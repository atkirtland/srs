"""Anki-independent source discovery, study filters, and scheduling profiles."""
from __future__ import annotations

from datetime import date, datetime, timezone
import csv
import math
import re
from pathlib import Path
import uuid

from . import store as catalog
from . import vault as sources
from . import core as srs
from . import layout
from .layout import read, write


def load_cards(data, configuration=None):
    catalog.recover(data)
    manifest = read(data / "manifest.json")
    cards = [card for part in catalog.partition_paths(manifest) for card in read(data / part)]
    if 'note_partition_count' in manifest:
        notes = [note for part in catalog.note_paths(manifest) for note in read(data / part)]
        source_path = data.parent / 'config' / 'sources.json'
        rules = read(source_path)['rules'] if source_path.exists() else {}
        cards = layout.hydrate_cards(cards, notes, configuration or {'source_rules':rules})
    if len({card['id'] for card in cards}) != len(cards):
        raise ValueError("Duplicate catalog card identity")
    return manifest, cards


def validate_filter(value):
    if not isinstance(value, dict):
        raise ValueError('Filter must be an object')
    allowed = {'all', 'any', 'not', 'paths', 'deck_ids', 'include_children', 'groups', 'templates', 'tags', 'tag_prefixes', 'properties', 'card_ids'}
    if set(value) - allowed:
        raise ValueError(f"Unknown filter fields: {set(value) - allowed}")
    for name in ('all', 'any'):
        if name in value:
            if not isinstance(value[name], list) or not value[name]:
                raise ValueError(f'{name} filter needs a nonempty list')
            for item in value[name]:
                validate_filter(item)
    if 'not' in value:
        validate_filter(value['not'])
    for name in ('paths', 'deck_ids', 'groups', 'templates', 'tags', 'tag_prefixes', 'card_ids'):
        if name in value and (not isinstance(value[name], list) or any(not isinstance(v, str) or not v for v in value[name])):
            raise ValueError(f'Invalid filter {name}')
    if 'include_children' in value and not isinstance(value['include_children'], bool):
        raise ValueError('include_children must be boolean')
    if 'properties' in value:
        if not isinstance(value['properties'], dict):
            raise ValueError('properties must be an object')
        for expected in value['properties'].values():
            if isinstance(expected, dict) and (set(expected) != {'exists'} or not isinstance(expected['exists'], bool)):
                raise ValueError('Property operators support only {"exists": true/false}')


def validate(config):
    if config.get('format_version') != 1 or not isinstance(config.get('profiles'), dict) or not config['profiles']:
        raise ValueError('Unsupported study configuration')
    if config.get('default_profile') not in config['profiles']:
        raise ValueError('Unknown default profile')
    for key, profile in config['profiles'].items():
        o = profile['settings']
        if not key or o.get('algorithm') != 'FSRS-6' or o.get('enable_fuzz') is not False:
            raise ValueError('Unsupported profile scheduler')
        weights = o.get('weights')
        if not isinstance(weights, list) or len(weights) not in (17, 19, 21) or any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in weights) or not o.get('parameter_policy'):
            raise ValueError(f'Invalid weights/policy for profile {key}')
        if not 0 < o['desired_retention'] < 1:
            raise ValueError('Retention must be between zero and one')
        for name, low, high in [('maximum_interval', 1, 36500), ('new_cards_per_day', 0, 1000000), ('minimum_interval', 1, 36500)]:
            value = o.get(name, 1)
            if type(value) is not int or not low <= value <= high:
                raise ValueError(f'Invalid profile {name}')
        if type(profile.get('reviews_per_day')) is not int or profile['reviews_per_day'] < 0:
            raise ValueError('Invalid review limit')
        for name in ('learning_steps', 'relearning_steps'):
            if not isinstance(o.get(name), list) or any(type(x) not in (float, int) or x <= 0 or not math.isfinite(x) for x in o[name]):
                raise ValueError('Invalid learning steps')
    for rule in config.get('profile_rules', []):
        if rule['profile'] not in config['profiles']:
            raise ValueError('Unknown assignment profile')
        validate_filter(rule['filter'])
    for key, rule in config.get('source_rules', {}).items():
        if rule.get('profile') not in config['profiles'] or not rule.get('sources'):
            raise ValueError(f'Invalid source rule {key}')
        for path in rule['sources']:
            if not isinstance(path, str) or Path(path).is_absolute() or '..' in Path(path).parts or not path:
                raise ValueError('Source paths must stay inside the vault')
        if not isinstance(rule.get('templates'),list) or any(not isinstance(key,str) for key in rule['templates']):
            raise ValueError('Source templates must be a list of keys')
        if rule.get('kind') not in (None,'block'):
            raise ValueError('Unsupported source kind')
        for field in rule['fields']:
            if field.get('transform', 'text') not in sources.TRANSFORMS:
                raise ValueError('Unknown source transformation')
        if rule.get('prepare') and rule['prepare'] not in sources.PREPARE_NOTES:
            raise ValueError('Unknown source preparation')
        if 'filter' in rule:
            validate_filter(rule['filter'])
    decks = config.get('decks', {})
    for key, deck in decks.items():
        if not isinstance(deck.get('name'),str) or not deck['name'].strip():
            raise ValueError('Decks need a nonempty name')
        validate_filter(deck['filter'])
        seen = {key}
        parent = deck.get('parent_id')
        while parent is not None:
            if parent not in decks or parent in seen:
                raise ValueError('Missing parent or cycle in study decks')
            seen.add(parent)
            parent = decks[parent].get('parent_id')
    return config


def _same_value(actual, expected):
    # JSON distinguishes booleans from numbers and missing properties from null.
    if isinstance(actual, (datetime, date)):
        actual = actual.isoformat()
    if isinstance(actual, (int, float)) and not isinstance(actual, bool) and isinstance(expected, (int, float)) and not isinstance(expected, bool):
        return actual == expected
    if type(actual) is not type(expected):
        return False
    if isinstance(actual, list):
        return len(actual)==len(expected) and all(_same_value(a,b) for a,b in zip(actual,expected))
    if isinstance(actual, dict):
        return actual.keys()==expected.keys() and all(_same_value(actual[k],expected[k]) for k in actual)
    return actual == expected


def matches(card, query, manifest):
    validate_filter(query)
    if 'all' in query and not all(matches(card, q, manifest) for q in query['all']):
        return False
    if 'any' in query and not any(matches(card, q, manifest) for q in query['any']):
        return False
    if 'not' in query and matches(card, query['not'], manifest):
        return False
    path = (card.get('source') or {}).get('path', '')
    if 'paths' in query and not any(path == p or path.startswith(p.rstrip('/') + '/') for p in query['paths']):
        return False
    for field, value in [('groups', card.get('group')), ('templates', card.get('template_key')), ('card_ids', card.get('id'))]:
        if field in query and value not in query[field]:
            return False
    if 'deck_ids' in query:
        deck = manifest['scheduling']['decks'].get(card.get('deck_id'))
        ids = {card.get('deck_id')}
        while query.get('include_children') and deck and deck.get('parent_id'):
            ids.add(deck['parent_id'])
            deck = manifest['scheduling']['decks'].get(deck['parent_id'])
        if not ids.intersection(query['deck_ids']):
            return False
    tags = set(card.get('source_tags', [])) | set(card.get('card_settings', {}).get('tags', []))
    if 'tags' in query and not set(query['tags']) <= tags:
        return False
    normalized_tags = {tag.replace('::', '/') for tag in tags}
    if 'tag_prefixes' in query and not all(
            any(tag == prefix.replace('::', '/') or tag.startswith(prefix.replace('::', '/') + '/')
                for tag in normalized_tags) for prefix in query['tag_prefixes']):
        return False
    properties = card.get('properties', {})
    for name, expected in query.get('properties', {}).items():
        actual = properties.get(name)
        if isinstance(expected, dict):
            if (name in properties) != expected['exists']:
                return False
        elif name not in properties or not _same_value(actual,expected):
            return False
    return True


def profile_id(card, config, manifest):
    explicit = card.get('card_settings', {}).get('profile')
    if explicit:
        if explicit not in config['profiles']:
            raise ValueError(f'Unknown profile {explicit}')
        return explicit
    for rule in config.get('profile_rules', []):
        home = {**card, 'deck_id':card.get('original_deck_id') or card.get('deck_id')} if card.get('original_deck_id') else card
        if matches(home, rule['filter'], manifest):
            return rule['profile']
    return card.get('profile_id') or config['default_profile']


BLOCK = re.compile(r'(?m)^[ \t]{0,3}>[ \t]*\[!(?:anki|srs)\](?:-[ \t]*|[ \t]+)([^\r\n]*)\r?\n'
                   r'((?:^[ \t]{0,3}>[ \t]?(?!\[!(?:anki|srs)\](?:-|[ \t]))[^\r\n]*(?:\r?\n|\Z))+)'
                   r'((?:^[ \t]*(?:<!--[ \t]*(?:ID|SRS-ID)[ \t]*:[ \t]*[^\r\n]+?[ \t]*-->[ \t]*)?(?:\r?\n|$))*)', re.I)
BLOCK_ID = re.compile(r'<!--[ \t]*(ID|SRS-ID)[ \t]*:[ \t]*([^\r\n]+?)[ \t]*-->', re.I)


def block_notes(path, seed=False):
    """Read existing block identities for desktop deck audits; never seed IDs."""
    if seed:
        raise ValueError('Create source identities with Tools → Refresh cards')
    text = path.read_text(encoding='utf-8')
    try:
        metadata, _ = sources.split_frontmatter(path)
    except sources.NoFrontmatterError:
        metadata = {}
    notes = []
    for match in BLOCK.finditer(text):
        markers = BLOCK_ID.findall(match[3])
        anki = {int(v.strip()) for kind, v in markers if kind.upper() == 'ID'}
        local = {str(uuid.UUID(v.strip())) for kind, v in markers if kind.upper() == 'SRS-ID'}
        if len(anki) > 1 or (not anki and len(local) > 1):
            raise ValueError(f'Conflicting block identities: {path}')
        identity = f'anki:{next(iter(anki))}' if anki else f'local:{next(iter(local))}' if local else None
        if identity:
            tags = metadata.get('tags', [])
            tags = list(tags) if isinstance(tags, list) else str(tags).split()
            tags = list(dict.fromkeys([*tags, *re.findall(r'(?<![\w/])#([\w/-]+)', match[2])]))
            notes.append((identity, sources.Note(path, {**metadata, 'tags': tags}, '')))
    return notes


def attach_properties(vault, cards):
    """Transient metadata for filter/profile evaluation; never publish note values."""
    cache = {}
    for card in cards:
        source = card.get('source') or {}
        relative = source.get('path')
        if not relative:
            continue
        path = (vault / relative).resolve()
        if not path.is_relative_to(vault.resolve()):
            raise ValueError('Source path escapes vault')
        if not path.is_file():
            continue
        cache_key=(relative,source.get('kind'))
        if cache_key not in cache:
            if source.get('kind')=='block':
                cache[cache_key]={identity:note.metadata for identity,note in block_notes(path,seed=False)}
            elif path.suffix == '.csv':
                with path.open(encoding='utf-8-sig', newline='') as stream:
                    cache[cache_key] = {srs.note_uid(row):row for row in csv.DictReader(stream) if srs.note_uid(row)}
            else:
                try:
                    metadata, _ = sources.split_frontmatter(path)
                except sources.NoFrontmatterError:
                    metadata = {}
                cache[cache_key] = {'$markdown':metadata}
        values = cache[cache_key].get('$markdown', cache[cache_key].get(card.get('note_uid'), {}))
        card['properties'] = values
        tags = values.get('tags', [])
        card['source_tags'] = tags if isinstance(tags, list) else str(tags).split()
