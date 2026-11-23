//! JS bindings for `src/logger.ts`: generated from the signatures in `port.rs` by rust-anything.
//! Regenerate with `rust-anything refresh` after changing them.

use napi_derive::napi;

pub mod js;
pub mod port;
pub mod wire;

#[allow(unused_imports)]
use serde_json::Value;
pub mod utf16;

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

/// `configureLogFile`.
#[napi(js_name = "configureLogFile")]
pub fn configure_log_file(file_path: String) -> napi::Result<()> {
    run(move || {
        port::configure_log_file(file_path)?;
        Ok(())
    })
}

/// `getLogFilePath`.
#[napi(js_name = "getLogFilePath")]
pub fn get_log_file_path() -> napi::Result<napi::bindgen_prelude::Either<String, ()>> {
    run(move || {
        let out = port::get_log_file_path()?;
        Ok(out.map_or(
            napi::bindgen_prelude::Either::B(()),
            napi::bindgen_prelude::Either::A,
        ))
    })
}

/// `log`.
#[napi(js_name = "log")]
pub fn log(
    level: String,
    scope: String,
    message: String,
    detail: String,
    source: Option<String>,
) -> napi::Result<String> {
    run(move || {
        let detail = crate::js::from_json(&detail)?;
        let out = port::log(level, scope, message, detail, source)?;
        crate::js::to_json(&out)
    })
}

/// `logDebug`.
#[napi(js_name = "logDebug")]
pub fn log_debug(scope: String, message: String, detail: String) -> napi::Result<String> {
    run(move || {
        let detail = crate::js::from_json(&detail)?;
        let out = port::log_debug(scope, message, detail)?;
        crate::js::to_json(&out)
    })
}

/// `logInfo`.
#[napi(js_name = "logInfo")]
pub fn log_info(scope: String, message: String, detail: String) -> napi::Result<String> {
    run(move || {
        let detail = crate::js::from_json(&detail)?;
        let out = port::log_info(scope, message, detail)?;
        crate::js::to_json(&out)
    })
}

/// `logWarn`.
#[napi(js_name = "logWarn")]
pub fn log_warn(scope: String, message: String, detail: String) -> napi::Result<String> {
    run(move || {
        let detail = crate::js::from_json(&detail)?;
        let out = port::log_warn(scope, message, detail)?;
        crate::js::to_json(&out)
    })
}

/// `logError`.
#[napi(js_name = "logError")]
pub fn log_error(scope: String, message: String, detail: String) -> napi::Result<String> {
    run(move || {
        let detail = crate::js::from_json(&detail)?;
        let out = port::log_error(scope, message, detail)?;
        crate::js::to_json(&out)
    })
}

/// `recordRendererLog`.
#[napi(js_name = "recordRendererLog")]
pub fn record_renderer_log(input: String) -> napi::Result<String> {
    run(move || {
        let input = crate::js::from_json(&input)?;
        let out = port::record_renderer_log(input)?;
        crate::js::to_json(&out)
    })
}

/// `logOnce`.
#[napi(js_name = "logOnce")]
pub fn log_once(
    key: String,
    level: String,
    scope: String,
    message: String,
    detail: String,
) -> napi::Result<String> {
    run(move || {
        let detail = crate::js::from_json(&detail)?;
        let out = port::log_once(key, level, scope, message, detail)?;
        crate::js::to_json(&out)
    })
}

/// `getLogEntries`.
#[napi(js_name = "getLogEntries")]
pub fn get_log_entries() -> napi::Result<String> {
    run(move || {
        let out = port::get_log_entries()?;
        crate::js::to_json(&out)
    })
}

/// `clearLogs`.
#[napi(js_name = "clearLogs")]
pub fn clear_logs() -> napi::Result<()> {
    run(move || {
        port::clear_logs()?;
        Ok(())
    })
}

/// `resetLoggerForTests`.
#[napi(js_name = "resetLoggerForTests")]
pub fn reset_logger_for_tests() -> napi::Result<()> {
    run(move || {
        port::reset_logger_for_tests()?;
        Ok(())
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
#[napi(js_name = "rustAnythingWireInit")]
pub fn rust_anything_wire_init(
    input: napi::bindgen_prelude::Uint8Array,
    output: napi::bindgen_prelude::Uint8Array,
    len: napi::bindgen_prelude::Uint32Array,
) {
    WIRE.with(|w| *w.borrow_mut() = Some((input, output, len)));
}

/// Copies a result that did not fit into the (now larger) result buffer.
#[napi(js_name = "rustAnythingWireFlush")]
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

/// `configureLogFile` over the binary wire.
#[napi(js_name = "configureLogFileWire")]
pub fn configure_log_file_wire() -> napi::Result<f64> {
    wire_io(|r, _w| {
        let file_path: String = r.string16()?;
        let () = port::configure_log_file(file_path)?;
        Ok(())
    })
}

/// `getLogFilePath` over the binary wire.
#[napi(js_name = "getLogFilePathWire")]
pub fn get_log_file_path_wire() -> napi::Result<f64> {
    wire_io(|_r, w| {
        let out = &port::get_log_file_path()?;
        match out {
            Some(x0) => {
                w.tag(1);
                w.string16(x0);
            }
            None => w.tag(2),
        }
        Ok(())
    })
}

static S_LOG_OUT: wire::Schema = wire::Schema::Obj(&[
    ("id", wire::Schema::Num),
    ("timestamp", wire::Schema::Str16),
    ("level", wire::Schema::Str16),
    ("scope", wire::Schema::Str16),
    ("message", wire::Schema::Str16),
    ("detail", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("source", wire::Schema::Str16),
]);

/// `log` over the binary wire.
#[napi(js_name = "logWire")]
pub fn log_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let level: String = r.string16()?;
        let scope: String = r.string16()?;
        let message: String = r.string16()?;
        let detail: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let source: Option<String> = r.opt_js(|r| r.string16())?;
        let out = &port::log(level, scope, message, detail, source)?;
        wire::write_value(w, out, &S_LOG_OUT)?;
        Ok(())
    })
}

static S_LOG_DEBUG_OUT: wire::Schema = wire::Schema::Obj(&[
    ("id", wire::Schema::Num),
    ("timestamp", wire::Schema::Str16),
    ("level", wire::Schema::Str16),
    ("scope", wire::Schema::Str16),
    ("message", wire::Schema::Str16),
    ("detail", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("source", wire::Schema::Str16),
]);

/// `logDebug` over the binary wire.
#[napi(js_name = "logDebugWire")]
pub fn log_debug_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let scope: String = r.string16()?;
        let message: String = r.string16()?;
        let detail: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let out = &port::log_debug(scope, message, detail)?;
        wire::write_value(w, out, &S_LOG_DEBUG_OUT)?;
        Ok(())
    })
}

static S_LOG_INFO_OUT: wire::Schema = wire::Schema::Obj(&[
    ("id", wire::Schema::Num),
    ("timestamp", wire::Schema::Str16),
    ("level", wire::Schema::Str16),
    ("scope", wire::Schema::Str16),
    ("message", wire::Schema::Str16),
    ("detail", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("source", wire::Schema::Str16),
]);

/// `logInfo` over the binary wire.
#[napi(js_name = "logInfoWire")]
pub fn log_info_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let scope: String = r.string16()?;
        let message: String = r.string16()?;
        let detail: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let out = &port::log_info(scope, message, detail)?;
        wire::write_value(w, out, &S_LOG_INFO_OUT)?;
        Ok(())
    })
}

static S_LOG_WARN_OUT: wire::Schema = wire::Schema::Obj(&[
    ("id", wire::Schema::Num),
    ("timestamp", wire::Schema::Str16),
    ("level", wire::Schema::Str16),
    ("scope", wire::Schema::Str16),
    ("message", wire::Schema::Str16),
    ("detail", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("source", wire::Schema::Str16),
]);

/// `logWarn` over the binary wire.
#[napi(js_name = "logWarnWire")]
pub fn log_warn_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let scope: String = r.string16()?;
        let message: String = r.string16()?;
        let detail: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let out = &port::log_warn(scope, message, detail)?;
        wire::write_value(w, out, &S_LOG_WARN_OUT)?;
        Ok(())
    })
}

static S_LOG_ERROR_OUT: wire::Schema = wire::Schema::Obj(&[
    ("id", wire::Schema::Num),
    ("timestamp", wire::Schema::Str16),
    ("level", wire::Schema::Str16),
    ("scope", wire::Schema::Str16),
    ("message", wire::Schema::Str16),
    ("detail", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("source", wire::Schema::Str16),
]);

/// `logError` over the binary wire.
#[napi(js_name = "logErrorWire")]
pub fn log_error_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let scope: String = r.string16()?;
        let message: String = r.string16()?;
        let detail: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let out = &port::log_error(scope, message, detail)?;
        wire::write_value(w, out, &S_LOG_ERROR_OUT)?;
        Ok(())
    })
}

static S_RECORD_RENDERER_LOG_0: wire::Schema = wire::Schema::Dyn;
static S_RECORD_RENDERER_LOG_OUT: wire::Schema = wire::Schema::Obj(&[
    ("id", wire::Schema::Num),
    ("timestamp", wire::Schema::Str16),
    ("level", wire::Schema::Str16),
    ("scope", wire::Schema::Str16),
    ("message", wire::Schema::Str16),
    ("detail", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("source", wire::Schema::Str16),
]);

/// `recordRendererLog` over the binary wire.
#[napi(js_name = "recordRendererLogWire")]
pub fn record_renderer_log_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let input: serde_json::Value = wire::read_value(r, &S_RECORD_RENDERER_LOG_0)?;
        let out = &port::record_renderer_log(input)?;
        wire::write_value(w, out, &S_RECORD_RENDERER_LOG_OUT)?;
        Ok(())
    })
}

static S_LOG_ONCE_OUT: wire::Schema = wire::Schema::OptJs(&wire::Schema::Obj(&[
    ("id", wire::Schema::Num),
    ("timestamp", wire::Schema::Str16),
    ("level", wire::Schema::Str16),
    ("scope", wire::Schema::Str16),
    ("message", wire::Schema::Str16),
    ("detail", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("source", wire::Schema::Str16),
]));

/// `logOnce` over the binary wire.
#[napi(js_name = "logOnceWire")]
pub fn log_once_wire() -> napi::Result<f64> {
    wire_io(|r, w| {
        let key: String = r.string16()?;
        let level: String = r.string16()?;
        let scope: String = r.string16()?;
        let message: String = r.string16()?;
        let detail: Option<serde_json::Value> = wire::read_dyn_opt(r)?;
        let out = &port::log_once(key, level, scope, message, detail)?;
        match out {
            Some(x0) => {
                w.tag(1);
                wire::write_value(w, x0, S_LOG_ONCE_OUT.inner())?;
            }
            None => w.tag(2),
        }
        Ok(())
    })
}

static S_GET_LOG_ENTRIES_OUT: wire::Schema = wire::Schema::List(&wire::Schema::Obj(&[
    ("id", wire::Schema::Num),
    ("timestamp", wire::Schema::Str16),
    ("level", wire::Schema::Str16),
    ("scope", wire::Schema::Str16),
    ("message", wire::Schema::Str16),
    ("detail", wire::Schema::OptJs(&wire::Schema::Str16)),
    ("source", wire::Schema::Str16),
]));

/// `getLogEntries` over the binary wire.
#[napi(js_name = "getLogEntriesWire")]
pub fn get_log_entries_wire() -> napi::Result<f64> {
    wire_io(|_r, w| {
        let out = &port::get_log_entries()?;
        w.tag(1);
        w.count(out.len());
        for x0 in out.iter() {
            wire::write_value(w, x0, S_GET_LOG_ENTRIES_OUT.inner())?;
        }
        Ok(())
    })
}

/// `clearLogs` over the binary wire.
#[napi(js_name = "clearLogsWire")]
pub fn clear_logs_wire() -> napi::Result<f64> {
    wire_io(|_r, _w| {
        let () = port::clear_logs()?;
        Ok(())
    })
}

/// `resetLoggerForTests` over the binary wire.
#[napi(js_name = "resetLoggerForTestsWire")]
pub fn reset_logger_for_tests_wire() -> napi::Result<f64> {
    wire_io(|_r, _w| {
        let () = port::reset_logger_for_tests()?;
        Ok(())
    })
}
