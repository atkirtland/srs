// Parse the exact source bytes; no Obsidian module lookup or stale metadata cache.
function maintenanceMetadata(path,text) {
  const match=text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if(!match)return {};
  let value;
  try { value=SRSYaml.load(match[1]); }
  catch(error){throw Error(`Invalid frontmatter: ${path}: ${error.message}`);}
  if(value==null)return {};
  if(typeof value!=='object'||Array.isArray(value))throw Error(`Invalid frontmatter: ${path}: expected a mapping`);
  return value;
}

// Catalog writes use the same roll-forward format as desktop maintenance.
class CatalogPublisher {
  constructor(storage, root) { this.storage=storage; this.root=root; }
  path(relative) { return `${this.root}/${relative}`; }
  async read(relative) { const text=await this.storage.read(this.path(relative));return text===null?null:JSON.parse(text); }
  async write(relative,value) { await this.storage.write(this.path(relative),JSON.stringify(value,null,2)+'\n'); }
  validate(journal) {
    if(!journal || !journal.previous || !journal.manifest || !journal.files || Array.isArray(journal.files))throw Error('Invalid catalog journal');
    for(const [path,records] of Object.entries(journal.files)) {
      if(!/^(notes\/notes|cards\/cards)-\d{5,}\.json$/.test(path)||!Array.isArray(records)||records.length>250)throw Error('Invalid pending partition');
      const ids=new Set();for(const record of records){if(!record?.id||ids.has(record.id))throw Error('Duplicate or missing partition identity');ids.add(record.id);}
    }
  }
  async recover() {
    const journal=await this.read('catalog.pending.json');if(journal===null)return false;
    this.validate(journal);
    const current=await this.read('manifest.json');
    if(canonical(current)!==canonical(journal.previous)&&canonical(current)!==canonical(journal.manifest))throw Error('Pending catalog update conflicts with current manifest');
    for(const [path,records] of Object.entries(journal.files).sort(([a],[b])=>Number(a.startsWith('cards/'))-Number(b.startsWith('cards/'))))await this.write(path,records);
    await this.write('manifest.json',journal.manifest);
    await this.storage.remove(this.path('catalog.pending.json'));return true;
  }
  async publish(previous,manifest,files) {
    await this.recover();
    const journal={previous,manifest,files};this.validate(journal);
    if(canonical(await this.read('manifest.json'))!==canonical(previous))throw Error('Catalog changed; retry');
    await this.write('catalog.pending.json',journal);
    await this.recover();
  }
}

function maintenanceIdentity(metadata) {
  const anki=String(metadata.anki_note_id||'').trim();
  if(anki){if(!/^[0-9]+$/.test(anki)||BigInt(anki)<=0n)throw Error('Invalid anki_note_id');return `anki:${BigInt(anki)}`;}
  const local=String(metadata.srs_note_id||metadata.srs_uid||'').trim().toLowerCase();
  if(local&&!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(local))throw Error('Invalid srs_note_id');
  return local?`local:${local}`:null;
}
async function maintenanceCardId(group,identity,template) {
  const namespace='6ba7b8119dad11d180b400c04fd430c8';
  const name=new TextEncoder().encode(`ankobs:srs:${group}/${identity}/${template}`);
  const bytes=new Uint8Array(16+name.length);bytes.set(namespace.match(/../g).map(x=>parseInt(x,16)));bytes.set(name,16);
  const result=new Uint8Array(await crypto.subtle.digest('SHA-1',bytes)).slice(0,16);result[6]=(result[6]&15)|80;result[8]=(result[8]&63)|128;
  const h=[...result].map(x=>x.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function maintenanceQuestion(template,note,rule) {
  if(!/{{[#^]/.test(template.front))return true;
  const specs=new Map(rule.fields.map(f=>[f.anki,f])),stack=[],visible=[];let offset=0;
  for(const match of template.front.matchAll(/{{([#^/])([^{}]+)}}/g)){
    if(stack.every(x=>x[1]))visible.push(template.front.slice(offset,match.index));
    const [,op,raw]=match,name=raw.trim();
    if(op==='/'){if(stack.pop()?.[0]!==name)return true;}
    else if(!stack.every(x=>x[1]))stack.push([name,false]);
    else {
      const spec=specs.get(name);if(!spec)return true;
      let value;try{value=transformField(spec.transform||'text',spec.source==='$body'?note.body:spec.source==='$filename'?note.filename:note.metadata[spec.source],note).trim()!=='';}catch{return true;}
      stack.push([name,op==='#'?value:!value]);
    }
    offset=match.index+match[0].length;
  }
  if(stack.length)return true;visible.push(template.front.slice(offset));
  const question=visible.join('').replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'');
  return /<(img|audio|video|svg)\b|\[sound:/i.test(question)||!!question.replace(/<[^>]*>/g,'').trim();
}
class MaintenanceCache {
  static async open(identity,factory=globalThis.indexedDB){return new MaintenanceCache(await CatalogCache.open(identity+':maintenance-v2',factory));}
  constructor(cache){this.cache=cache;this.memory=new Map();}
  async get(key){if(this.memory.has(key))return this.memory.get(key);try{return await this.cache.transaction('readonly',s=>s.get(key));}catch{return null;}}
  async put(key,value){this.memory.set(key,value);try{await this.cache.transaction('readwrite',s=>s.put(value,key));}catch{}}
  close(){this.cache.close();}
}
class CardMaintenance {
  constructor(io,root,cache,options={}){this.io=io;this.root=root;this.data=`${root}/data`;this.cache=cache;this.options=options;this.stats={parsed_files:0,reused_files:0,hashed_files:0};this.observed=new Map();this.seeded=new Map();this.parsedHashes=new Map();this.needsSeed=new Set();}
  inScope(path){const scope=this.options.sourcePath;return !scope||(Array.isArray(scope)?scope.includes(path):scope===path);}
  check(){if(this.options.cancelled?.())throw Error('Maintenance cancelled; catalog unchanged');}
  async json(path){const text=await this.io.read(path);if(text===null)throw Error(`Missing file: ${path}`);return JSON.parse(text);}
  async inputs(){
    const names={sources:'config/sources.json',cards:'config/cards.json',decks:'config/decks.json',assignments:'config/profile-rules.json',profiles:'data/profiles.json'};
    const parts={};for(const [key,path]of Object.entries(names))parts[key]=await this.json(`${this.root}/${path}`);
    return {parts,config:composeStudyDocuments(parts),templates:parts.cards,manifest:await this.json(`${this.data}/manifest.json`)};
  }
  files(rule,strict,issues,group,scoped=true){
    const selected=new Map();
    for(const path of rule.sources){
      if(!path||path.startsWith('/')||path.split('/').some(p=>p==='..'||p==='.')||path.includes('\\'))throw Error('Source path escapes vault');
      const exact=this.io.stat(path);
      if(!exact){if(strict)throw Error(`Source unavailable; refusing cleanup: ${path}`);issues.push({rule:group,path,error:'Missing source; existing cards preserved'});continue;}
      if(exact.file){selected.set(path,exact);continue;}
      const folded=new Set();
      for(const file of this.io.files()){
        if(!file.path.startsWith(path+'/')||!file.path.toLowerCase().endsWith('.md'))continue;
        const relative=file.path.slice(path.length+1);if(!rule.recursive&&relative.includes('/'))continue;
        if(!strict&&rule.kind!=='block'&&rule.filenames&&!rule.filenames.includes(relative.split('/').at(-1).slice(0,-3).toLowerCase()))continue;
        const key=relative.normalize('NFC').toLowerCase();if(folded.has(key))throw Error(`Filename collision: ${file.path}`);folded.add(key);selected.set(file.path,file);
      }
    }
    return [...selected.values()].filter(file=>!scoped||this.inScope(file.path)).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  }
  async fingerprint(input,prune){
    const files=new Map(),issues=[];
    for(const [group,rule]of Object.entries(input.config.source_rules))for(const f of this.files(rule,prune,issues,group,false))files.set(f.path,f);
    for(const f of this.io.files())if(f.path.startsWith(this.data+'/cards/')||f.path.startsWith(this.data+'/notes/')||prune&&f.path.startsWith(this.data+'/reviews/'))files.set(f.path,f);
    return canonical([input,[...files.values()].map(f=>[f.path,f.mtime,f.size,f.version||0]).sort(),issues]);
  }
  async finishSource(path,text,records){this.parsedHashes.set(path,await hash(text));return records;}
  async replaceSource(path,original,text){await this.io.replace(path,original,text);this.seeded.set(path,this.io.stat(path));}
  async source(path,rule,seed){
    let text=await this.io.read(path);if(text===null)throw Error(`Source unavailable: ${path}`);const original=text;
    const filename=path.split('/').at(-1).replace(/\.md$/i,''),body=()=>text.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/,'');
    if(path.toLowerCase().endsWith('.csv')){
      const rows=parseCSV(text);let changed=false;if(rows.some(row=>!maintenanceIdentity(row)))this.needsSeed.add(path);
      if(seed)for(const row of rows)if(!maintenanceIdentity(row)){row.srs_note_id=crypto.randomUUID();changed=true;}
      if(changed){const columns=[...Object.keys(rows[0])];if(!columns.includes('srs_note_id'))columns.push('srs_note_id');
        const quote=v=>/[",\r\n]/.test(String(v??''))?'"'+String(v??'').replaceAll('"','""')+'"':String(v??'');
        text=[columns,...rows.map(row=>columns.map(c=>row[c]??''))].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
      }
      if(changed)await this.replaceSource(path,original,text);
      return this.finishSource(path,text,rows.map(metadata=>({path,filename,metadata,body:'',identity:maintenanceIdentity(metadata)})));
    }
    const metadata=await this.io.metadata(path,text);
    if(rule.kind==='block'){
      const pattern=/^[ \t]{0,3}>[ \t]*\[!(?:anki|srs)\](?:-[ \t]*|[ \t]+)([^\r\n]*)\r?\n((?:^[ \t]{0,3}>[ \t]?(?!\[!(?:anki|srs)\](?:-|[ \t]))[^\r\n]*(?:\r?\n|$))+)((?:^[ \t]*(?:<!--[ \t]*(?:ID|SRS-ID)[ \t]*:[ \t]*[^\r\n]+?[ \t]*-->[ \t]*)?(?:\r?\n|$))*)/gmi;
      if([...text.matchAll(pattern)].some(m=>!/<!--\s*(?:ID|SRS-ID)\s*:/i.test(m[3]))||/>[^\r\n]*\r?\n(?:[ \t]*\r?\n)+[ \t]*<!--\s*SRS-ID\s*:/i.test(text))this.needsSeed.add(path);
      if(seed){
        text=text.replace(/(^[ \t]{0,3}>[^\r\n]*\r?\n)((?:[ \t]*\r?\n)+)([ \t]*<!--[ \t]*SRS-ID[ \t]*:[^\r\n]*-->[ \t]*(?:\r?\n|$))/gmi,'$1$3$2');

        const edits=[];for(const m of text.matchAll(pattern))if(!/<!--\s*(?:ID|SRS-ID)\s*:/i.test(m[3]))edits.push([m.index+m[0].length-m[3].length,`<!-- SRS-ID: ${crypto.randomUUID()} -->\n`]);
        for(const [offset,marker]of edits.reverse())text=text.slice(0,offset)+(text[offset-1]==='\n'?'':'\n')+marker+text.slice(offset);
        if(text!==original)await this.replaceSource(path,original,text);
      }
      return this.finishSource(path,text,sourceBlocks(text).map(block=>{maintenanceIdentity(block.identity.startsWith('anki:')?{anki_note_id:block.identity.slice(5)}:{srs_note_id:block.identity.slice(6)});return {path,filename,body:'',identity:block.identity,metadata:{...metadata,$front:block.front,$back:block.back,tags:[...new Set([...(Array.isArray(metadata.tags)?metadata.tags:String(metadata.tags||'').split(/\s+/)),...block.tags])]}};}));
    }
    if(!metadata||!Object.keys(metadata).length)return [];
    if(!(String(metadata.anki_note_id||'').trim()||Object.hasOwn(metadata,'srs_note_id')))return [];
    if(rule.required_property&&!Object.hasOwn(metadata,rule.required_property)||rule.required_any_property&&!rule.required_any_property.some(k=>Object.hasOwn(metadata,k)))return [];
    let identity=maintenanceIdentity(metadata);if(!identity)this.needsSeed.add(path);
    if(!identity&&seed){const uid=crypto.randomUUID();let count=0;
      text=text.replace(/^(---[ \t]*\r?\n)([\s\S]*?)(^---[ \t]*\r?$)/m,(all,start,header,end)=>start+header.replace(/^srs_note_id:[^\r\n]*/gm,()=>{count++;return `srs_note_id: ${uid}`;})+end);
      if(count!==1)throw Error(`Expected one srs_note_id field: ${path}`);
      await this.replaceSource(path,original,text);metadata.srs_note_id=uid;identity=`local:${uid}`;
    }
    return this.finishSource(path,text,identity?[{path,filename,metadata,body:body(),identity}]:[]);
  }
  async discover(input,prune){
    const found=[],bindings=[],live=new Set(),issues=[];
    for(const [group,rule]of Object.entries(input.config.source_rules)){
      const templates=input.templates.groups[group]?.templates;if(!templates)throw Error(`Unknown template group: ${group}`);
      if(rule.templates.some(key=>!templates.some(t=>t.key===key)))throw Error(`Unknown templates: ${group}`);
      const seen=new Set();
      for(const file of this.files(rule,prune,issues,group)){
        this.check();this.observed.set(file.path,canonical(this.io.stat(file.path)));
        // Identities depend on source interpretation; generation adds rule/template inputs.
        const sourceKey=canonical(['source',file.path,rule.kind||null,rule.required_property||null,rule.required_any_property||null]);
        const key=canonical(['generation',sourceKey,group,rule,input.templates.groups[group],input.manifest.scheduling]);
        const stamp=canonical([file.mtime,file.size,file.version||0]);
        let shared=await this.cache.get(sourceKey),generated=await this.cache.get(key),digest;
        if(shared?.stamp!==stamp){this.stats.hashed_files++;digest=await hash(await this.io.read(file.path));}
        const valid=shared&&(shared.stamp===stamp||shared.hash===digest);
        const generationValid=valid&&generated?.hash===shared.hash;
        let result;
        if(valid&&(prune||generationValid&&!shared.needsSeed)){
          result=prune?{identities:shared.identities,bindings:[],found:[]}:generated.result;
          this.stats.reused_files++;
          if(shared.stamp!==stamp){shared={...shared,stamp};await this.cache.put(sourceKey,shared);}
        }else{
          this.stats.parsed_files++;let notes=await this.source(file.path,rule,!prune);
          result={identities:notes.map(n=>n.identity).filter(Boolean),bindings:[],found:[]};
          let generationComplete=true;
          try {
            if(rule.prepare){const prepared=rule.prepare==='prepare_taxonomy_notes'?prepareTaxonomy(notes):rule.prepare==='prepare_president_notes'?preparePresidents(notes):null;if(!prepared)throw Error(`Unknown preparation: ${rule.prepare}`);notes=notes.map(n=>({...n,metadata:prepared.get(n.path)||n.metadata}));}

            for(const note of notes.filter(n=>n.identity)){
              const source={path:file.path,kind:rule.kind==='block'?'block':file.path.endsWith('.csv')?'csv':'markdown',fields:rule.fields,...(rule.prepare?{prepare:rule.prepare}:{})};
              const candidate={group,note_uid:note.identity,source,properties:note.metadata,source_tags:Array.isArray(note.metadata.tags)?note.metadata.tags:String(note.metadata.tags||'').split(/\s+/)};
              if(!matchesStudyFilter(candidate,rule.filter||{},input.manifest))continue;
              result.bindings.push({group,note_uid:note.identity,source});
              for(const template of templates.filter(t=>rule.templates.includes(t.key)&&t.enabled!==false)){
                if(!matchesStudyFilter({...candidate,template_key:template.key},template.when||{},input.manifest)||!maintenanceQuestion(template,note,rule))continue;
                const cloze=template.front.includes('{{cloze:');let ordinals=[template.anki_ordinal];
                if(cloze){const fields=Object.fromEntries(rule.fields.map(f=>[f.anki,f.source==='$body'?note.body:f.source==='$filename'?note.filename:note.metadata[f.source]??'']));ordinals=[...new Set([...template.front.matchAll(/{{cloze:([^}]+)}}/g)].flatMap(m=>[...String(fields[m[1]]||'').matchAll(/{{c([1-9][0-9]*)::/g)].map(x=>Number(x[1])-1)))].sort((a,b)=>a-b);}
                for(const ordinal of ordinals)result.found.push({group,note_uid:note.identity,source,template_key:template.key,anki_notetype:template.anki_notetype,anki_ordinal:ordinal,profile_id:rule.profile,...(cloze?{cloze:true}:{})});
              }
            }
          }catch(error){if(!prune)throw error;generationComplete=false;result.bindings=[];result.found=[];}
          const after=this.io.stat(file.path),finalHash=await hash(await this.io.read(file.path));
          if(this.parsedHashes.has(file.path)&&this.parsedHashes.get(file.path)!==finalHash)throw Error(`Source changed during scan: ${file.path}`);
          this.observed.set(file.path,canonical(after));
          shared={stamp:canonical([after.mtime,after.size,after.version||0]),hash:finalHash,identities:result.identities,needsSeed:prune&&this.needsSeed.has(file.path)};
          await this.cache.put(sourceKey,shared);
          if(generationComplete)await this.cache.put(key,{hash:finalHash,result});
        }
        for(const uid of result.identities){if(seen.has(uid))throw Error(`Duplicate source identity in rule ${group}: ${uid}`);seen.add(uid);live.add(canonical([group,uid]));}
        found.push(...result.found);bindings.push(...result.bindings);
        this.options.progress?.({path:file.path,...this.stats});await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    return {found,bindings,live,issues};
  }
  async catalog(manifest){
    if(manifest.note_partition_count===undefined)throw Error('Maintenance requires the current notes/cards layout');
    const directory=kind=>manifest.catalog_layout==='flat'?kind:`${manifest.catalog_layout==='split'?kind:'imports'}/${manifest.revision}`;
    const parts={};for(const kind of ['notes','cards'])parts[kind]=await readCatalogPartitions(Array.from({length:manifest[kind==='notes'?'note_partition_count':'partition_count']},(_,i)=>`${this.data}/${directory(kind)}/${kind}-${String(i).padStart(5,'0')}.json`),async path=>[await this.json(path)]);
    const cards=parts.cards.flat(),notes=parts.notes.flat();if(new Set(cards.map(c=>c.id)).size!==cards.length)throw Error('Duplicate catalog card identity');return {parts,cards,notes,manifest};
  }
  async conversions(cards,found,bindings){
    const old=new Map(),fresh=new Map(),get=(map,uid,group)=>{if(!map.has(uid))map.set(uid,new Map());if(!map.get(uid).has(group))map.get(uid).set(group,[]);return map.get(uid).get(group);};
    for(const c of cards)if(!c.retired&&c.group&&c.template_key)get(old,c.note_uid,c.group).push(c);
    for(const n of bindings)get(fresh,n.note_uid,n.group);
    for(const n of found)get(fresh,n.note_uid,n.group).push(n);
    const batches=new Map();
    for(const [uid,destinations]of fresh){const previous=old.get(uid);if(!previous)continue;
      if([...previous.keys()].some(k=>destinations.has(k))){if([...destinations.keys()].some(k=>!previous.has(k)))throw Error(`Ambiguous note type change: ${uid}`);continue;}
      if(previous.size!==1||destinations.size!==1)throw Error(`Ambiguous note type change: ${uid}`);
      const source=[...previous.keys()][0],target=[...destinations.keys()][0],key=canonical([source,target]);
      if(!batches.has(key))batches.set(key,{source,target,notes:[]});batches.get(key).notes.push([previous.get(source),destinations.get(target)]);
    }
    let count=0;
    for(const batch of batches.values()){
      this.check();const oldKeys=[...new Set(batch.notes.flatMap(([before])=>before.map(c=>c.template_key)))].sort(),newKeys=[...new Set(batch.notes.flatMap(([,after])=>after.map(c=>c.template_key)))].sort();
      const mapping=await this.options.chooseMapping?.({old_type:batch.source,new_type:batch.target,notes:batch.notes.length,cards:batch.notes.reduce((s,[c])=>s+c.length,0),old_templates:oldKeys,new_templates:newKeys});
      if(!mapping)throw Error('Type conversion cancelled; catalog unchanged');
      const values=Object.values(mapping).filter(x=>x!==null);
      if(canonical(Object.keys(mapping).sort())!==canonical(oldKeys)||values.some(v=>!newKeys.includes(v))||new Set(values).size!==values.length)throw Error('Invalid template mapping');
      for(const [before,after]of batch.notes){const used=new Set();
        for(const card of before){const key=mapping[card.template_key];let matches=after.filter(item=>item.template_key===key);
          if(card.cloze||matches.some(c=>c.cloze))matches=matches.filter(c=>c.anki_ordinal===card.anki_ordinal);
          if(key!==null&&matches.length!==1)throw Error(`Mapping unavailable for ${card.note_uid}; retire it instead`);
          const item=matches[0],identity=item&&canonical([item.template_key,item.anki_ordinal]);if(identity&&used.has(identity))throw Error('Multiple cards map to one destination');used.add(identity);
          const note=bindings.find(n=>n.note_uid===card.note_uid&&n.group===batch.target);
          for(const retired of cards)if(retired.retired&&retired.note_uid===card.note_uid)Object.assign(retired,{group:note.group,source:note.source});
          if(!item)Object.assign(card,{retired:true,group:note.group,source:note.source});
          else {for(const k of ['group','source','template_key','anki_notetype','anki_ordinal'])card[k]=item[k];delete card.cloze;if(item.cloze)card.cloze=true;}
          count++;
        }
      }
    }
    return {count,batches:batches.size};
  }
  async references(){
    const referenced=new Set();for(const file of this.io.files().filter(f=>f.path.startsWith(this.data+'/reviews/')&&f.path.endsWith('.jsonl'))){
      this.check();const key='reviews:'+file.path,stamp=canonical([file.mtime,file.size,file.version||0]);let saved=await this.cache.get(key);
      if(saved?.stamp!==stamp){const ids=new Set(),text=await this.io.read(file.path);let offset=0,processed=0;
        while(offset<text.length){const end=text.indexOf('\n',offset),line=text.slice(offset,end<0?text.length:end);offset=end<0?text.length:end+1;if(line.trim()){const event=JSON.parse(line);if(event.card_id)ids.add(event.card_id);}if(++processed%500===0){this.check();await new Promise(r=>setTimeout(r,0));}}
        saved={stamp,ids:[...ids]};await this.cache.put(key,saved);
      }
      for(const id of saved.ids)referenced.add(id);
    }return referenced;
  }
  async plan(prune=false){
    await new CatalogPublisher(this.io,this.data).recover();const input=await this.inputs(),signature=await this.fingerprint(input,prune);
    const checkpointKey=canonical(['unchanged',prune,this.options.sourcePath||null]);
    const checkpoint=await this.cache.get(checkpointKey);
    if(checkpoint?.signature===signature)return {input,signature,prune,files:{},result:{...checkpoint.result,scan:{parsed_files:0,reused_files:checkpoint.fileCount,hashed_files:0}}};
    if(this.options.sourcePath&&prune)throw Error('File sync must use refresh mode');
    const discovered=await this.discover(input,prune),catalog=await this.catalog(input.manifest);
    if(this.options.sourcePath&&!Object.values(input.config.source_rules).some(rule=>this.files(rule,false,[], '').length))throw Error('This file is not selected by any source rule; run full maintenance for moved or deleted files');
    const cards=hydrateCatalog(catalog.cards,catalog.notes,input.config);let result,notes,stored;
    if(prune){
      const pending=[],protectedCards=[];
      for(const card of cards){if(card.anki_card_id||!card.note_uid?.startsWith('local:')||discovered.live.has(canonical([card.group,card.note_uid])))continue;
        const row={card_id:card.id,note_id:card.note_id,rule:card.group,source:card.source?.path,added_at:card.added_at};
        (card.baseline?.reps?protectedCards:pending).push(row);
      }
      const refs=pending.length?await this.references():new Set(),removable=[];for(const row of pending)(refs.has(row.card_id)?protectedCards:removable).push(row);
      const remove=new Set(removable.map(c=>c.card_id));stored=catalog.cards.filter(c=>!remove.has(c.id));const used=new Set(stored.map(c=>c.note_id)),affected=new Set(removable.map(c=>c.note_id));notes=catalog.notes.filter(n=>!affected.has(n.id)||used.has(n.id));
      result={removable_cards:removable.length,removable_notes:catalog.notes.length-notes.length,cards:removable,protected_cards:protectedCards,scan:this.stats};
    }else{
      const conversions=await this.conversions(cards,discovered.found,discovered.bindings);let added=0,updated=conversions.count;
      const known=new Map(cards.filter(c=>!c.retired||this.options.sourcePath&&this.inScope(c.source?.path)).map(c=>[canonical([c.group,c.note_uid,c.template_key,c.anki_ordinal]),c])),ids=new Set(cards.map(c=>c.id));
      const unbound=new Map();for(const c of cards)if(!c.retired&&(!c.group||!c.template_key)){const k=canonical([c.note_uid,c.anki_notetype,c.anki_ordinal]);if(!unbound.has(k))unbound.set(k,[]);unbound.get(k).push(c);}
      const proposals=new Map();for(const item of discovered.found){const k=canonical([item.note_uid,item.anki_notetype,item.anki_ordinal]);if(unbound.has(k)){if(!proposals.has(k))proposals.set(k,new Set());proposals.get(k).add(canonical([item.group,item.template_key]));}}
      if([...proposals.values()].some(s=>s.size>1))throw Error('Multiple rules bind the same imported card');
      const now=this.options.now?.()??Date.now();
      for(const item of discovered.found){this.check();const key=canonical([item.group,item.note_uid,item.template_key,item.anki_ordinal]);let previous=known.get(key);
        if(previous){if(previous.retired){delete previous.retired;updated++;}if(canonical(previous.source)!==canonical(item.source)){previous.source=item.source;updated++;}continue;}
        const imported=unbound.get(canonical([item.note_uid,item.anki_notetype,item.anki_ordinal]));
        if(imported){if(imported.length!==1)throw Error('Ambiguous imported card binding');previous=imported[0];Object.assign(previous,{group:item.group,template_key:item.template_key,source:item.source,...(item.cloze?{cloze:true}:{})});known.set(key,previous);updated++;continue;}
        if(item.cloze&&cards.some(c=>!c.retired&&c.group===item.group&&c.note_uid===item.note_uid&&c.anki_ordinal===item.anki_ordinal&&c.anki_notetype===item.anki_notetype))continue;
        const template=input.templates.groups[item.group].templates.find(t=>t.key===item.template_key),suffix=item.template_key+(item.anki_ordinal!==template.anki_ordinal?`:cloze:${item.anki_ordinal}`:'');
        const id=await maintenanceCardId(item.group,item.note_uid,suffix);if(ids.has(id))throw Error(`Card identity collision: ${id}`);
        const state={due:now,queue:0,state:0,stability:0,difficulty:0,reps:0,lapses:0,elapsed_days:0,scheduled_days:0,learning_steps:0};
        const card={...item,id,anki_card_id:null,original_deck_id:null,deck_id:`profile:${item.profile_id}`,active:true,supported:true,queue:0,card_type:0,due_ms:now,anki_due:0,baseline:state,scheduling:{queue:0},memory:{}};
        cards.push(card);known.set(key,card);ids.add(id);added++;
      }
      let retired=0;
      if(this.options.sourcePath){
        const generated=new Set(discovered.found.map(c=>canonical([c.group,c.note_uid,c.template_key,c.anki_ordinal])));
        const missing=cards.filter(c=>!c.retired&&this.inScope(c.source?.path)&&!generated.has(canonical([c.group,c.note_uid,c.template_key,c.anki_ordinal])));
        // Resolve missing identities across sources before retiring: a row/block may have moved.
        const absent=missing.filter(c=>!discovered.live.has(canonical([c.group,c.note_uid])));
        if(absent.length){
          const lookup=new CardMaintenance(this.io,this.root,this.cache,{...this.options,sourcePath:null});
          const elsewhere=await lookup.discover(input,true);
          if(elsewhere.issues.length)throw Error('Some sources are unavailable; run full maintenance before retiring missing cards');
          const liveIds=new Set([...elsewhere.live].map(key=>JSON.parse(key)[1]));
          if(absent.some(c=>liveIds.has(c.note_uid)))throw Error('A source identity moved to another file or type; run Refresh cards to reconcile it');
          for(const [path,stamp]of lookup.observed)this.observed.set(path,stamp);
        }
        for(const card of missing){card.retired=true;retired++;}
      }
      const separated=await this.separate(cards);notes=separated.notes;stored=separated.cards;
      result={added,updated,...(this.options.sourcePath?{retired}:{}),cards:cards.length,issues:discovered.issues,type_conversions:conversions.batches,scan:this.stats};
    }
    this.check();for(const [path,stamp]of this.observed)if(canonical(this.io.stat(path))!==stamp)throw Error(`Source changed during scan: ${path}`);const after=await this.inputs(),finalSignature=await this.fingerprint(after,prune);
    // Only our own identity insertions may change input versions during discovery.
    const expected=JSON.parse(signature);for(const row of expected[1]){const seeded=this.seeded.get(row[0]);if(seeded){row[1]=seeded.mtime;row[2]=seeded.size;row[3]=seeded.version||0;}}
    if(canonical(expected)!==finalSignature)throw Error('Sources or logs changed during scan; retry');
    if(canonical(input)!==canonical(after))throw Error('Configuration or catalog changed; retry');
    this.publishTime=new Date(this.options.now?.()??Date.now()).toISOString();const files=this.partitions(catalog,notes,stored),changed=Object.keys(files).length>0;
    const manifest={...input.manifest,catalog_layout:'flat',partition_count:this.partitionCount(stored,catalog.parts.cards),note_partition_count:this.partitionCount(notes,catalog.parts.notes),revision:changed?crypto.randomUUID():input.manifest.revision};delete manifest.partitions;
    const plan={input,signature:finalSignature,prune,files,manifest,result:{...result,revision:manifest.revision}};
    if(!changed)await this.cache.put(checkpointKey,{signature:finalSignature,result:plan.result,fileCount:Object.values(input.config.source_rules).reduce((n,r)=>n+this.files(r,prune,[], '').length,0)});
    return plan;
  }
  async separate(cards){
    const existing=new Map();for(const card of cards)if(card.note_id){const key=canonical([card.group??null,card.note_uid??null]);if(existing.has(key)&&existing.get(key)!==card.note_id)throw Error('Conflicting persistent note identities');existing.set(key,card.note_id);}
    const notes=new Map(),stored=[];
    for(const card of cards){const key=canonical([card.group??null,card.note_uid??null]),note_id=existing.get(key)||await hash(key),source=card.source;
      const locator=source?Object.fromEntries(Object.entries(source).filter(([k])=>['path','kind','candidates','error'].includes(k))):null;
      if(locator?.error?.startsWith('Missing source rule: '))delete locator.error;
      const note={id:note_id,uid:card.note_uid??null,rule_id:card.group??null,locator:locator&&Object.keys(locator).length?locator:null};
      if(notes.has(note_id)&&canonical(notes.get(note_id))!==canonical(note))throw Error('Conflicting note binding');notes.set(note_id,note);
      const record=Object.fromEntries(Object.entries(card).filter(([k])=>!['group','note_uid','source','properties','source_tags','template','fields','history'].includes(k)));stored.push({...record,note_id});
    }return {notes:[...notes.values()],cards:stored};
  }
  arrange(incoming,oldParts){
    const remaining=new Map(incoming.map(c=>[c.id,c]));if(remaining.size!==incoming.length)throw Error('Duplicate catalog identity');
    const parts=oldParts.map(part=>part.flatMap(old=>{const current=remaining.get(old.id);if(!current)return [];remaining.delete(old.id);return [{...current,...(old.added_at?{added_at:old.added_at}:{})}];}));
    const added_at=this.publishTime||new Date(this.options.now?.()??Date.now()).toISOString();
    for(const record of remaining.values()){if(!parts.length||parts.at(-1).length===250)parts.push([]);parts.at(-1).push({...record,added_at:record.added_at||added_at});}return parts;
  }
  partitionCount(incoming,oldParts){return this.arrange(incoming,oldParts).length;}
  partitions(catalog,notes,cards){const files={};for(const [kind,records]of [['notes',notes],['cards',cards]])this.arrange(records,catalog.parts[kind]).forEach((part,i)=>{const old=catalog.parts[kind][i];if(catalog.manifest.catalog_layout!=='flat'||!old||canonical(old)!==canonical(part))files[`${kind}/${kind}-${String(i).padStart(5,'0')}.json`]=part;});return files;}
  async apply(plan){
    this.check();const current=await this.inputs();if(await this.fingerprint(current,plan.prune)!==plan.signature)throw Error('Sources, logs or catalog changed; rerun maintenance');
    if(Object.keys(plan.files).length){
      await new CatalogPublisher(this.io,this.data).publish(plan.input.manifest,plan.manifest,plan.files);
      if(plan.input.manifest.catalog_layout!=='flat'){
        const prefix=this.data+'/';for(const file of this.io.files()){
          const relative=file.path.slice(prefix.length);
          if(file.path.startsWith(prefix)&&/^(?:imports|notes|cards)\/[^/]+\/(?:notes|cards)-\d{5,}\.json$/.test(relative))await this.io.remove(file.path);
        }
      }
    }
    return {...plan.result,...(plan.prune?{applied:true}:{})};
  }
}

// Enumerate configured source files without reading or parsing their contents.
function maintenanceFileChoices(rules,io){
  const engine=new CardMaintenance(io,'',null),choices=new Map();
  for(const [id,rule]of Object.entries(rules))for(const file of engine.files(rule,false,[],id)){
    if(!choices.has(file.path))choices.set(file.path,{path:file.path,rules:[]});
    choices.get(file.path).rules.push(id);
  }
  return [...choices.values()].sort((a,b)=>a.path.localeCompare(b.path));
}
