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
    if layout not in (None, 'split'):
        raise ValueError(f'Unsupported catalog layout: {layout}')
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
