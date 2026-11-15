// Desktop verification only; the actual reviewer remains standalone.
const fs = require('node:fs');
const vm = require('node:vm');
globalThis.__SRS_TEST__ = true;
vm.runInThisContext(fs.readFileSync(require('node:path').join(__dirname,'../../view.js'),'utf8'));
const input = JSON.parse(fs.readFileSync(0,'utf8'));
const states = new Map(input.cards.map(c=>[c.id,{state:c.baseline || {queue:c.queue,due:c.due_ms,anki_due:c.anki_due}}]));
const tree = SRS.deckTree(input.cards,states,input.manifest,input.now);
const transitions = (input.transitions || []).map(t=>{
  try {return {id:t.id,state:SRS.nextStateV2(t.card,t.state,t.options,input.manifest,t.now,t.rating)};}
  catch(e) {return {id:t.id,error:e.message};}
});
process.stdout.write(JSON.stringify({tree,transitions}));
