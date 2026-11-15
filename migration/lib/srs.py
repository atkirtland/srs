"""Anki snapshot and migration helpers.

Persistent identity utilities are shared from tools/srs_tools/core.py.
"""
from __future__ import annotations

import base64
import json
import re
import sqlite3
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import _shared
from srs_tools.core import SRSError, canonical, digest, note_uid, card_uid, seed_csv_uids, write_immutable
from configuration import parse_json

VERSION = 1
KEY = re.compile(r"^[a-z][a-z0-9_-]*$")
TOKEN = re.compile(r"{{([#/^]?)([A-Za-z_][A-Za-z_0-9]*)}}")
ROOT = Path(__file__).resolve().parents[1]


def raw_value(value: Any) -> Any:
    if isinstance(value, bytes):
        return {"base64": base64.b64encode(value).decode("ascii")}
    return value


def validate_template(text: str, fields: set[str]) -> None:
    if not isinstance(text, str):
        raise SRSError("front/back must be strings")
    stack: list[str] = []
    for match in TOKEN.finditer(text):
        marker, name = match.groups()
        if name not in fields:
            raise SRSError(f"unknown template field: {name}")
        if marker in {"#", "^"}:
            stack.append(name)
        elif marker == "/" and (not stack or stack.pop() != name):
            raise SRSError(f"unbalanced template section: {name}")
    if stack or "{{" in TOKEN.sub("", text) or "}}" in TOKEN.sub("", text):
        raise SRSError("unbalanced or unsupported template syntax")


def load_config(path: Path, exports: dict[str, Any]) -> dict[str, Any]:
    config = parse_json(path.read_text(encoding="utf-8"), str(path))
    if not isinstance(config, dict) or config.get("format_version") != VERSION or not isinstance(config.get("groups"), dict):
        raise SRSError("unsupported SRS configuration")
    scheduler = config.get("scheduler", {})
    if not isinstance(scheduler, dict):
        raise SRSError("scheduler must be an object")
    if scheduler.get("algorithm") != "FSRS-6" or scheduler.get("enable_fuzz") is not False:
        raise SRSError("pilot requires FSRS-6 with fuzz disabled")
    retention = scheduler.get("desired_retention")
    maximum = scheduler.get("maximum_interval")
    limit = scheduler.get("new_cards_per_day")
    if isinstance(retention, bool) or not isinstance(retention, (int, float)) or not 0 < retention < 1:
        raise SRSError("desired_retention must be between zero and one")
    if type(maximum) is not int or not 1 <= maximum <= 36500:
        raise SRSError("maximum_interval must be an integer from 1 to 36500")
    if type(limit) is not int or limit < 0:
        raise SRSError("new_cards_per_day must be a nonnegative integer")
    for name, group in config["groups"].items():
        if (name not in exports and name != "markdown-blocks") or not isinstance(group, dict) or not isinstance(group.get("templates"), list):
            raise SRSError(f"invalid source group: {name}")
        fields = {field.anki for field in exports[name].fields} if name in exports else {"Front", "Back"}
        keys: set[str] = set()
        mappings: set[tuple[str, int]] = set()
        for template in group["templates"]:
            if not isinstance(template, dict):
                raise SRSError(f"template must be an object: {name}")
            key = template.get("key", "")
            ordinal = template.get("anki_ordinal")
            model = template.get("anki_notetype")
            if not isinstance(key, str) or not KEY.fullmatch(key) or key in keys:
                raise SRSError(f"duplicate or invalid template key: {key}")
            if type(ordinal) is not int or ordinal < 0 or not isinstance(model, str) or not model:
                raise SRSError(f"invalid Anki mapping: {key}")
            if (model, ordinal) in mappings:
                raise SRSError(f"ambiguous Anki ordinal: {name}/{ordinal}")
            if type(template.get("enabled")) is not bool:
                raise SRSError(f"enabled must be boolean: {key}")
            required = template.get("required_fields")
            if not isinstance(required, list) or any(not isinstance(f, str) or f not in fields for f in required):
                raise SRSError(f"invalid required_fields: {key}")
            if any(not isinstance(template.get(side), str) for side in ("front", "back")):
                raise SRSError(f"front/back must be strings: {key}")
            # Syntax errors are local card errors, so all other decks remain usable.
            keys.add(key)
            mappings.add((model, ordinal))
    return config


def read_snapshot(path: Path) -> dict[str, Any]:
    path = path.resolve()
    if not path.exists():
        raise SRSError(f"collection file not found: {path}")
    if not path.is_file():
        raise SRSError(f"collection path is not a file: {path}")
    wal = Path(str(path) + "-wal")
    if wal.exists() and wal.stat().st_size > 0:
        raise SRSError(f"collection has pending WAL data: {wal}; close Anki and copy "
                       "the collection into a separate standalone SQLite snapshot")
    # Only standalone, unchanging snapshots are supported. immutable avoids
    # creating empty WAL/SHM files when the copied database uses WAL mode.
    connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        # Anki declares this custom collation in its modern schema. Register it
        # before preparing reads, including WITHOUT ROWID tables. We only scan
        # raw rows: no sorting/filtering or reliance on Anki's index ordering.
        # Python casefold is a fallback, not a reimplementation of Anki's
        # version-pinned Unicode comparator; force table scans below.
        def unicase(left: str, right: str) -> int:
            left, right = left.casefold(), right.casefold()
            return (left > right) - (left < right)

        connection.create_collation("unicase", unicase)
        connection.execute("BEGIN")
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"col", "notes", "cards", "revlog"} <= tables:
            raise SRSError("snapshot is missing Anki collection tables")
        raw = {}
        for table in ("col", "notes", "cards", "revlog", "notetypes", "fields", "templates", "decks", "deck_config", "config", "graves"):
            if table in tables:
                raw[table] = [{key: raw_value(row[key]) for key in row.keys()}
                              for row in connection.execute(f'SELECT * FROM "{table}" NOT INDEXED')]
        if len(raw["col"]) != 1 or "crt" not in raw["col"][0]:
            raise SRSError("snapshot must contain one Anki collection record")
        return raw
    finally:
        connection.close()


def models_from_snapshot(raw: dict[str, Any]) -> dict[int, dict[str, Any]]:
    """Read old JSON and current normalized metadata without decoding protobuf."""
    col = raw["col"][0]
    old = json.loads(col.get("models") or "{}")
    models = {int(key): value for key, value in old.items()}
    for model in raw.get("notetypes", []):
        mid = model["id"]
        models[mid] = {
            "id": mid, "name": model["name"],
            "flds": sorted([f for f in raw.get("fields", []) if f["ntid"] == mid], key=lambda f: f["ord"]),
            "tmpls": sorted([dict(t, **template_formats(t.get("config"))) for t in raw.get("templates", []) if t["ntid"] == mid], key=lambda t: t["ord"]),
        }
    return models


def template_formats(config: Any) -> dict[str, str]:
    """Extract Template.Config q/a strings; retain the complete protobuf in raw.

    Field numbers follow Anki's proto/anki/notetypes.proto. Unknown scalar and
    length-delimited fields are skipped, so newer metadata stays lossless.
    """
    if not isinstance(config, dict) or "base64" not in config:
        return {}
    data = base64.b64decode(config["base64"])
    position = 0

    def varint() -> int:
        nonlocal position
        result = 0
        for shift in range(0, 70, 7):
            if position >= len(data):
                raise SRSError("truncated template protobuf")
            byte = data[position]
            position += 1
            result |= (byte & 127) << shift
            if byte < 128:
                return result
        raise SRSError("invalid template protobuf varint")

    result = {}
    while position < len(data):
        tag = varint()
        number, wire = tag >> 3, tag & 7
        if wire == 0:
            varint()
            continue
        if wire not in {1, 2, 5}:
            raise SRSError("unsupported template protobuf wire type")
        size = varint() if wire == 2 else 8 if wire == 1 else 4
        value = data[position:position + size]
        if len(value) != size:
            raise SRSError("truncated template protobuf field")
        position += size
        if wire == 2 and number in {1, 2}:
            result["qfmt" if number == 1 else "afmt"] = value.decode("utf-8")
    return result


def normalize_due(card: dict[str, Any], day_zero: date, zone: ZoneInfo, rollover: int) -> int | None:
    queue = card["queue"]
    due = card["due"]
    if card.get("odid") or queue not in {0, 1, 2, 3, 4}:
        return None
    if queue == 0:
        return None  # New-card order, not a date.
    if queue in {1, 4}:
        return due * 1000  # Learning timestamp in seconds.
    local = datetime.combine(day_zero + timedelta(days=due), time(rollover), zone)
    return int(local.timestamp() * 1000)


def interval(value: int) -> dict[str, Any]:
    return {"value": abs(value), "unit": "seconds" if value < 0 else "days"}


# Version 2 catalog stores no retained Anki note content.
from catalog import build_export, publish, generate_templates, partition_paths
