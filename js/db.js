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
let _modo    = null;   // v39 · { multiBazar, principal } del paquete público
let _cats    = [];
let _brands  = [];
let _users   = [];
let _activos = [];
let _logs    = [];
let _drops   = [];
let _bazares = [];
let _resenas = [];        // reseñas públicas de los bazares
let _ajustes = null;      // qué partes del sitio están abiertas
let _tienda = null;       // promociones, info del negocio y próximos drops (tienda pública)
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
    const e = new Error(err.error || res.statusText);
    e.status = res.status; e.ruta = String(path).split('?op=')[1]?.split('&')[0] || String(path);
    e.datos = err;   // v33: el resto de la respuesta (requiereConfirmar, yaPagado, duplicado…)
    // Sesión del panel vencida: un solo aviso fijo con "Iniciar sesión"
    if (res.status === 401 && typeof Avisos === 'object' && document.body?.classList.contains('stmp-admin')) Avisos.sesionVencida();
    if (res.status >= 500 && typeof Avisos === 'object') Avisos.registrarError('servidor', e, { estado: res.status, ruta: e.ruta });
    throw e;
  }
  return res.json();
}

// ── Carga inicial ────────────────────────────────────────────
async function _loadAll() {
  try {
    const data = await api(RUTA_SYNC);
    _db      = data.inventario  || [];
    _agendarPagos();
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
    _tienda   = data.tienda     || null;
    _modo     = data.modo       || null;
    if (_modo?.multiBazar) document.documentElement.classList.add('multi-bazar');
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
// ¿El cliente cree ahora mismo que alguna parte está cerrada?
function _algoCerrado() {
  const m = _ajustes && _ajustes.mantenimiento;
  if (!m) return false;
  return Object.values(m).some(v =>
    v && v.cerrado && (!v.hasta || new Date(v.hasta).getTime() > Date.now()));
}

async function _poll() {
  try {
    // Regla clave: si el sitio (o una sección) se ve cerrado, la siguiente
    // consulta esquiva TODA caché —CDN incluido— con fresh=1 y un sello de
    // tiempo único. Así, en cuanto el admin reabre, la cortina se levanta a
    // la primera vuelta del poll sin depender de que expire el caché del CDN.
    // Solo pasa mientras hay cortina, así que no afecta el uso normal.
    let ruta = RUTA_SYNC;
    if (_algoCerrado()) ruta += (MODO_PUBLICO ? '&' : '?') + 'fresh=1&_=' + Date.now();
    const data = await api(ruta);

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
    if (data.tienda) _tienda = data.tienda;

    _vencerPagos(inv);
    if (!_escudoActivo('inventario') && _h(inv) !== _hInv) {
      _hInv = _h(inv); _db = inv; _huboCambioEnPoll = true;
      _agendarPagos();
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

// ── v36 · Apartadas mientras alguien paga en línea (10 min) ──────
// El servidor manda "pagandoHasta" (solo la hora, nunca quién). Al llegar a
// cero la prenda vuelve a verse libre aquí mismo, sin esperar al siguiente
// poll (el CDN puede tardar unos segundos), y se confirma con el servidor.
let _timerPagos = null;
function _vencerPagos(lista) {
  const ahora = Date.now(); let prox = Infinity;
  for (const p of lista || []) {
    if (!p || !p.pagandoHasta) continue;
    const t = Date.parse(p.pagandoHasta);
    if (!(t > ahora)) { p.apartada = false; delete p.pagandoHasta; }
    else prox = Math.min(prox, t);
  }
  return prox;
}
function _agendarPagos() {
  clearTimeout(_timerPagos);
  const prox = _vencerPagos(_db);
  if (prox === Infinity) return;
  _timerPagos = setTimeout(() => {
    _vencerPagos(_db); _hInv = _h(_db);
    window.dispatchEvent(new CustomEvent('db:inventario', { detail: _db }));
    _agendarPagos();
    if (typeof pollAhora === 'function') pollAhora(2500);
  }, Math.min(prox - Date.now() + 250, 2147483000));
}
// Segundos que le quedan al apartado de pago de una prenda (0 si no tiene)
function segundosApartado(p) {
  const t = p && p.pagandoHasta ? Date.parse(p.pagandoHasta) - Date.now() : 0;
  return t > 0 ? Math.ceil(t / 1000) : 0;
}

// ── v36 · Contadores en vivo ─────────────────────────────────
// <span data-cuenta="2026-11-18T14:30:00Z">9:41</span> se actualiza solo cada
// segundo (m:ss; con horas si falta mucho). Al llegar a cero pone el texto de
// data-cuenta-fin (si lo hay) y lanza el evento "cuenta:fin".
const Contador = (() => {
  const fmt = ms => {
    const s = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(s / 60);
    if (m >= 60) { const h = Math.floor(m / 60); return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h ${m % 60} min`; }
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  };
  const html = (iso, { fin = '', clase = '' } = {}) => {
    const ms = Date.parse(iso) - Date.now();
    return `<span class="cuenta${clase ? ' ' + clase : ''}${ms < 60000 ? ' cuenta-poca' : ''}" data-cuenta="${String(iso).replace(/"/g, '')}"${fin ? ` data-cuenta-fin="${String(fin).replace(/"/g, '&quot;')}"` : ''} role="timer" aria-live="off">${ms > 0 ? fmt(ms) : (fin || '0:00')}</span>`;
  };
  function tic() {
    const els = document.querySelectorAll('[data-cuenta]');
    if (!els.length) return;
    const ahora = Date.now();
    els.forEach(el => {
      const ms = Date.parse(el.dataset.cuenta) - ahora;
      if (ms > 0) {
        const t = fmt(ms); if (el.textContent !== t) el.textContent = t;
        el.classList.toggle('cuenta-poca', ms < 60000);
      } else if (!el.dataset.cuentaTermino) {
        el.dataset.cuentaTermino = '1';
        el.textContent = el.dataset.cuentaFin || '0:00';
        el.dispatchEvent(new CustomEvent('cuenta:fin', { bubbles: true }));
      }
    });
  }
  setInterval(tic, 1000);
  return { html, fmt, tic };
})();
window.Contador = Contador;
window.segundosApartado = segundosApartado;
function getTienda() { return _tienda; }
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
// v39 · { multiBazar, principal }: la página es solo de Stiimpys salvo MULTI_BAZAR=1 en el servidor
function getModo() { return _modo; }
window.getModo = getModo;

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
//  AVISOS — servicio único de notificaciones de todo el sitio
//
//  Compatibles con lo de antes:
//    toast('Guardado')                     → el tipo se deduce del texto
//    toast('No se pudo', 'error')          → ok · error · alerta · info · cargando
//    toast('Hecho', 6000)                  → duración en ms
//  Con opciones:
//    toast('Prenda eliminada', { tipo: 'ok', origen: 'productos', deshacer: fn })
//    Avisos.mostrar(texto, { tipo, titulo, cuerpo, dur, fijo, critico, clave,
//      grupo, plural, item, detalles, acciones: [{ texto, al, principal }],
//      deshacer, reintentar, reconectar, ir: { texto, url | tab, vista, sec, pedido },
//      origen, importante, historial })  → { id, actualizar, resolver, cerrar }
//    Avisos.operacion(fn, { cargando, ok, error, origen })   → spinner → listo/error + Reintentar
//    Avisos.lote({ clave, origen, total, ... })               → "5 fotografías subidas correctamente"
//    Avisos.copiar(texto, { que: 'Link' })
//    Avisos.resolver(clave)          → quita un error fijo cuando ya se arregló
//    Avisos.configurar({ max, duracion: { ok, info, alerta, error } })
//    Avisos.registrarError(origen, error, extra)
//  El historial (campana) lo pinta js/avisos-centro.js con Avisos.historial().
// ═══════════════════════════════════════════════════════════
const Avisos = (() => {
  const TIPOS = ['ok', 'error', 'alerta', 'info', 'cargando'];
  const CFG = { max: 3, duracion: { ok: 4000, info: 4600, alerta: 6000, error: 8000 }, historial: 150, errores: 60 };
  const NOMBRE_TIPO = { ok: 'Éxito', error: 'Error', alerta: 'Advertencia', info: 'Información', cargando: 'En proceso' };
  const NOMBRE_ORIGEN = { fotos: 'Fotos', instagram: 'Instagram', sesion: 'Cuenta', wishlist: 'Carrito', enlaces: 'Enlaces',
    automatico: 'Automático', productos: 'Productos', pedidos: 'Pedidos', red: 'Conexión', pagina: 'Página', general: 'General' };
  const SVG = {
    ok: '<path d="M20 6 9 17l-5-5"/>',
    error: '<path d="M12 8v5"/><path d="M12 16.5h.01"/><circle cx="12" cy="12" r="9"/>',
    alerta: '<path d="M10.3 3.9 2.4 17.6a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v3.5"/><path d="M12 16.5h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6h.01"/>',
    corazon: '<path d="M19.5 12.6 12 20l-7.5-7.4A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 7.5 6Z"/>',
    carrito: '<path d="M3 4h2.4l2.2 10.3a1.7 1.7 0 0 0 1.7 1.3h8.1a1.7 1.7 0 0 0 1.6-1.2L21 8H6.2"/><circle cx="9.6" cy="19.6" r="1.3"/><circle cx="17.2" cy="19.6" r="1.3"/>',
    instagram: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17 7h.01"/>',
    imagen: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5L5 20"/>',
    enlace: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    sinred: '<path d="M2 8.8a15 15 0 0 1 4.2-2.6"/><path d="M10.7 5.1A15 15 0 0 1 22 8.8"/><path d="M5 12.5a10 10 0 0 1 5.2-2.7"/><path d="M15.5 10.4a10 10 0 0 1 3.5 2.1"/><path d="M8.5 16a5 5 0 0 1 7 0"/><path d="M12 20h.01"/><path d="m2 2 20 20"/>',
    cerrar: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
    abajo: '<path d="m6 9 6 6 6-6"/>',
  };
  const svg = (k, tam = 18, clase = '') => `<svg viewBox="0 0 24 24" width="${tam}" height="${tam}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${clase ? ` class="${clase}"` : ''}>${SVG[k] || SVG.info}</svg>`;
  const ADORNO = /^[\s☀-➿⬀-⯿\u{1F000}-\u{1FAFF}️‍✓✔✗✘×•·→]+|[\s☀-➿⬀-⯿\u{1F000}-\u{1FAFF}️‍✓✔✗✘•]+$/gu;
  const PASOS_IG = ['Abre el Graph API Explorer de Meta y genera un token nuevo para tu cuenta de Instagram.',
    'En el Access Token Debugger toca "Extend Access Token" para que dure 60 días.',
    'Pégalo en Vercel → Settings → Environment Variables → IG_STIIMPYS_TOKEN y dale Redeploy.'];

  // ── Deducir tipo y origen del texto (para las llamadas de siempre) ──
  function tipoDe(crudo) {
    const ini = String(crudo || '').trim();
    if (/^(❌|✗|✘|⛔|🚫)/u.test(ini)) return 'error';
    if (/^⚠/u.test(ini)) return 'alerta';
    if (/^(✅|✓|✔|🎉|🙌)/u.test(ini)) return 'ok';
    const t = ini.replace(ADORNO, '').toLowerCase();
    if (/^(subiendo|publicando|revisando|guardando|generando|importando|cargando|procesando|enviando|borrando|preparando|buscando|actualizando|descargando|creando|conectando|analizando|leyendo|optimizando|comprimiendo|republicando|quitando|aplicando|calculando)\b/.test(t) && /(…|\.\.\.)/.test(t)) return 'cargando';
    if (/(^error|error |no se pudo|no pude|falló|no se encontr|no encontrad|inválid|invalid|incorrect|no coincide|no tiene permitido|no se puede|expiró|venció el token|rechaz|no autenticado)/.test(t)) return 'error';
    if (/^(escribe|elige|toma |agrega|selecciona|pon |ya existe|ya llegaste|solo |sin permiso|termina primero|tienes |se omiten|todas las seleccionadas|tu navegador|espera|tu cuenta inició|primero )|obligatori|debe ser|mínimo|máximo|límite|^ojo|requiere permisos/.test(t)) return 'alerta';
    if (/^¡|^(listo|hecho|gracias|todo bien|valoraste|respuesta publicada|subasta abierta)|(guardad|publicad|actualizad|copiad|cread|agregad|añadid|eliminad|borrad|subid|enviad|completad|programad|restablecid|importad|descargad|vendid|apartad|activad|marcad|aceptad|repartid|quitad|restaurad|reactivad)[oa]s?\b/.test(t)) return 'ok';
    return 'info';
  }
  function origenDe(t) {
    t = String(t || '').toLowerCase();
    if (/instagram|reel|historia|post\b|posts\b|publicaci/.test(t)) return 'instagram';
    if (/wishlist|favorit|carrito/.test(t)) return 'wishlist';
    if (/\blink|enlace|copiad/.test(t)) return 'enlaces';
    if (/automático/.test(t)) return 'automatico';
    if (/foto|imagen|logo|banner/.test(t)) return 'fotos';
    if (/pedido|pago|venta|vendid|cobr|entregad|enviad/.test(t)) return 'pedidos';
    if (/prenda|producto|categor|marca|drop|subasta/.test(t)) return 'productos';
    if (/sesión|contraseña|cuenta|autentic/.test(t)) return 'sesion';
    return 'general';
  }
  function iconoDe(v) {
    if (v.tipo === 'cargando') return null;
    const t = v.titulo + ' ' + v.cuerpo;
    if (v.origen === 'wishlist') return { k: 'carrito', color: /(eliminad|quitad|vendió|apartada)/i.test(t) ? '' : '#2d6be4' };
    if (v.origen === 'red' && v.tipo !== 'ok') return { k: 'sinred' };
    if (v.tipo === 'ok' && v.origen === 'instagram') return { k: 'instagram' };
    if (v.tipo === 'ok' && v.origen === 'fotos' && v.cuenta > 1) return { k: 'imagen' };
    if (v.tipo === 'ok' && v.origen === 'enlaces') return { k: 'enlace' };
    return { k: v.tipo };
  }
  function partir(texto) {
    const i = texto.indexOf(': ');
    if (i > 2 && i <= 34 && texto.length - i > 3 && !/\$\s*$/.test(texto.slice(0, i))) {
      const cuerpo = texto.slice(i + 2).trim();
      return { titulo: texto.slice(0, i).trim(), cuerpo: cuerpo.charAt(0).toUpperCase() + cuerpo.slice(1) };
    }
    return { titulo: texto, cuerpo: '' };
  }

  // ── Acciones que otros módulos registran (p. ej. reconectar Instagram, iniciar sesión) ──
  const registro = {};
  let navegador = null;
  const registrarAccion = (nombre, accion) => { registro[nombre] = accion; };
  const alIr = fn => { navegador = fn; };
  function ir(destino) {
    if (!destino) return;
    if (navegador && navegador(destino) !== false) return;
    if (destino.url) { if (destino.nueva) window.open(destino.url, '_blank', 'noopener'); else location.href = destino.url; }
  }
  const accionSesion = () => registro.sesion || (document.body?.classList.contains('stmp-admin') ? { texto: 'Iniciar sesión', principal: true,
    al: () => { location.href = typeof rutaDeAcceso === 'function' ? rutaDeAcceso() : 'login.html'; } } : null);

  // Mensajes conocidos que merecen un trato especial, vengan de donde vengan
  const PATRONES = [
    { re: /no autenticado|tu sesión (venció|expiró|terminó)/i, o: () => ({ tipo: 'error', critico: true, clave: 'sesion', origen: 'sesion',
        titulo: 'Tu sesión terminó', cuerpo: 'Vuelve a iniciar sesión para seguir guardando cambios.', acciones: [accionSesion()].filter(Boolean) }) },
    { re: /inició sesión en otro dispositivo/i, o: () => ({ tipo: 'alerta', critico: true, clave: 'sesion', origen: 'sesion',
        titulo: 'Tu cuenta se abrió en otro dispositivo', cuerpo: 'Por seguridad cerramos esta sesión.', acciones: [accionSesion()].filter(Boolean) }) },
    { re: /(access token|oauth|error validating|\(#190\)|code 190|token de instagram|session has expired|sesión de instagram|token (venció|expiró|caducó|ya no es válido|inválido))/i, o: t => ({ tipo: 'error', critico: true, clave: 'ig-token', origen: 'instagram',
        titulo: 'Instagram necesita reconectarse', cuerpo: t.length < 140 ? t : 'El token de Instagram ya no es válido.', detalles: PASOS_IG,
        acciones: registro.instagram ? [{ ...registro.instagram, principal: true }] : [] }) },
    { re: /(failed to fetch|networkerror|load failed|network request failed)/i, o: t => ({ tipo: 'error', origen: 'red',
        titulo: 'No hubo conexión con el servidor', cuerpo: 'Revisa tu internet e inténtalo otra vez.', detalles: [t] }) },
  ];

  // ── Estado ──
  let pila, cuentaCola, estiloListo = false, seq = 0, pendientes = 0;
  const visibles = [], cola = [];
  const accionesVivas = new Map();          // id del historial → acciones (solo mientras la página está abierta)
  const movil = () => matchMedia('(max-width: 640px)').matches;
  const sinMovimiento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const vivos = () => [...visibles, ...cola];

  // ── Historial (campana) y registro de errores ──
  const claveHist = () => 'stmp-avisos:' + ((typeof getSession === 'function' && getSession()?.username) || 'tienda');
  const leer = k => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
  let hist = null, guardarT;
  const historial = () => (hist ??= leer(claveHist()));
  function guardarHist() {
    clearTimeout(guardarT);
    guardarT = setTimeout(() => { try { localStorage.setItem(claveHist(), JSON.stringify(historial().slice(0, CFG.historial))); } catch {} }, 250);
    window.dispatchEvent(new CustomEvent('avisos:cambio'));
  }
  function anotar(v) {
    // Solo el panel tiene campana: en la tienda no se guarda historial
    if (v.historial === false || v.tipo === 'cargando' || !document.body?.classList.contains('stmp-admin')) return;
    const h = historial();
    let e = h.find(x => x.id === v.hid);
    if (!e) { e = { id: v.hid = 'a' + Date.now().toString(36) + (seq++).toString(36) }; h.unshift(e); }
    Object.assign(e, { tipo: v.tipo, titulo: v.titulo, cuerpo: v.cuerpo, origen: v.origen, cuenta: v.cuenta,
      detalles: (v.detalles || []).slice(0, 40), en: new Date().toISOString(), critico: !!v.critico,
      leido: !(v.importante || v.critico || v.tipo === 'error'),
      ir: v.ir ? { texto: v.ir.texto || 'Abrir', url: v.ir.url, nueva: !!v.ir.nueva, prenda: v.ir.prenda, tab: v.ir.tab, vista: v.ir.vista, sec: v.ir.sec, pedido: v.ir.pedido, filtro: v.ir.filtro } : null });
    const acc = (v.acciones || []).filter(a => a.al && !/deshacer/i.test(a.texto));
    if (acc.length) accionesVivas.set(e.id, acc); else accionesVivas.delete(e.id);
    if (h.length > CFG.historial) h.length = CFG.historial;
    guardarHist();
  }
  const marcarLeida = (id, si = true) => { const e = historial().find(x => x.id === id); if (e && e.leido !== si) { e.leido = si; guardarHist(); } };
  const marcarTodas = () => { historial().forEach(e => { e.leido = true; }); guardarHist(); };
  const limpiar = () => { hist = []; accionesVivas.clear(); guardarHist(); };
  const noLeidas = () => historial().filter(e => !e.leido).length;
  function ejecutar(id) {
    const e = historial().find(x => x.id === id); if (!e) return false;
    marcarLeida(id);
    const acc = accionesVivas.get(id);
    if (acc?.length) { try { acc[0].al(); } catch (err) { registrarError('avisos', err); } return true; }
    if (e.ir) { ir(e.ir); return true; }
    return false;
  }
  const accionDe = id => { const a = accionesVivas.get(id)?.[0]; const e = historial().find(x => x.id === id); return a ? a.texto : e?.ir ? e.ir.texto : ''; };

  // Errores: consola + este navegador + servidor (solo con sesión del panel)
  const CLAVE_ERR = 'stmp-avisos-errores';
  let envio = [], envioT, enviadosMin = 0, minuto = 0;
  function registrarError(origen, error, extra = {}) {
    const mensaje = String(error?.message || error || 'Error desconocido').slice(0, 400);
    const e = { en: new Date().toISOString(), origen: origen || 'general', mensaje, pagina: location.pathname + location.hash,
      pila: String(error?.stack || '').split('\n').slice(0, 5).join('\n').slice(0, 900), ...extra };
    try { console.error(`[avisos:${e.origen}]`, error); } catch {}
    try { const l = leer(CLAVE_ERR); l.unshift(e); localStorage.setItem(CLAVE_ERR, JSON.stringify(l.slice(0, CFG.errores))); } catch {}
    const s = typeof getSession === 'function' ? getSession() : null;
    if (s && typeof api === 'function' && extra.servidor !== false) {
      const m = Math.floor(Date.now() / 6e4); if (m !== minuto) { minuto = m; enviadosMin = 0; }
      if (enviadosMin++ < 10) { envio.push(e); clearTimeout(envioT); envioT = setTimeout(enviarErrores, 2500); }
    }
    return e;
  }
  function enviarErrores() {
    const lote = envio.splice(0, 20); if (!lote.length) return;
    fetch('/api/acciones?op=v-error-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ errores: lote }), keepalive: true }).catch(() => {});
  }
  const errores = () => leer(CLAVE_ERR);

  // ── Estilos (se inyectan una vez; así sirven en todas las páginas) ──
  function estilos() {
    if (estiloListo) return; estiloListo = true;
    const s = document.createElement('style'); s.id = 'avisosEstilo';
    s.textContent = `
.stmp-avisos{position:fixed;z-index:10050;right:20px;bottom:20px;display:flex;flex-direction:column;align-items:stretch;gap:10px;width:min(392px,calc(100vw - 24px));pointer-events:none;font-family:'DM Sans',system-ui,-apple-system,sans-serif}
.stmp-aviso{--c:#86a8ff;position:relative;display:grid;grid-template-columns:34px minmax(0,1fr) 34px;align-items:start;column-gap:12px;padding:14px;border-radius:16px;background:#1a1f2e;color:#fff;box-shadow:0 20px 44px -16px rgba(8,12,22,.62),0 2px 8px rgba(8,12,22,.18),inset 0 0 0 1px rgba(255,255,255,.07);pointer-events:auto;overflow:hidden;opacity:0;transform:translateY(12px) scale(.98);transition:opacity .24s ease,transform .36s cubic-bezier(.2,.9,.25,1.08);touch-action:pan-y}
.stmp-aviso.stmp-ver{opacity:1;transform:none}
.stmp-aviso.stmp-sale{opacity:0;transform:translateX(28px) scale(.98);transition:opacity .2s ease,transform .24s ease}
.stmp-aviso[data-tipo="ok"]{--c:#3fd07f}.stmp-aviso[data-tipo="error"]{--c:#ff6f6f}.stmp-aviso[data-tipo="alerta"]{--c:#f6c453}.stmp-aviso[data-tipo="info"]{--c:#86a8ff}.stmp-aviso[data-tipo="cargando"]{--c:#c9d3ea}
.stmp-aviso.stmp-critico{box-shadow:0 20px 44px -16px rgba(8,12,22,.62),inset 0 0 0 1px rgba(255,111,111,.45)}
.stmp-aviso-ic{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;color:var(--c);background:rgba(255,255,255,.08);background:color-mix(in srgb,var(--c) 15%,transparent)}
.stmp-aviso-ic svg.stmp-lleno{fill:currentColor}
.stmp-aviso-giro{width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.2);border-top-color:#fff;animation:stmp-aviso-giro .8s linear infinite}
@keyframes stmp-aviso-giro{to{transform:rotate(360deg)}}
.stmp-aviso-tx{min-width:0;min-height:34px;display:flex;flex-direction:column;justify-content:center}
.stmp-aviso-tit{display:block;font-size:14px;line-height:1.35;font-weight:600;letter-spacing:-.005em;overflow-wrap:anywhere}
.stmp-aviso-cuerpo{display:block;margin-top:3px;font-size:13px;line-height:1.45;color:rgba(255,255,255,.72);overflow-wrap:anywhere}
.stmp-aviso-n{display:inline-block;margin-left:7px;padding:1px 7px;border-radius:999px;background:rgba(255,255,255,.12);font-size:11px;font-weight:600;color:rgba(255,255,255,.88);vertical-align:1px}
.stmp-aviso-det{grid-column:2/4;margin:12px 0 0;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.06);max-height:150px;overflow:auto;font-size:12.5px;line-height:1.5;color:rgba(255,255,255,.8);list-style:none}
.stmp-aviso-det[hidden]{display:none}.stmp-aviso-det li+li{margin-top:3px}
.stmp-aviso-det li::before{content:'';display:inline-block;width:4px;height:4px;margin:0 8px 2px 0;border-radius:50%;background:var(--c);vertical-align:middle}
.stmp-aviso-acc{grid-column:2/4;display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.stmp-aviso-btn{display:inline-flex;align-items:center;gap:5px;min-height:32px;border:0;background:rgba(255,255,255,.1);color:#fff;font:600 12.5px/1 'DM Sans',system-ui,sans-serif;padding:8px 12px;border-radius:9px;cursor:pointer;white-space:nowrap}
.stmp-aviso-btn:hover{background:rgba(255,255,255,.17)}
.stmp-aviso-btn.stmp-principal{background:var(--c);color:#141824}
.stmp-aviso-btn.stmp-principal:hover{filter:brightness(1.08)}
.stmp-aviso-btn svg{transition:transform .2s}
.stmp-aviso-btn[aria-expanded="true"] svg{transform:rotate(180deg)}
.stmp-aviso-x{border:0;background:none;color:rgba(255,255,255,.5);width:34px;height:34px;border-radius:11px;display:grid;place-items:center;cursor:pointer}
.stmp-aviso-x:hover{color:#fff;background:rgba(255,255,255,.08)}
.stmp-aviso-btn:focus-visible,.stmp-aviso-x:focus-visible{outline:2px solid #86a8ff;outline-offset:2px}
.stmp-aviso-barra{position:absolute;left:0;right:0;bottom:0;height:3px;background:var(--c);opacity:.7;transform-origin:left;animation:stmp-aviso-barra linear forwards}
.stmp-aviso-barra.stmp-avance{animation:none;transition:transform .3s ease}
.stmp-aviso:hover .stmp-aviso-barra,.stmp-aviso:focus-within .stmp-aviso-barra,.stmp-aviso.stmp-pausa .stmp-aviso-barra{animation-play-state:paused}
@keyframes stmp-aviso-barra{from{transform:scaleX(1)}to{transform:scaleX(0)}}
.stmp-avisos-cola{align-self:center;pointer-events:auto;border:0;padding:6px 12px;border-radius:999px;background:#1a1f2e;color:rgba(255,255,255,.85);font:600 12px 'DM Sans',system-ui,sans-serif;box-shadow:0 8px 20px -10px rgba(8,12,22,.6);cursor:default}
.stmp-avisos-cola[hidden]{display:none}
@media (max-width:640px){
  .stmp-avisos{left:10px;right:10px;top:calc(env(safe-area-inset-top,0px) + 10px);bottom:auto;width:auto;flex-direction:column-reverse}
  .stmp-aviso{padding:12px;column-gap:10px;transform:translateY(-12px) scale(.98)}
  .stmp-aviso.stmp-sale{transform:translateY(-12px)}
}
@media (prefers-reduced-motion:reduce){
  .stmp-aviso,.stmp-aviso.stmp-sale{transform:none!important;transition:opacity .15s linear}
  .stmp-aviso-giro{animation-duration:2s}
}
#toast.toast{display:none!important}`;
    document.head.appendChild(s);
  }
  function asegurarPila() {
    estilos();
    if (pila && document.body.contains(pila)) return pila;
    pila = document.createElement('section');
    pila.className = 'stmp-avisos'; pila.setAttribute('aria-label', 'Notificaciones');
    cuentaCola = document.createElement('div'); cuentaCola.className = 'stmp-avisos-cola'; cuentaCola.hidden = true;
    cuentaCola.setAttribute('aria-live', 'polite');
    pila.appendChild(cuentaCola);
    document.body.appendChild(pila);
    return pila;
  }
  function pintarCola() {
    if (!cuentaCola) return;
    cuentaCola.hidden = !cola.length;
    cuentaCola.textContent = cola.length === 1 ? '1 aviso más en espera' : `${cola.length} avisos más en espera`;
  }

  // ── Opciones y datos de cada aviso ──
  function opciones(a, b) {
    const o = {};
    for (const x of [a, b]) {
      if (typeof x === 'number') o.dur = x;
      else if (typeof x === 'string' && TIPOS.includes(x)) o.tipo = x;
      else if (x === 'warn' || x === 'warning') o.tipo = 'alerta';
      else if (x === 'success') o.tipo = 'ok';
      else if (x && typeof x === 'object') Object.assign(o, x);
    }
    return o;
  }
  function preparar(msg, o) {
    const crudo = String(msg?.message ?? msg ?? '').trim();
    const limpio = crudo.replace(ADORNO, '').trim() || crudo;
    const patron = PATRONES.find(p => p.re.test(limpio));
    if (patron && !o.sinPatron) {
      const extra = patron.o(limpio);
      o = { ...extra, ...o, acciones: [...(extra.acciones || []), ...(o.acciones || [])] };
      if (!('titulo' in o)) o.titulo = extra.titulo;
    }
    const tipo = o.tipo || tipoDe(crudo);
    let titulo, cuerpo;
    if (o.titulo) { titulo = o.titulo; cuerpo = o.cuerpo ?? (o.titulo === limpio ? '' : limpio); }
    else ({ titulo, cuerpo } = partir(limpio));
    if (o.cuerpo != null && !o.titulo) cuerpo = o.cuerpo;
    const acciones = [];
    if (o.accion) acciones.push(o.accion);
    if (o.reintentar) acciones.push({ texto: 'Reintentar', al: o.reintentar, principal: true });
    if (o.reconectar) acciones.push({ texto: 'Reconectar cuenta', al: o.reconectar, principal: true });
    if (o.deshacer) acciones.push({ texto: 'Deshacer', al: o.deshacer });
    acciones.push(...(o.acciones || []));
    if (o.ir) acciones.push({ texto: o.ir.texto || 'Abrir', al: () => ir(o.ir) });
    const critico = !!o.critico;
    let detalles = o.detalles == null ? [] : Array.isArray(o.detalles) ? o.detalles.map(String) : [String(o.detalles)];
    if (o.item != null) detalles = [String(o.item), ...detalles];
    return { tipo, titulo, cuerpo, critico, fijo: critico || !!o.fijo || (tipo === 'cargando' && !!o.clave),
      clave: o.clave || null, grupo: o.grupo || null, plural: o.plural || null, detalles,
      acciones: acciones.filter((a, i, l) => a && a.texto && l.findIndex(x => x.texto === a.texto) === i).slice(0, 3),
      ir: o.ir || null, origen: o.origen || origenDe(titulo + ' ' + cuerpo),
      importante: !!o.importante, historial: o.historial, dur: o.dur, legado: !o.clave && !o.grupo, log: o.log };
  }
  function duracion(v) {
    if (v.fijo) return 0;
    if (v.tipo === 'cargando') return 20000;
    const base = CFG.duracion[v.tipo] || 4500;
    const largo = (v.titulo + v.cuerpo).length;
    const extra = Math.max(0, largo - 60) * 45 + (v.acciones.length ? 2500 : 0);
    return Math.min(16000, Math.max(v.dur || 0, base + extra));
  }

  // ── Pintar ──
  function pintar(v) {
    const el = v.el;
    el.className = 'stmp-aviso' + (v.mostrado ? ' stmp-ver' : '') + (v.critico ? ' stmp-critico' : '');
    el.dataset.tipo = v.tipo;
    el.setAttribute('role', v.tipo === 'error' ? 'alert' : 'status');
    const ic = iconoDe(v);
    el.style.setProperty('--c', ic?.color || '');
    const detalles = v.detalles.length > 0;
    const titulo = v.cuenta > 1 && v.plural ? v.plural(v.cuenta) : v.titulo;
    el.innerHTML = `<span class="stmp-aviso-ic">${ic ? svg(ic.k, 18, ic.lleno ? 'stmp-lleno' : '') : '<span class="stmp-aviso-giro"></span>'}</span>
      <div class="stmp-aviso-tx"><span class="stmp-aviso-tit"></span>${v.cuerpo ? '<span class="stmp-aviso-cuerpo"></span>' : ''}</div>
      <button type="button" class="stmp-aviso-x" aria-label="Cerrar notificación">${svg('cerrar', 16)}</button>
      ${detalles ? `<ul class="stmp-aviso-det" id="${v.id}-det"${v.abierto ? '' : ' hidden'}></ul>` : ''}
      ${v.acciones.length || detalles ? '<div class="stmp-aviso-acc"></div>' : ''}
      ${v.tipo === 'cargando' ? (v.avance != null ? `<i class="stmp-aviso-barra stmp-avance" style="transform:scaleX(${v.avance})"></i>` : '')
        : v.ms ? `<i class="stmp-aviso-barra" style="animation-duration:${v.ms}ms"></i>` : ''}`;
    const t = el.querySelector('.stmp-aviso-tit'); t.textContent = titulo;
    if (v.cuenta > 1 && !v.plural) { const n = document.createElement('span'); n.className = 'stmp-aviso-n'; n.textContent = '×' + v.cuenta; t.appendChild(n); }
    if (v.cuerpo) el.querySelector('.stmp-aviso-cuerpo').textContent = v.cuerpo;
    if (detalles) {
      const ul = el.querySelector('.stmp-aviso-det'), max = 12;
      v.detalles.slice(0, max).forEach(d => { const li = document.createElement('li'); li.textContent = d; ul.appendChild(li); });
      if (v.detalles.length > max) { const li = document.createElement('li'); li.textContent = `y ${v.detalles.length - max} más`; ul.appendChild(li); }
    }
    const caja = el.querySelector('.stmp-aviso-acc');
    v.acciones.forEach(a => {
      const b = document.createElement('button'); b.type = 'button';
      b.className = 'stmp-aviso-btn' + (a.principal ? ' stmp-principal' : ''); b.textContent = a.texto;
      b.onclick = () => {
        let siguePorAhi = false;
        try { siguePorAhi = a.al() === 'mantener'; } catch (err) { registrarError('avisos', err); }
        if (!siguePorAhi) quitar(v, true);
      };
      caja.appendChild(b);
    });
    if (detalles) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'stmp-aviso-btn';
      b.setAttribute('aria-expanded', String(!!v.abierto)); b.setAttribute('aria-controls', v.id + '-det');
      b.innerHTML = `${v.abierto ? 'Ocultar detalles' : 'Ver detalles'} ${svg('abajo', 14)}`;
      b.onclick = () => { v.abierto = !v.abierto; if (v.abierto) pausar(v); pintar(v); el.querySelector('.stmp-aviso-btn[aria-controls]')?.focus(); };
      caja.appendChild(b);
    }
    el.querySelector('.stmp-aviso-x').onclick = () => quitar(v, true);
  }

  // ── Tiempos ──
  function programar(v) {
    clearTimeout(v.timer);
    v.ms = duracion(v); v.pausado = false;
    if (!v.ms) return;
    v.restante = v.ms; v.desde = Date.now();
    v.timer = setTimeout(() => quitar(v), v.restante);
  }
  function pausar(v) {
    if (v.pausado || !v.ms || !v.timer) return;
    v.pausado = true; clearTimeout(v.timer); v.restante -= Date.now() - v.desde; v.el.classList.add('stmp-pausa');
  }
  function seguir(v) {
    if (!v.pausado || v.abierto) return;
    v.pausado = false; v.desde = Date.now(); v.el.classList.remove('stmp-pausa');
    v.timer = setTimeout(() => quitar(v), Math.max(1200, v.restante));
  }

  // ── Mostrar, cola y salida ──
  function entrar(v) {
    asegurarPila();
    visibles.push(v);
    pila.insertBefore(v.el, cuentaCola);
    if (!v.enlazado) enlazar(v);
    pintar(v);
    requestAnimationFrame(() => requestAnimationFrame(() => { v.mostrado = true; v.el.classList.add('stmp-ver'); }));
    programar(v);
    pintarCola();
  }
  function enlazar(v) {
    v.enlazado = true;
    v.el.addEventListener('mouseenter', () => pausar(v));
    v.el.addEventListener('mouseleave', () => seguir(v));
    v.el.addEventListener('focusin', () => pausar(v));
    v.el.addEventListener('focusout', e => { if (!v.el.contains(e.relatedTarget)) seguir(v); });
    v.el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); quitar(v, true); } });
    deslizar(v);
  }
  function quitar(v, porUsuario = false) {
    if (v.fuera) return; v.fuera = true; clearTimeout(v.timer);
    const enCola = cola.indexOf(v); if (enCola >= 0) { cola.splice(enCola, 1); pintarCola(); return; }
    const i = visibles.indexOf(v); if (i >= 0) visibles.splice(i, 1);
    if (porUsuario && v.hid) marcarLeida(v.hid);
    v.el.classList.add('stmp-sale'); v.el.classList.remove('stmp-ver');
    setTimeout(() => { v.el.remove(); siguiente(); }, sinMovimiento() ? 160 : 260);
  }
  function siguiente() {
    while (visibles.length < CFG.max && cola.length) entrar(cola.shift());
    pintarCola();
  }
  function encolar(v) {
    if (visibles.length < CFG.max) return entrar(v);
    if (v.critico) {
      // Un error crítico no espera: el aviso más viejo que no es crítico regresa a la fila
      const j = visibles.findIndex(x => !x.critico && x.tipo !== 'cargando');
      if (j >= 0) {
        const x = visibles.splice(j, 1)[0];
        clearTimeout(x.timer); x.el.remove(); x.mostrado = false; cola.unshift(x);
        return entrar(v);
      }
    }
    cola.push(v); pintarCola();
  }
  function deslizar(v) {
    let x0 = null, dx = 0;
    v.el.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' || e.target.closest('button')) return; x0 = e.clientX; dx = 0; pausar(v); });
    v.el.addEventListener('pointermove', e => { if (x0 === null) return; dx = e.clientX - x0; v.el.style.transition = 'none'; v.el.style.transform = `translateX(${dx}px)`; v.el.style.opacity = String(Math.max(.2, 1 - Math.abs(dx) / 220)); });
    const fin = () => { if (x0 === null) return; x0 = null; v.el.style.transition = ''; if (Math.abs(dx) > 70) { v.el.style.transform = `translateX(${dx > 0 ? 420 : -420}px)`; v.el.style.opacity = '0'; quitar(v, true); } else { v.el.style.transform = ''; v.el.style.opacity = ''; seguir(v); } };
    v.el.addEventListener('pointerup', fin); v.el.addEventListener('pointercancel', fin);
  }
  function asa(v) {
    return {
      id: v.id,
      get abierto() { return !v.fuera; },
      actualizar(m, o = {}) { if (v.fuera) return this; aplicar(v, m, o); return this; },
      resolver(m, o = {}) { if (v.fuera) return mostrar(m, o); aplicar(v, m, { ...o, clave: o.clave ?? null, fijo: o.fijo ?? false }); return this; },
      avance(p) { v.avance = Math.max(0, Math.min(1, p)); const b = v.el.querySelector('.stmp-aviso-barra'); if (b) b.style.transform = `scaleX(${v.avance})`; else if (v.mostrado) pintar(v); return this; },
      cerrar() { quitar(v); },
    };
  }
  function aplicar(v, m, o) {
    const d = preparar(m ?? v.titulo, { ...o, tipo: o.tipo || (m == null ? v.tipo : undefined) });
    if (m == null) { d.titulo = v.titulo; d.cuerpo = o.cuerpo ?? v.cuerpo; }
    Object.assign(v, d, { cuenta: o.cuenta ?? v.cuenta, avance: d.tipo === 'cargando' ? v.avance : null });
    if (v.mostrado || visibles.includes(v)) { pintar(v); programar(v); }
    anotar(v);
  }

  function mostrar(msg, a, b) {
    if (typeof document === 'undefined') return null;
    const o = opciones(a, b);
    const d = preparar(msg, o);
    if (!d.titulo) return null;
    if (d.tipo === 'error' && d.log !== false) registrarError(d.origen, (msg && msg.stack) ? msg : (d.titulo + (d.cuerpo ? ': ' + d.cuerpo : '')), { servidor: d.origen !== 'red' });
    if (!document.body) {
      let real = null; document.addEventListener('DOMContentLoaded', () => { real = mostrar(msg, a, b); }, { once: true });
      return { id: null, get abierto() { return !!real?.abierto; }, actualizar(m, x) { real?.actualizar(m, x); return this; },
        resolver: (m, x) => real ? real.resolver(m, x) : mostrar(m, x), avance(p) { real?.avance(p); return this; }, cerrar() { real?.cerrar(); } };
    }

    // 1) Misma clave: se actualiza el que ya existe
    let v = d.clave && vivos().find(x => !x.fuera && x.clave === d.clave);
    // 2) Mismo grupo: se suma al conteo y a los detalles
    if (!v && d.grupo) v = vivos().find(x => !x.fuera && x.grupo === d.grupo);
    if (v && (d.clave || d.grupo)) {
      const sumar = !!d.grupo && v.grupo === d.grupo;
      const detalles = sumar ? [...d.detalles, ...v.detalles] : d.detalles.length ? d.detalles : v.detalles;
      Object.assign(v, d, { cuenta: sumar ? v.cuenta + 1 : v.cuenta, detalles, hid: v.hid });
      if (visibles.includes(v)) { pintar(v); programar(v); }
      anotar(v);
      return asa(v);
    }
    // 3) Repetido idéntico: ×2 en lugar de otro aviso
    v = vivos().find(x => !x.fuera && x.tipo === d.tipo && x.titulo === d.titulo && x.cuerpo === d.cuerpo);
    if (v) {
      v.cuenta++; v.detalles = d.detalles.length ? d.detalles : v.detalles;
      if (visibles.includes(v)) { pintar(v); programar(v); }
      anotar(v);
      return asa(v);
    }
    // 4) "Subiendo…" de las llamadas de siempre se convierte en su resultado
    if (d.legado && d.tipo !== 'cargando') {
      v = visibles.find(x => !x.fuera && x.tipo === 'cargando' && x.legado && x.origen === d.origen);
      if (v) { Object.assign(v, d, { cuenta: 1, avance: null }); pintar(v); programar(v); anotar(v); return asa(v); }
    }
    v = { ...d, id: 'stmp-aviso-' + (++seq), cuenta: 1, el: document.createElement('div') };
    anotar(v);
    encolar(v);
    return asa(v);
  }

  // ── Operaciones pendientes ──
  async function operacion(fn, o = {}) {
    const h = mostrar(o.cargando || 'Procesando…', { tipo: 'cargando', clave: o.clave || 'op-' + (++seq), origen: o.origen, historial: false });
    pendientes++;
    try {
      const r = await fn();
      const okTxt = typeof o.ok === 'function' ? o.ok(r) : (o.ok || 'Listo');
      h.resolver(okTxt, { tipo: 'ok', origen: o.origen, ...(o.okOpciones || {}) });
      return r;
    } catch (e) {
      h.resolver(e, { tipo: 'error', origen: o.origen, titulo: o.error || 'No se pudo completar', cuerpo: e?.message || String(e),
        reintentar: o.reintentar === false ? null : () => { operacion(fn, o).catch(() => {}); } });
      throw e;
    } finally { pendientes--; }
  }
  // Varias cosas iguales a la vez (fotos): un solo aviso con conteo y detalles
  const lotes = {};
  function lote(o = {}) {
    const clave = o.clave || 'lote-' + (++seq);
    const L = lotes[clave];
    if (L && !L.terminado) { L.total += o.total || 1; L.pintar(); return L.api; }
    const t = Object.assign({ cargando: (h, n) => `Subiendo ${h + 1 > n ? n : h + 1} de ${n}…`, ok: n => n === 1 ? 'Listo' : `${n} listos`,
      fallo: (f, n) => `${f} de ${n} no se pudieron completar` }, o.textos || {});
    const st = { total: o.total || 1, hechos: 0, bien: [], mal: [], terminado: false };
    pendientes++;
    const h = mostrar(t.cargando(0, st.total), { tipo: 'cargando', clave, origen: o.origen, historial: false });
    st.pintar = () => {
      const n = st.bien.length + st.mal.length;
      if (n < st.total) { h.actualizar(t.cargando(n, st.total), { tipo: 'cargando', clave, origen: o.origen, historial: false }); h.avance(n / st.total); return; }
      st.terminado = true; pendientes--;
      delete lotes[clave];
      if (!st.mal.length) h.resolver(t.ok(st.bien.length), { tipo: 'ok', origen: o.origen, detalles: st.bien.filter(Boolean), cuerpo: o.cuerpoOk || '', ir: o.ir });
      else {
        const reintentos = st.mal.map(x => x.reintentar).filter(Boolean);
        h.resolver(t.fallo(st.mal.length, st.total), { tipo: 'error', origen: o.origen, fijo: true, log: false,
          cuerpo: st.bien.length ? `${st.bien.length} sí quedaron.` : '',
          detalles: st.mal.map(x => x.item ? `${x.item}: ${x.error}` : x.error),
          reintentar: reintentos.length ? () => { reintentos.forEach(fn => { try { fn(); } catch (e) { registrarError(o.origen, e); } }); } : null });
      }
    };
    st.api = {
      ok(item) { if (st.terminado) return; st.bien.push(item || ''); st.pintar(); },
      fallo(item, error, reintentar) { if (st.terminado) return; registrarError(o.origen, error, { item }); st.mal.push({ item, error: error?.message || String(error || 'Error'), reintentar }); st.pintar(); },
      get terminado() { return st.terminado; },
    };
    lotes[clave] = st;
    return st.api;
  }
  // Copiar al portapapeles con aviso (y respaldo para navegadores viejos)
  async function copiar(texto, o = {}) {
    const que = o.que || 'Link';
    let ok = false;
    try { await navigator.clipboard.writeText(texto); ok = true; }
    catch {
      try {
        const ta = document.createElement('textarea'); ta.value = texto; ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0'; document.body.appendChild(ta); ta.select();
        ok = document.execCommand('copy'); ta.remove();
      } catch {}
    }
    if (ok) mostrar(`${que} copiado`, { tipo: 'ok', origen: 'enlaces', grupo: 'copiar:' + que, item: texto,
      plural: o.plural || (n => `${n} ${que.toLowerCase()}s copiados`), historial: o.historial });
    else mostrar('No se pudo copiar automáticamente', { tipo: 'alerta', origen: 'enlaces', cuerpo: 'Ábrelo en detalles y cópialo a mano.', detalles: [texto], log: false });
    return ok;
  }
  function resolver(clave, m, o = {}) {
    const v = vivos().find(x => !x.fuera && x.clave === clave);
    if (v) quitar(v);
    if (m) mostrar(m, { tipo: 'ok', ...o });
    return !!v;
  }
  function configurar(o = {}) {
    if (o.max) CFG.max = Math.max(1, Math.min(6, Number(o.max) || 3));
    if (o.duracion) Object.assign(CFG.duracion, o.duracion);
    siguiente();
  }

  // ── Globales: conexión, errores de la página y salir con cosas pendientes ──
  window.addEventListener('offline', () => mostrar('Sin conexión a internet', { tipo: 'alerta', critico: true, clave: 'red', origen: 'red',
    cuerpo: 'Lo que guardes ahora puede no llegar. Te avisamos cuando vuelva.', log: false }));
  window.addEventListener('online', () => { if (resolver('red')) mostrar('Conexión restablecida', { tipo: 'ok', origen: 'red', historial: false }); });
  window.addEventListener('error', e => {
    if (!e.filename || /extension|chrome-extension|moz-extension/.test(e.filename) || /ResizeObserver loop/.test(e.message)) return;
    registrarError('pagina', e.error || e.message, { archivo: String(e.filename).split('/').pop() + ':' + e.lineno });
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e.reason; if (!r) return;
    // v37 · La transición animada entre páginas es solo adorno: si el navegador
    // la cancela (pasa en algunos celulares al cambiar de página) no es una falla
    // de la tienda y no debe llenar el registro de errores del panel.
    if (/^(InvalidStateError|AbortError)$/.test(r.name || '') && /Transition was|view ?transition/i.test(r.message || '')) { e.preventDefault(); return; }
    registrarError('pagina', r, { tipo: 'promesa' });
  });
  window.addEventListener('beforeunload', e => {
    if (pendientes > 0) { e.preventDefault(); e.returnValue = 'Todavía se está guardando algo. ¿Salir de todos modos?'; return e.returnValue; }
  });
  document.addEventListener('visibilitychange', () => visibles.forEach(v => document.hidden ? pausar(v) : seguir(v)));
  window.addEventListener('storage', e => { if (e.key === claveHist()) { hist = null; window.dispatchEvent(new CustomEvent('avisos:cambio')); } });

  const atajo = tipo => (m, o = {}) => mostrar(m, { ...o, tipo });
  return {
    mostrar, ok: atajo('ok'), error: atajo('error'), alerta: atajo('alerta'), info: atajo('info'), cargando: atajo('cargando'),
    operacion, lote, copiar, resolver, configurar, registrarError, registrarAccion, alIr, ir,
    cerrarTodos: () => [...visibles, ...cola].forEach(v => quitar(v)),
    tipoDe, svg, NOMBRE_TIPO, NOMBRE_ORIGEN,
    historial: () => historial().slice(), marcarLeida, marcarTodas, limpiar, noLeidas, ejecutar, accionDe, errores,
    get pendientes() { return pendientes; },
    sesionVencida: () => mostrar('No autenticado. Inicia sesión.', { tipo: 'error' }),
  };
})();
function toast(msg, a, b) { return Avisos.mostrar(msg, a, b); }

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
