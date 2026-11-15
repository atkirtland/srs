# SRS data formats

`config/` contains editable source rules, card-generation rules/templates,
study deck filters and profile-assignment filters. `data/` contains active
scheduling profiles, generated SRS note bindings and cards, frozen imported
scheduling metadata, scheduler archives, and reviews. Note content is read from
the vault at review time and is never archived here.

There is no retained Anki note-content archive.

The current store format is **version 2**. Preserved version 1 answer events are
also readable. File names do not determine event kind; inspect `format_version`
and `kind` inside each record.

## Layout and JSON Schema

```text
data/
  manifest.json
  profiles.json
  scheduler-configs/
    <sha256>.json
  imports/<revision>/
    report.json
  notes/
    notes-00000.json
  cards/
    cards-00000.json
    cards-00001.json
    ...
  reviews/
    anki-YYYY-MM.jsonl
    computer-YYYY-MM.jsonl
    android-YYYY-MM.jsonl
    computer-YYYY-MM-002.jsonl
    ...
```

[schemas/data.schema.json](schemas/data.schema.json) is a JSON Schema Draft
2020-12 document describing these files. Its root accepts a manifest, card/note
partition, scheduling profiles, scheduler configuration, import report, or individual event. Validate **each JSONL line
separately**, not a complete JSONL file as one JSON document. Specific types are
available through these schema references:

| File or record | Schema reference |
| --- | --- |
| `data/manifest.json` | `schemas/data.schema.json#/$defs/Manifest` |
| `data/profiles.json` | `schemas/data.schema.json#/$defs/Profiles` |
| `notes-*.json` | `schemas/data.schema.json#/$defs/NotePartition` |
| `cards-*.json` | `schemas/data.schema.json#/$defs/CardPartition` |
| `scheduler-configs/<sha256>.json` | `schemas/data.schema.json#/$defs/SchedulerConfig` |
| Import `report.json` | `schemas/data.schema.json#/$defs/ImportReport` |
| Any review-log line | `schemas/data.schema.json#/$defs/Event` |
| Historical observation | `schemas/data.schema.json#/$defs/HistoricalReview` |
| Imported baseline | `schemas/data.schema.json#/$defs/SchedulingBaseline` |
| New answer | `schemas/data.schema.json#/$defs/Answer` |
| Card settings change | `schemas/data.schema.json#/$defs/CardSettingsEvent` |
| Preserved version 1 answer | `schemas/data.schema.json#/$defs/LegacyAnswer` |

These schemas document structure; they are not automatically invoked by the
reviewer. Its runtime checks also enforce relationships that JSON Schema alone
does not express here: matching event IDs, known cards, import compatibility,
parent references, matching answer/state timestamps, and duplicate-ID contents.
Use a validator with format assertions enabled to check date and UUID formats.
Additional properties are permitted for compatibility with older records.
Preset/deck settings in new manifests use an explicit list of required runtime
fields, rather than retaining the full native Anki protobuf objects.

## Shared conventions

- Timestamps such as `snapshot_ms`, `review_time_ms`, `time_ms`, `due`, `due_ms`, and
  `last_review` are Unix **milliseconds**. Durations are milliseconds unless
  the field explicitly says seconds or days.
- Anki card, note, deck, preset, and revlog identities generally use strings
  in references and map keys. The untouched numeric values inside
  `original_review` and native scheduling fields retain Anki's representation.
- `card.id` is the persistent reviewer identity. Do not recompute it when
  changing templates or source presentation. Some IDs are UUIDs; unmapped cards
  can have IDs such as `anki:<collection-key>:card:<anki-card-id>`.
- `note_uid` identifies the vault note or CSV row, usually `anki:<note-id>` or
  `local:<uid>`. Several cards can share it.
- Card partitions use `data/cards/cards-<index>.json` with zero-based,
  five-digit indices. Source paths are relative to the **vault root**, not to `data/`.

Reviews link to cards through `card_id`; cards link to SRS notes through `note_id`.
Each SRS note links to its vault source through `rule_id` and `locator`. The
note → card mapping is therefore the set of `(note_id, id)` pairs in the card
partitions, rather than a second mapping file.

## Manifests

`data/manifest.json` is the active entry point. The reviewer follows it and reads
the numbered partitions directly in `cards/` and `notes/`.
This file is required: it also supplies the scheduling settings and timing.
New imports do not write a duplicate manifest under `imports/<revision>/`.
Older imports may still have an unused copy there.

Concretely, the reviewer needs the manifest to:

1. Find the active card partitions and detect a catalog change during review.
2. Build the deck hierarchy and associate each deck with its preset.
3. Calculate answers using trained weights, retention, learning steps, and interval bounds.
4. Calculate exact deck counts using daily limits, overrides, saved counters,
   learning lookahead, and bury/parent-limit policies.
5. Interpret due days using the timezone, rollover hour, and day zero, and tie
   new answers to the correct imported baseline.

It contains no per-card history or note content. Reimports also use the collection
key and a comparison of scheduling baselines to prevent mixing collections or replacing scheduling
under existing answers. The remaining size comes mainly from deck/preset settings.
A partition count replaces the old repetitive path list.

| Field | Meaning |
| --- | --- |
| `format_version` | Currently `2`. |
| `collection_key` | String form of the imported collection's creation timestamp; the importer uses this as collection identity. |
| `import_id` | Scheduling-baseline identity referenced by new answers. |
| `revision` | Opaque catalog change token used to invalidate browser caches. Discovery changes this token without creating revision directories; it is not a note/card identity or timestamp. |
| `catalog_layout` | `"flat"` selects `cards/` and `notes/` directly. Legacy `"split"` stores with revision subdirectories, and older `imports/` stores, remain readable. |
| `note_partition_count` | Number of note arrays, with at most 250 notes per file. |
| `partition_count` | Number of card arrays under `cards/`, named `cards-00000.json` onwards, with at most 250 cards per file. Older manifests with an explicit `partitions` list remain readable. |
| `timing` | `day_zero` (`YYYY-MM-DD`), IANA `timezone`, and local `rollover_hour` (0–23). Import timing is supplied at runtime; the timezone defaults to the system timezone. |
| `scheduling` | Native deck hierarchy, presets, selected collection settings, source Anki version, and parameter policy. |

The native scheduling object contains:

```text
scheduling.presets[<preset-id>]
  id
  settings             only the selected fields listed below

scheduling.decks[<deck-id>]
  id, name, parent_id  hierarchy; names use :: separators
  filtered             whether the deck is filtered
  normal               config_id, limits/overrides, retention, etc. when present
  common
    last_day_studied, new_studied, review_studied

scheduling.collection  five runtime queue/count settings listed below
scheduling.source_anki_version
scheduling.parameter_policy
```

Preset `settings` contain one selected trained `fsrs_params_*` array,
`desired_retention`, `learn_steps`/`relearn_steps` (minutes), `new_per_day`,
`reviews_per_day`, `minimum_lapse_interval`, and `maximum_review_interval`. Deck
fields can override preset values. The saved native daily counters and newly
logged answers together determine remaining daily allowances. Imported historical
observations are not counted again as new study activity.

Deck `normal` contains only `config_id`, optional `desired_retention`,
`new_limit`, `review_limit`, and the `new_limit_today`/`review_limit_today`
overrides when present. Collection settings are `collapseTime`,
`applyAllParentLimits`, `newCardsIgnoreReviewLimit`, `lastUnburied`, and
`fsrsShortTermWithStepsEnabled`.

New manifests omit native legacy blobs, unused preset options and labels,
unused counters/offsets, duplicate global scheduler settings, snapshot timestamps,
and import-device UUIDs. Static rendering lookups are bundled in `view.js`.
Existing manifests with those extra fields remain readable; rerun migration to
publish the smaller form.

`algorithm: "FSRS-6"` is the reviewer engine label, not proof that the original
Anki preset had 21 weights. Preserve the selected parameter field, source backend
version, and parameter policy; your verified presets use 19 weights.

## SRS note bindings and card partitions

Both `notes-*.json` and `cards-*.json` are JSON arrays with at most 250 records
per file. Existing records keep their partition position; newly discovered
records append to the last partition or start a new one. The manifest's
`partition_count` counts card files; `note_partition_count` counts note files.
The latter also signals the separated binding layout. Manifest/event format
version 2 and the existing `import_id` remain unchanged.

A note binding contains only:

```json
{
  "id": "<stable hash of source rule and note UID>",
  "uid": "anki:1005",
  "rule_id": "example-notes",
  "locator": {"path": "examples/a.md", "kind": "markdown"}
}
```

`uid` identifies the vault note/row/block. `rule_id` selects its source rule in
`config/sources.json`; the pair defines this SRS note. A locator may include
`candidates` for unresolved paths and an `error`; it is null if there is no
binding. It contains no field mappings, preparation functions or note values.
Multiple cards reference the same note record by `note_id`.

| Card fields | Meaning |
| --- | --- |
| `id`, `note_id` | Stable card ID and reference to the SRS note binding. This is the persisted note-to-card mapping. |
| `template_key`, optional `cloze` | Selected template/variant from `config/cards.json`; null template for unmapped imported cards. |
| `anki_card_id`, `anki_notetype`, `anki_ordinal` | Original import identity and zero-based variant ordinal. Local cards have null Anki card ID. |
| `deck_id`, `original_deck_id` | Scheduling ledger/home deck association, retained for imported daily limits and counters. Study decks are separately defined filters. |
| Optional `profile_id` | Initial profile assignment; explicit settings and assignment rules can override it. |
| `active`, `supported`, optional `retired` | Catalog flags; missing content does not remove a card from scheduling counts. |
| `queue`, `card_type`, `anki_due`, `due_ms` | Baseline scheduling queue/type and due values. |
| `baseline` | Complete initial/imported scheduling state, or null if memory is absent. |
| `scheduling`, `memory`, optional `memory_origin` | Native scheduling baseline/provenance needed for import verification and compatibility. |

Card records contain **no** `source`, `fields`, `group` or `note_uid` copies.
The runtime joins note bindings with the central source rules and templates.
For example, `config/sources.json` contains the field recipe
`{"name":"Front","source":"character","transform":"text","required":true}`.
`name` identifies the SRS note field and `source` the vault property. These
recipes are stored once per rule, regardless of the number of cards it creates.

Cards with missing content still exist and count; rendering exposes the problem
and disables rating. Legacy partitions with inline source references remain
readable for conversion, but new separated stores never write those recipes.

## Scheduler state

The same state structure appears in `card.baseline`, baseline events, and new
answer events:

| Field | Meaning |
| --- | --- |
| `state` | Reviewer enum: `0` new, `1` learning, `2` review, `3` relearning. |
| `due`, optional `last_review` | Unix milliseconds. |
| `stability`, `difficulty` | FSRS memory state; stability is measured in days. |
| `elapsed_days`, `scheduled_days` | Scheduler day intervals. |
| `reps`, `lapses` | Repetition and lapse counters. |
| `learning_steps`, optional `remaining_steps` | Current learning position and remaining steps. |
| Optional `scheduled_secs` | Selected learning delay in seconds, before conversion to an interday due date. |
| Optional `queue`, `anki_due` | Native-style queue and due value retained/updated by the reviewer. |

Do not confuse `state` with Anki's queue. Common queues are `0` new, `1`
intraday learning, `2` review, `3` interday learning, `4` preview, `-1` suspended,
`-2` scheduler-buried, and `-3` manually buried. Anki's `due` is overloaded:
new-card order for queue 0, Unix seconds for queues 1/4, and days since
`timing.day_zero` for review/interday queues. The normalized reviewer `due` is
always a timestamp. Negative queues retain scheduling information but are
excluded or unburied according to the queue rules.

## Monthly review logs

Every nonempty line in `reviews/*.jsonl` is one complete UTF-8 JSON event,
terminated by a newline. Files are divided by **device and UTC month**, not by
deck or local study day. A log rolls over before exceeding **32 MiB**, using
`-002`, `-003`, etc. A single month's file can contain different event kinds.

New logs use names as device identities, with no UUID mapping table needed:

| `device_id` / filename prefix | Writer |
| --- | --- |
| `anki` | Migration/imported Anki history and baselines. |
| `computer` | Desktop reviewer. |
| `android` | Android reviewer. |

The reviewer's **Device** selector chooses `computer` or `android` and saves that
choice only on that device, in localStorage under
`ankobs-srs:<vault-name>:<reviewer-root>:device-name`. The initial default is
`android` for an Android user agent and `computer` otherwise. An optional
Dataview input `device: "computer"` or `device: "android"` can set the selection
when opening the view. Use a different name on each of your two reviewing devices
so they append to separate files. `anki` is reserved for migration.

Existing UUID device identities and UUID-named logs remain readable and immutable.
Migration recognizes its old deterministic import UUID, so adopting names does
not duplicate already imported events. Event IDs and parent references remain
UUIDs or baseline references; the device name does not identify individual answers.

### Historical observation: `historical_review`

Represents something in Anki's original revlog. Common event fields are
`format_version: 2`, `kind`, `id`, `device_id`, and `review_time_ms`. Additional
fields are:

- `id`: `anki:<collection_key>:<anki_revlog_id>`; deterministic deduplication key.
- `collection_key`, `anki_revlog_id`, `anki_card_id`: original scheduling identities.
- `card_id`: reviewer identity, or null for a card already deleted from Anki.
- `rating`, `duration_ms`, `review_type`: original review observations. Historical
  ratings are not restricted to 1–4 because the native log can contain other operations.
- `interval`, `previous_interval`: `{ "value": <absolute amount>, "unit": "days" | "seconds" }`.
  Negative native intervals encode seconds; nonnegative intervals encode days.
- `original_review`: original revlog row (`id`, `cid`, `usn`, `ease`, `ivl`,
  `lastIvl`, `factor`, `time`, `type`), all numeric scheduling metadata.

There is deliberately **no resulting `state`**: the old review row does not
establish a complete resulting memory state. It cannot replace the imported
baseline or a newer answer.

### Imported state: `scheduling_baseline`

Records the imported scheduling starting point:

```text
format_version: 2
kind: scheduling_baseline
id: baseline:<import_id>:<card_id>
device_id: anki
card_id, import_id
review_time_ms: <snapshot_ms>
state: <scheduler state or null>
scheduling: <original native card scheduling fields>
```

The card partition's `baseline` is the runtime starting point. Baseline events
record provenance; the index does not treat them as new answers or study activity.

### New answer: `answer`

Written when you rate a card in the reviewer:

```text
format_version: 2
kind: answer
id: <random event UUID>
device_id: computer | android
card_id: <persistent reviewer card ID>
deck_id: <home deck ID>
import_id: <compatible imported baseline>
parent: <previous answer UUID or import:<import_id>:<card_id>>
review_time_ms, duration_ms
rating: 1 | 2 | 3 | 4       Again | Hard | Good | Easy
was_new, was_review         booleans describing the prior state
scheduler_config_id: <SHA-256 of the immutable scheduler configuration>
state: <complete resulting scheduler state>
```

`scheduler_config_id` references `data/scheduler-configs/<id>.json`, described
below. Older version 2 answers with inline `scheduler_version` and
`scheduler_config` remain readable; existing logs are not rewritten. Each answer
has either the reference or the inline fields, never both.
`state.last_review` must equal `review_time_ms`. Keeping complete resulting
states avoids reconstructing the winner by replaying conflicting branches.

When two devices answer offline from the same parent, both immutable events
remain in the logs. The greatest `(review_time_ms, id)` selects the current
complete state. Duplicate IDs with identical contents are harmless; duplicate
IDs with different contents are errors. Historical observations and baseline
events never compete with answers for the latest state.

Preserved version 1 answer events lack `kind` and may omit `deck_id` and
`was_review`. The reviewer still reads them from monthly logs. New writes use
version 2 monthly logs. There is no `events/` directory in the current format.

### Immutable scheduler configurations

Each distinct effective interval configuration is written once, before its first
answer is appended, to `data/scheduler-configs/<sha256>.json`:

```text
scheduler_version: ts-fsrs@5.2.3/FSRS-6
settings:
  algorithm, weights, desired_retention, maximum_interval, minimum_interval
  learning_steps, relearning_steps, enable_fuzz, short_term_with_steps
  parameter_field, parameter_policy, source_anki_version
```

Optional fields are omitted when absent. Daily allowances (`new_cards_per_day`)
and mutable preset IDs are excluded: they do not affect the answer's interval.
Identical interval settings can therefore share a file across decks and devices.
The scheduler version is included in the document and hash, rather than repeated
on every new answer.

The lowercase 64-character ID is the SHA-256 of the document's canonical UTF-8
JSON: object keys sorted recursively, array order preserved, JavaScript JSON
number/string encoding, no whitespace or trailing newline. The file may end in
a newline; whitespace does not participate in the hash. The reviewer checks
that referenced files exist, validate, and match their hashes when indexing new
answers. An error leaves that log uncheckpointed for retry after syncing or repair.
Each distinct configuration is read once per incremental indexing pass.

Files are immutable and retained across configuration changes and reimports.
Missing/corrupt files produce a diagnostic; the writer never overwrites them.
Sync this directory alongside monthly logs. Old configurations support auditing
past answers; future answers continue to use current settings with the saved
card state. `data/profiles.json` supplies current scheduler settings. The manifest
retains frozen imported timing, hierarchy, baseline counters and deck overrides.

### Card settings change: `card_settings`

The **Cards** manager and the reviewer's **Card settings** button write settings
for one stable card UID. These are independent of vault note content, templates,
and imported scheduling baselines:

```json
{
  "format_version": 2,
  "kind": "card_settings",
  "id": "11111111-1111-4111-8111-111111111111",
  "device_id": "example-device",
  "card_id": "22222222-2222-4222-8222-222222222222",
  "time_ms": 946684800000,
  "changes": {"suspended": true, "tags": ["extra-practice"]}
}
```

Only changed fields are written. Optional `profile` is a scheduling-profile ID
from `data/profiles.json`; null restores automatic profile assignment. `suspended` is a
boolean and `tags` is a list of
unique, nonempty strings. A null value removes an override; the index retains
its timestamp so an older edit cannot resurrect it. Omitted fields stay unchanged.
Tags are card-specific and do not modify source-note tags.

Settings share `reviews/computer-YYYY-MM.jsonl` and Android's corresponding logs
with answers, using `time_ms` to choose the UTC month and the same 32 MiB rollover.
There is no separate mutable settings file. The greatest `(time_ms, id)` wins
**per field**: an offline tag edit and a suspension edit combine, while conflicting
edits to the same field resolve deterministically. Each tag list is one field.

Settings events have no `import_id`, scheduler configuration, or resulting state.
They follow the card UID across reimports, do not compete with answers, and do
not consume daily allowances. A settings-only log does not block a new imported
baseline; a log containing answers still does. Restoring an imported suspended
card resumes its saved queue type without resetting its memory state. Removing
the suspension override restores the imported suspension status. Retired cards
remain excluded regardless of overrides.

## Import report and local caches

`imports/<revision>/report.json` contains `notes`, `cards`, `review_events`,
`issues`, `content_problems`, and a `verification` status string. It describes
the migration run. A later `verify --output ../verification.json` writes a
**separate verification report**, outside `data/`; it does not rewrite the import
report's original unverified status. The schema here covers the import report,
not that separate verification report.

IndexedDB holds the device-local incremental index: file checkpoints, event
deduplication, current answers, per-field card settings, imported observations, activity, and reconstructed
baseline caches. Those are not synced `data/` JSON files. They can be rebuilt
from the store. Session Bury choices are also not written as review events.

Discovery writes only changed note/card partitions, with atomic replacement per
file. `catalog.pending.json` temporarily records the changed partitions and target
manifest. If interrupted, the next CLI open completes the pending update; the
reviewer pauses while it is present. Review logs and scheduler archives are not
rewritten. Generated metadata contains no note content; edit `config/cards.json`
and vault source files for presentation/content changes.

New notes and cards have an `added_at` UTC ISO 8601 timestamp (for example,
`2000-01-01T00:00:00.000Z`). It records first addition to this store and remains
unchanged on rediscovery, source moves, template edits and reimports. Existing
records with unknown addition times omit it; upgrading does not invent a date.

## Independent card discovery and profile training

Ongoing commands are `tools/srs.py refresh-cards` and `tools/srs.py train`.
The one-time imported-metadata initializer remains `migration/migrate.py init-study`.
The editable documents (all `format_version: 1`) are:

| File | Top-level payload | Purpose |
| --- | --- | --- |
| `config/sources.json` | `rules` | Obsidian → SRS note paths, selection, fields and transformations. |
| `config/cards.json` | `groups`, `rules` | Template definitions and per-source-rule selected templates/initial profile. |
| `config/decks.json` | `decks` | Named study filters and parents. |
| `config/profile-rules.json` | `rules` | Ordered filter-based profile assignments. |
| `data/profiles.json` | `profiles`, `default_profile` | Active scheduling settings and default profile ID. |

See [schemas/config.schema.json](schemas/config.schema.json) for the four rule
files and [schemas/data.schema.json](schemas/data.schema.json) for profiles and
generated metadata. [schemas/study.schema.json](schemas/study.schema.json)
describes the old combined/runtime representation, not a required stored file.

`tools/srs.py upgrade-layout` converts existing `study.json`/`config.json` and
card partitions in place. It checks configuration equivalence, card IDs and
baselines before switching the manifest, then removes the superseded generated
imports and legacy configuration. It never writes review logs or scheduler
archives, changes `import_id`, retrains a profile, or reschedules a card. A
converted store can keep using its existing incremental review index.
The [README](README.md#source-rules-study-decks-and-profiles) documents filter
semantics, precedence, daily budgets and commands.

New source-discovered cards use the same card-partition format and persistent
source/template identity. Optional `profile_id` supplies their initial profile;
`cloze: true` allows several cloze ordinals to use one template. Their internal
`deck_id` is `profile:<profile-id>`, a scheduling ledger constructed by the
reviewer from current profiles. These ledger IDs are not editable study decks.
The initial new-card state lives in the card's `baseline`; discovery does not
invent historical reviews or change `import_id`. After publishing the new
metadata generation it removes superseded generated import directories.

Source properties, tags and rendered questions/answers used for filter
evaluation remain transient. They are not copied into partitions. A source
rule's template list controls new-card generation; optional template `when`
filters use source properties. Existing UIDs and saved states are preserved.

A new answer may carry `profile_id` to identify its effective profile at review
time. Its immutable `scheduler_config_id` still records the actual interval
parameters, independent of subsequent profile edits. The trainer reads all
monthly logs, deduplicates IDs, selects the winning answer ancestry and excludes
manual/rescheduling observations. It groups histories by the current profile
assignment, including card-specific overrides. It can update `data/profiles.json` but
never rewrites answers, card states, imported baselines, or scheduler archives.
Training keeps same-day reviews as history inputs, but excludes zero-gap
prediction targets from fitting and evaluation. `same_day_targets_excluded`
counts formerly eligible zero-gap endpoints after a long-term review; the
initial learning-only prefixes are not included in this counter.
Training reports contain weights, sample/exclusion totals and labeled in-sample
metrics only. They are optional desktop output, not part of the runtime store.
