"""Parse ID-linked Anki callouts from Markdown files."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote


# A callout is contiguous quoted text followed immediately by its Anki ID.
# The first line supplies Front; subsequent quoted lines supply Back and tags.
ANKI_CALLOUT_RE = re.compile(
    r"(?m)^[ \t]{0,3}>[ \t]*\[!anki\](?:-[ \t]*|[ \t]+)(?P<front>[^\r\n]*)\r?\n"
    r"(?P<quoted>(?:^[ \t]{0,3}>[ \t]?(?!\[!anki\](?:-|[ \t]))[^\r\n]*(?:\r?\n|\Z))+)"
    r"(?P<markers>(?:^[ \t]*(?:<!--[ \t]*(?:ID|SRS-ID)[ \t]*:[ \t]*[^\r\n]+?[ \t]*-->[ \t]*)?(?:\r?\n|$))*)",
    re.IGNORECASE,
)
ANKI_ID_RE = re.compile(r"<!--[ \t]*ID[ \t]*:[ \t]*([0-9]+)[ \t]*-->", re.I)
HEADING_RE = re.compile(r"^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$")
TAG_RE = re.compile(r"(?<![\w/])#(?P<tag>oa(?:/[\w-]+)+)", re.UNICODE)
TAG_ONLY_RE = re.compile(r"^[ \t]*(?:#[^\s#]+[ \t]*)+$", re.UNICODE)


@dataclass(frozen=True)
class BlockNote:
    path: Path
    line: int
    note_id: int
    front: str
    back: str
    tags: tuple[str, ...]


def _headings_before(content: str, offset: int) -> list[str]:
    stack: list[str] = []
    for line in content[:offset].splitlines():
        match = HEADING_RE.match(line)
        if match is None:
            continue
        level = len(match.group(1))
        del stack[level - 1:]
        while len(stack) < level - 1:
            stack.append("")
        stack.append(match.group(2).strip())
    return [heading for heading in stack if heading]


def _unquote(quoted: str) -> list[str]:
    return [re.sub(r"^[ \t]{0,3}>[ \t]?", "", line) for line in quoted.splitlines()]


def parse_file(path: Path, vault: Path) -> list[BlockNote]:
    content = path.read_text(encoding="utf-8")
    relative = path.resolve().relative_to(vault.resolve()).as_posix()
    notes: list[BlockNote] = []
    for match in ANKI_CALLOUT_RE.finditer(content):
        ids = {int(value) for value in ANKI_ID_RE.findall(match.group("markers"))}
        if not ids:
            continue
        if len(ids) > 1:
            raise ValueError(f"Conflicting block identities in {path}")
        lines = _unquote(match.group("quoted"))
        tags: list[str] = []
        back_lines: list[str] = []
        for line in lines:
            found = list(TAG_RE.finditer(line))
            tags.extend(item.group("tag").replace("/", "::") for item in found)
            # All-tag lines are callout metadata, including local-only tags
            # such as #proof. Only the #oa/... subset is sent to Anki.
            if TAG_ONLY_RE.fullmatch(line):
                continue
            back_lines.append(line.rstrip())
        while back_lines and not back_lines[-1]:
            back_lines.pop()
        breadcrumb = " > ".join([relative, *_headings_before(content, match.start())])
        uri = (f"obsidian://open?vault={quote(vault.resolve().name, safe='')}"
               f"&file={quote(relative, safe='')}")
        backlink = f'<a href="{uri}" class="obsidian-link">Obsidian</a>{breadcrumb}'
        body = "\n".join(back_lines).strip()
        back = f"{body}\n\n\n{backlink}" if body else backlink
        notes.append(BlockNote(
            path=path.resolve(),
            line=content.count("\n", 0, match.start()) + 1,
            note_id=next(iter(ids)),
            front=match.group("front").strip(),
            back=back,
            tags=tuple(dict.fromkeys(tags)),
        ))
    return notes


def scan(vault: Path) -> list[BlockNote]:
    root = vault / "wiki"
    if not root.is_dir():
        return []
    return [note for path in sorted(root.rglob("*.md"))
            for note in parse_file(path, vault)]
