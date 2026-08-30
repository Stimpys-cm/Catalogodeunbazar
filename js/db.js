// js/db.js
const AUTH_KEY = 'stiimpys_session';

// ── Modo público vs panel ────────────────────────────────────
// Un visitante de la tienda no necesita usuarios, logs ni actividad, y el
// catálogo no cambia cada tres segundos. En modo público se pide una
// respuesta recortada (que además el CDN cachea) y se consulta mucho menos
// seguido: así el sitio aguanta bastante más gente sin caerse.
const MODO_PUBLICO = (() => {
  try { return !localStorage.getItem(AUTH_KEY); } catch (_) { return true; }
})();

const RUTA_SYNC = MODO_PUBLICO ? '/api/sync?scope=publico' : '/api/sync';

// ── Caché en memoria ─────────────────────────────────────────
let _db      = [];
let _cats    = [];
let _brands  = [];
let _users   = [];
let _activos = [];
let _logs    = [];
let _drops   = [];
let _bazares = [];
let _resenas = [];        // reseñas públicas de los bazares
let _ajustes = null;      // qué partes del sitio están abiertas
let _subastas = [];       // prendas que se están subastando
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
    const data = await api(RUTA_SYNC);
    _db      = data.inventario  || [];
    _cats    = data.categorias  || [];
    _brands  = data.marcas      || [];
    _users   = data.usuarios    || [];
    _activos = data.activos     || [];
    _logs    = data.logs        || [];
    _drops   = data.drops       || [];
    _bazares = data.bazares     || [];
    _resenas = data.resenas     || [];
    _ajustes = data.ajustes     || null;
    _subastas = data.subastas   || [];
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
let _hBazares = '';
let _hResenas = '';
let _hAjustes = '';
let _hSubastas = '';

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
      const data = await api(RUTA_SYNC + (MODO_PUBLICO ? '&' : '?') + 'fresh=1');
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
    const data = await api(RUTA_SYNC);

    const inv     = data.inventario || [];
    const cats    = data.categorias || [];
    const brands  = data.marcas     || [];
    const users   = data.usuarios   || [];
    const activos = data.activos    || [];
    const logs    = data.logs       || [];
    const drops   = data.drops      || [];
    const bazares = data.bazares    || [];
    const resenas = data.resenas    || [];
    const ajustes = data.ajustes    || null;
    const subastas = data.subastas  || [];

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
    if (!_escudoActivo('bazares') && _h(bazares) !== _hBazares) {
      _hBazares = _h(bazares); _bazares = bazares; _huboCambioEnPoll = true;
      window.dispatchEvent(new CustomEvent('db:bazares', { detail: bazares }));
    }
    if (_h(ajustes) !== _hAjustes) {
      _hAjustes = _h(ajustes); _ajustes = ajustes;
      window.dispatchEvent(new CustomEvent('db:ajustes', { detail: ajustes }));
    }
    if (_h(subastas) !== _hSubastas) {
      _hSubastas = _h(subastas); _subastas = subastas; _huboCambioEnPoll = true;
      window.dispatchEvent(new CustomEvent('db:subastas', { detail: subastas }));
    }
    if (_h(resenas) !== _hResenas) {
      _hResenas = _h(resenas); _resenas = resenas; _huboCambioEnPoll = true;
      window.dispatchEvent(new CustomEvent('db:resenas', { detail: resenas }));
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
// El panel necesita sentirse en vivo; la tienda no. Consultar cada 3 s por
// visitante es lo que tumba un sitio cuando entra mucha gente a la vez.
const POLL_RAPIDO = MODO_PUBLICO ?  20000 : 3000;
const POLL_NORMAL = MODO_PUBLICO ?  60000 : 6000;
const POLL_LENTO  = MODO_PUBLICO ? 300000 : 15000;
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
  if (!document.hidden) pollAhora(MODO_PUBLICO ? 1500 : 150);
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
  _hBazares = _h(_bazares);
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
  // Multi-bazar: un bazar solo manda SUS prendas. El servidor acota el borrado
  // al mismo bazar, así que las de los demás quedan intactas.
  const mio = miBazarId();
  const payload = (esAdminGlobal() || !mio)
    ? list
    : list.filter(p => Number(p.bazarId || 1) === Number(mio));
  // Devuelve la promesa: quien necesite saber que el servidor ya tiene la
  // prenda (por ejemplo, para configurarle una subasta) puede esperarla.
  return api('/api/inventario', { method: 'PUT', body: { list: payload, allowEmpty: true } })
    .catch(e => { console.error('[saveDB]', e); throw e; });
}
// ── Guardado por prenda ──────────────────────────────────────
// saveDB() manda el inventario ENTERO. Con muchas prendas eso choca con
// el límite de tamaño de Vercel, y si dos personas del mismo bazar
// guardan a la vez la última pisa lo que hizo la otra. Estas tres
// funciones mandan solo la prenda que cambió, así que ninguna de las dos
// cosas pasa. saveDB se queda para los casos raros de verdad.

// El servidor asigna el id: si lo eligiera el navegador, dos vendedores
// publicando a la vez se pisarían el número.
async function crearPrenda(datos) {
  const prenda = await api('/api/inventario-item', { method: 'POST', body: datos });
  const nueva = prenda.prenda || prenda;
  _marcarEscritura('inventario');
  _db = [nueva, ..._db];
  _hInv = _h(_db);
  _confirmarEscritura('inventario');
  window.dispatchEvent(new CustomEvent('db:inventario', { detail: _db }));
  return nueva;
}

async function guardarPrenda(id, cambios) {
  await api(`/api/inventario-item?id=${encodeURIComponent(id)}`, {
    method: 'PATCH', body: cambios,
  });
  _marcarEscritura('inventario');
  const i = _db.findIndex(p => Number(p.id) === Number(id));
  if (i >= 0) _db[i] = { ..._db[i], ...cambios };
  _hInv = _h(_db);
  _confirmarEscritura('inventario');
  window.dispatchEvent(new CustomEvent('db:inventario', { detail: _db }));
}

async function borrarPrendaServidor(id) {
  await api(`/api/inventario-item?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  _marcarEscritura('inventario');
  _db = _db.filter(p => Number(p.id) !== Number(id));
  _hInv = _h(_db);
  _confirmarEscritura('inventario');
  window.dispatchEvent(new CustomEvent('db:inventario', { detail: _db }));
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
//  IMÁGENES
// ═══════════════════════════════════════════════════════════
// Las fotos viven en Cloudinary, que puede entregarlas ya redimensionadas
// y en el formato que soporte el navegador. Pedir la miniatura de 400 px en
// vez de la foto original de 3 MB es la diferencia entre que la tienda
// cargue al instante o se arrastre en datos móviles.
// Cada teléfono pide el tamaño que le sirve. Sin esto, una pantalla de
// 400 px con densidad 3 recibe la misma imagen que un monitor: o se ve
// borrosa, o se gastan datos (y cuota de Cloudinary) de más.
//
// Se usa junto a src: <img src="..." srcset="${imgSrcSet(u, [400,600,900])}"
//                          sizes="(max-width: 700px) 50vw, 300px">
function imgSrcSet(url, anchos = [400, 600, 900]) {
  const u = String(url || '');
  if (!u.includes('/image/upload/')) return '';
  return anchos.map(a => `${imgOptimizada(u, a)} ${a}w`).join(', ');
}

function imgOptimizada(url, ancho = 600) {
  const u = String(url || '');
  if (!u.includes('/image/upload/')) return u;          // no es de Cloudinary
  if (/\/image\/upload\/[^/]*[wf]_/.test(u)) return u;  // ya trae transformación
  return u.replace('/image/upload/', `/image/upload/f_auto,q_auto,w_${ancho},c_limit/`);
}

// ═══════════════════════════════════════════════════════════
//  BAZARES (multi-tienda)
// ═══════════════════════════════════════════════════════════
const BAZAR_PRINCIPAL = 1;

function getBazares() { return _bazares; }

// Solo los que están activos (los que se muestran al público)
function getBazaresActivos() { return _bazares.filter(b => b.activo !== false); }

// Bazar dueño de una prenda. Las prendas viejas sin bazarId caen en el principal.
function bazarDe(p) {
  const id = Number(p?.bazarId || BAZAR_PRINCIPAL);
  return _bazares.find(b => Number(b.id) === id) || null;
}

function getBazarById(id) {
  return _bazares.find(b => Number(b.id) === Number(id)) || null;
}
function getBazarBySlug(slug) {
  const s = String(slug || '').toLowerCase().replace(/^@/, '');
  return _bazares.find(b => String(b.slug).toLowerCase() === s) || null;
}

// WhatsApp del bazar dueño (con fallback al número histórico del sitio)
const WA_FALLBACK = '528995284602';
function whatsappDe(p) {
  const b = bazarDe(p);
  return (b && b.whatsapp) ? String(b.whatsapp).replace(/[^0-9]/g, '') : WA_FALLBACK;
}

/* ── RESEÑAS ──────────────────────────────────────────────────
   Las reseñas que los compradores dejan a cada bazar. Llegan con el
   sync público, así que la tienda las pinta sin pedir nada extra. */
function getResenas()          { return _resenas; }
function resenasDeBazar(id)    { return _resenas.filter(r => Number(r.bazarId) === Number(id)); }

// Promedio en estrellas de un bazar: { promedio, total }
function ratingDeBazar(id) {
  const lista = resenasDeBazar(id).filter(r => Number(r.estrellas) > 0);
  if (!lista.length) return { promedio: 0, total: 0 };
  const suma = lista.reduce((s, r) => s + Number(r.estrellas), 0);
  return { promedio: Math.round((suma / lista.length) * 10) / 10, total: lista.length };
}

// Estrellas en texto para las tarjetas: ★★★★☆
function estrellasHTML(valor, clase = 'st-estrellas') {
  const v = Math.max(0, Math.min(5, Number(valor) || 0));
  let html = '';
  for (let i = 1; i <= 5; i++) {
    const estado = v >= i ? 'llena' : (v >= i - .5 ? 'media' : 'vacia');
    html += `<span class="st-estrella ${estado}">★</span>`;
  }
  return `<span class="${clase}" role="img" aria-label="${v} de 5 estrellas">${html}</span>`;
}

/* ── ESTADO DEL SITIO ─────────────────────────────────────────
   Qué partes están abiertas. Llega con el sync, así que las páginas
   públicas se enteran de un cierre en menos de un minuto sin recargar. */
function getAjustes() { return _ajustes; }

// ── SUBASTAS ────────────────────────────────────────────────
// El estado que llega con el sync sirve para pintar las tarjetas del
// catálogo. Para ofertar, la ficha pide el estado fresco al servidor:
// una oferta de hace quince segundos ya no dice cuánto hay que pujar.
function getSubastas() { return _subastas; }

function subastaDe(prendaId) {
  return _subastas.find(s => Number(s.prendaId) === Number(prendaId)) || null;
}

// ¿Sigue viva? El cierre por hora se calcula aquí para que la tarjeta
// no diga "quedan 3 minutos" cuando ya se acabó hace rato.
function subastaAbierta(s) {
  return !!s && !s.cerrada && new Date(s.fin).getTime() > Date.now();
}

// "2d 4h" · "3h 20m" · "14m" · "45s"
function tiempoRestante(fin) {
  let ms = new Date(fin).getTime() - Date.now();
  if (!(ms > 0)) return '';
  const d = Math.floor(ms / 86400000); ms -= d * 86400000;
  const h = Math.floor(ms / 3600000);  ms -= h * 3600000;
  const m = Math.floor(ms / 60000);    ms -= m * 60000;
  const sg = Math.floor(ms / 1000);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${String(sg).padStart(2, '0')}s`;
  return `${sg}s`;
}

// ¿Esta sección está cerrada ahora? Un cierre con hora de fin ya pasada
// se considera terminado: no hay que acordarse de reabrir.
function enMantenimiento(seccion) {
  const m = _ajustes?.mantenimiento?.[seccion];
  if (!m || !m.cerrado) return false;
  if (m.hasta && new Date(m.hasta).getTime() < Date.now()) return false;
  return true;
}
function mensajeMantenimiento(seccion) {
  return _ajustes?.mantenimiento?.[seccion]?.mensaje ||
         'Estamos haciendo mejoras. Volvemos en un rato.';
}

function saveBazares(list) {
  _bazares = list; _hBazares = _h(list);
  _marcarEscritura('bazares');
  return api('/api/config', { method: 'PUT', body: { col: 'bazares', list } });
}
function nextBazarId() {
  return _bazares.length ? Math.max(..._bazares.map(b => Number(b.id) || 0)) + 1 : 1;
}

// El bazar de la sesión actual (null = admin principal, ve todo)
function miBazarId() {
  const s = getSession();
  return s && s.bazarId != null ? Number(s.bazarId) : null;
}
function miBazar() {
  const id = miBazarId();
  return id ? getBazarById(id) : null;
}
// El admin principal no pertenece a ningún bazar: manda sobre todos.
function esAdminGlobal() {
  const s = getSession();
  return !!s && s.role === 'admin' && (s.bazarId == null);
}
// ¿Mi bazar tiene este permiso? El admin principal siempre puede.
function puedo(permiso) {
  if (esAdminGlobal()) return true;
  const b = miBazar();
  if (!b || b.activo === false) return false;
  const p = b.permisos || {};
  return p[permiso] === true;
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
    id: u.id, username: u.username, role: u.role, sessionToken: u.sessionToken,
    bazarId: u.bazarId != null ? Number(u.bazarId) : null
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
