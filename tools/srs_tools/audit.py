"""Read-only checks of filtered deck coverage."""
from . import layout, study


def parent_gaps(cards, config, manifest):
    decks = config['decks']
    children = {key: [] for key in decks}
    for key, deck in decks.items():
        if deck.get('parent_id') is not None:
            children[deck['parent_id']].append(key)
    direct = {key: {c['id'] for c in cards if not c.get('retired') and
                    study.matches(c, deck['filter'], manifest)} for key, deck in decks.items()}
    covered = {}

    def membership(key):
        if key not in covered:
            covered[key] = direct[key].union(*(membership(child) for child in children[key]))
        return covered[key]

    issues = []
    for key, child_ids in children.items():
        if not child_ids:
            continue
        gaps = direct[key] - set().union(*(membership(child) for child in child_ids))
        if gaps:
            issues.append({'deck_id': key, 'name': decks[key]['name'],
                           'count': len(gaps), 'card_ids': sorted(gaps)})
    return {'parents_checked': sum(bool(value) for value in children.values()),
            'parent_only_cards': len(set().union(*(set(x['card_ids']) for x in issues))),
            'issues': issues}


def audit_decks(vault, data, configuration):
    config = study.validate(layout.load_study(configuration, data))
    manifest, cards = study.load_cards(data, config)
    # Apply the same field-wise settings conflict resolution used during training.
    from .training import events_from_logs, merge_card_settings
    cards = merge_card_settings(cards, events_from_logs(data))
    def needs_metadata(query):
        return ('tags' in query or 'tag_prefixes' in query or 'properties' in query or
                any(needs_metadata(q) for k in ('all', 'any') for q in query.get(k, [])) or
                ('not' in query and needs_metadata(query['not'])))
    if any(needs_metadata(d['filter']) for d in config['decks'].values()):
        # Missing sources must not silently produce a successful metadata audit.
        for card in cards:
            if not card.get('retired') and (card.get('source') or {}).get('path'):
                if not (vault / card['source']['path']).is_file():
                    raise ValueError(f"Source unavailable for metadata audit: {card['source']['path']}")
        study.attach_properties(vault, cards)
    return parent_gaps(cards, config, manifest)
