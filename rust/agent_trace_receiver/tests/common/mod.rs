#![allow(dead_code)]

use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// A fresh folder under the Cargo target directory, so tests never write outside the build output.
pub fn scratch(name: &str) -> PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join("agent-trace-receiver")
        .join(name);
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("scratch folder");
    dir
}

pub struct Reply {
    pub status: u16,
    pub content_type: Option<String>,
    pub body: Vec<u8>,
}

/// The port of an endpoint such as `http://127.0.0.1:4318`.
pub fn port_of(endpoint: &str) -> u16 {
    endpoint
        .rsplit(':')
        .next()
        .and_then(|port| port.parse().ok())
        .expect("endpoint with a port")
}

/// One HTTP/1.1 exchange on a new connection that is closed after the reply, as the TypeScript
/// scenarios send them. A `content-length` header is added when the body is not empty.
pub fn exchange(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(String, String)],
    body: Option<&[u8]>,
) -> Reply {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .expect("read timeout");

    let mut head = format!("{method} {path} HTTP/1.1\r\n");
    for (name, value) in headers {
        head += &format!("{name}: {value}\r\n");
    }
    let has_length = headers
        .iter()
        .any(|(name, _)| name.eq_ignore_ascii_case("content-length"));
    if let (Some(bytes), false) = (body, has_length) {
        head += &format!("content-length: {}\r\n", bytes.len());
    }
    head += "connection: close\r\n\r\n";

    let _ = stream.write_all(head.as_bytes());
    if let Some(bytes) = body {
        let _ = stream.write_all(bytes);
    }
    let mut raw = Vec::new();
    let _ = stream.read_to_end(&mut raw);
    parse_reply(&raw)
}

fn parse_reply(raw: &[u8]) -> Reply {
    let split = raw
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .unwrap_or(raw.len());
    let head = String::from_utf8_lossy(&raw[..split]).into_owned();
    let body = raw.get(split + 4..).unwrap_or_default().to_vec();

    let mut lines = head.lines();
    let status = lines
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse().ok())
        .unwrap_or(0);
    let content_type = lines.find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim()
            .eq_ignore_ascii_case("content-type")
            .then(|| value.trim().to_owned())
    });
    Reply {
        status,
        content_type,
        body,
    }
}
