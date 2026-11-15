"""Explicit removal of unreviewed generated cards whose source identity is gone."""
import csv
from pathlib import Path
import uuid
from . import core, layout, store, study, vault as sources


def prune(vault, data, configuration, apply=False):
    vault, data = Path(vault).resolve(), Path(data)
    config = study.validate(layout.load_study(configuration, data))
    store.recover(data)
    manifest = layout.read(data/'manifest.json')
    if 'note_partition_count' not in manifest:
        raise ValueError('Pruning requires the current notes/cards storage layout')
    live = set()
    from .source_cache import source_cache, source_files, unchanged_snapshot
    # Refuse incomplete mounts, rather than treating an unavailable vault as deleted content.
    with source_cache(vault, data, 'prune') as cache:
        signature, file_count = unchanged_snapshot(cache, config, None, manifest, strict=True, reviews=True)
        previous = cache.checkpoint(signature)
        if previous is not None:
            cache.keep_existing()
            return {**previous, 'applied':apply, 'scan':dict(parsed_files=0, reused_files=file_count, hashed_files=0)}
        raw_cards = [c for p in store.partition_paths(manifest) for c in layout.read(data/p)]
        notes = [n for p in store.note_paths(manifest) for n in layout.read(data/p)]
        cards = layout.hydrate_cards(raw_cards, notes, config)
        if len({c['id'] for c in cards}) != len(cards):
            raise ValueError('Duplicate catalog card identity')
        for group, rule in config['source_rules'].items():
            for source in source_files(vault, rule, strict=True):
                def identities():
                    if rule.get('kind') == 'block':
                        return [identity for identity, _ in study.block_notes(source, seed=False)]
                    if source.suffix.lower() == '.csv':
                        with source.open(encoding='utf-8-sig', newline='') as stream:
                            return [identity for row in csv.DictReader(stream) if (identity := core.note_uid(row))]
                    if source.suffix.lower() == '.md':
                        try:
                            metadata, _ = sources.split_frontmatter(source)
                        except sources.NoFrontmatterError:
                            return []
                        if metadata.get('anki_note_id') or 'srs_note_id' in metadata:
                            identity = core.note_uid(metadata)
                            return [identity] if identity else []
                    return []
                live.update((group, identity) for identity in cache.read(source, rule.get('kind'), identities))
        scan = dict(cache.stats)
    pending, protected = [], []
    for card in cards:
        if card.get('anki_card_id') or not str(card.get('note_uid', '')).startswith('local:'):
            continue
        if (card.get('group'), card.get('note_uid')) in live:
            continue
        record = {'card_id':card['id'], 'note_id':card['note_id'], 'rule':card.get('group'),
                  'source':(card.get('source') or {}).get('path'), 'added_at':card.get('added_at')}
        if card.get('baseline', {}).get('reps', 0):
            protected.append(record)
        else:
            pending.append(record)
    referenced = set()
    # No missing unreviewed sources means logs cannot affect the result.
    if pending:
        with source_cache(vault, data, 'prune-reviews') as cache:
            for path in sorted((data/'reviews').glob('*.jsonl')):
                def references():
                    ids = set()
                    with path.open(encoding='utf-8') as stream:
                        for line in stream:
                            if line.strip():
                                event = core.parse_json(line, str(path))
                                if event.get('card_id'):
                                    ids.add(event['card_id'])
                    return sorted(ids)
                referenced.update(cache.read(path, {}, references))
    candidates = []
    for record in pending:
        (protected if record['card_id'] in referenced else candidates).append(record)
    removed = {row['card_id'] for row in candidates}
    kept = [c for c in raw_cards if c['id'] not in removed]
    used_notes = {c['note_id'] for c in kept}
    affected_notes = {row['note_id'] for row in candidates}
    removed_notes = {n['id'] for n in notes if n['id'] in affected_notes and n['id'] not in used_notes}
    if apply and removed:
        store.publish(data, manifest, {**manifest, 'revision':str(uuid.uuid4())}, kept,
                      [n for n in notes if n['id'] not in removed_notes],
                      remove_cards=removed, remove_notes=removed_notes)
    result = {'applied':apply, 'removable_cards':len(candidates), 'removable_notes':len(removed_notes),
              'cards':candidates, 'protected_cards':protected, 'scan':scan}
    if not removed:
        with source_cache(vault, data, 'prune') as cache:
            current, _ = unchanged_snapshot(cache, config, None, manifest, strict=True, reviews=True)
            cache.keep_existing()
            if current == signature:
                cache.save_checkpoint(signature, result)
    return result
