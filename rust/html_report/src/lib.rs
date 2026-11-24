//! The Rust port of `src/main/html-report.ts`: the standalone HTML report written by the export.
//!
//! The renderer is a pure string function, so parity is checked by replaying the TypeScript output in
//! `tests/scenarios.rs` byte for byte.

#![forbid(unsafe_code)]

pub mod port;
