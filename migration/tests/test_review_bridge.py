"""Bridge safety and repeat-import checks, using metadata-only fixtures."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
import review_bridge as bridge
from srs_tools.layout import write, read
from srs_tools.training import events_from_logs, histories


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.data = Path(self.tmp.name)
        self.manifest = dict(format_version=2, collection_key='123', import_id='initial', revision='r',
            catalog_layout='flat', partition_count=1,
            timing=dict(day_zero='2000-01-01', timezone='America/Chicago', rollover_hour=3))
        write(self.data/'manifest.json', self.manifest)
        write(self.data/'cards/cards-00000.json', [dict(id='card', anki_card_id='42', custom='preserve')])
        self.raw = dict(col=[dict(crt=123)], cards=[dict(id=42, did=1, odid=0, queue=2, type=2,
            due=1200, ivl=10, reps=2, lapses=0, left=0, data=json.dumps(dict(s=5,d=7,lrt=1794000000)))],
            revlog=[dict(id=1794000000000, cid=42, ease=3, time=900, type=1, ivl=10, lastIvl=5, factor=2500)])
        self.meta = patch.object(bridge.scheduling,'metadata',return_value={})
        self.meta.start(); self.addCleanup(self.meta.stop)
        self.settings = patch.object(bridge.scheduling,'effective',return_value=dict(learning_steps=[1,10],relearning_steps=[10]))
        self.settings.start(); self.addCleanup(self.settings.stop)

    def test_idempotent_state_and_untouched_catalog(self):
        before = (self.data/'cards/cards-00000.json').read_bytes()
        manifest, events, report = bridge.plan(self.raw,self.data,'26.9.4')
        self.assertEqual((report['new_reviews'],report['updated_cards']), (1,1))
        self.assertFalse((self.data/'reviews').exists())
        bridge.apply(self.data,manifest,events)
        imported = events_from_logs(self.data)
        self.assertEqual(len(imported),2)
        state = next(e for e in imported if e['kind']=='anki_state')['state']
        self.assertEqual((state['stability'],state['difficulty'],state['reps']), (5,7,2))
        self.assertEqual(bridge.plan(self.raw,self.data,'26.9.4')[1], [])
        self.assertEqual((self.data/'cards/cards-00000.json').read_bytes(),before)
        self.assertEqual(read(self.data/'manifest.json'),manifest)
        # New local answers can refer to the bridge state as their parent.
        root = next(e for e in imported if e['kind']=='anki_state')
        answer = dict(kind='answer',id='local',card_id='card',import_id='initial',rating=3,
                      review_time_ms=root['review_time_ms']+1000,parent=root['id'])
        result,_ = histories(imported+[answer],{'card'},'initial')
        self.assertEqual(len(result['card']),2)

    def test_subsequent_anki_review_and_later_local_conflict(self):
        manifest, events, _ = bridge.plan(self.raw,self.data,'26.9.4')
        bridge.apply(self.data,manifest,events)
        self.raw['revlog'].append({**self.raw['revlog'][0], 'id':1794000010000})
        self.raw['cards'][0]['reps']=3
        _,events,report=bridge.plan(self.raw,self.data,'26.9.4')
        self.assertEqual((report['new_reviews'],report['updated_cards']),(1,1))
        bridge.apply(self.data,manifest,events)
        self.assertEqual(len(events_from_logs(self.data)),4)
        path=self.data/'reviews/computer-2026-11.jsonl'
        path.write_text(json.dumps(dict(id='local',kind='answer',card_id='card',review_time_ms=1794000020000))+'\n')
        self.raw['revlog'].append({**self.raw['revlog'][0], 'id':1794000030000})
        _,events,report=bridge.plan(self.raw,self.data,'26.9.4')
        self.assertFalse(events);self.assertEqual(len(report['conflicts']),1)

    def test_rollover_and_oversized_event(self):
        manifest,events,_=bridge.plan(self.raw,self.data,'26.9.4')
        limit=max(len((bridge.srs.canonical(e)+'\n').encode()) for e in events)+1
        with patch.object(bridge,'LOG_LIMIT',limit):
            bridge.apply(self.data,manifest,events)
        paths=list((self.data/'reviews').glob('*.jsonl'))
        self.assertEqual(len(paths),2)
        self.assertTrue(all(p.stat().st_size<=limit for p in paths))
        with patch.object(bridge,'LOG_LIMIT',1):
            with self.assertRaisesRegex(ValueError,'exceeds'):
                bridge.apply(self.data,manifest,events)

    def test_local_review_conflict_and_wrong_collection(self):
        path=self.data/'reviews/computer-2026-11.jsonl';path.parent.mkdir()
        path.write_text(json.dumps(dict(id='local',kind='answer',card_id='card',review_time_ms=1))+'\n')
        _,events,report=bridge.plan(self.raw,self.data,'26.9.4')
        self.assertEqual(events,[]);self.assertEqual(len(report['conflicts']),1)
        self.raw['col'][0]['crt']=999
        with self.assertRaisesRegex(ValueError,'different collection'):
            bridge.plan(self.raw,self.data,'26.9.4')

    def test_missing_memory_and_unmapped_cards(self):
        self.raw['cards'][0]['data']='{}'
        _,events,report=bridge.plan(self.raw,self.data,'26.9.4')
        self.assertFalse(events);self.assertIn('memory',report['conflicts'][0]['reason'])
        self.raw['revlog'][0]['cid']=999
        self.assertEqual(bridge.plan(self.raw,self.data,'26.9.4')[2]['unmapped_anki_cards'],['999'])

    def test_recover_interrupted_publish_and_preserve_months(self):
        self.raw['revlog'].insert(0,{**self.raw['revlog'][0], 'id':1790000000000})
        manifest,events,_=bridge.plan(self.raw,self.data,'26.9.4')
        with patch.object(bridge,'recover',side_effect=OSError('interrupted')):
            with self.assertRaises(OSError):bridge.apply(self.data,manifest,events)
        self.assertTrue((self.data/'anki-bridge.pending.json').exists())
        bridge.recover(self.data)
        self.assertEqual(len(list((self.data/'reviews').glob('*.jsonl'))),2)
        self.assertEqual(len(events_from_logs(self.data)),3)
        bridge.recover(self.data)
        self.assertEqual(bridge.plan(self.raw,self.data,'26.9.4')[1],[])

if __name__=='__main__':unittest.main()
