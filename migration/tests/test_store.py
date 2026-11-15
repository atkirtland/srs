from __future__ import annotations

import copy
from datetime import date, datetime, timezone, timedelta
import importlib.metadata
import json
from pathlib import Path
import sys
import os
import shutil
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import catalog
import scheduling
import sources
import srs
from anki.collection import Collection
from anki import deck_config_pb2


WEIGHTS = [0.4, 0.6, 2.4, 5.8, 4.9, 0.9, 0.8, 0.01, 1.5, 0.1, 0.9, 2.0, 0.1, 0.3, 1.6, 0.2, 2.9, 0.5, 0.6]


def fixture(root):
    os.environ["TZ"] = "UTC"
    __import__("time").tzset()
    path = root / "collection.anki2"
    col = Collection(str(path))
    col.db.execute("update col set crt=crt-172800")
    col.close()
    col = Collection(str(path))
    col.set_config("fsrs", True)
    col.set_config("rollover", 4)
    now = __import__("time").time()
    for i in range(6):
        did = col.decks.id(f"Parent::Preset{i}")
        preset = col.decks.get_config(1) if i == 0 else col.decks.add_config(f"Preset{i}")
        preset["fsrsParams5"] = [x * (1 + .005 * i) if j < 4 else x for j, x in enumerate(WEIGHTS)]
        preset["new"]["perDay"] = 7
        preset["rev"]["perDay"] = 50
        col.decks.update_config(preset)
        deck = col.decks.get(did)
        deck["conf"] = preset["id"]
        col.decks.save(deck)
        for category in (0, 1, 2, 3):
            note = col.new_note(col.models.current())
            note["Front"] = "PRIVATE QUESTION MUST NOT SURVIVE"
            note["Back"] = "PRIVATE ANSWER MUST NOT SURVIVE"
            col.add_note(note, did)
            cid = col.find_cards(f"nid:{note.id}")[0]
            card = col.get_card(cid)
            card.type = category
            card.queue = 0 if category == 0 else 2 if category == 2 else 1
            card.ivl = 5 if category else 0
            card.due = col.sched.today if category == 2 else int(now - 300) if category else 1
            card.left = 1 if category in (1, 3) else 0
            card.reps = 2 if category else 0
            card.lapses = 1 if category == 3 else 0
            col.update_card(card)
            if category:
                col.db.execute("update cards set data=? where id=?", '{"s":5,"d":7,"dr":0.9}', cid)
                col.db.execute("insert into revlog values (?,?,?,?,?,?,?,?,?)",
                               int((now - 5 * 86400) * 1000) + i * 10 + category, cid, 0, 3, 5, 3, 2500, 1200, 1)
    col.close()
    return path


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.collection = fixture(self.root)
        col = Collection(str(self.collection))
        self.day_zero = datetime.fromtimestamp(col.sched.day_cutoff, timezone.utc).date() - timedelta(days=col.sched.today + 1)
        col.close()
        self.raw = srs.read_snapshot(self.collection)
        self.config = json.loads((Path(__file__).resolve().parents[2] / "config.json").read_text())
        self.config["groups"] = {}
        self.exports = {"test": sources.Export("data/test.csv", "Basic", (
            sources.Field("Front", "front", sources.text), sources.Field("Back", "back", sources.text)))}
        self.model = next(m for m in srs.models_from_snapshot(self.raw).values() if m["name"] == "Basic")

    def tearDown(self):
        self.temp.cleanup()

    def build(self):
        return srs.build_export(self.raw, self.root, self.exports, copy.deepcopy(self.config),
                                self.day_zero, "UTC", 4, importlib.metadata.version("anki"))

    def test_all_cards_and_saved_states_survive_missing_sources(self):
        data = self.build()
        self.assertEqual(len(data["cards"]), 24)
        self.assertTrue(all(c["active"] for c in data["cards"]))
        learned = [c for c in data["cards"] if c["card_type"]]
        self.assertTrue(all(c["baseline"]["stability"] == 5 and c["baseline"]["difficulty"] == 7 for c in learned))
        self.assertTrue(all(c["baseline"]["reps"] == 2 for c in learned))
        self.assertTrue(all(c["baseline"]["last_review"] == c["history"][-1]["review_time_ms"] for c in learned))
        self.assertGreaterEqual(len(data["scheduling"]["presets"]), 6)

    def test_monthly_logs_idempotency_no_content_and_cleanup(self):
        data = self.build()
        destination = self.root / "store"
        root = srs.publish(data, destination)
        manifest = json.loads((destination / "manifest.json").read_text())
        payloads = {p.name: p.read_bytes() for p in (destination / "reviews").glob("*.jsonl")}
        self.assertEqual(sum(len(p.splitlines()) for p in payloads.values()), 18 + 24)
        srs.publish(self.build(), destination)
        self.assertEqual(payloads, {p.name: p.read_bytes() for p in (destination / "reviews").glob("*.jsonl")})
        for path in destination.rglob("*"):
            if path.is_file():
                text = path.read_text()
                self.assertNotIn("PRIVATE QUESTION", text)
                self.assertNotIn("PRIVATE ANSWER", text)
                self.assertFalse(path.name.startswith("history-"))
                self.assertNotEqual(path.name, "raw.json")
        for path in (destination / "reviews").glob("*.jsonl"):
            for line in path.read_text().splitlines():
                event = json.loads(line)
                if event["kind"] == "historical_review":
                    self.assertNotIn("state", event)
                    self.assertEqual(event["original_review"]["id"], int(event["anki_revlog_id"]))
        # A presentation edit keeps the card key, IDs, and historical logs.
        config = data["config"]
        config["groups"]["test"]["templates"][0]["front"] = "Edited: {{Front}}"
        regenerated = srs.generate_templates(self.raw, config, self.exports)
        self.assertEqual(regenerated["groups"]["test"]["templates"][0]["front"], "Edited: {{Front}}")

    def test_month_boundaries_and_rollover(self):
        data = self.build()
        for i, stamp in enumerate((1738367999999, 1738368000000)):
            data["observations"].append({"format_version": 2, "kind": "historical_review", "id": f"test-{i}",
                                         "review_time_ms": stamp, "card_id": None})
        with patch.object(catalog, "LOG_LIMIT", 1500):
            srs.publish(data, self.root / "store")
        files = list((self.root / "store/reviews").glob("*.jsonl"))
        self.assertTrue(any("2025-01" in p.name for p in files))
        self.assertTrue(any("2025-02" in p.name for p in files))
        self.assertTrue(any("-002.jsonl" in p.name for p in files))
        self.assertTrue(all(p.stat().st_size <= 1500 for p in files))

    def test_v1_upgrade_preserves_id_and_answer_logs(self):
        data = self.build()
        destination = self.root / "store"
        old = destination / "imports/old"
        old.mkdir(parents=True)
        card = copy.deepcopy(data["cards"][0])
        card["id"] = "preserved-uid"
        card.pop("history")
        (old / "cards.json").write_text(json.dumps([card]))
        (old / "raw.json").write_text("PRIVATE OLD CONTENT")
        (destination / "manifest.json").write_text(json.dumps({"format_version": 1,
            "collection_key": data["collection_key"], "import_id": "old-import-id",
            "partitions": ["imports/old/cards.json"]}))
        (destination / "reviews").mkdir()
        answer_path = destination / "reviews/real-device-answer.jsonl"
        answer_path.write_text("existing answer log\n")
        srs.publish(data, destination)
        manifest = json.loads((destination / "manifest.json").read_text())
        self.assertEqual(manifest["import_id"], "old-import-id")
        self.assertEqual(json.loads((destination / srs.partition_paths(manifest)[0]).read_text())[0]["id"], "preserved-uid")
        self.assertEqual(answer_path.read_text(), "existing answer log\n")
        self.assertFalse(old.exists())

    def test_parameter_provenance_and_source_version(self):
        data = self.build()
        preset = next(v for v in data["scheduling"]["presets"].values() if v["settings"]["fsrs_params_5"])
        self.assertEqual(len(preset["settings"]["fsrs_params_5"]), 19)
        effective = scheduling.effective(data["scheduling"], data["cards"][0]["deck_id"])
        self.assertEqual(effective["parameter_field"], "fsrs_params_5")
        self.assertEqual(len(effective["weights"]), 19)
        self.assertIsNone(scheduling.metadata(self.raw)["parameter_policy"])

    def test_compact_metadata_preserves_import_identity_and_old_device_logs(self):
        import uuid
        data = self.build()
        destination = self.root / "store"
        srs.publish(data, destination)
        manifest = json.loads((destination / "manifest.json").read_text())
        self.assertEqual(set(manifest), {"format_version", "import_id", "revision", "collection_key", "scheduling", "timing", "partition_count"})
        for preset in manifest["scheduling"]["presets"].values():
            self.assertEqual(set(preset), {"id", "settings"})
            self.assertEqual(len([k for k in preset["settings"] if k.startswith("fsrs_params_")]), 1)
        # Simulate a store written before metadata pruning and named devices.
        for preset in manifest["scheduling"]["presets"].values():
            preset.update(name="Unused native preset label", legacy_other={"unused": "x" * 10000})
            preset["settings"]["unused_native_setting"] = "x" * 10000
        manifest["scheduling"]["collection"]["localOffset"] = 999
        manifest["partitions"] = srs.partition_paths(manifest)
        manifest.pop("partition_count")
        (destination / "manifest.json").write_text(json.dumps(manifest))
        old_device = str(uuid.uuid5(uuid.NAMESPACE_URL, f"ankobs:import:{data['collection_key']}"))
        old_logs = {}
        for path in (destination / "reviews").glob("anki-*.jsonl"):
            events = [dict(json.loads(line), device_id=old_device) for line in path.read_text().splitlines()]
            old_path = path.with_name(old_device + path.name[len("anki"):])
            old_path.write_text("".join(json.dumps(event) + "\n" for event in events))
            path.unlink()
            old_logs[old_path] = old_path.read_bytes()
        (destination / "reviews/computer-2026-11.jsonl").write_text("existing answer\n")
        srs.publish(self.build(), destination)
        current = json.loads((destination / "manifest.json").read_text())
        self.assertEqual(current["import_id"], manifest["import_id"])
        self.assertFalse(list((destination / "reviews").glob("anki-*.jsonl")))
        self.assertTrue(all(path.read_bytes() == contents for path, contents in old_logs.items()))
        self.assertNotIn("unused_native_setting", (destination / "manifest.json").read_text())
        changed = self.build()
        changed["scheduling"]["presets"]["1"]["settings"]["desired_retention"] = .8
        with self.assertRaisesRegex(srs.SRSError, "baseline is blocked"):
            srs.publish(changed, destination)

    def test_settings_logs_survive_reimport_and_do_not_block_a_new_baseline(self):
        data = self.build()
        destination = self.root / "store"
        srs.publish(data, destination)
        previous = json.loads((destination / "manifest.json").read_text())
        card_id = data["cards"][0]["id"]
        event = {"format_version": 2, "kind": "card_settings", "id": "11111111-1111-4111-8111-111111111111",
                 "card_id": card_id, "device_id": "computer", "time_ms": 946684800000,
                 "changes": {"suspended": True, "tags": ["focused"]}}
        path = destination / "reviews/computer-2026-11.jsonl"
        text = json.dumps(event) + "\n"
        path.write_text(text)
        archived = destination / "scheduler-configs" / ("a" * 64 + ".json")
        archived.parent.mkdir()
        archived.write_text('{"scheduler_version":"retained","settings":{}}\n')
        archived_bytes = archived.read_bytes()
        srs.publish(self.build(), destination)
        self.assertEqual(path.read_text(), text)
        self.assertEqual(archived.read_bytes(), archived_bytes)
        changed = self.build()
        changed["scheduling"]["presets"]["1"]["settings"]["desired_retention"] = .8
        srs.publish(changed, destination)
        current = json.loads((destination / "manifest.json").read_text())
        self.assertNotEqual(previous["import_id"], current["import_id"])
        self.assertEqual(path.read_text(), text)
        self.assertEqual(archived.read_bytes(), archived_bytes)
        self.assertIn(card_id, [c["id"] for p in srs.partition_paths(current)
                              for c in json.loads((destination / p).read_text())])
        path.write_text(text + json.dumps({"format_version": 2, "kind": "answer"}) + "\n")
        with self.assertRaisesRegex(srs.SRSError, "baseline is blocked"):
            srs.publish(self.build(), destination)

    def test_native_backend_all_six_presets_and_four_states(self):
        node = os.environ.get("NODE") or shutil.which("node")
        if not node:
            self.skipTest("Node is needed only for desktop browser verification")
        import verification
        destination = self.root / "store"
        srs.publish(self.build(), destination)
        args = SimpleNamespace(collection=self.collection, data=destination, at=None,
                               anki_version=importlib.metadata.version("anki"), node=node, output=self.root / "verification.json")
        self.assertEqual(verification.run(args), 0)
        report = json.loads(args.output.read_text())
        self.assertTrue(report["exact_counts_agree"])
        self.assertFalse(report["deterministic_differences"])
        self.assertEqual(len(report["answer_transitions"]), 96)
        for difference in report["scheduling_differences"]:
            self.assertEqual(set(difference["differences"]), {"interval_days"})
        manifest = json.loads((destination / "manifest.json").read_text())
        partition = destination / srs.partition_paths(manifest)[0]
        partition.write_text(json.dumps(json.loads(partition.read_text())[1:]))
        self.assertEqual(verification.run(args), 2)
        report = json.loads(args.output.read_text())
        self.assertFalse(report["exact_counts_agree"])
        self.assertTrue(report["count_differences"])
        self.assertTrue(report["count_inputs"]["native_cards"])
        self.assertNotIn("source", report["transition_inputs"][0]["card"])

    def test_native_sub_point_one_stability_and_saved_last_review(self):
        node = os.environ.get("NODE") or shutil.which("node")
        if not node:
            self.skipTest("Node is needed only for desktop browser verification")
        import verification
        col = Collection(str(self.collection))
        try:
            for preset in col.decks.all_config():
                if preset.get("fsrsParams5"):
                    preset["fsrsParams5"][0] = .09347633
                    col.decks.update_config(preset)
            saved_time = int(__import__("time").time())
            for cid, payload in col.db.all("select id, data from cards where type != 0"):
                memory = json.loads(payload)
                memory["lrt"] = saved_time
                col.db.execute("update cards set data=? where id=?", json.dumps(memory), cid)
        finally:
            col.close()
        self.raw = srs.read_snapshot(self.collection)
        data = self.build()
        for card in data["cards"]:
            if card["card_type"]:
                self.assertEqual(card["baseline"]["last_review"], saved_time * 1000)
                self.assertNotEqual(card["baseline"]["last_review"], card["history"][-1]["review_time_ms"])
        destination = self.root / "store"
        srs.publish(data, destination)
        args = SimpleNamespace(collection=self.collection, data=destination, at=None,
                               anki_version=importlib.metadata.version("anki"), node=node,
                               output=self.root / "verification.json")
        self.assertEqual(verification.run(args), 0)
        report = json.loads(args.output.read_text())
        self.assertFalse(report["deterministic_differences"])
        self.assertTrue(all(set(d["differences"]) == {"interval_days"}
                            for d in report["scheduling_differences"]))

    def test_native_verification_uses_vault_timezone(self):
        node = os.environ.get("NODE") or shutil.which("node")
        if not node:
            self.skipTest("Node is needed only for desktop browser verification")
        import verification
        # Keep the collection's creation date in its original UTC offset while
        # running today's scheduling in New York (Anki's modern timing mode).
        col = Collection(str(self.collection))
        col.set_config("creationOffset", 0)
        col.close()
        self.raw = srs.read_snapshot(self.collection)
        data = srs.build_export(self.raw, self.root, self.exports, copy.deepcopy(self.config),
                                self.day_zero, "America/Chicago", 4, importlib.metadata.version("anki"))
        destination = self.root / "store"
        srs.publish(data, destination)
        args = SimpleNamespace(collection=self.collection, data=destination, at=None,
                               anki_version=importlib.metadata.version("anki"), node=node,
                               output=self.root / "verification.json")
        self.assertEqual(verification.run(args), 0)
        report = json.loads(args.output.read_text())
        native = report["native_timing"]
        self.assertEqual(native["today"], native["reviewer_reference_day"])
        from zoneinfo import ZoneInfo
        self.assertEqual(datetime.fromtimestamp(native["next_day_at"], ZoneInfo("America/Chicago")).hour, 4)

    def test_native_queue_rules_and_daily_overrides(self):
        node = os.environ.get("NODE") or shutil.which("node")
        if not node:
            self.skipTest("Node is needed only for desktop browser verification")
        import verification
        col = Collection(str(self.collection))
        today = col.sched.today
        col.set_config("applyAllParentLimits", True)
        col.set_config("lastUnburied", today - 1)
        parent = col.decks.get(col.decks.id("Parent"))
        parent.update(newLimit=2, reviewLimit=4, newToday=[today, 1], revToday=[today, 1])
        col.decks.save(parent)
        deck = col.decks.get(col.decks.id("Parent::Preset0"))
        deck.update(newLimitToday={"limit": 0, "today": today})
        col.decks.save(deck)
        ids = col.find_cards('deck:"Parent::Preset0"')
        col.db.execute("update cards set queue=-1 where id=?", ids[0])
        col.db.execute("update cards set queue=-3,type=2,due=? where id=?", today, ids[1])
        col.db.execute("update cards set queue=3,type=1,due=? where id=?", today, ids[2])
        col.db.execute("update cards set queue=1,due=? where id=?", int(__import__('time').time()) + 3600, ids[3])
        col.close()
        self.raw = srs.read_snapshot(self.collection)
        destination = self.root / "store"
        srs.publish(self.build(), destination)
        args = SimpleNamespace(collection=self.collection, data=destination, at=None,
                               anki_version=importlib.metadata.version("anki"), node=node, output=self.root / "verification.json")
        verification.run(args)
        report = json.loads(args.output.read_text())
        self.assertTrue(report["exact_counts_agree"], report["count_differences"])
        for offset in (-1, 2):
            args.at = (datetime.now(timezone.utc) + timedelta(days=offset)).isoformat()
            verification.run(args)
            report = json.loads(args.output.read_text())
            self.assertTrue(report["exact_counts_agree"], report["count_differences"])

    def test_native_reconstruction_only_when_saved_memory_is_absent(self):
        original = self.build()
        cid = next(c["anki_card_id"] for c in original["cards"] if c["card_type"] == 2)
        col = Collection(str(self.collection))
        col.db.execute("update cards set data='{}' where id=?", int(cid))
        col.close()
        self.raw = srs.read_snapshot(self.collection)
        data = self.build()
        target = next(c for c in data["cards"] if c["anki_card_id"] == cid)
        self.assertIsNone(target["baseline"])
        saved = {c["id"]: copy.deepcopy(c["baseline"]) for c in data["cards"] if c["baseline"]}
        before = self.collection.read_bytes()
        scheduling.reconstruct_missing(data, self.collection)
        self.assertEqual(self.collection.read_bytes(), before)
        self.assertIsNotNone(target["baseline"])
        self.assertEqual(target["memory_origin"], "native_historical_reconstruction")
        for card in data["cards"]:
            if card["id"] in saved:
                self.assertEqual(card["baseline"], saved[card["id"]])

    def test_card_partitions_remain_250_and_block_baseline_replacement_after_answers(self):
        data = self.build()
        first = data["cards"][0]
        for i in range(251 - len(data["cards"])):
            card = copy.deepcopy(first)
            card.update(id=f"extra-{i}", anki_card_id=f"extra-{i}")
            data["cards"].append(card)
        destination = self.root / "store"
        srs.publish(data, destination)
        manifest = json.loads((destination / "manifest.json").read_text())
        self.assertEqual(manifest["partition_count"], 2)
        self.assertEqual([len(json.loads((destination / p).read_text())) for p in srs.partition_paths(manifest)], [250, 1])
        (destination / "reviews/new-device-answer.jsonl").write_text("answer\n")
        data["cards"][0]["baseline"]["stability"] = 99
        with self.assertRaisesRegex(srs.SRSError, "baseline is blocked"):
            srs.publish(data, destination)


if __name__ == "__main__":
    unittest.main()
