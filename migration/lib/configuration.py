"""Load and validate ankobs' JSON configuration files.

Configuration is deliberately data-only.  Rendering functions and note
preprocessors are supplied by callers and resolved through explicit name
registries, so editing JSON cannot import or execute arbitrary Python.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
import json
from pathlib import Path
import re
import unicodedata
from typing import Any


CONFIG_DIR = Path(__file__).resolve().parents[1] / "config"


def _object_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate JSON key: {key!r}")
        result[key] = value
    return result


def load_json(filename: str) -> Any:
    path = CONFIG_DIR / filename
    try:
        return parse_json(path.read_text(encoding="utf-8"), str(path))
    except (OSError, json.JSONDecodeError, ValueError) as error:
        raise ValueError(f"invalid configuration {path}: {error}") from error


def parse_json(contents: str, location: str = "JSON") -> Any:
    """Parse JSON while rejecting duplicate object keys."""
    try:
        return json.loads(contents, object_pairs_hook=_object_without_duplicates)
    except (json.JSONDecodeError, ValueError) as error:
        raise ValueError(f"invalid {location}: {error}") from error


def _string_list(value: Any, location: str, *, nonempty: bool = False) -> list[str]:
    if not isinstance(value, list) or (nonempty and not value):
        qualifier = "non-empty " if nonempty else ""
        raise ValueError(f"{location} must be a {qualifier}list")
    if any(not isinstance(item, str) or not item.strip() for item in value):
        raise ValueError(f"{location} must contain non-empty strings")
    return value


def _optional_string(value: Any, location: str) -> str | None:
    if value is not None and (not isinstance(value, str) or not value.strip()):
        raise ValueError(f"{location} must be null or a non-empty string")
    return value


def load_exports(
    export_type: type,
    field_type: type,
    transforms: Mapping[str, Callable[..., Any]],
    preprocessors: Mapping[str, Callable[..., Any]],
    registry: Mapping[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Build runtime Export objects from the validated JSON registry."""
    raw = load_json("exports.json") if registry is None else registry
    if not isinstance(raw, dict) or not raw:
        raise ValueError("config/exports.json must be a non-empty object")

    exports: dict[str, Any] = {}
    kinds: dict[str, str] = {}
    allowed_export_keys = {
        "source_kind", "sources", "notetype", "fields", "filenames",
        "required_property", "required_any_property", "query",
        "identity_fields", "classification", "candidate_exclusion",
        "candidate_decks", "destination_deck", "recursive", "prepare_notes",
    }
    allowed_field_keys = {
        "anki", "source", "transform", "required", "missing_source",
        "preserve_matching_links", "allow_link_removal",
    }
    for name, entry in raw.items():
        location = f"exports.{name}"
        if not isinstance(name, str) or not name or name.strip() != name:
            raise ValueError(f"invalid configuration name: {name!r}")
        if not isinstance(entry, dict):
            raise ValueError(f"{location} must be an object")
        unknown = set(entry) - allowed_export_keys
        if unknown:
            raise ValueError(f"{location} has unknown key(s): {', '.join(sorted(unknown))}")

        kind = entry.get("source_kind")
        if kind not in {"structural", "list"}:
            raise ValueError(f"{location}.source_kind must be 'structural' or 'list'")
        sources = _string_list(entry.get("sources"), f"{location}.sources", nonempty=True)
        fields_data = entry.get("fields")
        if not isinstance(fields_data, list) or not fields_data:
            raise ValueError(f"{location}.fields must be a non-empty list")
        fields = []
        configured_anki_fields: set[str] = set()
        for index, field in enumerate(fields_data):
            field_location = f"{location}.fields[{index}]"
            if not isinstance(field, dict):
                raise ValueError(f"{field_location} must be an object")
            unknown = set(field) - allowed_field_keys
            if unknown:
                raise ValueError(
                    f"{field_location} has unknown key(s): {', '.join(sorted(unknown))}"
                )
            anki = field.get("anki")
            source = field.get("source")
            transform_name = field.get("transform")
            if not isinstance(anki, str) or not anki.strip():
                raise ValueError(f"{field_location}.anki must be a non-empty string")
            if not isinstance(source, str) or not source.strip():
                raise ValueError(f"{field_location}.source must be a non-empty string")
            if transform_name not in transforms:
                raise ValueError(f"{field_location}.transform is unknown: {transform_name!r}")
            if anki in configured_anki_fields:
                raise ValueError(f"{location}.fields contains duplicate Anki field {anki!r}")
            configured_anki_fields.add(anki)
            for option in (
                "required", "preserve_matching_links", "allow_link_removal"
            ):
                if option in field and not isinstance(field[option], bool):
                    raise ValueError(f"{field_location}.{option} must be a boolean")
            missing_source = _optional_string(
                field.get("missing_source"), f"{field_location}.missing_source"
            )
            if missing_source not in {None, "error", "blank", "omit"}:
                raise ValueError(
                    f"{field_location}.missing_source must be 'error', 'blank', or 'omit'"
                )
            fields.append(field_type(
                anki=anki,
                source=source,
                transform=transforms[transform_name],
                required=field.get("required", True),
                missing_source=missing_source,
                preserve_matching_links=field.get("preserve_matching_links", False),
                allow_link_removal=field.get("allow_link_removal", False),
            ))

        query = entry.get("query", "")
        identities = _string_list(
            entry.get("identity_fields", []), f"{location}.identity_fields",
            nonempty=True,
        )
        classification = entry.get(
            "classification", "vocabulary" if kind == "list" else "structural"
        )
        if not isinstance(query, str) or not query.strip():
            raise ValueError(f"{location}.query must be a non-empty string")
        if classification not in {"structural", "vocabulary"}:
            raise ValueError(f"{location}.classification is invalid: {classification!r}")
        expected = "vocabulary" if kind == "list" else "structural"
        if classification != expected:
            raise ValueError(
                f"{location}.classification must be {expected!r} for {kind!r} sources"
            )
        field_names = {field.anki for field in fields}
        if not set(identities) <= field_names:
            raise ValueError(f"{location}.identity_fields must reference configured fields")

        prepare_name = entry.get("prepare_notes")
        if prepare_name is not None and prepare_name not in preprocessors:
            raise ValueError(f"{location}.prepare_notes is unknown: {prepare_name!r}")
        filenames_data = entry.get("filenames")
        filenames = None
        if filenames_data is not None:
            filenames = frozenset(
                _string_list(filenames_data, f"{location}.filenames", nonempty=True)
            )
        candidate_decks = tuple(_string_list(
            entry.get("candidate_decks", []), f"{location}.candidate_decks"
        ))
        destination = _optional_string(
            entry.get("destination_deck"), f"{location}.destination_deck"
        )
        if destination is not None and destination not in candidate_decks:
            raise ValueError(
                f"{location}.destination_deck must match a candidate deck"
            )
        required_any = tuple(_string_list(
            entry.get("required_any_property", []),
            f"{location}.required_any_property",
        ))
        recursive = entry.get("recursive", False)
        if not isinstance(recursive, bool):
            raise ValueError(f"{location}.recursive must be a boolean")
        exports[name] = export_type(
            notes_directory=sources[0] if len(sources) == 1 else tuple(sources),
            notetype=_optional_string(entry.get("notetype"), f"{location}.notetype"),
            fields=tuple(fields),
            filenames=filenames,
            required_property=_optional_string(
                entry.get("required_property"), f"{location}.required_property"
            ),
            required_any_property=required_any,
            query=query,
            identity_fields=tuple(identities),
            classification=classification,
            candidate_exclusion=_optional_string(
                entry.get("candidate_exclusion"), f"{location}.candidate_exclusion"
            ),
            candidate_decks=candidate_decks,
            destination_deck=destination,
            recursive=recursive,
            prepare_notes=preprocessors.get(prepare_name),
        )
        kinds[name] = kind

    structural = {name: value for name, value in exports.items() if kinds[name] == "structural"}
    lists = {name: value for name, value in exports.items() if kinds[name] == "list"}
    return exports, structural, lists


_CHINESE_PROVINCES = load_json("chinese_provinces.json")
ENGLISH_NAMES = _CHINESE_PROVINCES["english_names"]
SHORT_NAMES = _CHINESE_PROVINCES["short_names"]

_JAPANESE = load_json("japanese_regions.json")
JAPANESE_REGIONS = {key: tuple(value) for key, value in _JAPANESE["regions"].items()}
JAPANESE_REGION_NAMES = _JAPANESE["canonical_names"]

US_STATES = tuple(load_json("us_states.json"))


def normalized_name(value: str) -> str:
    return re.sub(r"[\s_-]+", "", unicodedata.normalize("NFC", value).strip().casefold())


def province_short_name(name: str) -> str:
    if name in SHORT_NAMES:
        return SHORT_NAMES[name]
    return re.sub(r"(?:省|市)$", "", name)


def province_candidate_names(name: str) -> frozenset[str]:
    aliases = {name, province_short_name(name)}
    english = ENGLISH_NAMES.get(name)
    if english:
        aliases.update({english, english.replace("-", " "), english.replace("-", "_")})
    return frozenset(normalized_name(alias) for alias in aliases if alias)


def japanese_normalized_name(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"[\s_-]+", "", value)


def canonical_japanese_region(value: str) -> str | None:
    key = japanese_normalized_name(value)
    for canonical, aliases in JAPANESE_REGIONS.items():
        if key in {
            japanese_normalized_name(canonical),
            *(japanese_normalized_name(item) for item in aliases),
        }:
            return canonical
    return None


def japanese_region_candidate_names(canonical: str) -> set[str]:
    return {
        japanese_normalized_name(name)
        for name in (canonical, *JAPANESE_REGIONS[canonical])
    }


def state_slug(name: str) -> str:
    return name.casefold().replace(" ", "-")


US_STATES_BY_SLUG = {state_slug(name): name for name in US_STATES}
