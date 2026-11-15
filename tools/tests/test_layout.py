import copy
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from srs_tools import layout, study, training
import test_study as fixtures


class LayoutTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.StudyTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.root, self.data = self.fixture.root, self.fixture.data
        (self.root / 'words.csv').write_text('anki_note_id,word,definition\n12,spume,foam\n')

    def upgrade(self):
        self.fixture.refresh()
        return layout.upgrade(self.root)

    def test_conversion_preserves_identity_states_logs_and_has_no_card_export_recipes(self):
        self.fixture.refresh()
        before, cards = study.load_cards(self.data)
        self.fixture.write_events([dict(id='must remain byte identical', kind='answer')])
        log = self.data / 'reviews/computer-2026-11.jsonl'
        log_before = log.read_bytes()
        result = layout.upgrade(self.root)
        after, hydrated = study.load_cards(self.data)
        self.assertEqual(before['import_id'], after['import_id'])
        self.assertEqual([(c['id'], c['baseline']) for c in cards], [(c['id'], c['baseline']) for c in hydrated])
        self.assertEqual(cards[0]['source'], hydrated[0]['source'])
        self.assertEqual(log_before, log.read_bytes())
        self.assertEqual(result['notes'], 1)
        self.assertFalse((self.root / 'study.json').exists())
        self.assertFalse((self.root / 'config.json').exists())
        raw = study.read(self.data / 'cards' / 'cards-00000.json')[0]
        self.assertTrue('note_id' in raw)
        self.assertFalse({'source', 'group', 'note_uid', 'fields'} & raw.keys())
        notes = study.read(self.data / 'notes' / 'notes-00000.json')
        self.assertEqual(notes[0]['locator'], {'path':'words.csv', 'kind':'csv'})
        self.assertEqual(notes[0]['uid'], 'anki:12')
        self.assertFalse(layout.upgrade(self.root)['converted'])

    def test_rule_edits_are_resolved_without_rewriting_card_metadata(self):
        self.upgrade()
        manifest, cards = study.load_cards(self.data)
        source = self.root / 'config/sources.json'
        value = study.read(source)
        value['rules']['words']['fields'][0]['source'] = 'other_property'
        study.write(source, value)
        after, hydrated = study.load_cards(self.data)
        self.assertEqual(after, manifest)
        self.assertEqual(hydrated[0]['id'], cards[0]['id'])
        self.assertEqual(hydrated[0]['source']['fields'][0]['source'], 'other_property')

    def test_discovery_two_cards_share_one_note_and_preserve_existing_uid(self):
        self.upgrade()
        config_dir = self.root / 'config'
        templates = study.read(config_dir / 'cards.json')
        old = copy.deepcopy(templates['groups']['words']['templates'][0])
        old.update(key='reverse', anki_ordinal=1, front='{{Back}}', back='{{Front}}')
        templates['groups']['words']['templates'].append(old)
        templates['rules']['words']['templates'].append('reverse')
        study.write(config_dir / 'cards.json', templates)
        result = study.refresh_cards(self.root, self.data, config_dir, config_dir)
        self.assertEqual(result['added'], 1)
        manifest, cards = study.load_cards(self.data)
        self.assertEqual(len({c['note_id'] for c in cards}), 1)
        self.assertEqual(len({c['id'] for c in cards}), 2)
        raw = study.read(self.data / 'cards' / 'cards-00000.json')
        self.assertTrue(all('source' not in c for c in raw))

    def test_profile_save_changes_only_profiles_and_checks_concurrent_edits(self):
        self.upgrade()
        config_dir = self.root / 'config'
        previous = layout.load_study(config_dir, self.data)
        original_files = {p: p.read_bytes() for p in config_dir.glob('*.json')}
        replacement = copy.deepcopy(previous)
        replacement['profiles']['vocab']['settings']['desired_retention'] = .9
        layout.save_study(config_dir, replacement, self.data, expected=previous)
        self.assertEqual(layout.load_study(config_dir, self.data), replacement)
        self.assertTrue(all(p.read_bytes() == content for p, content in original_files.items()))
        with self.assertRaisesRegex(ValueError, 'Configuration changed'):
            layout.save_study(config_dir, previous, self.data, expected=previous)

    def test_conversion_rejects_recipe_mismatch_before_publishing(self):
        self.fixture.refresh()
        manifest = study.read(self.data / 'manifest.json')
        current = study.read(self.fixture.study)
        current['source_rules']['words']['fields'][0]['source'] = 'different'
        study.write(self.fixture.study, current)
        with self.assertRaisesRegex(ValueError, 'Source rule differs'):
            layout.upgrade(self.root)
        self.assertEqual(study.read(self.data / 'manifest.json'), manifest)
        self.assertFalse((self.root / 'config').exists())

    def test_training_reads_new_profiles_and_config_layout(self):
        self.fixture.training_fixture()
        layout.upgrade(self.root)
        config, manifest, sequences, stats = training.prepare(self.data, self.root / 'config', 'vocab', self.root)
        self.assertTrue(sequences)
        self.assertEqual(config['profiles'], study.read(self.data / 'profiles.json')['profiles'])

    def test_training_apply_updates_only_profile_data_in_separate_layout(self):
        self.fixture.training_fixture()
        layout.upgrade(self.root)
        config_dir = self.root / 'config'
        before = {p: p.read_bytes() for p in config_dir.glob('*.json')}
        logs = {p: p.read_bytes() for p in (self.data / 'reviews').glob('*.jsonl')}
        manifest = study.read(self.data / 'manifest.json')
        report = training.train(self.data, config_dir, 'vocab', vault=self.root, apply=True, epochs=1)
        self.assertTrue(report['applied'])
        self.assertEqual(len(study.read(self.data / 'profiles.json')['profiles']['vocab']['settings']['weights']), 21)
        self.assertTrue(all(p.read_bytes() == contents for p, contents in {**before, **logs}.items()))
        self.assertEqual(study.read(self.data / 'manifest.json'), manifest)

    def test_dangling_note_reference_is_diagnosed(self):
        with self.assertRaisesRegex(ValueError, 'Missing SRS note binding'):
            layout.hydrate_cards([dict(id='card', note_id='absent')], [], {})

    def test_relocate_previous_normalized_layout_preserves_all_bytes_and_is_idempotent(self):
        self.upgrade()
        manifest, cards = study.load_cards(self.data)
        revision = manifest['revision']
        original = {}
        (self.data / 'imports' / revision).mkdir(parents=True, exist_ok=True)
        for kind in ('notes', 'cards'):
            for path in (self.data / kind).glob('*.json'):
                original[path.relative_to(self.data)] = path.read_bytes()
                path.rename(self.data / 'imports' / revision / path.name)
        manifest.pop('catalog_layout')
        study.write(self.data / 'manifest.json', manifest)
        self.assertTrue(layout.upgrade(self.root)['converted'])
        after, hydrated = study.load_cards(self.data)
        self.assertEqual(hydrated, cards)
        self.assertEqual(after, {**manifest, 'catalog_layout':'flat'})
        for path, contents in original.items():
            self.assertEqual((self.data / path).read_bytes(), contents)
        self.assertFalse(list((self.data / 'imports').glob('*/cards-*.json')))
        self.assertFalse(list((self.data / 'imports').glob('*/notes-*.json')))
        self.assertFalse(layout.upgrade(self.root)['converted'])

    def test_incremental_append_preserves_untouched_partitions_and_added_times(self):
        self.upgrade()
        source = self.root / 'words.csv'
        source.write_text('anki_note_id,word,definition\n' + ''.join(f'{i},word{i},def{i}\n' for i in range(12, 263)))
        config = self.root / 'config'
        study.refresh_cards(self.root, self.data, config, config)
        first = self.data / 'cards/cards-00000.json'
        first_notes = self.data / 'notes/notes-00000.json'
        saved = {p:(p.read_bytes(),p.stat().st_mtime_ns) for p in (first, first_notes)}
        records = study.read(self.data / 'cards/cards-00001.json')
        self.assertTrue(records[0]['added_at'].endswith('Z'))
        original_time = records[0]['added_at']
        with source.open('a') as stream:
            stream.write('263,new,new definition\n')
        result = study.refresh_cards(self.root, self.data, config, config)
        self.assertEqual(result['added'], 1)
        for p, previous in saved.items():
            self.assertEqual((p.read_bytes(),p.stat().st_mtime_ns), previous)
        after = study.read(self.data / 'cards/cards-00001.json')
        self.assertEqual(after[0]['added_at'], original_time)
        self.assertTrue(after[-1]['added_at'].endswith('Z'))
        notes = study.read(self.data / 'notes/notes-00001.json')
        self.assertEqual(notes[-1]['added_at'], after[-1]['added_at'])
        snapshot = {p:(p.read_bytes(),p.stat().st_mtime_ns) for kind in ('notes','cards') for p in (self.data/kind).glob('*.json')}
        self.assertEqual(study.refresh_cards(self.root,self.data,config,config)['added'],0)
        self.assertTrue(all((p.read_bytes(),p.stat().st_mtime_ns)==v for p,v in snapshot.items()))

    def test_interrupted_partition_update_rolls_forward_without_touching_logs(self):
        from unittest.mock import patch
        from srs_tools import store
        self.upgrade()
        manifest, _ = study.load_cards(self.data)
        cards = study.read(self.data / 'cards/cards-00000.json')
        notes = study.read(self.data / 'notes/notes-00000.json')
        cards[0]['active'] = False
        original_write = layout.write
        def interrupted(path, value):
            if Path(path) == self.data / 'manifest.json':
                raise OSError('interrupted')
            original_write(path,value)
        with patch.object(layout,'write',side_effect=interrupted):
            with self.assertRaisesRegex(OSError,'interrupted'):
                store.publish(self.data,manifest,{**manifest,'revision':'changed'},cards,notes)
        self.assertTrue((self.data/'catalog.pending.json').exists())
        after, recovered = study.load_cards(self.data)
        self.assertEqual(after['revision'],'changed')
        self.assertFalse(recovered[0]['active'])
        self.assertFalse((self.data/'catalog.pending.json').exists())
