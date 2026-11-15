# Ongoing SRS tools

Run from this directory:

```sh
uv sync --locked
uv run python srs.py refresh-cards
uv run python srs.py train --profile preset-1 --apply
```

Defaults point to `../config/`, `../data/`, and the containing vault.
Profiles live in `../data/profiles.json`. `--config` selects another configuration
directory; `--data` selects its store. Legacy `--study <study.json>` remains
available for compatibility. `refresh-cards` automatically assigns missing IDs to CSV rows, eligible structural
notes, and blocks while retaining existing identities. No separate seeding step is needed.

Omit `--apply` to train and evaluate without updating a profile.

| Command | Purpose |
| --- | --- |
| `srs.py audit-decks` | Flag cards matching a parent but none of its descendants; report IDs without changing decks. Exit 0: clear; 1: gaps; 2: failure. |
| `srs.py prune-missing-sources` | Preview removal of unreviewed generated cards with missing sources; `--apply` removes eligible cards. |
| `srs.py refresh-cards` | Discover source/template card variants while preserving identities, schedules, and logs. |
| `srs.py train --profile <id>` | Train and evaluate standalone FSRS from unified reviews; `--apply` updates future answers. |
| `build.py` | Rebuild the standalone reviewer from browser sources. |

The `srs_tools/` package contains the ongoing CLI, source discovery, training,
vault parsers/transformations, identity helpers, and metadata-store helpers.
It does not import migration modules or load the old Anki export registry.
Its environment has no Anki, BeautifulSoup, markdownify, or PyTorch dependency.
`browser/` contains browser source fragments and the shared desktop verification
runner. `tests/` holds ongoing Python and browser tests.

One-time Anki import, native verification, and `init-study` belong in
[`../migration/`](../migration/README.md). Old ongoing commands invoked through
`migrate.py` forward to this CLI using this project's uv environment.

For development checks from this directory:

```sh
uv sync --locked --extra test
uv run --extra test python build.py
uv run --extra test python -m unittest discover -s tests -v
uv run --extra test npm ci
uv run --extra test npm test
```

The optional `test` extra supplies Node for the browser checks. Browser test
packages live in `node_modules/`. Neither Node nor Python is required while
reviewing on desktop or Android.
