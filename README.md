# Portable Obsidian SRS

Copy the repository's **`ankobs-srs/` directory into your Obsidian vault**.
It includes the bundled reviewer, editable configuration, and desktop migration
tools isolated under `migration/` with their Python support modules. Reviewing needs Obsidian and Dataview;
it does not need Node, Python, this repository, or a running server.

The example source demonstrates initial enrollment. Other linked Anki cards
and histories are preserved for later template conversion.

## Install and prepare

Copy `ankobs-srs/` into the vault, then open a desktop terminal in its migration directory:

```sh
cd /path/to/vault/ankobs-srs/migration
uv sync --locked
```

`uv` creates the Python environment at `migration/.venv/`; it does not install
Python dependencies in the reviewer directory. Only desktop migration commands
need this environment. You can omit the entire `migration/` directory from mobile
devices or remove it after migration. uv may also use its usual shared download
cache outside the project.

Alternatively, from the repository use:

```sh
uv run python bin/srs.py install-view --vault /path/to/vault
```

That copies the complete directory and preserves existing vault configuration
and review data. Running the copied `migration/migrate.py` automatically finds the vault
above `ankobs-srs/`. Keep the directory name `ankobs-srs`; if renamed, supply `root` to the view
and `--vault`/`--output` to migration explicitly.

Sync Anki on all devices. Before taking the snapshot, obtain its scheduling
day-zero date in Anki's debug console, using the system study timezone:

```python
from datetime import datetime, timedelta
print(datetime.fromtimestamp(mw.col.sched.day_cutoff).date() - timedelta(days=mw.col.sched.today + 1))
```

Record this date, the study timezone, and the next-day rollover hour. Close
Anki and copy `collection.anki2` into a separate snapshot. The importer reads
standalone SQLite snapshots, not open/WAL databases or `.apkg`/`.colpkg` files.
Retain the snapshot for later configuration updates.

## Inspect, configure, and migrate

From `ankobs-srs/migration/`:

```sh
uv run python migrate.py inspect \
  --collection /path/to/snapshot.anki2 --output anki-inventory.json
```

Inspect the vocabulary model's existing `tmpls` (zero-based `ord`, `qfmt`, and
`afmt`). The inventory supports legacy JSON and modern protobuf metadata.
Binary source metadata remains base64 encoded in the lossless archive.

Edit **`../config.json`** (the reviewer configuration at `ankobs-srs/config.json`). Its supplied `recognition`
template is disabled until you verify that `vocab` ordinal `0` represents
word → definition. Set `enabled` to `true` after checking the binding and
presentation. Add explicit templates for other existing card ordinals.

| Template property | Meaning |
| --- | --- |
| `key` | Permanent identity within the source group. |
| `enabled` | Whether matching supported cards can be offered. |
| `anki_notetype`, `anki_ordinal` | Exact Anki binding during migration. |
| `required_fields` | Mapped fields that must be nonblank. |
| `front`, `back` | Markdown with fields such as `{{word}}`. |

`{{#field}}...{{/field}}` sections render when present; `{{^field}}...{{/field}}`
when absent. Sections may nest. Template JavaScript, Anki filters, cloze
generation, and automatic HTML/CSS emulation are unsupported.

The existing source mappings and transformations live in `migration/config/exports.json`.
The current reviewer supports CSV sources with `text` transforms. The packaged
Python modules reuse the project's existing parsing, transforms, configuration
validation, and ID auditing. They are copied from the same source modules at
build time.

Migrate using your actual day-zero date (not today's date) and timezone; these
values are examples:

```sh
uv run python migrate.py migrate \
  --collection /path/to/snapshot.anki2 \
  --day-zero YYYY-MM-DD
```

Output goes to `../data/` (`ankobs-srs/data/`), outside the migration directory. The report prints linked-note/card/
review counts, unmapped data, and problems. Blocking issues return status 2
and disable activation. Suspended, buried, filtered-deck, and history-less
learned cards remain archived inactive. Unlinked Anki notes are reported.

Due dates are preserved. FSRS-6 memory is reconstructed from eligible historical
answers using bundled default parameters and configured retention. This changes
future scheduling to FSRS-6; it does not reproduce earlier Anki weights or
algorithms. Manual scheduling records are archived but not treated as answers.

## Review and edit

Enable Dataview's JavaScript queries on desktop and Android. Add this to a note:

````markdown
```dataviewjs
await dv.view("ankobs-srs", { group: "example-notes" });
```
````

The view loads `config.json` directly. Changing prompt/answer presentation,
enabling/disabling existing templates, or changing scheduler settings takes
effect on Refresh, without reimporting or rebuilding. Changing permanent keys
or Anki bindings, adding generated cards, or moving source CSVs requires
migration against the original snapshot. Reopen the view after catalog changes.

CSV content is read live by stable note identity. Row reordering and content
edits preserve histories; missing sources/required values make cards inactive.
Obsidian-only CSV rows can receive persistent UUIDs using:

```sh
uv run python migrate.py seed-csv-uids ../../examples/notes.csv
```

Preserve the resulting `srs_uid` column. Existing linked rows retain their Anki
IDs. Assigning an Anki ID to an already reviewed local note needs an identity
migration.

Defaults are 90% desired retention, no fuzz, 36,500 maximum interval days, and
20 new cards per study day. Offline devices can collectively exceed the daily
limit until synced. Interval previews are recalculated when submitting.

## Files and scale

```text
ankobs-srs/
  view.js                 Bundled JavaScript, including FSRS
  view.css
  config.json             Editable templates/scheduler settings
  migration/              Desktop-only tools; optional on mobile
    migrate.py            Migration entry point
    lib/                  Reused Python modules plus migration logic
    config/               Source mappings and lookup data
    pyproject.toml
    uv.lock
    .venv/                Local Python environment, created by uv sync
  data/
    manifest.json
    imports/<revision>/
      manifest.json
      raw.json            Original linked Anki records and metadata
      report.json
      cards-00000.json     Small runtime metadata partitions
      history-00000.json   Separate imported history partitions
    reviews/
      <device-uuid>-2026-11.jsonl
      <device-uuid>-2026-12.jsonl
      <device-uuid>-2026-12-002.jsonl
```

One JSONL line represents one review. Each device appends only to its own UTC
calendar-month log. Logs roll over at **32 MiB** if necessary. Each write is
serialized with other views/windows when Web Locks are available and is verified
before advancing. Without Web Locks the fallback serializes views in the same
window; use one active reviewer window per device in that environment.

At roughly 0.7–0.8 KB per new review, 10,000 monthly reviews occupy about 7–8 MB
across device logs. A million occupy roughly 0.7–0.8 GB, plus imported archives,
backups, and the local index. Records are immutable even though the log is
appendable. Never manually truncate or edit review logs.

The **device-local IndexedDB index** holds current states, seen-event hashes,
daily new-card identities, lazy imported baselines, and file checkpoints. It
is not synced or authoritative. Warm startup checks file metadata and reads
no unchanged review logs. An appended log is read to verify its prefix, but
only appended records are parsed/indexed. Replaced/deleted files trigger a
full rebuild. Individual reads remain bounded by the rotated file size.

Reviewing does not load the million-record imported archive. Catalog partitions
exclude historical events; a selected card's imported history is loaded only
to construct its first baseline, then that baseline is cached locally. Runtime
memory grows with card count and one log/partition, rather than total reviews.

Use **Rebuild local index** to reconstruct caches from the on-disk records.
A cold rebuild over a large history can take time and shows progress. IndexedDB
must be available; the reviewer visibly pauses if storage is unavailable or a
write fails. The tested 10,000-record workload uses mocked IndexedDB, not a
physical-device performance guarantee.

## Conflict behavior and format

Sync `ankobs-srs/` with Syncthing; exclude `migration/.venv/` and Python caches.
The entire `migration/` directory can be excluded when syncing to mobile devices;
the reviewer uses only the files outside it. Device identity lives in local storage.
Different devices create different log files. Syncthing `sync-conflict` copies
are automatically read and merged logically; they are retained on disk rather
than automatically rewritten/deleted, avoiding simultaneous consolidation races.

Event IDs deduplicate records across files. Different contents under the same
ID, malformed JSONL, incomplete final records, or incompatible events pause the
queue visibly. Both offline branches remain in history; greatest
`(review_time_ms, event_id)` selects state. Losing branches are not replayed into
the winner. Keep device clocks reasonably synchronized. A stale prompt is
rechecked before submission.

JSON artifacts use format version 1. Canonical card UUIDs derive from group,
note identity (`anki:<note_id>` or `local:<uuid>`), and permanent template key.
Original Anki card IDs remain provenance. Imported event IDs use collection
creation time and revlog ID. One collection is supported per store.

New records contain event/device/card IDs, import identity, parent state
reference, UTC millisecond answer time, rating 1–4, duration, new-card status,
scheduler version/configuration, and complete resulting FSRS state. State
contains UTC millisecond `due`/`last_review`, stability/difficulty, elapsed and
scheduled days, repetitions, lapses, learning steps, and state enum. Historical
intervals preserve days versus seconds; original records remain archived.

Publishing is desktop-only. Once reviews exist, replacing the imported baseline
or changing an existing card's permanent template identity is blocked. Removed
templates retain inactive card identities for old reviews. Earlier experimental
per-review JSON files can still be indexed under `data/events/`; new writes
always use monthly JSONL logs.

## Development and cutover

In the repository, edit `obsidian/srs/*.js`, `lib/srs.py`, `bin/srs.py`, and
`config/srs.json`. JavaScript sources use ordinary `.js` modules. Build the
copyable directory with:

```sh
npm ci
npm run build:srs
uv run python -m unittest discover -s tests -v
npm test
```

The build bundles the browser code and copies the same Python modules/configs
into `ankobs-srs/migration/`, separate from the reviewer files. Node is needed only to rebuild, not to use the copied folder.

Before cutover, compare report counts/questions/answers/due dates against Anki.
Use a disposable store to test offline answers on desktop and Android, including
the same card on both; sync and verify both branches survive and queues converge.
Reopen offline and check persistence/responsiveness. Real Android/Syncthing and
million-record physical-device testing remain acceptance steps.

Take a final synchronized snapshot before real reviews, then stop reviewing
the pilot group in Anki. Later Anki reviews are not imported into an already
reviewed baseline. Other groups can continue in Anki until their own cutover.

The bundled FSRS library is MIT licensed; see `THIRD_PARTY_LICENSE.txt`.
