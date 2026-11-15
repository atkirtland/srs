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

## Source rules, study decks, and profiles

Run these commands from `migration/` after restoring your `data/` directory:

```sh
uv sync --locked
uv run python migrate.py init-study
```

`init-study` writes `../study.json` once; it refuses to overwrite an existing
file. It uses your imported hierarchy, template mappings and trained parameters,
without modifying card UIDs, baselines, review logs or the manifest. Reopen the
reviewer or click **Refresh** to enable it. An **All cards** study deck also
includes future additions. Without `study.json`, the previous reviewer behavior
remains available.

The editable configuration separates:

- **Source rules:** vault paths, field transformations and template keys that
  generate cards. Their keys correspond to template groups in `config.json`.
- **Study decks:** named filters over cards, with optional parent decks. A card
  may appear in several decks and still has one schedule and history. Opening
  a parent selects the union of its own filter and its descendants.
- **Scheduling profiles:** interval settings and trained FSRS parameters.
  **Profiles** edits retention, steps and daily settings. **Card settings** can
  explicitly assign an individual card to a profile.

Profile assignment uses a card-specific override, then the first matching
`profile_rules` entry, then its source-assigned `profile_id`, then
`default_profile`. Imported deck retention overrides remain effective while a
card uses that deck's original preset profile. Imported daily counters, deck
limits and parent limits are preserved. Updating an imported profile's daily
settings changes its preset defaults; explicit deck overrides still win.
New cards have a profile-specific scheduling ledger and share its daily budget.
A per-card profile override changes interval settings, not its existing ledger.
Study filters never create additional daily allowances.

Filters support `paths` (exact paths or directory prefixes), `groups`,
`templates`, source/card `tags`, `properties`, `card_ids`, and legacy `deck_ids`.
Values in a list are alternatives, except `tags`, which requires all listed tags.
Different fields are combined with AND. Compose filters with `all`, `any`, and
`not`. Properties use exact values or `{"exists": true}` / `{"exists": false}`.
For example, replace an imported deck filter in `study.json` with:

```json
{"paths": ["examples/notes.csv"], "templates": ["recognition"]}
```

This includes existing and future recognition cards from that CSV. The initial
imported filters use legacy deck IDs; new cards are always available in **All
cards**, and appear in those decks after you replace their filters with source
rules such as the example above. Use **New deck** or a deck’s **Edit** button for path/template/tag filters;
advanced compositions and source rules are editable in `study.json`. **Sources** summarizes the configured paths, templates and initial profiles.
See [schemas/study.schema.json](schemas/study.schema.json).

## Add cards without Anki

Keep adding your normal Obsidian notes, CSV rows, or callouts, then run:

```sh
uv run python migrate.py refresh-cards
```

The desktop command scans the source rules and publishes metadata partitions of
at most 250 cards. It needs neither Anki, an Anki snapshot, nor Node. Click
**Refresh** in the reviewer afterward; additions load without resetting the
review index or imported baseline. Reviewing remains standalone on Android and
desktop; discovery and training currently run on desktop.

Existing `anki_note_id` identities are preserved. New CSV rows receive an
`srs_uid` column value, and new Markdown source notes receive `srs_uid` in
frontmatter. Local `[!srs]` and existing `[!anki]` callouts receive a persistent
`<!-- SRS-ID: <uuid> -->` after the quoted block if they lack an ID. Stable
identities survive content changes, CSV reordering and file moves; after moving
sources, update the source rule paths and run discovery again.

Each enabled template listed in a source rule generates a card. Optional
`when` filters on templates select variants using source properties, e.g.
`"when": {"properties": {"production": true}}`. Cloze templates generate the
ordinals present in the mapped cloze field. Missing content stays visible as a
card error, with rating disabled. Missing source paths are reported while other sources continue to scan.
Discovery does not delete existing cards when a source or rule disappears; suspend them explicitly when desired. Removing a
source rule does not change an existing card's identity or history. Template
keys and source-rule keys are identity-bearing names; keep them stable when
editing presentation.

## Train FSRS without Anki

Training uses the standalone
[fsrs-rs-python bindings](https://github.com/open-spaced-repetition/fsrs-rs-python)
to the Rust FSRS optimizer. Neither Anki nor PyTorch is a training dependency.
Select a profile ID from `study.json` or the **Profiles** screen:

```sh
uv run python migrate.py train --profile preset-1 --output ../training.json
uv run python migrate.py train --profile preset-1 --apply --output ../training.json
```

Without `--apply`, the command reports trained parameters and evaluation only.
With it, the profile is updated for future answers. Current due dates, saved
memory states, card identities, imported baselines and all review logs are
preserved. The first answer using the updated profile automatically writes its
immutable scheduler configuration. Existing 19-weight presets remain unchanged
until explicitly trained/applied; this optimizer produces **21 FSRS-6 weights**,
with explicit standalone optimizer provenance.

Training deduplicates imported/local events, excludes rescheduling observations,
follows each card's winning answer branch, and computes gaps using your saved
study timezone and rollover. Cards whose history lacks an initial learning/new
review are excluded and counted in the report. At least 1,000 long-term training
examples are required by default. In-sample log loss and RMSE are reported before
and after fitting; these are not held-out accuracy estimates. Missing parents,
conflicting event IDs, malformed/incomplete logs and insufficient data produce
diagnostics rather than silently applying parameters.

Sync `study.json` and `data/scheduler-configs/` alongside the card metadata and
monthly review logs. The legacy `config.json` scheduler does not override these
profiles. Historical archive files are immutable records, not settings editors.

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
the optional Anki **26.9.4** backend for import/verification:

```sh
uv sync --locked --extra anki
```

If your source Anki has a different version, update the managed dependency with
`uv add` using that exact version (substitute the actual version):

```sh
uv add --optional anki 'anki==26.9.4'
```

This updates `pyproject.toml`, `uv.lock`, and the environment together. Run all
desktop Python commands through `uv run` as before.

For a directory named `srs` directly inside your vault:

```sh
uv run --extra anki python migrate.py migrate \
  --collection /absolute/path/to/snapshot.anki2 \
  --anki-version 26.9.4 \
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
uv run --extra anki python migrate.py verify \
  --collection /absolute/path/to/snapshot.anki2 \
  --data ../data --anki-version 26.9.4 \
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
the selected native field and source policy; unused native fields are pruned.

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

The automated fixture suite verifies backend 26.9.4. Another source version must
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
  study.json                source rules, filter decks, scheduling profiles
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
uv run --extra anki python -m unittest discover -s tests -v
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
