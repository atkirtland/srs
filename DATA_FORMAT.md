# SRS data formats

`data/` stores card identities, vault source references, imported scheduling
metadata, and review events. Questions and answers are read from the vault at
review time. Templates live in the editable `config.json` beside `data/`, not in
the card partitions. There is no retained Anki note-content archive.

The current store format is **version 2**. Preserved version 1 answer events are
also readable. File names do not determine event kind; inspect `format_version`
and `kind` inside each record.

## Layout and JSON Schema

```text
data/
  manifest.json
  imports/<revision>/
    report.json
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
2020-12 document describing these files. Its root accepts a manifest, card
partition, import report, or individual event. Validate **each JSONL line
separately**, not a complete JSONL file as one JSON document. Specific types are
available through these schema references:

| File or record | Schema reference |
| --- | --- |
| `data/manifest.json` | `schemas/data.schema.json#/$defs/Manifest` |
| `cards-*.json` | `schemas/data.schema.json#/$defs/CardPartition` |
| Import `report.json` | `schemas/data.schema.json#/$defs/ImportReport` |
| Any review-log line | `schemas/data.schema.json#/$defs/Event` |
| Historical observation | `schemas/data.schema.json#/$defs/HistoricalReview` |
| Imported baseline | `schemas/data.schema.json#/$defs/SchedulingBaseline` |
| New answer | `schemas/data.schema.json#/$defs/Answer` |
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

- Timestamps such as `snapshot_ms`, `review_time_ms`, `due`, `due_ms`, and
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
- Card partitions use `data/imports/<revision>/cards-<index>.json` with zero-based,
  five-digit indices. Source paths are relative to the **vault root**, not to `data/`.

## Manifests

`data/manifest.json` is the active entry point. The reviewer follows it and reads
the partitions under its revision; it does not select the latest-looking directory name.
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
| `revision` | SHA-256 digest identifying the generated catalog, including source references and a digest of the scheduling baseline. |
| `partition_count` | Number of card arrays under `imports/<revision>/`, named `cards-00000.json` onwards, with at most 250 cards per file. Older manifests with an explicit `partitions` list remain readable. |
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

## Card partitions

Each `cards-00000.json` is a JSON **array**, not an object or JSONL file.
Individual cards have no `format_version`; their manifest supplies it.

| Fields | Meaning |
| --- | --- |
| `id`, `anki_card_id`, `note_uid` | Reviewer identity, original Anki card ID (null for local cards), and note/row identity. |
| `group`, `template_key` | Reference to an editable template in `config.json`; either can be null for unmapped cards. |
| `anki_notetype`, `anki_ordinal` | Original note type and zero-based card ordinal. |
| `deck_id`, `original_deck_id` | Current deck and optional original/home deck association. |
| `source` | Vault source locator and field transformations, or null when unresolved. |
| `active`, `supported`, optional `retired` | Catalog flags. Retired cards remain addressable for history but do not participate in study counts. `supported` does not guarantee content will render. |
| `queue`, `card_type`, `anki_due`, `due_ms` | Imported queue/type, native due value, and normalized due timestamp. New cards have no scheduled date, so `due_ms` can be null. |
| `baseline` | Complete imported reviewer state, or null if memory initialization could not be completed. |
| `scheduling` | Original numeric Anki fields: `due`, `ivl`, `factor`, `reps`, `lapses`, `left`, `odue`, `odid`, `queue`, `type`. Local cards may have only `queue`. |
| `memory` | Available native `s` (stability), `d` (difficulty), `dr` (desired retention), `decay`, and `lrt` (last-review Unix **seconds**, an exception to the millisecond convention). |
| Optional `memory_origin` | `saved`, `missing`, or `native_historical_reconstruction`. |

`source` contains `kind` (`csv`, `markdown`, `block`, or `unresolved`), an
optional vault-relative `path`, optional `candidates`, optional preparation
function name, and a `fields` array. A field mapping contains:

```json
{
  "anki": "Front",
  "source": "word",
  "transform": "text",
  "required": true
}
```

`missing_source` can carry the mapping's fallback specification; an optional
source `error` records an identity-resolution problem. These are field **names
and instructions**, not retained note values. Cards with missing sources still
exist and count; rendering exposes the problem and disables rating.

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
scheduler_version: ts-fsrs@5.2.3/FSRS-6
scheduler_config: <effective settings used for this answer>
state: <complete resulting scheduler state>
```

`scheduler_config` records the effective weights, parameter provenance, retention,
interval limits, learning/relearning steps, and relevant reviewer options.
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

## Import report and local caches

`imports/<revision>/report.json` contains `notes`, `cards`, `review_events`,
`issues`, `content_problems`, and a `verification` status string. It describes
the migration run. A later `verify --output ../verification.json` writes a
**separate verification report**, outside `data/`; it does not rewrite the import
report's original unverified status. The schema here covers the import report,
not that separate verification report.

IndexedDB holds the device-local incremental index: file checkpoints, event
deduplication, current answers, imported observations, activity, and reconstructed
baseline caches. Those are not synced `data/` JSON files. They can be rebuilt
from the store. Session Bury choices are also not written as review events.

The publisher writes a complete generation, switches the root manifest, and
removes superseded generated import directories. `manifest.pending` is a
temporary publication artifact, not a separate document format. Review logs
remain; there should be no generated `raw.json` or per-card `history-*.json`
archive. Treat generated metadata and existing log lines as immutable; use
`config.json` and vault source files for presentation/content edits.
