#!/usr/bin/env python3
"""Legacy Obsidian-to-Anki export adapter; ongoing sources live in tools/."""
from __future__ import annotations
import argparse
import csv
from pathlib import Path
import shutil
import sys
import _shared
from srs_tools.vault import *
from configuration import load_exports
EXPORTS, MARKDOWN_EXPORTS, CSV_EXPORTS = load_exports(Export, Field, TRANSFORMS, PREPARE_NOTES)

def export_notes(args: argparse.Namespace) -> None:
    config = EXPORTS[args.card_type]
    vault = args.vault.expanduser().resolve()
    configured_directories = (
        (config.notes_directory,)
        if isinstance(config.notes_directory, str)
        else config.notes_directory
    )
    notes_directories = [vault / directory for directory in configured_directories]
    output = args.output.expanduser()
    media_output = args.media_output.expanduser() if args.media_output else None
    notes = source_notes(vault, config)
    if not notes:
        rendered = ", ".join(str(path) for path in notes_directories)
        raise ExportError(f"No source records found in {rendered}")

    rows: list[list[str]] = []
    media: dict[str, Path] = {}
    for note in notes:
        path = note.path
        if (
            config.required_property is not None
            and config.required_property not in note.metadata
        ):
            continue
        if (config.required_any_property
                and not any(key in note.metadata for key in config.required_any_property)):
            continue
        row = [
            field.transform(field_source_value(note, field), note)
            for field in config.fields
        ]
        if not row[0]:
            raise ExportError(f"{path}: first Anki field may not be empty")
        rows.append(row)
        for source in media_paths(config, note, vault):
            key = source.name.casefold()
            if key in media and media[key] != source:
                raise ExportError(
                    f"Media filename collision: {media[key]} and {source}"
                )
            media[key] = source

    if not rows:
        qualifier = (
            f" with property {config.required_property!r}"
            if config.required_property is not None
            else (
                f" with any property in {config.required_any_property!r}"
                if config.required_any_property else ""
            )
        )
        rendered = ", ".join(str(path) for path in notes_directories)
        raise ExportError(f"No source records{qualifier} found in {rendered}")

    output.parent.mkdir(parents=True, exist_ok=True)
    notetype = args.notetype if args.notetype is not None else config.notetype
    with output.open("w", encoding="utf-8", newline="") as stream:
        stream.write("#separator:Tab\n")
        stream.write("#html:true\n")
        if notetype:
            stream.write(f"#notetype:{notetype}\n")
        stream.write("#columns:" + "\t".join(field.anki for field in config.fields) + "\n")
        writer = csv.writer(stream, dialect="excel-tab", lineterminator="\n")
        writer.writerows(rows)

    if media_output:
        media_output.mkdir(parents=True, exist_ok=True)
        for source in media.values():
            destination = media_output / anki_media_name(source.name)
            if destination.exists() and destination.read_bytes() != source.read_bytes():
                raise ExportError(f"Refusing to overwrite different media: {destination}")
            if not destination.exists():
                shutil.copy2(source, destination)

    media_message = (
        f"; {len(media)} media file(s) staged in {media_output}"
        if media_output
        else f"; {len(media)} media file(s) referenced (not copied)"
    )
    print(f"Wrote {len(rows)} note(s) to {output}{media_message}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("card_type", choices=sorted(EXPORTS))
    parser.add_argument("--vault", type=Path, default=DEFAULT_VAULT)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--media-output",
        type=Path,
        help="stage referenced files here before copying them to collection.media",
    )
    parser.add_argument(
        "--notetype",
        help="override the configured Anki note type (also sets it for elements)",
    )
    args = parser.parse_args()
    try:
        export_notes(args)
        return 0
    except (ExportError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
