"""Scheduling metadata only. No note fields are retained in this module's output."""
from __future__ import annotations

import base64
import json
import re
from datetime import datetime, timedelta


def configure_timezone(name):
    """Give libc and the native backend the same tzdata as Python's ZoneInfo.

    Isolated uv environments may lack /usr/share/zoneinfo. A bare IANA TZ name
    silently becomes UTC in libc there, even though Python's tzdata works.
    """
    import os
    import time
    from datetime import datetime
    from importlib.resources import files
    from zoneinfo import ZoneInfo
    zone = ZoneInfo(name)
    resource = files("tzdata.zoneinfo").joinpath(*name.split("/"))
    os.environ["TZ"] = ":" + str(resource) if resource.is_file() else name
    if hasattr(time, "tzset"):
        time.tzset()
        stamp = time.time()
        native_wall = time.localtime(stamp)[:6]
        wall = datetime.fromtimestamp(stamp, zone)
        if native_wall != (wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second):
            raise ValueError(f"Native timezone setup failed for {name}; refusing UTC fallback")


def open_native_collection(path, timezone_name, timestamp_ms=None):
    """Pin Anki's user offset instead of trusting the host's cached local zone."""
    import time
    from zoneinfo import ZoneInfo
    configure_timezone(timezone_name)
    from anki.collection import Collection
    stamp = time.time() if timestamp_ms is None else timestamp_ms / 1000
    offset = datetime.fromtimestamp(stamp, ZoneInfo(timezone_name)).utcoffset()
    # The headless/server backend uses this setting for exactly the same native
    # scheduling calculations, without replacing it with the machine's zone.
    col = Collection(str(path), server=True)
    try:
        col.set_config("localOffset", -int(offset.total_seconds() / 60))
    except Exception:
        col.close()
        raise
    return col


def anki_versions_match(installed, requested):
    """Compare release numbers, preserving prerelease/build suffix distinctions.

    Anki's wheel metadata can retain a date-style zero (`26.09.4`) while uv
    displays the normalized release (`26.9.4`). No dependency change is needed.
    """
    def key(value):
        if not isinstance(value, str):
            return None
        match = re.fullmatch(r"(\d+(?:\.\d+)*)(.*)", value.strip())
        if not match:
            return None
        release = [int(part) for part in match[1].split(".")]
        while len(release) > 1 and release[-1] == 0:
            release.pop()
        return tuple(release), match[2].lower()
    left, right = key(installed), key(requested)
    return left is not None and left == right


def blob(value):
    return base64.b64decode(value["base64"]) if isinstance(value, dict) else value


def runtime_metadata(meta):
    """Keep only settings consumed by scheduling/counts, not native archives."""
    presets = {}
    for key, preset in meta["presets"].items():
        settings = preset["settings"]
        fields = ("desired_retention", "maximum_review_interval", "minimum_lapse_interval",
                  "learn_steps", "relearn_steps", "new_per_day", "reviews_per_day")
        selected = {k: settings[k] for k in fields if k in settings}
        parameter = next((k for k in ("fsrs_params_6", "fsrs_params_5", "fsrs_params_4")
                          if settings.get(k)), None)
        if parameter:
            selected[parameter] = settings[parameter]
        presets[key] = {"id": preset["id"], "settings": selected}
    decks = {}
    for key, deck in meta["decks"].items():
        normal_fields = ("config_id", "desired_retention", "new_limit", "review_limit",
                         "new_limit_today", "review_limit_today")
        decks[key] = {k: deck[k] for k in ("id", "name", "parent_id", "filtered")}
        decks[key]["normal"] = {k: v for k, v in deck["normal"].items() if k in normal_fields}
        decks[key]["common"] = {k: v for k, v in deck["common"].items()
                                  if k in ("last_day_studied", "new_studied", "review_studied")}
    flags = ("collapseTime", "applyAllParentLimits", "newCardsIgnoreReviewLimit",
             "lastUnburied", "fsrsShortTermWithStepsEnabled")
    return {"presets": presets, "decks": decks,
            "collection": {k: v for k, v in meta["collection"].items() if k in flags},
            "source_anki_version": meta["source_anki_version"],
            "parameter_policy": meta["parameter_policy"]}


def metadata(raw, backend_version=None):
    # Decode with Anki's own published schema; parameter precedence is explicit.
    from anki import deck_config_pb2, decks_pb2
    from google.protobuf.json_format import MessageToDict

    presets = {}
    for row in raw.get("deck_config", []):
        msg = deck_config_pb2.DeckConfig.Config.FromString(blob(row["config"]))
        settings = MessageToDict(msg, preserving_proto_field_name=True,
                                 always_print_fields_with_no_presence=True)
        other = json.loads(msg.other or b"{}")
        # Legacy clients store unknown settings in `other`. Keep them separately:
        # the source Anki version, not the vector length, determines precedence.
        settings.pop("other", None)
        presets[str(row["id"])] = {"id": str(row["id"]), "name": row["name"],
                                    "settings": settings, "legacy_other": other}
    decks = {}
    for row in raw.get("decks", []):
        kind = decks_pb2.Deck.KindContainer.FromString(blob(row["kind"]))
        common = decks_pb2.Deck.Common.FromString(blob(row["common"]))
        name = row["name"].replace("\x1f", "::")
        normal = MessageToDict(kind.normal, preserving_proto_field_name=True)
        normal.pop("description", None)
        normal.pop("markdown_description", None)
        decks[str(row["id"])] = {
            "id": str(row["id"]), "name": name, "normal": normal,
            "filtered": kind.WhichOneof("kind") == "filtered",
            "common": {key: getattr(common, key) for key in
                       ("last_day_studied", "new_studied", "review_studied", "learning_studied")},
        }
    by_name = {d["name"]: d["id"] for d in decks.values()}
    for deck in decks.values():
        deck["parent_id"] = by_name.get(deck["name"].rsplit("::", 1)[0]) if "::" in deck["name"] else None
    conf = {r["KEY"]: json.loads(blob(r["val"])) for r in raw.get("config", [])}
    result = {"presets": presets, "decks": decks,
              "collection": {key: conf.get(key) for key in
                             ("fsrs", "collapseTime", "applyAllParentLimits", "newCardsIgnoreReviewLimit",
                              "lastUnburied", "creationOffset", "localOffset", "fsrsShortTermWithStepsEnabled",
                              "loadBalancerEnabled", "cardStateCustomizer")},
              "source_anki_version": backend_version,
              "parameter_policy": f"anki-native/{backend_version}" if backend_version else None}
    return runtime_metadata(result)


def effective(meta, deck_id):
    deck = meta["decks"][str(deck_id)]
    preset = meta["presets"].get(str(deck["normal"].get("config_id", "1")))
    if not preset:
        raise ValueError(f"Missing preset for deck {deck_id}")
    settings = preset["settings"]
    field = next((f for f in ("fsrs_params_6", "fsrs_params_5", "fsrs_params_4") if settings.get(f)), None)
    return {"algorithm": "FSRS-6", "weights": settings.get(field, []), "parameter_field": field,
            "parameter_policy": meta["parameter_policy"], "preset_id": preset["id"],
            "desired_retention": deck["normal"].get("desired_retention", settings["desired_retention"]),
            "maximum_interval": settings["maximum_review_interval"],
            "minimum_interval": settings["minimum_lapse_interval"],
            "learning_steps": settings["learn_steps"], "relearning_steps": settings["relearn_steps"],
            "new_cards_per_day": settings["new_per_day"], "enable_fuzz": False,
            "source_anki_version": meta["source_anki_version"],
            "short_term_with_steps": bool(meta["collection"].get("fsrsShortTermWithStepsEnabled"))}


def reconstruct_missing(data, collection):
    """Use the explicitly selected native backend only for absent saved memory."""
    import shutil
    import tempfile
    from pathlib import Path
    missing = [c for c in data["cards"] if c.get("baseline") is None and c.get("anki_card_id")]
    if not missing:
        return
    with tempfile.TemporaryDirectory(prefix="srs-memory-") as directory:
        path = Path(directory) / "collection.anki2"
        shutil.copyfile(collection, path)
        col = open_native_collection(path, data["timing"]["timezone"])
        try:
            for card in missing:
                try:
                    response = col._backend.compute_memory_state(int(card["anki_card_id"]))
                    if not response.HasField("state"):
                        raise ValueError("native reconstruction returned no memory state")
                    memory = {"s": response.state.stability, "d": response.state.difficulty,
                              "decay": response.decay, "dr": response.desired_retention}
                    if "lrt" in card.get("memory", {}):
                        memory["lrt"] = card["memory"]["lrt"]
                    native = dict(card["scheduling"], data=json.dumps(memory))
                    card["baseline"] = saved_state(native, card["history"], card["due_ms"],
                                                    effective(data["scheduling"], card.get("original_deck_id") or card["deck_id"]),
                                                    data["snapshot_ms"])
                    card["memory"] = memory
                    card["memory_origin"] = "native_historical_reconstruction"
                except Exception as error:
                    data["report"]["content_problems"].append({"kind": "memory-reconstruction", "card_id": card["id"],
                                                              "message": str(error)})
        finally:
            col.close()


def saved_state(card, history, due_ms, settings, snapshot_ms):
    data = json.loads(card.get("data") or "{}")
    state = {"due": due_ms if due_ms is not None else snapshot_ms,
             "stability": data.get("s", 0), "difficulty": data.get("d", 0),
             "elapsed_days": 0, "scheduled_days": card["ivl"], "reps": card["reps"],
             "lapses": card["lapses"], "learning_steps": 0,
             "state": 0 if card["type"] == 0 else 3 if card["type"] == 3 else 2 if card["type"] == 2 else 1,
             "queue": card["queue"], "anki_due": card["due"], "remaining_steps": card["left"] % 1000}
    if card["queue"] in (1, 3) and card["type"] == 2:
        state["state"] = 1
    steps = settings["relearning_steps"] if card["type"] == 3 else settings["learning_steps"]
    state["learning_steps"] = max(0, len(steps) - card["left"] % 1000) if card["queue"] in (1, 3) else 0
    answers = [h for h in history if h["rating"] in (1, 2, 3, 4) and h["review_type"] in (0, 1, 2, 3)]
    # Recent Anki versions save the scheduler's last-review timestamp directly.
    # It can differ from revlog after rescheduling or history edits.
    if isinstance(data.get("lrt"), (int, float)):
        state["last_review"] = int(data["lrt"] * 1000)
    elif answers:
        state["last_review"] = answers[-1]["review_time_ms"]
    if card["type"] == 0 or (data.get("s") and data.get("d")):
        return state
    # Leave reconstruction to the per-preset engine; never invent a memory state.
    return None
