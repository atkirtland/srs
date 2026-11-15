# Portable Obsidian SRS

The standalone `view.js` reviewer reads card content exclusively from your vault.
It needs Obsidian and Dataview on desktop or Android. Python and Node are desktop
migration/verification tools; they are never used while reviewing.

Open the default deck homepage:

````markdown
```dataviewjs
await dv.view("srs", { root: "srs" });
```
````

Use your actual folder name for both paths. Existing group calls still work:
`await dv.view("srs", { root: "srs", group: "example-notes" });`.

The homepage has an expandable deck hierarchy with blue new, red learning/
relearning, and green review counts. Content-error totals are separate. Opening
a deck includes its children. Missing sources, required fields, disabled templates,
and unsupported operations stay visible without reducing scheduling counts.
**Bury** hides a card for this session and changes no schedule, history, or daily counter. Refresh
rereads the vault and configuration; reopening clears the session's skips.

The first opening indexes review logs in persistent local IndexedDB. Later openings
process only changed logs. Vault content is resolved once per open view and reused
while reviewing; source or template changes, or Refresh, invalidate that cache.

Open **Cards** to search questions, answers, source paths, card IDs, templates,
and card-specific tags. Filter by deck or suspension status, then select a card
to suspend/restore it or edit its tags. **Card settings** opens the same editor
from the reviewer. Settings apply to that individual card, including when a note
generates several cards. **Use imported defaults** removes its explicit overrides.
Settings are synced in the device's monthly logs and survive reimports; they do
not change the card's saved schedule or count as studying. Suspension excludes
the card from review counts and queues until it is restored.

New answers reference an immutable scheduler configuration under
`data/scheduler-configs/<sha256>.json`. Identical interval settings share a file;
changed settings create a new one. Existing inline review configurations remain
readable. These archive files are retained across reimports and should sync with
the review logs.

## Take a desktop snapshot

Synchronize and close Anki before copying `collection.anki2`. The importer refuses
pending WAL data and never writes to the original collection. In Anki's debug
console, record the day-zero date before closing:

```python
from datetime import datetime, timedelta
print(datetime.fromtimestamp(mw.col.sched.day_cutoff).date() - timedelta(days=mw.col.sched.today + 1))
```

Also record the **exact desktop Anki version**, study timezone, rollover hour,
and the UTC timestamp of the reference counts. The six 19-weight presets do not
identify the source application version. Keep the original snapshot outside the
reviewer store until verification has passed.

## Migrate all decks in one command

Run inside this folder's `migration/` directory. The locked environment includes
Anki **25.9.2**, the backend exercised by the automated tests:

```sh
uv sync --locked
```

If your source Anki has a different version, update the managed dependency with
`uv add` using that exact version (substitute the actual version):

```sh
uv add 'anki==25.9.2'
```

This updates `pyproject.toml`, `uv.lock`, and the environment together. Run all
desktop Python commands through `uv run` as before.

For a directory named `srs` directly inside your vault:

```sh
uv run python migrate.py migrate \
  --collection /absolute/path/to/snapshot.anki2 \
  --anki-version 25.9.2 \
  --day-zero YYYY-MM-DD
```

Replace the version, paths and timing with the recorded values. For another
layout, add `--vault /path/to/vault --output /path/to/srs/data`. The importer
checks that the installed backend version matches `--anki-version`.

This imports every card and deck, including unresolved sources, suspended cards,
and cards without saved memory. It generates editable templates for all mapped
source/notetype/card-ordinal combinations in `config.json` in one pass. Existing
template keys, edits, card UIDs, and answer logs are preserved. Source mappings
remain in `migration/config/exports.json`.

CSV rows resolve through `anki_note_id` or `srs_uid`. Markdown frontmatter uses
the same identities; ID-linked `[!anki]` callouts are supported too. Mapped text,
media, vocabulary, taxonomy, and structured source transformations run against
live vault properties. Card partitions retain source/transformation references,
never field values. New local CSV identities can be assigned with:

```sh
uv run python migrate.py seed-csv-uids /path/to/vault/examples/notes.csv
```

Templates support fields, nested conditional/inverted sections, `FrontSide`,
`cloze:` and `text:` filters, and vault media references. Unknown fields, `type:`
inputs, JavaScript, and unsupported filters produce visible card errors and
prevent rating. Cloze ordinals remain the existing Anki ordinals. Editing the
front/back presentation does not create new identities or rewrite history.

## Verify against native Anki

Verification needs a desktop Node executable as well as the Python environment.
No JavaScript packages are needed for the verification command. It opens a
**disposable copy** of the snapshot and deletes that copy afterward. The retained
report contains counts and scheduling metadata, without note fields or rendered
Anki questions/answers.

```sh
uv run python migrate.py verify \
  --collection /absolute/path/to/snapshot.anki2 \
  --data ../data --anki-version 25.9.2 \
  --output verification.json
```

Replace `--at` with the corresponding Anki reference time; omit it to use command
start time. `--node /path/to/node` selects an executable outside PATH.

Every deck and parent must agree **exactly** in all three counts. Missing snapshot
cards, a different count, missing transition coverage, memory/step differences,
or deterministic interval differences produce status 2 and detailed diagnostics.
Content
errors do not affect the comparison. A successful count comparison is reported
separately from scheduling comparisons.

The harness exercises all four ratings for available new, learning, review, and
relearning representatives in every preset, submits each answer on the disposable
copy, and undoes it before the next branch. Missing states receive synthetic
representatives using that preset on the disposable copy; the report labels
their origin. They never enter the store or reference counts. Saved stability/difficulty, repetitions, lapses,
learning position, queue, and due are preserved; only missing saved memory uses
historical reconstruction. Per-deck trained settings and effective retention
are recorded with each new answer. Legacy parameter fields remain separate from
unknown client settings in `other`; the selected native field is recorded.

Anki's answer-state API uses its wall clock. **`--at` fixes count calculations;
answer transitions use their separately recorded wall-clock timestamp.** The
harness applies reference-day unburying through Anki's API and suppresses its
separate wall-clock unbury pass when obtaining historical reference counts.
Memory comparison uses an explicit float32 tolerance (absolute 0.0001 or relative
0.000002). Deterministic intervals are checked independently from native memory
states. Native fuzz/load-balancing interval differences are retained in the
report; they are not count differences and do not by themselves fail verification.
The reviewer deliberately uses deterministic intervals. Filtered-deck cards are
counted, but answering a card still in a filtered deck is currently disabled;
return those cards to their original decks in Anki before final migration.

The automated fixture suite verifies backend 25.9.2. Another source version must
pass its own native verification before cutover. The original snapshot and vault
sources were not available for final acceptance in this workspace, so its exact
reference counts and real desktop/Android operation remain to be checked on your
devices. Do not interpret fixture results as verification of your collection.

## Files and migration safety

See [DATA_FORMAT.md](DATA_FORMAT.md) for field descriptions, event semantics,
and the [JSON Schema](schemas/data.schema.json) for files in `data/`.

```text
srs/
  view.js, view.css          standalone browser reviewer
  config.json               editable templates
  data/
    manifest.json
    imports/<revision>/
      report.json
      cards-00000.json       at most 250 cards per file
    reviews/
      anki-2026-11.jsonl
      computer-2026-11.jsonl
      android-2026-11.jsonl
      computer-2026-11-002.jsonl
  migration/                optional on reviewing devices
```

All version 2 events use device-specific UTC-month JSONL files, rotating at
**32 MiB**. Writers use the names `anki`, `computer`, and `android`; choose this
device in the reviewer's Device selector. Existing UUID-named logs remain readable.
Historical
observations deduplicate by collection identity and original revlog ID and retain
the original review information without invented resulting states. Separate
baseline events describe imported scheduling. Only new answer events select
current state or contribute new activity; imported observations never double-count
activity already in the saved deck counters.

Publishing writes and validates the replacement store, atomically switches the
manifest, then directly deletes superseded generated import directories. It
writes no `raw.json`, note-field archive, or `history-*.json`. Existing new-review
logs and card UIDs survive the version 1 upgrade. Subsequent baseline changes
are blocked once new answers exist; presentation edits remain dynamic.

The device-local IndexedDB index is disposable and incremental. Unchanged logs
are not reread; appended logs verify their prefix and index only added records.
Replaced/deleted logs rebuild the index. Imported history is indexed separately
and loaded per card only when reconstruction is necessary. Syncthing conflict
copies remain on disk. Duplicate event IDs with different contents, malformed
records, and incomplete final lines visibly pause reviewing.

Both offline answer branches remain immutable. The latest `(review_time_ms,
event_id)` wins with its complete resulting state; losing branches are not replayed
onto it. Rebuild local index regenerates the cache from the synced files. Each
device appends only to its own log; Web Locks serialize writes when available.
Without Web Locks use one active reviewer window per device.

## Development checks

Browser source fragments and all desktop tooling/dependencies live under
`migration/`. Rebuild the standalone browser file without Node:

```sh
uv run python build.py
uv run python -m unittest discover -s tests -v
npm ci
npm test
```

The Python suite uses native Anki disposable collections with six distinct trained
19-weight presets and 96 representative answers, exact deck/parent counts,
overrides and rollover, plus migration identity, monthly boundaries, rollover,
and idempotency tests. Node tests use mocked Obsidian/IndexedDB for rendering,
skipping, template edits, events, conflicts, and incremental indexing. They do
not replace testing on a physical Android device or a large real Syncthing store.

Queue behavior follows Anki's published [deck tree](https://github.com/ankitects/anki/blob/25.09.2/rslib/src/decks/tree.rs),
[limits](https://github.com/ankitects/anki/blob/25.09.2/rslib/src/decks/limits.rs), and
[parameter precedence](https://github.com/ankitects/anki/blob/25.09.2/rslib/src/deckconfig/mod.rs).
The bundled ts-fsrs library is MIT licensed; see `THIRD_PARTY_LICENSE.txt`.
