#!/usr/bin/env python3
"""Verify a bijection between managed Obsidian IDs and managed Anki notes."""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

import yaml

import sources as exporter
from ankiconnect import AnkiConnect
from managed_tags import MANAGED_TAGS


ID_PROPERTY = "anki_note_id"
BLOCK_ID_RE = re.compile(r"<!--\s*ID\s*:\s*([0-9]+)\s*-->", re.IGNORECASE)
BLOCK_MARKER_RE = re.compile(r"<!--\s*ID\s*:", re.IGNORECASE)
FRONTMATTER_RE = re.compile(r"\A---[ \t]*\r?\n")


def chunks(values: list[int], size: int) -> Iterable[list[int]]:
    for start in range(0, len(values), size):
        yield values[start:start + size]


def positive_id(value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError
    rendered = str(value).strip()
    if not rendered.isascii() or not rendered.isdecimal():
        raise ValueError
    note_id = int(rendered)
    if note_id <= 0:
        raise ValueError
    return note_id


def collect_csv_ids(vault: Path, errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    owners: list[dict[str, Any]] = []
    root = vault / "data"
    if not root.is_dir():
        return owners
    for path in sorted(root.rglob("*.csv")):
        try:
            with path.open(encoding="utf-8-sig", newline="") as stream:
                reader = csv.DictReader(stream)
                if not reader.fieldnames or ID_PROPERTY not in reader.fieldnames:
                    continue
                for row_number, row in enumerate(reader, start=2):
                    raw_id = row.get(ID_PROPERTY, "")
                    if raw_id is None or not str(raw_id).strip():
                        errors.append({"kind": "missing-local-id", "source": "list",
                                       "path": str(path), "row": row_number})
                        continue
                    try:
                        note_id = positive_id(raw_id)
                    except ValueError:
                        errors.append({"kind": "invalid-local-id", "source": "list",
                                       "path": str(path), "row": row_number,
                                       "value": raw_id})
                        continue
                    owners.append({"note_id": note_id, "source": "list",
                                   "path": str(path), "row": row_number})
        except (OSError, csv.Error, UnicodeError) as error:
            errors.append({"kind": "csv", "path": str(path), "message": str(error)})
    return owners


def collect_structural_ids(
    vault: Path, errors: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    owners: list[dict[str, Any]] = []
    root = vault / "wiki"
    if not root.is_dir():
        return owners
    for path in sorted(root.rglob("*.md")):
        try:
            content = path.read_text(encoding="utf-8")
            if FRONTMATTER_RE.match(content) is None:
                continue
            metadata, _body = exporter.split_frontmatter(path)
        except (OSError, UnicodeError, yaml.YAMLError, exporter.ExportError) as error:
            errors.append({"kind": "frontmatter", "path": str(path),
                           "message": str(error)})
            continue
        if ID_PROPERTY not in metadata:
            continue
        raw_id = metadata[ID_PROPERTY]
        try:
            note_id = positive_id(raw_id)
        except ValueError:
            errors.append({"kind": "invalid-local-id", "source": "structural",
                           "path": str(path), "value": raw_id})
            continue
        owners.append({"note_id": note_id, "source": "structural",
                       "path": str(path)})
    return owners


def collect_block_ids(vault: Path, errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    owners: list[dict[str, Any]] = []
    for root in (vault / "data", vault / "wiki"):
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*.md")):
            try:
                content = path.read_text(encoding="utf-8")
            except (OSError, UnicodeError) as error:
                errors.append({"kind": "markdown", "path": str(path),
                               "message": str(error)})
                continue
            valid_starts: set[int] = set()
            for match in BLOCK_ID_RE.finditer(content):
                valid_starts.add(match.start())
                note_id = int(match.group(1))
                line = content.count("\n", 0, match.start()) + 1
                if note_id <= 0:
                    errors.append({"kind": "invalid-local-id", "source": "block",
                                   "path": str(path), "line": line,
                                   "value": match.group(1)})
                else:
                    owners.append({"note_id": note_id, "source": "block",
                                   "path": str(path), "line": line})
            for marker in BLOCK_MARKER_RE.finditer(content):
                if marker.start() not in valid_starts:
                    line = content.count("\n", 0, marker.start()) + 1
                    errors.append({"kind": "invalid-block-id", "source": "block",
                                   "path": str(path), "line": line})
    return owners


def collect_local(vault: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    errors: list[dict[str, Any]] = []
    owners = collect_csv_ids(vault, errors)
    owners.extend(collect_structural_ids(vault, errors))
    owners.extend(collect_block_ids(vault, errors))
    return owners, errors


def fetch_managed_notes(client: Any, batch_size: int) -> tuple[
    dict[int, dict[str, Any]], dict[str, set[int]], list[dict[str, Any]]
]:
    errors: list[dict[str, Any]] = []
    ids_by_source: dict[str, set[int]] = {}
    for source, tag in MANAGED_TAGS.items():
        result = client.invoke("findNotes", query=f"tag:{tag}")
        if not isinstance(result, list):
            errors.append({"kind": "anki", "message":
                           f"findNotes for {tag} did not return a list"})
            ids_by_source[source] = set()
            continue
        try:
            ids = [positive_id(value) for value in result]
        except ValueError:
            errors.append({"kind": "anki", "message":
                           f"findNotes for {tag} returned an invalid note ID"})
            ids = []
        if len(ids) != len(set(ids)):
            errors.append({"kind": "duplicate-anki-result", "tag": tag})
        ids_by_source[source] = set(ids)

    requested = sorted(set().union(*ids_by_source.values()))
    notes: dict[int, dict[str, Any]] = {}
    for batch in chunks(requested, batch_size):
        result = client.invoke("notesInfo", notes=batch)
        if not isinstance(result, list):
            errors.append({"kind": "anki", "message":
                           "notesInfo did not return a list"})
            continue
        for note in result:
            try:
                note_id = positive_id(note["noteId"])
            except (KeyError, TypeError, ValueError):
                errors.append({"kind": "anki", "message":
                               "notesInfo returned a note without a valid noteId"})
                continue
            if note_id not in batch:
                errors.append({"kind": "unexpected-anki-note", "note_id": note_id})
            elif note_id in notes:
                errors.append({"kind": "duplicate-anki-note", "note_id": note_id})
            else:
                notes[note_id] = note
    for note_id in requested:
        if note_id not in notes:
            errors.append({"kind": "missing-notes-info", "note_id": note_id})
    return notes, ids_by_source, errors


def build_report(vault: Path, client: Any, batch_size: int) -> dict[str, Any]:
    owners, errors = collect_local(vault)
    notes, ids_by_source, anki_errors = fetch_managed_notes(client, batch_size)
    errors.extend(anki_errors)

    owners_by_id: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for owner in owners:
        owners_by_id[owner["note_id"]].append(owner)
    for note_id, claimed_by in sorted(owners_by_id.items()):
        if len(claimed_by) > 1:
            errors.append({"kind": "duplicate-local-id", "note_id": note_id,
                           "owners": claimed_by})

    local_ids = set(owners_by_id)
    anki_ids = set(notes)
    for note_id in sorted(local_ids - anki_ids):
        errors.append({"kind": "missing-in-anki", "note_id": note_id,
                       "owners": owners_by_id[note_id]})
    for note_id in sorted(anki_ids - local_ids):
        errors.append({"kind": "missing-in-obsidian", "note_id": note_id,
                       "managed_sources": sorted(source for source, ids in
                                                 ids_by_source.items()
                                                 if note_id in ids)})

    for note_id in sorted(local_ids & anki_ids):
        local_sources = {owner["source"] for owner in owners_by_id[note_id]}
        anki_sources = {source for source, ids in ids_by_source.items()
                        if note_id in ids}
        if local_sources != anki_sources:
            errors.append({"kind": "managed-tag-mismatch", "note_id": note_id,
                           "obsidian_sources": sorted(local_sources),
                           "anki_sources": sorted(anki_sources),
                           "owners": owners_by_id[note_id]})

    counts = {
        source: {
            "obsidian": sum(owner["source"] == source for owner in owners),
            "anki": len(ids_by_source[source]),
        }
        for source in MANAGED_TAGS
    }
    return {
        "vault": str(vault),
        "managed_tags": MANAGED_TAGS,
        "counts": counts,
        "obsidian_ids": len(local_ids),
        "anki_ids": len(anki_ids),
        "errors": errors,
        "ok": not errors,
    }


def error_location(error: dict[str, Any]) -> str:
    location = error.get("path", "")
    if "row" in error:
        location += f":{error['row']}"
    elif "line" in error:
        location += f":{error['line']}"
    return location


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", type=Path, default=exporter.DEFAULT_VAULT)
    parser.add_argument("--url", default="http://127.0.0.1:8765")
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--retries", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=250)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if args.timeout <= 0 or args.retries < 0 or args.batch_size <= 0:
        parser.error("--timeout and --batch-size must be positive; --retries cannot be negative")

    vault = args.vault.expanduser().resolve()
    client = AnkiConnect(args.url, os.environ.get("ANKI_CONNECT_API_KEY"),
                         args.timeout, args.retries)
    try:
        report = build_report(vault, client, args.batch_size)
        if args.report:
            destination = args.report.expanduser()
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                                   encoding="utf-8")
    except (OSError, exporter.ExportError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    counts = report["counts"]
    details = ", ".join(
        f"{source} {value['obsidian']}/{value['anki']}"
        for source, value in counts.items()
    )
    print(f"Managed-ID audit: {report['obsidian_ids']} Obsidian ID(s), "
          f"{report['anki_ids']} Anki note(s); {details}; "
          f"{len(report['errors'])} error(s)")
    for error in report["errors"]:
        print(f"ERROR\t{error['kind']}\t{error.get('note_id', '')}\t"
              f"{error_location(error)}")
    if args.report:
        print(f"Detailed report: {args.report.expanduser()}")
    return int(not report["ok"])


if __name__ == "__main__":
    raise SystemExit(main())
