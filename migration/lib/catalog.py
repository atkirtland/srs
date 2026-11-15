"""All-deck catalog and version 2 monthly event store."""
from __future__ import annotations

import json
import re
import shutil
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import scheduling
import _shared
from srs_tools.store import partition_paths

LOG_LIMIT = 32 * 1024 * 1024


def settings_only_log(path):
    """Settings survive a baseline replacement; answers still block it."""
    try:
        with path.open() as lines:
            for line in lines:
                if not line.strip():
                    continue
                event = json.loads(line)
                if not isinstance(event, dict) or event.get("format_version") != 2 or event.get("kind") != "card_settings":
                    return False
        return True
    except (ValueError, OSError):
        return False


def baseline_fingerprint(cards, timing, meta):
    from srs import digest
    return digest({"cards": [{k: v for k, v in card.items() if k in
                              ("id", "scheduling", "memory", "baseline")} for card in cards],
                   "timing": timing, "scheduling": scheduling.runtime_metadata(meta)})


def required_front_fields(template, fields):
    """Unconditional front fields are required; conditional sections stay optional."""
    required, stack = set(), []
    for marker, expression in re.findall(r"{{([#/^]?)([^{}]+)}}", template):
        if marker in ("#", "^"):
            stack.append(expression)
        elif marker == "/":
            if stack:
                stack.pop()
        elif not stack and expression.split(":")[-1] in fields:
            required.add(expression.split(":")[-1])
    return sorted(required)


def generate_templates(raw, config, exports):
    from srs import models_from_snapshot
    models = models_from_snapshot(raw)
    note_models = {n["id"]: n["mid"] for n in raw["notes"]}
    ordinals_by_model = defaultdict(set)
    for card in raw["cards"]:
        ordinals_by_model[note_models.get(card["nid"])].add(card["ord"])
    groups = config.setdefault("groups", {})
    for name, export in exports.items():
        templates = groups.setdefault(name, {"templates": []})["templates"]
        bindings = {(t["anki_notetype"], t["anki_ordinal"]) for t in templates}
        mapped_fields = {f.anki for f in export.fields}
        for model in models.values():
            fields = {f["name"] for f in model["flds"]}
            if export.notetype and model["name"] != export.notetype:
                continue
            if not export.notetype and not mapped_fields <= fields:
                continue
            ordinals = ordinals_by_model[model["id"]] | {t["ord"] for t in model["tmpls"]}
            for ordinal in sorted(ordinals):
                if (model["name"], ordinal) in bindings:
                    continue
                source = next((t for t in model["tmpls"] if t["ord"] == ordinal), next(iter(model["tmpls"]), {}))
                key = f"anki-{model['id']}-{ordinal}"
                templates.append({"key": key, "enabled": True, "anki_notetype": model["name"],
                                  "anki_ordinal": ordinal, "required_fields": required_front_fields(source.get("qfmt", ""), mapped_fields),
                                  "front": source.get("qfmt", ""), "back": source.get("afmt", "")})
                bindings.add((model["name"], ordinal))
    return config


def build_export(raw, vault, exports, config, day_zero, timezone_name, rollover=4, source_anki_version=None):
    from srs import card_uid, models_from_snapshot, normalize_due, note_uid, interval, SRSError
    import sources
    config = generate_templates(raw, config, exports)
    meta = scheduling.metadata(raw, source_anki_version)
    models = models_from_snapshot(raw)
    notes = {str(n["id"]): n for n in raw["notes"]}
    collection = str(raw["col"][0]["crt"])
    snapshot_ms = raw["col"][0]["mod"]
    history = defaultdict(list)
    for row in sorted(raw["revlog"], key=lambda x: x["id"]):
        history[str(row["cid"])].append({
            "format_version": 2, "kind": "historical_review", "id": f"anki:{collection}:{row['id']}",
            "collection_key": collection, "anki_revlog_id": str(row["id"]), "anki_card_id": str(row["cid"]),
            "review_time_ms": row["id"], "rating": row["ease"], "duration_ms": row["time"],
            "review_type": row["type"], "interval": interval(row["ivl"]),
            "previous_interval": interval(row["lastIvl"]), "original_review": row})
    linked = {}
    problems = []
    for group, export in exports.items():
        try:
            loaded = sources.source_notes(vault, export)
        except (sources.ExportError, OSError) as error:
            problems.append({"kind": "source", "group": group, "message": str(error)})
            continue
        for note in loaded:
            try:
                identity = note_uid(note.metadata)
                if not identity:
                    continue
                path = Path(str(note.path).split("#row-")[0]).resolve().relative_to(vault.resolve()).as_posix()
                spec = {"path": path, "kind": "csv" if path.endswith(".csv") else "markdown",
                        "prepare": export.prepare_notes.__name__ if export.prepare_notes else None,
                        "fields": [{"anki": f.anki, "source": f.source, "transform": f.transform.__name__,
                                    "required": f.required, "missing_source": f.missing_source} for f in export.fields]}
                key = (group, identity)
                if key in linked:
                    spec["error"] = f"Duplicate source identity {identity}"
                linked[key] = spec
            except ValueError as error:
                problems.append({"kind": "identity", "message": str(error)})
    import block_notes
    cards_by_note = defaultdict(list)
    for card in raw["cards"]:
        cards_by_note[str(card["nid"])].append(card)
    for block in block_notes.scan(vault):
        nid = str(block.note_id)
        model = models.get(notes.get(nid, {}).get("mid"), {})
        definition = config["groups"].setdefault("markdown-blocks", {"templates": []})
        for anki_card in cards_by_note[nid]:
            ordinal = anki_card["ord"]
            if any(t["anki_notetype"] == model.get("name") and t["anki_ordinal"] == ordinal for t in definition["templates"]):
                continue
            template = next((t for t in model.get("tmpls", []) if t["ord"] == ordinal), {})
            definition["templates"].append({"key": f"anki-{model.get('id')}-{ordinal}", "enabled": True,
                                           "anki_notetype": model.get("name"), "anki_ordinal": ordinal,
                                           "required_fields": ["Front", "Back"], "front": template.get("qfmt", "{{Front}}"),
                                           "back": template.get("afmt", "{{Back}}")})
        linked[("markdown-blocks", f"anki:{nid}")] = {"path": block.path.relative_to(vault.resolve()).as_posix(),
            "kind": "block", "fields": [{"anki": "Front", "source": "$front", "transform": "text", "required": True},
                                          {"anki": "Back", "source": "$back", "transform": "text", "required": True}]}
    cards = []
    for card in raw["cards"]:
        nid, cid = str(card["nid"]), str(card["id"])
        identity = f"anki:{nid}"
        model = models.get(notes.get(nid, {}).get("mid"), {})
        deck = meta["decks"].get(str(card["did"]), {})
        candidates = []
        if ("markdown-blocks", identity) in linked:
            candidates.append((4, "markdown-blocks"))
        for group, export in exports.items():
            if (group, identity) in linked:
                candidates.append((3, group))
            elif deck.get("name") in export.candidate_decks:
                candidates.append((2, group))
            elif export.notetype == model.get("name"):
                candidates.append((1, group))
        candidates.sort(reverse=True)
        group = candidates[0][1] if candidates and (len(candidates) == 1 or candidates[0][0] > candidates[1][0]) else None
        template = next((t for t in config["groups"].get(group, {}).get("templates", [])
                         if t["anki_notetype"] == model.get("name") and t["anki_ordinal"] == card["ord"]), None)
        source = linked.get((group, identity))
        if not source and group:
            export = exports[group]
            paths = [export.notes_directory] if isinstance(export.notes_directory, str) else list(export.notes_directory)
            source = {"candidates": paths, "kind": "unresolved", "fields": [
                {"anki": f.anki, "source": f.source, "transform": f.transform.__name__,
                 "required": f.required, "missing_source": f.missing_source} for f in export.fields]}
            if len(paths) == 1 and paths[0].endswith(".csv"):
                source.update(path=paths[0], kind="csv")
        due = normalize_due(dict(card, queue=card["queue"] if card["queue"] >= 0 else
                                  0 if card["type"] == 0 else 2 if card["type"] == 2 else 1,
                                  odid=0), day_zero, ZoneInfo(timezone_name), rollover)
        settings = scheduling.effective(meta, card.get("odid") or card["did"])
        state = scheduling.saved_state(card, history[cid], due, settings, snapshot_ms)
        # Keep the original fallback identity for previously unmapped cards.
        uid = card_uid(group, identity, template["key"]) if template and group else f"anki:{collection}:card:{cid}"
        cards.append({"id": uid, "anki_card_id": cid, "note_uid": identity, "group": group,
                      "deck_id": str(card["did"]), "original_deck_id": str(card["odid"]) if card.get("odid") else None,
                      "anki_notetype": model.get("name"), "anki_ordinal": card["ord"],
                      "template_key": template["key"] if template else None, "source": source,
                      "active": True, "supported": True, "queue": card["queue"], "card_type": card["type"],
                      "due_ms": due, "anki_due": card["due"], "baseline": state,
                      "memory_origin": "saved" if state else "missing",
                      "scheduling": {k: card[k] for k in ("due", "ivl", "factor", "reps", "lapses", "left", "odue", "odid", "queue", "type")},
                      "memory": {k: v for k, v in json.loads(card.get("data") or "{}").items() if k in ("s", "d", "dr", "decay", "lrt")},
                      "history": history[cid]})
    card_by_cid = {c["anki_card_id"]: c for c in cards}
    observations = []
    for cid, events in history.items():
        # Deleted-card observations still belong in the immutable imported log.
        for event in events:
            event["card_id"] = card_by_cid[cid]["id"] if cid in card_by_cid else None
            observations.append(event)
    for (group, identity), source in linked.items():
        if not identity.startswith("local:"):
            continue
        export = exports[group]
        deck = next((d for d in meta["decks"].values() if d["name"] == export.destination_deck), None)
        if not deck:
            problems.append({"kind": "local-deck", "group": group, "message": "No destination deck for local note"})
            continue
        for template in config["groups"][group]["templates"]:
            state = {"due": snapshot_ms, "queue": 0, "state": 0, "stability": 0, "difficulty": 0,
                     "reps": 0, "lapses": 0, "elapsed_days": 0, "scheduled_days": 0, "learning_steps": 0}
            cards.append({"id": card_uid(group, identity, template["key"]), "anki_card_id": None, "note_uid": identity,
                          "group": group, "deck_id": deck["id"], "original_deck_id": None, "queue": 0, "card_type": 0,
                          "anki_notetype": template["anki_notetype"], "anki_ordinal": template["anki_ordinal"],
                          "template_key": template["key"], "source": source, "baseline": state, "active": True,
                          "supported": True, "due_ms": None, "anki_due": 0, "scheduling": {"queue": 0}, "memory": {}, "history": []})
    return {"format_version": 2, "collection_key": collection, "snapshot_ms": snapshot_ms,
            "timing": {"day_zero": day_zero.isoformat(), "timezone": timezone_name, "rollover_hour": rollover},
            "scheduling": meta, "cards": cards, "observations": observations,
            "lookups": {"us_states": sources.US_STATES_BY_SLUG},
            "config": config, "report": {"notes": len(notes), "cards": len(cards), "review_events": len(observations),
                                          "issues": [], "content_problems": problems,
                                          "verification": "unverified: run verify against the complete snapshot and source Anki version"}}


def publish(data, destination):
    from srs import canonical, digest, write_immutable, SRSError
    destination.mkdir(parents=True, exist_ok=True)
    pointer = destination / "manifest.json"
    previous = json.loads(pointer.read_text()) if pointer.exists() else None
    old_roots = []
    if previous:
        if previous["collection_key"] != data["collection_key"]:
            raise SRSError("cannot mix collections")
        from srs_tools.study import load_cards
        _, old_cards = load_cards(destination)
        by_anki = {c.get("anki_card_id"): c for c in old_cards if c.get("anki_card_id")}
        remap = {}
        for card in data["cards"]:
            old = by_anki.get(card.get("anki_card_id"))
            if old:
                remap[card["id"]] = old["id"]
                card["id"] = old["id"]
        for event in data["observations"]:
            event["card_id"] = remap.get(event["card_id"], event["card_id"])
        new_ids = {c["id"] for c in data["cards"]}
        for card in old_cards:
            if card["id"] not in new_ids:
                previous_card = {k: v for k, v in card.items() if k not in {"history_path", "raw", "fields", "template"}}
                previous_card.update(queue=-1, active=False, retired=True)
                previous_card.setdefault("baseline", None)
                previous_card.setdefault("scheduling", {"queue": -1})
                data["cards"].append(previous_card)
        old_roots = list((destination / "imports").iterdir())
    data["scheduling"] = scheduling.runtime_metadata(data["scheduling"])
    baseline_digest = baseline_fingerprint(data["cards"], data["timing"], data["scheduling"])
    # Preserve existing answer import identity during the one-time archive upgrade.
    import_id = previous["import_id"] if previous and previous["format_version"] == 1 else baseline_digest
    if previous and previous["format_version"] == 2:
        import_id = previous["import_id"]
        previous_digest = baseline_fingerprint(old_cards, previous["timing"], previous["scheduling"])
        if previous_digest != baseline_digest:
            new_reviews = [p for p in (destination / "reviews").glob("*.jsonl")
                           if not any(p.name.startswith(prefix + "-") for prefix in
                                      ("anki", str(uuid.uuid5(uuid.NAMESPACE_URL, f"ankobs:import:{data['collection_key']}"))))]
            if any(not settings_only_log(path) for path in new_reviews):
                raise SRSError("new answers exist: changing the scheduling baseline is blocked")
            import_id = baseline_digest
    device = "anki"
    old_device = str(uuid.uuid5(uuid.NAMESPACE_URL, f"ankobs:import:{data['collection_key']}"))
    revision = digest({"baseline": baseline_digest, "cards": [
        {k: v for k, v in c.items() if k != "history"} for c in data["cards"]]})
    root = destination / "imports" / revision
    from srs_tools import layout
    config_directory = destination.parent / 'config'
    normalized = (config_directory / 'sources.json').exists()
    notes, stored_cards = layout.separate_cards(data['cards']) if normalized else ([], data['cards'])
    if normalized:
        for start in range(0, len(notes), 250):
            write_immutable(root / f'notes-{start//250:05d}.json', notes[start:start+250])
    partitions = []
    events = list(data["observations"])
    for index in range(0, len(data["cards"]), 250):
        selected = data["cards"][index:index + 250]
        name = f"cards-{index // 250:05d}.json"
        runtime = [{k: v for k, v in c.items() if k != "history"} for c in stored_cards[index:index+250]]
        write_immutable(root / name, runtime)
        partitions.append(f"imports/{revision}/{name}")
        for card in selected:
            events.append({"format_version": 2, "kind": "scheduling_baseline",
                           "id": f"baseline:{import_id}:{card['id']}", "card_id": card["id"],
                           "review_time_ms": data["snapshot_ms"], "import_id": import_id,
                           "state": card["baseline"], "scheduling": card["scheduling"]})
    # Reimports compare immutable records, including duplicates in conflict copies.
    seen = {}
    reviews = destination / "reviews"
    reviews.mkdir(exist_ok=True)
    for path in sorted(set(reviews.glob(f"{device}-*.jsonl")) | set(reviews.glob(f"{old_device}-*.jsonl"))):
        contents = path.read_text()
        if contents and not contents.endswith("\n"):
            raise SRSError(f"incomplete imported log: {path}")
        for line in contents.splitlines():
            event = json.loads(line)
            if event["id"] in seen and seen[event["id"]] != event:
                raise SRSError(f"conflicting imported event {event['id']}")
            seen[event["id"]] = event
    buffers = {}
    for event in sorted(events, key=lambda e: (e["review_time_ms"], e["id"])):
        event["device_id"] = device
        if event["id"] in seen:
            # Names replace device UUIDs for new records only. Compare against
            # the original writer identity without mutating old log lines.
            existing = seen[event["id"]]
            if existing != dict(event, device_id=existing["device_id"]):
                raise SRSError(f"imported observation changed: {event['id']}")
            continue
        month = datetime.fromtimestamp(event["review_time_ms"] / 1000, timezone.utc).strftime("%Y-%m")
        line = (canonical(event) + "\n").encode("utf-8")
        if len(line) > LOG_LIMIT:
            raise SRSError("imported event exceeds the 32 MiB log limit")
        part = 1
        while True:
            suffix = "" if part == 1 else f"-{part:03d}"
            path = reviews / f"{device}-{month}{suffix}.jsonl"
            size = len(buffers.get(path, b"")) + (path.stat().st_size if path.exists() else 0)
            if size + len(line) <= LOG_LIMIT:
                buffers.setdefault(path, bytearray()).extend(line)
                break
            part += 1
        seen[event["id"]] = event
    for path, payload in buffers.items():
        with path.open("ab") as stream:
            stream.write(payload)
            stream.flush()
            import os
            os.fsync(stream.fileno())
    manifest = {"format_version": 2, "import_id": import_id,
                "revision": revision, "collection_key": data["collection_key"], "scheduling": data["scheduling"],
                "timing": data["timing"], "partition_count": len(partitions)}
    if normalized:
        manifest['note_partition_count'] = (len(notes)+249)//250
    write_immutable(root / "report.json", data["report"])
    # Validate all metadata and logs before the atomic pointer switch and cleanup.
    for partition in partitions:
        parsed = json.loads((destination / partition).read_text())
        if len(parsed) > 250 or any("fields" in c or "raw" in c or "history" in c for c in parsed):
            raise SRSError("invalid runtime metadata partition")
    temporary = destination / "manifest.pending"
    temporary.write_text(canonical(manifest) + "\n")
    temporary.replace(pointer)
    for old in old_roots:
        if old != root and old.is_dir():
            shutil.rmtree(old)
    return root
