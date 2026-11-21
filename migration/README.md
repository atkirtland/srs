# Anki import and verification

Run these commands from `migration/`. Copy a closed, synchronized Anki collection
before importing. The importer reads standalone `collection.anki2` snapshots;
`.apkg`/`.colpkg` packages and snapshots with pending WAL data are unsupported.
It does not write to the source collection.

## Initial import

Convert note content into the vault separately and preserve Anki note IDs.
Copy and customize `config/exports.example.json` and `config/srs.example.json`
as `config/exports.json` and `config/srs.json`. These local files are ignored.

```sh
uv sync --locked --extra anki
uv run --extra anki python migrate.py inspect --collection /path/to/snapshot.anki2
uv run --extra anki python migrate.py migrate \
  --collection /path/to/snapshot.anki2 --anki-version 26.9.4 \
  --day-zero YYYY-MM-DD
uv run python migrate.py init-study
```

Use the source Anki version and its actual day-zero date; see the
[setup instructions](../README.md#import-from-anki). The locked backend is 26.9.4.
For another version, install it with `uv add --optional anki 'anki==YOUR_VERSION'`.
The installed backend must match `--anki-version`.

Timezone defaults to the system timezone or ignored `../config/local.json`.
Use `--timezone` and `--rollover-hour` to match Anki. Paths default to the
containing vault and `../data/`; `--vault` and `--output` override them.
Skip `init-study` if `../config/sources.json` already exists.

## Verify

```sh
uv run --extra anki python migrate.py verify \
  --collection /path/to/snapshot.anki2 --anki-version 26.9.4 \
  --data ../data --output ../verification.json
```

Verification uses a disposable snapshot copy and desktop Node. `--node` selects
another Node executable. `--at` fixes the time for count comparisons; answer
transitions use Anki's wall clock. The report checks deck counts, memory, learning
steps, and deterministic intervals. Native fuzz/load-balancing differences are
reported separately and do not alone fail verification. Exit status 2 indicates
failed checks. Check your own collection and devices before switching reviewers.

## Temporary Anki review bridge

Preview later reviews from a snapshot of the same collection:

```sh
uv run --extra anki python migrate.py import-reviews \
  --collection /path/to/snapshot.anki2 --anki-version 26.9.4 \
  --data ../data --output ../anki-review-import.json
```

Add `--apply` to save. Close the reviewer on every device and finish syncing
first. Preview changes no study data; the optional report is still written.

Imports deduplicate by original Anki review ID and include each affected card's
saved due date and memory state. They preserve templates, bindings, profiles,
and study decks. Nothing is sent back to Anki and no note content is archived.

- Cards with any local SRS answer are conflicts; their incoming history is skipped.
- Unmapped cards, filtered-deck cards, and cards without saved memory are skipped.
  The bridge adds no cards and does not reconstruct missing memory.
- Daily activity allowances, deck settings, and scheduling profiles are unchanged.
- Rescheduling/suspension edits without a new revlog entry are not imported.
- Exit status 2 reports conflicts or unmapped cards. With `--apply`, other safe
  cards are still imported.

If interrupted, rerun with `--apply` to finish `data/anki-bridge.pending.json`
before reopening the reviewer. Recovery refuses changed logs or catalogs.
Future answers here use this reviewer's scheduler, so intervals can differ from
Anki.

## Tests

```sh
uv sync --locked --extra anki
uv run --extra anki python -m unittest discover -s tests -v
```

See [architecture](../ARCHITECTURE.md) for module responsibilities and storage,
[data formats](../DATA_FORMAT.md) for records, and [desktop tools](../tools/README.md)
for training and builds.
