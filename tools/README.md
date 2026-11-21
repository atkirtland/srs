# Ongoing SRS tools

Run from this directory:

```sh
uv sync --locked
uv run python srs.py train --profile preset-1 --apply
```

Defaults point to `../config/`, `../data/`, and the containing vault. Set the
vault in ignored `../config/local.json` (copy `local.example.json`), with
`SRS_VAULT`, or with `--vault`. Only synthetic `*.example.json` configurations
are tracked.
Profiles live in `../data/profiles.json`. `--config` selects another configuration
directory; `--data` selects its store. Legacy `--study <study.json>` remains
available for compatibility.

Refresh and prune are UI-only: **Tools → Refresh cards** and **Tools → Prune missing
sources** in the reviewer, on desktop or Android. The prune preview requires an
explicit removal action. No Python or Node is required for these operations.
The browser maintenance engine uses device-local IndexedDB for disposable scan
results containing identities and bindings, never source content. Unchanged runs
skip catalog/source reads; changed files are hashed before reparsing. Rebuild local
index clears this cache. See the root README for cancellation and recovery behavior.
Run maintenance on only one syncing device at a time.

Omit `--apply` to train and evaluate without updating a profile.

| Command | Purpose |
| --- | --- |
| `srs.py audit-decks` | Flag cards matching a parent but none of its descendants; report IDs without changing decks. Exit 0: clear; 1: gaps; 2: failure. |
| `srs.py train --profile <id>` | Train and evaluate standalone FSRS from unified reviews; `--apply` updates future answers. |
| `build.py` | Rebuild the standalone reviewer from browser sources. |

The `srs_tools/` package contains the ongoing CLI, training,
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

Review indexing saves an intra-file checkpoint after each committed 500-event
batch. Interrupted views resume from that checkpoint after verifying the saved
prefix in hashed chunks; changed prefixes/deleted logs still trigger a rebuild.
Completed-file checkpoints remain compatible. Imported-history database requests
are batched, and indexing yields between batches so mobile views can respond to
lifecycle events. The displayed indexing counter counts records processed in the
current pass, so it restarts on reopening even when earlier work is reused.

`browser/browser-maintenance.js` owns ongoing discovery and pruning. The Python
implementation is frozen under `tests/maintenance_reference/` solely as a parity
oracle; runtime commands do not import it. Bump the maintenance cache namespace
when changing generation or identity behavior.

Refresh and prune share per-file content hashes and source identities. The first
operation also computes metadata-only generation results for reuse by refresh;
no source text, bodies, or field values are cached. Running the other operation
against unchanged files therefore needs no source reads or parsing, including
after reopening the reviewer. Generation-rule edits invalidate generation results
but preserve reusable source identities. Prune never inserts IDs: if it encounters
unidentified notes, refresh must revisit those files to seed them. Final no-change
checkpoints remain operation-specific because prune also depends on review logs.
The shared-cache format uses a new namespace, so the first run after this update
rebuilds the disposable cache once.
