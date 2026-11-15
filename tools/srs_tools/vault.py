"""Vault source parsers, field transformations, and note preparation."""
from __future__ import annotations

import csv
import html
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import yaml

from .configuration import JAPANESE_REGIONS, US_STATES_BY_SLUG


DEFAULT_VAULT = Path("/path/to/vault")
ValueTransform = Callable[[Any, "Note"], str]


class ExportError(RuntimeError):
    pass


class NoFrontmatterError(ExportError):
    """The file is ordinary Markdown rather than a configured source note."""


@dataclass(frozen=True)
class Note:
    path: Path
    metadata: dict[str, Any]
    body: str

    @property
    def filename(self) -> str:
        return self.path.stem


@dataclass(frozen=True)
class Field:
    """Map one Obsidian property (or ``$filename``) to one Anki field."""

    anki: str
    source: str
    transform: ValueTransform
    required: bool = True
    # Explicit outbound behavior for an absent source. When omitted, legacy
    # ``required`` semantics apply (required -> error, optional -> blank).
    missing_source: str | None = None
    # Some migrated lists intentionally store only the visible text of legacy
    # Anki fields.  Keep a linked Anki value when its non-whitespace text still
    # matches the source, while continuing to block genuine text/link loss.
    preserve_matching_links: bool = False
    # Permit this managed field to replace linked HTML with source text. This
    # must be enabled narrowly; dropped links are blocking by default.
    allow_link_removal: bool = False


@dataclass(frozen=True)
class Export:
    notes_directory: str | tuple[str, ...]
    notetype: str | None
    fields: tuple[Field, ...]
    filenames: frozenset[str] | None = None
    required_property: str | None = None
    required_any_property: tuple[str, ...] = ()
    query: str = ""
    identity_fields: tuple[str, ...] = ()
    classification: str = "structural"
    candidate_exclusion: str | None = None
    candidate_decks: tuple[str, ...] = ()
    destination_deck: str | None = None
    recursive: bool = False
    prepare_notes: Callable[[list["Note"]], list["Note"]] | None = None


def text(value: Any, _note: Note) -> str:
    return "" if value is None else str(value).strip()


def markdown_body(value: Any, _note: Note) -> str:
    """Render a Markdown note body as HTML accepted by Anki's importer."""
    # These notes primarily contain prose. Make line breaks explicit because
    # the generated TSV declares HTML mode; HTML-sensitive text remains text.
    return html.escape(str(value).strip()).replace("\n", "<br>")


def capitalize(value: Any, note: Note) -> str:
    value = text(value, note)
    return value[:1].upper() + value[1:]


def functional_group_name(value: Any, note: Note) -> str:
    """Render either ``ketone`` or ``ketone-group`` as the Anki name."""
    value = text(value, note)
    if value.casefold().endswith("-group"):
        value = value[:-len("-group")]
    return value[:1].upper() + value[1:]


def ph_front(_value: Any, note: Note) -> str:
    """Choose the most specific available display name for a pH note."""
    for property_name in ("name_zh", "name_en"):
        rendered = text(note.metadata.get(property_name), note)
        if rendered:
            return rendered
    return note.filename


def ph_units(_value: Any, _note: Note) -> str:
    """Render the fixed unit label used by the pH Anki notes."""
    return "pH"


def chinese_alias(value: Any, note: Note) -> str:
    aliases = value if isinstance(value, list) else [value]
    for alias in aliases:
        rendered = text(alias, note)
        if any("CJK" in unicodedata.name(character, "") for character in rendered):
            return rendered
    raise ExportError(f"{note.path}: aliases contains no Chinese name")


def first_alias(value: Any, note: Note) -> str:
    """Return the first entry from an Obsidian aliases list."""
    if not isinstance(value, list) or not value:
        raise ExportError(f"{note.path}: aliases must be a nonempty list")
    rendered = text(value[0], note)
    if not rendered:
        raise ExportError(f"{note.path}: first alias may not be empty")
    return rendered


WIKILINK_RE = re.compile(r"^!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$")
FRONTMATTER_END_RE = re.compile(r"(?m)^---[ \t]*\r?(?:\n|$)")


def media_reference(value: Any, note: Note) -> str:
    """Resolve an Obsidian wikilink to a vault-relative media path."""
    rendered = text(value, note)
    match = WIKILINK_RE.fullmatch(rendered)
    if not match:
        raise ExportError(
            f"{note.path}: expected a media wikilink, found {rendered!r}"
        )
    return match.group(1)


def anki_media_name(name: str) -> str:
    """Return the name Anki stores a media file under.

    Anki lowercases the name of every media file it writes, so a name with
    capitals can never be replaced in place; references use the stored name.
    """
    return name.lower()


def sound(value: Any, note: Note) -> str:
    return f"[sound:{anki_media_name(Path(media_reference(value, note)).name)}]"


def image(value: Any, note: Note) -> str:
    """Render one image wikilink or a YAML list of image wikilinks."""
    entries = value if isinstance(value, list) else [value]
    rendered = []
    for entry in entries:
        if not text(entry, note):
            continue
        filename = html.escape(
            anki_media_name(Path(media_reference(entry, note)).name), quote=True)
        rendered.append(f'<img src="{filename}">')
    return "<br>".join(rendered)


def optional_image(value: Any, note: Note) -> str:
    if not text(value, note):
        return ""
    return image(value, note)


def country_flags(value: Any, note: Note) -> str:
    """Render the blurred flag first, followed by the regular country flag."""
    values = [note.metadata.get("flag_blur"), value]
    return "".join(image(item, note) for item in values if text(item, note))


def image_or_text(value: Any, note: Note) -> str:
    """Render an image wikilink as Anki HTML, otherwise preserve plain text."""
    if isinstance(value, list):
        return image(value, note)
    rendered = text(value, note)
    if not rendered:
        return ""
    if WIKILINK_RE.fullmatch(rendered):
        return image(rendered, note)
    return rendered


def chemical_structure(_value: Any, note: Note) -> str:
    """Prefer the reference image while retaining LaTeX as editable source."""
    structure_image = note.metadata.get("structure_image")
    if text(structure_image, note):
        return image(structure_image, note)
    for property_name in ("structure_latex", "structure"):
        value = note.metadata.get(property_name)
        if text(value, note):
            return image_or_text(value, note)
    return ""


def image_list(value: Any, note: Note) -> str:
    """Render one or more image wikilinks from a scalar or YAML list."""
    if value is None:
        return ""
    entries = value if isinstance(value, list) else [value]
    rendered = [image(entry, note) for entry in entries if text(entry, note)]
    return "<br>".join(rendered)


def wikilink_label(value: Any, note: Note) -> str:
    """Return a wikilink's display label, or pass through plain text."""
    rendered = text(value, note)
    match = WIKILINK_RE.fullmatch(rendered)
    if not match:
        return rendered
    inner = rendered[2:-2]
    if "|" in inner:
        return inner.rsplit("|", 1)[1]
    return Path(match.group(1)).stem


def comma_separated_labels(value: Any, note: Note) -> str:
    """Render a YAML list of wikilinks or text as an Anki comma list."""
    entries = value if isinstance(value, list) else [value]
    return ", ".join(
        label for entry in entries if (label := wikilink_label(entry, note))
    )


def taxonomy_name(note: Note) -> tuple[str, str]:
    """Return the rank and scientific name encoded in a taxonomy filename."""
    rank, separator, scientific_name = note.filename.partition(" ")
    if not separator or not rank.strip() or not scientific_name.strip():
        raise ExportError(
            f"{note.path}: taxonomy filename must be '<rank> <scientific name>'"
        )
    return rank.strip(), scientific_name.strip()


def child_link_target(value: Any, note: Note) -> str:
    rendered = text(value, note)
    match = WIKILINK_RE.fullmatch(rendered)
    if not match:
        raise ExportError(f"{note.path}: invalid child wikilink {rendered!r}")
    return match.group(1).strip()


def prepare_taxonomy_notes(notes: list[Note]) -> list[Note]:
    """Reverse taxonomy ``child``/``children`` links and derive ancestry fields."""
    if not notes:
        return notes
    root = notes[0].path.parent
    while root.name and root.name != "life":
        root = root.parent

    exact: dict[str, Note] = {}
    stems: dict[str, list[Note]] = {}
    for note in notes:
        relative = note.path.relative_to(root).with_suffix("")
        key = unicodedata.normalize("NFC", relative.as_posix()).casefold()
        exact[key] = note
        stem_key = unicodedata.normalize("NFC", note.path.stem).casefold()
        stems.setdefault(stem_key, []).append(note)

    parents: dict[Path, list[Note]] = {note.path: [] for note in notes}
    unresolved_children: dict[Path, list[str]] = {note.path: [] for note in notes}
    for parent in notes:
        # The vault's established taxonomy property is singular ``child``.
        # Accept the older plural spelling too, and permit a scalar wikilink
        # because a taxon often has only one child.  Blank YAML values parse
        # as None and simply mean that this taxon is currently a leaf.
        child_values = [
            parent.metadata.get(key)
            for key in ("child", "children")
            if key in parent.metadata and parent.metadata.get(key) is not None
        ]
        raw_children: list[Any] = []
        for value in child_values:
            if isinstance(value, list):
                raw_children.extend(item for item in value if text(item, parent))
            elif text(value, parent):
                raw_children.append(value)
        for raw_child in raw_children:
            target = child_link_target(raw_child, parent)
            target_path = Path(target)
            if target_path.suffix.casefold() == ".md":
                target_path = target_path.with_suffix("")
            normalized = unicodedata.normalize(
                "NFC", target_path.as_posix()
            ).casefold()
            child = exact.get(normalized)
            if child is None and normalized.startswith("wiki/life/"):
                child = exact.get(normalized.removeprefix("wiki/life/"))
            if child is None:
                candidates = stems.get(
                    unicodedata.normalize("NFC", target_path.name).casefold(), []
                )
                if len(candidates) > 1:
                    paths = ", ".join(str(candidate.path) for candidate in candidates)
                    raise ExportError(
                        f"{parent.path}: ambiguous child link {target!r}: {paths}"
                    )
                child = candidates[0] if candidates else None
            if child is None:
                unresolved_children[parent.path].append(target)
                continue
            parents[child.path].append(parent)

    prepared: list[Note] = []
    for note in notes:
        rank, scientific_name = taxonomy_name(note)
        ancestors: list[Note] = []
        visited: set[Path] = set()

        def visit(ancestor: Note, visiting: set[Path]) -> None:
            if ancestor.path in visiting:
                raise ExportError(f"{note.path}: cycle detected in taxonomy ancestry")
            if ancestor.path in visited:
                return
            visited.add(ancestor.path)
            ancestors.append(ancestor)
            for parent in parents[ancestor.path]:
                visit(parent, visiting | {ancestor.path})

        for parent in parents[note.path]:
            visit(parent, {note.path})

        # Include the note itself.  Without this, a Genus note has a blank
        # genus field and a Family note has a blank family field; descendants
        # still obtain those values through the ancestor walk below.
        by_rank: dict[str, list[str]] = {rank.casefold(): [scientific_name]}
        for ancestor in ancestors:
            ancestor_rank, ancestor_name = taxonomy_name(ancestor)
            by_rank.setdefault(ancestor_rank.casefold(), []).append(ancestor_name)
        multiple_ancestry: list[str] = []
        for requested_rank in ("genus", "family", "subfamily", "tribe", "kingdom"):
            values = list(dict.fromkeys(by_rank.get(requested_rank, [])))
            if len(values) > 1:
                multiple_ancestry.append(
                    f"multiple {requested_rank} ancestors: " + "; ".join(values)
                )
            by_rank[requested_rank] = values

        genus = "; ".join(by_rank["genus"])
        family = "; ".join(by_rank["family"])
        subfamily = "; ".join(by_rank["subfamily"])
        tribe = "; ".join(by_rank["tribe"])
        kingdom = "; ".join(by_rank["kingdom"])
        family_parts = family
        if kingdom.casefold() == "plantae":
            for lower_rank in (subfamily, tribe):
                if lower_rank:
                    family_parts = (
                        f"{family_parts} - {lower_rank}"
                        if family_parts else lower_rank
                    )
        family_display = (
            f"{family_parts} ({kingdom})" if family_parts and kingdom
            else family_parts or (f"({kingdom})" if kingdom else "")
        )
        metadata = dict(note.metadata)
        metadata.update({
            "$taxonomy_scientific_name": scientific_name,
            "$taxonomy_rank": rank,
            "$taxonomy_genus": genus,
            "$taxonomy_family": family_display,
            "$taxonomy_multiple_ancestry": multiple_ancestry,
            "$taxonomy_unresolved_children": list(dict.fromkeys(unresolved_children[note.path])),
        })
        prepared.append(Note(note.path, metadata, note.body))
    return prepared


def indian_union_territory(_value: Any, note: Note) -> str:
    return "Yes" if note.path.parent.name == "union-territories" else "No"


MARKDOWN_LINK_RE = re.compile(r"^\[([^]]*)\]\(([^)]+)\)$")


def markdown_link_list(value: Any, note: Note) -> str:
    """Render a YAML list of Markdown links as clickable Anki HTML."""
    entries = value if isinstance(value, list) else [value]
    rendered = []
    for entry in entries:
        item = text(entry, note)
        if not item:
            continue
        match = MARKDOWN_LINK_RE.fullmatch(item)
        if match:
            label, target = match.groups()
            rendered.append(
                f'<a href="{html.escape(target, quote=True)}">'
                f"{html.escape(label)}</a>"
            )
        else:
            rendered.append(html.escape(item))
    return "<br>".join(rendered)


def us_state_name(_value: Any, note: Note) -> str:
    try:
        return US_STATES_BY_SLUG[note.filename.casefold()]
    except KeyError as error:
        raise ExportError(f"{note.path}: filename is not a canonical US state") from error


def classical_back(value: Any, note: Note) -> str:
    """Rebuild a clean Back field from the structured music properties."""
    title = text(value, note)
    composer = wikilink_label(note.metadata.get("composer"), note)
    if not composer:
        raise ExportError(f"{note.path}: missing required property 'composer'")
    heading = f"{composer} - {title}"
    info = text(note.metadata.get("info"), note)
    return f"{heading}\n\n{info}" if info else heading


TRANSFORMS = {
    function.__name__: function
    for function in (
        capitalize, chemical_structure, chinese_alias, classical_back,
        comma_separated_labels, country_flags, first_alias,
        functional_group_name, image, image_list, indian_union_territory,
        markdown_body, markdown_link_list, optional_image, ph_front, ph_units,
        sound, text, us_state_name, wikilink_label,
    )
}
PREPARE_NOTES = {"prepare_taxonomy_notes": prepare_taxonomy_notes}
def split_frontmatter(path: Path) -> tuple[dict[str, Any], str]:
    content = path.read_text(encoding="utf-8")
    opening = re.match(r"\A---[ \t]*\r?\n", content)
    if opening is None:
        raise NoFrontmatterError(f"{path}: no YAML front matter")
    closing = FRONTMATTER_END_RE.search(content, opening.end())
    if closing is None:
        raise ExportError(f"{path}: opening YAML delimiter has no closing delimiter")
    try:
        # YAML forbids tab indentation and separators. Obsidian files can
        # nevertheless acquire stray tabs through manual editing, so tolerate
        # them in frontmatter without modifying tabs in the Markdown body.
        yaml_text = content[opening.end():closing.start()].replace("\t", "  ")
        metadata = yaml.safe_load(yaml_text) or {}
    except yaml.YAMLError as error:
        raise ExportError(f"{path}: invalid YAML front matter: {error}") from error
    if not isinstance(metadata, dict):
        raise ExportError(f"{path}: YAML front matter is not a mapping")
    return metadata, content[closing.end():].strip()


def source_value(note: Note, source: str) -> Any:
    if source == "$filename":
        return note.filename
    if source == "$body":
        return note.body
    if source not in note.metadata:
        raise ExportError(f"{note.path}: missing required property {source!r}")
    return note.metadata[source]


def field_source_value(note: Note, field: Field) -> Any:
    """Read a source, returning None when the field is explicitly optional."""
    behavior = field.missing_source or ("error" if field.required else "blank")
    if behavior not in {"error", "blank", "omit"}:
        raise ExportError(f"invalid missing-source behavior {behavior!r} for {field.anki}")
    if (
        (behavior == "blank" or field.transform is optional_image)
        and field.source not in note.metadata
    ):
        return None
    return source_value(note, field.source)


def media_paths(
    export: Export, note: Note, vault: Path,
    missing_paths: list[Path] | None = None,
) -> list[Path]:
    """Return referenced media paths.

    Callers that supply ``missing_paths`` can inventory incomplete notes
    without aborting; legacy callers remain strict.
    """
    paths = []
    for field in export.fields:
        if field.transform not in {sound, image, optional_image, image_or_text, image_list, country_flags, chemical_structure}:
            continue
        if field.transform is chemical_structure:
            value = note.metadata.get("structure_image")
            if not text(value, note):
                continue
        else:
            value = field_source_value(note, field)
        if field.transform is country_flags:
            value = [note.metadata.get("flag_blur"), value]
        if field.transform in {optional_image, image_or_text, image_list} and not value:
            continue
        if (field.transform is image_or_text and not isinstance(value, list)
                and not WIKILINK_RE.fullmatch(text(value, note))):
            continue
        values = value if isinstance(value, list) else [value]
        for item in values:
            if not text(item, note):
                continue
            relative = media_reference(item, note)
            path = vault / relative
            if not path.is_file():
                if missing_paths is not None:
                    missing_paths.append(path)
                    continue
                raise ExportError(
                    f"{note.path}: referenced media does not exist: {path}"
                )
            paths.append(path)
    return paths


def unique_notes(
    notes_directory: Path, filenames: frozenset[str] | None = None,
    recursive: bool = False,
) -> list[Path]:
    pattern = "**/*.md" if recursive else "*.md"
    notes = sorted(notes_directory.glob(pattern), key=lambda path: str(path).casefold())
    if filenames is not None:
        notes = [path for path in notes if path.stem.casefold() in filenames]
    folded: dict[str, Path] = {}
    for path in notes:
        key = unicodedata.normalize(
            "NFC", str(path.relative_to(notes_directory))
        ).casefold()
        if key in folded:
            raise ExportError(f"Filename collision: {folded[key]} and {path}")
        folded[key] = path
    return notes


def source_notes(vault: Path, config: Export) -> list[Note]:
    """Load configured Markdown notes or rows from a configured data CSV."""
    configured = ((config.notes_directory,) if isinstance(config.notes_directory, str)
                  else config.notes_directory)
    notes: list[Note] = []
    for relative in configured:
        source = vault / relative
        if source.suffix.casefold() == ".csv":
            if not source.is_file():
                raise ExportError(f"Data CSV does not exist: {source}")
            with source.open(encoding="utf-8-sig", newline="") as stream:
                reader = csv.DictReader(stream)
                if reader.fieldnames is None:
                    raise ExportError(f"Data CSV has no header: {source}")
                for number, row in enumerate(reader, 2):
                    notes.append(Note(Path(f"{source}#row-{number}"), dict(row), ""))
            continue
        if not source.is_dir():
            raise ExportError(f"Notes directory does not exist: {source}")
        for path in unique_notes(source, config.filenames, config.recursive):
            try:
                metadata, body = split_frontmatter(path)
            except NoFrontmatterError:
                # Configured directories can contain ordinary Markdown notes.
                # Only notes with YAML metadata participate in export,
                # reconciliation, and ID seeding.
                continue
            notes.append(Note(path, metadata, body))
    if config.prepare_notes is not None:
        notes = config.prepare_notes(notes)
    return notes


