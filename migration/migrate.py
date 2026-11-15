#!/usr/bin/env python3
"""Inspect a snapshot, migrate reviews, seed local CSV IDs, or install the view."""
from __future__ import annotations

import argparse
from datetime import date
import json
from pathlib import Path
import shutil
import sqlite3
import sys
from zoneinfo import ZoneInfoNotFoundError

HERE = Path(__file__).resolve().parent
ROOT = HERE if (HERE / "lib/srs.py").is_file() else HERE.parent
PORTABLE = ROOT.parent if ROOT.name == "migration" and (ROOT.parent / "config.json").is_file() else None
sys.path.insert(0, str(ROOT / "lib"))

import srs
import sources


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect", help="read collection metadata and existing templates")
    inspect.add_argument("--collection", type=Path, required=True)
    inspect.add_argument("--output", type=Path)
    migrate = commands.add_parser("migrate", help="archive history and generate configured cards")
    migrate.add_argument("--collection", type=Path, required=True)
    migrate.add_argument("--vault", type=Path, default=PORTABLE.parent if PORTABLE else None)
    migrate.add_argument("--config", type=Path)
    migrate.add_argument("--output", type=Path, help="default: <vault>/ankobs-srs/data")
    migrate.add_argument("--timezone", required=True, help="Anki scheduling timezone, e.g. America/Chicago")
    migrate.add_argument("--day-zero", type=date.fromisoformat, required=True,
                         help="local calendar date corresponding to Anki scheduler day zero (YYYY-MM-DD)")
    migrate.add_argument("--rollover-hour", type=int, choices=range(24), default=4)
    migrate.add_argument("--anki-version", required=True, help="exact source desktop Anki version (install the same anki package)")
    verify = commands.add_parser("verify", help="compare every deck and representative transitions with a disposable Anki copy")
    verify.add_argument("--collection", type=Path, required=True)
    verify.add_argument("--data", type=Path, default=PORTABLE / "data" if PORTABLE else None)
    verify.add_argument("--anki-version", required=True)
    verify.add_argument("--at", help="fixed UTC ISO timestamp; defaults to command start")
    verify.add_argument("--node", default="node", help="desktop JS executable; never needed for reviewing")
    verify.add_argument("--output", type=Path, default=HERE / "verification.json")
    install = commands.add_parser("install-view", help="copy the prebuilt portable view into the vault")
    install.add_argument("--vault", type=Path, required=True)
    seed = commands.add_parser("seed-csv-uids", help="assign UUIDs to Obsidian-only CSV notes")
    seed.add_argument("csv", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "seed-csv-uids":
            print(f"Assigned {srs.seed_csv_uids(args.csv)} local note identities")
        elif args.command == "install-view":
            package = PORTABLE or ROOT / "ankobs-srs"
            if not (package / "view.js").is_file():
                raise srs.SRSError("build the portable directory first: npm ci && npm run build:srs")
            destination = args.vault / "ankobs-srs"
            if package.resolve() != destination.resolve():
                for source in package.rglob("*"):
                    if not source.is_file() or any(part in {"__pycache__", ".venv", "data"} for part in source.relative_to(package).parts):
                        continue
                    target = destination / source.relative_to(package)
                    # Editable configuration belongs to the vault owner.
                    if target.exists() and (source.name == "config.json" or "config" in source.relative_to(package).parts):
                        continue
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(source, target)
            print(f"Installed portable SRS directory: {destination}")
        elif args.command == "inspect":
            raw = srs.read_snapshot(args.collection)
            result = {"collection": raw["col"], "models": srs.models_from_snapshot(raw),
                      "counts": {key: len(raw[key]) for key in ("notes", "cards", "revlog")}}
            content = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
            if args.output:
                args.output.write_text(content, encoding="utf-8")
            else:
                print(content, end="")
        elif args.command == "verify":
            import verification
            return verification.run(args)
        else:
            if args.vault is None:
                raise srs.SRSError("--vault is required outside the portable vault directory")
            portable = PORTABLE or args.vault / "ankobs-srs"
            config_path = args.config or (portable / "config.json" if (portable / "config.json").is_file() else ROOT / "config/srs.json")
            config = srs.load_config(config_path, sources.EXPORTS)
            import importlib.metadata
            import scheduling
            installed_version = importlib.metadata.version("anki")
            if not scheduling.anki_versions_match(installed_version, args.anki_version):
                raise srs.SRSError(f"Installed Anki backend is {installed_version}; requested {args.anki_version}. "
                                   "Update the managed backend from migration/: uv add 'anki==" + args.anki_version + "'")
            data = srs.build_export(srs.read_snapshot(args.collection), args.vault, sources.EXPORTS,
                                    config, args.day_zero, args.timezone, args.rollover_hour, installed_version)
            scheduling.reconstruct_missing(data, args.collection)
            destination = args.output or portable / "data"
            imported = srs.publish(data, destination)
            config_path.write_text(json.dumps(data["config"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(json.dumps({key: value for key, value in data["report"].items() if key != "models"}, indent=2))
            print(f"Archived import and report: {imported}")
            return 2 if data["report"]["issues"] else 0
        return 0
    except (ValueError, OSError, sqlite3.Error, ZoneInfoNotFoundError, sources.ExportError) as error:
        print(f"SRS: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
