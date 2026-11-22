// v42: misma forma que el servidor para /marca/:slug y /categoria/:slug
const pSlug = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’´`]/g, '').replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
// js/ficha.js — página completa de la prenda (prenda.html?id=)
// Nombre distinto a api/prenda.js a propósito: son archivos diferentes y
// tenerlos con el mismo nombre se presta a confundirlos al subirlos.

const WL_KEY_PP = 'bazar_wishlist';
const WA_POR_DEFECTO = '528995284602';

const pEsc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
// Precios en pesos mexicanos: el MXN va en pequeño junto al importe
const pMoney = n => '$' + Number(n || 0).toLocaleString('es-MX') + ' <span class="cur">MXN</span>';

// Oferta: precio anterior tachado + nuevo + % de descuento.
const pHayOferta = p => { const a = Number(p.precioAnterior); return a > 0 && a > Number(p.precio_venta); };
const pDescuento = p => Math.round((1 - Number(p.precio_venta) / Number(p.precioAnterior)) * 100);
const pPrecioHTML = p => pHayOferta(p)
  ? `<span class="of-antes">$${Number(p.precioAnterior).toLocaleString('es-MX')}</span>` +
    `<span class="of-ahora">${pMoney(p.precio_venta)}</span>` +
    `<span class="of-badge">-${pDescuento(p)}%</span>`
  : pMoney(p.precio_venta);
// "Nuevo": subida en los últimos 7 días.
const pEsNuevo = p => { const t = new Date(p.creadoEn || 0).getTime() || 0; return t && (Date.now() - t) < 7 * 86400000; };

let prenda   = null;
let fotos    = [];
let fotoIdx  = 0;

// El sitio puede estar corriendo un js/db.js viejo, sin la capa de bazares.
// En ese caso la ficha se muestra igual, solo que sin los datos del bazar.
function bazarDeSeguro(p) {
  try { return (typeof bazarDe === 'function') ? bazarDe(p) : null; }
  catch (_) { return null; }
}

// ─── CARRITO (mismo almacenamiento que la tienda; antes "wishlist") ───
function wlLista() {
  try { return JSON.parse(localStorage.getItem(WL_KEY_PP)) || []; }
  catch { return []; }
}
function wlGuardar(list) {
  localStorage.setItem(WL_KEY_PP, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent('wishlist:cambio'));
}
function wlTiene(id) { return wlLista().some(i => String(i.id) === String(id)); }

// Texto del botón de la ficha según si la prenda ya está en el carrito
function wlPintarBoton() {
  const btn = document.getElementById('ppFav'); if (!btn || !prenda) return;
  const en = wlTiene(prenda._id || prenda.id);
  btn.classList.toggle('active', en);
  btn.setAttribute('aria-pressed', en);
  const car = document.getElementById('ppBarraCarrito');
  if (car) { car.classList.toggle('active', en); car.setAttribute('aria-label', en ? 'En tu carrito: ver carrito' : 'Agregar al carrito'); }
  const t = btn.querySelector('.pp-carrito-txt');
  if (t) t.innerHTML = en ? 'En tu carrito <span class="pp-carrito-sub">· Ver carrito</span>' : 'Agregar al carrito';
}

// v37 · Barra fija del celular como la de Mercado Libre: carrito + "Comprar ahora".
// Solo si el bazar cobra en línea y la prenda está disponible; si no, queda WhatsApp.
function barraDeCompra(p, btn, waUrl) {
  if (!btn) return;
  if (!btn.dataset.original) btn.dataset.original = btn.innerHTML;
  const cfg = (typeof getTienda === 'function' && getTienda()?.porBazar?.[String(p.bazarId || 1)]) || null;
  const puede = !p.vendido && !p.apartada && cfg?.pagoEnLinea;
  let car = document.getElementById('ppBarraCarrito');
  if (!puede) {
    car?.remove();
    btn.classList.remove('comprar'); btn.innerHTML = btn.dataset.original; btn.href = waUrl; btn.target = '_blank';
    return;
  }
  if (!car) {
    car = document.createElement('button');
    car.type = 'button'; car.id = 'ppBarraCarrito'; car.className = 'pp-barra-carrito';
    car.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2.4l2.2 10.3a1.7 1.7 0 0 0 1.7 1.3h8.1a1.7 1.7 0 0 0 1.6-1.2L21 8H6.2"/><circle cx="9.6" cy="19.6" r="1.3"/><circle cx="17.2" cy="19.6" r="1.3"/><path class="ic-mas" d="M13.4 9.3v3.6M11.6 11.1h3.6"/><path class="ic-ok" d="m11.4 11.2 1.6 1.6 2.9-3"/></svg>';
    car.onclick = () => wlAlternar();
    btn.before(car);
  }
  const en = wlTiene(p._id || p.id);
  car.classList.toggle('active', en);
  car.setAttribute('aria-label', en ? 'En tu carrito: ver carrito' : 'Agregar al carrito');
  btn.classList.add('comprar'); btn.removeAttribute('target');
  btn.href = `pagar.html?bazar=${encodeURIComponent(p.bazarId || 1)}&ids=${encodeURIComponent(p.id)}`;
  btn.textContent = 'Comprar ahora';
}

// v35 · Si ya está en el carrito, el botón abre el carrito (se quita desde ahí)
function wlAlternar() {
  if (!prenda) return;
  const id = prenda._id || prenda.id;
  let list = wlLista();
  const i = list.findIndex(x => String(x.id) === String(id));
  if (i !== -1) { if (window.Carrito) { Carrito.abrir(); return; } }
  if (i === -1 && (prenda.vendido || prenda.apartada)) { aviso(prenda.vendido ? 'Esta prenda ya se vendió' : 'Esta prenda está apartada'); return; }

  if (i === -1) {
    list.push({
      id, nombre: prenda.nombre, talla: prenda.talla, estado: prenda.estado,
      precio_venta: prenda.precio_venta, marca: prenda.marca,
      imagenes: Array.isArray(prenda.imagenes) ? prenda.imagenes : [],
      bazarId: prenda.bazarId || 1,
    });
    if (window.Carrito?.avisarAgregada) Carrito.avisarAgregada(prenda.nombre, id);
    else aviso('Agregada a tu carrito');
  } else {
    list.splice(i, 1);
    if (typeof Avisos === 'object') Avisos.info('Quitada de tu carrito', { origen: 'wishlist', clave: 'wl-' + id, cuerpo: prenda.nombre || '',
      deshacer: () => { if (!wlTiene(id)) wlAlternar(); } });
    else aviso('Quitada de tu carrito');
  }
  wlGuardar(list);
  wlPintarBoton();
  if (typeof updateWishlistBadge === 'function') updateWishlistBadge();
}
// Si se quita desde el panel del carrito, el botón de la ficha vuelve a "Agregar"
window.addEventListener('wishlist:cambio', () => wlPintarBoton());

/* El panel del carrito vive en js/wishlist.js, compartido con el
   catálogo. Aquí solo queda el botón "Agregar al carrito" de la prenda. */

let avisoTimer;
function aviso(msg) {
  if (typeof Avisos === 'object') return Avisos.mostrar(msg);
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
  if (img) {
    img.src = imgOptimizada(fotos[fotoIdx], 900);
    // Sin esto el navegador se queda con el srcset de la foto anterior
    img.srcset = imgSrcSet(fotos[fotoIdx], [500, 900, 1400]);
  }
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
  const bz  = bazarDeSeguro(p);
  const talla = String(p.talla || '').split('·')[0].trim().replace(/\s*(Hombre|Mujer)\s*/i, '');
  return `<a class="h-card" href="prenda.html?id=${encodeURIComponent(p.id)}">
    <div class="h-card-img">
      ${img ? `<img src="${imgOptimizada(img, 400)}"
                    srcset="${imgSrcSet(img, [280, 400, 640])}"
                    sizes="(max-width: 700px) 45vw, 220px"
                    alt="${pEsc(p.nombre)}" loading="lazy" decoding="async">`
            : `<div class="h-card-nophoto">Sin foto</div>`}
      ${pHayOferta(p) ? `<span class="of-corner">-${pDescuento(p)}%</span>` : ''}
      ${(!pHayOferta(p) && pEsNuevo(p)) ? `<span class="nuevo-corner">Nuevo</span>` : ''}
    </div>
    <div class="h-card-body">
      <div class="h-card-brand${p.marca ? '' : ' sin-marca'}">${pEsc(p.marca || 'Sin marca')}</div>
      <div class="h-card-name">${pEsc(p.nombre)}</div>
      <div class="h-card-foot">
        <span class="h-card-price${pHayOferta(p) ? ' tiene-oferta' : ''}">${pPrecioHTML(p)}</span>
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

  const bz    = bazarDeSeguro(p);
  const color = (bz && bz.color) || '#2d6be4';
  const wa    = bz && bz.whatsapp ? String(bz.whatsapp).replace(/[^0-9]/g, '') : WA_POR_DEFECTO;
  const id    = p._id || p.id;

  // El color del bazar tiñe la página
  document.documentElement.style.setProperty('--bz-color', color);
  document.body.classList.add('pp-tema');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);

  document.title = `${p.nombre}${p.marca ? ' · ' + p.marca : ''} | Stiimpys`;

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

  // Prueba social del bazar: calificación promedio (de sus reseñas) y cuántas
  // prendas ha vendido. Da confianza para escribirle.
  let ppSocial = '';
  if (bz) {
    const rt   = (typeof ratingDeBazar === 'function') ? ratingDeBazar(bz.id) : { promedio: 0, total: 0 };
    const vend = (typeof getDB === 'function' ? getDB() : []).filter(x => Number(x.bazarId) === Number(bz.id) && x.vendido).length;
    const trozos = [];
    if (rt.total) trozos.push(`<span class="pp-bz-rating">${(typeof estrellasHTML === 'function' ? estrellasHTML(rt.promedio, 'st-estrellas') : '★')} <b>${rt.promedio.toFixed(1)}</b> <i>(${rt.total})</i></span>`);
    if (vend)     trozos.push(`<span class="pp-bz-ventas">${vend} vendida${vend !== 1 ? 's' : ''}</span>`);
    if (trozos.length) ppSocial = `<span class="pp-bazar-social">${trozos.join('')}</span>`;
  }

  // Si está en subasta, el precio fijo y el botón de apartar sobran: aquí
  // no se aparta, se oferta.
  const enSubasta = typeof subastaDe === 'function' && !!subastaDe(p.id) && !p.vendido;

  const tallaBase   = String(p.talla || '').split('·')[0].trim();
  const tallaExtras = String(p.talla || '').split('·').slice(1).map(x => x.trim()).filter(Boolean);

  const fichas = [
    ['Talla', tallaBase || '—'],
    tallaExtras.length ? ['Cómo queda', tallaExtras.join(' · ')] : null,
    ['Condición', p.estado || '—'],
    ['Marca', p.marca || 'Sin marca'],
    cats.length ? ['Categoría', cats.join(', ')] : null,
    ['Ubicación', (bz && bz.ubicacion) || 'Reynosa, Tamps.'],
    ['Disponibilidad', p.vendido ? 'Vendida' : enSubasta ? 'En subasta · pieza única' : p.apartada ? (p.pagandoHasta ? 'Apartada · alguien la está pagando' : 'Apartada · puede liberarse si no se paga') : 'Disponible · pieza única'],
  ].filter(Boolean);

  document.getElementById('ppContenido').innerHTML = `
    <div class="pp-galeria">
      <div class="pp-foto-wrap">
        ${fotos.length ? `
          <div class="pp-zoom" id="ppZoom">
            <img id="ppFoto" src="${imgOptimizada(fotos[0], 900)}"
                 srcset="${imgSrcSet(fotos[0], [500, 900, 1400])}"
                 sizes="(max-width: 900px) 100vw, 560px"
                 alt="${pEsc(p.nombre)}" onclick="abrirModal()" fetchpriority="high">
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
           <img src="${imgOptimizada(src, 180)}" alt="Foto ${i + 1}" loading="lazy" decoding="async">
         </button>`).join('')}</div>` : ''}
    </div>

    <div class="pp-info">
      ${p.marca
        ? `<a class="pp-marca" href="/marca/${pSlug(p.marca)}">${pEsc(p.marca)}</a>`
        : '<span class="pp-marca sin-marca">Sin marca</span>'}
      <h1 class="pp-nombre">${pEsc(p.nombre)}</h1>
      <div class="pp-meta">${pEsc(haceCuanto(p))}</div>

      ${enSubasta ? '' : `
      <div class="pp-precio-fila">
        <span class="pp-precio${pHayOferta(p) ? ' tiene-oferta' : ''}">${pPrecioHTML(p)}</span>
        ${p.vendido ? `<span class="pp-vendida">Vendida</span>` : p.apartada ? (p.pagandoHasta && window.Contador ? `<span class="pp-apartada pp-en-pago">Apartada · ${Contador.html(p.pagandoHasta, { fin: 'liberando…' })}</span>` : `<span class="pp-apartada">Apartada</span>`) : `<span class="pp-unica">Pieza única</span>`}
      </div>
      ${(!p.vendido && pHayOferta(p)) ? `<div class="pp-ahorro">¡Bajó de precio! Te ahorras $${(Number(p.precioAnterior) - Number(p.precio_venta)).toLocaleString('es-MX')}</div>` : ''}`}

      ${(!p.vendido && p.apartada && p.pagandoHasta && window.Contador) ? `<div class="pp-aviso-pago" role="status">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9.5 2.5h5"/></svg>
        <span>Alguien la está pagando en este momento. Si no completa su pago en <b>${Contador.html(p.pagandoHasta, { fin: '0:00' })}</b>, vuelve a estar disponible aquí mismo.</span>
      </div>` : ''}

      <div id="sbPanel" hidden></div>

      ${cats.length ? `<div class="pp-chips">${cats.map(c =>
        `<a class="pp-chip" href="tienda.html?cat=${encodeURIComponent(c)}">${pEsc(c)}</a>`).join('')}</div>` : ''}

      <div class="pp-acciones${enSubasta ? ' sin-wa' : ''}">
        ${enSubasta ? '' : `<a class="pp-btn-wa" href="${waUrl}" target="_blank" rel="noopener">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 2.138.558 4.147 1.535 5.886L0 24l6.274-1.507A11.944 11.944 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.853 0-3.587-.5-5.084-1.367l-.361-.214-3.733.897.931-3.618-.235-.374A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
          Apartar por WhatsApp
        </a>`}
        ${(p.vendido || p.apartada || enSubasta) ? '' : `<button class="pp-btn-fav pp-btn-carrito ${wlTiene(id) ? 'active' : ''}" id="ppFav" onclick="wlAlternar()" aria-pressed="${wlTiene(id)}">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 4h2.4l2.2 10.3a1.7 1.7 0 0 0 1.7 1.3h8.1a1.7 1.7 0 0 0 1.6-1.2L21 8H6.2"/><circle cx="9.6" cy="19.6" r="1.3"/><circle cx="17.2" cy="19.6" r="1.3"/><path class="ic-mas" d="M13.4 9.3v3.6M11.6 11.1h3.6"/><path class="ic-ok" d="m11.4 11.2 1.6 1.6 2.9-3"/>
          </svg>
          <span class="pp-carrito-txt">${wlTiene(id) ? 'En tu carrito <span class="pp-carrito-sub">· Ver carrito</span>' : 'Agregar al carrito'}</span>
        </button>`}
        <button class="pp-btn-share" onclick="compartir(this)">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Compartir
        </button>
      </div>

      ${bz ? `
        <a class="pp-bazar" href="tienda.html?bazar=${encodeURIComponent(bz.slug)}">
          ${(bz.logo || bz.portada)
            ? `<img class="pp-bazar-logo" src="${imgOptimizada(bz.logo || bz.portada, 160)}" alt="Logo de ${pEsc(bz.nombre)}" loading="lazy">`
            : `<span class="pp-bazar-logo pp-bazar-inicial">${pEsc((bz.nombre || '?').charAt(0))}</span>`}
          <span class="pp-bazar-datos">
            <span class="pp-bazar-nombre">${pEsc(bz.nombre)}</span>
            <span class="pp-bazar-slug">@${pEsc(bz.slug)}</span>
            ${ppSocial}
          </span>
          <span class="pp-bazar-ver">Ver catálogo →</span>
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
          <li>Se aparta hasta que Stiimpys confirme por WhatsApp.</li>
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

  // Barra fija de compra en el celular. En subasta apunta al panel de
  // ofertas: mandar a WhatsApp desde ahí sería saltarse la subasta.
  const barra = document.getElementById('ppBarra');
  if (barra) {
    barra.hidden = false;
    document.getElementById('ppBarraNombre').textContent = p.nombre;
    const precioBarra = document.getElementById('ppBarraPrecio');
    const btnBarra    = document.getElementById('ppBarraWa');
    if (enSubasta) {
      const sb = subastaDe(p.id);
      if (precioBarra) precioBarra.innerHTML =
        pMoney(sb.totalOfertas ? sb.ofertaActual : sb.precioInicial) +
        ' <small style="font-weight:400;opacity:.7">en subasta</small>';
      if (btnBarra) {
        btnBarra.href = '#sbPanel';
        btnBarra.removeAttribute('target');
        btnBarra.textContent = 'Ofertar';
        btnBarra.onclick = ev => {
          ev.preventDefault();
          document.getElementById('sbPanel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => document.querySelector('#sbPanel .sb-monto')?.focus(), 400);
        };
      }
    } else {
      if (precioBarra) precioBarra.innerHTML = pPrecioHTML(p);
      if (btnBarra) { btnBarra.href = waUrl; btnBarra.onclick = null; }
      barraDeCompra(p, btnBarra, waUrl);
    }
  }

  // El estado real de la subasta se pide al servidor: el del sync puede
  // tener hasta quince segundos y aquí eso ya es dinero de otro.
  if (typeof Subasta !== 'undefined') {
    if (enSubasta) Subasta.montar(document.getElementById('sbPanel'), p);
    else Subasta.desmontar();
  }

  pintarRelacionadas(p, bz);
}

function compartir(btn) {
  const url = location.href;
  const orig = btn.innerHTML;
  if (navigator.share) {
    navigator.share({ title: prenda?.nombre || 'Stiimpys', url }).catch(() => {});
    return;
  }
  if (typeof Avisos === 'object') Avisos.copiar(url, { que: 'Link' });
  else navigator.clipboard.writeText(url).catch(() => {});
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

// ─── ERRORES DE CARGA ────────────────────────────────────────
// Si la base de datos no responde, la página avisa en vez de quedarse
// girando para siempre.
function noSePudoCargar(detalle) {
  const cont = document.getElementById('ppContenido');
  if (!cont) return;
  cont.innerHTML = `
    <div class="pp-vacio">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>
      <h1>No se pudo cargar la prenda</h1>
      <p>Revisa tu conexión y vuelve a intentar.${detalle ? `<br><span class="pp-detalle">${pEsc(detalle)}</span>` : ''}</p>
      <div class="pp-vacio-btns">
        <button class="h-btn h-btn-primary" onclick="location.reload()">Reintentar</button>
        <a class="h-btn h-btn-wa" href="tienda.html">Ir al catálogo</a>
      </div>
    </div>`;
  document.title = 'No se pudo cargar | Stiimpys';
}

// Espera a la base de datos, pero no para siempre
function esperarBD(msMax = 12000) {
  return new Promise((ok, falla) => {
    if (typeof waitForDB !== 'function') {
      return falla(new Error('Falta js/db.js'));
    }
    let listo = false;
    const reloj = setTimeout(() => {
      if (!listo) falla(new Error('El catálogo tardó demasiado en responder'));
    }, msMax);
    waitForDB().then(() => {
      listo = true;
      clearTimeout(reloj);
      ok();
    });
  });
}

// ─── NO ENCONTRADA ───────────────────────────────────────────
function prendaNoDisponible() {
  document.getElementById('ppContenido').innerHTML = `
    <div class="pp-vacio">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <h1>Esta prenda ya no está disponible</h1>
      <p>Puede que se haya vendido o que ya no esté en el catálogo.</p>
      <a class="h-btn h-btn-primary" href="tienda.html">Ver el catálogo</a>
    </div>`;
  document.title = 'Prenda no disponible | Stiimpys';

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

  try {
    await esperarBD();
  } catch (err) {
    console.error('[ficha]', err);
    return noSePudoCargar(err.message);
  }

  const buscado = new URLSearchParams(location.search).get('id');
  if (!buscado) return prendaNoDisponible();

  const p = getDB().find(x =>
    String(x.id) === String(buscado) || String(x._id) === String(buscado));

  if (!p || p.oculto) return prendaNoDisponible();

  try {
    pintarPrenda(p);
  } catch (err) {
    // Un fallo al pintar no debe dejar la página en blanco
    console.error('[ficha]', err);
    noSePudoCargar(err.message);
  }
});

// Si el catálogo cambia mientras la página está abierta, se refresca
window.addEventListener('db:inventario', () => {
  if (!prenda) return;
  const actual = getDB().find(x => String(x.id) === String(prenda.id));
  if (actual) pintarPrenda(actual);
});
