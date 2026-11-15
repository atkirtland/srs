"""Review and write managed tags into CSV rows and Obsidian Markdown."""
from __future__ import annotations

import base64
import csv
import hashlib
import io
import re
from pathlib import Path
from typing import Any

import block_notes
import list_additions
import sources
from managed_tags import MANAGED_TAGS


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encoded_csv(raw: bytes, columns: list[str], records: list[dict[str, str]]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns,
                            lineterminator="\r\n" if b"\r\n" in raw else "\n")
    writer.writeheader()
    writer.writerows(records)
    return output.getvalue().encode("utf-8-sig" if raw.startswith(b"\xef\xbb\xbf") else "utf-8")


def has_tag(tags: list[str], target: str) -> bool:
    return any(tag.lstrip("#").replace("/", "::") == target for tag in tags)


def block_tag_line(quoted: str, newline: str) -> str:
    """Put the managed tag on an existing metadata line when available."""
    managed = "#" + MANAGED_TAGS["block"].replace("::", "/")
    token = re.compile(r"(?<!\S)" + re.escape(managed) + r"(?!\S)")
    lines = quoted.splitlines(keepends=True)
    metadata = []
    for index, line in enumerate(lines):
        content = re.sub(r"^>[ \t]?", "", line.rstrip("\r\n"))
        if block_notes.TAG_ONLY_RE.fullmatch(content):
            metadata.append(index)
    if not metadata:
        return quoted + f"> {managed}{newline}"
    # Prefer a line with user tags over a standalone managed-tag line left
    # by the previous writer. Keep other metadata and answer lines intact.
    target = next((index for index in metadata
                   if token.sub("", re.sub(r"^>[ \t]?", "", lines[index])).strip()), metadata[0])
    for index in metadata:
        line = lines[index]
        ending = "\r\n" if line.endswith("\r\n") else ("\n" if line.endswith("\n") else "")
        body = line[:-len(ending)] if ending else line
        if index == target:
            if not token.search(body):
                lines[index] = body.rstrip(" \t") + f"  {managed}" + ending
        elif token.search(body):
            body = token.sub("", body)
            lines[index] = body.rstrip(" \t") + ending if body.lstrip("> \t") else ""
    return "".join(lines)


def patch_markdown(raw: bytes, edits: list[dict[str, Any]], kind: str) -> bytes:
    if kind == "structural":
        return raw
    text = raw.decode("utf-8")
    newline = "\r\n" if "\r\n" in text else "\n"
    if kind == "block":
        ids = {edit["note_id"] for edit in edits}
        for match in reversed(list(block_notes.ANKI_CALLOUT_RE.finditer(text))):
            if int(match["note_id"]) in ids:
                text = (text[:match.start("quoted")] + block_tag_line(match["quoted"], newline)
                        + text[match.end("quoted"):])
        return text.encode("utf-8")

    raise sources.ExportError(f"unsupported Markdown source kind: {kind}")


def patch(raw: bytes, edits: list[dict[str, Any]], kind: str) -> bytes:
    if kind != "list":
        return patch_markdown(raw, edits, kind)
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""))
    records = list(reader)
    for edit in edits:
        record = records[edit["row"] - 2]
        tags = record["tags"].split()
        if MANAGED_TAGS[kind] not in tags:
            record["tags"] = " ".join([*tags, MANAGED_TAGS[kind]])
    return encoded_csv(raw, reader.fieldnames, records)


def build(rows: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    if kind == "structural":
        for row in rows:
            row["local_add_tags"] = []
        return []
    grouped: dict[Path, list[dict[str, Any]]] = {}
    csv_records: dict[Path, list[dict[str, str]]] = {}
    block_layout: dict[Path, set[int]] = {}
    for row in rows:
        if kind == "list":
            source, number = row["path"].rsplit("#row-", 1)
            path = Path(source)
            if path not in csv_records:
                _, _, csv_records[path] = list_additions.read_csv(path)
            records = csv_records[path]
            tags = records[int(number) - 2]["tags"].split()
            edit = {"row": int(number)}
        elif kind == "block":
            path = Path(row["path"])
            tags = row["desired_tags"]
            edit = {}
            if path not in block_layout:
                content = path.read_bytes().decode("utf-8")
                newline = "\r\n" if "\r\n" in content else "\n"
                block_layout[path] = {int(match["note_id"]) for match in
                                      block_notes.ANKI_CALLOUT_RE.finditer(content)
                                      if block_tag_line(match["quoted"], newline) != match["quoted"]}
        else:
            raise sources.ExportError(f"unsupported local tag source kind: {kind}")
        present = MANAGED_TAGS[kind] in tags if kind == "list" else has_tag(tags, MANAGED_TAGS[kind])
        if present and not (kind == "block" and row["note_id"] in block_layout[path]):
            row["local_add_tags"] = []
            continue
        edit.update({"note_id": row["note_id"], "definition": row["definition"]})
        grouped.setdefault(path, []).append(edit)
        row["local_add_tags"] = [MANAGED_TAGS[kind] if kind == "list"
                                  else MANAGED_TAGS[kind].replace("::", "/")]
        row["changed"] = True
    result = []
    for path, edits in grouped.items():
        raw = path.read_bytes()
        proposed = patch(raw, edits, kind)
        result.append({"path": str(path), "kind": kind, "edits": edits,
                       "before_sha256": digest(raw),
                       "before_base64": base64.b64encode(raw).decode(),
                       "after_base64": base64.b64encode(proposed).decode()})
    return result


def select(changes: list[dict[str, Any]], definition: str) -> list[dict[str, Any]]:
    selected = []
    for change in changes:
        edits = [edit for edit in change["edits"] if edit["definition"] == definition]
        if edits:
            raw = base64.b64decode(change["before_base64"])
            selected.append({**change, "edits": edits,
                             "after_base64": base64.b64encode(patch(raw, edits, change["kind"])).decode()})
    return selected


def apply(changes: list[dict[str, Any]], csv_hashes: dict[str, str],
          written: list[tuple[Path, bytes]], operations: list[dict[str, Any]]) -> None:
    for change in changes:
        path = Path(change["path"])
        raw = path.read_bytes()
        if digest(raw) != csv_hashes.get(str(path), change["before_sha256"]):
            raise sources.ExportError(f"local source drifted before tagging: {path}")
        proposed = patch(raw, change["edits"], change["kind"])
        written.append((path, raw))
        list_additions.atomic_write(path, proposed)
        if path.read_bytes() != proposed:
            raise sources.ExportError(f"local managed-tag verification failed: {path}")
        operations.append({"kind": "local_tags", "path": str(path), "status": "success"})
