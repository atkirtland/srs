// Filesystem-free parity runner: only the JSON fixture supplied on stdin is used.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
globalThis.__SRS_TEST__=true;
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../../view.js'),'utf8'));
(async()=>{
 const input=JSON.parse(fs.readFileSync(0,'utf8')),files=new Map(Object.entries(input.files).map(([p,text])=>[p,{text,mtime:1}]));let clock=2;
 const stat=p=>files.has(p)?{path:p,file:true,mtime:files.get(p).mtime,size:files.get(p).text.length}:[...files.keys()].some(k=>k.startsWith(p+'/'))?{path:p,file:false}:null;
 const io={read:async p=>files.get(p)?.text??null,stat,files:()=>[...files.keys()].map(stat),write:async(p,text)=>files.set(p,{text,mtime:clock++}),remove:async p=>files.delete(p),metadata:async p=>input.metadata[p]||{},replace:async(p,expected,text)=>{if(files.get(p).text!==expected)throw Error('changed');files.set(p,{text,mtime:clock++});}};
 const rows=new Map(),cache={get:async k=>rows.get(k),put:async(k,v)=>rows.set(k,v)};
 const engine=new SRS.CardMaintenance(io,'srs',cache,{now:()=>input.now});await engine.apply(await engine.plan());
 process.stdout.write(JSON.stringify(Object.fromEntries([...files].filter(([p])=>p.startsWith('srs/data/cards/')||p.startsWith('srs/data/notes/')).map(([p,v])=>[p,JSON.parse(v.text)]))));
})().catch(e=>{console.error(e);process.exitCode=1;});
