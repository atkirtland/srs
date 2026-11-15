"""Append-only bridge from a closed Anki snapshot into an existing SRS store."""
from collections import defaultdict
from datetime import date, datetime, timezone
import json
import uuid
from zoneinfo import ZoneInfo

import srs
import scheduling
from srs_tools.layout import read, write
from srs_tools.store import partition_paths
from srs_tools.training import events_from_logs
from catalog import LOG_LIMIT


def plan(raw, data, version):
    manifest = read(data / 'manifest.json')
    if (data / 'catalog.pending.json').exists():
        raise ValueError('Finish the pending catalog update before importing reviews')
    collection = str(raw['col'][0]['crt'])
    if collection != manifest['collection_key']:
        raise ValueError('Snapshot belongs to a different collection')
    cards = [c for path in partition_paths(manifest) for c in read(data / path)]
    mapped = {str(c['anki_card_id']): c for c in cards if c.get('anki_card_id')}
    events = events_from_logs(data)
    seen = {e['id']: e for e in events}
    prior = defaultdict(list)
    for event in events:
        if event.get('card_id'):
            prior[event['card_id']].append(event)
    rows = defaultdict(list)
    for row in sorted(raw['revlog'], key=lambda r: r['id']):
        rows[str(row['cid'])].append(row)
    native = {str(c['id']): c for c in raw['cards']}
    meta = scheduling.metadata(raw, version)
    timing = manifest['timing']
    pending, conflicts, unknown = [], [], []
    for aid, history in rows.items():
        fresh = [r for r in history if f"anki:{collection}:{r['id']}" not in seen]
        if not fresh:
            continue
        card = mapped.get(aid)
        if not card or aid not in native:
            unknown.append(aid)
            continue
        cid = card['id']
        old = prior[cid]
        # Conservatively preserve every local branch; there is no automatic
        # reconciliation between independently trained schedulers.
        answers = [e for e in old if e.get('kind', 'answer') == 'answer']
        if answers:
            conflicts.append({'card_id': cid, 'anki_card_id': aid, 'reason': 'reviewed locally; both branches retained unchanged'})
            continue
        latest_import = max((e['review_time_ms'] for e in old if e.get('kind') in ('historical_review', 'anki_state')), default=0)
        if history[-1]['id'] < latest_import:
            conflicts.append({'card_id': cid, 'anki_card_id': aid, 'reason': 'snapshot is older than imported history'})
            continue
        source = native[aid]
        if source.get('odid'):
            conflicts.append({'card_id': cid, 'anki_card_id': aid, 'reason': 'card is in an Anki filtered deck; empty it before importing'})
            continue
        settings = scheduling.effective(meta, source['did'])
        observations = []
        for row in history:
            observations.append(dict(format_version=2, kind='historical_review', id=f"anki:{collection}:{row['id']}",
                device_id='anki', collection_key=collection, anki_revlog_id=str(row['id']), anki_card_id=aid,
                card_id=cid, review_time_ms=row['id'], rating=row['ease'], duration_ms=row['time'],
                review_type=row['type'], interval=srs.interval(row['ivl']), previous_interval=srs.interval(row['lastIvl']), original_review=row))
        due = srs.normalize_due(dict(source, queue=source['queue'] if source['queue'] >= 0 else
            0 if source['type'] == 0 else 2 if source['type'] == 2 else 1),
            date.fromisoformat(timing['day_zero']), ZoneInfo(timing['timezone']), timing['rollover_hour'])
        state = scheduling.saved_state(source, observations, due, settings, history[-1]['id'])
        if state is None:
            conflicts.append({'card_id': cid, 'anki_card_id': aid, 'reason': 'no saved Anki memory state; bridge will not reconstruct it'})
            continue
        for event in observations:
            if event['id'] in seen:
                existing = seen[event['id']]
                if existing != dict(event, device_id=existing['device_id']):
                    raise ValueError(f"Imported review changed: {event['id']}")
            else:
                pending.append(event)
        identity = str(uuid.uuid5(uuid.NAMESPACE_URL, f"srs:anki-state:{collection}:{aid}:{history[-1]['id']}"))
        imported_state = dict(format_version=2, kind='anki_state', id=identity, device_id='anki', card_id=cid,
            import_id=manifest['import_id'], review_time_ms=history[-1]['id'], state=state,
            anki_revlog_id=str(history[-1]['id']))
        if identity in seen:
            if seen[identity] != imported_state:
                raise ValueError(f'Anki state changed without a new review: {aid}')
        else:
            pending.append(imported_state)
    return manifest, pending, dict(new_reviews=sum(e['kind']=='historical_review' for e in pending),
        updated_cards=sum(e['kind']=='anki_state' for e in pending), conflicts=conflicts, unmapped_anki_cards=unknown)


def apply(data, manifest, events):
    """Publish whole JSONL replacements atomically, with an idempotent journal."""
    journal = data / 'anki-bridge.pending.json'
    if journal.exists():
        raise ValueError('Pending bridge exists; run the command again to recover it first')
    if read(data / 'manifest.json') != manifest:
        raise ValueError('Catalog changed; retry')
    affected = {e['card_id'] for e in events}
    if any(e.get('kind', 'answer') == 'answer' and e.get('card_id') in affected
           for e in events_from_logs(data)):
        raise ValueError('Local answers appeared during import; close the reviewer and retry')
    logs = {}
    for event in sorted(events, key=lambda e: (e['review_time_ms'], e['id'])):
        month = datetime.fromtimestamp(event['review_time_ms']/1000, timezone.utc).strftime('%Y-%m')
        line = srs.canonical(event) + '\n'
        if len(line.encode('utf-8')) > LOG_LIMIT:
            raise ValueError('Imported event exceeds the 32 MiB log limit')
        part = 1
        while True:
            suffix = '' if part == 1 else f'-{part:03d}'
            name = f'anki-{month}{suffix}.jsonl'
            path = data / 'reviews' / name
            if name not in logs:
                logs[name] = path.read_text() if path.exists() else ''
            if len((logs[name] + line).encode()) <= LOG_LIMIT:
                logs[name] += line
                break
            part += 1
    if not events:
        return
    # Journal stores only event metadata, never note contents.
    write(journal, {'manifest': manifest, 'logs': logs})
    recover(data)


def recover(data):
    journal = data / 'anki-bridge.pending.json'
    if not journal.exists():
        return
    transaction = read(journal)
    if read(data / 'manifest.json') != transaction['manifest']:
        raise ValueError('Pending Anki bridge conflicts with catalog; restore the pre-import store before retrying')
    for name, text in transaction['logs'].items():
        if '/' in name or '\\' in name or not name.startswith('anki-') or not name.endswith('.jsonl'):
            raise ValueError('Invalid bridge log path')
        path = data / 'reviews' / name
        current = path.read_text() if path.exists() else ''
        if not text.startswith(current):
            raise ValueError(f'Log changed during bridge import: {name}')
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix('.jsonl.bridge-tmp')
        temporary.write_text(text, encoding='utf-8')
        temporary.replace(path)
    journal.unlink()
