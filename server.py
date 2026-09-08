#!/usr/bin/env python3
"""Local dashboard server that exposes CSV files from the data directory."""

from __future__ import annotations

import json
import csv
import re
import unicodedata
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"


HEADER_ALIASES = {
    "label": ("libelle", "operation", "description", "intitule", "designation"),
    "category": ("categorie", "category"),
}


def normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.strip().lower())
    ascii_value = "".join(char for char in decomposed if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", ascii_value).strip()


def find_header(headers: list[str], logical_name: str) -> str | None:
    normalized_headers = {normalize(header): header for header in headers}
    for alias in HEADER_ALIASES[logical_name]:
        header = normalized_headers.get(normalize(alias))
        if header:
            return header
    return None


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]], csv.Dialect]:
    for encoding in ("utf-8-sig", "cp1252", "iso-8859-1"):
        try:
            content = path.read_text(encoding=encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError(f"Unable to decode {path.name}")

    dialect = csv.Sniffer().sniff(content[:4096], delimiters=";,\t,")
    reader = csv.DictReader(content.splitlines(), dialect=dialect)
    if not reader.fieldnames:
        raise ValueError(f"{path.name} has no header row")
    return reader.fieldnames, list(reader), dialect


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/csv-files":
            self.send_csv_file_list()
            return
        super().do_GET()

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        match = re.match(r"^/api/csv-files/([^/]+)/rows/(\d+)$", parsed.path)
        if not match:
            self.send_error(404)
            return
        self.update_csv_row(unquote(match.group(1)), int(match.group(2)))

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

    def send_json(self, status: int, data: dict[str, object]) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def update_csv_row(self, file_name: str, row_number: int) -> None:
        try:
            path = (DATA_DIR / Path(file_name).name).resolve()
            path.relative_to(DATA_DIR.resolve())
            if path.suffix.lower() != ".csv" or not path.exists():
                self.send_json(404, {"error": "CSV file not found"})
                return

            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            label = str(payload.get("label", "")).strip()
            category = str(payload.get("category", "")).strip()
            if not label or not category:
                self.send_json(400, {"error": "Label and category are required"})
                return

            headers, rows, dialect = read_csv(path)
            data_index = row_number - 2
            if data_index < 0 or data_index >= len(rows):
                self.send_json(404, {"error": "CSV row not found"})
                return

            label_header = find_header(headers, "label")
            if not label_header:
                self.send_json(400, {"error": "CSV has no editable label column"})
                return

            category_header = find_header(headers, "category")
            if not category_header:
                category_header = "Catégorie"
                headers.append(category_header)
                for row in rows:
                    row[category_header] = ""

            rows[data_index][label_header] = label
            rows[data_index][category_header] = category

            with path.open("w", encoding="utf-8-sig", newline="") as csv_file:
                writer = csv.DictWriter(csv_file, fieldnames=headers, delimiter=dialect.delimiter)
                writer.writeheader()
                writer.writerows(rows)

            self.send_json(200, {"ok": True})
        except Exception as error:
            self.send_json(500, {"error": str(error)})

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