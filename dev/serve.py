"""
Tiny dev server for previewing the Ventis web UI in a browser.

Runs on port 8000 by default. Visit http://localhost:8000/?mock=1 — the index.html
loads against the mock JSON files in this directory.

Mocks the ESP32's POST endpoints so the dev HTML can be bit-identical to the
firmware's INDEX_HTML (no JS divergence to maintain):
    POST /insight  -> returns mock-insight.json
    POST /control  -> returns {"ok": true}
GET requests pass through to static files (mock-data.json, mock-history.json, etc.)

Run:
    python serve.py            # defaults to port 8000
    python serve.py 8080       # custom port
"""

import http.server
import socketserver
import json
import sys
from pathlib import Path

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
HERE = Path(__file__).parent


class MockHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def do_POST(self):
        if self.path.startswith("/insight"):
            body = (HERE / "mock-insight.json").read_bytes()
            self._send_json(body)
        elif self.path.startswith("/control"):
            self._send_json(b'{"ok":true}')
        else:
            self.send_error(404, "POST endpoint not mocked")

    def _send_json(self, body):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # Quieter log lines than the default
        print(f"  {self.command} {self.path}")


if __name__ == "__main__":
    print(f"Serving Ventis dev UI at http://localhost:{PORT}/?mock=1")
    print(f"  (root: {HERE})")
    print("  Ctrl+C to stop")
    with socketserver.TCPServer(("", PORT), MockHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
