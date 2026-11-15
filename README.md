# Portable Obsidian SRS

The standalone `view.js` reviewer reads card content exclusively from your vault.
It needs Obsidian and Dataview on desktop or Android. Python tooling runs on desktop under `tools/` (ongoing usage) and
`migration/` (Anki import/verification). Python and Node are never used while
reviewing.

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

Editable configuration lives in `config/`. Scheduling profiles and generated
bindings live in `data/`. Vault note content is read on demand; an SRS note is a
stable identity plus a runtime set of fields, without a second content archive.

| Layer | Defined in |
| --- | --- |
| Source → SRS notes | `config/sources.json` |
| Notes → cards | `config/cards.json` |
| Cards → study decks | `config/decks.json` |
| Scheduling profiles and assignment | `data/profiles.json`, `config/profile-rules.json` |
| Generated identities and source bindings | `data/notes/`, `data/cards/` |
| Answers and card-specific settings | `data/reviews/` |

These configuration layers are separate, and study deck membership uses filters.
Stored card records also retain scheduling baselines and imported Anki metadata,
including original deck IDs; those IDs do not define study deck membership.
The manifest retains imported scheduling settings and daily counters. The store
therefore includes scheduling and compatibility metadata alongside identities.

For an existing installation using `study.json` and `config.json`, run once from
`tools/`:

```sh
uv run python srs.py upgrade-layout
```

This converts the configuration and catalog in place, preserves card IDs,
baselines, profile settings, and review logs, then removes the superseded files.
It does not require Anki or Node. Reopen the reviewer or click **Refresh**.
For a fresh Anki import, `migration/migrate.py init-study` creates the same layout
from the imported metadata and compatibility source registry. It refuses to
replace existing source rules.

### Changing a note type

Move the source row or Markdown note into its new source rule and edit its fields,
keeping its existing note ID. Run `uv run python srs.py refresh-cards` from
`tools/` in an interactive terminal. Refresh prompts once for each old source rule
→ new source rule pair, showing the affected note and card counts. Map each old
template to a destination template, or choose **Retire**, then confirm the batch.
Mappings apply to this refresh only.

Mapped cards keep their card IDs, scheduling state, profile assignments, settings,
review history, and creation timestamps. New destination templates create new
cards. Retired cards retain their history and leave the study queue. Note IDs
in `data/notes/` also remain stable. Study deck membership follows the new source
bindings and filters. Ambiguous mappings and cancellation stop catalog publication;
source discovery can still seed IDs for unrelated new notes before prompting.

### Configuration and storage locations

All paths below are relative to this reviewer directory.

| Layer | Location | What it defines or stores |
| --- | --- | --- |
| Anki → vault conversion | Your external converter; compatibility adapter: `migration/config/exports.json` | Legacy import only. Ongoing tools and reviewer do not load this registry. |
| Vault source identity | Frontmatter / CSV: `anki_note_id`, `srs_note_id` (legacy `srs_uid` readable); block comments: `ID`, `SRS-ID` | Persistent identity independent of the source file's position. |
| Obsidian → SRS note | `config/sources.json` → `rules[rule-id]` | Source paths, field names, property mappings, transformations and selection filters. Field `name` names the SRS note field; `source` names the vault property. |
| SRS note → cards | `config/cards.json` → `rules[rule-id]`, `groups[rule-id].templates` | Selected templates, initial scheduling profile, front/back presentation and optional `when` filters. |
| SRS note bindings | `data/notes/notes-*.json` | `id`, source `uid`, `rule_id`, and a vault `locator`. One binding per source-rule/note-UID pair, shared by its cards. No export definitions or field recipes. |
| Note → card ID mapping | `data/cards/cards-*.json` → `note_id`, `id`, `template_key`, ordinal | Each card points to its SRS note binding. Several card IDs may share one `note_id`; no separate mapping file is needed. Existing imported IDs are preserved. |
| New card ID generation | [tools/srs_tools/core.py](tools/srs_tools/core.py) → `card_uid()` | UUIDv5 from rule/group, persistent source UID and template key; cloze variants also distinguish ordinal. |
| Card-specific settings | `data/reviews/<device>-YYYY-MM.jsonl` → `kind: "card_settings"` | Suspension, tags and optional profile override. |
| Profile assignment rules | `config/profile-rules.json` → `rules` | First matching filter assigns a profile. Precedence: explicit card override → matching rule → initial card profile → default profile. |
| Current scheduling profiles | `data/profiles.json` → `profiles`, `default_profile` | Active weights, retention, steps, interval/daily limits. Training updates this file only. |
| Card scheduling state | Card partition → `baseline`; latest answer event → `state` | Due date, stability, difficulty and other scheduling state. |
| Historical scheduler settings | `data/scheduler-configs/<hash>.json` | Immutable settings referenced by answers through `scheduler_config_id`. |
| Study decks | `config/decks.json` → `decks` | Named card filters and parents. UI deck edits save here. |
| Catalog pointer and imported scheduling baseline | `data/manifest.json` | Catalog change token, partition counts, study-day timing and frozen imported limits/counters required for Anki parity. |

The pipeline is **Obsidian source → SRS note fields → template/card variants →
card scheduling and reviews**. Notes hold source bindings, templates hold
presentation, decks select cards, and profiles schedule them. Generated card
records contain no source paths, field mappings, preparation functions or
export definitions. Runtime objects join these layers only in memory.

Schemas: [configuration](schemas/config.schema.json),
[data](schemas/data.schema.json). The old combined
[study schema](schemas/study.schema.json) documents the compatibility/runtime
composition; it is no longer the persistent configuration format.

There is no separate handwritten ID-map file. New card IDs are UUIDv5 values
from `(source-rule/group key, persistent source note UID, template key)` in
`tools/srs_tools/core.py:card_uid`; generated cloze variants additionally distinguish
their ordinal. Persisted imported card IDs are preserved, including previously
unmapped cards that later acquire a source/template. File paths and CSV row
positions do not define identity. Existing legacy `deck_id` fields remain in
scheduling metadata to preserve imported daily counters and deck/parent limits.

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
For example, replace an imported deck filter in `config/decks.json` with:

```json
{"paths": ["examples/notes.csv"], "templates": ["recognition"]}
```

This includes existing and future recognition cards from that CSV. A filter such
as `{"groups": ["example-notes"]}` instead selects cards by their SRS note’s
source-rule ID, including unresolved sources. Add `templates` to select particular
cards generated from those notes. Parent decks include the union of their children.

Imported filters initially use legacy deck IDs. They can be replaced with source-rule
and template filters when those describe the intended membership. Splits of the same
source/template need an explicit property or tag; legacy filters can preserve those
splits until that distinction is defined. New cards always appear in **All cards**.
Use **New deck** or a deck’s **Edit** button for path/template/tag filters;
advanced compositions are editable in `config/decks.json`; source rules in `config/sources.json`. **Sources** summarizes the configured paths, templates and initial profiles.
See [schemas/config.schema.json](schemas/config.schema.json).

## Add cards without Anki

Keep adding your normal Obsidian notes, CSV rows, or callouts. From `tools/`, run:

```sh
uv sync --locked
uv run python srs.py refresh-cards
```

The desktop command scans the source rules and publishes metadata partitions of
at most 250 cards. It needs neither Anki, an Anki snapshot, nor Node. Click
**Refresh** in the reviewer afterward; additions load without resetting the
review index or imported baseline. Reviewing remains standalone on Android and
desktop; discovery and training currently run on desktop.

Structural Markdown notes are eligible only when they have an existing
`anki_note_id` or a `srs_note_id` field. To opt a new note in, add a blank field:

```yaml
srs_note_id:
```

Discovery fills that field with a stable UUID. Notes without either marker are
skipped and left untouched, even when their directory matches a source rule.
Existing Anki IDs take precedence and receive no extra ID.

All CSV rows and explicit `[!srs]` / `[!anki]` blocks are eligible. CSV rows
without an identity receive `srs_note_id`; blocks without an ID receive
`<!-- SRS-ID: <uuid> -->`. Legacy `srs_uid` identities remain readable, but that
field alone does not enroll a structural note. Identities survive content changes,
CSV reordering and file moves. After moving sources, update the source rule paths
and run discovery again. Discovery preserves existing catalog entries and reviews;
changing eligibility does not automatically delete previously generated cards.

To inspect accidental additions whose source identities no longer exist:

```sh
uv run python srs.py prune-missing-sources
uv run python srs.py prune-missing-sources --apply
```

The first command previews; the second removes the listed local cards and any
notes left unreferenced. Imported cards, reviewed cards, and cards with settings
log entries are preserved. Review logs remain unchanged. All configured source
locations must be available; cleanup refuses an incomplete mount. Source identity
is checked across the configured locations, so a moved note with the same ID is
preserved. Content errors alone do not make a card removable. A source ID that
still exists keeps the card; cleanup does not infer unwanted enrollment from age.

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
From `tools/`, select a profile ID from `data/profiles.json` or the **Profiles** screen:

```sh
uv run python srs.py train --profile preset-1 --output ../training.json
uv run python srs.py train --profile preset-1 --apply --output ../training.json
```

Without `--apply`, the command reports trained parameters and evaluation only.
With it, the profile is updated for future answers. Current due dates, saved
memory states, card identities, imported baselines and all review logs are
preserved. The first answer using the updated profile automatically writes its
immutable scheduler configuration. Existing 19-weight presets remain unchanged
until explicitly trained/applied; this optimizer produces **21 FSRS-6 weights**,
with explicit standalone optimizer provenance.

Training retains same-day reviews inside histories but uses only positive-gap
reviews as prediction targets; its report counts omitted same-day targets.
Training deduplicates imported/local events, excludes rescheduling observations,
follows each card's winning answer branch, and computes gaps using your saved
study timezone and rollover. Cards whose history lacks an initial learning/new
review are excluded and counted in the report. At least 1,000 long-term training
examples are required by default. In-sample log loss and RMSE are reported before
and after fitting; these are not held-out accuracy estimates. Missing parents,
conflicting event IDs, malformed/incomplete logs and insufficient data produce
diagnostics rather than silently applying parameters.

Sync `config/`, `data/profiles.json` and `data/scheduler-configs/` alongside the card metadata and
monthly review logs. The legacy global scheduler does not override these
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
source/notetype/card-ordinal combinations in `config/cards.json` in one pass. Existing
template keys, edits, card UIDs, and answer logs are preserved. Source mappings
remain in `migration/config/exports.json`.

CSV rows resolve through `anki_note_id`, `srs_note_id`, or legacy `srs_uid`. Markdown frontmatter uses
the same identities; ID-linked `[!anki]` callouts are supported too. Mapped text,
media, vocabulary, taxonomy, and structured source transformations run against
live vault properties. Note bindings retain source locators; configuration retains transformations.
Neither stores note field values. New local CSV identities can be assigned from `tools/` with:

```sh
uv run python srs.py seed-csv-uids /path/to/vault/examples/notes.csv
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
  config/
    sources.json            vault → SRS note rules
    cards.json              SRS note → card rules and templates
    decks.json              study deck filters
    profile-rules.json      scheduling profile assignment filters
  data/
    profiles.json           active scheduling profiles
    manifest.json
    imports/<revision>/
      report.json
    notes/
      notes-00000.json       source bindings shared by cards
    cards/
      cards-00000.json       note/card ID mapping and metadata; at most 250 cards
    reviews/
      anki-2026-11.jsonl
      computer-2026-11.jsonl
      android-2026-11.jsonl
      computer-2026-11-002.jsonl
  tools/                    ongoing CLI, parsers, training, browser build/tests
    srs.py, build.py
    srs_tools/, browser/, tests/
    pyproject.toml, uv.lock
  migration/                optional Anki import, verification, initial setup
    migrate.py, lib/, tests/
    pyproject.toml, uv.lock
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

Discovery scans source identities and updates only changed partitions, appending
new records without moving existing records between files. A recovery journal
protects interrupted writes; the manifest is updated last. It
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

Ongoing tools, browser source fragments, and their tests live under `tools/`.
Each tooling directory has its own uv project and `.venv`. Neither is required on
reviewing devices. From `tools/`:

```sh
uv sync --locked --extra test
uv run --extra test python build.py
uv run --extra test python -m unittest discover -s tests -v
uv run --extra test npm ci
uv run --extra test npm test
```

The optional `test` extra supplies desktop Node. From `migration/`, run native
checks separately:

```sh
uv run --extra anki python -m unittest discover -s tests -v
```

The previous ongoing commands in `migration/migrate.py` remain compatibility
aliases that forward to `tools/srs.py` using the `tools/` environment. Use
`tools/srs.py upgrade-layout` once for the legacy combined configuration layout. See [tools/README.md](tools/README.md) and
[migration/README.md](migration/README.md) for the ownership of each command.

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
