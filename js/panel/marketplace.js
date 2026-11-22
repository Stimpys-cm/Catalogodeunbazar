// js/marketplace.js
// ═══════════════════════════════════════════════════════════════
//  Asistente de Facebook Marketplace
//
//  Meta no deja que ninguna app publique sola en Marketplace (no hay API
//  para vendedores pequeños), así que aquí se hace lo siguiente mejor:
//    1. Un "kit" por prenda: fotos listas para guardar (la primera cuadrada
//       para que se vea completa en la cuadrícula), y título, precio,
//       descripción, SKU y etiquetas listos para copiar y pegar.
//    2. El control de qué está publicado allá: qué falta publicar, qué
//       conviene renovar, a qué le cambiaste el precio y qué se vendió pero
//       sigue disponible en Marketplace.
//  Funciona igual en celular (las fotos van a la galería) y en computadora
//  (se descargan).
// ═══════════════════════════════════════════════════════════════

const MP = { filtro: 'sin', busca: '', id: null, archivos: null, preparando: null, conLink: false, guardando: false };
const MP_DIAS_RENOVAR = 7;
const MP_URL_CREAR = 'https://www.facebook.com/marketplace/create/item';
const MP_URL_MIS   = 'https://www.facebook.com/marketplace/you/selling';

const IC_MP = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 9 5 4h14l1.5 5"/><path d="M3.5 9v.5a2.8 2.8 0 0 0 5.67 0V9m0 .5a2.8 2.8 0 0 0 5.66 0V9m0 .5a2.8 2.8 0 0 0 5.67 0V9"/><path d="M5 12.5V20h14v-7.5"/><path d="M10 20v-4.5h4V20"/></svg>';
const MPI = {
  bajar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>',
  ext:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
  ok:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  buscar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
};

const mpEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mpNum = n => Number(n || 0).toLocaleString('es-MX');
const mpEsIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const mpEsperar = ms => new Promise(r => setTimeout(r, ms));

function mpPrendas() {
  const todas = typeof prendasVisibles === 'function' ? prendasVisibles() : (getDB() || []);
  return todas.filter(p => Array.isArray(p.imagenes) && p.imagenes.length);
}
const mpPrenda = id => (getDB() || []).find(x => Number(x.id) === Number(id));

function mpDias(iso) {
  const d = new Date(iso); if (isNaN(d)) return 0;
  return Math.floor((Date.now() - d) / 864e5);
}
function mpHace(iso) {
  const n = mpDias(iso);
  return n <= 0 ? 'hoy' : n === 1 ? 'ayer' : `hace ${n} días`;
}

// Estado de una prenda respecto a Marketplace:
//   sin      disponible y todavía no publicada allá
//   activa   publicada y al día
//   renovar  publicada hace más de una semana
//   precio   le cambiaste el precio y allá sigue el anterior
//   vender   se vendió, pero en Marketplace sigue como disponible
//   cerrada  vendida y ya marcada allá     ·  fuera  oculta / vendida sin publicar
function mpEstado(p) {
  const m = p?.marketplace || {};
  if (p.vendido) return m.publicadoEn ? (m.vendidoMarcadoEn ? 'cerrada' : 'vender') : 'fuera';
  if (p.oculto) return 'fuera';
  if (!m.publicadoEn || m.vendidoMarcadoEn) return 'sin';
  if (m.precio != null && Number(m.precio) !== Number(p.precio_venta)) return 'precio';
  if (mpDias(m.renovadoEn || m.publicadoEn) >= MP_DIAS_RENOVAR) return 'renovar';
  return 'activa';
}
const MP_ESTADOS = {
  sin:     { txt: 'Sin publicar',      accion: 'Preparar publicación', titulo: 'Preparar para Marketplace' },
  activa:  { txt: 'En Marketplace',    accion: 'Ver detalles',         titulo: 'En Marketplace' },
  renovar: { txt: 'Renovar',           accion: 'Renovar',              titulo: 'Renovar en Marketplace' },
  precio:  { txt: 'Precio cambió',     accion: 'Actualizar precio',    titulo: 'Actualizar precio en Marketplace' },
  vender:  { txt: 'Vendida · márcala', accion: 'Marcar vendida',       titulo: 'Marcar vendida en Marketplace' },
};

// ── Textos para copiar ───────────────────────────────────────
const mpTalla = p => String(p.talla || '').trim();
const mpTallaCorta = p => mpTalla(p).split('·')[0].trim();

function mpTitulo(p) {
  let t = String(p.nombre || '').trim();
  if (p.marca && !t.toLowerCase().includes(String(p.marca).toLowerCase())) t += ` ${p.marca}`;
  const talla = mpTallaCorta(p);
  if (talla && !/\btalla\b/i.test(t)) t += ` · Talla ${talla}`;
  return t.slice(0, 99);
}
// Las opciones de "Estado" que ofrece Marketplace
function mpCondicion(e) {
  const s = String(e || '').toLowerCase().trim();
  if (s.startsWith('nuev')) return 'Nuevo';
  const n = parseInt(s, 10);
  if (n >= 9) return 'Usado - Como nuevo';
  if (n >= 7) return 'Usado - Buen estado';
  if (n > 0 || s.includes('desgaste')) return 'Usado - Aceptable';
  return 'Usado - Buen estado';
}
function mpCategoria(p) {
  const txt = [p.nombre, ...(Array.isArray(p.categorias) ? p.categorias : [])].join(' ').toLowerCase();
  const talla = mpTalla(p).toLowerCase();
  if (/gorra|lentes|cintur[oó]n|cartera|reloj|collar|pulsera|joy|accesorio/.test(txt)) return 'Joyería y accesorios';
  if (/bolsa|mochila|maleta|backpack|bolso/.test(txt)) return 'Bolsos y equipaje';
  if (/mujer|dama|vestido|falda|blusa/.test(`${txt} ${talla}`) || /^(1|3|5|7|9|11|13|15)$/.test(mpTallaCorta(p))) return 'Ropa y calzado de mujer';
  return 'Ropa y calzado de hombre';
}
function mpDescripcion(p, conLink) {
  const b = typeof bazarDePrenda === 'function' ? bazarDePrenda(p.bazarId) : null;
  const l = [String(p.nombre || '').trim(), ''];
  if (p.marca)  l.push(`• Marca: ${p.marca}`);
  if (p.talla)  l.push(`• Talla: ${p.talla}`);
  if (p.estado) l.push(`• Estado: ${p.estado}`);
  const propia = String(p.descripcion || '').trim();
  if (propia) l.push('', propia);
  l.push('', String(b?.instagramConfig?.firma || '📦 Envíos a todo México').trim());
  l.push('💬 Mándame mensaje para apartarla');
  if (conLink) l.push(`🛍️ Más prendas en ${location.host}/prenda.html?id=${p.id}`);
  return l.join('\n');
}
function mpEtiquetas(p) {
  const base = [p.marca, ...(Array.isArray(p.categorias) ? p.categorias : []), 'ropa', 'vintage', 'streetwear', 'segunda mano'];
  const vistas = new Set();
  return base.map(x => String(x || '').trim().toLowerCase()).filter(x => x && x.length <= 30 && !vistas.has(x) && vistas.add(x)).slice(0, 10);
}

// ── Fotos ────────────────────────────────────────────────────
// Marketplace muestra las fotos cuadradas en la cuadrícula: la portada se
// arma a 1:1 con la prenda completa para que no se corte. Las demás van tal
// cual (hasta 1600 px).
function mpSlug(s) {
  return String(s || 'prenda').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'prenda';
}
function mpFotos(p) {
  const slug = mpSlug(p.nombre);
  return (p.imagenes || []).filter(Boolean).slice(0, 10).map((u, i) => {
    const m = typeof u === 'string' && u.includes('res.cloudinary.com') && u.includes('/upload/')
      ? u.match(/\/upload\/(?:[^/]*[_,:][^/]*\/)*(?:v\d+\/)?(.+?)\.[a-z0-9]+$/i) : null;
    const nombre = `${slug}-${i + 1}.jpg`;
    if (!m) return { url: u, vista: u, nombre, portada: i === 0 };
    const base = u.split('/upload/')[0] + '/upload/';
    // Portada: la foto completa al centro sobre una copia suya difuminada,
    // así los lados no quedan como franjas lisas.
    const t = i === 0
      ? `c_fill,w_1080,h_1080,g_auto/e_blur:1500/e_brightness:-6/l_${m[1].replace(/\//g, ':')}/c_fit,w_1080,h_1080/fl_layer_apply`
      : 'c_limit,w_1600,h_1600';
    return {
      url:   `${base}${t}/f_jpg,q_90/${m[1]}.jpg`,
      vista: `${base}${i === 0 ? `${t}/c_scale,w_360` : 'c_fill,w_240,h_300,g_auto'}/f_auto,q_auto/${m[1]}.jpg`,
      nombre, portada: i === 0,
    };
  });
}
// Se preparan en cuanto se abre el kit: en iPhone el menú de compartir solo
// se abre si se llama justo al tocar el botón, sin esperar descargas.
function mpPrepararArchivos(p) {
  const id = p.id;
  MP.archivos = null;
  MP.preparando = Promise.all(mpFotos(p).map(async f => {
    const r = await fetch(f.url, { mode: 'cors' });
    if (!r.ok) throw new Error('No se pudo bajar una foto');
    return new File([await r.blob()], f.nombre, { type: 'image/jpeg' });
  })).then(files => {
    if (MP.id === id) { MP.archivos = files; mpBotonFotos(); }
    return files;
  }).catch(() => { if (MP.id === id) { MP.archivos = []; mpBotonFotos(); } return []; });
}
function mpBotonFotos() {
  const b = document.getElementById('mpBtnFotos'); if (!b) return;
  const n = mpFotos(mpPrenda(MP.id) || {}).length;
  if (MP.archivos === null) { b.disabled = true; b.innerHTML = '<span class="igx-spin blanco"></span> Preparando fotos…'; return; }
  b.disabled = false;
  b.innerHTML = `${MPI.bajar} ${mpEsIOS() ? `Guardar ${n} foto${n === 1 ? '' : 's'} en el carrete` : `Descargar ${n} foto${n === 1 ? '' : 's'}`}`;
}
async function mpGuardarFotos() {
  const p = mpPrenda(MP.id); if (!p) return;
  const files = MP.archivos || [];
  try {
    if (files.length && mpEsIOS() && navigator.canShare?.({ files })) {
      await navigator.share({ files });            // → «Guardar imágenes»
      return;
    }
    if (!files.length) throw new Error('sin archivos');
    for (const f of files) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f); a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      await mpEsperar(350);
    }
    toast(files.length > 1 ? `${files.length} fotos descargadas` : 'Foto descargada');
  } catch (e) {
    if (e?.name === 'AbortError') return;
    toast(mpEsIOS() ? 'Mantén presionada cada foto y elige «Guardar en Fotos»' : 'Abre cada foto y guárdala con clic derecho');
  }
}

// ── Copiar ───────────────────────────────────────────────────
async function mpCopiarTexto(texto, btn) {
  try { await navigator.clipboard.writeText(texto); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = texto; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  if (btn) {
    btn.classList.add('ok');
    const antes = btn.dataset.txt || btn.innerHTML; btn.dataset.txt = antes;
    btn.innerHTML = `${MPI.ok} Copiado`;
    clearTimeout(btn._t); btn._t = setTimeout(() => { btn.classList.remove('ok'); btn.innerHTML = antes; }, 1600);
  }
}
function mpCopiar(campo, btn) {
  const p = mpPrenda(MP.id); if (!p) return;
  const t = { titulo: mpTitulo(p), precio: String(Math.round(Number(p.precio_venta) || 0)), descripcion: mpDescripcion(p, MP.conLink), sku: `STMP-${p.id}` }[campo];
  if (t != null) mpCopiarTexto(t, btn);
}

// ═════════════════════════════════════════════════════════════
//  PESTAÑA
// ═════════════════════════════════════════════════════════════
function mpAbrir() { mpRender(); }

function mpGrupos() {
  const g = { sin: [], activas: [], pendientes: [], vender: [] };
  for (const p of mpPrendas()) {
    const e = mpEstado(p);
    if (e === 'sin') g.sin.push(p);
    if (e === 'activa' || e === 'renovar' || e === 'precio') g.activas.push(p);
    if (e === 'renovar' || e === 'precio') g.pendientes.push(p);
    if (e === 'vender') g.vender.push(p);
  }
  const ref = p => new Date(p.marketplace?.renovadoEn || p.marketplace?.publicadoEn || 0);
  g.sin.sort((a, b) => b.id - a.id);
  g.activas.sort((a, b) => ref(a) - ref(b));
  g.pendientes.sort((a, b) => ref(a) - ref(b));
  g.vender.sort((a, b) => new Date(b.vendidoEn || 0) - new Date(a.vendidoEn || 0));
  return g;
}

function mpRender() {
  const raiz = document.getElementById('mpRaiz'); if (!raiz) return;
  mpActualizarGlobo();
  const g = mpGrupos();
  const FILTROS = [
    ['sin', 'Sin publicar', g.sin, 'Disponibles que aún no subes'],
    ['activas', 'En Marketplace', g.activas, 'Publicadas y disponibles'],
    ['pendientes', 'Por renovar', g.pendientes, 'Más de 7 días o precio distinto'],
    ['vender', 'Vendidas por marcar', g.vender, 'Siguen disponibles allá'],
  ];
  if (!FILTROS.some(f => f[0] === MP.filtro)) MP.filtro = 'sin';
  const q = MP.busca.trim().toLowerCase();
  const lista = (FILTROS.find(f => f[0] === MP.filtro)[2])
    .filter(p => !q || `${p.nombre} ${p.marca || ''} ${p.talla || ''}`.toLowerCase().includes(q));
  const VACIO = {
    sin: 'Todo tu inventario disponible ya está en Marketplace.',
    activas: 'Todavía no marcas ninguna prenda como publicada en Marketplace.',
    pendientes: 'Nada que renovar por ahora. Todo está al día.',
    vender: 'No hay prendas vendidas pendientes de marcar en Marketplace.',
  };

  raiz.innerHTML = `
    <div class="mpx">
      <div class="igx-kpis mpx-kpis">
        ${FILTROS.map(([k, t, arr, d]) => `
          <button class="igx-kpi mpx-kpi ${MP.filtro === k ? 'on' : ''} ${k === 'vender' && arr.length ? 'alerta' : ''}" onclick="mpFiltro('${k}')">
            <span>${t}</span><b>${arr.length}</b><small>${d}</small>
          </button>`).join('')}
      </div>

      <div class="mpx-barra">
        <label class="mpx-buscar">${MPI.buscar}<input type="search" placeholder="Buscar prenda…" value="${mpEsc(MP.busca)}"
          oninput="MP.busca=this.value;mpRenderLista()" aria-label="Buscar prenda"></label>
        <a class="igx-btn ghost" href="${MP_URL_MIS}" target="_blank" rel="noopener">${MPI.ext} Mis publicaciones</a>
      </div>

      <div id="mpLista">${mpHtmlLista(lista, VACIO[MP.filtro])}</div>

      <div class="igx-card mpx-consejos">
        <div class="igx-card-tit">Para vender más en Marketplace</div>
        <div class="mpx-consejos-grid">
          <div><b>Llega a tus grupos</b><p>Antes de publicar, en «Publicar en más lugares» elige tus grupos de compra-venta. Así una sola publicación aparece en varios grupos.</p></div>
          <div><b>Renueva cada semana</b><p>Lo que lleva días sin moverse se va quedando abajo. Aquí te avisamos qué renovar o a qué bajarle un poco el precio.</p></div>
          <div><b>Portada clara</b><p>La primera foto es la que se ve en la cuadrícula: el kit la deja cuadrada para que la prenda se vea completa.</p></div>
          <div><b>Contesta rápido</b><p>Marketplace muestra qué tan rápido respondes. Ten a la mano tus respuestas rápidas de Instagram.</p></div>
        </div>
      </div>
    </div>`;
}
function mpRenderLista() {
  const cont = document.getElementById('mpLista'); if (!cont) return mpRender();
  // Solo se redibuja la lista para no perder el foco del buscador
  const g = mpGrupos();
  const arr = { sin: g.sin, activas: g.activas, pendientes: g.pendientes, vender: g.vender }[MP.filtro] || [];
  const q = MP.busca.trim().toLowerCase();
  cont.innerHTML = mpHtmlLista(arr.filter(p => !q || `${p.nombre} ${p.marca || ''} ${p.talla || ''}`.toLowerCase().includes(q)), 'Ninguna prenda coincide con tu búsqueda.');
}
function mpFiltro(k) { MP.filtro = k; mpRender(); }

function mpHtmlLista(lista, vacio) {
  if (!lista.length) return `<div class="igx-vacio mpx-vacio">${mpEsc(vacio)}</div>`;
  return `<div class="mpx-grid">${lista.map(p => {
    const e = mpEstado(p), info = MP_ESTADOS[e] || MP_ESTADOS.activa, m = p.marketplace || {};
    const foto = (typeof igMini === 'function' ? igMini(p.imagenes[0], 360) : p.imagenes[0]);
    const nota = e === 'sin' ? (p.creadoEn ? `Subida ${mpHace(p.creadoEn)}` : 'Lista para publicar')
      : e === 'precio' ? `Allá: $${mpNum(m.precio)} → ahora $${mpNum(p.precio_venta)}`
      : e === 'vender' ? `Vendida ${mpHace(p.vendidoEn)}`
      : `${m.renovadoEn ? 'Renovada' : 'Publicada'} ${mpHace(m.renovadoEn || m.publicadoEn)}`;
    return `
      <article class="mpx-item est-${e}">
        <button class="mpx-foto" onclick="mpAbrirKit(${p.id})" aria-label="${mpEsc(info.titulo)}: ${mpEsc(p.nombre)}">
          <img src="${mpEsc(foto)}" alt="" loading="lazy">
          <span class="mpx-pill">${info.txt}</span>
        </button>
        <div class="mpx-info">
          <b>${mpEsc(p.nombre)}</b>
          <span>${mpTallaCorta(p) ? `Talla ${mpEsc(mpTallaCorta(p))} · ` : ''}<i>$${mpNum(p.precio_venta)}</i></span>
          <small>${mpEsc(nota)}</small>
        </div>
        <button class="igx-btn ${e === 'activa' ? 'ghost' : 'grad'} mini mpx-accion" onclick="mpAbrirKit(${p.id})">${info.accion}</button>
      </article>`;
  }).join('')}</div>`;
}

// ═════════════════════════════════════════════════════════════
//  KIT DE PUBLICACIÓN (modal)
// ═════════════════════════════════════════════════════════════
function mpAbrirKit(id) {
  const p = mpPrenda(id); if (!p) return;
  MP.id = p.id; MP.conLink = false;
  let modal = document.getElementById('mpModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'mpModal';
    modal.className = 'igx-modal mpx-modal';
    modal.addEventListener('click', e => { if (e.target === modal) mpCerrar(); });
    document.body.appendChild(modal);
  }
  if (mpEstado(p) === 'sin') mpPrepararArchivos(p); else { MP.archivos = null; MP.preparando = null; }
  mpPintarKit();
  modal.classList.add('open');
  document.body.classList.add('igx-sin-scroll');
}
function mpCerrar() {
  document.getElementById('mpModal')?.classList.remove('open');
  document.body.classList.remove('igx-sin-scroll');
  MP.id = null; MP.archivos = null;
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('mpModal')?.classList.contains('open')) mpCerrar(); });

function mpPintarKit() {
  const modal = document.getElementById('mpModal'); const p = mpPrenda(MP.id);
  if (!modal || !p) return;
  const e = mpEstado(p), m = p.marketplace || {};
  const linkPub = m.url || MP_URL_MIS;
  let cuerpo = '';

  if (e === 'vender') {
    cuerpo = `
      <div class="mpx-aviso rojo"><b>Ya se vendió, pero en Marketplace sigue disponible.</b>
        Márcala como vendida allá para que no te sigan escribiendo por ella.</div>
      <div class="mpx-pasos">
        ${mpPaso(1, 'Abre tu publicación', `${m.url ? '' : 'Entra a «Tus publicaciones» y búscala.'}`,
          `<a class="igx-btn ghost" href="${mpEsc(linkPub)}" target="_blank" rel="noopener">${MPI.ext} ${m.url ? 'Abrir publicación' : 'Ir a mis publicaciones'}</a>`)}
        ${mpPaso(2, 'Toca «Marcar como vendido»', 'O bórrala si prefieres que ya no aparezca.',
          `<div class="mpx-fila"><button class="igx-btn grad" onclick="mpMarcar('vendida', this)">${MPI.ok} Ya la marqué como vendida</button>
           <button class="igx-btn ghost" onclick="mpMarcar('quitar', this)">La borré de Marketplace</button></div>`)}
      </div>`;
  } else if (e === 'sin') {
    cuerpo = mpHtmlKit(p) + `
      ${mpPaso(4, 'Marca que ya quedó publicada', 'Así llevamos el control y te avisamos cuándo renovarla o marcarla vendida.',
        `<input type="url" class="igx-input" id="mpLink" placeholder="Pega aquí el link de la publicación (opcional)" inputmode="url" autocomplete="off">
         <button class="igx-btn grad grande" onclick="mpMarcar('publicada', this)">${MPI.ok} Ya la publiqué</button>`)}
      </div>`;
  } else {
    const dias = mpDias(m.renovadoEn || m.publicadoEn);
    cuerpo = `
      ${e === 'precio' ? `<div class="mpx-aviso"><b>Cambiaste el precio:</b> en Marketplace sigue en $${mpNum(m.precio)} y aquí está en $${mpNum(p.precio_venta)}.
        Edítalo allá para que coincida.</div>`
      : e === 'renovar' ? `<div class="mpx-aviso"><b>Lleva ${dias} días sin renovarse.</b> Ábrela y toca «Renovar» si Facebook te lo ofrece,
        o bájale un poco el precio para darle un empujón.</div>`
      : `<div class="mpx-aviso ok"><b>Publicada ${mpHace(m.publicadoEn)}.</b>${m.renovadoEn ? ` Renovada ${mpHace(m.renovadoEn)}.` : ''} Todo al día.</div>`}
      <div class="mpx-fila">
        <a class="igx-btn ghost" href="${mpEsc(linkPub)}" target="_blank" rel="noopener">${MPI.ext} ${m.url ? 'Abrir publicación' : 'Ir a mis publicaciones'}</a>
        ${e === 'precio' ? `<button class="igx-btn grad" onclick="mpMarcar('precio', this)">${MPI.ok} Ya actualicé el precio</button>` : ''}
        ${e === 'renovar' ? `<button class="igx-btn grad" onclick="mpMarcar('renovada', this)">${MPI.ok} Ya la renové</button>` : ''}
      </div>
      ${m.url ? '' : `
        <div class="igx-sub">Link de la publicación</div>
        <div class="mpx-fila-input"><input type="url" class="igx-input" id="mpLink" placeholder="Pega el link para abrirla directo desde aquí" inputmode="url" autocomplete="off">
          <button class="igx-btn ghost" onclick="mpMarcar('link', this)">Guardar</button></div>`}
      <details class="mpx-mas"><summary>Volver a copiar los datos o las fotos</summary>${mpHtmlKit(p, true)}</div></details>
      <button class="igx-link mpx-quitar" onclick="mpMarcar('quitar', this)">Ya no está en Marketplace</button>`;
  }

  modal.innerHTML = `
    <div class="mpx-caja" role="dialog" aria-modal="true" aria-labelledby="mpTit">
      <header class="mpx-cab">
        <img src="${mpEsc(typeof igMini === 'function' ? igMini(p.imagenes[0], 120) : p.imagenes[0])}" alt="">
        <div><span class="mpx-eyebrow">${IC_MP} Marketplace · ${MP_ESTADOS[e]?.txt || ''}</span>
          <h3 id="mpTit">${mpEsc(p.nombre)}</h3>
          <p>${mpTallaCorta(p) ? `Talla ${mpEsc(mpTallaCorta(p))} · ` : ''}$${mpNum(p.precio_venta)} MXN</p></div>
        <button class="igx-cerrar" onclick="mpCerrar()" aria-label="Cerrar">×</button>
      </header>
      <div class="mpx-cuerpo">${cuerpo}</div>
    </div>`;
  if (e === 'sin' || MP.preparando) mpBotonFotos();
  // En "volver a copiar" las fotos se preparan solo si se abre esa sección
  modal.querySelector('details.mpx-mas')?.addEventListener('toggle', ev => {
    if (ev.target.open && !MP.preparando) { mpPrepararArchivos(p); mpBotonFotos(); }
  });
}

function mpPaso(n, titulo, texto, contenido) {
  return `<section class="mpx-paso"><span class="mpx-num">${n}</span><div class="mpx-paso-cuerpo">
    <h4>${titulo}</h4>${texto ? `<p>${texto}</p>` : ''}${contenido || ''}</div></section>`;
}

// Pasos 1-3: fotos, abrir Marketplace y copiar cada dato.
// (abre un <div class="mpx-pasos"> que cierra quien lo llama)
function mpHtmlKit(p, compacto = false) {
  const fotos = mpFotos(p);
  const ios = mpEsIOS();
  const campo = (k, etiqueta, valor, extra = '') => `
    <div class="mpx-campo">
      <div class="mpx-campo-cab"><span>${etiqueta}</span>
        <button class="mpx-copiar" onclick="mpCopiar('${k}', this)">Copiar</button></div>
      <div class="mpx-valor ${k === 'descripcion' ? 'largo' : ''}" id="mpVal_${k}">${extra || mpEsc(valor)}</div>
    </div>`;
  const elegir = (etiqueta, valor) => `
    <div class="mpx-campo elegir"><div class="mpx-campo-cab"><span>${etiqueta}</span><em>elígela en la lista</em></div>
      <div class="mpx-valor"><b>${mpEsc(valor)}</b></div></div>`;
  return `
    <div class="mpx-pasos ${compacto ? 'compacto' : ''}">
      ${mpPaso(1, 'Guarda las fotos',
        `La portada va cuadrada para que la prenda se vea completa en la cuadrícula de Marketplace.${ios ? ' También puedes mantener presionada una foto y elegir «Guardar en Fotos».' : ''}`,
        `<div class="mpx-fotos">${fotos.map(f => `
            <a class="mpx-mini ${f.portada ? 'portada' : ''}" href="${mpEsc(f.url)}" target="_blank" rel="noopener" title="${mpEsc(f.nombre)}">
              <img src="${mpEsc(f.vista)}" alt="" loading="lazy">${f.portada ? '<span>Portada</span>' : ''}</a>`).join('')}</div>
         <button class="igx-btn grad" id="mpBtnFotos" onclick="mpGuardarFotos()"></button>`)}
      ${mpPaso(2, 'Abre Marketplace', 'Elige «Crear publicación» → «Artículo en venta» y sube las fotos.',
        `<a class="igx-btn ghost" href="${MP_URL_CREAR}" target="_blank" rel="noopener">${MPI.ext} Abrir Marketplace</a>`)}
      ${mpPaso(3, 'Copia y pega cada dato', '',
        `<div class="mpx-campos">
          ${campo('titulo', 'Título', mpTitulo(p))}
          ${campo('precio', 'Precio', '', `$${mpNum(p.precio_venta)} <small>MXN</small>`)}
          <div class="mpx-campos-2">${elegir('Categoría', mpCategoria(p))}${elegir('Estado', mpCondicion(p.estado))}</div>
          ${campo('descripcion', 'Descripción', mpDescripcion(p, MP.conLink))}
          <label class="mpx-check"><input type="checkbox" ${MP.conLink ? 'checked' : ''} onchange="mpLinkTienda(this.checked)"> Agregar el link de la prenda en tu tienda</label>
          <div class="mpx-campos-2">
            ${campo('sku', 'SKU <small>(opcional)</small>', `STMP-${p.id}`)}
            <div class="mpx-campo"><div class="mpx-campo-cab"><span>Etiquetas <small>(toca para copiar)</small></span></div>
              <div class="mpx-tags">${mpEtiquetas(p).map(t => `<button onclick="mpCopiarTexto(${mpEsc(JSON.stringify(t))}, this)">${mpEsc(t)}</button>`).join('')}</div></div>
          </div>
        </div>
        <div class="mpx-tip"><b>Tip:</b> antes de publicar, en «Publicar en más lugares» elige tus grupos de compra-venta.</div>`)}`;
}
function mpLinkTienda(v) {
  MP.conLink = !!v;
  const p = mpPrenda(MP.id), el = document.getElementById('mpVal_descripcion');
  if (p && el) el.textContent = mpDescripcion(p, MP.conLink);
}

async function mpMarcar(accion, btn) {
  const p = mpPrenda(MP.id); if (!p || MP.guardando) return;
  if (accion === 'quitar' && typeof uiConfirm === 'function' &&
      !(await uiConfirm({ titulo: 'Quitar de Marketplace', mensaje: 'Solo se borra el registro en tu panel. Si sigue publicada en Facebook, bórrala también allá.', ok: 'Quitar' }))) return;
  const url = (document.getElementById('mpLink')?.value || '').trim();
  MP.guardando = true;
  const antes = btn?.innerHTML; if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    const r = await api(`/api/inventario-item?op=marketplace&id=${encodeURIComponent(p.id)}`, { method: 'POST', body: { accion, url: url || undefined } });
    if (r.marketplace) p.marketplace = r.marketplace; else delete p.marketplace;
    const msg = { publicada: '¡Listo! Quedó registrada en Marketplace', renovada: 'Renovación registrada', precio: 'Precio al día',
      vendida: 'Marcada como vendida en Marketplace', link: 'Link guardado', quitar: 'Quitada de Marketplace' }[accion];
    if (typeof registrarLog === 'function' && accion !== 'link') registrarLog('marketplace', p.nombre, msg);
    if (typeof playActionSound === 'function' && (accion === 'publicada' || accion === 'vendida')) playActionSound('ok');
    toast(msg);
    if (accion === 'link') mpPintarKit(); else mpCerrar();
    if (document.getElementById('mpRaiz') && !document.getElementById('view-marketplace')?.classList.contains('hidden')) mpRender();
    if (typeof renderInv === 'function') renderInv();
    mpActualizarGlobo();
  } catch (err) {
    toast(err.message || 'No se pudo guardar');
    if (btn) { btn.disabled = false; btn.innerHTML = antes; }
  } finally { MP.guardando = false; }
}

// Botón para la tarjeta de cada prenda en el inventario
function mpBotonPrenda(p) {
  if (!Array.isArray(p.imagenes) || !p.imagenes.length) return '';
  const e = mpEstado(p);
  if (e === 'fuera' || e === 'cerrada') return '';
  const info = MP_ESTADOS[e];
  const clase = e === 'sin' ? '' : e === 'activa' ? 'hecho' : 'hecho aviso';
  return `<button class="act-btn mp ${clase}" onclick="mpAbrirKit(${p.id})" title="${info.titulo}" aria-label="${info.titulo}">${IC_MP}</button>`;
}
// Total de pendientes (para el globito del menú)
function mpPendientes() {
  const g = mpGrupos();
  return g.vender.length + g.pendientes.length;
}
// Globito del menú: vendidas por marcar + por renovar / precio distinto
function mpActualizarGlobo() {
  const el = document.getElementById('mpGlobo'); if (!el) return;
  const n = mpPendientes();
  el.textContent = n; el.classList.toggle('hidden', !n);
}
window.addEventListener('db:ready', mpActualizarGlobo);
