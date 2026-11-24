mod common;

use std::io::{ErrorKind, Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Duration;

use agent_trace_correlator::port::AgentTraceCorrelatorOptions;
use agent_trace_protocol::otlp::opentelemetry::proto::collector::trace::v1::ExportTraceServiceRequest;
use agent_trace_protocol::otlp::opentelemetry::proto::common::v1::{AnyValue, KeyValue, any_value::Value};
use agent_trace_protocol::otlp::opentelemetry::proto::resource::v1::Resource;
use agent_trace_protocol::otlp::opentelemetry::proto::trace::v1::{ResourceSpans, ScopeSpans, Span};
use agent_trace_receiver::port::{
    AgentTraceReceiver, MAX_CONCURRENT_CONNECTIONS, MAX_REFUSAL_DRAINS, ReceiverOptions,
    start_agent_trace_receiver,
};
use agent_trace_store::port::open_agent_trace_store;
use prost::Message;

fn string_attribute(key: &str, value: &str) -> KeyValue {
    KeyValue {
        key: key.into(),
        value: Some(AnyValue {
            value: Some(Value::StringValue(value.into())),
        }),
        ..Default::default()
    }
}

/// A Copilot CLI export with one agent root span, so a valid request is stored and answered with 200.
fn valid_export() -> Vec<u8> {
    let span = Span {
        trace_id: vec![0x0a; 16],
        span_id: vec![0x0b; 8],
        name: "invoke_agent copilot".into(),
        start_time_unix_nano: 1_795_000_000_000_000_000,
        end_time_unix_nano: 1_795_000_005_000_000_000,
        attributes: vec![string_attribute("gen_ai.conversation.id", "sess-1")],
        ..Default::default()
    };
    ExportTraceServiceRequest {
        resource_spans: vec![ResourceSpans {
            resource: Some(Resource {
                attributes: vec![string_attribute("service.name", "github-copilot")],
                ..Default::default()
            }),
            scope_spans: vec![ScopeSpans {
                spans: vec![span],
                ..Default::default()
            }],
            ..Default::default()
        }],
    }
    .encode_to_vec()
}

fn otlp_headers() -> Vec<(String, String)> {
    vec![
        ("host".into(), "127.0.0.1".into()),
        ("content-type".into(), "application/x-protobuf".into()),
    ]
}

#[test]
fn truncated_body_is_refused_and_the_next_valid_request_still_returns_200() {
    let folder = common::scratch("truncated-then-valid");
    let store = open_agent_trace_store(&folder.join("agent-trace-store.db")).expect("store");
    let receiver = start_agent_trace_receiver(ReceiverOptions {
        store: Arc::new(Mutex::new(store)),
        port: Some(0),
        on_partial_success: None,
        on_export_rejected: None,
        correlation: AgentTraceCorrelatorOptions::default(),
    })
    .expect("receiver");
    let port = common::port_of(receiver.endpoint());

    let body = valid_export();
    let truncated = common::exchange(
        port,
        "POST",
        "/v1/traces",
        &otlp_headers(),
        Some(&body[..body.len() / 2]),
    );
    assert!(
        (400..500).contains(&truncated.status),
        "a truncated body must be refused with a 4xx, got {}",
        truncated.status
    );

    let valid = common::exchange(port, "POST", "/v1/traces", &otlp_headers(), Some(&body));
    assert_eq!(
        valid.status, 200,
        "the request after a malformed one must still be accepted"
    );

    receiver.close();
}

#[test]
fn body_over_the_limit_is_refused_with_413() {
    let folder = common::scratch("oversized-body");
    let store = open_agent_trace_store(&folder.join("agent-trace-store.db")).expect("store");
    let receiver = start_agent_trace_receiver(ReceiverOptions {
        store: Arc::new(Mutex::new(store)),
        port: Some(0),
        on_partial_success: None,
        on_export_rejected: None,
        correlation: AgentTraceCorrelatorOptions::default(),
    })
    .expect("receiver");
    let port = common::port_of(receiver.endpoint());

    let oversized = vec![0u8; 8 * 1024 * 1024 + 1];
    let reply = common::exchange(port, "POST", "/v1/traces", &otlp_headers(), Some(&oversized));
    assert_eq!(reply.status, 413);

    receiver.close();
}

fn start(folder: &Path) -> AgentTraceReceiver {
    let store = open_agent_trace_store(&folder.join("agent-trace-store.db")).expect("store");
    start_agent_trace_receiver(ReceiverOptions {
        store: Arc::new(Mutex::new(store)),
        port: Some(0),
        on_partial_success: None,
        on_export_rejected: None,
        correlation: AgentTraceCorrelatorOptions::default(),
    })
    .expect("receiver")
}

#[test]
fn early_rejected_body_is_drained_so_the_next_request_on_the_connection_succeeds() {
    let folder = common::scratch("drain-early-reject");
    let receiver = start(&folder);
    let port = common::port_of(receiver.endpoint());

    let mut connection = common::KeepAlive::connect(port);
    let json_headers = vec![
        ("host".to_owned(), "127.0.0.1".to_owned()),
        ("content-type".to_owned(), "application/json".to_owned()),
    ];
    let rejected = connection.request_chunked("POST", "/v1/traces", &json_headers, &[b'x'; 4096]);
    assert_eq!(rejected.status, 415, "the early rejection keeps its own status");

    let valid = connection.request("POST", "/v1/traces", &otlp_headers(), &valid_export());
    assert_eq!(valid.status, 200, "the next request on the same connection must not read the unread body");

    receiver.close();
}

#[test]
fn a_stalled_body_is_cut_off_so_close_returns() {
    let folder = common::scratch("stalled-body");
    let receiver = start(&folder);
    let port = common::port_of(receiver.endpoint());

    let mut stalled = TcpStream::connect(("127.0.0.1", port)).expect("connect");
    let mut head = b"POST /v1/traces HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-type: application/x-protobuf\r\ncontent-length: 4096\r\n\r\n".to_vec();
    head.extend_from_slice(&[0u8; 100]);
    stalled.write_all(&head).expect("write the partial body");
    thread::sleep(Duration::from_millis(200));

    let (done, closed) = mpsc::channel();
    thread::spawn(move || {
        receiver.close();
        let _ = done.send(());
    });
    closed
        .recv_timeout(Duration::from_secs(30))
        .expect("close() must return once the stalled body is cut off");
    drop(stalled);
}

#[test]
fn connections_beyond_the_concurrency_cap_get_503_and_the_receiver_keeps_serving() {
    let folder = common::scratch("concurrency-cap");
    let receiver = start(&folder);
    let port = common::port_of(receiver.endpoint());

    // Idle connections each hold a handler until the cap is reached. They are accepted in order, so
    // the export below is refused once the cap is full.
    let idle: Vec<TcpStream> = (0..64)
        .map(|_| TcpStream::connect(("127.0.0.1", port)).expect("connect"))
        .collect();
    let refused = common::exchange(port, "POST", "/v1/traces", &otlp_headers(), Some(&valid_export()));
    assert_eq!(refused.status, 503);

    drop(idle);
    thread::sleep(Duration::from_millis(300));
    let served = common::exchange(port, "POST", "/v1/traces", &otlp_headers(), Some(&valid_export()));
    assert_eq!(served.status, 200);

    receiver.close();
}

/// Fills every served slot, then refuses twice `MAX_REFUSAL_DRAINS` connections while their clients
/// stay open, so their drains run for their full timeout. The first `MAX_REFUSAL_DRAINS` refusals always
/// get a drain and must get their 503. A refusal past the cap may be reset instead, since the receiver
/// closes it with the request unread; a 503 is accepted too, but any other read error fails the test.
/// The receiver must serve again once the slots and drains are freed.
#[test]
fn refusals_past_the_drain_cap_still_get_503_and_the_receiver_keeps_serving() {
    let folder = common::scratch("refusal-flood");
    let receiver = start(&folder);
    let port = common::port_of(receiver.endpoint());

    let idle: Vec<TcpStream> = (0..MAX_CONCURRENT_CONNECTIONS)
        .map(|_| TcpStream::connect(("127.0.0.1", port)).expect("connect"))
        .collect();

    let export = valid_export();
    let mut held = Vec::new();
    for index in 0..MAX_REFUSAL_DRAINS * 2 {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
        stream
            .set_read_timeout(Some(Duration::from_secs(10)))
            .expect("read timeout");
        let mut request = format!(
            "POST /v1/traces HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-type: application/x-protobuf\r\ncontent-length: {}\r\n\r\n",
            export.len()
        )
        .into_bytes();
        request.extend_from_slice(&export);
        let _ = stream.write_all(&request);
        let mut raw = Vec::new();
        match stream.read_to_end(&mut raw) {
            Err(error)
                if index >= MAX_REFUSAL_DRAINS
                    && matches!(error.kind(), ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted) => {}
            Err(error) if index >= MAX_REFUSAL_DRAINS => {
                panic!("refusal {index}: read failed with {:?} instead of a reset: {error}", error.kind())
            }
            _ => assert_eq!(common::parse_reply(&raw).status, 503, "refusal {index}"),
        }
        held.push(stream);
    }

    drop(held);
    drop(idle);
    thread::sleep(Duration::from_millis(300));
    let served = common::exchange(port, "POST", "/v1/traces", &otlp_headers(), Some(&valid_export()));
    assert_eq!(served.status, 200);

    receiver.close();
}

/// Sends a request with a `content-length` head on a new connection, after `delay`, and returns the reply.
/// The body goes out in 64 KiB pieces with a pause between them, so a receiver that closes early is
/// still being written to when it closes. Unlike `common::exchange`, a write that fails fails the test:
/// the receiver closed the connection before the body was read, and a client that gets that error may
/// never read the reply.
fn send_in_full(port: u16, delay: Duration, head: &str, body: &[u8]) -> common::Reply {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .expect("read timeout");
    thread::sleep(delay);
    stream
        .write_all(head.as_bytes())
        .expect("the receiver must read the request, not reset the connection");
    for piece in body.chunks(64 * 1024) {
        stream
            .write_all(piece)
            .expect("the receiver must read the request, not reset the connection");
        thread::sleep(Duration::from_millis(1));
    }
    let mut raw = Vec::new();
    let _ = stream.read_to_end(&mut raw);
    common::parse_reply(&raw)
}

#[test]
fn a_request_refused_with_503_has_its_body_drained_so_the_503_is_not_reset() {
    let folder = common::scratch("busy-with-body");
    let receiver = start(&folder);
    let port = common::port_of(receiver.endpoint());

    let idle: Vec<TcpStream> = (0..16)
        .map(|_| TcpStream::connect(("127.0.0.1", port)).expect("connect"))
        .collect();
    // The request is sent after the refusal, so the receiver has closed the connection by then.
    let head = "POST /v1/traces HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-type: application/x-protobuf\r\ncontent-length: 4096\r\nconnection: close\r\n\r\n";
    let refused = send_in_full(port, Duration::from_millis(50), head, &[b'x'; 4096]);
    assert_eq!(refused.status, 503);

    drop(idle);
    receiver.close();
}

#[test]
fn an_unsupported_expectation_with_a_body_gets_417_and_the_body_is_drained() {
    let folder = common::scratch("expectation-failed");
    let receiver = start(&folder);
    let port = common::port_of(receiver.endpoint());

    let length = 16 * 1024 * 1024;
    let head = format!("POST /v1/traces HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-type: application/x-protobuf\r\nexpect: frobnicate\r\ncontent-length: {length}\r\nconnection: close\r\n\r\n");
    let reply = send_in_full(port, Duration::ZERO, &head, &vec![0u8; length]);
    assert_eq!(reply.status, 417);

    receiver.close();
}

#[test]
fn a_body_sent_past_the_limit_in_full_gets_413_and_is_not_reset() {
    let folder = common::scratch("oversized-body-in-full");
    let receiver = start(&folder);
    let port = common::port_of(receiver.endpoint());

    // Twice the limit: the client is still sending when a receiver that stops at the limit closes.
    let length = 16 * 1024 * 1024;
    let head = format!("POST /v1/traces HTTP/1.1\r\nhost: 127.0.0.1\r\ncontent-type: application/x-protobuf\r\ncontent-length: {length}\r\nconnection: close\r\n\r\n");
    let reply = send_in_full(port, Duration::ZERO, &head, &vec![0u8; length]);
    assert_eq!(reply.status, 413);

    receiver.close();
}
