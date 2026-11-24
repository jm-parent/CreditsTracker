//! Replays `reference/scenarios/agent-trace-receiver-scenarios.ts` against the Rust receiver and service.
//! The fixture is the TypeScript output: every request is sent over HTTP with the bytes it had there,
//! and each step's result (status, content type, response body, or the service status and session),
//! and the callbacks it fired, must match.

mod common;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use agent_trace_correlator::port::AgentTraceCorrelatorOptions;
use agent_trace_receiver::port::{
    AgentTraceExportRejection, AgentTracePartialSuccess, AgentTraceReceiver, ReceiverOptions,
    start_agent_trace_receiver,
};
use agent_trace_receiver::service::{
    AgentTraceService, AgentTraceServiceDependencies, ReceiverFactory, StoreFactory,
    create_agent_trace_service,
};
use agent_trace_store::port::{AgentTraceStore, open_agent_trace_store};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};
use shared::{AgentTraceCollectionStatus, AgentTraceSelection};

const FIXTURE: &str = include_str!("fixtures/scenarios.json");
/// Stands for the endpoint in the fixture, which differs on every run.
const ENDPOINT_TOKEN: &str = "<endpoint>";

struct Replay {
    folder: PathBuf,
    events: Arc<Mutex<Vec<Value>>>,
    store: Option<Arc<Mutex<AgentTraceStore>>>,
    receiver: Option<AgentTraceReceiver>,
    service: Option<AgentTraceService>,
}

impl Replay {
    fn new(folder: PathBuf) -> Self {
        Self {
            folder,
            events: Arc::new(Mutex::new(Vec::new())),
            store: None,
            receiver: None,
            service: None,
        }
    }

    fn perform(&mut self, step: &Value) -> Value {
        match self.execute(step) {
            Ok(ok) => json!({ "ok": ok }),
            Err(error) => json!({ "error": error }),
        }
    }

    fn execute(&mut self, step: &Value) -> Result<Value, String> {
        match step["call"].as_str().expect("call") {
            "startReceiver" => {
                self.receiver = Some(self.start_receiver(step)?);
                Ok(Value::Null)
            }
            "request" => self.request(step),
            "wait" => {
                thread::sleep(Duration::from_millis(step["ms"].as_u64().expect("ms")));
                Ok(Value::Null)
            }
            "discardPending" => {
                self.running_receiver()?.discard_pending();
                Ok(Value::Null)
            }
            "getSession" => {
                let selection = selection(step);
                let store = self.store.as_ref().ok_or("no store is open in this scenario")?;
                let session = store.lock().unwrap().get_session(&selection);
                to_value(session.map_err(|error| error.to_string())?)
            }
            "closeReceiver" => {
                self.running_receiver()?.close();
                self.receiver = None;
                if let Some(store) = &self.store {
                    store.lock().unwrap().close();
                }
                Ok(Value::Null)
            }
            "serviceCreate" => {
                self.service = Some(self.create_service(step));
                Ok(Value::Null)
            }
            "serviceInitialize" => {
                self.running_service()?.initialize();
                Ok(Value::Null)
            }
            "serviceStatus" => Ok(normalize(self.running_service()?.get_status())),
            "serviceSetEnabled" => {
                let enabled = step["enabled"].as_bool().expect("enabled");
                Ok(normalize(self.running_service()?.set_enabled(enabled)))
            }
            "serviceGetSession" => {
                let selection = selection(step);
                to_value(self.running_service()?.get_session(&selection))
            }
            "serviceClear" => {
                self.running_service()?.clear();
                Ok(Value::Null)
            }
            "serviceShutdown" => {
                self.running_service()?.shutdown();
                Ok(Value::Null)
            }
            other => panic!("unknown call {other}"),
        }
    }

    fn start_receiver(&mut self, step: &Value) -> Result<AgentTraceReceiver, String> {
        let store = open_agent_trace_store(&self.folder.join(step["dbPath"].as_str().expect("dbPath")))
            .map_err(|error| error.to_string())?;
        let store = Arc::new(Mutex::new(store));
        self.store = Some(store.clone());

        let partial_events = self.events.clone();
        let rejected_events = self.events.clone();
        start_agent_trace_receiver(ReceiverOptions {
            store,
            port: Some(0),
            on_partial_success: Some(Arc::new(move |value: Option<AgentTracePartialSuccess>| {
                let value = value.map_or(Value::Null, to_value_unchecked);
                partial_events
                    .lock()
                    .unwrap()
                    .push(json!({ "event": "partialSuccess", "value": value }));
            })),
            on_export_rejected: Some(Arc::new(move |value: AgentTraceExportRejection| {
                rejected_events
                    .lock()
                    .unwrap()
                    .push(json!({ "event": "exportRejected", "value": to_value_unchecked(value) }));
            })),
            correlation: AgentTraceCorrelatorOptions {
                pending_ttl_ms: step["pendingTtlMs"].as_f64(),
                ..Default::default()
            },
        })
    }

    /// Sends the request bytes recorded by the TypeScript scenario and returns what came back.
    fn request(&self, step: &Value) -> Result<Value, String> {
        let endpoint = if step["target"].as_str() == Some("service") {
            self.running_service()?.get_status().endpoint
        } else {
            Some(self.running_receiver()?.endpoint().to_owned())
        };
        let endpoint = endpoint.ok_or("the service is not listening")?;

        let wire = step["result"]["ok"]["wire"].clone();
        let headers: Vec<(String, String)> = wire["headers"]
            .as_object()
            .expect("headers")
            .iter()
            .map(|(name, value)| (name.clone(), value.as_str().expect("header").to_owned()))
            .collect();
        let body = wire["bodyBase64"]
            .as_str()
            .map(|encoded| STANDARD.decode(encoded).expect("base64 body"));
        let reply = common::exchange(
            common::port_of(&endpoint),
            wire["method"].as_str().expect("method"),
            wire["path"].as_str().expect("path"),
            &headers,
            body.as_deref(),
        );
        Ok(json!({
            "wire": wire,
            "response": {
                "status": reply.status,
                "contentType": reply.content_type,
                "bodyBase64": STANDARD.encode(&reply.body),
            },
        }))
    }

    fn create_service(&self, step: &Value) -> AgentTraceService {
        let folder = self.folder.join(step["userDataDir"].as_str().expect("userDataDir"));
        let mut dependencies = AgentTraceServiceDependencies {
            receiver_factory: Some(receiver_factory(step["receiverFailure"].as_str())),
            ..Default::default()
        };
        if let Some(message) = step["storeFailure"].as_str() {
            dependencies.store_factory = Some(failing_store(message.to_owned()));
        }
        create_agent_trace_service(&folder, dependencies)
    }

    fn running_receiver(&self) -> Result<&AgentTraceReceiver, String> {
        self.receiver
            .as_ref()
            .ok_or_else(|| "no receiver is running in this scenario".to_owned())
    }

    fn running_service(&self) -> Result<&AgentTraceService, String> {
        self.service
            .as_ref()
            .ok_or_else(|| "no service exists in this scenario".to_owned())
    }

    fn finish(mut self) {
        if let Some(receiver) = self.receiver.take() {
            receiver.close();
        }
        if let Some(store) = self.store.take() {
            store.lock().unwrap().close();
        }
        if let Some(service) = self.service.take() {
            service.shutdown();
        }
    }
}

/// The TypeScript scenario wires its receiver to an ephemeral port; `failure` replaces it with a
/// factory that fails with that message, as the TypeScript test double does.
fn receiver_factory(failure: Option<&str>) -> ReceiverFactory {
    match failure {
        Some(message) => {
            let message = message.to_owned();
            Box::new(move |_| Err(message.clone()))
        }
        None => Box::new(|mut options: ReceiverOptions| {
            options.port = Some(0);
            start_agent_trace_receiver(options)
        }),
    }
}

fn failing_store(message: String) -> StoreFactory {
    Box::new(move |_| Err(message.clone()))
}

fn selection(step: &Value) -> AgentTraceSelection {
    serde_json::from_value(step["selection"].clone()).expect("selection")
}

fn to_value<T: serde::Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

fn to_value_unchecked<T: serde::Serialize>(value: T) -> Value {
    serde_json::to_value(value).expect("serializable")
}

fn normalize(status: AgentTraceCollectionStatus) -> Value {
    let endpoint = status.endpoint.as_ref().map(|_| ENDPOINT_TOKEN);
    json!({
        "enabled": status.enabled,
        "listening": status.listening,
        "endpoint": endpoint,
        "errorMessage": status.error_message,
    })
}

#[test]
fn replays_the_typescript_receiver_and_service_scenarios() {
    let scenarios: Vec<Value> = serde_json::from_str(FIXTURE).expect("fixture");
    for scenario in scenarios {
        let name = scenario["name"].as_str().expect("name").to_owned();
        let mut replay = Replay::new(common::scratch(&name));
        for (index, step) in scenario["steps"].as_array().expect("steps").iter().enumerate() {
            let result = js_numbers(replay.perform(step));
            let events: Vec<Value> = replay.events.lock().unwrap().drain(..).map(js_numbers).collect();
            let call = step["call"].as_str().expect("call");
            assert_eq!(result, js_numbers(step["result"].clone()), "{name} step {index} ({call}): result");
            assert_eq!(Value::Array(events), js_numbers(step["events"].clone()), "{name} step {index} ({call}): events");
        }
        replay.finish();
    }
}

/// JavaScript has one number type, so `5000.0` from Rust and `5000` from the fixture are the same
/// value. Integral floats become integers before the comparison.
fn js_numbers(value: Value) -> Value {
    match value {
        Value::Number(number) => match number.as_f64() {
            Some(float) if float.fract() == 0.0 && float.abs() < 9.0e15 => json!(float as i64),
            _ => Value::Number(number),
        },
        Value::Array(items) => Value::Array(items.into_iter().map(js_numbers).collect()),
        Value::Object(fields) => Value::Object(
            fields.into_iter().map(|(key, value)| (key, js_numbers(value))).collect(),
        ),
        other => other,
    }
}
