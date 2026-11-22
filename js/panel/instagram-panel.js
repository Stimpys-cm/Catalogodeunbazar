/* ═══════════════════════════════════════════════════════════
   Administrador de Instagram — Stiimpys
   Habla solo con /api/acciones?op=ig-* (el token nunca llega aquí).

   Secciones (menú interno):
     Resumen · Publicaciones · Comentarios · Mensajes ·
     Crear · Programados · Ajustes
   Usa globales del panel: api, toast, getDB, getBazares, esAdminGlobal,
   miBazarId, isAdmin, uiConfirm, uploadToCloud, registrarLog.
   ═══════════════════════════════════════════════════════════ */

const IG = {
  bazarId: null,
  estado: null,                 // { conectado, perfil, config, pendientes, error }
  vista: 'resumen',
  // Resumen
  resumen: null, cargandoResumen: false,
  // Publicaciones
  posts: [], siguiente: null, cargandoPosts: false,
  filtro: 'todas', seleccion: new Set(), modoSeleccion: false, lote: null,
  // Modal post
  post: null, comentarios: [], cargandoComs: false, statsPost: null,
  // Bandeja
  bandeja: null, cargandoBandeja: false, filtroBandeja: 'pendientes',
  // DMs
  dms: null, cargandoDms: false, dmError: '', hilo: null, convActiva: null,
  // Crear
  tipo: 'post', fotos: [], caption: '', prendaId: null, usarPlantilla: true,
  cuando: 'ahora', fechaProg: '', publicando: false,
  // Programados
  programados: null,
  // Historias
  historias: null, cargandoHistorias: false, estiloHistoria: null, publicandoHistoria: null,
};

// ── Utilidades ───────────────────────────────────────────────
const igEsc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const igNum = n => (n == null || n === '' ? '–' : Number(n).toLocaleString('es-MX'));
const igCorto = n => {
  if (n == null) return '–';
  n = Number(n);
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + ' M';
  if (n >= 1e4) return (n / 1e3).toFixed(1).replace('.0', '') + ' mil';
  return n.toLocaleString('es-MX');
};
const igQS  = () => (IG.bazarId ? `&bazarId=${encodeURIComponent(IG.bazarId)}` : '');
const igApi = (op, body, extra = '') => body === undefined
  ? api(`/api/acciones?op=${op}${igQS()}${extra}`)
  : api(`/api/acciones?op=${op}${igQS()}${extra}`, { method: 'POST', body: { ...body, bazarId: IG.bazarId } });

// "Reconectar cuenta" en cualquier aviso de token vencido lleva a Instagram → Ajustes
if (typeof Avisos === 'object') Avisos.registrarAccion('instagram', { texto: 'Reconectar cuenta', al: () => {
  if (typeof showTab === 'function') showTab('instagram');
  setTimeout(() => { if (typeof igVista === 'function') igVista('ajustes'); }, 350);
} });
// Token vencido o por vencer: aviso al entrar (el de "por vencer", una vez al día)
function igAvisarToken(t) {
  if (!t || typeof Avisos !== 'object') return;
  if (t.valido === false) return Avisos.mostrar('El token de Instagram ya no es válido', { tipo: 'error', critico: true, clave: 'ig-token', origen: 'instagram',
    titulo: 'Instagram necesita reconectarse', cuerpo: 'Mientras tanto no se publica nada en tu perfil.', log: false });
  if (!t.vence) return;
  const dias = Math.ceil((new Date(t.vence) - Date.now()) / 864e5);
  const hoy = new Date().toLocaleDateString('en-CA'), k = 'stmp-ig-token-aviso';
  if (dias > 7 || localStorage.getItem(k) === hoy) return;
  try { localStorage.setItem(k, hoy); } catch {}
  Avisos.mostrar(dias <= 0 ? 'El token de Instagram venció' : `El token de Instagram vence en ${dias} día${dias === 1 ? '' : 's'}`, {
    tipo: dias <= 3 ? 'error' : 'alerta', critico: dias <= 3, clave: 'ig-token', origen: 'instagram', importante: true, log: false,
    cuerpo: 'Renuévalo para que las publicaciones y respuestas automáticas sigan funcionando.' });
}

function igFecha(iso, conHora = false) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const min = Math.floor((Date.now() - d) / 6e4);
  if (!conHora) {
    if (min < 1) return 'Ahora';
    if (min < 60) return `Hace ${min} min`;
    if (min < 1440) return `Hace ${Math.floor(min / 60)} h`;
    if (min < 2880) return 'Ayer';
    if (min < 10080) return `Hace ${Math.floor(min / 1440)} días`;
  }
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined })
    + (conHora ? ' · ' + d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' }) : '');
}
function igMini(url, w = 300) {
  return typeof url === 'string' && url.includes('res.cloudinary.com') && url.includes('/upload/')
    ? url.replace('/upload/', `/upload/c_fill,w_${w},h_${Math.round(w * 1.25)},g_auto,f_auto,q_auto/`) : url;
}
// Instagram no deja mostrar sus fotos dentro de otros sitios: pasan por el servidor.
const igPx = url => (typeof url === 'string' && /^https:\/\/[^/]*(cdninstagram\.com|fbcdn\.net)\//i.test(url))
  ? `/api/acciones?op=ig-img${igQS()}&u=${encodeURIComponent(url)}` : url;
// Miniatura ligera: si el post tiene prenda con foto en Cloudinary, se pide
// a 360 px (≈25 KB, en caché de CDN) en vez de la foto completa de Instagram.
const igMiniCloud = u => typeof u === 'string' && /res\.cloudinary\.com\/.+\/upload\//.test(u)
  ? u.replace('/upload/', '/upload/c_fill,w_360,h_450,g_auto,q_auto:eco,f_auto/') : null;
const igMiniPost = p => igMiniCloud(p.prenda?.imagenes?.[0])
  || igPx(p.media_type === 'VIDEO' ? (p.thumbnail_url || p.media_url) : p.media_url);
const igPuedeBorrar = () => !!IG.estado?.perfil?.puedeBorrar;
const igBazar = () => (getBazares() || []).find(x => Number(x.id) === Number(IG.bazarId));
const igPrendas = () => (getDB() || []).filter(p => Number(p.bazarId || 1) === Number(IG.bazarId));

const I = {
  ig:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6" fill="currentColor"/></svg>',
  gift:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v9h14v-9M7.5 8a2.5 2.5 0 1 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 1 1 0 5"/></svg>',
  reel:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M3 8h18M8 3l3 5M14 3l3 5"/><path d="m10 12 5 3-5 3z"/></svg>',
  chart:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  alerta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  home:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  grid:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  chat:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z"/></svg>',
  send:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>',
  plus:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  cal:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  gear:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  heart:  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3.1 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.8 0 6 3.9 4.5 7.3C19.5 16.4 12 21 12 21z"/></svg>',
  com:    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z"/></svg>',
  carr:   '<svg viewBox="0 0 24 24" fill="#fff"><rect x="7" y="3" width="14" height="14" rx="2"/><path d="M3 7v12a2 2 0 0 0 2 2h12" fill="none" stroke="#fff" stroke-width="2"/></svg>',
  play:   '<svg viewBox="0 0 24 24" fill="#fff"><path d="M7 4v16l13-8z"/></svg>',
  ext:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  link:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  edit:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
  descargar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>',
  repub:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
  magic:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M12.2 6.2L11 5"/><path d="M3 21l9-9"/></svg>',
  tag:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/></svg>',
  check:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  eye:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  story:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 6h4"/><circle cx="12" cy="13" r="3"/></svg>',
  refresh:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
};

const SECCIONES = [
  ['resumen', 'Resumen', I.home],
  ['posts', 'Publicaciones', I.grid],
  ['bandeja', 'Comentarios', I.chat],
  ['dms', 'Mensajes', I.send],
  ['crear', 'Crear', I.plus],
  ['historias', 'Historias', I.story],
  ['programados', 'Programados', I.cal],
  ['problemas', 'Con problemas', I.alerta],   // v58
  ['borradores', 'Borradores', I.edit],
  ['reels', 'Reels', I.reel],
  ['sorteo', 'Sorteos', I.gift],
  ['auto', 'Automático', I.magic],
  ['reporte', 'Reporte', I.chart],
  ['ajustes', 'Ajustes', I.gear],
];

// ── Entrada ──────────────────────────────────────────────────
function igAbrir() {
  if (IG.bazarId == null) IG.bazarId = esAdminGlobal() ? 1 : miBazarId();
  igPintarSelectorBazar();
  if (!IG.estado) igRecargar(); else igRender();
}

function igPintarSelectorBazar() {
  const sel = document.getElementById('igBazarSel');
  if (!sel) return;
  if (!esAdminGlobal()) { sel.classList.add('hidden'); return; }
  const bazares = getBazares() || [];
  sel.innerHTML = bazares.map(b => `<option value="${b.id}" ${Number(b.id) === Number(IG.bazarId) ? 'selected' : ''}>${igEsc(b.nombre)}${b.instagramAuto ? ' ✓' : ''}</option>`).join('');
  sel.classList.toggle('hidden', bazares.length < 2);
}

function igCambiarBazar(id) {
  Object.assign(IG, { bazarId: Number(id), estado: null, resumen: null, posts: [], siguiente: null, bandeja: null, dms: null, hilo: null, programados: null, fotos: [], seleccion: new Set() });
  igRecargar();
}

async function igRecargar() {
  const raiz = document.getElementById('igRaiz');
  if (raiz && !IG.estado) raiz.innerHTML = '<div class="igx-cargando"><span class="igx-spin"></span>Cargando Instagram…</div>';
  try { IG.estado = await igApi('ig-estado'); }
  catch (e) { IG.estado = { conectado: false, error: e.message }; }
  Object.assign(IG, { resumen: null, posts: [], siguiente: null, bandeja: null, dms: null, programados: null, problemas: null });
  igRender();
  igAvisarToken(IG.estado.token);
  if (IG.estado.conectado && IG.estado.perfil) {
    igCargarPosts();
    igCargarProblemas();   // v58: para el número rojo del menú
    igApi('ig-procesar', {}).then(r => {
      if (r.publicados?.length) {
        const bien = r.publicados.filter(x => x.ok).length, mal = r.publicados.filter(x => !x.ok);
        toast(bien === 1 ? 'Salió 1 publicación programada' : `Salieron ${bien} publicaciones programadas`, {
          tipo: mal.length ? 'alerta' : 'ok', origen: 'instagram', importante: true,
          cuerpo: mal.length ? `${mal.length} no se pudo publicar.` : '', detalles: mal.map(x => x.error || 'Error de Instagram'),
          ir: { texto: 'Ver programados', tab: 'instagram', vista: 'programados' } });
      }
      if (r.automatico?.length) {
        const n = r.automatico.length; IG.auto = null;
        toast(n === 1 ? 'Automático: 1 acción nueva' : `Automático: ${n} acciones nuevas`, { tipo: 'info', origen: 'automatico', importante: true,
          titulo: n === 1 ? 'Automático hizo 1 acción' : `Automático hizo ${n} acciones`, cuerpo: 'Rebajas, respuestas, apartados vencidos y avisos.',
          detalles: r.automatico.map(x => x.texto).filter(Boolean), ir: { texto: 'Ver automático', tab: 'instagram', vista: 'auto' } });
      }
    }).catch(() => {});
  }
}

// ── Estructura ───────────────────────────────────────────────
// Secciones en el orden del usuario (favoritos arriba, sin las ocultas)
function igSeccionesOrden() {
  if (typeof PanelPrefs === 'undefined') return SECCIONES;
  return PanelPrefs.ordenar('instagram', SECCIONES.map(s => s[0])).map(k => SECCIONES.find(s => s[0] === k));
}
if (typeof PanelPrefs !== 'undefined') PanelPrefs.alCambiar(z => { if ((z === 'instagram' || z === '*') && document.querySelector('#igRaiz .igx')) igRender(); });

function igRender() {
  const raiz = document.getElementById('igRaiz');
  if (!raiz) return;
  const e = IG.estado || {};
  if (!e.conectado) { raiz.innerHTML = igVistaSinConexion(e); return; }
  if (!e.perfil) { raiz.innerHTML = `<div class="igx-alerta">${igEsc(e.error || 'No se pudo leer la cuenta.')}</div>`; return; }

  const p = e.perfil;
  raiz.innerHTML = `
    <div class="igx">
      <aside class="igx-nav">
        <div class="igx-cuenta">
          <div class="igx-avatar">${p.profile_picture_url ? `<img src="${igEsc(igPx(p.profile_picture_url))}" alt="">` : I.ig}</div>
          <div class="igx-cuenta-txt">
            <b>@${igEsc(p.username)}</b>
            <span>${igCorto(p.followers_count)} seguidores</span>
          </div>
        </div>
        <nav class="igx-menu" role="tablist">
          ${igSeccionesOrden().map(([k, t, ic]) => `
            <button class="igx-item ${IG.vista === k ? 'on' : ''} ${typeof PanelPrefs !== 'undefined' && PanelPrefs.esFav('instagram', k) ? 'fav' : ''}" role="tab" onclick="igVista('${k}')">
              <span class="igx-ic">${ic}</span><span>${t}</span>
              ${typeof PanelPrefs !== 'undefined' ? `<span class="pp-estrella" role="button" tabindex="-1" title="${PanelPrefs.esFav('instagram', k) ? 'Quitar de favoritos' : 'Fijar arriba'}" onclick="event.stopPropagation();PanelPrefs.alternarFav('instagram','${k}')">${ico('estrella', 14, PanelPrefs.esFav('instagram', k) ? 'lleno' : '')}</span>` : ''}
              ${k === 'programados' && e.pendientes ? `<em>${e.pendientes}</em>` : ''}
              ${k === 'problemas' && IG.problemas?.total ? `<em class="rojo">${IG.problemas.total}</em>` : ''}
              ${k === 'borradores' && IG.borradores?.length ? `<em>${IG.borradores.length}</em>` : ''}
              ${k === 'bandeja' && IG.bandeja ? (n => n ? `<em>${n}</em>` : '')(IG.bandeja.comentarios.filter(c => !c.respondido && !c.hidden).length) : ''}
            </button>`).join('')}
        </nav>
        ${typeof PanelPrefs !== 'undefined' ? `<button class="igx-ordenar" onclick="PanelPrefs.editor('instagram', 'Ordenar Instagram', SECCIONES.map(([id, nombre, icono]) => ({ id, nombre, icono })))">${ico('ajustes', 15)} Ordenar</button>` : ''}
        <div class="igx-nav-pie">
          <span class="igx-modo ${p.puedeBorrar ? 'full' : ''}">${p.puedeBorrar ? 'Control total' : 'Publicar y comentar'}</span>
          <a href="https://instagram.com/${igEsc(p.username)}" target="_blank" rel="noopener">${I.ext} Ver perfil</a>
        </div>
      </aside>
      <section class="igx-main">${typeof igAvisoToken === 'function' ? igAvisoToken(e.token) : ''}<div id="igCuerpo">${igCuerpo()}</div></section>
    </div>`;
  igAlEntrar();
}

function igVista(v) {
  IG.vista = v;
  if (v !== 'posts') { IG.modoSeleccion = false; IG.seleccion.clear(); }
  igRender();
  document.getElementById('igRaiz')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function igCuerpo() {
  switch (IG.vista) {
    case 'posts':       return igVistaPosts();
    case 'bandeja':     return igVistaBandeja();
    case 'dms':         return igVistaDms();
    case 'crear':       return igVistaCrear();
    case 'programados': return igVistaProgramados();
    case 'problemas': return igVistaProblemas();
    case 'historias':   return igVistaHistorias();
    case 'ajustes':     return igVistaAjustes();
    case 'auto':        return typeof igVistaAuto === 'function' ? igVistaAuto() : '';
    case 'borradores':  return typeof igVistaBorradores === 'function' ? igVistaBorradores() : '';
    case 'reels':       return typeof igVistaReels === 'function' ? igVistaReels() : '';
    case 'sorteo':      return typeof igVistaSorteo === 'function' ? igVistaSorteo() : '';
    case 'reporte':     return typeof igVistaReporte === 'function' ? igVistaReporte() : '';
    default:            return igVistaResumen();
  }
}
function igRefrescar() { const c = document.getElementById('igCuerpo'); if (c) c.innerHTML = igCuerpo(); }

// Carga perezosa de cada sección al entrar
function igAlEntrar() {
  if (IG.vista === 'resumen' && !IG.resumen && !IG.cargandoResumen) igCargarResumen();
  if (IG.vista === 'bandeja' && !IG.bandeja && !IG.cargandoBandeja) igCargarBandeja();
  if (IG.vista === 'dms' && !IG.dms && !IG.cargandoDms) igCargarDms();
  if (IG.vista === 'programados' && !IG.programados) igCargarProgramados();
  if (IG.vista === 'problemas' && !IG.problemas && !IG.cargandoProblemas) igCargarProblemas();
  if (IG.vista === 'historias' && !IG.historias && !IG.cargandoHistorias) igCargarHistorias();
  if (IG.vista === 'auto' && !IG.auto && !IG.cargandoAuto && typeof igCargarAuto === 'function') igCargarAuto();
  if (IG.vista === 'reporte' && !IG.reporte && !IG.cargandoReporte && typeof igCargarReporte === 'function') igCargarReporte();
}

function igCabecera(titulo, sub, acciones = '') {
  return `<header class="igx-cab"><div><h2>${titulo}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${acciones ? `<div class="igx-cab-acc">${acciones}</div>` : ''}</header>`;
}

function igVistaSinConexion(e) {
  const k = String(igBazar()?.slug || 'TUBAZAR').toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return `
    <div class="igx-vacio-card">
      <div class="igx-logo">${I.ig}</div>
      <h2>Conecta Instagram${e.bazar ? ` para ${igEsc(e.bazar)}` : ''}</h2>
      <p>Cuando la cuenta esté conectada, desde aquí vas a administrarla completa: estadísticas, publicaciones,
         comentarios, mensajes, programación y automatización.</p>
      <ol class="igx-pasos">
        <li>Cuenta <b>profesional</b> en Instagram, ligada a una página de Facebook.</li>
        <li>App en <b>developers.facebook.com</b> y token de acceso.</li>
        <li>En Vercel: <code>IG_${igEsc(k)}_USER_ID</code>, <code>IG_${igEsc(k)}_TOKEN</code> y <code>IG_${igEsc(k)}_MODO=facebook</code>.</li>
      </ol>
      ${e.error ? `<div class="igx-alerta">${igEsc(e.error)}</div>` : ''}
    </div>`;
}

// ═════════════════════════════════════════════════════════════
//  RESUMEN
// ═════════════════════════════════════════════════════════════
async function igCargarResumen() {
  IG.cargandoResumen = true;
  try { IG.resumen = await igApi('ig-resumen'); }
  catch (e) { IG.resumen = { metricas: {}, seguidores: [], errores: [e.message] }; }
  IG.cargandoResumen = false;
  if (IG.vista === 'resumen') igRefrescar();
}

function igSparkline(valores) {
  if (!valores || valores.length < 2) return '';
  const w = 280, h = 64, min = Math.min(...valores), max = Math.max(...valores), rango = max - min || 1;
  const pts = valores.map((v, i) => [i * w / (valores.length - 1), h - 6 - (v - min) / rango * (h - 12)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  return `<svg class="igx-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="igxG" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#111111" stop-opacity=".08"/><stop offset="1" stop-color="#111111" stop-opacity="0"/></linearGradient></defs>
    <path d="${d} L${w} ${h} L0 ${h} Z" fill="url(#igxG)"/><path d="${d}" fill="none" stroke="#111111" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function igAnalisisPosts() {
  const posts = IG.posts.filter(p => p.like_count != null);
  if (!posts.length) return null;
  const inter = p => (p.like_count || 0) + (p.comments_count || 0);
  const total = posts.reduce((s, p) => s + inter(p), 0);
  const dias = Array(7).fill(0).map(() => ({ n: 0, s: 0 }));
  const horas = Array(24).fill(0).map(() => ({ n: 0, s: 0 }));
  posts.forEach(p => { const d = new Date(p.timestamp); dias[d.getDay()].n++; dias[d.getDay()].s += inter(p); horas[d.getHours()].n++; horas[d.getHours()].s += inter(p); });
  const mejor = arr => arr.map((x, i) => ({ i, prom: x.n ? x.s / x.n : -1, n: x.n })).filter(x => x.n >= 2 || arr.filter(y => y.n).length < 4).sort((a, b) => b.prom - a.prom)[0];
  const nombresDia = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const md = mejor(dias), mh = mejor(horas);
  const primero = new Date(posts[posts.length - 1].timestamp), ultimo = new Date(posts[0].timestamp);
  const semanas = Math.max(1, (ultimo - primero) / (7 * 864e5));
  return {
    n: posts.length,
    promedio: Math.round(total / posts.length),
    likes: Math.round(posts.reduce((s, p) => s + (p.like_count || 0), 0) / posts.length),
    coms: (posts.reduce((s, p) => s + (p.comments_count || 0), 0) / posts.length).toFixed(1),
    tasa: IG.estado?.perfil?.followers_count ? (total / posts.length / IG.estado.perfil.followers_count * 100).toFixed(1) : null,
    mejorDia: md ? nombresDia[md.i] : null,
    mejorHora: mh ? `${mh.i % 12 || 12} ${mh.i < 12 ? 'a. m.' : 'p. m.'}` : null,
    porSemana: (posts.length / semanas).toFixed(1),
    top: [...posts].sort((a, b) => inter(b) - inter(a)).slice(0, 6),
  };
}

function igVistaResumen() {
  const r = IG.resumen, m = r?.metricas || {}, p = IG.estado.perfil;
  const seg = (r?.seguidores || []).map(x => x.valor);
  const crecimiento = seg.length ? seg.reduce((a, b) => a + b, 0) : null;
  const a = igAnalisisPosts();
  const prendas = igPrendas();
  const sinPublicar = prendas.filter(x => !x.vendido && !x.oculto && !x.instagramId && x.imagenes?.length);
  const vendidasSinMarcar = prendas.filter(x => x.vendido && x.instagramId && !x.instagramVendido?.portada);
  const sinPermiso = r && r.errores?.length && Object.values(m).every(v => v == null);
  const kpi = (titulo, valor, extra = '') => `<div class="igx-kpi"><span>${titulo}</span><b>${valor}</b>${extra}</div>`;

  return `
    ${igCabecera('Resumen', 'Cómo va tu cuenta en los últimos 28 días',
      `<button class="igx-btn ghost" onclick="IG.resumen=null;igCargarResumen();igRefrescar()">${I.refresh} Actualizar</button>`)}
    <div class="igx-kpis">
      ${kpi('Seguidores', igCorto(p.followers_count), crecimiento != null ? `<small class="${crecimiento >= 0 ? 'sube' : 'baja'}">${crecimiento >= 0 ? '+' : ''}${crecimiento} en 30 días</small>` : '')}
      ${kpi('Alcance', IG.cargandoResumen ? '<i class="igx-skel"></i>' : igCorto(m.reach), '<small>cuentas que te vieron</small>')}
      ${kpi('Interacciones', IG.cargandoResumen ? '<i class="igx-skel"></i>' : igCorto(m.total_interactions), '<small>likes, comentarios, guardados</small>')}
      ${kpi('Visitas al perfil', IG.cargandoResumen ? '<i class="igx-skel"></i>' : igCorto(m.profile_views), m.website_clicks != null ? `<small>${igNum(m.website_clicks)} clics a tu link</small>` : '<small>&nbsp;</small>')}
    </div>
    ${sinPermiso ? `<div class="igx-nota">Las estadísticas de alcance necesitan el permiso <b>instagram_manage_insights</b> en tu app de Meta.
      Lo demás de esta página se calcula con tus publicaciones.</div>` : ''}

    <div class="igx-col2">
      <div class="igx-card">
        <div class="igx-card-tit">Crecimiento de seguidores</div>
        ${seg.length > 1 ? `${igSparkline(seg.reduce((acc, v) => (acc.push((acc.at(-1) || 0) + v), acc), []))}
          <div class="igx-spark-pie"><span>hace 30 días</span><span>hoy</span></div>`
          : `<div class="igx-vacio mini">${IG.cargandoResumen ? 'Cargando…' : 'Sin datos de crecimiento todavía.'}</div>`}
      </div>
      <div class="igx-card">
        <div class="igx-card-tit">Tus publicaciones</div>
        ${a ? `<div class="igx-mini-stats">
            <div><b>${igNum(a.promedio)}</b><span>interacciones por post</span></div>
            <div><b>${a.tasa ? a.tasa + '%' : '–'}</b><span>tasa de interacción</span></div>
            <div><b>${a.porSemana}</b><span>posts por semana</span></div>
          </div>
          ${a.mejorDia ? `<div class="igx-tip">${ico('foco', 16)} Tus posts del <b>${a.mejorDia}</b>${a.mejorHora ? ` alrededor de las <b>${a.mejorHora}</b>` : ''} son los que mejor funcionan.</div>` : ''}`
          : `<div class="igx-vacio mini">${IG.cargandoPosts ? 'Cargando…' : 'Sin publicaciones.'}</div>`}
      </div>
    </div>

    <div class="igx-col2">
      <div class="igx-card">
        <div class="igx-card-tit">Pendientes del bazar</div>
        <button class="igx-pend" onclick="igVista('crear')" ${sinPublicar.length ? '' : 'disabled'}>
          <b>${sinPublicar.length}</b><span>prenda${sinPublicar.length === 1 ? '' : 's'} disponible${sinPublicar.length === 1 ? '' : 's'} sin publicar en Instagram</span>${sinPublicar.length ? '<em>Publicar →</em>' : ''}
        </button>
        <button class="igx-pend rojo" onclick="IG.filtro='vendidas';igVista('posts')" ${vendidasSinMarcar.length ? '' : 'disabled'}>
          <b>${vendidasSinMarcar.length}</b><span>vendida${vendidasSinMarcar.length === 1 ? '' : 's'} que en Instagram todavía se ve${vendidasSinMarcar.length === 1 ? '' : 'n'} disponible${vendidasSinMarcar.length === 1 ? '' : 's'}</span>${vendidasSinMarcar.length ? '<em>Revisar →</em>' : ''}
        </button>
        <button class="igx-pend" onclick="igVista('programados')" ${IG.estado.pendientes ? '' : 'disabled'}>
          <b>${IG.estado.pendientes || 0}</b><span>${IG.estado.pendientes === 1 ? 'publicación programada' : 'publicaciones programadas'}</span>${IG.estado.pendientes ? '<em>Ver →</em>' : ''}
        </button>
      </div>
      <div class="igx-card">
        <div class="igx-card-tit">Lo que mejor te ha funcionado</div>
        ${a?.top?.length ? `<div class="igx-top">${a.top.map(t => `
          <a href="${igEsc(t.permalink)}" target="_blank" rel="noopener" class="igx-top-it">
            <img src="${igEsc(igMiniPost(t))}" alt="" loading="lazy" decoding="async">
            <span>${I.heart}${igCorto(t.like_count)} · ${I.com}${igCorto(t.comments_count)}</span>
          </a>`).join('')}</div>` : `<div class="igx-vacio mini">${IG.cargandoPosts ? 'Cargando…' : 'Sin datos.'}</div>`}
      </div>
    </div>`;
}

// ═════════════════════════════════════════════════════════════
//  PUBLICACIONES
// ═════════════════════════════════════════════════════════════
async function igCargarPosts(mas = false) {
  if (IG.cargandoPosts) return;
  IG.cargandoPosts = true;
  if (['posts', 'resumen'].includes(IG.vista)) igRefrescar();
  try {
    const r = await igApi('ig-posts', undefined, mas && IG.siguiente ? `&after=${encodeURIComponent(IG.siguiente)}` : '');
    IG.posts = mas ? [...IG.posts, ...(r.posts || [])] : (r.posts || []);
    IG.siguiente = r.siguiente || null;
  } catch (e) { toast(e.message || 'No se pudieron cargar las publicaciones'); }
  IG.cargandoPosts = false;
  if (['posts', 'resumen'].includes(IG.vista)) igRefrescar();
}

function igEstadoPost(p) {
  if (!p.prenda) return 'libre';
  if (p.prenda.vendido) return 'vendida';
  return 'disponible';
}

function igVistaPosts() {
  const cuenta = { todas: IG.posts.length, disponibles: 0, vendidas: 0, libres: 0 };
  IG.posts.forEach(p => { const e = igEstadoPost(p); if (e === 'vendida') cuenta.vendidas++; else if (e === 'disponible') cuenta.disponibles++; else cuenta.libres++; });
  const lista = IG.posts.filter(p => IG.filtro === 'todas' || (IG.filtro === 'vendidas' && igEstadoPost(p) === 'vendida')
    || (IG.filtro === 'disponibles' && igEstadoPost(p) === 'disponible') || (IG.filtro === 'libres' && igEstadoPost(p) === 'libre'));
  const puede = igPuedeBorrar() && isAdmin();
  const nSel = IG.seleccion.size;

  return `
    ${igCabecera('Publicaciones', `${igNum(IG.estado.perfil.media_count)} en tu perfil · ${IG.posts.length} cargadas`,
      `${isAdmin() ? `<button class="igx-btn ghost" onclick="igImportarAbrir()">${I.descargar || I.plus} Importar prendas</button>` : ''}
       ${puede ? `<button class="igx-btn ${IG.modoSeleccion ? 'oscuro' : 'ghost'}" onclick="igModoSeleccion()">${IG.modoSeleccion ? 'Cancelar selección' : 'Seleccionar varias'}</button>` : ''}
       <button class="igx-btn grad" onclick="igVista('crear')">${I.plus} Nueva</button>`)}
    <div class="igx-filtros">
      ${[['todas', 'Todas'], ['disponibles', 'Disponibles'], ['vendidas', 'Vendidas'], ['libres', 'Sin prenda']].map(([k, t]) =>
        `<button class="igx-chip ${IG.filtro === k ? 'on' : ''}" onclick="IG.filtro='${k}';igRefrescar()">${t} <em>${cuenta[k]}</em></button>`).join('')}
    </div>
    ${IG.filtro === 'libres' ? `<div class="igx-nota">Estos posts no están ligados a ninguna prenda de tu catálogo. Ábrelos y elige la prenda: así el panel sabe si ya se vendió.</div>` : ''}
    ${IG.lote ? igBarraLote() : ''}
    ${IG.modoSeleccion ? `
      <div class="igx-barra-sel">
        <span><b>${nSel}</b> seleccionada${nSel === 1 ? '' : 's'}</span>
        <button class="igx-link" onclick="igSeleccionarTodo()">Seleccionar las ${lista.length} visibles</button>
        ${IG.siguiente || IG.cargandoTodo ? `<button class="igx-link" onclick="igSeleccionarPerfil()" ${IG.cargandoTodo ? 'disabled' : ''}>${IG.cargandoTodo ? `Cargando… ${IG.posts.length}` : `Seleccionar todo el perfil (${igNum(IG.estado.perfil.media_count)})`}</button>` : ''}
        <div class="igx-barra-acc">
          <button class="igx-btn ghost" ${nSel ? '' : 'disabled'} onclick="igLote('republicar')">${I.repub} Republicar</button>
          <button class="igx-btn ghost" ${nSel ? '' : 'disabled'} onclick="igLote('plantilla')">${I.magic} Aplicar plantilla</button>
          <button class="igx-btn rojo" ${nSel ? '' : 'disabled'} onclick="igLote('vendido')">${I.tag} Comentar VENDIDA</button>
          <button class="igx-btn ghost peligro" ${nSel ? '' : 'disabled'} onclick="igLote('borrar')">${I.trash} Borrar</button>
        </div>
      </div>` : ''}
    ${!IG.posts.length && IG.cargandoPosts
      ? `<div class="igx-grid">${Array.from({ length: 10 }, () => '<div class="igx-post esqueleto"></div>').join('')}</div>`
      : !lista.length ? `<div class="igx-vacio">Nada por aquí.</div>`
      : `<div class="igx-grid">${lista.map(p => {
          const i = IG.posts.indexOf(p), est = igEstadoPost(p), sel = IG.seleccion.has(p.id);
          return `<button class="igx-post ${sel ? 'sel' : ''} est-${est}" onclick="${IG.modoSeleccion ? `igAlternarSel('${p.id}')` : `igAbrirPost(${i})`}">
            <img src="${igEsc(igMiniPost(p))}" alt="" loading="lazy" decoding="async" width="360" height="450" onerror="this.onerror=null;this.src='${igEsc(igPx(p.media_type === 'VIDEO' ? (p.thumbnail_url || p.media_url) : p.media_url))}'">
            ${p.media_type === 'CAROUSEL_ALBUM' ? `<span class="igx-tipo">${I.carr}</span>` : p.media_type === 'VIDEO' ? `<span class="igx-tipo">${I.play}</span>` : ''}
            ${est === 'vendida' ? '<span class="igx-est vendida">Vendida</span>' : est === 'disponible' ? `<span class="igx-est">$${igNum(p.prenda.precio_venta)}</span>` : ''}
            ${IG.modoSeleccion ? `<span class="igx-check">${sel ? I.check : ''}</span>` : ''}
            <span class="igx-hover"><span>${I.heart} ${igCorto(p.like_count)}</span><span>${I.com} ${igCorto(p.comments_count)}</span></span>
          </button>`; }).join('')}</div>`}
    ${IG.siguiente ? `<button class="igx-btn ghost igx-mas" onclick="igCargarPosts(true)" ${IG.cargandoPosts ? 'disabled' : ''}>${IG.cargandoPosts ? 'Cargando…' : 'Cargar más'}</button>` : ''}`;
}

function igModoSeleccion() { IG.modoSeleccion = !IG.modoSeleccion; IG.seleccion.clear(); igRefrescar(); }
function igAlternarSel(id) { IG.seleccion.has(id) ? IG.seleccion.delete(id) : IG.seleccion.add(id); igRefrescar(); }
// Carga todas las páginas que falten y selecciona todo el perfil
async function igSeleccionarPerfil() {
  if (IG.cargandoTodo) return;
  IG.cargandoTodo = true; igRefrescar();
  try {
    let vueltas = 0;
    while (IG.siguiente && vueltas++ < 40) {
      const r = await igApi('ig-posts', undefined, `&after=${encodeURIComponent(IG.siguiente)}`);
      IG.posts = [...IG.posts, ...(r.posts || [])];
      IG.siguiente = r.siguiente || null;
      igRefrescar();
    }
  } catch (e) { toast(e.message || 'No se pudieron cargar todas'); }
  IG.cargandoTodo = false;
  IG.filtro = 'todas';
  igSeleccionarTodo();
}

function igSeleccionarTodo() {
  IG.posts.filter(p => IG.filtro === 'todas' || igEstadoPost(p) === { vendidas: 'vendida', disponibles: 'disponible', libres: 'libre' }[IG.filtro])
    .forEach(p => { if (p.media_type !== 'VIDEO') IG.seleccion.add(p.id); });
  igRefrescar();
}

function igTiempo(seg) {
  seg = Math.max(0, Math.round(seg));
  if (seg < 60) return `${seg} s`;
  const m = Math.floor(seg / 60), r = seg % 60;
  return m < 60 ? `${m} min${r && m < 5 ? ` ${r} s` : ''}` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
// Barra de progreso de los trabajos en lote (republicar, plantilla, vendido, borrar)
function igHtmlProgreso(l) {
  const pct = l.total ? Math.round(l.hechos / l.total * 100) : 0;
  const pasado = (Date.now() - l.inicio) / 1000;
  const porPost = l.hechos ? pasado / l.hechos : (l.estimado || 20);
  const falta = l.total - l.hechos;
  const bien = l.hechos - l.errores;
  return `<div class="igx-lote">
    <div class="igx-lote-cab">
      <div class="igx-lote-pct">${pct}<small>%</small></div>
      <div class="igx-lote-tit"><b>${igEsc(l.titulo)}</b>
        <span>${l.actual ? `Ahora: ${igEsc(l.actual)}` : 'Preparando…'}</span></div>
      ${l.miniatura ? `<img class="igx-lote-img" src="${igEsc(igPx(l.miniatura))}" alt="">` : ''}
    </div>
    <div class="igx-progreso grande"><i style="width:${pct}%"></i></div>
    <div class="igx-lote-nums">
      <div><b>${bien}</b><span>Listos</span></div>
      <div><b>${falta}</b><span>Faltan</span></div>
      <div><b>${l.total}</b><span>Total</span></div>
      ${l.errores ? `<div class="rojo"><b>${l.errores}</b><span>Con error</span></div>` : ''}
      <div><b>${igTiempo(pasado)}</b><span>Llevas</span></div>
      <div><b>${falta ? '≈ ' + igTiempo(falta * porPost) : '—'}</b><span>Para terminar</span></div>
    </div>
    <small>No cierres esta pestaña hasta que termine.</small>
  </div>`;
}
function igBarraLote() { return igHtmlProgreso(IG.lote); }
// Mientras corre un lote, el tiempo se actualiza cada segundo
setInterval(() => {
  if (IMP?.corriendo) { const sp = document.querySelector('#igImp .igx-imp-pie span'); if (sp) igImportarPintar(); }
  if (!IG.lote) return;
  const el = document.querySelector('#view-instagram .igx-lote');
  if (el) el.outerHTML = igHtmlProgreso(IG.lote);
}, 1000);

function igAvisoSalir(e) { e.preventDefault(); e.returnValue = ''; }

async function igLote(accion) {
  // Del más viejo al más nuevo: al volver a publicarse, quedan arriba del
  // perfil en el mismo orden que tenían.
  const fecha = id => new Date(IG.posts.find(x => x.id === id)?.timestamp || 0).getTime();
  const ids = [...IG.seleccion].sort((a, b) => fecha(a) - fecha(b));
  if (!ids.length || IG.lote) return;
  // Las prendas vendidas no se vuelven a publicar (solo llevan comentario)
  if (accion === 'republicar' || accion === 'plantilla') {
    const antes = ids.length;
    for (let k = ids.length - 1; k >= 0; k--) { const p = IG.posts.find(x => x.id === ids[k]); if (p?.prenda?.vendido) ids.splice(k, 1); }
    if (antes !== ids.length) toast(`Se omiten ${antes - ids.length} post(s) de prendas vendidas`);
    if (!ids.length) return toast('Todas las seleccionadas son de prendas vendidas: esas no se republican');
  }
  const textos = {
    plantilla: ['Aplicar plantilla de marca', `Se vuelven a publicar ${ids.length} post(s) con la portada nueva (@, talla y precio; las vendidas en gris con VENDIDO). Cada post nuevo pierde los likes y comentarios del original. Tarda ~20 s por post.`],
    vendido: ['Marcar como VENDIDO', `Se deja un comentario de VENDIDA en ${ids.length} post(s). El post no se toca: conserva sus likes y comentarios.`],
    republicar: ['Republicar', `Se vuelven a publicar ${ids.length} post(s) para que salgan arriba de tu perfil, con el diseño actual y el texto al día. Se borran los originales (pierden likes y comentarios). Tarda ~20 s por post.`],
    borrar: ['Borrar publicaciones', `Se borran ${ids.length} post(s) de Instagram para siempre, con sus likes y comentarios.`],
  }[accion];
  let aviso = '';
  if (accion === 'republicar' || accion === 'plantilla') {
    // Instagram limita cuántos posts se publican desde apps en 24 h
    try {
      const c = await igApi('ig-cuota');
      if (c.borrar === false) {
        return uiConfirm({ titulo: 'Falta un permiso de Instagram', ok: 'Entendido',
          mensaje: 'El token de Instagram guardado en Vercel no tiene el permiso "instagram_manage_contents", así que no se pueden borrar los posts viejos. Si republicas así, quedarían duplicados. Pon el token nuevo (con ese permiso) en IG_STIIMPYS_TOKEN, vuelve a desplegar y luego republica.' });
      }
      if (c.restantes < ids.length) {
        aviso = ` Instagram solo deja publicar ${c.limite} posts cada 24 h por app y ya van ${c.usados}: hoy se harán los ${c.restantes} más viejos. Los demás los puedes republicar mañana.`;
        ids.splice(c.restantes);
      }
    } catch {}
    if (!ids.length) return toast('Ya llegaste al límite de publicaciones de Instagram por hoy. Inténtalo mañana.');
    const min = Math.ceil(ids.length * 20 / 60);
    aviso += ` Tardará unos ${min} min: deja esta pestaña abierta (si la cierras, se detiene y puedes seguir después con lo que falte).`;
  }
  const ok = await uiConfirm({ titulo: textos[0], mensaje: textos[1] + aviso, ok: accion === 'borrar' ? 'Borrar' : 'Continuar', peligro: true });
  if (!ok) return;
  window.addEventListener('beforeunload', igAvisoSalir);
  IG.lote = { titulo: textos[0], total: ids.length, hechos: 0, errores: 0, inicio: Date.now(), estimado: accion === 'borrar' ? 2 : 20 };
  IG.modoSeleccion = false; igRefrescar();
  for (const id of ids) {
    const p = IG.posts.find(x => x.id === id);
    IG.lote.actual = p?.prenda?.nombre || (p?.caption || '').split('\n')[0].slice(0, 60) || 'Publicación';
    IG.lote.miniatura = p ? (p.media_type === 'VIDEO' ? p.thumbnail_url : p.media_url) : '';
    igRefrescar();
    try {
      if (accion === 'borrar') {
        await igApi('ig-borrar-post', { media: id });
        IG.posts = IG.posts.filter(x => x.id !== id);
      } else if (accion === 'republicar') {
        const r = await igApi('ig-republicar', { media: id, prendaId: p?.prenda?.id, borrar: true, textoNuevo: true });
        if (p) { p.id = r.id; p.permalink = r.permalink; }
        // Si no se pudo borrar el viejo, se detiene para no llenar el perfil de duplicados
        if (r.avisoBorrado) { IG.lote.hechos++; IG.lote.errores++; uiConfirm({ titulo: 'Se detuvo la republicación', mensaje: r.avisoBorrado + ' Revisa que el token tenga el permiso instagram_manage_contents.', ok: 'Entendido' }); break; }
      } else if (accion === 'vendido') {
        await igApi('ig-comentar-vendido', { media: id });
      } else {
        const r = await igApi('ig-rehacer', { media: id, vendido: false });
        if (p) { p.id = r.id; p.permalink = r.permalink; }
      }
    } catch (e) {
      IG.lote.errores++; (IG.lote.fallos ||= []).push(`${IG.lote.actual}: ${e.message || 'Error de Instagram'}`);
      if (typeof Avisos === 'object') Avisos.registrarError('instagram', e, { item: IG.lote.actual });
      // Falta permiso o falló un borrado: se detiene para no dejar duplicados
      if (/Se detiene/.test(e.message || '')) { IG.lote.hechos++; uiConfirm({ titulo: 'Se detuvo el proceso', mensaje: e.message, ok: 'Entendido' }); break; }
      // Si Instagram ya no deja publicar más hoy, no tiene caso seguir
      if (/limit|l[ií]mite|too many|9007|#4\b|#32\b/i.test(e.message || '')) { toast('Instagram puso un límite por hoy. Lo que faltó puedes republicarlo mañana.'); IG.lote.hechos++; break; }
    }
    IG.lote.hechos++; igRefrescar();
  }
  window.removeEventListener('beforeunload', igAvisoSalir);
  const { hechos, errores, fallos = [] } = IG.lote;
  IG.lote = null; IG.seleccion.clear();
  toast(errores ? `${errores} de ${hechos} no se pudieron completar` : hechos === 1 ? 'Listo: 1 publicación' : `Listo: ${hechos} publicaciones`, {
    tipo: errores ? (errores === hechos ? 'error' : 'alerta') : 'ok', origen: 'instagram', importante: !!errores, log: false,
    titulo: errores ? `${textos[0]}: ${errores} de ${hechos} con error` : undefined, cuerpo: errores ? `${hechos - errores} sí quedaron.` : '',
    detalles: fallos });
  if (typeof registrarLog === 'function') registrarLog('instagram', textos[0], `${hechos - errores} post(s)`);
  igCargarPosts();
}

// ── Modal de una publicación ─────────────────────────────────
function igModal() {
  let m = document.getElementById('igModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'igModal'; m.className = 'igx-modal';
    m.addEventListener('click', e => { if (e.target === m) igCerrarPost(); });
    document.body.appendChild(m);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.classList.contains('open')) igCerrarPost(); });
  }
  return m;
}

function igAbrirPost(i) {
  IG.post = IG.posts[i]; IG.comentarios = []; IG.statsPost = null;
  igModal().classList.add('open');
  document.body.classList.add('igx-sin-scroll');
  igPintarModal();
  igCargarComentarios();
  igApi('ig-post-stats', undefined, `&media=${encodeURIComponent(IG.post.id)}&tipo=${IG.post.media_type}`)
    .then(r => { IG.statsPost = r; igPintarStats(); }).catch(() => { IG.statsPost = {}; igPintarStats(); });
}
function igCerrarPost() {
  document.getElementById('igModal')?.classList.remove('open');
  document.body.classList.remove('igx-sin-scroll');
  IG.post = null;
}

function igPintarModal() {
  const m = igModal(), p = IG.post;
  if (!p) return;
  const puede = igPuedeBorrar(), admin = isAdmin(), comsOn = p.is_comment_enabled !== false;
  const est = igEstadoPost(p);
  const prendas = igPrendas().sort((a, b) => b.id - a.id);
  m.innerHTML = `
    <div class="igx-modal-caja" role="dialog" aria-modal="true">
      <div class="igx-modal-media">
        ${p.media_type === 'VIDEO'
          ? `<div class="igx-video"><img src="${igEsc(igMiniPost(p))}" alt=""><a class="igx-btn grad" href="${igEsc(p.permalink)}" target="_blank" rel="noopener">${I.play} Ver video en Instagram</a></div>`
          : `<img src="${igEsc(igPx(p.media_url))}" alt="">`}
      </div>
      <div class="igx-modal-lado">
        <div class="igx-modal-cab">
          <div class="igx-avatar chico">${IG.estado.perfil.profile_picture_url ? `<img src="${igEsc(igPx(IG.estado.perfil.profile_picture_url))}" alt="">` : ''}</div>
          <div><b>${igEsc(IG.estado.perfil.username)}</b><span>${igFecha(p.timestamp, true)}</span></div>
          <button class="igx-cerrar" onclick="igCerrarPost()" aria-label="Cerrar">×</button>
        </div>
        <div class="igx-modal-scroll">
          <div class="igx-stats" id="igStats">${igStatsHTML()}</div>

          <div class="igx-vinculo">
            <label>${I.tag} Prenda del catálogo</label>
            <select onchange="igVincular(this.value)">
              <option value="">— Sin prenda —</option>
              ${prendas.map(x => `<option value="${x.id}" ${p.prenda?.id === x.id ? 'selected' : ''}>#${x.id} · ${igEsc(x.nombre)}${x.vendido ? ' (vendida)' : ''}</option>`).join('')}
            </select>
            ${est === 'vendida' ? '<span class="igx-est-txt rojo">Vendida</span>' : est === 'disponible' ? '<span class="igx-est-txt">Disponible</span>' : ''}
          </div>

          <div id="igRepub"></div>
          <div class="igx-caption" id="igCaption">${igEsc(p.caption || '').replace(/\n/g, '<br>') || '<i>Sin texto</i>'}</div>

          <div class="igx-acciones">
            <a class="igx-acc" href="${igEsc(p.permalink)}" target="_blank" rel="noopener">${I.ext}<span>Abrir</span></a>
            <button class="igx-acc" onclick="igCopiar('${igEsc(p.permalink)}')">${I.link}<span>Copiar link</span></button>
            ${p.prenda && !p.prenda.vendido ? `<button class="igx-acc" onclick="igCopiarTextoNuevo(${Number(p.prenda.id)})" title="Para pegarlo en Instagram con Editar (no pierde likes)">${I.copiar || I.link}<span>Copiar texto corto</span></button>` : ''}
            <button class="igx-acc" onclick="igToggleComentarios()">${I.chat}<span>${comsOn ? 'Apagar comentarios' : 'Activar comentarios'}</span></button>
            ${admin ? `
            <button class="igx-acc ${puede ? '' : 'bloq'}" onclick="${puede ? 'igRepubAbrir()' : 'igSinPermiso()'}">${I.repub}<span>Republicar</span></button>
            <button class="igx-acc ${puede ? '' : 'bloq'}" onclick="${puede ? 'igRehacerUno(false)' : 'igSinPermiso()'}">${I.magic}<span>Aplicar plantilla</span></button>
            <button class="igx-acc rojo ${puede ? '' : 'bloq'}" onclick="${puede ? 'igComentarVendidoUno()' : 'igSinPermiso()'}">${I.tag}<span>Comentar VENDIDA</span></button>
            <button class="igx-acc ${puede ? '' : 'bloq'}" onclick="${puede ? 'igEditarPost()' : 'igSinPermiso()'}">${I.edit}<span>Editar texto</span></button>
            <button class="igx-acc peligro ${puede ? '' : 'bloq'}" onclick="${puede ? 'igBorrarPost()' : 'igSinPermiso()'}">${I.trash}<span>Borrar</span></button>` : ''}
          </div>

          <div class="igx-sub">Comentarios</div>
          <div id="igComs">${igListaComentarios(IG.comentarios, IG.cargandoComs)}</div>
        </div>
      </div>
    </div>`;
}

function igStatsHTML() {
  const p = IG.post, s = IG.statsPost;
  const it = (t, v) => `<div><b>${v}</b><span>${t}</span></div>`;
  return [
    it('likes', igCorto(p.like_count)), it('comentarios', igCorto(p.comments_count)),
    it('alcance', s ? igCorto(s.reach) : '…'), it('guardados', s ? igCorto(s.saved) : '…'), it('compartidos', s ? igCorto(s.shares) : '…'),
  ].join('');
}
function igPintarStats() { const el = document.getElementById('igStats'); if (el) el.innerHTML = igStatsHTML(); }

function igSinPermiso() {
  uiConfirm({ titulo: 'Instagram no lo permite con esta conexión',
    mensaje: 'Borrar, editar y cambiar portadas solo funciona con la conexión por inicio de sesión de Facebook (IG_..._MODO=facebook).', ok: 'Entendido' });
}

async function igVincular(prendaId) {
  const p = IG.post; if (!p) return;
  try {
    await igApi('ig-vincular', { media: p.id, prendaId: prendaId ? Number(prendaId) : null, permalink: p.permalink });
    const pr = prendaId ? getDB().find(x => Number(x.id) === Number(prendaId)) : null;
    IG.posts.forEach(x => { if (x !== p && pr && x.prenda?.id === pr.id) x.prenda = null; });
    p.prenda = pr ? { id: pr.id, nombre: pr.nombre, vendido: pr.vendido, precio_venta: pr.precio_venta, talla: pr.talla } : null;
    getDB().forEach(x => { if (x.instagramId === p.id) delete x.instagramId; });
    if (pr) { pr.instagramId = p.id; pr.instagramUrl = p.permalink; }
    igPintarModal(); igPintarComs();
    toast(pr ? `Ligado a #${pr.id} · ${pr.nombre}` : 'Post sin prenda');
  } catch (e) { toast(e.message); }
}

// ── Republicar un post ───────────────────────────────────────
// Lo sube otra vez como publicación nueva (sale arriba del feed) con las
// fotos y el diseño actuales. Opcional: borrar el anterior y rehacer el texto.
function igRepubAbrir() {
  const p = IG.post, box = document.getElementById('igRepub'); if (!p || !box) return;
  if (p.media_type === 'VIDEO') return toast('Solo se pueden republicar publicaciones de fotos');
  if (box.innerHTML) { box.innerHTML = ''; return; }
  const conPrenda = !!p.prenda;
  box.innerHTML = `<div class="igx-repub">
    <b>${I.repub} Republicar</b>
    <p>Se sube de nuevo como publicación nueva, arriba de tu perfil${conPrenda ? ', con todas las fotos de la prenda y el diseño actual' : ''}.</p>
    <label class="igx-opcion"><input type="checkbox" id="igRepBorrar" checked> Borrar el post anterior <small>(pierde sus likes y comentarios)</small></label>
    ${conPrenda ? `<label class="igx-opcion"><input type="checkbox" id="igRepTexto" checked> Actualizar el texto con los datos de la prenda <small>(precio, talla, descripción)</small></label>` : ''}
    <div class="igx-repub-btns">
      <button class="igx-btn grad mini" id="igRepBtn" onclick="igRepubConfirmar()">Republicar ahora</button>
      <button class="igx-btn ghost mini" onclick="document.getElementById('igRepub').innerHTML=''">Cancelar</button>
    </div>
  </div>`;
}
async function igRepubConfirmar() {
  const p = IG.post; if (!p) return;
  const btn = document.getElementById('igRepBtn');
  const borrar = !!document.getElementById('igRepBorrar')?.checked;
  const textoNuevo = !!document.getElementById('igRepTexto')?.checked;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="igx-spin blanco"></span> Publicando… (unos 20 s)'; }
  try {
    const r = await igApi('ig-republicar', { media: p.id, prendaId: p.prenda?.id, borrar, textoNuevo });
    toast(r.aviso || r.avisoBorrado || (borrar ? '¡Republicado! El post anterior se borró' : '¡Republicado!'));
    if (typeof registrarLog === 'function') registrarLog('instagram', 'Republicar', p.prenda?.nombre || p.id);
    igCerrarPost(); igCargarPosts();
  } catch (e) {
    toast(e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Republicar ahora'; }
  }
}

// Al vender ya no se vuelve a publicar: solo se deja el comentario
async function igComentarVendidoUno() {
  const p = IG.post; if (!p) return;
  try {
    const r = await igApi('ig-comentar-vendido', { media: p.id });
    toast(r.ya ? 'Ese post ya tenía el comentario de VENDIDA' : 'Comentario de VENDIDA publicado');
    if (p.prenda) p.prenda.vendido = true;
    igCargarComentarios?.();
  } catch (e) { toast(e.message); }
}

async function igRehacerUno(vendido) {
  if (IG.post?.prenda?.vendido) return toast('Las prendas vendidas no se vuelven a publicar: solo llevan el comentario de VENDIDA');
  const p = IG.post; if (!p) return;
  if (p.media_type === 'VIDEO') return toast('Solo se pueden rehacer publicaciones de fotos');
  const ok = await uiConfirm({
    titulo: vendido ? 'Marcar como VENDIDO' : 'Aplicar plantilla de marca',
    mensaje: (vendido ? 'La portada se cambia a la foto en gris con el sello VENDIDO. ' : 'La portada se cambia a la plantilla editorial con nombre, talla y precio. ')
      + 'Instagram no deja cambiar fotos de un post, así que se publica de nuevo y se borra el original: pierde sus likes y comentarios.',
    ok: 'Continuar', peligro: true,
  });
  if (!ok) return;
  toast('Publicando la versión nueva… (unos 20 s)');
  try {
    const r = await igApi('ig-rehacer', { media: p.id, vendido });
    toast(r.aviso || r.avisoBorrado || '¡Listo! Post actualizado');
    igCerrarPost(); igCargarPosts();
  } catch (e) { toast(e.message); }
}

// ── Comentarios (modal y bandeja comparten pintado) ──────────
async function igCargarComentarios() {
  if (!IG.post) return;
  IG.cargandoComs = true; igPintarComs();
  try { IG.comentarios = (await igApi('ig-comentarios', undefined, `&media=${encodeURIComponent(IG.post.id)}`)).comentarios || []; }
  catch (e) { IG.comentarios = []; toast(e.message); }
  IG.cargandoComs = false; igPintarComs();
}
function igPintarComs() { const c = document.getElementById('igComs'); if (c) c.innerHTML = igListaComentarios(IG.comentarios, IG.cargandoComs); }

function igRespuestasRapidas(id) {
  const rr = IG.estado?.config?.respuestasRapidas || [];
  return rr.length ? `<div class="igx-rr">${rr.map((t, k) => `<button onclick="igUsarRR('${id}', ${k})">${igEsc(t.length > 38 ? t.slice(0, 36) + '…' : t)}</button>`).join('')}</div>` : '';
}

function igComentarioHTML(c, conPost = false) {
  return `
    <div class="igx-com ${c.hidden ? 'oculto' : ''} ${c.respondido ? 'resp' : ''}" id="igCom-${c.id}">
      ${conPost ? `<a class="igx-com-post" href="${igEsc(c.post.permalink)}" target="_blank" rel="noopener"><img src="${igEsc(igPx(c.post.miniatura))}" alt="" loading="lazy" decoding="async"></a>` : ''}
      <div class="igx-com-cuerpo">
        <div class="igx-com-cab"><b>@${igEsc(c.username || 'usuario')}</b><span>${igFecha(c.timestamp)}</span>
          ${c.hidden ? '<em>oculto</em>' : ''}${c.respondido ? `<em class="ok">${I.check} respondido</em>` : ''}</div>
        <div class="igx-com-txt">${igEsc(c.text)}</div>
        ${(c.respuestas || c.replies?.data || []).map(r => `<div class="igx-resp"><b>@${igEsc(r.username || '')}</b> ${igEsc(r.text)}</div>`).join('')}
        <div class="igx-com-acc">
          <button onclick="igResponderUI('${c.id}')">Responder</button>
          <button onclick="igOcultar('${c.id}', ${!c.hidden})">${c.hidden ? 'Mostrar' : 'Ocultar'}</button>
          <button class="peligro" onclick="igBorrarComentario('${c.id}')">Borrar</button>
        </div>
        <div class="igx-resp-form hidden" id="igResp-${c.id}">
          ${igRespuestasRapidas(c.id)}
          <div class="igx-fila-input">
            <input type="text" maxlength="500" placeholder="Escribe tu respuesta…" data-borrador="com:${c.id}" onkeydown="if(event.key==='Enter')igResponder('${c.id}')">
            <button class="igx-btn ghost mini ia" onclick="igIASugerirComentario('${c.id}')" title="Sugerir respuesta con IA">✦</button>
            <button class="igx-btn grad mini" onclick="igResponder('${c.id}')">Enviar</button>
          </div>
        </div>
      </div>
    </div>`;
}

function igListaComentarios(lista, cargando) {
  if (cargando) return '<div class="igx-vacio mini">Cargando…</div>';
  if (!lista.length) return '<div class="igx-vacio mini">Sin comentarios todavía.</div>';
  return lista.map(c => igComentarioHTML(c)).join('');
}

function igBuscarComentario(id) {
  return IG.comentarios.find(x => x.id === id) || IG.bandeja?.comentarios.find(x => x.id === id);
}

function igResponderUI(id) {
  const f = document.getElementById('igResp-' + id); if (!f) return;
  f.classList.toggle('hidden');
  const input = f.querySelector('input');
  if (!f.classList.contains('hidden') && input) {
    const c = igBuscarComentario(id);
    if (c?.username && !input.value) input.value = `@${c.username} `;
    input.focus();
  }
}
function igUsarRR(id, k) {
  const input = document.querySelector(`#igResp-${id} input`), t = IG.estado?.config?.respuestasRapidas?.[k];
  if (!input || !t) return;
  const c = igBuscarComentario(id);
  input.value = `${c?.username ? '@' + c.username + ' ' : ''}${t}`; input.focus();
}

async function igResponder(id) {
  const input = document.querySelector(`#igResp-${id} input`);
  const mensaje = (input?.value || '').trim(); if (!mensaje) return;
  try {
    await igApi('ig-responder', { comentario: id, mensaje });
    toast('Respuesta publicada');
    if (typeof igBorrarTexto === 'function') igBorrarTexto('com:' + id);
    const c = igBuscarComentario(id);
    if (c) { c.respondido = true; (c.respuestas ||= []).push({ username: IG.estado.perfil.username, text: mensaje }); if (c.replies?.data) c.replies.data.push({ username: IG.estado.perfil.username, text: mensaje }); }
    if (IG.post) igPintarComs();
    if (IG.vista === 'bandeja') igRefrescar();
  } catch (e) { toast(e.message); }
}

async function igOcultar(id, ocultar) {
  try {
    await igApi('ig-ocultar', { comentario: id, ocultar });
    const c = igBuscarComentario(id); if (c) c.hidden = ocultar;
    if (IG.post) igPintarComs(); if (IG.vista === 'bandeja') igRefrescar();
    toast(ocultar ? 'Comentario oculto' : 'Comentario visible');
  } catch (e) { toast(e.message); }
}

async function igBorrarComentario(id) {
  if (!(await uiConfirm({ titulo: 'Borrar comentario', mensaje: 'Se borra de Instagram y no se puede deshacer.', ok: 'Borrar', peligro: true }))) return;
  try {
    await igApi('ig-borrar-comentario', { comentario: id });
    IG.comentarios = IG.comentarios.filter(x => x.id !== id);
    if (IG.bandeja) IG.bandeja.comentarios = IG.bandeja.comentarios.filter(x => x.id !== id);
    if (IG.post) { IG.post.comments_count = Math.max(0, (IG.post.comments_count || 1) - 1); igPintarComs(); }
    if (IG.vista === 'bandeja') igRefrescar();
    toast('Comentario borrado');
  } catch (e) { toast(e.message); }
}

async function igToggleComentarios() {
  const p = IG.post; if (!p) return;
  const activar = p.is_comment_enabled === false;
  try {
    await igApi('ig-comentarios-onoff', { media: p.id, activar });
    p.is_comment_enabled = activar; igPintarModal(); igPintarComs(); igPintarStats();
    toast(activar ? 'Comentarios activados' : 'Comentarios apagados');
  } catch (e) { toast(e.message); }
}

function igCopiar(url) { Avisos.copiar(url, { que: 'Link' }); }

function igEditarPost() {
  const p = IG.post; if (!p) return;
  if (p.media_type === 'VIDEO') return toast('Solo se pueden editar publicaciones de fotos');
  const cap = document.getElementById('igCaption'); if (!cap) return;
  cap.outerHTML = `
    <div class="igx-editar">
      <textarea id="igCaptionNuevo" class="igx-textarea" maxlength="2200" rows="9" data-borrador="cap:${p.id}">${igEsc(p.caption || '')}</textarea>
      <p class="igx-nota">Instagram no deja cambiar el texto de un post. Al guardar se <b>publica de nuevo</b> y se borra el original: <b>pierde sus likes y comentarios</b>.</p>
      <div class="igx-fila"><button class="igx-btn ghost" onclick="igPintarModal();igPintarComs()">Cancelar</button>
        <button class="igx-btn grad" id="igGuardarEd" onclick="igGuardarEdicion()">Volver a publicar</button></div>
    </div>`;
}
async function igGuardarEdicion() {
  const p = IG.post; if (!p) return;
  const caption = document.getElementById('igCaptionNuevo')?.value.trim();
  if (!caption) return toast('El texto no puede ir vacío');
  const btn = document.getElementById('igGuardarEd'); if (btn) { btn.disabled = true; btn.textContent = 'Publicando…'; }
  try { const r = await igApi('ig-editar-post', { media: p.id, caption }); if (typeof igBorrarTexto === 'function') igBorrarTexto('cap:' + p.id); toast(r.aviso || r.avisoBorrado || 'Publicación actualizada'); igCerrarPost(); igCargarPosts(); }
  catch (e) { toast(e.message); if (btn) { btn.disabled = false; btn.textContent = 'Volver a publicar'; } }
}

async function igBorrarPost() {
  const p = IG.post; if (!p) return;
  const ok = await uiConfirm({ titulo: 'Borrar publicación', sub: p.prenda ? `Prenda #${p.prenda.id} · ${p.prenda.nombre}` : '',
    mensaje: 'Se borra de Instagram con sus likes y comentarios. No se puede deshacer.', ok: 'Borrar', peligro: true });
  if (!ok) return;
  try {
    await igApi('ig-borrar-post', { media: p.id });
    IG.posts = IG.posts.filter(x => x.id !== p.id);
    if (IG.estado.perfil.media_count) IG.estado.perfil.media_count--;
    igCerrarPost(); igRefrescar(); toast('Publicación borrada');
  } catch (e) { toast(e.message); }
}

// ═════════════════════════════════════════════════════════════
//  BANDEJA DE COMENTARIOS
// ═════════════════════════════════════════════════════════════
async function igCargarBandeja() {
  IG.cargandoBandeja = true; if (IG.vista === 'bandeja') igRefrescar();
  try { IG.bandeja = await igApi('ig-bandeja'); }
  catch (e) { IG.bandeja = { comentarios: [], error: e.message }; }
  IG.cargandoBandeja = false;
  if (IG.vista === 'bandeja') igRender();
}

function igVistaBandeja() {
  const b = IG.bandeja;
  const todos = b?.comentarios || [];
  const pend = todos.filter(c => !c.respondido && !c.hidden);
  const lista = IG.filtroBandeja === 'pendientes' ? pend : todos;
  return `
    ${igCabecera('Comentarios', 'Lo que te escribieron en tus últimos 20 posts, en un solo lugar',
      `<button class="igx-btn ghost" onclick="IG.bandeja=null;igCargarBandeja()">${I.refresh} Actualizar</button>`)}
    <div class="igx-filtros">
      <button class="igx-chip ${IG.filtroBandeja === 'pendientes' ? 'on' : ''}" onclick="IG.filtroBandeja='pendientes';igRefrescar()">Sin responder <em>${pend.length}</em></button>
      <button class="igx-chip ${IG.filtroBandeja === 'todos' ? 'on' : ''}" onclick="IG.filtroBandeja='todos';igRefrescar()">Todos <em>${todos.length}</em></button>
      <button class="igx-link" onclick="igVista('ajustes')">Editar respuestas rápidas</button>
    </div>
    ${b?.error ? `<div class="igx-alerta">${igEsc(b.error)}</div>` : ''}
    <div class="igx-card sin-pad">
      ${IG.cargandoBandeja || !b ? '<div class="igx-vacio"><span class="igx-spin"></span>Juntando comentarios…</div>'
        : !lista.length ? `<div class="igx-vacio">${IG.filtroBandeja === 'pendientes' ? `${ico('listo', 18)} Respondiste todo.` : 'Sin comentarios.'}</div>`
        : lista.map(c => igComentarioHTML(c, true)).join('')}
    </div>`;
}

// ═════════════════════════════════════════════════════════════
//  MENSAJES DIRECTOS
// ═════════════════════════════════════════════════════════════
async function igCargarDms() {
  IG.cargandoDms = true; IG.dmError = ''; if (IG.vista === 'dms') igRefrescar();
  try { IG.dms = (await igApi('ig-dms')).conversaciones || []; }
  catch (e) { IG.dms = []; IG.dmError = e.message; }
  IG.cargandoDms = false;
  if (IG.vista === 'dms') igRefrescar();
}

async function igAbrirConv(id) {
  IG.convActiva = id; IG.hilo = { cargando: true, mensajes: [] }; igRefrescar();
  try { IG.hilo = await igApi('ig-dm', undefined, `&conv=${encodeURIComponent(id)}`); }
  catch (e) { IG.hilo = { mensajes: [], error: e.message }; }
  igRefrescar();
  const cont = document.getElementById('igHilo'); if (cont) cont.scrollTop = cont.scrollHeight;
}

async function igEnviarDM() {
  const input = document.getElementById('igDmInput');
  const texto = (input?.value || '').trim();
  if (!texto || !IG.hilo?.usuarioId) return;
  input.disabled = true;
  try {
    await igApi('ig-dm-enviar', { usuarioId: IG.hilo.usuarioId, texto });
    if (typeof igBorrarTexto === 'function') igBorrarTexto('dm:' + (IG.convActiva || ''));
    IG.hilo.mensajes.push({ texto, deMi: true, fecha: new Date().toISOString() });
    const c = IG.dms?.find(x => x.id === IG.convActiva); if (c) { c.ultimo = texto; c.deMi = true; c.actualizado = new Date().toISOString(); }
    igRefrescar();
    const cont = document.getElementById('igHilo'); if (cont) cont.scrollTop = cont.scrollHeight;
    document.getElementById('igDmInput')?.focus();
  } catch (e) { toast(e.message); input.disabled = false; }
}
function igDmRR(k) {
  const t = IG.estado?.config?.respuestasRapidas?.[k], input = document.getElementById('igDmInput');
  if (t && input) { input.value = t; input.focus(); }
}

function igVistaDms() {
  if (IG.dmError) {
    return `${igCabecera('Mensajes', 'Tus mensajes directos de Instagram')}
      <div class="igx-card"><div class="igx-alerta">${igEsc(IG.dmError)}</div>
        <p class="igx-nota">Para usar los mensajes desde el panel: en tu app de Meta agrega los permisos <b>instagram_manage_messages</b> y
        <b>pages_manage_metadata</b>, genera de nuevo el token, y en la app de Instagram activa
        <b>Configuración → Mensajes → Herramientas conectadas → Permitir acceso a los mensajes</b>.</p></div>`;
  }
  const rr = IG.estado?.config?.respuestasRapidas || [];
  return `
    ${igCabecera('Mensajes', 'Tus mensajes directos de Instagram',
      `<button class="igx-btn ghost" onclick="IG.dms=null;igCargarDms()">${I.refresh} Actualizar</button>`)}
    <div class="igx-dm ${IG.convActiva ? 'con-hilo' : ''}">
      <div class="igx-dm-lista">
        ${IG.cargandoDms || !IG.dms ? '<div class="igx-vacio mini"><span class="igx-spin"></span>Cargando…</div>'
          : !IG.dms.length ? '<div class="igx-vacio mini">Sin conversaciones.</div>'
          : IG.dms.map(c => `
            <button class="igx-dm-it ${IG.convActiva === c.id ? 'on' : ''}" onclick="igAbrirConv('${igEsc(c.id)}')">
              <span class="igx-dm-av">${igEsc((c.usuario || '?')[0].toUpperCase())}</span>
              <span class="igx-dm-txt"><b>${igEsc(c.usuario)}</b><small>${c.deMi ? 'Tú: ' : ''}${igEsc(c.ultimo || '')}</small></span>
              <span class="igx-dm-fecha">${igFecha(c.actualizado)}</span>
            </button>`).join('')}
      </div>
      <div class="igx-dm-hilo">
        ${!IG.convActiva ? '<div class="igx-vacio">Elige una conversación</div>' : `
          <div class="igx-dm-cab"><button class="igx-volver" onclick="IG.convActiva=null;igRefrescar()" aria-label="Volver">‹</button>
            <b>${igEsc(IG.hilo?.usuario || '')}</b>
            ${IG.hilo?.usuario ? `<a href="https://instagram.com/${igEsc(IG.hilo.usuario)}" target="_blank" rel="noopener">${I.ext}</a>` : ''}</div>
          <div class="igx-dm-msgs" id="igHilo">
            ${IG.hilo?.cargando ? '<div class="igx-vacio mini">Cargando…</div>' : IG.hilo?.error ? `<div class="igx-alerta">${igEsc(IG.hilo.error)}</div>`
              : (IG.hilo?.mensajes || []).map(m => `<div class="igx-msg ${m.deMi ? 'mio' : ''}">
                  ${m.imagen ? `<img src="${igEsc(igPx(m.imagen))}" alt="">` : ''}${m.texto ? `<p>${igEsc(m.texto)}</p>` : ''}<small>${igFecha(m.fecha, true)}</small></div>`).join('')}
          </div>
          ${rr.length ? `<div class="igx-rr dm">${rr.map((t, k) => `<button onclick="igDmRR(${k})">${igEsc(t.length > 34 ? t.slice(0, 32) + '…' : t)}</button>`).join('')}</div>` : ''}
          <div class="igx-dm-enviar">
            <input id="igDmInput" type="text" maxlength="1000" placeholder="Escribe un mensaje…" data-borrador="dm:${igEsc(IG.convActiva || '')}" onkeydown="if(event.key==='Enter')igEnviarDM()">
            <button class="igx-btn ghost ia" onclick="igIASugerirDM()" title="Sugerir respuesta con IA">✦</button>
            <button class="igx-btn ghost" onclick="typeof igOfrecerDM==='function'&&igOfrecerDM()" title="Ofrecer una prenda con descuento y apartarla" aria-label="Ofrecer una prenda con descuento">${ico('oferta', 17)}</button>
            <button class="igx-btn grad" onclick="igEnviarDM()">${I.send}</button>
          </div>
          <p class="igx-nota mini">Instagram solo permite contestar dentro de las 24 h después del último mensaje del cliente.</p>`}
      </div>
    </div>`;
}

// ═════════════════════════════════════════════════════════════
//  CREAR
// ═════════════════════════════════════════════════════════════
function igVistaCrear() {
  const disponibles = igPrendas().filter(p => !p.vendido && !p.oculto && Array.isArray(p.imagenes) && p.imagenes.length)
    .sort((a, b) => (a.instagramId ? 1 : 0) - (b.instagramId ? 1 : 0) || b.id - a.id);
  const max = IG.tipo === 'historia' ? 1 : 10;
  const cfg = IG.estado?.config || {};
  const prenda = IG.prendaId ? getDB().find(x => Number(x.id) === Number(IG.prendaId)) : null;
  const conPlantilla = IG.tipo === 'post' && prenda && IG.usarPlantilla && IG.fotos[0] && IG.fotos[0] === prenda.imagenes?.[0];
  const portada = IG.fotos[0] ? (conPlantilla ? igPlantillaPreview(IG.fotos[0], prenda) : IG.fotos[0]) : '';
  // v49: con plantilla, la foto de la portada vuelve a salir sola (sin textos) como 2ª foto
  const repite = conPlantilla && cfg.portadaSola !== false;
  const nCarrusel = Math.min(10, IG.fotos.length + (repite ? 1 : 0));
  const minFecha = new Date(Date.now() + 5 * 6e4 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16);

  return `
    ${igCabecera('Crear', 'Post, carrusel o historia — ahora o programado')}
    <div class="igx-crear">
      <div class="igx-card">
        <div class="igx-seg">
          <button class="${IG.tipo === 'post' ? 'on' : ''}" onclick="igTipo('post')">Post / carrusel</button>
          <button class="${IG.tipo === 'historia' ? 'on' : ''}" onclick="igTipo('historia')">Historia</button>
        </div>

        <div class="igx-sub">Fotos <span>${IG.fotos.length}/${max}</span></div>
        <div class="igx-sel-fila">
          ${IG.fotos.map((u, i) => `<div class="igx-sel"><img src="${igEsc(igMini(u, 180))}" alt=""><span class="igx-orden">${i + 1}</span>
            <button onclick="igQuitarFoto(${i})" aria-label="Quitar">×</button>
            ${i > 0 ? `<button class="izq" onclick="igMoverFoto(${i},-1)" aria-label="Mover">‹</button>` : ''}</div>`).join('')}
          ${IG.fotos.length < max ? `<label class="igx-subir"><input type="file" accept="image/*" ${IG.tipo === 'post' ? 'multiple' : ''} onchange="igSubirFotos(this.files)"><span>+</span><small>Subir</small></label>` : ''}
        </div>

        <div class="igx-sub">De tus prendas disponibles</div>
        <div class="igx-galeria">
          ${disponibles.length ? disponibles.map(p => `
            <div class="igx-gal ${Number(IG.prendaId) === p.id ? 'on' : ''}">
              <div class="igx-gal-cab"><b>${igEsc(p.nombre)}</b><span>$${igNum(p.precio_venta)}</span>
                ${p.instagramId ? '<em>ya en IG</em>' : ''}
                <button class="igx-link" onclick="igUsarPrenda(${p.id})">${IG.tipo === 'historia' ? 'Usar' : 'Usar fotos y texto'}</button></div>
              <div class="igx-gal-fotos">${p.imagenes.slice(0, 6).map(u => `
                <button class="igx-gal-foto ${IG.fotos.includes(u) ? 'on' : ''}" onclick="igAlternarFoto('${igEsc(u)}')"><img src="${igEsc(igMini(u, 140))}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div>
            </div>`).join('') : '<div class="igx-vacio mini">No hay prendas disponibles con fotos.</div>'}
        </div>

        ${IG.tipo === 'post' ? `
          ${prenda ? `<label class="igx-switch fila"><input type="checkbox" ${IG.usarPlantilla ? 'checked' : ''} onchange="IG.usarPlantilla=this.checked;igRefrescar()"><span class="igx-switch-ui"></span>
            <span><b>Portada con plantilla editorial</b><small>Nombre, talla y precio en una franja limpia bajo la foto${cfg.portadaSola !== false ? '. La misma foto sale otra vez sin textos como 2ª foto.' : ''}</small></span></label>` : ''}
          <div class="igx-sub">Texto <span id="igCapCont">${IG.caption.length}/2200</span></div>
          <textarea id="igCapInput" class="igx-textarea" maxlength="2200" rows="8" placeholder="Escribe la descripción…" oninput="igCapCambio(this.value)">${igEsc(IG.caption)}</textarea>
          <div class="igx-fila izq">
            <button class="igx-chip-btn" onclick="igInsertar(${igEsc(JSON.stringify('\n\n' + (cfg.firma || '')))})">+ Firma</button>
            <button class="igx-chip-btn" onclick="igInsertar(${igEsc(JSON.stringify('\n\n' + (cfg.hashtags || '')))})">+ Hashtags</button>
          </div>` : `<p class="igx-nota mini">La foto se ajusta sola a pantalla completa (9:16).</p>`}

        <div class="igx-sub">¿Cuándo?</div>
        <div class="igx-seg chico">
          <button class="${IG.cuando === 'ahora' ? 'on' : ''}" onclick="IG.cuando='ahora';igRefrescar()">Publicar ahora</button>
          <button class="${IG.cuando === 'programar' ? 'on' : ''}" onclick="IG.cuando='programar';igRefrescar()">${I.cal} Programar</button>
        </div>
        ${IG.cuando === 'programar' ? `<input type="datetime-local" class="igx-input" id="igFechaProg" min="${minFecha}" value="${igEsc(IG.fechaProg)}" onchange="IG.fechaProg=this.value">` : ''}

        <button class="igx-btn grad grande" onclick="igPublicar()" ${IG.publicando ? 'disabled' : ''}>
          ${IG.publicando ? 'Publicando…' : IG.cuando === 'programar' ? `${I.cal} Programar ${IG.tipo === 'historia' ? 'historia' : 'publicación'}` : IG.tipo === 'historia' ? 'Publicar historia' : nCarrusel > 1 ? `Publicar carrusel (${nCarrusel})` : 'Publicar post'}
        </button>

        <button class="igx-atajo" onclick="igVista('historias')">
          <span class="igx-atajo-ic">${I.story}</span>
          <span><b>¿Historia de una prenda?</b><small>En Historias tienes diseños editoriales listos: Crema, Noir o Portada.</small></span>
          <em>→</em>
        </button>
      </div>

      <div class="igx-preview">
        <div class="igx-tel ${IG.tipo}">
          <div class="igx-tel-cab"><span class="igx-avatar mini">${IG.estado.perfil.profile_picture_url ? `<img src="${igEsc(igPx(IG.estado.perfil.profile_picture_url))}" alt="">` : ''}</span><b>${igEsc(IG.estado.perfil.username)}</b></div>
          <div class="igx-tel-media">${portada ? `<img src="${igEsc(portada)}" alt="">` : '<span>Vista previa</span>'}
            ${IG.tipo === 'post' && nCarrusel > 1 ? `<span class="igx-tel-puntos">${Array.from({ length: nCarrusel }, (_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</span>` : ''}</div>
          ${IG.tipo === 'post' ? `<div class="igx-tel-icons">${I.heart}${I.chat}${I.send}</div>
            <div class="igx-tel-cap" id="igTelCaption"><b>${igEsc(IG.estado.perfil.username)}</b> ${igEsc(IG.caption).replace(/\n/g, '<br>')}</div>` : ''}
        </div>
      </div>
    </div>`;
}

// Misma plantilla editorial que arma el servidor (api/_lib/instagram.js →
// imagenPlantilla), para ver la portada al instante sin ir al servidor.
const IG_TONOS = {
  crema:  { fondo: 'f3efe7', tinta: '111111', suave: '8a8178', nombre: 'Crema' },
  blanco: { fondo: 'ffffff', tinta: '111111', suave: '8a8178', nombre: 'Blanco' },
  noir:   { fondo: '0e0e0f', tinta: 'f5f2ec', suave: '9b948a', nombre: 'Noir' },
};
function igPlantillaPreview(url, prenda, tono) {
  if (!url?.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  const m = url.match(/\/upload\/(?:[^/]*[_,:][^/]*\/)*(?:v\d+\/)?(.+?)\.[a-z0-9]+$/i); if (!m) return url;
  const t = (s, max = 60) => encodeURIComponent(String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max))
    .replace(/%2C/g, '%252C').replace(/%2F/g, '%252F').replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const T = IG_TONOS[tono || IG.estado?.config?.tonoPlantilla] || IG_TONOS.crema;
  const SERIF = 'Playfair%20Display', ALERTA = 'b3261e';
  const pid = m[1], capa = pid.replace(/\//g, ':'), vendido = !!prenda.vendido;
  const talla = prenda.talla ? String(prenda.talla).split('·')[0].trim() : '';
  let nombre = String(prenda.nombre || '').trim();
  if (nombre.length > 26) nombre = nombre.slice(0, 25).trim() + '…';
  const det = [talla && `TALLA ${talla.toUpperCase()}`, prenda.estado && String(prenda.estado).toUpperCase()].filter(Boolean).join('  ·  ');
  const p = [
    `c_fill,w_1080,h_1350,g_auto/e_colorize:100,co_rgb:${T.fondo}`,
    `l_${capa}/c_fill,w_1080,h_1150,g_auto/e_blur:1800/e_brightness:-12${vendido ? '/e_grayscale' : ''}/e_gradient_fade,y_-0.35/fl_layer_apply,g_north`,
    `l_${capa}/c_fit,w_1000,h_1100${vendido ? '/e_grayscale/e_brightness:-5' : ''}/r_10/fl_layer_apply,g_north,y_24`,
  ];
  if (vendido) p.push('l_text:Montserrat_30_semibold_letter_spacing_16:VENDIDO,co_rgb:111111,b_white/bo_30px_solid_white/fl_layer_apply,g_center,y_-90');
  if (nombre) p.push(`l_text:${SERIF}_52:${t(nombre, 30)},co_rgb:${T.tinta}/fl_layer_apply,g_south_west,x_64,y_118`);
  if (det) p.push(`l_text:Montserrat_23_semibold_letter_spacing_6:${t(det, 40)},co_rgb:${T.suave}/fl_layer_apply,g_south_west,x_67,y_70`);
  if (vendido) p.push(`l_text:Montserrat_24_semibold_letter_spacing_8:VENDIDO,co_rgb:${ALERTA}/fl_layer_apply,g_south_east,x_64,y_104`);
  else if (prenda.precio_venta != null) p.push(`l_text:${SERIF}_68_italic:${t('$' + Number(prenda.precio_venta || 0).toLocaleString('es-MX'))},co_rgb:${T.tinta}/fl_layer_apply,g_south_east,x_64,y_80`);
  p.push('c_scale,w_600/f_jpg,q_85');
  return url.split('/upload/')[0] + '/upload/' + p.join('/') + '/' + pid + '.jpg';
}

function igTipo(t) { IG.tipo = t; if (t === 'historia' && IG.fotos.length > 1) IG.fotos = IG.fotos.slice(0, 1); igRefrescar(); }
function igAlternarFoto(u) {
  const i = IG.fotos.indexOf(u);
  if (i >= 0) IG.fotos.splice(i, 1);
  else if (IG.tipo === 'historia') IG.fotos = [u];
  else if (IG.fotos.length < 10) IG.fotos.push(u);
  else return toast('Máximo 10 fotos por carrusel');
  if (!IG.fotos.length) IG.prendaId = null;
  igRefrescar();
}
function igQuitarFoto(i) { IG.fotos.splice(i, 1); if (!IG.fotos.length) IG.prendaId = null; igRefrescar(); }
function igMoverFoto(i, d) { const j = i + d; if (j < 0 || j >= IG.fotos.length) return; [IG.fotos[i], IG.fotos[j]] = [IG.fotos[j], IG.fotos[i]]; igRefrescar(); }

function igUsarPrenda(id) {
  const p = getDB().find(x => Number(x.id) === Number(id)); if (!p) return;
  const cfg = IG.estado?.config || {};
  IG.prendaId = p.id;
  if (IG.tipo === 'historia') { IG.fotos = [p.imagenes[0]]; return igRefrescar(); }
  IG.fotos = p.imagenes.slice(0, 10);
  IG.caption = igTextoPublicacion(p, cfg, igBazarTexto()); IG.captionEditado = false;
  igRefrescar();
}
function igCapCambio(v) {
  IG.caption = v; IG.captionEditado = true;   // v56: al programar, un texto editado no se rehace
  const c = document.getElementById('igCapCont'); if (c) c.textContent = `${v.length}/2200`;
  const t = document.getElementById('igTelCaption'); if (t) t.innerHTML = `<b>${igEsc(IG.estado.perfil.username)}</b> ${igEsc(v).replace(/\n/g, '<br>')}`;
}
function igInsertar(txt) {
  const ta = document.getElementById('igCapInput'); if (!ta) return;
  const ini = ta.selectionStart ?? ta.value.length;
  ta.value = (ta.value.slice(0, ini) + txt + ta.value.slice(ta.selectionEnd ?? ini)).slice(0, 2200);
  igCapCambio(ta.value); ta.focus();
}
async function igSubirFotos(files) {
  const lista = Array.from(files || []).slice(0, (IG.tipo === 'historia' ? 1 : 10) - IG.fotos.length);
  if (!lista.length) return;
  const lote = Avisos.lote({ clave: 'fotos-instagram', origen: 'fotos', total: lista.length, textos: {
    cargando: (h, n) => n === 1 ? 'Subiendo foto…' : `Subiendo fotos… ${h} de ${n}`,
    ok: n => n === 1 ? 'Foto lista para publicar' : `${n} fotografías listas para publicar`,
    fallo: (f, n) => n === 1 ? 'No se pudo subir la foto' : `${f} de ${n} fotos no se pudieron subir` } });
  for (const f of lista) {
    try {
      const b64 = await new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => mal(new Error('No se pudo leer el archivo')); r.readAsDataURL(f); });
      const url = await uploadToCloud(b64);
      if (IG.tipo === 'historia') IG.fotos = [url]; else IG.fotos.push(url);
      igRefrescar();
      lote.ok(f.name);
    } catch (e) { lote.fallo(f.name, e, () => igSubirFotos([f])); }
  }
}

async function igPublicar() {
  if (IG.publicando) return;
  if (!IG.fotos.length) return toast('Elige al menos una foto');
  const prenda = IG.prendaId ? getDB().find(x => Number(x.id) === Number(IG.prendaId)) : null;
  const plantilla = IG.tipo === 'post' && !!prenda && IG.usarPlantilla && IG.fotos[0] === prenda.imagenes?.[0];
  const cuerpo = { tipo: IG.tipo, imagenes: IG.fotos, caption: IG.caption, prendaId: prenda?.id || null, plantilla, captionAuto: !!prenda && !IG.captionEditado };
  if (IG.cuando === 'programar') {
    const v = document.getElementById('igFechaProg')?.value || IG.fechaProg;
    if (!v) return toast('Elige fecha y hora');
    cuerpo.publicarEn = new Date(v).toISOString();
  } else if (IG.tipo === 'post' && !IG.caption.trim()) {
    if (!(await uiConfirm({ titulo: 'Publicar sin texto', mensaje: '¿Seguro que quieres publicar sin descripción?', ok: 'Publicar' }))) return;
  }
  IG.publicando = true; igRefrescar();
  try {
    if (IG.cuando === 'programar') {
      await igApi('ig-programar', cuerpo);
      toast('Programado ✓');
      IG.estado.pendientes = (IG.estado.pendientes || 0) + 1; IG.programados = null;
      Object.assign(IG, { fotos: [], caption: '', prendaId: null, fechaProg: '', cuando: 'ahora', vista: 'programados' });
      IG.publicando = false; igRender(); return;
    }
    const r = await igApi('ig-publicar', cuerpo);
    toast(IG.tipo === 'historia' ? '¡Historia publicada!' : '¡Publicado en Instagram!', { tipo: 'ok', origen: 'instagram',
      ir: r.permalink ? { texto: 'Ver en Instagram', url: r.permalink, nueva: true } : null });
    if (prenda && r.id && !prenda.instagramId) { prenda.instagramId = r.id; prenda.instagramUrl = r.permalink; }
    if (typeof registrarLog === 'function') registrarLog('instagram', IG.tipo === 'historia' ? 'Historia' : 'Post', r.permalink || '');
    const eraPost = IG.tipo === 'post';
    Object.assign(IG, { fotos: [], caption: '', prendaId: null });
    if (eraPost) { IG.estado.perfil.media_count = (IG.estado.perfil.media_count || 0) + 1; IG.vista = 'posts'; IG.publicando = false; igRender(); igCargarPosts(); return; }
  } catch (e) {
    IG.publicando = false;
    toast(e.message || 'No se pudo publicar', { tipo: 'error', origen: 'instagram', titulo: 'No se pudo publicar en Instagram', cuerpo: e.message || '',
      reintentar: () => { if (IG.fotos.length) igPublicar(); } });
  }
  IG.publicando = false; if (IG.vista === 'crear') igRefrescar();
}

async function igHistoriaPrenda(id) {
  if (IG.publicandoHistoria) return;
  IG.publicandoHistoria = id; igRefrescar();
  try {
    await igApi('ig-historia-prenda', { id, estilo: IG.estiloHistoria || undefined });
    const ahora = new Date().toISOString();
    const p = getDB().find(x => Number(x.id) === Number(id)); if (p) p.instagramHistoriaEn = ahora;
    const h = IG.historias?.find(x => x.id === id); if (h) h.ultima = ahora;
    toast('¡Historia publicada!');
  } catch (e) { toast(e.message); }
  IG.publicandoHistoria = null; igRefrescar();
}

// ═════════════════════════════════════════════════════════════
//  HISTORIAS — diseño automático por prenda, en 3 estilos
// ═════════════════════════════════════════════════════════════
const ESTILOS = [['crema', 'Crema', 'Papel crema, tinta negra'], ['noir', 'Noir', 'Negro profundo, letras marfil'], ['portada', 'Portada', 'Foto completa, tipo revista']];
const ESTILO_VIEJO = { claro: 'crema', oscuro: 'noir', color: 'portada' };

async function igCargarHistorias(estilo) {
  IG.cargandoHistorias = true; if (IG.vista === 'historias') igRefrescar();
  try {
    const r = await igApi('ig-historias', undefined, estilo ? `&estilo=${estilo}` : '');
    IG.historias = r.historias || []; IG.estiloHistoria = r.estilo;
  } catch (e) { IG.historias = []; toast(e.message); }
  IG.cargandoHistorias = false;
  if (IG.vista === 'historias') igRefrescar();
}

function igVistaHistorias() {
  const est = ESTILO_VIEJO[IG.estiloHistoria || IG.estado?.config?.estiloHistoria] || IG.estiloHistoria || IG.estado?.config?.estiloHistoria || 'crema';
  const lista = IG.historias;
  return `
    ${igCabecera('Historias', 'Una historia lista para cada prenda disponible: foto, precio, talla y tu link')}
    <div class="igx-estilos">
      ${ESTILOS.map(([k, t, d]) => `
        <button class="igx-estilo ${est === k ? 'on' : ''} est-${k}" onclick="igEstiloHistoria('${k}')">
          <span class="igx-estilo-mini"><i></i><i></i><i></i></span>
          <span><b>${t}</b><small>${d}</small></span>
        </button>`).join('')}
      ${isAdmin() && est !== IG.estado?.config?.estiloHistoria && ESTILOS.some(x => x[0] === est) ? `<button class="igx-link" onclick="igGuardarEstiloHistoria()">Usar «${ESTILOS.find(x => x[0] === est)[1]}» siempre</button>` : ''}
    </div>
    ${IG.cargandoHistorias || !lista ? `<div class="igx-historias">${Array.from({ length: 4 }, () => '<div class="igx-historia esqueleto"></div>').join('')}</div>`
      : !lista.length ? '<div class="igx-vacio">No hay prendas disponibles con fotos.</div>'
      : `<div class="igx-historias">${lista.map(h => `
          <div class="igx-historia">
            <div class="igx-historia-img">
              <img src="${igEsc(h.preview)}" alt="Historia de ${igEsc(h.nombre)}" loading="lazy">
              ${h.ultima ? `<span class="igx-historia-ult">Subida ${igFecha(h.ultima).toLowerCase()}</span>` : ''}
              <div class="igx-historia-acc">
                <button class="igx-btn grad" onclick="igHistoriaPrenda(${h.id}, this)" ${IG.publicandoHistoria === h.id ? 'disabled' : ''}>
                  ${IG.publicandoHistoria === h.id ? '<span class="igx-spin blanco"></span> Publicando…' : `${I.story} Publicar historia`}</button>
                <a class="igx-btn ghost" href="${igEsc(h.preview.replace('/c_scale,w_420/f_jpg,q_80/', '/f_jpg,q_90/'))}" target="_blank" rel="noopener">${I.eye} Ver grande</a>
              </div>
            </div>
            <div class="igx-historia-pie"><b>${igEsc(h.nombre)}</b><span>$${igNum(h.precio)}</span></div>
          </div>`).join('')}</div>`}`;
}

function igEstiloHistoria(k) { IG.estiloHistoria = k; IG.historias = null; igCargarHistorias(k); }
async function igGuardarEstiloHistoria() {
  try {
    const r = await igApi('ig-config', { ...IG.estado.config, estiloHistoria: IG.estiloHistoria });
    IG.estado.config = r.config; igRefrescar(); toast('Estilo guardado');
  } catch (e) { toast(e.message); }
}

// ═════════════════════════════════════════════════════════════
//  PROGRAMADOS
// ═════════════════════════════════════════════════════════════
async function igCargarProgramados() {
  try { IG.programados = (await igApi('ig-programados')).programados || []; }
  catch (e) { IG.programados = []; toast(e.message); }
  if (IG.vista === 'programados') igRefrescar();
}

function igVistaProgramados() {
  const lista = IG.programados;
  const ahora = Date.now();
  const futuros = (lista || []).filter(x => x.estado === 'pendiente' || x.estado === 'publicando').sort((a, b) => new Date(a.publicarEn) - new Date(b.publicarEn));
  const pasados = (lista || []).filter(x => !futuros.includes(x));
  const fila = x => `
    <div class="igx-prog est-${x.estado}">
      <img src="${igEsc(igMini(x.imagenes[0], 120))}" alt="">
      <div class="igx-prog-txt">
        <b>${x.tipo === 'historia' ? 'Historia' : x.imagenes.length > 1 ? `Carrusel · ${x.imagenes.length} fotos` : 'Post'}</b>
        <span>${igEsc((x.caption || '').split('\n')[0].slice(0, 80)) || '<i>Sin texto</i>'}</span>
        ${x.estado === 'error' ? `<span class="rojo">${igEsc(x.error || 'Error')}</span>` : ''}
      </div>
      <div class="igx-prog-fecha">
        <b>${(d => d.charAt(0).toUpperCase() + d.slice(1))(new Date(x.publicarEn).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }))}</b>
        <span>${new Date(x.publicarEn).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' })}</span>
      </div>
      <span class="igx-pill ${x.estado}">${{ pendiente: new Date(x.publicarEn) < ahora ? 'En fila' : 'Programado', publicando: 'Publicando', publicado: 'Publicado', error: 'Error' }[x.estado]}</span>
      ${x.estado === 'publicado' && x.permalink ? `<a class="igx-btn ghost mini" href="${igEsc(x.permalink)}" target="_blank" rel="noopener">${I.ext}</a>`
        : ['pendiente', 'error'].includes(x.estado) ? `<span class="igx-fila">${x.tipo !== 'drop' && !x.generada ? `<button class="igx-btn ghost mini" onclick="igProgramadoABorrador(${x.id})" title="Sacar de la cola y editar">${I.edit} Editar</button>` : ''}${isAdmin() ? `<button class="igx-btn ghost mini peligro" onclick="igBorrarProgramado(${x.id})" aria-label="Quitar">${I.trash}</button>` : ''}</span>` : '<span></span>'}
    </div>`;
  return `
    ${igCabecera('Programados', 'Publicaciones que salen solas en la fecha que elegiste',
      `<button class="igx-btn ghost" onclick="igProcesarAhora()">${I.refresh} Revisar ahora</button><button class="igx-btn grad" onclick="IG.cuando='programar';igVista('crear')">${I.plus} Programar</button>`)}
    ${lista == null ? '<div class="igx-vacio"><span class="igx-spin"></span>Cargando…</div>' : `
      <div class="igx-card sin-pad">
        <div class="igx-card-tit pad">Próximas</div>
        ${futuros.length ? futuros.map(fila).join('') : '<div class="igx-vacio mini">Nada programado.</div>'}
      </div>
      ${pasados.length ? `<div class="igx-card sin-pad"><div class="igx-card-tit pad">Historial</div>${pasados.slice(0, 20).map(fila).join('')}</div>` : ''}
      <p class="igx-nota mini">Las publicaciones programadas salen en cuanto el sistema las revisa: al abrir esta sección, con el cron diario
        y, si lo configuras, cada 5 minutos con cron-job.org (instrucciones en el LEEME).</p>`}`;
}

// ── v58 · Publicaciones con problemas ─────────────────────────
async function igCargarProblemas() {
  IG.cargandoProblemas = true;
  try { IG.problemas = await igApi('ig-problemas'); }
  catch (e) { IG.problemas = { prendas: [], programados: [], total: 0, error: e.message }; }
  IG.cargandoProblemas = false;
  if (document.querySelector('#igRaiz .igx')) igRender();
}
function igHaceTxt(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'hace un momento' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : igFecha(iso, true);
}
function igVistaProblemas() {
  const d = IG.problemas;
  const filaPrenda = x => `
    <div class="igx-prog igx-prob est-${x.estado === 'publicando' ? 'publicando' : 'error'}" data-prob="${x.id}">
      ${x.foto ? `<img src="${igEsc(igMini(x.foto, 120))}" alt="">` : '<span class="igx-prob-sinfoto"></span>'}
      <div class="igx-prog-txt">
        <b>${igEsc(x.nombre || 'Prenda ' + x.id)}</b>
        <span class="${x.estado === 'publicando' ? '' : 'rojo'}">${igEsc(x.mensaje)}</span>
        <span>${igHaceTxt(x.en)}${x.intentos > 1 ? ` · ${x.intentos} intentos` : ''}</span>
      </div>
      <span class="igx-pill ${x.estado === 'publicando' ? 'publicando' : 'error'}">${{ publicando: 'Publicando', atorada: 'A medias', error: 'Error' }[x.estado]}</span>
      <span class="igx-fila">
        <button class="igx-btn grad mini" onclick="igProblemaReintentar(${x.id}, '${x.estado}')">${I.refresh} Reintentar</button>
        ${x.estado !== 'publicando' ? `<button class="igx-btn ghost mini" onclick="igProblemaCancelar(${x.id})" title="Ya no intentar">Cancelar</button>` : ''}
      </span>
    </div>`;
  const filaProg = x => `
    <div class="igx-prog igx-prob est-error" data-prob-prog="${x.id}">
      <img src="${igEsc(igMini((x.imagenes || [])[0], 120))}" alt="">
      <div class="igx-prog-txt">
        <b>${x.tipo === 'historia' ? 'Historia programada' : x.tipo === 'drop' ? 'Drop programado' : 'Post programado'}</b>
        <span class="rojo">${igEsc(x.estado === 'publicando' ? 'Se quedó publicando (se cortó)' : x.error || 'Error')}</span>
        <span>${igEsc((x.caption || '').split('\n')[0].slice(0, 70))}</span>
      </div>
      <span class="igx-pill error">${x.estado === 'publicando' ? 'A medias' : 'Error'}</span>
      <span class="igx-fila">
        <button class="igx-btn grad mini" onclick="igProgramadoReintentar(${x.id})">${I.refresh} Reintentar</button>
        ${isAdmin() ? `<button class="igx-btn ghost mini" onclick="igProblemaBorrarProgramado(${x.id})" title="Quitar de programados">Cancelar</button>` : ''}
      </span>
    </div>`;
  return `
    ${igCabecera('Con problemas', 'Publicaciones que fallaron o se quedaron a medias',
      `<button class="igx-btn ghost" onclick="IG.problemas=null;igCargarProblemas();igRefrescar()">${I.refresh} Revisar de nuevo</button>`)}
    ${d == null ? '<div class="igx-vacio"><span class="igx-spin"></span>Cargando…</div>' : `
      <div class="igx-card sin-pad">
        <div class="igx-card-tit pad">Prendas</div>
        ${d.prendas.length ? d.prendas.map(filaPrenda).join('') : '<div class="igx-vacio mini">Ninguna prenda con problemas.</div>'}
      </div>
      <div class="igx-card sin-pad">
        <div class="igx-card-tit pad">Programados</div>
        ${d.programados.length ? d.programados.map(filaProg).join('') : '<div class="igx-vacio mini">Ningún programado con problemas.</div>'}
      </div>
      <p class="igx-nota mini"><b>Reintentar</b> primero revisa si el post sí alcanzó a salir en Instagram: si salió, solo lo liga con la prenda (no se publica dos veces). <b>Cancelar</b> quita el aviso; la prenda queda lista para publicarla cuando quieras.</p>`}`;
}
async function igProblemaReintentar(id, estado) {
  if (estado === 'publicando' && !(await uiConfirm({ titulo: 'Cancelar y reintentar', mensaje: 'Esta prenda se empezó a publicar hace menos de 3 minutos. Si esa publicación sí termina, podría salir dos veces. ¿Reintentar de todos modos?', ok: 'Reintentar' }))) return;
  try {
    const r = await igApi('ig-destrabar', { id, forzar: estado === 'publicando' });
    const p = getDB().find(x => Number(x.id) === Number(id));
    if (r.vinculada || r.yaPublicada) {
      if (p) { Object.assign(p, { instagramId: r.instagramId || p.instagramId, instagramUrl: r.instagramUrl || r.permalink || p.instagramUrl }); delete p.instagramError; delete p.instagramPublicando; }
      toast('Ya estaba en Instagram: se ligó con la prenda (no se publicó otra vez)', { tipo: 'ok', ir: (r.instagramUrl || r.permalink) ? { texto: 'Ver en Instagram', url: r.instagramUrl || r.permalink, nueva: true } : null });
    } else {
      if (p) delete p.instagramPublicando;
      if (typeof publicarEnInstagram === 'function') await publicarEnInstagram(id);
    }
  } catch (e) { toast(e.message || 'No se pudo reintentar', { tipo: 'error' }); }
  if (typeof renderInv === 'function') renderInv();
  IG.problemas = null; igCargarProblemas();
}
async function igProblemaCancelar(id) {
  try {
    await igApi('ig-descartar-error', { id });
    const p = getDB().find(x => Number(x.id) === Number(id));
    if (p) { delete p.instagramError; delete p.instagramPublicando; }
    if (typeof renderInv === 'function') renderInv();
    toast('Listo: ya no aparece como error. Puedes publicarla cuando quieras.', { tipo: 'ok' });
  } catch (e) { toast(e.message || 'No se pudo cancelar', { tipo: 'error' }); }
  IG.problemas = null; igCargarProblemas();
}
async function igProgramadoReintentar(id) {
  try {
    const r = await igApi('ig-programado-reintentar', { id });
    toast(r.yaSalio ? 'Ya se había publicado: se marcó como publicado' : (r.hechos || []).some(h => h.ok) ? 'Publicado ✓' : 'Se volvió a poner en la fila', { tipo: r.yaSalio || (r.hechos || []).some(h => h.ok) ? 'ok' : 'info' });
  } catch (e) { toast(e.message || 'No se pudo reintentar', { tipo: 'error' }); }
  IG.problemas = null; IG.programados = null; igCargarProblemas();
}
async function igProblemaBorrarProgramado(id) {
  if (!(await uiConfirm({ titulo: 'Quitar de programados', mensaje: 'Ya no se publicará.', ok: 'Quitar', peligro: true }))) return;
  try { await igApi('ig-programado-borrar', { id }); } catch (e) { toast(e.message); }
  IG.problemas = null; IG.programados = null; igCargarProblemas();
}

async function igBorrarProgramado(id) {
  if (!(await uiConfirm({ titulo: 'Quitar de programados', mensaje: 'Ya no se publicará.', ok: 'Quitar', peligro: true }))) return;
  try {
    await igApi('ig-programado-borrar', { id });
    IG.programados = IG.programados.filter(x => x.id !== id);
    IG.estado.pendientes = Math.max(0, (IG.estado.pendientes || 1) - 1);
    igRender();
  } catch (e) { toast(e.message); }
}
async function igProcesarAhora() {
  try {
    const r = await igApi('ig-procesar', {});
    toast(r.publicados?.length ? `${r.publicados.filter(x => x.ok).length} publicada(s)` : 'Nada pendiente por ahora');
    IG.programados = null; igCargarProgramados();
  } catch (e) { toast(e.message); }
}

// ═════════════════════════════════════════════════════════════
//  AJUSTES (automatización, plantilla, respuestas rápidas)
// ═════════════════════════════════════════════════════════════

function igVistaAjustes() {
  const c = IG.estado?.config || {};
  const admin = isAdmin();
  const dis = admin ? '' : 'disabled';
  const sw = (k, titulo, desc) => `
    <label class="igx-switch"><input type="checkbox" id="igCfg_${k}" ${c[k] ? 'checked' : ''} ${dis}><span class="igx-switch-ui"></span>
      <span><b>${titulo}</b><small>${desc}</small></span></label>`;
  const muestra = igPrendas().find(p => !p.vendido && p.imagenes?.[0]?.includes('res.cloudinary.com'));
  const tono = IG.tonoTmp || c.tonoPlantilla || 'crema';
  return `
    ${igCabecera('Ajustes', 'Lo que pasa solo, y cómo se ven tus publicaciones')}
    <div class="igx-col2 arriba">
      <div class="igx-card">
        <div class="igx-card-tit">Automatización</div>
        <div class="igx-sub">Al subir una prenda</div>
        ${sw('autoPublicar', 'Publicarla en Instagram', 'Carrusel con todas sus fotos y el texto con talla, precio y link.')}
        <div class="igx-sub">Al marcarla como vendida</div>
        ${sw('autoComentario', 'Comentar "VENDIDA" en su post', 'Quien vea la publicación sabrá que ya no está.')}
        ${sw('autoHistoria', 'Subir historia de VENDIDO', 'Diseño editorial con la foto en gris y el link a la tienda.')}
        ${'' && sw('autoPortada', 'Cambiar la portada del post a VENDIDO', 'Foto en gris con sello VENDIDO. Se vuelve a publicar: pierde likes y comentarios.')}
        <p class="igx-nota mini">Son las opciones que vienen marcadas; en cada prenda puedes cambiarlas antes de guardar.</p>
      </div>
      <div class="igx-card">
        <div class="igx-card-tit">Plantilla de marca</div>
        ${sw('hashtagsInteligentes', 'Hashtags por prenda', 'Elige los que más sirven para cada prenda: lo más específico, la marca, el tipo de prenda y tu ciudad.')}
        ${sw('plantilla', 'Usar plantilla en la portada', 'La foto se funde con una franja limpia: nombre en serif, talla, estado y precio. Igual en todos tus posts.')}
        ${sw('portadaSola', 'Repetir la foto de la portada sin textos', 'La portada lleva la plantilla y la misma foto vuelve a salir sola, limpia, como 2ª foto del carrusel (así se ve la prenda completa sin la franja).')}
        ${sw('mejorarFotos', 'Mejorar fotos automáticamente', 'Corrige luz, color y nitidez de cada foto al publicar (Cloudinary, sin costo). Tus fotos originales no cambian.')}
        <div class="igx-sub">Tono de la franja</div>
        <div class="igx-tonos">${Object.entries(IG_TONOS).map(([k, t]) => `<button class="igx-tono ${tono === k ? 'on' : ''}" ${dis}
          onclick="igTono('${k}')"><i style="background:#${t.fondo}"></i>${t.nombre}</button>`).join('')}</div>
        ${muestra ? `<div class="igx-muestras" id="igMuestras">
            <figure><img src="${igEsc(igPlantillaPreview(muestra.imagenes[0], muestra, tono))}" alt=""><figcaption>Disponible</figcaption></figure>
            <figure><img src="${igEsc(igPlantillaPreview(muestra.imagenes[0], { ...muestra, vendido: true }, tono))}" alt=""><figcaption>Vendido</figcaption></figure>
          </div>` : ''}
        <p class="igx-nota mini">Para darles esta estética a tus posts anteriores: <b>Publicaciones → Seleccionar varias → Aplicar plantilla</b>.</p>
      </div>
    </div>
    <div class="igx-col2 arriba">
      <div class="igx-card">
        <div class="igx-card-tit">Textos de tus publicaciones</div>
        <div class="fg"><label>Firma (va antes del link)</label><input type="text" id="igCfg_firma" maxlength="300" value="${igEsc(c.firma || '')}" data-borrador="cfg:firma" ${dis}></div>
        <div class="fg"><label>Estilo del texto</label><select id="igCfg_estiloTexto" ${dis}><option value="limpio" ${c.estiloTexto !== 'emojis' ? 'selected' : ''}>Limpio, sin emojis (Precio:, Talla:, Estado:)</option><option value="emojis" ${c.estiloTexto === 'emojis' ? 'selected' : ''}>Con emojis</option></select></div>
        ${sw('textoCorto', 'Texto corto (solo lo importante)', 'Precio, talla, estado, medidas, una frase de la prenda y lo que hay que considerar. La lista de detalles se queda en la tienda.')}
        <div class="fg"><label>Hashtags por publicación</label><select id="igCfg_maxHashtags" ${dis}>${[5, 4, 3, 2, 1, 0].map(n => `<option value="${n}" ${Number(c.maxHashtags ?? 5) === n ? 'selected' : ''}>${n ? n + (n === 5 ? ' (lo máximo que deja Instagram)' : '') : 'Ninguno'}</option>`).join('')}</select></div>
        <div class="fg"><label>Hashtags de la tienda (se usan si sobra lugar)</label><textarea id="igCfg_hashtags" class="igx-textarea" rows="2" maxlength="600" data-borrador="cfg:hashtags" ${dis}>${igEsc(c.hashtags || '')}</textarea></div>
        ${sw('avisarCambios', 'Avisar cambios en el post', 'Si cambias el precio, se comenta el precio nuevo en su post (uno solo, se reemplaza). Si borras la prenda, se avisa que ya no está disponible. Si reviertes una venta, se quita el comentario de VENDIDA.')}
        <p class="igx-nota mini">Formas de pago: ${IG.estado?.pagos ? `“${igEsc(IG.estado.pagos)}”` : 'ninguna marcada'} (se cambian en <b>Ventas → Promociones y pagos</b>, lo mismo para la tienda).</p>
        <p class="igx-nota mini">Instagram solo deja <b>5 hashtags</b> por publicación. Tu WhatsApp <b>nunca</b> se pone en los posts, y si una descripción trae un teléfono, esa frase no se publica.</p>
        ${(() => { const m = igPrendas().find(p => !p.vendido); return m ? `<div class="igx-sub">Así se verá el texto (con ${igEsc(m.nombre)})</div><div class="igx-caption igx-cap-muestra">${igEsc(igTextoPublicacion(m, c, igBazarTexto())).replace(/\n/g, '<br>')}</div>` : ''; })()}
      </div>
      <div class="igx-card">
        <div class="igx-card-tit">Respuestas rápidas</div>
        <p class="igx-nota mini">Aparecen como botones al contestar comentarios y mensajes. Una por línea.</p>
        <textarea id="igCfg_rr" class="igx-textarea" rows="6" data-borrador="cfg:rr" ${dis}>${igEsc((c.respuestasRapidas || []).join('\n'))}</textarea>
      </div>
    </div>
    ${admin ? `<div class="igx-card"><div class="igx-card-tit">Mantenimiento</div>
        <p class="igx-nota mini">Arregla tus prendas importadas: quita de la descripción "10/10", "$VENDIDA", "NO DISPO", "Ofertas o trades" y promos de follow; quita los @ de los nombres y ordena las tallas con notas ("L · Queda como M").</p>
        <button class="igx-btn ghost" id="igLimpiarDesc" onclick="igLimpiarDescripciones()">Limpiar prendas importadas</button>
        <p class="igx-nota mini" style="margin-top:14px">Revisa que el post de cada prenda siga existiendo en Instagram. Si alguno lo borraste desde la app, la prenda se desliga para que puedas volver a publicarla.</p>
        <button class="igx-btn ghost" id="igVerificar" onclick="igVerificarPosts()">Verificar que los posts sigan vivos</button></div>` : ''}
    ${admin ? `<button class="igx-btn grad grande" id="igGuardarCfg" onclick="igGuardarConfig()">Guardar ajustes</button>` : '<p class="igx-nota">Solo un administrador del bazar puede cambiar esto.</p>'}`;
}

// Cambia el tono en la vista previa; se guarda con "Guardar ajustes".
function igTono(k) {
  if (!IG_TONOS[k]) return;
  IG.tonoTmp = k;
  document.querySelectorAll('.igx-tono').forEach(b => b.classList.toggle('on', b.getAttribute('onclick') === `igTono('${k}')`));
  const muestra = igPrendas().find(p => !p.vendido && p.imagenes?.[0]?.includes('res.cloudinary.com'));
  const imgs = document.querySelectorAll('#igMuestras img');
  if (muestra && imgs.length === 2) {
    imgs[0].src = igPlantillaPreview(muestra.imagenes[0], muestra, k);
    imgs[1].src = igPlantillaPreview(muestra.imagenes[0], { ...muestra, vendido: true }, k);
  }
}

async function igGuardarConfig() {
  const v = id => document.getElementById(id);
  const body = {
    autoPublicar: !!v('igCfg_autoPublicar')?.checked, autoComentario: !!v('igCfg_autoComentario')?.checked,
    autoHistoria: !!v('igCfg_autoHistoria')?.checked, autoPortada: false,
    plantilla: !!v('igCfg_plantilla')?.checked, portadaSola: !!v('igCfg_portadaSola')?.checked, hashtagsInteligentes: !!v('igCfg_hashtagsInteligentes')?.checked, textoCorto: !!v('igCfg_textoCorto')?.checked, avisarCambios: !!v('igCfg_avisarCambios')?.checked, estiloTexto: v('igCfg_estiloTexto')?.value === 'emojis' ? 'emojis' : 'limpio', maxHashtags: Number(v('igCfg_maxHashtags')?.value ?? 5), mejorarFotos: !!v('igCfg_mejorarFotos')?.checked, tonoPlantilla: IG.tonoTmp || IG.estado?.config?.tonoPlantilla || 'crema',
    firma: v('igCfg_firma')?.value || '', hashtags: v('igCfg_hashtags')?.value || '',
    respuestasRapidas: (v('igCfg_rr')?.value || '').split('\n').map(x => x.trim()).filter(Boolean),
  };
  if ((body.hashtags.match(/#[^\s#]+/g) || []).length > 30) return toast('Máximo 30 hashtags en la lista (en cada post van máximo 5)');
  const btn = v('igGuardarCfg'); if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    const r = await igApi('ig-config', body);
    IG.estado.config = r.config; IG.tonoTmp = null;
    const b = igBazar(); if (b) b.instagramConfig = r.config;
    if (typeof prepararOpcionInstagram === 'function') prepararOpcionInstagram();
    toast('Ajustes guardados');
    if (typeof igBorrarTexto === 'function') ['cfg:firma', 'cfg:hashtags', 'cfg:rr'].forEach(igBorrarTexto);
  } catch (e) { toast(e.message); }
  if (btn) { btn.disabled = false; btn.textContent = 'Guardar ajustes'; }
}

document.addEventListener('input', e => {
  if (e.target?.id === 'igCfg_hashtags') {
    const n = document.getElementById('igHashCont');
    if (n) n.textContent = (e.target.value.match(/#[^\s#]+/g) || []).length;
  }
});


// ═════════════════════════════════════════════════════════════
//  IMPORTAR PRENDAS DESDE POSTS VIEJOS
//  Busca los posts que no tienen prenda, lee su texto (nombre, marca,
//  talla, estado, precio, vendida) y deja revisarlo antes de crear cada
//  prenda con las fotos del post. La prenda queda ligada a su post.
// ═════════════════════════════════════════════════════════════
const IMP = { lista: null, cats: [], sel: new Set(), oculto: false, corriendo: false, hecho: {}, error: {}, total: 0, ed: {} };

// Lo que corriges en Importar se guarda en este navegador mientras escribes:
// si cierras la ventana (o la página) por accidente, vuelve tal cual.
const IMP_LOCAL = 'stmp-ig-importar-v1';
function igImpGuardar() {
  try {
    if (!Object.keys(IMP.ed).length && !IMP.selTocada) return localStorage.removeItem(IMP_LOCAL);
    localStorage.setItem(IMP_LOCAL, JSON.stringify({ ed: IMP.ed, sel: IMP.selTocada ? [...IMP.sel] : null, oculto: IMP.oculto, en: Date.now() }));
  } catch {}
}
function igImpLeer() { try { return JSON.parse(localStorage.getItem(IMP_LOCAL) || 'null'); } catch { return null; } }
function igImpDescartar() {
  try { localStorage.removeItem(IMP_LOCAL); } catch {}
  IMP.ed = {}; IMP.selTocada = false; IMP.recuperado = 0;
  igImportarAbrir();
}

async function igImportarAbrir() {
  let m = document.getElementById('igImp');
  if (!m) {
    m = document.createElement('div');
    m.id = 'igImp'; m.className = 'igx-modal igx-imp-modal';
    m.addEventListener('click', e => { if (e.target === m && !IMP.corriendo) igImportarCerrar(); });
    document.body.appendChild(m);
  }
  const guardado = igImpLeer();
  Object.assign(IMP, { lista: null, sel: new Set(), hecho: {}, error: {}, corriendo: false, ed: guardado?.ed || {}, selTocada: !!guardado?.sel, recuperado: 0, recuperadoEn: guardado?.en });
  if (guardado) IMP.oculto = !!guardado.oculto;
  m.classList.add('open'); document.body.classList.add('igx-sin-scroll');
  igImportarPintar();
  try {
    const r = await igApi('ig-importar-lista');
    IMP.lista = r.lista || []; IMP.cats = r.categorias || []; IMP.total = r.total || 0;
    // Tus correcciones de la vez pasada
    IMP.lista.forEach(x => { const e = IMP.ed[x.media]; if (e) { Object.assign(x, e); IMP.recuperado++; } });
    // Selección: la que tenías; si no, las que traen nombre y precio
    if (guardado?.sel) { const hay = new Set(IMP.lista.map(x => x.media)); guardado.sel.forEach(id => hay.has(id) && IMP.sel.add(id)); }
    else IMP.lista.forEach(x => { if (x.nombre && x.precio) IMP.sel.add(x.media); });
  } catch (e) { IMP.lista = []; IMP.errorCarga = e.message; }
  igImportarPintar();
}
function igImportarCerrar() {
  if (IMP.corriendo) return;
  igImpGuardar();
  if (Object.keys(IMP.ed).length) toast('Tus cambios quedan guardados: al volver a abrir Importar siguen ahí');
  document.getElementById('igImp')?.classList.remove('open');
  document.body.classList.remove('igx-sin-scroll');
}

function igImportarPintar() {
  const m = document.getElementById('igImp'); if (!m) return;
  const L = IMP.lista;
  const pendientes = L ? L.filter(x => !IMP.hecho[x.media]) : [];
  const nSel = pendientes.filter(x => IMP.sel.has(x.media)).length;
  const fila = x => {
    const ok = IMP.hecho[x.media], err = IMP.error[x.media];
    const v = k => igEsc(x[k] ?? '');
    return `<div class="igx-imp-fila ${ok ? 'ok' : ''} ${err ? 'err' : ''}" data-m="${x.media}">
      <label class="igx-imp-chk">${ok ? I.check || '✓' : `<input type="checkbox" ${IMP.sel.has(x.media) ? 'checked' : ''} ${IMP.corriendo ? 'disabled' : ''} onchange="igImpSel('${x.media}', this.checked)">`}</label>
      <a class="igx-imp-foto" href="${igEsc(x.permalink)}" target="_blank" rel="noopener" title="Ver post">
        <img src="${igEsc(igPx(x.miniatura))}" alt="" loading="lazy" decoding="async">${x.fotos > 1 ? `<span>${x.fotos}</span>` : ''}</a>
      <div class="igx-imp-campos">
        <input class="igx-input n" value="${v('nombre')}" placeholder="Nombre de la prenda" oninput="igImpSet('${x.media}','nombre',this.value)" ${ok ? 'disabled' : ''}>
        <div class="igx-imp-g">
          <label>Precio<input class="igx-input" type="number" min="0" value="${v('precio')}" oninput="igImpSet('${x.media}','precio',this.value)" ${ok ? 'disabled' : ''}></label>
          <label>Talla<input class="igx-input" value="${v('talla')}" oninput="igImpSet('${x.media}','talla',this.value)" ${ok ? 'disabled' : ''}></label>
          <label>Estado<input class="igx-input" value="${v('estado')}" placeholder="9/10" oninput="igImpSet('${x.media}','estado',this.value)" ${ok ? 'disabled' : ''}></label>
          <label>Marca<input class="igx-input" value="${v('marca')}" oninput="igImpSet('${x.media}','marca',this.value)" ${ok ? 'disabled' : ''}></label>
          <label>Categoría<select class="igx-input" onchange="igImpSet('${x.media}','categoria',this.value)" ${ok ? 'disabled' : ''}>
            <option value="">—</option>${IMP.cats.map(c => `<option ${c === x.categoria ? 'selected' : ''}>${igEsc(c)}</option>`).join('')}</select></label>
          <label class="igx-imp-vend"><input type="checkbox" ${x.vendido ? 'checked' : ''} onchange="igImpSet('${x.media}','vendido',this.checked)" ${ok ? 'disabled' : ''}> Ya se vendió</label>
        </div>
        ${err ? `<small class="igx-imp-error">${igEsc(err)}</small>` : ok ? `<small class="igx-imp-listo">Importada como #${ok}</small>` : ''}
      </div>
    </div>`;
  };
  m.innerHTML = `<div class="igx-imp-caja" role="dialog" aria-modal="true" aria-labelledby="igImpTit">
    <header class="igx-imp-cab">
      <div><h3 id="igImpTit">Importar prendas desde Instagram</h3>
        <p>${L === null ? 'Leyendo tus publicaciones…'
          : IMP.errorCarga ? igEsc(IMP.errorCarga)
          : `Revisamos ${IMP.total} publicaciones: <b>${L.length}</b> no tienen prenda. Revisa lo que leímos del texto, corrige lo necesario e importa. <span class="igx-imp-guarda">Lo que escribes se guarda solo.</span>`}</p>
        ${IMP.recuperado ? `<p class="igx-imp-recup">Recuperamos tus cambios en <b>${IMP.recuperado}</b> publicación${IMP.recuperado === 1 ? '' : 'es'}${IMP.recuperadoEn ? ` (${igFecha(new Date(IMP.recuperadoEn).toISOString())})` : ''}. <button class="igx-link" onclick="igImpDescartar()">Descartar y empezar de cero</button></p>` : ''}</div>
      <button class="igx-cerrar" onclick="igImportarCerrar()" aria-label="Cerrar" ${IMP.corriendo ? 'disabled' : ''}>×</button>
    </header>
    ${L && L.length ? `<div class="igx-imp-barra">
      <label class="igx-opcion"><input type="checkbox" ${nSel && nSel === pendientes.length ? 'checked' : ''} onchange="igImpTodas(this.checked)" ${IMP.corriendo ? 'disabled' : ''}> Seleccionar todas</label>
      <label class="igx-opcion"><input type="checkbox" ${IMP.oculto ? 'checked' : ''} onchange="IMP.oculto=this.checked;igImpGuardar()" ${IMP.corriendo ? 'disabled' : ''}> Importarlas ocultas <small>(no salen en la tienda hasta que las muestres)</small></label>
    </div>` : ''}
    <div class="igx-imp-lista">
      ${L === null ? '<div class="igx-imp-cargando"><span class="igx-spin"></span> Buscando posts sin prenda…</div>'
        : !L.length ? `<div class="igx-vacio">${ico('listo', 18)} Todas tus publicaciones ya tienen su prenda.</div>`
        : L.map(fila).join('')}
    </div>
    ${L && L.length ? `<footer class="igx-imp-pie">
      ${IMP.corriendo ? `<div class="igx-progreso"><i style="width:${Math.round(100 * IMP.corriendo.hechos / IMP.corriendo.total)}%"></i></div>
        <span>${(() => { const c = IMP.corriendo, falta = c.total - c.hechos, seg = (Date.now() - c.inicio) / 1000, por = c.hechos ? seg / c.hechos : 8;
          return `<b>${c.hechos}</b> de ${c.total} · faltan <b>${falta}</b> · llevas ${igTiempo(seg)} · ≈ ${igTiempo(falta * por)} para terminar`; })()}</span>`
        : `<span>${nSel} seleccionada${nSel === 1 ? '' : 's'}</span>
           <button class="igx-btn grad" ${nSel ? '' : 'disabled'} onclick="igImportarCorrer()">${I.descargar} Importar ${nSel} prenda${nSel === 1 ? '' : 's'}</button>`}
    </footer>` : ''}
  </div>`;
}
const igImpItem = id => IMP.lista?.find(x => x.media === id);
let _impT = null;
function igImpSet(id, k, v) {
  const x = igImpItem(id); if (!x) return;
  x[k] = v; (IMP.ed[id] ||= {})[k] = v;
  clearTimeout(_impT); _impT = setTimeout(igImpGuardar, 300);
}
function igImpSel(id, on) { on ? IMP.sel.add(id) : IMP.sel.delete(id); IMP.selTocada = true; igImpGuardar(); igImportarPintarPie(); }
function igImpTodas(on) { IMP.lista.forEach(x => { if (!IMP.hecho[x.media]) on ? IMP.sel.add(x.media) : IMP.sel.delete(x.media); }); IMP.selTocada = true; igImpGuardar(); igImportarPintar(); }
function igImportarPintarPie() {
  // Solo actualiza el contador sin redibujar (no se pierde lo que se escribe)
  const n = IMP.lista.filter(x => !IMP.hecho[x.media] && IMP.sel.has(x.media)).length;
  const pie = document.querySelector('#igImp .igx-imp-pie');
  if (pie && !IMP.corriendo) {
    pie.querySelector('span').textContent = `${n} seleccionada${n === 1 ? '' : 's'}`;
    const b = pie.querySelector('button'); b.disabled = !n;
    b.innerHTML = `${I.descargar} Importar ${n} prenda${n === 1 ? '' : 's'}`;
  }
}

async function igImportarCorrer() {
  const cola = IMP.lista.filter(x => IMP.sel.has(x.media) && !IMP.hecho[x.media]);
  const sinNombre = cola.filter(x => !String(x.nombre || '').trim());
  if (sinNombre.length) return toast(`${sinNombre.length} prenda(s) no tienen nombre. Escríbelo o quítalas de la selección.`);
  // De la más vieja a la más nueva: así los números de prenda siguen el orden de tu perfil
  cola.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  IMP.corriendo = { total: cola.length, hechos: 0, inicio: Date.now() };
  igImportarPintar();
  let bien = 0;
  for (const x of cola) {
    delete IMP.error[x.media];
    try {
      const r = await igApi('ig-importar', { media: x.media, nombre: x.nombre, precio: x.precio, talla: x.talla, estado: x.estado,
        marca: x.marca, descripcion: x.descripcion, categoria: x.categoria, vendido: !!x.vendido, oculto: IMP.oculto });
      IMP.hecho[x.media] = r.prenda.id; IMP.sel.delete(x.media); bien++;
      delete IMP.ed[x.media]; igImpGuardar();
      try { const db = getDB(); if (Array.isArray(db) && !db.some(p => p.id === r.prenda.id)) db.unshift(r.prenda); } catch {}
    } catch (e) { IMP.error[x.media] = e.message || 'No se pudo importar'; }
    IMP.corriendo.hechos++; igImportarPintar();
  }
  IMP.corriendo = false; igImportarPintar();
  const malas = cola.length - bien;
  toast(malas ? `Listo: ${bien} importadas, ${malas} con error` : `¡Listo! ${bien} prenda(s) importadas`);
  if (typeof registrarLog === 'function' && bien) registrarLog('instagram', 'Importar prendas', `${bien} prenda(s) desde posts`);
  if (typeof pollAhora === 'function') pollAhora(400);
  if (typeof renderAll === 'function') renderAll();
  if (IG.vista === 'posts') igCargarPosts();
}

// ── Hashtags por prenda ──────────────────────────────────────
// Además de los generales del bazar, cada post lleva hashtags de SU prenda
// (marca, tipo de prenda, talla, género, estilo y ciudad): así lo encuentra
// gente que busca exactamente eso. Primero los personalizados de la prenda,
// luego los automáticos y al final los generales. Máximo 30 (límite de IG).
function igHashLimpio(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]/g, '');
}
const IG_HASH_CAT = [
  [/playera|tee|camiseta|jersey|polo/, ['playeras', 'playeravintage', 'vintagetee']],
  [/pantal|jean|cargo/, ['pantalones', 'jeansvintage', 'baggyjeans']],
  [/su[eé]ter|sudadera|hoodie|crewneck/, ['sudaderas', 'sudaderavintage', 'hoodievintage']],
  [/chamarra|jacket|chaqueta|rompevientos/, ['chamarras', 'chamarravintage', 'vintagejacket']],
  [/short/, ['shorts', 'shortsvintage']],
  [/lentes|gafas/, ['lentes', 'lentesdesol']],
  [/bolsa|mochila|bag/, ['bolsas', 'bolsavintage']],
  [/gorra|cap|beanie/, ['gorras', 'gorravintage']],
  [/tenis|sneaker|zapato/, ['tenis', 'sneakers']],
];
const IG_HASH_EST = [
  [/y2k/, 'y2k'], [/90s|noventa/, '90s'], [/80s/, '80s'], [/oversize/, 'oversize'], [/baggy/, 'baggy'],
  [/tour|band|concierto|rap|hip ?hop/, 'bandtee'], [/anime/, 'anime'], [/futbol|soccer|jersey/, 'jerseyfutbol'],
  [/skate/, 'skatewear'], [/gorpcore|outdoor|north face/, 'gorpcore'], [/workwear|carhartt|dickies/, 'workwear'],
];
// v53 · Igual que hashtagsPrenda/textoPublicacion del servidor (pruebas/v53-instagram.mjs revisa que coincidan)
const IG_MAX_HASHTAGS = 5;   // límite de Instagram desde dic 2025
function igHashtagsPrenda(prenda = {}, cfg = {}, bazar = {}, max) {
  const tope = Math.max(0, Math.min(IG_MAX_HASHTAGS, Number.isFinite(Number(max)) ? Number(max) : (Number.isFinite(Number(cfg.maxHashtags)) ? Number(cfg.maxHashtags) : IG_MAX_HASHTAGS)));
  if (!tope) return '';
  const ok = h => h && h.length > 1 && h.length <= 40;
  const propios = String(prenda.hashtags || '').split(/[\s,]+/).map(igHashLimpio).filter(ok);
  const generales = String(cfg.hashtags || '').split(/[\s,]+/).map(igHashLimpio).filter(ok);
  let orden;
  if (cfg.hashtagsInteligentes !== false) {
    const marca = igHashLimpio(prenda.marca);
    const conMarca = marca && !/^(sinmarca|generica|na)$/.test(marca);
    const tipo = [prenda.nombre, ...(Array.isArray(prenda.categorias) ? prenda.categorias : [])].join(' ').toLowerCase();
    const cat = (IG_HASH_CAT.find(([re]) => re.test(tipo)) || [null, []])[1];
    const estilos = IG_HASH_EST.filter(([re]) => re.test(`${tipo} ${String(prenda.descripcion || '').toLowerCase()} ${String(prenda.talla || '').toLowerCase()}`)).map(x => x[1]);
    const ciudad = igHashLimpio(bazar?.ubicacion);
    const talla = String(prenda.talla || '').split('·')[0].trim().split(/\s+/)[0];
    orden = [
      propios[0], conMarca ? marca : null, cat[1] || cat[0], ciudad ? 'ropa' + ciudad : generales[0], propios[1], 'vintagemexico',
      ...propios.slice(2), estilos[0], conMarca ? marca + 'vintage' : null, ...cat, ciudad, ...generales,
      talla ? 'talla' + igHashLimpio(talla) : null, 'streetwearmexico',
    ];
  } else {
    orden = [...propios, ...generales];
  }
  return [...new Set(orden.filter(ok))].slice(0, tope).map(h => '#' + h).join(' ');
}
const IG_RE_NUMERO = /\+?\d[\d\s().-]{8,}\d/g;
const IG_RE_CONTACTO = /whats\s*app|\bwhats\b|\bwsp\b|\bwpp\b|\bwasap\b|wa\.me|wa\.link|whatsapp\.com|\btel[eé]fono\b|\btel\s*[:.]|\bcel(?:ular)?\s*[:.]/i;
function igSinTelefonos(t) {
  const conTel = x => (String(x).match(IG_RE_NUMERO) || []).some(m => m.replace(/\D/g, '').length >= 10);
  return String(t || '').split('\n').map(linea => {
    const frases = linea.match(/[^.!?…]+(?:[.!?…]+|$)\s*/g) || [linea];
    return frases.filter(f => !IG_RE_CONTACTO.test(f) && !conTel(f)).join('').trimEnd();
  }).join('\n').replace(/[^\S\n]{2,}/g, ' ');
}
function igCortar(t, max) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max - 1).replace(/[\s,;:·-]+\S*$/, '') + '…';
}
function igOraciones(t, max) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  let out = '';
  for (const o of t.match(/[^.!?…]+[.!?…]+["»”)]*(?:\s|$)/g) || []) { if ((out + o).trim().length > max) break; out += o; }
  return out.trim() || igCortar(t, max);
}
function igResumenDesc(desc, max = 160) {
  const bloques = igSinTelefonos(desc).replace(/\r/g, '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  let texto = '', fallas = '', medidas = '';
  const vineta = l => /^\s*[•●▪◦*·✔✓-]\s*/.test(l);
  for (const b of bloques) {
    const lineas = b.split('\n').map(x => x.trim()).filter(Boolean);
    for (const l of lineas) {
      if (/^a considerar\s*:/i.test(l)) { fallas = fallas || l.replace(/^a considerar\s*:\s*/i, ''); continue; }
      if (/^📐/u.test(l)) { medidas = medidas || l.replace(/^📐\s*/u, ''); continue; }
    }
    if (texto) continue;
    const normal = lineas.filter(l => !vineta(l) && !/^a considerar\s*:/i.test(l) && !/^📐/u.test(l));
    if (normal.length) texto = normal.join(' ');
  }
  return { texto: igOraciones(texto, max), fallas: igCortar(fallas.replace(/\.$/, ''), 110), medidas: igCortar(medidas, 90) };
}
// v54 · estilo 'limpio' (sin emojis, con etiquetas) o 'emojis'
const IG_RE_EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu;
function igSinEmojis(t) { return String(t || '').replace(IG_RE_EMOJI, '').split('\n').map(l => l.replace(/[^\S\n]{2,}/g, ' ').trim()).join('\n'); }
function igTextoPublicacion(p = {}, cfg = {}, bazar = {}) {
  const pesos = n => `$${Number(n).toLocaleString('es-MX')}`;
  const limpio = cfg.estiloTexto !== 'emojis', corto = cfg.textoCorto !== false;
  const precio = Number(p.precio_venta), antes = Number(p.precioAnterior);
  const rebaja = antes > precio ? ` (antes ${pesos(antes)})` : '';
  const r = igResumenDesc(p.descripcion);
  const conPunto = t => (/[.!?…]$/.test(t) ? t : t + '.');
  let datos, cuerpo;
  if (limpio) {
    datos = [`Precio: ${pesos(precio)} MXN${rebaja}`, p.marca ? `Marca: ${p.marca}` : null, p.talla ? `Talla: ${p.talla}` : null,
      p.estado ? `Estado: ${p.estado}` : null, corto && r.medidas ? `Medidas: ${r.medidas}` : null];
    cuerpo = corto
      ? [r.texto ? `\n${r.texto}` : null, r.fallas ? `A considerar: ${conPunto(r.fallas)}` : null]
      : [p.descripcion ? `\n${igSinTelefonos(p.descripcion).replace(/^[^\S\n]*📐[^\S\n]*/gmu, 'Medidas: ').trim()}` : null];
  } else if (corto) {
    datos = [`💸 ${pesos(precio)} MXN${rebaja}`,
      [p.marca ? `🏷️ ${p.marca}` : null, p.talla ? `📏 Talla ${p.talla}` : null, p.estado ? `✨ ${p.estado}` : null].filter(Boolean).join(' · ') || null,
      r.medidas ? `📐 ${r.medidas}` : null];
    cuerpo = [r.texto ? `\n${r.texto}` : null, r.fallas ? `⚠️ A considerar: ${r.fallas}` : null];
  } else {
    datos = [p.marca ? `🏷️ Marca: ${p.marca}` : null, p.talla ? `📏 Talla: ${p.talla}` : null, p.estado ? `✨ Estado: ${p.estado}` : null, `💸 Precio: ${pesos(precio)} MXN${rebaja}`];
    cuerpo = [p.descripcion ? `\n${igSinTelefonos(p.descripcion).trim()}` : null];
  }
  const lineas = [p.nombre, '', ...datos, ...cuerpo, '', cfg.firma || null,
    bazar?._pagos ? (limpio ? bazar._pagos : `💳 ${bazar._pagos}`) : null,
    limpio ? `Disponible en stiimpys.store/p/${p.id} (link en bio)` : `🛒 Apártala en stiimpys.store/p/${p.id} (link en bio)`, '', igHashtagsPrenda(p, cfg, bazar) || null];
  const out = lineas.filter(l => l !== null).join('\n');
  return (limpio ? igSinEmojis(out) : out).replace(/\n{3,}/g, '\n\n').trim().slice(0, 2200);
}
// v55 · El bazar con la línea de formas de pago (viene de ig-estado; la fuente es Ventas → Promociones y pagos)
function igBazarTexto() { return { ...(igBazar() || {}), _pagos: IG.estado?.pagos || '' }; }
// Para posts que ya están publicados: Instagram no deja cambiar el texto por API sin
// volver a publicar, pero sí a mano en la app (sin perder likes). Se copia el texto nuevo.
function igCopiarTextoNuevo(id) {
  const p = getDB().find(x => Number(x.id) === Number(id)); if (!p) return toast('No encontré la prenda');
  Promise.resolve(Avisos.copiar(igTextoPublicacion(p, IG.estado?.config || {}, igBazarTexto()), { que: 'Texto' }))
    .then(listo => { if (listo) toast('Pégalo en Instagram: ⋯ → Editar → borra el texto viejo, pega y ✓', { tipo: 'info', dur: 7000 }); });
}

async function igLimpiarDescripciones() {
  const b = document.getElementById('igLimpiarDesc');
  if (b) { b.disabled = true; b.textContent = 'Limpiando…'; }
  try {
    const r = await igApi('ig-limpiar-descripciones', {});
    toast(r.cambiadas ? `Listo: ${r.cambiadas} de ${r.revisadas} prendas corregidas` : 'Todas las prendas importadas ya estaban limpias');
    if (typeof pollAhora === 'function') pollAhora(400);
  } catch (e) { toast(e.message); }
  if (b) { b.disabled = false; b.textContent = 'Limpiar prendas importadas'; }
}

async function igVerificarPosts() {
  const b = document.getElementById('igVerificar');
  if (b) { b.disabled = true; b.textContent = 'Revisando posts…'; }
  try {
    const r = await igApi('ig-verificar-posts', {});
    if (!r.muertos.length) toast(`Todo bien: los ${r.revisadas} posts ligados siguen vivos`);
    else uiConfirm({ titulo: `${r.muertos.length} post(s) ya no existen`, ok: 'Entendido',
      mensaje: 'Se desligaron de su prenda: ' + r.muertos.map(m => `${m.nombre}${m.vendido ? ' (vendida)' : ''}`).join(', ')
        + '. Las disponibles las puedes volver a publicar desde su ficha.' });
    if (typeof pollAhora === 'function') pollAhora(400);
  } catch (e) { toast(e.message); }
  if (b) { b.disabled = false; b.textContent = 'Verificar que los posts sigan vivos'; }
}
