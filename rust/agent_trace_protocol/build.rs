fn main() {
    napi_build::setup();

    // prost-build shells out to `protoc`; vendor a prebuilt binary instead of requiring one
    // on PATH.
    unsafe {
        std::env::set_var("PROTOC", protoc_bin_vendored::protoc_bin_path().unwrap());
    }

    let proto_root = "proto";
    let proto_file =
        format!("{proto_root}/opentelemetry/proto/collector/trace/v1/trace_service.proto");
    println!("cargo:rerun-if-changed={proto_file}");
    prost_build::Config::new()
        // The .proto comments include indented example payloads (e.g. a sample attribute
        // map) that rustdoc otherwise treats as a doctest and tries to compile as Rust.
        .disable_comments(["."])
        .compile_protos(&[&proto_file], &[proto_root])
        .expect("failed to compile agent-trace OTLP .proto files with prost-build");
}
