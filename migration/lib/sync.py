#!/usr/bin/env python3
"""Review and apply ID-based Obsidian-to-Anki structural updates."""
from __future__ import annotations

import argparse
import base64
import csv
import difflib
import hashlib
import html
import json
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

import block_notes
import list_additions
import local_tags
import sources as exporter
from ankiconnect import AnkiConnect, ExportError as AnkiConnectError, chunks
from managed_tags import MANAGED_TAGS


def visible_text_without_whitespace(value: str) -> str:
    """Compare source text with linked Anki HTML without presentation spacing."""
    # Let the HTML parser decode entities only for actual markup. Running
    # ``html.unescape`` over plain URL text can mistake ``&mp=`` for the
    # legacy ``&mp`` entity and turn it into a mathematical symbol.
    visible = (BeautifulSoup(value, "html.parser").get_text()
               if "<" in value else value)
    return re.sub(r"[\s\u200b]+", "", visible)


FORMAT_VERSION = 4
MANAGED_TAG = MANAGED_TAGS["structural"]
ID_PROPERTY = "anki_note_id"
MEDIA_BATCH_SIZE = 50
MEDIA_BATCH_BYTES = 32 * 1024 * 1024
MEDIA_BACKUP_DIRECTORY = "media-backup"
MEDIA_UPLOAD_TIMEOUT = 300.0
PROGRESS_INTERVAL = 2.0
# Enabled by the command line only, so library callers and tests stay quiet.
PROGRESS_ENABLED = False
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def snapshot_note(note: dict[str, Any]) -> dict[str, Any]:
    return {
        "note_id": int(note["noteId"]),
        "model": str(note.get("modelName", "")),
        "fields": {name: str(value.get("value", ""))
                   for name, value in note.get("fields", {}).items()},
        "tags": sorted(str(tag) for tag in note.get("tags", [])),
    }


def scalar_note_id(value: Any, path: Path) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise exporter.ExportError(f"{path}: {ID_PROPERTY} must be a scalar integer")
    rendered = str(value).strip()
    if not rendered.isdecimal() or int(rendered) <= 0:
        raise exporter.ExportError(f"{path}: invalid {ID_PROPERTY} {value!r}")
    return int(rendered)


def notes_for_config(vault: Path, config: exporter.Export) -> list[exporter.Note]:
    return exporter.source_notes(vault, config)


def render_definition(name: str, config: exporter.Export, vault: Path,
                      source_kind: str = "structural",
                      source_warnings: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for note in notes_for_config(vault, config):
        if source_warnings is not None:
            source_warnings.extend({
                "severity": "warning", "kind": "unresolved_taxonomy_child",
                "definition": name, "note_path": str(note.path.resolve()),
                "target": target,
                "message": f"Child link {target!r} was not loaded in wiki/life (missing file or no YAML frontmatter); skipped this child edge",
            } for target in note.metadata.get("$taxonomy_unresolved_children", []))
        if config.required_property and config.required_property not in note.metadata:
            continue
        if (config.required_any_property
                and not any(key in note.metadata for key in config.required_any_property)):
            continue
        if ID_PROPERTY not in note.metadata:
            # Structural sync only manages notes that have explicitly been
            # linked to an existing Anki note.  Other Markdown notes may live
            # in the same configured directory and remain unmanaged.
            continue
        if source_kind == "list" and not str(note.metadata[ID_PROPERTY] or "").strip():
            continue  # Reviewed separately as a new CSV note.
        note_id = scalar_note_id(note.metadata[ID_PROPERTY], note.path)
        fields: dict[str, str] = {}
        unavailable: list[str] = []
        for field in config.fields:
            if field.missing_source == "omit" and field.source not in note.metadata:
                unavailable.append(field.anki)
                continue
            value = exporter.field_source_value(note, field)
            fields[field.anki] = field.transform(value, note)
        media: list[dict[str, Any]] = []
        missing_media: list[Path] = []
        for path in exporter.media_paths(config, note, vault, missing_media):
            data = path.read_bytes()
            media.append({"filename": exporter.anki_media_name(path.name),
                          "path": str(path.resolve()),
                          "sha256": sha256(data), "size": len(data)})
        issues = [{"severity": "error", "kind": "missing_attachment",
                   "message": "Referenced attachment does not exist",
                   "path": str(path.resolve())}
                  for path in missing_media]
        warnings = [{"severity": "warning", "kind": "multiple_ancestry",
                     "message": message}
                    for message in note.metadata.get(
                        "$taxonomy_multiple_ancestry", [])]
        desired_tags = (str(note.metadata.get("tags", "")).split()
                        if source_kind == "list" else [])
        rows.append({"definition": name, "path": str(note.path.resolve()),
                     "note_id": note_id, "fields": fields,
                     "unavailable_fields": unavailable, "media": media,
                     "issues": issues, "warnings": warnings,
                     "desired_tags": desired_tags})
    return rows


BLOCK_CONFIG = exporter.Export(
    notes_directory="wiki", notetype="Basic",
    fields=(exporter.Field("Front", "$front", exporter.text),
            exporter.Field("Back", "$back", exporter.text)),
    classification="block", recursive=True,
)


def config_for(name: str, source_kind: str) -> exporter.Export:
    return BLOCK_CONFIG if source_kind == "block" else exporter.EXPORTS[name]


def render_blocks(vault: Path) -> list[dict[str, Any]]:
    return [{"definition": "blocks", "path": str(note.path),
             "line": note.line, "note_id": note.note_id,
             "fields": {"Front": note.front, "Back": note.back},
             "unavailable_fields": [], "media": [], "issues": [],
             "warnings": [], "desired_tags": list(note.tags)}
            for note in block_notes.scan(vault)]


def selected_definitions(name: str, source_kind: str = "structural") -> list[str]:
    if source_kind == "block":
        available = ["blocks"]
    elif source_kind == "list":
        available = list(exporter.CSV_EXPORTS)
    else:
        available = [key for key, value in exporter.EXPORTS.items()
                     if value.classification == "structural"]
    if name != "all":
        if name not in available:
            raise exporter.ExportError(f"unknown {source_kind} definition: {name}")
        return [name]
    return available


def global_markdown_id_owners(vault: Path) -> dict[int, list[str]]:
    """Inventory seeded structural IDs, including unselected wiki notes."""
    owners: dict[int, list[str]] = defaultdict(list)
    wiki = vault / "wiki"
    if not wiki.is_dir():
        return owners
    for path in wiki.rglob("*.md"):
        try:
            metadata, _ = exporter.split_frontmatter(path)
        except exporter.NoFrontmatterError:
            continue
        value = metadata.get(ID_PROPERTY)
        if value is None:
            continue
        note_id = scalar_note_id(value, path)
        owners[note_id].append(str(path.resolve()))
    return owners


def progress(message: str) -> None:
    """Report the current stage on stderr when run from the command line."""
    if PROGRESS_ENABLED:
        print(message, file=sys.stderr, flush=True)


def track(label: str, items: Any) -> Any:
    """Yield items while reporting a throttled running count on stderr."""
    items = list(items)
    last = 0.0
    for index, item in enumerate(items, 1):
        now = time.monotonic()
        if index in (1, len(items)) or now - last >= PROGRESS_INTERVAL:
            progress(f"{label}: {index}/{len(items)}")
            last = now
        yield item


def fetch_notes(client: Any, ids: list[int], batch_size: int) -> dict[int, dict[str, Any]]:
    found: dict[int, dict[str, Any]] = {}
    for batch in chunks(ids, batch_size):
        result = client.invoke("notesInfo", notes=batch)
        if not isinstance(result, list):
            raise exporter.ExportError("notesInfo returned a non-list result")
        for note in result:
            found[int(note["noteId"])] = note
    return found


def retrieve_media(client: Any, filename: str) -> tuple[str | None, str | None]:
    encoded = client.invoke("retrieveMediaFile", filename=filename)
    if encoded is False or encoded is None:
        return None, None
    if not isinstance(encoded, str):
        raise exporter.ExportError(f"retrieveMediaFile returned invalid data for {filename!r}")
    try:
        data = base64.b64decode(encoded, validate=True)
    except ValueError as error:
        raise exporter.ExportError(f"invalid base64 returned for media {filename!r}") from error
    return sha256(data), encoded


def retrieve_media_many(client: Any, filenames: list[str]) -> dict[str, tuple[str | None, str | None]]:
    """Fetch media in one AnkiConnect round trip when ``multi`` is available."""
    if not filenames:
        return {}
    try:
        results = client.invoke("multi", actions=[
            {"action": "retrieveMediaFile", "params": {"filename": filename}}
            for filename in filenames
        ])
        if not isinstance(results, list) or len(results) != len(filenames):
            raise exporter.ExportError("multi returned invalid media results")
        fetched: dict[str, tuple[str | None, str | None]] = {}
        for filename, result in zip(filenames, results, strict=True):
            # AnkiConnect multi returns either raw results or result/error
            # envelopes depending on version.
            if isinstance(result, dict) and "result" in result:
                if result.get("error"):
                    raise exporter.ExportError(
                        f"retrieveMediaFile failed for {filename!r}: {result['error']}"
                    )
                result = result["result"]
            if result is False or result is None:
                fetched[filename] = (None, None)
            elif isinstance(result, str):
                data = base64.b64decode(result, validate=True)
                fetched[filename] = (sha256(data), result)
            else:
                raise exporter.ExportError(
                    f"retrieveMediaFile returned invalid data for {filename!r}"
                )
        return fetched
    except (AssertionError, NotImplementedError):
        # Small test clients and older adapters may not expose ``multi``.
        return {filename: retrieve_media(client, filename) for filename in filenames}


def inline_diff(old: str, new: str) -> tuple[str, str]:
    if old == new:
        escaped = html.escape(old)
        return escaped, escaped
    left: list[str] = []
    right: list[str] = []
    for operation, a, b, c, d in difflib.SequenceMatcher(None, old, new).get_opcodes():
        old_part, new_part = html.escape(old[a:b]), html.escape(new[c:d])
        if operation == "equal":
            left.append(old_part); right.append(new_part)
        else:
            if old_part: left.append(f"<del>{old_part}</del>")
            if new_part: right.append(f"<ins>{new_part}</ins>")
    return "".join(left), "".join(right)


def media_batches(media_sources: dict[str, dict[str, Any]]) -> list[list[str]]:
    """Group media filenames so one request stays small in count and bytes.

    Anki's copy is not measurable in advance, so the local size stands in.
    """
    batches: list[list[str]] = [[]]
    pending = 0
    for filename in sorted(media_sources, key=str.casefold):
        size = int(media_sources[filename].get("size", 0))
        if batches[-1] and (len(batches[-1]) >= MEDIA_BATCH_SIZE
                            or pending + size > MEDIA_BATCH_BYTES):
            batches.append([])
            pending = 0
        batches[-1].append(filename)
        pending += size
    return [batch for batch in batches if batch]


def prune_media_backups(directory: Path, keep: set[str]) -> None:
    """Remove content-addressed backups that the new plan no longer references."""
    if not directory.is_dir():
        return
    for path in directory.iterdir():
        if (path.is_file() and path.name not in keep
                and re.fullmatch(r"[0-9a-f]{64}", path.name)):
            path.unlink()


def store_media(client: Any, filename: str, path: Path, expected_sha256: str) -> None:
    """Store one media file in Anki, letting Anki read it from disk when it can.

    AnkiConnect receives large request bodies very slowly, so the file is
    passed by path first. The upload is the fallback for an Anki that cannot
    see the path (sandboxed or remote), with a timeout suited to large files.
    """
    data = path.read_bytes()
    if sha256(data) != expected_sha256:
        raise exporter.ExportError(f"media changed on disk before it was stored: {filename}")
    try:
        returned = client.invoke("storeMediaFile", filename=filename, path=str(path.resolve()))
    except AnkiConnectError:
        previous = getattr(client, "timeout", None)
        if previous is not None:
            client.timeout = max(previous, MEDIA_UPLOAD_TIMEOUT)
        try:
            returned = client.invoke("storeMediaFile", filename=filename,
                                     data=base64.b64encode(data).decode("ascii"))
        finally:
            if previous is not None:
                client.timeout = previous
    if returned != filename:
        raise exporter.ExportError(f"storeMediaFile returned {returned!r}, expected {filename!r}")


def media_backup_base64(item: dict[str, Any]) -> str:
    """Return the pre-sync Anki copy of a replaced media file for rollback."""
    if item.get("before_backup"):
        data = Path(item["before_backup"]).read_bytes()
        if sha256(data) != item["before_sha256"]:
            raise exporter.ExportError(
                f"media backup is corrupt for {item['filename']}: {item['before_backup']}")
        return base64.b64encode(data).decode("ascii")
    if item.get("before_base64"):
        return item["before_base64"]
    raise exporter.ExportError(f"no media backup recorded for {item['filename']}")


def build_plan(definition: str, vault: Path, client: Any, batch_size: int,
               source_kind: str = "structural",
               media_backup_dir: Path | None = None) -> dict[str, Any]:
    names = selected_definitions(definition, source_kind)
    additions = (list_additions.build(names, vault, client, batch_size)
                 if source_kind == "list" else [])
    source_warnings: list[dict[str, Any]] = []
    rows = (render_blocks(vault) if source_kind == "block" else
            [row for name in names
             for row in render_definition(
                 name, exporter.EXPORTS[name], vault, source_kind, source_warnings)])
    row_ids: dict[int, list[str]] = defaultdict(list)
    for row in rows:
        location = row["path"] + (f":{row['line']}" if "line" in row else "")
        row_ids[row["note_id"]].append(location)
    repeated_rows = {note_id: locations for note_id, locations in row_ids.items()
                     if len(locations) > 1}
    if repeated_rows:
        details = "; ".join(
            f"{note_id}: {', '.join(locations)}"
            for note_id, locations in repeated_rows.items()
        )
        raise exporter.ExportError(f"duplicate {ID_PROPERTY} ownership: {details}")
    owners: dict[int, list[str]] = defaultdict(list)
    for note_id, paths in global_markdown_id_owners(vault).items():
        owners[note_id].extend(paths)
    for row in rows:
        location = row["path"] + (f":{row['line']}" if "line" in row else "")
        if location not in owners[row["note_id"]]:
            owners[row["note_id"]].append(location)
    duplicate = {note_id: paths for note_id, paths in owners.items() if len(paths) > 1}
    if duplicate:
        details = "; ".join(f"{key}: {', '.join(value)}" for key, value in duplicate.items())
        raise exporter.ExportError(f"duplicate {ID_PROPERTY} ownership: {details}")

    selected_ids = {row["note_id"] for row in rows}
    current = fetch_notes(client, sorted(selected_ids), batch_size)
    missing = sorted(selected_ids - set(current))
    if missing:
        raise exporter.ExportError("Anki notes do not exist: " + ", ".join(map(str, missing)))

    schemas: dict[str, list[str]] = {}
    for row in rows:
        config = config_for(row["definition"], source_kind)
        note = current[row["note_id"]]
        model = str(note.get("modelName", ""))
        if config.notetype is not None and model != config.notetype:
            raise exporter.ExportError(
                f"note {row['note_id']}: expected note type {config.notetype!r}, found {model!r}")
        if model not in schemas:
            result = client.invoke("modelFieldNames", modelName=model)
            if not isinstance(result, list):
                raise exporter.ExportError(f"modelFieldNames returned invalid data for {model!r}")
            schemas[model] = [str(item) for item in result]
        configured = [field.anki for field in config.fields]
        absent = sorted(set(configured) - set(schemas[model]))
        if absent:
            raise exporter.ExportError(
                f"note type {model!r} lacks configured fields: {', '.join(absent)}")

    media_sources: dict[str, dict[str, Any]] = {}
    collisions: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        for item in row["media"]:
            collisions[item["filename"].casefold()].append(item)
    for folded, items in collisions.items():
        hashes = {item["sha256"] for item in items}
        if len(hashes) > 1:
            paths = ", ".join(sorted({item["path"] for item in items}))
            raise exporter.ExportError(f"local media filename collision for {folded!r}: {paths}")
        source = dict(items[0])
        source["definitions"] = sorted({
            row["definition"] for row in rows
            if any(media["filename"].casefold() == folded for media in row["media"])
        })
        media_sources[items[0]["filename"]] = source

    media_plan: list[dict[str, Any]] = []
    # Fetch in batches so neither Anki nor this process ever holds the whole
    # media library in one response.  Anki's copy of each replaced file is the
    # rollback backup; given a backup directory it goes to disk rather than
    # into the plan, which would otherwise grow by every replaced file.
    backups: set[str] = set()
    for batch in track("Comparing media with Anki (batches)", media_batches(media_sources)):
        remote_media = retrieve_media_many(client, batch)
        for filename in batch:
            item = media_sources[filename]
            remote_hash, remote_data = remote_media[filename]
            kind = "addition" if remote_hash is None else ("unchanged" if remote_hash == item["sha256"] else "replacement")
            entry = {**item, "status": kind, "before_sha256": remote_hash,
                     "before_base64": None}
            if kind == "replacement":
                if media_backup_dir is None:
                    entry["before_base64"] = remote_data
                else:
                    media_backup_dir.mkdir(parents=True, exist_ok=True)
                    backup = media_backup_dir / remote_hash
                    backup.write_bytes(base64.b64decode(remote_data, validate=True))
                    backups.add(backup.name)
                    entry["before_backup"] = str(backup)
            media_plan.append(entry)
    if media_backup_dir is not None:
        prune_media_backups(media_backup_dir, backups)

    plan_rows: list[dict[str, Any]] = []
    managed_tag = MANAGED_TAGS[source_kind]
    for row in rows:
        before = snapshot_note(current[row["note_id"]])
        preserved_fields: list[str] = []
        if source_kind == "list":
            fields_by_name = {
                field.anki: field
                for field in config_for(row["definition"], source_kind).fields
            }
            for field, proposed in row["fields"].items():
                existing = before["fields"].get(field, "")
                if (re.search(r"<a\b", existing, re.IGNORECASE)
                        and not re.search(r"<a\b", proposed, re.IGNORECASE)):
                    field_config = fields_by_name[field]
                    if field_config.allow_link_removal:
                        continue
                    if (field_config.preserve_matching_links
                            and visible_text_without_whitespace(existing)
                            == visible_text_without_whitespace(proposed)):
                        # The source is an intentionally flattened migration
                        # record. Keep richer legacy markup when its actual
                        # text has not changed.
                        preserved_fields.append(field)
                        continue
                    row["issues"].append({
                        "severity": "error",
                        "kind": "dropped_link",
                        "field": field,
                        "message": "Proposed list value drops an existing HTML link",
                    })
        updates = {name: value for name, value in row["fields"].items()
                   if name not in preserved_fields
                   and before["fields"].get(name) != value}
        desired_tags = set(row.get("desired_tags", [])) | {managed_tag}
        plan_rows.append({**row, "before": before, "updates": updates,
                          "preserved_fields": preserved_fields,
                          "add_tags": sorted(desired_tags - set(before["tags"])),
                          "changed": bool(updates) or not desired_tags.issubset(before["tags"])})
    local_tag_changes = local_tags.build(plan_rows, source_kind)
    issues = [{**issue, "definition": row["definition"],
               "note_id": row["note_id"], "note_path": row["path"]}
              for row in plan_rows for issue in row["issues"]]
    warnings = source_warnings + [{**warning, "definition": row["definition"],
                 "note_id": row["note_id"], "note_path": row["path"]}
                for row in plan_rows for warning in row.get("warnings", [])]
    return {
        "format_version": FORMAT_VERSION,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "vault": str(vault), "definitions": names,
        "source_kind": source_kind, "managed_tag": managed_tag,
        "schemas": schemas, "notes": plan_rows, "media": media_plan,
        "list_additions": additions,
        "local_tag_changes": local_tag_changes,
        "issues": issues, "warnings": warnings,
    }


def write_csvs(plan: dict[str, Any], destination: Path) -> None:
    with (destination / "changes.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=("definition", "note_id", "path", "field", "current", "proposed"))
        writer.writeheader()
        for row in plan["notes"]:
            for field, proposed in row["updates"].items():
                writer.writerow({"definition": row["definition"], "note_id": row["note_id"],
                                 "path": row["path"], "field": field,
                                 "current": row["before"]["fields"].get(field, ""),
                                 "proposed": proposed})
            if row.get("local_add_tags"):
                writer.writerow({"definition": row["definition"], "note_id": row["note_id"],
                                 "path": row["path"], "field": "$local_tags",
                                 "current": "", "proposed": " ".join(row["local_add_tags"])})
        for group in plan.get("list_additions", []):
            for action in group["actions"]:
                for field, value in action["fields"].items():
                    writer.writerow({"definition": group["definition"],
                                     "note_id": action.get("note_id", "new"),
                                     "path": group["path"],
                                     "field": f"{action['action']}:{field}",
                                     "current": "", "proposed": value})
    with (destination / "media.csv").open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=("filename", "status", "path", "sha256", "before_sha256", "size"))
        writer.writeheader()
        for item in plan["media"]:
            writer.writerow({key: item.get(key) for key in writer.fieldnames})
        for issue in plan.get("issues", []):
            if issue["kind"] == "missing_attachment":
                writer.writerow({"filename": Path(issue["path"]).name,
                                 "status": "missing", "path": issue["path"],
                                 "sha256": "", "before_sha256": "", "size": ""})


def report_html(plan: dict[str, Any]) -> str:
    by_definition: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in plan["notes"]: by_definition[row["definition"]].append(row)
    sections: list[str] = []
    summary: list[str] = []
    unresolved = [warning for warning in plan.get("warnings", [])
                  if warning.get("kind") == "unresolved_taxonomy_child"]
    if unresolved:
        entries = "".join(f'<li><code>{html.escape(warning["note_path"])}</code>: {html.escape(warning["message"])}</li>'
                          for warning in unresolved)
        sections.append(f'<section><h2>Unresolved taxonomy child links</h2><p>These child edges were skipped. Ancestry for existing notes uses the resolved links.</p><ul>{entries}</ul></section>')
    for group in plan.get("list_additions", []):
        if not group["actions"]:
            continue
        additions = []
        for action in group["actions"]:
            label = {"create": "Create in Anki", "import": "Append to CSV",
                     "link": "Link CSV row to Anki"}[action["action"]]
            values = html.escape(json.dumps(action["fields"], ensure_ascii=False, indent=2))
            target = html.escape(str(action.get("deck", group["path"])))
            details = []
            if "row" in action:
                details.append(f"CSV row {action['row']}")
            if "model" in action:
                details.append(f"Note type: {action['model']}")
            tags = action.get("tags", action.get("record", {}).get("tags", ""))
            if tags:
                details.append(f"Tags: {' '.join(tags) if isinstance(tags, list) else tags}")
            detail_text = html.escape("; ".join(details))
            additions.append(f'<tr><td>{label}<br>{detail_text}</td><td>{action.get("note_id", "new")}</td><td>{target}</td><td><pre>{values}</pre></td></tr>')
        sections.append(f'<section><h2>{html.escape(group["definition"])}: additions</h2><p>CSV IDs are written back when this plan is applied.</p><table><tr><th>Action</th><th>Anki ID</th><th>Destination</th><th>Fields</th></tr>{"".join(additions)}</table></section>')
    for definition in plan["definitions"]:
        rows = by_definition[definition]
        fields = [field.anki for field in config_for(
            definition, plan.get("source_kind", "structural")).fields]
        counts = Counter(field for row in rows for field in row["updates"])
        tag_changes = sum(bool(row.get("add_tags") or row.get("local_add_tags")) for row in rows)
        changed = sum(row["changed"] for row in rows)
        field_summary = ", ".join(
            f"{html.escape(field)}: {counts[field]}" for field in fields if counts[field]
        )
        if tag_changes:
            field_summary = ", ".join(filter(None, (field_summary, f"Tags: {tag_changes}")))
        field_summary = field_summary or "no field or tag changes"
        summary.append(f'<a href="#def-{html.escape(definition, quote=True)}"><b>{html.escape(definition)}</b><span>{changed}/{len(rows)} notes · {sum(counts.values())} fields · {tag_changes} tags<br>{field_summary}</span></a>')
        heads = "".join(f'<th class="field" data-field="{html.escape(field, quote=True)}">{html.escape(field)}</th>' for field in fields)
        heads += '<th class="field" data-field="$tags">Tags</th>'
        body: list[str] = []
        for row in rows:
            changed_fields = set(row["updates"])
            cells: list[str] = []
            for field in fields:
                old = row["before"]["fields"].get(field, "")
                unavailable = field in row["unavailable_fields"]
                new = old if unavailable else row["fields"].get(field, "")
                left, right = inline_diff(old, new)
                status = "unavailable" if unavailable else ("changed" if field in changed_fields else "unchanged")
                cells.append(f'<td class="field {status}" data-field="{html.escape(field, quote=True)}"><div class="old"><label>Anki</label>{left}</div><div class="new"><label>Obsidian</label>{right}</div></td>')
            old_tags = " ".join(sorted(row["before"].get("tags", [])))
            new_tags = " ".join(sorted(
                set(row["before"].get("tags", [])) | set(row.get("add_tags", []))
            ))
            old_tag_html, new_tag_html = inline_diff(old_tags, new_tags)
            tag_status = "changed" if row.get("add_tags") or row.get("local_add_tags") else "unchanged"
            local_tag_html = (f'<div><label>Update local source tags</label>{html.escape(" ".join(row["local_add_tags"]))}</div>'
                              if row.get("local_add_tags") else "")
            cells.append(
                f'<td class="field {tag_status}" data-field="$tags">'
                f'<div class="old"><label>Anki</label>{old_tag_html}</div>'
                f'<div class="new"><label>Proposed</label>{new_tag_html}</div>{local_tag_html}</td>'
            )
            issues = row.get("issues", [])
            warnings = row.get("warnings", [])
            row_status = ("error" if issues else "warning" if warnings
                          else "changed" if row["changed"] else "unchanged")
            change_count = len(changed_fields) + bool(row.get("add_tags")) + bool(row.get("local_add_tags"))
            search_text = (str(row["note_id"]) + " " + row["path"] + " "
                           + " ".join(row["fields"].values()) + " " + new_tags)
            body.append(f'<tr data-changed="{str(bool(row["changed"] or issues)).lower()}" data-media="{str(bool(row["media"] or issues)).lower()}" data-search="{html.escape(search_text.casefold(), quote=True)}"><td class="identity">{row["note_id"]}</td><td class="identity path">{html.escape(row["path"])}</td><td class="identity number">{change_count}</td><td class="identity {row_status}">{row_status}</td>{"".join(cells)}</tr>')
        toggles = "".join(f'<label><input type="checkbox" class="column" data-field="{html.escape(field, quote=True)}" checked> {html.escape(field)}</label>' for field in fields)
        toggles += '<label><input type="checkbox" class="column" data-field="$tags" checked> Tags</label>'
        contents = f'<div class="controls"><input class="search" placeholder="Search notes"><label><input type="checkbox" class="unchanged"> Include unchanged</label><label><input type="checkbox" class="media-only"> Media references only</label><select class="page-size"><option>25</option><option>50</option><option>100</option><option value="999999">All</option></select><div class="columns">{toggles}</div></div><div class="table-wrap"><table><thead><tr><th data-sort="number">Note ID</th><th data-sort="text">Obsidian path</th><th data-sort="number">Changes</th><th data-sort="text">Status</th>{heads}</tr></thead><tbody>{"".join(body)}</tbody></table></div><div class="pager"><button class="prev">Previous</button><span></span><button class="next">Next</button></div>'
        # Templates keep thousands of table cells out of the live DOM until a
        # group is opened.  This substantially reduces initial layout work.
        sections.append(f'<section id="def-{html.escape(definition, quote=True)}" data-definition="{html.escape(definition, quote=True)}"><h2><button class="open-group">Open {html.escape(definition)}</button></h2><template>{contents}</template></section>')
    media_rows = "".join(f'<tr data-status="{item["status"]}"><td>{html.escape(item["filename"])}</td><td>{item["status"]}</td><td>{html.escape(item["path"])}</td><td><code>{item["sha256"]}</code></td></tr>' for item in plan["media"] if item["status"] != "unchanged")
    media_rows += "".join(f'<tr data-status="missing"><td>{html.escape(Path(issue["path"]).name)}</td><td>missing (error)</td><td>{html.escape(issue["path"])}</td><td></td></tr>' for issue in plan.get("issues", []) if issue["kind"] == "missing_attachment")
    data = html.escape(canonical({"definitions": plan["definitions"]}), quote=True)
    return f'''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Structural sync review</title><style>
body{{font:14px system-ui;margin:0;background:#f6f7f9;color:#202124}}header,main{{padding:20px}}header{{background:#202124;color:white}}nav{{display:flex;gap:10px;flex-wrap:wrap}}nav a{{background:white;color:#202124;padding:10px;text-decoration:none;border-radius:6px}}nav span{{display:block;color:#666}}section{{background:white;margin:18px 0;padding:16px;border-radius:8px}}.controls{{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:10px}}.columns{{display:flex;gap:8px;flex-wrap:wrap}}.table-wrap{{overflow:auto;max-height:70vh}}table{{border-collapse:separate;border-spacing:0;min-width:100%}}th,td{{border:1px solid #ddd;padding:7px;vertical-align:top;white-space:pre-wrap;min-width:160px}}th{{position:sticky;top:0;background:#eceff3;z-index:3;cursor:pointer}}.identity{{position:sticky;background:white;z-index:2;min-width:75px}}td:nth-child(1),th:nth-child(1){{left:0}}td:nth-child(2),th:nth-child(2){{left:90px;min-width:260px}}td:nth-child(3),th:nth-child(3){{left:365px}}td:nth-child(4),th:nth-child(4){{left:455px}}.old,.new{{max-height:180px;overflow:auto}}label{{font-size:12px;color:#555}}del{{background:#ffd7d5;text-decoration:none}}ins{{background:#c9f3d2;text-decoration:none}}.changed{{background:#fffdf5}}.pager{{margin-top:10px;display:flex;gap:10px}}code{{font-size:11px}}[hidden]{{display:none!important}}
</style></head><body><header><h1>Reviewed sync</h1><p>Generated {html.escape(plan["created_at"])}. Anki content is shown as escaped text.</p>{f'<p class="error"><b>{len(plan.get("issues", []))} blocking error(s).</b> Fix them and regenerate this review before applying.</p>' if plan.get("issues") else ''}{f'<p class="warning"><b>{len(plan.get("warnings", []))} warning(s).</b> See the source warnings and affected notes below.</p>' if plan.get("warnings") else ''}<nav>{''.join(summary)}</nav></header><main>{''.join(sections)}<section id="media"><h2>Media changes</h2><label>Filter <select id="media-filter"><option value="all">All changes and errors</option><option value="addition">New uploads</option><option value="replacement">Replacements</option><option value="missing">Missing (errors)</option></select></label><div class="table-wrap"><table><thead><tr><th>Filename</th><th>Status</th><th>Source</th><th>SHA-256</th></tr></thead><tbody>{media_rows}</tbody></table></div></section></main><div id="report-data" data-json="{data}" hidden></div><script>
function activate(s){{if(s.dataset.loaded)return;s.dataset.loaded='true';s.append(s.querySelector('template').content.cloneNode(true));let page=0,sort=0,dir=1;const rows=[...s.querySelectorAll('tbody tr')];function draw(){{const q=s.querySelector('.search').value.toLowerCase(),unch=s.querySelector('.unchanged').checked,media=s.querySelector('.media-only').checked,size=+s.querySelector('.page-size').value;let visible=rows.filter(r=>(unch||r.dataset.changed==='true')&&(!media||r.dataset.media==='true')&&r.dataset.search.includes(q));visible.sort((a,b)=>{{let x=a.cells[sort].innerText,y=b.cells[sort].innerText;if(s.querySelectorAll('th')[sort].dataset.sort==='number'){{x=+x;y=+y}}return (x<y?-1:x>y?1:0)*dir}});let pages=Math.max(1,Math.ceil(visible.length/size));page=Math.min(page,pages-1);rows.forEach(r=>r.hidden=true);visible.slice(page*size,(page+1)*size).forEach(r=>r.hidden=false);s.querySelector('.pager span').textContent=`Page ${{page+1}} of ${{pages}} (${{visible.length}} notes)`}}s.querySelectorAll('.search,.unchanged,.media-only,.page-size').forEach(e=>e.addEventListener('input',()=>{{page=0;draw()}}));s.querySelector('.prev').onclick=()=>{{page=Math.max(0,page-1);draw()}};s.querySelector('.next').onclick=()=>{{page++;draw()}};s.querySelectorAll('th').forEach((th,i)=>th.onclick=()=>{{if(sort===i)dir=-dir;else{{sort=i;dir=1}}draw()}});s.querySelectorAll('.column').forEach(c=>c.onchange=()=>s.querySelectorAll(`[data-field="${{CSS.escape(c.dataset.field)}}"]`).forEach(x=>x.hidden=!c.checked));draw()}}
document.querySelectorAll('section[data-definition]').forEach(s=>s.querySelector('.open-group').onclick=()=>activate(s));document.querySelectorAll('nav a').forEach(a=>a.onclick=()=>activate(document.querySelector(a.getAttribute('href'))));
document.querySelector('#media-filter').onchange=e=>document.querySelectorAll('#media tbody tr').forEach(r=>r.hidden=e.target.value!=='all'&&r.dataset.status!==e.target.value);
</script></body></html>'''


def write_report(plan: dict[str, Any], destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    (destination / "plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_csvs(plan, destination)
    (destination / "index.html").write_text(report_html(plan), encoding="utf-8")


def write_analysis_reports(
    plan: dict[str, Any], destination: Path, split_groups: bool = False
) -> list[Path]:
    """Write an aggregate review and, for ``all``, each applicable group.

    Group reviews are siblings of the aggregate directory.  Thus the default
    aggregate ``review/structural/all`` refreshes such independently applicable
    snapshots as ``review/structural/elements`` from the same Anki read.
    """
    written: list[Path] = []
    if split_groups:
        for definition in plan["definitions"]:
            group_destination = destination.parent / definition
            write_report(select_plan_group(plan, definition), group_destination)
            written.append(group_destination)
    write_report(plan, destination)
    written.append(destination)
    return written


def media_change_summary(plan: dict[str, Any]) -> str:
    """Describe pending media uploads, which change no note field."""
    counts = Counter(item["status"] for item in plan.get("media", []))
    return (f"{counts['replacement']} media replacement(s), "
            f"{counts['addition']} new media file(s)")


def analysis_group_statuses(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """Summarize an aggregate analysis using the same per-group snapshots."""
    statuses: list[dict[str, Any]] = []
    for definition in plan.get("definitions", []):
        selected = select_plan_group(plan, definition)
        statuses.append({
            "definition": definition,
            "notes": len(selected["notes"]),
            "changes": sum(bool(row["changed"]) for row in selected["notes"]),
            "media": media_change_summary(selected),
            "warnings": len(selected.get("warnings", [])),
            "issues": len(selected.get("issues", [])),
        })
        if selected.get("list_additions"):
            statuses[-1]["additions"] = sum(len(group["actions"]) for group in selected["list_additions"])
    return statuses


def select_plan_group(plan: dict[str, Any], group: str | None) -> dict[str, Any]:
    """Return an immutable-plan subset containing one reviewed definition."""
    if group is None:
        return plan
    if group not in plan.get("definitions", []):
        raise exporter.ExportError(f"group {group!r} is not present in this plan")
    selected = dict(plan)
    selected["definitions"] = [group]
    selected["notes"] = [row for row in plan["notes"] if row["definition"] == group]
    selected["list_additions"] = [item for item in plan.get("list_additions", [])
                                  if item["definition"] == group]
    selected["local_tag_changes"] = local_tags.select(plan.get("local_tag_changes", []), group)
    selected["issues"] = [issue for issue in plan.get("issues", [])
                          if issue.get("definition") == group]
    selected["warnings"] = [warning for warning in plan.get("warnings", [])
                            if warning.get("definition") == group]
    selected["media"] = [item for item in plan["media"]
                         if group in item.get("definitions", plan["definitions"])]
    used_models = {row["before"]["model"] for row in selected["notes"]}
    selected["schemas"] = {model: fields for model, fields in plan.get("schemas", {}).items()
                           if model in used_models}
    return selected


def verify_preflight(plan: dict[str, Any], client: Any, batch_size: int) -> list[dict[str, Any]]:
    vault = Path(plan["vault"])
    source_kind = plan.get("source_kind", "structural")
    if source_kind == "list":
        additions = list_additions.build(plan["definitions"], vault, client, batch_size)
        if canonical(additions) != canonical(plan.get("list_additions", [])):
            raise exporter.ExportError("CSV sources, Anki candidates, or creation configuration drifted since review")
    progress("Preflight: rendering vault sources")
    current_rows = (render_blocks(vault) if source_kind == "block" else
                    [row for name in plan["definitions"]
                     for row in render_definition(
                         name, exporter.EXPORTS[name], vault, source_kind)])
    tag_changes = local_tags.build(current_rows, source_kind)
    if canonical(tag_changes) != canonical(plan.get("local_tag_changes", [])):
        raise exporter.ExportError("local managed tags or source files drifted since review")
    expected_source = {row["note_id"]: (row["path"], row["fields"], row["unavailable_fields"], row["media"], row.get("desired_tags", []))
                       for row in plan["notes"]}
    actual_source = {row["note_id"]: (row["path"], row["fields"], row["unavailable_fields"], row["media"], row.get("desired_tags", []))
                     for row in current_rows}
    if canonical(actual_source) != canonical(expected_source):
        raise exporter.ExportError("local source or media drifted since review")
    progress(f"Preflight: reading {len(expected_source)} Anki notes")
    notes = fetch_notes(client, sorted(expected_source), batch_size)
    if set(notes) != set(expected_source):
        raise exporter.ExportError("one or more reviewed Anki notes no longer exist")
    planned = {row["note_id"]: row["before"] for row in plan["notes"]}
    actual = {key: snapshot_note(value) for key, value in notes.items()}
    if canonical(actual) != canonical(planned):
        raise exporter.ExportError("Anki note fields, tags, or note types drifted since review")
    for model, fields in plan.get("schemas", {}).items():
        current_fields = client.invoke("modelFieldNames", modelName=model)
        if current_fields != fields:
            raise exporter.ExportError(f"Anki note type schema drifted since review: {model}")
    for item in track("Preflight: checking Anki media", plan["media"]):
        current_hash, _ = retrieve_media(client, item["filename"])
        if current_hash != item["before_sha256"]:
            raise exporter.ExportError(f"Anki media drifted since review: {item['filename']}")
    return current_rows


def apply_plan(plan: dict[str, Any], client: Any, batch_size: int) -> dict[str, Any]:
    result: dict[str, Any] = {"started_at": datetime.now(timezone.utc).isoformat(),
                             "success": False, "operations": [], "verification": [],
                             "rollback_errors": []}
    applied_media: list[dict[str, Any]] = []
    updated: list[dict[str, Any]] = []
    tagged: list[tuple[int, str]] = []
    created: list[int] = []
    written: list[tuple[Path, bytes]] = []
    managed_tag = str(plan.get("managed_tag", ""))
    try:
        source_kind = plan.get("source_kind", "structural")
        if (plan.get("format_version") != FORMAT_VERSION
                or managed_tag != MANAGED_TAGS.get(source_kind)):
            raise exporter.ExportError("unsupported or invalid reviewed sync plan")
        if plan.get("issues"):
            raise exporter.ExportError(
                f"plan contains {len(plan['issues'])} blocking error(s); fix them and regenerate the review"
            )
        verify_preflight(plan, client, batch_size)
        for item in track("Preflight: checking rollback copies",
                          [item for item in plan["media"] if item["status"] == "replacement"]):
            if item["status"] == "replacement":
                # Fail before any write if a rollback copy is unusable.
                media_backup_base64(item)
        result["operations"].append({"kind": "preflight", "status": "success"})
        for item in track("Storing media",
                          [item for item in plan["media"] if item["status"] != "unchanged"]):
            # Record before invoking: a transport error can occur after Anki
            # has committed the write, so rollback must treat it as uncertain.
            applied_media.append(item)
            store_media(client, item["filename"], Path(item["path"]), item["sha256"])
            result["operations"].append({"kind": "media", "filename": item["filename"], "status": "success"})
        for row in track("Updating note fields",
                         [row for row in plan["notes"] if row["updates"]]):
            updated.append(row)
            client.invoke("updateNoteFields", note={"id": row["note_id"], "fields": row["updates"]})
            result["operations"].append({"kind": "fields", "note_id": row["note_id"], "status": "success"})
        for row in track("Tagging notes", plan["notes"]):
            for tag in row.get("add_tags", [managed_tag] if managed_tag not in row["before"]["tags"] else []):
                tagged.append((row["note_id"], tag))
                client.invoke("addTags", notes=[row["note_id"]], tags=tag)
                result["operations"].append({"kind": "tag", "note_id": row["note_id"], "tag": tag, "status": "success"})
        progress("Verifying applied notes")
        reread = fetch_notes(client, [row["note_id"] for row in plan["notes"]], batch_size)
        for row in plan["notes"]:
            note = snapshot_note(reread[row["note_id"]])
            expected_fields = dict(row["before"]["fields"]); expected_fields.update(row["updates"])
            expected_tags = set(row["before"]["tags"]) | set(row.get("add_tags", [managed_tag]))
            ok = note["fields"] == expected_fields and set(note["tags"]) == expected_tags
            result["verification"].append({"note_id": row["note_id"], "success": ok})
            if not ok: raise exporter.ExportError(f"post-apply verification failed for note {row['note_id']}")
        csv_hashes = list_additions.apply(plan.get("list_additions", []), client, created,
                                         written, tagged, result["operations"])
        local_tags.apply(plan.get("local_tag_changes", []), csv_hashes,
                         written, result["operations"])
        result["success"] = True
    except Exception as error:
        result["error"] = str(error)
        result["operations"].append({"kind": "failure", "status": "failed",
                                     "error": str(error)})
        progress(f"Failed: {error}")
        progress("Rolling back")
        for path, data in reversed(written):
            try: list_additions.atomic_write(path, data)
            except Exception as rollback: result["rollback_errors"].append({"kind": "csv", "path": str(path), "error": str(rollback)})
        for note_id, tag in reversed(tagged):
            try: client.invoke("removeTags", notes=[note_id], tags=tag)
            except Exception as rollback: result["rollback_errors"].append({"kind": "tag", "note_id": note_id, "tag": tag, "error": str(rollback)})
        for row in reversed(updated):
            try:
                prior = {name: row["before"]["fields"].get(name, "") for name in row["updates"]}
                client.invoke("updateNoteFields", note={"id": row["note_id"], "fields": prior})
            except Exception as rollback: result["rollback_errors"].append({"kind": "fields", "note_id": row["note_id"], "error": str(rollback)})
        for note_id in reversed(created):
            try: client.invoke("deleteNotes", notes=[note_id])
            except Exception as rollback: result["rollback_errors"].append({"kind": "create", "note_id": note_id, "error": str(rollback)})
        for item in track("Rolling back media", list(reversed(applied_media))):
            try:
                if item["status"] == "addition": client.invoke("deleteMediaFile", filename=item["filename"])
                elif item.get("before_backup"):
                    store_media(client, item["filename"], Path(item["before_backup"]), item["before_sha256"])
                else: client.invoke("storeMediaFile", filename=item["filename"], data=media_backup_base64(item))
            except Exception as rollback: result["rollback_errors"].append({"kind": "media", "filename": item["filename"], "error": str(rollback)})
    result["finished_at"] = datetime.now(timezone.utc).isoformat()
    return result


def default_review_dir(definition: str, source_kind: str = "structural") -> Path:
    """Return the source-namespaced review directory for one CLI group."""
    namespace = {"structural": "structural", "list": "lists", "block": "blocks"}
    try:
        parent = namespace[source_kind]
    except KeyError as error:
        raise exporter.ExportError(f"unknown review source kind: {source_kind}") from error
    return REPOSITORY_ROOT / "review" / parent / definition


def run(args: argparse.Namespace, client: Any | None = None) -> tuple[dict[str, Any], int]:
    if client is None:
        client = AnkiConnect(args.url, os.environ.get("ANKI_CONNECT_API_KEY"), args.timeout, args.retries)
    explicit_plan = getattr(args, "apply_plan", None)
    apply_saved = getattr(args, "apply", False)
    source_kind = getattr(args, "source_kind", "structural")
    report_dir = (getattr(args, "report_dir", None)
                  or default_review_dir(args.definition, source_kind))
    if explicit_plan or apply_saved:
        path = (explicit_plan or (report_dir / "plan.json")).expanduser().resolve()
        plan = select_plan_group(
            json.loads(path.read_text(encoding="utf-8")),
            getattr(args, "apply_group", None),
        )
        result = apply_plan(plan, client, args.batch_size)
        log = path.parent / "application-result.json"
        log.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return result, 0 if result["success"] else 1
    vault = args.vault.expanduser().resolve()
    report_dir = report_dir.expanduser().resolve()
    plan = build_plan(args.definition, vault, client, args.batch_size, source_kind,
                      report_dir / MEDIA_BACKUP_DIRECTORY)
    write_analysis_reports(
        plan,
        report_dir,
        split_groups=args.definition == "all",
    )
    return plan, 0


def main() -> int:
    structural = sorted(name for name, config in exporter.EXPORTS.items() if config.classification == "structural")
    lists = sorted(exporter.CSV_EXPORTS)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("definition")
    parser.add_argument("--source-kind", choices=["structural", "list", "block"], default="structural")
    parser.add_argument("--vault", type=Path, default=exporter.DEFAULT_VAULT)
    parser.add_argument(
        "--report-dir", type=Path,
        help="review directory (default: review/<source-kind>/<definition>)",
    )
    application = parser.add_mutually_exclusive_group()
    application.add_argument(
        "--apply", action="store_true",
        help="apply the saved review/<definition>/plan.json snapshot",
    )
    application.add_argument(
        "--apply-plan", type=Path,
        help="apply an explicitly located reviewed plan (legacy/automation)",
    )
    parser.add_argument("--apply-group", choices=sorted(set(structural + lists)))
    parser.add_argument("--url", default="http://127.0.0.1:8765")
    parser.add_argument("--timeout", type=float, default=10)
    parser.add_argument("--retries", type=int, default=1)
    parser.add_argument("--batch-size", type=int, default=250)
    args = parser.parse_args()
    choices = (structural if args.source_kind == "structural" else
               lists if args.source_kind == "list" else ["blocks"])
    if args.definition not in {"all", *choices}:
        parser.error(f"unknown {args.source_kind} definition: {args.definition}")
    global PROGRESS_ENABLED
    PROGRESS_ENABLED = True
    try:
        report, status = run(args)
    except (exporter.ExportError, OSError, ValueError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr); return 1
    if args.apply or args.apply_plan:
        if status == 0:
            print("Reviewed plan applied and verified.")
        else:
            mutations = [
                operation for operation in report.get("operations", [])
                if operation.get("kind") in {"media", "fields", "tag", "create", "import", "link", "local_tags"}
                and operation.get("status") == "success"
            ]
            outcome = (
                "rollback attempted"
                if mutations else
                "Anki was not changed"
            )
            print(
                f"Reviewed plan failed: {report.get('error', 'unknown error')} "
                f"({outcome})."
            )
    else:
        changed = sum(bool(row["changed"]) for row in report["notes"])
        additions = sum(len(group["actions"]) for group in report.get("list_additions", []))
        issues = len(report.get("issues", []))
        suffix = f"; {issues} blocking error(s) flagged" if issues else ""
        if additions:
            suffix += f"; {additions} addition(s) or new link(s)"
        destination = (args.report_dir or default_review_dir(
            args.definition, args.source_kind)).expanduser().resolve()
        if args.definition == "all":
            print(
                f"Analysis only; Anki was not changed. Refreshed "
                f"{len(report['definitions'])} group review(s) and wrote the "
                f"aggregate view at {destination} for {len(report['notes'])} "
                f"note(s); {changed} proposed change(s); "
                f"{media_change_summary(report)}{suffix}."
            )
            for group in analysis_group_statuses(report):
                details = [
                    f"{group['notes']} note(s)",
                    f"{group['changes']} proposed change(s)",
                    group["media"],
                ]
                if group.get("additions"):
                    details.append(f"{group['additions']} addition(s) or new link(s)")
                if group["warnings"]:
                    details.append(f"{group['warnings']} warning(s)")
                if group["issues"]:
                    details.append(f"{group['issues']} blocking error(s)")
                print(f"  {group['definition']}: {'; '.join(details)}")
        else:
            print(
                f"Analysis only; Anki was not changed. Wrote {destination} for "
                f"{len(report['notes'])} note(s); {changed} proposed change(s); "
                f"{media_change_summary(report)}{suffix}."
            )
    return status


if __name__ == "__main__":
    raise SystemExit(main())
