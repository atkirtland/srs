// In-memory scheduling index. Catalog scans belong to construction, not navigation.
const INDEX_KINDS = ["new", "review", "intraday", "interday"];
const indexZeros = () => ({new:0,review:0,intraday:0,interday:0,total:0,errors:0});
const indexOrder = (a,b) => (a.anki_due??0)-(b.anki_due??0)||a.id.localeCompare(b.id);
class SchedulingOrder {
  constructor(compare=indexOrder){this.root=null;this.compare=compare;}
  priority(id){let h=2166136261;for(let i=0;i<id.length;i++)h=Math.imul(h^id.charCodeAt(i),16777619);return h>>>0;}
  fix(n){if(!n)return n;n.size=1+(n.left?.size||0)+(n.right?.size||0);n.best=n.card;for(const child of [n.left,n.right])if(child&&this.compare(child.best,n.best)<0)n.best=child.best;return n;}
  rotate(n,right){const p=n[right?'left':'right'];n[right?'left':'right']=p[right?'right':'left'];p[right?'right':'left']=this.fix(n);return this.fix(p);}
  insert(card){
    const add=n=>{if(!n)return this.fix({card,priority:this.priority(card.id),left:null,right:null});const cmp=indexOrder(card,n.card);if(!cmp){n.card=card;return this.fix(n);}const side=cmp<0?'left':'right';n[side]=add(n[side]);return n[side].priority<n.priority?this.rotate(n,cmp<0):this.fix(n);};
    this.root=add(this.root);
  }
  remove(card){
    const del=n=>{if(!n)return null;const cmp=indexOrder(card,n.card);if(cmp<0)n.left=del(n.left);else if(cmp>0)n.right=del(n.right);else{if(!n.left)return n.right;if(!n.right)return n.left;const right=n.left.priority<n.right.priority;n=this.rotate(n,right);n[right?'right':'left']=del(n[right?'right':'left']);}return this.fix(n);};
    this.root=del(this.root);
  }
  bulk(cards){
    const stack=[];
    for(const card of cards){const node={card,priority:this.priority(card.id),left:null,right:null};let last=null;while(stack.length&&stack.at(-1).priority>node.priority)last=stack.pop();node.left=last;if(stack.length)stack.at(-1).right=node;stack.push(node);}
    this.root=stack[0]||null;const finish=n=>{if(n){finish(n.left);finish(n.right);this.fix(n);}};finish(this.root);
  }
  rank(card){let n=this.root,total=0;while(n){if(indexOrder(n.card,card)<=0){total+=1+(n.left?.size||0);n=n.right;}else n=n.left;}return total;}
  bestThrough(bound){
    if(!bound)return this.root?.best;
    let n=this.root,best;const take=c=>{if(c&&(!best||this.compare(c,best)<0))best=c;};
    while(n){if(indexOrder(n.card,bound)<=0){take(n.left?.best);take(n.card);n=n.right;}else n=n.left;}return best;
  }
}
class SchedulingIndex {
  constructor(cards,states,manifest,activity,now,memberships){
    this.cards=new Map(cards.map(c=>[c.id,c]));this.states=states;this.manifest=manifest;this.now=now;this.today=dayNumber(now,manifest.timing);
    this.scopes=new Map();this.reverse=new Map();this.roots=new Map();this.nativeDecksByRoot=new Map();this.rootScopes=new Map();this.added=new Map();this.introduced=new Set();this.kinds=new Map();this.wakes=[];this.versions=new Map();
    this.stats={catalogCards:0,cardUpdates:0,countUpdates:0,queueReads:0};this.buried=new Set();this.ordering=new Map();this.building=true;
    this.deckOrder=Object.entries(manifest.study?.decks||{}).sort(([,a],[,b])=>a.name.localeCompare(b.name));
    for(const deck of Object.values(manifest.scheduling.decks)){let root=deck;while(root.parent_id)root=manifest.scheduling.decks[root.parent_id];this.roots.set(deck.id,root.id);if(!this.nativeDecksByRoot.has(root.id))this.nativeDecksByRoot.set(root.id,{});this.nativeDecksByRoot.get(root.id)[deck.id]=deck;}
    const memberDecks=new Map();
    if(manifest.study){for(const [id,ids] of memberships||studyMemberships(cards,manifest.study,manifest))for(const cid of ids){if(!memberDecks.has(cid))memberDecks.set(cid,[]);memberDecks.get(cid).push(id);}}
    else for(const card of cards){const ids=[];let deck=manifest.scheduling.decks[card.deck_id];while(deck){ids.push(deck.id);deck=manifest.scheduling.decks[deck.parent_id];}memberDecks.set(card.id,ids);}
    for(const card of [...cards].sort(indexOrder)){
      this.stats.catalogCards++;
      const keys=[];for(const id of [null,...(memberDecks.get(card.id)||[])])for(const group of ['',...(card.group?[card.group]:[])]){
        const key=JSON.stringify([id,group]);keys.push(key);
        if(!this.scopes.has(key))this.scopes.set(key,{id,group,buckets:new Map(),counts:null,orders:Object.fromEntries(INDEX_KINDS.map(k=>[k,new SchedulingOrder((a,b)=>this.compareDue(a,b))]))});
        const root=this.roots.get(card.deck_id);if(!this.rootScopes.has(root))this.rootScopes.set(root,new Set());this.rootScopes.get(root).add(key);
      }
      this.reverse.set(card.id,keys);this.change(card,1);this.scheduleWake(card);
    }
    this.building=false;
    for(const scope of this.scopes.values())for(const orders of [scope.orders,...[...scope.buckets.values()].map(b=>b.orders)])for(const order of Object.values(orders)){order.bulk(order.pending||[]);delete order.pending;}
    for(const event of activity)this.addActivity(event);
    this.refreshCounts(new Set(this.scopes.keys()));
  }
  key(id,group=''){return JSON.stringify([id??null,group||'']);}
  bucket(scope,id){if(!scope.buckets.has(id))scope.buckets.set(id,{...indexZeros(),orders:Object.fromEntries(INDEX_KINDS.map(k=>[k,new SchedulingOrder((a,b)=>this.compareDue(a,b))]))});return scope.buckets.get(id);}
  change(card,delta){
    if(card.retired)return;
    const kind=delta>0?queueKind(card,this.states.get(card.id),this.manifest,this.now,this.today):this.kinds.get(card.id);
    if(delta>0){this.kinds.set(card.id,kind);const state=this.states.get(card.id)?.state;this.ordering.set(card.id,{priority:kind==='intraday'?(state.due>this.now?4:0):kind==='interday'?1:kind==='review'?2:3,due:state?.due||0});}
    for(const key of this.reverse.get(card.id)||[]){const b=this.bucket(this.scopes.get(key),card.deck_id);b.total+=delta;if(card.content_error)b.errors+=delta;if(kind){b[kind]+=delta;if(delta>0&&!this.buried.has(card.id)){for(const order of [b.orders[kind],this.scopes.get(key).orders[kind]]){if(this.building)(order.pending??=[]).push(card);else order.insert(card);}}else{b.orders[kind].remove(card);this.scopes.get(key).orders[kind].remove(card);}}}
    if(delta>0)this.kinds.set(card.id,kind);
  }
  addActivity(event){
    if(event.kind==='historical_review'||event.kind==='scheduling_baseline'||event.kind==='card_settings'||studyDay(event.review_time_ms,this.manifest.timing)!==studyDay(this.now,this.manifest.timing))return;
    const card=this.cards.get(event.card_id);if(!card||event.was_new&&this.introduced.has(card.id))return;
    if(event.was_new)this.introduced.add(card.id);
    let deck=this.manifest.scheduling.decks[card.original_deck_id||card.deck_id];
    while(deck){const value=this.added.get(deck.id)||{new:0,review:0};if(event.was_new)value.new++;else if(event.was_review??event.state?.state===State.Review)value.review++;this.added.set(deck.id,value);deck=this.manifest.scheduling.decks[deck.parent_id];}
  }
  nativeTree(){
    if(!this.native){const raw=this.scopes.get(this.key(null))?.buckets||new Map();this.native=deckTree([],this.states,this.manifest,this.now,[],{raw,added:this.added});}
    return this.native;
  }
  indexNativeRoots(){
    this.nativeById=new Map();this.nativeRootPositions=new Map();
    const visit=n=>{this.nativeById.set(n.id,n);n.children.forEach(visit);};
    this.native.forEach((n,i)=>{this.nativeRootPositions.set(n.id,i);visit(n);});
  }
  updateNativeRoots(roots){
    if(!this.native){this.nativeTree();this.indexNativeRoots();return;}
    if(!roots)return;
    const raw=this.scopes.get(this.key(null))?.buckets||new Map();
    for(const root of roots){
      const decks=this.nativeDecksByRoot.get(root);if(!decks)continue;
      const localRaw=new Map(Object.keys(decks).map(id=>[id,raw.get(id)||indexZeros()]));
      const manifest={...this.manifest,scheduling:{...this.manifest.scheduling,decks}};
      const node=deckTree([],this.states,manifest,this.now,[],{raw:localRaw,added:this.added})[0];
      const position=this.nativeRootPositions.get(root);
      if(position!==undefined){this.native[position]=node;const visit=n=>{this.nativeById.set(n.id,n);n.children.forEach(visit);};visit(node);}
    }
  }
  selectedRoots(scope,roots){
    if(this.manifest.study||!scope.id)return roots?[...roots].map(id=>this.nativeById.get(id)).filter(Boolean):this.nativeTree();
    if(roots&&!roots.has(this.roots.get(scope.id)))return [];
    const node=this.nativeById.get(scope.id);return node?[node]:[];
  }
  computeCounts(scope,roots){
    const count=n=>{const b=scope.buckets.get(n.id)||indexZeros(),v={...b};for(const child of n.children){const c=count(child);for(const k of INDEX_KINDS)v[k]+=c[k];v.total+=c.total;v.errors+=c.errors;}for(const k of INDEX_KINDS)v[k]=Math.min(v[k],n[k]);return v;};
    scope.rootCounts??=new Map();const out=scope.counts||indexZeros();
    for(const root of this.selectedRoots(scope,roots)){
      const value=count(root),previous=scope.rootCounts.get(root.id)||indexZeros();
      for(const k of [...INDEX_KINDS,'total','errors'])out[k]+=value[k]-previous[k];
      scope.rootCounts.set(root.id,value);
    }
    this.stats.countUpdates++;return {...out,fresh:out.new,learning:out.intraday+out.interday};
  }
  refreshCounts(keys,roots){this.updateNativeRoots(roots);for(const key of keys){const scope=this.scopes.get(key);if(scope)scope.counts=this.computeCounts(scope,roots);}}
  counts(id=null,group=''){return this.scopes.get(this.key(id,group))?.counts||{...indexZeros(),fresh:0,learning:0};}
  tree(group=''){
    if(!this.manifest.study){const copy=nodes=>nodes.map(n=>({...n,...this.counts(n.id,group),children:copy(n.children)}));return copy(this.nativeTree());}
    const nodes=new Map();for(const [id,deck] of this.deckOrder)nodes.set(id,{id,...deck,...this.counts(id,group),children:[]});
    const roots=[];for(const node of nodes.values())(nodes.get(node.parent_id)?.children||roots).push(node);
    return roots;
  }
  compareDue(a,b){
    const x=this.ordering.get(a.id),y=this.ordering.get(b.id);
    return x.priority-y.priority||x.due-y.due||a.id.localeCompare(b.id);
  }
  bury(id){
    if(this.buried.has(id))return;this.buried.add(id);
    const card=this.cards.get(id),kind=this.kinds.get(id);if(!kind)return;
    for(const key of this.reverse.get(id)||[]){const scope=this.scopes.get(key);scope.buckets.get(card.deck_id).orders[kind].remove(card);scope.orders[kind].remove(card);}
  }
  queue(id=null,group=''){
    this.stats.queueReads++;const scope=this.scopes.get(this.key(id,group));if(!scope)return {...this.counts(id,group),cards:[]};
    let best;const take=c=>{if(c&&(!best||this.compareDue(c,best)<0))best=c;};
    for(const kind of INDEX_KINDS){
      // A node's allowance selects a prefix in Anki allocation order. Rank and
      // prefix-min queries find its next card without materializing that prefix.
      const count=(n,bound)=>{let value=bound?scope.buckets.get(n.id)?.orders[kind].rank(bound)||0:scope.buckets.get(n.id)?.orders[kind].root?.size||0;for(const child of n.children)value+=count(child,bound);return Math.min(value,n[kind]);};
      const boundary=(n,limit)=>{let at=scope.orders[kind].root,result;while(at){if(count(n,at.card)>=limit){result=at.card;at=at.left;}else at=at.right;}return result;};
      const visit=(n,bound)=>{
        if(!n[kind])return;
        let available=bound?scope.buckets.get(n.id)?.orders[kind].rank(bound)||0:scope.buckets.get(n.id)?.orders[kind].root?.size||0;
        for(const child of n.children)available+=count(child,bound);
        if(available>n[kind])bound=boundary(n,n[kind]);
        take(scope.buckets.get(n.id)?.orders[kind].bestThrough(bound));
        for(const child of n.children)visit(child,bound);
      };
      for(const root of this.selectedRoots(scope))visit(root,null);
    }
    return {...scope.counts,cards:best?[best]:[]};
  }
  update(card,value,event){
    const previous=this.cards.get(card.id);this.change(previous,-1);this.cards.set(card.id,card);if(value)this.states.set(card.id,value);this.change(card,1);this.scheduleWake(card);if(event)this.addActivity(event);this.stats.cardUpdates++;
    // Shared parent/preset allowances can change sibling counts too.
    const roots=new Set([this.roots.get(previous.deck_id),this.roots.get(card.deck_id),this.roots.get(card.original_deck_id||card.deck_id)]);
    const keys=new Set();for(const root of roots)for(const key of this.rootScopes.get(root)||[])keys.add(key);this.refreshCounts(keys,roots);
  }
  scheduleWake(card){
    const version=(this.versions.get(card.id)||0)+1;this.versions.set(card.id,version);
    const state=this.states.get(card.id)?.state,q=state?.queue??card.queue,due=state?.due??card.due_ms;
    const times=q===1||q===4?[due-(this.manifest.scheduling.collection.collapseTime??1200)*1000+(q===1?1:0),due]:[2,3].includes(q)&&state?.anki_due===undefined&&card.anki_due===undefined?[due]:[];
    for(const time of times)if(time>this.now){const entry={time,id:card.id,version};this.wakes.push(entry);let i=this.wakes.length-1;while(i){const p=(i-1)>>1;if(this.wakes[p].time<=time)break;this.wakes[i]=this.wakes[p];i=p;}this.wakes[i]=entry;}
  }
  advance(now){
    if(dayNumber(now,this.manifest.timing)!==this.today)return false;
    this.now=now;
    while(this.wakes[0]?.time<=now){const first=this.wakes[0],last=this.wakes.pop();if(this.wakes.length){this.wakes[0]=last;let i=0;while(true){let c=i*2+1;if(c>=this.wakes.length)break;if(c+1<this.wakes.length&&this.wakes[c+1].time<this.wakes[c].time)c++;if(this.wakes[i].time<=this.wakes[c].time)break;[this.wakes[i],this.wakes[c]]=[this.wakes[c],this.wakes[i]];i=c;}}if(this.versions.get(first.id)===first.version)this.update(this.cards.get(first.id));}
    return true;
  }
  get nextWake(){return this.wakes[0]?.time??Infinity;}
}
