#!/usr/bin/env python3
"""Local dashboard server that exposes CSV files from the data directory."""

from __future__ import annotations

import json
import csv
import re
import shutil
import sqlite3
import unicodedata
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
IMPORTED_DIR = ROOT / "imported_files"
DATABASE_PATH = ROOT / "reference.sqlite3"


HEADER_ALIASES = {
    "date": ("date", "date operation", "date d operation", "date comptable"),
    "label": ("libelle", "operation", "description", "intitule", "designation"),
    "amount": ("montant", "amount", "valeur"),
    "debit": ("debit", "retrait", "depense"),
    "credit": ("credit", "versement", "recette"),
    "category": ("categorie", "category"),
    "source": ("source", "fichier"),
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


def parse_amount(value: str) -> float:
    cleaned = str(value or "").replace("\u00a0", " ").replace(" ", "")
    cleaned = cleaned.replace("EUR", "").replace("€", "").replace(",", ".")
    cleaned = re.sub(r"[^0-9.+-]", "", cleaned)
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def parse_date(value: str) -> str | None:
    text = str(value or "").strip()
    for pattern, date_format in ((r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", "%d/%m/%Y"),
                                (r"^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$", "%d.%m.%Y"),
                                (r"^(\d{4})-(\d{1,2})-(\d{1,2})$", "%Y-%m-%d")):
        if re.match(pattern, text):
            from datetime import datetime
            parsed = datetime.strptime(text, date_format.replace("%Y", "%Y"))
            return parsed.strftime("%Y-%m-%d")
    return text or None


def initialize_database() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_file TEXT NOT NULL,
            source_row INTEGER NOT NULL,
            date TEXT,
            label TEXT NOT NULL,
            amount REAL NOT NULL,
            category TEXT NOT NULL,
            type TEXT NOT NULL,
            source TEXT,
            UNIQUE(source_file, source_row)
        )
    """)
    connection.execute("""
        CREATE TABLE IF NOT EXISTS imports (
            source_file TEXT PRIMARY KEY,
            imported_at TEXT NOT NULL
        )
    """)
    connection.commit()
    return connection


def import_pending_files(connection: sqlite3.Connection) -> int:
    DATA_DIR.mkdir(exist_ok=True)
    IMPORTED_DIR.mkdir(exist_ok=True)
    imported_count = 0
    rules_path = ROOT / "categories.json"
    rules = json.loads(rules_path.read_text(encoding="utf-8")) if rules_path.exists() else []

    for path in sorted(DATA_DIR.glob("*.csv")):
        if connection.execute("SELECT 1 FROM imports WHERE source_file = ?", (path.name,)).fetchone():
            continue
        headers, rows, _dialect = read_csv(path)
        date_header = find_header(headers, "date")
        label_header = find_header(headers, "label")
        amount_header = find_header(headers, "amount")
        debit_header = find_header(headers, "debit")
        credit_header = find_header(headers, "credit")
        category_header = find_header(headers, "category")
        source_header = find_header(headers, "source")
        if not label_header or not (amount_header or debit_header or credit_header):
            raise ValueError(f"{path.name}: colonnes attendues Date, Libellé, Montant ou Débit/Crédit")

        for row_number, row in enumerate(rows, start=2):
            label = str(row.get(label_header, "")).strip().replace("\n", " ")
            amount = parse_amount(row.get(amount_header, "")) if amount_header else parse_amount(row.get(credit_header, "")) - parse_amount(row.get(debit_header, ""))
            if not label or amount == 0:
                continue
            normalized_label = normalize(label)
            matching_rule = next((rule for rule in rules if any(normalize(needle) in normalized_label for needle in rule.get("match", []))), None)
            category = str(row.get(category_header, "")).strip() if category_header else ""
            category = category or (matching_rule or {}).get("category", "Divers")
            transaction_type = (matching_rule or {}).get("type") or ("Recettes" if amount >= 0 else "Dépenses")
            source = str(row.get(source_header, "")).strip() if source_header else path.name
            connection.execute("""
                INSERT INTO transactions(source_file, source_row, date, label, amount, category, type, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (path.name, row_number, parse_date(row.get(date_header, "")) if date_header else None, label, amount, category, transaction_type, source))

        connection.execute("INSERT INTO imports(source_file, imported_at) VALUES (?, datetime('now'))", (path.name,))
        connection.commit()
        shutil.move(str(path), str(IMPORTED_DIR / path.name))
        imported_count += 1
    return imported_count


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/csv-files":
            self.send_csv_file_list()
            return
        if parsed.path == "/api/transactions":
            self.send_transactions()
            return
        super().do_GET()

    def do_PATCH(self) -> None:
        parsed = urlparse(self.path)
        transaction_match = re.match(r"^/api/transactions/(\d+)$", parsed.path)
        if transaction_match:
            self.update_transaction(int(transaction_match.group(1)))
            return
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

    def send_transactions(self) -> None:
        connection = initialize_database()
        try:
            import_pending_files(connection)
            rows = connection.execute("SELECT id, date, label, amount, category, type, source, source_file, source_row FROM transactions ORDER BY date DESC, id DESC").fetchall()
            self.send_json(200, {"transactions": [dict(row) for row in rows]})
        finally:
            connection.close()

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

    def update_transaction(self, transaction_id: int) -> None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            label = str(payload.get("label", "")).strip()
            category = str(payload.get("category", "")).strip()
            if not label or not category:
                self.send_json(400, {"error": "Label and category are required"})
                return
            connection = initialize_database()
            try:
                cursor = connection.execute("UPDATE transactions SET label = ?, category = ? WHERE id = ?", (label, category, transaction_id))
                connection.commit()
            finally:
                connection.close()
            if cursor.rowcount == 0:
                self.send_json(404, {"error": "Transaction not found"})
                return
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