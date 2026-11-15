// Browser implementation bundled into ../view.js by build.py. No runtime tooling.
function effectiveSettings(card, manifest) {
  if (!manifest.scheduling) return manifest.scheduler;
  const meta = manifest.scheduling;
  const deck = meta.decks[card.original_deck_id || card.deck_id];
  const preset = meta.presets[deck.normal.config_id || "1"];
  const s = preset.settings;
  const field = ["fsrs_params_6", "fsrs_params_5", "fsrs_params_4"].find(k => s[k]?.length);
  return {
    algorithm: "FSRS-6", weights: s[field] || [], parameter_field: field,
    parameter_policy: meta.parameter_policy, source_anki_version: meta.source_anki_version,
    preset_id: preset.id, desired_retention: deck.normal.desired_retention ?? s.desired_retention,
    maximum_interval: s.maximum_review_interval, minimum_interval: s.minimum_lapse_interval,
    learning_steps: s.learn_steps, relearning_steps: s.relearn_steps,
    new_cards_per_day: s.new_per_day, enable_fuzz: false,
    short_term_with_steps: Boolean(meta.collection.fsrsShortTermWithStepsEnabled)
  };
}
function schedulerV2(options) {
  validateOptions(options);
  if (options.weights) {
    if (!options.parameter_policy) throw Error("Source Anki version is unconfirmed. Run desktop verification before rating.");
    if (![17, 19, 21].includes(options.weights.length) || options.weights.some(x => !Number.isFinite(x)))
      throw Error("Unsupported trained scheduler parameters");
  }
  const engine = fsrs({request_retention: options.desired_retention, maximum_interval: options.maximum_interval,
    enable_fuzz: false, w: options.weights,
    ...(options.learning_steps ? {learning_steps: options.learning_steps.map(x => `${x}m`)} : {}),
    ...(options.relearning_steps ? {relearning_steps: options.relearning_steps.map(x => `${x}m`)} : {})});
  // Anki permits initial stability below the bundled library's 0.1 floor.
  engine.init_stability = rating => engine.param.w[rating - 1];
  // The native short-term model prevents Hard from reducing stability too.
  engine.next_short_term_stability = (s, rating) => {
    const w = engine.param.w;
    const growth = Math.pow(s, -w[19]) * Math.exp(w[17] * (rating - 3 + w[18]));
    return Math.min(36500, Math.max(.001, s * (rating >= 2 ? Math.max(1, growth) : growth)));
  };
  return engine;
}
function renderV2(template, fields, ordinal = 0, answer = false) {
  if (/<script\b|\bon\w+\s*=|javascript:/i.test(template)) throw Error("Unsupported template operation: JavaScript");
  const token = /{{([#/^]?)([^{}]+)}}/g;
  const stack = [{visible: true, name: null}];
  let output = "", offset = 0;
  const value = expression => {
    const parts = expression.split(":"), key = parts.pop();
    if (!Object.hasOwn(fields, key)) throw Error(`Missing template field: ${key}`);
    let v = String(fields[key] ?? "");
    for (const filter of parts.reverse()) {
      if (filter === "cloze") v = v.replace(/{{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?}}/g,
        (_, n, body, hint) => +n === ordinal + 1 ? answer ? body : `[${hint || "…"}]` : body);
      else if (filter === "text") v = v.replace(/<[^>]*>/g, "");
      else if (filter === "type") throw Error("Unsupported template operation: type-answer input");
      else throw Error(`Unsupported template filter: ${filter}`);
    }
    return v;
  };
  for (const match of template.matchAll(token)) {
    if (stack.at(-1).visible) output += template.slice(offset, match.index);
    const [, marker, key] = match;
    if (marker === "#" || marker === "^") {
      const present = value(key).trim() !== "";
      stack.push({name: key, visible: stack.at(-1).visible && (marker === "#" ? present : !present)});
    } else if (marker === "/") {
      if (stack.length === 1 || stack.pop().name !== key) throw Error(`Unbalanced template section: ${key}`);
    } else if (stack.at(-1).visible) output += value(key);
    offset = match.index + match[0].length;
  }
  if (stack.length !== 1 || /{{|}}/.test(template.replace(token, ""))) throw Error("Unsupported template syntax");
  return output + template.slice(offset);
}
function transformField(name, value, note) {
  const text = v => v == null ? "" : String(v).trim();
  const list = v => Array.isArray(v) ? v : [v];
  const label = v => text(v).replace(/^!?\[\[([^\]|#]+)(?:[|#]([^\]]*))?\]\]$/, (_, p, l) => l || p.split("/").at(-1).replace(/\.md$/, ""));
  const media = v => list(v).filter(x => text(x)).map(x => {
    const m = text(x).match(/^!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
    if (!m) throw Error(`Expected vault media reference: ${text(x)}`);
    return `![[${m[1]}]]`;
  }).join("\n");
  switch (name) {
    case "text": case "markdown_body": return text(value);
    case "capitalize": return text(value).replace(/^./, x => x.toUpperCase());
    case "functional_group_name": return text(value).replace(/-group$/i, "").replace(/^./, x => x.toUpperCase());
    case "ph_front": return text(note.metadata.name_zh) || text(note.metadata.name_en) || note.filename;
    case "ph_units": return "pH";
    case "first_alias": if (!Array.isArray(value) || !text(value[0])) throw Error("Missing first alias"); return text(value[0]);
    case "chinese_alias": {const v = list(value).find(x => /\p{Script=Han}/u.test(text(x))); if (!v) throw Error("Missing Chinese alias"); return text(v);}
    case "wikilink_label": return label(value);
    case "comma_separated_labels": return list(value).map(label).filter(Boolean).join(", ");
    case "image": case "image_list": case "optional_image": case "sound": return media(value);
    case "country_flags": return [note.metadata.flag_blur, value].filter(x => text(x)).map(media).join("\n");
    case "image_or_text": return Array.isArray(value) || /^!?\[\[/.test(text(value)) ? media(value) : text(value);
    case "chemical_structure": {const v = note.metadata.structure_image || note.metadata.structure_latex || note.metadata.structure; return v ? transformField("image_or_text", v, note) : "";}
    case "markdown_link_list": return list(value).map(text).filter(Boolean).join("\n\n");
    case "indian_union_territory": return note.path.split("/").at(-2) === "union-territories" ? "Yes" : "No";
    case "us_state_name": {const v = note.lookups?.us_states?.[note.filename.toLowerCase()]; if (!v) throw Error("Unknown US state filename"); return v;}
    case "classical_back": {const composer = label(note.metadata.composer); if (!composer) throw Error("Missing composer"); return `${composer} - ${text(value)}${note.metadata.info ? "\n\n" + text(note.metadata.info) : ""}`;}
    default: throw Error(`Unsupported source transformation: ${name}`);
  }
}
function fieldsFromNote(card, note) {
  const specs = card.source.fields || Object.entries(card.source.field_map || {}).map(([anki, source]) => ({anki, source, transform: "text", required: false}));
  const fields = {};
  for (const spec of specs) {
    let value = spec.source === "$filename" ? note.filename : spec.source === "$body" ? note.body : note.metadata[spec.source];
    if (value === undefined && spec.required && !["blank", "omit"].includes(spec.missing_source) && spec.transform !== "optional_image")
      throw Error(`Missing source field: ${spec.source}`);
    fields[spec.anki] = transformField(spec.transform, value, note);
  }
  for (const key of card.template.required_fields) if (!String(fields[key] ?? "").trim()) throw Error(`Missing required field: ${key}`);
  return fields;
}
function prepareTaxonomy(notes) {
  const normalized = s => s.normalize("NFC").toLowerCase().replace(/\.md$/i, "");
  const exact = new Map(), stems = new Map(), parents = new Map();
  for (const note of notes) {
    const key = normalized(note.path.replace(/^.*?wiki\/life\//, ""));
    exact.set(key,note);const stem=normalized(note.filename);
    stems.set(stem,[...(stems.get(stem)||[]),note]);parents.set(note.path,[]);
  }
  for(const parent of notes) for(const item of [parent.metadata.child,parent.metadata.children].flat().filter(Boolean)) {
    const m=String(item).match(/^!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/);
    if(!m)throw Error(`Invalid taxonomy child: ${item}`);
    const target=normalized(m[1].replace(/^wiki\/life\//,""));
    let child=exact.get(target);
    if(!child){const matches=stems.get(target.split("/").at(-1))||[];if(matches.length>1)throw Error(`Ambiguous taxonomy child: ${item}`);child=matches[0];}
    if(child)parents.get(child.path).push(parent);
  }
  const output=new Map();
  for(const note of notes) {
    const byRank=new Map(),seen=new Set();
    const visit=(n,visiting)=>{
      if(visiting.has(n.path))throw Error("Cycle in taxonomy ancestry");
      if(seen.has(n.path))return;seen.add(n.path);
      const m=n.filename.match(/^(\S+)\s+(.+)$/);if(!m)throw Error("Taxonomy filename must be '<rank> <scientific name>'");
      const key=m[1].toLowerCase();byRank.set(key,[...new Set([...(byRank.get(key)||[]),m[2]])]);
      for(const p of parents.get(n.path))visit(p,new Set([...visiting,n.path]));
    };visit(note,new Set());
    const [rank,...scientific]=note.filename.split(" ");
    const get=r=>(byRank.get(r)||[]).join("; ");
    const kingdom=get("kingdom");let family=get("family");
    if(kingdom.toLowerCase()==="plantae")family=[family,get("subfamily"),get("tribe")].filter(Boolean).join(" - ");
    const familyDisplay=family&&kingdom?`${family} (${kingdom})`:family||(kingdom?`(${kingdom})`:"");
    output.set(note.path,{...note.metadata,$taxonomy_rank:rank,$taxonomy_scientific_name:scientific.join(" "),$taxonomy_genus:get("genus"),$taxonomy_family:familyDisplay});
  }
  return output;
}
function dayNumber(now, timing) {
  return Math.round((Date.parse(studyDay(now, timing)) - Date.parse(timing.day_zero)) / 86400000);
}
function queueKind(card, value, manifest, now, today = dayNumber(now, manifest.timing)) {
  if (card.retired) return null;
  const state = value?.state;
  let q = state?.queue ?? card.queue;
  const lastUnburied = manifest.scheduling?.collection.lastUnburied ?? 0;
  if ((q === -2 || q === -3) && (today > lastUnburied || today + 7 < lastUnburied))
    q = card.card_type === 0 ? 0 : card.card_type === 2 ? 2 : card.scheduling?.due > 1e9 ? 1 : 3;
  if (q < 0) return null;
  if (q === 0) return "new";
  if (q === 1) return (state?.due ?? card.due_ms) < now + (manifest.scheduling?.collection.collapseTime ?? 1200) * 1000 ? "intraday" : null;
  if (q === 4) return (state?.due ?? card.due_ms) <= now + (manifest.scheduling?.collection.collapseTime ?? 1200) * 1000 ? "intraday" : null;
  if (q === 2 || q === 3) {
    const dueDay = state?.anki_due ?? card.anki_due;
    const due = dueDay !== undefined ? dueDay <= today : state?.due <= now;
    return due ? q === 3 ? "interday" : "review" : null;
  }
  return null;
}
function deckTree(cards, states, manifest, now, activity = []) {
  const meta = manifest.scheduling;
  if (!meta) return [];
  const today = dayNumber(now, manifest.timing);
  const nodes = new Map(Object.values(meta.decks).map(deck => [deck.id, {...deck, children: [],
    new: 0, review: 0, intraday: 0, interday: 0, errors: 0, total: 0}]));
  for (const c of cards) {
    const node = nodes.get(c.deck_id);
    if (!node) continue;
    node.total++;
    if (c.content_error) node.errors++;
    const kind = queueKind(c, states.get(c.id), manifest, now, today);
    if (kind) node[kind]++;
  }
  const roots = [];
  for (const n of nodes.values()) (nodes.get(n.parent_id)?.children || roots).push(n);
  const added = new Map(), introduced = new Set();
  const byCard = new Map(cards.map(c => [c.id, c]));
  const currentDay = studyDay(now, manifest.timing);
  for (const event of activity) {
    if (event.kind === "historical_review" || event.kind === "scheduling_baseline" || studyDay(event.review_time_ms, manifest.timing) !== currentDay) continue;
    const card = byCard.get(event.card_id);
    if (!card) continue;
    if (event.was_new && introduced.has(card.id)) continue;
    if (event.was_new) introduced.add(card.id);
    let node = nodes.get(card.original_deck_id || card.deck_id);
    while (node) {
      const value = added.get(node.id) || {new: 0, review: 0};
      if (event.was_new) value.new++;
      else if (event.was_review ?? event.state.state === State.Review) value.review++;
      added.set(node.id, value);
      node = nodes.get(node.parent_id);
    }
  }
  const visit = (n, parent) => {
    const preset = meta.presets[n.normal.config_id || "1"]?.settings;
    let limits = {new: 9999, review: 9999};
    if (!n.filtered && preset) {
      const limit = (kind, fallback) => {
        const override = n.normal[`${kind}_limit_today`];
        return override && (override.today ?? 0) === today ? override.limit ?? 0 : n.normal[`${kind}_limit`] ?? fallback;
      };
      const counts = n.common.last_day_studied === today ? n.common : {};
      const extra = added.get(n.id) || {};
      const studiedNew = (counts.new_studied || 0) + (extra.new || 0);
      const studiedReview = (counts.review_studied || 0) + (extra.review || 0);
      limits.review = Math.max(0, limit("review", preset.reviews_per_day) - studiedReview - (meta.collection.newCardsIgnoreReviewLimit ? 0 : studiedNew));
      limits.new = Math.max(0, limit("new", preset.new_per_day) - studiedNew);
      if (!meta.collection.newCardsIgnoreReviewLimit) limits.new = Math.min(limits.new, limits.review);
    }
    if (parent && meta.collection.applyAllParentLimits) {
      limits.new = Math.min(limits.new, parent.new); limits.review = Math.min(limits.review, parent.review);
    }
    n.children.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    for (const child of n.children) {
      visit(child, limits);
      for (const kind of ["new", "review", "intraday", "interday", "errors", "total"]) n[kind] += child[kind];
    }
    n.interday = Math.min(n.interday, limits.review);
    n.review = Math.min(n.review, limits.review - n.interday);
    n.new = Math.min(n.new, limits.new);
    if (!n.filtered && !meta.collection.newCardsIgnoreReviewLimit) n.new = Math.min(n.new, limits.review - n.interday - n.review);
    n.learning = n.intraday + n.interday;
  };
  roots.sort((a,b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  roots.forEach(n => visit(n, null));
  return roots.filter(n => !(n.id === "1" && n.total === 0 && !n.children.length && roots.length > 1));
}
function reviewQueueV2(cards, states, events, manifest, now, group, introducedCount, deckId = null, skipped = new Set()) {
  if (!manifest.scheduling) return reviewQueue(cards, states, events, manifest, now, group, introducedCount);
  const tree = deckTree(cards, states, manifest, now, events);
  const nodesById = new Map(), kinds = new Map(), today = dayNumber(now, manifest.timing);
  const kindOf = c => {
    if (!kinds.has(c.id)) kinds.set(c.id, queueKind(c, states.get(c.id), manifest, now, today));
    return kinds.get(c.id);
  };
  const find = nodes => {for (const n of nodes) {nodesById.set(n.id,n); find(n.children);}};
  find(tree);
  const node = nodesById.get(deckId);
  const selected = node ? [node] : tree;
  const allowed = new Map();
  const allocate = n => {
    const ids = new Set();
    const gather = p => {ids.add(p.id); p.children.forEach(gather);}; gather(n);
    const eligible = cards.filter(c => ids.has(c.deck_id) && (!group || c.group === group) && states.has(c.id));
    const budget = {new:n.new,review:n.review,interday:n.interday,intraday:n.intraday};
    eligible.sort((a,b) => Number(skipped.has(a.id))-Number(skipped.has(b.id)) || (a.anki_due ?? 0) - (b.anki_due ?? 0) || a.id.localeCompare(b.id));
    const used = new Map();
    for (const kind of ["intraday", "interday", "review", "new"]) for (const c of eligible) {
      if (budget[kind] <= 0 || kindOf(c) !== kind) continue;
      let path = manifest.scheduling.decks[c.deck_id], ok = true;
      const ancestors = [];
      while (path) {
        ancestors.push(path.id);
        const entry = used.get(path.id) || {new:0,review:0,interday:0,intraday:0};
        const target = nodesById.get(path.id);
        if (target && entry[kind] >= target[kind]) ok = false;
        if (path.id === n.id) break;
        path = manifest.scheduling.decks[path.parent_id];
      }
      if (!ok) continue;
      for (const id of ancestors) {const entry = used.get(id) || {new:0,review:0,interday:0,intraday:0};entry[kind]++;used.set(id,entry);}
      budget[kind]--; allowed.set(c.id,c);
    }
  };
  selected.forEach(allocate);
  const chosen = [...allowed.values()];
  const priority = c => {
    const kind=kindOf(c);
    return kind==="intraday" ? (states.get(c.id).state.due>now?4:0) : kind==="interday"?1:kind==="review"?2:3;
  };
  chosen.sort((a,b)=>priority(a)-priority(b) || (states.get(a.id).state.due||0)-(states.get(b.id).state.due||0) || a.id.localeCompare(b.id));
  return {cards: chosen, fresh: chosen.filter(c => kindOf(c) === "new").length,
    learning:chosen.filter(c => ["intraday","interday"].includes(kindOf(c))).length,
    review:chosen.filter(c => kindOf(c) === "review").length, tree};
}
function nextStateV2(card, current, options, manifest, now, rating) {
  if (![1,2,3,4].includes(rating)) throw Error("Invalid rating");
  if (current.last_review !== undefined && now < current.last_review) throw Error("Device clock precedes last review");
  if (manifest.scheduling?.decks[card.deck_id]?.filtered) throw Error("Filtered-deck answering requires returning cards to their original deck in Anki before migration");
  const engine = schedulerV2(options);
  // Anki measures whole 24-hour periods back from the next cutoff, using
  // today's UTC offset. Counting historical local dates differs across DST.
  const clock = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone:manifest.timing.timezone,
    hour:"numeric", minute:"numeric", second:"numeric", hourCycle:"h23"})
    .formatToParts(new Date(now)).map(p => [p.type,p.value]));
  const sinceMidnight = +clock.hour * 3600 + +clock.minute * 60 + +clock.second;
  const untilRollover = (manifest.timing.rollover_hour * 3600 - sinceMidnight + 86400) % 86400 || 86400;
  const nextCutoff = Math.floor(now / 1000) + untilRollover;
  const elapsed = current.last_review === undefined ? 0 :
    Math.max(0, Math.floor((nextCutoff - Math.floor(current.last_review / 1000)) / 86400));
  const memories = [1,2,3,4].map(r => engine.next_state(current.state===State.New ? null : {stability:current.stability,difficulty:current.difficulty},elapsed,r));
  const interval = m => m.stability * engine.intervalModifier;
  const capped = (value,min=1) => Math.min(options.maximum_interval,Math.max(min,Math.round(value)));
  const memory = memories[rating-1];
  const state = {...current,stability:memory.stability,difficulty:memory.difficulty,elapsed_days:elapsed,
    last_review:now,reps:current.reps+1,lapses:current.lapses,queue:2,state:State.Review,
    learning_steps:0,remaining_steps:0};
  let seconds, remaining = 0;
  let days = capped(interval(memory));
  const relearning = current.state===State.Relearning || current.state===State.Review && rating===1;
  const steps = relearning ? options.relearning_steps || [10] : options.learning_steps || [1,10];
  if (current.state!==State.Review || rating===1) {
    const total=steps.length;
    const originalRemaining = current.state===State.New || current.state===State.Review ? total :
      current.remaining_steps ?? Math.max(0,total-current.learning_steps);
    const position=Math.max(0,Math.min(total-1,total-originalRemaining));
    if(rating===1 && total) {seconds=Math.trunc(steps[0]*60);remaining=total;}
    else if(rating===2 && total) {
      const delay=Math.trunc(steps[position]*60);
      seconds=position===0 ? total>1 ? Math.trunc((delay+Math.trunc(steps[1]*60))/2) : Math.min(Math.trunc(delay*1.5),delay+86400) : delay;
      if(seconds>86400)seconds=Math.round(seconds/86400)*86400;
      remaining=originalRemaining;
    } else if(rating===3 && position+1<total) {seconds=Math.trunc(steps[position+1]*60);remaining=total-position-1;}
    if(rating===4)days=capped(interval(memory),capped(interval(memories[2]))+1);
    if(seconds===undefined && rating!==4 && (total===0 || options.short_term_with_steps) && interval(memory)<.5) {
      seconds=Math.max(1,Math.trunc(interval(memory)*86400));remaining=originalRemaining;
    }
    if(current.state===State.Review && rating===1)state.lapses++;
  } else {
    const hard=capped(interval(memories[1]));
    const good=capped(interval(memories[2]),hard+1);
    const easy=capped(interval(memories[3]),good+1);
    days=[days,hard,good,easy][rating-1];
  }
  if(seconds!==undefined) {
    state.scheduled_secs=seconds;
    state.state=relearning?State.Relearning:State.Learning;
    state.scheduled_days=relearning ? rating===1?days:current.scheduled_days : 0;
    state.remaining_steps=remaining;state.learning_steps=Math.max(0,steps.length-remaining);
    state.due=now+seconds*1000;
    state.queue=state.due>=studyDayStart(dayNumber(now,manifest.timing)+1,manifest.timing)?3:1;
    if(state.queue===3) {
      state.anki_due=dayNumber(now,manifest.timing)+Math.max(1,Math.round(seconds/86400));
      state.due=studyDayStart(state.anki_due,manifest.timing);
    } else delete state.anki_due;
  } else {
    delete state.scheduled_secs;
    state.scheduled_days=days;state.anki_due=dayNumber(now,manifest.timing)+days;
    state.due=studyDayStart(state.anki_due,manifest.timing);
  }
  return state;
}
function studyDayStart(day, timing) {
  const target = Date.parse(timing.day_zero) + day * 86400000 + timing.rollover_hour * 3600000;
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone:timing.timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(new Date(guess)).map(x=>[x.type,x.value]));
    guess += target - Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
  }
  return guess;
}
