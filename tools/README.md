# Desktop tools

Run commands from `tools/`. Reviewing and card maintenance need no desktop runtime;
use **Tools → Refresh cards** and **Tools → Prune missing sources** in the reviewer.

## Train and audit

```sh
uv sync --locked
uv run python srs.py train --profile preset-1 --output ../training.json
uv run python srs.py train --profile preset-1 --apply --output ../training.json
uv run python srs.py audit-decks
```

Choose a profile ID from **Profiles** or `../data/profiles.json`. Training previews
by default; `--apply` updates future answers without changing saved schedules or
history. `audit-decks` reports cards matching a parent but none of its children;
exit codes are 0 for clear, 1 for gaps, and 2 for failure.

Defaults use `../config/`, `../data/`, and the containing vault. Set the vault in
ignored `../config/local.json`, `SRS_VAULT`, or `--vault`. Use `--config` and
`--data` for another store. Run either subcommand with `--help` for options.

## Build and test

```sh
uv sync --locked --extra test
uv run --extra test python build.py
uv run --extra test python -m unittest discover -s tests -v
uv run --extra test npm ci
uv run --extra test npm test
uv run --extra test node tests/benchmark-reviewer.cjs
```

`build.py` combines browser sources into `../view.js`. The test extra supplies
Node; the benchmark uses a synthetic 30,000-card store and does not measure vault
I/O. Browser tests mock Obsidian and IndexedDB; check desktop/Android behavior on
real devices as well.

See [architecture](../ARCHITECTURE.md) for modules, indexing, and maintenance
behavior, and [migration](../migration/README.md) for Anki commands.
