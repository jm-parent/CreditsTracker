//! The Rust port of `reference/src/merge.ts`: the merged usage database that combines Copilot CLI
//! usage with VS Code Copilot Chat usage.
//!
//! `build_merged_database` takes a live SQLite connection, so `rust-anything bridge` cannot carry it to
//! JS as a value and the unit is not bridged. Parity is checked by replaying the TypeScript scenarios in
//! `tests/scenarios.rs`.

#![forbid(unsafe_code)]

pub mod port;
