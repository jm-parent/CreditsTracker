//! Replays `reference/scenarios/correlator-scenarios.ts` through the Rust correlator. The fixture is
//! the TypeScript output of those scenarios; every step's result, next expiry and pending count must
//! match it.

use agent_trace_correlator::port::{
    AgentTraceCorrelationFacts, AgentTraceCorrelationInput, AgentTraceCorrelationResult,
    AgentTraceCorrelatorOptions, create_agent_trace_correlator,
};
use agent_trace_protocol::port::{AgentTraceSource as ProtocolSource, SourceResolution};
use agent_trace_sanitizer::port::UnattributedAgentTraceSpan;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

const FIXTURE: &str = include_str!("fixtures/scenarios.json");

fn text(v: &Value) -> String {
    v.as_str().expect("string field").to_owned()
}

fn opt(v: &Value) -> Option<String> {
    v.as_str().map(str::to_owned)
}

fn enum_from<T: DeserializeOwned>(v: &Value) -> T {
    serde_json::from_value(v.clone()).expect("shared enum")
}

fn source(v: &Value) -> Option<ProtocolSource> {
    match v.as_str()? {
        "vscode" => Some(ProtocolSource::Vscode),
        "copilot-cli" => Some(ProtocolSource::CopilotCli),
        other => panic!("unknown source {other}"),
    }
}

fn resolution(v: &Value) -> SourceResolution {
    match v.as_str().expect("resolution") {
        "supported" => SourceResolution::Supported,
        "unsupported" => SourceResolution::Unsupported,
        "missing" => SourceResolution::Missing,
        other => panic!("unknown resolution {other}"),
    }
}

fn input(v: &Value) -> AgentTraceCorrelationInput {
    let (f, s) = (&v["facts"], &v["span"]);
    AgentTraceCorrelationInput {
        facts: AgentTraceCorrelationFacts {
            trace_id: text(&f["traceId"]),
            span_id: text(&f["spanId"]),
            parent_span_id: opt(&f["parentSpanId"]),
            trace_root_in_request: f["traceRootInRequest"].as_bool().expect("bool"),
            trace_source: source(&f["traceSource"]),
            trace_source_resolution: resolution(&f["traceSourceResolution"]),
            trace_session_id: opt(&f["traceSessionId"]),
            span_source: source(&f["spanSource"]),
            span_source_resolution: resolution(&f["spanSourceResolution"]),
            span_conversation_id: opt(&f["spanConversationId"]),
            span_parent_conversation_id: opt(&f["spanParentConversationId"]),
        },
        span: UnattributedAgentTraceSpan {
            trace_id: text(&s["traceId"]),
            span_id: text(&s["spanId"]),
            parent_span_id: opt(&s["parentSpanId"]),
            name: text(&s["name"]),
            category: enum_from(&s["category"]),
            tool_name: opt(&s["toolName"]),
            skill_name: opt(&s["skillName"]),
            model: opt(&s["model"]),
            started_at: text(&s["startedAt"]),
            ended_at: text(&s["endedAt"]),
            duration_ms: s["durationMs"].as_f64().expect("number"),
            status: enum_from(&s["status"]),
            error_type: opt(&s["errorType"]),
            tool_call_id: opt(&s["toolCallId"]),
            arguments_json: opt(&s["argumentsJson"]),
            result_text: opt(&s["resultText"]),
            content_state: enum_from(&s["contentState"]),
        },
    }
}

fn options(v: &Value) -> AgentTraceCorrelatorOptions {
    AgentTraceCorrelatorOptions {
        pending_ttl_ms: v["pendingTtlMs"].as_f64(),
        max_pending_spans: v["maxPendingSpans"].as_u64().map(|n| n as usize),
        max_pending_bytes: v["maxPendingBytes"].as_u64().map(|n| n as usize),
    }
}

fn result_json(r: &AgentTraceCorrelationResult) -> Value {
    json!({ "ready": r.ready, "rejected": r.rejected, "dropped": r.dropped, "held": r.held })
}

/// JSON numbers compare by value: the fixture writes `1000` where Rust serializes `1000.0`.
fn canon(v: Value) -> Value {
    match v {
        Value::Number(n) => json!(n.as_f64()),
        Value::Array(items) => Value::Array(items.into_iter().map(canon).collect()),
        Value::Object(map) => Value::Object(map.into_iter().map(|(k, v)| (k, canon(v))).collect()),
        other => other,
    }
}

#[test]
fn replays_every_typescript_scenario_step_for_step() {
    let scenarios: Value = serde_json::from_str(FIXTURE).expect("fixture is JSON");
    for scenario in scenarios.as_array().expect("scenario list") {
        let name = scenario["name"].as_str().expect("name");
        let mut correlator = create_agent_trace_correlator(options(&scenario["options"]));
        for (index, step) in scenario["steps"]
            .as_array()
            .expect("steps")
            .iter()
            .enumerate()
        {
            let now = step["nowMs"].as_f64().unwrap_or(0.0);
            let result = match step["call"].as_str().expect("call") {
                "ingest" => {
                    let inputs: Vec<_> = step["inputs"]
                        .as_array()
                        .expect("inputs")
                        .iter()
                        .map(input)
                        .collect();
                    Some(correlator.ingest(&inputs, now).expect("ingest"))
                }
                "expire" => Some(correlator.expire(now).expect("expire")),
                "flushAll" => Some(correlator.flush_all().expect("flush_all")),
                _ => {
                    correlator.discard_pending();
                    None
                }
            };
            let context = format!("{name} step {index}");
            let result = result.as_ref().map_or(Value::Null, result_json);
            assert_eq!(
                canon(result),
                canon(step["result"].clone()),
                "{context}: result"
            );
            assert_eq!(
                canon(json!(correlator.next_expiry_at())),
                canon(step["nextExpiryAt"].clone()),
                "{context}: nextExpiryAt"
            );
            assert_eq!(
                canon(json!(correlator.pending_span_count())),
                canon(step["pendingSpanCount"].clone()),
                "{context}: pendingSpanCount"
            );
        }
    }
}
