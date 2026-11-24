//! The Rust port of `reference/src/agent-trace-receiver.ts` and `reference/src/agent-trace-service.ts`.
//! `port` is the OTLP/HTTP receiver; `service` owns one receiver and the store, and its opt-in state.
//!
//! The receiver's only export takes the store, which has function members in TypeScript, so
//! `rust-anything bridge` refuses the unit. The port is reached through these modules directly, and
//! parity is checked by replaying the TypeScript scenarios over real HTTP requests.

#![forbid(unsafe_code)]

pub mod port;
pub mod service;

mod http;
