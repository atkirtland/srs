"""Reviewed creation on either side of a configured CSV/Anki list.

Field mappings belong to the source configuration. Text mappings invert
losslessly by retaining Anki HTML; unsupported transforms must be given an
explicit inverse before they can participate in inbound creation.
"""
from __future__ import annotations

import csv
import hashlib
import io
import os
from pathlib import Path
import re
import tempfile
from typing import Any

from bs4 import BeautifulSoup

import sources
from managed_tags import MISTAKEN_MANAGED_TAGS, MANAGED_TAGS


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_csv(path: Path) -> tuple[bytes, list[str], list[dict[str, str]]]:
    data = path.read_bytes()
    reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig"), newline=""), strict=True)
    columns = reader.fieldnames or []
    if not columns or any(not column.strip() for column in columns) or len(set(columns)) != len(columns):
        raise sources.ExportError(f"{path}: missing or duplicate CSV headers")
    try:
        rows = list(reader)
    except csv.Error as error:
        raise sources.ExportError(f"{path}: invalid CSV: {error}") from error
    if any(None in row or None in row.values() for row in rows):
        raise sources.ExportError(f"{path}: CSV row has the wrong number of columns")
    return data, columns, rows


def identity(fields: dict[str, str], config: sources.Export) -> tuple[str, ...]:
    names = config.identity_fields or (config.fields[0].anki,)
    return tuple(re.sub(r"\s+", " ", BeautifulSoup(fields.get(name, ""),
                 "html.parser").get_text()).strip().casefold() for name in names)


def render_record(record: dict[str, str], config: sources.Export, path: Path) -> dict[str, str]:
    note = sources.Note(path, record, "")
    return {field.anki: field.transform(record[field.source], note) for field in config.fields}


def build(names: list[str], vault: Path, client: Any, batch_size: int) -> list[dict[str, Any]]:
    # Import here to share the existing snapshot and batching contracts.
    import sync

    owners: dict[int, list[str]] = sync.global_markdown_id_owners(vault)
    for config in sources.CSV_EXPORTS.values():
        paths = ((config.notes_directory,) if isinstance(config.notes_directory, str)
                 else config.notes_directory)
        for relative in paths:
            path = vault / relative
            if not path.is_file():
                continue
            _, _, records = read_csv(path)
            for number, record in enumerate(records, 2):
                if record.get("anki_note_id", "").strip():
                    note_id = sync.scalar_note_id(record["anki_note_id"], path)
                    owners.setdefault(note_id, []).append(f"{path.resolve()}#row-{number}")

    result = []
    claimed: dict[int, str] = {}
    for name in names:
        config = sources.EXPORTS[name]
        paths = ((config.notes_directory,) if isinstance(config.notes_directory, str)
                 else config.notes_directory)
        if len(paths) != 1:
            raise sources.ExportError(f"{name}: additions require one CSV destination")
        path = (vault / paths[0]).resolve()
        raw, columns, records = read_csv(path)
        required = {"anki_note_id", "tags", *(field.source for field in config.fields)}
        if required - set(columns):
            raise sources.ExportError(f"{path}: missing columns: {', '.join(sorted(required - set(columns)))}")
        if any(field.transform not in {sources.text, sources.comma_separated_labels}
               or field.source.startswith("$")
               for field in config.fields):
            raise sources.ExportError(f"{name}: inbound creation needs explicit inverse transforms")
        if len({field.source for field in config.fields}) != len(config.fields):
            raise sources.ExportError(f"{name}: field mapping cannot be inverted unambiguously")

        query = config.query
        if query and config.notetype:
            query = f'({query}) note:"{config.notetype}"'
        candidate_ids = sorted(set(client.invoke("findNotes", query=query))) if query else []
        candidates = sync.fetch_notes(client, candidate_ids, batch_size)
        if set(candidates) != set(candidate_ids):
            raise sources.ExportError(f"{name}: Anki candidates changed during analysis")
        remote = {note_id: sync.snapshot_note(note) for note_id, note in candidates.items()}
        actions = []
        seen: set[tuple[str, ...]] = set()
        linked_keys: set[tuple[str, ...]] = set()
        blank = []
        for number, record in enumerate(records, 2):
            fields = render_record(record, config, path)
            key = identity(fields, config)
            location = f"{path}#row-{number}"
            if not record["anki_note_id"].strip():
                if not all(key):
                    raise sources.ExportError(f"{location}: new note needs a nonempty identity")
                blank.append((number, record, fields, key))
            # Existing lists may contain legacy duplicate identities. Only
            # additions are blocked by them; established IDs remain authoritative.
            seen.add(key)
            if record["anki_note_id"].strip():
                linked_keys.add(key)
        blank_keys: set[tuple[str, ...]] = set()
        for number, record, fields, key in blank:
            if key in blank_keys or key in linked_keys:
                raise sources.ExportError(f"{path}#row-{number}: duplicate new-note identity {key!r}")
            blank_keys.add(key)

        unmatched: dict[tuple[str, ...], list[dict[str, Any]]] = {}
        for note_id, note in remote.items():
            if set(note["tags"]) & {tags[kind] for tags in (MANAGED_TAGS, MISTAKEN_MANAGED_TAGS)
                                    for kind in ("structural", "block")}:
                owners.setdefault(note_id, []).append("managed by another source kind")
            if note_id in owners:
                continue
            if note_id in claimed:
                raise sources.ExportError(f"Anki note {note_id} matches both {claimed[note_id]} and {name}")
            if config.notetype and note["model"] != config.notetype:
                raise sources.ExportError(f"{name}: unexpected note type for Anki note {note_id}")
            if set(field.anki for field in config.fields) - note["fields"].keys():
                raise sources.ExportError(f"{name}: Anki note {note_id} lacks configured fields")
            key = identity(note["fields"], config)
            if not all(key):
                raise sources.ExportError(f"{name}: Anki note {note_id} has an empty identity")
            unmatched.setdefault(key, []).append(note)
            claimed[note_id] = name
        for key, matches in unmatched.items():
            if len(matches) > 1 or (key in seen and key not in blank_keys):
                raise sources.ExportError(f"{name}: ambiguous new Anki identity {key!r}; resolve duplicates first")

        for number, record, fields, key in blank:
            matches = unmatched.pop(key, [])
            if matches:
                note = matches[0]
                if any(note["fields"][field].strip() != value for field, value in fields.items()):
                    raise sources.ExportError(f"{path}#row-{number}: Anki has the same identity with different fields; resolve before linking")
                actions.append({"action": "link", "row": number, "note_id": note["note_id"],
                                "fields": fields})
                continue
            # An ID-less row must not recreate an already-owned Anki identity.
            if any(identity(note["fields"], config) == key for note_id, note in remote.items()
                   if note_id in owners):
                raise sources.ExportError(f"{path}#row-{number}: identity already exists in Anki")
            model = config.notetype
            if model is None:
                models = {note["model"] for note in remote.values()}
                if len(models) == 1:
                    model = models.pop()
            deck = config.destination_deck
            if not model or not deck:
                raise sources.ExportError(f"{name}: creating notes requires an unambiguous note type and destination_deck")
            schema = client.invoke("modelFieldNames", modelName=model)
            if not set(fields).issubset(schema):
                raise sources.ExportError(f"{name}: note type lacks configured fields")
            # Deterministic recovery tag identifies an uncertain addNote response.
            token = digest(f"{path}:{digest(raw)}:{number}".encode())[:32]
            actions.append({"action": "create", "row": number, "fields": fields,
                            "model": model, "schema": schema, "deck": deck,
                            "tags": sorted(set(record["tags"].split()) | {sync.MANAGED_TAGS['list']}),
                            "recovery_tag": f"oa::pending::{token}"})
        for matches in unmatched.values():
            note = matches[0]
            record = {"anki_note_id": str(note["note_id"]),
                      "tags": " ".join(sorted(set(note["tags"]) | {MANAGED_TAGS['list']})),
                      **{field.source: note["fields"][field.anki] for field in config.fields}}
            rendered = render_record(record, config, path)
            if any(rendered[field.anki] != note["fields"][field.anki].strip()
                   for field in config.fields):
                raise sources.ExportError(f"{name}: Anki note {note['note_id']} cannot round-trip through the configured transforms")
            actions.append({"action": "import", "note_id": note["note_id"],
                            "fields": {field.anki: note["fields"][field.anki] for field in config.fields},
                            "record": record})
        result.append({"definition": name, "path": str(path), "sha256": digest(raw),
                       "columns": columns, "query": query,
                       "candidates": list(remote.values()), "actions": actions})
    return result


def atomic_write(path: Path, data: bytes) -> None:
    mode = path.stat().st_mode
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.chmod(mode)
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def apply(groups: list[dict[str, Any]], client: Any, created: list[int],
          written: list[tuple[Path, bytes]], tagged: list[tuple[int, str]],
          operations: list[dict[str, Any]]) -> dict[str, str]:
    import sync

    hashes = {}
    for group in groups:
        if not group["actions"]:
            continue
        sync.progress(f"Applying {len(group['actions'])} list addition(s): {group['definition']}")
        path = Path(group["path"])
        raw, columns, records = read_csv(path)
        if digest(raw) != group["sha256"]:
            raise sources.ExportError(f"CSV drifted before write: {path}")
        for action in group["actions"]:
            kind = action["action"]
            if kind == "create":
                token = action["recovery_tag"]
                payload = {"deckName": action["deck"], "modelName": action["model"],
                           "fields": action["fields"], "tags": action["tags"] + [token],
                           "options": {"allowDuplicate": False}}
                # AnkiConnect must not retry addNote after a transport failure.
                # Recover the committed ID by its unique tag if the response is lost.
                try:
                    note_id = client.invoke("addNote", note=payload)
                except Exception:
                    recovered = client.invoke("findNotes", query=f"tag:{token}")
                    if len(recovered) != 1:
                        raise
                    note_id = recovered[0]
                note_id = sync.scalar_note_id(note_id, path)
                created.append(note_id)
                actual = sync.snapshot_note(sync.fetch_notes(client, [note_id], 1)[note_id])
                if (actual["model"] != action["model"]
                        or any(actual["fields"].get(k) != v for k, v in action["fields"].items())
                        or set(actual["tags"]) != set(payload["tags"])):
                    raise sources.ExportError(f"new Anki note {note_id} failed verification")
                client.invoke("removeTags", notes=[note_id], tags=token)
            else:
                note_id = action["note_id"]
                before = next(note for note in group["candidates"] if note["note_id"] == note_id)
                desired = set(records[action["row"] - 2]["tags"].split()) if kind == "link" else set()
                for tag in sorted((desired | {sync.MANAGED_TAGS['list']}) - set(before["tags"])):
                    tagged.append((note_id, tag))
                    client.invoke("addTags", notes=[note_id], tags=tag)
                actual = sync.snapshot_note(sync.fetch_notes(client, [note_id], 1)[note_id])
                expected = {**before, "tags": sorted(set(before["tags"]) | desired | {sync.MANAGED_TAGS['list']})}
                if actual != expected:
                    raise sources.ExportError(f"imported Anki note {note_id} failed verification")
            if kind in {"create", "link"}:
                records[action["row"] - 2]["anki_note_id"] = str(note_id)
                record = records[action["row"] - 2]
                tags = record["tags"].split()
                if MANAGED_TAGS['list'] not in tags:
                    record["tags"] = " ".join([*tags, MANAGED_TAGS['list']])
            else:
                records.append({column: action["record"].get(column, "") for column in columns})
            operations.append({"kind": kind, "definition": group["definition"],
                               "note_id": note_id, "status": "success"})
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, fieldnames=columns, lineterminator="\r\n" if b"\r\n" in raw else "\n")
        writer.writeheader()
        writer.writerows(records)
        if digest(path.read_bytes()) != group["sha256"]:
            raise sources.ExportError(f"CSV drifted before write: {path}")
        written.append((path, raw))
        encoded = output.getvalue().encode("utf-8-sig" if raw.startswith(b"\xef\xbb\xbf") else "utf-8")
        atomic_write(path, encoded)
        if path.read_bytes() != encoded:
            raise sources.ExportError(f"CSV verification failed after write: {path}")
        hashes[str(path)] = digest(encoded)
    return hashes
