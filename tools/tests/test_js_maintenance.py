"""Compare actual JavaScript publication with the frozen Python implementation."""
import json
from datetime import datetime, timezone
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
import test_study as fixtures
from srs_tools import layout
from maintenance_reference import study

class JavascriptParityTests(unittest.TestCase):
    def test_refresh_publication_matches_python_for_csv_conditionals_and_cloze(self):
        fixture=fixtures.StudyTests();fixture.setUp();self.addCleanup(fixture.tearDown)
        config=fixtures.configuration()
        config['source_rules']['words']['templates']=['recognition','conditional','cloze']
        fixture.templates['groups']['words']['templates'] += [
            dict(key='conditional',enabled=True,anki_notetype='Basic',anki_ordinal=1,front='{{#Back}}{{Back}}{{/Back}}',back=''),
            dict(key='cloze',enabled=True,anki_notetype='Cloze',anki_ordinal=0,front='{{cloze:Front}}',back='')]
        layout.write(fixture.study,config);layout.write(fixture.config,fixture.templates)
        (fixture.root/'words.csv').write_text('anki_note_id,word,definition\n1,one,first\n2,two,\n3,{{c1::one}} and {{c3::three}},third\n')
        layout.upgrade(fixture.root)
        initial=layout.read(fixture.data/'manifest.json')
        files={f'srs/config/{name}':json.dumps(doc) for name,doc in layout.documents(config,fixture.templates).items()}
        files['srs/data/profiles.json']=(fixture.data/'profiles.json').read_text()
        files['srs/data/manifest.json']=json.dumps(initial)
        from srs_tools import store
        for path in store.partition_paths(initial)+store.note_paths(initial):files['srs/data/'+path]=(fixture.data/path).read_text()
        files['words.csv']=(fixture.root/'words.csv').read_text()
        instant=datetime(2026,11,15,tzinfo=timezone.utc)
        class Clock(datetime):
            @classmethod
            def now(cls,tz=None):return instant
        with patch.object(study,'datetime',Clock):study.refresh_cards(fixture.root,fixture.data,fixture.root/'config',fixture.root/'config')
        expected={f'srs/data/{kind}/{p.name}':layout.read(p) for kind in ('notes','cards') for p in (fixture.data/kind).glob('*.json')}
        tools=Path(__file__).resolve().parents[1]
        result=subprocess.run([str(tools/'.venv/bin/node'),str(tools/'tests/maintenance-runner.cjs')],input=json.dumps(dict(files=files,metadata={},now=int(instant.timestamp()*1000))),text=True,capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(json.loads(result.stdout),expected)
