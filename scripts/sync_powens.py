#!/usr/bin/env python3
"""Export new Powens transactions to the dashboard CSV directory."""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
STATE_PATH = DATA_DIR / ".powens-state.json"


def api_get(domain: str, token: str, path: str, params: dict[str, object] | None = None) -> dict:
    query = f"?{urlencode(params)}" if params else ""
    request = Request(
        f"https://{domain}.biapi.pro/2.0{path}{query}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def load_state() -> set[str]:
    if not STATE_PATH.exists():
        return set()
    payload = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    return {str(value) for value in payload.get("transaction_ids", [])}


def save_state(transaction_ids: set[str]) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    STATE_PATH.write_text(
        json.dumps({"transaction_ids": sorted(transaction_ids)}, indent=2) + "\n",
        encoding="utf-8",
    )


def list_transactions(domain: str, token: str, days: int) -> list[dict]:
    start_date = date.today() - timedelta(days=days)
    transactions: list[dict] = []
    offset = 0
    limit = 100
    while True:
        payload = api_get(
            domain,
            token,
            "/users/me/transactions",
            {"limit": limit, "offset": offset, "min_date": start_date.isoformat()},
        )
        batch = payload.get("transactions", [])
        transactions.extend(batch)
        if len(batch) < limit:
            return transactions
        offset += limit


def export_transactions(transactions: list[dict], known_ids: set[str]) -> int:
    new_transactions = [transaction for transaction in transactions if str(transaction.get("id")) not in known_ids]
    if not new_transactions:
        return 0

    DATA_DIR.mkdir(exist_ok=True)
    output_path = DATA_DIR / f"powens_{date.today().isoformat()}.csv"
    if output_path.exists():
        output_path = DATA_DIR / f"powens_{date.today().isoformat()}_{len(list(DATA_DIR.glob('powens_*.csv')))}.csv"
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter=";")
        writer.writerow(("Date", "Libellé", "Montant", "Source"))
        for transaction in new_transactions:
            writer.writerow((
                transaction.get("date") or transaction.get("rdate") or "",
                transaction.get("wording") or transaction.get("original_wording") or "Opération CMB",
                transaction.get("value", 0),
                "CMB via Powens",
            ))
    return len(new_transactions)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=90, help="Nombre de jours à récupérer (défaut : 90)")
    args = parser.parse_args()

    domain = os.environ.get("POWENS_DOMAIN")
    token = os.environ.get("POWENS_USER_TOKEN")
    if not domain or not token:
        print("Définissez POWENS_DOMAIN et POWENS_USER_TOKEN avant de lancer la synchronisation.", file=sys.stderr)
        return 2

    try:
        transactions = list_transactions(domain, token, args.days)
        known_ids = load_state()
        exported_count = export_transactions(transactions, known_ids)
        save_state(known_ids | {str(transaction.get("id")) for transaction in transactions})
    except Exception as error:
        print(f"Synchronisation Powens impossible : {error}", file=sys.stderr)
        return 1

    print(f"{exported_count} nouvelle(s) opération(s) exportée(s) dans {DATA_DIR}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())