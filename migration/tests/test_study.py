from __future__ import annotations
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import uuid
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
import study
import training
import srs

WEIGHTS=[0.4, 0.6, 2.4, 5.8, 4.9, 0.9, 0.8, 0.01, 1.5, 0.1, 0.9, 2.0, 0.1, 0.3, 1.6, 0.2, 2.9, 0.5, 0.6]


def profile():
    return {'name':'Vocabulary','settings':dict(algorithm='FSRS-6',weights=WEIGHTS,parameter_policy='legacy-test',
            desired_retention=.85,maximum_interval=36500,minimum_interval=1,learning_steps=[1,10],relearning_steps=[10],
            new_cards_per_day=20,enable_fuzz=False),'reviews_per_day':200,'imported_preset':'1'}


def manifest():
    return dict(format_version=2,import_id='original',revision='r',partition_count=1,collection_key='c',
        timing=dict(timezone='America/Chicago',rollover_hour=3,day_zero='2000-01-01'),
        scheduling=dict(source_anki_version='26.9.4',parameter_policy='legacy-test',collection={},
        presets={'1':{'id':'1','settings':dict(fsrs_params_5=WEIGHTS,desired_retention=.85,maximum_review_interval=36500,
        minimum_lapse_interval=1,learn_steps=[1,10],relearn_steps=[10],new_per_day=20,reviews_per_day=200)}},
        decks={'a':dict(id='a',name='Vocabulary',parent_id=None,normal={'config_id':'1'},common={})}))


def configuration():
    return dict(format_version=1,default_profile='vocab',profiles={'vocab':profile()},profile_rules=[],
                source_rules={'words':dict(sources=['words.csv'],profile='vocab',templates=['recognition'],fields=[
                    dict(anki='Front',source='word',transform='text',required=True),dict(anki='Back',source='definition',transform='text',required=True)])},
                decks={'words':dict(name='Words',parent_id=None,filter={'paths':['words.csv']})})


class StudyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.data=self.root/'data'
        self.study=self.root/'study.json';self.config=self.root/'config.json'
        self.templates={'format_version':1,'groups':{'words':{'templates':[dict(key='recognition',enabled=True,anki_notetype='Basic',anki_ordinal=0,front='{{Front}}',back='{{Back}}',required_fields=['Front','Back'])]}}}
        study.write(self.study,configuration());study.write(self.config,self.templates)
        study.write(self.data/'manifest.json',manifest());study.write(self.data/'imports/r/cards-00000.json',[])
        (self.data/'reviews').mkdir()
    def tearDown(self):self.temp.cleanup()
    def write_events(self,events,name='computer-2026-11.jsonl'):
        (self.data/'reviews'/name).write_text(''.join(json.dumps(e)+'\n' for e in events))
    def refresh(self):return study.refresh_cards(self.root,self.data,self.study,self.config)

    def test_discovery_seeds_csv_and_preserves_answers_baseline_and_identity_on_move(self):
        (self.root/'words.csv').write_text('anki_note_id,word,definition\n12,spume,foam\n,new word,new definition\n')
        result=self.refresh();self.assertEqual(result['added'],2)
        m,cards=study.load_cards(self.data);self.assertEqual(m['import_id'],'original')
        self.assertEqual(cards[0]['id'],srs.card_uid('words','anki:12','recognition'))
        self.assertIn('srs_uid', (self.root/'words.csv').read_text())
        self.write_events([dict(id='existing answer must survive',kind='answer')])
        previous=(self.data/'reviews/computer-2026-11.jsonl').read_bytes()
        self.assertEqual(self.refresh()['added'],0)
        self.assertEqual((self.data/'reviews/computer-2026-11.jsonl').read_bytes(),previous)
        (self.root/'words.csv').rename(self.root/'renamed.csv')
        config=study.read(self.study);config['source_rules']['words']['sources']=['renamed.csv'];study.write(self.study,config)
        self.assertEqual(self.refresh()['updated'],2)
        _,moved=study.load_cards(self.data)
        self.assertEqual([c['id'] for c in cards],[c['id'] for c in moved])
        self.assertEqual([c['baseline'] for c in cards],[c['baseline'] for c in moved])
        for file in self.data.rglob('*.json'):
            self.assertNotIn('new definition',file.read_text())
        with (self.root/'renamed.csv').open('a') as f:f.write(',third,third definition,\n')
        self.assertEqual(self.refresh()['added'],1,'new cards can be added after answers exist')

    def test_missing_sources_report_issues_without_blocking_other_additions(self):
        (self.root/'words.csv').write_text('anki_note_id,word,definition\n12,spume,foam\n')
        c=study.read(self.study);c['source_rules']['words']['sources'].append('missing.csv');study.write(self.study,c)
        result=self.refresh();self.assertEqual(result['added'],1)
        self.assertEqual(result['issues'][0]['path'],'missing.csv')
        self.assertEqual(self.refresh()['added'],0)

    def test_newly_resolved_imported_card_keeps_its_uid_and_saved_schedule(self):
        (self.root/'words.csv').write_text('anki_note_id,word,definition\n12,spume,foam\n')
        card=dict(id='anki:collection:card:999',note_uid='anki:12',anki_notetype='Basic',anki_ordinal=0,group=None,template_key=None,
                  source=None,deck_id='a',baseline={'state':2,'due':123,'stability':7},queue=2)
        study.write(self.data/'imports/r/cards-00000.json',[card])
        result=self.refresh();self.assertEqual(result['added'],0);self.assertEqual(result['updated'],1)
        _,cards=study.load_cards(self.data)
        self.assertEqual(len(cards),1);self.assertEqual(cards[0]['id'],card['id']);self.assertEqual(cards[0]['baseline'],card['baseline'])
        self.assertEqual(cards[0]['template_key'],'recognition')

    def test_markdown_block_and_cloze_card_generation_are_stable(self):
        (self.root/'notes').mkdir();(self.root/'notes/a.md').write_text('---\nword: alpha\ndefinition: first\n---\n')
        c=configuration();c['source_rules']['words']['sources']=['notes'];study.write(self.study,c)
        self.assertEqual(self.refresh()['added'],1);text=(self.root/'notes/a.md').read_text();self.assertIn('srs_uid:',text)
        self.assertEqual(self.refresh()['added'],0)
        c['source_rules']['words']['sources']=['notes/a.md'];study.write(self.study,c)
        self.assertEqual(self.refresh()['added'],0)
        (self.root/'blocks').mkdir();block=self.root/'blocks/b.md';block.write_text('> [!srs] Question\n> Answer\n\nText\n')
        c['source_rules']['words'].update(sources=['blocks'],kind='block',fields=[dict(anki='Front',source='$front',transform='text'),dict(anki='Back',source='$back',transform='text')]);study.write(self.study,c)
        self.assertEqual(self.refresh()['added'],1);self.assertIn('SRS-ID:',block.read_text());self.assertEqual(self.refresh()['added'],0)
        block.write_text(block.read_text().replace('Question','Edited question'))
        self.assertEqual(self.refresh()['added'],0)
        end=self.root/'blocks/end.md';end.write_text('> [!srs] EOF\n> Answer without newline')
        self.assertEqual(self.refresh()['added'],1);self.assertEqual(len(study.block_notes(end,seed=False)),1)
        (self.root/'words.csv').write_text('word,definition\n"{{c1::a}} and {{c3::b}}",answer\n')
        c['source_rules']['words']=configuration()['source_rules']['words'];study.write(self.study,c)
        self.templates['groups']['words']['templates'][0]['front']='{{cloze:Front}}';study.write(self.config,self.templates)
        self.assertEqual(self.refresh()['added'],2)
        _,cards=study.load_cards(self.data)
        self.assertEqual(sorted(card['anki_ordinal'] for card in cards if card['source']['path']=='words.csv'),[0,2])
        self.assertEqual(self.refresh()['added'],0)

    def test_initialize_preserves_native_overrides_and_never_overwrites_edits(self):
        self.study.unlink()
        with patch.dict(study.sources.EXPORTS, {'words':study.sources.Export('words.csv','Basic',())}):
            c=study.initialize(self.data,self.config,self.study)
        self.assertEqual(c['profiles']['preset-1']['settings']['weights'],WEIGHTS)
        self.assertEqual(c['decks']['a']['filter'],{'deck_ids':['a'],'include_children':True})
        with self.assertRaisesRegex(ValueError,'Already exists'):study.initialize(self.data,self.config,self.study)
        self.assertEqual(study.read(self.data/'manifest.json'),manifest())

    def test_filters_and_profile_precedence_are_independent_of_identity(self):
        card=dict(id='stable',group='words',template_key='recognition',deck_id='a',source={'path':'wiki/words/a.md'},properties={'production':True},card_settings={'tags':['hard']})
        query={'all':[{'paths':['wiki/words']},{'tags':['hard']},{'properties':{'production':True}}],'not':{'templates':['reverse']}}
        self.assertTrue(study.matches(card,query,manifest()))
        self.assertFalse(study.matches(card,{'any':[{'tags':['missing']},{'properties':{'missing':{'exists':True}}}]},manifest()))
        c=configuration();c['profiles']['hard']=profile();c['profile_rules']=[{'profile':'hard','filter':query}]
        self.assertEqual(study.profile_id(card,c,manifest()),'hard')
        card['card_settings']['profile']='vocab';self.assertEqual(study.profile_id(card,c,manifest()),'vocab')
        self.assertEqual(card['id'],'stable')
        c['decks']['words']['filter']={'typo':['x']}
        with self.assertRaisesRegex(ValueError,'Unknown filter'):study.validate(c)

    def training_fixture(self):
        cards=[];events=[];start=1736956800000
        for i in range(55):
            cid=f'card-{i}';cards.append(dict(id=cid,deck_id='a'))
            for j in range(22):
                events.append(dict(kind='historical_review',id=f'anki:c:{i*100+j}',card_id=cid,review_time_ms=start+j*86400000,
                                   rating=1 if (i+j)%9==0 else 4 if (i+j)%7==0 else 3,review_type=0 if j==0 else 1))
        study.write(self.data/'imports/r/cards-00000.json',cards)
        self.write_events(events,'anki-2025-01.jsonl')
        return events

    def test_training_deduplicates_and_follows_winning_branch_and_study_days(self):
        events=self.training_fixture();first=events[-1]['review_time_ms']+86400000
        def answer(id,parent,time):return dict(kind='answer',format_version=2,id=id,card_id='card-0',import_id='original',parent=parent,review_time_ms=time,rating=3,was_new=False)
        root='import:original:card-0'
        self.write_events([answer('losing',root,first),answer('winner',root,first+1000),answer('child','winner',first+86400000)])
        self.write_events(events,'anki-2025-01.sync-conflict.jsonl')
        c,m,sequences,stats=training.prepare(self.data,self.study,'vocab')
        self.assertEqual(stats['losing_branch_answers_excluded'],1)
        self.assertEqual(stats['reviews'],55*22+2)
        self.assertEqual(sequences[0][-1],(3,1))
        # Local rollover, including the repeated DST hour, uses calendar study days.
        self.assertEqual(training.study_day(1730615400000,m['timing']).isoformat(),'2024-11-02')
        self.write_events([answer('child','missing',first)])
        with self.assertRaisesRegex(ValueError,'Missing parent'):training.prepare(self.data,self.study,'vocab')

    def test_real_standalone_optimizer_trains_and_applies_without_touching_states(self):
        self.training_fixture()
        before={p:p.read_bytes() for p in self.data.rglob('*') if p.is_file()}
        report=training.train(self.data,self.study,'vocab',apply=True,epochs=1)
        self.assertEqual(len(report['weights']),21);self.assertTrue(report['applied'])
        self.assertEqual(report['training_examples'],55*21)
        self.assertEqual(report['previous_parameter_count'],19)
        self.assertEqual(study.read(self.study)['profiles']['vocab']['settings']['weights'],report['weights'])
        self.assertEqual(before,{p:p.read_bytes() for p in self.data.rglob('*') if p.is_file()})
        self.assertTrue(all(__import__('math').isfinite(x) for x in report['weights']))
        from fsrs_rs_python import DEFAULT_PARAMETERS
        self.assertNotEqual(report['weights'],DEFAULT_PARAMETERS,'the optimizer actually trains instead of returning defaults')

    def test_trained_parameters_match_browser_memory_updates_for_all_ratings(self):
        from fsrs_rs_python import FSRS, MemoryState
        self.training_fixture();report=training.train(self.data,self.study,'vocab',epochs=1)
        opts={**profile()['settings'],'weights':report['weights'],'parameter_policy':'standalone-test'}
        now=1768485600000
        transitions=[];expected={}
        engine=FSRS(parameters=report['weights'])
        for elapsed in (0,1,7,100):
            for rating,name in enumerate(('again','hard','good','easy'),1):
                identity=f'{elapsed}-{rating}'
                current=dict(state=2,queue=2,due=now,stability=5,difficulty=7,elapsed_days=0,scheduled_days=7,
                             reps=10,lapses=1,learning_steps=0,last_review=now-elapsed*86400000)
                transitions.append(dict(id=identity,card={'deck_id':'a'},state=current,options=opts,now=now,rating=rating))
                expected[identity]=getattr(engine.next_states(MemoryState(5,7),.85,elapsed),name).memory
        payload=dict(manifest=manifest(),cards=[],now=now,transitions=transitions)
        node=Path(sys.executable).with_name('node')
        if not node.exists():self.skipTest('desktop verification Node is not installed')
        result=subprocess.run([str(node),str(Path(__file__).resolve().parents[1]/'verify-browser.cjs')],input=json.dumps(payload),capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
        for value in json.loads(result.stdout)['transitions']:
            self.assertNotIn('error',value)
            memory=expected[value['id']]
            self.assertAlmostEqual(value['state']['stability'],memory.stability,delta=.0002)
            self.assertAlmostEqual(value['state']['difficulty'],memory.difficulty,delta=.0002)

    def test_training_refuses_conflicts_incomplete_logs_and_insufficient_data(self):
        events=self.training_fixture()
        self.write_events([{**events[0],'rating':1 if events[0]['rating']!=1 else 4}])
        with self.assertRaisesRegex(ValueError,'Conflicting event'):training.prepare(self.data,self.study,'vocab')
        self.write_events([])
        with self.assertRaisesRegex(ValueError,'need 5000'):training.train(self.data,self.study,'vocab',minimum_reviews=5000)
        (self.data/'reviews/computer-2026-11.jsonl').write_text('{}')
        with self.assertRaisesRegex(ValueError,'Incomplete log'):training.prepare(self.data,self.study,'vocab')

    def test_partition_rollover_and_exact_property_types(self):
        (self.root/'words.csv').write_text('anki_note_id,word,definition\n'+''.join(f'{i+1},word{i},definition{i}\n' for i in range(251)))
        self.assertEqual(self.refresh()['added'],251)
        m,cards=study.load_cards(self.data)
        self.assertEqual(m['partition_count'],2)
        self.assertEqual(len(study.read(self.data/f"imports/{m['revision']}/cards-00000.json")),250)
        self.assertEqual(len(study.read(self.data/f"imports/{m['revision']}/cards-00001.json")),1)
        self.assertEqual(len(list((self.data/'imports').iterdir())),1)
        self.assertFalse(study.matches({'properties':{}},{'properties':{'missing':None}},m))
        self.assertFalse(study.matches({'properties':{'production':1}},{'properties':{'production':True}},m))

    def test_discovery_and_training_import_without_anki(self):
        code="""import sys
class BlockAnki:
 def find_spec(self, fullname, *args):
  if fullname == 'anki' or fullname.startswith('anki.'):
   raise AssertionError('Anki must not be imported')
sys.meta_path.insert(0, BlockAnki())
import study, training, fsrs_rs_python
training.train(__import__('pathlib').Path(sys.argv[1]), __import__('pathlib').Path(sys.argv[2]), 'vocab', epochs=1)
assert not any(name == 'anki' or name.startswith('anki.') for name in sys.modules)
"""
        self.training_fixture()
        result=subprocess.run([sys.executable,'-c',code,str(self.data),str(self.study)],env={**__import__('os').environ,'PYTHONPATH':str(Path(study.__file__).parent)},capture_output=True,text=True)
        self.assertEqual(result.returncode,0,result.stderr)
