//! Rust message types for the OTLP trace protocol, generated at build time by
//! `prost-build` from the `.proto` files in `proto/` (mirrored, unmodified, from
//! `src/main/agent-trace-proto/`). See `build.rs`.
//!
//! The module nesting below must mirror the protobuf package paths exactly: prost emits
//! cross-package references (e.g. `trace.v1` using `common.v1::KeyValue`) as `super::` paths
//! relative to this structure.

#![allow(clippy::all)]

pub mod opentelemetry {
    pub mod proto {
        pub mod collector {
            pub mod trace {
                pub mod v1 {
                    include!(concat!(
                        env!("OUT_DIR"),
                        "/opentelemetry.proto.collector.trace.v1.rs"
                    ));
                }
            }
        }
        pub mod common {
            pub mod v1 {
                include!(concat!(
                    env!("OUT_DIR"),
                    "/opentelemetry.proto.common.v1.rs"
                ));
            }
        }
        pub mod resource {
            pub mod v1 {
                include!(concat!(
                    env!("OUT_DIR"),
                    "/opentelemetry.proto.resource.v1.rs"
                ));
            }
        }
        pub mod trace {
            pub mod v1 {
                include!(concat!(env!("OUT_DIR"), "/opentelemetry.proto.trace.v1.rs"));
            }
        }
    }
}
