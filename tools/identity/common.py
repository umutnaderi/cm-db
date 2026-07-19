"""Shared helpers for the persistent Retroball identity registry."""

from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import sqlite3
import tempfile
import unicodedata
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DB = ROOT / "db" / "retroball.sqlite"
REGISTRY_DB = ROOT / "identity" / "retroball_identity.sqlite"
SCHEMA_PATH = Path(__file__).with_name("schema.sql")
ALIAS_PATH = ROOT / "config" / "identity" / "nation_aliases.csv"
AUDIT_DIR = ROOT / "audit" / "identity"


def normalize_name(value: Any) -> str:
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(character for character in text if not unicodedata.combining(character))
    text = text.casefold().replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def slug_part(value: str) -> str:
    return normalize_name(value).replace(" ", "_") or "unknown"


def source_connection(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        raise FileNotFoundError(f"Source database not found: {path}")
    connection = sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


def registry_connection(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 30000")
    return connection


def table_columns(connection: sqlite3.Connection, table: str) -> list[str]:
    # PRAGMA inspection is deliberately used because generated source schemas may evolve.
    rows = list(connection.execute(f'PRAGMA table_info("{table}")'))
    if not rows:
        raise RuntimeError(f"Required source table is missing: {table}")
    return [str(row["name"]) for row in rows]


def choose_column(columns: Iterable[str], candidates: tuple[str, ...], label: str) -> str:
    available = set(columns)
    for candidate in candidates:
        if candidate in available:
            return candidate
    raise RuntimeError(f"Cannot identify {label}; source columns: {', '.join(sorted(available))}")


def json_value(value: Any) -> Any:
    if isinstance(value, bytes):
        return {"encoding": "hex", "value": value.hex()}
    return value


def stable_json(row: dict[str, Any]) -> str:
    return json.dumps(
        {key: json_value(value) for key, value in row.items()},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def atomic_csv(path: Path, fieldnames: list[str], rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, text=True
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
        raise


def load_alias_rules(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        raise FileNotFoundError(f"Nation alias configuration not found: {path}")
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    required = {"action", "source_name", "canonical_name", "public_id", "historical", "notes"}
    if not rows and path.stat().st_size == 0:
        raise RuntimeError(f"Nation alias configuration is empty: {path}")
    actual = set(rows[0]) if rows else set()
    if required - actual:
        raise RuntimeError(f"Alias CSV missing columns: {', '.join(sorted(required - actual))}")
    valid_actions = {"link", "create_new", "keep_separate", "reject_candidate"}
    seen: set[str] = set()
    for line_number, row in enumerate(rows, start=2):
        row.update({key: (value or "").strip() for key, value in row.items()})
        if row["action"] not in valid_actions:
            raise RuntimeError(f"Invalid action on alias CSV line {line_number}: {row['action']}")
        source_normalized = normalize_name(row["source_name"])
        if row["action"] != "create_new" and not source_normalized:
            raise RuntimeError(f"Missing source_name on alias CSV line {line_number}")
        if row["action"] in {"link", "create_new"} and not row["canonical_name"]:
            raise RuntimeError(f"Missing canonical_name on alias CSV line {line_number}")
        if source_normalized and source_normalized in seen:
            raise RuntimeError(f"Duplicate normalized source_name on alias CSV line {line_number}")
        seen.add(source_normalized)
    return rows
