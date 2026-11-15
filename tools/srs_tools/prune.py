"""Explicit removal of unreviewed generated cards whose source identity is gone."""
import csv
from pathlib import Path
import uuid
from . import core, layout, store, study, vault as sources


def prune(vault, data, configuration, apply=False):
    vault, data = Path(vault).resolve(), Path(data)
    config = study.validate(layout.load_study(configuration, data))
    manifest, cards = study.load_cards(data, config)
    if 'note_partition_count' not in manifest:
        raise ValueError('Pruning requires the current notes/cards storage layout')
    raw_cards = [c for p in store.partition_paths(manifest) for c in layout.read(data/p)]
    notes = [n for p in store.note_paths(manifest) for n in layout.read(data/p)]
    live = set()
    # Refuse incomplete mounts, rather than treating an unavailable vault as deleted content.
    for group, rule in config['source_rules'].items():
        for relative in rule['sources']:
            path = (vault/relative).resolve()
            if not path.is_relative_to(vault) or not path.exists():
                raise ValueError(f'Source unavailable; refusing cleanup: {path}')
            paths = [path] if path.is_file() else sorted(path.glob('**/*.md' if rule.get('recursive') else '*.md'))
            for source in paths:
                if rule.get('kind') == 'block':
                    live.update((group, identity) for identity, _ in study.block_notes(source, seed=False))
                elif source.suffix.lower() == '.csv':
                    with source.open(encoding='utf-8-sig', newline='') as stream:
                        for row in csv.DictReader(stream):
                            identity = core.note_uid(row)
                            if identity:
                                live.add((group, identity))
                elif source.suffix.lower() == '.md':
                    try:
                        metadata, _ = sources.split_frontmatter(source)
                    except sources.NoFrontmatterError:
                        continue
                    if not (metadata.get('anki_note_id') or 'srs_note_id' in metadata):
                        continue
                    identity = core.note_uid(metadata)
                    if identity:
                        live.add((group, identity))
    referenced = set()
    # Preserve any card with log data, including answers and per-card settings.
    for path in (data/'reviews').glob('*.jsonl'):
        for line in path.read_text(encoding='utf-8').splitlines():
            if line.strip():
                event = core.parse_json(line, str(path))
                if event.get('card_id'):
                    referenced.add(event['card_id'])
    candidates, protected = [], []
    for card in cards:
        if card.get('anki_card_id') or not str(card.get('note_uid', '')).startswith('local:'):
            continue
        if (card.get('group'), card.get('note_uid')) in live:
            continue
        record = {'card_id':card['id'], 'note_id':card['note_id'], 'rule':card.get('group'),
                  'source':(card.get('source') or {}).get('path'), 'added_at':card.get('added_at')}
        if card['id'] in referenced or card.get('baseline', {}).get('reps', 0):
            protected.append(record)
        else:
            candidates.append(record)
    removed = {row['card_id'] for row in candidates}
    kept = [c for c in raw_cards if c['id'] not in removed]
    used_notes = {c['note_id'] for c in kept}
    affected_notes = {row['note_id'] for row in candidates}
    removed_notes = {n['id'] for n in notes if n['id'] in affected_notes and n['id'] not in used_notes}
    if apply and removed:
        store.publish(data, manifest, {**manifest, 'revision':str(uuid.uuid4())}, kept,
                      [n for n in notes if n['id'] not in removed_notes],
                      remove_cards=removed, remove_notes=removed_notes)
    return {'applied':apply, 'removable_cards':len(candidates), 'removable_notes':len(removed_notes),
            'cards':candidates, 'protected_cards':protected}
