# Anki migration and verification

This directory owns one-time Anki import, native scheduler verification, and
initial conversion of imported metadata into editable study configuration.
Ongoing card discovery and training live in [`../tools/`](../tools/README.md).

| Command | Purpose |
| --- | --- |
| `migrate.py inspect --collection <snapshot>` | Inspect snapshot metadata and template definitions. |
| `migrate.py migrate ...` | Import scheduling identities, baselines and review history. |
| `migrate.py verify ...` | Compare counts and transitions with a disposable Anki collection copy. |
| `migrate.py init-study` | Create `../config/`, `../data/profiles.json` and separate note/card bindings once. |

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
