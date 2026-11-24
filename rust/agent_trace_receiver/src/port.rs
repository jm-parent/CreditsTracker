//! The Rust port of `reference/src/agent-trace-receiver.ts`: the OTLP/HTTP receiver on localhost.
//! It listens on 127.0.0.1 only and refuses requests from a browser or a foreign host. Each export
//! gets the same status, headers and OTLP response body as the TypeScript receiver.
//!
//! ponytail: the expiry timer is a thread that polls every 25 ms instead of sleeping until the next
//! expiry. A held trace is therefore resolved up to 25 ms late; the stored result is the same.

use std::io;
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::http::{Body, Connection, Request, RequestError, answer_busy, drain_refused};
use agent_trace_correlator::port::{
    AgentTraceCorrelationInput, AgentTraceCorrelationResult, AgentTraceCorrelator,
    AgentTraceCorrelatorOptions, AgentTraceRejectionCounts, PENDING_TRACE_TTL_MS,
    create_agent_trace_correlator, decoded_to_correlation_facts,
};
use agent_trace_protocol::otlp::opentelemetry::proto::collector::trace::v1::{
    ExportTracePartialSuccess, ExportTraceServiceResponse,
};
use agent_trace_protocol::port::decode_otlp_trace_request;
use agent_trace_sanitizer::port::sanitize_unattributed_agent_trace_span;
use agent_trace_store::port::AgentTraceStore;
use prost::Message;
use serde::Serialize;
use serde_json::{Value, json};

pub const DEFAULT_PORT: u16 = 4318;

const LOOPBACK_HOST: &str = "127.0.0.1";
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
/// Connections open at once. Each holds a thread, and a thread reading a body holds up to
/// `MAX_BODY_BYTES`. Node has no cap, but this receiver serves a few local exporters.
/// ponytail: a fixed cap of 16 with a 503 refusal; a worker pool with a queue would smooth bursts.
pub const MAX_CONCURRENT_CONNECTIONS: usize = 16;
/// Most refused connections whose request is drained at once. Past it, a refusal closes right after its 503.
pub const MAX_REFUSAL_DRAINS: usize = 32;
const ACCEPT_RETRY: Duration = Duration::from_millis(10);
const OTLP_PATH: &str = "/v1/traces";
const OTLP_CONTENT_TYPE: &str = "application/x-protobuf";
const EXPIRY_POLL: Duration = Duration::from_millis(25);
const SCOPE: &str = "agent-trace-receiver";

/// Receives the partial-coverage outcome of an export, or `None` when every span was covered.
pub type PartialSuccessCallback = Arc<dyn Fn(Option<AgentTracePartialSuccess>) + Send + Sync>;
/// Receives an export refused before decoding (wrong content type or oversized body).
pub type ExportRejectedCallback = Arc<dyn Fn(AgentTraceExportRejection) + Send + Sync>;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTracePartialSuccess {
    pub total_rejected_spans: usize,
    pub unsupported_source_spans: usize,
    pub missing_source_session_spans: usize,
    pub unresolved_trace_root_spans: usize,
    pub error_message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTraceExportRejection {
    pub status: u16,
    pub error_message: String,
}

pub struct ReceiverOptions {
    pub store: Arc<Mutex<AgentTraceStore>>,
    pub port: Option<u16>,
    pub on_partial_success: Option<PartialSuccessCallback>,
    pub on_export_rejected: Option<ExportRejectedCallback>,
    pub correlation: AgentTraceCorrelatorOptions,
}

/// State shared by the acceptor, the connection threads and the expiry timer.
struct Shared {
    store: Arc<Mutex<AgentTraceStore>>,
    /// Locked before the store, never the other way round, so an export is stored in one step.
    correlator: Mutex<AgentTraceCorrelator>,
    pending_ttl_ms: f64,
    on_partial_success: Option<PartialSuccessCallback>,
    on_export_rejected: Option<ExportRejectedCallback>,
    closing: AtomicBool,
    connections: Arc<AtomicUsize>,
}

pub struct AgentTraceReceiver {
    endpoint: String,
    port: u16,
    shared: Arc<Shared>,
    acceptor: Mutex<Option<JoinHandle<()>>>,
    expiry: Mutex<Option<JoinHandle<()>>>,
    closed: AtomicBool,
}

pub fn start_agent_trace_receiver(options: ReceiverOptions) -> Result<AgentTraceReceiver, String> {
    let port = options.port.unwrap_or(DEFAULT_PORT);
    let listener = TcpListener::bind((LOOPBACK_HOST, port)).map_err(|error| error.to_string())?;
    let listening_port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();

    let shared = Arc::new(Shared {
        store: options.store,
        pending_ttl_ms: options
            .correlation
            .pending_ttl_ms
            .unwrap_or(PENDING_TRACE_TTL_MS as f64),
        correlator: Mutex::new(create_agent_trace_correlator(options.correlation)),
        on_partial_success: options.on_partial_success,
        on_export_rejected: options.on_export_rejected,
        closing: AtomicBool::new(false),
        connections: Arc::new(AtomicUsize::new(0)),
    });

    let expiry = {
        let shared = shared.clone();
        thread::Builder::new()
            .spawn(move || expire_held_traces(&shared))
            .map_err(|error| error.to_string())?
    };
    let acceptor = {
        let for_acceptor = shared.clone();
        thread::Builder::new()
            .spawn(move || accept_connections(&listener, &for_acceptor, listening_port))
            .map_err(|error| {
                shared.closing.store(true, Ordering::SeqCst);
                error.to_string()
            })?
    };

    Ok(AgentTraceReceiver {
        endpoint: format!("http://{LOOPBACK_HOST}:{listening_port}"),
        port: listening_port,
        shared,
        acceptor: Mutex::new(Some(acceptor)),
        expiry: Mutex::new(Some(expiry)),
        closed: AtomicBool::new(false),
    })
}

impl AgentTraceReceiver {
    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    /// Stops accepting, waits for the requests in flight, then stores the spans still held and
    /// reports their coverage. Later calls do nothing.
    pub fn close(&self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        self.shared.closing.store(true, Ordering::SeqCst);
        // The acceptor blocks in accept(). This connection wakes it so it sees `closing`.
        let _ = TcpStream::connect((LOOPBACK_HOST, self.port));
        if let Some(handle) = self.acceptor.lock().unwrap().take() {
            let _ = handle.join();
        }
        if let Some(handle) = self.expiry.lock().unwrap().take() {
            let _ = handle.join();
        }

        let flushed = self.shared.correlator.lock().unwrap().flush_all();
        match flushed {
            Ok(result) => store_held(&self.shared, result),
            Err(error) => log_error_detail("Failed to flush held OTLP spans", json!({ "error": error })),
        }
    }

    /// Forgets spans held in memory while their trace root is awaited.
    pub fn discard_pending(&self) {
        self.shared.correlator.lock().unwrap().discard_pending();
    }
}

/// Counts one open connection for as long as it is alive.
struct ConnectionSlot(Arc<AtomicUsize>);

impl ConnectionSlot {
    fn take(count: &Arc<AtomicUsize>) -> Option<Self> {
        if count.fetch_add(1, Ordering::SeqCst) < MAX_CONCURRENT_CONNECTIONS {
            Some(Self(count.clone()))
        } else {
            count.fetch_sub(1, Ordering::SeqCst);
            None
        }
    }
}

impl Drop for ConnectionSlot {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Counts one refusal drain thread for as long as it is alive.
struct RefusalDrain(Arc<AtomicUsize>);

impl RefusalDrain {
    fn take(count: &Arc<AtomicUsize>) -> Option<Self> {
        if count.fetch_add(1, Ordering::SeqCst) < MAX_REFUSAL_DRAINS {
            Some(Self(count.clone()))
        } else {
            count.fetch_sub(1, Ordering::SeqCst);
            None
        }
    }
}

impl Drop for RefusalDrain {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// Answers a refused connection with 503. It is then drained on its own thread while fewer than
/// `MAX_REFUSAL_DRAINS` drains run; past that, the connection closes right after the 503.
fn refuse(mut stream: TcpStream, drains: &Arc<AtomicUsize>) {
    if !answer_busy(&mut stream) {
        return;
    }
    let Some(drain) = RefusalDrain::take(drains) else {
        return;
    };
    // The guard moves into the thread, so the count is released when the drain ends or the spawn fails.
    let _ = thread::Builder::new().spawn(move || {
        let _drain = drain;
        drain_refused(stream);
    });
}

fn accept_connections(listener: &TcpListener, shared: &Arc<Shared>, port: u16) {
    let mut handlers: Vec<JoinHandle<()>> = Vec::new();
    let drains = Arc::new(AtomicUsize::new(0));
    loop {
        let stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(error) => {
                if shared.closing.load(Ordering::SeqCst) {
                    break;
                }
                log_error_detail("Failed to accept an OTLP connection", json!({ "error": error.to_string() }));
                thread::sleep(ACCEPT_RETRY);
                continue;
            }
        };
        if shared.closing.load(Ordering::SeqCst) {
            break;
        }

        let Some(slot) = ConnectionSlot::take(&shared.connections) else {
            log_once_detail(
                "agent-trace-receiver:busy",
                "Refused an OTLP connection: too many connections are open",
                json!({ "status": 503, "limit": MAX_CONCURRENT_CONNECTIONS }),
            );
            refuse(stream, &drains);
            continue;
        };
        handlers.retain(|handle| !handle.is_finished());
        let shared = shared.clone();
        match thread::Builder::new().spawn(move || {
            let _slot = slot;
            serve_connection(stream, &shared, port);
        }) {
            Ok(handle) => handlers.push(handle),
            Err(error) => {
                log_error_detail("Failed to start an OTLP connection thread", json!({ "error": error.to_string() }))
            }
        }
    }
    for handle in handlers {
        let _ = handle.join();
    }
}

fn expire_held_traces(shared: &Shared) {
    while !shared.closing.load(Ordering::SeqCst) {
        thread::sleep(EXPIRY_POLL);
        let expired = shared.correlator.lock().unwrap().expire(now_ms());
        match expired {
            Ok(result) => store_held(shared, result),
            Err(error) => log_error_detail("Failed to expire held OTLP spans", json!({ "error": error })),
        }
    }
}

/// Stores the spans a held result released and reports what it dropped.
fn store_held(shared: &Shared, result: AgentTraceCorrelationResult) {
    if !result.ready.is_empty() {
        let stored = shared.store.lock().unwrap().insert_spans(&result.ready);
        if let Err(error) = stored {
            log_error_detail(
                "Failed to store held OTLP spans",
                json!({ "spans": result.ready.len(), "error": error.to_string() }),
            );
        }
    }

    if let Some(partial) = build_partial_coverage(
        AgentTraceRejectionCounts::default(),
        result.dropped,
        shared.pending_ttl_ms,
    ) && let Some(callback) = &shared.on_partial_success
    {
        callback(Some(partial));
    }
}

fn serve_connection(stream: TcpStream, shared: &Shared, port: u16) {
    let Ok(mut connection) = Connection::new(stream) else {
        return;
    };
    loop {
        let request = match connection.next_request() {
            Ok(Some(request)) => request,
            Ok(None) | Err(RequestError::Closed) => return,
            Err(RequestError::Malformed) => {
                let _ = connection.respond(400, None, &[], false);
                return;
            }
            Err(RequestError::ExpectationFailed(request)) => {
                connection.drain_body(&request);
                let _ = connection.respond(417, None, &[], false);
                return;
            }
        };
        let (reply, body_read) = handle_request(&mut connection, &request, shared, port);
        let keep_alive = body_read && request.keeps_alive();
        if send_reply(&mut connection, reply, keep_alive).is_err() || !keep_alive {
            return;
        }
    }
}

/// What the request is answered with: an empty response, or an OTLP export response.
enum Reply {
    Empty(u16),
    Otlp(Vec<u8>),
}

/// Why an export body could not be stored: a 400 when it does not decode, a 500 otherwise.
enum IngestError {
    Decode(String),
    Internal(String),
}

fn send_reply(connection: &mut Connection, reply: Reply, keep_alive: bool) -> io::Result<()> {
    match reply {
        Reply::Empty(status) => connection.respond(status, None, &[], keep_alive),
        Reply::Otlp(payload) => connection.respond(200, Some(OTLP_CONTENT_TYPE), &payload, keep_alive),
    }
}

/// Answers one request. Also returns whether its body was read to the end, which lets the connection
/// carry the next request.
fn handle_request(connection: &mut Connection, request: &Request, shared: &Shared, port: u16) -> (Reply, bool) {
    let route = route_of(&request.target);
    if let Some(reply) = early_rejection(request, &route, shared, port) {
        // Drain the body before answering, so the client can finish sending and the next request on
        // the connection is not read from it.
        let drained = connection.drain_body(request);
        return (reply, drained);
    }

    match connection.read_body(request, MAX_BODY_BYTES) {
        Ok(Body::Complete(body)) => (ingest_reply(&body, &route, shared), true),
        Ok(Body::TooLarge) => {
            report_export_rejection(
                shared,
                &route,
                AgentTraceExportRejection {
                    status: 413,
                    error_message:
                        "OTLP export rejected (HTTP 413): the request body exceeded the 8 MiB limit."
                            .into(),
                },
                None,
            );
            (Reply::Empty(413), false)
        }
        Err(error) if error.kind() == io::ErrorKind::InvalidData => {
            log_handler_failure(&route, 400, &error.to_string());
            (Reply::Empty(400), false)
        }
        Err(error) => {
            log_handler_failure(&route, 500, &error.to_string());
            (Reply::Empty(500), false)
        }
    }
}

/// The answer to a request that is refused before its body is read: a 403, 404, 405 or 415.
fn early_rejection(request: &Request, route: &str, shared: &Shared, port: u16) -> Option<Reply> {
    if let Some(reason) = forbidden_reason(request, port) {
        log_once_detail(
            &format!("agent-trace-receiver:forbidden:{reason}"),
            "Rejected an OTLP request that did not come from a local exporter",
            json!({ "route": route, "status": 403, "reason": reason }),
        );
        return Some(Reply::Empty(403));
    }

    if route != OTLP_PATH {
        return Some(Reply::Empty(404));
    }

    if request.method != "POST" {
        return Some(Reply::Empty(405));
    }

    let content_type = request.header("content-type");
    if !has_otlp_content_type(content_type) {
        let media_type = describe_media_type(content_type);
        report_export_rejection(
            shared,
            route,
            AgentTraceExportRejection {
                status: 415,
                error_message: format!(
                    "OTLP export rejected (HTTP 415): content type {media_type} is not supported; \
                     set the exporter protocol to http/protobuf."
                ),
            },
            Some(&media_type),
        );
        return Some(Reply::Empty(415));
    }

    None
}

fn ingest_reply(body: &[u8], route: &str, shared: &Shared) -> Reply {
    match ingest(body, shared) {
        Ok(payload) => Reply::Otlp(payload),
        Err(IngestError::Decode(error)) => {
            log_handler_failure(route, 400, &error);
            Reply::Empty(400)
        }
        Err(IngestError::Internal(error)) => {
            log_handler_failure(route, 500, &error);
            Reply::Empty(500)
        }
    }
}

/// Decodes and correlates an export, stores what is ready, reports coverage, and returns the
/// encoded OTLP response.
fn ingest(body: &[u8], shared: &Shared) -> Result<Vec<u8>, IngestError> {
    let decoded = decode_otlp_trace_request(body).map_err(|error| IngestError::Decode(error.to_string()))?;
    let inputs = decoded
        .iter()
        .map(|span| {
            Ok(AgentTraceCorrelationInput {
                facts: decoded_to_correlation_facts(span),
                span: sanitize_unattributed_agent_trace_span(span).map_err(IngestError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, IngestError>>()?;

    let result = {
        let mut correlator = shared.correlator.lock().unwrap();
        let result = correlator
            .ingest(&inputs, now_ms())
            .map_err(IngestError::Internal)?;
        shared
            .store
            .lock()
            .unwrap()
            .insert_spans(&result.ready)
            .map_err(|error| IngestError::Internal(error.to_string()))?;
        result
    };

    let partial = build_partial_coverage(result.rejected, result.dropped, shared.pending_ttl_ms);
    if let Some(callback) = &shared.on_partial_success {
        if partial.is_some() {
            callback(partial.clone());
        } else if result.held == 0 {
            callback(None);
        }
    }

    // The response reports only the spans this export rejected, as the TypeScript receiver does.
    let response_partial = build_partial_coverage(
        result.rejected,
        AgentTraceRejectionCounts::default(),
        shared.pending_ttl_ms,
    );
    Ok(encode_response(response_partial.as_ref()))
}

fn encode_response(partial: Option<&AgentTracePartialSuccess>) -> Vec<u8> {
    ExportTraceServiceResponse {
        partial_success: partial.map(|partial| ExportTracePartialSuccess {
            rejected_spans: partial.total_rejected_spans as i64,
            error_message: partial.error_message.clone(),
        }),
    }
    .encode_to_vec()
}

fn report_export_rejection(
    shared: &Shared,
    route: &str,
    rejection: AgentTraceExportRejection,
    content_type: Option<&str>,
) {
    let mut detail = json!({ "route": route, "status": rejection.status });
    if let Some(content_type) = content_type {
        detail["contentType"] = json!(content_type);
    }
    log_once_detail(
        &format!("agent-trace-receiver:{}:{}", rejection.status, content_type.unwrap_or("")),
        "Rejected an OTLP export before decoding",
        detail,
    );
    if let Some(callback) = &shared.on_export_rejected {
        callback(rejection);
    }
}

/// Refuses requests with an `Origin` header (a browser) or a `Host` other than this loopback
/// listener. Exporters send neither a browser origin nor a foreign host.
fn forbidden_reason(request: &Request, port: u16) -> Option<&'static str> {
    if request.header("origin").is_some() {
        return Some("origin");
    }
    let host = request.header("host").unwrap_or("").trim();
    if is_local_host(host, port) { None } else { Some("host") }
}

fn is_local_host(host: &str, port: u16) -> bool {
    let host = host.to_ascii_lowercase();
    let (name, host_port) = match host.split_once(':') {
        Some((name, host_port)) => (name, Some(host_port)),
        None => (host.as_str(), None),
    };
    if name != LOOPBACK_HOST && name != "localhost" {
        return false;
    }
    match host_port {
        None => true,
        Some(digits) => {
            (1..=5).contains(&digits.len())
                && digits.bytes().all(|byte| byte.is_ascii_digit())
                && digits.parse::<u32>().ok() == Some(u32::from(port))
        }
    }
}

fn has_otlp_content_type(content_type: Option<&str>) -> bool {
    media_type_of(content_type) == OTLP_CONTENT_TYPE
}

/// The lowercase media type without parameters, as the TypeScript receiver reads it.
fn media_type_of(content_type: Option<&str>) -> String {
    content_type
        .and_then(|value| value.split(';').next())
        .unwrap_or("")
        .trim()
        .to_lowercase()
}

/// The media type for a log line, or a placeholder when it is missing or not a media type.
fn describe_media_type(content_type: Option<&str>) -> String {
    let media_type = media_type_of(content_type);
    if media_type.is_empty() {
        "(missing)".into()
    } else if is_media_type(&media_type) {
        media_type
    } else {
        "(unrecognized)".into()
    }
}

/// `^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$`
fn is_media_type(value: &str) -> bool {
    value
        .split_once('/')
        .is_some_and(|(kind, subtype)| is_media_token(kind) && is_media_token(subtype))
}

fn is_media_token(token: &str) -> bool {
    let bytes = token.as_bytes();
    (1..=64).contains(&bytes.len())
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes[1..]
            .iter()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"!#$&^_.+-".contains(byte))
}

/// Port of `buildPartialCoverage`: the coverage message for spans that were rejected or dropped.
fn build_partial_coverage(
    rejected: AgentTraceRejectionCounts,
    dropped: AgentTraceRejectionCounts,
    pending_ttl_ms: f64,
) -> Option<AgentTracePartialSuccess> {
    let unsupported = rejected.unsupported_source + dropped.unsupported_source;
    let missing = rejected.missing_source_session + dropped.missing_source_session;
    let unresolved = rejected.unresolved_trace_root + dropped.unresolved_trace_root;
    let total = unsupported + missing + unresolved;
    if total == 0 {
        return None;
    }

    let mut reasons = Vec::new();
    if unsupported > 0 {
        reasons.push(format!("{unsupported} from unsupported source"));
    }
    if missing > 0 {
        reasons.push(format!("{missing} without source/session context"));
    }
    if unresolved > 0 {
        reasons.push(format!(
            "{unresolved} without a trace root or conversation context after {}",
            format_hold_duration(pending_ttl_ms)
        ));
    }

    Some(AgentTracePartialSuccess {
        total_rejected_spans: total,
        unsupported_source_spans: unsupported,
        missing_source_session_spans: missing,
        unresolved_trace_root_spans: unresolved,
        error_message: format!(
            "partial trace coverage: rejected {total} span(s): {}",
            reasons.join(", ")
        ),
    })
}

fn format_hold_duration(milliseconds: f64) -> String {
    if milliseconds < 1_000.0 {
        format!("{milliseconds} ms")
    } else {
        format!("{} s", (milliseconds / 1_000.0).round())
    }
}

/// `/v1/traces` for `/v1/traces?x=1`, as the TypeScript receiver reads the pathname.
fn route_of(url: &str) -> String {
    url.split(['?', '#']).next().unwrap_or("/").to_owned()
}

fn now_ms() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as f64)
        .unwrap_or(0.0)
}

fn log_handler_failure(route: &str, status: u16, error: &str) {
    log_error_detail(
        "Failed to handle OTLP trace request",
        json!({ "route": route, "status": status, "error": error }),
    );
}

fn log_error_detail(message: &str, detail: Value) {
    let _ = logger::port::log_error(SCOPE.into(), message.into(), Some(detail));
}

fn log_once_detail(key: &str, message: &str, detail: Value) {
    let _ = logger::port::log_once(
        key.into(),
        "warn".into(),
        SCOPE.into(),
        message.into(),
        Some(detail),
    );
}
