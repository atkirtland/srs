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
    setAttribute(key,value){this.attr[key]=value;}
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
  let cardPath='srs/data/imports/r/cards-00000.json';
  put('srs/data/manifest.json',JSON.stringify(m));put(cardPath,JSON.stringify(cs));put('srs/config.json',JSON.stringify(config));
  put('vocab.csv','anki_note_id,word,definition\n1,broken,\n2,ready,answer\n');
  let scans=0;const reads=[];const listeners=new Map();
  const vaultName=`test-ui-${crypto.randomUUID()}`;
  const vault={getName:()=>vaultName,getFiles:()=>{scans++;return [...files.values()];},getAbstractFileByPath:p=>files.get(p),read:async f=>{reads.push(f.path);return f.text;},
    create:async(p,t)=>put(p,t),modify:async(f,t)=>put(f.path,t),createFolder:async p=>files.set(p,{path:p}),append:async(f,t)=>{f.text+=t;f.stat.mtime++;f.stat.size=f.text.length;},on:(name,fn)=>{listeners.set(name,fn);return ()=>{};}};
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
  assert.equal(reads.filter(p=>p==='vocab.csv').length,0,'homepage does not read or render source content');
  assert.ok(root.querySelectorAll('div').some(e=>e.textContent.includes('3 unchecked')));
  for(const cleanup of cleanups.splice(0))cleanup();root.empty();
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../view.js'),'utf8'),context);
  for(let i=0;i<100&&!button('Review');i++)await tick();
  button('Performance details').onclick();
  const restored=JSON.parse(root.querySelectorAll('div').find(e=>e.textContent.startsWith('{"fileReads"')).textContent.split(' · ')[0]);
  assert.equal(restored.sessionRestores,1,'reopening transfers the prepared runtime');
  assert.equal(restored.schedulingBuilds,0,'reopening does not rebuild scheduling');
  assert.equal(restored.cardPreparations,0,'reopening does not prepare the catalog');
  assert.equal(restored.sourceReads,0,'reopening does not reread source metadata');

  const beforeUnrelated=reads.length;
  listeners.get('modify')({path:'unrelated.md'});await tick();
  assert.equal(reads.length,beforeUnrelated,'unrelated edits cause no data reads');
  const deckSearch=root.querySelectorAll('input').find(e=>e.attr['aria-label']==='Find a deck');
  deckSearch.value='Parent::A';deckSearch.oninput();
  assert.ok(!root.querySelectorAll('summary').some(e=>e.attr['aria-label']==='Other'));
  assert.ok(root.querySelectorAll('summary').some(e=>e.attr['aria-label']==='Parent'));
  assert.ok(root.querySelectorAll('summary').some(e=>e.attr['aria-label']==='Parent::A'));
  assert.ok(root.querySelectorAll('details').some(e=>e.open),'search expands matching ancestors');
  deckSearch.value='nonexistent';deckSearch.oninput();
  assert.ok(root.querySelectorAll('p').some(e=>e.textContent==='No decks match. Try another name.'));
  button('Collapse all').onclick();
  const browse=root.querySelectorAll('button').find(e=>e.attr['aria-label']==='Browse cards in Parent');
  browse.onclick({preventDefault(){}});
  for(let i=0;i<100&&!root.querySelectorAll('select').some(e=>e.attr['aria-label']==='Card deck');i++)await tick();
  assert.equal(root.querySelectorAll('select').find(e=>e.attr['aria-label']==='Card deck').value,'parent');
  assert.ok(root.querySelectorAll('div').some(e=>e.textContent==='2 matching cards'));
  button('Decks').onclick();
  for(let i=0;i<100&&!button('Review');i++)await tick();
  const scansAtHome=scans;const readsAtHome=reads.length;
  // Other sorts before Parent, so open the Parent root explicitly.
  root.querySelectorAll('button').filter(b=>b.textContent==='Review')[1].onclick({preventDefault(){}});
  for(let i=0;i<100&&!button('Rating unavailable');i++)await tick();
  assert.ok(button('Rating unavailable'),'missing fields remain accessible');
  assert.equal(scans-scansAtHome,1,'first selected source is located lazily');
  assert.deepEqual(reads.slice(readsAtHome),['vocab.csv'],'deck opening reads only the selected source');
  assert.ok(root.querySelectorAll('span').some(e=>e.textContent===' · 1 content errors'));
  assert.ok(root.querySelectorAll('summary').some(e=>e.textContent==='Inspect 1 content errors'));
  assert.ok(!root.querySelectorAll('span').some(e=>e.textContent===' · 2 content errors'));
  const scansBeforeBury=scans;
  button('Bury').onclick();
  for(let i=0;i<100&&!button('Show answer');i++)await tick();
  assert.ok(button('Show answer'));
  assert.equal(scans-scansBeforeBury,0,'burying reuses source and review snapshots');
  const warmReads=reads.length;
  button('Performance details').onclick();
  assert.equal(reads.length,warmReads,'performance inspection performs no file reads');
  assert.ok(root.querySelectorAll('div').some(e=>e.textContent.includes('Render selected card')));
  assert.equal([...files.keys()].filter(p=>p.endsWith('.jsonl')).length,0);
  const priorIds=JSON.parse(files.get(cardPath).text).map(c=>c.id);
  config.groups.test.templates[0].front='Edited {{word}}';put('srs/config.json',JSON.stringify(config));
  button('Reload reviewer').onclick();await tick();
  for(let i=0;i<100&&!button('Show answer');i++)await tick();
  button('Show answer').onclick();
  const rate=root.querySelectorAll('button').find(b=>b.textContent.startsWith('Good ('));
  assert.ok(rate);
  const performanceCounts=()=>{button('Performance details').onclick();const notice=root.querySelectorAll('div').find(e=>e.textContent.startsWith('{"fileReads"'));return JSON.parse(notice.textContent.split(' · ')[0]);};
  const beforeAnswer=performanceCounts();await rate.onclick();
  const afterAnswer=performanceCounts();
  assert.equal(afterAnswer.schedulingBuilds,beforeAnswer.schedulingBuilds,'answer updates the existing scheduling index');
  assert.equal(afterAnswer.cardPreparations,beforeAnswer.cardPreparations,'answer does not prepare the catalog again');
  assert.equal(afterAnswer.scheduling.catalogCards,beforeAnswer.scheduling.catalogCards,'answer does not scan catalog cards');
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
  assert.equal(button('Undo review').disabled,false);
  await button('Undo review').onclick();
  assert.equal(files.get(logs[0].path).text,'','undo removes the answer rather than introducing a training observation');
  assert.ok(button('Show answer'),'undone card is available again');
  assert.equal(button('Undo review').disabled,true);
  assert.deepEqual(JSON.parse(files.get(cardPath).text).map(c=>c.id),priorIds);
  button('Show answer').onclick();
  await root.querySelectorAll('button').find(b=>b.textContent.startsWith('Good (')).onclick();
  logs[0]=files.get(logs[0].path);
  const beforeRemote=performanceCounts();
  const remote={...event,id:'99999999-9999-4999-8999-999999999999',card_id:'card-0',review_time_ms:now+1,state:{...event.state,last_review:now+1},parent:`import:import:card-0`};
  logs[0].text+=JSON.stringify(remote)+'\n';logs[0].stat.mtime++;logs[0].stat.size=logs[0].text.length;
  listeners.get('modify')(logs[0]);await new Promise(resolve=>setTimeout(resolve,450));
  const afterRemote=performanceCounts();
  assert.equal(afterRemote.schedulingBuilds,beforeRemote.schedulingBuilds,'remote answers update the existing scheduling index');
  assert.equal(afterRemote.cardPreparations,beforeRemote.cardPreparations,'remote answers do not prepare catalog metadata');
  const logBeforeRefusedUndo=logs[0].text;
  await button('Undo review').onclick();
  assert.equal(logs[0].text,logBeforeRefusedUndo,'undo preserves a log with a subsequent event');
  button('Cards').onclick();
  for(let i=0;i<100&&!root.querySelectorAll('input').length;i++)await tick();
  const search=root.querySelectorAll('input').find(e=>e.type==='search');
  assert.ok(search,JSON.stringify(root.querySelectorAll("div").map(e=>e.textContent).filter(Boolean)));
  search.value='ready';search.oninput();
  assert.ok(root.querySelectorAll('div').some(e=>e.textContent==='1 matching cards'));
  await button('Edited ready').onclick();
  assert.ok(root.querySelectorAll('h5').some(e=>e.textContent==='Question'));
  assert.ok(root.querySelectorAll('h5').some(e=>e.textContent==='Answer'));
  assert.ok(root.querySelectorAll('div').some(e=>e.textContent==='answer'),'editor shows the answer preview');
  let checkbox=root.querySelectorAll('input').find(e=>e.type==='checkbox');
  const tagsInput=root.querySelectorAll('input').find(e=>e.type==='text');
  checkbox.checked=true;checkbox.onchange();tagsInput.value='focused, focused, hard';tagsInput.oninput();
  button('Decks').onclick();
  assert.ok(root.querySelectorAll('div').some(e=>e.textContent.includes('You have unsaved changes')));
  assert.ok(button('Save card settings'),'navigation preserves the unsaved editor');
  await button('Save card settings').onclick();
  let events=logs[0].text.trim().split('\n').map(JSON.parse);
  assert.equal(events.length,3);assert.equal(events[2].kind,'card_settings');
  assert.equal(events[2].card_id,'card-1');assert.deepEqual(events[2].changes,{suspended:true,tags:['focused','hard']});
  assert.ok(!('state' in events[2]));assert.ok(!('import_id' in events[2]));
  const status=root.querySelectorAll('select').find(e=>e.attr['aria-label']==='Card status');
  status.value='suspended';status.onchange();
  assert.ok(root.querySelectorAll('div').some(e=>e.textContent==='1 matching cards'));
  const tagSearch=root.querySelectorAll('input').find(e=>e.type==='search');tagSearch.value='focused';tagSearch.oninput();
  assert.ok(button('Edited ready'),'card-specific tags are searchable');
  checkbox=root.querySelectorAll('input').find(e=>e.type==='checkbox');checkbox.checked=false;checkbox.onchange();
  await button('Save card settings').onclick();
  events=logs[0].text.trim().split('\n').map(JSON.parse);
  assert.deepEqual(events[3].changes,{suspended:false});
  assert.equal(events.filter(e=>e.kind==='answer').length,2,'settings do not create answers');
  assert.deepEqual(JSON.parse(files.get(cardPath).text).map(c=>c.id),priorIds);
  const finalStatus=root.querySelectorAll('select').find(e=>e.attr['aria-label']==='Card status');
  finalStatus.value='errors';finalStatus.onchange();
  const finalDeck=root.querySelectorAll('select').find(e=>e.attr['aria-label']==='Card deck');finalDeck.value='';finalDeck.onchange();
  const finalSearch=root.querySelectorAll('input').find(e=>e.attr['aria-label']==='Search cards');
  finalSearch.value='';finalSearch.oninput();
  const cancelledCheck=button('Check content').onclick();
  await tick();button('Cancel content check').onclick();await cancelledCheck;
  await button('Check content').onclick();
  assert.ok(root.querySelectorAll('div').some(e=>e.textContent==='2 matching cards'));
  const checkedSearch=root.querySelectorAll('input').find(e=>e.attr['aria-label']==='Search cards');checkedSearch.value='not present';checkedSearch.oninput();
  assert.ok(root.querySelectorAll('p').some(e=>e.textContent==='No cards match these filters. Try a different search or deck.'));
  const liveStudy=studyConfiguration(m);
  liveStudy.decks.all={name:'All cards',parent_id:null,filter:{}};
  // Upgrade the open reviewer to separate configuration and note bindings.
  put('srs/config/sources.json',JSON.stringify({format_version:1,rules:{test:{sources:['vocab.csv'],fields:cs[0].source.fields.map(({anki,...f})=>({...f,name:anki}))}}}));
  put('srs/config/cards.json',JSON.stringify({format_version:1,groups:config.groups,rules:{test:{templates:['recognition'],profile:'main'}}}));
  put('srs/config/decks.json',JSON.stringify({format_version:1,decks:liveStudy.decks}));
  put('srs/config/profile-rules.json',JSON.stringify({format_version:1,rules:liveStudy.profile_rules}));
  put('srs/data/profiles.json',JSON.stringify({format_version:1,profiles:liveStudy.profiles,default_profile:'main'}));
  const bindings=cs.map((c,i)=>({id:`note-${i}`,uid:c.note_uid,rule_id:c.group,locator:{kind:'csv',path:'vocab.csv'}}));
  const separated=cs.map(({source,group,note_uid,...c},i)=>({...c,note_id:`note-${i}`}));
  cardPath='srs/data/cards/cards-00000.json';
  put(cardPath,JSON.stringify(separated));put('srs/data/notes/notes-00000.json',JSON.stringify(bindings));
  put('srs/data/manifest.json',JSON.stringify({...m,revision:'r2',catalog_layout:'flat',note_partition_count:1}));
  files.delete('srs/config.json');files.delete('srs/study.json');
  button('Reload reviewer').onclick();
  for(let i=0;i<100&&!button('Profiles');i++)await tick();
  await tick();button('Profiles').onclick();
  for(let i=0;i<100&&!button('Save profile');i++)await tick();
  const retention=root.querySelectorAll('input').find(e=>e.attr['aria-label']==='Main: Desired retention (0–1)');
  assert.ok(retention);retention.value='.91';retention.oninput();
  await button('Save profile').onclick();
  assert.equal(JSON.parse(files.get('srs/data/profiles.json').text).profiles.main.settings.desired_retention,.91);
  assert.deepEqual(JSON.parse(files.get(cardPath).text).map(c=>c.id),priorIds);
  button('Decks').onclick();
  for(let i=0;i<100&&!button('Review');i++)await tick();
  assert.ok(root.querySelectorAll('summary').some(e=>e.attr['aria-label']==='All cards'));
  button('New deck').onclick();
  for(let i=0;i<100&&!button('Save deck');i++)await tick();
  const deckName=root.querySelectorAll('input').find(e=>e.attr['aria-label']==='Deck name');
  const deckPath=root.querySelectorAll('input').find(e=>e.attr['aria-label']==='Deck source paths');
  deckName.value='Vocabulary practice';deckName.oninput();deckPath.value='vocab.csv';deckPath.oninput();
  await button('Save deck').onclick();
  assert.deepEqual(JSON.parse(files.get('srs/config/decks.json').text).decks['vocabulary-practice'].filter,{paths:['vocab.csv']});
  assert.equal(files.has('srs/study.json'),false,'UI saves never recreate the legacy combined configuration');
  assert.ok(root.querySelectorAll('summary').some(e=>e.attr['aria-label']==='Vocabulary practice'),root.querySelectorAll('div').map(e=>e.textContent).join(' | '));
  cleanups.forEach(f=>f());
});

function studyConfiguration(m=manifest()) {
  return {format_version:1,default_profile:'main',profiles:{main:{name:'Main',settings:{...options,minimum_interval:1},reviews_per_day:100,imported_preset:'1'}},
    profile_rules:[{profile:'main',filter:{deck_ids:['a','b','parent']}}],source_rules:{},decks:Object.fromEntries(Object.values(m.scheduling.decks).map(d=>[d.id,{name:d.name,parent_id:d.parent_id,filter:{deck_ids:[d.id],include_children:true}}]))};
}
test('filter study decks preserve imported counts, union overlapping selections and share daily allowances',()=>{
  const cs=cards([0,1,2,0,2]),m=manifest(),config=studyConfiguration(m);
  config.decks.all={name:'All cards',parent_id:null,filter:{}};
  config.decks.overlap={name:'Overlapping',parent_id:null,filter:{any:[{groups:['test']},{templates:['front']}]}};
  cs.forEach((c,i)=>Object.assign(c,{group:'test',template_key:'front',source:{path:i%2?'wiki/b/item.md':'wiki/a/item.md'},card_settings:{tags:i%2?['hard']:[]},properties:{production:i%2===0}}));
  const runtime=SRS.studyRuntimeManifest(m,SRS.validateStudy(config));
  const original=SRS.deckTree(cs,states(cs),m,now)[0];
  const tree=SRS.studyDeckTree(cs,states(cs),runtime,now,[],new Set(),'');
  const parent=tree.find(n=>n.id==='parent'),all=tree.find(n=>n.id==='all'),overlap=tree.find(n=>n.id==='overlap');
  assert.deepEqual([parent.new,parent.learning,parent.review],[original.new,original.learning,original.review]);
  assert.deepEqual([all.new,all.learning,all.review],[overlap.new,overlap.learning,overlap.review],'overlapping filters do not duplicate cards');
  assert.equal(SRS.matchesStudyFilter(cs[1],{all:[{paths:['wiki/b']},{tags:['hard']}],not:{properties:{production:true}}},runtime),true);
  assert.equal(SRS.matchesStudyFilter(cs[1],{properties:{absent:{exists:true}}},runtime),false);
  config.profiles.main.settings.new_cards_per_day=1;
  const capped=SRS.studyRuntimeManifest(m,config),sameDeck=cards([0,0,0]);sameDeck.forEach(c=>c.deck_id='a');
  const activity=[{kind:'answer',card_id:sameDeck[0].id,review_time_ms:now,was_new:true,state:state(1)}];
  const q=SRS.reviewQueueV2(sameDeck,states(sameDeck),activity,capped,now,'',undefined,null,new Set(),c=>c.id===sameDeck[2].id);
  assert.equal(q.fresh,0,'an answer outside the selected filter still consumes the shared allowance');
  assert.deepEqual(m,manifest(),'editable profiles do not mutate the imported manifest');
});
test('profile assignment, explicit card overrides and cloze variants preserve identity and saved memory',()=>{
  const m=manifest(),config=studyConfiguration(m),[card]=cards([2]);
  config.profiles.other={name:'Other',settings:{...options,desired_retention:.95},reviews_per_day:50};
  config.profile_rules.unshift({profile:'other',filter:{tags:['hard']}});
  card.card_settings={tags:['hard']};const runtime=SRS.studyRuntimeManifest(m,SRS.validateStudy(config));
  assert.equal(SRS.studyProfileId(card,config,runtime),'other');
  assert.equal(SRS.effectiveSettings(card,runtime).desired_retention,.95);
  card.card_settings.profile='main';assert.equal(SRS.effectiveSettings(card,runtime).desired_retention,.85);
  assert.equal(card.id,'card-0');assert.equal(card.baseline.stability,5);
  assert.throws(()=>SRS.validateStudyFilter({typo:['x']}),/Unknown filter/);
  assert.throws(()=>SRS.validateStudy({...config,decks:{a:{name:'A',parent_id:'a',filter:{}}}}),/cycle/);
  const cloze={...card,group:'test',template_key:'cloze',anki_notetype:'Cloze',anki_ordinal:2,cloze:true};
  const templates={format_version:1,groups:{test:{templates:[{key:'cloze',enabled:true,required_fields:[],front:'{{cloze:Text}}',back:'{{cloze:Text}}',anki_notetype:'Cloze',anki_ordinal:0}]}}};
  assert.equal(SRS.configuredCards([cloze],templates)[0].id,card.id);
  assert.equal(SRS.renderV2('{{cloze:Text}}',{Text:'{{c1::one}} and {{c3::three}}'},2,false),'one and […]');
  assert.throws(()=>SRS.configuredCards([{...cloze,cloze:false}],templates),/binding changed/);
  const event={format_version:2,kind:'card_settings',id:crypto.randomUUID(),device_id:'computer',card_id:card.id,time_ms:now,changes:{profile:'other'}};
  assert.equal(SRS.validateEvent(event,'import'),event);
  assert.throws(()=>SRS.validateEvent({...event,changes:{profile:7}},'import'),/Invalid profile/);
});

test('local and imported Markdown callouts resolve stable block identities',()=>{
  const uuid=crypto.randomUUID();
  const text=`> [!srs] Local question\n> Local answer\n> #tag\n<!-- SRS-ID: ${uuid} -->\n\n> [!anki] Old question\n> Old answer\n<!-- ID: 123 -->\n`;
  const blocks=SRS.sourceBlocks(text);
  assert.deepEqual(blocks,[{identity:`local:${uuid}`,front:'Local question',back:'Local answer',tags:['tag']},{identity:'anki:123',front:'Old question',back:'Old answer',tags:[]}]);
});

test('separate configuration and note bindings reproduce scheduling and render multiple cards',()=>{
  const m=manifest(),combined=studyConfiguration(m);
  const parts={profiles:{format_version:1,profiles:combined.profiles,default_profile:combined.default_profile},
    sources:{format_version:1,rules:{words:{sources:['words.csv'],fields:[{name:'Front',source:'word',transform:'text',required:true},{name:'Back',source:'definition',transform:'text',required:true}]}}},
    cards:{format_version:1,groups:{},rules:{words:{templates:['forward','reverse'],profile:'main'}}},
    decks:{format_version:1,decks:combined.decks},assignments:{format_version:1,rules:combined.profile_rules}};
  const config=SRS.composeStudyDocuments(parts);
  const original=cards([0,1,2]);
  const raw=original.map((c,i)=>({...c,note_id:'note',template_key:i===0?'forward':'reverse'}));
  const notes=[{id:'note',uid:'anki:12',rule_id:'words',locator:{path:'words.csv',kind:'csv'}}];
  const hydrated=SRS.hydrateCatalog(raw,notes,config);
  assert.deepEqual(hydrated.map(c=>c.id),original.map(c=>c.id));
  assert.deepEqual(SRS.deckTree(hydrated,states(hydrated),m,now),SRS.deckTree(original,states(original),m,now));
  assert.equal(hydrated[0].source.fields[0].anki,'Front');
  const fields=SRS.fieldsFromNote({...hydrated[0],template:{required_fields:['Front','Back']}},{metadata:{word:'spume',definition:'foam'},body:'',filename:'words',lookups:{}});
  assert.equal(SRS.renderV2('{{Front}}',fields,0,false),'spume');
  parts.sources.rules.words.fields[0].source='another';
  const changed=SRS.hydrateCatalog(raw,notes,SRS.composeStudyDocuments(parts));
  assert.equal(changed[0].source.fields[0].source,'another');
  assert.equal(changed[0].id,raw[0].id);
  assert.equal(raw[0].source,undefined);
  assert.throws(()=>SRS.hydrateCatalog(raw,[],config),/Missing SRS note binding/);
  const broken=SRS.hydrateCatalog(raw,notes,{source_rules:{}});
  assert.match(broken[0].source.error,/Missing source rule/);
  assert.equal(SRS.deckTree(broken,states(broken),m,now)[0].review,1);
});

test('blocks prefer existing Anki IDs across blank lines and inserted SRS IDs',()=>{
  const text=' > [!anki]- Question\n > #oa/example-topic\n<!-- SRS-ID: 33333333-3333-4333-8333-333333333333 -->\n \n<!--ID: 1002-->\n';
  const blocks=SRS.sourceBlocks(text);
  assert.equal(blocks.length,1);
  assert.equal(blocks[0].identity,'anki:1002');
  assert.equal(blocks[0].front,'Question');
  assert.equal(blocks[0].back,'');
});


test('retired conversion cards stay out of queues, counts and template validation',()=>{
  const cs=cards([0,1,2]),m=manifest(),config=studyConfiguration(m);
  config.decks.all={name:'All',parent_id:null,filter:{}};
  cs.forEach(c=>Object.assign(c,{retired:true,group:'old',template_key:'front',anki_notetype:'Old',anki_ordinal:0,content_error:'Retired template'}));
  const template={key:'front',enabled:true,required_fields:[],front:'front',back:'back',anki_notetype:'New',anki_ordinal:1};
  assert.doesNotThrow(()=>SRS.configuredCards(cs,{format_version:1,groups:{old:{templates:[template]}}}));
  assert.ok(SRS.configuredCards(cs,{format_version:1,groups:{}}).every(c=>!c.active));
  const runtime=SRS.studyRuntimeManifest(m,config);
  const tree=SRS.studyDeckTree(cs,states(cs),runtime,now,[],new Set(),'');
  for(const id of ['parent','all']){
    const node=tree.find(n=>n.id===id);
    assert.deepEqual([node.new,node.learning,node.review,node.total,node.errors],[0,0,0,0,0]);
  }
  assert.equal(SRS.reviewQueueV2(cs,states(cs),[],runtime,now).cards.length,0);
});

test('membership index equals recursive filters for parents, overlaps and retired cards',()=>{
  const m=manifest(),config=studyConfiguration(m),cs=cards([0,1,2,0]);
  config.decks.first={name:'First',parent_id:null,filter:{groups:['one']}};
  config.decks.second={name:'Second',parent_id:'first',filter:{tags:['special']}};
  cs.forEach((c,i)=>Object.assign(c,{group:i%2?'two':'one',card_settings:{tags:i===1?['special']:[]}}));
  cs[3].retired=true;
  const members=SRS.studyMemberships(cs,config,m);
  for(const id of Object.keys(config.decks))for(const card of cs)assert.equal(members.get(id).has(card.id),SRS.studyDeckMatches(card,id,config,m));
  const runtime=SRS.studyRuntimeManifest(m,config),states=new Map(cs.map(c=>[c.id,{state:c.baseline}]));
  assert.deepEqual(SRS.studyDeckTree(cs,states,runtime,now,[],new Set(),'',members),SRS.studyDeckTree(cs,states,runtime,now,[],new Set(),''));
});

test('catalog reads are limited to four, preserve partition order and reject incomplete snapshots',async()=>{
  let active=0,peak=0;
  const paths=Array.from({length:11},(_,i)=>i);
  const result=await SRS.readCatalogPartitions(paths,async i=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,(11-i)%4));active--;return [i];});
  assert.deepEqual(result,paths);assert.equal(peak,4);assert.equal(active,0);
  await assert.rejects(SRS.readCatalogPartitions(paths,async i=>{if(i===2)throw Error('missing partition');return [i];}),/missing partition/);
  assert.deepEqual(await SRS.readCatalogPartitions([],async()=>assert.fail('unexpected read')),[]);
});

 test('vault image embeds render inside HTML templates using source-relative Obsidian resolution',()=>{
  const source='wiki/places/jp/regions/Okinawa.md',image={path:'attachments/japanese-region-maps/Okinawa.png'};
  const resolve=(target,from)=>{assert.equal(target,image.path);assert.equal(from,source);return image;};
  const fields={Map:SRS.transformField('image','![[attachments/japanese-region-maps/Okinawa.png]]',{})};
  const front=SRS.renderV2('<div class="map">{{Map}}</div>',fields);
  assert.equal(SRS.resolveImageEmbeds(front,source,resolve,()=> 'app://vault/Okinawa.png?a=1&b=2'),
    '<div class="map"><img src="app://vault/Okinawa.png?a=1&amp;b=2" alt="Okinawa.png"></div>');
  assert.equal(SRS.resolveImageEmbeds('![[photo.png|200x100]]',source,()=>image,()=> 'vault:image'),
    '<img src="vault:image" alt="photo.png" width="200" height="100">');
  assert.equal(SRS.resolveImageEmbeds('![[sound.mp3]] ![[note#block]]',source,()=>{throw Error('unexpected lookup');}), '![[sound.mp3]] ![[note#block]]');
  assert.throws(()=>SRS.resolveImageEmbeds('![[missing.png]]',source,()=>null),/Missing vault image: missing.png/);
 });

test('maintained counts and next-card queries match the reference across filters, limits and queue states',()=>{
  let seed=8191;const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  for(let trial=0;trial<20;trial++){
    const m=manifest();m.scheduling.collection.applyAllParentLimits=Boolean(trial%2);
    m.scheduling.collection.newCardsIgnoreReviewLimit=Boolean(trial%3);
    m.scheduling.decks.parent.normal.new_limit=rand(20);m.scheduling.decks.parent.normal.review_limit=rand(35);
    m.scheduling.decks.a.normal.new_limit_today={today:day,limit:rand(10)};
    m.scheduling.decks.b.common={last_day_studied:day,new_studied:rand(5),review_studied:rand(5)};
    m.scheduling.decks.other={id:'other',name:'Other',parent_id:null,normal:{config_id:'1'},common:{}};
    const cs=Array.from({length:100},(_,i)=>{
      const q=[0,1,2,3,-1,-2,4][rand(7)],c=cards([q])[0];c.id=`c-${i}`;c.deck_id=['a','b','other'][rand(3)];c.group=['x','y'][rand(2)];
      c.baseline={...state(q),queue:q,anki_due:day+rand(3)-1,due:now+(rand(7)-3)*600000};c.anki_due=rand(100);c.retired=i===0;
      if(i%17===0)c.content_error='Missing field';if(i%13===0)c.card_settings={suspended:true};return c;
    });
    m.study={decks:{all:{name:'All',parent_id:null,filter:{groups:[]}},x:{name:'X',parent_id:'all',filter:{groups:['x']}},subset:{name:'Subset',parent_id:null,filter:{deck_ids:['a']}},other:{name:'Other',parent_id:null,filter:{deck_ids:['other']}}}};
    const st=states(cs),memberships=SRS.studyMemberships(cs,m.study,m),idx=new SRS.SchedulingIndex(cs,st,m,[],now,memberships);
    const flatten=tree=>tree.flatMap(n=>[n,...flatten(n.children)]);
    for(const group of ['', 'x','y']){
      const reference=flatten(SRS.studyDeckTree(cs,st,m,now,[],new Set(),group,memberships));
      const actual=new Map(flatten(idx.tree(group)).map(n=>[n.id,n]));
      for(const n of reference){
        assert.deepEqual(['new','learning','review','total','errors'].map(k=>actual.get(n.id)[k]),['new','learning','review','total','errors'].map(k=>n[k]),`counts ${trial}/${group}/${n.id}`);
        const expected=SRS.reviewQueueV2(cs,st,[],m,now,group,undefined,null,new Set(),c=>memberships.get(n.id).has(c.id));
        assert.equal(idx.queue(n.id,group).cards[0]?.id,expected.cards[0]?.id,`next ${trial}/${group}/${n.id}`);
      }
    }
    // Once built, navigation and one-card changes cannot enumerate the catalog.
    const scans=idx.stats.catalogCards;
    idx.cards[Symbol.iterator]=()=>{throw Error('catalog iteration');};
    const changed=cs.find(c=>!c.retired),next={state:{...changed.baseline,queue:2,anki_due:day+10,due:now+10*86400000}};
    st.set(changed.id,next);idx.update(changed,next);
    idx.tree();idx.queue('all');assert.equal(idx.stats.catalogCards,scans);
    const ref=flatten(SRS.studyDeckTree(cs,st,m,now,[],new Set(),'',memberships));
    for(const n of ref)assert.deepEqual(['new','learning','review'].map(k=>idx.counts(n.id)[k]),['new','learning','review'].map(k=>n[k]));
  }
});

test('incremental answers, shared allowances, Bury and availability boundaries preserve counts',()=>{
  const m=manifest(),cs=cards([0,0,1,2]);cs.forEach(c=>c.group='x');
  cs[2].baseline.due=now+1200001;
  m.scheduling.decks.parent.normal.new_limit=1;
  m.study={decks:{a:{name:'A',parent_id:null,filter:{deck_ids:['a']}},b:{name:'B',parent_id:null,filter:{deck_ids:['b']}},all:{name:'All',parent_id:null,filter:{groups:['x']}}}};
  const st=states(cs),memberships=SRS.studyMemberships(cs,m.study,m),idx=new SRS.SchedulingIndex(cs,st,m,[],now,memberships);
  const unchanged={...idx.counts('all')};const first=idx.queue('all').cards[0];idx.bury(first.id);
  assert.deepEqual(idx.counts('all'),unchanged);assert.notEqual(idx.queue('all').cards[0]?.id,first.id);
  assert.ok(idx.advance(now+2));assert.equal(idx.counts('all').learning,1);
  const next={...cs[0].baseline,state:1,queue:1,due:now+60000};
  const event={...answer('77777777-7777-4777-8777-777777777777',now+2),card_id:cs[0].id,state:next,was_new:true};
  idx.update(cs[0],{state:next,parent:event.id},event);
  const reference=SRS.studyDeckTree(cs,st,m,now+2,[event],new Set(),'',memberships);
  for(const n of reference)assert.deepEqual(['new','learning','review'].map(k=>idx.counts(n.id)[k]),['new','learning','review'].map(k=>n[k]));
  assert.equal(idx.advance(now+86400000),false,'rollover requests a scheduling rebuild');
});


test('block topic filters partition nested Obsidian and Anki tags',()=>{
  const math={any:[{tag_prefixes:['oa/math']},{tag_prefixes:['oa/cs']}]};
  const proof={tag_prefixes:['proof']};
  const filters=[{all:[math,{not:proof}]},proof,{all:[{not:math},{not:proof}]}];
  for(const [tags,expected] of [
    [['oa/math/categories'],0],[['oa::cs::algorithms'],0],[['oa/math','proof'],1],
    [['proof/subtype'],1],[['oa/example-topic'],2],[['oa/mathematics'],2],[[],2]]){
    const card={source_tags:tags};
    assert.deepEqual(filters.map(f=>SRS.matchesStudyFilter(card,f,{})),[0,1,2].map(i=>i===expected));
    filters.forEach(f=>SRS.validateStudyFilter(f));
  }
});

test('template JavaScript requires explicit opt-in and runs on the displayed side',()=>{
  const template='<div id="sentence">{{Sentence}}</div><script>document.getElementById("sentence").textContent += "!";</script>';
  assert.throws(()=>SRS.renderV2(template,{Sentence:'hello'}),/JavaScript/);
  assert.throws(()=>SRS.renderV2(template,{Sentence:'hello'},0,false,{allow_javascript:'true'}),/JavaScript/);
  const rendered=SRS.renderV2(template,{Sentence:'hello'},0,false,{allow_javascript:true});
  assert.throws(()=>SRS.templateScriptParts(rendered),/disabled/);
  const {html,scripts}=SRS.templateScriptParts(rendered,true);
  assert.equal(html,'<div id="sentence">hello</div>');
  const node={id:'sentence',textContent:'hello'};
  const side={querySelectorAll:()=>[node]};
  SRS.runTemplateScripts(side,scripts,{});
  assert.equal(node.textContent,'hello!');
  assert.throws(()=>SRS.templateScriptParts('<script src="a.js"></script>',true),/External/);
});

test('Chinese template highlighting handles blank and quoted target words',()=>{
  const template={front:`<div id="exampleSentence">{{Example Sentence}}</div>
<span class="srs-highlight-word" hidden>{{Word}}</span>
<script>
const word = document.querySelector('.srs-highlight-word').textContent;
const sentence = document.getElementById('exampleSentence');
if (word && sentence) sentence.textContent = sentence.textContent.replace(word, () => '（' + word + '）');
</script>`};
  for(const word of ['', '他', '"$&']) {
    const sentence={id:'exampleSentence',textContent:`${word}說${word}`};
    const target={textContent:word};
    const fields={Word:word,'Example Sentence':sentence.textContent,Deck:'',Tags:''};
    const {scripts}=SRS.templateScriptParts(SRS.renderV2(template.front,fields,0,false,{allow_javascript:true}),true);
    const side={querySelector:()=>target,querySelectorAll:()=>[sentence]};
    SRS.runTemplateScripts(side,scripts,{});
    assert.equal(sentence.textContent,word?`（${word}）說${word}`:'說');
  }
});

test('background redraws wait for content checking to finish without cancelling the scan',async()=>{
  const source=fs.readFileSync(require('node:path').join(__dirname,'../browser/browser-view.js'),'utf8');
  const scan=source.slice(source.indexOf('    async function checkContent('),source.indexOf('    checkButton.onclick='));
  const draw=source.slice(source.indexOf('    async function guardedDraw()'),source.indexOf('\n',source.indexOf('    async function guardedDraw()')));
  const sandbox={setTimeout,checked:[],draws:0};
  vm.createContext(sandbox);
  vm.runInContext(`let checking=false,busy=false,managerDirty=false,disposed=false,operation=0,pending=false;
    let selectedDeck=null,readyEpoch=-1;const sessionCache={epoch:0};const managing=false,managerDeck=null,notice={},select={value:""};
    const scanProgress={active:false,results:new Map(),save(){}};function bindScanProgress(){}
    async function readSources(){return Array.from({length:80},(_,id)=>({id}));}
    function inScope(){return true;}
    async function rendered(card){checked.push(card.id);await guardedDraw();return card;}
    async function draw(){draws++;}
    function message(e){throw e;}function clearCard(){}function scheduleRefresh(){throw Error('Unexpected repeated redraw');}
    ${scan}\n${draw}\n globalThis.run=checkContent;`,sandbox);
  await sandbox.run();
  assert.equal(sandbox.checked.length,80);
  assert.equal(sandbox.draws,1);
  assert.equal(vm.runInContext('checking',sandbox),false);
});

test('scheduled wakeups preserve a running scan and unsaved edits, then refresh when idle',()=>{
  const source=fs.readFileSync(require('node:path').join(__dirname,'../browser/browser-view.js'),'utf8');
  const timer=source.split('\n').find(line=>line.includes('component.registerInterval(setInterval('));
  const sandbox={Date,callbacks:[],draws:0,setInterval:fn=>{sandbox.callbacks.push(fn);},component:{registerInterval(){}},dayNumber:()=>1};
  vm.createContext(sandbox);
  vm.runInContext(`let manifest={timing:{}},shown=null,checking=true,busy=false,managerDirty=false,nextWake=0,timeKey='1';function guardedDraw(){draws++;}${timer.slice(0,timer.indexOf('await guardedDraw();'))}`,sandbox);
  sandbox.callbacks[0]();assert.equal(sandbox.draws,0);
  assert.equal(vm.runInContext('nextWake',sandbox),0);
  vm.runInContext('checking=false;managerDirty=true',sandbox);
  sandbox.callbacks[0]();assert.equal(sandbox.draws,0);
  vm.runInContext('managerDirty=false',sandbox);
  sandbox.callbacks[0]();assert.equal(sandbox.draws,1);
  sandbox.callbacks[0]();assert.equal(sandbox.draws,1);
});

test('content errors group by category, card type and exact error with deterministic card order',()=>{
 const input=[
  {id:'3',group:'z',anki_notetype:'Basic',content_error:'Missing field'},
  {id:'2',note_uid:'anki:2',group:'a',anki_notetype:'Basic',content_error:'Missing field'},
  {id:'1',note_uid:'anki:1',group:'a',anki_notetype:'Basic',content_error:'Missing field'},
  {id:'4',group:'a',anki_notetype:'Cloze',content_error:'Missing field'},
  {id:'5',group:'a',anki_notetype:'Basic',content_error:'Missing image'},
  {id:'6',group:'a'}];
 const grouped=SRS.groupContentErrors(input);
 assert.deepEqual(grouped.map(c=>c.category),['a','z']);
 assert.deepEqual(grouped[0].groups.map(g=>[g.type,g.error,g.cards.length]),[['Basic','Missing field',2],['Basic','Missing image',1],['Cloze','Missing field',1]]);
 assert.deepEqual(grouped[0].groups[0].cards.map(c=>c.id),['1','2']);
 assert.equal(input[0].id,'3');
});

test('president terms provide fields, preserve multiple terms and derive adjacent presidents',()=>{
 const notes=[{path:'washington.md',filename:'washington',metadata:{name:'George Washington',terms:[{order:1}]}},
 {path:'adams.md',filename:'adams',metadata:{name:'John Adams',hometown:'Massachusetts',terms:[{order:2,dates:'1797-03-04–1801-03-04',term_years:'1797–1801',party:'Federalist',vice_presidents:['Thomas Jefferson']}]}},
 {path:'jefferson.md',filename:'jefferson',metadata:{name:'Thomas Jefferson',terms:[{order:3},{order:4}]}}];
 const prepared=SRS.preparePresidents(notes),adams=prepared.get('adams.md');
 assert.equal(adams.Order,'2');assert.equal(adams['Vice President(s)'],'Thomas Jefferson');
 assert.equal(adams.Term,'1797-03-04–1801-03-04');assert.equal(adams['Term Years'],'1797–1801');
 assert.equal(adams.Party,'Federalist');assert.equal(adams.Predecessor,'George Washington');assert.equal(adams.Successor,'Thomas Jefferson');
 assert.equal(prepared.get('jefferson.md').Order,'3, 4');
 assert.equal(prepared.get('washington.md').Predecessor,'None');
 assert.equal(prepared.get('jefferson.md').Successor,'None');
 assert.equal(notes[1].metadata.Order,undefined);
 assert.throws(()=>SRS.preparePresidents([...notes,{path:'bad.md',metadata:{name:'Other',terms:[{order:2}]}}]),/Duplicate president order/);
});

test('poetry uses its filename without an alias; Chinese CSV preserves a genuinely blank answer',()=>{
 assert.equal(SRS.transformField('title_or_filename',undefined,{filename:'憫農'}),'憫農');
 assert.equal(SRS.transformField('title_or_filename',[],{filename:'憫農'}),'憫農');
 assert.equal(SRS.transformField('title_or_filename',['Other title'],{filename:'憫農'}),'Other title');
 const rows=SRS.indexRows(SRS.parseCSV('anki_note_id,tags,name_en,name_zh,pronunciation,definition\n1003,example oa::managed::list,example-term,,,example definition\n1004,chinese,example root,示例,,\n'));
 assert.equal(rows.get('anki:1004').name_zh,'示例');
 assert.throws(()=>SRS.fieldsFromNote({source:{fields:[{anki:'word2',source:'name_zh',transform:'comma_separated_labels',required:true}]},template:{required_fields:['word2']}},{metadata:rows.get('anki:1003')}),/Missing required field: word2/);
});

test('content check checkpoints survive view replacement, resume unfinished work and invalidate changed sources',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
 let progress=new SRS.ContentCheckProgress(storage,'scan');progress.bind('catalog/config/source-versions');
 progress.active=true;progress.deck='deck';progress.group='vocab';
 progress.results.set('valid',null);progress.results.set('broken','Missing required field: definition');progress.save();
 progress=new SRS.ContentCheckProgress(storage,'scan');progress.bind('catalog/config/source-versions');
 assert.equal(progress.active,true);assert.equal(progress.deck,'deck');assert.equal(progress.group,'vocab');
 assert.equal(progress.results.has('valid'),true);assert.equal(progress.results.get('broken'),'Missing required field: definition');
 assert.equal(progress.results.has('unfinished'),false);
 progress.active=false;progress.save();
 assert.equal(new SRS.ContentCheckProgress(storage,'scan').active,false);
 progress.bind('changed-source-version');assert.equal(progress.results.size,0);assert.equal(progress.active,false);
 progress.results.set('old',null);progress.invalidate();
 assert.equal(new SRS.ContentCheckProgress(storage,'scan').results.size,0);
 const denied=new SRS.ContentCheckProgress({getItem(){throw Error('Denied');},setItem(){throw Error('Denied');}},'scan');
 denied.bind('version');denied.save();
});

test('an interrupted content scan resumes from completed cards after the view is recreated',async()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../browser/browser-view.js'),'utf8');
 const scan=source.slice(source.indexOf('    async function checkContent('),source.indexOf('    checkButton.onclick='));
 const saved=new Map(),storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},checked=[];
 async function run(interrupt){
  const progress=new SRS.ContentCheckProgress(storage,'resume');progress.bind('same-sources');
  const sandbox={setTimeout,scanProgress:progress,checked,interrupt};vm.createContext(sandbox);
  vm.runInContext(`let checking=false,busy=false,managerDirty=false,disposed=false,operation=0,pending=false,selectedDeck=null;
    const managing=false,managerDeck=null,notice={},select={value:'vocab'};
    function bindScanProgress(){}function inScope(){return true;}
    async function readSources(){return Array.from({length:60},(_,id)=>({id}));}
    async function rendered(card){
      if(interrupt&&card.id===20){scanProgress.save();disposed=true;operation++;return card;}
      checked.push(card.id);return card.id===5?{...card,content_error:'Missing field'}:card;
    }
    function message(e){throw e;}async function guardedDraw(){}
    ${scan}\nglobalThis.run=checkContent;`,sandbox);
  await sandbox.run();return progress;
 }
 const first=await run(true);assert.equal(first.active,true);assert.equal(first.results.size,20);
 const resumed=await run(false);assert.equal(resumed.active,false);assert.equal(resumed.results.size,60);
 assert.equal(checked.length,60);assert.equal(new Set(checked).size,60);
 assert.equal(resumed.results.get(5),'Missing field');
});

test('metadata loading is restricted by catalog constraints and nested boolean filters',()=>{
 const c={id:'c',group:'vocab',template_key:'read',source:{path:'words.csv'}};
 const needs=q=>SRS.studyFilterNeedsMetadata(c,q,manifest());
 assert.equal(needs({groups:['blocks'],tags:['proof']}),false);
 assert.equal(needs({all:[{groups:['blocks']},{tags:['proof']}]}),false);
 assert.equal(needs({all:[{groups:['vocab']},{tags:['proof']}]}),true);
 assert.equal(needs({any:[{groups:['vocab']},{tags:['proof']}]}),false);
 assert.equal(needs({not:{all:[{groups:['blocks']},{properties:{x:1}}]}}),false);
 assert.equal(needs({not:{tags:['proof']}}),true);
 assert.equal(needs({paths:['elsewhere'],properties:{x:1}}),false);
 assert.equal(needs({groups:['vocab']}),false);
 assert.equal(needs({tags:[],properties:{}}),false);
});

test('catalog cache survives reopening, invalidates changed files, and tolerates unavailable storage',async()=>{
 const name=`catalog-${crypto.randomUUID()}`;
 let reads=0;const load=async()=>{reads++;return [{id:String(reads)}];};
 let cache=await SRS.CatalogCache.open(name,indexedDB);
 assert.equal((await cache.read('cards','mtime-1',load))[0].id,'1');cache.close();
 cache=await SRS.CatalogCache.open(name,indexedDB);
 assert.equal((await cache.read('cards','mtime-1',load))[0].id,'1');assert.equal(reads,1);
 assert.equal((await cache.read('cards','mtime-2',load))[0].id,'2');
 await assert.rejects(cache.read('cards','mtime-3',async()=>{throw Error('missing partition');}),/missing partition/);
 assert.equal((await cache.read('cards','mtime-2',load))[0].id,'2');
 await cache.clear();await cache.read('cards','mtime-2',load);assert.equal(reads,3);cache.close();
 const unavailable=await SRS.CatalogCache.open(name,{open(){throw Error('denied');}});
 await unavailable.read('cards','same',load);await unavailable.read('cards','same',load);assert.equal(reads,5);
 const noStats=await SRS.CatalogCache.open(name,indexedDB);
 await noStats.read('cards',null,load);await noStats.read('cards',null,load);assert.equal(reads,7);noStats.close();
});

test('session cache transfers ownership and invalidates on every vault/metadata change',()=>{
 const events=new Map(),metadataEvents=new Map();
 const vault={on:(event,fn)=>events.set(event,fn)},metadata={on:(event,fn)=>metadataEvents.set(event,fn)};
 const cache=SRS.ReviewerSessionCache.forVault(vault,metadata);
 assert.equal(SRS.ReviewerSessionCache.forVault(vault,metadata),cache);
 const value={index:'prepared'};cache.save('srs',cache.epoch,value);
 assert.equal(cache.take('srs'),value);assert.equal(cache.take('srs'),undefined);
 for(const notify of [...events.values(),...metadataEvents.values()]){
  const old=cache.epoch;cache.save('srs',old,value);notify({path:'changed'});
  assert.equal(cache.take('srs'),undefined);cache.save('srs',old,value);assert.equal(cache.take('srs'),undefined);
 }
});

test('reused scheduling index advances learning availability and clears session buries',()=>{
 const m=manifest(),cs=cards([0,0,1]);
 const states=new Map(cs.map(c=>[c.id,{state:c.baseline}]));
 const index=new SRS.SchedulingIndex(cs,states,m,[],now);
 const first=index.queue().cards[0];assert.ok(first);
 const counts=index.counts();index.bury(first.id);index.clearBuried();
 assert.equal(index.queue().cards[0].id,first.id);
 assert.deepEqual(index.counts(),counts);
 const later=now+60*60*1000;assert.equal(index.advance(later),true);
 const fresh=new SRS.SchedulingIndex(cs,states,m,[],later);
 assert.deepEqual(index.counts(),fresh.counts());
 assert.deepEqual(index.queue().cards.map(c=>c.id),fresh.queue().cards.map(c=>c.id));
 assert.equal(index.advance(now+86400000),false,'rollover requires a rebuild');
});

function importedHistory(count){
  return Array.from({length:count},(_,i)=>({format_version:2,kind:'historical_review',id:`anki:col:${i+1}`,collection_key:'col',anki_revlog_id:String(i+1),device_id:device,card_id:'card-0',review_time_ms:i+1,original_review:{id:i+1}}));
}
test('interrupted review indexing resumes inside a log after reopening without replaying committed batches',async()=>{
  const name=`resume-${crypto.randomUUID()}`,events=importedHistory(1200),text=events.map(e=>JSON.stringify(e)+'\n').join('');
  const files=[{path:'history',stat:{mtime:1,size:text.length}}],known=new Set(['card-0']);
  let index=await SRS.ReviewIndex.open(name,'import',timing,indexedDB);
  await assert.rejects(()=>index.sync(files,()=>text,known,{progress:n=>{if(n===500)throw Error('view reloaded');}}),/view reloaded/);
  assert.equal((await index.historyFor('card-0')).length,500);
  assert.equal((await index.get('files','history')).complete,false);
  index.close();index=await SRS.ReviewIndex.open(name,'import',timing,indexedDB);
  const resumed=await index.sync(files,()=>text,known);
  assert.equal(resumed.parsed,700);
  assert.equal((await index.historyFor('card-0')).length,1200);
  assert.equal((await index.sync(files,()=>assert.fail('unchanged file read'),known)).readFiles,0);
  index.close();
});
test('partial review checkpoints detect rewritten prefixes and retain full rebuild behavior',async()=>{
  const index=await SRS.ReviewIndex.open(`rewrite-${crypto.randomUUID()}`,'import',timing,indexedDB);
  const events=importedHistory(600),known=new Set(['card-0']);
  let text=events.map(e=>JSON.stringify(e)+'\n').join('');
  const files=()=>[{path:'history',stat:{mtime:1,size:text.length}}];
  await assert.rejects(()=>index.sync(files(),()=>text,known,{progress:()=>{throw Error('interrupted');}}),/interrupted/);
  events[0].review_time_ms=99;text=events.map(e=>JSON.stringify(e)+'\n').join('');
  const result=await index.sync(files(),()=>text,known);
  assert.equal(result.rebuilt,true);assert.equal(result.parsed,600);
  assert.equal((await index.historyFor('card-0')).find(e=>e.id===events[0].id).review_time_ms,99);
  index.close();
});
test('bulk historical indexing still rejects conflicts atomically and preserves deduplication',async()=>{
  const index=await SRS.ReviewIndex.open(`bulk-${crypto.randomUUID()}`,'import',timing,indexedDB),known=new Set(['card-0']);
  const [one,two]=importedHistory(2),different={...one,review_time_ms:99};
  await assert.rejects(()=>index.ingest([one,different],known),/Conflicting/);
  assert.equal((await index.historyFor('card-0')).length,0);
  await index.ingest([one,one],known);
  assert.equal((await index.historyFor('card-0')).length,1);
  await assert.rejects(()=>index.ingest([two,different],known),/Conflicting/);
  assert.equal((await index.historyFor('card-0')).length,1);
  index.close();
});

test('catalog journal recovers interrupted writes and rejects conflicting manifests',async()=>{
  const files=new Map([['data/manifest.json',JSON.stringify({revision:'a'})]]);
  let fail=true;
  const storage={read:async p=>files.get(p)??null,remove:async p=>files.delete(p),write:async(p,t)=>{if(p.includes('cards/')&&fail){fail=false;throw Error('interrupted');}files.set(p,t);}};
  const publisher=new SRS.CatalogPublisher(storage,'data');
  await assert.rejects(publisher.publish({revision:'a'},{revision:'b'},{'notes/notes-00000.json':[{id:'n'}],'cards/cards-00000.json':[{id:'c',note_id:'n'}]}),/interrupted/);
  assert.equal(JSON.parse(files.get('data/manifest.json')).revision,'a');
  assert.equal(await publisher.recover(),true);
  assert.equal(JSON.parse(files.get('data/manifest.json')).revision,'b');
  assert.equal(await publisher.recover(),false);
  await assert.rejects(publisher.publish({revision:'a'},{revision:'c'},{}),/changed/);
  await assert.rejects(publisher.publish({revision:'b'},{revision:'c'},{'../bad':[]}),/partition/);
});

function maintenanceFixture(){
  const files=new Map(),reads=[],writes=[];let clock=1;
  const put=(path,text)=>files.set(path,{text:typeof text==='string'?text:JSON.stringify(text),mtime:clock++});
  const rule={sources:['words.csv'],profile:'p',templates:['read'],fields:[{name:'Front',source:'word',transform:'text'}]};
  const template={key:'read',enabled:true,anki_notetype:'Basic',anki_ordinal:0,front:'{{Front}}',back:'',required_fields:['Front']};
  put('srs/config/sources.json',{format_version:1,rules:{words:rule}});
  put('srs/config/cards.json',{format_version:1,rules:{words:{profile:'p',templates:['read']}},groups:{words:{templates:[template]}}});
  put('srs/config/decks.json',{format_version:1,decks:{}});put('srs/config/profile-rules.json',{format_version:1,rules:[]});
  put('srs/data/profiles.json',{format_version:1,default_profile:'p',profiles:{p:{settings:options,reviews_per_day:200}}});
  put('srs/data/manifest.json',{...manifest(),revision:'initial',catalog_layout:'flat',partition_count:1,note_partition_count:1});put('srs/data/cards/cards-00000.json',[]);put('srs/data/notes/notes-00000.json',[]);
  put('words.csv','anki_note_id,word\n1,one\n');
  const info=(path,f)=>({path,file:true,mtime:f.mtime,size:f.text.length});
  const io={read:async path=>{reads.push(path);return files.get(path)?.text??null;},write:async(path,text)=>{writes.push(path);put(path,text);},remove:async path=>files.delete(path),files:()=>[...files].map(([p,f])=>info(p,f)),stat:path=>files.has(path)?info(path,files.get(path)):[...files.keys()].some(p=>p.startsWith(path+'/'))?{path,file:false}:null,
    metadata:async(path,text)=>JSON.parse(text.match(/^---\n([\s\S]*?)\n---/)[1]),
    replace:async(path,expected,text)=>{assert.equal(files.get(path).text,expected);writes.push(path);put(path,text);}};
  const cache={rows:new Map(),async get(key){return this.rows.get(key);},async put(key,value){this.rows.set(key,structuredClone(value));}};
  const engine=opts=>new SRS.CardMaintenance(io,'srs',cache,{now:()=>now,...opts});
  const json=path=>JSON.parse(files.get(path).text);
  return {files,put,io,cache,engine,json,reads,writes,rule,template};
}

test('maintenance refresh preserves identities and baseline, and unchanged checkpoint skips catalog/source reads',async()=>{
  const f=maintenanceFixture(),engine=f.engine(),plan=await engine.plan();assert.equal(plan.result.added,1);await engine.apply(plan);
  const card=f.json('srs/data/cards/cards-00000.json')[0],note=f.json('srs/data/notes/notes-00000.json')[0];
  assert.equal(card.note_id,note.id);assert.equal(note.uid,'anki:1');assert.equal(card.added_at,new Date(now).toISOString());assert.equal(card.baseline.reps,0);
  assert.equal(card.id,await SRS.maintenanceCardId('words','anki:1','read'));
  assert.equal(card.source,undefined);assert.equal(note.locator.fields,undefined);
  const second=f.engine(),noChange=await second.plan();assert.equal(noChange.result.added,0);await second.apply(noChange);
  f.reads.length=0;const warm=await f.engine().plan();assert.equal(warm.result.scan.parsed_files,0);
  assert.ok(!f.reads.includes('words.csv'));assert.ok(!f.reads.some(p=>p.includes('/cards/')||p.includes('/notes/')));
  assert.deepEqual(f.json('srs/data/cards/cards-00000.json')[0],card);
});

test('maintenance seeds CSV IDs, opts structural notes in, and puts block markers immediately below quote',async()=>{
  const f=maintenanceFixture();f.put('words.csv','anki_note_id,word\n,new\n');let e=f.engine();await e.apply(await e.plan());assert.match(f.files.get('words.csv').text,/srs_note_id/);
  const first=f.json('srs/data/cards/cards-00000.json')[0].id;await f.engine().apply(await f.engine().plan());assert.equal(f.json('srs/data/cards/cards-00000.json')[0].id,first);
  f.put('srs/config/sources.json',{format_version:1,rules:{words:{...f.rule,sources:['notes']}}});
  f.put('notes/no.md','---\n{"word":"not opted in"}\n---\n');f.put('notes/yes.md','---\n{"anki_note_id":2,"word":"yes"}\n---\n');
  const plan=await f.engine().plan();assert.equal(plan.result.added,1);assert.equal(plan.files['notes/notes-00000.json'].length,2);
  const g=maintenanceFixture();g.put('srs/config/sources.json',{format_version:1,rules:{words:{...g.rule,sources:['blocks'],kind:'block',fields:[{name:'Front',source:'$front',transform:'text'}]}}});
  g.put('blocks/a.md','> [!anki]- Question\n> #tag\n\n');g.io.metadata=async()=>({});await g.engine().plan();assert.match(g.files.get('blocks/a.md').text,/> #tag\n<!-- SRS-ID: [^\n]+ -->\n\n/);
});

test('maintenance prune protects imported and referenced cards and rejects incomplete roots',async()=>{
  const f=maintenanceFixture();f.put('words.csv','anki_note_id,word\n,one\n,two\n');let e=f.engine();await e.apply(await e.plan());const cards=f.json('srs/data/cards/cards-00000.json');
  f.put('srs/data/reviews/computer-2026-11.jsonl',JSON.stringify({kind:'card_settings',card_id:cards[0].id})+'\n');f.put('words.csv','anki_note_id,word\n');
  e=f.engine();const plan=await e.plan(true);assert.equal(plan.result.removable_cards,1);assert.equal(plan.result.protected_cards.length,1);await e.apply(plan);assert.deepEqual(f.json('srs/data/cards/cards-00000.json').map(c=>c.id),[cards[0].id]);
  f.files.delete('words.csv');await assert.rejects(f.engine().plan(true),/Source unavailable/);
});

test('maintenance rejects stale apply and duplicate identities without catalog writes',async()=>{
  const f=maintenanceFixture(),e=f.engine(),plan=await e.plan();f.put('words.csv','anki_note_id,word\n1,changed\n');await assert.rejects(e.apply(plan),/changed/);assert.equal(f.json('srs/data/cards/cards-00000.json').length,0);
  f.put('words.csv','anki_note_id,word\n1,one\n1,two\n');await assert.rejects(f.engine().plan(),/Duplicate source identity/);
  await assert.rejects(f.engine({cancelled:()=>true}).plan(),/cancelled/);
});

test('maintenance filters conditional geography fronts and generates cloze ordinals',async()=>{
  const f=maintenanceFixture();f.template.front='{{#Front}}{{Front}}{{/Front}}';f.put('words.csv','anki_note_id,word\n1,\n2,yes\n');let config=f.json('srs/config/cards.json');config.groups.words.templates=[f.template];f.put('srs/config/cards.json',config);assert.equal((await f.engine().plan()).result.added,1);
  f.template.front='{{cloze:Front}}';config.groups.words.templates=[f.template];f.put('srs/config/cards.json',config);f.put('words.csv','anki_note_id,word\n1,{{c1::one}} and {{c3::three}}\n');const plan=await f.engine().plan();assert.equal(plan.result.added,2);assert.deepEqual(plan.files['cards/cards-00000.json'].map(c=>c.anki_ordinal),[0,2]);
});

test('maintenance batches type changes and preserves card IDs, note IDs, history and timestamps',async()=>{
  const f=maintenanceFixture();let e=f.engine();await e.apply(await e.plan());const before=f.json('srs/data/cards/cards-00000.json')[0];
  const sources=f.json('srs/config/sources.json');sources.rules.other={...f.rule,sources:['other.csv']};f.put('srs/config/sources.json',sources);
  const config=f.json('srs/config/cards.json');config.rules.other={profile:'p',templates:['read']};config.groups.other={templates:[{...f.template,anki_notetype:'Other'}]};f.put('srs/config/cards.json',config);f.put('other.csv',f.files.get('words.csv').text);f.put('words.csv','anki_note_id,word\n');
  let calls=0;e=f.engine({chooseMapping:async plan=>{calls++;assert.equal(plan.notes,1);return {read:'read'};}});const plan=await e.plan();assert.equal(plan.result.added,0);await e.apply(plan);assert.equal(calls,1);
  const after=f.json('srs/data/cards/cards-00000.json')[0];assert.equal(after.id,before.id);assert.equal(after.note_id,before.note_id);assert.equal(after.added_at,before.added_at);assert.deepEqual(after.baseline,before.baseline);assert.equal(f.json('srs/data/notes/notes-00000.json')[0].rule_id,'other');
});

test('maintenance validates identities and UUIDv5 matches Python reference',async()=>{
  assert.equal(SRS.maintenanceIdentity({anki_note_id:'00123',srs_note_id:'garbage'}),'anki:123');assert.throws(()=>SRS.maintenanceIdentity({anki_note_id:'-1'}));assert.throws(()=>SRS.maintenanceIdentity({srs_note_id:'bad'}));
  assert.equal(await SRS.maintenanceCardId('words','anki:1','read'),'8756ff58-0f9f-5c7d-a1ec-b8d9f77b173b');
});

test('maintenance reuses touched identical files, reparses edits, and refuses additions during scanning',async()=>{
  const f=maintenanceFixture();let e=f.engine();await e.apply(await e.plan());await f.engine().plan();
  f.put('words.csv',f.files.get('words.csv').text);let plan=await f.engine().plan();assert.equal(plan.result.scan.parsed_files,0);assert.equal(plan.result.scan.hashed_files,1);
  f.put('words.csv','anki_note_id,word\n1,one\n2,two\n');plan=await f.engine().plan();assert.equal(plan.result.added,1);assert.equal(plan.result.scan.parsed_files,1);
  f.put('srs/config/sources.json',{format_version:1,rules:{words:{...f.rule,sources:['notes']}}});f.put('notes/a.md','---\n{"anki_note_id":1,"word":"one"}\n---\n');
  await assert.rejects(f.engine({progress:()=>f.put('notes/b.md','---\n{"anki_note_id":2,"word":"two"}\n---\n')}).plan(),/changed during scan/);
});

test('structural seeding changes only the blank opt-in and retains an existing Anki identity',async()=>{
  const f=maintenanceFixture();f.io.metadata=async(path,text)=>text.includes('anki_note_id:')?{anki_note_id:3,srs_note_id:null,word:'three'}:{srs_note_id:null,word:'one'};
  f.put('note.md','---\nsrs_note_id:\nword: one\n---\nBody\n');const e=f.engine();const records=await e.source('note.md',f.rule,true);assert.equal(records.length,1);assert.match(records[0].identity,/^local:/);assert.match(f.files.get('note.md').text,/word: one\n---\nBody\n$/);
  f.put('anki.md','---\nanki_note_id: 3\nsrs_note_id:\nword: three\n---\n');const original=f.files.get('anki.md').text;const existing=await e.source('anki.md',f.rule,true);assert.equal(existing[0].identity,'anki:3');assert.equal(f.files.get('anki.md').text,original);
});

test('mapping cancellation and retirement retain history; imported identities are never pruned',async()=>{
  const f=maintenanceFixture();let e=f.engine();await e.apply(await e.plan());const before=f.files.get('srs/data/cards/cards-00000.json').text;
  const sources=f.json('srs/config/sources.json');sources.rules.other={...f.rule,sources:['other.csv']};f.put('srs/config/sources.json',sources);const cfg=f.json('srs/config/cards.json');cfg.rules.other={profile:'p',templates:['read']};cfg.groups.other={templates:[f.template]};f.put('srs/config/cards.json',cfg);f.put('other.csv',f.files.get('words.csv').text);f.put('words.csv','anki_note_id,word\n');
  await assert.rejects(f.engine({chooseMapping:()=>null}).plan(),/cancelled/);assert.equal(f.files.get('srs/data/cards/cards-00000.json').text,before);
  e=f.engine({chooseMapping:()=>({read:null})});await e.apply(await e.plan());const cards=f.json('srs/data/cards/cards-00000.json');assert.equal(cards.length,2);assert.equal(cards[0].retired,true);f.put('other.csv','anki_note_id,word\n');const pruned=await f.engine().plan(true);assert.equal(pruned.result.removable_cards,0);
});

test('maintenance parses real YAML without require or Obsidian module access',async()=>{
  const context={TextEncoder,__SRS_TEST__:true,require:()=>{throw Error("Cannot find module 'obsidian'");}};
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../../view.js'),'utf8'),context);
  const text=`---
anki_note_id: 1001
aliases:
  - 示例別名
srs_note_id:
map: '![[attachments/map.svg]]'
terms:
  - order: 2
    party: Federalist
text: |-
  First line
  Second line
---
Body
`;
  const metadata=context.SRS.maintenanceMetadata('note.md',text);
  assert.equal(metadata.anki_note_id,1001);assert.equal(metadata.aliases[0],'示例別名');assert.equal(metadata.srs_note_id,null);assert.equal(metadata.terms[0].order,2);assert.equal(metadata.text,'First line\nSecond line');assert.equal(metadata.map,'![[attachments/map.svg]]');
  assert.equal(Object.keys(context.SRS.maintenanceMetadata('ordinary.md','No frontmatter')).length,0);
  assert.throws(()=>context.SRS.maintenanceMetadata('bad.md','---\nkey: [broken\n---\n'),/Invalid frontmatter: bad.md/);
  assert.throws(()=>context.SRS.maintenanceMetadata('list.md','---\n- value\n---\n'),/expected a mapping/);
  const f=maintenanceFixture();f.io.metadata=async(path,text)=>context.SRS.maintenanceMetadata(path,text);
  f.put('note.md','---\nsrs_note_id:\nword: one\n---\nBody\n');
  const result=await f.engine().source('note.md',f.rule,true);assert.equal(result.length,1);assert.match(result[0].identity,/^local:/);
});

test('refresh and prune share source parsing in either order without persisting note content',async()=>{
  for(const firstPrune of [false,true]){
    const f=maintenanceFixture();f.io.metadata=async(path,text)=>SRS.maintenanceMetadata(path,text);
    f.put('srs/config/sources.json',{format_version:1,rules:{words:{...f.rule,sources:['notes']}}});
    f.put('notes/a.md','---\nanki_note_id: 1\nword: private-source-content\n---\nPrivate body\n');
    let parses=0;const metadata=f.io.metadata;f.io.metadata=async(...args)=>{parses++;return metadata(...args);};
    const first=f.engine(),plan=await first.plan(firstPrune);await first.apply(plan);
    assert.equal(parses,1);f.reads.length=0;
    const second=await f.engine().plan(!firstPrune);
    assert.equal(parses,1);assert.equal(second.result.scan.parsed_files,0);assert.equal(second.result.scan.reused_files,1);
    assert.ok(!f.reads.includes('notes/a.md'),'other operation does not reread source');
    const saved=JSON.stringify([...f.cache.rows]);assert.ok(!saved.includes('private-source-content'));assert.ok(!saved.includes('Private body'));
  }
});

test('prune-first sharing still lets refresh seed missing CSV, structural, and block IDs',async()=>{
  for(const kind of ['csv','markdown','block']){
    const f=maintenanceFixture();f.io.metadata=async(path,text)=>SRS.maintenanceMetadata(path,text);
    const rule=kind==='csv'?f.rule:{...f.rule,sources:['notes'],...(kind==='block'?{kind:'block',fields:[{name:'Front',source:'$front',transform:'text'}]}:{})};
    f.put('srs/config/sources.json',{format_version:1,rules:{words:rule}});
    const path=kind==='csv'?'words.csv':'notes/a.md';
    const original=kind==='csv'?'word\nnew\n':kind==='markdown'?'---\nsrs_note_id:\nword: new\n---\n':'> [!anki]- new\n> #tag\n\n';f.put(path,original);
    await f.engine().plan(true);assert.equal(f.files.get(path).text,original,'prune does not seed IDs');
    const refresh=f.engine(),plan=await refresh.plan();assert.equal(plan.result.added,1);assert.equal(plan.result.scan.parsed_files,1);assert.notEqual(f.files.get(path).text,original);
    await refresh.apply(plan);f.reads.length=0;const prune=await f.engine().plan(true);assert.equal(prune.result.scan.parsed_files,0);assert.ok(!f.reads.includes(path));
  }
});

test('shared identity cache survives generation changes and touched-identical files',async()=>{
  const f=maintenanceFixture();let e=f.engine();await e.apply(await e.plan());
  const config=f.json('srs/config/cards.json');config.groups.words.templates[0].front='Updated {{Front}}';f.put('srs/config/cards.json',config);
  f.reads.length=0;let plan=await f.engine().plan(true);assert.equal(plan.result.scan.parsed_files,0);assert.ok(!f.reads.includes('words.csv'));
  plan=await f.engine().plan();assert.equal(plan.result.scan.parsed_files,1,'changed generation inputs need reevaluation');
  f.put('words.csv',f.files.get('words.csv').text);plan=await f.engine().plan(true);assert.equal(plan.result.scan.parsed_files,0);assert.equal(plan.result.scan.hashed_files,1);
  f.reads.length=0;plan=await f.engine().plan();assert.equal(plan.result.scan.parsed_files,0);assert.ok(!f.reads.includes('words.csv'));
  f.put('words.csv','anki_note_id,word\n1,changed\n2,two\n');await f.engine().plan(true);f.reads.length=0;plan=await f.engine().plan();assert.equal(plan.result.added,1);assert.equal(plan.result.scan.parsed_files,0);assert.ok(!f.reads.includes('words.csv'));
});

test('shared maintenance scans survive closing and reopening IndexedDB',async()=>{
  const f=maintenanceFixture(),identity='shared-maintenance-'+crypto.randomUUID();
  let persistent=await SRS.MaintenanceCache.open(identity,indexedDB);
  f.cache.get=key=>persistent.get(key);f.cache.put=(key,value)=>persistent.put(key,value);
  let e=f.engine();await e.apply(await e.plan());persistent.close();persistent=await SRS.MaintenanceCache.open(identity,indexedDB);
  try{f.reads.length=0;const plan=await f.engine().plan(true);assert.equal(plan.result.scan.parsed_files,0);assert.equal(plan.result.scan.reused_files,1);assert.ok(!f.reads.includes('words.csv'));}finally{persistent.close();}
});

test('Anki bridge states select current scheduling without inventing review activity',async()=>{
  const index=await SRS.ReviewIndex.open(`anki-bridge-${crypto.randomUUID()}`,'import',timing,indexedDB);
  const event={format_version:2,kind:'anki_state',id:crypto.randomUUID(),device_id:'anki',card_id:'card-0',
    import_id:'import',review_time_ms:now,anki_revlog_id:String(now),state:state(2)};
  await index.ingest([event],new Set(['card-0']));
  assert.deepEqual((await index.latest()).get('card-0').state,event.state);
  assert.equal((await index.activityToday(now)).length,0);
  assert.equal((await index.historyFor('card-0')).length,0);
  await index.ingest([event],new Set(['card-0']));
  assert.equal((await index.latest()).size,1);
  assert.throws(()=>SRS.validateEvent({...event,import_id:'wrong'},'import'),/Invalid Anki/);
  const local={...answer(),card_id:'card-0',parent:event.id,review_time_ms:now+1000,state:{...state(2),last_review:now+1000}};
  await index.ingest([local],new Set(['card-0']));
  assert.equal((await index.latest()).get('card-0').id,local.id);
  assert.equal((await index.activityToday(now)).length,1);

  index.close();
});

 test('interval labels use study days for reviews and interday learning',()=>{
  const stamp=Date.parse('2026-11-15T20:00:00Z');
  const today=SRS.dayNumber(stamp,timing);
  const due=SRS.studyDayStart(today+2,timing);
  assert.equal(SRS.reviewIntervalLabel({queue:2,scheduled_days:2,due},stamp,timing),'2d');
  assert.equal(SRS.reviewIntervalLabel({queue:3,anki_due:today+2,scheduled_days:0,due},stamp,timing),'2d');
  assert.equal(SRS.reviewIntervalLabel({queue:1,due:stamp+600000},stamp,timing),'10m');
  const dst=Date.parse('2026-03-07T21:00:00Z'),day=SRS.dayNumber(dst,timing);
  assert.equal(SRS.reviewIntervalLabel({queue:2,scheduled_days:2,due:SRS.studyDayStart(day+2,timing)},dst,timing),'2d');
});

test('file sync adds and retires only selected CSV cards, retaining and restoring identity/history',async()=>{
  const f=maintenanceFixture();
  const sources=f.json('srs/config/sources.json');sources.rules.words.sources.push('other.csv');f.put('srs/config/sources.json',sources);
  f.put('other.csv','anki_note_id,word\n2,two\n');
  let e=f.engine();await e.apply(await e.plan());
  const before=f.json('srs/data/cards/cards-00000.json');
  const first=before.find(c=>c.id=== '8756ff58-0f9f-5c7d-a1ec-b8d9f77b173b');
  first.baseline.reps=10;f.put('srs/data/cards/cards-00000.json',before);
  const other=before.find(c=>c.id!==first.id);
  f.put('other.csv','anki_note_id,word\n2,two\n4,four\n');
  f.put('words.csv','anki_note_id,word\n3,three\n');
  e=f.engine({sourcePath:'words.csv'});const plan=await e.plan();
  assert.equal(plan.result.added,1);assert.equal(plan.result.retired,1);await e.apply(plan);
  let cards=f.json('srs/data/cards/cards-00000.json');
  assert.equal(cards.length,3);assert.deepEqual(cards.find(c=>c.id===other.id),other);
  assert.equal(cards.find(c=>c.id===first.id).retired,true);
  assert.deepEqual(cards.find(c=>c.id===first.id).baseline,first.baseline);
  f.put('words.csv','anki_note_id,word\n1,one\n3,three\n');
  e=f.engine({sourcePath:'words.csv'});await e.apply(await e.plan());
  cards=f.json('srs/data/cards/cards-00000.json');assert.equal(cards.length,3);
  assert.equal(cards.find(c=>c.id===first.id).retired,undefined);
  assert.equal(cards.find(c=>c.id===first.id).added_at,first.added_at);
});


test('file sync refuses retirement when an identity moved to another source file',async()=>{
  const f=maintenanceFixture(),sources=f.json('srs/config/sources.json');
  sources.rules.words.sources.push('other.csv');f.put('srs/config/sources.json',sources);
  f.put('other.csv','anki_note_id,word\n');let e=f.engine();await e.apply(await e.plan());
  const before=f.files.get('srs/data/cards/cards-00000.json').text;
  f.put('words.csv','anki_note_id,word\n');f.put('other.csv','anki_note_id,word\n1,one\n');
  await assert.rejects(f.engine({sourcePath:'words.csv'}).plan(),/moved/);
  assert.equal(f.files.get('srs/data/cards/cards-00000.json').text,before);
});

test('file sync retires disabled templates and preserves other source cards',async()=>{
  const f=maintenanceFixture();let e=f.engine();await e.apply(await e.plan());
  const config=f.json('srs/config/cards.json');config.groups.words.templates[0].enabled=false;f.put('srs/config/cards.json',config);
  e=f.engine({sourcePath:'words.csv'});const plan=await e.plan();assert.equal(plan.result.retired,1);
  await e.apply(plan);assert.equal(f.json('srs/data/cards/cards-00000.json')[0].retired,true);
});

test('file sync shares generation cache and does not parse unrelated edits when adding',async()=>{
  const f=maintenanceFixture(),sources=f.json('srs/config/sources.json');
  sources.rules.words.sources.push('other.csv');f.put('srs/config/sources.json',sources);
  f.put('other.csv','anki_note_id,word\n2,two\n');let e=f.engine();await e.apply(await e.plan());
  f.put('other.csv','anki_note_id,word\n2,changed\n');
  f.put('words.csv','anki_note_id,word\n1,one\n3,three\n');f.reads.length=0;
  e=f.engine({sourcePath:'words.csv'});const plan=await e.plan();
  assert.equal(plan.result.added,1);assert.equal(plan.result.scan.parsed_files,1);
  assert.ok(!f.reads.includes('other.csv'));
  f.put('other.csv','anki_note_id,word\n2,changed again\n');
  await assert.rejects(e.apply(plan),/changed/);
  e=f.engine({sourcePath:'words.csv'});const retry=await e.plan();
  assert.equal(retry.result.scan.parsed_files,0);assert.equal(retry.result.scan.reused_files,1);
  await e.apply(retry);
});

test('source file picker lists only refresh-eligible paths, groups shared files and reads no content',()=>{
  const f=maintenanceFixture();
  f.put('notes/a.md','unread');f.put('notes/b.md','unread');f.put('notes/nested/c.md','unread');
  f.put('notes/image.png','unread');f.put('unrelated.md','unread');
  const rules={words:f.rule,shared:{...f.rule},structural:{...f.rule,sources:['notes'],recursive:false,filenames:['a']}};
  const choices=SRS.maintenanceFileChoices(rules,f.io);
  assert.deepEqual(choices,[{path:'notes/a.md',rules:['structural']},{path:'words.csv',rules:['words','shared']}]);
  assert.equal(f.reads.length,0);assert.equal(f.writes.length,0);
  rules.structural.kind='block';
  assert.deepEqual(SRS.maintenanceFileChoices(rules,f.io).map(f=>f.path),['notes/a.md','notes/b.md','words.csv']);
  rules.structural.recursive=true;
  assert.ok(SRS.maintenanceFileChoices(rules,f.io).some(f=>f.path==='notes/nested/c.md'));
});

test('source row sync publishes multiple selected files together and leaves other files alone',async()=>{
  const f=maintenanceFixture(),sources=f.json('srs/config/sources.json');
  sources.rules.words.sources.push('second.csv','third.csv');f.put('srs/config/sources.json',sources);
  f.put('second.csv','anki_note_id,word\n2,two\n');f.put('third.csv','anki_note_id,word\n3,three\n');
  const engine=f.engine({sourcePath:['words.csv','second.csv']});const plan=await engine.plan();
  assert.equal(plan.result.added,2);await engine.apply(plan);
  assert.equal(f.json('srs/data/cards/cards-00000.json').length,2);
  assert.ok(!f.reads.includes('third.csv'));
});
