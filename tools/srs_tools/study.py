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
    allowed = {'all', 'any', 'not', 'paths', 'deck_ids', 'include_children', 'groups', 'templates', 'tags', 'properties', 'card_ids'}
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
    for name in ('paths', 'deck_ids', 'groups', 'templates', 'tags', 'card_ids'):
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


def _seed_markdown(path):
    text = path.read_text(encoding='utf-8')
    metadata, _ = sources.split_frontmatter(path)
    existing = srs.note_uid(metadata)
    if existing:
        return existing
    if 'srs_note_id' not in metadata:
        raise ValueError(f'Missing srs_note_id opt-in: {path}')
    identity = str(uuid.uuid4())
    # Only fill the opted-in frontmatter field, preserving the rest of the file.
    opening = re.match(r'\A---[ \t]*\r?\n', text)
    closing = re.search(r'(?m)^---[ \t]*\r?$', text[opening.end():])
    end = opening.end() + closing.start()
    header = text[opening.end():end]
    header, count = re.subn(r'(?m)^srs_note_id:[^\r\n]*', f'srs_note_id: {identity}', header)
    if count != 1:
        raise ValueError(f'Expected one srs_note_id field: {path}')
    path.write_text(text[:opening.end()] + header + text[end:], encoding='utf-8')
    return f'local:{identity}'


# Local blocks need their own persistent identity, independent of file position.
BLOCK = re.compile(r'(?m)^[ \t]{0,3}>[ \t]*\[!(?:anki|srs)\](?:-[ \t]*|[ \t]+)([^\r\n]*)\r?\n'
                   r'((?:^[ \t]{0,3}>[ \t]?(?!\[!(?:anki|srs)\](?:-|[ \t]))[^\r\n]*(?:\r?\n|\Z))+)'
                   r'((?:^[ \t]*(?:<!--[ \t]*(?:ID|SRS-ID)[ \t]*:[ \t]*[^\r\n]+?[ \t]*-->[ \t]*)?(?:\r?\n|$))*)', re.I)
BLOCK_ID = re.compile(r'<!--[ \t]*(ID|SRS-ID)[ \t]*:[ \t]*([^\r\n]+?)[ \t]*-->', re.I)


def block_notes(path, seed=True):
    text = path.read_text(encoding='utf-8')
    original = text
    if seed:
        # Move an existing local marker above intervening blank lines as well.
        text = re.sub(r'(?m)(^[ \t]{0,3}>[^\r\n]*\r?\n)((?:[ \t]*\r?\n)+)([ \t]*<!--[ \t]*SRS-ID[ \t]*:[^\r\n]*-->[ \t]*(?:\r?\n|$))',
                      lambda m: m[1] + m[3] + ('\n' if not m[3].endswith('\n') else '') + m[2], text, flags=re.I)
    replacements, notes = [], []
    try:
        file_metadata,_=sources.split_frontmatter(path)
    except sources.NoFrontmatterError:
        file_metadata={}
    for m in BLOCK.finditer(text):
        markers = BLOCK_ID.findall(m[3])
        anki_ids = {int(value.strip()) for kind, value in markers if kind.upper() == 'ID'}
        local_ids = {str(uuid.UUID(value.strip())) for kind, value in markers if kind.upper() == 'SRS-ID'}
        if len(anki_ids) > 1 or (not anki_ids and len(local_ids) > 1):
            raise ValueError(f'Conflicting block identities in {path}')
        identity = f'anki:{next(iter(anki_ids))}' if anki_ids else f'local:{next(iter(local_ids))}' if local_ids else None
        if identity is None:
            if not seed:
                continue
            value = str(uuid.uuid4()); identity = f'local:{value}'
            offset = m.end(2)  # Immediately after quoted lines, before trailing blank lines.
            prefix='' if text[:offset].endswith('\n') else '\n'
            replacements.append((offset, prefix + f'<!-- SRS-ID: {value} -->\n'))
        back = '\n'.join(re.sub(r'^[ \t]{0,3}>[ \t]?', '', line) for line in m[2].splitlines())
        back = '\n'.join(line for line in back.splitlines() if not re.fullmatch(r'\s*(?:#[^\s#]+\s*)+', line)).strip()
        tags=file_metadata.get('tags', [])
        tags=list(tags) if isinstance(tags,list) else str(tags).split()
        tags=list(dict.fromkeys([*tags,*re.findall(r'(?<![\w/])#([\w/-]+)',m[2])]))
        notes.append((identity, sources.Note(path, {**file_metadata,'$front':m[1].strip(),'$back':back,'tags':tags}, '')))
    for offset, value in reversed(replacements):
        text = text[:offset] + value + text[offset:]
    if replacements or text != original:
        path.write_text(text, encoding='utf-8')
    return notes


def template_conditions_allow_question(template, note, rule):
    """Suppress empty conditional questions, without hiding ordinary content errors.

    Field placeholders remain potentially visible: missing non-conditional fields
    must still produce accessible error cards. Only false sections remove them.
    Unknown conditions/failed transformations conservatively retain the card.
    """
    front = template['front']
    if not re.search(r'{{[#^]', front):
        return True
    fields = {f['anki']: f for f in rule['fields']}

    def truth(name):
        field = fields.get(name)
        if field is None:
            return None
        source = field['source']
        value = (note.body if source == '$body' else note.filename if source == '$filename'
                 else note.metadata.get(source))
        try:
            return bool(sources.TRANSFORMS[field.get('transform', 'text')](value, note).strip())
        except Exception:
            return None

    stack = []
    visible = []
    offset = 0
    for match in re.finditer(r'{{([#^/])([^{}]+)}}', front):
        if all(active for _, active in stack):
            visible.append(front[offset:match.start()])
        op, name = match[1], match[2].strip()
        if op == '/':
            if not stack or stack[-1][0] != name:
                return True
            stack.pop()
        else:
            if not all(active for _, active in stack):
                stack.append((name, False))
            else:
                value = truth(name)
                if value is None:
                    return True
                stack.append((name, value if op == '#' else not value))
        offset = match.end()
    if stack:
        return True
    visible.append(front[offset:])
    question = ''.join(visible)
    question = re.sub(r'<!--.*?-->|<(script|style)\b[^>]*>.*?</\1>', '', question, flags=re.S | re.I)
    # Images/audio are meaningful even without text.
    if re.search(r'<(?:img|audio|video|svg)\b|\[sound:', question, re.I):
        return True
    return bool(re.sub(r'<[^>]*>', '', question).strip())


def discover(vault, config, templates, manifest, issues=None, note_bindings=None):
    """Return metadata only; content is transient and always re-read by the view."""
    found = []
    if issues is None:
        issues=[]
    for group, rule in config.get('source_rules', {}).items():
        for relative in rule['sources']:
            if not (vault / relative).resolve().is_relative_to(vault.resolve()):
                raise ValueError('Source path escapes vault')
        available=[]
        for relative in rule['sources']:
            if (vault / relative).exists():
                available.append(relative)
            else:
                issues.append({'rule':group,'path':relative,'error':'Missing source; existing cards preserved'})
        selected_templates = [t for t in templates['groups'][group]['templates'] if t['key'] in rule['templates'] and t.get('enabled', True)]
        if rule.get('kind') == 'block':
            records = []
            for relative in available:
                directory = vault / relative
                if not directory.exists():
                    raise ValueError(f'Missing source: {directory}')
                paths = [directory] if directory.is_file() else sorted(directory.glob('**/*.md' if rule.get('recursive') else '*.md'))
                for path in paths:
                    records.extend(block_notes(path))
        else:
            for relative in available:
                if relative.endswith('.csv'):
                    srs.seed_csv_uids(vault / relative)
            regular=[relative for relative in available if not ((vault / relative).is_file() and relative.lower().endswith('.md'))]
            singles=[]
            for relative in available:
                path=vault / relative
                if path.is_file() and relative.lower().endswith('.md'):
                    try:
                        metadata,body=sources.split_frontmatter(path)
                    except sources.NoFrontmatterError:
                        continue
                    singles.append(sources.Note(path,metadata,body))
            export = sources.Export(tuple(regular), None, tuple(sources.Field(f['anki'], f['source'], sources.TRANSFORMS[f.get('transform', 'text')], f.get('required', False), f.get('missing_source')) for f in rule['fields']),
                                    recursive=rule.get('recursive', False), filenames=frozenset(rule['filenames']) if rule.get('filenames') else None)
            records = []
            for note in [*sources.source_notes(vault, export),*singles]:
                if not Path(str(note.path).split('#row-')[0]).resolve().is_relative_to(vault.resolve()):
                    raise ValueError('Source path escapes vault')
                if rule.get('required_property') and rule['required_property'] not in note.metadata:
                    continue
                if rule.get('required_any_property') and not any(p in note.metadata for p in rule['required_any_property']):
                    continue
                is_csv = '#row-' in str(note.path) or str(note.path).lower().endswith('.csv')
                if not is_csv and not (str(note.metadata.get('anki_note_id', '') or '').strip() or 'srs_note_id' in note.metadata):
                    continue
                identity = srs.note_uid(note.metadata)
                if not identity:
                    identity = _seed_markdown(note.path)
                records.append((identity, note))
        seen = set()
        for identity, note in records:
            if identity in seen:
                raise ValueError(f'Duplicate source identity in rule {group}: {identity}')
            seen.add(identity)
            path = Path(str(note.path).split('#row-')[0]).resolve().relative_to(vault.resolve()).as_posix()
            source = dict(path=path, kind='block' if rule.get('kind') == 'block' else 'csv' if path.endswith('.csv') else 'markdown', fields=rule['fields'])
            if rule.get('prepare'):
                source['prepare'] = rule['prepare']
            tags=note.metadata.get('tags', [])
            candidate = dict(group=group, note_uid=identity, source=source, properties=note.metadata, source_tags=tags if isinstance(tags,list) else str(tags).split())
            if not matches(candidate, rule.get('filter', {}), manifest):
                continue
            if note_bindings is not None:
                note_bindings.append(dict(candidate))
            for template in selected_templates:
                candidate['template_key']=template['key']
                if not matches(candidate, template.get('when', {}), manifest):
                    continue
                if not template_conditions_allow_question(template, note, rule):
                    continue
                ordinals = [template['anki_ordinal']]
                if '{{cloze:' in template['front']:
                    fields = {f['anki']: note.body if f['source']=='$body' else note.filename if f['source']=='$filename' else note.metadata.get(f['source'], '') for f in rule['fields']}
                    clozes = sorted({int(n)-1 for expression in re.findall(r'{{cloze:([^}]+)}}', template['front'])
                                     for n in re.findall(r'{{c([1-9][0-9]*)::', str(fields.get(expression, '')))})
                    ordinals = clozes
                for ordinal in ordinals:
                    found.append(dict(note_uid=identity, group=group, template_key=template['key'], source=source,
                                      anki_notetype=template['anki_notetype'], anki_ordinal=ordinal, profile_id=rule['profile'],
                                      **({'cloze':True} if '{{cloze:' in template['front'] else {})))
    return found


def refresh_cards(vault, data, study_path, config_path, choose_mapping=None):
    config = validate(layout.load_study(study_path, data)); templates = layout.load_templates(config_path)
    for group,rule in config['source_rules'].items():
        if group not in templates.get('groups', {}):
            raise ValueError(f'Unknown template group: {group}')
        keys={t['key'] for t in templates['groups'][group]['templates']}
        if set(rule['templates']) - keys:
            raise ValueError(f'Unknown templates in source rule {group}: {set(rule["templates"])-keys}')
    manifest, cards = load_cards(data, config)
    issues=[]
    note_bindings = []
    found = discover(vault, config, templates, manifest, issues, note_bindings)
    from .conversion import convert, prompt_mapping
    converted, conversions = convert(cards, found, note_bindings, choose_mapping or prompt_mapping)
    # Match imported cloze ordinals separately, retaining their existing template keys/UIDs.
    known = {(c.get('group'), c.get('note_uid'), c.get('template_key'), c.get('anki_ordinal')): c for c in cards if not c.get('retired')}
    unbound = {}
    for card in cards:
        if not card.get('retired') and (not card.get('group') or not card.get('template_key')):
            key=(card.get('note_uid'),card.get('anki_notetype'),card.get('anki_ordinal'))
            unbound.setdefault(key,[]).append(card)
    proposals={}
    for item in found:
        key=(item['note_uid'],item['anki_notetype'],item['anki_ordinal'])
        if key in unbound:
            proposals.setdefault(key,set()).add((item['group'],item['template_key']))
    if any(len(values)>1 for values in proposals.values()):
        raise ValueError('Multiple source rules would bind the same unmapped imported card')
    variants = {(c.get('group'),c.get('note_uid'),c.get('anki_ordinal'),c.get('anki_notetype')) for c in cards if not c.get('retired')}
    uids = {c['id'] for c in cards}
    now = int(datetime.now(timezone.utc).timestamp() * 1000)
    added, updated = 0, converted
    for item in found:
        key = (item['group'], item['note_uid'], item['template_key'], item['anki_ordinal'])
        previous = known.get(key)
        if previous:
            if previous.get('source') != item['source']:
                previous['source'] = item['source']; updated += 1
            continue
        imported=unbound.get((item['note_uid'],item['anki_notetype'],item['anki_ordinal']),[])
        if imported:
            if len(imported)!=1:
                raise ValueError('Ambiguous unmapped imported card binding')
            previous=imported[0]
            previous.update(group=item['group'],template_key=item['template_key'],source=item['source'])
            if item.get('cloze'):
                previous['cloze']=True
            known[key]=previous;updated+=1
            continue
        # Match an existing cloze variant even if it used an ordinal-specific template.
        variant = (item['group'],item['note_uid'],item['anki_ordinal'],item['anki_notetype'])
        alternate = variant in variants
        if alternate and '{{cloze:' in next(t['front'] for t in templates['groups'][item['group']]['templates'] if t['key'] == item['template_key']):
            continue
        suffix = item['template_key']
        template = next(t for t in templates['groups'][item['group']]['templates'] if t['key'] == item['template_key'])
        if item['anki_ordinal'] != template['anki_ordinal']:
            suffix += f":cloze:{item['anki_ordinal']}"
        uid = srs.card_uid(item['group'], item['note_uid'], suffix)
        if uid in uids:
            raise ValueError(f'Card identity collision: {uid}')
        profile = item['profile_id']; home = f'profile:{profile}'
        state = dict(due=now, queue=0, state=0, stability=0, difficulty=0, reps=0, lapses=0,
                     elapsed_days=0, scheduled_days=0, learning_steps=0)
        card = dict(item, id=uid, anki_card_id=None, original_deck_id=None, deck_id=home, active=True,
                    supported=True, queue=0, card_type=0, due_ms=now, anki_due=0, baseline=state, scheduling={'queue':0}, memory={})
        cards.append(card); known[key] = card; uids.add(uid); variants.add(variant); added += 1
    # An unavailable source does not delete or retire existing cards. They remain inspectable errors.
    if not added and not updated:
        return {'added':0, 'updated':0, 'cards':len(cards), 'revision':manifest['revision'],'issues':issues}
    revision = str(uuid.uuid4())  # Cache invalidation token, not a storage directory.
    normalized = 'note_partition_count' in manifest or Path(study_path).suffix != '.json'
    notes, stored_cards = layout.separate_cards(cards) if normalized else (None, cards)
    replacement = {**manifest, 'revision':revision}
    catalog.publish(data, manifest, replacement, stored_cards, notes,
                    added_at=datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'))
    # The imported baseline identity, all logs, and immutable scheduler archives stay intact.
    return {'added':added, 'updated':updated, 'cards':len(cards), 'revision':revision,'issues':issues, 'type_conversions':conversions}


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
