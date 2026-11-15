  (async () => {
    const api = dv.app, component = dv.component;
    const root = input?.root || "ankobs-srs", dataRoot = `${root}/data`;
    const identity = `ankobs-srs:${api.vault.getName()}:${root}`;
    const host = dv.container.createDiv({cls:"ankobs-srs"});
    const notice = host.createDiv(), controls = host.createDiv();
    const home = controls.createEl("button",{text:"Decks"});
    const select = controls.createEl("select");
    const deviceSelect = controls.createEl("select",{attr:{"aria-label":"This device"}});
    const refresh = controls.createEl("button",{text:"Refresh"});
    const rebuild = controls.createEl("button",{text:"Rebuild local index"});
    const counts = host.createDiv(), homepage = host.createDiv(), front = host.createDiv(), back = host.createDiv();
    const actions = host.createDiv(), source = host.createDiv();
    const dirty = new Set(), cache = new Map(), skipped = new Set();
    let taxonomy;
    let resolvedCards, resolvedConfig, sourceGeneration = 0, resolvedGeneration = -1;
    const candidateSources = new Map();
    let manifest, cards = [], config, index, states, shown, configKey, started = 0;
    let busy = false, disposed = false, refreshTimer, pending = false, selectedDeck = null;
    let reviewing = Boolean(input?.group);
    let deviceId = input?.device || localStorage.getItem(`${identity}:device-name`);
    if (!["computer","android"].includes(deviceId))deviceId=/Android/i.test(globalThis.navigator?.userAgent||"")?"android":"computer";
    for(const name of ["computer","android"])deviceSelect.createEl("option",{value:name,text:`Device: ${name}`});
    deviceSelect.value=deviceId;
    localStorage.setItem(`${identity}:device-name`,deviceId);
    deviceSelect.onchange=()=>{deviceId=deviceSelect.value;localStorage.setItem(`${identity}:device-name`,deviceId);};
    component.register(() => {disposed=true;clearTimeout(refreshTimer);index?.close();});
    const store = {
      async list(directory) {return api.vault.getFiles().filter(f=>f.path.startsWith(directory+"/"));},
      async read(path) {const f=api.vault.getAbstractFileByPath(path);return f ? api.vault.read(f) : null;},
      async create(path,text) {await api.vault.create(path,text);},
      async append(path,text) {const f=api.vault.getAbstractFileByPath(path);if(!f)throw Error(`Missing log: ${path}`);await api.vault.append(f,text);}
    };
    async function json(path) {const text=await store.read(path);if(text===null)throw Error(`Missing SRS file: ${path}`);return JSON.parse(text);}
    function message(e) {notice.textContent=String(e.message||e);}
    function clearCard() {front.empty();back.empty();actions.empty();source.empty();homepage.empty();shown=null;}
    function logFiles() {return api.vault.getFiles().filter(f=>
      f.path.startsWith(`${dataRoot}/reviews/`) && LOG_PATTERN.test(f.path.split("/").at(-1)))
      .map(f=>({path:f.path,stat:f.stat?{...f.stat}:undefined}));}
    async function syncIndex() {
      const force=new Set([...dirty].filter(p=>p.startsWith(`${dataRoot}/reviews/`)));
      await index.sync(logFiles(),async f=>{const t=await store.read(f.path);if(t===null)throw Error(`Log disappeared: ${f.path}`);return t;},new Set(cards.map(c=>c.id)),{
        force, progress:n=>{if(!disposed && n>=500)notice.textContent=`Indexing reviews: ${n.toLocaleString()}…`;}
      });
      for(const path of force)dirty.delete(path);
    }
    async function noteAt(file) {
      let stored=cache.get(file.path);
      if(!stored || !file.stat || stored.mtime!==file.stat.mtime || stored.size!==file.stat.size || dirty.has(file.path)) {
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
    async function resolveSource(card) {
      if(!card.template)throw Error("No editable template mapped to this Anki card ordinal");
      if(!card.template.enabled)throw Error("Template disabled in config.json");
      if(!card.source)throw Error("Unresolved vault source");
      if(card.source.error)throw Error(card.source.error);
      let path=card.source.path;
      if(!path && card.source.candidates) {
        const key=canonical(card.source.candidates);
        if(!candidateSources.has(key)) {
          const identities=new Map();
          for(const file of api.vault.getFiles().filter(f=>card.source.candidates.some(p=>f.path===p||f.path.startsWith(p+"/")))) {
            const note=await noteAt(file);
            const uids=note.rows ? note.rows.keys() : [note.metadata?.anki_note_id ? `anki:${note.metadata.anki_note_id}` : `local:${note.metadata?.srs_uid}`];
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
      const data=await noteAt(file);
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
      if(card.source.kind==="block") {
        const matches=[...data.text.matchAll(/^>[ \t]*\[!anki\](?:-[ \t]*|[ \t]+)([^\r\n]*)\r?\n((?:^>[ \t]?(?!\[!anki\](?:-|[ \t]))[^\r\n]*(?:\r?\n|$))+?)^[ \t]*<!--[ \t]*ID[ \t]*:[ \t]*(\d+)[ \t]*-->[ \t]*$/gmi)].filter(m=>`anki:${m[3]}`===card.note_uid);
        if(matches.length!==1)throw Error(matches.length?"Duplicate block identity":"Missing Markdown block identity");
        metadata={$front:matches[0][1].trim(),$back:matches[0][2].split(/\r?\n/).map(l=>l.replace(/^>[ \t]?/,"")).filter(l=>!/^\s*(?:#[^\s#]+\s*)+$/.test(l)).join("\n").trim()};
      }
      if(!metadata)throw Error(`Missing source identity: ${card.note_uid}`);
      if(!data.rows && (metadata.anki_note_id || metadata.srs_uid)) {
        const uid=metadata.anki_note_id?`anki:${metadata.anki_note_id}`:`local:${metadata.srs_uid}`;
        if(uid!==card.note_uid)throw Error("Source identity changed");
      }
      const note={metadata,body:data.body,filename:file.basename||file.path.split("/").at(-1).replace(/\.md$/,""),path,lookups:{us_states:US_STATES}};
      const fields=fieldsFromNote(card,note);
      const special={...fields,Deck:manifest.scheduling?.decks[card.deck_id]?.name||"",Subdeck:manifest.scheduling?.decks[card.deck_id]?.name.split("::").at(-1)||"",Card:card.template.key,Type:card.anki_notetype,Tags:Array.isArray(metadata.tags)?metadata.tags.join(" "):String(metadata.tags||"")};
      const frontText=renderV2(card.template.front,special,card.anki_ordinal,false);
      const backText=renderV2(card.template.back,{...special,FrontSide:frontText},card.anki_ordinal,true);
      if(!frontText.trim() || !backText.trim())throw Error("Template produced an empty question or answer");
      return {...card,source:{...card.source,path},fields,frontText,backText};
    }
    async function readSources() {
      if(resolvedCards && resolvedConfig===configKey && resolvedGeneration===sourceGeneration)return resolvedCards;
      const generation=sourceGeneration;
      taxonomy=null;
      candidateSources.clear();
      const result=[];
      for(const card of configuredCards(cards,config)) {
        try {result.push(await resolveSource(card));}
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
    function showCounts(el,n) {
      el.createEl("span",{text:`${n.new ?? n.fresh ?? 0} new`,cls:"srs-new"});
      el.createEl("span",{text:` · ${n.learning||0} learning`,cls:"srs-learning"});
      el.createEl("span",{text:` · ${n.review||0} review`,cls:"srs-review"});
      if(n.errors)el.createEl("span",{text:` · ${n.errors} content errors`,cls:"srs-errors"});
    }
    function contentProblems(available) {
      return available.filter(c=>c.content_error && (!select.value || c.group===select.value) &&
        (!selectedDeck || manifest.scheduling.decks[c.deck_id]?.name===manifest.scheduling.decks[selectedDeck]?.name ||
          manifest.scheduling.decks[c.deck_id]?.name.startsWith(manifest.scheduling.decks[selectedDeck]?.name+"::")));
    }
    function showErrors(available) {
      const problems=contentProblems(available);
      if(!problems.length)return;
      const details=homepage.createEl("details");details.createEl("summary",{text:`Inspect ${problems.length} content errors`});
      let offset=0,more;
      const page=()=>{
        if(more)more.disabled=true;
        for(const card of problems.slice(offset,offset+50)) {
          const row=details.createDiv();row.createEl("p",{text:`${card.anki_notetype||"Card"} · ${card.note_uid||card.id}: ${card.content_error}`});
          if(card.source?.path)row.createEl("a",{text:"Open source"}).onclick=()=>api.workspace.openLinkText(card.source.path,"",false);
        }
        offset+=50;if(offset<problems.length){more=details.createEl("button",{text:"Show more errors"});more.onclick=page;}
      };
      details.ontoggle=()=>{if(details.open && offset===0)page();};
    }
    async function draw() {
      if(disposed)return;
      clearCard();counts.empty();notice.textContent="";
      if((await json(`${dataRoot}/manifest.json`)).revision!==manifest.revision)throw Error("Card catalog changed; reopen this view");
      config=await json(`${root}/config.json`);configKey=canonical(config);
      const snapshot=await withStoreLock(identity,async()=>{await syncIndex();return {latest:await index.latest(),activity:await index.activityToday(Date.now())};});
      const available=await readSources();states=new Map();
      for(const card of available) {
        const projection=card.baseline || {state:card.queue===0?State.New:card.card_type===3?State.Relearning:card.queue===2?State.Review:State.Learning,due:card.due_ms,queue:card.queue,anki_due:card.anki_due};
        states.set(card.id,current(card,projection,snapshot.latest.get(card.id)));
      }
      const queue=reviewQueueV2(available,states,snapshot.activity,manifest,Date.now(),select.value,undefined,selectedDeck,skipped);
      const errors=contentProblems(available).length;
      if(!reviewing && manifest.scheduling) {
        const build=(nodes,container)=>{for(const n of nodes) {
          const details=container.createEl("details"),summary=details.createEl("summary");
          summary.createEl("span",{text:n.name.split("::").at(-1)+" · "});showCounts(summary,n);
          const open=summary.createEl("button",{text:"Review"});
          open.onclick=e=>{e.preventDefault();selectedDeck=n.id;reviewing=true;guardedDraw();};
          build(n.children,details);
        }};build(queue.tree,homepage);showErrors(available);notice.textContent=`${cards.length.toLocaleString()} cards · ${errors.toLocaleString()} content errors`;
        return;
      }
      showCounts(counts,{...queue,errors});
      showErrors(available);
      // Session skips do not change states, event logs, or the displayed counts.
      const card=queue.cards.find(c=>!skipped.has(c.id));
      if(!card){front.textContent="No cards ready for review in this session.";return;}
      shown=card;started=Date.now();
      const skip=()=>{skipped.add(card.id);guardedDraw();};
      actions.createEl("button",{text:"Bury"}).onclick=skip;
      if(card.source?.path)source.createEl("a",{text:"Open source"}).onclick=()=>api.workspace.openLinkText(card.source.path,"",false);
      if(card.content_error){front.textContent=card.content_error;actions.createEl("button",{text:"Rating unavailable"}).disabled=true;return;}
      dv.el("div",card.frontText,{container:front});
      let options;
      try {options=effectiveSettings(card,manifest);schedulerV2(options);if(!snapshot.latest.has(card.id))states.set(card.id,current(card,await baseline(card)));}
      catch(e){message(e);actions.createEl("button",{text:"Rating unavailable"}).disabled=true;return;}
      const reveal=actions.createEl("button",{text:"Show answer"});
      reveal.onclick=()=>{
        if(busy||shown!==card)return;
        try {
          dv.el("div",card.backText,{container:back});actions.empty();
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
          if(canonical(await json(`${root}/config.json`))!==configKey)return "Configuration changed. Queue refreshed.";
          await syncIndex();
          const value=current(card,states.get(card.id).state,await index.get("latest",card.id));
          if(value.parent!==states.get(card.id).parent)return "Card reviewed on another device. Queue refreshed.";
          const live=await resolveSource(card);
          if(canonical(live.fields)!==canonical(card.fields))return "Source changed. Queue refreshed.";
          const now=Date.now(),options=effectiveSettings(card,manifest);
          const event={format_version:2,kind:"answer",id:crypto.randomUUID(),device_id:deviceId,card_id:card.id,
            deck_id:card.original_deck_id||card.deck_id,import_id:manifest.import_id,parent:value.parent,
            review_time_ms:now,duration_ms:Math.max(0,now-started),rating,was_new:value.state.state===State.New,
            was_review:value.state.state===State.Review,scheduler_version:SCHEDULER_VERSION,
            scheduler_config:options,state:nextStateV2(card,value.state,options,manifest,now,rating)};
          validateEvent(event,manifest.import_id);
          dirty.add(await appendReview(store,`${dataRoot}/reviews`,event));await syncIndex();return null;
        });
        await draw();if(result)notice.textContent=result;
      }catch(e){clearCard();message(e);notice.textContent+=" — review paused. Refresh to retry.";}
      finally{busy=false;if(pending){pending=false;scheduleRefresh();}}
    }
    async function guardedDraw(){if(busy){pending=true;return;}busy=true;try{await draw();}catch(e){clearCard();message(e);}finally{busy=false;if(pending){pending=false;scheduleRefresh();}}}
    function scheduleRefresh(file,oldPath){if(disposed)return;if(file){dirty.add(file.path);if(oldPath)dirty.add(oldPath);if(!file.path.startsWith(`${dataRoot}/reviews/`) || (oldPath && !oldPath.startsWith(`${dataRoot}/reviews/`)))sourceGeneration++;}clearTimeout(refreshTimer);refreshTimer=setTimeout(guardedDraw,400);}
    home.onclick=()=>{reviewing=false;selectedDeck=null;guardedDraw();};
    select.onchange=()=>{reviewing=Boolean(select.value);selectedDeck=null;guardedDraw();};
    refresh.onclick=()=>{cache.clear();sourceGeneration++;guardedDraw();};
    rebuild.onclick=async()=>{if(busy)return;busy=true;try{await withStoreLock(identity,()=>index.clear());}catch(e){message(e);}finally{busy=false;await guardedDraw();}};
    try {
      manifest=await json(`${dataRoot}/manifest.json`);if(![1,2].includes(manifest.format_version))throw Error("Unsupported store format");
      if(manifest.partition_count!==undefined && (!Number.isSafeInteger(manifest.partition_count)||manifest.partition_count<0))throw Error("Invalid card partition count");
      const partitions=manifest.partition_count===undefined?manifest.partitions:
        Array.from({length:manifest.partition_count},(_,i)=>`imports/${manifest.revision}/cards-${String(i).padStart(5,"0")}.json`);
      for(const partition of partitions)cards.push(...await json(`${dataRoot}/${partition}`));
      index=await ReviewIndex.open(identity,manifest.import_id,manifest.timing);if(disposed){index.close();return;}
      select.createEl("option",{text:"All decks",value:""});
      for(const group of [...new Set(cards.map(c=>c.group).filter(Boolean))].sort())select.createEl("option",{text:group,value:group});
      if(input?.group)select.value=input.group;
      for(const name of ["create","modify","delete","rename"])component.registerEvent(api.vault.on(name,scheduleRefresh));
      component.registerEvent(api.metadataCache.on("changed",scheduleRefresh));
      component.registerInterval(setInterval(()=>{if(!shown)guardedDraw();},60000));await guardedDraw();
    }catch(e){message(e);}
  })();
