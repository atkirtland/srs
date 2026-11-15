const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {indexedDB}=require('fake-indexeddb');
globalThis.__SRS_TEST__=true;
vm.runInThisContext(fs.readFileSync(require('node:path').join(__dirname,'../../view.js'),'utf8'));
const {SRS}=globalThis;
const timing={timezone:'America/Chicago',rollover_hour:3,day_zero:'2000-01-01'};
const now=Date.parse('2026-11-14T16:00:00Z');
const day=SRS.dayNumber(now,timing);
const options={algorithm:'FSRS-6',desired_retention:.85,maximum_interval:36500,new_cards_per_day:20,enable_fuzz:false,
  parameter_policy:'anki-25.09',learning_steps:[1,10],relearning_steps:[10],weights:[0.4,0.6,2.4,5.8,4.9,0.9,0.8,0.01,1.5,0.1,0.9,2.0,0.1,0.3,1.6,0.2,2.9,0.5,0.6]};
const preset={id:'1',settings:{new_per_day:20,reviews_per_day:100,learn_steps:[1,10],relearn_steps:[10],desired_retention:.85,maximum_review_interval:36500,minimum_lapse_interval:1,fsrs_params_5:options.weights}};
function manifest(){return {format_version:2,import_id:'import',timing,scheduling:{source_anki_version:'25.9.2',parameter_policy:'anki-25.09',presets:{'1':preset},collection:{collapseTime:1200,lastUnburied:day,newCardsIgnoreReviewLimit:false,applyAllParentLimits:false},decks:{
  parent:{id:'parent',name:'Parent',parent_id:null,normal:{config_id:'1'},common:{}},
  a:{id:'a',name:'Parent::A',parent_id:'parent',normal:{config_id:'1'},common:{}},
  b:{id:'b',name:'Parent::B',parent_id:'parent',normal:{config_id:'1'},common:{}}
}}};}
function state(q=0){return {state:q===0?0:q===2?2:1,queue:q,due:q===1?now-1000:now,anki_due:day,
  stability:q?5:0,difficulty:q?7:0,elapsed_days:0,scheduled_days:q?5:0,reps:q?2:0,lapses:0,learning_steps:0,
  ...(q?{last_review:now-5*86400000}: {})};}
function cards(qs){return qs.map((q,i)=>({id:`card-${i}`,deck_id:i%2?'b':'a',queue:q,card_type:q===0?0:q===2?2:1,
  anki_due:day,due_ms:q===1?now-1000:now,baseline:state(q),active:true,supported:true}));}
const states=cs=>new Map(cs.map(c=>[c.id,{state:c.baseline}]));

test('content errors and disabled/missing templates never reduce deck counts',()=>{
  const m=manifest(),cs=cards([0,0,1,2,2]);
  cs.forEach(c=>{c.content_error='Missing source';c.active=false;c.supported=false;});
  const [tree]=SRS.deckTree(cs,states(cs),m,now);
  assert.deepEqual([tree.new,tree.learning,tree.review,tree.errors],[2,1,2,5]);
});
test('daily overrides, parent limits, study counters and historical observations',()=>{
  const m=manifest(),cs=cards([0,0,0,0,2,2,2,2]);
  m.scheduling.decks.parent.normal.new_limit=1;
  m.scheduling.decks.a.normal.new_limit_today={limit:0,today:day};
  let [tree]=SRS.deckTree(cs,states(cs),m,now);
  assert.equal(tree.new,1);assert.equal(tree.children[0].new,0);assert.equal(tree.children[1].new,2);
  m.scheduling.collection.applyAllParentLimits=true;
  [tree]=SRS.deckTree(cs,states(cs),m,now);assert.equal(tree.children[1].new,1);
  m.scheduling.decks.parent.common={last_day_studied:day,new_studied:1,review_studied:2};
  [tree]=SRS.deckTree(cs,states(cs),m,now,[{kind:'historical_review',review_time_ms:now,card_id:cs[0].id,was_new:true}]);
  assert.equal(tree.new,0);
  [tree]=SRS.deckTree(cs,states(cs),m,now+86400000);assert.equal(tree.new,1);
});
test('learning availability, interday learning, suspended and buried rollover',()=>{
  const m=manifest(),cs=cards([1,1,3,-1,-2]);
  cs[1].baseline.due=now+1200001;
  cs[4].card_type=2;
  assert.deepEqual(SRS.deckTree(cs,states(cs),m,now).map(n=>[n.learning,n.review]),[[2,0]]);
  assert.equal(SRS.deckTree(cs,states(cs),m,now+86400000)[0].review,1);
  m.scheduling.decks.parent.normal.review_limit=1;
  const [tree]=SRS.deckTree(cs,states(cs),m,now+86400000);
  assert.equal(tree.interday,1);assert.equal(tree.review,0);
});
test('study rollover observes DST and computes due boundaries',()=>{
  assert.equal(SRS.studyDay(Date.parse('2026-11-01T08:59:00Z'),timing),'2026-10-31');
  assert.equal(SRS.studyDay(Date.parse('2026-11-01T09:00:00Z'),timing),'2026-11-01');
  assert.equal(new Date(SRS.studyDayStart(SRS.dayNumber(now,timing),timing)).toISOString(),'2026-11-14T09:00:00.000Z');
});
test('cloze, media, nested sections, arbitrary field names and unsupported filters',()=>{
  const fields={'Example Sentence':'{{c1::one::hint}} and {{c2::two}}',image:'![[media/a.png]]',yes:'yes',no:''};
  assert.equal(SRS.renderV2('{{cloze:Example Sentence}}',fields,0,false),'[hint] and two');
  assert.equal(SRS.renderV2('{{cloze:Example Sentence}}',fields,1,true),'one and two');
  assert.equal(SRS.renderV2('{{#yes}}{{^no}}{{image}}{{/no}}{{/yes}}',fields),'![[media/a.png]]');
  assert.throws(()=>SRS.renderV2('{{unknown:image}}',fields),/Unsupported/);
  assert.throws(()=>SRS.renderV2('{{Missing field}}',fields),/Missing/);
  assert.equal(SRS.transformField('image',['[[media/A.png]]','[[media/B.png]]'],{}),'![[media/A.png]]\n![[media/B.png]]');
  assert.equal(SRS.transformField('sound','[[media/audio.mp3]]',{}),'![[media/audio.mp3]]');
});
test('saved memory, trained presets, study-day elapsed time and Anki learning steps',()=>{
  const m=manifest();
  const fresh=state(0);
  assert.equal(SRS.nextStateV2({},fresh,options,m,now,2).due-now,330000);
  assert.equal(SRS.nextStateV2({},fresh,options,m,now,3).remaining_steps,1);
  const learning={...state(1),remaining_steps:1,learning_steps:1};
  assert.equal(SRS.nextStateV2({},learning,options,m,now,2).due-now,600000);
  assert.equal(SRS.nextStateV2({},learning,options,m,now,3).state,2);
  const different={...options,weights:[...options.weights]};different.weights[2]=4;
  assert.notEqual(SRS.nextStateV2({},fresh,options,m,now,3).stability,SRS.nextStateV2({},fresh,different,m,now,3).stability);
  assert.throws(()=>SRS.schedulerV2({...options,parameter_policy:null}),/unconfirmed/);
  assert.equal(SRS.effectiveSettings({deck_id:'a'},m).weights.length,19);
});
test('FSRS elapsed days use Anki cutoff arithmetic across DST',()=>{
  const m=manifest(), stamp=Date.parse('2026-03-09T16:00:00Z');
  const previous={...state(2),last_review:Date.parse('2026-03-07T08:30:00Z')};
  const result=SRS.nextStateV2({},previous,options,m,stamp,3);
  assert.equal(SRS.dayNumber(stamp,timing)-SRS.dayNumber(previous.last_review,timing),3);
  assert.equal(result.elapsed_days,2);
  const expected=SRS.schedulerV2(options).next_state(previous,2,3);
  assert.equal(result.stability,expected.stability);
});
const eventId='11111111-1111-4111-8111-111111111111', device='22222222-2222-4222-8222-222222222222';
function answer(id=eventId,stamp=now){return {format_version:2,kind:'answer',id,device_id:device,card_id:'card-0',import_id:'import',parent:'import:import:card-0',review_time_ms:stamp,duration_ms:100,rating:3,was_new:true,
  scheduler_version:'ts-fsrs@5.2.3/FSRS-6',scheduler_config:options,state:{...state(1),last_review:stamp}};}
test('incremental index preserves both branches, imports do not replace answers, rebuild is deterministic',async()=>{
  const index=await SRS.ReviewIndex.open('test-index','import',timing,indexedDB);
  const known=new Set(['card-0']);
  const historical={format_version:2,kind:'historical_review',id:'anki:col:1',collection_key:'col',anki_revlog_id:'1',device_id:device,card_id:'card-0',review_time_ms:1,original_review:{id:1}};
  const baseline={format_version:2,kind:'scheduling_baseline',id:'baseline:import:card-0',import_id:'import',device_id:device,card_id:'card-0',review_time_ms:now+500,state:state(2)};
  const first=answer(),second=answer('33333333-3333-4333-8333-333333333333',now+1);
  let text=[historical,first,baseline,second].map(x=>JSON.stringify(x)+'\n').join('');
  let reads=0;
  const read=()=>{reads++;return text;};
  const descriptor=()=>[{path:'file',stat:{mtime:text.length,size:text.length}}];
  await index.sync(descriptor(),read,known);
  assert.equal((await index.latest()).get('card-0').id,second.id);
  assert.equal((await index.historyFor('card-0')).length,1);
  assert.equal((await index.activityToday(now)).length,2);
  assert.equal(await index.introducedToday(now),1);
  let result=await index.sync(descriptor(),read,known);assert.equal(result.readFiles,0);assert.equal(reads,1);
  text+=JSON.stringify(answer('44444444-4444-4444-8444-444444444444',now+2))+'\n';
  result=await index.sync(descriptor(),read,known);assert.equal(result.parsed,1);
  await assert.rejects(()=>index.ingest([{...first,rating:4}],known),/Conflicting/);
  await index.clear();await index.sync(descriptor(),read,known);
  assert.equal((await index.latest()).get('card-0').review_time_ms,now+2);
  await index.sync([],read,known);assert.equal((await index.latest()).size,0);
  index.close();
});
test('monthly writer uses UTC month and rotates at 32 MiB',async()=>{
  const files=new Map();
  const store={list:async()=>[...files.keys()].map(path=>({path})),read:async p=>files.get(p)??null,
    create:async(p,t)=>files.set(p,t),append:async(p,t)=>files.set(p,files.get(p)+t)};
  const first=answer(eventId,Date.parse('2026-11-01T00:00:00Z'));
  const path=await SRS.appendReview(store,'reviews',first);
  assert.match(path,/-2026-11.jsonl$/);
  files.set(path,' '.repeat(32*1024*1024-2)+'\n');
  const next=await SRS.appendReview(store,'reviews',answer('33333333-3333-4333-8333-333333333333',first.review_time_ms));
  assert.match(next,/-2026-11-002.jsonl$/);
});
test('named devices write readable logs while UUID device records remain valid',async()=>{
  const files=new Map();
  const store={read:async p=>files.get(p)??null,create:async(p,t)=>files.set(p,t),append:async(p,t)=>files.set(p,files.get(p)+t)};
  for(const name of ['computer','android']) {
    const event={...answer(),device_id:name};
    SRS.validateEvent(event,'import');
    assert.equal(await SRS.appendReview(store,'reviews',event),`reviews/${name}-2026-11.jsonl`);
  }
  SRS.validateEvent(answer(),'import');
  assert.throws(()=>SRS.validateEvent({...answer(),device_id:'../other'},'import'),/Invalid/);
});
test('scheduler archives deduplicate effective settings by canonical hash and never overwrite files',async()=>{
  const files=new Map();let creates=0;
  const store={read:async p=>files.get(p)??null,create:async(p,t)=>{creates++;files.set(p,t);}};
  const id=await SRS.saveSchedulerConfig(store,'configs',options);
  const path=`configs/${id}.json`, bytes=files.get(path);
  const reordered=Object.fromEntries(Object.entries(options).reverse());
  assert.equal(await SRS.saveSchedulerConfig(store,'configs',{...reordered,new_cards_per_day:99,preset_id:'other'}),id);
  assert.equal(creates,1);assert.equal(files.size,1);assert.equal(files.get(path),bytes);
  const saved=await SRS.verifySchedulerConfig(id,bytes);
  assert.deepEqual(saved.settings.weights,options.weights);
  assert.equal(saved.settings.parameter_policy,options.parameter_policy);
  assert.ok(!('new_cards_per_day' in saved.settings));assert.ok(!('preset_id' in saved.settings));
  const changed=await SRS.saveSchedulerConfig(store,'configs',{...options,desired_retention:.9});
  assert.notEqual(changed,id);assert.equal(files.get(path),bytes);
  const weights=[...options.weights];weights[0]+=.01;
  assert.notEqual(await SRS.saveSchedulerConfig(store,'configs',{...options,weights}),id);
  await assert.rejects(()=>SRS.saveSchedulerConfig(store,'configs',options,'unknown scheduler'),/Unsupported scheduler version/);
  files.set(path,JSON.stringify({...saved,settings:{...saved.settings,desired_retention:.95}}));
  const corrupt=files.get(path);
  await assert.rejects(()=>SRS.saveSchedulerConfig(store,'configs',options),/hash mismatch/);
  assert.equal(files.get(path),corrupt);
  await assert.rejects(()=>SRS.verifySchedulerConfig(id,null),/Missing scheduler configuration/);
  await assert.rejects(()=>SRS.verifySchedulerConfig(id,'{'),/Malformed scheduler configuration/);
  // A concurrent writer may create the identical immutable file first.
  const raced=new Map();
  const racingStore={read:async p=>raced.get(p)??null,create:async(p,t)=>{raced.set(p,t);throw Error('Already exists');}};
  assert.equal(await SRS.saveSchedulerConfig(racingStore,'configs',options),id);
});
test('hashed scheduler references coexist with inline reviews and validate before indexing or checkpointing',async()=>{
  const files=new Map(), store={read:async p=>files.get(p)??null,create:async(p,t)=>files.set(p,t)};
  const id=await SRS.saveSchedulerConfig(store,'configs',options);
  const indexed=await SRS.ReviewIndex.open(`config-refs-${crypto.randomUUID()}`,'import',timing,indexedDB);
  const known=new Set(['card-0']);
  const ref=(eventId,stamp,configId=id)=>{
    const {scheduler_config,scheduler_version,...event}=answer(eventId,stamp);
    return {...event,scheduler_config_id:configId};
  };
  const first=ref('33333333-3333-4333-8333-333333333333',now);
  SRS.validateEvent(first,'import');
  assert.throws(()=>SRS.validateEvent({...first,scheduler_config:options},'import'),/reference/);
  assert.throws(()=>SRS.validateEvent({...first,scheduler_version:'anything'},'import'),/reference/);
  assert.throws(()=>SRS.validateEvent({...first,scheduler_config_id:'../config'},'import'),/reference/);
  assert.throws(()=>SRS.validateEvent({...first,scheduler_config_id:[id]},'import'),/reference/);
  assert.throws(()=>SRS.validateEvent({...first,format_version:1},'import'),/reference/);
  let text=JSON.stringify(first)+'\n';
  const descriptors=()=>[{path:'reviews/computer-2026-11.jsonl',stat:{mtime:text.length,size:text.length}}];
  await assert.rejects(()=>indexed.sync(descriptors(),()=>text,known,{readSchedulerConfig:()=>null}),/Missing scheduler configuration/);
  assert.equal((await indexed.latest()).size,0);
  assert.equal(await indexed.get('files',descriptors()[0].path),undefined,'missing configs leave the file uncheckpointed');
  await assert.rejects(()=>indexed.sync(descriptors(),()=>text,known,{readSchedulerConfig:()=>JSON.stringify({})}),/hash mismatch/);
  await assert.rejects(()=>indexed.ingest([first],known),/configuration reader/);
  const legacy={...answer(),format_version:1};delete legacy.kind;
  const events=[legacy,...Array.from({length:501},(_,i)=>ref(`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,now+i+1))];
  text=events.map(e=>JSON.stringify(e)+'\n').join('');
  let configReads=0;
  const readSchedulerConfig=id=>{configReads++;return files.get(`configs/${id}.json`)??null;};
  await indexed.sync(descriptors(),()=>text,known,{readSchedulerConfig});
  assert.equal(configReads,1,'one config read across multiple ingest batches');
  const winner=(await indexed.latest()).get('card-0');
  assert.equal(winner.scheduler_config_id,id);assert.ok(!('scheduler_config' in winner));
  assert.equal(winner.review_time_ms,now+501);
  assert.equal((await indexed.activityToday(now)).length,502);
  assert.equal((await indexed.sync(descriptors(),()=>{throw Error('Unchanged log read');},known,{readSchedulerConfig})).parsed,0);
  assert.equal(configReads,1);
  await indexed.clear();await indexed.sync(descriptors(),()=>text,known,{readSchedulerConfig});
  assert.deepEqual((await indexed.latest()).get('card-0'),winner);
  indexed.close();
});
test('card settings merge per field across offline branches, resets and index rebuilds without study activity',async()=>{
  const name=`settings-${crypto.randomUUID()}`, index=await SRS.ReviewIndex.open(name,'import',timing,indexedDB);
  const setting=(id,time_ms,changes)=>({format_version:2,kind:'card_settings',id,device_id:'android',card_id:'card-0',time_ms,changes});
  const first=setting(eventId,now,{suspended:true,tags:['first']});
  const tags=setting('33333333-3333-4333-8333-333333333333',now+1,{tags:['focused']});
  const restore=setting('44444444-4444-4444-8444-444444444444',now+2,{suspended:false});
  await index.ingest([restore,tags,first],new Set(['card-0']));
  assert.deepEqual((await index.cardSettings()).get('card-0'),{suspended:false,tags:['focused']});
  const reset=setting('55555555-5555-4555-8555-555555555555',now+3,{tags:null});
  await index.ingest([reset,first],new Set(['card-0']));
  assert.deepEqual((await index.cardSettings()).get('card-0'),{suspended:false});
  // A timestamp tie uses the event ID, independently for each field.
  const tied=setting('66666666-6666-4666-8666-666666666666',now+2,{suspended:true});
  await index.ingest([tied],new Set(['card-0']));
  const expected={suspended:true};
  assert.deepEqual((await index.cardSettings()).get('card-0'),expected);
  assert.equal((await index.latest()).size,0);
  assert.equal((await index.activityToday(now)).length,0);
  assert.equal(await index.introducedToday(now),0);
  const files=new Map(),store={read:async p=>files.get(p)??null,create:async(p,t)=>files.set(p,t),append:async(p,t)=>files.set(p,files.get(p)+t)};
  for(const event of [first,tags,restore,reset,tied])assert.equal(await SRS.appendReview(store,'reviews',event),'reviews/android-2026-11.jsonl');
  const descriptors=[...files].map(([path,text])=>({path,stat:{mtime:1,size:text.length}}));
  await index.clear();
  await index.sync(descriptors,f=>files.get(f.path),new Set(['card-0']));
  assert.deepEqual((await index.cardSettings()).get('card-0'),expected);
  assert.equal((await index.sync(descriptors,()=>{throw Error('Unchanged log read');},new Set(['card-0']))).parsed,0);
  index.close();
  const reopened=await SRS.ReviewIndex.open(name,'changed-baseline',timing,indexedDB);
  await reopened.sync(descriptors,f=>files.get(f.path),new Set(['card-0']));
  assert.deepEqual((await reopened.cardSettings()).get('card-0'),expected,'settings survive a changed import identity');
  reopened.close();
  for(const changes of [{suspended:'yes'},{tags:['x','x']},{tags:['']},{unrecognized:true},{}])
    assert.throws(()=>SRS.validateEvent(setting(eventId,now,changes),'import'));
});
test('suspension applies to individual card UIDs and restores native suspended cards without changing saved state',()=>{
  const m=manifest(),cs=cards([0,2,-1]);
  cs[0].note_uid=cs[1].note_uid='same-note';
  cs[0].card_settings={suspended:true};
  cs[2].card_type=2;cs[2].baseline.state=2;
  const saved=JSON.stringify(cs.map(c=>c.baseline));
  let queue=SRS.reviewQueueV2(cs,states(cs),[],m,now);
  assert.deepEqual(queue.cards.map(c=>c.id),['card-1']);
  cs[2].card_settings={suspended:false};
  queue=SRS.reviewQueueV2(cs,states(cs),[],m,now);
  assert.deepEqual(new Set(queue.cards.map(c=>c.id)),new Set(['card-1','card-2']));
  assert.equal(JSON.stringify(cs.map(c=>c.baseline)),saved);
  cs[2].card_settings={};
  assert.equal(SRS.cardSuspended(cs[2],states(cs).get(cs[2].id)),true);
});
test('adding card settings upgrades the local database without rebuilding historical log checkpoints',async()=>{
  const name=`upgrade-${crypto.randomUUID()}`;
  const old=await new Promise((resolve,reject)=>{
    const opening=indexedDB.open(name,2);
    opening.onupgradeneeded=()=>{
      const db=opening.result;
      for(const store of ['meta','files','seen','latest','baselines'])db.createObjectStore(store);
      db.createObjectStore('observations',{keyPath:'id'}).createIndex('card_id','card_id');
      db.createObjectStore('activity',{keyPath:'id'}).createIndex('day','day');
      db.createObjectStore('introduced',{keyPath:['day','card_id']}).createIndex('day','day');
    };
    opening.onsuccess=()=>resolve(opening.result);opening.onerror=()=>reject(opening.error);
  });
  await new Promise((resolve,reject)=>{
    const tx=old.transaction(['meta','files','latest'],'readwrite');
    tx.objectStore('meta').put('import','import');tx.objectStore('meta').put(2,'schema');
    tx.objectStore('files').put({mtime:1,size:100},'historical-log');
    tx.objectStore('latest').put(answer(),'card-0');
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
  });old.close();
  const upgraded=await SRS.ReviewIndex.open(name,'import',timing,indexedDB);
  assert.equal((await upgraded.get('files','historical-log')).size,100);
  assert.equal((await upgraded.latest()).get('card-0').id,eventId);
  assert.equal((await upgraded.cardSettings()).size,0);
  upgraded.close();
});
test('reviewer scopes content errors, reuses resolved content, and Bury writes nothing; live edits preserve identity',async()=>{
  class Element {
    constructor(tag='div',options={}) {this.tag=tag;this.children=[];this.textContent=options.text||'';this.value=options.value||'';this.type=options.type;this.attr=options.attr||{};}
    createEl(tag,options){const e=new Element(tag,options);this.children.push(e);return e;}
    createDiv(options){return this.createEl('div',options);}
    empty(){this.children=[];this.textContent='';}
    querySelectorAll(tag){return this.children.flatMap(e=>[...(e.tag===tag?[e]:[]),...e.querySelectorAll(tag)]);}
  }
  const root=new Element(), files=new Map(), cleanups=[];
  const m=manifest(), cs=cards([0,0,0]);m.partition_count=1;m.revision='r';
  m.scheduling.decks.other={id:'other',name:'Other',parent_id:null,normal:{config_id:'1'},common:{}};
  cs[2].deck_id='other';
  const config={format_version:1,scheduler:options,groups:{test:{templates:[{key:'recognition',enabled:true,anki_notetype:'vocab',anki_ordinal:0,required_fields:['word','definition'],front:'{{word}}',back:'{{definition}}'}]}}};
  cs.forEach((c,i)=>Object.assign(c,{group:'test',note_uid:`anki:${i+1}`,template_key:'recognition',anki_notetype:'vocab',anki_ordinal:0,
    source:{candidates:['vocab.csv'],kind:'csv',fields:[{anki:'word',source:'word',transform:'text'},{anki:'definition',source:'definition',transform:'text'}]}}));
  const put=(path,text)=>files.set(path,{path,extension:path.split('.').at(-1),text,stat:{mtime:Date.now()+files.size,size:text.length}});
  const cardPath='srs/data/imports/r/cards-00000.json';
  put('srs/data/manifest.json',JSON.stringify(m));put(cardPath,JSON.stringify(cs));put('srs/config.json',JSON.stringify(config));
  put('vocab.csv','anki_note_id,word,definition\n1,broken,\n2,ready,answer\n');
  let scans=0;
  const vault={getName:()=>`test-ui-${crypto.randomUUID()}`,getFiles:()=>{scans++;return [...files.values()];},getAbstractFileByPath:p=>files.get(p),read:async f=>f.text,
    create:async(p,t)=>put(p,t),createFolder:async p=>files.set(p,{path:p}),append:async(f,t)=>{f.text+=t;f.stat.mtime++;f.stat.size=f.text.length;},on:()=>()=>{}};
  const component={register:f=>cleanups.push(f),registerEvent:()=>{},registerInterval:()=>{}};
  class FixedDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
  const context={dv:{app:{vault,metadataCache:{getFileCache:()=>({}),on:()=>()=>{}},workspace:{openLinkText:()=>{}}},component,container:root,
    el:(tag,text,{container})=>container.createEl(tag,{text})},input:{root:'srs'},localStorage:{getItem:()=>device,setItem:()=>{}},
    indexedDB,crypto,TextEncoder,console,Date:FixedDate,setTimeout,clearTimeout,setInterval:()=>0};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../view.js'),'utf8'),context);
  const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
  const button=text=>root.querySelectorAll('button').find(b=>b.textContent===text);
  for(let i=0;i<100&&!button('Review');i++)await tick();
  assert.ok(button('Review'),'default deck homepage appears');
  const scansAtHome=scans;
  // Other sorts before Parent, so open the Parent root explicitly.
  root.querySelectorAll('button').filter(b=>b.textContent==='Review')[1].onclick({preventDefault(){}});
  for(let i=0;i<100&&!button('Rating unavailable');i++)await tick();
  assert.ok(button('Rating unavailable'),'missing fields remain accessible');
  assert.equal(scans-scansAtHome,1,'opening a deck only scans for log changes, without resolving sources again');
  assert.ok(root.querySelectorAll('span').some(e=>e.textContent===' · 1 content errors'));
  assert.ok(root.querySelectorAll('summary').some(e=>e.textContent==='Inspect 1 content errors'));
  assert.ok(!root.querySelectorAll('span').some(e=>e.textContent===' · 2 content errors'));
  const scansBeforeBury=scans;
  button('Bury').onclick();
  for(let i=0;i<100&&!button('Show answer');i++)await tick();
  assert.ok(button('Show answer'));
  assert.equal(scans-scansBeforeBury,1,'burying reuses the resolved source catalog');
  assert.equal([...files.keys()].filter(p=>p.endsWith('.jsonl')).length,0);
  const priorIds=JSON.parse(files.get(cardPath).text).map(c=>c.id);
  config.groups.test.templates[0].front='Edited {{word}}';put('srs/config.json',JSON.stringify(config));
  button('Refresh').onclick();await tick();
  for(let i=0;i<100&&!button('Show answer');i++)await tick();
  button('Show answer').onclick();
  const rate=root.querySelectorAll('button').find(b=>b.textContent.startsWith('Good ('));
  assert.ok(rate);await rate.onclick();
  assert.deepEqual(JSON.parse(files.get(cardPath).text).map(c=>c.id),priorIds);
  const logs=[...files.values()].filter(f=>f.path.endsWith('.jsonl'));
  assert.equal(logs.length,1);const event=JSON.parse(logs[0].text);
  assert.match(logs[0].path,/\/computer-2026-11.jsonl$/);assert.equal(event.device_id,'computer');
  assert.equal(event.card_id,'card-1');assert.equal(event.kind,'answer');
  assert.match(event.scheduler_config_id,/^[0-9a-f]{64}$/);
  assert.ok(!('scheduler_config' in event));assert.ok(!('scheduler_version' in event));
  const savedConfig=JSON.parse(files.get(`srs/data/scheduler-configs/${event.scheduler_config_id}.json`).text);
  assert.deepEqual(savedConfig.settings.weights,options.weights);
  assert.equal(savedConfig.scheduler_version,'ts-fsrs@5.2.3/FSRS-6');
  assert.ok(!('preset_id' in savedConfig.settings));assert.ok(!('new_cards_per_day' in savedConfig.settings));
  button('Cards').onclick();
  for(let i=0;i<100&&!root.querySelectorAll('input').length;i++)await tick();
  const search=root.querySelectorAll('input').find(e=>e.type==='search');
  assert.ok(search);
  search.value='ready';search.oninput();
  assert.ok(root.querySelectorAll('div').some(e=>e.textContent==='1 matching cards'));
  button('Edited ready').onclick();
  let checkbox=root.querySelectorAll('input').find(e=>e.type==='checkbox');
  const tagsInput=root.querySelectorAll('input').find(e=>e.type==='text');
  checkbox.checked=true;checkbox.onchange();tagsInput.value='focused, focused, hard';tagsInput.oninput();
  await button('Save card settings').onclick();
  let events=logs[0].text.trim().split('\n').map(JSON.parse);
  assert.equal(events.length,2);assert.equal(events[1].kind,'card_settings');
  assert.equal(events[1].card_id,'card-1');assert.deepEqual(events[1].changes,{suspended:true,tags:['focused','hard']});
  assert.ok(!('state' in events[1]));assert.ok(!('import_id' in events[1]));
  const status=root.querySelectorAll('select').find(e=>e.attr['aria-label']==='Card status');
  status.value='suspended';status.onchange();
  assert.ok(root.querySelectorAll('div').some(e=>e.textContent==='1 matching cards'));
  const tagSearch=root.querySelectorAll('input').find(e=>e.type==='search');tagSearch.value='focused';tagSearch.oninput();
  assert.ok(button('Edited ready'),'card-specific tags are searchable');
  checkbox=root.querySelectorAll('input').find(e=>e.type==='checkbox');checkbox.checked=false;checkbox.onchange();
  await button('Save card settings').onclick();
  events=logs[0].text.trim().split('\n').map(JSON.parse);
  assert.deepEqual(events[2].changes,{suspended:false});
  assert.equal(events.filter(e=>e.kind==='answer').length,1,'settings do not create answers');
  assert.deepEqual(JSON.parse(files.get(cardPath).text).map(c=>c.id),priorIds);
  cleanups.forEach(f=>f());
});
