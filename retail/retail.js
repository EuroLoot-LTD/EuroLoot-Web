const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sections={catalog:['Store','Direct listings from EuroLoot. Commercial sales have not opened.'],basket:['Basket','Digital licences have a quantity of one per account.'],wishlist:['Wishlist','Direct listings saved to your account.'],library:['Library','Your active EuroLoot entitlements and available releases.'],orders:['Orders','Sandbox orders have no monetary value.'],account:['Account','Manage your sign-in, profile and account data.'],support:['Support','Contact EuroLoot about an account, order, download or privacy request.'],developers:['Developer submissions','Submit a listing for review. Publication and distribution require a separate agreement.'],admin:['Administration','Review submissions and support requests.']};
let session=null,version=0,busy=false,checkoutKey=null,searchItems=[];
const price=cents=>new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR'}).format(cents/100);
const route=()=>Object.hasOwn(sections,location.hash.slice(1))?location.hash.slice(1):'catalog';
const btn=(action,label,attrs='')=>'<button type="button" data-action="'+action+'" '+attrs+'>'+esc(label)+'</button>';
const link=(hash,text)=>'<a class="quiet-link" href="#'+hash+'">'+esc(text)+'</a>';
const entry=(name,fields,submit)=>'<form class="entry" data-form="'+name+'">'+fields+'<button>'+esc(submit)+'</button></form>';
const input=(name,label,type='text',max=120)=>'<label>'+esc(label)+'<input name="'+name+'" type="'+type+'" required maxlength="'+max+'"></label>';
const description='<label>Details<textarea name="details" required minlength="10" maxlength="2400"></textarea></label>';
const empty=text=>'<p>'+esc(text)+'</p>';
const signIn=()=>'<p>'+link('account','Sign in')+' to use this section.</p>';
const item=(title,text,actions='')=>'<article class="item"><h2>'+esc(title)+'</h2><p>'+esc(text)+'</p><div class="buttons">'+actions+'</div></article>';
function notice(text){$('notice').textContent=text;}
async function api(path,body){
  const response=await fetch('/api/'+path,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'EuroLoot could not complete this request.');
  return data;
}
function catalog(items){return items.map(p=>item(p.title,(p.fixture?'Test fixture · ':'')+p.category+' · '+price(p.cents)+' · '+p.summary,session.account?btn('add','Add to basket','data-id="'+esc(p.id)+'"')+btn('wish','Save to wishlist','data-id="'+esc(p.id)+'" class="quiet"'):link('account','Sign in'))).join('')||empty('There are no matching direct listings.');}
function account(){
  const u=session.account;
  if(!u){const country='<label>Account country (two-letter code)<input name="country" value="'+esc(session.country)+'" minlength="2" maxlength="2" required></label>';
    return session.local?'<h2>Local test sign-in</h2><p>Enter the single-use invitation printed by the EuroLoot development server.</p>'+entry('login',input('code','Test invitation','password',128),'Sign in'):
    '<h2>Email sign-in</h2>'+entry('request',input('email','Email address','email',254),'Send a code')+entry('login',input('email','Email address','email',254)+input('code','Email code','text',12)+country,'Verify and sign in');
  }
  return item(u.name||'Your profile','Account country · '+u.country+' · '+u.role)+entry('profile',input('name','Display name','text',70),'Save display name')+'<p><a href="/api/export" download>Download account data</a></p><p>'+link('support','Request account deletion or privacy assistance')+'</p><div class="buttons">'+btn('logout','Sign out')+btn('revoke','Sign out all sessions','class="quiet"')+'</div>';
}
async function view(key){
  if(key==='account')return account();
  if(key==='catalog'){
    const data=await api('catalog');searchItems=data.items;
    return (data.sandbox?'<p class="meta">Sandbox catalogue. No payment is collected for local test orders.</p>':'')+'<label>Find a direct listing<input type="search" id="filter" autocomplete="off"></label><div id="results">'+catalog(data.items)+'</div>';
  }
  if(key==='support'){
    const help='<details class="help"><summary>Where is my Steam purchase?</summary><p>External offers are fulfilled by the linked store. Contact that store for its receipt, key or refund.</p></details><details class="help"><summary>Why is my download unavailable?</summary><p>Sign in to the purchasing account and open Library for a fresh link. A refunded order no longer grants access.</p></details><p><a href="mailto:euroloot.net@gmail.com">euroloot.net@gmail.com</a></p>';
    if(!session.account)return help+signIn();
    const list=await api('tickets');return help+'<h2>Open a ticket</h2>'+entry('ticket','<label>Category<select name="category">'+['Account','Order','Refund','Download','Developer','Privacy'].map(k=>'<option>'+k+'</option>').join('')+'</select></label>'+input('subject','Subject')+description,'Submit ticket')+'<h2>Your tickets</h2>'+list.items.map(t=>item(t.subject,t.category+' · '+t.state+' · '+t.id)).join('');
  }
  if(!session.account)return signIn();
  if(key==='developers'){
    const list=await api('submissions');return entry('submission',input('studio','Studio or organisation')+input('title','Product title')+description,'Submit for review')+'<h2>Your submissions</h2>'+list.items.map(t=>item(t.title,t.studio+' · '+t.state)).join('');
  }
  if(key==='admin'){
    if(!session.account.support)return empty('This section requires a privileged account.');
    let html='';
    if(session.account.staff){
      const stats=await api('admin/status');html+=item('Operations',stats.accounts+' accounts · '+stats.openTickets+' open tickets · '+stats.pendingOrders+' pending orders');
    }
    for(const kind of session.account.staff?['tickets','submissions']:['tickets']){
      const list=await api('admin/'+kind);html+='<h2>'+esc(kind==='tickets'?'Support queue':'Submission queue')+'</h2>';
      for(const row of list.items){
        const states=kind==='tickets'?['open','in_review','closed']:['under_review','changes_requested','approved','rejected'];
        html+=item(row.subject||row.title,(row.body||row.details)+' · '+row.state,states.map(s=>btn('review',s.replaceAll('_',' '),'data-kind="'+kind+'" data-id="'+esc(row.id)+'" data-state="'+s+'" class="quiet"')).join(''));
      }
      if(!list.items.length)html+=empty('The queue is empty.');
    }
    if(session.local&&session.account.staff)html+='<h2>Refund a local test order</h2>'+entry('refund',input('id','Order ID','text',36),'Refund test order');
    return html;
  }
  const {items}=await api(key);
  if(!items.length)return empty({basket:'Your basket is empty.',wishlist:'Your wishlist is empty.',library:'You do not have any EuroLoot entitlements yet.',orders:'You have no EuroLoot orders.'}[key]);
  if(key==='orders')return items.map(o=>item(o.id,price(o.total)+' · '+o.state+' · '+o.mode+' · '+new Date(o.created*1000).toLocaleDateString(),o.state==='pending'?btn('resume','Resume checkout','data-id="'+esc(o.id)+'"') : '')).join('');
  if(key==='library')return items.map(p=>item(p.title,p.version?'Version '+p.version+' · '+p.bytes+' bytes · SHA-256 '+p.sha256:'No release is available.',p.version?btn('download','Download','data-id="'+esc(p.id)+'" data-version="'+esc(p.version)+'"'):'' )).join('');
  let html=items.map(p=>item(p.title,price(p.cents),btn('remove','Remove','data-id="'+esc(p.id)+'" class="quiet"'))).join('');
  if(key==='basket')html+='<h2>Subtotal '+price(items.reduce((n,p)=>n+p.cents,0))+'</h2>'+entry('checkout','<label>Billing country<input name="billingCountry" value="'+esc(session.account.country)+'" required minlength="2" maxlength="2"></label><label>Test coupon (optional)<input name="coupon" maxlength="30"></label>',session.local?'Place local test order':'Continue to test checkout');
  return html;
}
async function render(message=''){
  const revision=++version,key=route();document.title=sections[key][0]+' | EuroLoot';$('title').textContent=sections[key][0];$('intro').textContent=sections[key][1];notice(message);
  $('content').setAttribute('aria-busy','true');$('content').textContent='Loading…';
  document.querySelectorAll('#sections a').forEach(a=>a.hash==='#'+key?a.setAttribute('aria-current','page'):a.removeAttribute('aria-current'));
  try{const state=await api('session');if(revision!==version)return;session=state;$('staff-link').hidden=!state.account?.support;
    const html=await view(key);if(revision===version)$('content').innerHTML=html;
  }catch(e){if(revision===version){$('content').textContent=e.message;}}
  finally{if(revision===version)$('content').setAttribute('aria-busy','false');}
}
async function act(fn){
  if(busy)return;busy=true;
  try{await fn();}catch(e){notice(e.message);}finally{busy=false;}
}
document.addEventListener('submit',event=>{
  const form=event.target;if(!form.dataset.form)return;event.preventDefault();
  void act(async()=>{
    const data=Object.fromEntries(new FormData(form)),kind=form.dataset.form;
    if(kind==='checkout'){
      const fingerprint=JSON.stringify(data);
      if(checkoutKey?.fingerprint!==fingerprint)checkoutKey={fingerprint,key:crypto.randomUUID()};
      const o=await api('checkout',{...data,requestKey:checkoutKey.key});
      if(o.url){location.assign(o.url);return;}checkoutKey=null;location.hash='orders';return;
    }
    const endpoint={request:'auth/request',login:'auth/verify',profile:'profile',ticket:'tickets',submission:'submissions',refund:'admin/refund'}[kind];
    const r=await api(endpoint,data);form.reset();
    await render(({request:'Check your email for the sign-in code.',login:'Signed in.',profile:'Profile saved.',ticket:'Ticket opened. Reference '+r.id,submission:'Submitted for review. Reference '+r.id,refund:'Test order refunded.'})[kind]);
  });
});
document.addEventListener('click',event=>{
  const b=event.target.closest('[data-action]');if(!b)return;
  void act(async()=>{
    const {action,id,kind,state,version:release}=b.dataset;
    if(action==='resume'){const data=await api('orders/resume',{id});location.assign(data.url);return;}
    if(action==='download'){
      const data=await api('download',{product:id,version:release});
      if(data.bytes>16*1024*1024)throw Error('This staging client supports verified downloads up to 16 MiB.');
      const response=await fetch(data.url,{cache:'no-store'});
      if(!response.ok)throw Error('Download expired or unavailable.');
      const bytes=await response.arrayBuffer();
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      if(bytes.byteLength!==data.bytes||hash!==data.sha256)throw Error('File integrity check failed.');
      const localURL=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
      const a=document.createElement('a');a.href=localURL;a.download=data.filename;document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(localURL),60000);notice('Download verified.');return;
    }
    if(action==='logout'||action==='revoke'){await api(action==='logout'?'auth/logout':'sessions/revoke',{});checkoutKey=null;await render('Signed out.');return;}
    if(action==='review'){await api('admin/'+kind,{id,state});await render('Review saved.');return;}
    const list=action==='add'?'basket':action==='wish'?'wishlist':route();
    await api(list,{product:id,add:action!=='remove'});checkoutKey=null;await render(action==='remove'?'Removed.':'Saved to your '+list+'.');
  });
});
document.addEventListener('input',e=>{if(e.target.id==='filter')$('results').innerHTML=catalog(searchItems.filter(p=>(p.title+' '+p.category).toLowerCase().includes(e.target.value.toLowerCase())));});
window.addEventListener('hashchange',()=>{void render();$('main-content').focus();});
void render();
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
