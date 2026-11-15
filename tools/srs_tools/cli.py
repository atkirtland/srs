"""Desktop card discovery, FSRS training, identity seeding and view installation."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import shutil
import sys
from .vault import ExportError

REVIEWER = Path(__file__).resolve().parents[2]


def install_view(vault):
    """Install only the standalone runtime, preserving editable configuration."""
    destination = vault / 'ankobs-srs'
    if not (REVIEWER / 'view.js').is_file():
        raise ValueError('Build the reviewer first: uv run python build.py (from tools/)')
    destination.mkdir(parents=True, exist_ok=True)
    for name in ('view.js', 'view.css'):
        source, target = REVIEWER / name, destination / name
        if source.resolve() == target.resolve():
            continue
        shutil.copyfile(source, target)
    # Copy editable rule documents only when absent. Scheduling profiles and
    # generated metadata belong to the store and are synced/copied separately.
    legacy_destination = (destination / 'study.json').exists() or (destination / 'config.json').exists()
    for source in ([] if legacy_destination else (REVIEWER / 'config').glob('*.json')):
        target = destination / 'config' / source.name
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
    # Compatibility for installations still using the legacy layout.
    if not (REVIEWER / 'config/cards.json').exists() and (REVIEWER / 'config.json').exists() and not (destination / 'config.json').exists():
        shutil.copyfile(REVIEWER / 'config.json', destination / 'config.json')
    return destination


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    refresh = commands.add_parser('refresh-cards', help='discover vault cards without changing review baselines')
    train = commands.add_parser('train', help='train standalone FSRS using the unified review logs')
    prune = commands.add_parser('prune-missing-sources', help='preview removal of unreviewed local cards whose source identity no longer exists')
    audit = commands.add_parser('audit-decks', help='flag parent matches outside all child decks (read-only)')
    prune.add_argument('--apply', action='store_true')
    for command in (refresh, train, prune, audit):
        command.add_argument('--data', type=Path, default=REVIEWER / 'data')
        command.add_argument('--study', type=Path, help='legacy study.json or configuration directory (default: --config)')
        command.add_argument('--config', type=Path, default=REVIEWER / 'config', help='configuration directory')
        command.add_argument('--vault', type=Path, default=REVIEWER.parent)
    upgrade = commands.add_parser('upgrade-layout', help='separate configuration and move note/card partitions into their own directories')
    upgrade.add_argument('--root', type=Path, default=REVIEWER)
    upgrade.add_argument('--data', type=Path)
    train.add_argument('--profile', required=True)
    train.add_argument('--apply', action='store_true', help='apply fitted parameters to future answers')
    train.add_argument('--output', type=Path)
    train.add_argument('--minimum-reviews', type=int, default=1000)
    train.add_argument('--epochs', type=int, default=5)
    seed = commands.add_parser('seed-csv-uids', help='assign persistent identities to new CSV rows')
    seed.add_argument('csv', type=Path)
    install = commands.add_parser('install-view', help='copy the standalone reviewer into a vault')
    install.add_argument('--vault', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == 'refresh-cards':
            from .study import refresh_cards
            result = refresh_cards(args.vault.resolve(), args.data, args.study or args.config, args.config)
            print(json.dumps(result, indent=2))
        elif args.command == 'audit-decks':
            from .audit import audit_decks
            result = audit_decks(args.vault.resolve(), args.data, args.study or args.config)
            print(json.dumps(result, indent=2))
            return 1 if result['issues'] else 0
        elif args.command == 'prune-missing-sources':
            from .prune import prune
            print(json.dumps(prune(args.vault, args.data, args.study or args.config, args.apply), indent=2))
        elif args.command == 'train':
            from .training import train as train_profile
            if args.minimum_reviews < 1 or args.epochs < 1:
                raise ValueError('minimum-reviews and epochs must be positive')
            result = train_profile(args.data, args.study or args.config, args.profile, vault=args.vault,
                                   apply=args.apply, output=args.output, minimum_reviews=args.minimum_reviews,
                                   epochs=args.epochs, progress=lambda text:print(text, file=sys.stderr, flush=True))
            print(json.dumps(result, indent=2))
        elif args.command == 'seed-csv-uids':
            from .core import seed_csv_uids
            print(f'Assigned {seed_csv_uids(args.csv)} local note identities')
        elif args.command == 'install-view':
            print(f'Installed standalone reviewer: {install_view(args.vault)}')
        elif args.command == 'upgrade-layout':
            from .layout import upgrade as upgrade_store
            print(json.dumps(upgrade_store(args.root, args.data), indent=2))
        return 0
    except (ValueError, OSError, ImportError, ExportError) as error:
        print(f'SRS: {error}', file=sys.stderr)
        return 2
