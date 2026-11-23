//! JS bindings for `reference/src/agent-trace-sanitizer.ts`. The JSON entry points and the wire
//! glue are maintained by hand: they call the value-level port in `port.rs` and keep the wire's
//! binary layout in step with it, so `rust-anything refresh` would overwrite them.

use napi_derive::napi;

pub mod js;
pub mod js_value;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;

fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".into())
}

#[allow(dead_code)]
fn run<T>(f: impl FnOnce() -> Result<T, String>) -> napi::Result<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(result) => result.map_err(napi::Error::from_reason),
        Err(payload) => Err(napi::Error::from_reason(format!(
            "Rust panic: {}",
            panic_message(&*payload)
        ))),
    }
}

/// `sanitizeAgentTraceSpan`.
#[napi(js_name = "sanitizeAgentTraceSpan")]
pub fn sanitize_agent_trace_span(span: String) -> napi::Result<String> {
    run(move || {
        let span = crate::js::from_json(&span)?;
        let out = port::sanitize_agent_trace_span_value(&span)?;
        crate::js::to_json(&out)
    })
}

/// `sanitizeUnattributedAgentTraceSpan`.
#[napi(js_name = "sanitizeUnattributedAgentTraceSpan")]
pub fn sanitize_unattributed_agent_trace_span(span: String) -> napi::Result<String> {
    run(move || {
        let span = crate::js::from_json(&span)?;
        let out = port::sanitize_unattributed_agent_trace_span_value(&span)?;
        crate::js::to_json(&out)
    })
}

/// `attributeAgentTraceSpan`.
#[napi(js_name = "attributeAgentTraceSpan")]
pub fn attribute_agent_trace_span(span: String, attribution: String) -> napi::Result<String> {
    run(move || {
        let span = crate::js::from_json(&span)?;
        let attribution = crate::js::from_json(&attribution)?;
        let out = port::attribute_agent_trace_span_value(&span, &attribution)?;
        crate::js::to_json(&out)
    })
}

// ---- the binary wire ------------------------------------------------------------------------

type WireBuffers = (
    napi::bindgen_prelude::Uint8Array,
    napi::bindgen_prelude::Uint8Array,
    napi::bindgen_prelude::Uint32Array,
);

thread_local! {
    static WIRE: std::cell::RefCell<Option<WireBuffers>> = const { std::cell::RefCell::new(None) };
    static PENDING: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
    static SCRATCH: std::cell::RefCell<Vec<u8>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Registers the argument, result and argument-length buffers `index.cjs` uses.
#[napi(js_name = "sanitizerWireInit")]
pub fn rust_anything_wire_init(
    input: napi::bindgen_prelude::Uint8Array,
    output: napi::bindgen_prelude::Uint8Array,
    len: napi::bindgen_prelude::Uint32Array,
) {
    WIRE.with(|w| *w.borrow_mut() = Some((input, output, len)));
}

/// Copies a result that did not fit into the (now larger) result buffer.
#[napi(js_name = "sanitizerWireFlush")]
pub fn rust_anything_wire_flush() -> f64 {
    let bytes = PENDING.with(|p| std::mem::take(&mut *p.borrow_mut()));
    WIRE.with(|w| {
        let mut w = w.borrow_mut();
        let Some((_, output, _)) = w.as_mut() else {
            return -1.0;
        };
        // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
        let out = unsafe { output.as_mut() };
        let n = bytes.len().min(out.len());
        out[..n].copy_from_slice(&bytes[..n]);
        n as f64
    })
}

/// The wire has no `$object` or `$bytes` markers: a result carrying one goes through JSON instead.
fn wire_safe(value: &serde_json::Value) -> Result<(), String> {
    fn has_marker(value: &serde_json::Value) -> bool {
        match value {
            serde_json::Value::Array(items) => items.iter().any(has_marker),
            serde_json::Value::Object(map) => {
                (map.len() == 1 && (map.contains_key("$object") || map.contains_key("$bytes")))
                    || map.values().any(has_marker)
            }
            _ => false,
        }
    }
    if has_marker(value) {
        return Err(format!("{}a result with a JSON marker", wire::MISMATCH));
    }
    Ok(())
}

/// Reads the argument bytes (`wLen[0]` of them), runs `f`, and writes its result; a negative
/// return is the size of a result that did not fit, kept for `sanitizerWireFlush`.
fn wire_io(
    f: impl FnOnce(&mut wire::Reader, &mut wire::Writer) -> Result<(), String>,
) -> napi::Result<f64> {
    WIRE.with(|cell| {
        let mut guard = cell.borrow_mut();
        let Some((input, output, len)) = guard.as_mut() else {
            return Err(napi::Error::from_reason(
                "rust-anything: the wire buffers are not registered",
            ));
        };
        let len = (len.first().copied().unwrap_or(0) as usize).min(input.len());
        let mut w = wire::Writer(SCRATCH.with(|s| std::mem::take(&mut *s.borrow_mut())));
        w.0.clear();
        let result = run(|| f(&mut wire::Reader::new(&input[..len]), &mut w));
        let keep = |w: wire::Writer| SCRATCH.with(|s| *s.borrow_mut() = w.0);
        match result {
            // A result of another shape than the TS type: JS runs the call through JSON.
            Err(e) if e.reason.starts_with(wire::MISMATCH) => {
                keep(w);
                return Ok(f64::NAN);
            }
            Err(e) => {
                keep(w);
                let mut m = wire::Writer::default();
                m.string16(&e.reason);
                // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
                let out = unsafe { output.as_mut() };
                if m.0.len() > out.len() {
                    return Err(e);
                }
                out[..m.0.len()].copy_from_slice(&m.0);
                return Ok(f64::INFINITY);
            }
            Ok(()) => {}
        }
        // SAFETY: the call is synchronous; JS does not touch `output` until it returns.
        let out = unsafe { output.as_mut() };
        let n = w.0.len();
        if n > out.len() {
            PENDING.with(|p| *p.borrow_mut() = w.0);
            return Ok(-(n as f64));
        }
        out[..n].copy_from_slice(&w.0);
        keep(w);
        Ok(n as f64)
    })
}

static S_SANITIZE_AGENT_TRACE_SPAN_0: wire::Schema = wire::Schema::Dyn;
static S_SANITIZE_AGENT_TRACE_SPAN_OUT: wire::Schema = wire::Schema::OptJs(&wire::Schema::Obj(&[
    ("source", wire::Schema::Str16),
    ("sessionId", wire::Schema::Str16),
    ("traceId", wire::Schema::Str16),
    ("spanId", wire::Schema::Str16),
    ("parentSpanId", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("name", wire::Schema::Str16),
    ("category", wire::Schema::Str16),
    ("toolName", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("skillName", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("model", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("startedAt", wire::Schema::Str16),
    ("endedAt", wire::Schema::Str16),
    ("durationMs", wire::Schema::Num),
    ("status", wire::Schema::Str16),
    ("errorType", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("toolCallId", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("argumentsJson", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("resultText", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("contentState", wire::Schema::Str16),
]));

/// `sanitizeAgentTraceSpan` over the binary wire.
#[napi(js_name = "sanitizeAgentTraceSpanWire")]
pub fn sanitize_agent_trace_span_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let span: serde_json::Value = wire::read_value(r, &S_SANITIZE_AGENT_TRACE_SPAN_0)?;
        let out = port::sanitize_agent_trace_span_value(&span)?;
        wire_safe(&out)?;
        match &out {
            serde_json::Value::Null => w.tag(2),
            _ => {
                w.tag(1);
                wire::write_value(w, &out, S_SANITIZE_AGENT_TRACE_SPAN_OUT.inner())?;
            }
        }
        Ok(())
    })
}

static S_SANITIZE_UNATTRIBUTED_AGENT_TRACE_SPAN_0: wire::Schema = wire::Schema::Dyn;
static S_SANITIZE_UNATTRIBUTED_AGENT_TRACE_SPAN_OUT: wire::Schema = wire::Schema::Dyn;

/// `sanitizeUnattributedAgentTraceSpan` over the binary wire.
#[napi(js_name = "sanitizeUnattributedAgentTraceSpanWire")]
pub fn sanitize_unattributed_agent_trace_span_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let span: serde_json::Value =
            wire::read_value(r, &S_SANITIZE_UNATTRIBUTED_AGENT_TRACE_SPAN_0)?;
        let out = port::sanitize_unattributed_agent_trace_span_value(&span)?;
        wire_safe(&out)?;
        wire::write_value(w, &out, &S_SANITIZE_UNATTRIBUTED_AGENT_TRACE_SPAN_OUT)?;
        Ok(())
    })
}

static S_ATTRIBUTE_AGENT_TRACE_SPAN_0: wire::Schema = wire::Schema::Dyn;
static S_ATTRIBUTE_AGENT_TRACE_SPAN_1: wire::Schema = wire::Schema::Dyn;
static S_ATTRIBUTE_AGENT_TRACE_SPAN_OUT: wire::Schema = wire::Schema::Obj(&[
    ("source", wire::Schema::Str16),
    ("sessionId", wire::Schema::Str16),
    ("traceId", wire::Schema::Str16),
    ("spanId", wire::Schema::Str16),
    ("parentSpanId", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("name", wire::Schema::Str16),
    ("category", wire::Schema::Str16),
    ("toolName", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("skillName", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("model", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("startedAt", wire::Schema::Str16),
    ("endedAt", wire::Schema::Str16),
    ("durationMs", wire::Schema::Num),
    ("status", wire::Schema::Str16),
    ("errorType", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("toolCallId", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("argumentsJson", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("resultText", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("contentState", wire::Schema::Str16),
]);

/// `attributeAgentTraceSpan` over the binary wire.
#[napi(js_name = "attributeAgentTraceSpanWire")]
pub fn attribute_agent_trace_span_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let span: serde_json::Value = wire::read_value(r, &S_ATTRIBUTE_AGENT_TRACE_SPAN_0)?;
        let attribution: serde_json::Value = wire::read_value(r, &S_ATTRIBUTE_AGENT_TRACE_SPAN_1)?;
        let out = port::attribute_agent_trace_span_value(&span, &attribution)?;
        wire_safe(&out)?;
        wire::write_value(w, &out, &S_ATTRIBUTE_AGENT_TRACE_SPAN_OUT)?;
        Ok(())
    })
}
