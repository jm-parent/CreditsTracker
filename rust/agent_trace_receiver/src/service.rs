//! The Rust port of `reference/src/agent-trace-service.ts`: owns the agent trace store, the opt-in
//! saved in it, and the localhost receiver that runs while collection is on.
//!
//! The TypeScript service serializes its lifecycle calls through a promise queue. Here every call
//! runs to completion under one lock, which gives the same order. Store and receiver errors become
//! the status `errorMessage`, as they do in TypeScript; the message is derived from the three
//! recorded messages on each read, so it is never stale.

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use agent_trace_store::port::{AgentTraceStore, open_agent_trace_store};
use serde_json::json;
use shared::{
    AgentTraceAvailability, AgentTraceCollectionStatus, AgentTraceSelection, AgentTraceSession,
};

use crate::port::{
    AgentTracePartialSuccess, AgentTraceReceiver, ReceiverOptions, start_agent_trace_receiver,
};

const PURGE_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
const AGENT_TRACE_DB_NAME: &str = "agent-trace-store.db";
const SCOPE: &str = "agent-trace-service";

pub type StoreFactory = Box<dyn Fn(&Path) -> Result<AgentTraceStore, String> + Send + Sync>;
pub type ReceiverFactory =
    Box<dyn Fn(ReceiverOptions) -> Result<AgentTraceReceiver, String> + Send + Sync>;

/// Test seams, as in TypeScript: `None` uses the default store and receiver.
#[derive(Default)]
pub struct AgentTraceServiceDependencies {
    pub store_factory: Option<StoreFactory>,
    pub receiver_factory: Option<ReceiverFactory>,
}

pub struct AgentTraceService {
    store_path: PathBuf,
    store_factory: StoreFactory,
    receiver_factory: ReceiverFactory,
    messages: Arc<Mutex<Messages>>,
    state: Mutex<State>,
}

/// The messages behind the status `errorMessage`. Receiver callbacks write here from other threads,
/// so this lock is separate from the lifecycle lock.
#[derive(Default)]
struct Messages {
    lifecycle_error: Option<String>,
    export_rejection: Option<String>,
    partial_coverage: Option<String>,
}

impl Messages {
    fn current(&self) -> Option<String> {
        self.lifecycle_error
            .clone()
            .or_else(|| self.export_rejection.clone())
            .or_else(|| self.partial_coverage.clone())
    }
}

#[derive(Default)]
struct State {
    store: Option<Arc<Mutex<AgentTraceStore>>>,
    receiver: Option<AgentTraceReceiver>,
    purge: Option<Purge>,
    enabled: bool,
    listening: bool,
    endpoint: Option<String>,
    is_shutdown: bool,
}

/// The daily purge thread. Dropping `stop` ends it.
struct Purge {
    stop: Sender<()>,
    handle: JoinHandle<()>,
}

pub fn create_agent_trace_service(
    user_data_path: &Path,
    dependencies: AgentTraceServiceDependencies,
) -> AgentTraceService {
    AgentTraceService {
        store_path: user_data_path.join(AGENT_TRACE_DB_NAME),
        store_factory: dependencies
            .store_factory
            .unwrap_or_else(|| Box::new(default_store)),
        receiver_factory: dependencies
            .receiver_factory
            .unwrap_or_else(|| Box::new(start_agent_trace_receiver)),
        messages: Arc::new(Mutex::new(Messages::default())),
        state: Mutex::new(State::default()),
    }
}

impl AgentTraceService {
    pub fn initialize(&self) {
        let mut state = self.state.lock().unwrap();
        if state.is_shutdown {
            return;
        }
        self.do_initialize(&mut state);
    }

    pub fn get_status(&self) -> AgentTraceCollectionStatus {
        let state = self.state.lock().unwrap();
        self.status(&state)
    }

    pub fn set_enabled(&self, enabled: bool) -> AgentTraceCollectionStatus {
        let mut state = self.state.lock().unwrap();
        if state.is_shutdown {
            return self.status(&state);
        }
        if let Some(store) = self.ensure_store(&mut state) {
            if enabled {
                self.enable_collection(&mut state, &store, true, true);
            } else {
                self.disable_collection(&mut state, &store, true);
            }
        }
        self.status(&state)
    }

    pub fn get_session(&self, selection: &AgentTraceSelection) -> AgentTraceSession {
        let mut state = self.state.lock().unwrap();
        let Some(store) = self.ensure_store(&mut state) else {
            return not_collected(selection);
        };
        let session = store.lock().unwrap().get_session(selection);
        match session {
            Ok(session) => session,
            Err(error) => {
                record_error(&self.messages, "Failed to read local agent trace data", &error.to_string());
                not_collected(selection)
            }
        }
    }

    pub fn clear(&self) {
        let mut state = self.state.lock().unwrap();
        let Some(store) = self.ensure_store(&mut state) else {
            return;
        };
        if let Some(receiver) = &state.receiver {
            receiver.discard_pending();
        }
        let cleared = store.lock().unwrap().clear();
        match cleared {
            Ok(()) => self.messages.lock().unwrap().partial_coverage = None,
            Err(error) => record_error(&self.messages, "Failed to clear local agent trace data", &error.to_string()),
        }
    }

    pub fn shutdown(&self) {
        let mut state = self.state.lock().unwrap();
        if state.is_shutdown {
            return;
        }
        state.is_shutdown = true;
        if let Some(purge) = state.purge.take() {
            let Purge { stop, handle } = purge;
            drop(stop);
            let _ = handle.join();
        }
        if let Some(receiver) = state.receiver.take() {
            receiver.close();
        }
        if let Some(store) = state.store.take() {
            store.lock().unwrap().close();
        }
        set_disabled(&mut state);
    }

    fn status(&self, state: &State) -> AgentTraceCollectionStatus {
        AgentTraceCollectionStatus {
            enabled: state.enabled,
            listening: state.listening,
            endpoint: state.endpoint.clone(),
            error_message: self.messages.lock().unwrap().current(),
        }
    }

    fn do_initialize(&self, state: &mut State) {
        let Some(store) = self.ensure_store(state) else {
            return;
        };
        let collection_enabled = store.lock().unwrap().get_collection_enabled();
        match collection_enabled {
            Ok(true) => self.enable_collection(state, &store, false, false),
            Ok(false) => {
                self.messages.lock().unwrap().lifecycle_error = None;
                set_disabled(state);
            }
            Err(error) => record_error(&self.messages, "Failed to read the local agent trace opt-in", &error.to_string()),
        }
    }

    /// Opens the store on first use and starts its purge. `None` when the service is shut down or
    /// the store cannot be opened.
    fn ensure_store(&self, state: &mut State) -> Option<Arc<Mutex<AgentTraceStore>>> {
        if state.is_shutdown {
            return None;
        }
        if let Some(store) = &state.store {
            return Some(store.clone());
        }

        let opened = (self.store_factory)(&self.store_path).and_then(|mut store| {
            store.prune_expired(now_ms()).map_err(|error| error.to_string())?;
            Ok(store)
        });
        match opened {
            Ok(store) => {
                let store = Arc::new(Mutex::new(store));
                if state.purge.is_none() {
                    state.purge = Some(start_purge(store.clone(), self.messages.clone()));
                }
                state.store = Some(store.clone());
                self.messages.lock().unwrap().lifecycle_error = None;
                Some(store)
            }
            Err(error) => {
                record_error(&self.messages, "Failed to initialize local agent trace storage", &error);
                None
            }
        }
    }

    fn enable_collection(
        &self,
        state: &mut State,
        store: &Arc<Mutex<AgentTraceStore>>,
        persist_enabled: bool,
        reset_enabled_on_failure: bool,
    ) {
        if state.receiver.is_some() {
            if persist_enabled {
                let persisted = store.lock().unwrap().set_collection_enabled(true);
                if let Err(error) = persisted {
                    record_error(&self.messages, "Failed to persist local agent trace opt-in", &error.to_string());
                    return;
                }
            }
            self.messages.lock().unwrap().lifecycle_error = None;
            let endpoint = state.receiver.as_ref().map(|receiver| receiver.endpoint().to_owned());
            set_listening(state, endpoint);
            return;
        }

        let started = self.start_receiver(store).and_then(|receiver| {
            if !persist_enabled {
                return Ok(receiver);
            }
            let persisted = store.lock().unwrap().set_collection_enabled(true);
            match persisted {
                Ok(()) => Ok(receiver),
                Err(error) => {
                    receiver.close();
                    Err(error.to_string())
                }
            }
        });

        match started {
            Ok(receiver) => {
                let endpoint = receiver.endpoint().to_owned();
                state.receiver = Some(receiver);
                self.messages.lock().unwrap().lifecycle_error = None;
                set_listening(state, Some(endpoint));
            }
            Err(error) => {
                state.receiver = None;
                if reset_enabled_on_failure {
                    let reset = store.lock().unwrap().set_collection_enabled(false);
                    if let Err(reset_error) = reset {
                        record_error(
                            &self.messages,
                            "Failed to reset local agent trace opt-in after a startup error",
                            &reset_error.to_string(),
                        );
                    }
                }
                record_error(&self.messages, "Failed to start the local agent trace receiver", &error);
                set_disabled(state);
            }
        }
    }

    fn start_receiver(&self, store: &Arc<Mutex<AgentTraceStore>>) -> Result<AgentTraceReceiver, String> {
        let partial_messages = self.messages.clone();
        let rejection_messages = self.messages.clone();
        (self.receiver_factory)(ReceiverOptions {
            store: store.clone(),
            port: None,
            on_partial_success: Some(Arc::new(move |partial: Option<AgentTracePartialSuccess>| {
                let mut messages = partial_messages.lock().unwrap();
                messages.partial_coverage = partial.as_ref().map(|p| p.error_message.clone());
                if partial.is_none() {
                    messages.export_rejection = None;
                }
            })),
            on_export_rejected: Some(Arc::new(move |rejection| {
                rejection_messages.lock().unwrap().export_rejection = Some(rejection.error_message);
            })),
            correlation: Default::default(),
        })
    }

    fn disable_collection(&self, state: &mut State, store: &Arc<Mutex<AgentTraceStore>>, persist_disabled: bool) {
        if let Some(receiver) = state.receiver.take() {
            receiver.close();
        }
        if persist_disabled {
            let persisted = store.lock().unwrap().set_collection_enabled(false);
            if let Err(error) = persisted {
                record_error(&self.messages, "Failed to persist local agent trace opt-out", &error.to_string());
            }
        }
        set_disabled(state);
    }
}

fn set_listening(state: &mut State, endpoint: Option<String>) {
    state.enabled = true;
    state.listening = true;
    state.endpoint = endpoint;
}

fn set_disabled(state: &mut State) {
    state.enabled = false;
    state.listening = false;
    state.endpoint = None;
}

fn record_error(messages: &Mutex<Messages>, message: &str, error: &str) {
    let _ = logger::port::log_error(
        SCOPE.into(),
        message.into(),
        Some(json!({ "error": error })),
    );
    messages.lock().unwrap().lifecycle_error = Some(format!("{message}: {error}"));
}

fn start_purge(store: Arc<Mutex<AgentTraceStore>>, messages: Arc<Mutex<Messages>>) -> Purge {
    let (stop, stopped) = mpsc::channel::<()>();
    let handle = thread::spawn(move || {
        while let Err(RecvTimeoutError::Timeout) = stopped.recv_timeout(PURGE_INTERVAL) {
            let purged = store.lock().unwrap().prune_expired(now_ms());
            if let Err(error) = purged {
                record_error(&messages, "Failed to purge expired local agent trace data", &error.to_string());
            }
        }
    });
    Purge { stop, handle }
}

fn default_store(path: &Path) -> Result<AgentTraceStore, String> {
    open_agent_trace_store(path).map_err(|error| error.to_string())
}

fn not_collected(selection: &AgentTraceSelection) -> AgentTraceSession {
    AgentTraceSession {
        source: selection.source,
        session_id: selection.session_id.clone(),
        availability: AgentTraceAvailability::NotCollected,
        spans: Vec::new(),
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}
