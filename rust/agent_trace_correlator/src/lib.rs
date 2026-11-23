//! JS bindings for `reference/src/agent-trace-correlator.ts`. The wire glue at the bottom is maintained by
//! hand: its init and flush are exported as `correlatorWire*`, because `agent_trace_protocol` exports
//! the generated `rustAnythingWire*` names too and the later registration would win. `rust-anything
//! refresh` would overwrite these lines.

use napi_derive::napi;

pub mod js;
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

/// `toAgentTraceCorrelationFacts`.
#[napi(js_name = "toAgentTraceCorrelationFacts")]
pub fn to_agent_trace_correlation_facts(decoded: String) -> napi::Result<String> {
    run(move || {
        let decoded = crate::js::from_json(&decoded)?;
        let out = port::to_agent_trace_correlation_facts(decoded)?;
        crate::js::to_json(&out)
    })
}

/// `emptyCounts`.
#[napi(js_name = "emptyCounts")]
pub fn empty_counts() -> napi::Result<String> {
    run(move || {
        let out = port::empty_counts()?;
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
#[napi(js_name = "correlatorWireInit")]
pub fn rust_anything_wire_init(
    input: napi::bindgen_prelude::Uint8Array,
    output: napi::bindgen_prelude::Uint8Array,
    len: napi::bindgen_prelude::Uint32Array,
) {
    WIRE.with(|w| *w.borrow_mut() = Some((input, output, len)));
}

/// Copies a result that did not fit into the (now larger) result buffer.
#[napi(js_name = "correlatorWireFlush")]
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

/// Reads the argument bytes (`wLen[0]` of them), runs `f`, and writes its result; a negative
/// return is the size of a result that did not fit, kept for `rustAnythingWireFlush`.
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

static S_TO_AGENT_TRACE_CORRELATION_FACTS_0: wire::Schema = wire::Schema::Dyn;
static S_TO_AGENT_TRACE_CORRELATION_FACTS_OUT: wire::Schema = wire::Schema::Obj(&[
    ("traceId", wire::Schema::Str16),
    ("spanId", wire::Schema::Str16),
    ("parentSpanId", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("traceRootInRequest", wire::Schema::Bool),
    ("traceSource", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("traceSourceResolution", wire::Schema::Str16),
    ("traceSessionId", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("spanSource", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("spanSourceResolution", wire::Schema::Str16),
    (
        "spanConversationId",
        wire::Schema::OptJs(&wire::Schema::Str16),
    ),
    (
        "spanParentConversationId",
        wire::Schema::OptJs(&wire::Schema::Str16),
    ),
]);

/// `toAgentTraceCorrelationFacts` over the binary wire.
#[napi(js_name = "toAgentTraceCorrelationFactsWire")]
pub fn to_agent_trace_correlation_facts_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let decoded: serde_json::Value =
            wire::read_value(r, &S_TO_AGENT_TRACE_CORRELATION_FACTS_0)?;
        let out = &port::to_agent_trace_correlation_facts(decoded)?;
        wire::write_value(w, out, &S_TO_AGENT_TRACE_CORRELATION_FACTS_OUT)?;
        Ok(())
    })
}

static S_EMPTY_COUNTS_OUT: wire::Schema = wire::Schema::Obj(&[
    ("unsupportedSource", wire::Schema::Num),
    ("missingSourceSession", wire::Schema::Num),
    ("unresolvedTraceRoot", wire::Schema::Num),
]);

/// `emptyCounts` over the binary wire.
#[napi(js_name = "emptyCountsWire")]
pub fn empty_counts_wire() -> napi::Result<f64> {
    wire_io(|_r, w| {
        let out = &port::empty_counts()?;
        wire::write_value(w, out, &S_EMPTY_COUNTS_OUT)?;
        Ok(())
    })
}
