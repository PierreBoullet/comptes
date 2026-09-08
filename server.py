#!/usr/bin/env python3
"""Local dashboard server that exposes CSV files from the data directory."""

from __future__ import annotations

import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/csv-files":
            self.send_csv_file_list()
            return
        super().do_GET()

    def send_csv_file_list(self) -> None:
        DATA_DIR.mkdir(exist_ok=True)
        files = [
            {
                "name": path.name,
                "url": f"/data/{path.name}",
                "size": path.stat().st_size,
            }
            for path in sorted(DATA_DIR.glob("*.csv"))
            if path.is_file()
        ]
        payload = json.dumps(files, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def translate_path(self, path: str) -> str:
        parsed_path = unquote(urlparse(path).path)
        resolved = Path(super().translate_path(parsed_path)).resolve()
        try:
            resolved.relative_to(ROOT)
        except ValueError:
            return str(ROOT / "dashboard.html")
        return str(resolved)


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", 8765), DashboardHandler)
    print("Dashboard available at http://localhost:8765/dashboard.html")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())