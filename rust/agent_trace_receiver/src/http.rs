//! A minimal HTTP/1.1 server on `std::net`, for the localhost OTLP receiver.
//!
//! It replaces tiny_http, which keeps its sockets private, so a stalled body could not be cut off.
//! Here every read goes through a deadline on the socket. It implements what the receiver needs:
//! request heads, `content-length` and chunked bodies, keep-alive, and `100-continue`.
//! ponytail: no pipelining beyond sequential keep-alive, and trailers are read but not kept.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpStream};
use std::time::{Duration, Instant};

/// How long an idle keep-alive connection stays open between requests (Node's default).
pub const KEEP_ALIVE_TIMEOUT: Duration = Duration::from_secs(5);
/// Ceiling for reading one request, from its first byte to its last body byte, and for writing a reply.
/// ponytail: Node's default `requestTimeout` is 300 s. `close()` waits for in-flight requests under the
/// service lock, so the receiver uses a shorter ceiling.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// How long a refused connection (503) is drained before it closes. It runs on its own thread.
pub const REFUSAL_DRAIN_TIMEOUT: Duration = Duration::from_millis(200);
/// Bytes of a refused request's body that are read and dropped before the connection closes: twice
/// the 8 MiB export limit. A longer body is cut off, and the connection then closes with data unread.
pub const MAX_DRAINED_BYTES: usize = 16 * 1024 * 1024;

const MAX_HEAD_BYTES: usize = 64 * 1024;
const BUSY_RESPONSE: &[u8] =
    b"HTTP/1.1 503 Service Unavailable\r\ncontent-length: 0\r\nconnection: close\r\n\r\n";

/// A request head. Its body is read with `Connection::read_body`.
pub struct Request {
    pub method: String,
    pub target: String,
    headers: Vec<(String, String)>,
    framing: Framing,
    keep_alive: bool,
}

#[derive(Clone, Copy)]
enum Framing {
    Empty,
    Length(usize),
    Chunked,
}

/// A body within the limit, or one larger than it. A larger body is drained up to `MAX_DRAINED_BYTES`
/// before this is returned, and the connection is then closed.
pub enum Body {
    Complete(Vec<u8>),
    TooLarge,
}

pub enum RequestError {
    /// The client went away, or the request timed out before its head was complete.
    Closed,
    /// The head or its framing is not one this server reads. Answered with 400.
    Malformed,
    /// An `Expect` header other than `100-continue`. Answered with 417; the request's body is drained
    /// with `Connection::drain_body` first.
    ExpectationFailed(Request),
}

pub struct Connection {
    reader: BufReader<Deadline>,
}

/// Reads from the socket with a deadline: each read waits at most until `at`.
struct Deadline {
    stream: TcpStream,
    at: Instant,
}

impl Read for Deadline {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let remaining = self.at.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "the request deadline has passed",
            ));
        }
        self.stream.set_read_timeout(Some(remaining))?;
        self.stream.read(buf)
    }
}

impl Connection {
    pub fn new(stream: TcpStream) -> io::Result<Self> {
        stream.set_write_timeout(Some(REQUEST_TIMEOUT))?;
        Ok(Self {
            reader: BufReader::new(Deadline {
                stream,
                at: Instant::now(),
            }),
        })
    }

    /// Waits for the next request. `None` when the client has closed the connection or it stayed idle
    /// for `KEEP_ALIVE_TIMEOUT`.
    pub fn next_request(&mut self) -> Result<Option<Request>, RequestError> {
        self.reader.get_mut().at = Instant::now() + KEEP_ALIVE_TIMEOUT;
        match self.reader.fill_buf() {
            Ok(buffered) if !buffered.is_empty() => {}
            _ => return Ok(None),
        }
        self.reader.get_mut().at = Instant::now() + REQUEST_TIMEOUT;

        let request = read_head(&mut self.reader)?;
        match header_of(&request.headers, "expect") {
            None => {}
            Some(expect) if expect.eq_ignore_ascii_case("100-continue") => {
                let mut stream = self.stream();
                stream
                    .write_all(b"HTTP/1.1 100 Continue\r\n\r\n")
                    .map_err(|_| RequestError::Closed)?;
            }
            Some(_) => return Err(RequestError::ExpectationFailed(request)),
        }
        Ok(Some(request))
    }

    /// Reads the body of `request` up to `limit` bytes. A larger body is drained up to
    /// `MAX_DRAINED_BYTES` and reported as `TooLarge`; the caller then answers and closes.
    pub fn read_body(&mut self, request: &Request, limit: usize) -> io::Result<Body> {
        match request.framing {
            Framing::Empty => Ok(Body::Complete(Vec::new())),
            Framing::Length(length) if length > limit => {
                drain_length(&mut self.reader, length);
                Ok(Body::TooLarge)
            }
            Framing::Length(length) => {
                let mut body = Vec::new();
                (&mut self.reader)
                    .take(length as u64)
                    .read_to_end(&mut body)?;
                if body.len() < length {
                    return Err(io::ErrorKind::UnexpectedEof.into());
                }
                Ok(Body::Complete(body))
            }
            Framing::Chunked => read_chunked(&mut self.reader, limit),
        }
    }

    /// Reads and drops the body of a request that is refused, up to `MAX_DRAINED_BYTES`, so the client
    /// can finish sending before the connection closes. Returns whether the body was read to its end.
    pub fn drain_body(&mut self, request: &Request) -> bool {
        match request.framing {
            Framing::Empty => true,
            Framing::Length(length) => drain_length(&mut self.reader, length),
            Framing::Chunked => match read_chunk_size(&mut self.reader) {
                Ok(size) => drain_chunks(&mut self.reader, size),
                Err(_) => false,
            },
        }
    }

    /// Writes one complete response. The `content-type` header is sent only when one is given.
    pub fn respond(
        &mut self,
        status: u16,
        content_type: Option<&str>,
        body: &[u8],
        keep_alive: bool,
    ) -> io::Result<()> {
        let mut head = format!("HTTP/1.1 {status} {}\r\n", reason_phrase(status));
        if let Some(content_type) = content_type {
            head += &format!("content-type: {content_type}\r\n");
        }
        head += &format!("content-length: {}\r\n", body.len());
        if !keep_alive {
            head += "connection: close\r\n";
        }
        head += "\r\n";
        let mut stream = self.stream();
        stream.write_all(head.as_bytes())?;
        stream.write_all(body)?;
        stream.flush()
    }

    fn stream(&self) -> &TcpStream {
        &self.reader.get_ref().stream
    }
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        header_of(&self.headers, name)
    }

    /// Whether the connection can carry another request once this one is answered.
    pub fn keeps_alive(&self) -> bool {
        self.keep_alive
    }
}

/// Answers a connection that arrives while the receiver is full, then drains what the client sends
/// for up to `REFUSAL_DRAIN_TIMEOUT` before closing. The request is not parsed, so it can be any
/// request. Run it on its own thread: the drain waits for the client.
pub fn refuse_busy(mut stream: TcpStream) {
    if stream.write_all(BUSY_RESPONSE).is_err() {
        return;
    }
    let _ = stream.shutdown(Shutdown::Write);
    let mut drained = Deadline {
        stream,
        at: Instant::now() + REFUSAL_DRAIN_TIMEOUT,
    };
    let _ = io::copy(
        &mut (&mut drained).take(MAX_DRAINED_BYTES as u64),
        &mut io::sink(),
    );
}

/// Reads and drops `length` bytes, or as many as `MAX_DRAINED_BYTES` allows. Returns whether all of them
/// were read.
fn drain_length(reader: &mut BufReader<Deadline>, length: usize) -> bool {
    let copied = io::copy(
        &mut reader.by_ref().take(length.min(MAX_DRAINED_BYTES) as u64),
        &mut io::sink(),
    );
    copied.is_ok_and(|copied| copied == length as u64)
}

/// Reads and drops the rest of a chunked body, from `size`, the size of its next chunk, up to
/// `MAX_DRAINED_BYTES` of data. Returns whether the body ended within that bound.
fn drain_chunks(reader: &mut BufReader<Deadline>, mut size: usize) -> bool {
    let mut drained = 0;
    loop {
        if size == 0 {
            return read_trailers(reader).is_ok();
        }
        if size > MAX_DRAINED_BYTES - drained || !drain_length(reader, size) {
            return false;
        }
        drained += size;
        let mut budget = MAX_HEAD_BYTES;
        if !read_line(reader, &mut budget).is_ok_and(|line| line.is_empty()) {
            return false;
        }
        size = match read_chunk_size(reader) {
            Ok(size) => size,
            Err(_) => return false,
        };
    }
}

fn read_head(reader: &mut BufReader<Deadline>) -> Result<Request, RequestError> {
    let mut budget = MAX_HEAD_BYTES;
    let request_line = read_line(reader, &mut budget).map_err(head_error)?;
    let (method, target, version) = match request_line.split_whitespace().collect::<Vec<_>>()[..] {
        [method, target, version] => (method, target, version),
        _ => return Err(RequestError::Malformed),
    };
    let minor = version
        .strip_prefix("HTTP/1.")
        .and_then(|minor| minor.parse::<u8>().ok())
        .ok_or(RequestError::Malformed)?;

    let mut headers = Vec::new();
    loop {
        let line = read_line(reader, &mut budget).map_err(head_error)?;
        if line.is_empty() {
            break;
        }
        let (name, value) = line.split_once(':').ok_or(RequestError::Malformed)?;
        headers.push((name.trim().to_owned(), value.trim().to_owned()));
    }

    let framing = framing_of(&headers)?;
    let closes = header_of(&headers, "connection").is_some_and(|value| {
        value
            .split(',')
            .any(|token| token.trim().eq_ignore_ascii_case("close"))
    });
    Ok(Request {
        method: method.to_owned(),
        target: target.to_owned(),
        headers,
        framing,
        keep_alive: minor == 1 && !closes,
    })
}

/// Reads one line without its line break. The head budget bounds every line, so a client cannot
/// keep the server reading forever.
fn read_line(reader: &mut BufReader<Deadline>, budget: &mut usize) -> io::Result<String> {
    let mut line = Vec::new();
    let read = (&mut *reader)
        .take(*budget as u64)
        .read_until(b'\n', &mut line)?;
    *budget -= read;
    if !line.ends_with(b"\n") {
        return Err(if *budget == 0 {
            invalid("line too long")
        } else {
            io::ErrorKind::UnexpectedEof.into()
        });
    }
    line.pop();
    if line.last() == Some(&b'\r') {
        line.pop();
    }
    String::from_utf8(line).map_err(|_| invalid("line is not UTF-8"))
}

fn read_chunked(reader: &mut BufReader<Deadline>, limit: usize) -> io::Result<Body> {
    let mut body = Vec::new();
    loop {
        let size = read_chunk_size(reader)?;
        if size == 0 {
            read_trailers(reader)?;
            return Ok(Body::Complete(body));
        }
        if size > limit - body.len() {
            drain_chunks(reader, size);
            return Ok(Body::TooLarge);
        }
        let read = (&mut *reader).take(size as u64).read_to_end(&mut body)?;
        if read < size {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        let mut budget = MAX_HEAD_BYTES;
        if !read_line(reader, &mut budget)?.is_empty() {
            return Err(invalid("chunk data is not followed by a line break"));
        }
    }
}

fn read_chunk_size(reader: &mut BufReader<Deadline>) -> io::Result<usize> {
    let mut budget = MAX_HEAD_BYTES;
    let size_line = read_line(reader, &mut budget)?;
    let size = size_line.split(';').next().unwrap_or("").trim();
    usize::from_str_radix(size, 16).map_err(|_| invalid("chunk size is not hexadecimal"))
}

fn read_trailers(reader: &mut BufReader<Deadline>) -> io::Result<()> {
    let mut budget = MAX_HEAD_BYTES;
    while !read_line(reader, &mut budget)?.is_empty() {}
    Ok(())
}

fn framing_of(headers: &[(String, String)]) -> Result<Framing, RequestError> {
    if let Some(encoding) = header_of(headers, "transfer-encoding") {
        return if encoding.to_ascii_lowercase().ends_with("chunked") {
            Ok(Framing::Chunked)
        } else {
            Err(RequestError::Malformed)
        };
    }
    match header_of(headers, "content-length") {
        None => Ok(Framing::Empty),
        Some(length) => length
            .parse()
            .map(Framing::Length)
            .map_err(|_| RequestError::Malformed),
    }
}

fn header_of<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(field, _)| field.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

fn head_error(error: io::Error) -> RequestError {
    if error.kind() == io::ErrorKind::InvalidData {
        RequestError::Malformed
    } else {
        RequestError::Closed
    }
}

fn invalid(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

fn reason_phrase(status: u16) -> &'static str {
    match status {
        100 => "Continue",
        200 => "OK",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        413 => "Payload Too Large",
        415 => "Unsupported Media Type",
        417 => "Expectation Failed",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "",
    }
}
