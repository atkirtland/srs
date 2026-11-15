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
    for name, help_text in [('init-study', 'create source rules, filter decks and profiles from the current catalog'),
                            ('refresh-cards', 'discover new vault cards without Anki or replacing review baselines'),
                            ('train', 'train standalone FSRS on imported and local reviews')]:
        command = commands.add_parser(name, help=help_text)
        command.add_argument('--data', type=Path, default=PORTABLE / 'data' if PORTABLE else None)
        command.add_argument('--study', type=Path, default=PORTABLE / 'study.json' if PORTABLE else None)
        if name != 'train':
            command.add_argument('--config', type=Path, default=PORTABLE / 'config.json' if PORTABLE else None)
        command.add_argument('--vault', type=Path, default=PORTABLE.parent if PORTABLE else None)
        if name == 'train':
            command.add_argument('--profile', required=True)
            command.add_argument('--apply', action='store_true', help='apply trained parameters to future answers')
            command.add_argument('--output', type=Path)
            command.add_argument('--minimum-reviews', type=int, default=1000, help='minimum long-term examples (default: 1000)')
            command.add_argument('--epochs', type=int, default=5)
    args = parser.parse_args(argv)
    try:
        if args.command in {'init-study', 'refresh-cards', 'train'}:
            import study
            if args.data is None or args.study is None:
                raise ValueError('--data and --study are required outside the portable directory')
            if args.command != 'train' and args.config is None:
                raise ValueError('--config is required outside the portable directory')
            if args.command == 'init-study':
                result = study.initialize(args.data, args.config, args.study)
                print(f"Created {args.study}: {len(result['source_rules'])} source rules, {len(result['decks'])} study decks, {len(result['profiles'])} profiles")
                for identity, profile in result['profiles'].items():
                    print(f"  {identity}: {profile['name']}")
            elif args.command == 'refresh-cards':
                if args.vault is None:
                    raise ValueError('--vault is required')
                print(json.dumps(study.refresh_cards(args.vault.resolve(), args.data, args.study, args.config), indent=2))
            else:
                import training
                if args.minimum_reviews < 1 or args.epochs < 1:
                    raise ValueError('minimum-reviews and epochs must be positive')
                print(json.dumps(training.train(args.data, args.study, args.profile, vault=args.vault,
                                               apply=args.apply, output=args.output,
                                               minimum_reviews=args.minimum_reviews, epochs=args.epochs,
                                               progress=lambda text: print(text,file=sys.stderr,flush=True)), indent=2))
        elif args.command == "seed-csv-uids":
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
                                   "Update the managed backend from migration/: uv add --optional anki 'anki==" + args.anki_version + "'")
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
    except (ValueError, OSError, sqlite3.Error, ZoneInfoNotFoundError, sources.ExportError, ImportError) as error:
        print(f"SRS: {error}", file=sys.stderr)
        if isinstance(error, ImportError) and 'anki' in str(error):
            print("Anki is optional: run import/verification with uv run --extra anki python migrate.py ...", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
