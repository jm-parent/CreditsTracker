//! The Rust port of `reference/src/db.ts`: read-only usage queries over the Copilot CLI session store.
//!
//! The queries take a live SQLite connection, so `rust-anything bridge` cannot carry them to JS as
//! values and the unit is not bridged. The port is reached through `port` directly, and parity is
//! checked by replaying the TypeScript scenarios in `tests/scenarios.rs`.

#![forbid(unsafe_code)]

pub mod port;
