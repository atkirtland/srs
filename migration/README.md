# Anki migration and verification

This directory owns one-time Anki import, native scheduler verification, and
initial conversion of imported metadata into editable study configuration.
Ongoing card discovery and training live in [`../tools/`](../tools/README.md).

Initial scheduling baselines and original Anki scheduling fields are stored on
cards, not duplicated as `scheduling_baseline` events in review logs. Readers
still accept those legacy events. The incremental bridge's `anki_state` events
are different: they carry a later scheduling update after new Anki reviews.

| Command | Purpose |
| --- | --- |
| `migrate.py inspect --collection <snapshot>` | Inspect snapshot metadata and template definitions. |
| `migrate.py migrate ...` | Import scheduling identities, baselines and review history. |
| `migrate.py verify ...` | Compare counts and transitions with a disposable Anki collection copy. |
| `migrate.py init-study` | Create `../config/`, `../data/profiles.json` and separate note/card bindings once. |

Copy `config/exports.example.json` and `config/srs.example.json` to local files
without `.example` and customize them before importing. These local files are
ignored. Migration defaults to the system timezone; `--timezone` and the ignored
`../config/local.json` can override it. See the main README for vault settings.

Run native import and verification with their optional backend:

```sh
uv sync --locked --extra anki
uv run --extra anki python migrate.py migrate --help
uv run --extra anki python migrate.py verify --help
```

For one-time setup after importing:

```sh
uv run python migrate.py init-study
```

Skip setup if `../config/sources.json` already exists.
Review logs and card IDs are preserved by the initial layout conversion.
Anki-to-vault field mappings remain in `config/exports.json` for the compatibility
adapter; your external converter owns that conversion. `lib/bootstrap.py`
converts imported metadata to study configuration. `lib/catalog.py`, `srs.py`,
`scheduling.py`, and `verification.py` handle native import and verification.
Shared vault parsers and identity helpers come from `../tools/srs_tools/`.

Old `train` invocations
through `migrate.py` forward to `../tools/srs.py` and its uv environment.
`build.py` and `verify-browser.cjs` are compatibility entry points for their
implementations under `tools/`. Migration's uv environment contains the legacy
conversion dependencies and optional Anki backend, not the standalone optimizer.

Run migration checks with:

```sh
uv run --extra anki python -m unittest discover -s tests -v
```

See [the reviewer README](../README.md) for complete migration commands and
[DATA_FORMAT.md](../DATA_FORMAT.md) for the persistent file formats.

## Temporary Anki review bridge

`import-reviews` imports new reviews into an **existing** catalog without
regenerating notes/cards or changing templates, source bindings, profiles, or
study decks. Use a standalone snapshot from the same Anki collection. Close Anki
before copying its collection (a live SQLite file can have uncheckpointed WAL
changes). Close the SRS reviewer on all devices and finish syncing before applying;
this command cannot lock another device's reviewer.

From `migration/`, preview:

```sh
uv run --extra anki python migrate.py import-reviews \
  --collection ../../collection.anki2 --anki-version 26.9.4 \
  --data ../data --output ../anki-review-import.json
```

Add `--apply` to save the import. Match `--anki-version` to the snapshot's source
version and installed optional backend. Timezone, day zero, and rollover come
from the existing `data/manifest.json`; no timezone argument is needed.

New reviews retain their original Anki revlog IDs and information, deduplicate
against previous imports, and append to `data/reviews/anki-YYYY-MM.jsonl` with the
existing 32 MiB rollover. Separate `anki_state` events contain each affected
card's **saved Anki scheduling state**, including its due date and memory state.
The reviewer uses these events as the current state; they are not invented
review answers. Nothing is sent back to Anki, and no note content is archived.
Subsequent local reviews can use an imported state as their parent. Training
reads the imported observations once and ignores state events as examples.

Cards with any local SRS answer are reported as conflicts and left unchanged,
including their incoming Anki history. This is deliberately conservative: the
bridge cannot reconcile reviews performed in both schedulers. Unmapped cards,
filtered-deck cards, and cards without saved memory state are also reported and
skipped; it does not add cards or reconstruct FSRS memory. Exit status 2 signals
conflicts/unmapped cards; with `--apply`, other safe cards are still imported.
A preview writes no data (only the optional report).

**Limitations:** imported reviews do not update local daily activity allowances,
Anki deck settings, or scheduling profiles. Future answers here still use this
reviewer's scheduler, so future intervals can differ from Anki. This imports
review-driven changes, not independent rescheduling/suspension edits with no new
revlog entry. Review times are the original Anki timestamps, not import times.

An interrupted apply leaves `data/anki-bridge.pending.json`, containing only
replacement review logs and the expected manifest. Rerun with `--apply` to finish
it before reopening the reviewer; replay is idempotent and refuses changed logs
or catalogs. The journal is removed after successful publication.
