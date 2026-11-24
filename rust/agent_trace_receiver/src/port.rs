//! The Rust port of `reference/src/agent-trace-receiver.ts`: the OTLP/HTTP receiver on localhost.
//! It listens on 127.0.0.1 only and refuses requests from a browser or a foreign host. Each export
//! gets the same status, headers and OTLP response body as the TypeScript receiver.
//!
//! ponytail: the expiry timer is a thread that polls every 25 ms instead of sleeping until the next
//! expiry. A held trace is therefore resolved up to 25 ms late; the stored result is the same.

use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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

/// State shared by the acceptor, the request threads and the expiry timer.
struct Shared {
    store: Arc<Mutex<AgentTraceStore>>,
    /// Locked before the store, never the other way round, so an export is stored in one step.
    correlator: Mutex<AgentTraceCorrelator>,
    pending_ttl_ms: f64,
    on_partial_success: Option<PartialSuccessCallback>,
    on_export_rejected: Option<ExportRejectedCallback>,
    closing: AtomicBool,
}

pub struct AgentTraceReceiver {
    endpoint: String,
    shared: Arc<Shared>,
    server: Arc<tiny_http::Server>,
    acceptor: Mutex<Option<JoinHandle<()>>>,
    expiry: Mutex<Option<JoinHandle<()>>>,
    closed: AtomicBool,
}

pub fn start_agent_trace_receiver(options: ReceiverOptions) -> Result<AgentTraceReceiver, String> {
    let port = options.port.unwrap_or(DEFAULT_PORT);
    let server = Arc::new(
        tiny_http::Server::http((LOOPBACK_HOST, port)).map_err(|error| error.to_string())?,
    );
    let listening_port = server
        .server_addr()
        .to_ip()
        .map(|address| address.port())
        .ok_or("Agent trace receiver did not bind to a TCP address")?;

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
    });

    let acceptor = {
        let (server, shared) = (server.clone(), shared.clone());
        thread::spawn(move || accept_requests(&server, &shared, listening_port))
    };
    let expiry = {
        let shared = shared.clone();
        thread::spawn(move || expire_held_traces(&shared))
    };

    Ok(AgentTraceReceiver {
        endpoint: format!("http://{LOOPBACK_HOST}:{listening_port}"),
        shared,
        server,
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
        self.server.unblock();
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

fn accept_requests(server: &tiny_http::Server, shared: &Arc<Shared>, port: u16) {
    let mut handlers: Vec<JoinHandle<()>> = Vec::new();
    while let Ok(request) = server.recv() {
        if shared.closing.load(Ordering::SeqCst) {
            break;
        }
        handlers.retain(|handle| !handle.is_finished());
        let shared = shared.clone();
        handlers.push(thread::spawn(move || handle_request(request, &shared, port)));
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

fn handle_request(mut request: tiny_http::Request, shared: &Shared, port: u16) {
    let route = route_of(request.url());
    let reply = reply_for(&mut request, &route, shared, port);
    let response = match reply {
        Reply::Empty(status) => request.respond(tiny_http::Response::empty(status)),
        Reply::Otlp(payload) => request.respond(
            tiny_http::Response::from_data(payload).with_header(content_type_header()),
        ),
    };
    let _ = response;
}

fn reply_for(request: &mut tiny_http::Request, route: &str, shared: &Shared, port: u16) -> Reply {
    if let Some(reason) = forbidden_reason(request, port) {
        log_once_detail(
            &format!("agent-trace-receiver:forbidden:{reason}"),
            "Rejected an OTLP request that did not come from a local exporter",
            json!({ "route": route, "status": 403, "reason": reason }),
        );
        return Reply::Empty(403);
    }

    if route != OTLP_PATH {
        return Reply::Empty(404);
    }

    if request.method() != &tiny_http::Method::Post {
        return Reply::Empty(405);
    }

    let content_type = header(request, "content-type");
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
        return Reply::Empty(415);
    }

    let body = match read_body(request) {
        Ok(Some(body)) => body,
        Ok(None) => {
            report_export_rejection(
                shared,
                route,
                AgentTraceExportRejection {
                    status: 413,
                    error_message:
                        "OTLP export rejected (HTTP 413): the request body exceeded the 8 MiB limit."
                            .into(),
                },
                None,
            );
            return Reply::Empty(413);
        }
        Err(error) => {
            log_handler_failure(route, 500, &error.to_string());
            return Reply::Empty(500);
        }
    };

    match ingest(&body, shared) {
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

    let partial = build_partial_coverage(result.rejected, AgentTraceRejectionCounts::default(), shared.pending_ttl_ms);
    if let Some(callback) = &shared.on_partial_success {
        if partial.is_some() {
            callback(partial.clone());
        } else if result.held == 0 {
            callback(None);
        }
    }

    Ok(encode_response(partial.as_ref()))
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

/// Reads the body up to the limit. `None` means it is larger than the limit.
fn read_body(request: &mut tiny_http::Request) -> std::io::Result<Option<Vec<u8>>> {
    let mut body = Vec::new();
    request
        .as_reader()
        .take(MAX_BODY_BYTES as u64 + 1)
        .read_to_end(&mut body)?;
    Ok((body.len() <= MAX_BODY_BYTES).then_some(body))
}

/// Refuses requests with an `Origin` header (a browser) or a `Host` other than this loopback
/// listener. Exporters send neither a browser origin nor a foreign host.
fn forbidden_reason(request: &tiny_http::Request, port: u16) -> Option<&'static str> {
    if header(request, "origin").is_some() {
        return Some("origin");
    }
    let host = header(request, "host").unwrap_or("").trim();
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

fn header<'a>(request: &'a tiny_http::Request, name: &'static str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv(name))
        .map(|header| header.value.as_str())
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

fn content_type_header() -> tiny_http::Header {
    tiny_http::Header::from_bytes(&b"Content-Type"[..], OTLP_CONTENT_TYPE.as_bytes())
        .expect("valid header")
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
