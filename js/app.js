<script>
// ══════════════════════════════════════════════════════
//  GEO & LOCALIZATION MOCK (EU Restriction & Language)
// ══════════════════════════════════════════════════════
const TRANSLATIONS = {
  en: { store: "Store", deals: "Deals", wishlist: "Wishlist", cart: "Cart", search: "Search Steam games...", login: "Sign in", addToCart: "Add to Cart", buy: "Buy Now" },
  de: { store: "Shop", deals: "Angebote", wishlist: "Wunschliste", cart: "Warenkorb", search: "Steam-Spiele suchen...", login: "Anmelden", addToCart: "In den Warenkorb", buy: "Jetzt kaufen" },
  it: { store: "Negozio", deals: "Offerte", wishlist: "Lista desideri", cart: "Carrello", search: "Cerca giochi Steam...", login: "Accedi", addToCart: "Aggiungi al carrello", buy: "Acquista ora" },
  fr: { store: "Boutique", deals: "Offres", wishlist: "Liste de souhaits", cart: "Panier", search: "Rechercher des jeux...", login: "Connexion", addToCart: "Ajouter au panier", buy: "Acheter" },
  es: { store: "Tienda", deals: "Ofertas", wishlist: "Lista de deseos", cart: "Carrito", search: "Buscar juegos...", login: "Iniciar sesión", addToCart: "Añadir al carrito", buy: "Comprar ahora" }
};

let currentLangObj = TRANSLATIONS['en'];

function initSecurityAndLocale() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!tz.startsWith('Europe/')) {
    document.getElementById('geo-block').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    return false;
  }
  
  document.getElementById('geo-block').style.display = 'none';
  document.getElementById('app').style.display = 'flex';

  const langRaw = navigator.language || 'en';
  const langKey = langRaw.split('-')[0];
  if (TRANSLATIONS[langKey]) {
    currentLangObj = TRANSLATIONS[langKey];
  } else {
    currentLangObj = TRANSLATIONS['en'];
  }
  
  applyTranslations();
  return true;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if(currentLangObj[key]) el.textContent = currentLangObj[key];
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const key = el.getAttribute('data-i18n-ph');
    if(currentLangObj[key]) el.placeholder = currentLangObj[key];
  });
}

// ══════════════════════════════════════════════════════
//  FRESH RUN STATE DATA
// ══════════════════════════════════════════════════════
let CART = [];
let WISHLIST_IDS = [];
let FRONT_GAMES = [];
let ACTIVE_GAME_CACHE = {}; 
let searchTimeout = null;

// ══════════════════════════════════════════════════════
//  LIVE STEAM API INTERACTION (CheapShark Engine)
// ══════════════════════════════════════════════════════

// Fetch dynamic front page highlights
async function fetchFrontHighlights() {
  try {
    const response = await fetch('https://www.cheapshark.com/api/1.0/deals?storeID=1&upperPrice=50&pageSize=12');
    if (!response.ok) throw new Error('Data endpoint issue');
    const data = await response.json();
    
    FRONT_GAMES = data.map(item => ({
      id: item.gameID,
      steamAppID: item.steamAppID,
      title: item.title,
      tagline: 'Verified Steam platform entry. Index tracker identification node ' + item.steamAppID,
      basePrice: parseFloat(item.normalPrice),
      currentPrice: parseFloat(item.salePrice),
      discountPercent: Math.round(parseFloat(item.savings)),
      coverImage: item.thumb,
      dealID: item.dealID
    }));

    FRONT_GAMES.forEach(g => { ACTIVE_GAME_CACHE[g.id] = g; });
    return true;
  } catch (err) {
    console.error("Catalog system failed initialization:", err);
    return false;
  }
}

// Global live game target configuration lookup
async function fetchTargetGameDetails(gameId) {
  if (ACTIVE_GAME_CACHE[gameId] && ACTIVE_GAME_CACHE[gameId].tagline !== 'Global catalog listing') {
    return ACTIVE_GAME_CACHE[gameId];
  }
  try {
    const response = await fetch(`https://www.cheapshark.com/api/1.0/games?id=${gameId}`);
    if (!response.ok) throw new Error('Query error');
    const data = await response.json();
    
    const steamInfo = data.deals.find(d => d.storeID === "1") || data.deals[0];
    const base = parseFloat(steamInfo.retailPrice);
    const current = parseFloat(steamInfo.price);
    const savings = Math.round(((base - current) / base) * 100);

    const gameObj = {
      id: gameId,
      steamAppID: data.info.steamAppID || 'Unknown',
      title: data.info.title,
      tagline: 'Global catalog listing retrieved from live central tracking framework nodes.',
      basePrice: base,
      currentPrice: current,
      discountPercent: savings > 0 ? savings : 0,
      coverImage: data.info.thumb,
      dealID: steamInfo.dealID
    };

    ACTIVE_GAME_CACHE[gameId] = gameObj;
    return gameObj;
  } catch (err) {
    console.error("Failed loading target configuration elements:", err);
    return null;
  }
}

// ══════════════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════════════
const fmt = n => '&euro;' + n.toFixed(2);
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const discTag = pct => pct > 0 ? `<span class="badge-discount">-${pct}%</span>` : '<span></span>';

function gameCard(game){
  return `
  <div class="game-card" onclick="navigate('game','${game.id}')">
    <img class="gc-img" src="${game.coverImage}" alt="${esc(game.title)}" onerror="this.src='https://picsum.photos/seed/${game.id}/260/120'">
    <div class="gc-title">${esc(game.title)}</div>
    <div style="margin-top:2px;"><span class="plat-pill">Steam</span></div>
    <div class="gc-price">
      ${game.discountPercent > 0 ? discTag(game.discountPercent) : '<span></span>'}
      <span class="price-current">${fmt(game.currentPrice)}</span>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════
//  ROUTER
// ══════════════════════════════════════════════════════
function navigate(page, param=''){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const el = document.getElementById(`page-${page}`);
  if(!el) return;
  el.classList.add('active');
  window.scrollTo(0,0);
  
  document.querySelectorAll('nav a').forEach(a=>a.classList.remove('active'));
  if(page==='store') document.querySelector('nav a[data-i18n="store"]')?.classList.add('active');
  if(page==='deals') document.querySelector('nav a[data-i18n="deals"]')?.classList.add('active');
  if(page==='wishlist') document.querySelector('nav a[data-i18n="wishlist"]')?.classList.add('active');

  switch(page){
    case 'home':      renderHome(); break;
    case 'store':     renderStore(); break;
    case 'deals':     renderDeals(); break;
    case 'wishlist':  renderWishlist(); break;
    case 'cart':      renderCart(); break;
    case 'game':      renderGame(param); break;
    case 'login':     renderLogin(); break;
  }
}

// ══════════════════════════════════════════════════════
//  PAGES RENDERING
// ══════════════════════════════════════════════════════
function renderHome(){
  if(FRONT_GAMES.length === 0) {
    document.getElementById('page-home').innerHTML = '<div class="status-msg">Loading live European Steam framework catalog indexes...</div>';
    return;
  }
  
  const featured = FRONT_GAMES[0];
  const gridGames = FRONT_GAMES.slice(1, 9);
  
  document.getElementById('page-home').innerHTML = `
  <div class="hero">
    <div class="wrap hero-content">
      <img src="${featured.coverImage}" class="hero-img" alt="" onerror="this.src='https://picsum.photos/seed/hero/400/200'">
      <div class="hero-info">
        <h2 class="hero-title">${esc(featured.title)}</h2>
        <p class="hero-tagline">${esc(featured.tagline)}</p>
        <div style="margin-bottom:15px;"><span class="plat-pill">Steam Official Platform Asset</span></div>
        <div>
          <span style="font-size:24px; font-weight:bold;">${fmt(featured.currentPrice)}</span>
          ${featured.discountPercent > 0 ? `<span style="text-decoration:line-through; color:var(--muted); margin-left:10px;">${fmt(featured.basePrice)}</span>` : ''}
        </div>
        <button class="btn-primary" style="margin-top:20px; width:150px;" onclick="navigate('game','${featured.id}')">View Details</button>
      </div>
    </div>
  </div>
  <div class="wrap">
    <div class="section">
      <div class="section-head">
        <div class="section-title">Live Steam Catalog Highlights</div>
      </div>
      <div class="grid">
        ${gridGames.map(g=>gameCard(g)).join('')}
      </div>
    </div>
  </div>`;
}

function renderStore(){
  if(FRONT_GAMES.length === 0) {
    document.getElementById('page-store').innerHTML = '<div class="status-msg">Accessing live tracking endpoints...</div>';
    return;
  }

  document.getElementById('page-store').innerHTML = `
  <div class="wrap store-layout">
    <aside class="sidebar">
      <div class="filter-section">
        <div class="filter-label">Available Platforms</div>
        <div class="filter-list">
          <a href="#" onclick="return false">Steam Active Catalog</a>
          <span style="margin-top:5px; font-weight:normal; font-size:11px;">Epic Games (Unavailable/EU Check Pending)</span>
          <span style="font-weight:normal; font-size:11px;">PlayStation Network (Unavailable)</span>
          <span style="font-weight:normal; font-size:11px;">Xbox Live Marketplace (Unavailable)</span>
          <span style="font-weight:normal; font-size:11px;">Nintendo eShop (Unavailable)</span>
          <span style="font-weight:normal; font-size:11px;">GOG Galaxy Direct (Unavailable)</span>
        </div>
      </div>
    </aside>
    <div style="flex:1;">
      <h2 style="color:var(--eu-blue); border-bottom:2px solid var(--eu-blue); padding-bottom:5px; margin-bottom:15px;">Active Steam Ecosystem</h2>
      <div class="grid">
        ${FRONT_GAMES.map(g=>gameCard(g)).join('')}
      </div>
    </div>
  </div>`;
}

function renderDeals(){
  if(FRONT_GAMES.length === 0) {
    document.getElementById('page-deals').innerHTML = '<div class="status-msg">Processing live discounts...</div>';
    return;
  }
  
  const deals = FRONT_GAMES.filter(g => g.discountPercent > 0);
  document.getElementById('page-deals').innerHTML = `
  <div class="wrap" style="padding:20px 0;">
    <h2 style="color:var(--hot); border-bottom:2px solid var(--hot); padding-bottom:5px; margin-bottom:15px;">Special Live Promotions</h2>
    <div class="grid">
      ${deals.map(g=>gameCard(g)).join('')}
    </div>
  </div>`;
}

async function renderGame(id){
  document.getElementById('page-game').innerHTML = '<div class="status-msg">Synchronizing specific allocation records...</div>';
  
  const game = await fetchTargetGameDetails(id);
  if(!game) {
    document.getElementById('page-game').innerHTML = '<div class="status-msg">Target structural item allocation trace error.</div>';
    return;
  }
  const inWish = WISHLIST_IDS.includes(game.id);

  document.getElementById('page-game').innerHTML = `
  <div class="wrap game-detail">
    <div class="gd-header">
      <img src="${game.coverImage}" class="gd-cover" alt="" onerror="this.src='https://picsum.photos/seed/${game.id}/260/120'">
      <div class="gd-info">
        <h1 class="gd-title">${esc(game.title)}</h1>
        <p style="color:var(--muted); margin-bottom:15px;">${esc(game.tagline)}</p>
        <div style="margin-bottom:15px;"><span class="plat-pill">Steam Platform Node</span></div>
        <div style="background:#e8f0fe; border:1px solid var(--eu-blue); padding:15px; width:300px;">
          <div style="font-size:24px; font-weight:bold; color:#000;">${fmt(game.currentPrice)}</div>
          <div style="margin-top:10px; display:flex; gap:10px;">
             <button class="btn-primary" onclick="addToCart('${game.id}')">${currentLangObj.addToCart || 'Add to Cart'}</button>
             <button onclick="toggleWishlist('${game.id}')" style="border:1px solid #999; background:#fff; padding:5px 10px; font-weight:bold;">${inWish?'- Remove Wishlist':'+ Add to Wishlist'}</button>
          </div>
        </div>
      </div>
    </div>
    <h2 style="font-size:16px; color:var(--eu-blue); border-bottom:1px solid #ccc; padding-bottom:5px;">Platform Distribution Audits</h2>
    <table class="price-table">
      <thead><tr><th>Storefront Node</th><th>Ecosystem Status</th><th>Indexed Price</th><th>Action</th></tr></thead>
      <tbody>
        <tr>
          <td><strong>Steam Valve Corporation</strong></td>
          <td><span style="color:var(--mint); font-weight:bold;">Active/Authorized</span></td>
          <td style="font-weight:bold;">${fmt(game.currentPrice)}</td>
          <td><button class="buy-btn" onclick="addToCart('${game.id}')">Procure Key</button></td>
        </tr>
        <tr style="color:var(--muted2); background:#fafafa;">
          <td>Epic Games Store</td>
          <td>Unavailable / Platform Excluded</td>
          <td>Blocked</td>
          <td>Locked</td>
        </tr>
        <tr style="color:var(--muted2); background:#fafafa;">
          <td>GOG Digital Distrib.</td>
          <td>Unavailable / Platform Excluded</td>
          <td>Blocked</td>
          <td>Locked</td>
        </tr>
      </tbody>
    </table>
  </div>`;
}

function renderCart(){
  const items = CART.map(id => ACTIVE_GAME_CACHE[id]).filter(Boolean);
  const total = items.reduce((sum, g) => sum + g.currentPrice, 0);
  
  document.getElementById('page-cart').innerHTML = `
  <div class="wrap" style="padding:20px 0;">
    <h2 style="color:var(--eu-blue); border-bottom:2px solid var(--eu-blue); padding-bottom:5px; margin-bottom:15px;">Shopping Cart</h2>
    ${items.length === 0 ? '<p>Your cart is empty.</p>' : `
    <table class="classic-table">
      <thead><tr><th>Acquisition Target</th><th>Price Matrix Allocation</th><th>Action</th></tr></thead>
      <tbody>
        ${items.map(g => `<tr><td><strong>${esc(g.title)}</strong> (Steam App ID reference ID: ${g.steamAppID})</td><td>${fmt(g.currentPrice)}</td><td><button onclick="removeCart('${g.id}')" style="color:var(--hot); text-decoration:underline;">Remove Matrix Allocation</button></td></tr>`).join('')}
      </tbody>
    </table>
    <div style="text-align:right; font-size:18px; margin-bottom:15px;">
      Subtotal Aggregate: <strong>${fmt(total)}</strong>
    </div>
    <div style="text-align:right;">
      <button class="btn-primary" onclick="alert('Transaction infrastructure initialized for secure processing.')">Proceed to Checkout</button>
    </div>
    `}
  </div>`;
}

function renderWishlist(){
  const items = WISHLIST_IDS.map(id => ACTIVE_GAME_CACHE[id]).filter(Boolean);
  
  document.getElementById('page-wishlist').innerHTML = `
  <div class="wrap" style="padding:20px 0;">
    <h2 style="color:var(--eu-blue); border-bottom:2px solid var(--eu-blue); padding-bottom:5px; margin-bottom:15px;">My Wishlist</h2>
    ${items.length === 0 ? '<p>Your wishlist is currently clear.</p>' : `
    <div class="grid">
      ${items.map(g => gameCard(g)).join('')}
    </div>
    `}
  </div>`;
}

function renderLogin(){
  const REDIRECT_URI = encodeURIComponent("https://euroloot.eu/callback");
  const GOOGLE_AUTH = `https://accounts.google.com/o/oauth2/v2/auth?client_id=GOOGLE_CLIENT_ID&redirect_uri=${REDIRECT_URI}&response_type=code&scope=email%20profile`;
  const STEAM_AUTH = `https://steamcommunity.com/openid/login?openid.ns=http://specs.openid.net/auth/2.0&openid.mode=checkid_setup&openid.return_to=${REDIRECT_URI}&openid.realm=https://euroloot.eu`;
  const DISCORD_AUTH = `https://discord.com/api/oauth2/authorize?client_id=DISCORD_CLIENT_ID&redirect_uri=${REDIRECT_URI}&response_type=code&scope=identify`;
  const ITCH_AUTH = `https://itch.io/user/oauth?client_id=ITCH_CLIENT_ID&redirect_uri=${REDIRECT_URI}&response_type=token`;
  const MEGACARD_AUTH = `https://api.megacard.eu/auth/authorize?client_id=MEGACARD_CLIENT_ID&redirect_uri=${REDIRECT_URI}&response_type=code`;

  document.getElementById('page-login').innerHTML = `
  <div class="wrap auth-page">
    <div class="auth-card">
      <div class="auth-title">Sign In / Register</div>
      <p style="font-size:11px; color:var(--muted); text-align:center; margin-bottom:15px;">Sign in via your preferred European or global network link infrastructure.</p>
      
      <a href="${GOOGLE_AUTH}" class="social-btn">Sign in with Google</a>
      <a href="${STEAM_AUTH}" class="social-btn">Sign in with Steam</a>
      <a href="${DISCORD_AUTH}" class="social-btn">Sign in with Discord</a>
      <a href="${ITCH_AUTH}" class="social-btn">Sign in with Itch.io</a>
      <a href="${MEGACARD_AUTH}" class="social-btn" style="border-color:var(--eu-blue); color:var(--eu-blue) !important;">Sign in with MEGACARD</a>
      
      <div style="text-align:center; margin:15px 0; border-bottom:1px solid var(--border); line-height:0.1em;">
        <span style="background:var(--surface); padding:0 10px; color:var(--muted);">or classic framework token login</span>
      </div>
      
      <div class="form-group">
        <label class="form-label">Email Address</label>
        <input type="email" class="form-input">
      </div>
      <div class="form-group">
        <label class="form-label">Password</label>
        <input type="password" class="form-input">
      </div>
      <button class="btn-primary" style="width:100%; margin-top:10px;" onclick="alert('Local database submission requires active authentication node configuration.')">Login securely</button>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════
//  ACTIONS & ADVANCED SEARCH INTERACTION
// ══════════════════════════════════════════════════════
function addToCart(gameId){
  if(!CART.includes(gameId)) CART.push(gameId);
  document.getElementById('cart-badge').textContent = CART.length;
  alert("Item pinned to active processing session.");
}

function removeCart(gameId){
  CART = CART.filter(id => id !== gameId);
  document.getElementById('cart-badge').textContent = CART.length;
  renderCart();
}

function toggleWishlist(gameId){
  if(WISHLIST_IDS.includes(gameId)){
    WISHLIST_IDS = WISHLIST_IDS.filter(id=>id!==gameId);
    alert("Removed from active processing wishlist.");
  } else {
    WISHLIST_IDS.push(gameId);
    alert("Pinned to active processing wishlist.");
  }
  if(document.getElementById('page-game').classList.contains('active')) renderGame(gameId);
}

// Input Debouncing functionality to optimize pipeline execution
function debounceSearch(val) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    handleLiveSearch(val);
  }, 350);
}

// Full execution query system across whole tracking catalog
async function handleLiveSearch(q){
  const dd = document.getElementById('search-dropdown');
  if(!q.trim()){ dd.style.display='none'; return; }
  
  dd.innerHTML = '<div style="padding:10px; font-size:11px; text-align:center; color:var(--muted);">Querying global data directories...</div>';
  dd.style.display = 'block';

  try {
    const response = await fetch(`https://www.cheapshark.com/api/1.0/games?title=${encodeURIComponent(q)}`);
    if(!response.ok) throw new Error('API failure');
    const data = await response.json();
    
    // Max output constraints
    const elements = data.slice(0, 8);
    if(elements.length === 0) {
      dd.innerHTML = '<div style="padding:10px; font-size:11px; text-align:center; color:var(--hot);">No indexed items discovered.</div>';
      return;
    }

    dd.innerHTML = elements.map(item => {
      // Map temporary global item metadata wrapper 
      if (!ACTIVE_GAME_CACHE[item.gameID]) {
        ACTIVE_GAME_CACHE[item.gameID] = {
          id: item.gameID,
          steamAppID: item.steamAppID || 'Unknown',
          title: item.external,
          tagline: 'Global catalog listing',
          basePrice: parseFloat(item.cheapest) || 0.00,
          currentPrice: parseFloat(item.cheapest) || 0.00,
          discountPercent: 0,
          coverImage: item.thumb
        };
      }
      
      return `
      <div class="search-result-item" onclick="clearSearchDropdown(); navigate('game','${item.gameID}');">
        <img class="search-result-cover" src="${item.thumb}" alt="" onerror="this.src='https://picsum.photos/seed/${item.gameID}/45/21'">
        <div style="flex:1; min-width:0;">
          <div class="search-result-title">${esc(item.external)}</div>
          <span style="font-size:10px; color:var(--muted2);">ID: ${item.steamAppID || 'N/A'}</span>
        </div>
        <div class="search-result-price">From ${fmt(parseFloat(item.cheapest))}</div>
      </div>`;
    }).join('');

  } catch (err) {
    dd.innerHTML = '<div style="padding:10px; font-size:11px; text-align:center; color:var(--hot);">Failed retrieving query dataset indexes.</div>';
  }
}

function clearSearchDropdown() {
  document.getElementById('header-search').value = '';
  document.getElementById('search-dropdown').style.display = 'none';
}

document.addEventListener('click', e => {
  const dd = document.getElementById('search-dropdown');
  if(dd && !dd.contains(e.target) && e.target.id!=='header-search') dd.style.display='none';
});

// ══════════════════════════════════════════════════════
//  BOOTSTRAP INITIALIZATION
// ══════════════════════════════════════════════════════
if(initSecurityAndLocale()){
  fetchFrontHighlights().then(success => {
    navigate('home');
  });
}
</script>