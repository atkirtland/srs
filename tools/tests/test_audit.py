import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from srs_tools.audit import parent_gaps


class DeckAuditTests(unittest.TestCase):
    def test_descendants_overlap_retired_and_leaf(self):
        config = {'decks': {
            'p': {'name': 'Parent', 'filter': {}, 'parent_id': None},
            'c': {'name': 'Child', 'filter': {'groups': []}, 'parent_id': 'p'},
            'g': {'name': 'Grandchild', 'filter': {'groups': ['covered']}, 'parent_id': 'c'},
            'other': {'name': 'Other', 'filter': {}, 'parent_id': None}}}
        cards = [{'id': 'ok', 'group': 'covered'}, {'id': 'gap', 'group': 'missing'},
                 {'id': 'retired', 'retired': True}]
        result = parent_gaps(cards, config, {})
        self.assertEqual(result['parents_checked'], 2)
        self.assertEqual(result['parent_only_cards'], 1)
        self.assertEqual(result['issues'], [{'deck_id': 'p', 'name': 'Parent',
                                            'count': 1, 'card_ids': ['gap']}])
        self.assertEqual(parent_gaps(cards[:1], config, {})['issues'], [])
