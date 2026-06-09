const DB_KEY       = 'stiimpys_inventario';
const AUTH_KEY     = 'stiimpys_session';
const USERS_KEY    = 'stiimpys_users';
const CATS_KEY     = 'stiimpys_categorias';
const BRANDS_KEY   = 'stiimpys_marcas';

// ─── USUARIOS ────────────────────────────────────────────────
function getUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY)) || []; }
  catch(e) { return []; }
}
function saveUsers(d) { localStorage.setItem(USERS_KEY, JSON.stringify(d)); }

(function initDefaults() {
  let users = getUsers();
  if (!users.find(u => u.username === 'admin')) {
    users.push({ id:1, username:'admin', password:'stiimpys2026', role:'admin' });
    saveUsers(users);
  }
  // Categorías por defecto
  if (!localStorage.getItem(CATS_KEY)) {
    localStorage.setItem(CATS_KEY, JSON.stringify([
      { id:1, nombre:'Pantalones' },
      { id:2, nombre:'Playeras' },
      { id:3, nombre:'Suéteres' },
      { id:4, nombre:'Chamarras' },
      { id:5, nombre:'Shorts' },
    ]));
  }
  // Marcas por defecto
  if (!localStorage.getItem(BRANDS_KEY)) {
    localStorage.setItem(BRANDS_KEY, JSON.stringify([
      { id:1, nombre:'Nike' },
      { id:2, nombre:'Adidas' },
      { id:3, nombre:'Supreme' },
      { id:4, nombre:'Dickies' },
    ]));
  }
})();

function nextUserId() {
  const u = getUsers();
  return u.length ? Math.max(...u.map(x=>x.id))+1 : 1;
}

// ─── CATEGORÍAS ──────────────────────────────────────────────
function getCats() {
  try { return JSON.parse(localStorage.getItem(CATS_KEY)) || []; }
  catch(e) { return []; }
}
function saveCats(d) { localStorage.setItem(CATS_KEY, JSON.stringify(d)); }
function nextCatId() {
  const c = getCats();
  return c.length ? Math.max(...c.map(x=>x.id))+1 : 1;
}

// ─── MARCAS ──────────────────────────────────────────────────
function getBrands() {
  try { return JSON.parse(localStorage.getItem(BRANDS_KEY)) || []; }
  catch(e) { return []; }
}
function saveBrands(d) { localStorage.setItem(BRANDS_KEY, JSON.stringify(d)); }
function nextBrandId() {
  const b = getBrands();
  return b.length ? Math.max(...b.map(x=>x.id))+1 : 1;
}

// ─── SESIÓN ──────────────────────────────────────────────────
function getSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; }
  catch(e) { return null; }
}
function setSession(u) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ id:u.id, username:u.username, role:u.role }));
}
function clearSession() { localStorage.removeItem(AUTH_KEY); }
function isAdmin()    { const s=getSession(); return s&&s.role==='admin'; }
function isVendedor() { const s=getSession(); return s&&s.role==='vendedor'; }
function isLoggedIn() { return !!getSession(); }

// ─── INVENTARIO ──────────────────────────────────────────────
function getDB() {
  try { return JSON.parse(localStorage.getItem(DB_KEY)) || []; }
  catch(e) { return []; }
}
function saveDB(d) { localStorage.setItem(DB_KEY, JSON.stringify(d)); }
function nextId() {
  const db = getDB();
  return db.length ? Math.max(...db.map(x=>x.id))+1 : 1;
}

// ─── TOAST ───────────────────────────────────────────────────
function toast(msg, dur=2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), dur);
}

// ─── MODAL IMÁGENES ──────────────────────────────────────────
let mImgs=[], mIdx=0;
function openMod(imgs, idx) {
  mImgs=imgs; mIdx=idx;
  document.getElementById('modImg').src = imgs[idx]||'';
  document.getElementById('modalOv').classList.add('active');
  document.body.style.overflow='hidden';
  const multi = imgs.length>1;
  document.getElementById('mPrev').style.display = multi?'flex':'none';
  document.getElementById('mNext').style.display = multi?'flex':'none';
}
function closeMod() {
  document.getElementById('modalOv').classList.remove('active');
  document.body.style.overflow='';
}
function mChg(d) {
  mIdx=(mIdx+d+mImgs.length)%mImgs.length;
  document.getElementById('modImg').src=mImgs[mIdx]||'';
}
document.addEventListener('keydown', e=>{
  const ov=document.getElementById('modalOv');
  if(ov&&ov.classList.contains('active')){
    if(e.key==='Escape') closeMod();
    if(e.key==='ArrowLeft') mChg(-1);
    if(e.key==='ArrowRight') mChg(1);
  }
});
document.addEventListener('DOMContentLoaded',()=>{
  const ov=document.getElementById('modalOv');
  if(ov) ov.addEventListener('click',function(e){ if(e.target===this) closeMod(); });
});

// ─── MONITOREO DE USUARIOS EN TIEMPO REAL (SIMULADO) ────────────────
const ACTIVE_USERS_KEY = 'stiimpys_active_users';

function updateMyActivity() {
  const session = getSession();
  if (!session) return;
  
  let activeUsers = [];
  try { activeUsers = JSON.parse(localStorage.getItem(ACTIVE_USERS_KEY)) || []; }
  catch(e) { activeUsers = []; }
  
  const now = Date.now();
  // Filtrar usuarios que no se han reportado en los últimos 45 segundos
  activeUsers = activeUsers.filter(u => (now - u.lastActive) < 45000);
  
  // Buscar si ya existo en la lista para actualizarme
  const myIdx = activeUsers.findIndex(u => u.username === session.username);
  if (myIdx !== -1) {
    activeUsers[myIdx].lastActive = now;
  } else {
    activeUsers.push({ username: session.username, lastActive: now });
  }
  
  localStorage.setItem(ACTIVE_USERS_KEY, JSON.stringify(activeUsers));
}

function getActiveUsers() {
  try {
    const activeUsers = JSON.parse(localStorage.getItem(ACTIVE_USERS_KEY)) || [];
    const now = Date.now();
    // Retornar solo los que tengan actividad reciente (menos de 45 segundos)
    return activeUsers.filter(u => (now - u.lastActive) < 45000);
  } catch(e) {
    return [];
  }
}

// Limpiar mi rastro al cerrar sesión de forma explíciting
function removeMyActivity() {
  const session = getSession();
  if (!session) return;
  try {
    let activeUsers = JSON.parse(localStorage.getItem(ACTIVE_USERS_KEY)) || [];
    activeUsers = activeUsers.filter(u => u.username !== session.username);
    localStorage.setItem(ACTIVE_USERS_KEY, JSON.stringify(activeUsers));
  } catch(e) {}
}