// Editable study configuration is independent of imported scheduling baselines.
function composeStudyDocuments(parts) {
  for(const doc of Object.values(parts))if(doc?.format_version!==1)throw Error("Unsupported configuration layout");
  const source_rules={};
  for(const [id,rule] of Object.entries(parts.sources.rules))source_rules[id]={...rule,
    fields:rule.fields.map(f=>{const {name,...rest}=f;return name===undefined?rest:{...rest,anki:name};}),...parts.cards.rules[id]};
  return validateStudy({format_version:1,profiles:parts.profiles.profiles,default_profile:parts.profiles.default_profile,
    source_rules,decks:parts.decks.decks,profile_rules:parts.assignments.rules});
}
function hydrateCatalog(cards,notes,study) {
  const bindings=new Map(notes.map(n=>[n.id,n]));
  if(bindings.size!==notes.length)throw Error("Duplicate SRS note binding");
  return cards.map(card=>{
    const note=bindings.get(card.note_id);if(!note)throw Error(`Missing SRS note binding: ${card.note_id}`);
    const rule=study?.source_rules[note.rule_id];
    const source=note.locator?{...note.locator}:null;
    if(source){if(!rule)source.error=`Missing source rule: ${note.rule_id}`;
      else {source.fields=rule.fields;if(rule.prepare)source.prepare=rule.prepare;}}
    return {...card,group:note.rule_id,note_uid:note.uid,source};
  });
}
function validateStudyFilter(query) {
  if(!query || typeof query!=="object" || Array.isArray(query))throw Error("Filter must be an object");
  const allowed=["all","any","not","paths","deck_ids","include_children","groups","templates","tags","properties","card_ids"];
  for(const key of Object.keys(query))if(!allowed.includes(key))throw Error(`Unknown filter field: ${key}`);
  for(const key of ["all","any"])if(key in query){if(!Array.isArray(query[key])||!query[key].length)throw Error(`Invalid ${key} filter`);query[key].forEach(validateStudyFilter);}
  if("not" in query)validateStudyFilter(query.not);
  for(const key of ["paths","deck_ids","groups","templates","tags","card_ids"])if(key in query && (!Array.isArray(query[key])||query[key].some(x=>typeof x!=="string"||!x)))throw Error(`Invalid ${key} filter`);
  if("include_children" in query && typeof query.include_children!=="boolean")throw Error("Invalid include_children filter");
  if("properties" in query){
    if(!query.properties || typeof query.properties!=="object" || Array.isArray(query.properties))throw Error("Invalid properties filter");
    for(const value of Object.values(query.properties))if(value && typeof value==="object" && !Array.isArray(value) && (Object.keys(value).join()!=="exists"||typeof value.exists!=="boolean"))throw Error("Unknown property filter operator");
  }
}
function matchesStudyFilter(card,query,manifest) {
  if(query.all && !query.all.every(q=>matchesStudyFilter(card,q,manifest)))return false;
  if(query.any && !query.any.some(q=>matchesStudyFilter(card,q,manifest)))return false;
  if(query.not && matchesStudyFilter(card,query.not,manifest))return false;
  const path=card.source?.path||"";
  if(query.paths && !query.paths.some(p=>path===p||path.startsWith(p.replace(/\/$/,"")+"/")))return false;
  for(const [key,value] of [["groups",card.group],["templates",card.template_key],["card_ids",card.id]])if(query[key] && !query[key].includes(value))return false;
  if(query.deck_ids){
    let deck=manifest.scheduling.decks[card.deck_id];const ids=new Set([card.deck_id]);
    while(query.include_children && deck?.parent_id){ids.add(deck.parent_id);deck=manifest.scheduling.decks[deck.parent_id];}
    if(!query.deck_ids.some(id=>ids.has(id)))return false;
  }
  const tags=new Set([...(card.source_tags||[]),...(card.card_settings?.tags||[])]);
  if(query.tags && !query.tags.every(tag=>tags.has(tag)))return false;
  for(const [key,expected] of Object.entries(query.properties||{})) {
    if(expected && typeof expected==="object" && !Array.isArray(expected)){
      if(Object.hasOwn(card.properties||{},key)!==expected.exists)return false;
    }else if(canonical(card.properties?.[key])!==canonical(expected))return false;
  }
  return true;
}
function validateStudy(config) {
  if(config?.format_version!==1||!config.profiles||!Object.keys(config.profiles).length||!config.profiles[config.default_profile])throw Error("Invalid study configuration");
  for(const [id,profile] of Object.entries(config.profiles)){
    if(!id)throw Error("Empty profile ID");
    validateOptions(profile.settings);validateSchedulerConfig({scheduler_version:SCHEDULER_VERSION,settings:profile.settings});
    if(!Number.isSafeInteger(profile.reviews_per_day)||profile.reviews_per_day<0)throw Error(`Invalid review limit: ${id}`);
    for(const key of ["learning_steps","relearning_steps"])if(!Array.isArray(profile.settings[key])||profile.settings[key].some(v=>!Number.isFinite(v)||v<=0))throw Error(`Invalid steps: ${id}`);
  }
  for(const rule of config.profile_rules||[]){if(!config.profiles[rule.profile])throw Error("Unknown assignment profile");validateStudyFilter(rule.filter);}
  for(const [id,deck] of Object.entries(config.decks||{})){
    if(typeof deck.name!=="string"||!deck.name.trim())throw Error("Decks need a nonempty name");
    validateStudyFilter(deck.filter);const seen=new Set([id]);let parent=deck.parent_id;
    while(parent!=null){if(!config.decks[parent]||seen.has(parent))throw Error("Missing parent or cycle in study decks");seen.add(parent);parent=config.decks[parent].parent_id;}
  }
  for(const rule of Object.values(config.source_rules||{})){
    if(!config.profiles[rule.profile]||!Array.isArray(rule.sources)||!rule.sources.length||rule.sources.some(p=>typeof p!=="string"||!p||p.startsWith("/")||p.split("/").includes("..")))throw Error("Invalid source rule");
    if(rule.filter)validateStudyFilter(rule.filter);
  }
  return config;
}
function studyProfileId(card,config,manifest) {
  const home=card.original_deck_id?{...card,deck_id:card.original_deck_id}:card;
  const id=card.card_settings?.profile || (config.profile_rules||[]).find(r=>matchesStudyFilter(home,r.filter,manifest))?.profile || card.profile_id || config.default_profile;
  if(!config.profiles[id])throw Error(`Unknown scheduling profile: ${id}`);
  return id;
}
function studyDeckMatches(card,id,config,manifest) {
  if(card.retired)return false;
  const deck=config.decks[id];if(!deck)throw Error(`Unknown study deck: ${id}`);
  if(matchesStudyFilter(card,deck.filter,manifest))return true;
  return Object.entries(config.decks).some(([child,d])=>d.parent_id===id && studyDeckMatches(card,child,config,manifest));
}
function studyRuntimeManifest(original,config) {
  const meta=JSON.parse(JSON.stringify(original.scheduling));
  for(const [id,profile] of Object.entries(config.profiles)){
    const o=profile.settings, preset={id:`profile:${id}`,settings:{new_per_day:o.new_cards_per_day,reviews_per_day:profile.reviews_per_day,
      desired_retention:o.desired_retention,maximum_review_interval:o.maximum_interval,minimum_lapse_interval:o.minimum_interval,
      learn_steps:o.learning_steps,relearn_steps:o.relearning_steps}};
    meta.presets[preset.id]=preset;
    if(profile.imported_preset && meta.presets[profile.imported_preset])meta.presets[profile.imported_preset].settings={...meta.presets[profile.imported_preset].settings,...preset.settings};
    const home=`profile:${id}`;
    meta.decks[home]={id:home,name:profile.name||id,parent_id:null,normal:{config_id:preset.id},common:{},filtered:false};
  }
  return {...original,scheduling:meta,study:config};
}
function studyDeckTree(cards,states,manifest,now,activity,skipped,group) {
  const config=manifest.study, base=deckTree(cards,states,manifest,now,activity);
  const native=new Map();const visit=nodes=>nodes.forEach(n=>{native.set(n.id,n);visit(n.children);});visit(base);
  const nodes=new Map();
  for(const [id,deck] of Object.entries(config.decks)){
    // Imported hierarchy filters can reuse the native counts without rescanning the catalog.
    const descendants=[];const gather=parent=>{for(const [child,d] of Object.entries(config.decks))if(d.parent_id===parent){descendants.push(d);gather(child);}};gather(id);
    const q=deck.filter, direct=Object.keys(q).length===2 && q.include_children===true && q.deck_ids?.length===1 &&
      !descendants.some(d=>!d.filter.deck_ids?.every(x=>native.get(x)?.name.startsWith((native.get(q.deck_ids[0])?.name||"\0")+"::")));
    const target=direct && !group && native.get(q.deck_ids[0]);
    const queue=target || reviewQueueV2(cards,states,activity,manifest,now,group,undefined,null,skipped,c=>studyDeckMatches(c,id,config,manifest),base);
    const matching=target ? null : cards.filter(c=>(!group||c.group===group)&&studyDeckMatches(c,id,config,manifest));
    nodes.set(id,{id,...deck,children:[],new:queue.new??queue.fresh,learning:queue.learning,review:queue.review,
      errors:target?target.errors:matching.filter(c=>c.content_error).length,total:target?target.total:matching.length});
  }
  const roots=[];for(const node of nodes.values())(nodes.get(node.parent_id)?.children||roots).push(node);
  const sort=nodes=>{nodes.sort((a,b)=>a.name.localeCompare(b.name));nodes.forEach(n=>sort(n.children));};sort(roots);return roots;
}
function sourceBlocks(text) {
  const pattern=/^[ \t]{0,3}>[ \t]*\[!(?:anki|srs)\](?:-[ \t]*|[ \t]+)([^\r\n]*)\r?\n((?:^[ \t]{0,3}>[ \t]?(?!\[!(?:anki|srs)\](?:-|[ \t]))[^\r\n]*(?:\r?\n|$))+)((?:^[ \t]*(?:<!--[ \t]*(?:ID|SRS-ID)[ \t]*:[ \t]*[^\r\n]+?[ \t]*-->[ \t]*)?(?:\r?\n|$))*)/gmi;
  return [...text.matchAll(pattern)].flatMap(m=>{
    const markers=[...m[3].matchAll(/<!--[ \t]*(ID|SRS-ID)[ \t]*:[ \t]*([^\r\n]+?)[ \t]*-->/gi)];
    const anki=[...new Set(markers.filter(x=>x[1].toUpperCase()==="ID").map(x=>String(BigInt(x[2].trim()))))];
    const local=[...new Set(markers.filter(x=>x[1].toUpperCase()==="SRS-ID").map(x=>x[2].trim().toLowerCase()))];
    if(anki.length>1 || (!anki.length && local.length>1))throw Error("Conflicting block identities");
    if(!anki.length && !local.length)return [];
    return [{identity:anki.length?`anki:${anki[0]}`:`local:${local[0]}`,
      front:m[1].trim(),tags:[...new Set([...m[2].matchAll(/(?<![\w/])#([\p{L}\p{N}_/-]+)/gu)].map(t=>t[1]))],back:m[2].split(/\r?\n/).map(l=>l.replace(/^[ \t]{0,3}>[ \t]?/,"")).filter(l=>!/^\s*(?:#[^\s#]+\s*)+$/.test(l)).join("\n").trim()}];
  });
}
