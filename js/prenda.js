// js/prenda.js — página completa de la prenda (prenda.html?id=)

const WL_KEY_PP = 'bazar_wishlist';
const WA_POR_DEFECTO = '528995284602';

const pEsc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
// Precios en pesos mexicanos: el MXN va en pequeño junto al importe
const pMoney = n => '$' + Number(n || 0).toLocaleString('es-MX') + ' <span class="cur">MXN</span>';

let prenda   = null;
let fotos    = [];
let fotoIdx  = 0;

// ─── WISHLIST (mismo almacenamiento que la tienda) ───────────
function wlLista() {
  try { return JSON.parse(localStorage.getItem(WL_KEY_PP)) || []; }
  catch { return []; }
}
function wlGuardar(list) { localStorage.setItem(WL_KEY_PP, JSON.stringify(list)); }
function wlTiene(id) { return wlLista().some(i => String(i.id) === String(id)); }

function wlAlternar() {
  if (!prenda) return;
  const id = prenda._id || prenda.id;
  let list = wlLista();
  const i = list.findIndex(x => String(x.id) === String(id));

  if (i === -1) {
    list.push({
      id, nombre: prenda.nombre, talla: prenda.talla, estado: prenda.estado,
      precio_venta: prenda.precio_venta, marca: prenda.marca,
      imagenes: Array.isArray(prenda.imagenes) ? prenda.imagenes : [],
      bazarId: prenda.bazarId || 1,
    });
    aviso('❤️ Guardado en tu wishlist');
  } else {
    list.splice(i, 1);
    aviso('Eliminado de tu wishlist');
  }
  wlGuardar(list);
  const btn = document.getElementById('ppFav');
  if (btn) btn.classList.toggle('active', wlTiene(id));
}

let avisoTimer;
function aviso(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ─── GALERÍA ─────────────────────────────────────────────────
function verFoto(i) {
  fotoIdx = (i + fotos.length) % fotos.length;
  const img = document.getElementById('ppFoto');
  if (img) img.src = fotos[fotoIdx];
  document.querySelectorAll('.pp-thumb').forEach((t, n) => t.classList.toggle('active', n === fotoIdx));
  const c = document.getElementById('ppContador');
  if (c) c.textContent = fotoIdx + 1;
}
function cambiarFoto(d) { verFoto(fotoIdx + d); }

// Modal a pantalla completa
function abrirModal() {
  if (!fotos.length) return;
  document.getElementById('modImg').src = fotos[fotoIdx];
  document.getElementById('modalOv').classList.add('active');
  document.body.style.overflow = 'hidden';
  const multi = fotos.length > 1;
  document.getElementById('mPrev').style.display = multi ? 'flex' : 'none';
  document.getElementById('mNext').style.display = multi ? 'flex' : 'none';
}
function cerrarModal() {
  document.getElementById('modalOv')?.classList.remove('active');
  document.body.style.overflow = '';
}
function modalChg(d) {
  verFoto(fotoIdx + d);
  document.getElementById('modImg').src = fotos[fotoIdx];
}

// Lupa al pasar el mouse (solo con ratón)
function activarZoom() {
  const wrap = document.getElementById('ppZoom');
  const img  = document.getElementById('ppFoto');
  if (!wrap || !img || window.matchMedia('(hover: none)').matches) return;
  wrap.addEventListener('mousemove', e => {
    const r = wrap.getBoundingClientRect();
    img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
    img.style.transform = 'scale(2.2)';
  });
  wrap.addEventListener('mouseleave', () => {
    img.style.transform = 'scale(1)';
    img.style.transformOrigin = 'center center';
  });
}

// ─── TIEMPO ──────────────────────────────────────────────────
function haceCuanto(p) {
  const raw = p.creadoEn || p.createdAt || p.fecha;
  const t = raw ? new Date(raw).getTime() : NaN;
  if (isNaN(t)) return '';
  const dias = Math.floor((Date.now() - t) / 86400000);
  const hrs  = Math.floor((Date.now() - t) / 3600000);
  if (hrs < 1)  return 'Publicada hace unos minutos';
  if (hrs < 24) return `Publicada hace ${hrs} h`;
  if (dias < 30) return `Publicada hace ${dias} día${dias !== 1 ? 's' : ''}`;
  const meses = Math.floor(dias / 30);
  return `Publicada hace ${meses} mes${meses > 1 ? 'es' : ''}`;
}

// ─── TARJETAS DE LAS FILAS ───────────────────────────────────
function tarjeta(p) {
  const img = (Array.isArray(p.imagenes) && p.imagenes[0]) || '';
  const bz  = bazarDe(p);
  const talla = String(p.talla || '').split('·')[0].trim().replace(/\s*(Hombre|Mujer)\s*/i, '');
  return `<a class="h-card" href="prenda.html?id=${encodeURIComponent(p.id)}">
    <div class="h-card-img">
      ${img ? `<img src="${pEsc(img)}" alt="${pEsc(p.nombre)}" loading="lazy">`
            : `<div class="h-card-nophoto">Sin foto</div>`}
    </div>
    <div class="h-card-body">
      <div class="h-card-brand${p.marca ? '' : ' sin-marca'}">${pEsc(p.marca || 'Sin marca')}</div>
      <div class="h-card-name">${pEsc(p.nombre)}</div>
      <div class="h-card-foot">
        <span class="h-card-price">${pMoney(p.precio_venta)}</span>
        <span class="h-card-size">Talla ${pEsc(talla || '–')}</span>
      </div>
      ${bz ? `<div class="card-bazar-row"><span class="card-bazar" style="--bz-color:${pEsc(bz.color || '#2d6be4')}">@${pEsc(bz.slug)}</span></div>` : ''}
    </div>
  </a>`;
}

function pintarRail(id, items, seccionId) {
  const el  = document.getElementById(id);
  const sec = seccionId ? document.getElementById(seccionId) : null;
  if (!el) return;
  if (!items.length) { sec?.classList.add('hidden'); return; }
  sec?.classList.remove('hidden');
  el.innerHTML = items.map(tarjeta).join('');
}

// ─── FICHA ───────────────────────────────────────────────────
function pintarPrenda(p) {
  prenda = p;
  fotos  = Array.isArray(p.imagenes) ? p.imagenes.filter(Boolean) : [];
  fotoIdx = 0;

  const bz    = bazarDe(p);
  const color = (bz && bz.color) || '#2d6be4';
  const wa    = bz && bz.whatsapp ? String(bz.whatsapp).replace(/[^0-9]/g, '') : WA_POR_DEFECTO;
  const id    = p._id || p.id;

  // El color del bazar tiñe la página
  document.documentElement.style.setProperty('--bz-color', color);
  document.body.classList.add('pp-tema');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);

  document.title = `${p.nombre}${p.marca ? ' · ' + p.marca : ''} | STMP MARKET`;

  // Migas de pan
  const cats = Array.isArray(p.categorias) ? p.categorias : [];
  const crumbs = document.getElementById('ppCrumbs');
  if (crumbs) {
    crumbs.innerHTML =
      `<a href="inicio.html">Inicio</a><span>/</span>` +
      `<a href="tienda.html">Catálogo</a><span>/</span>` +
      (bz ? `<a href="tienda.html?bazar=${encodeURIComponent(bz.slug)}">${pEsc(bz.nombre)}</a><span>/</span>` : '') +
      (cats[0] ? `<a href="tienda.html?cat=${encodeURIComponent(cats[0])}">${pEsc(cats[0])}</a><span>/</span>` : '') +
      `<span class="pp-crumb-actual">${pEsc(p.nombre)}</span>`;
  }

  const waMsg = encodeURIComponent(
    `Hola! Me interesa: ${p.nombre}${p.talla ? ' · Talla ' + p.talla : ''} · $${p.precio_venta} MXN\n${location.href}`);
  const waUrl = `https://wa.me/${wa}?text=${waMsg}`;

  const tallaBase   = String(p.talla || '').split('·')[0].trim();
  const tallaExtras = String(p.talla || '').split('·').slice(1).map(x => x.trim()).filter(Boolean);

  const fichas = [
    ['Talla', tallaBase || '—'],
    tallaExtras.length ? ['Cómo queda', tallaExtras.join(' · ')] : null,
    ['Condición', p.estado || '—'],
    ['Marca', p.marca || 'Sin marca'],
    cats.length ? ['Categoría', cats.join(', ')] : null,
    ['Ubicación', (bz && bz.ubicacion) || 'Reynosa, Tamps.'],
    ['Disponibilidad', p.vendido ? 'Vendida' : 'Disponible · pieza única'],
  ].filter(Boolean);

  document.getElementById('ppContenido').innerHTML = `
    <div class="pp-galeria">
      <div class="pp-foto-wrap">
        ${fotos.length ? `
          <div class="pp-zoom" id="ppZoom">
            <img id="ppFoto" src="${pEsc(fotos[0])}" alt="${pEsc(p.nombre)}" onclick="abrirModal()">
          </div>
          ${fotos.length > 1 ? `
            <button class="pp-nav pp-prev" onclick="cambiarFoto(-1)" aria-label="Anterior">‹</button>
            <button class="pp-nav pp-next" onclick="cambiarFoto(1)" aria-label="Siguiente">›</button>` : ''}
          <span class="pp-contador"><span id="ppContador">1</span> / ${fotos.length}</span>
          <button class="pp-ampliar" onclick="abrirModal()">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>
            Ampliar
          </button>`
        : `<div class="pp-sin-foto">Sin foto</div>`}
      </div>
      ${fotos.length > 1 ? `<div class="pp-thumbs">${fotos.map((src, i) =>
        `<button class="pp-thumb ${i === 0 ? 'active' : ''}" onclick="verFoto(${i})">
           <img src="${pEsc(src)}" alt="Foto ${i + 1}" loading="lazy">
         </button>`).join('')}</div>` : ''}
    </div>

    <div class="pp-info">
      ${p.marca
        ? `<a class="pp-marca" href="tienda.html?marca=${encodeURIComponent(p.marca)}">${pEsc(p.marca)}</a>`
        : '<span class="pp-marca sin-marca">Sin marca</span>'}
      <h1 class="pp-nombre">${pEsc(p.nombre)}</h1>
      <div class="pp-meta">${pEsc(haceCuanto(p))}</div>

      <div class="pp-precio-fila">
        <span class="pp-precio">${pMoney(p.precio_venta)}</span>
        ${p.vendido ? `<span class="pp-vendida">Vendida</span>` : `<span class="pp-unica">Pieza única</span>`}
      </div>

      ${cats.length ? `<div class="pp-chips">${cats.map(c =>
        `<a class="pp-chip" href="tienda.html?cat=${encodeURIComponent(c)}">${pEsc(c)}</a>`).join('')}</div>` : ''}

      <div class="pp-acciones">
        <a class="pp-btn-wa" href="${waUrl}" target="_blank" rel="noopener">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 2.138.558 4.147 1.535 5.886L0 24l6.274-1.507A11.944 11.944 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.853 0-3.587-.5-5.084-1.367l-.361-.214-3.733.897.931-3.618-.235-.374A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
          Apartar por WhatsApp
        </a>
        <button class="pp-btn-fav ${wlTiene(id) ? 'active' : ''}" id="ppFav" onclick="wlAlternar()" aria-label="Guardar en wishlist">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
        <button class="pp-btn-share" onclick="compartir(this)">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Compartir
        </button>
      </div>

      ${bz ? `
        <a class="pp-bazar" href="tienda.html?bazar=${encodeURIComponent(bz.slug)}">
          ${(bz.logo || bz.portada)
            ? `<img class="pp-bazar-logo" src="${pEsc(bz.logo || bz.portada)}" alt="Logo de ${pEsc(bz.nombre)}">`
            : `<span class="pp-bazar-logo pp-bazar-inicial">${pEsc((bz.nombre || '?').charAt(0))}</span>`}
          <span class="pp-bazar-datos">
            <span class="pp-bazar-nombre">${pEsc(bz.nombre)}</span>
            <span class="pp-bazar-slug">@${pEsc(bz.slug)}</span>
          </span>
          <span class="pp-bazar-ver">Ver su bazar →</span>
        </a>` : ''}

      <div class="pp-ficha">
        <h2>Detalles de la prenda</h2>
        <dl>
          ${fichas.map(([k, v]) => `<div class="pp-dato"><dt>${pEsc(k)}</dt><dd>${pEsc(v)}</dd></div>`).join('')}
        </dl>
      </div>

      ${p.descripcion ? `
        <div class="pp-desc">
          <h2>Descripción</h2>
          <p>${pEsc(p.descripcion)}</p>
        </div>` : ''}

      <div class="pp-envio">
        <h2>Envío y entrega</h2>
        <ul>
          <li>Envíos a todo México con guía rastreable; el costo lo acuerdas con el bazar.</li>
          <li>Entrega en persona disponible en ${pEsc((bz && bz.ubicacion) || 'Reynosa, Tamps.')}.</li>
          <li>Se aparta hasta que el bazar confirme por WhatsApp.</li>
        </ul>
      </div>

      <div class="pp-aviso">
        <strong>Antes de apartar:</strong> es una prenda de segunda mano y se vende
        tal como se muestra. <b>No hay cambios, devoluciones ni garantía.</b>
        Pide todas las medidas y fotos que necesites por WhatsApp.
        <a href="terminos.html" target="_blank" rel="noopener">Ver términos</a>
      </div>
    </div>`;

  activarZoom();

  // Barra fija de compra en el celular
  const barra = document.getElementById('ppBarra');
  if (barra) {
    barra.hidden = false;
    document.getElementById('ppBarraPrecio').innerHTML = pMoney(p.precio_venta);
    document.getElementById('ppBarraNombre').textContent = p.nombre;
    document.getElementById('ppBarraWa').href = waUrl;
  }

  pintarRelacionadas(p, bz);
}

function compartir(btn) {
  const url = location.href;
  const orig = btn.innerHTML;
  if (navigator.share) {
    navigator.share({ title: prenda?.nombre || 'STMP MARKET', url }).catch(() => {});
    return;
  }
  navigator.clipboard.writeText(url).catch(() => {});
  btn.textContent = '✓ Link copiado';
  setTimeout(() => { btn.innerHTML = orig; }, 2000);
}

// ─── RELACIONADAS ────────────────────────────────────────────
function pintarRelacionadas(p, bz) {
  const otras = getDB().filter(x =>
    !x.vendido && !x.oculto && String(x.id) !== String(p.id));

  // Del mismo bazar
  if (bz) {
    const suyas = otras.filter(x => Number(x.bazarId || 1) === Number(bz.id)).slice(0, 10);
    document.getElementById('ppBazarNombre').textContent = bz.nombre;
    document.getElementById('ppBazarSub').textContent = `@${bz.slug}${bz.ubicacion ? ' · ' + bz.ubicacion : ''}`;
    const link = document.getElementById('ppBazarLink');
    if (link) link.href = `tienda.html?bazar=${encodeURIComponent(bz.slug)}`;
    pintarRail('ppRailBazar', suyas, 'ppSeccionBazar');
  }

  // Similares: misma categoría o misma marca
  const cats = Array.isArray(p.categorias) ? p.categorias : [];
  const similares = otras.filter(x =>
    (x.marca && p.marca && x.marca === p.marca) ||
    (Array.isArray(x.categorias) && x.categorias.some(c => cats.includes(c)))
  ).slice(0, 10);
  pintarRail('ppRailSimilares', similares, 'ppSeccionSimilares');

  // Lo más nuevo del catálogo
  const recientes = [...otras].sort((a, b) => {
    const ta = new Date(a.creadoEn || 0).getTime() || 0;
    const tb = new Date(b.creadoEn || 0).getTime() || 0;
    return tb - ta || (b.id || 0) - (a.id || 0);
  }).slice(0, 10);
  pintarRail('ppRailRecientes', recientes, 'ppSeccionRecientes');
}

// ─── NO ENCONTRADA ───────────────────────────────────────────
function prendaNoDisponible() {
  document.getElementById('ppContenido').innerHTML = `
    <div class="pp-vacio">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <h1>Esta prenda ya no está disponible</h1>
      <p>Puede que se haya vendido o que el bazar la haya quitado del catálogo.</p>
      <a class="h-btn h-btn-primary" href="tienda.html">Ver el catálogo</a>
    </div>`;
  document.title = 'Prenda no disponible | STMP MARKET';

  const recientes = getDB().filter(x => !x.vendido && !x.oculto).slice(0, 10);
  pintarRail('ppRailRecientes', recientes, 'ppSeccionRecientes');
}

// ─── INICIO ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('prendaSearchForm');
  if (form) form.addEventListener('submit', e => {
    e.preventDefault();
    const q = (document.getElementById('prendaSearch')?.value || '').trim();
    location.href = q ? `tienda.html?q=${encodeURIComponent(q)}` : 'tienda.html';
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') cerrarModal();
    if (!document.getElementById('modalOv')?.classList.contains('active')) return;
    if (e.key === 'ArrowLeft')  modalChg(-1);
    if (e.key === 'ArrowRight') modalChg(1);
  });

  document.getElementById('modalOv')?.addEventListener('click', e => {
    if (e.target.id === 'modalOv') cerrarModal();
  });

  await waitForDB();

  const buscado = new URLSearchParams(location.search).get('id');
  if (!buscado) return prendaNoDisponible();

  const p = getDB().find(x =>
    String(x.id) === String(buscado) || String(x._id) === String(buscado));

  if (!p || p.oculto) return prendaNoDisponible();
  pintarPrenda(p);
});

// Si el catálogo cambia mientras la página está abierta, se refresca
window.addEventListener('db:inventario', () => {
  if (!prenda) return;
  const actual = getDB().find(x => String(x.id) === String(prenda.id));
  if (actual) pintarPrenda(actual);
});
