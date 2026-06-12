// js/db.js
const AUTH_KEY = 'stiimpys_session';

// ── Caché en memoria ─────────────────────────────────────────
let _db      = [];
let _cats    = [];
let _brands  = [];
let _users   = [];
let _activos = [];
let _dbReady = false;

// ── Helper HTTP ──────────────────────────────────────────────
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

// ── Carga inicial ────────────────────────────────────────────
async function _loadAll() {
  try {
    const data = await api('/api/sync');
    _db      = data.inventario  || [];
    _cats    = data.categorias  || [];
    _brands  = data.marcas      || [];
    _users   = data.usuarios    || [];
    _activos = data.activos     || [];
    _dbReady = true;
    window.dispatchEvent(new CustomEvent('db:ready'));
  } catch (e) {
    console.error('[db] Error cargando datos:', e);
  }
}

// ── Hashes para detectar cambios reales ──────────────────────
let _hInv    = '';
let _hCats   = '';
let _hBrands = '';
let _hUsers  = '';
let _hActivos = '';

function _h(arr) { return JSON.stringify(arr); }

// ── Polling: UNA sola petición cada 3 segundos ───────────────
async function _poll() {
  try {
    const data = await api('/api/sync');

    const inv     = data.inventario || [];
    const cats    = data.categorias || [];
    const brands  = data.marcas     || [];
    const users   = data.usuarios   || [];
    const activos = data.activos    || [];

    if (_h(inv) !== _hInv) {
      _hInv = _h(inv); _db = inv;
      window.dispatchEvent(new CustomEvent('db:inventario', { detail: inv }));
    }
    if (_h(cats) !== _hCats) {
      _hCats = _h(cats); _cats = cats;
      window.dispatchEvent(new CustomEvent('db:categorias', { detail: cats }));
    }
    if (_h(brands) !== _hBrands) {
      _hBrands = _h(brands); _brands = brands;
      window.dispatchEvent(new CustomEvent('db:marcas', { detail: brands }));
    }
    if (_h(users) !== _hUsers) {
      _hUsers = _h(users); _users = users;
      window.dispatchEvent(new CustomEvent('db:usuarios', { detail: users }));
    }
    if (_h(activos) !== _hActivos) {
      _hActivos = _h(activos); _activos = activos;
      window.dispatchEvent(new CustomEvent('db:activos', { detail: activos }));
    }

  } catch (_) {}
}

// Arrancar
_loadAll().then(() => {
  _hInv    = _h(_db);
  _hCats   = _h(_cats);
  _hBrands = _h(_brands);
  _hUsers  = _h(_users);
  _hActivos = _h(_activos);
  setInterval(_poll, 10000); // 3 segundos
});

window.waitForDB = () => new Promise(resolve => {
  if (_dbReady) { resolve(); return; }
  window.addEventListener('db:ready', () => resolve(), { once: true });
});

// ═══════════════════════════════════════════════════════════
//  INVENTARIO
// ═══════════════════════════════════════════════════════════
function getDB() { return _db; }
function saveDB(list) {
  _db = list; _hInv = _h(list);
  api('/api/inventario', { method: 'PUT', body: { list } })
    .catch(e => console.error('[saveDB]', e));
}
function nextId() {
  return _db.length ? Math.max(..._db.map(x => x.id)) + 1 : 1;
}

// ═══════════════════════════════════════════════════════════
//  CATEGORÍAS
// ═══════════════════════════════════════════════════════════
function getCats() { return _cats; }
function saveCats(list) {
  _cats = list; _hCats = _h(list);
  api('/api/config', { method: 'PUT', body: { col: 'categorias', list } })
    .catch(e => console.error('[saveCats]', e));
}
function nextCatId() {
  return _cats.length ? Math.max(..._cats.map(x => x.id)) + 1 : 1;
}

// ═══════════════════════════════════════════════════════════
//  MARCAS
// ═══════════════════════════════════════════════════════════
function getBrands() { return _brands; }
function saveBrands(list) {
  _brands = list; _hBrands = _h(list);
  api('/api/config', { method: 'PUT', body: { col: 'marcas', list } })
    .catch(e => console.error('[saveBrands]', e));
}
function nextBrandId() {
  return _brands.length ? Math.max(..._brands.map(x => x.id)) + 1 : 1;
}

// ═══════════════════════════════════════════════════════════
//  USUARIOS
// ═══════════════════════════════════════════════════════════
function getUsers() { return _users; }
function saveUsers(list) {
  _users = list; _hUsers = _h(list);
  api('/api/config', { method: 'PUT', body: { col: 'usuarios', list } })
    .catch(e => console.error('[saveUsers]', e));
}
function nextUserId() {
  return _users.length ? Math.max(..._users.map(x => x.id)) + 1 : 1;
}

// ═══════════════════════════════════════════════════════════
//  SESIÓN
// ═══════════════════════════════════════════════════════════
function getSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; }
  catch { return null; }
}
function setSession(u) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ id: u.id, username: u.username, role: u.role }));
}
function clearSession()  { localStorage.removeItem(AUTH_KEY); }
function isAdmin()       { return getSession()?.role === 'admin'; }
function isVendedor()    { return getSession()?.role === 'vendedor'; }
function isLoggedIn()    { return !!getSession(); }

// ═══════════════════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════════════════
function toast(msg, dur = 2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), dur);
}

// ═══════════════════════════════════════════════════════════
//  MODAL IMÁGENES
// ═══════════════════════════════════════════════════════════
let mImgs = [], mIdx = 0;
function openMod(imgs, idx) {
  mImgs = imgs; mIdx = idx;
  document.getElementById('modImg').src = imgs[idx] || '';
  document.getElementById('modalOv').classList.add('active');
  document.body.style.overflow = 'hidden';
  const multi = imgs.length > 1;
  document.getElementById('mPrev').style.display = multi ? 'flex' : 'none';
  document.getElementById('mNext').style.display = multi ? 'flex' : 'none';
}
function closeMod() {
  document.getElementById('modalOv').classList.remove('active');
  document.body.style.overflow = '';
}
function mChg(d) {
  mIdx = (mIdx + d + mImgs.length) % mImgs.length;
  document.getElementById('modImg').src = mImgs[mIdx] || '';
}
document.addEventListener('keydown', e => {
  const ov = document.getElementById('modalOv');
  if (ov?.classList.contains('active')) {
    if (e.key === 'Escape')     closeMod();
    if (e.key === 'ArrowLeft')  mChg(-1);
    if (e.key === 'ArrowRight') mChg(1);
  }
});
document.addEventListener('DOMContentLoaded', () => {
  const ov = document.getElementById('modalOv');
  if (ov) ov.addEventListener('click', e => { if (e.target === ov) closeMod(); });
});

// ═══════════════════════════════════════════════════════════
//  USUARIOS ACTIVOS — usa caché local, se actualiza con el poll
// ═══════════════════════════════════════════════════════════
async function updateMyActivity() {
  const session = getSession();
  if (!session) return;
  try {
    await api('/api/activos', { method: 'POST', body: { username: session.username } });
  } catch (_) {}
}

async function getActiveUsers() {
  // Devuelve el caché local (ya actualizado por el poll)
  return _activos;
}

async function removeMyActivity() {
  const session = getSession();
  if (!session) return;
  try {
    await api(`/api/activos?username=${encodeURIComponent(session.username)}`, { method: 'DELETE' });
  } catch (_) {}
}

// ── Keep-alive: ping cada 4 minutos para evitar cold start ───
// Solo cuando hay sesión activa (admin/vendedor)
function _keepAlive() {
  if (!getSession()) return;
  fetch('/api/sync').catch(() => {});
}
setInterval(_keepAlive, 4 * 60 * 1000);
