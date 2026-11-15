"""Shared JSON parsing and static geographic lookups; no export registry."""
from __future__ import annotations

import json
from pathlib import Path
import re
import unicodedata
from typing import Any


CONFIG_DIR = Path(__file__).resolve().parent / "lookups"


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
