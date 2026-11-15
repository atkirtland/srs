# Ongoing SRS tools

Run from this directory:

```sh
uv sync --locked
uv run python srs.py refresh-cards
uv run python srs.py train --profile preset-1 --apply
```

Defaults point to `../config/`, `../data/`, and the containing vault.
Profiles live in `../data/profiles.json`. `--config` selects another configuration
directory; `--data` selects its store. Legacy `--study <study.json>` remains
available for compatibility. `refresh-cards` automatically assigns missing IDs to CSV rows, eligible structural
notes, and blocks while retaining existing identities. No separate seeding step is needed.

`refresh-cards` and `prune-missing-sources` cache per-file discovery results in
`tools/.cache/source-scans.sqlite3` (relative to the selected data directory's
parent). The cache contains IDs and generated bindings, never source text or field
values. Both commands still enumerate configured paths to detect additions,
moves, and deletions. Unchanged filesystem signatures skip reading and parsing;
changed signatures trigger a content hash, and only changed content is reparsed.
Refresh also invalidates affected results when source rules/templates change;
parser changes invalidate all results. Files receiving newly seeded IDs are
verified again on the next run. Each command reports `scan` counts for parsed,
reused, and hashed files. The first run builds its cache; later runs reuse it.
Delete this disposable cache to force a full scan. No command syntax changes.
An unchanged run checks input file signatures and returns its previous no-change
result without loading catalogs or reconstructing card bindings. Catalog partitions,
configuration, source paths/stat signatures, parser code, and (for prune) review-log
paths/stat signatures invalidate that checkpoint. Directory enumeration still runs
to detect new/deleted files. Changed runs reconcile the catalog as before.
Prune loads each catalog partition once and reads review logs only if there are
missing-source candidates without baseline reviews. Per-log caches retain only
referenced card IDs; changed/deleted logs are detected on subsequent runs. Missing
configured source roots still prevent pruning, including on the fast path.

Omit `--apply` to train and evaluate without updating a profile.

| Command | Purpose |
| --- | --- |
| `srs.py audit-decks` | Flag cards matching a parent but none of its descendants; report IDs without changing decks. Exit 0: clear; 1: gaps; 2: failure. |
| `srs.py prune-missing-sources` | Preview removal of unreviewed generated cards with missing sources; `--apply` removes eligible cards. |
| `srs.py refresh-cards` | Discover source/template card variants while preserving identities, schedules, and logs. |
| `srs.py train --profile <id>` | Train and evaluate standalone FSRS from unified reviews; `--apply` updates future answers. |
| `build.py` | Rebuild the standalone reviewer from browser sources. |

The `srs_tools/` package contains the ongoing CLI, source discovery, training,
vault parsers/transformations, identity helpers, and metadata-store helpers.
It does not import migration modules or load the old Anki export registry.
Its environment has no Anki, BeautifulSoup, markdownify, or PyTorch dependency.
`browser/` contains browser source fragments and the shared desktop verification
runner. `tests/` holds ongoing Python and browser tests.

One-time Anki import, native verification, and `init-study` belong in
[`../migration/`](../migration/README.md). Old ongoing commands invoked through
`migrate.py` forward to this CLI using this project's uv environment.

For development checks from this directory:

```sh
uv sync --locked --extra test
uv run --extra test python build.py
uv run --extra test python -m unittest discover -s tests -v
uv run --extra test npm ci
uv run --extra test npm test
```

The optional `test` extra supplies Node for the browser checks. Browser test
packages live in `node_modules/`. Neither Node nor Python is required while
reviewing on desktop or Android.

Reviewer startup keeps a disposable catalog cache in the device's IndexedDB.
Unchanged card/note partitions are reused across view reopenings; partition paths,
modification times, and sizes determine invalidation. The cache contains catalog
metadata, not source text. Storage failure falls back to reading vault files.
**Rebuild local index** clears this cache together with the review index.
Source tags/properties are loaded only where they can affect deck/profile filters;
structural frontmatter uses Obsidian's metadata cache when available. Deck
membership narrows candidates by source group; remaining text reads run with
bounded concurrency.

Within one Obsidian app session, closing and reopening an unchanged reviewer
transfers its prepared runtime (including memberships and scheduling queues).
Vault/metadata events invalidate this cache. Learning availability advances
incrementally; study-day rollover rebuilds the scheduling index. Session buries
are cleared on reopening. This runtime cache stays in memory and does not survive
restarting Obsidian. Performance details report `sessionRestores: 1` on reuse,
with `schedulingBuilds: 0` and `cardPreparations: 0`.
