//! The Rust port of `reference/src/agent-trace-sanitizer.ts`.
//!
//! The port runs on JavaScript values (`js_value::Js`), because the recorded calls include spans
//! that do not match the TypeScript type: missing fields, `undefined`, arguments that are not
//! objects. They produce the output and the thrown messages of the original. The typed entry
//! points take and return the Rust types and are thin adapters over the same code.

use std::sync::LazyLock;

use agent_trace_protocol::port::DecodedAgentTraceSpan;
use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use shared::{
    AgentTraceCategory, AgentTraceContentState, AgentTraceSource, AgentTraceSpan,
    AgentTraceSpanStatus,
};

use crate::js_value::{self, Js, JsResult, get, object, to_bigint};

type State = AgentTraceContentState;

/// `UnattributedAgentTraceSpan`: the span without the source and session it belongs to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnattributedAgentTraceSpan {
    pub trace_id: String,
    pub span_id: String,
    pub parent_span_id: Option<String>,
    pub name: String,
    pub category: AgentTraceCategory,
    pub tool_name: Option<String>,
    pub skill_name: Option<String>,
    pub model: Option<String>,
    pub started_at: String,
    pub ended_at: String,
    pub duration_ms: f64,
    pub status: AgentTraceSpanStatus,
    pub error_type: Option<String>,
    pub tool_call_id: Option<String>,
    pub arguments_json: Option<String>,
    pub result_text: Option<String>,
    pub content_state: AgentTraceContentState,
}

/// `AgentTraceAttribution`: the conversation an unattributed span is assigned to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTraceAttribution {
    pub source: AgentTraceSource,
    pub session_id: String,
}

/// Port of `sanitizeAgentTraceSpan`: `None` when the span has no source, session or conversation.
pub fn sanitize_agent_trace_span(
    span: &DecodedAgentTraceSpan,
) -> Result<Option<AgentTraceSpan>, String> {
    match sanitize_agent_trace_span_value(&span.to_value())? {
        Value::Null => Ok(None),
        out => serde_json::from_value(out)
            .map(Some)
            .map_err(|error| error.to_string()),
    }
}

/// Port of `sanitizeUnattributedAgentTraceSpan`.
pub fn sanitize_unattributed_agent_trace_span(
    span: &DecodedAgentTraceSpan,
) -> Result<UnattributedAgentTraceSpan, String> {
    let out = sanitize_unattributed_agent_trace_span_value(&span.to_value())?;
    serde_json::from_value(out).map_err(|error| error.to_string())
}

/// Port of `attributeAgentTraceSpan`.
pub fn attribute_agent_trace_span(
    span: &UnattributedAgentTraceSpan,
    attribution: &AgentTraceAttribution,
) -> Result<AgentTraceSpan, String> {
    let span = serde_json::to_value(span).map_err(|error| error.to_string())?;
    let attribution = serde_json::to_value(attribution).map_err(|error| error.to_string())?;
    let out = attribute_agent_trace_span_value(&span, &attribution)?;
    serde_json::from_value(out).map_err(|error| error.to_string())
}

/// `sanitizeAgentTraceSpan` over JSON values from the JS bridge; `null` for `None`.
pub fn sanitize_agent_trace_span_value(span: &Value) -> Result<Value, String> {
    let span = js_value::from_value(span)?;
    Ok(js_value::to_value(&sanitize_span(&span)?))
}

/// `sanitizeUnattributedAgentTraceSpan` over JSON values from the JS bridge.
pub fn sanitize_unattributed_agent_trace_span_value(span: &Value) -> Result<Value, String> {
    let span = js_value::from_value(span)?;
    Ok(js_value::to_value(&sanitize_unattributed(&span)?))
}

/// `attributeAgentTraceSpan` over JSON values from the JS bridge.
pub fn attribute_agent_trace_span_value(
    span: &Value,
    attribution: &Value,
) -> Result<Value, String> {
    let span = js_value::from_value(span)?;
    let attribution = js_value::from_value(attribution)?;
    Ok(js_value::to_value(&attribute(&span, &attribution)?))
}

fn sanitize_span(span: &Js) -> JsResult<Js> {
    let source = get(span, "source")?;
    if !js_value::truthy(&source) {
        return Ok(Js::Null);
    }
    let session_id = get(span, "sessionId")?;
    if !js_value::truthy(&session_id) {
        return Ok(Js::Null);
    }
    if !js_value::truthy(&get(span, "conversationId")?) {
        return Ok(Js::Null);
    }
    let unattributed = sanitize_unattributed(span)?;
    attribute(
        &unattributed,
        &object(vec![
            ("source".into(), source),
            ("sessionId".into(), session_id),
        ]),
    )
}

/// `sanitizeUnattributedAgentTraceSpan`. Reads and timestamps are in the order the TypeScript
/// evaluates them, so the first failing read is the one that throws.
fn sanitize_unattributed(span: &Js) -> JsResult<Js> {
    let trace_id = get(span, "traceId")?;
    let span_id = get(span, "spanId")?;
    let parent_span_id = get(span, "parentSpanId")?;
    let name = get(span, "name")?;
    let category = get(span, "category")?;
    let tool_name = get(span, "toolName")?;
    let skill_name = get(span, "skillName")?;
    let model = get(span, "model")?;
    let started_ns = get(span, "startedAtNs")?;
    let ended_ns = get(span, "endedAtNs")?;
    let started_at = nanos_to_iso(&started_ns)?;
    let ended_at = nanos_to_iso(&ended_ns)?;
    let duration_ms = nanos_to_duration_ms(&started_ns, &ended_ns)?;
    let status = get(span, "status")?;
    let error_type = sanitize_error_type(&get(span, "errorType")?);
    let tool_call_id = get(span, "toolCallId")?;

    let (arguments_json, result_text, content_state) = match sanitize_contents(span) {
        Ok((None, None)) => (Js::Null, Js::Null, State::Unavailable),
        Ok((arguments, result)) => (
            content_text(&arguments),
            content_text(&result),
            combine(
                arguments.as_ref().map(|c| c.state),
                result.as_ref().map(|c| c.state),
            ),
        ),
        // The TypeScript throws inside its try block, and the span keeps only its metadata.
        Err(Unsupported) => (Js::Null, Js::Null, State::Omitted),
    };

    Ok(object(vec![
        ("traceId".into(), trace_id),
        ("spanId".into(), span_id),
        ("parentSpanId".into(), parent_span_id),
        ("name".into(), name),
        ("category".into(), category),
        ("toolName".into(), tool_name),
        ("skillName".into(), skill_name),
        ("model".into(), model),
        ("startedAt".into(), Js::String(started_at)),
        ("endedAt".into(), Js::String(ended_at)),
        ("durationMs".into(), Js::Number(duration_ms)),
        ("status".into(), status),
        ("errorType".into(), error_type),
        ("toolCallId".into(), tool_call_id),
        ("argumentsJson".into(), arguments_json),
        ("resultText".into(), result_text),
        (
            "contentState".into(),
            Js::String(state_name(content_state).into()),
        ),
    ]))
}

/// `attributeAgentTraceSpan`: copies the span's fields under the attribution's source and session.
fn attribute(span: &Js, attribution: &Js) -> JsResult<Js> {
    const FIELDS: [&str; 17] = [
        "traceId",
        "spanId",
        "parentSpanId",
        "name",
        "category",
        "toolName",
        "skillName",
        "model",
        "startedAt",
        "endedAt",
        "durationMs",
        "status",
        "errorType",
        "toolCallId",
        "argumentsJson",
        "resultText",
        "contentState",
    ];
    let mut entries = vec![
        ("source".into(), get(attribution, "source")?),
        ("sessionId".into(), get(attribution, "sessionId")?),
    ];
    for field in FIELDS {
        entries.push((field.into(), get(span, field)?));
    }
    Ok(object(entries))
}

fn content_text(content: &Option<Sanitized>) -> Js {
    content
        .as_ref()
        .map_or(Js::Null, |content| Js::String(content.text.clone()))
}

fn state_name(state: State) -> &'static str {
    match state {
        State::Unavailable => "unavailable",
        State::Stored => "stored",
        State::Redacted => "redacted",
        State::Truncated => "truncated",
        State::RedactedTruncated => "redacted-truncated",
        State::Omitted => "omitted",
    }
}

fn nanos_to_iso(value: &Js) -> JsResult<String> {
    js_value::iso_from_millis(to_bigint(value)? / 1_000_000)
}

fn nanos_to_duration_ms(started: &Js, ended: &Js) -> JsResult<f64> {
    let ended = to_bigint(ended)?;
    let started = to_bigint(started)?;
    Ok((ended.saturating_sub(started) / 1_000_000) as f64)
}

fn sanitize_error_type(error_type: &Js) -> Js {
    match error_type {
        Js::String(text) => match redact_sensitive_text(text) {
            Ok(redacted) => Js::String(
                truncate_utf8(&redacted.text, MAX_ERROR_TYPE_BYTES)
                    .0
                    .to_string(),
            ),
            Err(Unsupported) => Js::Null,
        },
        // Only a string is redacted; anything else fails inside the TypeScript and is `null`.
        _ => Js::Null,
    }
}

/// The TypeScript throws out of the content sanitizer; the caller turns that into `omitted`.
#[derive(Debug)]
struct Unsupported;

struct Sanitized {
    text: String,
    state: State,
}

fn sanitize_contents(span: &Js) -> Result<(Option<Sanitized>, Option<Sanitized>), Unsupported> {
    let arguments = sanitize_content(&get(span, "argumentsValue").map_err(|_| Unsupported)?)?;
    let result = sanitize_content(&get(span, "result").map_err(|_| Unsupported)?)?;
    Ok((arguments, result))
}

fn sanitize_content(input: &Js) -> Result<Option<Sanitized>, Unsupported> {
    match input {
        Js::Undefined | Js::Null => Ok(None),
        // Tool payloads often carry JSON in a string; a container is sanitized structurally.
        Js::String(text) => match js_value::parse_json(text) {
            Some(parsed @ (Js::Array(_) | Js::Object(_))) => serialize_sanitized(&parsed).map(Some),
            _ => sanitize_text(text).map(Some),
        },
        Js::Array(_) | Js::Object(_) => serialize_sanitized(input).map(Some),
        Js::Bytes(_) => Err(Unsupported),
        Js::Bool(flag) => sanitize_text(if *flag { "true" } else { "false" }).map(Some),
        Js::Number(n) => {
            // `JSON.stringify` writes non-finite numbers as `null`.
            let text = if n.is_finite() {
                js_value::number_to_string(*n)
            } else {
                "null".into()
            };
            sanitize_text(&text).map(Some)
        }
    }
}

fn serialize_sanitized(value: &Js) -> Result<Sanitized, Unsupported> {
    let (sanitized, state) = sanitize_json_value(value, 0)?;
    let text = js_value::to_json_text(&sanitized).map_err(|_| Unsupported)?;
    let (text, truncated) = truncate_utf8(&text, MAX_CONTENT_BYTES);
    Ok(Sanitized {
        text: text.to_string(),
        state: combine(Some(state), truncated.then_some(State::Truncated)),
    })
}

fn sanitize_json_value(value: &Js, depth: usize) -> Result<(Js, State), Unsupported> {
    match value {
        Js::Null => Ok((Js::Null, State::Stored)),
        Js::Number(n) => Ok((Js::Number(*n), State::Stored)),
        Js::Bool(flag) => Ok((Js::Bool(*flag), State::Stored)),
        Js::String(text) => {
            let (text, state) = sanitize_json_string(text, depth)?;
            Ok((Js::String(text), state))
        }
        Js::Undefined | Js::Bytes(_) => Err(Unsupported),
        Js::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            let mut state = State::Stored;
            for item in items {
                if *item == Js::Undefined {
                    state = combine(Some(state), Some(State::Redacted));
                    continue;
                }
                let (value, item_state) = sanitize_json_value(item, depth)?;
                out.push(value);
                state = combine(Some(state), Some(item_state));
            }
            Ok((Js::Array(out), state))
        }
        Js::Object(entries) => {
            let mut out = Vec::with_capacity(entries.len());
            let mut state = State::Stored;
            for (key, raw) in entries {
                if FILTERED_KEYS.contains(&key.to_lowercase().as_str()) || *raw == Js::Undefined {
                    state = combine(Some(state), Some(State::Redacted));
                    continue;
                }
                // `output["__proto__"] = ...` never creates an own property, so the key is dropped.
                let keep = key != "__proto__";
                if is_sensitive_key(key) {
                    if keep {
                        out.push((key.clone(), Js::String(REDACTED.into())));
                    }
                    state = combine(Some(state), Some(State::Redacted));
                    continue;
                }
                let (value, item_state) = sanitize_json_value(raw, depth)?;
                if keep {
                    out.push((key.clone(), value));
                }
                state = combine(Some(state), Some(item_state));
            }
            Ok((object(out), state))
        }
    }
}

fn sanitize_json_string(text: &str, depth: usize) -> Result<(String, State), Unsupported> {
    if depth < MAX_NESTED_JSON_DEPTH
        && let Some(nested) = parse_json_container(text)
    {
        let (sanitized, state) = sanitize_json_value(&nested, depth + 1)?;
        if state != State::Stored {
            let serialized = js_value::to_json_text(&sanitized).map_err(|_| Unsupported)?;
            return Ok((serialized, state));
        }
    }
    let redacted = redact_bounded_text(text)?;
    Ok((redacted.text, redacted.state))
}

fn sanitize_text(text: &str) -> Result<Sanitized, Unsupported> {
    let redacted = redact_bounded_text(text)?;
    let (kept, truncated) = truncate_utf8(&redacted.text, MAX_CONTENT_BYTES);
    Ok(Sanitized {
        text: kept.to_string(),
        state: combine(Some(redacted.state), truncated.then_some(State::Truncated)),
    })
}

fn redact_bounded_text(text: &str) -> Result<Sanitized, Unsupported> {
    let (bounded, truncated) = truncate_utf8(text, MAX_REDACTION_INPUT_BYTES);
    let redacted = redact_sensitive_text(bounded)?;
    Ok(Sanitized {
        state: combine(Some(redacted.state), truncated.then_some(State::Truncated)),
        text: redacted.text,
    })
}

fn redact_sensitive_text(text: &str) -> Result<Sanitized, Unsupported> {
    if PRIVATE_KEY_BEGIN.is_match(text) && !PRIVATE_KEY_END.is_match(text) {
        return Err(Unsupported);
    }
    type Step = fn(&str) -> String;
    let steps: [Step; 9] = [
        redact_private_key_blocks,
        redact_url_credentials,
        redact_header_credentials,
        redact_assignments,
        redact_cli_flags,
        redact_github_tokens,
        redact_github_pats,
        redact_aws_keys,
        redact_bearer_tokens,
    ];
    let mut result = text.to_string();
    let mut changed = false;
    for (index, step) in steps.iter().enumerate() {
        let next = step(&result);
        if next != result {
            changed = true;
            result = next;
        }
        // A private key header or footer left without its matching boundary cannot be redacted.
        if index == 0 && PRIVATE_KEY_MARKER.is_match(&result) {
            return Err(Unsupported);
        }
    }
    Ok(Sanitized {
        text: result,
        state: if changed {
            State::Redacted
        } else {
            State::Stored
        },
    })
}

fn combine(first: Option<State>, second: Option<State>) -> State {
    let states: Vec<State> = [first, second].into_iter().flatten().collect();
    if states.is_empty() {
        return State::Unavailable;
    }
    if states.contains(&State::Omitted) {
        return State::Omitted;
    }
    let redacted = states
        .iter()
        .any(|s| matches!(s, State::Redacted | State::RedactedTruncated));
    let truncated = states
        .iter()
        .any(|s| matches!(s, State::Truncated | State::RedactedTruncated));
    match (redacted, truncated) {
        (true, true) => State::RedactedTruncated,
        (true, false) => State::Redacted,
        (false, true) => State::Truncated,
        (false, false) if states.contains(&State::Stored) => State::Stored,
        (false, false) => State::Unavailable,
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized: String = key
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        .collect();
    SENSITIVE_EXACT_KEYS.contains(&normalized.as_str())
        || SENSITIVE_KEY_PARTS
            .iter()
            .any(|part| normalized.contains(part))
}

/// A JSON object or array in `text` after JS trimming, or `None`.
fn parse_json_container(text: &str) -> Option<Js> {
    let trimmed = text.trim_matches(js_value::is_js_whitespace);
    if !trimmed.starts_with(['{', '[']) {
        return None;
    }
    js_value::parse_json(trimmed).filter(|parsed| matches!(parsed, Js::Array(_) | Js::Object(_)))
}

/// The longest prefix of `text` within `max_bytes`, and whether anything was cut.
fn truncate_utf8(text: &str, max_bytes: usize) -> (&str, bool) {
    if text.len() <= max_bytes {
        return (text, false);
    }
    let mut end = 0;
    for (index, c) in text.char_indices() {
        if index + c.len_utf8() > max_bytes {
            break;
        }
        end = index + c.len_utf8();
    }
    (&text[..end], true)
}

const MAX_CONTENT_BYTES: usize = 32 * 1024;
// Bounds the text scanned for secrets so a pathological payload cannot stall the main process.
const MAX_REDACTION_INPUT_BYTES: usize = 256 * 1024;
const MAX_ERROR_TYPE_BYTES: usize = 256;
const MAX_NESTED_JSON_DEPTH: usize = 4;
const REDACTED: &str = "[REDACTED]";
const FILTERED_KEYS: [&str; 7] = [
    "prompt",
    "response",
    "system",
    "message",
    "messages",
    "schema",
    "attributes",
];
const SENSITIVE_KEY_PARTS: [&str; 12] = [
    "token",
    "secret",
    "password",
    "passwd",
    "passphrase",
    "apikey",
    "authorization",
    "privatekey",
    "accesskey",
    "accountkey",
    "credential",
    "cookie",
];
const SENSITIVE_EXACT_KEYS: [&str; 3] = ["auth", "pass", "pwd"];

// The redaction patterns are the TypeScript regexes, rewritten for the `regex` crate. JS
// `\s` is wider than the crate's, `\b` and `/i` are ASCII-only in JS without the `u` flag, and
// `/i` is spelled out as letter classes so Unicode case folding (`ſ` for `s`) cannot match.
const JS_WHITESPACE: &str = r"\t\n\x0B\x0C \r\x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}";
const WORD_BOUNDARY: &str = r"(?-u:\b)";
const ASSIGNMENT: &str = r#"\\?["']?[ \t]*(?:=>|[:=])[ \t]*"#;
const QUOTED_VALUE: &str =
    r#""(?:[^"\\\r\n]|\\[^\r\n\x{2028}\x{2029}])*"?|'(?:[^'\\\r\n]|\\[^\r\n\x{2028}\x{2029}])*'?"#;

/// Letters of `literal` as `[xX]` classes: the case-insensitive match of a JS `/i` regex.
fn ci(literal: &str) -> String {
    literal
        .chars()
        .map(|c| {
            if c.is_ascii_alphabetic() {
                format!("[{}{}]", c.to_ascii_lowercase(), c.to_ascii_uppercase())
            } else {
                regex::escape(&c.to_string())
            }
        })
        .collect()
}

fn private_key() -> String {
    format!("{} {}", ci("PRIVATE"), ci("KEY"))
}

fn secret_keyword() -> String {
    format!(
        "{}|{}|{}(?:{})?{}|{}|{}|(?:{}|{}|{}|{})[ _.\\-]?{}",
        ci("token"),
        ci("secret"),
        ci("passw"),
        ci("or"),
        ci("d"),
        ci("passphrase"),
        ci("credential"),
        ci("api"),
        ci("private"),
        ci("access"),
        ci("account"),
        ci("key"),
    )
}

fn secret_key() -> String {
    format!(
        r"[A-Za-z0-9_.\-]{{0,64}}?(?:{})[A-Za-z0-9_.\-]{{0,64}}",
        secret_keyword()
    )
}

fn header_secret_key() -> String {
    format!(
        r"[A-Za-z0-9_\-]{{0,32}}(?:{}|{})[A-Za-z0-9_\-]{{0,32}}",
        ci("authorization"),
        ci("cookie")
    )
}

fn compile(pattern: &str) -> Regex {
    Regex::new(pattern).expect("the redaction patterns are valid regular expressions")
}

static PRIVATE_KEY_BLOCK: LazyLock<Regex> = LazyLock::new(|| {
    compile(&format!(
        r"-----{begin}[ A-Za-z0-9]{{0,40}}{key}[ A-Za-z0-9]{{0,40}}-----[\s\S]*?-----{end}[ A-Za-z0-9]{{0,40}}{key}[ A-Za-z0-9]{{0,40}}-----",
        begin = ci("BEGIN"),
        end = ci("END"),
        key = private_key(),
    ))
});
static PRIVATE_KEY_BEGIN: LazyLock<Regex> = LazyLock::new(|| {
    compile(&format!(
        "-----{}[ A-Za-z0-9]{{0,40}}{}",
        ci("BEGIN"),
        private_key()
    ))
});
static PRIVATE_KEY_END: LazyLock<Regex> = LazyLock::new(|| {
    compile(&format!(
        "-----{}[ A-Za-z0-9]{{0,40}}{}",
        ci("END"),
        private_key()
    ))
});
static PRIVATE_KEY_MARKER: LazyLock<Regex> = LazyLock::new(|| {
    compile(&format!(
        "-----(?:{}|{})[ A-Za-z0-9]{{0,40}}{}",
        ci("BEGIN"),
        ci("END"),
        private_key()
    ))
});
static URL_CREDENTIALS: LazyLock<Regex> = LazyLock::new(|| {
    compile(&format!(
        r"{WORD_BOUNDARY}([A-Za-z][A-Za-z0-9+.\-]{{0,20}}://)([^{JS_WHITESPACE}:@/?#]{{1,256}}):([^{JS_WHITESPACE}@/?#]{{1,256}})@"
    ))
});
static HEADER_CREDENTIALS: LazyLock<Regex> = LazyLock::new(|| {
    compile(&format!(
        r#"{WORD_BOUNDARY}({})({ASSIGNMENT})({QUOTED_VALUE}|[^{JS_WHITESPACE}"'][^\r\n]*)"#,
        header_secret_key()
    ))
});
static ASSIGNMENTS: LazyLock<Regex> = LazyLock::new(|| {
    compile(&format!(
        r#"{WORD_BOUNDARY}({}|(?:{}|{}|{}){WORD_BOUNDARY})({ASSIGNMENT})({QUOTED_VALUE}|[^{JS_WHITESPACE}"',;][^\r\n,;]*)"#,
        secret_key(),
        ci("auth"),
        ci("pass"),
        ci("pwd"),
    ))
});
/// A `--token value` flag. The TypeScript rule has a lookbehind, which the caller checks.
static CLI_FLAGS: LazyLock<Regex> = LazyLock::new(|| {
    compile(&format!(
        r#"(--?{})([ \t]+)({QUOTED_VALUE}|[^{JS_WHITESPACE}"'\-][^{JS_WHITESPACE}]*)"#,
        secret_key()
    ))
});
static GITHUB_TOKENS: LazyLock<Regex> = LazyLock::new(|| {
    compile(&format!(
        r"{WORD_BOUNDARY}{}[pPoOuUsSrR]_[A-Za-z0-9_]+{WORD_BOUNDARY}",
        ci("gh")
    ))
});
static GITHUB_PATS: LazyLock<Regex> = LazyLock::new(|| {
    compile(&format!(
        r"{WORD_BOUNDARY}{}[A-Za-z0-9_]+{WORD_BOUNDARY}",
        ci("github_pat_")
    ))
});
static AWS_KEYS: LazyLock<Regex> = LazyLock::new(|| {
    compile(&format!(
        r"{WORD_BOUNDARY}(?:AKIA|ASIA)[A-Z0-9]{{16}}{WORD_BOUNDARY}"
    ))
});
static BEARER_TOKENS: LazyLock<Regex> = LazyLock::new(|| {
    compile(&format!(
        r#"{WORD_BOUNDARY}({})[ \t]+[^{JS_WHITESPACE}"'`]+"#,
        ci("bearer")
    ))
});

fn replace_all(pattern: &Regex, text: &str, replacer: impl Fn(&Captures) -> String) -> String {
    pattern
        .replace_all(text, |captures: &Captures| replacer(captures))
        .into_owned()
}

fn redact_private_key_blocks(text: &str) -> String {
    replace_all(&PRIVATE_KEY_BLOCK, text, |_| REDACTED.to_string())
}

fn redact_url_credentials(text: &str) -> String {
    replace_all(&URL_CREDENTIALS, text, |c| {
        format!("{}{}:{REDACTED}@", &c[1], &c[2])
    })
}

fn redact_header_credentials(text: &str) -> String {
    replace_all(&HEADER_CREDENTIALS, text, redact_assignment)
}

fn redact_assignments(text: &str) -> String {
    replace_all(&ASSIGNMENTS, text, redact_assignment)
}

fn redact_cli_flags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let (mut copied, mut searched) = (0, 0);
    while let Some(captures) = CLI_FLAGS.captures_at(text, searched) {
        let whole = captures.get(0).expect("group 0 is always present");
        if preceded_by_key_character(text, whole.start()) {
            // The lookbehind fails at this start, so the next match is searched from the next character.
            searched = whole.start()
                + text[whole.start()..]
                    .chars()
                    .next()
                    .map_or(1, char::len_utf8);
            continue;
        }
        out.push_str(&text[copied..whole.start()]);
        out.push_str(&redact_assignment(&captures));
        copied = whole.end();
        searched = whole.end();
    }
    out.push_str(&text[copied..]);
    out
}

fn preceded_by_key_character(text: &str, index: usize) -> bool {
    text[..index]
        .chars()
        .next_back()
        .is_some_and(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

fn redact_github_tokens(text: &str) -> String {
    replace_all(&GITHUB_TOKENS, text, |_| REDACTED.to_string())
}

fn redact_github_pats(text: &str) -> String {
    replace_all(&GITHUB_PATS, text, |_| REDACTED.to_string())
}

fn redact_aws_keys(text: &str) -> String {
    replace_all(&AWS_KEYS, text, |_| REDACTED.to_string())
}

fn redact_bearer_tokens(text: &str) -> String {
    replace_all(&BEARER_TOKENS, text, |c| format!("{} {REDACTED}", &c[1]))
}

/// Keeps the key and separator, and the quotes of a quoted value.
fn redact_assignment(captures: &Captures) -> String {
    let (key, separator, value) = (&captures[1], &captures[2], &captures[3]);
    match value.chars().next() {
        Some(quote @ ('"' | '\'')) => format!("{key}{separator}{quote}{REDACTED}{quote}"),
        _ => format!("{key}{separator}{REDACTED}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_trace_protocol::port::{
        AgentTraceSource as ProtocolSource, AttributeValue, SourceResolution, SpanCategory,
        SpanStatus,
    };

    fn text(value: &str) -> AttributeValue {
        AttributeValue::String(value.to_string())
    }

    fn object(entries: &[(&str, AttributeValue)]) -> AttributeValue {
        AttributeValue::Object(
            entries
                .iter()
                .map(|(key, value)| (key.to_string(), value.clone()))
                .collect(),
        )
    }

    fn span(arguments: AttributeValue, result: AttributeValue) -> DecodedAgentTraceSpan {
        DecodedAgentTraceSpan {
            source: Some(ProtocolSource::CopilotCli),
            source_resolution: SourceResolution::Supported,
            conversation_id: Some("conversation-1".into()),
            session_id: Some("session-1".into()),
            trace_root_in_request: true,
            span_source: None,
            span_source_resolution: SourceResolution::Missing,
            span_conversation_id: None,
            span_parent_conversation_id: None,
            trace_id: "0102030405060708090a0b0c0d0e0f10".into(),
            span_id: "0102030405060708".into(),
            parent_span_id: None,
            name: "tool".into(),
            category: SpanCategory::Tool,
            tool_name: Some("search".into()),
            skill_name: None,
            model: None,
            started_at_ns: "1700000000000000000".into(),
            ended_at_ns: "1700000001500000000".into(),
            status: SpanStatus::Ok,
            error_type: None,
            tool_call_id: Some("call-1".into()),
            arguments_value: arguments,
            result,
        }
    }

    fn sanitized(arguments: AttributeValue, result: AttributeValue) -> AgentTraceSpan {
        sanitize_agent_trace_span(&span(arguments, result))
            .unwrap()
            .expect("the span has a conversation")
    }

    #[test]
    fn prompt_and_response_text_never_reach_the_sanitized_span() {
        let arguments = object(&[
            ("prompt", text("PROMPT-SECRET")),
            ("response", text("RESPONSE-SECRET")),
            (
                "messages",
                AttributeValue::Array(vec![object(&[("content", text("MESSAGE-SECRET"))])]),
            ),
            ("system", text("SYSTEM-SECRET")),
            ("tool", text("search")),
        ]);
        let result = object(&[
            ("response", text("RESPONSE-SECRET")),
            ("text", text("visible")),
        ]);
        let out = sanitized(arguments, result);
        assert_eq!(out.arguments_json.as_deref(), Some(r#"{"tool":"search"}"#));
        let json = serde_json::to_string(&out).unwrap();
        for secret in [
            "PROMPT-SECRET",
            "RESPONSE-SECRET",
            "MESSAGE-SECRET",
            "SYSTEM-SECRET",
        ] {
            assert!(!json.contains(secret), "{secret} leaked into {json}");
        }

        let json_text = text(r#"{"prompt":"PROMPT-SECRET","q":1}"#);
        let out = sanitized(json_text, AttributeValue::Null);
        assert_eq!(out.arguments_json.as_deref(), Some(r#"{"q":1}"#));
    }

    #[test]
    fn non_ascii_attribute_values_are_kept_as_written() {
        let out = sanitized(
            object(&[("city", text("Zürich 東京 🚀"))]),
            text("Ça marche ✓ — 完了"),
        );
        assert_eq!(
            out.arguments_json.as_deref(),
            Some(r#"{"city":"Zürich 東京 🚀"}"#)
        );
        assert_eq!(out.result_text.as_deref(), Some("Ça marche ✓ — 完了"));
        assert_eq!(out.content_state, AgentTraceContentState::Stored);
    }

    #[test]
    fn bytes_are_omitted_not_stored() {
        let out = sanitized(AttributeValue::Bytes(vec![1, 2, 3]), text("visible"));
        assert_eq!(out.arguments_json, None);
        assert_eq!(out.result_text, None);
        assert_eq!(out.content_state, AgentTraceContentState::Omitted);
    }

    #[test]
    fn a_key_value_list_that_looks_like_bytes_stays_an_object() {
        let arguments = object(&[(
            "$bytes",
            AttributeValue::Array(vec![
                AttributeValue::Number(1.0),
                AttributeValue::Number(2.0),
            ]),
        )]);
        let out = sanitized(arguments, AttributeValue::Null);
        assert_eq!(out.arguments_json.as_deref(), Some(r#"{"$bytes":[1,2]}"#));
        assert_eq!(out.content_state, AgentTraceContentState::Stored);
    }

    #[test]
    fn redaction_matches_ascii_case_only() {
        let out = sanitized(AttributeValue::Null, text("ſecret=abc"));
        assert_eq!(out.result_text.as_deref(), Some("ſecret=abc"));
        assert_eq!(out.content_state, AgentTraceContentState::Stored);

        let out = sanitized(AttributeValue::Null, text("SECRET=abc"));
        assert_eq!(out.result_text.as_deref(), Some("SECRET=[REDACTED]"));
        assert_eq!(out.content_state, AgentTraceContentState::Redacted);
    }
}
