  (async () => {
    const api = dv.app, component = dv.component;
    const root = input?.root || "ankobs-srs", dataRoot = `${root}/data`;
    const identity = `ankobs-srs:${api.vault.getName()}:${root}`;
    const host = dv.container.createDiv({cls:"ankobs-srs"});
    const notice = host.createDiv({cls:"srs-notice",attr:{role:"status","aria-live":"polite"}}), controls = host.createDiv({cls:"srs-toolbar"});
    const home = controls.createEl("button",{text:"Decks"});
    let undoReview=null;
    const manage = controls.createEl("button",{text:"Cards"});
    const profilesButton=controls.createEl("button",{text:"Profiles"});
    const sourcesButton=controls.createEl("button",{text:"Sources"});
    const select = controls.createEl("select",{attr:{"aria-label":"Template group"}});
    const tools = controls.createEl("details",{cls:"srs-tools"});
    tools.createEl("summary",{text:"Tools"});
    const toolBody = tools.createDiv();
    const deviceSelect = toolBody.createEl("select",{attr:{"aria-label":"This device"}});
    const refresh = toolBody.createEl("button",{text:"Refresh"});
    const rebuild = toolBody.createEl("button",{text:"Rebuild local index"});
    const content = host.createDiv({cls:"srs-content"});
    const context = content.createDiv({cls:"srs-context"});
    const counts = content.createDiv({cls:"srs-counts"}), homepage = content.createDiv();
    const cardHeader=content.createDiv({cls:"srs-card-header"});
    const front=content.createDiv({cls:"srs-front"}), back=content.createDiv({cls:"srs-back"});
    const actions = host.createDiv({cls:"srs-actions"});
    const cardName=cardHeader.createEl("h3",{cls:"srs-card-name"});
    const cardMenu=cardHeader.createEl("details",{cls:"srs-tools srs-card-menu"});
    cardMenu.createEl("summary",{text:"⋯",attr:{"aria-label":"Card actions"}});
    const cardMenuBody=cardMenu.createDiv();
    const source=cardMenuBody.createDiv();
    const undoButton=cardMenuBody.createEl("button",{text:"Undo review"});
    undoButton.disabled=true;
    cardMenu.hidden=true;
    cardHeader.hidden=true;
    function sizeReviewer(){
      const top=Math.max(0,host.getBoundingClientRect?.().top??0);
      host.style?.setProperty("--srs-top",`${top}px`);
    }
    globalThis.addEventListener?.("resize",sizeReviewer);
    globalThis.visualViewport?.addEventListener("resize",sizeReviewer);
    component.register(()=>{globalThis.removeEventListener?.("resize",sizeReviewer);globalThis.visualViewport?.removeEventListener("resize",sizeReviewer);});
    const sessionCache=ReviewerSessionCache.forVault(api.vault,api.metadataCache);
    let readyEpoch=-1;
    const dirty = new Set(), cache = new Map(), skipped = new Set();
    let taxonomy, presidents;
    let progressStorage;try{progressStorage=globalThis.sessionStorage;}catch{}
    const scanProgress=new ContentCheckProgress(progressStorage,`${identity}:content-check:${input?.group||""}`);
    let scanSignature;
    function bindScanProgress(){
      if(scanSignature===undefined){
        const versions=api.vault.getFiles().filter(f=>!f.path.startsWith(root+"/")).map(f=>[f.path,f.stat?.mtime,f.stat?.size]).sort((a,b)=>a[0].localeCompare(b[0]));
        scanSignature=JSON.stringify([baseManifest.import_id,baseManifest.revision,configKey,versions]);
      }
      scanProgress.bind(scanSignature);
    }
    function invalidateScanProgress(){scanSignature=undefined;scanProgress.invalidate();}

    let contentCache=new Map(), metadataCache=new Map();const metrics=[];
    const counters={fileReads:0,sourceReads:0,renders:0,indexSyncs:0,schedulingBuilds:0,cardPreparations:0,sessionRestores:0};
    let hydrationKey, statesSnapshot, statesRevision;
    let profileCache=new Map();
    let runtimeCache, snapshotCache, runtimeDirty=true, indexDirty=true, catalogDirty=true;
    let operation=0, checking=false, membershipCache=new Map();
    let schedulingIndex, runtimeCards, runtimeSources, runtimeSnapshot;
    let runtimePositions=new Map(), knownErrors=new Map();
    let runtimeLoaded, runtimeBase;
    let knownCardIds, reviewFiles, catalogCache;
    const clock=()=>globalThis.performance?.now?.()??Date.now();
    async function measure(name,fn){const start=clock();try{return await fn();}finally{metrics.push({name,ms:Math.round((clock()-start)*100)/100});if(metrics.length>60)metrics.shift();}}
    const performanceButton=toolBody.createEl("button",{text:"Performance details"});
    performanceButton.onclick=()=>{notice.textContent=JSON.stringify({...counters,scheduling:schedulingIndex?.stats})+" · "+metrics.map(x=>`${x.name}: ${x.ms}ms`).join(" · ");};
    const checkButton=toolBody.createEl("button",{text:"Check content"});
    const cancelCheck=toolBody.createEl("button",{text:"Cancel content check"});
    cancelCheck.onclick=()=>{scanProgress.active=false;scanProgress.save();operation++;checking=false;notice.textContent="Content check cancelled; completed results retained.";};
    function resetQueues(){membershipCache.clear();profileCache.clear();schedulingIndex=null;runtimeCards=null;}
    function deckMatches(card,id){return membershipCache.get(id)?.has(card.id)??studyDeckMatches(card,id,studyConfig,manifest);}
    function inScope(card,deck=selectedDeck){return !card.retired && (!select.value||card.group===select.value) && (!deck || (studyConfig?deckMatches(card,deck):manifest.scheduling.decks[card.deck_id]?.name===manifest.scheduling.decks[deck]?.name||manifest.scheduling.decks[card.deck_id]?.name.startsWith(manifest.scheduling.decks[deck]?.name+"::")));}
    async function rendered(card){
      if(contentCache.has(card.id))return {...card,...contentCache.get(card.id),card_settings:card.card_settings};
      counters.renders++;const generation=sourceGeneration,key=configKey;
      let result;try{result={...await resolveSource({...card}),validation:"valid"};}catch(e){result={...card,content_error:e.message,validation:"error"};}
      if(generation===sourceGeneration&&key===configKey&&!disposed){contentCache.set(card.id,result);
        if(runtimeCards){const position=runtimePositions.get(card.id);if(position!==undefined)runtimeCards[position]=result;if(result.content_error)knownErrors.set(card.id,result);else knownErrors.delete(card.id);}
        schedulingIndex?.update(result);}
      return result;
    }
    async function checkContent(deck=selectedDeck){
      if(checking||busy||managerDirty)return;
      bindScanProgress();scanProgress.active=true;scanProgress.deck=deck;scanProgress.group=select.value;scanProgress.save();
      checking=true;const token=++operation;
      try{const all=(await readSources()).filter(c=>inScope(c,deck));
        for(let i=0;i<all.length;i++){
          if(disposed||token!==operation)return;
          const card=all[i];
          if(!scanProgress.results.has(card.id)){
            const result=await rendered(card);
            if(disposed||token!==operation)return;
            scanProgress.results.set(card.id,result.content_error||null);
          }
          if(i%100===0)scanProgress.save();
          if(i%25===0){notice.textContent=`Checking content: ${i+1}/${all.length}`;await new Promise(resolve=>setTimeout(resolve,0));}
        }
      }catch(e){message(e);}finally{
        if(!disposed){scanProgress.active=false;scanProgress.save();}
        if(token===operation){checking=false;pending=false;await guardedDraw();}
      }
    }
    checkButton.onclick=()=>checkContent(managing?managerDeck:selectedDeck);

    let resolvedCards, resolvedConfig, sourceGeneration = 0, resolvedGeneration = -1;
    const candidateSources = new Map();
    let manifest, baseManifest, studyConfig, studyKey, panel="", cards = [], config, index, states, shown, configKey, started = 0;
    let rawCards=[], noteBindings=[], studyParts=null;
    let timeKey="", nextWake=Infinity;
    let busy = false, disposed = false, refreshTimer, pending = false, selectedDeck = null;
    let reviewing = Boolean(input?.group), activeGroup=input?.group||"";
    const positionKey=`${identity}:position:${input?.group||""}`;
    try {
      const saved=JSON.parse(localStorage.getItem(positionKey)||"null");
      if(saved&&typeof saved.reviewing==="boolean"){
        reviewing=saved.reviewing;
        selectedDeck=typeof saved.deck==="string"?saved.deck:null;
        activeGroup=typeof saved.group==="string"?saved.group:activeGroup;
      }
    }catch{}
    function savePosition(){
      try{localStorage.setItem(positionKey,JSON.stringify({reviewing,deck:selectedDeck,group:activeGroup}));}catch{}
    }
    let deckQuery="", expandedDecks=new Set(), editingDeckId=null;
    let managing=false, managerQuery="", managerStatus="all", managerDeck="", editedCardId=null, managerDirty=false;
    let deviceId = input?.device || localStorage.getItem(`${identity}:device-name`);
    if (!["computer","android"].includes(deviceId))deviceId=/Android/i.test(globalThis.navigator?.userAgent||"")?"android":"computer";
    for(const name of ["computer","android"])deviceSelect.createEl("option",{value:name,text:`Device: ${name}`});
    deviceSelect.value=deviceId;
    localStorage.setItem(`${identity}:device-name`,deviceId);
    deviceSelect.onchange=()=>{deviceId=deviceSelect.value;localStorage.setItem(`${identity}:device-name`,deviceId);};
    component.register(() => {saveRuntime();scanProgress.save();disposed=true;operation++;clearTimeout(refreshTimer);index?.close();catalogCache?.close();});
    const store = {
      async list(directory) {return directory===`${dataRoot}/reviews`?[...reviewFileMap().values()]:api.vault.getFiles().filter(f=>f.path.startsWith(directory+"/"));},
      async read(path) {counters.fileReads++;const f=api.vault.getAbstractFileByPath(path);return f ? api.vault.read(f) : null;},
      async create(path,text) {await api.vault.create(path,text);},
      async mkdir(path) {if(!api.vault.getAbstractFileByPath(path))try{await api.vault.createFolder(path);}catch(error){if(!api.vault.getAbstractFileByPath(path))throw error;}},
      async append(path,text) {const f=api.vault.getAbstractFileByPath(path);if(!f)throw Error(`Missing log: ${path}`);await api.vault.append(f,text);}
    };
    async function json(path) {const text=await store.read(path);if(text===null)throw Error(`Missing SRS file: ${path}`);return JSON.parse(text);}
    async function cachedConfiguration(){if(!runtimeCache||runtimeDirty){runtimeCache=await measure("Configuration",runtimeConfiguration);runtimeDirty=false;}return runtimeCache;}
    async function runtimeConfiguration(){
      if(await store.read(`${dataRoot}/catalog.pending.json`)!==null)throw Error("Catalog update in progress; rerun discovery if it was interrupted.");
      if(await store.read(`${root}/config/sources.json`)!==null){
        const parts={};
        await Promise.all(Object.entries({sources:"config/sources.json",cards:"config/cards.json",decks:"config/decks.json",assignments:"config/profile-rules.json",profiles:"data/profiles.json"}).map(async([key,path])=>{parts[key]=await json(`${root}/${path}`);}));
        return {study:composeStudyDocuments(parts),templates:parts.cards,parts};
      }
      const text=await store.read(`${root}/study.json`);
      return {study:text===null?null:validateStudy(JSON.parse(text)),templates:await json(`${root}/config.json`),parts:null};
    }
    function message(e) {notice.textContent=String(e.message||e);}
    function clearCard() {context.empty();front.empty();back.empty();actions.empty();source.empty();cardHeader.hidden=true;cardMenu.hidden=true;cardMenu.open=false;homepage.empty();shown=null;}
    function reviewFileMap(){
      if(!reviewFiles)reviewFiles=new Map(api.vault.getFiles().filter(f=>f.path.startsWith(`${dataRoot}/reviews/`)&&LOG_PATTERN.test(f.path.split("/").at(-1))).map(f=>[f.path,f]));
      return reviewFiles;
    }
    function logFiles(){return [...reviewFileMap().values()].map(f=>({path:f.path,stat:f.stat?{...f.stat}:undefined}));}
    async function syncIndex() {
      counters.indexSyncs++;
      const force=new Set([...dirty].filter(p=>p.startsWith(`${dataRoot}/reviews/`)));
      const changes=[];
      const result=await index.sync(logFiles(),async f=>{const t=await store.read(f.path);if(t===null)throw Error(`Log disappeared: ${f.path}`);return t;},knownCardIds,{
        force, readSchedulerConfig:id=>store.read(`${dataRoot}/scheduler-configs/${id}.json`),
        onEvents:snapshotCache?batch=>changes.push(...batch):undefined,
        progress:n=>{if(!disposed && n>=500)notice.textContent=`Indexing reviews: ${n.toLocaleString()}…`;}
      });
      for(const path of force)dirty.delete(path);
      if(snapshotCache){
        if(result.rebuilt||changes.some(e=>e.kind==='card_settings')){snapshotCache=null;runtimeCards=null;schedulingIndex=null;indexDirty=true;}
        else {
          snapshotCache.activityIds??=new Set(snapshotCache.activity.map(e=>e.id));
          const touched=new Set();
          for(const event of changes){
            if(event.kind==='historical_review'||event.kind==='scheduling_baseline')continue;
            touched.add(event.card_id);
            if(!snapshotCache.activityIds.has(event.id)&&studyDay(event.review_time_ms,manifest.timing)===studyDay(Date.now(),manifest.timing)){
              snapshotCache.activityIds.add(event.id);snapshotCache.activity.push(event);schedulingIndex?.addActivity(event);
            }
          }
          for(const id of touched){
            const latest=await index.get("latest",id);snapshotCache.latest.set(id,latest);
            const card=runtimeCards?.[runtimePositions.get(id)];
            if(card){const value=current(card,states.get(id)?.state,latest);states.set(id,value);schedulingIndex?.update(card,value);}
          }
          indexDirty=false;
        }
      }
      return result;
    }
    async function noteAt(file) {
      let stored=cache.get(file.path);
      if(!stored || !file.stat || stored.mtime!==file.stat.mtime || stored.size!==file.stat.size || dirty.has(file.path)) {
        counters.sourceReads++;
        const text=await api.vault.read(file);
        if(file.path.endsWith(".csv")) stored={rows:indexRows(parseCSV(text))};
        else {
          // Obsidian owns YAML parsing on both supported platforms.
          const metadata=api.metadataCache.getFileCache(file)?.frontmatter || {};
          stored={metadata,body:text.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/,""),text};
        }
        Object.assign(stored,{mtime:file.stat?.mtime,size:file.stat?.size});cache.set(file.path,stored);dirty.delete(file.path);
      }
      return stored;
    }
    async function resolveSource(card,metadataOnly=false) {
      if(!card.template)throw Error("No editable template mapped to this Anki card ordinal");
      if(!card.template.enabled)throw Error("Template disabled in config/cards.json");
      if(!card.source)throw Error("Unresolved vault source");
      if(card.source.error)throw Error(card.source.error);
      let path=card.source.path;
      if(!path && card.source.candidates) {
        const key=canonical(card.source.candidates);
        if(!candidateSources.has(key)) {
          const identities=new Map();
          for(const file of api.vault.getFiles().filter(f=>card.source.candidates.some(p=>f.path===p||f.path.startsWith(p+"/")))) {
            const note=await noteAt(file);
            const uids=note.rows ? note.rows.keys() : [note.metadata?.anki_note_id ? `anki:${note.metadata.anki_note_id}` : `local:${(note.metadata?.srs_note_id || note.metadata?.srs_uid)}`];
            for(const uid of uids) {
              if(!identities.has(uid))identities.set(uid,[]);
              identities.get(uid).push(file.path);
            }
          }
          candidateSources.set(key,identities);
        }
        const matches=candidateSources.get(key).get(card.note_uid)||[];
        if(matches.length!==1)throw Error(matches.length?"Duplicate vault source identity":"Unresolved vault source");
        path=matches[0];
      }
      const file=api.vault.getAbstractFileByPath(path);
      if(!file)throw Error(`Missing vault source: ${path}`);
      // Membership needs raw properties/tags, never rendered fields or taxonomy preparation.
      const cachedMetadata=metadataOnly&&card.source.kind!=="block"&&!path.endsWith(".csv")?api.metadataCache.getFileCache(file)?.frontmatter:null;
      const data=cachedMetadata?{metadata:cachedMetadata}:await noteAt(file);
      let metadata=data.rows?data.rows.get(card.note_uid):data.metadata;
      if(card.source.prepare==="prepare_taxonomy_notes") {
        if(!taxonomy) {
          const notes=[];
          for(const f of api.vault.getFiles().filter(f=>f.path.startsWith("wiki/life/")&&f.path.endsWith(".md"))) {
            const parsed=await noteAt(f);
            if(Object.keys(parsed.metadata).length)notes.push({path:f.path,filename:f.basename||f.path.split("/").at(-1).replace(/\.md$/,""),metadata:parsed.metadata});
          }
          taxonomy=prepareTaxonomy(notes);
        }
        metadata=taxonomy.get(path)||metadata;
      }
      if(card.source.prepare==="prepare_president_notes") {
        if(!presidents){
          const notes=[];
          for(const f of api.vault.getFiles().filter(f=>f.path.startsWith("wiki/people/us-presidents/")&&f.path.endsWith(".md"))){
            const parsed=await noteAt(f);
            notes.push({path:f.path,filename:f.basename||f.path.split("/").at(-1).replace(/\.md$/,""),metadata:parsed.metadata});
          }
          presidents=preparePresidents(notes);
        }
        metadata=presidents.get(path)||metadata;
      }
      if(card.source.kind==="block") {
        const matches=(data.blocks??=sourceBlocks(data.text)).filter(block=>block.identity===card.note_uid);
        if(matches.length!==1)throw Error(matches.length?"Duplicate block identity":"Missing Markdown block identity");
        metadata={...metadata,$front:matches[0].front,$back:matches[0].back,tags:[...new Set([...(Array.isArray(metadata.tags)?metadata.tags:String(metadata.tags||"").split(/\s+/).filter(Boolean)),...matches[0].tags])]};
      }
      if(!metadata)throw Error(`Missing source identity: ${card.note_uid}`);
      if(card.source.kind!=="block" && !data.rows && (metadata.anki_note_id || metadata.srs_note_id || metadata.srs_uid)) {
        const uid=metadata.anki_note_id?`anki:${metadata.anki_note_id}`:`local:${metadata.srs_note_id || metadata.srs_uid}`;
        if(uid!==card.note_uid)throw Error("Source identity changed");
      }
      const note={metadata,body:data.body,filename:file.basename||file.path.split("/").at(-1).replace(/\.md$/,""),path,lookups:{us_states:US_STATES}};
      card.properties=metadata;
      card.source_tags=Array.isArray(metadata.tags)?metadata.tags:String(metadata.tags||"").split(/\s+/).filter(Boolean);
      if(metadataOnly)return {...card,source:{...card.source,path},validation:"unchecked"};
      const fields=fieldsFromNote(card,note);
      const special={...fields,Deck:manifest.scheduling?.decks[card.deck_id]?.name||"",Subdeck:manifest.scheduling?.decks[card.deck_id]?.name.split("::").at(-1)||"",Card:card.template.key,Type:card.anki_notetype,Tags:Array.isArray(metadata.tags)?metadata.tags.join(" "):String(metadata.tags||"")};
      const images=text=>resolveImageEmbeds(text,path,
        (target,source)=>api.metadataCache.getFirstLinkpathDest(target,source),
        file=>api.vault.getResourcePath(file));
      const frontText=images(renderV2(card.template.front,special,card.anki_ordinal,false,config));
      const backText=images(renderV2(card.template.back,{...special,FrontSide:frontText},card.anki_ordinal,true,config));
      templateScriptParts(frontText,config.allow_javascript);templateScriptParts(backText,config.allow_javascript);
      if(!frontText.trim())throw Error("Template produced an empty question");
      return {...card,source:{...card.source,path},fields,frontText,backText};
    }
    async function readSources() {
      if(resolvedCards && resolvedConfig===configKey && resolvedGeneration===sourceGeneration)return resolvedCards;
      const generation=sourceGeneration;

      const result=[];
      const metadataFilters=[...Object.values(studyConfig?.decks||{}).map(d=>d.filter),...(studyConfig?.profile_rules||[]).map(r=>r.filter)].filter(filter=>/"(?:tags|tag_prefixes|properties)"/.test(JSON.stringify(filter)));
      const prepared=configuredCards(cards,config).map(configured=>{
        const rule=studyConfig?.source_rules[configured.group];
        const card=rule && configured.source ? {...configured,source:{...configured.source,fields:rule.fields,prepare:rule.prepare||null}}:configured;
        return {card,needsMetadata:!card.retired&&metadataFilters.some(filter=>studyFilterNeedsMetadata(card,filter,manifest))};
      });
      // Fetch each directly located text source once, with bounded concurrency.
      // Resolution below still reports source errors on the individual card.
      const files=new Map();
      for(const {card,needsMetadata} of prepared)if(needsMetadata&&!metadataCache.has(card.id)&&card.source?.path){
        const file=api.vault.getAbstractFileByPath(card.source.path);
        if(file&&(card.source.kind==="block"||file.path.endsWith(".csv")||!api.metadataCache.getFileCache(file)?.frontmatter))files.set(file.path,file);
      }
      await readCatalogPartitions([...files.values()],async file=>{try{await noteAt(file);}catch{}return [];});
      for(const {card,needsMetadata} of prepared){
        try {
          if(needsMetadata){if(!metadataCache.has(card.id))metadataCache.set(card.id,await resolveSource({...card},true));result.push(metadataCache.get(card.id));}
          else result.push({...card,validation:"unchecked"});
        }
        catch(e) {result.push({...card,content_error:e.message});}
      }
      resolvedCards=result;resolvedConfig=configKey;resolvedGeneration=generation;
      return result;
    }
    function current(card,baseline,latest) {return latest?{state:latest.state,parent:latest.id}:{state:baseline,parent:`import:${manifest.import_id}:${card.id}`};}
    async function baseline(card) {
      if(card.baseline)return card.baseline;
      const options=effectiveSettings(card,manifest);
      const key=`${card.id}:${await hash(canonical(options))}`;
      let state=await index.get("baselines",key);
      if(!state) {
        const history=card.history || (card.history_path ? (await json(`${dataRoot}/${card.history_path}`))[card.id] : await index.historyFor(card.id));
        state=initialState({...card,history},schedulerV2(options));
        if(card.scheduling)Object.assign(state,{reps:card.scheduling.reps,lapses:card.scheduling.lapses,
          scheduled_days:card.scheduling.ivl,queue:card.queue,anki_due:card.anki_due,
          learning_steps:Math.max(0,(card.card_type===3?options.relearning_steps:options.learning_steps).length-card.scheduling.left%1000)});
        await index.put("baselines",key,state);
      }
      return state;
    }
    function displayCardContent(container,text) {
      const {html,scripts}=templateScriptParts(text,config.allow_javascript);
      const side=container.createDiv();
      dv.el("div",html,{container:side});
      runTemplateScripts(side,scripts);
    }
    function showCounts(el,n) {
      el.createEl("span",{text:`${n.new ?? n.fresh ?? 0} new`,cls:"srs-new"});
      el.createEl("span",{text:` · ${n.learning||0} learning`,cls:"srs-learning"});
      el.createEl("span",{text:` · ${n.review||0} review`,cls:"srs-review"});
      if(n.errors)el.createEl("span",{text:` · ${n.errors} content errors`,cls:"srs-errors"});
    }
    function contentProblems(available) {
      return [...knownErrors.values()].filter(c=>c.content_error && (!select.value || c.group===select.value) &&
        (studyConfig ? !selectedDeck || deckMatches(c,selectedDeck) : !selectedDeck || manifest.scheduling.decks[c.deck_id]?.name===manifest.scheduling.decks[selectedDeck]?.name ||
          manifest.scheduling.decks[c.deck_id]?.name.startsWith(manifest.scheduling.decks[selectedDeck]?.name+"::")));
    }
    function showErrors(available) {
      const count=schedulingIndex?.counts(selectedDeck,select.value).errors??contentProblems(available).length;
      if(!count)return;
      const details=homepage.createEl("details");details.createEl("summary",{text:`Inspect ${count} content errors`});
      let loaded=false;
      details.ontoggle=()=>{
        if(!details.open||loaded)return;loaded=true;
        for(const category of groupContentErrors(contentProblems(available))){
          const section=details.createEl("details");section.createEl("summary",{text:`${category.category} · ${category.groups.reduce((n,g)=>n+g.cards.length,0)} errors`});
          for(const group of category.groups){
            const bucket=section.createEl("details");bucket.createEl("summary",{text:`${group.type} · ${group.error} · ${group.cards.length} cards`});
            let offset=0,more;
            const page=()=>{
              more?.remove();
              for(const card of group.cards.slice(offset,offset+50)){
                const row=bucket.createDiv();row.createEl("p",{text:card.note_uid||card.id});
                if(card.source?.path)row.createEl("a",{text:"Open source"}).onclick=()=>api.workspace.openLinkText(card.source.path,"","tab");
              }
              offset+=50;
              if(offset<group.cards.length){more=bucket.createEl("button",{text:"Show more cards"});more.onclick=page;}
            };
            bucket.ontoggle=()=>{if(bucket.open&&offset===0)page();};
          }
        }
      };
    }

    function openCardSettings(card) {
      if(!leaveEditor())return;
      panel="";managing=true;editedCardId=card.id;managerDirty=false;guardedDraw();
    }
    function leaveEditor() {
      if(managerDirty){notice.textContent="You have unsaved changes. Save them or use the discard/close action before navigating.";return false;}
      return true;
    }
    function showDecks(queue,available) {
      homepage.createEl("h2",{text:"Decks"});
      homepage.createEl("p",{text:"Choose a deck to study, or browse its cards. Counts include subdecks.",cls:"srs-muted"});
      const filters=homepage.createDiv({cls:"srs-deck-filters"});
      const search=filters.createEl("input",{type:"search",value:deckQuery,attr:{placeholder:"Find a deck…","aria-label":"Find a deck"}});
      const expand=filters.createEl("button",{text:"Expand all"}),collapse=filters.createEl("button",{text:"Collapse all"});
      if(studyConfig)filters.createEl("button",{text:"New deck"}).onclick=()=>{editingDeckId=null;panel="deck";guardedDraw();};
      const list=homepage.createDiv({cls:"srs-deck-list"});
      function render() {
        list.empty();const query=deckQuery.trim().toLocaleLowerCase();
        const matches=node=>node.name.toLocaleLowerCase().includes(query)||node.children.some(matches);
        const build=(nodes,container)=>{for(const n of nodes) {
          if(query && !matches(n))continue;
          const details=container.createEl("details",{cls:"srs-deck"});
          details.open=Boolean(query)||expandedDecks.has(n.id);
          details.ontoggle=()=>{if(query)return;if(details.open)expandedDecks.add(n.id);else expandedDecks.delete(n.id);};
          const summary=details.createEl("summary",{attr:{"aria-label":n.name}});
          summary.createEl("span",{text:n.name.split("::").at(-1),cls:"srs-deck-name"});
          const badges=summary.createDiv({cls:"srs-deck-counts"});showCounts(badges,n);
          const buttons=summary.createDiv({cls:"srs-deck-actions"});
          buttons.createEl("button",{text:"Review",attr:{"aria-label":`Review ${n.name}`}}).onclick=e=>{e.preventDefault();selectedDeck=n.id;reviewing=true;guardedDraw();};
          buttons.createEl("button",{text:"Browse cards",attr:{"aria-label":`Browse cards in ${n.name}`}}).onclick=e=>{
            e.preventDefault();managerDeck=n.id;managerQuery="";managerStatus="all";editedCardId=null;managing=true;guardedDraw();
          };
          if(studyConfig)buttons.createEl("button",{text:"Edit",attr:{"aria-label":`Edit deck ${n.name}`}}).onclick=e=>{e.preventDefault();editingDeckId=n.id;panel="deck";guardedDraw();};
          const children=details.createDiv({cls:"srs-subdecks"});build(n.children,children);
          if(!n.children.length)details.open=false;
        }};build(queue.tree,list);
        if(!list.children.length)list.createEl("p",{text:"No decks match. Try another name.",cls:"srs-empty"});
      }
      search.oninput=()=>{deckQuery=search.value;render();};
      expand.onclick=()=>{const add=nodes=>{for(const n of nodes){expandedDecks.add(n.id);add(n.children);}};add(queue.tree);render();};
      collapse.onclick=()=>{expandedDecks.clear();deckQuery="";search.value="";render();};
      render();showErrors(available);
    }
    function showCardManager(available) {
      homepage.createEl("h3",{text:"Cards"});
      const filters=homepage.createDiv({cls:"srs-card-filters"});
      const search=filters.createEl("input",{type:"search",value:managerQuery,attr:{placeholder:"Search cards, sources, templates, or tags","aria-label":"Search cards"}});
      const status=filters.createEl("select",{attr:{"aria-label":"Card status"}});
      for(const [value,text] of [["all","All cards"],["active","Active cards"],["suspended","Suspended cards"],["errors","Content errors"]])status.createEl("option",{value,text});
      status.value=managerStatus;
      const deck=filters.createEl("select",{attr:{"aria-label":"Card deck"}});
      deck.createEl("option",{value:"",text:"All decks"});
      for(const [id,d] of Object.entries(studyConfig?.decks||manifest.scheduling?.decks||{}).sort(([,a],[,b])=>a.name.localeCompare(b.name)))deck.createEl("option",{value:id,text:d.name});
      deck.value=managerDeck;
      const summary=homepage.createDiv({cls:"srs-card-summary",attr:{role:"status","aria-live":"polite"}});
      const browser=homepage.createDiv({cls:"srs-card-browser"});
      const list=browser.createDiv({cls:"srs-card-list"}), editor=browser.createDiv({cls:"srs-card-editor"});
      const emptyEditor=()=>{editor.empty();editor.createEl("p",{text:"Select a card to preview its question and answer, suspend it, or edit its tags.",cls:"srs-empty"});};
      emptyEditor();
      const entries=available.map(card=>({card,text:[card.id,card.note_uid,card.anki_notetype,card.template_key,card.source?.path,...(card.source?.candidates||[]),
        manifest.scheduling?.decks[card.deck_id]?.name,card.frontText,card.backText,card.content_error,...(card.card_settings?.tags||[])].join(" ").toLocaleLowerCase()}));
      const searchContent=homepage.createEl("button",{text:"Search card content"});
      searchContent.onclick=()=>checkContent(managerDeck);
      const unchecked=available.filter(c=>inScope(c,managerDeck)&&!contentCache.has(c.id)).length;
      if(unchecked)homepage.createEl("p",{text:`${unchecked} unchecked cards; content search and error results are incomplete until you check content.`,cls:"srs-muted"});
      const rowButtons=new Map();
      const label=card=>(card.frontText||card.note_uid||card.id).replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,140);
      async function edit(card) {
        const token=operation;editedCardId=card.id;card=await rendered(card);if(disposed||token!==operation||editedCardId!==card.id)return;
        if(!leaveEditor())return;
        for(const [id,button] of rowButtons)button.setAttribute("aria-pressed",String(id===card.id));
        editedCardId=card.id;managerDirty=false;editor.empty();
        editor.createEl("h4",{text:label(card)});
        editor.createEl("p",{text:manifest.scheduling?.decks[card.deck_id]?.name||card.group||"",cls:"srs-muted"});
        if(!card.content_error) {
          const preview=editor.createDiv({cls:"srs-card-preview"});
          preview.createEl("h5",{text:"Question"});displayCardContent(preview,card.frontText);
          preview.createEl("h5",{text:"Answer"});displayCardContent(preview,card.backText);
        }
        const metadata=editor.createEl("details",{cls:"srs-card-metadata"});
        metadata.createEl("summary",{text:"Card details"});
        metadata.createEl("p",{text:`${card.anki_notetype||"Card"} · ${card.template_key||`ordinal ${card.anki_ordinal}`}`});
        metadata.createEl("p",{text:`Card ID: ${card.id}`});
        if(card.source?.path)editor.createEl("a",{text:"Open source"}).onclick=()=>api.workspace.openLinkText(card.source.path,"","tab");
        if(card.content_error)editor.createEl("p",{text:card.content_error,cls:"srs-errors"});
        const suspension=editor.createEl("label",{text:"Suspended "});
        const suspended=suspension.createEl("input",{type:"checkbox"});
        const originalSuspended=cardSuspended(card,states.get(card.id));suspended.checked=originalSuspended;
        const tagLabel=editor.createEl("label",{text:"Card tags (comma-separated)"});
        const tags=tagLabel.createEl("input",{type:"text",value:(card.card_settings?.tags||[]).join(", ")});
        let profileSelect;
        if(studyConfig){
          const profileLabel=editor.createEl("label",{text:"Scheduling profile"});
          profileSelect=profileLabel.createEl("select",{attr:{"aria-label":"Card scheduling profile"}});
          profileSelect.createEl("option",{value:"",text:`Automatic (${studyConfig.profiles[studyProfileId({...card,card_settings:{...card.card_settings,profile:null}},studyConfig,manifest)].name})`});
          for(const [id,p] of Object.entries(studyConfig.profiles))profileSelect.createEl("option",{value:id,text:p.name||id});
          profileSelect.value=card.card_settings?.profile||"";
        }
        const changed=editor.createDiv({cls:"srs-muted",attr:{role:"status"}});
        suspended.onchange=tags.oninput=()=>{managerDirty=true;changed.textContent="Unsaved changes";};
        if(profileSelect)profileSelect.onchange=()=>{managerDirty=true;changed.textContent="Unsaved changes";};
        const buttons=editor.createDiv();
        buttons.createEl("button",{text:"Save card settings",cls:"mod-cta"}).onclick=()=>{
          const changes={}, nextTags=[...new Set(tags.value.split(",").map(t=>t.trim()).filter(Boolean))];
          if(profileSelect && profileSelect.value!==(card.card_settings?.profile||""))changes.profile=profileSelect.value||null;
          if(suspended.checked!==originalSuspended)changes.suspended=suspended.checked;
          if(canonical(nextTags)!==canonical(card.card_settings?.tags||[]))changes.tags=nextTags;
          return saveCardSettings(card,changes);
        };
        buttons.createEl("button",{text:"Use imported defaults"}).onclick=()=>saveCardSettings(card,{suspended:null,tags:null,...(studyConfig?{profile:null}:{})});
        buttons.createEl("button",{text:"Close settings"}).onclick=()=>{emptyEditor();editedCardId=null;managerDirty=false;for(const button of rowButtons.values())button.setAttribute("aria-pressed","false");};
      }
      function renderList() {
        list.empty();rowButtons.clear();
        const terms=managerQuery.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
        const deckName=manifest.scheduling?.decks[managerDeck]?.name;
        const matches=entries.filter(({card,text})=>!card.retired && terms.every(term=>text.includes(term)) &&
          (managerStatus==="all" || (managerStatus==="errors" ? Boolean(card.content_error) : cardSuspended(card,states.get(card.id))===(managerStatus==="suspended"))) &&
          (studyConfig ? !managerDeck || deckMatches(card,managerDeck) : !deckName || manifest.scheduling.decks[card.deck_id]?.name===deckName || manifest.scheduling.decks[card.deck_id]?.name.startsWith(deckName+"::")));
        summary.textContent=`${matches.length.toLocaleString()} matching cards`;
        if(!matches.length)list.createEl("p",{text:"No cards match these filters. Try a different search or deck.",cls:"srs-empty"});
        let offset=0, more;
        const page=()=>{
          if(more)more.remove();
          for(const {card} of matches.slice(offset,offset+50)) {
            const row=list.createDiv({cls:"srs-card-row"});
            const button=row.createEl("button",{text:label(card),attr:{"aria-label":`Edit ${label(card)}`,"aria-pressed":String(editedCardId===card.id)}});
            rowButtons.set(card.id,button);button.onclick=()=>edit(card);
            if(card.content_error)row.createEl("small",{text:"Content error",cls:"srs-error-badge"});
            row.createEl("span",{text:`${cardSuspended(card,states.get(card.id))?"Suspended":"Active"} · ${card.template_key||card.anki_ordinal} · ${manifest.scheduling?.decks[card.deck_id]?.name||""}${card.card_settings?.tags?.length?" · "+card.card_settings.tags.join(", "):""}`});
          }
          offset+=50;
          if(offset<matches.length){more=list.createEl("button",{text:"Show more cards"});more.onclick=page;}
        };page();
      }
      search.oninput=()=>{managerQuery=search.value;renderList();};
      status.onchange=()=>{managerStatus=status.value;renderList();};
      deck.onchange=()=>{managerDeck=deck.value;renderList();};
      renderList();
      const selected=available.find(card=>card.id===editedCardId);if(selected)edit(selected);
    }
    function showConfiguration(section){
      if(section==="deck"){showDeckEditor();return;}
      homepage.createEl("h2",{text:section==="profiles"?"Scheduling profiles":"Sources"});
      if(!studyConfig){homepage.createEl("p",{text:"Create the study configuration once from migration/: uv run python migrate.py init-study"});return;}
      homepage.createEl("button",{text:panel==="profiles"?"Open scheduling profiles":"Open source rules"}).onclick=()=>api.workspace.openLinkText(`${root}/${studyParts?(panel==="profiles"?"data/profiles.json":"config/sources.json"):"study.json"}`,"","tab");
      if(section==="sources"){
        homepage.createEl("p",{text:"Rules create cards from your vault content. Templates define the questions; study decks select which cards to practice."});
        homepage.createEl("p",{text:"Discover additions on desktop from tools/: uv run python srs.py refresh-cards. Then Refresh here to load them. This preserves existing schedules and review logs."});
        for(const [id,rule] of Object.entries(studyConfig.source_rules)){
          const row=homepage.createDiv({cls:"srs-card-editor"});row.createEl("h3",{text:id});
          row.createEl("p",{text:rule.sources.join(", ")});row.createEl("p",{text:`Templates: ${rule.templates.join(", ")}`});
          row.createEl("p",{text:`New cards use: ${studyConfig.profiles[rule.profile].name||rule.profile}`});
        }return;
      }
      homepage.createEl("p",{text:"Changes apply to future answers. Current memory states and due dates are preserved. Imported deck limits and daily counters remain in force."});
      const profileForms=[];
      for(const [id,profile] of Object.entries(studyConfig.profiles)){
        const row=homepage.createEl("details",{cls:"srs-profile"});row.createEl("summary",{text:profile.name||id});
        row.createEl("p",{text:`Train on desktop from tools/: uv run python srs.py train --profile ${id} --apply`});
        const fields={};profileForms.push(row);
        for(const [key,label,value,type] of [["name","Name",profile.name,"text"],["desired_retention","Desired retention (0–1)",profile.settings.desired_retention,"number"],
          ["new_cards_per_day","New cards per day",profile.settings.new_cards_per_day,"number"],["reviews_per_day","Reviews per day",profile.reviews_per_day,"number"],
          ["learning_steps","Learning steps in minutes",profile.settings.learning_steps.join(", "),"text"],["relearning_steps","Relearning steps in minutes",profile.settings.relearning_steps.join(", "),"text"]]){
          const labelEl=row.createEl("label",{text:label});fields[key]=labelEl.createEl("input",{type,value:String(value),attr:{"aria-label":`${profile.name||id}: ${label}`}});
          fields[key].oninput=()=>{managerDirty=true;for(const other of profileForms)if(other!==row){other.querySelectorAll("input").forEach(e=>e.disabled=true);other.querySelectorAll("button").forEach(e=>e.disabled=true);}notice.textContent="Unsaved profile changes. Save or discard before navigating.";};
        }
        const weights=row.createEl("details");weights.createEl("summary",{text:`${profile.settings.weights.length} FSRS parameters`});weights.createEl("pre",{text:JSON.stringify(profile.settings.weights)});
        row.createEl("button",{text:"Save profile",cls:"mod-cta"}).onclick=async()=>{
          if(busy)return;busy=true;
          try{
            const replacement=JSON.parse(JSON.stringify(studyConfig)),next=replacement.profiles[id];
            next.name=fields.name.value.trim()||id;next.reviews_per_day=Number(fields.reviews_per_day.value);
            for(const key of ["desired_retention","new_cards_per_day"])next.settings[key]=Number(fields[key].value);
            for(const key of ["learning_steps","relearning_steps"])next.settings[key]=fields[key].value.trim()?fields[key].value.split(",").map(x=>Number(x.trim())):[];
            validateStudy(replacement);
            await commitStudy(replacement);
            managerDirty=false;await draw();notice.textContent="Profile saved. Existing due dates are preserved.";
          }catch(e){message(e);}finally{busy=false;}
        };
        row.createEl("button",{text:"Discard profile changes"}).onclick=()=>{managerDirty=false;guardedDraw();};
      }
    }
    async function commitStudy(replacement){
      validateStudy(replacement);
      await withStoreLock(identity,async()=>{
        const latest=await runtimeConfiguration();
        if(canonical(latest.study)!==studyKey)throw Error("Study configuration changed; discard changes, Refresh and retry");
        let path=`${root}/study.json`,before=studyConfig,after=replacement;
        if(studyParts){
          const changed=[];
          if(canonical(replacement.profiles)!==canonical(studyConfig.profiles)||replacement.default_profile!==studyConfig.default_profile)
            changed.push({path:`${dataRoot}/profiles.json`,before:studyParts.profiles,after:{format_version:1,profiles:replacement.profiles,default_profile:replacement.default_profile}});
          if(canonical(replacement.decks)!==canonical(studyConfig.decks))
            changed.push({path:`${root}/config/decks.json`,before:studyParts.decks,after:{format_version:1,decks:replacement.decks}});
          if(canonical(replacement.source_rules)!==canonical(studyConfig.source_rules)||canonical(replacement.profile_rules)!==canonical(studyConfig.profile_rules))throw Error("Edit source and assignment rules in config/");
          if(!changed.length)return;if(changed.length!==1)throw Error("Save one configuration document at a time");
          ({path,before,after}=changed[0]);
        }
        const file=api.vault.getAbstractFileByPath(path);
        const update=text=>{if(canonical(JSON.parse(text))!==canonical(before))throw Error("Configuration changed; discard changes, Refresh and retry");return JSON.stringify(after,null,2)+"\n";};
        if(api.vault.process)await api.vault.process(file,update);
        else await api.vault.modify(file,update(await api.vault.read(file)));
        runtimeDirty=true;resetQueues();
      });
    }
    function showDeckEditor(){
      const previous=editingDeckId && studyConfig.decks[editingDeckId];
      homepage.createEl("h2",{text:previous?"Edit study deck":"New study deck"});
      homepage.createEl("p",{text:"A study deck selects existing cards. It does not create cards or change their schedules. Parent decks also include their children's selections."});
      const form=homepage.createDiv({cls:"srs-card-editor"});
      const name=form.createEl("label",{text:"Name"}).createEl("input",{type:"text",value:previous?.name||"",attr:{"aria-label":"Deck name"}});
      const parent=form.createEl("label",{text:"Parent deck"}).createEl("select",{attr:{"aria-label":"Parent deck"}});
      parent.createEl("option",{value:"",text:"None"});
      for(const [id,deck] of Object.entries(studyConfig.decks))if(id!==editingDeckId)parent.createEl("option",{value:id,text:deck.name});parent.value=previous?.parent_id||"";
      const mode=form.createEl("label",{text:"Select cards using"}).createEl("select",{attr:{"aria-label":"Deck filter mode"}});
      if(previous)mode.createEl("option",{value:"existing",text:"Keep existing filter"});mode.createEl("option",{value:"sources",text:"Source paths, templates and tags"});mode.value=previous?"existing":"sources";
      const inputs={};
      for(const [key,title,placeholder] of [["paths","Source paths","wiki/biology, data/words.csv"],["groups","Source rule names","example-notes"],["templates","Template keys","recognition"],["tags","Required tags","extra-practice"]]){
        const label=form.createEl("label",{text:title});inputs[key]=label.createEl("input",{type:"text",value:(previous?.filter[key]||[]).join(", "),attr:{placeholder,"aria-label":`Deck ${title.toLowerCase()}`}});
        inputs[key].disabled=mode.value==="existing";
      }
      form.createEl("p",{text:"Separate alternatives with commas. All listed tags are required. Blank fields match all cards. Choose source filters to replace the existing filter.",cls:"srs-muted"});
      for(const control of [name,parent,mode,...Object.values(inputs)]){
        const change=()=>{managerDirty=true;notice.textContent="Unsaved deck changes.";for(const field of Object.values(inputs))field.disabled=mode.value==="existing";};
        if(control===parent||control===mode)control.onchange=change;else control.oninput=change;
      }
      form.createEl("button",{text:"Save deck",cls:"mod-cta"}).onclick=async()=>{
        if(busy)return;busy=true;
        try{
          if(!name.value.trim())throw Error("Give the deck a name");
          const replacement=JSON.parse(JSON.stringify(studyConfig)),id=editingDeckId||name.value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||crypto.randomUUID();
          if(!editingDeckId && replacement.decks[id])throw Error("A deck with that ID already exists; choose another name");
          const filter=mode.value==="existing"?previous.filter:Object.fromEntries(Object.entries(inputs).map(([key,field])=>[key,field.value.split(",").map(x=>x.trim()).filter(Boolean)]).filter(([,values])=>values.length));
          replacement.decks[id]={name:name.value.trim(),parent_id:parent.value||null,filter};
          await commitStudy(replacement);managerDirty=false;panel="";reviewing=false;selectedDeck=null;await draw();notice.textContent="Study deck saved.";
        }catch(e){message(e);}finally{busy=false;}
      };
      form.createEl("button",{text:"Discard deck changes"}).onclick=()=>{managerDirty=false;panel="";guardedDraw();};
    }
    async function saveCardSettings(card,changes) {
      if(busy)return;
      if(!Object.keys(changes).length){managerDirty=false;notice.textContent="No settings changed.";return;}
      busy=true;homepage.querySelectorAll("button").forEach(button=>button.disabled=true);
      try {
        await withStoreLock(identity,async()=>{
          if((await json(`${dataRoot}/manifest.json`)).revision!==manifest.revision)throw Error("Catalog changed; reopen the view");
          await syncIndex();
          const event={format_version:2,kind:"card_settings",id:crypto.randomUUID(),device_id:deviceId,card_id:card.id,time_ms:Date.now(),changes};
          validateEvent(event,manifest.import_id);
          const logPath=await appendReview(store,`${dataRoot}/reviews`,event);
          reviewFileMap().set(logPath,api.vault.getAbstractFileByPath(logPath));
          dirty.add(logPath);await syncIndex();
        });
        managerDirty=false;await draw();notice.textContent="Card settings saved.";
      }catch(e){message(e);homepage.querySelectorAll("button").forEach(button=>button.disabled=false);}
      finally{busy=false;if(pending && !managerDirty){pending=false;scheduleRefresh();}}
    }
    async function draw(){
      const epoch=sessionCache.epoch;readyEpoch=-1;
      await drawContents();
      if(epoch===sessionCache.epoch)readyEpoch=epoch;
    }
    async function drawContents() {
      if(disposed)return;
      clearCard();counts.empty();notice.textContent="";
      host.setAttribute("data-reviewing",String(reviewing&&!managing&&!panel));
      sizeReviewer();
      content.scrollTop=0;
      home.setAttribute("aria-pressed",String(!panel && !managing && !reviewing));
      profilesButton.setAttribute("aria-pressed",String(panel==="profiles"));
      sourcesButton.setAttribute("aria-pressed",String(panel==="sources"));
      manage.setAttribute("aria-pressed",String(managing));
      const freshManifest=catalogDirty?await json(`${dataRoot}/manifest.json`):baseManifest;
      if(freshManifest.import_id!==baseManifest.import_id)throw Error("Imported baseline changed; reopen this view");
      if(freshManifest.revision!==baseManifest.revision){invalidateScanProgress();await loadCatalog(freshManifest);resolvedCards=null;contentCache.clear();metadataCache.clear();resetQueues();}
      const loaded=await cachedConfiguration();
      if(runtimeLoaded!==loaded||runtimeBase!==baseManifest){
        studyConfig=loaded.study;studyParts=loaded.parts;studyKey=canonical(studyConfig);
        manifest=studyConfig?studyRuntimeManifest(baseManifest,studyConfig):baseManifest;
        config=loaded.templates;const nextConfigKey=canonical({templates:config,study:studyConfig});
        if(configKey!==nextConfigKey){scanSignature=undefined;contentCache.clear();metadataCache.clear();resolvedCards=null;resetQueues();operation++;}
        configKey=nextConfigKey;runtimeLoaded=loaded;runtimeBase=baseManifest;
      }
      catalogDirty=false;
      if(selectedDeck&&!(studyConfig?.decks[selectedDeck]||(!studyConfig&&manifest.scheduling?.decks[selectedDeck]))){selectedDeck=null;reviewing=false;}
      savePosition();
      const nextHydrationKey=baseManifest.revision+":"+configKey;
      if(hydrationKey!==nextHydrationKey){cards=baseManifest.note_partition_count===undefined?rawCards:hydrateCatalog(rawCards,noteBindings,studyConfig);hydrationKey=nextHydrationKey;}
      const today=dayNumber(Date.now(),manifest.timing);
      if(!snapshotCache||indexDirty||snapshotCache.today!==today){
        await measure("Review index",()=>withStoreLock(identity,async()=>{
          if(snapshotCache?.today!==today)snapshotCache=null;
          await syncIndex();
          if(!snapshotCache){snapshotCache={latest:await index.latest(),activity:await index.activityToday(Date.now()),settings:await index.cardSettings(),today};resetQueues();}
        }));
        indexDirty=false;
      }
      bindScanProgress();
      const snapshot=snapshotCache;
      const sources=await measure("Source metadata",readSources);
      if(!runtimeCards||runtimeSources!==sources||runtimeSnapshot!==snapshot){
        counters.cardPreparations++;
        runtimePositions.clear();knownErrors.clear();
        runtimeCards=await measure("Card index preparation",async()=>sources.map((card,i)=>{
          if(scanProgress.results.get(card.id))card={...card,content_error:scanProgress.results.get(card.id),validation:"error"};
          if(contentCache.has(card.id))card={...card,...contentCache.get(card.id)};
          const value={...card,card_settings:snapshot.settings.get(card.id)||{}};
          if(studyConfig){if(!profileCache.has(card.id)){try{studyProfileId(value,studyConfig,manifest);profileCache.set(card.id,null);}catch(e){profileCache.set(card.id,e.message);}}if(profileCache.get(card.id))value.content_error=profileCache.get(card.id);}
          runtimePositions.set(card.id,i);if(value.content_error)knownErrors.set(card.id,value);return value;
        }));
        runtimeSources=sources;runtimeSnapshot=snapshot;schedulingIndex=null;
      }
      const available=runtimeCards;
      if(statesSnapshot!==snapshot||statesRevision!==baseManifest.revision){states=new Map();
        for(const card of available) {
          const projection=card.baseline || {state:card.queue===0?State.New:card.card_type===3?State.Relearning:card.queue===2?State.Review:State.Learning,due:card.due_ms,queue:card.queue,anki_due:card.anki_due};
          states.set(card.id,current(card,projection,snapshot.latest.get(card.id)));
        }
        statesSnapshot=snapshot;statesRevision=baseManifest.revision;
      }
      if(manifest.scheduling&&studyConfig&&!membershipCache.size)membershipCache=await measure("Deck membership",()=>studyMemberships(available,studyConfig,manifest));
      const clockNow=Date.now();
      if(schedulingIndex&&!schedulingIndex.advance(clockNow))schedulingIndex=null;
      if(manifest.scheduling&&!schedulingIndex){counters.schedulingBuilds++;schedulingIndex=await measure("Scheduling index",()=>new SchedulingIndex(available,states,manifest,snapshot.activity,clockNow,studyConfig?membershipCache:null));for(const id of skipped)schedulingIndex.bury(id);}
      nextWake=schedulingIndex?.nextWake??Infinity;
      timeKey=String(schedulingIndex?.today??today);
      if(panel){showConfiguration(panel);return;}
      if(managing){showCardManager(available);return;}
      if(!reviewing && manifest.scheduling) {
        const queue={tree:await measure("Deck screen",()=>schedulingIndex.tree(select.value))};
        showDecks(queue,available);notice.textContent=`${cards.length.toLocaleString()} cards · ${knownErrors.size.toLocaleString()} known content errors · ${(Math.max(0,schedulingIndex.counts().total-new Set([...contentCache.keys(),...scanProgress.results.keys()]).size)).toLocaleString()} unchecked`;
        return;
      }
      const queue=await measure("Selected queue",()=>schedulingIndex?schedulingIndex.queue(selectedDeck,select.value):reviewQueueV2(available,states,snapshot.activity,manifest,Date.now(),select.value));
      context.createEl("h2",{text:studyConfig?.decks[selectedDeck]?.name||manifest.scheduling?.decks[selectedDeck]?.name||select.value||"All decks"});
      context.createEl("button",{text:"Browse cards"}).onclick=()=>{managerDeck=selectedDeck||"";managerQuery="";managerStatus="all";editedCardId=null;managing=true;guardedDraw();};

      // Session skips do not change states, event logs, or the displayed counts.
      const renderGeneration=sourceGeneration;
      let card=queue.cards.find(c=>!skipped.has(c.id));
      if(card){card=await measure("Render selected card",()=>rendered(card));const i=runtimePositions.get(card.id);available[i]=card;}
      if(disposed||renderGeneration!==sourceGeneration){pending=true;return;}
      showCounts(counts,{...queue,errors:schedulingIndex?.counts(selectedDeck,select.value).errors??contentProblems(available).length});showErrors(available);
      if(!card){
        front.textContent="No cards ready for review in this session.";
        if(undoReview){cardHeader.hidden=false;cardMenu.hidden=false;cardName.textContent="Review complete";}
        return;
      }
      shown=card;started=Date.now();
      cardHeader.hidden=false;
      cardName.textContent=card.template?.name||`${card.anki_notetype||card.group||"Card"} · Card ${(card.anki_ordinal??0)+1}`;
      const skip=()=>{skipped.add(card.id);schedulingIndex?.bury(card.id);guardedDraw();};
      actions.createEl("button",{text:"Bury"}).onclick=skip;
      cardMenu.hidden=false;
      source.createEl("button",{text:"Card settings"}).onclick=()=>{cardMenu.open=false;openCardSettings(card);};
      if(card.source?.path)source.createEl("button",{text:"Open source"}).onclick=()=>{cardMenu.open=false;api.workspace.openLinkText(card.source.path,"","tab");};
      if(card.content_error){front.textContent=card.content_error;actions.createEl("button",{text:"Rating unavailable"}).disabled=true;return;}
      displayCardContent(front,card.frontText);
      let options;
      try {options=effectiveSettings(card,manifest);schedulerV2(options);if(!snapshot.latest.has(card.id)){const value=current(card,await baseline(card));states.set(card.id,value);if(!card.baseline)schedulingIndex?.update(card,value);}}
      catch(e){message(e);actions.createEl("button",{text:"Rating unavailable"}).disabled=true;return;}
      const reveal=actions.createEl("button",{text:"Show answer",cls:"mod-cta"});
      reveal.onclick=()=>{
        if(busy||shown!==card)return;
        try {
          displayCardContent(back,card.backText);actions.empty();
          if(card.source?.kind==="block" && !String(card.fields?.Back||"").trim()) {
            back.createEl("button",{text:"Open source"}).onclick=()=>api.workspace.openLinkText(card.source.path,"","tab");
          }
          actions.createEl("button",{text:"Bury"}).onclick=skip;
          for(const [i,label]of["Again","Hard","Good","Easy"].entries()) {
            const preview=nextStateV2(card,states.get(card.id).state,options,manifest,Date.now(),i+1);
            const minutes=Math.max(0,Math.round((preview.due-Date.now())/60000));
            actions.createEl("button",{text:`${label} (${minutes<1440?minutes+"m":Math.round(minutes/1440)+"d"})`}).onclick=()=>answer(card,i+1);
          }
        }catch(e){message(e);actions.empty();actions.createEl("button",{text:"Bury"}).onclick=skip;}
      };
    }
    async function answer(card,rating) {
      if(busy||shown!==card||card.content_error)return;
      busy=true;actions.querySelectorAll("button").forEach(b=>b.disabled=true);
      try {
        const result=await withStoreLock(identity,async()=>{
          if((await json(`${dataRoot}/manifest.json`)).revision!==manifest.revision)throw Error("Catalog changed; reopen the view");
          const latestConfig=await runtimeConfiguration();
          if(canonical({templates:latestConfig.templates,study:latestConfig.study})!==configKey)return "Configuration changed. Queue refreshed.";
          await syncIndex();
          if(canonical(await index.cardSettingsFor(card.id))!==canonical(card.card_settings))return "Card settings changed. Queue refreshed.";
          const value=current(card,states.get(card.id).state,await index.get("latest",card.id));
          if(value.parent!==states.get(card.id).parent)return "Card reviewed on another device. Queue refreshed.";
          const live=await resolveSource(card);
          if(canonical(live.fields)!==canonical(card.fields))return "Source changed. Queue refreshed.";
          const now=Date.now(),options=effectiveSettings(card,manifest);
          const next=nextStateV2(card,value.state,options,manifest,now,rating);
          const schedulerConfigId=await saveSchedulerConfig(store,`${dataRoot}/scheduler-configs`,options);
          const event={format_version:2,kind:"answer",id:crypto.randomUUID(),device_id:deviceId,card_id:card.id,
            deck_id:card.original_deck_id||card.deck_id,...(studyConfig?{profile_id:studyProfileId(card,studyConfig,manifest)}:{}),import_id:manifest.import_id,parent:value.parent,
            review_time_ms:now,duration_ms:Math.max(0,now-started),rating,was_new:value.state.state===State.New,
            was_review:value.state.state===State.Review,scheduler_config_id:schedulerConfigId,state:next};
          validateEvent(event,manifest.import_id);
          const logPath=await appendReview(store,`${dataRoot}/reviews`,event);
          undoReview={event,path:logPath,deck:selectedDeck,group:activeGroup};undoButton.disabled=false;
          reviewFileMap().set(logPath,api.vault.getAbstractFileByPath(logPath));
          dirty.add(logPath);await syncIndex();return null;
        });
        await draw();if(result)notice.textContent=result;
      }catch(e){clearCard();message(e);notice.textContent+=" — review paused. Refresh to retry.";}
      finally{busy=false;if(pending){pending=false;scheduleRefresh();}}
    }
    function saveRuntime(){
      if(disposed||busy||checking||pending||runtimeDirty||indexDirty||catalogDirty||!schedulingIndex)return;
      sessionCache.save(identity,readyEpoch,{baseManifest,rawCards,noteBindings,cards,knownCardIds,
        runtimeCache,snapshotCache,hydrationKey,statesSnapshot,statesRevision,states,
        runtimeLoaded,runtimeBase,studyConfig,studyParts,studyKey,manifest,config,configKey,
        resolvedCards,resolvedConfig,resolvedGeneration,sourceGeneration,
        runtimeCards,runtimeSources,runtimeSnapshot,runtimePositions,knownErrors,
        membershipCache,profileCache,schedulingIndex,contentCache,metadataCache,scanSignature});
    }
    function restoreRuntime(saved){
      ({baseManifest,rawCards,noteBindings,cards,knownCardIds,
        runtimeCache,snapshotCache,hydrationKey,statesSnapshot,statesRevision,states,
        runtimeLoaded,runtimeBase,studyConfig,studyParts,studyKey,manifest,config,configKey,
        resolvedCards,resolvedConfig,resolvedGeneration,sourceGeneration,
        runtimeCards,runtimeSources,runtimeSnapshot,runtimePositions,knownErrors,
        membershipCache,profileCache,schedulingIndex,contentCache,metadataCache,scanSignature}=saved);
      runtimeDirty=false;catalogDirty=false;indexDirty=true;
      schedulingIndex.clearBuried();counters.sessionRestores++;
    }
    async function guardedDraw(){if(disposed)return;if(checking || busy || managerDirty){pending=true;return;}busy=true;try{await draw();}catch(e){clearCard();message(e);}finally{busy=false;if(pending){pending=false;scheduleRefresh();}}}
    undoButton.onclick=async()=>{
      if(busy||!undoReview)return;
      if(!leaveEditor())return;
      cardMenu.open=false;
      busy=true;undoButton.disabled=true;
      try{
        const target=undoReview;
        await withStoreLock(identity,async()=>{
          await syncIndex();
          if((await index.get("latest",target.event.card_id))?.id!==target.event.id)throw Error("This card has another review now; undo is unavailable.");
          const text=await store.read(target.path);
          if(!text?.endsWith("\n"))throw Error("Review log changed; undo is unavailable.");
          const end=text.length-1,start=text.lastIndexOf("\n",end-1)+1;
          if(JSON.parse(text.slice(start,end)).id!==target.event.id)throw Error("Another event was saved after this review; undo is unavailable.");
          const file=api.vault.getAbstractFileByPath(target.path);
          await api.vault.modify(file,text.slice(0,start));
          if(await store.read(target.path)!==text.slice(0,start))throw Error("Could not verify undo; refresh the reviewer.");
          reviewFileMap().set(target.path,api.vault.getAbstractFileByPath(target.path));
          dirty.add(target.path);indexDirty=true;await syncIndex();
        });
        undoReview=null;selectedDeck=target.deck;activeGroup=target.group;select.value=activeGroup;
        panel="";managing=false;reviewing=true;skipped.delete(target.event.card_id);
        await draw();notice.textContent="Last review undone.";
      }catch(error){message(error);}
      finally{busy=false;undoButton.disabled=!undoReview;if(pending){pending=false;scheduleRefresh();}}
    };
    function scheduleRefresh(file,oldPath){
      if(disposed)return;
      if(file){
        const paths=[file.path,oldPath].filter(Boolean);
        let relevant=false;
        for(const path of paths){
          if(path.startsWith(`${dataRoot}/reviews/`)){
            if(reviewFiles){const f=api.vault.getAbstractFileByPath(path);if(f)reviewFiles.set(path,f);else reviewFiles.delete(path);}
            dirty.add(path);indexDirty=true;relevant=true;continue;
          }
          if(path===`${dataRoot}/manifest.json`||path===`${dataRoot}/catalog.pending.json`||path.startsWith(`${dataRoot}/cards/`)||path.startsWith(`${dataRoot}/notes/`)){catalogDirty=true;indexDirty=true;relevant=true;}
          if(path.startsWith(`${root}/config/`)||[`${root}/config.json`,`${root}/study.json`,`${dataRoot}/profiles.json`].includes(path)){runtimeDirty=true;contentCache.clear();metadataCache.clear();resolvedCards=null;relevant=true;}
          for(const card of cards){
            const dependent=card.source?.prepare==="prepare_president_notes"&&path.startsWith("wiki/people/us-presidents/")||card.source?.path===path||card.source?.candidates?.some(p=>path===p||path.startsWith(p+"/"))||card.source?.prepare==="prepare_taxonomy_notes"&&path.startsWith("wiki/life/");
            if(dependent){contentCache.delete(card.id);metadataCache.delete(card.id);dirty.add(path);relevant=true;resolvedCards=null;}
          }
        }
        if(!relevant)return;
        if(paths.some(path=>!path.startsWith(`${dataRoot}/reviews/`))){invalidateScanProgress();sourceGeneration++;operation++;checking=false;candidateSources.clear();taxonomy=null;presidents=null;resetQueues();}
      }else{indexDirty=true;}
      clearTimeout(refreshTimer);refreshTimer=setTimeout(guardedDraw,400);
    }
    home.onclick=()=>{operation++;checking=false;if(!leaveEditor())return;panel="";managing=false;managerDirty=false;reviewing=false;selectedDeck=null;guardedDraw();};
    manage.onclick=()=>{operation++;checking=false;if(!leaveEditor())return;panel="";managing=true;managerDirty=false;guardedDraw();};
    select.onchange=()=>{operation++;checking=false;if(!leaveEditor()){select.value=activeGroup;return;}activeGroup=select.value;panel="";managing=false;managerDirty=false;reviewing=Boolean(select.value);selectedDeck=null;guardedDraw();};
    refresh.onclick=()=>{if(managerDirty){notice.textContent="Save or discard changes before refreshing.";return;}reviewFiles=null;cache.clear();contentCache.clear();metadataCache.clear();candidateSources.clear();taxonomy=null;presidents=null;runtimeDirty=true;catalogDirty=true;indexDirty=true;invalidateScanProgress();sourceGeneration++;operation++;checking=false;resetQueues();guardedDraw();};
    rebuild.onclick=async()=>{if(busy)return;busy=true;try{await withStoreLock(identity,async()=>{sessionCache.invalidate();await index.clear();await catalogCache?.clear();});}catch(e){message(e);}finally{busy=false;await guardedDraw();}};
    profilesButton.onclick=()=>{operation++;checking=false;if(!leaveEditor())return;managing=false;panel="profiles";guardedDraw();};
    sourcesButton.onclick=()=>{operation++;checking=false;if(!leaveEditor())return;managing=false;panel="sources";guardedDraw();};
    function catalogDirectory(value,kind){
      if(value.catalog_layout!==undefined && value.catalog_layout!=="split" && value.catalog_layout!=="flat")throw Error("Unsupported catalog layout");
      if(value.catalog_layout==="flat")return kind;
      return `${value.catalog_layout==="split"?kind:"imports"}/${value.revision}`;
    }
    async function readPartitions(paths,kind){
      const versions=paths.map(path=>{const f=api.vault.getAbstractFileByPath(path);return f?.stat?[path,f.stat.mtime,f.stat.size]:null;});
      const signature=versions.every(Boolean)?JSON.stringify(versions):null;
      return measure("Catalog partitions",()=>catalogCache.read(kind,signature,()=>readCatalogPartitions(paths,json)));
    }
    async function loadCatalog(value){

      const paths=value.partition_count===undefined?value.partitions:Array.from({length:value.partition_count},(_,i)=>`${catalogDirectory(value,"cards")}/cards-${String(i).padStart(5,"0")}.json`);
      const nextCards=await readPartitions(paths.map(path=>`${dataRoot}/${path}`),"cards");
      let nextNotes=[];
      if(value.note_partition_count!==undefined){
        if(!Number.isSafeInteger(value.note_partition_count)||value.note_partition_count<0)throw Error("Invalid note partition count");
        nextNotes=await readPartitions(Array.from({length:value.note_partition_count},(_,i)=>`${dataRoot}/${catalogDirectory(value,"notes")}/notes-${String(i).padStart(5,"0")}.json`),"notes");
      }
      const hydrated=value.note_partition_count===undefined?nextCards:hydrateCatalog(nextCards,nextNotes,(await cachedConfiguration()).study);
      baseManifest=value;rawCards=nextCards;noteBindings=nextNotes;cards=hydrated;knownCardIds=new Set(cards.map(c=>c.id));
    }
    try {
      manifest=await json(`${dataRoot}/manifest.json`);if(![1,2].includes(manifest.format_version))throw Error("Unsupported store format");
      if(manifest.partition_count!==undefined && (!Number.isSafeInteger(manifest.partition_count)||manifest.partition_count<0))throw Error("Invalid card partition count");
      catalogCache=await CatalogCache.open(identity);
      if(disposed){catalogCache.close();return;}
      const saved=sessionCache.take(identity);
      if(saved&&canonical(saved.baseManifest)===canonical(manifest))restoreRuntime(saved);
      else await loadCatalog(manifest);
      index=await ReviewIndex.open(identity,manifest.import_id,manifest.timing);if(disposed){index.close();return;}
      select.createEl("option",{text:"All template groups",value:""});
      for(const group of [...new Set(cards.map(c=>c.group).filter(Boolean))].sort())select.createEl("option",{text:group,value:group});
      if(activeGroup)select.value=activeGroup;
      for(const name of ["create","modify","delete","rename"])component.registerEvent(api.vault.on(name,scheduleRefresh));
      component.registerEvent(api.metadataCache.on("changed",scheduleRefresh));
      component.registerInterval(setInterval(()=>{if(manifest&&!shown&&!checking&&!busy&&!managerDirty&&(Date.now()>=nextWake||timeKey!==String(dayNumber(Date.now(),manifest.timing)))){nextWake=Infinity;guardedDraw();}},1000));await guardedDraw();
      if(scanProgress.active&&!disposed){
        select.value=scanProgress.group;activeGroup=select.value;
        await checkContent(scanProgress.deck);
      }
    }catch(e){message(e);}
  })();
