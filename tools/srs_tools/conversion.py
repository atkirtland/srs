"""Explicit, batch template mappings for notes moved between source rules."""
import sys
from collections import defaultdict


def prompt_mapping(plan):
    if not sys.stdin.isatty():
        raise ValueError('Note type changes require an interactive terminal; rerun refresh-cards interactively')
    print(f"\n{plan['old_type']} → {plan['new_type']}: {plan['notes']} notes, {plan['cards']} existing cards", file=sys.stderr)
    targets = plan['new_templates']
    for index, key in enumerate(targets, 1):
        print(f'  {index}. {key}', file=sys.stderr)
    print('  0. Retire (keep history, remove from study)', file=sys.stderr)
    mapping = {}
    for key in plan['old_templates']:
        while True:
            try:
                answer = input(f'Map {key} to [0–{len(targets)}]: ').strip()
            except EOFError as error:
                raise ValueError('Type conversion cancelled; catalog unchanged') from error
            if answer.isdigit() and 0 <= int(answer) <= len(targets):
                target = targets[int(answer)-1] if int(answer) else None
                if target is not None and target in mapping.values():
                    print('Each destination template can be mapped only once.', file=sys.stderr)
                    continue
                mapping[key] = target
                break
    for key, target in mapping.items():
        print(f"  {key} → {target or 'retire'}", file=sys.stderr)
    print('Unmapped destination templates will create new cards.', file=sys.stderr)
    try:
        confirmed = input('Apply this mapping to all these notes? [y/N]: ').strip().lower()
    except EOFError:
        confirmed = ''
    if confirmed not in ('y', 'yes'):
        raise ValueError('Type conversion cancelled; catalog unchanged')
    return mapping


def convert(cards, found, note_bindings, choose):
    """Resolve all mappings before mutating records; identity is the persistent note UID."""
    old, new = defaultdict(lambda: defaultdict(list)), defaultdict(lambda: defaultdict(list))
    for card in cards:
        if not card.get('retired') and card.get('group') and card.get('template_key'):
            old[card['note_uid']][card['group']].append(card)
    bindings = {(item['note_uid'], item['group']): item for item in note_bindings}
    for item in note_bindings:
        new[item['note_uid']][item['group']]
    for item in found:
        new[item['note_uid']][item['group']].append(item)
    batches = defaultdict(list)
    for uid, destinations in new.items():
        previous = old.get(uid, {})
        if not previous:
            continue
        if set(previous) & set(destinations):
            if set(destinations) - set(previous):
                raise ValueError(f'Ambiguous note type change for {uid}: note still exists in its old source rule')
            continue
        if len(previous) != 1 or len(destinations) != 1:
            raise ValueError(f'Ambiguous note type change for {uid}; keep each note in one source rule')
        source, target = next(iter(previous)), next(iter(destinations))
        batches[source, target].append((previous[source], destinations[target]))
    operations = []
    for (source, target), notes in sorted(batches.items()):
        old_keys = sorted({c['template_key'] for before, after in notes for c in before})
        new_keys = sorted({c['template_key'] for before, after in notes for c in after})
        plan = dict(old_type=source, new_type=target, notes=len(notes),
                    cards=sum(len(before) for before, after in notes), old_templates=old_keys, new_templates=new_keys)
        mapping = choose(plan)
        values = [v for v in mapping.values() if v is not None]
        if set(mapping) != set(old_keys) or any(v not in new_keys for v in values) or len(values) != len(set(values)):
            raise ValueError('Invalid template mapping; use each destination at most once')
        for before, after in notes:
            used = set()
            for card in before:
                key = mapping[card['template_key']]
                candidates = [item for item in after if item['template_key'] == key]
                if card.get('cloze') or any(item.get('cloze') for item in candidates):
                    candidates = [item for item in candidates if item['anki_ordinal'] == card['anki_ordinal']]
                if key is not None and len(candidates) != 1:
                    raise ValueError(f'Mapping {card["template_key"]} → {key} is unavailable or ambiguous for {card["note_uid"]}; retire it instead')
                item = candidates[0] if candidates else None
                identity = (item['template_key'], item['anki_ordinal']) if item else None
                if identity is not None and identity in used:
                    raise ValueError('Multiple old cards map to the same destination card')
                used.add(identity)
                operations.append((card, item, bindings[card['note_uid'], target]))
    moved = {card['note_uid']: note for card, item, note in operations}
    for card in cards:
        if card.get('retired') and card.get('note_uid') in moved:
            note = moved[card['note_uid']]
            card.update(group=note['group'], source=note['source'])
    for card, item, note in operations:
        if item is None:
            card['retired'] = True
            # Keep all cards of this note bound to its new source, including history-only cards.
            card.update(group=note['group'], source=note['source'])
        else:
            for key in ('group', 'source', 'template_key', 'anki_notetype', 'anki_ordinal'):
                card[key] = item[key]
            card.pop('cloze', None)
            if item.get('cloze'):
                card['cloze'] = True
    return len(operations), len(batches)
