"""Desktop deck checks and FSRS training. Card maintenance is in the Obsidian UI."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
from .vault import ExportError

REVIEWER = Path(__file__).resolve().parents[2]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    train = commands.add_parser('train', help='train standalone FSRS using the unified review logs')
    audit = commands.add_parser('audit-decks', help='flag parent matches outside all child decks (read-only)')
    for command in (train, audit):
        command.add_argument('--data', type=Path, default=REVIEWER / 'data')
        command.add_argument('--study', type=Path, help='legacy study.json or configuration directory (default: --config)')
        command.add_argument('--config', type=Path, default=REVIEWER / 'config', help='configuration directory')
        command.add_argument('--vault', type=Path, default=REVIEWER.parent)
    train.add_argument('--profile', required=True)
    train.add_argument('--apply', action='store_true', help='apply fitted parameters to future answers')
    train.add_argument('--output', type=Path)
    train.add_argument('--minimum-reviews', type=int, default=1000)
    train.add_argument('--epochs', type=int, default=5)
    args = parser.parse_args(argv)
    try:
        if args.command == 'audit-decks':
            from .audit import audit_decks
            result = audit_decks(args.vault.resolve(), args.data, args.study or args.config)
            print(json.dumps(result, indent=2))
            return 1 if result['issues'] else 0
        elif args.command == 'train':
            from .training import train as train_profile
            if args.minimum_reviews < 1 or args.epochs < 1:
                raise ValueError('minimum-reviews and epochs must be positive')
            result = train_profile(args.data, args.study or args.config, args.profile, vault=args.vault,
                                   apply=args.apply, output=args.output, minimum_reviews=args.minimum_reviews,
                                   epochs=args.epochs, progress=lambda text:print(text, file=sys.stderr, flush=True))
            print(json.dumps(result, indent=2))
        return 0
    except (ValueError, OSError, ImportError, ExportError) as error:
        print(f'SRS: {error}', file=sys.stderr)
        return 2
