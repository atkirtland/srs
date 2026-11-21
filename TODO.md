# TODO

## Exact Anki intervals

The reviewer uses deterministic intervals. Matching Anki's final intervals is
still deferred.

- [ ] Match the target Anki version's fuzz, rounding, interval ordering, and RNG.
- [ ] Implement load balancing, including siblings, Easy Days, and deck workloads.
- [ ] Share interval selection between previews and submitted answers.
- [ ] Verify exact intervals across presets, all review states, answer sequences,
  and day rollover. Preserve card IDs, history, and desktop/Android operation.

## Incremental reading

Deferred; no implementation yet.

- [ ] Decide source enrollment, stable IDs, reading-state schema, and scheduling.
- [ ] Save reading position and create extracts with their own vault text and
  parent references; choose inline blocks, separate notes, or both.
- [ ] Generate ordinary cards from extracts using existing templates and history.
- [ ] Keep reading queues/activity separate from card reviews and FSRS training.
  Finishing an article must leave its cards active.

Start with Markdown, saved position, extracts, and a simple “read again” schedule.
Defer PDFs, web capture, and more complex priority scheduling.
