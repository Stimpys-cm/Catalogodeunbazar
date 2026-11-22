// ─────────────────────────────────────────────────────────────
//  js/ig-borradores.js — Borradores y ayudas del panel de Instagram
//
//  · Crear: lo que armas se guarda solo (en este navegador al instante y en
//    el servidor cada pocos segundos), así lo sigues en otro dispositivo.
//  · Sección "Borradores": continuar, duplicar, borrar. Un programado se
//    puede regresar a borrador para editarlo.
//  · Respuestas a comentarios, DMs y edición de texto de un post: se guardan
//    mientras escribes y vuelven a aparecer si cierras y regresas.
//  · ✦ IA: escribir la descripción, sugerir respuesta a comentarios y DMs.
//  · Mejores horas para programar (según tus posts con más interacción)
//    y contador de hashtags (Instagram acepta máx. 30).
// ─────────────────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════
//  Borradores de texto (comentarios, DMs, edición de caption)
// ═════════════════════════════════════════════════════════════
const IGT_KEY = 'stmp-ig-textos-v1';
const IGT_DIAS = 14;
function igTextos() {
  try {
    const t = JSON.parse(localStorage.getItem(IGT_KEY) || '{}'), lim = Date.now() - IGT_DIAS * 864e5;
    for (const k of Object.keys(t)) if (!t[k]?.v || t[k].en < lim) delete t[k];
    return t;
  } catch { return {}; }
}
function igGuardarTexto(k, v) {
  if (!k) return;
  try {
    const t = igTextos();
    if (String(v || '').trim() && !/^@[\w.]+\s?$/.test(v)) t[k] = { v: String(v).slice(0, 2200), en: Date.now() }; else delete t[k];
    localStorage.setItem(IGT_KEY, JSON.stringify(t));
  } catch {}
}
function igBorrarTexto(k) { igGuardarTexto(k, ''); }

document.addEventListener('input', e => {
  const el = e.target?.closest?.('[data-borrador]');
  if (el) igGuardarTexto(el.dataset.borrador, el.value);
});

// Cuando aparece un campo con borrador guardado, se rellena
function igRestaurarEn(raiz) {
  const campos = raiz.matches?.('[data-borrador]') ? [raiz] : [...(raiz.querySelectorAll?.('[data-borrador]') || [])];
  if (!campos.length) return;
  const t = igTextos();
  for (const el of campos) {
    const g = t[el.dataset.borrador];
    if (!g || el.dataset.restaurado) continue;
    if (el.value && !/^@[\w.]+\s?$/.test(el.value) && el.value !== el.defaultValue) continue;
    el.value = g.v; el.dataset.restaurado = '1';
    el.classList.add('igb-restaurado'); el.title = 'Borrador guardado';
    // Si es la respuesta a un comentario, se deja abierta
    el.closest('.igx-resp-form')?.classList.remove('hidden');
  }
}
new MutationObserver(ms => {
  for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) igRestaurarEn(n);
}).observe(document.documentElement, { childList: true, subtree: true });

// ═════════════════════════════════════════════════════════════
//  Borradores de publicaciones (Crear)
// ═════════════════════════════════════════════════════════════
const IGB_LOCAL = 'stmp-ig-crear-v1';
Object.assign(IG, { borradores: null, cargandoBorradores: false, borradorId: null, borradorEstado: '', borradorEn: null, _ultimoComp: '' });

const igComp = () => ({ tipo: IG.tipo, fotos: [...IG.fotos], caption: IG.caption, prendaId: IG.prendaId, usarPlantilla: IG.usarPlantilla, cuando: IG.cuando, fechaProg: IG.fechaProg });
const igCompVacia = c => !c.fotos.length && !String(c.caption || '').trim();

// Lo que dejaste a medias en este navegador vuelve al abrir
try {
  const g = JSON.parse(localStorage.getItem(IGB_LOCAL) || 'null');
  if (g?.comp && !igCompVacia(g.comp)) { Object.assign(IG, g.comp); IG.borradorId = g.id || null; IG._ultimoComp = JSON.stringify(g.comp); IG.borradorEstado = g.id ? 'guardado' : 'local'; IG.borradorEn = g.en; }
} catch {}

let _igbT = null;
function igCambioCrear() {
  const c = igComp(), j = JSON.stringify(c);
  if (j === IG._ultimoComp) return;
  IG._ultimoComp = j;
  try {
    if (igCompVacia(c) && !IG.borradorId) localStorage.removeItem(IGB_LOCAL);
    else localStorage.setItem(IGB_LOCAL, JSON.stringify({ comp: c, id: IG.borradorId, en: Date.now() }));
  } catch {}
  if (igCompVacia(c)) { igPintarEstadoBorrador(); return; }
  IG.borradorEstado = 'pendiente'; igPintarEstadoBorrador();
  clearTimeout(_igbT); _igbT = setTimeout(igSubirBorrador, 1500);
}

async function igSubirBorrador() {
  const c = igComp(); if (igCompVacia(c)) return;
  IG.borradorEstado = 'guardando'; igPintarEstadoBorrador();
  try {
    const r = await igApi('ig-borrador', { ...c, id: IG.borradorId });
    IG.borradorId = r.id; IG.borradorEn = Date.parse(r.actualizado) || Date.now(); IG.borradorEstado = 'guardado';
    try { localStorage.setItem(IGB_LOCAL, JSON.stringify({ comp: c, id: r.id, en: IG.borradorEn })); } catch {}
    if (IG.borradores) {
      const i = IG.borradores.findIndex(b => b.id === r.id), d = { ...c, id: r.id, actualizado: r.actualizado, editadoPor: '' };
      if (i >= 0) IG.borradores[i] = { ...IG.borradores[i], ...d }; else IG.borradores.unshift(d);
    } else igCargarBorradores(true);
  } catch (e) { IG.borradorEstado = 'error'; IG.borradorError = e.message; }
  igPintarEstadoBorrador();
}

function igTextoEstadoBorrador() {
  switch (IG.borradorEstado) {
    case 'pendiente': return 'Cambios sin guardar…';
    case 'guardando': return 'Guardando…';
    case 'guardado': return `Borrador guardado${IG.borradorEn ? ' · ' + new Date(IG.borradorEn).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' }) : ''}`;
    case 'local': return 'Guardado en este navegador';
    case 'error': return 'Guardado solo en este navegador (sin conexión)';
    default: return 'Se guarda solo mientras escribes';
  }
}
function igPintarEstadoBorrador() {
  const el = document.getElementById('igBorradorEstado');
  if (el) { el.textContent = igTextoEstadoBorrador(); el.dataset.e = IG.borradorEstado; }
}

function igNuevoCrear() {
  clearTimeout(_igbT);
  Object.assign(IG, { fotos: [], caption: '', prendaId: null, fechaProg: '', cuando: 'ahora', borradorId: null, borradorEstado: '', borradorEn: null });
  IG._ultimoComp = JSON.stringify(igComp());
  try { localStorage.removeItem(IGB_LOCAL); } catch {}
  igRefrescar();
}

// ── Lista ────────────────────────────────────────────────────
async function igCargarBorradores(silencioso) {
  IG.cargandoBorradores = true;
  if (!silencioso && IG.vista === 'borradores') igRefrescar();
  try { IG.borradores = (await igApi('ig-borradores')).borradores || []; }
  catch (e) { IG.borradores = IG.borradores || []; IG.errorBorradores = e.message; }
  IG.cargandoBorradores = false;
  if (IG.vista === 'borradores') igRefrescar();
  else document.querySelectorAll('.igx-item').forEach(b => { if (b.getAttribute('onclick')?.includes("'borradores'")) { const em = b.querySelector('em'); const n = IG.borradores.length; if (n) { if (em) em.textContent = n; else b.insertAdjacentHTML('beforeend', `<em>${n}</em>`); } else em?.remove(); } });
}

function igVistaBorradores() {
  if (!IG.borradores) { if (!IG.cargandoBorradores) igCargarBorradores(); return igCabecera('Borradores', 'Lo que dejaste a medias') + '<div class="igx-cargando"><span class="igx-spin"></span>Cargando…</div>'; }
  const lista = IG.borradores;
  return `
    ${igCabecera('Borradores', 'Todo lo que armas en Crear se guarda solo. Sigue en cualquier dispositivo.', `<button class="igx-btn grad" onclick="igNuevoCrear();igVista('crear')">${I.plus} Nuevo</button>`)}
    ${!lista.length ? '<div class="igx-vacio">No tienes borradores. Lo que empieces en <b>Crear</b> aparecerá aquí.</div>' : `
    <div class="igb-lista">${lista.map(b => {
      const linea = String(b.caption || '').split('\n').find(x => x.trim()) || (b.tipo === 'historia' ? 'Historia sin texto' : 'Sin texto');
      const activo = b.id === IG.borradorId;
      return `<article class="igb-item ${activo ? 'on' : ''}">
        <button class="igb-mini" onclick="igAbrirBorrador('${igEsc(b.id)}')" aria-label="Continuar">${b.fotos?.[0] ? `<img src="${igEsc(igMini(b.fotos[0], 200))}" alt="" loading="lazy">` : `<span>${I.edit}</span>`}
          ${b.fotos?.length > 1 ? `<em>${b.fotos.length}</em>` : ''}</button>
        <div class="igb-info">
          <b>${igEsc(linea.slice(0, 90))}</b>
          <small>${b.tipo === 'historia' ? 'Historia' : b.fotos?.length > 1 ? 'Carrusel' : 'Post'} · ${igFecha(b.actualizado)}${b.editadoPor ? ' · ' + igEsc(b.editadoPor) : ''}${activo ? ' · <i>abierto en Crear</i>' : ''}</small>
        </div>
        <div class="igb-acc">
          <button class="igx-btn grad mini" onclick="igAbrirBorrador('${igEsc(b.id)}')">Continuar</button>
          <button class="igx-btn ghost mini" onclick="igDuplicarBorrador('${igEsc(b.id)}')">Duplicar</button>
          <button class="igx-btn ghost mini peligro" onclick="igBorrarBorrador('${igEsc(b.id)}')" aria-label="Borrar">${I.trash}</button>
        </div>
      </article>`;
    }).join('')}</div>`}`;
}

function igAbrirBorrador(id) {
  const b = IG.borradores?.find(x => x.id === id); if (!b) return;
  clearTimeout(_igbT);
  Object.assign(IG, { tipo: b.tipo, fotos: [...(b.fotos || [])], caption: b.caption || '', prendaId: b.prendaId || null, usarPlantilla: b.usarPlantilla !== false,
    cuando: b.cuando || 'ahora', fechaProg: b.fechaProg || '', borradorId: b.id, borradorEstado: 'guardado', borradorEn: Date.parse(b.actualizado) });
  IG._ultimoComp = JSON.stringify(igComp());
  try { localStorage.setItem(IGB_LOCAL, JSON.stringify({ comp: igComp(), id: b.id, en: Date.now() })); } catch {}
  igVista('crear');
}
async function igDuplicarBorrador(id) {
  const b = IG.borradores?.find(x => x.id === id); if (!b) return;
  try { await igApi('ig-borrador', { ...b, id: undefined }); toast('Borrador duplicado'); igCargarBorradores(); } catch (e) { toast(e.message); }
}
async function igBorrarBorrador(id) {
  if (!(await uiConfirm({ titulo: 'Borrar borrador', mensaje: 'Se borra de todos tus dispositivos.', ok: 'Borrar', peligro: true }))) return;
  try {
    await igApi('ig-borrador-borrar', { id });
    IG.borradores = IG.borradores.filter(x => x.id !== id);
    if (IG.borradorId === id) { IG.borradorId = null; IG.borradorEstado = 'local'; }
    igRefrescar(); toast('Borrador borrado');
  } catch (e) { toast(e.message); }
}
async function igProgramadoABorrador(id) {
  if (!(await uiConfirm({ titulo: 'Editar programado', mensaje: 'Se quita de la cola y pasa a Borradores para que lo edites. Al terminar, vuelve a programarlo.', ok: 'Editar' }))) return;
  try {
    const r = await igApi('ig-programado-a-borrador', { id });
    IG.programados = null; IG.estado.pendientes = Math.max(0, (IG.estado.pendientes || 1) - 1);
    (IG.borradores ||= []).unshift(r.borrador);
    igAbrirBorrador(r.borrador.id);
  } catch (e) { toast(e.message); }
}

// ═════════════════════════════════════════════════════════════
//  Mejores horas para publicar
// ═════════════════════════════════════════════════════════════
function igMejoresHoras() {
  const posts = (IG.posts || []).filter(p => p.timestamp);
  let horas;
  if (posts.length >= 8) {
    const m = new Map();
    for (const p of posts) {
      const h = new Date(p.timestamp).getHours();
      const x = m.get(h) || { s: 0, n: 0 }; x.s += (p.like_count || 0) + 2 * (p.comments_count || 0); x.n++; m.set(h, x);
    }
    horas = [...m].filter(([, x]) => x.n >= 2).map(([h, x]) => [h, x.s / x.n]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => h);
  }
  const fuente = horas?.length ? 'según tus posts con más interacción' : 'horas comunes con más actividad';
  if (!horas?.length) horas = [19, 13, 21];
  // Próximas fechas para cada hora (hoy si aún no pasa, si no mañana)
  const ahora = new Date();
  const opciones = horas.map(h => {
    const d = new Date(ahora); d.setHours(h, 0, 0, 0);
    if (d - ahora < 20 * 60000) d.setDate(d.getDate() + 1);
    return d;
  }).sort((a, b) => a - b);
  return { opciones, fuente };
}
const igLocalISO = d => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
function igUsarHora(iso) { IG.fechaProg = iso; igRefrescar(); }

// ═════════════════════════════════════════════════════════════
//  ✦ IA para textos
// ═════════════════════════════════════════════════════════════
async function igIATexto(cuerpo) {
  return api('/api/acciones?op=ia-texto', { method: 'POST', body: { ...cuerpo, bazarId: IG.bazarId || undefined } });
}
function igPrendaParaIA(p) {
  if (!p) return null;
  return { nombre: p.nombre, marca: p.marca, talla: p.talla, estado: p.estado, precio: p.precio_venta, descripcion: p.descripcion, link: `stiimpys.store/prenda.html?id=${p.id}` };
}
async function igIACaption() {
  const btn = document.getElementById('igIACap'); if (btn) { btn.disabled = true; btn.textContent = '✦ Escribiendo…'; }
  try {
    const cfg = IG.estado?.config || {};
    const prenda = IG.prendaId ? getDB().find(x => Number(x.id) === Number(IG.prendaId)) : null;
    const r = await igIATexto({ tipo: 'caption', prenda: igPrendaParaIA(prenda), caption: IG.caption, firma: cfg.firma, hashtags: prenda ? igHashtagsPrenda(prenda, cfg, igBazar() || {}) : cfg.hashtags });
    const ta = document.getElementById('igCapInput');
    if (ta) { ta.value = r.texto; igCapCambio(r.texto); }
    toast('Listo. Revísalo antes de publicar');
  } catch (e) { toast(e.message); }
  if (btn) { btn.disabled = false; btn.textContent = '✦ Escribir con IA'; }
}
async function igIASugerirComentario(id) {
  const c = igBuscarComentario(id); if (!c) return;
  const input = document.querySelector(`#igResp-${id} input`); if (!input) return;
  const antes = input.placeholder; input.placeholder = '✦ Pensando…'; input.disabled = true;
  try {
    const post = IG.post?.caption || IG.posts?.find(p => p.id === c.mediaId || p.id === c.post?.id)?.caption || '';
    const r = await igIATexto({ tipo: 'comentario', comentario: c.text, usuario: c.username, post });
    input.value = r.texto; igGuardarTexto('com:' + id, r.texto);
  } catch (e) { toast(e.message); }
  input.disabled = false; input.placeholder = antes; input.focus();
}
async function igIASugerirDM() {
  const input = document.getElementById('igDmInput'); if (!input || !IG.hilo) return;
  input.disabled = true; const antes = input.placeholder; input.placeholder = '✦ Pensando…';
  try {
    const r = await igIATexto({ tipo: 'dm', usuario: IG.hilo.usuario, mensajes: (IG.hilo.mensajes || []).map(m => ({ deMi: !!m.deMi, texto: m.texto || '(foto)' })) });
    input.value = r.texto; igGuardarTexto('dm:' + (IG.convActiva || ''), r.texto);
  } catch (e) { toast(e.message); }
  input.disabled = false; input.placeholder = antes; input.focus();
}

// ═════════════════════════════════════════════════════════════
//  Enganches al panel (sin tocar su lógica)
// ═════════════════════════════════════════════════════════════
(function enganchar() {
  // Crear: barra de borrador, botón IA, horas sugeridas, contador de hashtags
  const vistaCrear = igVistaCrear;
  igVistaCrear = function () {
    let html = vistaCrear();
    const n = IG.borradores?.length || 0;
    html = html.replace('<div class="igx-crear">', `
      <div class="igb-barra">
        <span class="igb-estado" id="igBorradorEstado" data-e="${IG.borradorEstado}">${igTextoEstadoBorrador()}</span>
        <span class="igx-fila">
          <button class="igx-btn ghost mini" onclick="igVista('borradores')">${I.edit} Borradores${n ? ` (${n})` : ''}</button>
          ${!igCompVacia(igComp()) ? `<button class="igx-btn ghost mini" onclick="igNuevoCrear()">${I.plus} Empezar otro</button>` : ''}
        </span>
      </div>
      <div class="igx-crear">`);
    html = html.replace('<button class="igx-chip-btn" onclick="igInsertar(', `<button class="igx-chip-btn ia" id="igIACap" onclick="igIACaption()">✦ Escribir con IA</button><button class="igx-chip-btn" onclick="igInsertar(`);
    html = html.replace(/(<span id="igCapCont">)([^<]*)(<\/span>)/, (_, a, b, c) => `${a}${igContador(IG.caption)}${c}`);
    if (IG.cuando === 'programar') {
      const { opciones, fuente } = igMejoresHoras();
      const chips = `<div class="igb-horas"><small>Mejores horas (${fuente}):</small>${opciones.map(d => {
        const iso = igLocalISO(d);
        return `<button class="igx-chip-btn ${IG.fechaProg === iso ? 'on' : ''}" onclick="igUsarHora('${iso}')">${d.toLocaleString('es-MX', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</button>`;
      }).join('')}</div>`;
      html = html.replace(/(<input type="datetime-local"[^>]*>)/, `$1${chips}`);
    }
    return html;
  };

  const capCambio = igCapCambio;
  igCapCambio = function (v) {
    capCambio(v);
    const c = document.getElementById('igCapCont'); if (c) { c.innerHTML = igContador(v); }
    igCambioCrear();
  };

  const refrescar = igRefrescar;
  igRefrescar = function () { refrescar(); if (IG.vista === 'crear') igCambioCrear(); };

  const publicar = igPublicar;
  igPublicar = async function () {
    const tags = (String(IG.caption || '').match(/#[\p{L}\p{N}_]+/gu) || []).length;
    if (tags > 30) return toast(`Tienes ${tags} hashtags; Instagram acepta máximo 30`);
    const id = IG.borradorId;
    await publicar();
    // Si se publicó o programó, Crear queda vacío → el borrador ya no hace falta
    if (!IG.fotos.length && !IG.caption) {
      clearTimeout(_igbT);
      try { localStorage.removeItem(IGB_LOCAL); } catch {}
      IG.borradorId = null; IG.borradorEstado = ''; IG._ultimoComp = JSON.stringify(igComp());
      if (id) { igApi('ig-borrador-borrar', { id }).catch(() => {}); if (IG.borradores) IG.borradores = IG.borradores.filter(b => b.id !== id); }
    }
  };

  // Al abrir el panel se cargan los borradores (para el contador)
  const alEntrar = typeof igAlEntrar === 'function' ? igAlEntrar : null;
  if (alEntrar) igAlEntrar = function () { alEntrar(); if (!IG.borradores && !IG.cargandoBorradores && IG.estado?.conectado) igCargarBorradores(true); };

  // Si cierras la pestaña con cambios sin subir, se intenta subir
  window.addEventListener('pagehide', () => { if (IG.borradorEstado === 'pendiente') igSubirBorrador(); });
})();

function igContador(v) {
  const t = String(v || '');
  const tags = (t.match(/#[\p{L}\p{N}_]+/gu) || []).length;
  return `${t.length}/2200 · <span class="${tags > 30 ? 'igb-mal' : ''}">${tags}/30 #</span>${tags > 30 ? ' — Instagram no publica con más de 30' : ''}`;
}
