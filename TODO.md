# Deferred: exact Anki interval selection

The reviewer currently uses deterministic intervals. It applies the imported
trained FSRS settings, rounds intervals, enforces bounds, and orders the
Hard/Good/Easy intervals. It does not reproduce Anki's native fuzz or load
balancing.

## Verified behavior and remaining differences

The latest verification against Anki 26.9.4 reported:

- Exact deck count agreement: zero deck differences.
- Zero memory/learning-step differences across 96 tested answer transitions.
- Zero deterministic scheduling differences.
- 39 final interval differences, grouped as "fuzz/ordering" differences.
- Zero diagnostics.

The interval-difference category does not isolate the cause of each difference.
It covers differences between Anki's final interval and the reviewer's
deterministic interval; it is not proof that every difference is random fuzz.
The reviewer already implements basic rating interval ordering.

Examples from that verification (all intervals in days):

| Answer | Anki | Reviewer |
| --- | ---: | ---: |
| Review → Hard | 7 | 6 |
| Review → Good | 42 | 40 |
| Review → Easy | 114 | 111 |
| Longer review → Easy | 864 | 886 |

Of the 39 differences, 23 were one or two days. The largest absolute difference
was 22 days. These are observations from that run, not guaranteed future bounds.
Future due dates and daily workloads can therefore differ from Anki even when
the underlying memory calculations agree.

## Work needed for exact interval matching

- [ ] Inspect and target the source corresponding to Anki 26.9.4, rather than
  assuming the current upstream implementation matches it.
- [ ] Match native fuzz bounds, rounding, interval constraints, and rating
  ordering, including interactions with previously scheduled intervals.
- [ ] Reproduce native random seeds and random-number generation; enabling the
  JavaScript FSRS library's fuzz alone is insufficient.
- [ ] Match load balancing using the relevant cards' due dates and preset
  associations, sibling relationships, and configured Easy Days. Retain any
  additional required scheduling metadata without storing note content.
- [ ] Use the same interval-selection implementation for previews and submitted
  answers in the standalone browser reviewer.
- [ ] Extend native verification to require exact final intervals for all four
  ratings across the six presets and new/learning/review/relearning states.
- [ ] Verify sequences of answers, day rollover, sibling handling, Easy Days,
  and changing workloads; single-card comparisons alone are insufficient.
- [ ] Preserve standalone desktop/Android operation without Python or Node at
  review time, card identities, and existing review history.

Exact parity means the same intervals for the same collection state, settings,
timestamp, and answer sequence against the targeted Anki version. Independent
study in both applications changes their collection workloads and can lead to
different load-balanced intervals. Compatibility with later Anki versions
requires separate verification.

Upstream references for investigation (current main branch, not pinned to the
target version):

- [Fuzz and interval bounds](https://github.com/ankitects/anki/blob/main/rslib/src/scheduler/states/fuzz.rs)
- [Load balancing](https://github.com/ankitects/anki/blob/main/rslib/src/scheduler/states/load_balancer.rs)
- [Review interval selection](https://github.com/ankitects/anki/blob/main/rslib/src/scheduler/states/review.rs)
