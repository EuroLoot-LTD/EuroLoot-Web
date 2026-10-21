/* EuroLoot — live discovery, persistent shortlists and honest store comparisons. */
(() => {
  'use strict';
  const API = 'https://www.cheapshark.com/api/1.0/';
  const STATE_KEY = 'euroloot-state-v2';
  const cache = new Map();
  const detailCache = new Map();
  const searchCache = new Map();
  const stores = new Map([['1', 'Steam']]);
  const pages = ['home', 'store', 'deals', 'wishlist', 'cart', 'game'];
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const validId = value => /^\d{1,12}$/.test(String(value));
  const amount = value => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const money = value => amount(value) === null ? 'Price unavailable' : Number(value) === 0 ? 'Free' : 'US$' + Number(value).toFixed(2);
  const safeImage = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : 'images/EuroLootIcon.png'; } catch { return 'images/EuroLootIcon.png'; } };
  const discount = (normal, price) => normal > 0 && price !== null ? Math.max(0, Math.min(100, Math.round((normal - price) / normal * 100))) : 0;
  const badge = value => value > 0 ? `<span class="badge-discount">−${value}%</span>` : '';
  const storeLink = game => game.dealID ? 'https://www.cheapshark.com/redirect?dealID=' + encodeURIComponent(game.dealID) : validId(game.steamAppID) ? 'https://store.steampowered.com/app/' + game.steamAppID + '/' : '';
  let catalog = [], catalogStatus = 'loading', catalogError = '';
  let current = {page:'home', id:'', params:new URLSearchParams()};
  let routeVersion = 0, searchVersion = 0, searchTimer, searchAbort, toastTimer, storageWarning = false;
  let expanded = 24;
  const currencyNote = 'Prices supplied by CheapShark are in US dollars (USD), not euros. Regional availability, currency, taxes and the final price are confirmed by the store.';
  function normalise(item, search = false) {
    const id = String(item.gameID ?? item.id ?? '');
    if (!validId(id) || !String(item.title ?? item.external ?? '').trim()) return null;
    const price = amount(search ? item.cheapest : item.salePrice ?? item.currentPrice);
    const normal = amount(item.normalPrice ?? item.basePrice);
    return {id, title:String(item.title ?? item.external).slice(0,300), steamAppID:validId(item.steamAppID) ? String(item.steamAppID) : '', currentPrice:price, basePrice:normal, discountPercent:discount(normal,price), coverImage:safeImage(item.thumb ?? item.coverImage), dealID:typeof item.dealID === 'string' ? item.dealID.slice(0,500) : '', storeID:String(item.storeID ?? (search ? '' : '1'))};
  }
  function readState(raw) {
    try {
      const data = JSON.parse(raw || '{}');
      const sanitise = list => Array.isArray(list) ? [...new Map(list.slice(0,200).map(item => { const game = item && typeof item === 'object' ? normalise(item) : null; return [game?.id,game]; }).filter(([,game])=>game)).values()].slice(0,100) : [];
      return {wishlist:sanitise(data.wishlist),cart:sanitise(data.cart)};
    } catch { return {wishlist:[],cart:[]}; }
  }
  let state;
  try { state = readState(localStorage.getItem(STATE_KEY)); } catch { state = readState(); }
  [...state.wishlist,...state.cart].forEach(game => cache.set(game.id,game));
  function toast(message) {
    clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
    toastTimer = setTimeout(()=>{ $('toast').hidden=true; },4500);
  }
  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); return true; }
    catch { if(!storageWarning){storageWarning=true;toast('Your browser cannot save changes. These picks will last for this visit only.');} return false; }
  }
  function updateCounts() {
    $('cart-badge').textContent = state.cart.length;
    $('wishlist-count').textContent = state.wishlist.length;
    document.querySelector('.picks-link').setAttribute('aria-label', 'Saved picks: ' + state.cart.length);
  }
  async function request(path, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort',abort,{once:true});
    const timer = setTimeout(abort,12000);
    try {
      const response = await fetch(API + path,{signal:controller.signal});
      if(!response.ok) throw new Error('The game service is temporarily unavailable.');
      return await response.json();
    } finally { clearTimeout(timer); signal?.removeEventListener('abort',abort); }
  }
  function skeleton(count=8) { return `<div class="games-grid" aria-label="Loading games" aria-busy="true">${Array.from({length:count},()=>'<div class="skeleton skeleton-card" aria-hidden="true"></div>').join('')}</div>`; }
  function empty(title, message, action='<a class="btn-primary" href="#store">Discover games <span aria-hidden="true">↗</span></a>') {
    return `<div class="empty-state"><span class="empty-icon" aria-hidden="true">✦</span><h2>${esc(title)}</h2><p>${esc(message)}</p>${action}</div>`;
  }
  function feedStatus() {
    if(catalogStatus === 'loading') return skeleton();
    if(catalogStatus === 'error') return empty('The deals are taking a break', catalogError, '<button class="btn-primary" data-action="retry">Try again ↻</button>');
    return empty('No games to show just yet','Try again shortly, or search for a game by name.','<button class="btn-primary" data-action="retry">Refresh games ↻</button>');
  }
  function gameCard(game) {
    return `<a class="game-card" href="#game/${game.id}" aria-label="${esc(game.title)} — ${esc(money(game.currentPrice))}">
      <div class="gc-art"><img class="gc-img" src="${esc(game.coverImage)}" alt="" loading="lazy" width="460" height="215">${badge(game.discountPercent)}</div>
      <div class="gc-content"><div class="gc-meta"><span class="status-dot"></span>${game.storeID==='1'?'Steam':'PC game'}<span>·</span>${state.wishlist.some(g=>g.id===game.id)?'Wishlisted':'Live listing'}</div><h3 class="gc-title">${esc(game.title)}</h3>
      <div class="gc-price"><div>${game.basePrice>game.currentPrice?`<span class="price-base">${money(game.basePrice)}</span> `:''}<span class="price-current">${money(game.currentPrice)}</span></div><span class="gc-arrow" aria-hidden="true">↗</span></div></div></a>`;
  }
  const grid = games => `<div class="games-grid">${games.map(gameCard).join('')}</div>`;
  const heading = (eyebrow,title,text='') => `<div class="page-heading"><div class="eyebrow"><span class="status-dot"></span>${eyebrow}</div><h1>${title}</h1>${text?`<p>${text}</p>`:''}</div>`;
  function renderHome() {
    const featured = catalog[0];
    $('page-home').innerHTML = `<section class="hero"><div class="wrap hero-content"><div><div class="eyebrow"><span class="status-dot"></span>For the love of the game</div><h1>Play more.<br><em>Spend less.</em></h1><p class="hero-copy">Big adventures. Small prices. Find your next favourite game and make your gaming budget go further.</p>
      <div class="hero-actions"><a class="btn-primary" href="#deals">Find a great deal <span aria-hidden="true">↗</span></a><a class="btn-secondary" href="#store">Explore games <span aria-hidden="true">→</span></a></div>
      <div class="hero-trust"><span>Live store offers</span><span>No account needed to browse</span><span>Built with Europe at heart</span></div></div><div>
      ${featured?`<article class="featured-card"><div class="featured-top"><span>✦ THE DISCOVERY OF THE DAY</span><span>STEAM / PC</span></div><a href="#game/${featured.id}" aria-label="Explore ${esc(featured.title)}"><img class="featured-image" src="${esc(featured.coverImage)}" alt="${esc(featured.title)}" width="460" height="215" fetchpriority="high"></a>
      <div class="featured-info"><div><span class="featured-label">Your next adventure?</span><h2>${esc(featured.title)}</h2><div class="featured-savings">${badge(featured.discountPercent)}${featured.basePrice>featured.currentPrice?`<s>${money(featured.basePrice)}</s>`:''}</div><div class="featured-price">${money(featured.currentPrice)} <small>USD</small></div></div><a class="featured-link" href="#game/${featured.id}" aria-label="View ${esc(featured.title)} offers">↗</a></div></article>`:'<div class="skeleton hero-placeholder" aria-label="Loading featured game"></div>'}
      <p class="hero-feed-note">Live prices in USD · Confirm your regional price at the store.</p></div></div></section>
      <div class="discovery-strip"><div class="wrap"><div class="discovery-item"><span class="strip-icon" aria-hidden="true">⌕</span><div><strong>Less searching. More playing.</strong><small>Discover games from a live price feed.</small></div></div><div class="discovery-item"><span class="strip-icon" aria-hidden="true">♡</span><div><strong>Keep the good ones close.</strong><small>Save your favourites on this browser.</small></div></div><div class="discovery-item"><span class="strip-icon" aria-hidden="true">↗</span><div><strong>Find it. Compare it. Play it.</strong><small>Complete purchases at the store.</small></div></div></div></div>
      <div class="wrap"><section class="section"><div class="section-head"><div><div class="eyebrow">The good stuff, for less</div><h2>Worth a place in your library.</h2><p>Fresh discoveries from the Steam deals feed.</p></div><a class="text-link" href="#store">All games ↗</a></div>
      <div class="filter-pills"><a class="filter-pill active" href="#store">All discoveries</a><a class="filter-pill" href="#store?filter=under10">Under US$10</a><a class="filter-pill" href="#deals?filter=75">75% off or more</a><a class="filter-pill" href="#store?filter=free">Free to pick up</a><a class="filter-pill" href="#store?filter=surprise">Surprise me ✦</a></div>
      ${catalog.length?grid(catalog.slice(0,8)):feedStatus()}<p class="currency-note">${currencyNote}</p></section>
      <section class="about-section" id="about"><div class="about-card"><div><div class="eyebrow">Independent. European. Just getting started.</div><h2>A brave new era<br>for European gaming.</h2></div><div><p>EuroLoot is an independent project building a more connected gaming destination for Europe. Right now, you can explore live PC game deals, compare store offers and put together your next-to-play list.</p><a class="text-link" href="mailto:euroloot.net@gmail.com">Help shape what comes next ↗</a></div></div></section>
      <section class="faq-section"><h2>A few things to know.</h2><details><summary>Can I buy games directly from EuroLoot?</summary><p>EuroLoot is still in development. For now, each live offer takes you to an external store, where you confirm availability, regional pricing and payment. EuroLoot does not process a payment or deliver a game key.</p></details><details><summary>Why are prices shown in US dollars?</summary><p>The current CheapShark data feed reports USD prices. We show the original currency accurately. Your store may show a different regional price or currency; always check before buying.</p></details><details><summary>Where do my wishlist and saved picks live?</summary><p>They are saved in this browser when browser storage is available. They stay after a refresh, without an account. They are not yet synced across devices. Clearing browser data removes them.</p></details><details><summary>What is a discovery link?</summary><p>Make a shortlist with a budget and share the game IDs as a link. The link contains only those IDs and the chosen budget. Anyone with it can load current listings; it does not share your account or browser history.</p></details></section></div>`;
  }
  function routeHref(updates) {
    const params = new URLSearchParams(current.params);
    Object.entries(updates).forEach(([key,value])=>value?params.set(key,value):params.delete(key));
    return '#' + current.page + (params.size?'?'+params.toString():'');
  }
  function filteredGames(items) {
    const filter = current.params.get('filter');
    let games = items.filter(g=>filter==='under10'?g.currentPrice!==null && g.currentPrice<10:filter==='free'?g.currentPrice===0:filter==='75'?g.discountPercent>=75:true);
    const max = amount(current.params.get('budget'));
    if(current.params.has('budget') && max!==null) games=games.filter(g=>g.currentPrice!==null&&g.currentPrice<=max);
    const sort = current.params.get('sort') || (current.page==='deals'?'saving':'featured');
    if(sort==='price') games.sort((a,b)=>(a.currentPrice??Infinity)-(b.currentPrice??Infinity));
    if(sort==='saving') games.sort((a,b)=>b.discountPercent-a.discountPercent);
    if(sort==='name') games.sort((a,b)=>a.title.localeCompare(b.title));
    return games;
  }
  async function renderCatalog(version) {
    const query = current.params.get('search')?.trim() || '';
    const shared = current.params.get('picks');
    let items = catalog;
    let failure = false;
    if(query) {
      $('header-search').value=query;
      const panel=$('page-'+current.page);
      panel.innerHTML=`<div class="wrap">${heading('Find your next favourite','Searching for “'+esc(query)+'”')}${skeleton()}</div>`;
      try {
        if(!searchCache.has(query)) searchCache.set(query,request('games?title='+encodeURIComponent(query)+'&limit=60').then(data=>{if(!Array.isArray(data))throw new Error('Invalid search response');return data.map(i=>normalise(i,true)).filter(Boolean);}).catch(error=>{searchCache.delete(query);throw error;}));
        items=await searchCache.get(query); items.forEach(g=>cache.set(g.id,cache.get(g.id)||g));
      } catch { failure=true; }
      if(version!==routeVersion)return;
    } else if(shared) {
      const ids=[...new Set(shared.split(',').filter(validId))].slice(0,12);
      $('page-store').innerHTML=`<div class="wrap">${heading('A list worth sharing','Your shared discoveries')}${skeleton(4)}</div>`;
      items=(await Promise.all(ids.map(id=>getGame(id).catch(()=>null)))).filter(Boolean);
      if(version!==routeVersion)return;
    }
    if(current.page==='deals')items=items.filter(g=>g.discountPercent>0);
    items=filteredGames([...items]);
    if(current.params.get('filter')==='surprise' && items.length) {
      const chosen=items[Math.floor(Math.random()*items.length)];
      location.hash='game/'+chosen.id;return;
    }
    const title=query?'Results for “'+esc(query)+'”':shared?'Your shared discoveries':current.page==='deals'?'Good games. Great prices.':'Find your next favourite.';
    const copy=query?'Search results across tracked PC stores. Open a game to compare current offers.':shared?'A friend’s shortlist, with current prices. Make it your own.':'Browse Steam discoveries, filter your budget and see what catches your eye.';
    $('page-'+current.page).innerHTML=`<div class="wrap">${heading(current.page==='deals'?'Deals worth discovering':'Your next adventure starts here',title,copy)}
      <div class="filter-pills">${[['','All games'],['under10','Under US$10'],['75','75% off or more'],['free','Free']].map(([value,label])=>`<a class="filter-pill ${(current.params.get('filter')||'')===value?'active':''}" href="${esc(routeHref({filter:value}))}">${label}</a>`).join('')}<a class="filter-pill" href="${esc(routeHref({filter:'surprise'}))}">Surprise me ✦</a></div>
      <div class="catalog-main"><div class="catalog-toolbar"><p class="results-count" role="status">${items.length} ${items.length===1?'game':'games'} found${query?' across tracked stores':''}</p><div class="catalog-controls"><label>Budget (USD) <select id="budget-filter" aria-label="Maximum price in USD"><option value="">Any budget</option>${[5,10,20,30,50].map(n=>`<option value="${n}" ${current.params.get('budget')===String(n)?'selected':''}>Under US$${n}</option>`).join('')}</select></label><label>Sort by <select id="sort-filter" aria-label="Sort games">${[['featured','Featured'],['price','Lowest price'],['saving','Biggest discount'],['name','Name A–Z']].map(([value,label])=>`<option value="${value}" ${(current.params.get('sort')||(current.page==='deals'?'saving':'featured'))===value?'selected':''}>${label}</option>`).join('')}</select></label></div></div>
      ${failure?empty('Search is unavailable right now','Please try again in a moment.','<button class="btn-primary" data-action="retry-search">Try again ↻</button>'):items.length?grid(items.slice(0,expanded)):(!query&&!shared&&catalogStatus!=='ready'?feedStatus():empty('Nothing matches just yet','Try another search or give your budget a little more room.','<a class="btn-primary" href="#store">Reset filters</a>'))}
      ${items.length>expanded?'<div class="load-more"><button class="btn-secondary" data-action="more">Show more games ↓</button></div>':''}<p class="currency-note">${currencyNote}</p></div></div>`;
  }
  async function getGame(id,force=false) {
    if(!validId(id))return null;
    if(!force&&detailCache.has(id))return detailCache.get(id);
    const promise=request('games?id='+encodeURIComponent(id)).then(data=>{
      if(!data?.info || !Array.isArray(data.deals))throw new Error('Game details are unavailable.');
      const offers=data.deals.map(d=>({storeID:String(d.storeID),price:amount(d.price),retailPrice:amount(d.retailPrice),dealID:typeof d.dealID==='string'?d.dealID:''})).filter(d=>d.price!==null&&d.dealID).sort((a,b)=>a.price-b.price);
      const best=offers[0];
      const game=normalise({gameID:id,title:data.info.title,steamAppID:data.info.steamAppID,thumb:data.info.thumb,salePrice:best?.price,normalPrice:best?.retailPrice,dealID:best?.dealID,storeID:best?.storeID??''});
      if(!game)throw new Error('Game details are incomplete.');
      game.offers=offers;cache.set(id,game);return game;
    }).catch(error=>{detailCache.delete(id);throw error;});
    detailCache.set(id,promise);return promise;
  }
  async function renderGame(version) {
    const id=current.id;
    $('page-game').innerHTML=`<div class="wrap">${heading('A closer look','Loading your next adventure…')}${skeleton(4)}</div>`;
    let game;
    try { game=await getGame(id); } catch {}
    if(version!==routeVersion)return;
    if(!game){$('page-game').innerHTML=`<div class="wrap">${heading('A little interruption','Game unavailable')}${empty('We couldn’t load this game','The listing may have changed, or the game service may be unavailable.','<button class="btn-primary" data-action="retry-game">Try again ↻</button> <a class="btn-secondary" href="#store">Back to games</a>')}</div>`;return;}
    document.title=game.title+' — EuroLoot';
    const wished=state.wishlist.some(g=>g.id===id), picked=state.cart.some(g=>g.id===id);
    const best=storeLink(game);
    $('page-game').innerHTML=`<div class="wrap game-detail"><div class="breadcrumb"><a href="#store">Discover games</a> / ${esc(game.title)}</div><div class="gd-header"><img class="gd-cover" src="${esc(game.coverImage)}" alt="${esc(game.title)}" width="460" height="215">
      <div class="gd-info"><span class="plat-pill">${game.steamAppID?'PC · Steam listing':'PC game'}</span><h1 class="gd-title">${esc(game.title)}</h1><p>One game. A few more possibilities. Compare the available store offers below.</p>
      <div class="gd-price"><span class="price-current">${money(game.currentPrice)}</span>${badge(game.discountPercent)}</div>
      <div class="gd-actions">${best?`<a class="btn-primary" href="${esc(best)}" target="_blank" rel="noopener noreferrer">View best offer ↗</a>`:''}<button class="btn-secondary" data-action="wishlist" data-id="${id}" aria-pressed="${wished}">${wished?'♥ Saved to wishlist':'♡ Add to wishlist'}</button></div>
      <div class="gd-save"><button class="icon-btn" data-action="cart" data-id="${id}" aria-pressed="${picked}">${picked?'Remove from picks':'＋ Add to saved picks'}</button><button class="icon-btn" data-action="share-game" data-id="${id}">Copy game link ↗</button></div><p class="gd-small">USD price feed · Purchases complete at an external store.</p></div></div>
      ${game.offers.length?`<div class="table-scroll"><table class="price-table"><caption>Compare current offers</caption><thead><tr><th scope="col">Store</th><th scope="col">Listed price (USD)</th><th scope="col">Discount</th><th scope="col">Explore</th></tr></thead><tbody>${game.offers.map(offer=>`<tr><td><strong>${esc(stores.get(offer.storeID)||'Store '+offer.storeID)}</strong></td><td class="offer-price">${money(offer.price)}</td><td>${badge(discount(offer.retailPrice,offer.price))||'—'}</td><td><a class="buy-btn" href="https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(offer.dealID)}" target="_blank" rel="noopener noreferrer">Visit store ↗</a></td></tr>`).join('')}</tbody></table></div>`:empty('No live offers right now','This game has no current tracked offers. Save it to your wishlist and check back.','')}
      <p class="currency-note">${currencyNote} Listed stores may offer different editions or activation platforms; check each offer before purchasing.</p></div>`;
  }
  function savedRow(game,type) {
    const fresh=cache.get(game.id)||game;
    return `<article class="saved-row"><a href="#game/${game.id}" aria-label="View ${esc(game.title)}"><img src="${esc(game.coverImage)}" alt="" width="150" height="70" loading="lazy"></a><div class="saved-info"><h2><a href="#game/${game.id}">${esc(game.title)}</a></h2><p>${fresh===game?'Saved price · ':'Latest available listing · '}USD · Confirm at store</p></div><div class="saved-price">${money(fresh.currentPrice)}</div><div class="saved-actions"><a class="buy-btn" href="#game/${game.id}">Compare offers ↗</a><button class="button-remove" data-action="${type}" data-id="${game.id}" aria-label="Remove ${esc(game.title)}">Remove</button></div></article>`;
  }
  function renderSaved(type) {
    const wishlist=type==='wishlist', items=state[type];
    const total=items.reduce((sum,g)=>sum+(cache.get(g.id)?.currentPrice??g.currentPrice??0),0);
    $('page-'+type).innerHTML=`<div class="wrap">${heading(wishlist?'Keep the good ones close':'Make room for the next adventure',wishlist?'Your wishlist. Your next obsession.':'Your saved picks.',wishlist?'The games you want to come back to. Saved on this browser.':'A shortlist to compare before you buy. Each purchase completes at its own store.')}
      ${items.length?`<div class="catalog-toolbar"><p class="results-count">${items.length} saved ${items.length===1?'game':'games'}</p><div class="saved-actions"><button class="icon-btn" data-action="share-list" data-list="${type}">Copy discovery link ↗</button>${wishlist?'<button class="icon-btn" data-action="budget-lab">Build my budget bundle ✦</button>':''}</div></div><div class="saved-list">${items.map(g=>savedRow(g,type)).join('')}</div>${!wishlist?`<div class="saved-total"><span>Combined listed prices <small>(USD)</small></span><strong>${money(total)}</strong></div>`:''}<div id="budget-lab"></div>`:empty(wishlist?'Your next favourite is out there.':'A great shortlist starts with one game.',wishlist?'See something you love? Open a game and tap the heart to keep it here.':'Add games to your saved picks to compare them together.')}
      <p class="currency-note">${currencyNote} Saved picks and wishlists are browser-local and may contain older prices.</p><div style="height:40px"></div></div>`;
  }
  function toggleSaved(type,id) {
    const index=state[type].findIndex(g=>g.id===id);
    if(index>=0)state[type].splice(index,1);
    else {const game=cache.get(id);if(!game)return;if(state[type].length>=100){toast('Your list is full. Remove a game before adding another.');return;}state[type].push({...game,offers:undefined});}
    const saved=saveState();updateCounts();
    if(saved)toast(index>=0?'Removed from '+(type==='cart'?'saved picks':'wishlist')+'.':'Saved to your '+(type==='cart'?'picks':'wishlist')+'.');
    if(current.page==='game')renderGame(routeVersion);else if(current.page===type)renderSaved(type);
  }
  function budgetLab() {
    const panel=$('budget-lab');if(!panel)return;
    panel.innerHTML='<section class="about-card" style="display:block;margin:25px 0"><div class="eyebrow">A little more play for your budget</div><h2>Build a budget bundle.</h2><p style="margin:12px 0">Choose a budget. We find the combination of wishlisted games that fits the most games, then the biggest listed savings. No purchase is made.</p><form id="bundle-form" class="catalog-controls"><label for="bundle-budget">Budget in USD</label><input id="bundle-budget" type="number" min="0" max="500" step="0.01" value="20" required><button class="btn-primary" type="submit">Find my bundle ✦</button></form><div id="bundle-results" role="status"></div></section>';
    $('bundle-budget').focus();
  }
  function solveBundle(budget) {
    const eligible=state.wishlist.map(g=>cache.get(g.id)||g).filter(g=>g.currentPrice!==null&&g.currentPrice<=budget);
    const limit=Math.floor(budget*100);
    const dp=new Map([[0,{games:[],saving:0}]]);
    for(const game of eligible){
      const cents=Math.round(game.currentPrice*100),saving=Math.max(0,(game.basePrice??game.currentPrice)-game.currentPrice);
      for(const [cost,pick] of [...dp.entries()].sort((a,b)=>b[0]-a[0])){
        const next=cost+cents;if(next>limit)continue;
        const candidate={games:[...pick.games,game],saving:pick.saving+saving},old=dp.get(next);
        if(!old||candidate.games.length>old.games.length||(candidate.games.length===old.games.length&&candidate.saving>old.saving))dp.set(next,candidate);
      }
    }
    return [...dp.entries()].sort((a,b)=>b[1].games.length-a[1].games.length||b[1].saving-a[1].saving||a[0]-b[0])[0]?.[1].games||[];
  }
  async function copyLink(value) {
    try {await navigator.clipboard.writeText(value);toast('Link copied. Share a little discovery.');}
    catch { const input=document.createElement('input');input.className='share-fallback';input.readOnly=true;input.value=value;$('toast').replaceChildren(document.createTextNode('Copy this link: '),input);$('toast').hidden=false;input.select(); }
  }
  function shareLink(type) {
    const url=new URL(location.href);url.search='';url.hash='store?picks='+state[type].slice(0,12).map(g=>g.id).join(',');
    copyLink(url.href);if(state[type].length>12)toast('The discovery link includes your first 12 saved games.');
  }
  async function loadCatalog() {
    catalogStatus='loading';catalogError='';renderRoute(false);
    try {
      const data=await request('deals?storeID=1&upperPrice=50&pageSize=60');
      if(!Array.isArray(data))throw new Error('The service returned an unexpected response.');
      catalog=[...new Map(data.map(i=>normalise(i)).filter(Boolean).map(g=>[g.id,g])).values()];
      catalog.forEach(g=>cache.set(g.id,g));catalogStatus='ready';
    } catch {catalogStatus='error';catalogError='We couldn’t reach the game service. Your saved games are still available. Please try again.';}
    if(['home','store','deals'].includes(current.page))renderRoute(false);
  }
  function parseRoute() {
    const raw=location.hash.slice(1);
    const [path,query='']=raw.split('?');
    const [page,id='']=path.split('/');
    if(path==='main-content')return null;
    const params=new URLSearchParams(query);
    if(!raw && new URLSearchParams(location.search).has('search'))params.set('search',new URLSearchParams(location.search).get('search'));
    return {page:params.has('search')&&!raw?'store':pages.includes(page)?page:'home',id,params};
  }
  function renderRoute(focus=true) {
    const route=parseRoute();if(!route)return;
    const changed=current.page!==route.page||current.id!==route.id||current.params.toString()!==route.params.toString();
    current=route;const version=++routeVersion;hideSearch();
    document.querySelectorAll('.page').forEach(el=>{const active=el.id==='page-'+route.page;el.hidden=!active;el.classList.toggle('active',active);});
    document.querySelectorAll('[data-route]').forEach(link=>{const active=link.dataset.route===route.page;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
    document.title=({home:'EuroLoot — Play more. Spend less.',store:'Discover games — EuroLoot',deals:'Game deals — EuroLoot',wishlist:'Your wishlist — EuroLoot',cart:'Your saved picks — EuroLoot',game:'Game offers — EuroLoot'})[route.page];
    if(route.page==='home'){renderHome();if(route.params.get('section')==='about')setTimeout(()=>$('about')?.scrollIntoView(),0);}
    else if(route.page==='store'||route.page==='deals')void renderCatalog(version);
    else if(route.page==='game')void renderGame(version);
    else renderSaved(route.page);
    if(focus&&changed){window.scrollTo(0,0);$('main-content').focus({preventScroll:true});}
  }
  function hideSearch() {
    clearTimeout(searchTimer);searchAbort?.abort();searchVersion++;$('search-dropdown').hidden=true;$('header-search').setAttribute('aria-expanded','false');
  }
  async function suggest(query,version) {
    const box=$('search-dropdown');
    if(query.length<2)return;
    searchAbort=new AbortController();box.hidden=false;$('header-search').setAttribute('aria-expanded','true');box.innerHTML='<p class="search-note" role="status">Finding your next game…</p>';
    try {
      const data=await request('games?title='+encodeURIComponent(query)+'&limit=8',searchAbort.signal);
      if(version!==searchVersion||$('header-search').value.trim()!==query)return;
      if(!Array.isArray(data))throw new Error('Invalid results');
      const games=data.map(i=>normalise(i,true)).filter(Boolean).slice(0,8);
      games.forEach(g=>cache.set(g.id,cache.get(g.id)||g));
      box.innerHTML=games.length?games.map(g=>`<a class="search-result-item" href="#game/${g.id}"><img class="search-result-cover" src="${esc(g.coverImage)}" alt="" width="58" height="32"><span class="search-result-title">${esc(g.title)}</span><span class="search-result-price">${money(g.currentPrice)}</span></a>`).join(''):'<p class="search-note" role="status">No matching games. Try another title.</p>';
    } catch(error){if(version===searchVersion&&error.name!=='AbortError')box.innerHTML='<p class="search-note" role="status">Search is unavailable. Press Enter to try a full search.</p>';}
  }
  $('header-search').addEventListener('input',event=>{
    hideSearch();const query=event.target.value.trim();const version=searchVersion;
    if(query.length>=2)searchTimer=setTimeout(()=>suggest(query,version),300);
  });
  $('header-search').addEventListener('keydown',event=>{
    if(event.key==='Escape')hideSearch();
    if(event.key==='ArrowDown'){const first=$('search-dropdown').querySelector('a');if(first){event.preventDefault();first.focus();}}
  });
  $('search-dropdown').addEventListener('keydown',event=>{
    const links=[...$('search-dropdown').querySelectorAll('a')],index=links.indexOf(document.activeElement);
    if(event.key==='Escape'){hideSearch();$('header-search').focus();}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const next=index+(event.key==='ArrowDown'?1:-1);if(next<0)$('header-search').focus();else links[Math.min(next,links.length-1)]?.focus();}
  });
  $('search-form').addEventListener('submit',event=>{event.preventDefault();const query=$('header-search').value.trim();hideSearch();location.hash=query?'store?search='+encodeURIComponent(query):'store';});
  document.addEventListener('click',event=>{
    if(!event.target.closest('.header-search'))hideSearch();
    const button=event.target.closest('[data-action]');if(!button)return;
    const action=button.dataset.action,id=button.dataset.id;
    if(action==='wishlist'||action==='cart')toggleSaved(action,id);
    if(action==='retry')void loadCatalog();
    if(action==='retry-search'){searchCache.delete(current.params.get('search'));renderRoute(false);}
    if(action==='retry-game'){detailCache.delete(current.id);void renderGame(routeVersion);}
    if(action==='more'){expanded+=24;void renderCatalog(routeVersion);}
    if(action==='share-game'){const url=new URL(location.href);url.search='';url.hash='game/'+id;void copyLink(url.href);}
    if(action==='share-list')shareLink(button.dataset.list);
    if(action==='budget-lab')budgetLab();
  });
  document.addEventListener('change',event=>{if(event.target.id==='sort-filter')location.hash=routeHref({sort:event.target.value});if(event.target.id==='budget-filter')location.hash=routeHref({budget:event.target.value});});
  document.addEventListener('submit',event=>{
    if(event.target.id!=='bundle-form')return;event.preventDefault();
    const value=amount($('bundle-budget').value);if(value===null||value>500)return;
    const games=solveBundle(value),sum=games.reduce((n,g)=>n+g.currentPrice,0);
    $('bundle-results').innerHTML=`<p style="margin:18px 0">${games.length?`<strong>${games.length} ${games.length===1?'game':'games'} for ${money(sum)}</strong> · ${money(value-sum)} left in your budget. Open each game to confirm current offers.`:'No wishlisted games fit this budget. Try a higher amount or add more games.'}</p>${grid(games)}`;
  });
  document.addEventListener('error',event=>{if(event.target instanceof HTMLImageElement&&!event.target.dataset.fallback){event.target.dataset.fallback='true';event.target.src='images/EuroLootIcon.png';}},true);
  document.addEventListener('keydown',event=>{if(event.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)&&!document.activeElement.isContentEditable){event.preventDefault();$('header-search').focus();}});
  window.addEventListener('hashchange',()=>{expanded=24;renderRoute();});
  window.addEventListener('storage',event=>{if(event.key===STATE_KEY||event.key===null){state=readState(event.newValue);[...state.wishlist,...state.cart].forEach(g=>cache.set(g.id,cache.get(g.id)||g));updateCounts();if(['wishlist','cart','game'].includes(current.page))renderRoute(false);}});
  function loadAuth() {
    const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';script.async=true;
    script.onload=()=>{
      try {
        if(!window.supabase?.createClient)return;
        const client=window.supabase.createClient('https://gepavrbxsdjmmtvwwtdc.supabase.co','sb_publishable_zJNUK33LL5YQOu0mKDBY0g_FglwQg6N');
        const update=session=>{const signed=!!session?.user;$('auth-signin-link').hidden=signed;$('auth-account-link').hidden=!signed;$('auth-signout-button').hidden=!signed;};
        client.auth.getSession().then(({data,error})=>{if(!error)update(data.session);}).catch(()=>{});
        client.auth.onAuthStateChange((_event,session)=>update(session));
        $('auth-signout-button').addEventListener('click',async()=>{const button=$('auth-signout-button');button.disabled=true;try{const {error}=await client.auth.signOut();if(error)throw error;update(null);toast('Signed out. Your browser-local saved games are still here.');}catch{toast('Sign-out failed. Please try again.');}finally{button.disabled=false;}});
      } catch { /* Discovery remains available when account services are offline. */ }
    };
    document.head.append(script);
  }
  updateCounts();renderRoute(false);void loadCatalog();loadAuth();
  void request('stores').then(data=>{if(Array.isArray(data))data.forEach(store=>{if(store.storeID&&store.storeName)stores.set(String(store.storeID),String(store.storeName));});if(current.page==='game'&&detailCache.has(current.id))void renderGame(routeVersion);}).catch(()=>{});
})();
