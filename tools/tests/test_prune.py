import unittest
import test_study as fixtures
from srs_tools import layout, study
from srs_tools.prune import prune

class PruneTests(unittest.TestCase):
    def setUp(self):
        self.fixture=fixtures.StudyTests();self.fixture.setUp();self.addCleanup(self.fixture.tearDown)
        self.root,self.data=self.fixture.root,self.fixture.data
        self.csv=self.root/'words.csv'
        self.csv.write_text('anki_note_id,word,definition\n12,imported,kept\n,local,remove\n')
        self.fixture.refresh();layout.upgrade(self.root)
        _,self.cards=study.load_cards(self.data)
        self.local=next(c for c in self.cards if c['note_uid'].startswith('local:'))
        self.csv.write_text('anki_note_id,word,definition\n12,imported,kept\n')
    def run_prune(self,apply=False):return prune(self.root,self.data,self.root/'config',apply)
    def test_preview_apply_and_idempotence(self):
        before=(self.data/'manifest.json').read_bytes()
        result=self.run_prune();self.assertEqual(result['removable_cards'],1)
        self.assertEqual((self.data/'manifest.json').read_bytes(),before)
        source=self.csv.read_bytes()
        self.run_prune(True)
        _,cards=study.load_cards(self.data);self.assertEqual(len(cards),1)
        self.assertEqual(cards[0]['note_uid'],'anki:12')
        self.assertEqual(len(layout.read(self.data/'notes/notes-00000.json')),1)
        self.assertEqual(self.csv.read_bytes(),source)
        self.assertEqual(self.run_prune()['removable_cards'],0)
    def test_any_log_reference_protects_card(self):
        self.fixture.write_events([{'kind':'answer','card_id':self.local['id']}])
        log=self.data/'reviews/computer-2026-11.jsonl';before=log.read_bytes()
        result=self.run_prune(True)
        self.assertEqual(result['removable_cards'],0)
        self.assertEqual(len(result['protected_cards']),1)
        self.assertEqual(log.read_bytes(),before)
        self.assertEqual(len(study.load_cards(self.data)[1]),2)
    def test_missing_source_mount_refuses_cleanup(self):
        self.csv.unlink()
        with self.assertRaisesRegex(ValueError,'Source unavailable'):self.run_prune(True)
    def test_moved_source_identity_is_kept(self):
        self.csv.write_text('anki_note_id,srs_note_id,word,definition\n12,,imported,kept\n,'+self.local['note_uid'][6:]+',local,kept\n')
        moved=self.root/'moved.csv';self.csv.rename(moved)
        sources=layout.read(self.root/'config/sources.json');sources['rules']['words']['sources']=['moved.csv'];layout.write(self.root/'config/sources.json',sources)
        self.assertEqual(self.run_prune()['removable_cards'],0)
