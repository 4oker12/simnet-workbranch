#!/usr/bin/env python3
"""RouterLab synthetic bootstrap target for Cudy WR1200.

Scope: model only the first-run management-plane contract needed by RouterLab.
This is deliberately NOT presented as the vendor firmware or vendor HTTP API.
"""

from __future__ import annotations

import argparse
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs


DEFAULT_STATE = {
    "schema": 1,
    "target": {
        "vendor": "Cudy",
        "model": "WR1200",
        "hardware_revision": "V2",
        "fidelity": "synthetic-bootstrap",
    },
    "configured": False,
    "bootstrap_stage": "factory",
    "wan": {"type": None},
    "wifi": {"action": "unchanged"},
}


class RouterState:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.Lock()
        self._state = self._load()

    def _factory(self):
        return json.loads(json.dumps(DEFAULT_STATE))

    def _load(self):
        if not self.path.exists():
            return self._factory()
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return self._factory()
        if not isinstance(data, dict) or data.get("schema") != 1:
            return self._factory()
        return data

    def _persist(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(self._state, indent=2, sort_keys=True), encoding="utf-8")
        tmp.replace(self.path)

    def snapshot(self):
        with self._lock:
            return json.loads(json.dumps(self._state))

    def apply_bootstrap(self, payload):
        wan_type = str(payload.get("wanType", "")).lower()
        wifi_action = str(payload.get("wifiAction", "keep")).lower()
        if wan_type != "dhcp":
            raise ValueError("bootstrap milestone currently supports wanType=dhcp only")
        if wifi_action not in {"keep", "unchanged"}:
            raise ValueError("bootstrap milestone currently keeps Wi-Fi unchanged")

        with self._lock:
            self._state["configured"] = True
            self._state["bootstrap_stage"] = "configured"
            self._state["wan"] = {"type": "dhcp"}
            self._state["wifi"] = {"action": "unchanged"}
            self._persist()
            return json.loads(json.dumps(self._state))

    def reset(self):
        with self._lock:
            self._state = self._factory()
            if self.path.exists():
                self.path.unlink()
            return json.loads(json.dumps(self._state))


INDEX_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>RouterLab · Cudy WR1200 Bootstrap</title>
<style>
:root { font-family: Inter, Segoe UI, Arial, sans-serif; color: #18202a; background: #f3f6f8; }
body { margin: 0; }
main { max-width: 760px; margin: 48px auto; padding: 0 20px; }
.card { background: white; border: 1px solid #dfe5ea; border-radius: 14px; padding: 24px; box-shadow: 0 8px 30px rgba(20,30,40,.06); }
h1 { margin: 0 0 8px; font-size: 26px; }
.muted { color: #687583; }
.badge { display:inline-block; padding:4px 9px; border-radius:999px; background:#eef2f5; font-size:12px; }
.row { display:flex; gap:12px; flex-wrap:wrap; margin:18px 0; }
.step { border-left:3px solid #d7dee5; padding:8px 14px; margin:10px 0; }
button { border:0; border-radius:9px; padding:11px 16px; cursor:pointer; font-weight:600; }
.primary { background:#232d37; color:white; }
.secondary { background:#e9eef2; color:#18202a; }
pre { background:#f6f8fa; border-radius:9px; padding:14px; overflow:auto; font-size:12px; }
.ok { color:#0b6b3a; font-weight:700; }
</style>
</head>
<body>
<main>
  <div class="card">
    <span class="badge">synthetic bootstrap target</span>
    <h1>Cudy WR1200 · RouterLab</h1>
    <p class="muted">This lab models the first-run workflow. It does not claim to reproduce Cudy firmware, radio hardware or the vendor HTTP API.</p>

    <section id="factory">
      <div class="step"><b>1. Internet connection</b><br><span class="muted">WAN type: Dynamic IP (DHCP)</span></div>
      <div class="step"><b>2. Wireless</b><br><span class="muted">Keep current/default Wi-Fi values for this milestone</span></div>
      <div class="step"><b>3. Apply</b><br><span class="muted">Persist configured state</span></div>
      <div class="row"><button class="primary" onclick="applyBootstrap()">Apply DHCP bootstrap</button></div>
    </section>

    <section id="configured" hidden>
      <p class="ok">Bootstrap complete.</p>
      <p>WAN is configured as DHCP. RouterLab state survives a process restart.</p>
      <div class="row"><button class="secondary" onclick="resetLab()">Factory reset</button></div>
    </section>

    <h3>Evidence</h3>
    <pre id="state">loading…</pre>
  </div>
</main>
<script>
async function loadState() {
  const r = await fetch('/api/state');
  const s = await r.json();
  document.getElementById('state').textContent = JSON.stringify(s, null, 2);
  document.getElementById('factory').hidden = !!s.configured;
  document.getElementById('configured').hidden = !s.configured;
}
async function applyBootstrap() {
  const r = await fetch('/api/bootstrap', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({wanType:'dhcp', wifiAction:'keep'})
  });
  if (!r.ok) alert((await r.json()).error || 'bootstrap failed');
  await loadState();
}
async function resetLab() {
  await fetch('/api/reset', {method:'POST'});
  await loadState();
}
loadState();
</script>
</body>
</html>
"""


def _payload(handler):
    length = int(handler.headers.get("Content-Length", "0") or "0")
    raw = handler.rfile.read(length) if length else b""
    ctype = handler.headers.get("Content-Type", "")
    if "application/json" in ctype:
        return json.loads(raw.decode("utf-8") or "{}")
    parsed = parse_qs(raw.decode("utf-8"))
    return {key: values[-1] for key, values in parsed.items()}


def make_handler(state):
    class Handler(BaseHTTPRequestHandler):
        server_version = "RouterLabCudy/1"

        def log_message(self, fmt, *args):
            print("[cudy-wr1200] " + (fmt % args))

        def _json(self, status, value):
            body = json.dumps(value, indent=2).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/":
                body = INDEX_HTML.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if self.path == "/health":
                snap = state.snapshot()
                self._json(200, {
                    "ok": True,
                    "target": "Cudy WR1200",
                    "fidelity": "synthetic-bootstrap",
                    "configured": snap["configured"],
                })
                return
            if self.path == "/api/state":
                self._json(200, state.snapshot())
                return
            self._json(404, {"error": "not found"})

        def do_POST(self):
            try:
                if self.path == "/api/bootstrap":
                    result = state.apply_bootstrap(_payload(self))
                    self._json(200, result)
                    return
                if self.path == "/api/reset":
                    self._json(200, state.reset())
                    return
                self._json(404, {"error": "not found"})
            except (ValueError, json.JSONDecodeError) as exc:
                self._json(400, {"error": str(exc)})

    return Handler


def build_server(host, port, state):
    return ThreadingHTTPServer((host, port), make_handler(state))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["serve", "dump", "reset"], nargs="?", default="serve")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18120)
    parser.add_argument("--state-file", default=str(Path.home() / ".routerlab" / "cudy-wr1200" / "state-v1.json"))
    args = parser.parse_args()

    state = RouterState(Path(args.state_file))
    if args.command == "dump":
        print(json.dumps(state.snapshot(), indent=2))
        return
    if args.command == "reset":
        print(json.dumps(state.reset(), indent=2))
        return

    server = build_server(args.host, args.port, state)
    print(f"[cudy-wr1200] listening on http://{args.host}:{server.server_address[1]}/", flush=True)
    print("[cudy-wr1200] fidelity=synthetic-bootstrap; no RF/PHY/vendor-API claim", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
