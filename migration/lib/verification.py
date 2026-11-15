"""Strict desktop oracle: open only a disposable collection copy.

Only counts, scheduler metadata and answer transitions leave the temporary
directory. Source notes and rendered Anki questions are never exported.
"""
from __future__ import annotations

import importlib.metadata
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone, timedelta, date
from zoneinfo import ZoneInfo

import scheduling

HERE = Path(__file__).resolve().parents[1]


def fixture_representative(col, meta, preset, category, now):
    """Fill missing state coverage on the disposable copy, using its real preset."""
    import copy
    name = "SRS verification fixture"
    model = col.models.by_name(name)
    if not model:
        model = col.models.new(name)
        for field in ("Front", "Back"):
            col.models.add_field(model, col.models.new_field(field))
        template = col.models.new_template("Fixture")
        template.update(qfmt="{{Front}}", afmt="{{Back}}")
        col.models.add_template(model, template)
        col.models.add(model)
    did = col.decks.id(f"SRS verification fixtures::{preset}")
    deck = col.decks.get(did)
    deck["conf"] = int(preset)
    col.decks.save(deck)
    note = col.new_note(model)
    note["Front"], note["Back"] = "Fixture", "Fixture"
    col.add_note(note, did)
    cid = col.find_cards(f"nid:{note.id}")[0]
    card = col.get_card(cid)
    category_type = {"new": 0, "learning": 1, "review": 2, "relearning": 3}[category]
    card.type = category_type
    card.queue = 0 if category_type == 0 else 2 if category_type == 2 else 1
    card.ivl = 0 if category_type == 0 else 5
    card.reps = 0 if category_type == 0 else 2
    card.lapses = 1 if category_type == 3 else 0
    card.left = 1 if category_type in (1, 3) else 0
    card.due = col.sched.today if category_type == 2 else now // 1000 - 300 if category_type else 1
    col.update_card(card)
    if category_type:
        col.db.execute("update cards set data=? where id=?", '{"s":5,"d":7}', cid)
        review_time = now - 5 * 86400000
        # revlog IDs are unique timestamps; choose a free millisecond.
        while col.db.scalar("select 1 from revlog where id=?", review_time):
            review_time += 1
        col.db.execute("insert into revlog values (?,?,?,?,?,?,?,?,?)", review_time, cid, 0, 3, 5, 3, 2500, 1000, 1)
    else:
        review_time = None
    temporary_meta = copy.deepcopy(meta)
    temporary_meta["decks"][str(did)] = {"normal": {"config_id": preset}}
    options = scheduling.effective(temporary_meta, did)
    baseline = {"state": category_type, "queue": card.queue, "due": now - 300000 if card.queue == 1 else now,
                "stability": 5 if category_type else 0, "difficulty": 7 if category_type else 0,
                "elapsed_days": 0, "scheduled_days": card.ivl, "reps": card.reps,
                "lapses": card.lapses, "learning_steps": max(0, len(options["relearning_steps"] if category_type == 3 else options["learning_steps"]) - 1),
                "remaining_steps": card.left, "anki_due": card.due}
    if review_time:
        baseline["last_review"] = review_time
    # Browser scheduling needs a normal deck association, independently of the
    # fixture's native temporary deck. Counts never include these fixtures.
    association = next(d["id"] for d in meta["decks"].values() if not d["filtered"])
    return {"id": f"verification:{preset}:{category}", "anki_card_id": str(cid), "deck_id": association,
            "queue": card.queue, "card_type": category_type, "baseline": baseline}, options


def flat_tree(tree):
    result = {}
    def visit(node):
        result[str(node.get("deck_id", 0))] = {"new": node.get("new_count", 0),
                                        "learning": node.get("learn_count", 0),
                                        "review": node.get("review_count", 0)}
        for child in node.get("children", []):
            visit(child)
    visit(tree)
    result.pop("0", None)
    return result


def run(args):
    from srs import read_snapshot, canonical, digest, SRSError, partition_paths
    installed_version = importlib.metadata.version("anki")
    if not scheduling.anki_versions_match(installed_version, args.anki_version):
        raise SRSError(f"Installed Anki backend is {installed_version}; requested {args.anki_version}. "
                       "Update it from migration/: uv add --optional anki 'anki==" + args.anki_version + "'")
    manifest = json.loads((args.data / "manifest.json").read_text())
    if not scheduling.anki_versions_match(manifest.get("scheduling", {}).get("source_anki_version"), args.anki_version):
        raise SRSError("Store and verification backend versions differ; rerun migration with the source version")
    raw = read_snapshot(args.collection)
    cards = [c for p in partition_paths(manifest) for c in json.loads((args.data / p).read_text())]
    now = int(datetime.fromisoformat(args.at.replace("Z", "+00:00")).timestamp() * 1000) if args.at else int(time.time() * 1000)
    from google.protobuf.json_format import MessageToDict
    issues = []
    source_ids = {str(c["id"]) for c in raw["cards"]}
    imported_ids = {c["anki_card_id"] for c in cards if c.get("anki_card_id") and not c.get("retired")}
    if source_ids != imported_ids:
        issues.append({"kind": "snapshot-coverage", "missing_card_ids": sorted(source_ids - imported_ids),
                       "extra_card_ids": sorted(imported_ids - source_ids)})
    cases, references = [], {}
    with tempfile.TemporaryDirectory(prefix="srs-anki-verification-") as temporary:
        copy = Path(temporary) / "collection.anki2"
        shutil.copyfile(args.collection, copy)
        col = scheduling.open_native_collection(copy, manifest["timing"]["timezone"], now)
        try:
            # deck_tree(now=...) otherwise unburies using today's wall clock.
            # Restore only the reference day's buried cards with Anki's own API,
            # and suppress the separate wall-clock unbury pass on this copy.
            local = datetime.fromtimestamp(now / 1000, ZoneInfo(manifest["timing"]["timezone"]))
            study_date = local.date() - timedelta(days=int(local.hour < manifest["timing"]["rollover_hour"]))
            reference_day = (study_date - date.fromisoformat(manifest["timing"]["day_zero"])).days
            last_unburied = manifest["scheduling"]["collection"].get("lastUnburied") or 0
            if last_unburied < reference_day or reference_day + 7 < last_unburied:
                col.sched.unbury_cards([c["id"] for c in raw["cards"] if c["queue"] in (-2, -3)])
            col.set_config("lastUnburied", col.sched.today)
            tree = MessageToDict(col._backend.deck_tree(now=now // 1000), preserving_proto_field_name=True)
            counts = flat_tree(tree)
            native_count_cards = col.db.all("select id, did, queue, type, due from cards")
            native_today = col.sched.today
            native_next_day_at = col.sched.day_cutoff
            actual_now = int(time.time() * 1000)
            # Counts may refer to a different DST offset from today's answers.
            zone = ZoneInfo(manifest["timing"]["timezone"])
            if datetime.fromtimestamp(now / 1000, zone).utcoffset() != datetime.fromtimestamp(actual_now / 1000, zone).utcoffset():
                col.close()
                col = scheduling.open_native_collection(copy, manifest["timing"]["timezone"], actual_now)
            # The backend's state API has no timestamp parameter. Record its
            # real timestamp independently, instead of pretending it is frozen.
            # A supplied --at controls the count oracle precisely.
            for preset in manifest["scheduling"]["presets"]:
                decks = {d["id"] for d in manifest["scheduling"]["decks"].values()
                         if d["normal"].get("config_id", "1") == preset and not d["filtered"]}
                selected = {}
                for c in cards:
                    if c.get("deck_id") not in decks or not c.get("anki_card_id") or c["queue"] < 0:
                        continue
                    category = "new" if c["queue"] == 0 else "review" if c["queue"] == 2 else "relearning" if c["card_type"] == 3 else "learning"
                    selected.setdefault(category, c)
                for category in ("new", "learning", "review", "relearning"):
                    card = selected.get(category)
                    origin = "snapshot"
                    if not card:
                        card, options = fixture_representative(col, manifest["scheduling"], preset, category, actual_now)
                        origin = "synthetic_on_disposable_copy"
                    else:
                        options = scheduling.effective(manifest["scheduling"], card.get("original_deck_id") or card["deck_id"])
                    source = col.get_card(int(card["anki_card_id"]))
                    source.start_timer()
                    # Capture all four transitions from precisely the same state.
                    states = col._backend.get_scheduling_states(source.id)
                    input_state = card["baseline"]
                    if input_state is None:
                        memory = col._backend.compute_memory_state(source.id)
                        issues.append({"kind": "missing-saved-memory", "card_id": card["id"],
                                       "backend_memory": MessageToDict(memory, preserving_proto_field_name=True)})
                        continue
                    for rating, name in enumerate(("again", "hard", "good", "easy"), 1):
                        key = f"{preset}:{category}:{rating}"
                        next_state = MessageToDict(getattr(states, name), preserving_proto_field_name=True)
                        next_state["representative"] = origin
                        references[key] = next_state
                        cases.append({"id": key, "card": card, "state": input_state,
                                      "native_current_state": MessageToDict(states.current, preserving_proto_field_name=True),
                                      "options": options,
                                      "now": actual_now, "rating": rating})
                        # Exercise submission and complete resulting state as well,
                        # then undo to leave each answer on the same branch.
                        from anki.scheduler_pb2 import CardAnswer
                        answer = col.sched.build_answer(card=source, states=states,
                            rating=(CardAnswer.AGAIN, CardAnswer.HARD, CardAnswer.GOOD, CardAnswer.EASY)[rating - 1])
                        col.sched.answer_card(answer)
                        after = col.get_card(source.id)
                        references[key]["resulting_card"] = {k: getattr(after, k) for k in
                                                              ("due", "queue", "type", "ivl", "reps", "lapses", "left")}
                        col.undo()
        finally:
            col.close()
    process = subprocess.run([args.node, str(HERE / "verify-browser.cjs")],
                             input=json.dumps({"cards": cards, "manifest": manifest, "now": now, "transitions": cases}),
                             text=True, capture_output=True)
    if process.returncode:
        raise SRSError("Browser verification failed: " + process.stderr)
    # Some bundled FSRS versions log parameter conversion diagnostics to stdout.
    browser = json.loads(process.stdout[process.stdout.index('{'):])
    browser_counts = {}
    def visit(nodes):
        for node in nodes:
            browser_counts[node["id"]] = {k: node[k] for k in ("new", "learning", "review")}
            visit(node["children"])
    visit(browser["tree"])
    differences = []
    for did in sorted(counts.keys() | browser_counts.keys()):
        if counts.get(did) != browser_counts.get(did):
            differences.append({"deck_id": did, "name": manifest["scheduling"]["decks"].get(did, {}).get("name"),
                                "anki": counts.get(did), "reviewer": browser_counts.get(did)})
    scheduling_differences = []
    deterministic_differences = []
    fuzz_differences = []
    def memory_and_target(reference):
        normal = reference.get("normal", {})
        return normal.get("review") or normal.get("learning") or normal.get("relearning", {}).get("learning", {})
    for case in cases:
        options = case["options"]
        weight_count = len(options["weights"])
        decay = options["weights"][20] if weight_count == 21 else .5
        def deterministic(rating):
            ref = references[case["id"].rsplit(":", 1)[0] + f":{rating}"]
            memory = memory_and_target(ref).get("memory_state", {})
            stability = memory.get("stability", 0)
            factor = .9 ** (-1 / decay) - 1
            days = stability * (options["desired_retention"] ** (-1 / decay) - 1) / factor
            return min(options["maximum_interval"], max(1, math.floor(days + .5)))
        days = deterministic(case["rating"])
        if case["state"]["state"] == 2 and case["rating"] > 1:
            hard = deterministic(2)
            good = min(options["maximum_interval"], max(hard + 1, deterministic(3)))
            easy = min(options["maximum_interval"], max(good + 1, deterministic(4)))
            days = [0, hard, good, easy][case["rating"] - 1]
        elif case["rating"] == 4:
            days = min(options["maximum_interval"], max(deterministic(3) + 1, days))
        case["deterministic_days"] = days
    by_case = {c["id"]: c for c in cases}
    for result in browser["transitions"]:
        reference = references[result["id"]]
        if "error" in result:
            scheduling_differences.append(result)
            continue
        target = memory_and_target(reference)
        memory = target.get("memory_state", {})
        state = result["state"]
        expected_days = by_case[result["id"]]["deterministic_days"]
        if "scheduled_days" in target and state["scheduled_days"] != expected_days:
            deterministic_differences.append({"id": result["id"], "anki_memory_interval": expected_days,
                                              "reviewer": state["scheduled_days"]})
        mismatches = {k: {"anki": memory.get(k), "reviewer": state[k]} for k in ("stability", "difficulty")
                      if k not in memory or abs(memory[k] - state[k]) > max(1e-4, abs(memory[k]) * 2e-6)}
        if "scheduled_days" in target and target["scheduled_days"] != state["scheduled_days"]:
            mismatches["interval_days"] = {"anki": target["scheduled_days"], "reviewer": state["scheduled_days"],
                                           "reason": "Anki fuzz/load balancing and rating interval ordering may differ; deterministic reviewer disables fuzz"}
            fuzz_differences.append({"id": result["id"], **mismatches["interval_days"]})
        if "scheduled_secs" in target:
            # Interday learning stores a study-day due date, not a timestamp.
            seconds = state.get("scheduled_secs", round((state["due"] - by_case[result["id"]]["now"]) / 1000))
            if seconds != target["scheduled_secs"]:
                mismatches["learning_seconds"] = {"anki": target["scheduled_secs"], "reviewer": seconds}
        if mismatches:
            scheduling_differences.append({"id": result["id"], "differences": mismatches})
        resulting = reference["resulting_card"]
        state_fields = {"reps": state["reps"], "lapses": state["lapses"], "queue": state["queue"],
                        "type": 0 if state["state"] == 0 else 2 if state["state"] == 2 else 3 if state["state"] == 3 else 1}
        for field, value in state_fields.items():
            if resulting[field] != value:
                deterministic_differences.append({"id": result["id"], "field": field, "anki": resulting[field], "reviewer": value})
        if resulting["left"] % 1000 != state.get("remaining_steps", 0):
            deterministic_differences.append({"id": result["id"], "field": "remaining_steps",
                                              "anki": resulting["left"] % 1000, "reviewer": state.get("remaining_steps", 0)})
    vocab_checks = []  # No collection-specific reference counts.
    result = {"format_version": 2, "backend_version": installed_version,
              "counts_at_utc": datetime.fromtimestamp(now / 1000, timezone.utc).isoformat(),
              "answers_at_utc": datetime.fromtimestamp(actual_now / 1000, timezone.utc).isoformat(),
              "native_timing": {"today": native_today, "next_day_at": native_next_day_at,
                                "reviewer_reference_day": reference_day,
                                "timezone": manifest["timing"]["timezone"]},
              "snapshot_scheduling_digest": digest({"cards": [{k: v for k, v in c.items() if k != "data"} for c in raw["cards"]]}),
              "exact_counts_agree": not differences and not any(i["kind"] == "snapshot-coverage" for i in issues),
              "count_differences": differences, "issues": issues, "vocabulary_reference": vocab_checks,
              "scheduling_differences": scheduling_differences,
              "deterministic_differences": deterministic_differences,
              "fuzz_differences": fuzz_differences,
              "answer_transitions": references, "browser_transitions": browser["transitions"],
              "transition_inputs": [dict(c, card={k: c["card"].get(k) for k in
                                       ("id", "deck_id", "original_deck_id")}) for c in cases],
              "count_inputs": {"timing": manifest["timing"], "scheduling": manifest["scheduling"],
                               "native_today": native_today, "reference_day": reference_day,
                               "native_cards": native_count_cards,
                               "cards": [{k: c.get(k) for k in ("id", "anki_card_id", "deck_id", "queue",
                                          "card_type", "anki_due", "due_ms", "baseline", "retired", "scheduling")}
                                         for c in cards]} if differences else None,
              "limitations": ["Anki answer transitions use the recorded backend wall clock; --at fixes deck counts only.",
                              "Float32 memory calculations are compared with an explicit 0.0001 absolute / 0.000002 relative tolerance.",
                              "Anki fuzz/load balancing is retained in the oracle; reviewer intervals are deterministic."]}
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    # A different count or missing transition coverage always fails verification.
    memory_or_steps = [d for d in scheduling_differences if "error" in d or
                       any(k != "interval_days" for k in d.get("differences", {}))]
    print(f"Exact count agreement: {result['exact_counts_agree']}; {len(differences)} deck differences; "
          f"{len(memory_or_steps)} memory/step differences; {len(deterministic_differences)} deterministic differences; "
          f"{len(fuzz_differences)} fuzz/ordering differences; {len(issues)} diagnostics. Report: {args.output}")
    return 0 if result["exact_counts_agree"] and not issues and not memory_or_steps and not deterministic_differences else 2
