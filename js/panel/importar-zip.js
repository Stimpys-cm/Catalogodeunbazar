// ─────────────────────────────────────────────────────────────
//  js/importar-zip.js — Subir muchas prendas de golpe
//
//  1. Eliges un ZIP (o varias fotos).
//  2. Se agrupan las fotos por prenda (carpetas, hora de la foto o cada N).
//  3. Cada prenda se sube a Cloudinary y la IA llena nombre, marca,
//     categoría, talla, estado, descripción, hashtags y precio sugerido.
//  4. Revisas, corriges lo que haga falta y guardas todas.
//
//  El ZIP se lee en el navegador (sin librerías): DecompressionStream.
//  Lo analizado se guarda en este navegador para poder continuar después.
// ─────────────────────────────────────────────────────────────

const ZI = {
  paso: 'elegir',          // elegir | agrupar | revisar
  grupos: [],              // [{ id, fotos:[{nombre,blob,url,t,heic}], subidas:[], estado, ia, f, error, guardada }]
  modo: 'auto', espera: 90, cadaN: 3,
  buscar: false, publicarIG: false, ocultas: false, calidad: 'auto',
  ig: 'programar', cadaHoras: 2, dropId: '',      // qué hacer en Instagram al guardar
  modoTrabajo: 'nuevas',   // nuevas | completar
  ia: null,                // { activa, modelo }
  corriendo: false, guardando: false,
  saltadas: { cifradas: 0, danadas: 0, formato: 0 },
  investigarRaras: true,   // v45: el agente investiga solo las piezas que parecen raras
  crearCatalogo: true,     // v45: crear marcas/categorías nuevas al guardar
  separarIA: true,         // v50: si las fotos vienen juntas, la IA las separa en prendas
  separando: null,         // v50: { fase, total, listos, tramos, costo } mientras la IA separa
  kFoto: 0,                // v51: número de cada foto (para mostrar las HEIC en cuanto suben)
  sig: 1,
};
const ZI_GUARDADO = 'stmp-importar-zip-v1';
const ZI_PREFS = 'stmp-ia-prefs';
const ZI_SUBIDAS = 'stmp-subidas-v1';      // huella de la foto → url en Cloudinary (no se vuelve a subir)
try { Object.assign(ZI, JSON.parse(localStorage.getItem(ZI_PREFS) || '{}')); } catch {}
const ziPrefs = () => { try { localStorage.setItem(ZI_PREFS, JSON.stringify({ calidad: ZI.calidad, buscar: ZI.buscar, ig: ZI.ig, cadaHoras: ZI.cadaHoras, investigarRaras: ZI.investigarRaras, crearCatalogo: ZI.crearCatalogo, separarIA: ZI.separarIA })); } catch {} };

// ── Subida en segundo plano: empieza en cuanto eliges las fotos ──
const ZI_PARALELO = 3;
let _ziSubiendo = 0; const _ziColaSub = [];
function ziSubirFoto(f) {
  if (f.nube) return Promise.resolve(f.nube);
  if (f.subida) return f.subida;
  f.subida = new Promise((ok, mal) => _ziColaSub.push({ f, ok, mal }));
  ziBombearSubidas();
  return f.subida;
}
function ziBombearSubidas() {
  while (_ziSubiendo < ZI_PARALELO && _ziColaSub.length) {
    const { f, ok, mal } = _ziColaSub.shift(); _ziSubiendo++;
    (async () => {
      try {
        const url = await ziConReintentos(async () => uploadToCloud(await ziDataUrl(f.blob, f.base)), 'subir');
        f.nube = url; if (f.huella) ziRecordarSubida(f.huella, url); ok(url);
      } catch (e) { f.subida = null; mal(e); }
      finally { _ziSubiendo--; ziBombearSubidas(); ziPintarSubidas(); }
    })();
  }
}
// v51: las fotos HEIC (iPhone) no se ven en Chrome/Brave/Windows: se muestran desde Cloudinary en cuanto suben
const ziMini = f => f.heic ? (f.nube ? f.nube.replace('/upload/', '/upload/c_fill,w_240,h_300,q_auto,f_jpg/') : '') : f.url;
const ziFotoHtml = (f, extra = '') => ziMini(f)
  ? `<img src="${escAdmin(ziMini(f))}" alt="" loading="lazy" decoding="async" draggable="false"${extra}>`
  : `<div class="zi-heic" data-zk="${f.k}"><span>HEIC</span><small>se ve al subir</small></div>`;
function ziPintarHeic() {
  const caja = document.getElementById('ziModal'); if (!caja || !ZI.fotos) return;
  caja.querySelectorAll('.zi-heic[data-zk]').forEach(el => {
    const f = ZI.fotos.find(x => String(x.k) === el.dataset.zk);
    if (f?.nube) { const t = document.createElement('div'); t.innerHTML = ziFotoHtml(f); el.replaceWith(t.firstElementChild); }
  });
  if (!ZI.fotos.some(f => f.heic && !f.nube)) document.getElementById('ziAvisoHeic')?.remove();
}
function ziPintarSubidas() {
  ziPintarHeic();
  const el = document.getElementById('ziSubidasTxt'); if (!el || !ZI.fotos) return;
  const t = ZI.fotos.length, n = ZI.fotos.filter(f => f.nube).length;
  el.textContent = n >= t ? `✓ ${t} fotos subidas` : `Subiendo fotos en segundo plano: ${n} de ${t}…`;
}
const ziMapaSubidas = () => { try { return JSON.parse(localStorage.getItem(ZI_SUBIDAS) || '{}'); } catch { return {}; } };
function ziRecordarSubida(huella, url) {
  try {
    const m = ziMapaSubidas(); m[huella] = url;
    const k = Object.keys(m); if (k.length > 3000) k.slice(0, k.length - 3000).forEach(x => delete m[x]);
    localStorage.setItem(ZI_SUBIDAS, JSON.stringify(m));
  } catch {}
}
async function ziHuella(blob) {
  try { const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()); return [...new Uint8Array(h)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join(''); }
  catch { return ''; }
}

// ── v44: reintentos y mensajes claros ───────────────────────
const ziDormir = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
function ziEsperarInternet() {
  if (navigator.onLine !== false) return Promise.resolve();
  ZI.sinInternet = true; ziPintarPie();
  return new Promise(r => window.addEventListener('online', () => { ZI.sinInternet = false; ziPintarPie(); r(); }, { once: true }));
}
// ¿Vale la pena volver a intentar? (saturada, sin red, tardó, error del servidor)
function ziReintentable(e) {
  const m = String(e?.message || '');
  if (/saldo|no es válida|Falta configurar|No autenticado|Inicia sesión|Solo se aceptan|Faltan las fotos|pesa más/i.test(m)) return false;
  if (e?.datos && 'reintentable' in e.datos) return !!e.datos.reintentable;
  if (e?.red || !e?.status) return true;                     // sin conexión / se cortó
  return [408, 425, 429, 500, 502, 503, 504, 520, 522, 524].includes(e.status);
}
function ziErrorHumano(e) {
  const m = String(e?.message || e || '');
  if (/failed to fetch|networkerror|load failed|network|sin conexión|internet/i.test(m)) return 'Sin conexión. Revisa tu internet y toca Reintentar.';
  if (/timed? ?out|timeout|aborted|abort/i.test(m)) return 'Tardó demasiado. Toca Reintentar.';
  if (/^(unexpected|syntaxerror|typeerror)|json/i.test(m)) return 'El servidor contestó algo raro. Toca Reintentar.';
  if (/demasiados intentos/i.test(m)) return 'Muchas fotos seguidas: espera un minuto y toca Reintentar.';
  // Texto de HTTP en inglés (Bad Gateway, Service Unavailable…): se dice en español
  if (/^(bad gateway|service unavailable|gateway time-?out|internal server error|too many requests|request timeout|forbidden|not found)$/i.test(m.trim()) || /^HTTP \d+$/.test(m.trim()))
    return e?.status === 429 ? 'Muchas fotos seguidas: espera un minuto y toca Reintentar.' : 'El servidor no respondió. Toca Reintentar.';
  return m || 'Algo falló. Toca Reintentar.';
}
// Hasta 4 intentos con espera creciente (respeta "Retry-After"); espera a que vuelva el internet
async function ziConReintentos(fn, que = '') {
  let ultimo;
  for (let i = 0; i < 4; i++) {
    await ziEsperarInternet();
    try { return await fn(i); }
    catch (e) {
      ultimo = e;
      // Crear una prenda solo se repite si el servidor dijo claramente que no la guardó
      if (!ziReintentable(e) || (que === 'crear' && ![429, 503].includes(e.status)) || i === 3) break;
      const ra = Number(e.retryAfter) > 0 ? Math.min(60000, e.retryAfter * 1000) : 0;
      await ziDormir(ra || [1500, 4000, 10000][i]);
    }
  }
  throw ultimo;
}

// ── Llamadas a la IA (compartidas con el formulario y "completar") ──
function iaListas() {
  let marcas = [];
  try { marcas = catalogoVisible(getBrands()).map(b => b.nombre).filter(Boolean).slice(0, 150); } catch {}
  return { categorias: ziCategorias(), tallas: TALLAS_PLANAS, estados: ESTADOS, marcas };
}
async function iaAnalizar({ imagenes, huellas, pista, calidad, buscar, agenteDespues }) {
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(80000) : undefined;
  return api('/api/acciones?op=ia-prenda', { method: 'POST', signal, body: {
    imagenes, huellas, pista, ...iaListas(),
    calidad: calidad || ZI.calidad, buscar: buscar ?? ZI.buscar,
    investigarRaras: agenteDespues === true && ZI.investigarRaras === true,    // si el agente la va a investigar, no se escala dos veces
    bazarId: typeof bazarParaNuevas === 'function' ? bazarParaNuevas() : null,
  } });
}
function iaAprender(casos) {
  if (!casos.length) return;
  api('/api/acciones?op=ia-aprender', { method: 'POST', body: { casos, bazarId: typeof bazarParaNuevas === 'function' ? bazarParaNuevas() : null } }).catch(() => {});
}
const iaCaso = (ia, f) => ({
  ia: { nombre: ia.nombre, marca: ia.marca, categoria: ia.categoria, talla: ia.talla, estado: ia.estado, precio: ia.precioSugerido },
  final: { nombre: f.nombre, marca: f.marca, categoria: f.categoria, talla: f.talla, estado: f.estado, precio: Number(f.precio) || 0 },
});
async function iaEstado(forzar) {
  if (ZI.ia && !forzar) return ZI.ia;
  try { ZI.ia = await api('/api/acciones?op=ia-estado' + (typeof bazarParaNuevas === 'function' ? `&bazarId=${bazarParaNuevas()}` : '')); }
  catch { ZI.ia = { activa: false }; }
  return ZI.ia;
}
const usd = n => { n = Number(n) || 0; return n > 0 && n < 0.001 ? 'menos de $0.001 USD' : '$' + n.toFixed(n >= 1 ? 2 : 3) + ' USD'; };
function iaUsoTexto() {
  const ia = ZI.ia; if (!ia?.activa) return '';
  const h = ia.hoy || {}, m = ia.mes || {};
  return `Hoy: ${h.prendas || 0} prendas · ${usd(h.usd)}${h.gratis ? ` (${h.gratis} gratis por memoria)` : ''} · Este mes: ${usd(m.usd)}${ia.aprendidas ? ` · Aprendió de ${ia.aprendidas} correcciones` : ''}`;
}
const ZI_IMG = /\.(jpe?g|png|webp|heic|heif|avif|gif)$/i;

// ═════════════════════════════════════════════════════════════
//  Lector de ZIP (sin dependencias)
// ═════════════════════════════════════════════════════════════
async function ziLeerZip(file) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Tu navegador no puede abrir ZIP. Actualízalo o usa Chrome.');
  const cola = Math.min(file.size, 65557 + 22);
  const fin = new DataView(await file.slice(file.size - cola).arrayBuffer());
  let i = fin.byteLength - 22;
  while (i >= 0 && fin.getUint32(i, true) !== 0x06054b50) i--;
  if (i < 0) throw new Error('Ese archivo no es un ZIP válido.');
  const total = fin.getUint16(i + 10, true), tam = fin.getUint32(i + 12, true), off = fin.getUint32(i + 16, true);
  if (off === 0xffffffff || total === 0xffff) throw new Error('El ZIP es demasiado grande (más de 4 GB). Divídelo en varios.');
  const cd = new DataView(await file.slice(off, off + tam).arrayBuffer());
  const dec = new TextDecoder('utf-8');
  const salida = [];
  for (let p = 0, n = 0; n < total && p + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const banderas = cd.getUint16(p + 8, true);
    const metodo = cd.getUint16(p + 10, true), hora = cd.getUint16(p + 12, true), fecha = cd.getUint16(p + 14, true);
    const comp = cd.getUint32(p + 20, true), largoN = cd.getUint16(p + 28, true), largoE = cd.getUint16(p + 30, true), largoC = cd.getUint16(p + 32, true);
    const local = cd.getUint32(p + 42, true);
    const nombre = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, largoN));
    // Marca de tiempo exacta (campo extra 0x5455) si viene; si no, la de DOS
    let t = new Date(1980 + (fecha >> 9), ((fecha >> 5) & 15) - 1, fecha & 31, hora >> 11, (hora >> 5) & 63, (hora & 31) * 2).getTime();
    for (let e = p + 46 + largoN; e + 4 <= p + 46 + largoN + largoE;) {
      const id = cd.getUint16(e, true), l = cd.getUint16(e + 2, true);
      if (id === 0x5455 && l >= 5 && (cd.getUint8(e + 4) & 1)) t = cd.getUint32(e + 5, true) * 1000;
      e += 4 + l;
    }
    p += 46 + largoN + largoE + largoC;
    const base = nombre.split('/').pop();
    if (nombre.endsWith('/') || nombre.startsWith('__MACOSX') || base.startsWith('.') || !ZI_IMG.test(base)) continue;
    if (banderas & 1) { ZI.saltadas.cifradas++; continue; }
    salida.push({ nombre, base, carpeta: nombre.includes('/') ? nombre.slice(0, nombre.lastIndexOf('/')) : '', t, metodo, comp, local });
  }
  // Se extraen de una en una (no carga todo el ZIP en memoria); una foto dañada se salta
  for (const s of salida) {
    try {
      const cab = new DataView(await file.slice(s.local, s.local + 30).arrayBuffer());
      if (cab.getUint32(0, true) !== 0x04034b50) { ZI.saltadas.danadas++; continue; }
      const ini = s.local + 30 + cab.getUint16(26, true) + cab.getUint16(28, true);
      const crudo = file.slice(ini, ini + s.comp);
      let blob;
      if (s.metodo === 0) blob = crudo;
      else if (s.metodo === 8) blob = await new Response(crudo.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
      else { ZI.saltadas.formato++; continue; }
      if (!blob.size) { ZI.saltadas.danadas++; continue; }
      s.blob = new Blob([blob], { type: ziTipo(s.base) });
    } catch { ZI.saltadas.danadas++; }
  }
  if (!salida.some(s => s.blob) && ZI.saltadas.cifradas) throw new Error('El ZIP tiene contraseña. Vuelve a crearlo sin contraseña.');
  return salida.filter(s => s.blob);
}

function ziTipo(n) {
  const e = n.split('.').pop().toLowerCase();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', gif: 'image/gif' }[e] || 'image/jpeg';
}
const ziNat = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// ═════════════════════════════════════════════════════════════
//  Agrupar fotos en prendas
// ═════════════════════════════════════════════════════════════
// Orden en que se tomaron: por carpeta, luego por hora de la foto y luego por nombre
const ziOrdenFotos = fotos => [...fotos].sort((a, b) => (a.carpeta === b.carpeta ? 0 : ziNat(a.carpeta || '', b.carpeta || '')) || ((a.t || 0) - (b.t || 0)) || ziNat(a.base || '', b.base || ''));
function ziAgrupar(fotos) {
  const orden = ziOrdenFotos(fotos);
  const carpetas = new Set(orden.map(f => f.carpeta));
  const grupos = [];
  const nuevo = () => { const g = { id: ZI.sig++, fotos: [], subidas: [], estado: 'listo', f: {} }; grupos.push(g); return g; };
  const conLote = gs => { gs.forEach(g => { g.lote = g.fotos[0]?.lote || ZI.lote || ''; }); return gs; };
  let modo = ZI.modo;
  // Automático: carpetas si hay varias; si las horas no sirven (todas iguales), cada 3
  if (modo === 'auto') {
    const horas = new Set(orden.map(f => Math.round(f.t / 2000)));
    modo = carpetas.size > 1 ? 'carpetas' : horas.size < orden.length * 0.3 ? 'cadaN' : 'hora';
    ZI.modoReal = modo;
  } else ZI.modoReal = modo;

  let g = null, prev = null;
  orden.forEach((f, i) => {
    const corta =
      !g ||
      (modo === 'carpetas' && f.carpeta !== prev.carpeta) ||
      (modo === 'hora' && (f.carpeta !== prev.carpeta || Math.abs(f.t - prev.t) > ZI.espera * 1000)) ||
      (modo === 'cadaN' && g.fotos.length >= ZI.cadaN) ||
      modo === 'cada1' ||
      g.fotos.length >= 10;
    if (corta) g = nuevo();
    g.fotos.push(f); prev = f;
  });
  return conLote(grupos);
}

// ═════════════════════════════════════════════════════════════
//  v50 · Separar con IA: la IA ve las fotos en orden y dice dónde empieza cada prenda
// ═════════════════════════════════════════════════════════════
const ZI_TRAMO = 40, ZI_ENCIMA = 6, ZI_TRAMO_MAX = 48;
function ziConvieneSepararIA() {
  return ZI.separarIA !== false && ZI.modo === 'auto' && ZI.modoReal !== 'carpetas' && ZI.modoTrabajo === 'nuevas'
    && (ZI.fotos?.length || 0) >= 3 && ZI.ia?.activa === true;
}
// Tramos de 40 fotos que se enciman 6 (así una prenda nunca queda cortada entre dos tramos)
function ziTramos(a, b) {
  const out = []; let ini = a;
  for (;;) {
    if (b - ini + 1 <= ZI_TRAMO_MAX) { out.push({ ini, fin: b }); break; }
    const fin = ini + ZI_TRAMO - 1; out.push({ ini, fin }); ini = fin - ZI_ENCIMA + 1;
  }
  return out;
}
// Junta lo que dijo cada tramo. Posiciones 0…N−1; t.prendas[].f y t.x usan números 1…N.
// - Cada par de fotos seguidas lo decide el tramo donde ese par queda más al centro.
// - Una foto que la IA no decidió va con la anterior (casi siempre es un acercamiento).
// - "x" (no es ropa) va aparte, para que la revises y la quites.
// - Una foto que la IA puso con otras fotos lejanas (una etiqueta tomada después) se mueve con ellas.
// - Si un tramo falló, esas fotos se juntan por hora de la foto (y se marcan para revisar).
function ziUnirTramos(N, tramos, mismaSinIA = () => true) {
  const info = tramos.filter(t => t.ok).map(t => {
    const et = new Map(), nombre = [], seg = [];
    (t.prendas || []).forEach((pr, k) => { (pr.f || []).forEach(n => et.set(n - 1, k)); nombre[k] = pr.n || ''; seg[k] = pr.s ?? 0.7; });
    (t.x || []).forEach(n => et.set(n - 1, 'x'));
    for (let p = t.ini; p <= t.fin; p++) if (!et.has(p)) {           // sin decidir → con la de antes (o la de después)
      let q = p - 1; while (q >= t.ini && (!et.has(q) || et.get(q) === 'x')) q--;
      if (q >= t.ini) et.set(p, et.get(q));
      else { q = p + 1; while (q <= t.fin && (!et.has(q) || et.get(q) === 'x')) q++; et.set(p, q <= t.fin ? et.get(q) : 'solo' + p); }
    }
    return { ...t, et, nombre, seg };
  });
  const mejor = (a, b) => { let m = null, v = -1; for (const t of info) if (t.ini <= a && b <= t.fin) { const c = Math.min(a - t.ini, t.fin - b); if (c > v) { v = c; m = t; } } return m; };
  const dueno = p => mejor(p, p);
  // Grupos seguidos
  let grupos = [];
  for (let p = 0; p < N; p++) {
    let misma = false;
    if (p > 0) {
      const t = mejor(p - 1, p);
      misma = t ? t.et.get(p - 1) === t.et.get(p) : mismaSinIA(p - 1, p);
    }
    if (!misma) grupos.push({ fotos: [] });
    grupos[grupos.length - 1].fotos.push(p);
  }
  // Fotos que la IA puso con otras que quedaron en otro grupo (p. ej. una etiqueta fotografiada después)
  const grupoDe = new Map(); grupos.forEach((g, i) => g.fotos.forEach(p => grupoDe.set(p, i)));
  for (let p = 0; p < N; p++) {
    const t = dueno(p); if (!t) continue;
    const L = t.et.get(p); if (L === 'x' || typeof L !== 'number') continue;
    const mates = [];
    for (let q = t.ini; q <= t.fin; q++) if (q !== p && t.et.get(q) === L) mates.push(q);
    if (!mates.length) continue;
    const gs = new Set(mates.map(q => grupoDe.get(q))), actual = grupoDe.get(p);
    if (gs.size !== 1 || gs.has(actual)) continue;
    const destino = [...gs][0];
    grupos[actual].fotos = grupos[actual].fotos.filter(x => x !== p);
    grupos[destino].fotos = [...grupos[destino].fotos, p].sort((a, b) => a - b);
    grupoDe.set(p, destino);
  }
  grupos = grupos.filter(g => g.fotos.length);
  // Nombre, seguridad y "no parece ropa" de cada grupo
  return grupos.map(g => {
    const p0 = g.fotos[0], t = dueno(p0);
    if (!t) return { ...g, n: '', s: 0, duda: true };
    const etiquetas = g.fotos.map(p => (dueno(p) || t).et.get(p));
    if (etiquetas.every(L => L === 'x')) return { ...g, n: 'No parece ropa', s: 0, duda: true, x: true };
    const L = etiquetas.find(L => typeof L === 'number');
    const segs = g.fotos.map(p => { const tt = dueno(p) || t, LL = tt.et.get(p); return typeof LL === 'number' ? tt.seg[LL] ?? 0.7 : 0.7; });
    const s = Math.min(...segs);
    return { ...g, n: typeof L === 'number' ? t.nombre[L] || '' : '', s, duda: s < 0.6 || g.fotos.length > 10 };
  });
}
async function ziEnParalelo(lista, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, async () => { while (i < lista.length) { const k = i++; await fn(lista[k], k); } }));
}
function ziSeparandoHtml(S) {
  const subidas = ZI.fotos ? ZI.fotos.filter(f => f.nube).length : 0;
  const pct = S.fase === 'subiendo' ? Math.round(subidas / Math.max(1, S.total) * 50) : 50 + Math.round(S.listos / Math.max(1, S.tramos) * 50);
  const txt = S.fase === 'subiendo' ? `Subiendo fotos: ${subidas} de ${S.total}…` : `Viendo las fotos: parte ${Math.min(S.listos + 1, S.tramos)} de ${S.tramos}…`;
  return `<div class="zi-separando" id="ziSeparando" role="status" aria-live="polite">
    <span class="zi-spin"></span>
    <div class="zi-sep-txt"><b>La IA está viendo cada foto para separar tus prendas</b>
      <small id="ziSepTxt">${txt}</small>
      <div class="zi-prog"><i id="ziSepBarra" style="width:${pct}%"></i></div></div>
    <button class="zi-btn" onclick="ziSepararCancelarYHora()">Cancelar y agrupar por hora</button>
  </div>`;
}
function ziPintarSeparando() {
  const S = ZI.separando, el = document.getElementById('ziSeparando');
  if (!S || !el) return;
  const tmp = document.createElement('div'); tmp.innerHTML = ziSeparandoHtml(S);
  const txt = tmp.querySelector('#ziSepTxt')?.textContent, ancho = tmp.querySelector('#ziSepBarra')?.style.width;
  const t = document.getElementById('ziSepTxt'), b = document.getElementById('ziSepBarra');
  if (t && txt != null) t.textContent = txt;
  if (b && ancho) b.style.width = ancho;
}
// Pone los grupos que salieron: reemplaza todo, o los agrega al final si eran fotos de más (v52)
function ziPonerGrupos(grupos, S) {
  if (S?.agregar) {
    ZI.grupos.push(...grupos);
    ZI.resalta = grupos[0]?.id;
    ziPintar();
    if (ZI.paso === 'revisar') ziCorrer();
  } else { ZI.grupos = grupos; ZI.modoReal = 'ia'; ziPintar(); }
}
// Agrupa unas fotos con otra forma sin cambiar cómo dice que está agrupado lo demás
function ziAgruparComo(modo, fotos) {
  const m = ZI.modo, real = ZI.modoReal;
  ZI.modo = modo; ZI.espera = ZI.espera || 90;
  const gs = ziAgrupar(fotos);
  ZI.modo = m; ZI.modoReal = real;
  return gs;
}
function ziSepararCancelarYHora() {
  const S = ZI.separando; if (!S) return;
  ziCancelarSeparar();
  if (S.agregar) ziPonerGrupos(ziAgruparComo('hora', S.fotos), S);
  else ziReagrupar('hora:90');
}

// ── v52 · Agregar más fotos después de importar ──────────────
// En "Agrupar": más prendas al final. En "Revisar": más prendas (se suben y analizan)
// o, con gId, más fotos a esa prenda (no se vuelve a pagar la IA; puedes pedirlo).
async function ziAgregarFotos(lista, gId) {
  const archivos = [...(lista || [])]; if (!archivos.length) return;
  if (ZI.separando) return toast('Espera a que la IA termine de separar las fotos');
  const ya = new Set([...(ZI.fotos || []), ...ZI.grupos.flatMap(g => g.fotos)].map(f => f.huella).filter(Boolean));
  let nuevas;
  try { nuevas = await ziLeerArchivos(archivos, ya); }
  catch (e) { return toast(e.message, 'error'); }
  if (!nuevas.length) return toast('Esas fotos ya estaban', 'info');
  ZI.fotos = [...(ZI.fotos || []), ...nuevas];
  if (gId != null) {
    const g = ZI.grupos.find(x => x.id === gId);
    if (!g || g.guardada) return;
    nuevas.forEach(f => { f.lote = g.lote || f.lote; });
    g.fotos.push(...nuevas); g.subiendoMas = true; ziPintarTarjeta(g, true);
    try {
      for (const f of nuevas) { g.subidas.push(await ziConReintentos(() => ziSubirFoto(f), 'subir')); ziPintarTarjeta(g, true); }
      toast(`Se agregaron ${nuevas.length} foto(s). Si quieres que la IA las vea, toca "Volver a analizar".`, 'ok');
    } catch (e) {
      g.fotos = g.fotos.filter(f => !nuevas.includes(f) || f.nube); g.subidas = g.subidas.slice(0, g.fotos.length);
      toast('No se pudieron subir todas las fotos: ' + ziErrorHumano(e), 'error');
    }
    g.subiendoMas = false; ziGuardarLocal(); ziPintarTarjeta(g, true);
    return;
  }
  nuevas.forEach(f => ziSubirFoto(f).catch(() => {}));
  const variasCarpetas = new Set(nuevas.map(f => f.carpeta || '')).size > 1;
  if (ZI.separarIA !== false && ZI.ia?.activa === true && nuevas.length >= 3 && !variasCarpetas && ZI.modoTrabajo === 'nuevas') {
    toast(`La IA está separando ${nuevas.length} fotos nuevas en prendas…`, 'info');
    return ziSepararIA({ fotos: nuevas, agregar: true });
  }
  ziPonerGrupos(ziAgruparComo(variasCarpetas ? 'carpetas' : ZI.modo === 'auto' || ZI.modo === 'ia' ? 'auto' : ZI.modo, nuevas), { agregar: true });
  toast(`Se agregaron ${nuevas.length} foto(s)`, 'ok');
}
function ziMasFotosHtml(g) {
  if (g.guardada || g.antes || !['hecho', 'error'].includes(g.estado)) return '';
  return `<div class="zi-mas-fotos">${g.subiendoMas ? '<span class="zi-spin"></span> Subiendo fotos…' : `
    <label class="zi-btn mini">＋ Fotos<input type="file" accept="image/*,.heic,.heif,.zip,application/zip" multiple hidden onchange="ziAgregarFotos(this.files, ${g.id}); this.value=''"></label>
    ${g.fotos.length > g.subidas.length ? '' : `<button class="zi-btn mini" onclick="ziReanalizar(${g.id})" title="La IA vuelve a ver todas las fotos (cuesta como una prenda)">Volver a analizar</button>`}`}</div>`;
}

function ziCancelarSeparar(silencio) {
  if (!ZI.separando) return;
  ZI.separando.cancelado = true; ZI.separando = null;
  if (!silencio) toast('Se canceló la separación con IA');
}
async function ziSepararIA(opc = {}) {
  if (!ZI.fotos?.length) return;
  if (ZI.separando) return;                                          // ya está corriendo
  const fotos = ziOrdenFotos(opc.fotos || ZI.fotos);
  const S = ZI.separando = { fase: 'subiendo', total: fotos.length, tramos: 0, listos: 0, costo: 0, memoria: 0, cancelado: false, agregar: !!opc.agregar, fotos };
  if (!S.agregar) ZI.modoReal = 'ia';
  ziPintar();
  // 1. Que terminen de subir (la IA ve las fotos desde Cloudinary). Las que no suban se juntan por hora.
  await Promise.allSettled(fotos.map(f => ziSubirFoto(f)));
  if (S.cancelado) return;
  const vistas = fotos.filter(f => f.nube);
  // 2. Tramos (sin cruzar carpetas: dos carpetas nunca son la misma prenda)
  const tramos = [];
  let a = 0;
  for (let i = 1; i <= vistas.length; i++) {
    if (i === vistas.length || (vistas[i].carpeta || '') !== (vistas[a].carpeta || '')) { if (i - 1 >= a) tramos.push(...ziTramos(a, i - 1)); a = i; }
  }
  S.fase = 'analizando'; S.tramos = tramos.filter(t => t.fin > t.ini).length; ziPintarSeparando();
  const bazarId = typeof bazarParaNuevas === 'function' ? bazarParaNuevas() : null;
  let error = null;
  await ziEnParalelo(tramos, 2, async t => {
    if (S.cancelado) return;
    if (t.fin === t.ini) { t.ok = true; t.prendas = [{ f: [t.ini + 1], n: '', s: 0.7 }]; t.x = []; return; }   // una sola foto
    try {
      const r = await ziConReintentos(() => api('/api/acciones?op=ia-agrupar', { method: 'POST',
        signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(80000) : undefined,
        body: { imagenes: vistas.slice(t.ini, t.fin + 1).map(f => f.nube), desde: t.ini + 1, calidad: ZI.calidad, bazarId } }), 'ia');
      Object.assign(t, { ok: true, prendas: r.prendas || [], x: r.x || [] });
      S.costo += Number(r.costoUSD) || 0; if (r.desdeMemoria) S.memoria++;
      if (r.costoUSD) ziGastar?.(r.costoUSD);
    } catch (e) {
      t.ok = false; error = e;
      if (e?.status === 402) { S.cancelado = true; }                 // sin saldo: no seguir gastando intentos
    }
    S.listos++; if (!S.cancelado) ziPintarSeparando();
  });
  if (ZI.separando !== S) return;                                    // se canceló o se volvió a empezar
  ZI.separando = null;
  if (!tramos.some(t => t.ok)) {
    if (S.agregar) ziPonerGrupos(ziAgruparComo('hora', fotos), S);
    else { ZI.modo = 'hora'; ZI.espera = ZI.espera || 90; ZI.grupos = ziAgrupar(ZI.fotos); ziPintar(); }
    toast(`No se pudo separar con IA${error?.message ? `: ${ziErrorHumano(error)}` : ''}. Las agrupé por la hora de la foto; revisa cada fila.`, { tipo: 'alerta', dur: 9000 });
    if (error?.status === 402) ziSaldoRefrescar?.();
    return;
  }
  // 3. Juntar
  const mismaSinIA = (p, q) => (vistas[p].carpeta || '') === (vistas[q].carpeta || '') && Math.abs((vistas[q].t || 0) - (vistas[p].t || 0)) <= (ZI.espera || 90) * 1000;
  const res = ziUnirTramos(vistas.length, tramos, mismaSinIA);
  const sinTramo = new Set(); tramos.filter(t => !t.ok).forEach(t => { for (let p = t.ini; p <= t.fin; p++) sinTramo.add(p); });
  tramos.filter(t => t.ok).forEach(t => { for (let p = t.ini; p <= t.fin; p++) sinTramo.delete(p); });
  const grupos = res.map(r => ({
    id: ZI.sig++, fotos: r.fotos.map(p => vistas[p]), subidas: [], estado: 'listo', f: {},
    iaNombre: r.n || '', iaDuda: !!r.duda || r.fotos.some(p => sinTramo.has(p)), iaX: !!r.x, lote: vistas[r.fotos[0]]?.lote || ZI.lote || '',
  }));
  // Las fotos que no se pudieron subir van con la foto anterior (en el orden en que se tomaron)
  const enGrupo = new Map(); grupos.forEach(g => g.fotos.forEach(f => enGrupo.set(f, g)));
  let ultimo = grupos[0];
  for (const f of fotos) {
    if (enGrupo.has(f)) { ultimo = enGrupo.get(f); continue; }
    if (!ultimo) { ultimo = { id: ZI.sig++, fotos: [], subidas: [], estado: 'listo', f: {}, iaNombre: '', iaDuda: true }; grupos.unshift(ultimo); }
    ultimo.fotos.push(f); ultimo.iaDuda = true; enGrupo.set(f, ultimo);
  }
  ziPonerGrupos(grupos, S);
  const gasto = S.costo > 0 ? ` (gastó ${S.costo < 0.01 ? 'menos de 1 centavo de dólar' : `$${S.costo.toFixed(2)} USD`})` : S.memoria ? ' (gratis: ya las había visto)' : '';
  const fallaron = tramos.filter(t => !t.ok).length;
  toast(`La IA separó ${vistas.length} fotos en ${grupos.length} prendas${gasto}. Revisa cada fila${fallaron ? `; una parte no se pudo ver con IA y se agrupó por hora` : ''}.`, { tipo: fallaron ? 'alerta' : 'ok', dur: 8000 });
}

// ═════════════════════════════════════════════════════════════
//  Ventana
// ═════════════════════════════════════════════════════════════
async function ziAbrir() {
  let caja = document.getElementById('ziModal');
  if (!caja) {
    caja = document.createElement('div');
    caja.id = 'ziModal'; caja.className = 'zi-modal';
    caja.setAttribute('role', 'dialog'); caja.setAttribute('aria-modal', 'true'); caja.setAttribute('aria-label', 'Importar prendas');
    document.body.appendChild(caja);
    // Al arrastrar con el dedo, la ventana no se desplaza (se registra desde el inicio para que el navegador lo respete)
    caja.addEventListener('touchmove', ev => { if (ZI.arrastre?.activo || window.OrdenarFotos?.arrastrando) ev.preventDefault(); }, { passive: false });
  }
  caja.hidden = false; document.body.classList.add('zi-abierto');
  // ¿Quedó una importación a medias?
  if (!ZI.grupos.length) {
    try {
      const g = JSON.parse(localStorage.getItem(ZI_GUARDADO) || 'null');
      if (g?.grupos?.length) { ZI.pendiente = g; }
    } catch {}
  }
  ziPintar();
  await iaEstado(true); ziPintar();
}

// v52: abre borradores (de Panel → Borradores) en "Revisar" para terminar de registrarlos
async function ziAbrirBorradores(lista) {
  lista = (lista || []).filter(d => d?.id && d.fotos?.length);
  if (!lista.length) return;
  if (ZI.separando || ZI.corriendo || ZI.guardando) { await ziAbrir(); return toast('Espera a que termine lo que está corriendo en el registro rápido'); }
  if (ZI.paso === 'agrupar' && ZI.grupos.some(g => !g.subidas.length)) { await ziAbrir(); return toast('Tienes fotos sin subir en "Agrupar": termina ese paso (Subir y analizar) o regresa a Fotos antes de abrir borradores.'); }
  const mismos = ZI.paso === 'revisar' && ZI.modoTrabajo === 'nuevas';
  const yaAbiertos = new Set(mismos ? ZI.grupos.map(g => g.bid).filter(Boolean) : []);
  const mini = u => u.replace('/upload/', '/upload/c_fill,w_240,h_300,q_auto,f_auto/');
  const nuevos = lista.filter(d => !yaAbiertos.has(d.id)).map(d => {
    const g = { id: ZI.sig++, bid: d.id, lote: d.lote || '', subidas: [...d.fotos], fotos: d.fotos.map(u => ({ url: mini(u), nube: u, lote: d.lote || '' })),
      estado: d.ia ? 'hecho' : 'listo', ia: d.ia || null, f: { ...(d.f || {}), incluir: true },   // la abriste para registrarla iaOriginal: d.iaOriginal || undefined,
      agente: d.agente || undefined, ordenManual: !!d.ordenManual, revisadaRepetida: true };
    g._bHash = JSON.stringify(ziBorradorDe(g));
    return g;
  });
  if (!mismos) { ZI.grupos = []; ZI.modoTrabajo = 'nuevas'; ZI.pendiente = null; }
  ZI.grupos.push(...nuevos);
  ZI.paso = 'revisar';
  await ziAbrir();
  if (nuevos.some(g => g.estado === 'listo')) ziCorrer();
}

function ziCerrar() {
  if (ZI.corriendo || ZI.guardando) { toast('Espera a que termine o pausa primero'); return; }
  const caja = document.getElementById('ziModal');
  if (caja) caja.hidden = true;
  document.body.classList.remove('zi-abierto');
}

function ziPintar() {
  const caja = document.getElementById('ziModal'); if (!caja) return;
  const pasos = [['elegir', 'Fotos'], ['agrupar', 'Agrupar'], ['revisar', 'Revisar'], ['listo', 'Publicar']];
  const iPaso = ZI.paso === 'sesion' ? 1 : pasos.findIndex(p => p[0] === ZI.paso);
  // Si sigue en el mismo paso, no regresar la lista hasta arriba (al mover, unir o separar)
  const antes = document.getElementById('ziCuerpo'), mismo = caja.dataset.paso === ZI.paso, arriba = mismo && antes ? antes.scrollTop : 0;
  const tiras = mismo ? [...caja.querySelectorAll('#ziGrupos .zi-tiras')].map(t => t.scrollLeft) : [];
  caja.dataset.paso = ZI.paso;
  caja.innerHTML = `
    <div class="zi-caja">
      <header class="zi-cab">
        <div>
          <h2>${ZI.modoTrabajo === 'completar' ? 'Completar prendas' : 'Registro rápido con IA'}</h2>
          <ol class="zi-pasos">${pasos.map(([k, t], i) => `<li class="${i < iPaso ? 'hecho' : i === iPaso ? 'on' : ''}"><span>${i + 1}</span>${t}</li>`).join('')}</ol>
        </div>
        <button class="zi-x" onclick="ziCerrar()" aria-label="Cerrar">✕</button>
      </header>
      <div class="zi-cuerpo" id="ziCuerpo">${ZI.paso === 'elegir' ? ziVistaElegir() : ZI.paso === 'agrupar' ? ziVistaAgrupar() : ZI.paso === 'sesion' ? ziVistaSesion() : ZI.paso === 'listo' ? ziVistaListo() : ziVistaRevisar()}</div>
      ${ZI.paso === 'revisar' ? ziPie() : ''}
    </div>`;
  if (arriba) document.getElementById('ziCuerpo').scrollTop = arriba;
  if (tiras.length) caja.querySelectorAll('#ziGrupos .zi-tiras').forEach((t, i) => { if (tiras[i]) t.scrollLeft = tiras[i]; });
}

// ── Paso 1 ───────────────────────────────────────────────────
function ziVistaElegir() {
  const ia = ZI.ia;
  const avisoIA = !ia ? '' : ia.activa ? '' : `
    <div class="zi-aviso">
      <b>La IA todavía no está configurada.</b> Puedes importar igual y llenar los datos a mano, pero para que se llenen solos:
      <ol>
        <li>Entra a <b>console.anthropic.com</b>, crea una cuenta y agrega saldo en <b>Billing</b> (con 5 USD alcanza para cientos de prendas).</li>
        <li>En <b>API Keys</b> crea una clave.</li>
        <li>En Vercel → tu proyecto → <b>Settings → Environment Variables</b> agrega <code>ANTHROPIC_API_KEY</code> con esa clave y haz <b>Redeploy</b>.</li>
      </ol>
    </div>`;
  const pend = ZI.pendiente;
  return `
    ${pend ? `<div class="zi-aviso suave"><b>Tienes una importación sin terminar</b> (${pend.grupos.length} prenda${pend.grupos.length === 1 ? '' : 's'}, ${new Date(pend.en).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}).
      <div class="zi-fila"><button class="zi-btn negro" onclick="ziContinuar()">Continuar donde me quedé</button><button class="zi-btn" onclick="ziDescartar()">Descartar</button></div></div>` : ''}
    ${avisoIA}
    ${ziSaldoHtml()}
    ${ia?.activa ? `<p class="zi-uso">${iaUsoTexto()}</p>` : ''}
    <label class="zi-drop" id="ziDrop" ondragover="event.preventDefault();this.classList.add('sobre')" ondragleave="this.classList.remove('sobre')" ondrop="ziSoltar(event)">
      <input type="file" accept=".zip,application/zip,image/*,.heic,.heif,.rar" multiple onchange="ziElegir(this.files)" hidden>
      <span class="zi-drop-ic">⇪</span>
      <b>Arrastra aquí tu ZIP, tus fotos o la carpeta</b>
      <span>o toca para elegirlos. La IA llena todo y tú solo revisas.</span>
    </label>
    <label class="zi-btn zi-carpeta-btn">${ico('carpeta', 16)} Elegir una carpeta
      <input type="file" id="ziCarpeta" webkitdirectory directory multiple onchange="ziElegir(this.files)" hidden></label>
    ${ia?.activa ? `<label class="zi-check zi-sep-op"><input type="checkbox" id="ziOpSeparar" ${ZI.separarIA !== false ? 'checked' : ''} onchange="ZI.separarIA=this.checked;ziPrefs()"> <span><b>Separar las prendas con IA</b><small>Si todas las fotos vienen juntas (sin una carpeta por prenda), la IA ve cada foto y decide dónde empieza cada prenda. Unos 5 centavos de dólar por cada 100 fotos.</small></span></label>` : ''}
    <div class="zi-o"><span>o desde el celular</span></div>
    <button class="zi-sesion-btn" onclick="ziSesionEmpezar()">
      <span class="zi-sesion-ic">${ico('camara', 22)}</span>
      <span><b>Sesión de fotos</b><small>Toma las fotos prenda por prenda con la cámara. Cada vez que terminas una, tocas "Siguiente prenda" y la IA empieza a analizarla mientras fotografías la otra.</small></span>
      <em>→</em>
    </button>
    <div class="zi-tips">
      <div><b>Cómo armar el ZIP</b>
        <p><b>Lo más fácil:</b> todas las fotos juntas en un ZIP, tomadas en orden (todas las de una prenda seguidas). La IA ve cada foto y las separa en prendas; en el siguiente paso solo revisas.</p>
        <p><b>También sirve:</b> una carpeta por prenda (Prenda 1, Prenda 2…); así no se usa la IA para separar.</p></div>
      <div><b>Para que la IA atine</b>
        <p>Incluye una foto de la prenda completa de frente, una de atrás y una de la <b>etiqueta</b> (marca y talla), en cualquier orden. La IA revisa hasta 8 fotos por prenda; con la etiqueta, la talla y la marca salen casi siempre bien.</p>
        <p>Fotos de iPhone: si salen en HEIC, en <i>Ajustes → Cámara → Formatos</i> elige "Más compatible".</p></div>
    </div>
    <div id="ziLeyendo"></div>
    ${ziFaltantes().length ? `<div class="zi-completar">
      <div><b>Completar las prendas que ya tienes</b>
        <p>${ziFaltantes().length} prenda(s) sin marca, talla, estado, categoría o descripción. La IA mira sus fotos y llena solo lo que falta; tú revisas antes de guardar.</p></div>
      <button class="zi-btn" onclick="ziCompletarAbrir()" ${ia?.activa ? '' : 'disabled'}>Completar con IA</button>
    </div>` : ''}`;
}

// ── Completar prendas existentes ─────────────────────────────
const ZI_CAMPOS = ['marca', 'talla', 'estado', 'categoria', 'descripcion', 'hashtags'];
function ziFaltantes() {
  try {
    return getDB().filter(p => !p.vendido && (p.imagenes || []).some(u => /res\.cloudinary\.com/.test(u))
      && (!p.marca || !p.talla || !p.estado || !(p.categorias || []).length || !String(p.descripcion || '').trim()));
  } catch { return []; }
}
function ziCompletarAbrir() {
  const lista = ziFaltantes();
  ZI.modoTrabajo = 'completar';
  ZI.grupos = lista.map(p => ({
    id: ZI.sig++, prendaId: p.id, estado: 'listo', fotos: [],
    subidas: (p.imagenes || []).filter(u => /res\.cloudinary\.com/.test(u)),
    antes: { nombre: p.nombre, marca: p.marca || '', talla: p.talla || '', estado: p.estado || '', categoria: (p.categorias || [])[0] || '', descripcion: p.descripcion || '', hashtags: p.hashtags || '', precio: p.precio_venta },
    f: {},
  }));
  ZI.paso = 'revisar'; ziPintar(); ziCorrer();
}

// v51: también se puede soltar una carpeta completa (con subcarpetas)
async function ziSoltar(ev) {
  ev.preventDefault(); document.getElementById('ziDrop')?.classList.remove('sobre');
  const items = [...(ev.dataTransfer.items || [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!items.some(e => e.isDirectory)) return ziElegir(ev.dataTransfer.files);
  const archivos = [];
  const leer = async e => {
    if (e.isFile) { const f = await new Promise((ok, mal) => e.file(ok, mal)).catch(() => null); if (f) { f._ruta = e.fullPath.replace(/^\//, ''); archivos.push(f); } return; }
    if (!e.isDirectory) return;
    const r = e.createReader();
    for (;;) { const lote = await new Promise((ok, mal) => r.readEntries(ok, mal)).catch(() => []); if (!lote.length) break; for (const x of lote) await leer(x); }
  };
  for (const e of items) await leer(e);
  ziElegir(archivos);
}

// v52: abre ZIP, carpetas o fotos y devuelve las fotos nuevas (sin repetidas, ni las que ya están en `ya`)
async function ziLeerArchivos(archivos, ya = new Set()) {
    let fotos = [];
    ZI.saltadas = { cifradas: 0, danadas: 0, formato: 0 };
    let rar = 0;
    for (const a of archivos) {
      if (/^\.|^__MACOSX|\/\._/.test(a._ruta || a.webkitRelativePath || a.name) || /^\._/.test(a.name)) continue;   // basura de Mac
      if (/\.(rar|7z|tar|gz)$/i.test(a.name)) { rar++; continue; }
      const ruta = a._ruta || a.webkitRelativePath || '';
      const carpeta = ruta.includes('/') ? ruta.slice(0, ruta.lastIndexOf('/')) : '';
      if (/\.zip$/i.test(a.name) || a.type.includes('zip')) fotos.push(...await ziLeerZip(a));
      else if (a.type.startsWith('image/') || ZI_IMG.test(a.name)) fotos.push({ nombre: ruta || a.name, base: a.name, carpeta, t: a.lastModified || 0, blob: a });
    }
    if (!fotos.length && rar) throw new Error('Los archivos .rar no se pueden abrir aquí. Toca "Elegir una carpeta" y escoge la carpeta con las fotos (o comprímela como ZIP: clic derecho → Enviar a → Carpeta comprimida).');
    if (!fotos.length) throw new Error('No encontré fotos (JPG, PNG, WEBP o HEIC) en lo que elegiste.');
    if (rar) toast(`${rar} archivo(s) .rar no se pudieron abrir; usa ZIP o elige la carpeta`, 'alerta');
    // Huella de cada foto: quita repetidas y evita volver a subir lo ya subido
    const vistas = new Set(ya), subidas = ziMapaSubidas(); let repetidas = 0;
    for (const f of fotos) f.huella = await ziHuella(f.blob);
    fotos = fotos.filter(f => { if (f.huella && vistas.has(f.huella)) { repetidas++; return false; } vistas.add(f.huella); return true; });
    if (repetidas) toast(`Quité ${repetidas} foto(s) repetida(s)`);
    const sz = ZI.saltadas, nSalt = sz.cifradas + sz.danadas + sz.formato;
    if (nSalt) toast(`${nSalt} foto(s) del ZIP no se pudieron abrir y se saltaron${sz.cifradas ? ' (tienen contraseña)' : ''}`);
    fotos.forEach(f => { f.k = ++ZI.kFoto; f.heic = /\.(heic|heif)$/i.test(f.base); f.url = URL.createObjectURL(f.blob); if (f.huella && subidas[f.huella]) f.nube = subidas[f.huella]; });
    // Nombre del lote (para encontrarlo en Borradores): el ZIP o la carpeta, con la fecha
    const a0 = archivos.find(a => !/\.(rar|7z|tar|gz)$/i.test(a.name)) || archivos[0];
    const raiz = String(a0?._ruta || a0?.webkitRelativePath || '').split('/')[0] || (fotos.length === 1 || !/\.zip$/i.test(a0?.name || '') ? 'Fotos' : String(a0.name).replace(/\.[^.]+$/, ''));
    const lote = `${raiz} · ${new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`;
    fotos.forEach(f => { f.lote = lote; });
    return fotos;
}

async function ziElegir(lista) {
  const archivos = [...(lista || [])]; if (!archivos.length) return;
  const zona = document.getElementById('ziLeyendo');
  if (zona) zona.innerHTML = '<div class="zi-cargando"><span class="zi-spin"></span>Abriendo fotos…</div>';
  try {
    const fotos = await ziLeerArchivos(archivos);
    ZI.lote = fotos[0]?.lote || '';
    ZI.modoTrabajo = 'nuevas';
    ZI.fotos = fotos;
    fotos.forEach(f => ziSubirFoto(f).catch(() => {}));      // ya empiezan a subir mientras agrupas
    ZI.grupos = ziAgrupar(fotos);
    ZI.paso = 'agrupar';
    ziPintar();
    // v50: si vienen juntas (una sola carpeta), la IA ve cada foto y las separa en prendas
    if (!ZI.ia) await iaEstado();
    if (ziConvieneSepararIA()) ziSepararIA();
  } catch (e) {
    if (zona) zona.innerHTML = `<div class="zi-error">${escAdmin(e.message)}</div>`;
  }
}

function ziContinuar() {
  const g = ZI.pendiente; ZI.pendiente = null;
  Object.assign(ZI, g.opciones || {});
  ZI.grupos = g.grupos.map(x => ({ ...x, fotos: (x.subidas || []).map(u => ({ url: u.replace('/upload/', '/upload/c_fill,w_240,h_300,q_auto,f_auto/'), nube: u })) }));
  ZI.sig = Math.max(0, ...ZI.grupos.map(x => x.id)) + 1;
  ZI.paso = 'revisar'; ziPintar();
  if (ZI.grupos.some(x => x.agente?.estado === 'cola')) ziAgenteCorrer();
}
function ziDescartar() { localStorage.removeItem(ZI_GUARDADO); ZI.pendiente = null; ziPintar(); }

// ── Paso 2 ───────────────────────────────────────────────────
function ziVistaAgrupar() {
  const nFotos = ZI.grupos.reduce((t, g) => t + g.fotos.length, 0);
  const heic = ZI.grupos.some(g => g.fotos.some(f => f.heic));
  const modoTxt = { carpetas: 'una prenda por carpeta', hora: `por hora de la foto (más de ${ZI.espera} s entre fotos = otra prenda)`, cadaN: `cada ${ZI.cadaN} fotos`, cada1: 'cada foto es una prenda', ia: 'por la IA (vio cada foto)' }[ZI.modoReal] || '';
  const sep = ZI.separando;
  const dudosas = ZI.modoReal === 'ia' ? ZI.grupos.filter(g => g.iaDuda).length : 0;
  return `
    <div class="zi-barra">
      <div>${sep ? `<b>${ZI.fotos?.length || nFotos} fotos</b> <small>La IA las está separando en prendas…</small><small id="ziSubidasTxt" hidden></small>`
        : `<b>${ZI.grupos.length} prenda${ZI.grupos.length === 1 ? '' : 's'}</b> · ${nFotos} fotos <small>Agrupadas ${modoTxt}</small><small id="ziSubidasTxt"></small>`}</div>
      <div class="zi-fila">
        ${sep ? '' : `<label class="zi-btn zi-agregar">＋ Agregar más fotos<input type="file" accept=".zip,application/zip,image/*,.heic,.heif" multiple hidden onchange="ziAgregarFotos(this.files); this.value=''"></label>`}
        <select onchange="ziReagrupar(this.value)" aria-label="Cómo agrupar">
          <option value="">Agrupar de otra forma…</option>
          ${ZI.ia?.activa ? '<option value="ia">Separar con IA (ve cada foto)</option>' : ''}
          <option value="carpetas">Una prenda por carpeta</option>
          <option value="hora:45">Por hora (45 s entre prendas)</option>
          <option value="hora:90">Por hora (90 s)</option>
          <option value="hora:180">Por hora (3 min)</option>
          <option value="cadaN:2">Cada 2 fotos</option>
          <option value="cadaN:3">Cada 3 fotos</option>
          <option value="cadaN:4">Cada 4 fotos</option>
          <option value="cadaN:5">Cada 5 fotos</option>
          <option value="cada1">Cada foto es una prenda</option>
        </select>
      </div>
    </div>
    ${heic && !sep && ZI.fotos?.some(f => f.heic && !f.nube) ? '<div class="zi-aviso suave" id="ziAvisoHeic">Hay fotos HEIC (iPhone): este navegador no las muestra directo, así que cada una aparece en cuanto termina de subir.</div>' : ''}
    ${sep ? ziSeparandoHtml(sep) : ''}
    ${!sep && dudosas ? `<div class="zi-aviso suave">La IA separó tus fotos en ${ZI.grupos.length} prendas. <b>${dudosas} fila${dudosas === 1 ? '' : 's'} con "revisar"</b>: ahí no estaba tan segura; confirma que cada fila sea una sola prenda.</div>` : ''}
    <div ${sep ? 'hidden' : ''}>
    <p class="zi-nota">Revisa que cada fila sea una sola prenda. Toca <b>✂</b> en una foto para que desde ahí empiece otra prenda, o <b>Unir</b> para juntar una fila con la de arriba.<br>
      <b>Para cambiar el orden:</b> arrastra el número de la prenda (o usa ▲ ▼). Las fotos también se arrastran: la primera es la portada, y puedes pasar una foto a otra prenda. En el celular, mantén el dedo sobre la foto un momento y luego muévela.</p>
    <div class="zi-grupos" id="ziGrupos">${ZI.grupos.map((g, gi) => `
      <div class="zi-grupo${ZI.resalta === g.id ? ' zi-resalta' : ''}" data-gi="${gi}">
        <div class="zi-mover">
          <button class="zi-flecha" onclick="ziMoverGrupo(${gi},${gi - 1})" ${gi === 0 ? 'disabled' : ''} aria-label="Subir prenda ${gi + 1}" title="Subir">▲</button>
          <div class="zi-grupo-n zi-mango" onpointerdown="ziArrastrar(event,'grupo',${gi})" title="Arrastra para mover la prenda" aria-label="Prenda ${gi + 1}: arrastra para moverla">${gi + 1}</div>
          <button class="zi-flecha" onclick="ziMoverGrupo(${gi},${gi + 1})" ${gi === ZI.grupos.length - 1 ? 'disabled' : ''} aria-label="Bajar prenda ${gi + 1}" title="Bajar">▼</button>
        </div>
        <div class="zi-grupo-cuerpo">
        ${g.iaNombre || g.iaDuda ? `<div class="zi-grupo-ia">${g.iaNombre ? escAdmin(g.iaNombre) : ''}${g.iaDuda ? ` <span class="zi-duda">${g.iaX ? 'no parece ropa' : 'revisar'}</span>` : ''}</div>` : ''}
        <div class="zi-tiras">${g.fotos.map((f, fi) => `
          <figure class="zi-foto" data-gi="${gi}" data-fi="${fi}" onpointerdown="ziArrastrar(event,'foto',${gi},${fi})" oncontextmenu="return false">
            ${fi === 0 && g.fotos.length > 1 ? '<span class="zi-portada">Portada</span>' : ''}
            ${ziFotoHtml(f)}
            <div class="zi-foto-acc">
              ${fi > 0 ? `<button onclick="ziPartir(${gi},${fi})" title="Desde aquí es otra prenda" aria-label="Separar aquí">✂</button>` : ''}
              <button onclick="ziQuitarFoto(${gi},${fi})" title="Quitar foto" aria-label="Quitar foto">✕</button>
            </div>
          </figure>`).join('')}
        </div>
        </div>
        <div class="zi-grupo-acc">
          ${gi > 0 ? `<button class="zi-btn mini" onclick="ziUnir(${gi})">Unir ↑</button>` : ''}
          <button class="zi-btn mini" onclick="ziQuitarGrupo(${gi})">Quitar</button>
        </div>
      </div>`).join('')}
    </div>
    </div>
    <div class="zi-opciones">
      ${ziCalidadHtml()}
      <label class="zi-check"><input type="checkbox" ${ZI.buscar ? 'checked' : ''} onchange="ZI.buscar=this.checked;ziPrefs()"> <span><b>Buscar precios en internet</b><small>La IA revisa cuánto se vende usada en eBay, Grailed, Mercado Libre… Tarda un poco más y cuesta ~1 centavo de dólar extra por prenda.</small></span></label>
    </div>
    <div class="zi-opciones">
      <label class="zi-check"><input type="checkbox" id="ziOpInvestigar" ${ZI.investigarRaras ? 'checked' : ''} onchange="ZI.investigarRaras=this.checked;ziPrefs()"> <span><b>Investigar a fondo las piezas raras</b><small>Como un tasador: el agente fecha la prenda por sus etiquetas, revisa si es auténtica y busca ventas reales (eBay, Grailed, Mercado Libre…) para que no la des barata. ~10 centavos de dólar (unos $2 pesos) por pieza rara.</small></span></label>
      <label class="zi-check"><input type="checkbox" id="ziOpCatalogo" ${ZI.crearCatalogo ? 'checked' : ''} onchange="ZI.crearCatalogo=this.checked;ziPrefs()"> <span><b>Crear marcas y categorías nuevas</b><small>Si la IA encuentra una marca o un tipo de prenda que no tienes (ej. Stüssy, Jerseys), se agrega solo a tu catálogo al guardar.</small></span></label>
    </div>
    <div class="zi-fila fin">
      <button class="zi-btn" onclick="ziCancelarSeparar(true);ZI.paso='elegir';ziPintar()">Atrás</button>
      <button class="zi-btn negro grande" onclick="ziEmpezar()" ${ZI.grupos.length && !sep ? '' : 'disabled'}>${ZI.ia?.activa ? `Subir y analizar ${ZI.grupos.length} prenda${ZI.grupos.length === 1 ? '' : 's'} con IA` : `Subir ${ZI.grupos.length} prenda${ZI.grupos.length === 1 ? '' : 's'} (llenar a mano)`}</button>
    </div>`;
}

function ziCalidadHtml() {
  const op = [
    ['ahorro', 'Ahorro', 'Solo el modelo rápido. ~0.05 centavos de dólar por prenda.'],
    ['auto', 'Automático', 'Rápido primero; si duda de la marca o el precio, revisa con el preciso. Recomendado.'],
    ['maxima', 'Máxima precisión', 'Siempre el modelo preciso. ~0.5–1 centavo de dólar por prenda.'],
  ];
  return `<div class="zi-calidad" role="radiogroup" aria-label="Calidad de la IA">${op.map(([k, t, d]) => `
    <label class="${ZI.calidad === k ? 'on' : ''}"><input type="radio" name="ziCal" value="${k}" ${ZI.calidad === k ? 'checked' : ''} onchange="ZI.calidad='${k}';ziPrefs();ziPintar()">
      <b>${t}</b><small>${d}</small></label>`).join('')}</div>`;
}

setInterval(() => { if (ZI.paso === 'agrupar') { ziPintarSubidas(); ziPintarSeparando(); } }, 1000);

function ziReagrupar(v) {
  if (!v) return;
  if (v === 'ia') return ziSepararIA();
  ziCancelarSeparar(true);
  const [m, n] = v.split(':');
  ZI.modo = m;
  if (m === 'hora') ZI.espera = Number(n);
  if (m === 'cadaN') ZI.cadaN = Number(n);
  ZI.grupos = ziAgrupar(ZI.fotos);
  ziPintar();
}
function ziPartir(gi, fi) {
  const g = ZI.grupos[gi];
  const nuevo = { id: ZI.sig++, fotos: g.fotos.splice(fi), subidas: [], estado: 'listo', f: {} };
  ZI.grupos.splice(gi + 1, 0, nuevo); ziPintar();
}
function ziUnir(gi) {
  ZI.grupos[gi - 1].fotos.push(...ZI.grupos[gi].fotos);
  if (ZI.grupos[gi - 1].fotos.length > 10) toast('Instagram acepta máx. 10 fotos por post; las demás solo saldrán en la tienda');
  ZI.grupos.splice(gi, 1); ziPintar();
}
function ziQuitarFoto(gi, fi) {
  ZI.grupos[gi].fotos.splice(fi, 1);
  if (!ZI.grupos[gi].fotos.length) ZI.grupos.splice(gi, 1);
  ziPintar();
}
function ziQuitarGrupo(gi) { ZI.grupos.splice(gi, 1); ziPintar(); }

// ── Cambiar el orden de prendas y fotos (mouse y dedo) ───────
// El orden de aquí es el orden en que se guardan y se publican en Instagram.
function ziMoverGrupo(de, a) {
  if (ZI.paso !== 'agrupar' || a < 0 || a >= ZI.grupos.length || de === a || !ZI.grupos[de]) return;
  const [g] = ZI.grupos.splice(de, 1);
  ZI.grupos.splice(a, 0, g);
  ziResaltar(g.id);
}
function ziMoverFoto(gi, fi, gj, pos) {
  const origen = ZI.grupos[gi], destino = ZI.grupos[gj];
  if (ZI.paso !== 'agrupar' || !origen || !destino || !origen.fotos[fi]) return;
  if (gi === gj && (pos === fi || pos === fi + 1)) return;            // quedó igual
  const [f] = origen.fotos.splice(fi, 1);
  if (gi === gj && pos > fi) pos--;
  destino.fotos.splice(Math.max(0, Math.min(pos, destino.fotos.length)), 0, f);
  origen.ordenManual = destino.ordenManual = true;       // v49: la IA ya no cambia la portada que elegiste
  if (!origen.fotos.length) ZI.grupos.splice(gi, 1);
  if (gi !== gj && destino.fotos.length > 10) toast('Instagram acepta máx. 10 fotos por post; las demás solo saldrán en la tienda');
  ziResaltar(destino.id);
}
function ziResaltar(id) {
  ZI.resalta = id; ziPintar();
  clearTimeout(ZI.resaltaT);
  ZI.resaltaT = setTimeout(() => { ZI.resalta = null; document.querySelectorAll('.zi-resalta').forEach(e => e.classList.remove('zi-resalta')); }, 1200);
  // que la prenda movida quede a la vista
  const i = ZI.grupos.findIndex(g => g.id === id);
  document.querySelector(`#ziGrupos .zi-grupo[data-gi="${i}"]`)?.scrollIntoView({ block: 'nearest' });
}

function ziArrastrar(e, tipo, gi, fi) {
  if (ZI.paso !== 'agrupar' || (e.button !== undefined && e.button > 0) || ZI.arrastre) return;
  if (tipo === 'foto' && e.target.closest('button')) return;           // ✂ y ✕ siguen funcionando
  const el = e.currentTarget, cuerpo = document.getElementById('ziCuerpo'), capa = document.getElementById('ziModal') || document.body;
  const dedo = e.pointerType === 'touch' || e.pointerType === 'pen';
  const espera = dedo && tipo === 'foto';                              // en foto con dedo: mantener presionado (si no, se desplaza normal)
  const x0 = e.clientX, y0 = e.clientY;
  const A = ZI.arrastre = { activo: false, x: x0, y: y0, destino: null };
  let fantasma = null, marca = null, timer = null, raf = 0;

  const empezar = () => {
    if (A.activo || ZI.arrastre !== A) return;
    A.activo = true;
    const r = el.getBoundingClientRect();
    A.dx = A.x - r.left; A.dy = A.y - r.top;
    fantasma = (tipo === 'grupo' ? el.closest('.zi-grupo') : el).cloneNode(true);
    const rf = (tipo === 'grupo' ? el.closest('.zi-grupo') : el).getBoundingClientRect();
    if (tipo === 'grupo') { A.dx = A.x - rf.left; A.dy = A.y - rf.top; }
    fantasma.classList.add('zi-fantasma'); fantasma.removeAttribute('id');
    fantasma.style.width = rf.width + 'px'; fantasma.style.height = rf.height + 'px';
    capa.appendChild(fantasma);
    (tipo === 'grupo' ? el.closest('.zi-grupo') : el).classList.add('zi-origen');
    marca = document.createElement('div'); marca.className = tipo === 'grupo' ? 'zi-marca-fila' : 'zi-marca-foto';
    document.body.classList.add('zi-moviendo');
    try { navigator.vibrate?.(12); } catch {}
    colocar(); bucle();
  };
  const colocar = () => {
    if (!fantasma) return;
    fantasma.style.transform = `translate(${A.x - A.dx}px, ${A.y - A.dy}px)`;
    A.destino = null; marca.remove();
    if (tipo === 'grupo') {
      const filas = [...document.querySelectorAll('#ziGrupos > .zi-grupo')];
      if (!filas.length) return;
      let i = filas.findIndex(f => { const r = f.getBoundingClientRect(); return A.y < r.top + r.height / 2; });
      if (i < 0) i = filas.length;
      A.destino = { pos: i };
      const ref = filas[Math.min(i, filas.length - 1)].getBoundingClientRect(), cont = document.getElementById('ziGrupos').getBoundingClientRect();
      Object.assign(marca.style, { left: cont.left + 'px', width: cont.width + 'px', top: (i < filas.length ? ref.top - 6 : ref.bottom + 4) + 'px' });
      capa.appendChild(marca);
    } else {
      const bajo = document.elementFromPoint(A.x, A.y);
      const foto = bajo?.closest?.('#ziGrupos .zi-foto');
      const fila = bajo?.closest?.('#ziGrupos .zi-grupo');
      if (foto) {
        const r = foto.getBoundingClientRect(), gj = +foto.dataset.gi, fj = +foto.dataset.fi, despues = A.x > r.left + r.width / 2;
        A.destino = { gj, pos: fj + (despues ? 1 : 0) };
        Object.assign(marca.style, { left: (despues ? r.right + 1 : r.left - 5) + 'px', top: r.top + 'px', height: r.height + 'px' });
        capa.appendChild(marca);
      } else if (fila) {
        const gj = +fila.dataset.gi, ultimas = fila.querySelectorAll('.zi-foto'), ult = ultimas[ultimas.length - 1];
        A.destino = { gj, pos: ZI.grupos[gj]?.fotos.length ?? 0 };
        if (ult) { const r = ult.getBoundingClientRect(); Object.assign(marca.style, { left: r.right + 1 + 'px', top: r.top + 'px', height: r.height + 'px' }); capa.appendChild(marca); }
      }
    }
  };
  // Desplazar solo la lista si el dedo/mouse llega a la orilla
  const bucle = () => {
    if (!A.activo) return;
    const r = cuerpo?.getBoundingClientRect();
    if (r) {
      const m = 70, v = A.y < r.top + m ? -(r.top + m - A.y) : A.y > r.bottom - m ? A.y - (r.bottom - m) : 0;
      if (v) { cuerpo.scrollTop += Math.max(-24, Math.min(24, v / 3)); colocar(); }
    }
    if (tipo === 'foto') {
      const tira = document.elementFromPoint(A.x, A.y)?.closest?.('.zi-tiras');
      if (tira) { const t = tira.getBoundingClientRect(); const h = A.x < t.left + 40 ? -10 : A.x > t.right - 40 ? 10 : 0; if (h && tira.scrollWidth > tira.clientWidth) { tira.scrollLeft += h; colocar(); } }
    }
    raf = requestAnimationFrame(bucle);
  };
  const mover = ev => {
    A.x = ev.clientX; A.y = ev.clientY;
    if (!A.activo) {
      if (Math.hypot(A.x - x0, A.y - y0) > 8) { if (espera) return terminar(false); empezar(); }
      return;
    }
    ev.preventDefault(); colocar();
  };
  const terminar = (soltar) => {
    clearTimeout(timer); cancelAnimationFrame(raf);
    removeEventListener('pointermove', mover); removeEventListener('pointerup', alSoltar); removeEventListener('pointercancel', alCancelar);
    removeEventListener('keydown', alTecla, true);
    fantasma?.remove(); marca?.remove();
    document.body.classList.remove('zi-moviendo');
    document.querySelectorAll('.zi-origen').forEach(x => x.classList.remove('zi-origen'));
    const fue = A.activo, d = A.destino;
    ZI.arrastre = null;
    if (fue) { ZI.ignorarClic = Date.now(); }
    if (!soltar || !fue || !d) return;
    if (tipo === 'grupo') { const a = d.pos > gi ? d.pos - 1 : d.pos; if (a !== gi) ziMoverGrupo(gi, a); }
    else ziMoverFoto(gi, fi, d.gj, d.pos);
  };
  const alSoltar = () => terminar(true);
  const alCancelar = () => terminar(false);
  const alTecla = ev => { if (ev.key === 'Escape' && A.activo) { ev.stopPropagation(); terminar(false); } };

  addEventListener('pointermove', mover, { passive: false });
  addEventListener('pointerup', alSoltar);
  addEventListener('pointercancel', alCancelar);
  addEventListener('keydown', alTecla, true);
  if (espera) timer = setTimeout(empezar, 300);
  else if (tipo === 'grupo') e.preventDefault();                       // el número no selecciona texto
}
// después de arrastrar, que no cuente como clic en ✂ / ✕
addEventListener('click', e => { if (ZI.ignorarClic && Date.now() - ZI.ignorarClic < 350 && e.target.closest?.('#ziGrupos')) { e.stopPropagation(); e.preventDefault(); } }, true);

// ── Paso 3: subir + IA ───────────────────────────────────────
const ziDataUrl = (blob, nombre = '') => new Promise((ok, err) => {
  // Algunas computadoras no le ponen tipo a las HEIC: se toma de la extensión
  if (!String(blob.type || '').startsWith('image/')) blob = new Blob([blob], { type: ziTipo(nombre || 'foto.jpg') });
  const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => err(new Error('No se pudo leer la foto')); r.readAsDataURL(blob);
});

function ziCategorias() {
  try { return catalogoVisible(getCats()).map(c => c.nombre).filter(Boolean); } catch { return []; }
}

async function ziEmpezar() {
  ZI.paso = 'revisar'; ziPintar();
  ziCorrer();
}

async function ziCorrer() {
  if (ZI.corriendo) return;
  ZI.corriendo = true; ZI.pausa = false;
  window.addEventListener('beforeunload', ziAntesDeSalir);
  // v44: lo que falla por algo pasajero (IA saturada, sin internet, el servidor tardó)
  // se vuelve a intentar solo hasta 3 veces, con espera creciente.
  const libre = g => (g.estado === 'listo' || g.estado === 'reintentar') && !g.tomado;
  const cola = () => ZI.grupos.find(g => libre(g) && !(g.esperaHasta > Date.now()));
  const trabajador = async () => {
    while (!ZI.pausa) {
      await ziEsperarInternet();
      const g = cola();
      if (!g) {
        const esperando = ZI.grupos.filter(x => libre(x) && x.esperaHasta > Date.now());
        if (!esperando.length) break;
        await ziDormir(Math.min(...esperando.map(x => x.esperaHasta)) - Date.now() + 50);
        continue;
      }
      g.tomado = true;
      try { await ziProcesar(g); g.intentos = 0; g.esperaHasta = 0; g.aviso = ''; }
      catch (e) { ziFallo(g, e); }
      g.tomado = false;
      ziGuardarLocal(); ziPintarTarjeta(g); ziPintarPie();
      if (/saldo|no es válida|Falta configurar/i.test(g.error || '')) { ZI.pausa = true; toast(g.error); if (/saldo/i.test(g.error)) ziSaldoRefrescar().catch(() => {}); }
    }
  };
  await Promise.all([trabajador(), trabajador()]);
  ZI.corriendo = false;
  window.removeEventListener('beforeunload', ziAntesDeSalir);
  ziPintarPie();
  const listos = ZI.grupos.filter(g => g.estado === 'hecho').length;
  if (!ZI.pausa && ZI.paso !== 'sesion') toast(`Listo: ${listos} prenda(s) para revisar`);
  ziSaldoRefrescar().catch(() => {});
}
function ziFallo(g, e) {
  g.intentos = (g.intentos || 0) + 1;
  if (ziReintentable(e) && g.intentos <= 3) {
    g.estado = 'reintentar'; g.error = '';
    g.esperaHasta = Date.now() + (ZI.esperasReintento || [4000, 12000, 30000])[g.intentos - 1];
    g.aviso = `${ziErrorHumano(e).replace(/ Toca Reintentar\.?$/, '')} Se vuelve a intentar sola (${g.intentos} de 3)…`;
  } else {
    g.estado = 'error'; g.esperaHasta = 0; g.aviso = '';
    g.error = ziErrorHumano(e);
  }
}
function ziReintentarTodas() {
  ZI.grupos.filter(g => g.estado === 'error').forEach(g => { g.estado = 'reintentar'; g.error = ''; g.intentos = 0; g.esperaHasta = 0; ziPintarTarjeta(g); });
  ziCorrer();
}
function ziAntesDeSalir(e) { e.preventDefault(); e.returnValue = ''; }
function ziPausar() { ZI.pausa = true; toast('Se detiene al terminar las que van'); ziPintarPie(); }

async function ziProcesar(g) {
  // 1 · Subir fotos (las que falten)
  if (g.subidas.length < g.fotos.length) {
    g.estado = 'subiendo'; ziPintarTarjeta(g);
    for (let i = g.subidas.length; i < g.fotos.length; i++) {
      g.subidas.push(await ziSubirFoto(g.fotos[i]));
      ziPintarTarjeta(g);
    }
    ziGuardarLocal();                                                // v52: ya es borrador aunque la IA falle o cierres
  }
  // ¿Estas fotos ya son de una prenda guardada? (mismo ZIP subido dos veces)
  if (!g.antes && !g.revisadaRepetida) {
    g.revisadaRepetida = true;
    try {
      const urls = new Set(g.subidas);
      const p = getDB().find(x => (x.imagenes || []).some(u => urls.has(u)));
      if (p) { g.repetida = { id: p.id, nombre: p.nombre, vendido: !!p.vendido }; g.f.incluir = false; }
    } catch {}
  }
  // 2 · IA (v47: una prenda que ya registraste no se vuelve a pagar)
  if (g.repetida && !g.reanalizar) { g.f = { incluir: false, ...g.f }; g.estado = 'hecho'; g.error = ''; return; }
  if (ZI.ia?.activa) {
    g.estado = 'analizando'; ziPintarTarjeta(g);
    const a = g.antes;
    const r = await iaAnalizar({
      imagenes: g.subidas.slice(0, 8),
      huellas: g.fotos.length ? g.fotos.slice(0, 8).map(f => f.huella).filter(Boolean) : undefined,
      pista: a ? [a.nombre, a.marca && `marca ${a.marca}`, a.talla && `talla ${a.talla}`, a.estado && `estado ${a.estado}`].filter(Boolean).join(', ') : '',
      calidad: g.forzarCalidad || (a ? (ZI.calidad === 'maxima' ? 'maxima' : 'auto') : ZI.calidad),
      agenteDespues: !a && !g.forzarCalidad,
    });
    g.forzarCalidad = null;
    g.ia = r;
    ZI.gastoSesion = (ZI.gastoSesion || 0) + (r.costoUSD || 0);
    ziGastar(r.costoUSD);
    if (a) {
      // Completar: solo lo que falta; nombre y precio se quedan
      g.f = { incluir: true, nombre: a.nombre, precio: a.precio };
      for (const k of ZI_CAMPOS) g.f[k] = a[k] || r[k] || '';
      g.estado = 'hecho'; g.error = '';
      return;
    }
    if (r.portada > 0 && !g.antes && !g.ordenManual) { const [p] = g.subidas.splice(r.portada, 1); g.subidas.unshift(p); const [fp] = g.fotos.splice(r.portada, 1); g.fotos.unshift(fp); }
    const deIA = {
      nombre: r.nombre, marca: r.marca, categoria: r.categoria || (ZI.crearCatalogo ? r.categoriaNueva || '' : ''), talla: r.talla, estado: r.estado,
      precio: r.precioSugerido || '', descripcion: r.descripcion, hashtags: r.hashtags,
    };
    g.f = {
      incluir: r.esPrenda !== false && !g.repetida, costo: '',
      ...deIA,
      ...(g.reanalizar ? {} : g.f),   // lo que ya hubieras escrito a mano no se pisa
      ...(g.reanalizar ? { costo: g.f.costo ?? '' } : {}),
    };
    g.iaOriginal = deIA;
    g.reanalizar = false;
    // v45: las que parecen raras se investigan a fondo solas (una por una, sin frenar a las demás)
    if (ZI.investigarRaras && (r.rareza || 0) >= 3 && r.esPrenda !== false && !g.agente && !g.repetida) { g.agente = { estado: 'cola' }; setTimeout(ziAgenteCorrer, 0); }
  } else g.f = { incluir: true, ...g.f };
  g.estado = 'hecho'; g.error = '';
}

// ── v52 · Borradores en el servidor ──────────────────────────
// Cada prenda con sus fotos ya subidas queda como borrador (Panel → Borradores) hasta que se guarda.
const ziIdBorrador = () => (crypto?.randomUUID ? crypto.randomUUID() : 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
const ziBorradorDe = g => ({ id: g.bid, fotos: g.subidas, f: g.f, ia: g.ia || null, agente: g.agente?.estado === 'hecho' ? g.agente : null,
  iaOriginal: g.iaOriginal || null, lote: g.lote || ZI.lote || '', ordenManual: !!g.ordenManual });
function ziBorradoresSync(ms = 1200) { clearTimeout(ZI._bT); ZI._bT = setTimeout(ziBorradoresEnviar, ms); }
async function ziBorradoresEnviar() {
  if (ZI._bEnviando) { ZI._bOtra = true; return; }
  ZI._bEnviando = true;
  let cambio = false;
  try {
    const borrar = ZI.grupos.filter(g => g.bid && g.guardada && !g._bBorrado);
    if (borrar.length) {
      await api('/api/acciones?op=b-borrar', { method: 'POST', body: { ids: borrar.map(g => g.bid) } });
      borrar.forEach(g => { g._bBorrado = true; }); cambio = true;
    }
    const cambiados = [];
    for (const g of ZI.grupos) {
      if (g.guardada || g.antes || g.repetida || g.subiendoMas || g.sinBorrador || !g.subidas?.length || g.subidas.length < g.fotos.length) continue;
      if (!g.bid) g.bid = ziIdBorrador();
      const d = ziBorradorDe(g), h = JSON.stringify(d);
      if (h !== g._bHash) cambiados.push([g, d, h]);
    }
    for (let i = 0; i < cambiados.length; i += 50) {
      const parte = cambiados.slice(i, i + 50);
      const r = await api('/api/acciones?op=b-guardar', { method: 'POST', body: { borradores: parte.map(x => x[1]), bazarId: typeof bazarParaNuevas === 'function' ? bazarParaNuevas() : undefined } });
      const ok = new Set(r?.guardados || []);
      parte.forEach(([g, d, h]) => { if (ok.has(d.id)) g._bHash = h; });
      cambio = true;
    }
    ZI._bReintento = 0;
  } catch (e) {
    // Sin internet o el servidor no pudo: se vuelve a intentar sola (lo local no se pierde)
    ZI._bReintento = Math.min(6, (ZI._bReintento || 0) + 1);
    setTimeout(() => ziBorradoresSync(0), 5000 * ZI._bReintento);
  } finally {
    ZI._bEnviando = false;
    if (cambio && typeof brContar === 'function') brContar();
    if (ZI._bOtra) { ZI._bOtra = false; ziBorradoresSync(); }
  }
}

function ziGuardarLocal() {
  ziBorradoresSync();
  try {
    const grupos = ZI.grupos.filter(g => g.subidas.length && !g.guardada).map(({ id, subidas, estado, ia, f, error, prendaId, antes, repetida, agente, iaOriginal, ordenManual, bid, lote }) => ({ id, subidas, estado: estado === 'hecho' ? 'hecho' : 'reintentar', ia, f, error, prendaId, antes, repetida, revisadaRepetida: true, iaOriginal, ordenManual, bid, lote,
      agente: agente?.estado === 'hecho' ? agente : agente ? { estado: 'cola' } : undefined }));
    if (grupos.length) localStorage.setItem(ZI_GUARDADO, JSON.stringify({ en: Date.now(), grupos, opciones: { buscar: ZI.buscar, publicarIG: ZI.publicarIG, ocultas: ZI.ocultas, modoTrabajo: ZI.modoTrabajo } }));
    else localStorage.removeItem(ZI_GUARDADO);
  } catch {}
}

// ── Revisión ─────────────────────────────────────────────────
function ziVistaRevisar() {
  return `${ZI.separando ? ziSeparandoHtml(ZI.separando) : ''}
    ${ZI.modoTrabajo === 'completar' ? '' : `<div class="zi-fila zi-rev-barra">
      <label class="zi-btn zi-agregar">＋ Agregar más prendas<input type="file" accept=".zip,application/zip,image/*,.heic,.heif" multiple hidden onchange="ziAgregarFotos(this.files); this.value=''"></label>
      <small>Se suben, se separan y se analizan como las demás. Todo lo que ya subiste queda en <b>Borradores</b> hasta que lo guardes.</small></div>`}
    ${ZI.modoTrabajo === 'completar' ? '' : ziHerramientas()}
    <div class="zi-revisar" id="ziLista">${ZI.grupos.map(g => `<article class="zi-tarjeta" id="ziT${g.id}">${ziTarjeta(g)}</article>`).join('')}</div>`;
}

// ── Aplicar a todas ──────────────────────────────────────────
const ziEditables = () => ZI.grupos.filter(g => g.estado === 'hecho' && !g.guardada && g.f.incluir !== false);
function ziHerramientas() {
  return `<details class="zi-herr">
    <summary>Aplicar a todas las prendas <small>categoría, estado, costo del lote, ajustar precios…</small></summary>
    <div class="zi-herr-rej">
      <label class="zi-c"><span>Categoría</span><select onchange="ziTodas('categoria', this.value); this.value=''">${ziOpciones(ziCategorias(), '', 'Elegir…')}</select></label>
      <label class="zi-c"><span>Estado</span><select onchange="ziTodas('estado', this.value); this.value=''">${ziOpciones(ESTADOS, '', 'Elegir…')}</select></label>
      <label class="zi-c"><span>Costo de cada una</span><span class="zi-c-fila"><input type="number" min="0" step="10" id="ziCostoC" placeholder="$"><button class="zi-btn mini" onclick="ziTodas('costo', document.getElementById('ziCostoC').value)">Poner</button></span></label>
      <label class="zi-c"><span>Costo total del lote / paca</span><span class="zi-c-fila"><input type="number" min="0" step="10" id="ziCostoL" placeholder="$"><button class="zi-btn mini" onclick="ziRepartirCosto()">Repartir</button></span>
        <small>Se reparte según el precio de cada prenda.</small></label>
      <div class="zi-c"><span>Precios</span><span class="zi-c-fila">
        <button class="zi-btn mini" onclick="ziAjustarPrecios(0.9)">−10%</button><button class="zi-btn mini" onclick="ziAjustarPrecios(1.1)">+10%</button>
        <button class="zi-btn mini" onclick="ziAjustarPrecios(1, 50)">Redondear a $50</button></span></div>
      <div class="zi-c"><span>Si algo salió raro</span><span class="zi-c-fila"><button class="zi-btn mini" onclick="ziReanalizarDudosas()">Revisar las dudosas con IA precisa</button></span></div>
      <div class="zi-c"><span>Agente</span><span class="zi-c-fila"><button class="zi-btn mini" onclick="ziInvestigarTodas()">Investigar todas a fondo</button></span>
        <small>~10 centavos de dólar (unos $2 pesos) por prenda; una por una.</small></div>
    </div>
  </details>`;
}
function ziTodas(k, v) {
  if (v === '' || v == null) return;
  const l = ziEditables(); l.forEach(g => { g.f[k] = v; ziPintarTarjeta(g, true); });
  ziGuardarLocal(); toast(`Listo en ${l.length} prenda(s)`);
}
function ziRepartirCosto() {
  const total = Number(document.getElementById('ziCostoL')?.value); if (!(total > 0)) return toast('Escribe el costo total del lote');
  const l = ziEditables(); const suma = l.reduce((t, g) => t + (Number(g.f.precio) || 0), 0);
  if (!l.length) return;
  let resto = total;
  l.forEach((g, i) => {
    const c = i === l.length - 1 ? resto : Math.round(suma ? total * (Number(g.f.precio) || 0) / suma : total / l.length);
    g.f.costo = Math.max(0, c); resto -= g.f.costo; ziPintarTarjeta(g, true);
  });
  ziGuardarLocal(); toast(`$${total} repartidos entre ${l.length} prenda(s)`);
}
function ziAjustarPrecios(factor, multiplo = 10) {
  const l = ziEditables();
  l.forEach(g => { const p = Number(g.f.precio) || 0; if (p) g.f.precio = Math.max(multiplo, Math.round(p * factor / multiplo) * multiplo); ziPintarTarjeta(g, true); });
  ziGuardarLocal(); ziPintarPie();
}
function ziDudosa(g) { const c = g.ia?.confianza || {}; return g.ia && !/sonnet|opus/.test(g.ia.modelo || '') && ((c.marca ?? 1) < 0.6 || (c.talla ?? 1) < 0.45 || (c.precio ?? 1) < 0.5); }
function ziReanalizar(id) {
  const g = ZI.grupos.find(x => x.id === id); if (!g) return;
  g.forzarCalidad = 'maxima'; g.reanalizar = true; g.estado = 'reintentar'; ziPintarTarjeta(g, true); ziCorrer();
}
function ziReanalizarDudosas() {
  const l = ziEditables().filter(ziDudosa);
  if (!l.length) return toast('No hay prendas dudosas');
  l.forEach(g => { g.forzarCalidad = 'maxima'; g.reanalizar = true; g.estado = 'reintentar'; ziPintarTarjeta(g, true); });
  ziCorrer(); toast(`Revisando ${l.length} prenda(s) con la IA precisa`);
}

// ═════════════════════════════════════════════════════════════
//  v46 · Saldo de la IA (cuánto te queda en Anthropic)
// ═════════════════════════════════════════════════════════════
const ZI_BILLING = 'https://platform.claude.com/settings/billing';
const ziFecha = iso => { try { return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
const ziMiles = n => Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('es-MX');
function ziSaldoHtml() {
  const ia = ZI.ia; if (!ia?.activa || !ia.puedeSaldo) return '';
  const s = ia.saldo, tc = Number(ia.tc) || 0, pr = ia.promedio || { prenda: 0.003, investigacion: 0.1 };
  if (ZI.editandoSaldo || !s) return `<div class="zi-saldo" id="ziSaldo">
    <div class="zi-saldo-cab"><b>${ico('foco', 15)} Saldo de la IA</b>${s ? '<button class="zi-btn mini" onclick="ZI.editandoSaldo=false;ziPintarSaldo()">Cancelar</button>' : ''}</div>
    <p>Escribe el saldo que ves en tu cuenta de Anthropic (<a href="${ZI_BILLING}" target="_blank" rel="noopener noreferrer">platform.claude.com → Billing ↗</a>) y aquí te llevo la cuenta de cuánto te queda con cada prenda.</p>
    <div class="zi-saldo-form"><label>Saldo <span>$</span><input id="ziSaldoUsd" type="number" min="0" step="0.01" inputmode="decimal" placeholder="4.32" value="${s && !ZI.editandoSaldo ? '' : ''}"> USD</label>
      <label>Avisarme con menos de <span>$</span><input id="ziSaldoUmbral" type="number" min="0" step="0.5" inputmode="decimal" value="${escAdmin(s?.umbral ?? 1)}"> USD</label>
      <button class="zi-btn negro" onclick="ziSaldoGuardar()">Guardar saldo</button></div>
  </div>`;
  const pct = s.inicial > 0 ? Math.max(0, Math.min(100, s.queda / s.inicial * 100)) : 0;
  const rinde = s.queda > 0 ? `Alcanza para ~${ziMiles(s.queda / Math.max(0.0005, pr.investigacion))} investigaciones a fondo o ~${ziMiles(s.queda / Math.max(0.0001, pr.prenda))} prendas con la IA rápida.` : '';
  return `<div class="zi-saldo ${s.sinSaldo ? 'agotado' : s.bajo ? 'bajo' : ''}" id="ziSaldo">
    <div class="zi-saldo-cab"><b>${ico('foco', 15)} Saldo de la IA</b><button class="zi-btn mini" onclick="ZI.editandoSaldo=true;ziPintarSaldo()">Actualizar</button></div>
    <div class="zi-saldo-num">$${(s.queda || 0).toFixed(2)} <small>USD</small>${tc ? `<em>≈ ${ziPesos(s.queda * tc)} MXN</em>` : ''}</div>
    <div class="zi-saldo-barra" role="meter" aria-valuemin="0" aria-valuemax="${s.inicial}" aria-valuenow="${s.queda}" aria-label="Saldo que queda"><span style="width:${pct.toFixed(1)}%"></span></div>
    ${s.sinSaldo ? `<p class="zi-saldo-alerta">Anthropic dice que <b>tu cuenta se quedó sin saldo</b>. Recarga en <a href="${ZI_BILLING}" target="_blank" rel="noopener noreferrer">Billing ↗</a> y luego toca "Actualizar".</p>`
      : s.bajo ? `<p class="zi-saldo-alerta">Te queda poco saldo. Recarga en <a href="${ZI_BILLING}" target="_blank" rel="noopener noreferrer">Billing ↗</a> para que no se detenga el registro.</p>` : `<p>${rinde}</p>`}
    <small>Desde ${escAdmin(ziFecha(s.en))} se han gastado $${(s.gastado || 0).toFixed(2)} de $${(s.inicial || 0).toFixed(2)} · ${s.fuente === 'anthropic' ? 'exacto, según el reporte de Anthropic' : 'contado aquí con el costo real de cada uso'}</small>
  </div>`;
}
function ziSaldoMini() {
  const s = ZI.ia?.puedeSaldo && ZI.ia.saldo; if (!s) return '';
  return ` · <span class="zi-saldo-mini ${s.bajo ? 'rojo' : ''}" title="Saldo de la IA en Anthropic">saldo IA ${s.sinSaldo ? 'agotado' : '$' + (s.queda || 0).toFixed(2) + ' USD'}</span>`;
}
function ziPintarSaldo() {
  const el = document.getElementById('ziSaldo'); if (el) el.outerHTML = ziSaldoHtml() || '<div id="ziSaldo"></div>';
  const l = document.getElementById('iaSaldoLinea'); if (l) l.innerHTML = ziSaldoMini().replace(/^ · /, '');
  ziPintarPie();
}
// Cada uso descuenta al momento; el servidor manda la cifra buena al terminar
function ziGastar(usd) {
  const s = ZI.ia?.saldo; if (!s || !(usd > 0)) return;
  s.gastado = (s.gastado || 0) + usd; s.queda = Math.max(0, (s.queda || 0) - usd); s.bajo = s.bajo || s.queda < (s.umbral ?? 1);
  ziPintarSaldo();
}
async function ziSaldoRefrescar() { await iaEstado(true); ziPintarSaldo(); }
async function ziSaldoGuardar() {
  const usdTxt = document.getElementById('ziSaldoUsd')?.value, umbral = document.getElementById('ziSaldoUmbral')?.value;
  if (usdTxt === '' || usdTxt == null) return toast('Escribe tu saldo en dólares, como aparece en Anthropic');
  try {
    const r = await api('/api/acciones?op=ia-saldo', { method: 'POST', body: { usd: usdTxt, umbral } });
    if (ZI.ia) ZI.ia.saldo = r.saldo;
    ZI.editandoSaldo = false; ziPintarSaldo(); toast('Saldo guardado: desde ahora se descuenta cada uso de la IA');
  } catch (e) { toast(ziErrorHumano(e)); }
}

// ═════════════════════════════════════════════════════════════
//  v45 · Agente investigador (tipo tasador) y catálogo nuevo
// ═════════════════════════════════════════════════════════════
const ziNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const ziPesos = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');
const ZI_RAREZA = ['', 'Común', 'Buscada', 'Rara', 'Muy rara', 'Grial'];
function ziRarezaChip(n) {
  n = Math.max(1, Math.min(5, Number(n) || 1));
  return `<span class="zi-rz n${n}" title="Rareza ${n} de 5">${'★'.repeat(n)}${'☆'.repeat(5 - n)} ${ZI_RAREZA[n]}</span>`;
}
async function iaInvestigar({ imagenes, datos, forzar, rareza }) {
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(90000) : undefined;
  return api('/api/acciones?op=ia-agente', { method: 'POST', signal, body: {
    imagenes, datos, forzar: !!forzar, rareza: Number(rareza) || 0, ...iaListas(),
    bazarId: typeof bazarParaNuevas === 'function' ? bazarParaNuevas() : null,
  } });
}
function ziInvestigar(id, forzar) {
  const g = ZI.grupos.find(x => x.id === id); if (!g || !g.subidas.length || g.guardada) return;
  if (['cola', 'investigando'].includes(g.agente?.estado)) return toast('Ya la está investigando');   // doble clic: no se paga dos veces
  g.agente = { estado: 'cola', forzar: !!forzar }; ziPintarTarjeta(g, true); ziAgenteCorrer();
}
function ziInvestigarTodas() {
  const l = ziEditables().filter(g => !g.agente || g.agente.estado === 'error');
  if (!l.length) return toast('Ya están todas investigadas');
  l.forEach(g => { g.agente = { estado: 'cola' }; ziPintarTarjeta(g, true); });
  toast(`El agente va a investigar ${l.length} prenda(s), una por una`); ziAgenteCorrer();
}
// Una a la vez: cada investigación busca en internet y tarda ~20–40 s
async function ziAgenteCorrer() {
  if (ZI.agenteCorriendo) return;
  ZI.agenteCorriendo = true; ziPintarPie();
  try {
    for (let g; (g = ZI.grupos.find(x => x.agente?.estado === 'cola' && !x.guardada));) {
      const forzar = g.agente.forzar;
      // Si mientras esperaba la quitaste ("Guardar" sin marcar) o resultó repetida, no se gasta en ella
      if (!forzar && (g.f?.incluir === false || g.repetida)) { g.agente = null; ziPintarTarjeta(g, true); continue; }
      g.agente = { estado: 'investigando' }; ziPintarTarjeta(g, true); ziPintarPie();
      try {
        const r = await ziConReintentos(() => iaInvestigar({ imagenes: g.subidas.slice(0, 8), datos: { nombre: g.f.nombre, marca: g.f.marca, talla: g.f.talla, estado: g.f.estado }, forzar, rareza: g.ia?.rareza }));
        g.agente = { estado: 'hecho', r };
        ZI.gastoSesion = (ZI.gastoSesion || 0) + (r.costoUSD || 0);
        ziGastar(r.costoUSD);
        ziAplicarAgente(g, r);
      } catch (e) {
        g.agente = { estado: 'error', error: ziErrorHumano(e) };
        if (/saldo|no es válida|Falta configurar/i.test(e?.message || '')) { toast(e.message); ZI.grupos.forEach(x => { if (x.agente?.estado === 'cola') x.agente = null; }); }
      }
      ziGuardarLocal(); ziPintarTarjeta(g, true); ziPintarPie();
    }
  } finally { ZI.agenteCorriendo = false; ziPintarPie(); ziSaldoRefrescar().catch(() => {}); }
}
// Igual que armarDescripcion del servidor (api/_lib/ia.js): texto + detalles + fallas + medidas
function ziDescripcionConDetalles(texto, ia = {}) {
  const det = Array.isArray(ia?.detalles) ? ia.detalles : [], fallas = Array.isArray(ia?.fallas) ? ia.fallas : [];
  const partes = [String(texto || '').trim()].filter(Boolean);
  if (det.length) partes.push(det.map(x => `• ${x}`).join('\n'));
  if (fallas.length) partes.push(`A considerar: ${fallas.map(f => /^\p{Lu}{2}/u.test(f) ? f : f.charAt(0).toLocaleLowerCase('es') + f.slice(1)).join(', ')}.`);
  if (ia?.medidas) partes.push(`📐 ${ia.medidas}`);
  return partes.join('\n\n').slice(0, 1500);
}
// Lo que dijo el agente reemplaza lo de la IA rápida, pero nunca lo que tú escribiste
function ziAplicarAgente(g, r) {
  const o = g.iaOriginal || {}, f = g.f;
  const libre = k => !String(f[k] ?? '').trim() || String(f[k]) === String(o[k] ?? '');
  const cat = r.categoria || (ZI.crearCatalogo ? r.categoriaNueva || '' : '');
  const nuevo = {
    nombre: r.nombre, marca: r.marca, categoria: cat, talla: r.talla, estado: r.estado,
    // v49: el texto del agente, pero sin perder los detalles y fallas que vio la IA rápida
    descripcion: r.descripcion ? ziDescripcionConDetalles(r.descripcion, g.ia) : '', hashtags: r.hashtags, precio: r.precios?.justo || '',
  };
  for (const [k, v] of Object.entries(nuevo)) if (v && libre(k)) f[k] = v;
  g.iaOriginal = { ...o, ...Object.fromEntries(Object.entries(nuevo).filter(([k, v]) => v && f[k] === v)) };
}
function ziUsarPrecio(id, valor) {
  if (id === 'form') { const el = document.getElementById('f_precio'); if (el) el.value = valor; iaPintarAgenteFormulario(); return; }
  const g = ZI.grupos.find(x => x.id === id); if (!g) return;
  g.f.precio = valor; ziGuardarLocal(); ziPintarTarjeta(g, true); ziPintarPie();
}

function ziAgenteHtml(g, enFormulario = false) {
  const a = g.agente, id = enFormulario ? "'form'" : g.id;
  const reinvestigar = enFormulario ? 'iaInvestigarFormulario(true)' : `ziInvestigar(${g.id}, true)`;
  if (!a) return !enFormulario && ZI.ia?.activa && !g.guardada ? `<div class="zi-ag-ofrece"><button class="zi-btn mini" onclick="ziInvestigar(${g.id})">${ico('buscar', 14)} Investigar a fondo</button><small>Fecha, rareza, autenticidad y ventas reales para ponerle el precio correcto.</small></div>` : '';
  if (a.estado === 'cola') return '<div class="zi-ag cargando"><span class="zi-spin"></span> En fila para que el agente la investigue…</div>';
  if (a.estado === 'investigando') return '<div class="zi-ag cargando"><span class="zi-spin"></span> El agente está investigando: leyendo etiquetas, fechando la prenda y buscando ventas reales…</div>';
  if (a.estado === 'error') return `<div class="zi-ag error">${escAdmin(a.error || 'No se pudo investigar.')} <button class="zi-btn mini" onclick="${enFormulario ? 'iaInvestigarFormulario()' : `ziInvestigar(${g.id})`}">Reintentar</button></div>`;
  const r = a.r || {}, p = r.precios || {}, n = r.rareza?.nivel || 1;
  const precioActual = Number(enFormulario ? document.getElementById('f_precio')?.value : g.f?.precio) || 0;
  const barata = precioActual > 0 && p.rapido && precioActual < p.rapido;
  const conf = Math.round((r.confianza || 0) * 100);
  const enlace = c => /^https?:\/\//.test(c.url || '') ? `<a href="${escAdmin(c.url)}" target="_blank" rel="noopener noreferrer nofollow">${escAdmin(c.titulo || c.sitio)}</a>` : `<span>${escAdmin(c.titulo || c.sitio)}</span>`;
  const comps = (r.comparables || []).slice(0, 8);
  return `<details class="zi-ag" ${enFormulario || n >= 3 || barata ? 'open' : ''}>
    <summary><b>${ico('buscar', 15)} Investigación</b> ${ziRarezaChip(n)}${r.epoca?.rango || r.epoca?.decada ? `<span class="zi-ag-chip">${escAdmin(r.epoca.rango || r.epoca.decada)}</span>` : ''}<span class="zi-conf ${conf >= 75 ? 'alta' : conf >= 45 ? 'media' : 'baja'}">Confianza ${conf}%</span></summary>
    ${barata ? `<div class="zi-ag-barata">${ico('alerta', 15)} <b>La estás dando barata.</b> Piezas así se venden en ${ziPesos(p.rapido)}–${ziPesos(p.maximo)} en México.</div>` : ''}
    <div class="zi-ag-precios">${[['rapido', 'Rápido', 'se vende en días'], ['justo', 'Justo', 'recomendado'], ['maximo', 'Máximo', 'para esperar al indicado']].map(([k, t, d]) => p[k] ? `
      <button type="button" class="zi-ag-p ${k === 'justo' ? 'rec' : ''} ${precioActual === p[k] ? 'on' : ''}" onclick="ziUsarPrecio(${id}, ${Number(p[k])})"><small>${t}</small><b>${ziPesos(p[k])}</b><em>${d}</em></button>` : '').join('')}</div>
    ${p.usdMediana ? `<p class="zi-ag-nota">En EE.UU. piezas así se venden en ~$${escAdmin(p.usdMediana)} USD (≈ ${ziPesos(p.mxnEEUU)}, dólar a ${escAdmin(p.tc)}). Para México se sugiere ~${escAdmin(p.pctMexico)} % por ser <b>${escAdmin(ZI_RAREZA[n].toLowerCase())}</b>, ajustado por su estado.</p>` : ''}
    <dl class="zi-ag-datos">
      ${r.modelo ? `<dt>Modelo</dt><dd>${escAdmin(r.modelo)}</dd>` : ''}
      ${r.epoca?.rango || r.epoca?.pistas?.length ? `<dt>Época</dt><dd>${escAdmin([r.epoca.rango, r.epoca.decada && `(${r.epoca.decada})`].filter(Boolean).join(' '))}${r.epoca.pistas?.length ? `<small>${r.epoca.pistas.map(escAdmin).join(' · ')}</small>` : ''}</dd>` : ''}
      ${r.origen || r.material ? `<dt>Hecha</dt><dd>${escAdmin([r.origen, r.material].filter(Boolean).join(' · '))}</dd>` : ''}
      ${r.rareza?.senales?.length ? `<dt>Por qué ${escAdmin(ZI_RAREZA[n].toLowerCase())}</dt><dd>${r.rareza.senales.map(x => `<span class="zi-ag-chip">${escAdmin(x)}</span>`).join('')}</dd>` : ''}
      ${r.autenticidad ? `<dt>Autenticidad</dt><dd><span class="zi-ag-aut ${escAdmin(r.autenticidad.nivel)}">${{ alta: 'Se ve auténtica', media: 'Revisa a detalle', baja: 'Posible réplica' }[r.autenticidad.nivel] || 'Revisa'}</span>${r.autenticidad.notas?.length ? `<small>${r.autenticidad.notas.map(escAdmin).join(' · ')}</small>` : ''}</dd>` : ''}
    </dl>
    ${comps.length ? `<div class="zi-ag-comps"><b>Comparables</b><ul>${comps.map(c => `<li>${enlace(c)}<span class="zi-ag-cm">${escAdmin(c.sitio || '')} · ${c.vendido ? 'vendida' : 'a la venta'}${c.fecha ? ' · ' + escAdmin(c.fecha) : ''}</span><b>${c.moneda === 'MXN' ? ziPesos(c.precio) : `$${escAdmin(c.precio)} ${escAdmin(c.moneda)} <small>≈ ${ziPesos(c.mxn)}</small>`}</b>${c.verificado ? '<em title="Salió en la búsqueda">✓</em>' : '<em class="no" title="No apareció en la búsqueda; no cuenta para el precio">?</em>'}</li>`).join('')}</ul></div>`
      : `<p class="zi-ag-nota">${r.sinBusqueda ? 'Tu cuenta de la IA no permite buscar en internet; el precio sale de lo que sabe la IA y de tu historial.' : 'No encontró ventas de piezas iguales; el precio sale de la IA y de tu historial.'}</p>`}
    ${r.evidencia?.length ? `<ul class="zi-ag-ev">${r.evidencia.map(x => `<li>${escAdmin(x)}</li>`).join('')}</ul>` : ''}
    <div class="zi-ag-pie"><small>${r.desdeMemoria ? 'De memoria · gratis' : `${escAdmin(r.busquedas || 0)} búsqueda(s) · ${r.costoUSD ? usd(r.costoUSD) : ''}`}</small><button type="button" class="zi-btn mini" onclick="${reinvestigar}">Volver a investigar</button></div>
  </details>`;
}

// Marca o categoría que todavía no está en tu catálogo
const ziExisteMarca = m => getBrands().some(b => ziNorm(b.nombre) === ziNorm(m));
const ziExisteCat = c => getCats().some(x => ziNorm(x.nombre) === ziNorm(c));
function ziNuevasHtml(g) {
  const f = g.f, chips = [];
  if (f.marca && !ziExisteMarca(f.marca)) chips.push(`Marca nueva: <b>${escAdmin(f.marca)}</b>`);
  if (f.categoria && !ziExisteCat(f.categoria)) chips.push(`Categoría nueva: <b>${escAdmin(f.categoria)}</b>`);
  if (!chips.length) return '';
  return `<p class="zi-nuevas">${ico('mas', 14)} ${chips.join(' · ')} — ${ZI.crearCatalogo ? 'se agrega a tu catálogo al guardar.' : 'no está en tu catálogo (actívalo en "Crear marcas y categorías nuevas").'}</p>`;
}
async function ziCrearCatalogo(tipo, nombre) {
  const r = await ziConReintentos(() => api('/api/acciones?op=ia-catalogo', { method: 'POST', body: {
    tipo, nombre, bazarId: typeof bazarParaNuevas === 'function' ? bazarParaNuevas() : null } }));
  const listaCat = tipo === 'marca' ? getBrands() : getCats();
  if (!listaCat.some(x => Number(x.id) === Number(r.id))) listaCat.push({ id: r.id, nombre: r.nombre, bazarId: r.bazarId ?? null });
  if (r.creada) {
    (ZI.creadas ||= []).push(`${tipo === 'marca' ? 'marca' : 'categoría'} ${r.nombre}`);
    try { registrarLog?.('catalogo_crear', r.nombre, tipo === 'marca' ? 'Marca (IA)' : 'Categoría (IA)'); } catch {}
    try { if (typeof renderBrandList === 'function' && tipo === 'marca') renderBrandList(); if (typeof renderCatList === 'function' && tipo !== 'marca') renderCatList(); } catch {}
  }
  return r.nombre;
}
async function ziAsegurarCatalogo(f) {
  if (!ZI.crearCatalogo) return;
  if (String(f.marca || '').trim() && !ziExisteMarca(f.marca)) f.marca = await ziCrearCatalogo('marca', String(f.marca).trim());
  else if (f.marca) f.marca = getBrands().find(b => ziNorm(b.nombre) === ziNorm(f.marca))?.nombre || f.marca;
  if (String(f.categoria || '').trim() && !ziExisteCat(f.categoria)) f.categoria = await ziCrearCatalogo('categoria', String(f.categoria).trim());
}

function ziPintarTarjeta(g, forzar) {
  if (ZI.paso === 'sesion') return ziPintarSesionLista();
  const el = document.getElementById('ziT' + g.id);
  if (!el) return;
  // No repintar mientras escribes en esa tarjeta
  if (!forzar && el.contains(document.activeElement) && g.estado === 'hecho' && el.dataset.pintada === 'hecho') return;
  el.innerHTML = ziTarjeta(g); el.dataset.pintada = g.estado;
}

const ziPct = x => Math.round((Number(x) || 0) * 100);
function ziConf(etq, x) {
  if (x == null) return '';
  const n = ziPct(x);
  return `<span class="zi-conf ${n >= 75 ? 'alta' : n >= 45 ? 'media' : 'baja'}" title="Qué tan segura está la IA">${etq} ${n >= 75 ? '✓' : n >= 45 ? '~' : 'revisa'}</span>`;
}

function ziOpciones(lista, valor, vacio = '—', nueva = false) {
  const v = String(valor || '');
  const extra = v && !lista.includes(v) ? `<option value="${escAdmin(v)}" selected>${nueva ? '＋ ' + escAdmin(v) + ' (nueva)' : escAdmin(v)}</option>` : '';
  return `<option value="">${vacio}</option>${extra}${lista.map(o => `<option ${o === v ? 'selected' : ''}>${escAdmin(o)}</option>`).join('')}`;
}
function ziOpcionesTalla(valor) {
  const v = String(valor || '');
  const todas = TALLAS.flatMap(t => t.opciones);
  const extra = v && !todas.includes(v) ? `<option selected>${escAdmin(v)}</option>` : '';
  return `<option value="">—</option>${extra}${TALLAS.map(t => `<optgroup label="${escAdmin(t.grupo)}">${t.opciones.map(o => `<option ${o === v ? 'selected' : ''}>${escAdmin(o)}</option>`).join('')}</optgroup>`).join('')}`;
}

function ziTarjeta(g) {
  const fotos = (g.subidas.length ? g.subidas.map(u => u.replace('/upload/', '/upload/c_fill,w_240,h_300,g_auto,q_auto,f_auto/')) : g.fotos.map(f => f.heic ? '' : f.url));
  // v49: las fotos se pueden reordenar (arrastrar / mantener presionado / ← →); un toque la hace portada
  const ordenable = ziOrdenable(g), n = fotos.length;
  const tira = `<div class="zi-t-fotos${ordenable ? ' of-lista' : ''}" id="ziTF${g.id}">${fotos.map((u, i) => u
    ? `<button type="button" data-of-arrastrable class="zi-t-foto of-item ${i === 0 ? 'portada' : ''}${(ZI.mirar?.id === g.id && ZI.mirar.i === i) ? ' zi-mirar' : ''}" data-of-i="${i}"
        onclick="ziPortada(${g.id},${i})" title="${i === 0 ? 'Portada' : ordenable ? 'Toca para usarla de portada o arrástrala para cambiar el orden' : 'Usar como portada'}"
        aria-label="Foto ${i + 1} de ${n}${i === 0 ? ' (portada)' : ''}${ordenable ? '. Flechas para moverla.' : ''}"
        ${ordenable ? `onpointerdown="OrdenarFotos.iniciar(event,{lista:document.getElementById('ziTF${g.id}'),selector:'.of-item',indice:${i},mover:(a,b)=>ziMoverFotoTarjeta(${g.id},a,b),puede:()=>ziOrdenable(ZI.grupos.find(x=>x.id===${g.id}))})"
        onkeydown="OrdenarFotos.teclado(event,${i},${n},(a,b)=>ziMoverFotoTarjeta(${g.id},a,b))" oncontextmenu="return false"` : ''}>
        <img src="${escAdmin(u)}" alt="" loading="lazy" decoding="async" draggable="false">${i === 0 && n > 1 ? '<span class="of-etq">Portada</span>' : ''}<span class="zi-t-n">${i + 1}</span></button>`
    : `<div class="zi-t-foto zi-heic">HEIC</div>`).join('')}</div>`;
  if (g.guardada) return `${tira}<div class="zi-t-ok">✓ Guardada${g.ig ? ' · ' + escAdmin(g.ig) : ''}</div>`;
  if (g.estado !== 'hecho') {
    const txt = { listo: 'En espera…', reintentar: g.aviso || 'En espera…', subiendo: `Subiendo fotos ${g.subidas.length}/${g.fotos.length}…`, analizando: 'La IA está viendo la prenda…', error: g.error }[g.estado] || '';
    return `${tira}<div class="zi-t-estado ${g.estado}">${g.estado === 'error' ? '' : '<span class="zi-spin"></span>'}${escAdmin(txt)}
      ${g.estado === 'error' ? `<button class="zi-btn mini" onclick="ziReintentar(${g.id})">Reintentar</button>` : ''}</div>`;
  }
  const f = g.f, ia = g.ia || {};
  const c = ia.confianza || {};
  const hist = ia.historial || {};
  const pista = [
    ia.rangoPrecio?.[1] ? `IA: $${ia.rangoPrecio[0]}–$${ia.rangoPrecio[1]}` : '',
    hist.marca ? `tus ${escAdmin(f.marca || 'de esa marca')}: $${hist.marca}` : hist.categoria ? `tu mediana en ${escAdmin(f.categoria)}: $${hist.categoria}` : '',
  ].filter(Boolean).join(' · ');
  const inp = (k, etq, extra = '') => `<label class="zi-c"><span>${etq}</span><input value="${escAdmin(f[k] ?? '')}" oninput="ziCampo(${g.id},'${k}',this.value)" ${extra}></label>`;
  const sel = (k, etq, html) => `<label class="zi-c"><span>${etq}</span><select onchange="ziCampo(${g.id},'${k}',this.value)">${html}</select></label>`;
  return `
    <div class="zi-t-col">${tira}${ziMasFotosHtml(g)}</div>
    <div class="zi-t-datos ${f.incluir === false ? 'fuera' : ''}">
      <div class="zi-t-cab">
        <label class="zi-check sola"><input type="checkbox" ${f.incluir !== false ? 'checked' : ''} onchange="ziCampo(${g.id},'incluir',this.checked);ziPintarTarjeta(ZI.grupos.find(x=>x.id===${g.id}));ziPintarPie()"> Guardar</label>
        <div class="zi-confs">${ia.rareza >= 3 || g.agente?.r ? ziRarezaChip(g.agente?.r?.rareza?.nivel || ia.rareza) : ''}${ziConf('Marca', c.marca)}${ziConf('Talla', c.talla)}${g.antes ? '' : ziConf('Precio', c.precio)}
          ${ziDudosa(g) ? `<button class="zi-conf mod btn" onclick="ziReanalizar(${g.id})" title="Volver a analizar con el modelo preciso">↻ precisa</button>` : ''}
          ${ia.desdeMemoria ? '<span class="zi-conf mod">memoria · gratis</span>' : ia.modelo ? `<span class="zi-conf mod" title="${escAdmin(ia.modelo)}">${/haiku/.test(ia.modelo) ? 'rápida' : 'precisa'}${ia.costoUSD ? ' · ' + usd(ia.costoUSD) : ''}</span>` : ''}</div>
      </div>
      ${g.antes ? `<p class="zi-nota mini">Solo se llenan los campos vacíos${ZI_CAMPOS.filter(k => !g.antes[k] && g.f[k]).length ? ': <b>' + ZI_CAMPOS.filter(k => !g.antes[k] && g.f[k]).join(', ') + '</b>' : ' (no encontró nada nuevo)'}.</p>` : ''}
      ${g.repetida ? `<div class="zi-aviso suave mini">Parece que <b>ya registraste esta prenda</b>: «${escAdmin(g.repetida.nombre)}» (#${g.repetida.id}${g.repetida.vendido ? ', vendida' : ''}). No se guardará otra vez a menos que marques "Guardar".</div>` : ''}
      ${ia.esPrenda === false ? '<div class="zi-aviso suave mini">La IA cree que estas fotos no son de una prenda. Revisa antes de guardarla.</div>' : ''}
      ${ia.sinConfirmar?.length && !g.antes ? `<div class="zi-aviso suave mini">No se ve con seguridad ${ia.sinConfirmar.map(x => `la <b>${x}</b>`).join(' ni ')}: la dejé vacía para no inventarla. Revísala en la etiqueta.</div>` : ''}
      ${ia.incompleta && !g.antes ? '<div class="zi-aviso suave mini">La IA no pudo llenar todo con seguridad: revisa sobre todo el <b>nombre</b> y el <b>precio</b>.</div>' : ''}
      ${ziDetallesHtml(g)}
      <div class="zi-rej">
        ${inp('nombre', 'Nombre', 'maxlength="80" class="ancho"')}
        ${inp('marca', 'Marca', 'maxlength="40"')}
        ${sel('categoria', 'Categoría', ziOpciones(ziCategorias(), f.categoria, '—', true))}
        ${sel('talla', 'Talla', ziOpcionesTalla(f.talla))}
        ${sel('estado', 'Estado', ziOpciones(ESTADOS, f.estado))}
        <label class="zi-c precio"><span>Precio</span><input type="number" min="0" step="10" value="${escAdmin(f.precio ?? '')}" oninput="ziCampo(${g.id},'precio',this.value)">${pista ? `<small>${pista}</small>` : ''}</label>
        <label class="zi-c"><span>Costo (opcional)</span><input type="number" min="0" step="10" value="${escAdmin(f.costo ?? '')}" oninput="ziCampo(${g.id},'costo',this.value)"></label>
        <label class="zi-c ancho"><span>Descripción</span><textarea rows="4" maxlength="1500" oninput="ziCampo(${g.id},'descripcion',this.value)">${escAdmin(f.descripcion || '')}</textarea></label>
        ${inp('hashtags', 'Hashtags', 'maxlength="300" class="ancho"')}
      </div>
      ${ziNuevasHtml(g)}
      ${ia.razonPrecio && g.agente?.estado !== 'hecho' ? `<p class="zi-razon">${ico('foco', 15)} ${escAdmin(ia.razonPrecio)}</p>` : ''}
      ${g.antes ? '' : ziAgenteHtml(g)}
    </div>`;
}

function ziCampo(id, k, v) {
  const g = ZI.grupos.find(x => x.id === id); if (!g) return;
  g.f[k] = v; clearTimeout(ZI._t); ZI._t = setTimeout(() => {
    ziGuardarLocal(); ziPintarPie();
    // v45: al cambiar el precio, el aviso de "la estás dando barata" se actualiza
    if (k === 'precio' && g.agente?.estado === 'hecho') { const el = document.querySelector(`#ziT${g.id} .zi-ag`); if (el) el.outerHTML = ziAgenteHtml(g); }
    if (k === 'marca' || k === 'categoria') { const t = document.getElementById('ziT' + g.id); const viejo = t?.querySelector('.zi-nuevas'); const nuevo = ziNuevasHtml(g);
      if (viejo) viejo.outerHTML = nuevo || ''; else if (nuevo) t?.querySelector('.zi-rej')?.insertAdjacentHTML('afterend', nuevo); }
  }, 400);
}
function ziPortada(id, i) {
  const g = ZI.grupos.find(x => x.id === id); if (!g || !i) return;
  if (!ziOrdenable(g)) return;
  ziMoverFotoTarjeta(id, i, 0);
}
// v49: en "Revisar" se puede cambiar el orden mientras la prenda no esté subiendo,
// analizándose o ya guardada (así la portada que elija la IA no revuelve tu orden)
function ziOrdenable(g) {
  return !!g && !g.guardada && !g.antes && !['subiendo', 'analizando'].includes(g.estado) && g.fotos.length > 1
    && (g.subidas.length === 0 || g.subidas.length === g.fotos.length);
}
function ziMoverFotoTarjeta(id, de, a) {
  const g = ZI.grupos.find(x => x.id === id);
  if (!ziOrdenable(g) || de === a) return;
  if (g.subidas.length) OrdenarFotos.moverEn(g.subidas, de, a);
  OrdenarFotos.moverEn(g.fotos, de, a);
  g.ordenManual = true;
  ziGuardarLocal(); ziPintarTarjeta(g, true);
}
// Resalta la foto donde la IA vio una falla
function ziVerFoto(id, i) {
  const g = ZI.grupos.find(x => x.id === id); if (!g) return;
  ZI.mirar = { id, i }; ziPintarTarjeta(g, true);
  document.querySelector(`#ziTF${id} [data-of-i="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  clearTimeout(ZI.mirarT);
  ZI.mirarT = setTimeout(() => { ZI.mirar = null; document.querySelectorAll('.zi-mirar').forEach(e => e.classList.remove('zi-mirar')); }, 2200);
}
// Detalles y fallas que vio la IA (las fallas dicen en qué foto están, aunque cambies el orden)
function ziDetallesHtml(g) {
  const ia = g.ia || {};
  const det = Array.isArray(ia.detalles) ? ia.detalles : [];
  const fallas = Array.isArray(ia.fallas) ? ia.fallas : [];
  let html = '';
  if (det.length) html += `<div class="zi-detalles"><b>Detalles que vio la IA</b><ul>${det.map(d => `<li>${escAdmin(d)}</li>`).join('')}</ul></div>`;
  if (fallas.length) {
    html += `<div class="zi-fallas">${ico('alerta', 15)}<span><b>Fallas que vio la IA:</b> ${fallas.map((f, k) => {
      const u = ia.fallasFoto?.[k];
      const i = u ? g.subidas.indexOf(u) : -1;
      return `${escAdmin(f)}${i >= 0 ? ` <button type="button" class="zi-falla-foto" onclick="ziVerFoto(${g.id},${i})" title="Ver dónde está">foto ${i + 1}</button>` : ''}`;
    }).join(' · ')} <small>(van en la descripción para evitar reclamos)</small></span></div>`;
  }
  return html;
}
function ziReintentar(id) {
  const g = ZI.grupos.find(x => x.id === id); if (!g) return;
  g.estado = 'reintentar'; g.error = ''; g.intentos = 0; g.esperaHasta = 0; ziPintarTarjeta(g); ziCorrer();
}

function ziDrops() {
  try { return (getDrops() || []).filter(d => !d.publicado && new Date(d.fecha) > Date.now()); } catch { return []; }
}
function ziOpcionesGuardar() {
  const drops = ziDrops();
  return `<label class="zi-sel"><span>Al guardar</span>
      <select onchange="ZI.ig=this.value;ziPrefs();ziPintarPie()">
        <option value="programar" ${ZI.ig === 'programar' ? 'selected' : ''}>Programar en Instagram (escalonado)</option>
        <option value="ahora" ${ZI.ig === 'ahora' ? 'selected' : ''}>Publicar todas en Instagram ya</option>
        <option value="no" ${ZI.ig === 'no' ? 'selected' : ''}>Solo guardar en la tienda</option>
        ${drops.length ? `<option value="drop" ${ZI.ig === 'drop' ? 'selected' : ''}>Meterlas a un drop</option>` : ''}
      </select></label>
    ${ZI.ig === 'programar' ? `<label class="zi-sel"><span>Una cada</span><select onchange="ZI.cadaHoras=Number(this.value);ziPrefs()">${[1, 2, 3, 4, 6, 12, 24].map(h => `<option value="${h}" ${ZI.cadaHoras === h ? 'selected' : ''}>${h === 24 ? '1 día' : h + ' h'}</option>`).join('')}</select></label>` : ''}
    ${ZI.ig === 'drop' ? `<label class="zi-sel"><span>Drop</span><select onchange="ZI.dropId=this.value">${drops.map(d => `<option value="${escAdmin(d.id)}" ${ZI.dropId === d.id ? 'selected' : ''}>${escAdmin(d.nombre)}</option>`).join('')}</select></label>` : ''}`;
}

function ziPie() { return `<footer class="zi-pie" id="ziPie">${ziPieHtml()}</footer>`; }
function ziPintarPie() { const el = document.getElementById('ziPie'); if (el) el.innerHTML = ziPieHtml(); }
function ziPieHtml() {
  const total = ZI.grupos.length;
  const hechos = ZI.grupos.filter(g => g.estado === 'hecho' || g.guardada).length;
  const errores = ZI.grupos.filter(g => g.estado === 'error').length;
  const reintentando = ZI.grupos.filter(g => g.estado === 'reintentar' && g.esperaHasta > Date.now()).length;
  const aGuardar = ZI.grupos.filter(g => g.estado === 'hecho' && !g.guardada && g.f.incluir !== false);
  const sinPrecio = aGuardar.filter(g => !(Number(g.f.precio) > 0) || !String(g.f.nombre || '').trim()).length;
  const pct = total ? Math.round(hechos / total * 100) : 0;
  return `
    <div class="zi-prog"><div class="zi-prog-b" style="width:${pct}%"></div></div>
    <div class="zi-pie-fila">
      <div class="zi-pie-txt"><b>${hechos} de ${total}</b> listas${ZI.gastoSesion ? ` · gastado ${usd(ZI.gastoSesion)}` : ''}${ziSaldoMini()}${errores ? ` · <span class="rojo">${errores} con error</span>` : ''}${reintentando ? ` · ${reintentando} reintentando sola${reintentando === 1 ? '' : 's'}` : ''}${ZI.sinInternet ? ' · <span class="rojo">sin internet: sigue sola cuando vuelva</span>' : ''}${ZI.agenteCorriendo ? ` · <span class="zi-ag-vivo">agente investigando (${ZI.grupos.filter(g => ['cola', 'investigando'].includes(g.agente?.estado)).length})…</span>` : ''}${sinPrecio ? ` · ${sinPrecio} sin nombre o precio` : ''}
        ${ZI.corriendo ? (ZI.pausa ? ' · pausando…' : ' · trabajando…') : ''}</div>
      <div class="zi-fila">
        ${ZI.corriendo && !ZI.pausa ? '<button class="zi-btn" onclick="ziPausar()">Pausar</button>' : ''}
        ${!ZI.corriendo && ZI.grupos.some(g => g.estado === 'listo' || g.estado === 'reintentar') ? '<button class="zi-btn" onclick="ziCorrer()">Seguir analizando</button>' : ''}
        ${errores && !ZI.guardando ? `<button class="zi-btn" onclick="ziReintentarTodas()">Reintentar ${errores === 1 ? 'la que falló' : `las ${errores} que fallaron`}</button>` : ''}
        ${ZI.modoTrabajo === 'completar' ? '' : ziOpcionesGuardar()}
        ${!aGuardar.length && total && ZI.grupos.every(g => g.guardada || g.f?.incluir === false) && !ZI.guardando ? '<button class="zi-btn" onclick="ziNueva()">Importar más</button>' : ''}
        <button class="zi-btn negro" onclick="ziGuardarTodas()" ${aGuardar.length && !ZI.guardando ? '' : 'disabled'}>${ZI.guardando ? 'Guardando…' : `Guardar ${aGuardar.length} prenda${aGuardar.length === 1 ? '' : 's'}`}</button>
      </div>
    </div>`;
}

async function ziGuardarTodas() {
  if (ZI.modoTrabajo === 'completar') return ziGuardarCompletadas();
  const lista = ZI.grupos.filter(g => g.estado === 'hecho' && !g.guardada && g.f.incluir !== false);
  const enInvestigacion = lista.filter(g => ['cola', 'investigando'].includes(g.agente?.estado));
  if (enInvestigacion.length) {
    document.getElementById('ziT' + enInvestigacion[0].id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return toast(`Espera un momento: el agente sigue investigando ${enInvestigacion.length} prenda(s) para darte el precio correcto`);
  }
  const malas = lista.filter(g => !(Number(g.f.precio) > 0) || !String(g.f.nombre || '').trim());
  if (malas.length) {
    document.getElementById('ziT' + malas[0].id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return toast(`${malas.length} prenda(s) no tienen nombre o precio`);
  }
  ZI.guardando = true; ziPintarPie();
  let ok = 0;
  const nuevas = [];
  for (const g of lista) {
    const f = g.f;
    // Ya se había guardado (p. ej. se cortó el internet justo después): no se duplica
    const ya = !g.repetida && getDB().find(x => g.subidas[0] && (x.imagenes || [])[0] === g.subidas[0]);
    if (ya) { g.guardada = true; g.prendaId = ya.id; ok++; nuevas.push(g); ziPintarTarjeta(g); continue; }
    try {
      await ziAsegurarCatalogo(f);
      const p = await ziConReintentos(() => crearPrenda({
        nombre: String(f.nombre).trim(), marca: String(f.marca || '').trim(),
        categorias: f.categoria ? [f.categoria] : [],
        talla: f.talla || '', estado: f.estado || '',
        precio_venta: Number(f.precio), costo: f.costo === '' || f.costo == null ? null : Number(f.costo),
        descripcion: String(f.descripcion || '').trim(),
        hashtags: typeof limpiarHashtags === 'function' ? limpiarHashtags(f.hashtags) : String(f.hashtags || ''),
        imagenes: g.subidas, vendido: false, oculto: ZI.ig === 'drop',
        bazarId: typeof bazarParaNuevas === 'function' ? bazarParaNuevas() : undefined,
      }), 'crear');
      g.guardada = true; g.prendaId = p.id; ok++; nuevas.push(g); g.error = '';
      registrarLog?.('subir', p.nombre, `Importada desde ZIP · $${f.precio}`);
    } catch (e) { g.error = ziErrorHumano(e); toast(`${f.nombre}: ${g.error}`); }
    ziPintarTarjeta(g); ziPintarPie();
  }
  ziGuardarLocal();
  if (ZI.creadas?.length) { toast(`Se agregaron a tu catálogo: ${ZI.creadas.join(', ')}`); ZI.creadas = []; }
  iaAprender(nuevas.filter(g => g.ia).map(g => iaCaso(g.ia, g.f)));
  if (typeof renderAll === 'function') renderAll();
  toast(`${ok} prenda(s) guardadas`);
  ZI.resumen = { guardadas: nuevas.length, programados: [], publicadas: 0, errorIG: '', drop: '' };
  if (ZI.ig === 'drop' && nuevas.length) {
    try {
      const drops = getDrops(); const d = drops.find(x => x.id === (ZI.dropId || ziDrops()[0]?.id));
      if (d) { nuevas.forEach(g => d.prendas.push(g.prendaId)); saveDrops(drops); ZI.resumen.drop = d.nombre; }
    } catch (e) { toast('No se pudo agregar al drop: ' + e.message); }
  }
  if (ZI.ig === 'programar' && nuevas.length) {
    try {
      const { opciones } = typeof igMejoresHoras === 'function' ? igMejoresHoras() : { opciones: [new Date(Date.now() + 10 * 60000)] };
      const r = await api('/api/acciones?op=ig-programar-prendas', { method: 'POST', body: {
        prendaIds: nuevas.map(g => g.prendaId), inicio: opciones[0].toISOString(), cadaHoras: ZI.cadaHoras,
        bazarId: typeof bazarParaNuevas === 'function' ? bazarParaNuevas() : undefined } });
      ZI.resumen.programados = r.programados || [];
      r.programados.forEach(x => { const g = nuevas.find(n => n.prendaId === x.prendaId); if (g) g.ig = 'programada ' + new Date(x.publicarEn).toLocaleString('es-MX', { weekday: 'short', hour: 'numeric', minute: '2-digit' }); });
      if (typeof IG !== 'undefined') { IG.programados = null; if (IG.estado) IG.estado.pendientes = (IG.estado.pendientes || 0) + r.programados.length; }
    } catch (e) { ZI.resumen.errorIG = e.message; }
  }
  // Instagram, de una en una y en el mismo orden
  if (ZI.ig === 'ahora') {
    for (const g of nuevas) {
      try {
        const r = await api(`/api/inventario-item?op=instagram&id=${g.prendaId}`, { method: 'POST', body: {} });
        const p = getDB().find(x => x.id === g.prendaId); if (p) Object.assign(p, { instagramId: r.instagramId, instagramUrl: r.instagramUrl, instagramEn: r.instagramEn });
        g.ig = 'en Instagram'; ZI.resumen.publicadas++;
      } catch (e) {
        g.ig = 'Instagram: ' + e.message; ZI.resumen.errorIG = e.message;
        if (/límite|limit|token|permiso/i.test(e.message)) { ziPintarTarjeta(g); break; }
      }
      ziPintarTarjeta(g);
    }
    if (typeof renderAll === 'function') renderAll();
  }
  ZI.guardando = false; ziPintarPie();
  if (ZI.grupos.every(g => g.guardada || g.f.incluir === false)) {
    localStorage.removeItem(ZI_GUARDADO);
    if (nuevas.length) { ZI.paso = 'listo'; ziPintar(); }
  }
}

// ── Resumen final ────────────────────────────────────────────
function ziVistaListo() {
  const r = ZI.resumen || {};
  const fecha = iso => new Date(iso).toLocaleString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const guardadas = ZI.grupos.filter(g => g.guardada);
  return `<div class="zi-listo">
    <div class="zi-listo-ic">✓</div>
    <h3>${r.guardadas} prenda${r.guardadas === 1 ? '' : 's'} registrada${r.guardadas === 1 ? '' : 's'}</h3>
    <p>${r.drop ? `Están en el drop <b>${escAdmin(r.drop)}</b> (ocultas hasta que salga).`
      : r.programados?.length ? `${r.programados.length} programada${r.programados.length === 1 ? '' : 's'} en Instagram, una cada ${ZI.cadaHoras === 24 ? 'día' : ZI.cadaHoras + ' h'} y sin publicar de noche. Si alguna se vende antes, su post ya no sale.`
      : r.publicadas ? `${r.publicadas} publicada${r.publicadas === 1 ? '' : 's'} en Instagram.` : 'Ya están en la tienda.'}
      ${r.errorIG ? `<br><span class="rojo">Instagram: ${escAdmin(r.errorIG)}</span>` : ''}
      ${ZI.gastoSesion ? `<br><small>IA: ${usd(ZI.gastoSesion)} en esta tanda.</small>` : ''}</p>
    ${r.programados?.length ? `<ol class="zi-agenda">${r.programados.slice(0, 40).map(x => {
      const g = guardadas.find(y => y.prendaId === x.prendaId);
      return `<li>${g?.subidas?.[0] ? `<img src="${escAdmin(g.subidas[0].replace('/upload/', '/upload/c_fill,w_80,h_100,q_auto,f_auto/'))}" alt="">` : ''}<span><b>${escAdmin(x.nombre)}</b><small>${fecha(x.publicarEn)}</small></span></li>`;
    }).join('')}</ol>` : ''}
    <div class="zi-fila centro">
      <button class="zi-btn negro grande" onclick="ziNueva()">Registrar más</button>
      ${r.programados?.length && typeof igVista === 'function' ? `<button class="zi-btn grande" onclick="ziCerrar();if(typeof showTab==='function')showTab('instagram');igVista('programados')">Ver programados</button>` : ''}
      <button class="zi-btn grande" onclick="ziCerrar()">Cerrar</button>
    </div>
  </div>`;
}

// ═════════════════════════════════════════════════════════════
//  Sesión de fotos (celular): prenda por prenda
// ═════════════════════════════════════════════════════════════
function ziSesionEmpezar() {
  ZI.modoTrabajo = 'nuevas'; ZI.fotos = []; ZI.grupos = []; ZI.sesion = { fotos: [] };
  ZI.paso = 'sesion'; ziPintar();
}
async function ziSesionAgregar(files) {
  const lista = [...(files || [])].filter(a => a.type.startsWith('image/') || ZI_IMG.test(a.name));
  for (const a of lista) {
    const f = { nombre: a.name, base: a.name, carpeta: '', t: a.lastModified || Date.now(), blob: a };
    f.huella = await ziHuella(a); f.heic = /\.(heic|heif)$/i.test(a.name); f.url = URL.createObjectURL(a);
    const ya = ziMapaSubidas()[f.huella]; if (ya) f.nube = ya;
    ZI.sesion.fotos.push(f); ZI.fotos.push(f);
    ziSubirFoto(f).catch(() => {});
  }
  ziPintar();
}
function ziSesionSiguiente() {
  const fotos = ZI.sesion.fotos; if (!fotos.length) return toast('Primero toma al menos una foto');
  const g = { id: ZI.sig++, fotos: fotos.slice(0, 10), subidas: [], estado: 'listo', f: {}, ordenManual: !!ZI.sesion.ordenManual };
  ZI.grupos.push(g); ZI.sesion.fotos = []; ZI.sesion.ordenManual = false;
  ziPintar(); ziCorrer();                      // la IA empieza con esta mientras tomas la siguiente
}
function ziSesionQuitar(i) { ZI.sesion.fotos.splice(i, 1); ziPintar(); }
function ziSesionMover(de, a) { OrdenarFotos.moverEn(ZI.sesion.fotos, de, a); ZI.sesion.ordenManual = true; ziPintar(); }
function ziSesionTerminar() {
  if (ZI.sesion.fotos.length) ziSesionSiguiente();
  if (!ZI.grupos.length) return toast('Toma fotos de al menos una prenda');
  ZI.paso = 'revisar'; ziPintar();
}
function ziVistaSesion() {
  const n = ZI.grupos.length + 1, fotos = ZI.sesion?.fotos || [];
  return `<div class="zi-sesion">
    <div class="zi-sesion-cab"><span class="zi-sesion-n">Prenda ${n}</span><small>${fotos.length ? `${fotos.length} foto${fotos.length === 1 ? '' : 's'}` : 'Frente, atrás y etiqueta'}</small></div>
    <div class="zi-sesion-fotos" id="ziSesionFotos">
      ${fotos.map((f, i) => `<figure class="of-item" data-of-i="${i}" tabindex="0" aria-label="Foto ${i + 1} de ${fotos.length}${i === 0 ? ' (portada)' : ''}. Flechas para moverla."
        onpointerdown="OrdenarFotos.iniciar(event,{lista:document.getElementById('ziSesionFotos'),selector:'.of-item',indice:${i},mover:ziSesionMover})"
        onkeydown="OrdenarFotos.teclado(event,${i},${fotos.length},ziSesionMover)" oncontextmenu="return false">${ziFotoHtml(f)}${i === 0 && fotos.length > 1 ? '<span class="of-etq">Portada</span>' : ''}<button onclick="ziSesionQuitar(${i})" aria-label="Quitar">✕</button></figure>`).join('')}
      <label class="zi-sesion-cam"><input type="file" accept="image/*" capture="environment" onchange="ziSesionAgregar(this.files);this.value=''" hidden><span>${ico('camara', 24)}</span><small>Tomar foto</small></label>
      <label class="zi-sesion-cam gal"><input type="file" accept="image/*" multiple onchange="ziSesionAgregar(this.files);this.value=''" hidden><span>${ico('imagen', 24)}</span><small>Galería</small></label>
    </div>
    <div class="zi-fila">
      <button class="zi-btn negro grande" onclick="ziSesionSiguiente()" ${fotos.length ? '' : 'disabled'}>✓ Siguiente prenda</button>
      <button class="zi-btn grande" onclick="ziSesionTerminar()" ${ZI.grupos.length || fotos.length ? '' : 'disabled'}>Terminar y revisar${ZI.grupos.length ? ` (${ZI.grupos.length + (fotos.length ? 1 : 0)})` : ''}</button>
    </div>
    ${ZI.grupos.length ? `<div class="zi-sesion-lista" id="ziSesionLista">${ziSesionListaHtml()}</div>` : ''}
  </div>`;
}
function ziSesionListaHtml() {
  return ZI.grupos.slice().reverse().map((g, i) => `<div class="zi-sesion-item">
    ${g.fotos[0] && ziMini(g.fotos[0]) ? `<img src="${escAdmin(ziMini(g.fotos[0]))}" alt="">` : '<span class="zi-heic">·</span>'}
    <span><b>${escAdmin(g.f?.nombre || `Prenda ${ZI.grupos.length - i}`)}</b><small>${g.estado === 'hecho' ? (g.f?.precio ? `$${g.f.precio} · ${escAdmin(g.f.talla || '')}` : 'Lista') : g.estado === 'error' ? escAdmin(g.error) : g.estado === 'analizando' ? 'La IA la está viendo…' : g.estado === 'subiendo' ? 'Subiendo…' : 'En espera…'}</small></span>
    ${g.estado === 'hecho' ? '<em class="ok">✓</em>' : g.estado === 'error' ? '<em class="mal">!</em>' : '<span class="zi-spin"></span>'}
  </div>`).join('');
}
function ziPintarSesionLista() { const el = document.getElementById('ziSesionLista'); if (el) el.innerHTML = ziSesionListaHtml(); }

// ═════════════════════════════════════════════════════════════
//  Función estrella: tarjeta en Registrar / Inventario y arrastrar
//  fotos o ZIP en cualquier parte de esas pantallas
// ═════════════════════════════════════════════════════════════
function ziHeroHtml() {
  return `<div class="zi-hero" ondragover="event.preventDefault();this.classList.add('sobre')" ondragleave="this.classList.remove('sobre')" ondrop="event.preventDefault();this.classList.remove('sobre');ziAbrirCon(event.dataTransfer.files)">
    <div class="zi-hero-txt">
      <span class="zi-hero-et">✦ Registro rápido con IA</span>
      <h3>Sube tus fotos y la IA registra las prendas por ti</h3>
      <p>Arrastra aquí un ZIP o tus fotos. Nombre, marca, talla, estado, precio sugerido, descripción y hashtags se llenan solos; tú revisas y se programan en Instagram.</p>
    </div>
    <div class="zi-hero-acc">
      <label class="zi-btn negro grande"><input type="file" accept=".zip,application/zip,image/*" multiple hidden onchange="ziAbrirCon(this.files);this.value=''">Elegir ZIP o fotos</label>
      <button class="zi-btn grande" onclick="ziAbrir().then(ziSesionEmpezar)">${ico('camara', 16)} Sesión de fotos</button>
    </div>
  </div>`;
}
async function ziAbrirCon(files) {
  files = [...(files || [])];                   // copia: el input se limpia enseguida
  if (!files.length) return;
  if (ZI.corriendo || ZI.guardando) { ziAbrir(); return toast('Termina primero la importación que va'); }
  ZI.grupos = []; ZI.paso = 'elegir';
  await ziAbrir();
  ziElegir(files);
}
function ziPonerHero() {
  for (const id of ['view-registrar', 'view-inventario']) {
    const v = document.getElementById(id); if (!v || v.querySelector('.zi-hero')) continue;
    const cab = v.querySelector('.view-header'); if (!cab) continue;
    cab.insertAdjacentHTML('afterend', ziHeroHtml());
    if (id === 'view-inventario') v.querySelector('.zi-hero').classList.add('compacta');
  }
}
document.addEventListener('DOMContentLoaded', ziPonerHero);
if (document.readyState !== 'loading') ziPonerHero();

// Soltar un ZIP o fotos en cualquier parte de Registrar / Inventario
['dragover', 'drop'].forEach(tipo => document.addEventListener(tipo, e => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  const vista = e.target.closest?.('#view-registrar, #view-inventario');
  if (!vista || e.target.closest('.zi-modal, .upload-zone, .zi-hero')) return;
  e.preventDefault();
  if (tipo === 'drop') ziAbrirCon(e.dataTransfer.files);
}));

// Al cerrar con todo guardado, se deja listo para otra importación
function ziNueva() {
  ZI.grupos = []; ZI.fotos = []; ZI.paso = 'elegir'; ziPintar();
}

async function ziGuardarCompletadas() {
  const lista = ZI.grupos.filter(g => g.estado === 'hecho' && !g.guardada && g.f.incluir !== false);
  ZI.guardando = true; ziPintarPie();
  let ok = 0; const casos = [];
  for (const g of lista) {
    const cambios = {};
    for (const k of ZI_CAMPOS) {
      const v = String(g.f[k] || '').trim();
      if (!v || v === (g.antes[k] || '')) continue;
      if (k === 'categoria') cambios.categorias = [v]; else cambios[k] = v;
    }
    if (String(g.f.nombre || '').trim() && g.f.nombre !== g.antes.nombre) cambios.nombre = String(g.f.nombre).trim();
    if (Number(g.f.precio) > 0 && Number(g.f.precio) !== Number(g.antes.precio)) cambios.precio_venta = Number(g.f.precio);
    if (!Object.keys(cambios).length) { g.guardada = true; ziPintarTarjeta(g); continue; }
    try {
      await ziConReintentos(() => guardarPrenda(g.prendaId, cambios), 'guardar');
      const p = getDB().find(x => x.id === g.prendaId); if (p) Object.assign(p, cambios);
      g.guardada = true; ok++;
      if (g.ia) casos.push(iaCaso(g.ia, { ...g.f, precio: g.antes.precio }));
    } catch (e) { toast(`${g.f.nombre}: ${e.message}`); }
    ziPintarTarjeta(g); ziPintarPie();
  }
  iaAprender(casos);
  ZI.guardando = false; ziPintarPie();
  if (typeof renderAll === 'function') renderAll();
  toast(`${ok} prenda(s) completadas`);
}

// ═════════════════════════════════════════════════════════════
//  Formulario "Registrar prenda" → botón "Llenar con IA"
// ═════════════════════════════════════════════════════════════
function iaBotonFormulario() {
  const strip = document.getElementById('previewStrip');
  if (!strip || document.getElementById('iaLlenarBtn')) return;
  const caja = document.createElement('div');
  caja.className = 'ia-llenar';
  caja.innerHTML = `<div class="ia-llenar-fila"><button type="button" id="iaLlenarBtn" class="zi-abrir" onclick="iaLlenarFormulario()"><span aria-hidden="true">✦</span> Llenar datos con IA</button>
    <button type="button" id="iaInvestigarBtn" class="zi-abrir sec" onclick="iaInvestigarFormulario()">${typeof ico === 'function' ? ico('buscar', 15) : ''} Investigar a fondo</button></div>
    <small id="iaLlenarNota">Sube las fotos (frente, atrás y etiqueta) y la IA llena nombre, marca, talla, estado, precio, descripción y hashtags. "Investigar a fondo" la fecha, mide qué tan rara es y busca ventas reales para el precio.</small>
    <small id="iaSaldoLinea" class="ia-saldo-linea"></small>
    <div id="iaAgenteForm"></div>`;
  iaEstado().then(() => ziPintarSaldo()).catch(() => {});
  strip.after(caja);
}

async function iaLlenarFormulario() {
  const fotos = [...(typeof editImages !== 'undefined' ? editImages : []), ...(typeof newImages !== 'undefined' ? newImages : [])]
    .filter(u => typeof u === 'string' && /res\.cloudinary\.com/.test(u));
  if (!fotos.length) return toast('Primero sube las fotos de la prenda (espera a que terminen de subir)');
  const ia = await iaEstado();
  if (!ia.activa) return toast('Falta configurar la IA (ANTHROPIC_API_KEY en Vercel)');
  const btn = document.getElementById('iaLlenarBtn'), nota = document.getElementById('iaLlenarNota');
  btn.disabled = true; btn.innerHTML = '<span class="zi-spin"></span> La IA está viendo la prenda…';
  try {
    const nombreActual = document.getElementById('f_nombre').value.trim();
    btn.innerHTML = '<span class="zi-spin"></span> La IA está viendo la prenda…';
    const r = await ziConReintentos(i => {
      if (i) btn.innerHTML = `<span class="zi-spin"></span> La IA está ocupada, reintentando (${i} de 3)…`;
      return iaAnalizar({ imagenes: fotos.slice(0, 8), pista: nombreActual });
    });
    const v = (id, val, pisar) => { const el = document.getElementById(id); if (el && val && (pisar || !String(el.value || '').trim())) el.value = val; };
    v('f_nombre', r.nombre);
    // Marca: si no existe en la lista, se agrega como opción
    await iaPonerMarcaYCategoria(r);
    if (r.talla && typeof escribirTalla === 'function' && !leerTalla('f')) escribirTalla('f', r.talla);
    if (r.estado && !document.getElementById('f_estado').value) {
      const pill = document.querySelector(`#f_estado_pills [data-estado="${CSS.escape(r.estado)}"]`);
      if (pill) elegirEstado('f', pill);
    }
    v('f_precio', r.precioSugerido);
    v('f_descripcion', r.descripcion);
    v('f_hashtags', r.hashtags);
    ZI.ultimaFormulario = r;
    ziGastar(r.costoUSD);
    const fotoDe = u => { const k = fotos.indexOf(u); return k >= 0 ? ` (foto ${k + 1})` : ''; };
    const extra = [
      r.detalles?.length ? `<br><b>Detalles:</b> ${r.detalles.map(escAdmin).join(' · ')}` : '',
      r.fallas?.length ? `<br><b class="ia-falla">Fallas:</b> ${r.fallas.map((f, k) => escAdmin(f) + fotoDe(r.fallasFoto?.[k])).join(' · ')} <small>(ya van en la descripción)</small>` : '',
    ].join('');
    nota.innerHTML = `Listo${r.desdeMemoria ? ' (de memoria, gratis)' : r.costoUSD ? ` · ${usd(r.costoUSD)}` : ''}. Precio sugerido $${r.precioSugerido || '—'}${r.rangoPrecio?.[1] ? ` (rango $${r.rangoPrecio[0]}–$${r.rangoPrecio[1]})` : ''}${r.razonPrecio ? ' · ' + escAdmin(r.razonPrecio.replace(/\.\s*$/, '')) : ''}. Revisa la talla${r.confianza?.talla < 0.5 ? ' (no vio la etiqueta)' : ''}${r.incompleta ? ', el nombre y el precio (no pudo llenarlos con seguridad)' : ''} y guarda.${extra}`;
    document.getElementById('f_nombre').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) { toast(ziErrorHumano(e)); }
  btn.disabled = false; btn.innerHTML = '<span aria-hidden="true">✦</span> Llenar datos con IA';
}

// v45: marca y categoría en el formulario; si no existen y está permitido, se crean
async function iaPonerMarcaYCategoria(r) {
  const sel = document.getElementById('f_marca');
  if (sel && r.marca && !sel.value) {
    let nombre = r.marca;
    if (!ziExisteMarca(nombre) && ZI.crearCatalogo) { try { nombre = await ziCrearCatalogo('marca', nombre); } catch (e) { toast(ziErrorHumano(e)); } }
    else nombre = getBrands().find(b => ziNorm(b.nombre) === ziNorm(nombre))?.nombre || nombre;
    let op = [...sel.options].find(o => ziNorm(o.value) === ziNorm(nombre));
    if (!op) { op = new Option(nombre, nombre); sel.add(op); }
    sel.value = op.value;
  }
  let cat = r.categoria || (ZI.crearCatalogo ? r.categoriaNueva : '');
  if (cat && !getSelectedCats().length) {
    if (!ziExisteCat(cat)) { try { cat = await ziCrearCatalogo('categoria', cat); if (typeof renderCatCheckboxes === 'function') renderCatCheckboxes([]); } catch (e) { toast(ziErrorHumano(e)); } }
    document.querySelectorAll('#f_cats_wrap input').forEach(i => { if (ziNorm(i.value) === ziNorm(cat)) i.checked = true; });
  }
  if (ZI.creadas?.length) { toast(`Se agregaron a tu catálogo: ${ZI.creadas.join(', ')}`); ZI.creadas = []; }
}
// Formulario de una prenda → "Investigar a fondo"
const ZI_FORM = { id: 'form', agente: null };
function iaPintarAgenteFormulario() {
  const el = document.getElementById('iaAgenteForm'); if (el) el.innerHTML = ziAgenteHtml(ZI_FORM, true);
}
async function iaInvestigarFormulario(forzar) {
  if (ZI_FORM.agente?.estado === 'investigando') return toast('Ya la está investigando');
  const fotos = [...(typeof editImages !== 'undefined' ? editImages : []), ...(typeof newImages !== 'undefined' ? newImages : [])]
    .filter(u => typeof u === 'string' && /res\.cloudinary\.com/.test(u));
  if (!fotos.length) return toast('Primero sube las fotos de la prenda (espera a que terminen de subir)');
  const ia = await iaEstado();
  if (!ia.activa) return toast('Falta configurar la IA (ANTHROPIC_API_KEY en Vercel)');
  const btn = document.getElementById('iaInvestigarBtn');
  if (btn) btn.disabled = true;
  ZI_FORM.agente = { estado: 'investigando' }; iaPintarAgenteFormulario();
  try {
    const v = id => document.getElementById(id)?.value?.trim() || '';
    const r = await ziConReintentos(() => iaInvestigar({ imagenes: fotos.slice(0, 8), forzar, rareza: ZI.ultimaFormulario?.rareza, datos: { nombre: v('f_nombre'), marca: v('f_marca'), talla: typeof leerTalla === 'function' ? leerTalla('f') : '', estado: v('f_estado') } }));
    ZI_FORM.agente = { estado: 'hecho', r };
    ziGastar(r.costoUSD);
    const poner = (id, val) => { const el = document.getElementById(id); if (el && val && !String(el.value || '').trim()) el.value = val; };
    poner('f_nombre', r.nombre); poner('f_descripcion', r.descripcion); poner('f_hashtags', r.hashtags); poner('f_precio', r.precios?.justo);
    if (r.talla && typeof escribirTalla === 'function' && !leerTalla('f')) escribirTalla('f', r.talla);
    if (r.estado && !document.getElementById('f_estado')?.value) { const pill = document.querySelector(`#f_estado_pills [data-estado="${CSS.escape(r.estado)}"]`); if (pill) elegirEstado('f', pill); }
    await iaPonerMarcaYCategoria(r);
  } catch (e) { ZI_FORM.agente = { estado: 'error', error: ziErrorHumano(e) }; }
  if (btn) btn.disabled = false;
  iaPintarAgenteFormulario();
}
window.addEventListener('db:inventario', () => { if (ZI_FORM.agente && !document.getElementById('f_nombre')?.value) { ZI_FORM.agente = null; iaPintarAgenteFormulario(); } });
document.addEventListener('input', e => { if (e.target?.id === 'f_precio' && ZI_FORM.agente?.estado === 'hecho') { clearTimeout(ZI_FORM._t); ZI_FORM._t = setTimeout(iaPintarAgenteFormulario, 400); } });

// Al guardar el formulario, aprende de lo que corregiste
window.addEventListener('db:inventario', () => {
  const r = ZI.ultimaFormulario; if (!r) return;
  const p = getDB()[0];
  if (!p || Date.now() - new Date(p.creadoEn || 0) > 60000) return;
  ZI.ultimaFormulario = null;
  iaAprender([iaCaso(r, { nombre: p.nombre, marca: p.marca, categoria: (p.categorias || [])[0], talla: p.talla, estado: p.estado, precio: p.precio_venta })]);
});

document.addEventListener('DOMContentLoaded', iaBotonFormulario);
if (document.readyState !== 'loading') iaBotonFormulario();
