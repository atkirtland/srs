"""Editable rules, scheduling profiles, and generated note/card bindings.

The merged dictionaries returned here are runtime views, never a second content
store. Legacy study.json/config.json are accepted only for compatibility.
"""
from pathlib import Path
import json
from .core import digest, parse_json
from . import store


def read(path):
    return parse_json(Path(path).read_text(encoding='utf-8'), str(path))


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    temporary.replace(path)


def load_study(path, data=None):
    path = Path(path)
    if path.suffix == '.json':
        return read(path)
    data = Path(data) if data is not None else path.parent / 'data'
    profiles = read(data / 'profiles.json')
    sources = read(path / 'sources.json')
    cards = read(path / 'cards.json')
    decks = read(path / 'decks.json')
    assignments = read(path / 'profile-rules.json')
    if any(doc.get('format_version') != 1 for doc in (profiles, sources, cards, decks, assignments)):
        raise ValueError('Unsupported configuration layout')
    return dict(format_version=1, profiles=profiles['profiles'], default_profile=profiles['default_profile'],
                source_rules={key: {**rule, 'fields': runtime_fields(rule['fields']), **cards['rules'].get(key, {})} for key, rule in sources['rules'].items()},
                decks=decks['decks'], profile_rules=assignments['rules'])


def load_templates(path):
    path = Path(path)
    return read(path / 'cards.json' if path.suffix != '.json' else path)


def documents(config, templates):
    sources, bindings = {}, {}
    for key, rule in config['source_rules'].items():
        sources[key] = {k: v for k, v in rule.items() if k not in ('templates', 'profile')}
        # Field names describe the SRS note; "anki" was the old adapter spelling.
        sources[key]['fields'] = [{('name' if k == 'anki' else k): v for k, v in f.items()} for f in rule['fields']]
        bindings[key] = {k: rule[k] for k in ('templates', 'profile')}
    return {
        'sources.json': dict(format_version=1, rules=sources),
        'cards.json': dict(format_version=1, groups=templates['groups'], rules=bindings),
        'decks.json': dict(format_version=1, decks=config['decks']),
        'profile-rules.json': dict(format_version=1, rules=config.get('profile_rules', [])),
    }


def runtime_fields(fields):
    return [{('anki' if k == 'name' else k): v for k, v in f.items()} for f in fields]


def save_study(path, config, data=None, expected=None):
    """Write only changed documents. Check the complete original before saving."""
    path = Path(path)
    if expected is not None and load_study(path, data) != expected:
        raise ValueError('Configuration changed; reload and retry')
    if path.suffix == '.json':
        write(path, config)
        return
    current = load_study(path, data)
    templates = load_templates(path)
    old_docs, new_docs = documents(current, templates), documents(config, templates)
    for name in new_docs:
        if new_docs[name] != old_docs[name]:
            write(path / name, new_docs[name])
    if (current['profiles'], current['default_profile']) != (config['profiles'], config['default_profile']):
        write(Path(data) / 'profiles.json', dict(format_version=1, profiles=config['profiles'], default_profile=config['default_profile']))


def separate_cards(cards):
    """One note binding per (source rule, persistent note UID); no field recipes."""
    notes, result = {}, []
    existing = {}
    for card in cards:
        key = (card.get('group'), card.get('note_uid'))
        if card.get('note_id'):
            if key in existing and existing[key] != card['note_id']:
                raise ValueError('Conflicting persistent note identities')
            existing[key] = card['note_id']
    for card in cards:
        key = (card.get('group'), card.get('note_uid'))
        note_id = existing.get(key, digest(list(key)))
        source = card.get('source')
        locator = {k: v for k, v in (source or {}).items() if k in ('path', 'kind', 'candidates', 'error')}
        if str(locator.get('error', '')).startswith('Missing source rule: '):
            locator.pop('error')  # Derived configuration error, not a source locator.
        note = dict(id=note_id, uid=card.get('note_uid'), rule_id=card.get('group'), locator=locator or None)
        if note_id in notes and notes[note_id] != note:
            raise ValueError(f'Conflicting source bindings for note {note_id}')
        notes[note_id] = note
        result.append({**{k: v for k, v in card.items() if k not in ('group', 'note_uid', 'source', 'properties', 'source_tags', 'template', 'fields', 'history')}, 'note_id': note_id})
    return list(notes.values()), result


def hydrate_cards(cards, notes, config):
    bindings = {note['id']: note for note in notes}
    if len(bindings) != len(notes):
        raise ValueError('Duplicate SRS note binding')
    result = []
    for card in cards:
        if card['note_id'] not in bindings:
            raise ValueError(f'Missing SRS note binding: {card["note_id"]}')
        note = bindings[card['note_id']]
        rule = config.get('source_rules', {}).get(note['rule_id'])
        source = dict(note['locator']) if note['locator'] else None
        if source is not None:
            if rule is None:
                source['error'] = f'Missing source rule: {note["rule_id"]}'
            else:
                source['fields'] = runtime_fields(rule['fields'])
                if rule.get('prepare'):
                    source['prepare'] = rule['prepare']
        result.append({**card, 'group': note['rule_id'], 'note_uid': note['uid'], 'source': source})
    return result


def upgrade(root, data=None, configuration=None, templates=None):
    """Convert the legacy layout in place; switch the catalog pointer last.

    Reviews and scheduler archives are never opened for writing. Existing rule
    documents must match, so an interrupted conversion is safe to retry.
    """
    from . import study
    root = Path(root)
    data = Path(data) if data is not None else root / 'data'
    destination = root / 'config'
    manifest, cards = study.load_cards(data)
    if 'note_partition_count' in manifest:
        study.validate(load_study(destination, data))
        return split_partitions(data, manifest, len(cards))
    original = study.validate(configuration if configuration is not None else read(root / 'study.json'))
    templates = templates if templates is not None else read(root / 'config.json')
    docs = documents(original, templates)
    docs_profiles = dict(format_version=1, profiles=original['profiles'], default_profile=original['default_profile'])
    # Validate every target before writing any of them.
    targets = {**{destination / name: value for name, value in docs.items()}, data / 'profiles.json': docs_profiles}
    for path, value in targets.items():
        if path.exists() and read(path) != value and not (configuration is not None and path == destination / 'cards.json' and read(path).get('groups') == value['groups'] and not read(path).get('rules')):
            raise ValueError(f'Refusing to overwrite different configuration: {path}')
    notes, stored = separate_cards(cards)
    # Central rules must express the same field recipe used by existing cards.
    for card in cards:
        source = card.get('source')
        if source and source.get('fields'):
            rule = original['source_rules'].get(card.get('group'))
            if not rule or source['fields'] != rule['fields'] or source.get('prepare') != rule.get('prepare'):
                raise ValueError(f'Source rule differs from saved binding for card {card["id"]}; reconcile study.json before conversion')
    revision = digest(dict(previous=manifest['revision'], layout=1, notes=notes, cards=stored))
    target = data / 'imports' / revision
    for i in range(0, len(stored), 250):
        write(data / 'cards' / revision / f'cards-{i//250:05d}.json', stored[i:i+250])
    for i in range(0, len(notes), 250):
        write(data / 'notes' / revision / f'notes-{i//250:05d}.json', notes[i:i+250])
    report = data / 'imports' / manifest['revision'] / 'report.json'
    if report.exists():
        write(target / 'report.json', read(report))
    for path, value in targets.items():
        if not path.exists() or read(path) != value:
            write(path, value)
    if study.validate(load_study(destination, data)) != original:
        raise ValueError('Configuration round-trip failed')
    hydrated = hydrate_cards(stored, notes, original)
    if [c['id'] for c in hydrated] != [c['id'] for c in cards] or any(a.get('baseline') != b.get('baseline') for a, b in zip(cards, hydrated)):
        raise ValueError('Card identity/state round-trip failed')
    if read(data / 'manifest.json') != manifest or configuration is None and (read(root / 'study.json') != original or read(root / 'config.json') != templates):
        raise ValueError('Store/configuration changed during conversion; retry')
    replacement = {**manifest, 'catalog_layout':'split', 'revision': revision, 'partition_count': (len(stored)+249)//250,
                   'note_partition_count': (len(notes)+249)//250}
    replacement.pop('partitions', None)
    write(data / 'manifest.json', replacement)
    # The new pointer and all referenced documents are valid before old generated
    # files/configuration are removed. Card/review identities are unchanged.
    study.load_cards(data)
    import shutil
    for old in (data / 'imports').iterdir():
        if old.is_dir() and old != target:
            shutil.rmtree(old)
    store.clean_partitions(data, revision)
    if configuration is None:
        (root / 'study.json').unlink()
        (root / 'config.json').unlink()
    split_partitions(data, replacement, len(stored))
    return dict(cards=len(stored), notes=len(notes), converted=True, revision=revision)


def split_partitions(data, manifest, card_count):
    """Relocate existing normalized partitions; preserve their bytes and revision."""
    if manifest.get('catalog_layout') == 'flat':
        return dict(cards=card_count, converted=False, revision=manifest['revision'])
    cards = [c for p in store.partition_paths(manifest) for c in read(data / p)]
    notes = [n for p in store.note_paths(manifest) for n in read(data / p)]
    store.publish(data, manifest, manifest, cards, notes)
    return dict(cards=card_count, converted=True, revision=manifest['revision'])
