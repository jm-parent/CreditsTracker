mod common;

use std::sync::{Arc, Mutex};

use agent_trace_correlator::port::AgentTraceCorrelatorOptions;
use agent_trace_protocol::otlp::opentelemetry::proto::collector::trace::v1::ExportTraceServiceRequest;
use agent_trace_protocol::otlp::opentelemetry::proto::common::v1::{AnyValue, KeyValue, any_value::Value};
use agent_trace_protocol::otlp::opentelemetry::proto::resource::v1::Resource;
use agent_trace_protocol::otlp::opentelemetry::proto::trace::v1::{ResourceSpans, ScopeSpans, Span};
use agent_trace_receiver::port::{ReceiverOptions, start_agent_trace_receiver};
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
