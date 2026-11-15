"""Stable identities and common JSON/CSV utilities shared with migration."""
from __future__ import annotations
import csv
import hashlib
import json
from pathlib import Path
from typing import Any
import uuid
from .configuration import parse_json

class SRSError(ValueError):
    pass

def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def note_uid(metadata: dict[str, Any]) -> str | None:
    value = str(metadata.get("anki_note_id", "")).strip()
    if value:
        if not value.isascii() or not value.isdecimal() or int(value) <= 0:
            raise SRSError(f"invalid anki_note_id: {value}")
        return f"anki:{int(value)}"
    value = str(metadata.get("srs_uid", "")).strip()
    return f"local:{uuid.UUID(value)}" if value else None


def card_uid(group: str, identity: str, template: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"ankobs:srs:{group}/{identity}/{template}"))


def seed_csv_uids(path: Path) -> int:
    """Persist identities for new CSV notes, preserving columns and row order."""
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        columns = reader.fieldnames
        rows = list(reader)
    if not columns or len(columns) != len(set(columns)) or any(None in row or None in row.values() for row in rows):
        raise SRSError("invalid CSV header or row width")
    count = 0
    for row in rows:
        if not note_uid(row):
            row["srs_uid"] = str(uuid.uuid4())
            count += 1
    if count:
        if "srs_uid" not in columns:
            columns.append("srs_uid")
        temporary = path.with_name(path.name + ".srs-tmp")
        with temporary.open("x", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=columns)
            writer.writeheader()
            writer.writerows(rows)
        temporary.replace(path)
    return count


def write_immutable(path: Path, value: Any) -> None:
    content = canonical(value) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("x", encoding="utf-8") as stream:
            stream.write(content)
    except FileExistsError:
        if path.read_text(encoding="utf-8") != content:
            raise SRSError(f"immutable artifact differs: {path}")


