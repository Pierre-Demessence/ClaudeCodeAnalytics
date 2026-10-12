//! The widget's one request: `GET /api/widget` on the dashboard.
//!
//! Windows does not resolve `*.localhost` (browsers special-case it), so the
//! connection goes to loopback, where Traefik listens, and the `Host` header stays
//! the real one for its routing. The request is HTTP/1.0 so that the answer is never
//! chunked: the body is everything after the headers. Redirects are not followed.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::Duration;

use crate::view::WidgetView;

pub const DASHBOARD_HOST: &str = "analytics.claudecode.localhost";
const TIMEOUT: Duration = Duration::from_secs(10);
/// The answer is a few hundred bytes; anything much larger is not the API.
const MAX_ANSWER: u64 = 64 * 1024;

fn request(host: &str, path: &str) -> String {
    format!("GET {path} HTTP/1.0\r\nHost: {host}\r\nAccept: application/json\r\nConnection: close\r\n\r\n")
}

fn parse(answer: &[u8]) -> Result<WidgetView, String> {
    let split = answer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or("incomplete answer")?;
    let (head, body) = (&answer[..split], &answer[split + 4..]);
    let head = std::str::from_utf8(head).map_err(|_| "bad headers")?;
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or("no status line")?;
    if status != "200" {
        return Err(format!("HTTP {status}"));
    }
    serde_json::from_slice(body).map_err(|error| format!("bad answer: {error}"))
}

/// Asks the dashboard on `address` (loopback, port 80 in production) for the widget view.
pub fn fetch_from(address: SocketAddr, host: &str, path: &str) -> Result<WidgetView, String> {
    let mut stream = TcpStream::connect_timeout(&address, TIMEOUT).map_err(|error| error.to_string())?;
    stream.set_read_timeout(Some(TIMEOUT)).map_err(|error| error.to_string())?;
    stream.set_write_timeout(Some(TIMEOUT)).map_err(|error| error.to_string())?;
    stream
        .write_all(request(host, path).as_bytes())
        .map_err(|error| error.to_string())?;
    let mut answer = Vec::new();
    stream
        .take(MAX_ANSWER)
        .read_to_end(&mut answer)
        .map_err(|error| error.to_string())?;
    parse(&answer)
}

pub fn fetch() -> Result<WidgetView, String> {
    fetch_from(
        SocketAddr::from((Ipv4Addr::LOCALHOST, 80)),
        DASHBOARD_HOST,
        "/api/widget",
    )
}

#[cfg(test)]
mod tests {
    use std::net::TcpListener;
    use std::thread;

    use super::*;

    const BODY: &str = r#"{"fiveHour":{"estimated":false,"limit":95,"percent":42},"generatedAt":"x","weekly":{"estimated":false,"limit":98}}"#;

    fn serve(answer: String) -> (SocketAddr, thread::JoinHandle<String>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut received = [0; 1024];
            let size = stream.read(&mut received).unwrap();
            stream.write_all(answer.as_bytes()).unwrap();
            String::from_utf8_lossy(&received[..size]).into_owned()
        });
        (address, handle)
    }

    #[test]
    fn asks_for_the_route_with_the_real_host_header() {
        let (address, handle) = serve(format!("HTTP/1.0 200 OK\r\n\r\n{BODY}"));
        fetch_from(address, DASHBOARD_HOST, "/api/widget").unwrap();
        let received = handle.join().unwrap();
        assert!(received.starts_with("GET /api/widget HTTP/1.0\r\n"));
        assert!(received.contains("Host: analytics.claudecode.localhost\r\n"));
    }

    #[test]
    fn reads_the_view_from_the_body() {
        let (address, _) = serve(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{BODY}"));
        let view = fetch_from(address, DASHBOARD_HOST, "/api/widget").unwrap();
        assert_eq!(view.five_hour.percent, Some(42.0));
        assert_eq!(view.weekly.percent, None);
    }

    #[test]
    fn a_status_other_than_200_is_an_error() {
        assert_eq!(parse(b"HTTP/1.1 404 Not Found\r\n\r\nnope").unwrap_err(), "HTTP 404");
        assert_eq!(parse(b"HTTP/1.1 302 Found\r\nLocation: /\r\n\r\n").unwrap_err(), "HTTP 302");
    }

    #[test]
    fn a_body_that_is_not_a_view_is_an_error() {
        assert!(parse(b"HTTP/1.1 200 OK\r\n\r\n<html>").is_err());
        assert!(parse(b"HTTP/1.1 200 OK\r\n\r\n{\"fiveHour\":1}").is_err());
    }

    #[test]
    fn a_truncated_answer_is_an_error() {
        assert!(parse(b"HTTP/1.1 200 OK\r\n").is_err());
        assert!(parse(b"").is_err());
    }

    #[test]
    fn a_refused_connection_is_an_error() {
        let address = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap().local_addr().unwrap();
        assert!(fetch_from(address, DASHBOARD_HOST, "/api/widget").is_err());
    }
}
