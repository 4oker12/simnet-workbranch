#!/usr/bin/env python3
"""RouterLab Xiaomi R4A compatibility front door.

This is intentionally a *transport* shim only. It serves the exact stock /www tree and
forwards LuCI CGI requests to the exact stock fcgi-cgi process on 127.0.0.1:8920.

Why it exists:
The stock sysapihttpd binary uses Xiaomi-specific original-destination/session plumbing.
Under qemu-user that plumbing sees the sentinel 0.0.0.1:65535 and aborts the worker on
the first request. That transport behavior is not part of the configuration semantics
we need to validate.

No router business logic is implemented here.
"""

from __future__ import annotations

import argparse
import mimetypes
import os
import socket
import struct
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterable

FCGI_VERSION_1 = 1
FCGI_BEGIN_REQUEST = 1
FCGI_END_REQUEST = 3
FCGI_PARAMS = 4
FCGI_STDIN = 5
FCGI_STDOUT = 6
FCGI_STDERR = 7
FCGI_RESPONDER = 1

HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


def _record(record_type: int, request_id: int, content: bytes = b"") -> bytes:
    padding = (-len(content)) & 7
    return (
        struct.pack("!BBHHBB", FCGI_VERSION_1, record_type, request_id, len(content), padding, 0)
        + content
        + (b"\x00" * padding)
    )


def _nv_len(length: int) -> bytes:
    if length < 128:
        return bytes([length])
    return struct.pack("!I", length | 0x80000000)


def _param(name: str, value: str) -> bytes:
    n = name.encode("latin-1", "replace")
    v = value.encode("latin-1", "replace")
    return _nv_len(len(n)) + _nv_len(len(v)) + n + v


def _chunks(data: bytes, size: int = 65535) -> Iterable[bytes]:
    for offset in range(0, len(data), size):
        yield data[offset : offset + size]


def fastcgi_request(host: str, port: int, env: dict[str, str], body: bytes, timeout: float) -> tuple[bytes, bytes]:
    request_id = 1
    begin = struct.pack("!HB5x", FCGI_RESPONDER, 0)

    params = b"".join(_param(k, v) for k, v in env.items())
    payload = [_record(FCGI_BEGIN_REQUEST, request_id, begin)]
    payload.extend(_record(FCGI_PARAMS, request_id, part) for part in _chunks(params))
    payload.append(_record(FCGI_PARAMS, request_id))
    payload.extend(_record(FCGI_STDIN, request_id, part) for part in _chunks(body))
    payload.append(_record(FCGI_STDIN, request_id))

    stdout = bytearray()
    stderr = bytearray()

    with socket.create_connection((host, port), timeout=timeout) as sock:
        sock.settimeout(timeout)
        sock.sendall(b"".join(payload))
        while True:
            header = b""
            while len(header) < 8:
                piece = sock.recv(8 - len(header))
                if not piece:
                    raise RuntimeError("FastCGI socket closed before record header")
                header += piece

            version, rec_type, rec_id, content_len, padding_len, _ = struct.unpack("!BBHHBB", header)
            if version != FCGI_VERSION_1 or rec_id not in (0, request_id):
                raise RuntimeError(f"unexpected FastCGI record version={version} id={rec_id}")

            content = b""
            while len(content) < content_len:
                piece = sock.recv(content_len - len(content))
                if not piece:
                    raise RuntimeError("FastCGI socket closed mid-record")
                content += piece

            remaining = padding_len
            while remaining:
                piece = sock.recv(remaining)
                if not piece:
                    raise RuntimeError("FastCGI socket closed in padding")
                remaining -= len(piece)

            if rec_type == FCGI_STDOUT:
                stdout.extend(content)
            elif rec_type == FCGI_STDERR:
                stderr.extend(content)
            elif rec_type == FCGI_END_REQUEST:
                return bytes(stdout), bytes(stderr)


def parse_cgi_response(raw: bytes) -> tuple[int, list[tuple[str, str]], bytes]:
    split = raw.find(b"\r\n\r\n")
    sep_len = 4
    if split < 0:
        split = raw.find(b"\n\n")
        sep_len = 2
    if split < 0:
        # A CGI program should emit headers. Keep evidence visible instead of inventing success.
        return 502, [("Content-Type", "text/plain; charset=utf-8")], raw

    header_blob = raw[:split].decode("latin-1", "replace")
    body = raw[split + sep_len :]
    status = 200
    headers: list[tuple[str, str]] = []

    for line in header_blob.replace("\r\n", "\n").split("\n"):
        if not line or ":" not in line:
            continue
        name, value = line.split(":", 1)
        name = name.strip()
        value = value.strip()
        if name.lower() == "status":
            try:
                status = int(value.split()[0])
            except (ValueError, IndexError):
                status = 500
            continue
        if name.lower() not in HOP_BY_HOP:
            headers.append((name, value))

    return status, headers, body


class RouterLabHandler(BaseHTTPRequestHandler):
    server_version = "RouterLab-Compat/1.0"
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        self._dispatch()

    def do_HEAD(self) -> None:
        self._dispatch(head_only=True)

    def do_POST(self) -> None:
        self._dispatch()

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("[compat-frontdoor] " + fmt % args + "\n")

    @property
    def cfg(self) -> argparse.Namespace:
        return self.server.cfg  # type: ignore[attr-defined]

    def _dispatch(self, head_only: bool = False) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path

        if path == "/api-third-party" or path.startswith("/api-third-party/"):
            self._cgi(parsed, head_only)
            return
        if path == "/cgi-bin/luci" or path.startswith("/cgi-bin/luci/"):
            self._cgi(parsed, head_only)
            return

        self._static(path, head_only)

    def _body(self) -> bytes:
        raw_len = self.headers.get("Content-Length", "0")
        try:
            length = max(0, min(int(raw_len), self.cfg.max_body))
        except ValueError:
            length = 0
        return self.rfile.read(length) if length else b""

    def _cgi(self, parsed: urllib.parse.SplitResult, head_only: bool) -> None:
        body = self._body()
        path = parsed.path
        prefix = "/cgi-bin/luci"
        path_info = path[len(prefix) :] if path.startswith(prefix) else path[len("/api-third-party") :]
        if path_info and not path_info.startswith("/"):
            path_info = "/" + path_info

        env: dict[str, str] = {
            "GATEWAY_INTERFACE": "CGI/1.1",
            "SERVER_SOFTWARE": "nginx/1.2.2",
            "SERVER_PROTOCOL": self.request_version,
            "REQUEST_METHOD": self.command,
            "REQUEST_URI": self.path,
            "DOCUMENT_URI": path,
            "DOCUMENT_ROOT": "/www",
            "SCRIPT_FILENAME": "/www/cgi-bin/luci",
            "SCRIPT_NAME": "/cgi-bin/luci",
            "PATH_INFO": path_info,
            "QUERY_STRING": parsed.query,
            "REMOTE_ADDR": self.cfg.client_ip,
            "REMOTE_PORT": str(self.client_address[1]),
            "SERVER_ADDR": self.cfg.router_ip,
            "SERVER_PORT": "80",
            "SERVER_NAME": self.cfg.router_host,
            "HTTP_HOST": self.headers.get("Host", self.cfg.router_host),
            "CONTENT_TYPE": self.headers.get("Content-Type", ""),
            "CONTENT_LENGTH": str(len(body)),
            "HTTPS": "",
        }

        for name, value in self.headers.items():
            key = "HTTP_" + name.upper().replace("-", "_")
            if key not in {"HTTP_CONTENT_TYPE", "HTTP_CONTENT_LENGTH", "HTTP_HOST"}:
                env[key] = value

        try:
            raw, fcgi_stderr = fastcgi_request(
                self.cfg.fcgi_host,
                self.cfg.fcgi_port,
                env,
                body,
                self.cfg.fcgi_timeout,
            )
        except Exception as exc:  # evidence first: expose transport failure, not fake API data
            payload = f"FastCGI transport error: {exc}\n".encode()
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            if not head_only:
                self.wfile.write(payload)
            return

        if fcgi_stderr:
            sys.stderr.write("[compat-frontdoor] fcgi stderr: " + fcgi_stderr.decode("utf-8", "replace") + "\n")

        status, headers, payload = parse_cgi_response(raw)
        self.send_response(status)
        have_length = False
        for name, value in headers:
            if name.lower() == "content-length":
                have_length = True
            self.send_header(name, value)
        if not have_length:
            self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if not head_only:
            self.wfile.write(payload)

    def _static(self, url_path: str, head_only: bool) -> None:
        decoded = urllib.parse.unquote(url_path)
        relative = decoded.lstrip("/") or "index.html"
        root = self.cfg.www_root.resolve()
        candidate = (root / relative).resolve()

        try:
            candidate.relative_to(root)
        except ValueError:
            self.send_error(403)
            return

        if candidate.is_dir():
            candidate = candidate / "index.html"
        if not candidate.is_file():
            self.send_error(404)
            return

        data = candidate.read_bytes()
        mime = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        if not head_only:
            self.wfile.write(data)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rootfs", type=Path, required=True)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18090)
    parser.add_argument("--fcgi-host", default="127.0.0.1")
    parser.add_argument("--fcgi-port", type=int, default=8920)
    parser.add_argument("--fcgi-timeout", type=float, default=8.0)
    parser.add_argument("--router-ip", default="192.168.31.1")
    parser.add_argument("--router-host", default="router.miwifi.com")
    parser.add_argument("--client-ip", default="192.168.31.100")
    parser.add_argument("--max-body", type=int, default=64 * 1024 * 1024)
    args = parser.parse_args()

    args.rootfs = args.rootfs.resolve()
    args.www_root = args.rootfs / "www"
    if not (args.www_root / "cgi-bin" / "luci").exists():
        parser.error(f"stock LuCI not found under {args.www_root}")

    server = ThreadingHTTPServer((args.bind, args.port), RouterLabHandler)
    server.cfg = args  # type: ignore[attr-defined]
    print(
        f"[compat-frontdoor] http://{args.bind}:{args.port} -> "
        f"stock /www + FastCGI {args.fcgi_host}:{args.fcgi_port}",
        flush=True,
    )
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
