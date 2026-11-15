"""Read the current card metadata generation without native dependencies."""
def partition_paths(manifest):
    if "partition_count" in manifest:
        count = manifest["partition_count"]
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise ValueError("Invalid card partition count")
        return [f"{partition_directory(manifest, 'cards')}/cards-{index:05d}.json" for index in range(count)]
    return manifest["partitions"]


def partition_directory(manifest, kind):
    layout = manifest.get('catalog_layout')
    if layout not in (None, 'split', 'flat'):
        raise ValueError(f'Unsupported catalog layout: {layout}')
    if layout == 'flat':
        return kind
    return f"{kind if layout == 'split' else 'imports'}/{manifest['revision']}"


def note_paths(manifest):
    count = manifest['note_partition_count']
    if type(count) is not int or count < 0:
        raise ValueError('Invalid note partition count')
    return [f"{partition_directory(manifest, 'notes')}/notes-{i:05d}.json" for i in range(count)]


def clean_partitions(data, revision):
    """Remove superseded generated partitions after publishing the new pointer."""
    import shutil
    for kind in ('notes', 'cards'):
        for old in (data / kind).glob('*'):
            if old.is_dir() and old.name != revision:
                shutil.rmtree(old)
    # Reports remain import metadata; old colocated partitions are superseded.
    for pattern in ('cards-*.json', 'notes-*.json'):
        for old in (data / 'imports').glob(f'*/{pattern}'):
            old.unlink()


def recover(data):
    """Finish an interrupted metadata transaction before opening the store."""
    from .layout import read, write
    pending = data / 'catalog.pending.json'
    if not pending.exists():
        return
    transaction = read(pending)
    current = read(data / 'manifest.json') if (data / 'manifest.json').exists() else None
    if current not in (transaction['previous'], transaction['manifest']):
        raise ValueError('Pending catalog update conflicts with current manifest')
    for path, records in transaction['files'].items():
        parts = path.split('/')
        if len(parts) != 2 or parts[0] not in ('notes', 'cards') or not parts[1].startswith(parts[0] + '-') or not parts[1].endswith('.json') or '..' in parts[1]:
            raise ValueError('Invalid pending partition path')
        write(data / path, records)
    write(data / 'manifest.json', transaction['manifest'])
    pending.unlink()


def publish(data, previous, replacement, cards, notes=None, added_at=None):
    """Keep existing partition positions; replace only changed arrays and append new IDs.

    A small roll-forward journal contains only changed partitions, never note
    content. Notes are published before cards and the manifest is written last.
    """
    from .layout import read, write
    recover(data)
    current = read(data / 'manifest.json') if (data / 'manifest.json').exists() else None
    if current != previous:
        raise ValueError('Catalog changed; retry')
    replacement = {**replacement, 'catalog_layout':'flat'}
    replacement.pop('partitions', None)
    changes = {}
    for kind, incoming in (('notes', notes), ('cards', cards)):
        if incoming is None:
            continue
        paths = (note_paths(previous) if kind == 'notes' and 'note_partition_count' in (previous or {})
                 else partition_paths(previous) if kind == 'cards' and previous else [])
        old_parts = [read(data / path) for path in paths]
        by_id = {record['id']: record for record in incoming}
        if len(by_id) != len(incoming):
            raise ValueError(f'Duplicate {kind} identity')
        parts = []
        for part in old_parts:
            updated = []
            for old in part:
                record = dict(by_id.pop(old['id'], old))
                if 'added_at' in old:
                    record['added_at'] = old['added_at']
                updated.append(record)
            parts.append(updated)
        for record in by_id.values():
            record = dict(record)
            if added_at is not None:
                record.setdefault('added_at', added_at)
            if not parts or len(parts[-1]) == 250:
                parts.append([])
            parts[-1].append(record)
        for i, part in enumerate(parts):
            path = f'{kind}/{kind}-{i:05d}.json'
            if not (data / path).exists() or read(data / path) != part:
                changes[path] = part
        replacement['note_partition_count' if kind == 'notes' else 'partition_count'] = len(parts)
    write(data / 'catalog.pending.json', dict(previous=previous, manifest=replacement, files=changes))
    recover(data)
    # Flat partitions are now authoritative; remove superseded generated arrays.
    clean_partitions(data, None)
    return replacement
