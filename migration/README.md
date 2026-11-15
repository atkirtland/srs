# Desktop SRS tools

All Python tooling and dependencies live here. The default `uv sync --locked`
environment supports card discovery and standalone FSRS training without Anki
or Node. Import/native verification use the optional `anki` extra:
`uv run --extra anki python migrate.py ...`.

From this directory, after restoring `../data/`:

```sh
uv sync --locked
uv run python migrate.py init-study
uv run python migrate.py refresh-cards
uv run python migrate.py train --profile preset-1 --apply
```

Initialization runs once and preserves edits. Use actual profile IDs from
`../study.json`; omit `--apply` to evaluate without updating settings. Source
discovery assigns persistent IDs to new notes/rows/blocks and preserves existing
schedules and logs. Training consumes imported and local reviews directly using
`fsrs-rs-python`; it never opens an Anki collection.

See [the reviewer README](../README.md) for filter syntax, migration, native
verification, storage formats, and test commands. `.venv` and test-only
`node_modules` are never required while reviewing on desktop or Android.
