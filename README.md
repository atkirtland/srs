# Obsidian SRS

Review cards from your Obsidian notes, CSV files, and callouts on desktop or
Android. Requires Obsidian and Dataview with JavaScript queries enabled.
Python and Node are only needed for desktop tools.

## Open the reviewer

Put this folder at `srs/` in your vault and add this to a note:

````markdown
```dataviewjs
await dv.view("srs", { root: "srs" });
```
````

Use your folder name for both paths. Select a deck to study.
**Bury** skips a card for the session; **Undo review** reverses the latest answer
when it is still the card's latest state and the last event in that device's log.
**Cards** provides search, previews, suspension, tags, and review history.
**Analytics** shows recall, time spent, and repeated Again answers.

## Set up

From this folder, copy the local settings without overwriting existing files:

```sh
cp -n config/local.example.json config/local.json
```

Set `vault` to your vault directory, or leave it null to use this folder's parent.
Leave `timezone` null to use the system timezone. Local configuration and study
data are ignored by Git; only synthetic `*.example.json` files are tracked.

Choose one starting point:

- **Anki:** follow the import commands below.
- **Without Anki:** copy `sources`, `cards`, `decks`, and `profile-rules` examples
  from `config/*.example.json` to matching `.json` filenames. Create `data/` and
  copy `config/profiles.example.json` to `data/profiles.json`. Supply
  `examples/notes.csv` in your vault with `question` and `answer` columns, or edit
  the source rules. The example weights are synthetic; train or supply your own
  profile before using them for study.

## Add and update cards

Edit `config/sources.json` for source paths and fields, `config/cards.json` for
templates, and `config/decks.json` for deck filters. **Sources** shows the current
rules; **New deck** and **Edit** change deck membership.

- **Tools → Refresh cards:** discover new notes and update cards.
- **Sync source file:** update one file from the card menu or **Sources**.
- **Tools → Check content:** find missing fields, sources, and template errors.
- **Tools → Prune missing sources:** preview removal of unreviewed local cards
  whose source identities no longer exist. Imported cards and cards with reviews
  or settings are protected.
- **Reload reviewer:** reload existing data without discovering new cards.

To enroll a Markdown note, add a blank `srs_note_id:` frontmatter field.
CSV rows and `[!srs]` / `[!anki]` blocks enroll automatically under matching source
rules. Refresh fills missing IDs. Keep IDs, source-rule keys, and template keys
stable when editing. When moving a note between source rules, refresh and map its
old templates to destination templates in the dialog to preserve card history.

Run maintenance on one syncing device at a time. Choose a distinct **Device**
value on each device, sync the vault, `config/`, and all of `data/`, and let syncing
finish before switching devices. **Tools → Rebuild local index** rebuilds caches.

## Import from Anki

First convert note content into your vault using your external converter, keeping
Anki note IDs. This importer links that content to Anki scheduling and history.
Synchronize and close Anki, then copy `collection.anki2` to a separate snapshot.
Before closing, obtain the collection's day-zero date in Anki's debug console:

```python
from datetime import datetime, timedelta
print(datetime.fromtimestamp(mw.col.sched.day_cutoff).date() - timedelta(days=mw.col.sched.today + 1))
```

From `migration/`:

```sh
cp -n config/exports.example.json config/exports.json
cp -n config/srs.example.json config/srs.json
uv sync --locked --extra anki
uv run --extra anki python migrate.py inspect --collection /path/to/snapshot.anki2
```

Customize the source mappings and templates in those local configuration files,
then import and verify:

```sh
uv run --extra anki python migrate.py migrate \
  --collection /path/to/snapshot.anki2 --anki-version 26.9.4 \
  --day-zero YYYY-MM-DD
uv run python migrate.py init-study
uv run --extra anki python migrate.py verify \
  --collection /path/to/snapshot.anki2 --anki-version 26.9.4 \
  --data ../data --output ../verification.json
```

Use your actual version and day-zero date. The locked backend is Anki 26.9.4;
for another version, run `uv add --optional anki 'anki==YOUR_VERSION'` first.
Pass `--timezone` and `--rollover-hour` to `migrate` if the defaults differ from
Anki. Skip `init-study` if `config/sources.json` already exists. Verification
requires desktop Node. Future intervals can differ from Anki's fuzz/load balancing.

To preview later reviews from a new snapshot of the same collection:

```sh
uv run --extra anki python migrate.py import-reviews \
  --collection /path/to/snapshot.anki2 --anki-version 26.9.4 --data ../data
```

Add `--apply` to save. Close the reviewer on all devices and finish syncing first.
This pulls reviews and saved scheduling state for existing cards; it skips cards
answered locally, adds no cards, and leaves profiles and daily allowances alone.
See [Anki import details](migration/README.md).

## Train FSRS

From `tools/`, replace `preset-1` with a profile ID from **Profiles**:

```sh
uv sync --locked
uv run python srs.py train --profile preset-1 --output ../training.json
uv run python srs.py train --profile preset-1 --apply --output ../training.json
```

The first command previews; `--apply` updates the profile for future answers.
Existing due dates and history stay intact. Training needs 1,000 eligible
long-term examples by default.

[Architecture and configuration](ARCHITECTURE.md) · [Data formats](DATA_FORMAT.md) ·
[Development commands](tools/README.md) · [TODO](TODO.md)
