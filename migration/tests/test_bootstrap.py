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

