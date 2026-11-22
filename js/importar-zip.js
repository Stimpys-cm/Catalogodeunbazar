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
  sig: 1,
};
const ZI_GUARDADO = 'stmp-importar-zip-v1';
const ZI_PREFS = 'stmp-ia-prefs';
const ZI_SUBIDAS = 'stmp-subidas-v1';      // huella de la foto → url en Cloudinary (no se vuelve a subir)
try { Object.assign(ZI, JSON.parse(localStorage.getItem(ZI_PREFS) || '{}')); } catch {}
const ziPrefs = () => { try { localStorage.setItem(ZI_PREFS, JSON.stringify({ calidad: ZI.calidad, buscar: ZI.buscar, ig: ZI.ig, cadaHoras: ZI.cadaHoras })); } catch {} };

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
        const url = await uploadToCloud(await ziDataUrl(f.blob));
        f.nube = url; if (f.huella) ziRecordarSubida(f.huella, url); ok(url);
      } catch (e) { f.subida = null; mal(e); }
      finally { _ziSubiendo--; ziBombearSubidas(); ziPintarSubidas(); }
    })();
  }
}
function ziPintarSubidas() {
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

// ── Llamadas a la IA (compartidas con el formulario y "completar") ──
function iaListas() {
  let marcas = [];
  try { marcas = catalogoVisible(getBrands()).map(b => b.nombre).filter(Boolean).slice(0, 150); } catch {}
  return { categorias: ziCategorias(), tallas: TALLAS_PLANAS, estados: ESTADOS, marcas };
}
async function iaAnalizar({ imagenes, huellas, pista, calidad, buscar }) {
  return api('/api/acciones?op=ia-prenda', { method: 'POST', body: {
    imagenes, huellas, pista, ...iaListas(),
    calidad: calidad || ZI.calidad, buscar: buscar ?? ZI.buscar,
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
    salida.push({ nombre, base, carpeta: nombre.includes('/') ? nombre.slice(0, nombre.lastIndexOf('/')) : '', t, metodo, comp, local });
  }
  // Se extraen de una en una (no carga todo el ZIP en memoria)
  for (const s of salida) {
    const cab = new DataView(await file.slice(s.local, s.local + 30).arrayBuffer());
    const ini = s.local + 30 + cab.getUint16(26, true) + cab.getUint16(28, true);
    const crudo = file.slice(ini, ini + s.comp);
    let blob;
    if (s.metodo === 0) blob = crudo;
    else if (s.metodo === 8) blob = await new Response(crudo.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
    else continue;
    s.blob = new Blob([blob], { type: ziTipo(s.base) });
  }
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
function ziAgrupar(fotos) {
  const orden = [...fotos].sort((a, b) => (a.carpeta === b.carpeta ? 0 : ziNat(a.carpeta, b.carpeta)) || (a.t - b.t) || ziNat(a.base, b.base));
  const carpetas = new Set(orden.map(f => f.carpeta));
  const grupos = [];
  const nuevo = () => { const g = { id: ZI.sig++, fotos: [], subidas: [], estado: 'listo', f: {} }; grupos.push(g); return g; };
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
  return grupos;
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
    ${ia?.activa ? `<p class="zi-uso">${iaUsoTexto()}</p>` : ''}
    <label class="zi-drop" id="ziDrop" ondragover="event.preventDefault();this.classList.add('sobre')" ondragleave="this.classList.remove('sobre')" ondrop="ziSoltar(event)">
      <input type="file" accept=".zip,application/zip,image/*" multiple onchange="ziElegir(this.files)" hidden>
      <span class="zi-drop-ic">⇪</span>
      <b>Arrastra aquí tu ZIP o tus fotos</b>
      <span>o toca para elegirlos. La IA llena todo y tú solo revisas.</span>
    </label>
    <div class="zi-o"><span>o desde el celular</span></div>
    <button class="zi-sesion-btn" onclick="ziSesionEmpezar()">
      <span class="zi-sesion-ic">${ico('camara', 22)}</span>
      <span><b>Sesión de fotos</b><small>Toma las fotos prenda por prenda con la cámara. Cada vez que terminas una, tocas "Siguiente prenda" y la IA empieza a analizarla mientras fotografías la otra.</small></span>
      <em>→</em>
    </button>
    <div class="zi-tips">
      <div><b>Cómo armar el ZIP</b>
        <p><b>Lo mejor:</b> una carpeta por prenda (Prenda 1, Prenda 2…) y el ZIP con todas las carpetas.</p>
        <p><b>También sirve:</b> todas las fotos juntas, tomadas en orden (todas las de una prenda seguidas). Se separan por la hora de la foto y en el siguiente paso puedes corregirlo.</p></div>
      <div><b>Para que la IA atine</b>
        <p>Incluye una foto de la prenda completa de frente, una de atrás y una de la <b>etiqueta</b> (marca y talla). Con la etiqueta, la talla sale casi siempre bien.</p>
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

function ziSoltar(ev) { ev.preventDefault(); document.getElementById('ziDrop')?.classList.remove('sobre'); ziElegir(ev.dataTransfer.files); }

async function ziElegir(lista) {
  const archivos = [...(lista || [])]; if (!archivos.length) return;
  const zona = document.getElementById('ziLeyendo');
  if (zona) zona.innerHTML = '<div class="zi-cargando"><span class="zi-spin"></span>Abriendo fotos…</div>';
  try {
    let fotos = [];
    for (const a of archivos) {
      if (/\.zip$/i.test(a.name) || a.type.includes('zip')) fotos.push(...await ziLeerZip(a));
      else if (a.type.startsWith('image/') || ZI_IMG.test(a.name)) fotos.push({ nombre: a.name, base: a.name, carpeta: '', t: a.lastModified || 0, blob: a });
    }
    if (!fotos.length) throw new Error('No encontré fotos (JPG, PNG, WEBP o HEIC) en lo que elegiste.');
    // Huella de cada foto: quita repetidas y evita volver a subir lo ya subido
    const vistas = new Set(), subidas = ziMapaSubidas(); let repetidas = 0;
    for (const f of fotos) f.huella = await ziHuella(f.blob);
    fotos = fotos.filter(f => { if (f.huella && vistas.has(f.huella)) { repetidas++; return false; } vistas.add(f.huella); return true; });
    if (repetidas) toast(`Quité ${repetidas} foto(s) repetida(s)`);
    fotos.forEach(f => { f.heic = /\.(heic|heif)$/i.test(f.base); f.url = URL.createObjectURL(f.blob); if (f.huella && subidas[f.huella]) f.nube = subidas[f.huella]; });
    ZI.modoTrabajo = 'nuevas';
    ZI.fotos = fotos;
    fotos.forEach(f => ziSubirFoto(f).catch(() => {}));      // ya empiezan a subir mientras agrupas
    ZI.grupos = ziAgrupar(fotos);
    ZI.paso = 'agrupar';
    ziPintar();
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
}
function ziDescartar() { localStorage.removeItem(ZI_GUARDADO); ZI.pendiente = null; ziPintar(); }

// ── Paso 2 ───────────────────────────────────────────────────
function ziVistaAgrupar() {
  const nFotos = ZI.grupos.reduce((t, g) => t + g.fotos.length, 0);
  const heic = ZI.grupos.some(g => g.fotos.some(f => f.heic));
  const modoTxt = { carpetas: 'una prenda por carpeta', hora: `por hora de la foto (más de ${ZI.espera} s entre fotos = otra prenda)`, cadaN: `cada ${ZI.cadaN} fotos`, cada1: 'cada foto es una prenda' }[ZI.modoReal] || '';
  return `
    <div class="zi-barra">
      <div><b>${ZI.grupos.length} prenda${ZI.grupos.length === 1 ? '' : 's'}</b> · ${nFotos} fotos <small>Agrupadas ${modoTxt}</small><small id="ziSubidasTxt"></small></div>
      <div class="zi-fila">
        <select onchange="ziReagrupar(this.value)" aria-label="Cómo agrupar">
          <option value="">Agrupar de otra forma…</option>
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
    ${heic ? '<div class="zi-aviso suave">Hay fotos HEIC (iPhone). Se suben igual, pero en algunas computadoras no se ve la miniatura.</div>' : ''}
    <p class="zi-nota">Revisa que cada fila sea una sola prenda. Toca <b>✂</b> en una foto para que desde ahí empiece otra prenda, o <b>Unir</b> para juntar una fila con la de arriba.</p>
    <div class="zi-grupos">${ZI.grupos.map((g, gi) => `
      <div class="zi-grupo">
        <div class="zi-grupo-n">${gi + 1}</div>
        <div class="zi-tiras">${g.fotos.map((f, fi) => `
          <figure class="zi-foto">
            ${f.heic ? `<div class="zi-heic">HEIC</div>` : `<img src="${f.url}" alt="" loading="lazy" decoding="async">`}
            <div class="zi-foto-acc">
              ${fi > 0 ? `<button onclick="ziPartir(${gi},${fi})" title="Desde aquí es otra prenda" aria-label="Separar aquí">✂</button>` : ''}
              <button onclick="ziQuitarFoto(${gi},${fi})" title="Quitar foto" aria-label="Quitar foto">✕</button>
            </div>
          </figure>`).join('')}
        </div>
        <div class="zi-grupo-acc">
          ${gi > 0 ? `<button class="zi-btn mini" onclick="ziUnir(${gi})">Unir ↑</button>` : ''}
          <button class="zi-btn mini" onclick="ziQuitarGrupo(${gi})">Quitar</button>
        </div>
      </div>`).join('')}
    </div>
    <div class="zi-opciones">
      ${ziCalidadHtml()}
      <label class="zi-check"><input type="checkbox" ${ZI.buscar ? 'checked' : ''} onchange="ZI.buscar=this.checked;ziPrefs()"> <span><b>Buscar precios en internet</b><small>La IA revisa cuánto se vende usada en eBay, Grailed, Mercado Libre… Tarda un poco más y cuesta ~1 centavo de dólar extra por prenda.</small></span></label>
    </div>
    <div class="zi-fila fin">
      <button class="zi-btn" onclick="ZI.paso='elegir';ziPintar()">Atrás</button>
      <button class="zi-btn negro grande" onclick="ziEmpezar()" ${ZI.grupos.length ? '' : 'disabled'}>${ZI.ia?.activa ? `Subir y analizar ${ZI.grupos.length} prenda${ZI.grupos.length === 1 ? '' : 's'} con IA` : `Subir ${ZI.grupos.length} prenda${ZI.grupos.length === 1 ? '' : 's'} (llenar a mano)`}</button>
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

setInterval(() => { if (ZI.paso === 'agrupar') ziPintarSubidas(); }, 1000);

function ziReagrupar(v) {
  if (!v) return;
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

// ── Paso 3: subir + IA ───────────────────────────────────────
const ziDataUrl = blob => new Promise((ok, err) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => err(new Error('No se pudo leer la foto')); r.readAsDataURL(blob); });

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
  const cola = () => ZI.grupos.find(g => (g.estado === 'listo' || g.estado === 'reintentar') && !g.tomado);
  const trabajador = async () => {
    for (let g = cola(); g && !ZI.pausa; g = cola()) {
      g.tomado = true;
      try { await ziProcesar(g); } catch (e) { g.estado = 'error'; g.error = e.message; }
      g.tomado = false;
      ziGuardarLocal(); ziPintarTarjeta(g); ziPintarPie();
      if (/saldo|no es válida|Falta configurar/i.test(g.error || '')) { ZI.pausa = true; toast(g.error); }
    }
  };
  await Promise.all([trabajador(), trabajador()]);
  ZI.corriendo = false;
  window.removeEventListener('beforeunload', ziAntesDeSalir);
  ziPintarPie();
  const listos = ZI.grupos.filter(g => g.estado === 'hecho').length;
  if (!ZI.pausa && ZI.paso !== 'sesion') toast(`Listo: ${listos} prenda(s) para revisar`);
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
  }
  // 2 · IA
  if (ZI.ia?.activa) {
    g.estado = 'analizando'; ziPintarTarjeta(g);
    const a = g.antes;
    const r = await iaAnalizar({
      imagenes: g.subidas.slice(0, 4),
      huellas: g.fotos.length ? g.fotos.slice(0, 4).map(f => f.huella).filter(Boolean) : undefined,
      pista: a ? [a.nombre, a.marca && `marca ${a.marca}`, a.talla && `talla ${a.talla}`, a.estado && `estado ${a.estado}`].filter(Boolean).join(', ') : '',
      calidad: g.forzarCalidad || (a ? (ZI.calidad === 'maxima' ? 'maxima' : 'auto') : ZI.calidad),
    });
    g.forzarCalidad = null;
    g.ia = r;
    ZI.gastoSesion = (ZI.gastoSesion || 0) + (r.costoUSD || 0);
    if (a) {
      // Completar: solo lo que falta; nombre y precio se quedan
      g.f = { incluir: true, nombre: a.nombre, precio: a.precio };
      for (const k of ZI_CAMPOS) g.f[k] = a[k] || r[k] || '';
      g.estado = 'hecho'; g.error = '';
      return;
    }
    if (r.portada > 0 && !g.antes) { const [p] = g.subidas.splice(r.portada, 1); g.subidas.unshift(p); const [fp] = g.fotos.splice(r.portada, 1); g.fotos.unshift(fp); }
    g.f = {
      incluir: r.esPrenda !== false,
      nombre: r.nombre, marca: r.marca, categoria: r.categoria, talla: r.talla, estado: r.estado,
      precio: r.precioSugerido || '', costo: '', descripcion: r.descripcion, hashtags: r.hashtags,
      ...(g.reanalizar ? {} : g.f),   // lo que ya hubieras escrito a mano no se pisa
      ...(g.reanalizar ? { costo: g.f.costo ?? '' } : {}),
    };
    g.reanalizar = false;
  } else g.f = { incluir: true, ...g.f };
  g.estado = 'hecho'; g.error = '';
}

function ziGuardarLocal() {
  try {
    const grupos = ZI.grupos.filter(g => g.subidas.length && !g.guardada).map(({ id, subidas, estado, ia, f, error, prendaId, antes }) => ({ id, subidas, estado: estado === 'hecho' ? 'hecho' : 'reintentar', ia, f, error, prendaId, antes }));
    if (grupos.length) localStorage.setItem(ZI_GUARDADO, JSON.stringify({ en: Date.now(), grupos, opciones: { buscar: ZI.buscar, publicarIG: ZI.publicarIG, ocultas: ZI.ocultas, modoTrabajo: ZI.modoTrabajo } }));
    else localStorage.removeItem(ZI_GUARDADO);
  } catch {}
}

// ── Revisión ─────────────────────────────────────────────────
function ziVistaRevisar() {
  return `${ZI.modoTrabajo === 'completar' ? '' : ziHerramientas()}
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

function ziOpciones(lista, valor, vacio = '—') {
  const v = String(valor || '');
  const extra = v && !lista.includes(v) ? `<option selected>${escAdmin(v)}</option>` : '';
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
  const tira = `<div class="zi-t-fotos">${fotos.map((u, i) => u
    ? `<button class="zi-t-foto ${i === 0 ? 'portada' : ''}" onclick="ziPortada(${g.id},${i})" title="${i === 0 ? 'Portada' : 'Usar como portada'}"><img src="${escAdmin(u)}" alt="" loading="lazy" decoding="async"></button>`
    : `<div class="zi-t-foto zi-heic">HEIC</div>`).join('')}</div>`;
  if (g.guardada) return `${tira}<div class="zi-t-ok">✓ Guardada${g.ig ? ' · ' + escAdmin(g.ig) : ''}</div>`;
  if (g.estado !== 'hecho') {
    const txt = { listo: 'En espera…', reintentar: 'En espera…', subiendo: `Subiendo fotos ${g.subidas.length}/${g.fotos.length}…`, analizando: 'La IA está viendo la prenda…', error: g.error }[g.estado] || '';
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
    ${tira}
    <div class="zi-t-datos ${f.incluir === false ? 'fuera' : ''}">
      <div class="zi-t-cab">
        <label class="zi-check sola"><input type="checkbox" ${f.incluir !== false ? 'checked' : ''} onchange="ziCampo(${g.id},'incluir',this.checked);ziPintarTarjeta(ZI.grupos.find(x=>x.id===${g.id}));ziPintarPie()"> Guardar</label>
        <div class="zi-confs">${ziConf('Marca', c.marca)}${ziConf('Talla', c.talla)}${g.antes ? '' : ziConf('Precio', c.precio)}
          ${ziDudosa(g) ? `<button class="zi-conf mod btn" onclick="ziReanalizar(${g.id})" title="Volver a analizar con el modelo preciso">↻ precisa</button>` : ''}
          ${ia.desdeMemoria ? '<span class="zi-conf mod">memoria · gratis</span>' : ia.modelo ? `<span class="zi-conf mod" title="${escAdmin(ia.modelo)}">${/haiku/.test(ia.modelo) ? 'rápida' : 'precisa'}${ia.costoUSD ? ' · ' + usd(ia.costoUSD) : ''}</span>` : ''}</div>
      </div>
      ${g.antes ? `<p class="zi-nota mini">Solo se llenan los campos vacíos${ZI_CAMPOS.filter(k => !g.antes[k] && g.f[k]).length ? ': <b>' + ZI_CAMPOS.filter(k => !g.antes[k] && g.f[k]).join(', ') + '</b>' : ' (no encontró nada nuevo)'}.</p>` : ''}
      ${ia.esPrenda === false ? '<div class="zi-aviso suave mini">La IA cree que estas fotos no son de una prenda. Revisa antes de guardarla.</div>' : ''}
      ${ia.fallas?.length ? `<div class="zi-fallas">${ico('alerta', 15)} Fallas que vio la IA: ${ia.fallas.map(escAdmin).join(' · ')} <small>(van en la descripción para evitar reclamos)</small></div>` : ''}
      <div class="zi-rej">
        ${inp('nombre', 'Nombre', 'maxlength="80" class="ancho"')}
        ${inp('marca', 'Marca', 'maxlength="40"')}
        ${sel('categoria', 'Categoría', ziOpciones(ziCategorias(), f.categoria))}
        ${sel('talla', 'Talla', ziOpcionesTalla(f.talla))}
        ${sel('estado', 'Estado', ziOpciones(ESTADOS, f.estado))}
        <label class="zi-c precio"><span>Precio</span><input type="number" min="0" step="10" value="${escAdmin(f.precio ?? '')}" oninput="ziCampo(${g.id},'precio',this.value)">${pista ? `<small>${pista}</small>` : ''}</label>
        <label class="zi-c"><span>Costo (opcional)</span><input type="number" min="0" step="10" value="${escAdmin(f.costo ?? '')}" oninput="ziCampo(${g.id},'costo',this.value)"></label>
        <label class="zi-c ancho"><span>Descripción</span><textarea rows="2" maxlength="600" oninput="ziCampo(${g.id},'descripcion',this.value)">${escAdmin(f.descripcion || '')}</textarea></label>
        ${inp('hashtags', 'Hashtags', 'maxlength="300" class="ancho"')}
      </div>
      ${ia.razonPrecio ? `<p class="zi-razon">${ico('foco', 15)} ${escAdmin(ia.razonPrecio)}</p>` : ''}
    </div>`;
}

function ziCampo(id, k, v) {
  const g = ZI.grupos.find(x => x.id === id); if (!g) return;
  g.f[k] = v; clearTimeout(ZI._t); ZI._t = setTimeout(() => { ziGuardarLocal(); ziPintarPie(); }, 400);
}
function ziPortada(id, i) {
  const g = ZI.grupos.find(x => x.id === id); if (!g || !i) return;
  if (g.subidas[i]) { const [u] = g.subidas.splice(i, 1); g.subidas.unshift(u); }
  if (g.fotos[i]) { const [f] = g.fotos.splice(i, 1); g.fotos.unshift(f); }
  ziGuardarLocal(); ziPintarTarjeta(g);
}
function ziReintentar(id) {
  const g = ZI.grupos.find(x => x.id === id); if (!g) return;
  g.estado = 'reintentar'; g.error = ''; ziPintarTarjeta(g); ziCorrer();
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
  const aGuardar = ZI.grupos.filter(g => g.estado === 'hecho' && !g.guardada && g.f.incluir !== false);
  const sinPrecio = aGuardar.filter(g => !(Number(g.f.precio) > 0) || !String(g.f.nombre || '').trim()).length;
  const pct = total ? Math.round(hechos / total * 100) : 0;
  return `
    <div class="zi-prog"><div class="zi-prog-b" style="width:${pct}%"></div></div>
    <div class="zi-pie-fila">
      <div class="zi-pie-txt"><b>${hechos} de ${total}</b> listas${ZI.gastoSesion ? ` · gastado ${usd(ZI.gastoSesion)}` : ''}${errores ? ` · <span class="rojo">${errores} con error</span>` : ''}${sinPrecio ? ` · ${sinPrecio} sin nombre o precio` : ''}
        ${ZI.corriendo ? (ZI.pausa ? ' · pausando…' : ' · trabajando…') : ''}</div>
      <div class="zi-fila">
        ${ZI.corriendo && !ZI.pausa ? '<button class="zi-btn" onclick="ziPausar()">Pausar</button>' : ''}
        ${!ZI.corriendo && ZI.grupos.some(g => g.estado === 'listo' || g.estado === 'reintentar') ? '<button class="zi-btn" onclick="ziCorrer()">Seguir analizando</button>' : ''}
        ${ZI.modoTrabajo === 'completar' ? '' : ziOpcionesGuardar()}
        ${!aGuardar.length && total && ZI.grupos.every(g => g.guardada || g.f?.incluir === false) && !ZI.guardando ? '<button class="zi-btn" onclick="ziNueva()">Importar más</button>' : ''}
        <button class="zi-btn negro" onclick="ziGuardarTodas()" ${aGuardar.length && !ZI.guardando ? '' : 'disabled'}>${ZI.guardando ? 'Guardando…' : `Guardar ${aGuardar.length} prenda${aGuardar.length === 1 ? '' : 's'}`}</button>
      </div>
    </div>`;
}

async function ziGuardarTodas() {
  if (ZI.modoTrabajo === 'completar') return ziGuardarCompletadas();
  const lista = ZI.grupos.filter(g => g.estado === 'hecho' && !g.guardada && g.f.incluir !== false);
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
    try {
      const p = await crearPrenda({
        nombre: String(f.nombre).trim(), marca: String(f.marca || '').trim(),
        categorias: f.categoria ? [f.categoria] : [],
        talla: f.talla || '', estado: f.estado || '',
        precio_venta: Number(f.precio), costo: f.costo === '' || f.costo == null ? null : Number(f.costo),
        descripcion: String(f.descripcion || '').trim(),
        hashtags: typeof limpiarHashtags === 'function' ? limpiarHashtags(f.hashtags) : String(f.hashtags || ''),
        imagenes: g.subidas, vendido: false, oculto: ZI.ig === 'drop',
        bazarId: typeof bazarParaNuevas === 'function' ? bazarParaNuevas() : undefined,
      });
      g.guardada = true; g.prendaId = p.id; ok++; nuevas.push(g);
      registrarLog?.('subir', p.nombre, `Importada desde ZIP · $${f.precio}`);
    } catch (e) { g.error = e.message; toast(`${f.nombre}: ${e.message}`); }
    ziPintarTarjeta(g); ziPintarPie();
  }
  ziGuardarLocal();
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
  const g = { id: ZI.sig++, fotos: fotos.slice(0, 10), subidas: [], estado: 'listo', f: {} };
  ZI.grupos.push(g); ZI.sesion.fotos = [];
  ziPintar(); ziCorrer();                      // la IA empieza con esta mientras tomas la siguiente
}
function ziSesionQuitar(i) { ZI.sesion.fotos.splice(i, 1); ziPintar(); }
function ziSesionTerminar() {
  if (ZI.sesion.fotos.length) ziSesionSiguiente();
  if (!ZI.grupos.length) return toast('Toma fotos de al menos una prenda');
  ZI.paso = 'revisar'; ziPintar();
}
function ziVistaSesion() {
  const n = ZI.grupos.length + 1, fotos = ZI.sesion?.fotos || [];
  return `<div class="zi-sesion">
    <div class="zi-sesion-cab"><span class="zi-sesion-n">Prenda ${n}</span><small>${fotos.length ? `${fotos.length} foto${fotos.length === 1 ? '' : 's'}` : 'Frente, atrás y etiqueta'}</small></div>
    <div class="zi-sesion-fotos">
      ${fotos.map((f, i) => `<figure>${f.heic ? '<div class="zi-heic">HEIC</div>' : `<img src="${f.url}" alt="">`}<button onclick="ziSesionQuitar(${i})" aria-label="Quitar">✕</button></figure>`).join('')}
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
    ${g.fotos[0]?.url && !g.fotos[0].heic ? `<img src="${g.fotos[0].url}" alt="">` : '<span class="zi-heic">·</span>'}
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
      await guardarPrenda(g.prendaId, cambios);
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
  caja.innerHTML = `<button type="button" id="iaLlenarBtn" class="zi-abrir" onclick="iaLlenarFormulario()"><span aria-hidden="true">✦</span> Llenar datos con IA</button>
    <small id="iaLlenarNota">Sube las fotos (frente, atrás y etiqueta) y la IA llena nombre, marca, talla, estado, precio, descripción y hashtags.</small>`;
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
    const r = await iaAnalizar({ imagenes: fotos.slice(0, 4), pista: nombreActual });
    const v = (id, val, pisar) => { const el = document.getElementById(id); if (el && val && (pisar || !String(el.value || '').trim())) el.value = val; };
    v('f_nombre', r.nombre);
    // Marca: si no existe en la lista, se agrega como opción
    const sel = document.getElementById('f_marca');
    if (sel && r.marca && !sel.value) {
      let op = [...sel.options].find(o => o.value.toLowerCase() === r.marca.toLowerCase());
      if (!op) { op = new Option(r.marca, r.marca); sel.add(op); }
      sel.value = op.value;
    }
    if (r.categoria) document.querySelectorAll('#f_cats_wrap input').forEach(i => { if (i.value === r.categoria && !getSelectedCats().length) i.checked = true; });
    if (r.talla && typeof escribirTalla === 'function' && !leerTalla('f')) escribirTalla('f', r.talla);
    if (r.estado && !document.getElementById('f_estado').value) {
      const pill = document.querySelector(`#f_estado_pills [data-estado="${CSS.escape(r.estado)}"]`);
      if (pill) elegirEstado('f', pill);
    }
    v('f_precio', r.precioSugerido);
    v('f_descripcion', r.descripcion);
    v('f_hashtags', r.hashtags);
    ZI.ultimaFormulario = r;
    nota.innerHTML = `Listo${r.desdeMemoria ? ' (de memoria, gratis)' : r.costoUSD ? ` · ${usd(r.costoUSD)}` : ''}. Precio sugerido $${r.precioSugerido || '—'}${r.rangoPrecio?.[1] ? ` (rango $${r.rangoPrecio[0]}–$${r.rangoPrecio[1]})` : ''}${r.razonPrecio ? ' · ' + escAdmin(r.razonPrecio.replace(/\.\s*$/, '')) : ''}. Revisa la talla${r.confianza?.talla < 0.5 ? ' (no vio la etiqueta)' : ''} y guarda.`;
    document.getElementById('f_nombre').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) { toast(e.message); }
  btn.disabled = false; btn.innerHTML = '<span aria-hidden="true">✦</span> Llenar datos con IA';
}

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
