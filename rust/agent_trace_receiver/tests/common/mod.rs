#![allow(dead_code)]

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
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

/// Several requests on one connection that stays open, as an exporter keeps its connection.
pub struct KeepAlive {
    writer: TcpStream,
    reader: BufReader<TcpStream>,
}

impl KeepAlive {
    pub fn connect(port: u16) -> Self {
        let writer = TcpStream::connect(("127.0.0.1", port)).expect("connect");
        writer
            .set_read_timeout(Some(Duration::from_secs(10)))
            .expect("read timeout");
        let reader = BufReader::new(writer.try_clone().expect("clone"));
        Self { writer, reader }
    }

    /// Sends one request with a `content-length` header and reads its reply.
    pub fn request(&mut self, method: &str, path: &str, headers: &[(String, String)], body: &[u8]) -> Reply {
        let head = format!("content-length: {}\r\n\r\n", body.len());
        self.send(method, path, headers, &head, body)
    }

    /// Sends one request whose body is a single `transfer-encoding: chunked` chunk, and reads its reply.
    pub fn request_chunked(&mut self, method: &str, path: &str, headers: &[(String, String)], body: &[u8]) -> Reply {
        let mut framed = format!("{:x}\r\n", body.len()).into_bytes();
        framed.extend_from_slice(body);
        framed.extend_from_slice(b"\r\n0\r\n\r\n");
        self.send(method, path, headers, "transfer-encoding: chunked\r\n\r\n", &framed)
    }

    fn send(&mut self, method: &str, path: &str, headers: &[(String, String)], framing: &str, body: &[u8]) -> Reply {
        let mut head = format!("{method} {path} HTTP/1.1\r\n");
        for (name, value) in headers {
            head += &format!("{name}: {value}\r\n");
        }
        head += framing;
        self.writer.write_all(head.as_bytes()).expect("write head");
        self.writer.write_all(body).expect("write body");
        read_reply(&mut self.reader)
    }
}

fn read_reply(reader: &mut BufReader<TcpStream>) -> Reply {
    let mut line = String::new();
    reader.read_line(&mut line).expect("status line");
    let status = line
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse().ok())
        .expect("status code");

    let mut content_type = None;
    let mut length = 0;
    loop {
        line.clear();
        reader.read_line(&mut line).expect("header line");
        let header = line.trim_end();
        if header.is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            match name.trim().to_ascii_lowercase().as_str() {
                "content-type" => content_type = Some(value.trim().to_owned()),
                "content-length" => length = value.trim().parse().expect("content-length"),
                _ => {}
            }
        }
    }

    let mut body = vec![0; length];
    reader.read_exact(&mut body).expect("reply body");
    Reply {
        status,
        content_type,
        body,
    }
}

pub fn parse_reply(raw: &[u8]) -> Reply {
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
