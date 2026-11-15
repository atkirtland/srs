# Incremental reading: proposed design

Discussion notes for future work. This is not an implementation commitment; incremental reading is deferred.

## Data flow

```text
Source document → reading item → extract → SRS note → cards
                       ↓                      ↓
                reading activity          reviews
```

The vault owns meaningful content. `data/` owns identity mappings, progress, scheduling, and activity. The existing separation of sources, notes, cards, and scheduling provides a foundation without requiring articles to become flashcards.

## Responsibilities and storage

| Layer | Proposed responsibility |
|---|---|
| Source document | Text, existing metadata, and a stable source identity |
| Reading item | Source reference, saved reading position, priority, next reading date, and active/finished status |
| Extract | Text in the vault, a stable identity, and a reference to its parent document or extract |
| SRS note | Existing source binding for a question or cloze derived from an extract |
| Card | Existing identity, FSRS state, and card-specific settings |
| Deck | Filters selecting reading items or cards |
| Activity logs | Reading actions and ordinary card reviews, distinguished by event type |

Reading-item state could live in `data/reading/`; the exact schema and layout remain undecided.

## Source metadata and identities

- Enrolling a source requires a stable identity so moves and renames preserve progress. Reuse a suitable existing identity where possible.
- If necessary, add a field such as `srs_reading_id` to the document. Its presence could also represent explicit enrollment; the name and enrollment mechanism remain undecided.
- Reuse existing titles, topics, paths, and tags for display and filtering.
- Keep reading position, scheduling, and activity history out of source frontmatter so reading does not continually modify the vault document.

## Extracts

An extract should own its text in the vault rather than depend entirely on character offsets into its parent. Editing an article must not silently change an extract's content.

Keep a parent reference for provenance and navigation. Optionally retain a heading or block reference and surrounding text to help locate the original passage after edits.

Two possible content representations remain open:

- Inline identified blocks keep extracts with their source.
- Separate Markdown notes make extracts easier to organize and develop independently.

Both could be supported through source locators. Stable identities must survive edits and moves in either representation.

## Example lifecycle

1. Enroll `wiki/ocean-circulation.md`; a reading item references its stable identity.
2. Read to a heading; update the saved position in `data/reading/`.
3. Extract a paragraph into an identified block or separate note. Create a reading item for it with a parent reference.
4. Write a question or cloze from the extract. Existing source rules generate an SRS note and ordinary cards.
5. Finish the article. Mark its reading item finished while its extracts and cards continue independently.

Finishing or postponing an article must not suspend cards derived from it. An article does not need an SRS note until it generates cards.

## Changes to the existing system

### Notes and cards

- Keep ordinary SRS notes and cards in their existing roles.
- Allow an optional provenance reference from a derived question to its reading item.
- Use existing templates, card identities, card settings, and FSRS scheduling for generated questions.

### Decks and queues

- Extend filters with a target such as `cards` or `reading_items`.
- Allow a topic to have a reading queue and a review deck based on similar source/tag filters.
- Keep reading and card-review counts separate.

### Scheduling and activity

- Give reading items a separate scheduling policy: priority, availability date, and perhaps a chosen interval.
- Do not use ordinary FSRS recall ratings to represent reading an unfinished article. Reading does not supply the same recall observation as answering a question.
- Keep graded card answers unchanged.
- Define distinct reading events, for example position saved, postponed, and finished.
- Exclude reading events from FSRS training examples.

## Possible first version

- Markdown source enrollment.
- Saved reading position.
- Selecting a passage to create an extract.
- Converting an extract into a question or cloze through existing card generation.
- Simple priority and “read again in…” scheduling.

Defer PDFs, web capture, and elaborate priority scheduling. Before implementation, settle extract representation, identity/enrollment conventions, reading-position anchors, and the reading-state/event schemas.
