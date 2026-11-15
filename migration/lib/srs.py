"""Lossless Anki snapshot export and portable SRS card configuration.

This module never opens a live Anki collection for writing. Archives are content
addressed; only the desktop publishing command updates the manifest pointer.
"""
from __future__ import annotations

import base64
import csv
import hashlib
import json
import re
import sqlite3
import uuid
from collections import Counter
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from configuration import parse_json

VERSION = 1
KEY = re.compile(r"^[a-z][a-z0-9_-]*$")
TOKEN = re.compile(r"{{([#/^]?)([A-Za-z_][A-Za-z_0-9]*)}}")
ROOT = Path(__file__).resolve().parents[1]


class SRSError(ValueError):
    pass


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


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
        if name not in exports or not isinstance(group, dict) or not isinstance(group.get("templates"), list):
            raise SRSError(f"invalid source group: {name}")
        fields = {field.anki for field in exports[name].fields}
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
            validate_template(template.get("front"), fields)
            validate_template(template.get("back"), fields)
            keys.add(key)
            mappings.add((model, ordinal))
    return config


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
    if card.get("odid") or queue not in {0, 1, 2, 3}:
        return None
    if queue == 0:
        return None  # New-card order, not a date.
    if queue == 1:
        return due * 1000  # Learning timestamp in seconds.
    local = datetime.combine(day_zero + timedelta(days=due), time(rollover), zone)
    return int(local.timestamp() * 1000)


def interval(value: int) -> dict[str, Any]:
    return {"value": abs(value), "unit": "seconds" if value < 0 else "days"}


def build_export(raw: dict[str, Any], vault: Path, exports: dict[str, Any], config: dict[str, Any],
                 day_zero: date, timezone_name: str, rollover: int = 4) -> dict[str, Any]:
    import audit
    import sources

    zone = ZoneInfo(timezone_name)
    owners, issues = audit.collect_local(vault)
    issues = [item for item in issues if item["kind"] != "missing-local-id"]
    ownership = Counter(owner["note_id"] for owner in owners)
    for nid, count in ownership.items():
        if count > 1:
            issues.append({"kind": "duplicate-local-id", "note_id": str(nid)})
    models = models_from_snapshot(raw)
    notes = {str(note["id"]): note for note in raw["notes"]}
    linked = {str(owner["note_id"]) for owner in owners}
    for nid in sorted(linked - notes.keys()):
        issues.append({"kind": "missing-anki-note", "note_id": nid})
    selected_notes = {nid: note for nid, note in notes.items() if nid in linked}
    selected_cards = {str(c["id"]): c for c in raw["cards"] if str(c["nid"]) in selected_notes}
    events: dict[str, list[dict[str, Any]]] = {cid: [] for cid in selected_cards}
    collection_key = str(raw["col"][0]["crt"])
    for review in sorted(raw["revlog"], key=lambda r: r["id"]):
        cid = str(review["cid"])
        if cid not in events:
            continue
        events[cid].append({
            "id": f"anki:{collection_key}:{review['id']}", "anki_card_id": cid,
            "review_time_ms": review["id"], "rating": review["ease"],
            "duration_ms": review["time"], "review_type": review["type"],
            "interval": interval(review["ivl"]), "previous_interval": interval(review["lastIvl"]),
            "raw": review,
        })
    generated: dict[tuple[str, int], dict[str, Any]] = {}
    local_cards: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for group, definition in config["groups"].items():
        export = exports[group]
        for note in sources.source_notes(vault, export):
            identity = note_uid(note.metadata)
            if not identity:
                issues.append({"kind": "missing-note-identity", "path": str(note.path)})
                continue
            if (group, identity) in seen:
                issues.append({"kind": "duplicate-group-note", "group": group, "identity": identity})
                continue
            seen.add((group, identity))
            # The pilot supports CSV text mappings; other groups remain archived.
            relative = str(note.path).split("#row-")[0]
            source = Path(relative).resolve().relative_to(vault.resolve()).as_posix()
            if not source.endswith(".csv") or any(f.transform.__name__ != "text" for f in export.fields):
                issues.append({"kind": "unsupported-review-source", "group": group})
                continue
            fields = {field.anki: field.transform(note.metadata.get(field.source), note) for field in export.fields}
            nid = identity.removeprefix("anki:") if identity.startswith("anki:") else None
            anki_note = notes.get(nid) if nid else None
            model = models.get(anki_note["mid"], {}) if anki_note else {}
            for template in definition["templates"]:
                card = {
                    "id": card_uid(group, identity, template["key"]), "group": group,
                    "note_uid": identity, "template_key": template["key"], "template": template,
                    "source": {"path": source, "kind": "csv", "field_map": {f.anki: f.source for f in export.fields}},
                    "fields": fields, "active": template["enabled"] and all(fields[f].strip() for f in template["required_fields"]),
                    "anki_notetype": template["anki_notetype"], "anki_ordinal": template["anki_ordinal"],
                    "supported": True,
                }
                if nid:
                    if model.get("name") != template["anki_notetype"]:
                        issues.append({"kind": "notetype-mismatch", "note_id": nid, "template": template["key"]})
                        continue
                    matching = [c for c in selected_cards.values() if str(c["nid"]) == nid and c["ord"] == template["anki_ordinal"]]
                    if len(matching) != 1 or (nid, template["anki_ordinal"]) in generated:
                        issues.append({"kind": "ambiguous-or-missing-card", "note_id": nid, "template": template["key"]})
                        continue
                    generated[(nid, template["anki_ordinal"])] = card
                else:
                    card.update(anki_card_id=None, raw=None, history=[], due_ms=None, queue=0, card_type=0)
                    local_cards.append(card)
    cards = []
    unsupported = []
    for cid, source in selected_cards.items():
        generated_card = generated.get((str(source["nid"]), source["ord"]))
        card = dict(generated_card or {"id": f"anki:{collection_key}:card:{cid}", "group": None, "active": False})
        due = normalize_due(source, day_zero, zone, rollover)
        has_answers = any(event["rating"] in {1, 2, 3, 4} and event["review_type"] in {0, 1, 2, 3} for event in events[cid])
        supported = (source["queue"] in {0, 1, 2, 3} and source["type"] in {0, 1, 2, 3}
                     and not source.get("odid") and (source["queue"] == 0 or has_answers))
        if not supported:
            unsupported.append(cid)
        card.update(anki_card_id=cid, raw=source, history=events[cid], due_ms=due,
                    queue=source["queue"], card_type=source["type"], supported=supported and generated_card is not None,
                    active=card["active"] and supported)
        cards.append(card)
    cards.extend(local_cards)
    selected_raw = {key: value for key, value in raw.items() if key not in {"notes", "cards", "revlog"}}
    selected_raw.update(notes=list(selected_notes.values()), cards=list(selected_cards.values()),
                        revlog=[event["raw"] for history in events.values() for event in history])
    # Duplicate ownership makes all activations unsafe, including across groups.
    if issues:
        for card in cards:
            card["active"] = False
            card["supported"] = False
    report = {
        "notes": len(selected_notes), "cards": len(selected_cards),
        "review_events": sum(map(len, events.values())), "active_cards": sum(c["active"] for c in cards),
        "unlinked_anki_notes": sorted(notes.keys() - linked), "unsupported_card_ids": unsupported,
        "issues": issues, "models": models,
    }
    return {"format_version": VERSION, "collection_key": collection_key,
            "timing": {"day_zero": day_zero.isoformat(), "timezone": timezone_name, "rollover_hour": rollover},
            "scheduler": config["scheduler"], "cards": cards, "raw": selected_raw, "report": report}


def write_immutable(path: Path, value: Any) -> None:
    content = canonical(value) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("x", encoding="utf-8") as stream:
            stream.write(content)
    except FileExistsError:
        if path.read_text(encoding="utf-8") != content:
            raise SRSError(f"immutable artifact differs: {path}")


def publish(data: dict[str, Any], destination: Path) -> Path:
    """Publish immutable partitions then atomically switch the desktop pointer."""
    # A configuration/content revision must not invalidate existing event IDs.
    import_id = digest({"raw": data["raw"], "timing": data["timing"]})
    previous = destination / "manifest.json"
    if previous.exists():
        manifest = json.loads(previous.read_text(encoding="utf-8"))
        if manifest.get("collection_key") != data["collection_key"]:
            raise SRSError("cannot mix Anki collections in one SRS directory")
        has_reviews = any((destination / "events").glob("*.json")) or any((destination / "reviews").glob("*.jsonl"))
        if has_reviews and manifest.get("import_id") != import_id:
            raise SRSError("reviews already exist: baseline replacement is blocked; keep the original import")
        old_cards = [card for partition in manifest["partitions"]
                     for card in json.loads((destination / partition).read_text(encoding="utf-8"))]
        new_ids = {card["id"] for card in data["cards"]}
        if has_reviews:
            old_bindings = {card["anki_card_id"]: card["id"] for card in old_cards if card.get("group") and card.get("anki_card_id")}
            for card in data["cards"]:
                previous_id = old_bindings.get(card.get("anki_card_id"))
                if card.get("group") and previous_id and previous_id != card["id"]:
                    raise SRSError("Anki card remapping would change a permanent template identity")
        # Removed templates remain addressable by their old events.
        for card in old_cards:
            if card["id"] in new_ids:
                continue
            previous_card = dict(card, active=False, supported=False)
            if "history_path" in card:
                histories = json.loads((destination / card["history_path"]).read_text(encoding="utf-8"))
                previous_card["history"] = histories.get(card["id"], [])
                previous_card.pop("history_path")
            data["cards"].append(previous_card)
    revision = digest(data)
    root = destination / "imports" / revision
    write_immutable(root / "raw.json", data["raw"])
    write_immutable(root / "report.json", data["report"])
    partitions = []
    for start in range(0, len(data["cards"]), 250):
        name = f"cards-{start // 250:05d}.json"
        history_name = f"history-{start // 250:05d}.json"
        history_path = f"imports/{revision}/{history_name}"
        selected = data["cards"][start:start + 250]
        # Startup loads only card metadata. Large imported histories are lazy.
        write_immutable(root / history_name, {card["id"]: card.get("history", []) for card in selected})
        runtime = [dict({key: value for key, value in card.items() if key not in {"history", "raw", "template", "fields", "history_path"}}, history_path=history_path)
                   for card in selected]
        write_immutable(root / name, runtime)
        partitions.append(f"imports/{revision}/{name}")
    manifest = {"format_version": VERSION, "import_id": import_id,
                "revision": revision, "collection_key": data["collection_key"], "scheduler": data["scheduler"],
                "timing": data["timing"], "partitions": partitions}
    write_immutable(root / "manifest.json", manifest)
    temporary = destination / "manifest.pending"
    temporary.write_text(canonical(manifest) + "\n", encoding="utf-8")
    temporary.replace(previous)
    (destination / "reviews").mkdir(exist_ok=True)
    return root
