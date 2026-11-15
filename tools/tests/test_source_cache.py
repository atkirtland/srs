"""Incremental source discovery must remain equivalent to a fresh source scan."""
import copy
import os
import unittest
from unittest.mock import patch

import test_study as fixtures
from srs_tools import layout
from maintenance_reference import study
from maintenance_reference.prune import prune
from maintenance_reference.source_cache import source_cache


class IncrementalTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.StudyTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.root, self.data = self.fixture.root, self.fixture.data
        self.csv = self.root / 'words.csv'
        self.csv.write_text('anki_note_id,word,definition\n12,one,first\n')

    def test_unchanged_touch_changed_contents_and_config(self):
        first = self.fixture.refresh()
        self.assertEqual(first['scan']['parsed_files'], 1)
        with patch.object(study, '_discover_uncached', side_effect=AssertionError('reparsed unchanged source')):
            second = self.fixture.refresh()
            self.assertEqual(second['scan'], dict(parsed_files=0, reused_files=1, hashed_files=0))
            os.utime(self.csv, ns=(self.csv.stat().st_atime_ns, self.csv.stat().st_mtime_ns + 1000000))
            touched = self.fixture.refresh()
            self.assertEqual(touched['scan'], dict(parsed_files=0, reused_files=1, hashed_files=1))
        self.csv.write_text(self.csv.read_text() + '13,two,second\n')
        changed = self.fixture.refresh()
        self.assertEqual(changed['added'], 1)
        self.assertEqual(changed['scan']['parsed_files'], 1)
        templates = copy.deepcopy(self.fixture.templates)
        templates['groups']['words']['templates'].append(dict(key='reverse', enabled=True, anki_notetype='Basic', anki_ordinal=1, front='{{Back}}', back='{{Front}}'))
        config = fixtures.configuration()
        config['source_rules']['words']['templates'].append('reverse')
        layout.write(self.fixture.config, templates)
        layout.write(self.fixture.study, config)
        result = self.fixture.refresh()
        self.assertEqual(result['added'], 2)
        self.assertEqual(result['scan']['parsed_files'], 1)

    def markdown_sources(self):
        directory = self.root / 'notes'
        directory.mkdir()
        a, b = directory/'a.md', directory/'b.md'
        a.write_text('---\nanki_note_id: 1\nword: one\ndefinition: first\n---\n')
        b.write_text('---\nsrs_note_id: 22222222-2222-4222-8222-222222222222\nword: two\ndefinition: second\n---\n')
        config = fixtures.configuration()
        config['source_rules']['words']['sources'] = ['notes']
        layout.write(self.fixture.study, config)
        return a, b

    def test_only_changed_markdown_is_parsed_and_new_files_discovered(self):
        a, b = self.markdown_sources()
        self.assertEqual(self.fixture.refresh()['added'], 2)
        a.write_text(a.read_text().replace('first', 'changed'))
        with patch.object(study, '_discover_uncached', wraps=study._discover_uncached) as parser:
            result = self.fixture.refresh()
            self.assertEqual(parser.call_count, 1)
            self.assertEqual(result['scan']['reused_files'], 1)
        c = a.with_name('c.md')
        c.write_text(a.read_text().replace('anki_note_id: 1', 'anki_note_id: 3'))
        self.assertEqual(self.fixture.refresh()['added'], 1)
        b.rename(b.with_name('renamed.md'))
        self.assertEqual(self.fixture.refresh()['updated'], 1)

    def test_prune_detects_deleted_files_without_reparsing_others(self):
        a, b = self.markdown_sources()
        self.fixture.refresh()
        layout.upgrade(self.root)
        def run():
            return prune(self.root, self.data, self.root/'config')
        self.assertEqual(run()['removable_cards'], 0)
        with patch.object(study.sources, 'split_frontmatter', side_effect=AssertionError('reparsed unchanged source')):
            self.assertEqual(run()['scan']['parsed_files'], 0)
            b.unlink()
            self.assertEqual(run()['removable_cards'], 1)
            a.unlink()
            self.assertEqual(run()['removable_cards'], 1)  # imported cards remain protected
        (self.root/'notes').rmdir()
        with self.assertRaisesRegex(ValueError, 'Source unavailable'):
            run()

    def test_cache_contains_no_note_content_and_is_disposable(self):
        self.csv.write_text(self.csv.read_text().replace('first', 'SECRET_NOTE_CONTENT'))
        self.fixture.refresh()
        path = self.root/'tools/.cache/source-scans.sqlite3'
        self.assertNotIn(b'SECRET_NOTE_CONTENT', path.read_bytes())
        path.unlink()
        result = self.fixture.refresh()
        self.assertEqual(result['added'], 0)
        self.assertEqual(result['scan']['parsed_files'], 1)

    def test_failed_scan_does_not_publish_partial_cache(self):
        with self.assertRaisesRegex(ValueError, 'cancel'):
            with source_cache(self.root, self.data, 'test') as cache:
                cache.read(self.csv, {}, lambda: ['anki:12'])
                raise ValueError('cancel')
        with source_cache(self.root, self.data, 'test') as cache:
            self.assertEqual(cache.read(self.csv, {}, lambda: ['anki:13']), ['anki:13'])
            self.assertEqual(cache.stats['parsed_files'], 1)

    def test_duplicate_identity_across_cached_and_changed_files_is_rejected(self):
        a, b = self.markdown_sources()
        self.fixture.refresh()
        b.write_text(a.read_text())
        with self.assertRaisesRegex(ValueError, 'Duplicate source identity'):
            self.fixture.refresh()

    def test_cached_blocks_recompute_cloze_ordinals_when_content_changes(self):
        block = self.root/'blocks.md'
        block.write_text('> [!anki]- {{c1::one}}\n> SECRET_BLOCK_ANSWER\n<!--ID: 12-->\n')
        config = fixtures.configuration()
        config['source_rules']['words'].update(sources=['blocks.md'], kind='block', fields=[
            dict(anki='Front', source='$front'), dict(anki='Back', source='$back')])
        templates = copy.deepcopy(self.fixture.templates)
        templates['groups']['words']['templates'][0]['front'] = '{{cloze:Front}}'
        layout.write(self.fixture.study, config)
        layout.write(self.fixture.config, templates)
        self.assertEqual(self.fixture.refresh()['added'], 1)
        self.assertEqual(self.fixture.refresh()['scan']['parsed_files'], 0)
        block.write_text(block.read_text().replace('{{c1::one}}', '{{c1::one}} {{c2::two}}'))
        self.assertEqual(self.fixture.refresh()['added'], 1)
        self.assertNotIn(b'SECRET_BLOCK_ANSWER', (self.root/'tools/.cache/source-scans.sqlite3').read_bytes())
        manifest, _ = study.load_cards(self.data)
        uncached = study.discover(self.root, config, templates, manifest)
        with source_cache(self.root, self.data, 'refresh') as cache:
            cached = study.discover(self.root, config, templates, manifest, cache=cache)
        self.assertEqual(cached, uncached)

    def test_unchanged_refresh_skips_loading_catalog_and_discovery(self):
        self.fixture.refresh()
        self.fixture.refresh()  # Establish the no-change checkpoint.
        with patch.object(study, 'load_cards', side_effect=AssertionError('loaded catalog')), patch.object(study, 'discover', side_effect=AssertionError('discovered cards')):
            result = self.fixture.refresh()
            self.assertEqual(result['added'], 0)
            self.assertEqual(result['scan']['parsed_files'], 0)
        # A partition edit invalidates the fast path even without a revision change.
        manifest, _ = study.load_cards(self.data)
        from srs_tools import store
        part = self.data/store.partition_paths(manifest)[0]
        part.write_text(part.read_text() + '\n')
        with patch.object(study, 'load_cards', wraps=study.load_cards) as load:
            self.fixture.refresh()
            self.assertEqual(load.call_count, 1)

    def test_prune_skips_logs_without_candidates_and_catalog_on_unchanged_run(self):
        self.markdown_sources()
        self.fixture.refresh()
        layout.upgrade(self.root)
        def run():
            return prune(self.root, self.data, self.root/'config')
        # An unrelated malformed log must not be parsed when nothing can be removed.
        self.fixture.write_events([{'card_id':'unrelated'}])
        log = self.data/'reviews/computer-2026-11.jsonl'
        log.write_text('not json\n')
        self.assertEqual(run()['removable_cards'], 0)
        original = layout.read
        def read(path):
            if str(path).endswith('.json') and ('/cards/' in str(path) or '/notes/' in str(path)):
                self.fail('loaded catalog on unchanged prune')
            return original(path)
        with patch.object(layout, 'read', side_effect=read):
            self.assertEqual(run()['removable_cards'], 0)
        # Once a candidate exists, logs must be validated before pruning.
        (self.root/'notes/b.md').unlink()
        with self.assertRaisesRegex(ValueError, 'invalid'):
            run()

    def test_prune_cached_log_references_detect_new_review_events(self):
        self.markdown_sources()
        self.fixture.refresh()
        layout.upgrade(self.root)
        _, cards = study.load_cards(self.data)
        local = next(c for c in cards if c['note_uid'].startswith('local:'))
        (self.root/'notes/b.md').unlink()
        def run(apply=False):
            return prune(self.root, self.data, self.root/'config', apply)
        self.assertEqual(run()['removable_cards'], 1)
        self.fixture.write_events([{'kind':'answer', 'card_id':local['id']}])
        self.assertEqual(run()['removable_cards'], 0)
        self.assertEqual(run(True)['removable_cards'], 0)
        # Removing an entire log must invalidate the no-change checkpoint too.
        (self.data/'reviews/computer-2026-11.jsonl').unlink()
        self.assertEqual(run()['removable_cards'], 1)
