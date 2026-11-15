"""Disposable, local per-file scan results; never stores source text or fields."""
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class SourceCache:
    def __init__(self, vault, data, operation):
        self.vault = Path(vault).resolve()
        self.data = Path(data).resolve()
        self.root = self.data if operation == "prune-reviews" else self.vault
        directory = Path(data).resolve().parent / 'tools' / '.cache'
        directory.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(directory / 'source-scans.sqlite3')
        self.db.execute('CREATE TABLE IF NOT EXISTS scans (namespace TEXT, key TEXT, stamp TEXT, hash TEXT, result TEXT, PRIMARY KEY(namespace,key))')
        self.namespace = digest([str(self.vault), str(Path(data).resolve()), operation])
        # Parser/identity changes invalidate derived results too.
        self.code = digest([p.read_text() for p in sorted(Path(__file__).parent.glob('*.py'))])
        self.stats = dict(parsed_files=0, reused_files=0, hashed_files=0)
        self.touched = set()

    @staticmethod
    def stamp(path):
        st = path.stat()
        return json.dumps([st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns])

    def file_hash(self, path):
        self.stats['hashed_files'] += 1
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def read(self, path, context, load):
        path = Path(path).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError('Scan path escapes configured root')
        key = digest([str(path), context, self.code])
        self.touched.add(key)
        row = self.db.execute('SELECT stamp,hash,result FROM scans WHERE namespace=? AND key=?', (self.namespace, key)).fetchone()
        stamp = self.stamp(path)
        content_hash = None
        if row:
            if row[0] == stamp:
                self.stats['reused_files'] += 1
                return json.loads(row[2])
            content_hash = self.file_hash(path)
            if content_hash == row[1]:
                self.db.execute('UPDATE scans SET stamp=? WHERE namespace=? AND key=?', (stamp, self.namespace, key))
                self.stats['reused_files'] += 1
                return json.loads(row[2])
        before = stamp
        result = load()
        self.stats['parsed_files'] += 1
        # Discovery may seed IDs. Cache only if the parser did not write the file;
        # otherwise reparse once next time to verify the resulting source.
        after = self.stamp(path)
        if before == after:
            content_hash = content_hash or self.file_hash(path)
            if self.stamp(path) != after:
                raise ValueError(f'Source changed during scan; retry: {path}')
            self.db.execute('INSERT OR REPLACE INTO scans VALUES (?,?,?,?,?)',
                            (self.namespace, key, after, content_hash, json.dumps(result)))
        else:
            self.db.execute('DELETE FROM scans WHERE namespace=? AND key=?', (self.namespace, key))
        return result

    def checkpoint(self, signature):
        key = '@unchanged'
        self.touched.add(key)
        row = self.db.execute('SELECT hash,result FROM scans WHERE namespace=? AND key=?', (self.namespace, key)).fetchone()
        return json.loads(row[1]) if row and row[0] == signature else None

    def save_checkpoint(self, signature, result):
        self.touched.add('@unchanged')
        self.db.execute('INSERT OR REPLACE INTO scans VALUES (?,?,?,?,?)',
                        (self.namespace, '@unchanged', '', signature, json.dumps(result)))

    def keep_existing(self):
        # A checkpoint hit bypasses per-file reads; retain their cached results.
        self.touched.update(row[0] for row in self.db.execute('SELECT key FROM scans WHERE namespace=?', (self.namespace,)))

    def finish(self):
        for (key,) in self.db.execute('SELECT key FROM scans WHERE namespace=?', (self.namespace,)).fetchall():
            if key not in self.touched:
                self.db.execute('DELETE FROM scans WHERE namespace=? AND key=?', (self.namespace, key))


@contextmanager
def source_cache(vault, data, operation):
    cache = SourceCache(vault, data, operation)
    try:
        with cache.db:
            yield cache
            cache.finish()
    finally:
        cache.db.close()


def source_files(vault, rule, *, strict=False, issues=None, group=None, filenames=False):
    """Enumerate every run: deletions and new paths must never be hidden by a cache."""
    vault = Path(vault).resolve()
    for relative in rule['sources']:
        path = (vault / relative).resolve()
        if not path.is_relative_to(vault):
            raise ValueError('Source path escapes vault')
        if not path.exists():
            if strict:
                raise ValueError(f'Source unavailable; refusing cleanup: {path}')
            if issues is not None:
                issues.append({'rule': group, 'path': relative, 'error': 'Missing source; existing cards preserved'})
            continue
        if path.is_file():
            yield path
        elif filenames and rule.get('kind') != 'block':
            from .vault import unique_notes
            yield from unique_notes(path, frozenset(rule['filenames']) if rule.get('filenames') else None, rule.get('recursive', False))
        else:
            yield from sorted(path.glob('**/*.md' if rule.get('recursive') else '*.md'))


def unchanged_snapshot(cache, config, templates, manifest, *, strict=False, reviews=False):
    """Fingerprint authoritative inputs without decoding catalogs or source results."""
    from . import store
    issues, files = [], []
    for group, rule in config['source_rules'].items():
        for path in source_files(cache.vault, rule, strict=strict, issues=issues, group=group, filenames=not reviews):
            files.append([group, str(path), cache.stamp(path)])
    paths = [*store.partition_paths(manifest)]
    if 'note_partition_count' in manifest:
        paths.extend(store.note_paths(manifest))
    data = cache.data
    catalog = [[p, cache.stamp(data / p)] for p in paths]
    logs = [[str(p), cache.stamp(p)] for p in sorted((data/'reviews').glob('*.jsonl'))] if reviews else []
    signature = digest([cache.code, config, templates, manifest, catalog, files, issues, logs])
    return signature, len(files)
