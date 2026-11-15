#!/usr/bin/env python3
"""Export Anki notes to round-trip-friendly Markdown through AnkiConnect."""

from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path, PurePath
from typing import Any, Iterable

import yaml
from bs4 import BeautifulSoup, NavigableString, Tag
from markdownify import markdownify as html_to_markdown


FORMAT_VERSION = 1
DEFAULT_URL = "http://127.0.0.1:8765"
SOUND_RE = re.compile(r"\[sound:([^\]\r\n]+)\]", re.IGNORECASE)
CLOZE_RE = re.compile(r"\{\{c\d+::(.*?)(?:::[^{}]*?)?\}\}", re.IGNORECASE)
SAFE_TAGS = {
    "a", "b", "blockquote", "br", "code", "del", "div", "em", "h1", "h2",
    "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre",
    "s", "strike", "strong", "sub", "sup", "table", "tbody", "td", "th",
    "thead", "tr", "u", "ul",
}
SEMANTIC_ATTRS = {"a": {"href", "title"}, "img": {"src", "alt", "title"}}
MEDIA_EXTENSIONS = {
    ".aac", ".avi", ".flac", ".gif", ".jpeg", ".jpg", ".m4a", ".mkv",
    ".mov", ".mp3", ".mp4", ".mpeg", ".ogg", ".opus", ".png", ".svg",
    ".wav", ".webm", ".webp",
}


class ExportError(RuntimeError):
    pass


def chunks(items: list[Any], size: int) -> Iterable[list[Any]]:
    for start in range(0, len(items), size):
        yield items[start:start + size]


class AnkiConnect:
    def __init__(self, url: str, api_key: str | None, timeout: float, retries: int) -> None:
        self.url = url
        self.api_key = api_key
        self.timeout = timeout
        self.retries = retries

    def invoke(self, action: str, **params: Any) -> Any:
        payload: dict[str, Any] = {"action": action, "version": 6}
        if params:
            payload["params"] = params
        if self.api_key:
            payload["key"] = self.api_key
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            self.url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        last_error: Exception | None = None
        # A transport failure may happen after creation commits. The list sync
        # recovers addNote via a unique tag instead of retrying the mutation.
        retries = 0 if action == "addNote" else self.retries
        for attempt in range(retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    raw = response.read()
                decoded = json.loads(raw.decode("utf-8"))
                if not isinstance(decoded, dict) or "result" not in decoded:
                    raise ExportError(f"Malformed response for {action}: missing result")
                if decoded.get("error") is not None:
                    raise ExportError(f"AnkiConnect {action} failed: {decoded['error']}")
                return decoded["result"]
            except ExportError:
                raise
            except (OSError, urllib.error.URLError, json.JSONDecodeError, UnicodeDecodeError) as exc:
                last_error = exc
                if attempt < retries:
                    time.sleep(0.25 * (2 ** attempt))
        raise ExportError(
            f"Could not call AnkiConnect at {self.url} for {action}: {last_error}. "
            "Make sure Anki is open and the AnkiConnect add-on is installed."
        )


def slugify(value: str, max_length: int = 80) -> str:
    normalized = html.unescape(value)
    normalized = BeautifulSoup(normalized, "html.parser").get_text(" ", strip=True)
    normalized = normalized.casefold()
    normalized = re.sub(r"[^\w.-]+", "-", normalized, flags=re.UNICODE)
    normalized = re.sub(r"[-_.]{2,}", "-", normalized).strip("-._")
    normalized = normalized or "untitled"
    if len(normalized) > max_length:
        digest = hashlib.sha256(normalized.encode()).hexdigest()[:10]
        normalized = f"{normalized[:max_length - 11].rstrip('-._')}-{digest}"
    return normalized


def first_field(note: dict[str, Any]) -> tuple[str, str]:
    ordered = sorted(note["fields"].items(), key=lambda pair: pair[1].get("order", 0))
    return (ordered[0][0], ordered[0][1].get("value", "")) if ordered else ("", "")


def title_text(field_html: str) -> str:
    text = BeautifulSoup(field_html, "html.parser").get_text(" ", strip=True)
    return CLOZE_RE.sub(lambda match: match.group(1), text)


def is_external_reference(value: str) -> bool:
    parsed = urllib.parse.urlparse(value)
    return bool(parsed.scheme) or value.startswith(("#", "//"))


def referenced_media(field_html: str) -> list[tuple[str, str]]:
    refs: list[tuple[str, str]] = []
    soup = BeautifulSoup(field_html, "html.parser")
    for image in soup.find_all("img"):
        src = image.get("src")
        if src and not is_external_reference(src):
            refs.append(("image", urllib.parse.unquote(src)))
    refs.extend(("sound", match.group(1)) for match in SOUND_RE.finditer(field_html))
    return refs


def safe_media_name(original: str) -> str:
    clean = urllib.parse.unquote(original).replace("\\", "/")
    basename = PurePath(clean).name
    if basename == clean and basename not in {"", ".", ".."}:
        return basename
    suffix = Path(basename).suffix if Path(basename).suffix.lower() in MEDIA_EXTENSIONS else ""
    return f"media-{hashlib.sha256(original.encode()).hexdigest()[:16]}{suffix}"


def build_media_names(originals: set[str]) -> dict[str, str]:
    preliminary = {original: safe_media_name(original) for original in originals}
    collisions: dict[str, list[str]] = defaultdict(list)
    for original, local_name in preliminary.items():
        collisions[local_name.casefold()].append(original)
    result: dict[str, str] = {}
    for originals_with_name in collisions.values():
        for original in sorted(originals_with_name):
            local_name = preliminary[original]
            if len(originals_with_name) > 1:
                path = Path(local_name)
                digest = hashlib.sha256(original.encode()).hexdigest()[:8]
                local_name = f"{path.stem}-{digest}{path.suffix}"
            result[original] = local_name
    return result


def problematic_tag(tag: Tag) -> bool:
    name = tag.name.lower()
    if name not in SAFE_TAGS:
        return True
    allowed = SEMANTIC_ATTRS.get(name, set())
    return any(attribute.lower() not in allowed for attribute in tag.attrs)


def inspect_html(field_html: str) -> list[dict[str, Any]]:
    soup = BeautifulSoup(field_html, "html.parser")
    issues: list[dict[str, Any]] = []
    for tag in soup.find_all(True):
        if problematic_tag(tag):
            issues.append({
                "tag": tag.name.lower(),
                "attributes": sorted(tag.attrs),
                "sample": str(tag)[:300],
            })
    return issues


def relative_media_link(note_path: Path, media_path: Path) -> str:
    return Path(os.path.relpath(media_path, start=note_path.parent)).as_posix()


def convert_field(
    field_html: str,
    note_path: Path,
    media_dir: Path,
    media_names: dict[str, str],
) -> tuple[str, list[dict[str, Any]]]:
    soup = BeautifulSoup(field_html, "html.parser")
    issues = inspect_html(field_html)

    for image in soup.find_all("img"):
        src = image.get("src")
        if src and not is_external_reference(src):
            original = urllib.parse.unquote(src)
            image["src"] = relative_media_link(note_path, media_dir / media_names[original])

    placeholders: dict[str, str] = {}
    candidates = [tag for tag in soup.find_all(True) if problematic_tag(tag)]
    candidate_ids = {id(tag) for tag in candidates}
    top_level = [
        tag for tag in candidates
        if not any(id(parent) in candidate_ids for parent in tag.parents if isinstance(parent, Tag))
    ]
    for index, tag in enumerate(top_level):
        token = f"ANKIRAWHTML{index}X{hashlib.sha1(str(tag).encode()).hexdigest()[:12]}"
        placeholders[token] = str(tag)
        tag.replace_with(NavigableString(token))

    markdown = html_to_markdown(
        str(soup), heading_style="ATX", bullets="-", strong_em_symbol="*"
    )
    for token, raw_html in placeholders.items():
        markdown = markdown.replace(token, raw_html)

    def replace_sound(match: re.Match[str]) -> str:
        original = match.group(1)
        local = relative_media_link(note_path, media_dir / media_names[original])
        suffix = Path(original).suffix.lower()
        kind = "video" if suffix in {".avi", ".mkv", ".mov", ".mp4", ".mpeg", ".webm"} else "audio"
        return f"[{kind}: {original}]({local})"

    markdown = SOUND_RE.sub(replace_sound, markdown)
    markdown = re.sub(r"\n{3,}", "\n\n", markdown).strip()
    return markdown, issues


def load_collection(client: AnkiConnect, query: str, batch_size: int) -> tuple[list[dict[str, Any]], dict[int, dict[str, Any]]]:
    version = client.invoke("version")
    if not isinstance(version, int) or version < 6:
        raise ExportError(f"AnkiConnect API v6 or newer is required; server reported {version!r}")
    note_ids = client.invoke("findNotes", query=query)
    if not isinstance(note_ids, list):
        raise ExportError("findNotes returned a non-list result")
    notes: list[dict[str, Any]] = []
    for batch in chunks(note_ids, batch_size):
        result = client.invoke("notesInfo", notes=batch)
        if not isinstance(result, list):
            raise ExportError("notesInfo returned a non-list result")
        notes.extend(result)
    card_ids = sorted({int(card) for note in notes for card in note.get("cards", [])})
    cards: dict[int, dict[str, Any]] = {}
    for batch in chunks(card_ids, batch_size):
        result = client.invoke("cardsInfo", cards=batch)
        if not isinstance(result, list):
            raise ExportError("cardsInfo returned a non-list result")
        cards.update({int(card["cardId"]): card for card in result})
    return notes, cards


def note_decks(note: dict[str, Any], cards: dict[int, dict[str, Any]]) -> list[str]:
    return sorted({cards[int(card)]["deckName"] for card in note.get("cards", []) if int(card) in cards})


def build_deck_paths(decks: set[str]) -> dict[str, tuple[str, ...]]:
    """Map deck names to unique, stable path components."""
    preliminary = {deck: tuple(slugify(part) for part in deck.split("::")) for deck in decks}
    collisions: dict[tuple[str, ...], list[str]] = defaultdict(list)
    for deck, parts in preliminary.items():
        collisions[tuple(part.casefold() for part in parts)].append(deck)
    result: dict[str, tuple[str, ...]] = {}
    for names in collisions.values():
        for deck in sorted(names):
            parts = list(preliminary[deck])
            if len(names) > 1:
                suffix = hashlib.sha256(deck.encode()).hexdigest()[:8]
                parts[-1] = f"{parts[-1]}-{suffix}"
            result[deck] = tuple(parts)
    return result


def note_directory(
    note: dict[str, Any],
    cards: dict[int, dict[str, Any]],
    deck_paths: dict[str, tuple[str, ...]],
) -> Path:
    decks = note_decks(note, cards)
    if not decks:
        return Path("notes", "_no-deck")
    if len(decks) == 1:
        return Path("notes", *deck_paths[decks[0]])
    full_slugs = ["--".join(deck_paths[deck]) for deck in decks]
    combination = "___".join(full_slugs)
    if len(combination) > 180:
        digest = hashlib.sha256(combination.encode()).hexdigest()[:12]
        combination = f"{combination[:167].rstrip('-._')}-{digest}"
    return Path("notes", "_multi-deck", combination)


def all_media_references(notes: list[dict[str, Any]]) -> dict[str, set[str]]:
    refs: dict[str, set[str]] = defaultdict(set)
    for note in notes:
        for field in note.get("fields", {}).values():
            for kind, filename in referenced_media(field.get("value", "")):
                refs[filename].add(kind)
    return refs


def build_analysis(
    notes: list[dict[str, Any]],
    cards: dict[int, dict[str, Any]],
    available_media: set[str],
) -> dict[str, Any]:
    models = Counter(note.get("modelName", "") for note in notes)
    decks = Counter(deck for note in notes for deck in note_decks(note, cards))
    fields = Counter(name for note in notes for name in note.get("fields", {}))
    tags = Counter(tag for note in notes for tag in note.get("tags", []))
    titles: dict[str, list[int]] = defaultdict(list)
    empty_titles: list[int] = []
    multi_deck: Counter[tuple[str, ...]] = Counter()
    html_issues: Counter[tuple[str, tuple[str, ...]]] = Counter()
    html_samples: dict[tuple[str, tuple[str, ...]], str] = {}
    for note in notes:
        _, raw_title = first_field(note)
        title = title_text(raw_title)
        if title:
            titles[title].append(int(note["noteId"]))
        else:
            empty_titles.append(int(note["noteId"]))
        note_deck_names = tuple(note_decks(note, cards))
        if len(note_deck_names) > 1:
            multi_deck[note_deck_names] += 1
        for field in note.get("fields", {}).values():
            for issue in inspect_html(field.get("value", "")):
                key = (issue["tag"], tuple(issue["attributes"]))
                html_issues[key] += 1
                html_samples.setdefault(key, issue["sample"])
    media = all_media_references(notes)
    duplicates = {title: ids for title, ids in titles.items() if len(ids) > 1}
    return {
        "format_version": FORMAT_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "counts": {
            "notes": len(notes), "cards": len(cards), "models": len(models),
            "decks": len(decks), "empty_titles": len(empty_titles),
            "duplicate_title_groups": len(duplicates), "multi_deck_notes": sum(multi_deck.values()),
            "media_references": len(media), "missing_media": sum(name not in available_media for name in media),
        },
        "models": dict(models.most_common()),
        "decks": dict(decks.most_common()),
        "fields": dict(fields.most_common()),
        "tags": dict(tags.most_common()),
        "empty_title_note_ids": empty_titles,
        "duplicate_titles": duplicates,
        "multi_deck_combinations": [
            {"decks": list(names), "note_count": count} for names, count in multi_deck.most_common()
        ],
        "html_issues": [
            {"tag": key[0], "attributes": list(key[1]), "count": count, "sample": html_samples[key]}
            for key, count in html_issues.most_common()
        ],
        "media": [
            {"filename": name, "kinds": sorted(kinds), "available": name in available_media}
            for name, kinds in sorted(media.items())
        ],
    }


def print_summary(report: dict[str, Any]) -> None:
    counts = report["counts"]
    print(
        f"Notes: {counts['notes']}  Cards: {counts['cards']}  Decks: {counts['decks']}  "
        f"Models: {counts['models']}"
    )
    print(
        f"Empty titles: {counts['empty_titles']}  Duplicate title groups: "
        f"{counts['duplicate_title_groups']}  Multi-deck notes: {counts['multi_deck_notes']}"
    )
    print(
        f"Referenced media: {counts['media_references']}  Missing media: {counts['missing_media']}  "
        f"HTML issue kinds: {len(report['html_issues'])}"
    )


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def command_analyze(args: argparse.Namespace, client: AnkiConnect) -> None:
    notes, cards = load_collection(client, args.query, args.batch_size)
    available = set(client.invoke("getMediaFilesNames", pattern="*"))
    report = build_analysis(notes, cards, available)
    write_json(args.report, report)
    print_summary(report)
    print(f"Analysis report: {args.report}")


def unique_timestamp_directory(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    destination = root / stamp
    destination.mkdir()
    return destination


def previous_manifest(root: Path, current: Path) -> dict[str, Any] | None:
    candidates = sorted(
        (path / "manifest.json" for path in root.iterdir() if path.is_dir() and path != current),
        reverse=True,
    )
    for candidate in candidates:
        if candidate.is_file():
            try:
                value = json.loads(candidate.read_text(encoding="utf-8"))
                if value.get("format_version") == FORMAT_VERSION:
                    return value
            except (OSError, json.JSONDecodeError):
                continue
    return None


def comparison_report(previous: dict[str, Any] | None, current_notes: dict[str, Any]) -> dict[str, Any]:
    if previous is None:
        return {"previous_export": None, "deleted_note_ids": [], "moved_note_ids": [], "changed_note_ids": []}
    old = previous.get("notes", {})
    old_ids, new_ids = set(old), set(current_notes)
    common = old_ids & new_ids
    return {
        "previous_export": previous.get("export_directory"),
        "deleted_note_ids": sorted(old_ids - new_ids),
        "moved_note_ids": sorted(note_id for note_id in common if old[note_id].get("path") != current_notes[note_id].get("path")),
        "changed_note_ids": sorted(note_id for note_id in common if old[note_id].get("sha256") != current_notes[note_id].get("sha256")),
    }


def render_note(
    note: dict[str, Any],
    cards: dict[int, dict[str, Any]],
    note_path: Path,
    media_dir: Path,
    media_names: dict[str, str],
) -> tuple[str, list[dict[str, Any]]]:
    ordered_fields = sorted(note.get("fields", {}).items(), key=lambda item: item[1].get("order", 0))
    card_metadata = []
    for card_id in note.get("cards", []):
        card = cards.get(int(card_id), {})
        card_metadata.append({"id": int(card_id), "deck": card.get("deckName")})
    metadata = {
        "anki_export_format": FORMAT_VERSION,
        "note_id": int(note["noteId"]),
        "model": note.get("modelName"),
        "tags": note.get("tags", []),
        "modified": note.get("mod"),
        "fields": [name for name, _ in ordered_fields],
        "cards": card_metadata,
    }
    frontmatter = yaml.safe_dump(metadata, allow_unicode=True, sort_keys=False).strip()
    sections = ["---", frontmatter, "---", ""]
    issues: list[dict[str, Any]] = []
    for name, field in ordered_fields:
        converted, field_issues = convert_field(field.get("value", ""), note_path, media_dir, media_names)
        sections.extend([
            f"<!-- anki-field: {json.dumps(name, ensure_ascii=False)} -->",
            converted,
            "<!-- /anki-field -->",
            "",
        ])
        for issue in field_issues:
            issues.append({"note_id": int(note["noteId"]), "field": name, **issue})
    return "\n".join(sections).rstrip() + "\n", issues


def command_export(args: argparse.Namespace, client: AnkiConnect) -> None:
    notes, cards = load_collection(client, args.query, args.batch_size)
    available = set(client.invoke("getMediaFilesNames", pattern="*"))
    media_refs = all_media_references(notes)
    media_names = build_media_names(set(media_refs))
    all_decks = {deck for note in notes for deck in note_decks(note, cards)}
    deck_paths = build_deck_paths(all_decks)
    destination = unique_timestamp_directory(args.output)
    media_dir = destination / "media"
    media_dir.mkdir()
    missing_media: list[str] = []
    media_manifest: dict[str, Any] = {}
    try:
        for original in sorted(media_refs):
            local_name = media_names[original]
            if original not in available:
                missing_media.append(original)
                media_manifest[original] = {"path": None, "missing": True}
                continue
            encoded = client.invoke("retrieveMediaFile", filename=original)
            if encoded is False:
                missing_media.append(original)
                media_manifest[original] = {"path": None, "missing": True}
                continue
            try:
                data = base64.b64decode(encoded, validate=True)
            except (ValueError, TypeError) as exc:
                raise ExportError(f"Invalid base64 returned for media {original!r}: {exc}") from exc
            target = media_dir / local_name
            target.write_bytes(data)
            media_manifest[original] = {
                "path": target.relative_to(destination).as_posix(),
                "sha256": hashlib.sha256(data).hexdigest(),
                "missing": False,
            }

        note_manifest: dict[str, Any] = {}
        conversion_issues: list[dict[str, Any]] = []
        occupied_paths: dict[str, int] = {}
        for note in notes:
            _, title = first_field(note)
            filename = f"{slugify(title_text(title))}_{int(note['noteId'])}.md"
            relative_path = note_directory(note, cards, deck_paths) / filename
            folded = relative_path.as_posix().casefold()
            if folded in occupied_paths:
                raise ExportError(f"Path collision between notes {occupied_paths[folded]} and {note['noteId']}: {relative_path}")
            occupied_paths[folded] = int(note["noteId"])
            target = destination / relative_path
            target.parent.mkdir(parents=True, exist_ok=True)
            content, issues = render_note(note, cards, target, media_dir, media_names)
            target.write_text(content, encoding="utf-8")
            conversion_issues.extend(issues)
            note_manifest[str(note["noteId"])] = {
                "path": relative_path.as_posix(),
                "sha256": hashlib.sha256(content.encode()).hexdigest(),
                "modified": note.get("mod"),
                "decks": note_decks(note, cards),
            }

        previous = previous_manifest(args.output, destination)
        comparison = comparison_report(previous, note_manifest)
        manifest = {
            "format_version": FORMAT_VERSION,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "export_directory": destination.name,
            "query": args.query,
            "notes": note_manifest,
            "media": media_manifest,
            "deck_paths": {deck: list(parts) for deck, parts in sorted(deck_paths.items())},
            "comparison": comparison,
        }
        write_json(destination / "manifest.json", manifest)
        analysis = build_analysis(notes, cards, available)
        analysis["conversion_issues"] = conversion_issues
        analysis["comparison"] = comparison
        write_json(destination / "export-report.json", analysis)
    except Exception:
        print(f"Export failed; partial output remains at {destination}", file=sys.stderr)
        raise

    print_summary(analysis)
    print(f"Exported {len(notes)} notes to: {destination}")
    if missing_media:
        print(f"Warning: {len(missing_media)} referenced media files were missing; see export-report.json")


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=DEFAULT_URL, help=f"AnkiConnect URL (default: {DEFAULT_URL})")
    parser.add_argument("--timeout", type=float, default=15.0, help="HTTP timeout in seconds")
    parser.add_argument("--retries", type=int, default=2, help="Retries for connection failures")
    parser.add_argument("--batch-size", type=positive_int, default=250, help="Notes/cards requested per batch")
    parser.add_argument("--query", default="", help="Anki search query; empty means all notes")
    subparsers = parser.add_subparsers(dest="command", required=True)
    analyze = subparsers.add_parser("analyze", help="Inspect the collection without exporting notes")
    analyze.add_argument("--report", type=Path, default=Path("anki-analysis.json"))
    export = subparsers.add_parser("export", help="Create a fresh timestamped Markdown export")
    export.add_argument("--output", type=Path, default=Path("exports"))
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.timeout <= 0 or args.retries < 0:
        parser.error("--timeout must be positive and --retries cannot be negative")
    client = AnkiConnect(
        args.url,
        os.environ.get("ANKI_CONNECT_API_KEY"),
        args.timeout,
        args.retries,
    )
    try:
        if args.command == "analyze":
            command_analyze(args, client)
        else:
            command_export(args, client)
        return 0
    except (ExportError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
