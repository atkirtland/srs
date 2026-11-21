# Architecture

The reviewer runs in Obsidian through Dataview. It reads note content from the
vault and stores identities, scheduling metadata, and review events under `data/`.
Python handles desktop import, verification, and training; reviewing and card
maintenance run in the browser on desktop and Android.

See [README.md](README.md) for usage and [DATA_FORMAT.md](DATA_FORMAT.md)
for record fields and event formats.

## Code layout

| Location | Responsibility |
| --- | --- |
| `view.js`, `view.css` | Built reviewer loaded by Dataview. |
| `tools/browser/` | Rendering, scheduling, indexing, analytics, and card maintenance. |
| `tools/srs_tools/` | Configuration, vault parsing, training, and deck audits. |
| `migration/lib/` | Anki snapshot import, review bridge, native verification, and legacy conversion. |
| `schemas/` | Configuration and store schemas. |

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

For a fresh Anki import, `migration/migrate.py init-study` creates the same layout
from the imported metadata and compatibility source registry. It refuses to
replace existing source rules.

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
| Card scheduling state | Card partition → `baseline`; latest answer or `anki_state` event → `state` | Due date, stability, difficulty and other scheduling state. |
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
Values in a list are alternatives, except `tags` and `tag_prefixes`, which require all listed tags.
`tags` matches exactly; `tag_prefixes` matches a tag and its descendants (e.g. `oa/math` includes `oa/math/categories`). Prefix matching treats Anki `::` and Obsidian `/` as equivalent separators.
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

## Card discovery

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

Choose **Tools → Prune missing sources** to preview accidental additions whose
source identities no longer exist. Inspect removable and protected records, then
use **Remove these cards and notes** to apply the preview. Imported cards, reviewed cards, and cards with settings
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

## Profile training

Training runs through `tools/srs.py train` using the standalone Rust FSRS optimizer.
It updates current profile settings only when `--apply` is supplied. Saved due
dates, memory states, imported baselines, identities, and review logs remain intact.
Existing 19-weight presets stay unchanged until training is applied; the optimizer
produces 21 FSRS-6 weights with recorded provenance.

Training deduplicates observations, follows the winning answer ancestry, and uses
the saved study timezone and rollover. Same-day reviews remain history inputs but
are excluded as prediction targets. Histories without an initial learning/new
review are excluded. Evaluation reports in-sample log loss and RMSE; it does not
estimate held-out performance.

## Storage and synchronization

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
Historical observations deduplicate by collection identity and original revlog ID and retain
the original review information without invented resulting states. Card records
hold initial scheduling baselines; legacy baseline events remain
readable. Later `anki_state` events can update saved state. Local answer events
select resulting state and contribute local activity; imported observations never
double-count activity already in the saved deck counters.

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

## Scheduling and Anki compatibility

The importer preserves saved Anki state and reconstructs missing memory through
the matching native backend. The reviewer uses deterministic intervals with rating
ordering and bounds; native Anki fuzz and load balancing can produce different
future intervals. Verification checks deck counts, memory/learning steps, and
deterministic scheduling separately from final native interval differences.
Filtered-deck cards are counted but cannot be answered here until returned to their
original decks in Anki.

`import-reviews` appends historical observations and `anki_state` events from a
snapshot of the same collection. It preserves the existing catalog and skips cards
with local SRS answers. Imported state can become the parent of a later local
answer. It does not reconcile independent review branches, update daily
allowances/profiles, or send changes to Anki. See the [bridge usage](migration/README.md#temporary-anki-review-bridge).

## Browser runtime and caches

The reviewer loads catalog partitions four at a time, then builds deck memberships
and ordered scheduling queues in memory. Ordinary deck switches and answers reuse
those structures. Configuration, catalog, settings, study-day, or relevant log
changes can rebuild them. Learning queues advance as cards become available.

IndexedDB stores disposable catalog and review indexes. Review indexing checkpoints
every 500 events, verifies appended log prefixes, and resumes interrupted scans.
Replaced or deleted logs trigger reconstruction. Closing and reopening an unchanged
view in the same Obsidian session can reuse its prepared runtime; restarting
Obsidian discards that runtime.

Questions and answers render when opened. Content checks run in cancellable
batches, with results retained until the view closes or dependencies change.
Unchecked cards still count toward scheduling totals. Analytics scans the review
index on demand and caches results until reviews, period, or study day change.
Scheduled review attempts determine recall; learning attempts contribute time and
failures. Manual/rescheduling records and state snapshots are excluded.

Maintenance caches file hashes and generated identities/bindings in IndexedDB,
without source text. Unchanged runs reuse scan results; changed files are hashed
before reparsing. Rebuild local index clears these caches. Cancellation before
publication leaves the catalog unchanged, though source IDs already inserted
remain. Once publication starts, the recovery journal finishes it on reopening.
Run maintenance on one syncing device at a time.

A single-file sync regenerates that file's cards and retires variants it no longer
generates, preserving schedules and history. Restoring the source/template and
syncing restores retired cards. Missing identities trigger a lookup across
configured sources; moves between sources require a full refresh. Source-rule
changes prompt a batch template mapping. Mapped cards retain their IDs and history;
unmapped templates can be retired, and new templates create new cards.

Templates support fields, nested conditional/inverted sections, `FrontSide`,
`cloze:` and `text:` filters, and vault media. Unsupported fields/filters disable
rating with a visible error. JavaScript is disabled unless `config/cards.json`
sets `allow_javascript: true`. Inline scripts then run with reviewer privileges,
scoped DOM lookups, and no sandbox; external and module scripts are unsupported.
Content checks do not execute scripts.

Use **Tools → Performance details** to inspect reads, rendering, cache reuse, and
queue/index work. The desktop benchmark in `tools/tests/benchmark-reviewer.cjs`
measures a synthetic 30,000-card scheduling workload, not vault I/O.

## Validation

Python tests cover native Anki fixtures, identity preservation, timing, imports,
and recovery. Browser tests use mocked Obsidian and IndexedDB for rendering,
maintenance, scheduling, analytics, and incremental indexing. These do not replace
checks on a real collection, Android device, or synced store. Commands are in
[tools/README.md](tools/README.md) and [migration/README.md](migration/README.md).

