// Synthetic scheduling benchmark; no vault content or persisted data required.
const fs=require('node:fs'),vm=require('node:vm'),{performance}=require('node:perf_hooks');
globalThis.__SRS_TEST__=true;
vm.runInThisContext(fs.readFileSync(require('node:path').join(__dirname,'../../view.js'),'utf8'));
const S=globalThis.SRS,now=Date.parse('2026-11-15T12:00:00Z');
const timing={timezone:'America/Chicago',rollover_hour:3,day_zero:'2000-01-01'},day=S.dayNumber(now,timing);
const original={timing,scheduling:{collection:{collapseTime:1200,lastUnburied:day},presets:{p:{settings:{new_per_day:20,reviews_per_day:200}}},decks:{d:{id:'d',name:'All',parent_id:null,normal:{config_id:'p'},common:{}}}}};
const config={decks:Object.fromEntries(Array.from({length:30},(_,i)=>['deck-'+i,{name:'Deck '+i,parent_id:null,filter:{groups:['group-'+i]}}]))};
const manifest={...original,study:config};
const cards=Array.from({length:30000},(_,i)=>({id:'card-'+i,deck_id:'d',group:'group-'+i%30,queue:2,card_type:2,anki_due:day,baseline:{state:2,queue:2,anki_due:day,due:now,reps:10}}));
const states=new Map(cards.map(c=>[c.id,{state:c.baseline}]));
function timed(name,run){const start=performance.now();const result=run();console.log(`${name}: ${(performance.now()-start).toFixed(1)} ms`);return result;}
const memberships=timed('Cold membership index (30,000 cards / 30 decks)',()=>S.studyMemberships(cards,config,manifest));
const tree=timed('Cold homepage counts',()=>S.studyDeckTree(cards,states,manifest,now,[],new Set(),'',memberships));
const cache=new Map([['homepage',tree]]);
timed('1,000 warm homepage cache lookups',()=>{for(let i=0;i<1000;i++)cache.get('homepage');});
const filter=c=>memberships.get('deck-0').has(c.id);
timed('Open selected deck queue',()=>S.reviewQueueV2(cards,states,[],manifest,now,'',undefined,null,new Set(),filter));
states.set('card-0',{state:{...cards[0].baseline,anki_due:day+5,due:now+5*86400000}});
timed('Refresh counts after one answer',()=>S.studyDeckTree(cards,states,manifest,now,[],new Set(),'',memberships));
console.log('Source reads: 0; template renders: 0 (scheduling-only workload). Use Performance details for actual UI and vault costs.');
const indexed=timed('Build maintained scheduling index',()=>new S.SchedulingIndex(cards,states,manifest,[],now,memberships));
timed('1,000 indexed deck screens',()=>{for(let i=0;i<1000;i++)indexed.tree();});
timed('Indexed selected queue',()=>indexed.queue('deck-0'));
const beforeScans=indexed.stats.catalogCards;
timed('Indexed one-card answer and affected counts',()=>indexed.update(cards[0],{state:{...cards[0].baseline,anki_due:day+10,due:now+10*86400000}}));
console.log('Catalog cards inspected after construction:',indexed.stats.catalogCards-beforeScans);
