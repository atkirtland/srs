"""Train standalone FSRS from unified logs. This module never imports Anki."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta
import importlib.metadata
import json
import math
from pathlib import Path
from zoneinfo import ZoneInfo

from . import study
from . import layout
from . import core as srs


def events_from_logs(data):
    seen = {}
    for path in sorted((data / 'reviews').glob('*.jsonl')):
        text = path.read_text(encoding='utf-8')
        if text and not text.endswith('\n'):
            raise ValueError(f'Incomplete log line: {path}')
        for number, line in enumerate(text.splitlines(), 1):
            if not line.strip():
                continue
            try:
                event = json.loads(line)
                key = event['id']
                if not isinstance(key,str) or not key:
                    raise ValueError('Missing event identity')
                kind=event.get('kind','answer')
                if kind not in ('answer','historical_review','scheduling_baseline','card_settings'):
                    raise ValueError('Unknown event kind')
                timestamp=event.get('time_ms') if kind=='card_settings' else event.get('review_time_ms')
                if type(timestamp) is not int or timestamp < 0:
                    raise ValueError('Invalid event timestamp')
            except (ValueError, KeyError, TypeError) as error:
                raise ValueError(f'Malformed event at {path}:{number}') from error
            canonical = srs.canonical(event)
            if key in seen and seen[key][0] != canonical:
                raise ValueError(f'Conflicting event ID: {key}')
            seen[key] = (canonical, event)
    return [item[1] for item in seen.values()]


def merge_card_settings(cards, events):
    fields = {}
    for event in events:
        if event.get('kind') != 'card_settings':
            continue
        for key, value in event['changes'].items():
            identity = (event['card_id'], key)
            clock = (event['time_ms'], event['id'])
            if identity not in fields or clock > fields[identity][0]:
                fields[identity] = (clock, value)
    settings=defaultdict(dict)
    for (cid,key),(_,value) in fields.items():
        if value is not None:
            settings[cid][key]=value
    return [{**card, 'card_settings':settings[card['id']]} for card in cards]


def study_day(timestamp, timing):
    local = datetime.fromtimestamp(timestamp / 1000, ZoneInfo(timing['timezone']))
    return local.date() - timedelta(days=int(local.hour < timing['rollover_hour']))


def histories(events, known_cards, import_id):
    imported, answers = defaultdict(list), defaultdict(dict)
    for event in events:
        kind = event.get('kind', 'answer')
        if event.get('card_id') not in known_cards:
            if kind not in ('historical_review', 'scheduling_baseline'):
                raise ValueError(f"Unknown event card: {event.get('card_id')}")
            continue
        if kind == 'historical_review':
            if event.get('review_type') in (0, 1, 2, 3) and event.get('rating') in (1, 2, 3, 4):
                imported[event['card_id']].append(event)
        elif kind == 'answer':
            if event.get('rating') not in (1, 2, 3, 4) or event.get('import_id') != import_id:
                raise ValueError('Invalid or incompatible answer in training history')
            answers[event['card_id']][event['id']] = event
    result, branches = {}, {}
    for cid in known_cards:
        observations = sorted(imported[cid], key=lambda e:(e['review_time_ms'], e['id']))
        nodes = answers[cid]
        branch = []
        if nodes:
            cursor = max(nodes.values(), key=lambda e:(e['review_time_ms'], e['id']))
            seen = set()
            while True:
                if cursor['id'] in seen:
                    raise ValueError('Cycle in answer history')
                seen.add(cursor['id']); branch.append(cursor)
                parent = cursor['parent']
                if parent == f'import:{import_id}:{cid}':
                    break
                if parent not in nodes:
                    raise ValueError(f'Missing parent answer {parent}; finish syncing before training')
                prior = nodes[parent]
                if prior['review_time_ms'] > cursor['review_time_ms']:
                    raise ValueError('Answer history goes backwards in time')
                cursor = prior
            branch.reverse()
            branches[cid] = len(nodes) - len(branch)
            if observations and branch[0]['review_time_ms'] < observations[-1]['review_time_ms']:
                raise ValueError('Local answer predates imported history')
        result[cid] = observations + branch
    return result, branches


def prepare(data, study_path, profile, vault=None):
    config = study.validate(layout.load_study(study_path, data))
    if profile not in config['profiles']:
        raise ValueError(f'Unknown profile: {profile}')
    manifest, cards = study.load_cards(data, config)
    events = events_from_logs(data)
    cards = merge_card_settings(cards, events)
    if vault:
        study.attach_properties(vault, cards)
    elif any('properties' in srs.canonical(r['filter']) or 'tags' in srs.canonical(r['filter']) for r in config.get('profile_rules', [])):
        raise ValueError('--vault is required for property/tag profile rules')
    selected = {c['id'] for c in cards if study.profile_id(c, config, manifest) == profile}
    history, branches = histories(events, {c['id'] for c in cards}, manifest['import_id'])
    sequences, incomplete, count = [], 0, 0
    for cid in sorted(selected):
        values = history[cid]
        if not values:
            continue
        first = values[0]
        if not (first.get('review_type') == 0 or first.get('was_new') is True):
            incomplete += 1
            continue
        previous = study_day(first['review_time_ms'], manifest['timing'])
        reviews = []
        for event in values:
            today = study_day(event['review_time_ms'], manifest['timing'])
            delta = (today - previous).days
            if delta < 0:
                raise ValueError('Review chronology precedes its training history')
            reviews.append((event['rating'], delta)); previous = today
        sequences.append(reviews); count += len(reviews)
    return config, manifest, sequences, {'cards':len(sequences), 'reviews':count,
                                        'incomplete_histories_excluded':incomplete, 'losing_branch_answers_excluded':sum(branches.get(cid,0) for cid in selected)}


def training_items(sequences):
    from fsrs_rs_python import FSRSItem, FSRSReview
    items, card_ids, same_day_targets = [], [], 0
    for index, sequence in enumerate(sequences):
        reviews = []
        has_long_term = False
        for rating, delta in sequence:
            reviews.append(FSRSReview(rating=rating, delta_t=delta))
            # Same-day answers remain model inputs for later predictions. The
            # evaluator requires a positive elapsed time for the target itself.
            if delta > 0:
                has_long_term = True
                items.append(FSRSItem(reviews=reviews.copy()))
                card_ids.append(index)
            elif has_long_term:
                same_day_targets += 1
    return items, card_ids, same_day_targets


def evaluate_parameters(engine, items, profile, label):
    try:
        return engine.evaluate(items)
    except ValueError as error:
        raise ValueError(f'Cannot evaluate {label} parameters for {profile} '
                         f'on {len(items):,} positive-gap targets: {error}. '
                         'No parameters changed.') from error


def train(data, study_path, profile, *, vault=None, apply=False, output=None, minimum_reviews=1000, epochs=5, progress=None):
    if output and (output.resolve()==study_path.resolve() or
                   study_path.suffix != '.json' and output.resolve().is_relative_to(study_path.resolve()) or
                   output.resolve().is_relative_to(data.resolve())):
        raise ValueError('Training reports must be outside the runtime data and study configuration')
    from fsrs_rs_python import FSRS, TrainingConfig, check_and_fill_parameters
    if progress:
        progress(f'Loading review history for {profile}…')
    config, manifest, sequences, stats = prepare(data, study_path, profile, vault)
    original = json.loads(json.dumps(config))
    items, card_ids, same_day_targets = training_items(sequences)
    stats['same_day_targets_excluded'] = same_day_targets
    stats['training_examples'] = len(items)
    if len(items) < minimum_reviews:
        raise ValueError(f'Only {len(items)} long-term training examples; need {minimum_reviews}. No parameters changed.')
    if progress:
        progress(f'Training {profile}: {len(items):,} long-term examples from {stats["cards"]:,} cards, {epochs} epochs…')
    profile_value = config['profiles'][profile]
    previous = profile_value['settings']['weights']
    engine = FSRS(parameters=check_and_fill_parameters(previous))
    weights = engine.compute_parameters(items, card_ids=card_ids, enable_short_term=True,
                                        num_relearning_steps=len(profile_value['settings']['relearning_steps']),
                                        training_config=TrainingConfig(num_epochs=epochs))
    if len(weights) != 21 or any(not math.isfinite(v) for v in weights):
        raise ValueError('Optimizer returned unsupported weights')
    if progress:
        progress('Evaluating previous parameters…')
    before = evaluate_parameters(engine, items, profile, 'previous')
    if progress:
        progress('Evaluating fitted parameters…')
    after = evaluate_parameters(FSRS(parameters=weights), items, profile, 'fitted')
    report = dict(profile=profile, optimizer=f"fsrs-rs-python@{importlib.metadata.version('fsrs-rs-python')}",
                  model='FSRS-6', previous_parameter_count=len(previous), weights=weights, **stats,
                  evaluation={'scope':'training data (not a held-out accuracy estimate)',
                              'before':{'log_loss':before.log_loss,'rmse_bins':before.rmse_bins},
                              'after':{'log_loss':after.log_loss,'rmse_bins':after.rmse_bins}}, applied=False)
    if any(not math.isfinite(value) for group in ('before','after') for value in report['evaluation'][group].values()):
        raise ValueError('Optimizer evaluation is not finite; no parameters changed')
    if apply:
        if layout.load_study(study_path, data) != original or study.read(data / 'manifest.json') != manifest:
            raise ValueError('Configuration/catalog changed during training; retry')
        # New parameters affect future answers only. No card states/logs/baselines are rewritten.
        settings = profile_value['settings']
        settings.update(weights=weights, parameter_policy=report['optimizer'] + '/FSRS-6', parameter_field='weights')
        settings.pop('source_anki_version', None)
        study.validate(config)
        layout.save_study(study_path, config, data, expected=original)
        report['applied'] = True
    if output:
        study.write(output, report)
    return report
