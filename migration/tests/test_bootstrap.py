from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"lib"))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"tools/tests"))
import bootstrap
import test_study as ongoing_fixtures
from srs_tools import study

class BootstrapTests(unittest.TestCase):
    setUp=ongoing_fixtures.StudyTests.setUp
    tearDown=ongoing_fixtures.StudyTests.tearDown

    def test_initialize_preserves_native_overrides_and_never_overwrites_edits(self):
        self.study.unlink()
        with patch.dict(bootstrap.sources.EXPORTS, {'words':bootstrap.sources.Export('words.csv','Basic',())}):
            c=bootstrap.initialize(self.data,self.config,self.study)
        self.assertEqual(c['profiles']['preset-1']['settings']['weights'],ongoing_fixtures.WEIGHTS)
        self.assertEqual(c['decks']['a']['filter'],{'deck_ids':['a'],'include_children':True})
        with self.assertRaisesRegex(ValueError,'Already exists'):bootstrap.initialize(self.data,self.config,self.study)
        self.assertEqual(study.read(self.data/'manifest.json'),ongoing_fixtures.manifest())

    def test_initialize_creates_separate_layout_for_fresh_import(self):
        self.study.unlink()
        self.config.unlink()
        directory=self.root/'config'
        study.write(directory/'cards.json',{**self.templates,'rules':{}})
        with patch.dict(bootstrap.sources.EXPORTS, {'words':bootstrap.sources.Export('words.csv','Basic',())}):
            result=bootstrap.initialize(self.data,directory,directory)
        self.assertEqual(study.read(self.data/'profiles.json')['profiles'],result['profiles'])
        self.assertEqual(study.read(directory/'sources.json')['rules']['words']['sources'],['words.csv'])
        self.assertIn('note_partition_count',study.read(self.data/'manifest.json'))
        self.assertFalse(self.study.exists())
        with self.assertRaisesRegex(ValueError,'Already exists'):
            bootstrap.initialize(self.data,directory,directory)

    def test_new_import_initializes_profiles_without_replacing_existing_rules_or_training(self):
        directory=self.root/'config'
        study.write(directory/'sources.json',{'format_version':1,'rules':{}})
        study.write(directory/'cards.json',{'format_version':1,'groups':{},'rules':{}})
        study.write(directory/'profile-rules.json',{'format_version':1,'rules':[]})
        bootstrap.ensure_profiles(self.data,directory)
        target=self.data/'profiles.json'
        self.assertEqual(study.read(target)['profiles']['preset-1']['settings']['weights'],ongoing_fixtures.WEIGHTS)
        original=target.read_bytes()
        bootstrap.ensure_profiles(self.data,directory)
        self.assertEqual(target.read_bytes(),original)

