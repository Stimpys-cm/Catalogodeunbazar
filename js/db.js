// js/db.js
const AUTH_KEY = 'stiimpys_session';

// ── Caché en memoria ─────────────────────────────────────────
let _db      = [];
let _cats    = [];
let _brands  = [];
let _users   = [];
let _activos = [];
let _logs    = [];
let _drops   = [];
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
    _logs    = data.logs        || [];
    _drops   = data.drops       || [];
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
let _hLogs   = '';
let _hDrops  = '';

function _h(arr) { return JSON.stringify(arr); }

// ── Escudo anti-rebote ───────────────────────────────────────
// Tras escribir una colección, ignoramos lo que el poll traiga de ella
// durante unos segundos. Esto evita que el caché del servidor (5s) nos
// devuelva datos viejos y "reviva" algo que acabamos de borrar/editar.
const _WRITE_SHIELD_MS = 3000;
const _lastWrite = {};   // { inventario: ts, categorias: ts, ... }
function _marcarEscritura(col) { _lastWrite[col] = Date.now(); }
function _escudoActivo(col) {
  return _lastWrite[col] && (Date.now() - _lastWrite[col]) < _WRITE_SHIELD_MS;
}
// Tras escribir, pide un sync fresco (sin caché) para refrescar el caché del
// servidor y confirmar el cambio. Se hace tras un pequeño retraso para dar
// tiempo a que el PUT se aplique en Mongo.
function _confirmarEscritura(col) {
  // Entrar en modo rápido: nuestro cambio es actividad reciente
  if (typeof pollAhora === 'function') _ultimoCambio = Date.now();
  setTimeout(async () => {
    try {
      const data = await api('/api/sync?fresh=1');
      const key = col;
      const nuevo = data[key];
      if (!Array.isArray(nuevo)) return;
      const local = { inventario:_db, categorias:_cats, marcas:_brands, usuarios:_users, drops:_drops }[key];
      if (local && _h(nuevo) === _h(local)) {
        _lastWrite[col] = 0;   // confirmado: liberamos el escudo antes
      }
    } catch (_) {}
  }, 1200);
}

// ── Polling: UNA sola petición cada 10 segundos ──────────────
async function _poll() {
  try {
    const data = await api('/api/sync');

    const inv     = data.inventario || [];
    const cats    = data.categorias || [];
    const brands  = data.marcas     || [];
    const users   = data.usuarios   || [];
    const activos = data.activos    || [];
    const logs    = data.logs       || [];
    const drops   = data.drops      || [];

    if (!_escudoActivo('inventario') && _h(inv) !== _hInv) {
      _hInv = _h(inv); _db = inv; _huboCambioEnPoll = true;
      window.dispatchEvent(new CustomEvent('db:inventario', { detail: inv }));
    }
    if (!_escudoActivo('categorias') && _h(cats) !== _hCats) {
      _hCats = _h(cats); _cats = cats; _huboCambioEnPoll = true;
      window.dispatchEvent(new CustomEvent('db:categorias', { detail: cats }));
    }
    if (!_escudoActivo('marcas') && _h(brands) !== _hBrands) {
      _hBrands = _h(brands); _brands = brands; _huboCambioEnPoll = true;
      window.dispatchEvent(new CustomEvent('db:marcas', { detail: brands }));
    }
    if (!_escudoActivo('usuarios') && _h(users) !== _hUsers) {
      _hUsers = _h(users); _users = users; _huboCambioEnPoll = true;
      window.dispatchEvent(new CustomEvent('db:usuarios', { detail: users }));
    }
    if (_h(activos) !== _hActivos) {
      _hActivos = _h(activos); _activos = activos;
      window.dispatchEvent(new CustomEvent('db:activos', { detail: activos }));
    }
    if (_h(logs) !== _hLogs) {
      _hLogs = _h(logs); _logs = logs; _huboCambioEnPoll = true;
      window.dispatchEvent(new CustomEvent('db:logs', { detail: logs }));
    }
    if (!_escudoActivo('drops') && _h(drops) !== _hDrops) {
      _hDrops = _h(drops); _drops = drops; _huboCambioEnPoll = true;
      window.dispatchEvent(new CustomEvent('db:drops', { detail: drops }));
    }

  } catch (_) {}
}

// ── Polling adaptativo ───────────────────────────────────────
// Rápido cuando hay actividad o la pestaña está visible; lento cuando
// todo está quieto o la pestaña en segundo plano. Así se siente casi en
// tiempo real sin quemar el límite de peticiones de los planes gratis.
const POLL_RAPIDO = 3000;    // hay actividad reciente
const POLL_NORMAL = 6000;    // visible pero tranquilo
const POLL_LENTO  = 15000;   // pestaña oculta o sin cambios hace rato
let _pollTimer   = null;
let _ultimoCambio = Date.now();   // última vez que el poll trajo algo nuevo
let _huboCambioEnPoll = false;

function _proximoIntervalo() {
  if (document.hidden) return POLL_LENTO;              // segundo plano → ahorra
  const desdeCambio = Date.now() - _ultimoCambio;
  if (desdeCambio < 15000) return POLL_RAPIDO;         // algo cambió hace poco
  if (desdeCambio < 60000) return POLL_NORMAL;         // tranquilo
  return POLL_LENTO;                                   // quieto hace >1 min
}

function _agendarPoll(msForzado) {
  clearTimeout(_pollTimer);
  const ms = msForzado != null ? msForzado : _proximoIntervalo();
  _pollTimer = setTimeout(_cicloPoll, ms);
}

async function _cicloPoll() {
  _huboCambioEnPoll = false;
  await _poll();
  if (_huboCambioEnPoll) _ultimoCambio = Date.now();
  _agendarPoll();
}

// Dispara un poll casi inmediato (tras un cambio propio o al volver a la pestaña)
function pollAhora(delay = 400) {
  _ultimoCambio = Date.now();
  _agendarPoll(delay);
}

// Al cambiar de visibilidad: si vuelve al frente, sincroniza ya
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pollAhora(150);
  else _agendarPoll();
});

// Arrancar
_loadAll().then(() => {
  _hInv    = _h(_db);
  _hCats   = _h(_cats);
  _hBrands = _h(_brands);
  _hUsers  = _h(_users);
  _hActivos = _h(_activos);
  _hLogs   = _h(_logs);
  _hDrops  = _h(_drops);
  _agendarPoll(POLL_RAPIDO); // arranque adaptativo
});

window.waitForDB = () => new Promise(resolve => {
  if (_dbReady) { resolve(); return; }
  window.addEventListener('db:ready', () => resolve(), { once: true });
});

// ═══════════════════════════════════════════════════════════
//  INVENTARIO
// ═══════════════════════════════════════════════════════════
function getDB() { return _db; }
// Actualiza el caché local del inventario sin re-enviar al servidor.
// Se usa tras un borrado que ya ocurrió en el servidor (api/borrar-prenda).
function _actualizarInventarioLocal(list) {
  _db = list; _hInv = _h(list); _marcarEscritura('inventario');
}
function saveDB(list) {
  _db = list; _hInv = _h(list); _marcarEscritura('inventario'); _confirmarEscritura('inventario');
  api('/api/inventario', { method: 'PUT', body: { list, allowEmpty: true } })
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
  _cats = list; _hCats = _h(list); _marcarEscritura('categorias'); _confirmarEscritura('categorias');
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
  _brands = list; _hBrands = _h(list); _marcarEscritura('marcas'); _confirmarEscritura('marcas');
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
  _users = list; _hUsers = _h(list); _marcarEscritura('usuarios'); _confirmarEscritura('usuarios');
  api('/api/config', { method: 'PUT', body: { col: 'usuarios', list } })
    .catch(e => console.error('[saveUsers]', e));
}
function nextUserId() {
  return _users.length ? Math.max(..._users.map(x => x.id)) + 1 : 1;
}

// ═══════════════════════════════════════════════════════════
//  DROPS (compartidos en servidor)
// ═══════════════════════════════════════════════════════════
function getDrops() { return _drops; }
function saveDrops(list) {
  _drops = list; _hDrops = _h(list); _marcarEscritura('drops'); _confirmarEscritura('drops');
  api('/api/config', { method: 'PUT', body: { col: 'drops', list } })
    .catch(e => console.error('[saveDrops]', e));
}

// ═══════════════════════════════════════════════════════════
//  LOGS DE AUDITORÍA
// ═══════════════════════════════════════════════════════════
function getLogs() { return _logs; }

// Registra una acción en el servidor. No bloquea la UI: si falla, solo avisa
// en consola (la acción principal ya se guardó por su propia vía).
// accion: 'subir' | 'editar' | 'eliminar' | 'vender' | 'reactivar' |
//         'catalogo_crear' | 'catalogo_editar' | 'catalogo_eliminar' |
//         'vendedor_crear' | 'vendedor_eliminar' | 'vendedor_password' |
//         'drop_crear' | 'drop_publicar' | 'drop_editar' | 'drop_eliminar' | 'drop_quitar_prenda'
function registrarLog(accion, objeto = '', detalle = '') {
  const s = getSession();
  if (!s) return;
  // Optimista: lo agregamos al caché local para verlo al instante
  const entrada = {
    ts: new Date().toISOString(),
    usuario: s.username,
    rol: s.role === 'admin' ? 'admin' : 'vendedor',
    accion, objeto: String(objeto || ''), detalle: String(detalle || ''),
  };
  _logs = [entrada, ..._logs].slice(0, 200);
  _hLogs = _h(_logs);
  window.dispatchEvent(new CustomEvent('db:logs', { detail: _logs }));

  api('/api/acciones?op=logs', {
    method: 'POST',
    body: { usuario: s.username, rol: s.role, accion, objeto, detalle }
  }).catch(e => console.error('[registrarLog]', e));
}

// ═══════════════════════════════════════════════════════════
//  SESIÓN
// ═══════════════════════════════════════════════════════════
function getSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; }
  catch { return null; }
}
function setSession(u) {
  localStorage.setItem(AUTH_KEY, JSON.stringify({
    id: u.id, username: u.username, role: u.role, sessionToken: u.sessionToken
  }));
}

// Verifica contra el backend que nuestra sesión siga siendo la vigente.
// Devuelve true si sigue válida, false si fue reemplazada en otro dispositivo.
async function checkMySession() {
  const s = getSession();
  if (!s || !s.sessionToken) return true; // sin token (sesión vieja): no expulsar
  try {
    const r = await api('/api/session-check', {
      method: 'POST',
      body: { username: s.username, token: s.sessionToken }
    });
    return r.valid !== false;
  } catch (_) {
    return true; // ante error de red, no cerramos sesión
  }
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
