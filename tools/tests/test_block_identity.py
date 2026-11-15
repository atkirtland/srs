import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from srs_tools import core
from maintenance_reference import study

class BlockIdentityTest(unittest.TestCase):
    def test_existing_anki_marker_wins_without_rewriting(self):
        for marker in ('', '<!-- SRS-ID: 33333333-3333-4333-8333-333333333333 -->\n'):
            text=' > [!anki]- Question\n > #oa/example-topic\n'+marker+' \n<!--ID: 1002-->\n'
            with tempfile.TemporaryDirectory() as directory:
                path=Path(directory)/'note.md'; path.write_text(text)
                notes=study.block_notes(path)
                self.assertEqual([identity for identity,_ in notes],['anki:1002'])
                self.assertEqual(path.read_text(),text)

    def test_existing_frontmatter_identity_is_preserved(self):
        self.assertEqual(core.note_uid({'anki_note_id':1001,'srs_uid':'33333333-3333-4333-8333-333333333333'}),'anki:1001')

    def test_new_marker_goes_before_blank_lines(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'note.md'
            path.write_text('> [!anki]- Q\n> #oa/history\n\nOther text\n')
            study.block_notes(path)
            text=path.read_text()
            self.assertIn('> #oa/history\n<!-- SRS-ID:',text)
            self.assertIn('-->\n\nOther text',text)
            study.block_notes(path)
            self.assertEqual(path.read_text(),text)

    def test_existing_marker_moves_above_blank_lines_without_changing_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'note.md'
            identity='44444444-4444-4444-8444-444444444444'
            path.write_text('> [!anki]- Q\n> #oa/history\n\n<!-- SRS-ID: '+identity+' -->\n')
            self.assertEqual(study.block_notes(path)[0][0],'local:'+identity)
            self.assertIn('> #oa/history\n<!-- SRS-ID:',path.read_text())
