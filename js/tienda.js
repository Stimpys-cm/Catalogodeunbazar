// js/tienda.js

let filterCat   = null;
let filterBrand = null;
let filterBazar = null;   // id del bazar cuando se navega a un bazar concreto
let searchQuery = '';

// ─── Estado de filtros del sidebar + orden ───────────────────
const shopFilters = { tallas:new Set(), marcas:new Set(), estados:new Set(), bazares:new Set(), maxPrecio:Infinity };
let shopPriceMax  = 0;
let shopSort      = 'recent';

// ─── DROPDOWNS ───────────────────────────────────────────────
function toggleDrop(id) {
  const drop   = document.getElementById(id);
  const isOpen = drop.classList.contains('open');
  // Cierra todos y regresa al DOM original si fueron teleportados
  document.querySelectorAll('.nav-dropdown').forEach(d => {
    d.classList.remove('open');
    const orig = d.dataset.origParent ? document.getElementById(d.dataset.origParent) : null;
    if (orig && d.parentElement === document.body) orig.appendChild(d);
  });
  if (!isOpen) {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      const btn  = drop.previousElementSibling;
      const rect = btn.getBoundingClientRect();
      drop.dataset.origParent = drop.parentElement.id || (() => {
        drop.parentElement.id = 'navItem_' + id;
        return 'navItem_' + id;
      })();
      document.body.appendChild(drop);
      drop.style.position    = 'fixed';
      drop.style.top         = rect.bottom + 'px';
      drop.style.left        = '0';
      drop.style.right       = '0';
      drop.style.width       = '100vw';
      drop.style.zIndex      = '9999';
      drop.style.borderRadius = '0 0 16px 16px';
      drop.style.maxHeight   = '50vh';
      drop.style.overflowY   = 'auto';
    }
    drop.classList.add('open');
  }
}

document.addEventListener('click', e => {
  if (!e.target.closest('.nav-item') && !e.target.closest('.nav-dropdown')) {
    document.querySelectorAll('.nav-dropdown').forEach(d => {
      d.classList.remove('open');
      const orig = d.dataset.origParent ? document.getElementById(d.dataset.origParent) : null;
      if (orig && d.parentElement === document.body) orig.appendChild(d);
    });
  }
});

// ─── BÚSQUEDA EXPANDIBLE ─────────────────────────────────────
function toggleSearch() {
  const wrap  = document.getElementById('searchWrap');
  const input = document.getElementById('searchInput');
  if (wrap.classList.contains('expanded')) {
    closeSearch();
  } else {
    // En móvil, scroll arriba para que la barra de búsqueda sea visible
    window.scrollTo({ top: 0, behavior: 'smooth' });
    wrap.classList.add('expanded');
    setTimeout(() => input.focus(), 300);
  }
}
function closeSearch() {
  const wrap  = document.getElementById('searchWrap');
  const input = document.getElementById('searchInput');
  wrap.classList.remove('expanded');
  input.value = '';
  renderGrid('');
}

// Hover para abrir; al salir el mouse espera 6s antes de cerrar.
(function initSearchHover() {
  const CIERRE_MS = 6000;
  const wrap = document.getElementById('searchWrap');
  if (!wrap || window.matchMedia('(hover: none)').matches) return;
  const input = document.getElementById('searchInput');
  let timer = null;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const abrir = () => {
    cancel();
    if (!wrap.classList.contains('expanded')) {
      wrap.classList.add('expanded');
      setTimeout(() => input && input.focus({ preventScroll:true }), 60);
    }
  };
  const cerrarLuego = () => {
    cancel();
    timer = setTimeout(() => {
      if (input && (input.value.trim() || document.activeElement === input)) { cerrarLuego(); return; }
      wrap.classList.remove('expanded');
    }, CIERRE_MS);
  };
  wrap.addEventListener('mouseenter', abrir);
  wrap.addEventListener('mouseleave', cerrarLuego);
  input && input.addEventListener('blur', () => { if (!wrap.matches(':hover')) cerrarLuego(); });
})();
// Cerrar búsqueda con Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeSearch();
    closeWishlistPanel();
    closeMod();
    closePD();
  }
});

// ─── WISHLIST (localStorage) ──────────────────────────────────
const WL_KEY = 'bazar_wishlist';

function getWishlist() {
  try { return JSON.parse(localStorage.getItem(WL_KEY)) || []; }
  catch { return []; }
}
function saveWishlist(list) {
  localStorage.setItem(WL_KEY, JSON.stringify(list));
  // Si hay sesión de comprador, js/cuenta.js la sincroniza con el servidor
  window.dispatchEvent(new CustomEvent('wishlist:cambio'));
}
function isWishlisted(id) {
  return getWishlist().some(item => item.id === id);
}
function toggleWishlist(product) {
  let list = getWishlist();
  const idx = list.findIndex(i => i.id === product.id);
  if (idx === -1) {
    list.push(product);
    showToast(`❤️ ${product.nombre} guardado`);
  } else {
    list.splice(idx, 1);
    showToast(`Eliminado de tu wishlist`);
  }
  saveWishlist(list);
  updateWishlistBadge();
  renderWishlistPanel();
  // Re-render el corazón en la card si está visible
  const btn = document.querySelector(`[data-wl-id="${product.id}"]`);
  if (btn) btn.classList.toggle('active', isWishlisted(product.id));
}
// El panel de prendas guardadas vive en js/wishlist.js, compartido con
// la ficha de prenda: updateWishlistBadge, renderWishlistPanel,
// toggleWishlistPanel, closeWishlistPanel y removeFromWishlist.

// ─── POBLAR DROPDOWNS ────────────────────────────────────────
function buildDropdowns() {
  const cats   = getCats();
  const brands = getBrands();

  document.getElementById('dropCatsList').innerHTML =
    `<a class="drop-link ${!filterCat?'active':''}" onclick="setFilterCat(null)">Todas las categorías</a>` +
    cats.map(c =>
      `<a class="drop-link ${filterCat===c.nombre?'active':''}" onclick="setFilterCat(&#39;${esc(c.nombre).replace(/'/g, '&#39;')}&#39;)">${esc(c.nombre)}</a>`
    ).join('');

  const bl = document.getElementById('dropBrandsList');
  bl.className = 'drop-inner' + (brands.length > 8 ? ' drop-cols' : '');
  bl.innerHTML =
    `<a class="drop-link ${!filterBrand?'active':''}" onclick="setFilterBrand(null)">Todas las marcas</a>` +
    brands.map(b =>
      `<a class="drop-link ${filterBrand===b.nombre?'active':''}" onclick="setFilterBrand(&#39;${esc(b.nombre).replace(/'/g, '&#39;')}&#39;)">${esc(b.nombre)}</a>`
    ).join('');
}

// ─── FILTROS ─────────────────────────────────────────────────
function setFilterCat(cat) {
  filterCat = cat;
  document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
  updateActiveFilters(); renderGrid(); buildDropdowns();
}
function setFilterBrand(brand) {
  filterBrand = brand;
  document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
  updateActiveFilters(); renderGrid(); buildDropdowns();
}
function clearFilters() {
  filterCat = null; filterBrand = null;
  updateActiveFilters(); renderGrid(); buildDropdowns();
}
function updateActiveFilters() {
  const row   = document.getElementById('activeFiltersRow');
  const wrap  = document.getElementById('activeFilters');
  const chips = [];
  if (filterCat)   chips.push(`<span class="filter-chip">${esc(filterCat)} <button onclick="setFilterCat(null)">✕</button></span>`);
  if (filterBrand) chips.push(`<span class="filter-chip">${esc(filterBrand)} <button onclick="setFilterBrand(null)">✕</button></span>`);
  if (filterBazar) {
    const b = getBazarById(filterBazar);
    if (b) chips.push(`<span class="filter-chip" style="--bz-color:${esc(b.color || '#2d6be4')};border-color:var(--bz-color);color:var(--bz-color)">@${esc(b.slug)}</span>`);
  }
  wrap.innerHTML = chips.join('');
  row.classList.toggle('hidden', chips.length === 0);
}

// ─── Tiempo transcurrido ("hace X horas") ────────────────────
function tiempoDesde(p) {
  let ms = null;
  const raw = p.creadoEn || p.createdAt || p.fecha;
  if (raw) { const d = new Date(raw); if (!isNaN(d)) ms = d.getTime(); }
  if (ms === null && typeof p._id === 'string' && p._id.length >= 8) {
    const s = parseInt(p._id.substring(0,8),16); if (!isNaN(s)) ms = s*1000;
  }
  if (ms === null) return '';
  const diff = Math.max(0, Date.now()-ms);
  const min = Math.floor(diff/60000), hrs = Math.floor(diff/3600000), dias = Math.floor(diff/86400000);
  if (min < 1)  return 'Ahora';
  if (min < 60) return `hace ${min} min`;
  if (hrs < 24) return `hace ${hrs} h`;
  if (dias < 30) return `hace ${dias} d`;
  const meses = Math.floor(dias/30);
  return `hace ${meses} mes${meses>1?'es':''}`;
}
// Los precios son en pesos mexicanos. Se marca en cada importe para que
// nadie lo confunga con dólares: money() da el texto plano y moneyHTML()
// pone el MXN en pequeño, para donde el precio se muestra en grande.
// Cuando la prenda no trae marca hay que escribirlo: dejar el hueco
// vacío descolocaba la tarjeta y no decía nada al comprador.
const SIN_MARCA = 'Sin marca';
const money = n => '$' + Number(n||0).toLocaleString('es-MX') + ' MXN';
const moneyHTML = n => '$' + Number(n||0).toLocaleString('es-MX') + ' <span class="cur">MXN</span>';

// ─── BAZARES ─────────────────────────────────────────────────
// El catálogo mezcla las prendas de todos los bazares; cada tarjeta
// dice de quién es y contacta al WhatsApp de ese bazar.
function nombreBazar(p) {
  const b = bazarDe(p);
  return b ? b.nombre : '';
}
function slugBazar(p) {
  const b = bazarDe(p);
  return b ? b.slug : '';
}
function waLink(p, msg) {
  return `https://wa.me/${whatsappDe(p)}?text=${encodeURIComponent(msg)}`;
}
function msgPrenda(p) {
  return `Hola! Me interesa: ${p.nombre} · Talla ${p.talla} · $${p.precio_venta} MXN`;
}

// Escapa texto para insertarlo con seguridad en HTML/atributos
// (evita que nombres con comillas o < > rompan el markup o inyecten HTML)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// Skeletons de carga: se muestran mientras llega el primer fetch a la BD
function renderSkeletons(n = 8) {
  const grid = document.getElementById('productGrid');
  if (!grid) return;
  grid.innerHTML = Array.from({ length: n }, () => `
    <div class="skeleton-card">
      <div class="sk-img"></div>
      <div class="sk-body">
        <div class="sk-line short"></div>
        <div class="sk-line"></div>
        <div class="sk-line price"></div>
      </div>
    </div>`).join('');
}

// ─── RENDER GRID ─────────────────────────────────────────────
function renderGrid(query) {
  if (query !== undefined) searchQuery = query;
  // Si el render NO viene de las flechas de paginación, volver a la página 1
  if (!_shopNavegando) _shopPagina = 0;
  _shopNavegando = false;
  let items = getDB().filter(p => !p.vendido && !p.oculto);

  const q = searchQuery.toLowerCase().trim();
  if (q) items = items.filter(p =>
    (p.nombre||'').toLowerCase().includes(q) ||
    (p.marca||'').toLowerCase().includes(q) ||
    (p.estado||'').toLowerCase().includes(q) ||
    (p.talla||'').toLowerCase().includes(q) ||
    (Array.isArray(p.categorias)?p.categorias:[]).some(c => c.toLowerCase().includes(q))
  );
  if (filterCat)   items = items.filter(p => Array.isArray(p.categorias) && p.categorias.includes(filterCat));
  if (filterBrand) items = items.filter(p => p.marca === filterBrand);
  if (filterBazar) items = items.filter(p => Number(p.bazarId || 1) === Number(filterBazar));

  // Filtros del sidebar
  if (shopFilters.tallas.size)  items = items.filter(p => shopFilters.tallas.has(String(p.talla)));
  if (shopFilters.marcas.size)  items = items.filter(p => shopFilters.marcas.has(p.marca));
  if (shopFilters.estados.size) items = items.filter(p => shopFilters.estados.has(p.estado));
  if (shopFilters.bazares.size) items = items.filter(p => shopFilters.bazares.has(String(p.bazarId || 1)));
  if (shopFilters.maxPrecio !== Infinity) items = items.filter(p => Number(p.precio_venta) <= shopFilters.maxPrecio);

  // Orden
  if (shopSort === 'priceLow')  items.sort((a,b)=> Number(a.precio_venta) - Number(b.precio_venta));
  if (shopSort === 'priceHigh') items.sort((a,b)=> Number(b.precio_venta) - Number(a.precio_venta));
  if (shopSort === 'brand')     items.sort((a,b)=> (a.marca||'').localeCompare(b.marca||''));
  if (shopSort === 'recent')    items.sort((a,b)=> {
    const ta = new Date(a.creadoEn||0).getTime()||0, tb = new Date(b.creadoEn||0).getTime()||0;
    return tb - ta || (b.id||0) - (a.id||0);
  });

  const grid  = document.getElementById('productGrid');
  const label = document.getElementById('countLabel');
  const fdCount = document.getElementById('fdCount');
  label.innerHTML = `<span class="count">${items.length}</span> resultado${items.length!==1?'s':''}`;
  if (fdCount) fdCount.textContent = items.length;

  if (!items.length) {
    const hayFiltros = filterCat || filterBrand || searchQuery.trim() ||
      shopFilters.tallas.size || shopFilters.marcas.size || shopFilters.estados.size ||
      shopFilters.bazares.size || shopFilters.maxPrecio !== shopPriceMax;
    grid.innerHTML = `<div class="empty">
      <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <div class="empty-title">Sin resultados</div>
      <div class="empty-sub">${hayFiltros ? 'No hay prendas con esos filtros.' : 'Aún no hay prendas disponibles. ¡Vuelve pronto!'}</div>
      ${hayFiltros ? '<button class="empty-cta" onclick="clearShopFilters();clearFilters();closeSearch()">Limpiar filtros</button>' : ''}
    </div>`;
    const navE = document.getElementById('shopPaginacion');
    if (navE) navE.innerHTML = '';
    return;
  }

  // Paginación (42 por página)
  const totalPaginas = Math.ceil(items.length / SHOP_POR_PAGINA);
  if (_shopPagina > totalPaginas - 1) _shopPagina = totalPaginas - 1;
  if (_shopPagina < 0) _shopPagina = 0;
  const inicioShop = _shopPagina * SHOP_POR_PAGINA;
  const itemsPagina = items.slice(inicioShop, inicioShop + SHOP_POR_PAGINA);

  grid.innerHTML = itemsPagina.map(p => {
    const imgs    = Array.isArray(p.imagenes) ? p.imagenes : [];
    const imgHtml = imgs[0]
      ? `<img src="${imgOptimizada(imgs[0], 500)}" alt="${esc(p.nombre)}" loading="lazy" decoding="async">`
      : `<div class="no-photo">Sin foto</div>`;
    const marcaTag  = p.marca ? `<div class="brand-tag">${esc(p.marca)}</div>` : '';
    const waMsg     = encodeURIComponent(`Hola! Me interesa: ${p.nombre} · Talla ${p.talla} · $${p.precio_venta} MXN`);
    const favActive = isWishlisted(p._id || p.id) ? 'active' : '';
    const favId     = p._id || p.id;
    const tiempo    = tiempoDesde(p);

    const productData = JSON.stringify({
      id: favId,
      nombre: p.nombre,
      talla: p.talla,
      estado: p.estado,
      precio_venta: p.precio_venta,
      marca: p.marca,
      imagenes: imgs,
      bazarId: p.bazarId || 1
    }).replace(/'/g, '&#39;');

    // Subasta: la tarjeta enseña la puja de ahora, no el precio fijo, y
    // el botón de WhatsApp sale sobrando (aquí se oferta, no se aparta).
    const sub = typeof subastaDe === 'function' ? subastaDe(p.id) : null;
    const subViva = sub && typeof subastaAbierta === 'function' && subastaAbierta(sub);
    const subCinta = sub ? `<div class="card-subasta${subViva ? '' : ' cerrada'}">
        ${subViva ? `<span class="card-subasta-punto"></span>Subasta · ${
          typeof tiempoRestante === 'function' ? tiempoRestante(sub.fin) : ''}`
                  : 'Subasta terminada'}
      </div>` : '';

    const bz     = bazarDe(p);
    const bzTag  = bz
      ? `<a class="card-bazar" href="tienda.html?bazar=${encodeURIComponent(bz.slug)}"
             style="--bz-color:${esc(bz.color || '#2d6be4')}"
             onclick="event.stopPropagation()">@${esc(bz.slug)}</a>`
      : '';

    return `<div class="card" data-product='${productData}' style="cursor:pointer">
      <div class="card-img">
        ${imgHtml}${marcaTag}${subCinta}
        <button class="card-fav-btn ${favActive}" data-wl-id="${favId}" data-product='${productData}'
          aria-label="Guardar en wishlist">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
        ${sub
          ? (subViva
              ? `<button type="button" class="card-quick card-quick-sb" data-ofertar="${p.id}"
                         onclick="event.stopPropagation(); abrirSubasta(${p.id})">
                   Ofertar desde $${Number(sub.totalOfertas ? sub.ofertaActual + 50 : sub.precioInicial).toLocaleString('es-MX')}
                 </button>`
              : `<button type="button" class="card-quick card-quick-sb cerrada"
                         onclick="event.stopPropagation(); abrirSubasta(${p.id})">
                   Ver cómo quedó
                 </button>`)
          : `<a href="https://wa.me/${whatsappDe(p)}?text=${waMsg}" target="_blank" class="card-quick" onclick="event.stopPropagation()">
          Contactar por WhatsApp
        </a>`}
      </div>
      <div class="card-body" data-marca="${p.marca||''}">
        <div class="card-row">
          <div class="card-titles">
            <div class="card-brand${p.marca ? '' : ' sin-marca'}">${esc(p.marca || SIN_MARCA)}</div>
            <div class="card-name">${esc(p.nombre)}</div>
          </div>
          <div class="card-price${sub ? ' es-subasta' : ''}">
            ${sub ? `<span class="card-price-tag">${sub.totalOfertas ? 'Van' : 'Desde'}</span>` : ''}
            ${moneyHTML(sub ? (sub.totalOfertas ? sub.ofertaActual : sub.precioInicial) : p.precio_venta)}
          </div>
        </div>
        <div class="card-sub" title="${esc(p.talla || '')}">
          <span class="size-tag">Talla ${esc(etiquetaTalla(p.talla) || '–')}</span>${
            [...detallesTalla(p.talla), p.estado].filter(Boolean).map(x => ' · ' + esc(x)).join('')}
        </div>
        ${bzTag ? `<div class="card-bazar-row">${bzTag}</div>` : ''}
        <div class="card-foot">
          <span class="card-loc">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            Reynosa, Tamps.
          </span>
          ${tiempo ? `<span class="card-time">${tiempo}</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  // Controles de paginación de la tienda
  const nav = document.getElementById('shopPaginacion');
  if (nav) {
    if (totalPaginas <= 1) {
      nav.innerHTML = '';
    } else {
      const desde = inicioShop + 1;
      const hasta = Math.min(inicioShop + SHOP_POR_PAGINA, items.length);
      const nums = shopPaginacionNumeros(_shopPagina, totalPaginas);
      const numsHtml = nums.map(n => {
        if (n === '...') return `<span class="pg-ellipsis">···</span>`;
        return `<button class="pg-num ${n === _shopPagina ? 'active' : ''}" onclick="shopIrPagina(${n})">${n + 1}</button>`;
      }).join('');
      nav.innerHTML = `
        <div class="pg-bar">
          <button class="pg-arrow" onclick="shopPagina(-1)" ${_shopPagina === 0 ? 'disabled' : ''} aria-label="Anterior">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="pg-nums">${numsHtml}</div>
          <button class="pg-arrow" onclick="shopPagina(1)" ${_shopPagina >= totalPaginas - 1 ? 'disabled' : ''} aria-label="Siguiente">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="pg-info">${desde}–${hasta} de ${items.length} prendas</div>`;
    }
  }
}

// ─── PAGINACIÓN DE LA TIENDA ─────────────────────────────────
let _shopPagina = 0;
let _shopNavegando = false;
const SHOP_POR_PAGINA = 42;

function shopPaginacionNumeros(actual, total) {
  const paginas = [];
  const rango = 1;
  for (let i = 0; i < total; i++) {
    if (i === 0 || i === total - 1 || (i >= actual - rango && i <= actual + rango)) {
      paginas.push(i);
    } else if (paginas[paginas.length - 1] !== '...') {
      paginas.push('...');
    }
  }
  return paginas;
}
function shopPagina(delta) {
  _shopPagina += delta;
  _shopNavegando = true;
  renderGrid();
  scrollShopArriba();
}
function shopIrPagina(n) {
  _shopPagina = n;
  _shopNavegando = true;
  renderGrid();
  scrollShopArriba();
}
function scrollShopArriba() {
  const ancla = document.getElementById('productGrid');
  if (ancla) {
    const y = ancla.getBoundingClientRect().top + window.scrollY - 100;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
}
// En el filtro y en las tarjetas se muestra la talla corta ("XL" en vez de
// "XL Hombre"); el texto completo va en el title y en el detalle.
function etiquetaTalla(t) {
  const base = String(t || '').split('·')[0].trim();
  return base.replace(/\s*(Hombre|Mujer)\s*/i, '').trim() || base;
}

// Lo que sigue después de la talla base: "Queda como M", "Oversize"...
function detallesTalla(t) {
  return String(t || '').split('·').slice(1).map(x => x.trim()).filter(Boolean);
}

function buildShopFilters() {
  const all = getDB().filter(p => !p.vendido && !p.oculto);
  // Tallas agrupadas (Hombre, Mujer, Pantalón...) y ordenadas por escala
  const tallas  = [...new Set(all.map(p=>String(p.talla)).filter(Boolean))]
    .sort((a,b)=> ordenTalla(a) - ordenTalla(b) || a.localeCompare(b));
  const marcas  = [...new Set(all.map(p=>p.marca).filter(Boolean))].sort();
  // Condición ordenada de mejor a peor, no alfabéticamente
  const estados = [...new Set(all.map(p=>p.estado).filter(Boolean))]
    .sort((a,b)=> ordenEstado(a) - ordenEstado(b) || a.localeCompare(b));
  const precios = all.map(p=>Number(p.precio_venta)).filter(n=>!isNaN(n));
  shopPriceMax  = precios.length ? Math.max(...precios) : 0;
  if (shopFilters.maxPrecio === Infinity) shopFilters.maxPrecio = shopPriceMax;

  const checkList = (title,key,vals) => !vals.length ? '' : `
    <div class="fblock">
      <button class="ftoggle" type="button"><span class="lbl">${title}</span>
        <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>
      <div class="freveal"><div>${vals.map(v=>`
        <label class="fcheck">
          <input type="checkbox" class="fchk" data-key="${key}" data-val="${esc(v)}" ${shopFilters[key].has(v)?'checked':''}>
          <span class="fbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg></span>
          <span class="ftxt">${esc(v)}</span>
        </label>`).join('')}</div></div>
    </div>`;

  // Las tallas se muestran por grupo: Hombre, Mujer, Pantalón, Unitalla...
  const porGrupo = {};
  tallas.forEach(t => {
    const g = grupoDeTalla(t);
    (porGrupo[g] = porGrupo[g] || []).push(t);
  });
  const ORDEN_GRUPOS = ['Hombre', 'Mujer', 'Mujer (numérica)', 'Pantalón (cintura)',
                        'Calzado (MX)', 'Sin talla definida', 'General', 'Numérica', 'Otras'];
  const gruposOrdenados = Object.keys(porGrupo)
    .sort((a,b)=> (ORDEN_GRUPOS.indexOf(a)+1 || 99) - (ORDEN_GRUPOS.indexOf(b)+1 || 99));

  const tallasHtml = !tallas.length ? '' : `
    <div class="fblock">
      <button class="ftoggle" type="button"><span class="lbl">Talla</span>
        <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>
      <div class="freveal"><div>${gruposOrdenados.map(g => `
        <div class="ftalla-grupo">
          <span class="ftalla-grupo-lbl">${esc(g)}</span>
          <div class="fpills">${porGrupo[g].map(t=>`
            <button type="button" class="fpill ${shopFilters.tallas.has(t)?'active':''}"
              data-key="tallas" data-val="${esc(t)}" title="${esc(t)}">${esc(etiquetaTalla(t))}</button>`).join('')}</div>
        </div>`).join('')}</div></div>
    </div>`;

  const priceHtml = !shopPriceMax ? '' : `
    <div class="fblock">
      <button class="ftoggle" type="button"><span class="lbl">Precio</span>
        <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>
      <div class="freveal"><div class="fprice">
        <input type="range" class="fprice-range" min="0" max="${shopPriceMax}" step="10" value="${shopFilters.maxPrecio===Infinity?shopPriceMax:shopFilters.maxPrecio}">
        <div class="fprice-labels"><span>$0</span><span>Hasta <b class="fprice-val">${moneyHTML(shopFilters.maxPrecio===Infinity?shopPriceMax:shopFilters.maxPrecio)}</b></span></div>
      </div></div>
    </div>`;

  // Bloque "Bazar": el catálogo mezcla varios bazares, así que se puede
  // filtrar por quién vende. Solo aparece si hay más de uno con prendas.
  const conteoBz = {};
  all.forEach(p => { const id = String(p.bazarId || 1); conteoBz[id] = (conteoBz[id] || 0) + 1; });
  const bazares = getBazaresActivos().filter(b => conteoBz[String(b.id)]);
  const bazaresHtml = bazares.length < 2 ? '' : `
    <div class="fblock">
      <button class="ftoggle" type="button"><span class="lbl">Bazar</span>
        <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>
      <div class="freveal"><div>${bazares.map(b=>`
        <label class="fcheck">
          <input type="checkbox" class="fchk" data-key="bazares" data-val="${b.id}" ${shopFilters.bazares.has(String(b.id))?'checked':''}>
          <span class="fbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg></span>
          <span class="ftxt"><span class="fbz-punto" style="background:${esc(b.color || '#2d6be4')}"></span>${esc(b.nombre)} <b style="color:var(--muted);font-weight:500">${conteoBz[String(b.id)]}</b></span>
        </label>`).join('')}</div></div>
    </div>`;

  const html = bazaresHtml + tallasHtml + checkList('Marca','marcas',marcas) + priceHtml + checkList('Condición','estados',estados);
  ['sidebarFilters','sidebarFiltersMobile'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) { el.innerHTML = html; wireShopFilters(el); }
  });
}

function wireShopFilters(scope) {
  scope.querySelectorAll('.ftoggle').forEach(btn=>{
    btn.onclick = ()=>{
      const rev = btn.parentElement.querySelector('.freveal');
      const arr = btn.querySelector('.arrow');
      rev.classList.toggle('collapsed');
      arr.style.transform = rev.classList.contains('collapsed') ? 'rotate(-90deg)' : 'rotate(0deg)';
    };
  });
  scope.querySelectorAll('.fchk').forEach(chk=>{
    chk.onchange = ()=>{ toggleShopSet(chk.dataset.key, chk.dataset.val); syncShopFilters(); renderGrid(); };
  });
  scope.querySelectorAll('.fpill').forEach(pl=>{
    pl.onclick = ()=>{ toggleShopSet(pl.dataset.key, pl.dataset.val); syncShopFilters(); renderGrid(); };
  });
  const range = scope.querySelector('.fprice-range');
  if (range) {
    updateRangeFill(range);
    range.oninput = ()=>{ shopFilters.maxPrecio = Number(range.value); updateRangeFill(range); syncShopFilters(); renderGrid(); };
  }
}
// Pinta el relleno azul del slider según su valor (0 → --pct)
function updateRangeFill(range){
  const min = Number(range.min) || 0;
  const max = Number(range.max) || 100;
  const val = Number(range.value);
  const pct = max > min ? ((val - min) / (max - min)) * 100 : 100;
  range.style.setProperty('--pct', pct + '%');
}
function toggleShopSet(key,val){ shopFilters[key].has(val) ? shopFilters[key].delete(val) : shopFilters[key].add(val); }
function syncShopFilters(){
  document.querySelectorAll('.fchk').forEach(c=> c.checked = shopFilters[c.dataset.key].has(c.dataset.val));
  document.querySelectorAll('.fpill').forEach(p=> p.classList.toggle('active', shopFilters[p.dataset.key].has(p.dataset.val)));
  document.querySelectorAll('.fprice-range').forEach(r=> { r.value = shopFilters.maxPrecio; updateRangeFill(r); });
  document.querySelectorAll('.fprice-val').forEach(v=> v.innerHTML = moneyHTML(shopFilters.maxPrecio));
}
function clearShopFilters(){
  shopFilters.tallas.clear(); shopFilters.marcas.clear(); shopFilters.estados.clear();
  shopFilters.bazares.clear();
  shopFilters.maxPrecio = shopPriceMax;
  syncShopFilters(); renderGrid();
}

// ─── ORDENAR ─────────────────────────────────────────────────
function toggleSort(e){ e.stopPropagation(); document.getElementById('sortMenu').classList.toggle('open'); }
function setSort(val, btn){
  shopSort = val;
  document.getElementById('sortLabel').textContent = btn.textContent;
  document.getElementById('sortMenu').classList.remove('open');
  renderGrid();
}
document.addEventListener('click', e=>{
  if (!e.target.closest('.sort-wrap')) document.getElementById('sortMenu')?.classList.remove('open');
});

// ─── DRAWER DE FILTROS (móvil) ───────────────────────────────
function openFilterDrawer(){
  document.getElementById('filterDrawer')?.classList.add('open');
  document.getElementById('filterScrim')?.classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeFilterDrawer(){
  document.getElementById('filterDrawer')?.classList.remove('open');
  document.getElementById('filterScrim')?.classList.remove('active');
  document.body.style.overflow = '';
}

// ─── PRODUCT DETAIL DRAWER ───────────────────────────────────
let pdImgs = [], pdIdx = 0;

// La ficha de la prenda vive en su propia página (prenda.html).
// Esta función queda como puente: cualquier clic navega allá.
function openProductDetail(p) {
  const id = (p && (p.id != null ? p.id : p._id));
  if (id == null) return;
  location.href = `prenda.html?id=${encodeURIComponent(id)}`;
}

// Versión anterior en panel lateral (ya no se usa)
function _openProductDetailDrawer(p) {
  pdImgs = Array.isArray(p.imagenes) ? p.imagenes : [];
  pdIdx  = 0;
  const favActive = isWishlisted(p.id) ? 'active' : '';
  const cats      = Array.isArray(p.categorias) ? p.categorias : [];
  const catChips  = cats.map(c => `<span class="cat-chip">${esc(c)}</span>`).join('');
  const waMsg     = encodeURIComponent(`Hola! Me interesa: ${p.nombre} · Talla ${p.talla} · $${p.precio_venta} MXN`);
  const productData = JSON.stringify(p).replace(/'/g, '&#39;');
  const pdBazar     = bazarDe(p);

  // Galería principal con zoom
  const mainImg = pdImgs[0]
    ? `<div class="pd-zoom-wrap" id="pdZoomWrap">
         <img id="pdMainImg" src="${pdImgs[0]}" alt="${p.nombre}" onclick="openModal(pdImgs, pdIdx)">
         <span class="pd-zoom-hint"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg> Ampliar</span>
       </div>`
    : `<div id="pdMainImg" class="no-photo">Sin foto</div>`;

  // Thumbnails
  const thumbs = pdImgs.map((src, i) =>
    `<button class="pd-thumb ${i===0?'active':''}" data-idx="${i}" onclick="pdSetImg(${i})">
      <img src="${src}" alt="Foto ${i+1}" loading="lazy">
    </button>`
  ).join('');

  // Piezas similares (misma categoría o marca, excluyendo la actual)
  const similares = getDB()
    .filter(x => !x.vendido && !x.oculto && (x._id||x.id) !== p.id && (x.id !== p.id))
    .filter(x => (x.marca && x.marca === p.marca) ||
                 (Array.isArray(x.categorias) && Array.isArray(p.categorias) && x.categorias.some(c => p.categorias.includes(c))))
    .slice(0, 4);
  const similaresHtml = similares.length ? `
    <div class="pd-similar">
      <h3 class="pd-similar-title">Piezas similares</h3>
      <div class="pd-similar-grid">
        ${similares.map(s => {
          const simg = (Array.isArray(s.imagenes) && s.imagenes[0]) ? s.imagenes[0] : '';
          const sData = JSON.stringify(s).replace(/'/g, '&#39;');
          return `<button class="pd-sim-card" data-product='${sData}' onclick="openProductDetail(JSON.parse(this.dataset.product))">
            <div class="pd-sim-img">${simg ? `<img src="${simg}" alt="${esc(s.nombre)}" loading="lazy">` : `<span class="pd-sim-nophoto">Sin foto</span>`}</div>
            <div class="pd-sim-info">
              ${s.marca ? `<span class="pd-sim-brand">${esc(s.marca)}</span>` : ''}
              <span class="pd-sim-name">${esc(s.nombre)}</span>
              <span class="pd-sim-price">${moneyHTML(s.precio_venta)}</span>
            </div>
          </button>`;
        }).join('')}
      </div>
    </div>` : '';

  document.getElementById('pdBody').innerHTML = `
    <div class="pd-gallery">
      <div class="pd-main-img">
        ${mainImg}
        ${pdImgs.length > 1 ? `
          <button class="pd-nav pd-prev" onclick="pdChg(-1)" aria-label="Anterior">‹</button>
          <button class="pd-nav pd-next" onclick="pdChg(1)" aria-label="Siguiente">›</button>
          <div class="pd-counter"><span id="pdCounter">1</span> / ${pdImgs.length}</div>` : ''}
      </div>
      ${pdImgs.length > 1 ? `<div class="pd-thumbs">${thumbs}</div>` : ''}
    </div>
    <div class="pd-info">
      <div class="pd-info-scroll">
        <div class="pd-head">
          <div class="pd-brand${p.marca ? '' : ' sin-marca'}">${esc(p.marca || SIN_MARCA)}</div>
          <h2 class="pd-name">${esc(p.nombre)}</h2>
          ${cats.length ? `<div class="pd-chips">${catChips}</div>` : ''}
        </div>

        <div class="pd-price">${moneyHTML(p.precio_venta)}</div>

        <div class="pd-specs">
          ${p.talla  ? `<div class="pd-spec"><span class="pd-spec-k">Talla</span><span class="pd-spec-v">${esc(p.talla)}</span></div>`  : ''}
          ${p.estado ? `<div class="pd-spec"><span class="pd-spec-k">Estado</span><span class="pd-spec-v">${esc(p.estado)}</span></div>` : ''}
          <div class="pd-spec"><span class="pd-spec-k">Ubicación</span><span class="pd-spec-v">${esc(pdBazar?.ubicacion || 'Reynosa, Tamps.')}</span></div>
          ${pdBazar ? `<div class="pd-spec"><span class="pd-spec-k">Bazar</span><span class="pd-spec-v"><a class="pd-bazar-link" style="--bz-color:${esc(pdBazar.color || '#2d6be4')}" href="tienda.html?bazar=${encodeURIComponent(pdBazar.slug)}">${esc(pdBazar.nombre)}</a></span></div>` : ''}
        </div>

        ${p.descripcion ? `
        <div class="pd-desc-block">
          <h3 class="pd-desc-title">Descripción</h3>
          <div class="pd-desc">${esc(p.descripcion)}</div>
        </div>` : ''}

        <div class="pd-aviso">
          Prenda de segunda mano, se vende tal como se muestra.
          <b>Sin cambios, devoluciones ni garantía.</b>
          <a href="terminos.html" target="_blank" rel="noopener">Ver términos</a>
        </div>

        <button class="pd-btn-share" onclick="compartirPrenda(this)" data-url="">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Compartir prenda
        </button>

        ${similaresHtml}
      </div>

      <div class="pd-actions">
        <a href="https://wa.me/${whatsappDe(p)}?text=${waMsg}" target="_blank" class="pd-btn-wa">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.138.563 4.144 1.535 5.886L0 24l6.274-1.507A11.944 11.944 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.853 0-3.587-.5-5.084-1.367l-.361-.214-3.733.897.931-3.618-.235-.374A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
          Contactar por WhatsApp
        </a>
        <button class="pd-btn-fav ${favActive}" data-wl-id="${p.id}" data-product='${productData}'>
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  // Zoom con lupa (hover en desktop)
  initPdZoom();

  // Poner la URL en el botón compartir DESPUÉS de renderizar el HTML
  const shareUrl = `${location.origin}/api/prenda?id=${p.id}`;
  const shareBtn = document.querySelector('.pd-btn-share');
  if (shareBtn) shareBtn.dataset.url = shareUrl;

  // Deep link: actualizar URL con el id de la prenda
  history.pushState({ productId: p.id }, '', `?id=${p.id}`);
  document.title = `${p.nombre} · STMP MARKET`;

  // El detalle se tiñe con el color del bazar dueño de la prenda
  const pdDrawerEl = document.getElementById('pdDrawer');
  const colorPd = (pdBazar && pdBazar.color) ? pdBazar.color : '';
  if (colorPd) {
    pdDrawerEl.style.setProperty('--bz-color', colorPd);
    pdDrawerEl.style.setProperty('--bz-gradiente', `linear-gradient(135deg, ${colorPd} 0%, ${aclarar(colorPd, .28)} 100%)`);
    pdDrawerEl.classList.add('pd-con-color');
  } else {
    pdDrawerEl.classList.remove('pd-con-color');
  }

  pdDrawerEl.classList.add('open');
  document.getElementById('pdOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closePD() {
  document.getElementById('pdDrawer').classList.remove('open');
  document.getElementById('pdOverlay').classList.remove('active');
  document.body.style.overflow = '';
  history.pushState({}, '', location.pathname);
  document.title = 'STMP MARKET | Prendas Disponibles';
}

function pdSetImg(idx) {
  pdIdx = idx;
  const el = document.getElementById('pdMainImg');
  if (el) el.src = pdImgs[idx];
  document.querySelectorAll('.pd-thumb').forEach((t, i) => t.classList.toggle('active', i === idx));
  const counter = document.getElementById('pdCounter');
  if (counter) counter.textContent = idx + 1;
}

function pdChg(d) {
  pdSetImg((pdIdx + d + pdImgs.length) % pdImgs.length);
}

// Zoom con lupa al mover el mouse sobre la imagen (solo desktop con hover)
function initPdZoom() {
  const wrap = document.getElementById('pdZoomWrap');
  const img  = document.getElementById('pdMainImg');
  if (!wrap || !img || window.matchMedia('(hover: none)').matches) return;
  const ZOOM = 2.2;
  wrap.addEventListener('mousemove', (e) => {
    const r = wrap.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = ((e.clientY - r.top) / r.height) * 100;
    img.style.transformOrigin = `${x}% ${y}%`;
    img.style.transform = `scale(${ZOOM})`;
  });
  wrap.addEventListener('mouseleave', () => {
    img.style.transform = 'scale(1)';
    img.style.transformOrigin = 'center center';
  });
}

function pdToggleFav(p) {
  toggleWishlist(p);
  // Sync botón dentro del drawer
  const btn = document.querySelector('.pd-btn-fav');
  if (btn) btn.classList.toggle('active', isWishlisted(p.id));
}

// ─── MODAL IMAGEN (ya no se usa desde cards, se mantiene por compatibilidad) ──
let modalImages = [], modalIdx = 0;
function openModal(imgs, idx) {
  modalImages = imgs; modalIdx = idx;
  document.getElementById('modImg').src = imgs[idx] || '';
  document.getElementById('modalOv').classList.add('active');
  document.body.style.overflow = 'hidden';
  const multi = imgs.length > 1;
  document.getElementById('mPrev').style.display = multi ? 'flex' : 'none';
  document.getElementById('mNext').style.display = multi ? 'flex' : 'none';
}
function closeMod() {
  document.getElementById('modalOv')?.classList.remove('active');
  // Solo restaurar scroll si el drawer tampoco está abierto
  if (!document.getElementById('pdDrawer')?.classList.contains('open') &&
      !document.getElementById('wishlistPanel')?.classList.contains('open')) {
    document.body.style.overflow = '';
  }
}
function mChg(d) {
  modalIdx = (modalIdx + d + modalImages.length) % modalImages.length;
  document.getElementById('modImg').src = modalImages[modalIdx] || '';
}

// ─── TOAST ───────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ─── INIT ────────────────────────────────────────────────────
// ─── COMPARTIR ───────────────────────────────────────────────
async function compartirPrenda(btn) {
  const url = btn.dataset.url || location.href;
  const orig = btn.innerHTML;
  await navigator.clipboard.writeText(url).catch(() => {});
  btn.textContent = '✓ Link copiado';
  setTimeout(() => { btn.innerHTML = orig; }, 2000);
}

// ─── DEEP LINK: abrir prenda directo desde URL ?id=X ─────────
// Los enlaces viejos (tienda.html?id=123) siguen funcionando: se redirigen
// a la página completa de la prenda.
async function checkDeepLink() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) return;
  location.replace(`prenda.html?id=${encodeURIComponent(id)}`);
}

// Botón atrás del browser cierra el drawer
window.addEventListener('popstate', () => {
  if (!new URLSearchParams(location.search).get('id')) closePD();
});

// ─── DEEP LINK: filtros y búsqueda desde la URL ──────────────
// inicio.html enlaza aquí con ?cat=, ?marca= o ?q= para abrir el
// catálogo ya filtrado.
let _slugBazarURL = null;   // se resuelve cuando la BD ya cargó

function aplicarFiltrosURL() {
  const params = new URLSearchParams(location.search);

  _slugBazarURL = params.get('bazar');

  const cat = params.get('cat');
  if (cat) filterCat = cat;

  const marca = params.get('marca');
  if (marca) filterBrand = marca;

  const q = params.get('q');
  if (q) {
    searchQuery = q;
    const wrap  = document.getElementById('searchWrap');
    const input = document.getElementById('searchInput');
    if (input) input.value = q;
    if (wrap)  wrap.classList.add('expanded');
  }

  updateActiveFilters();
}

// Cuando entras a ?bazar=slug el catálogo se convierte en el apartado de
// ese bazar: su portada, su descripción y solo sus prendas.
function aplicarBazarURL() {
  if (!_slugBazarURL) return;
  const b = getBazarBySlug(_slugBazarURL);
  if (!b || b.activo === false) return;

  filterBazar = b.id;
  pintarPortadaBazar(b);
  document.title = `${b.nombre} · STMP MARKET`;

  // El apartado del bazar se divide en tres pestañas
  document.getElementById('bzTabsWrap')?.classList.remove('hidden');
  actualizarContadoresBazar();
  setBazarTab('disponibles');
}

// ─── COLOR DEL BAZAR ─────────────────────────────────────────
// Dentro del apartado de un bazar, su color reemplaza al azul del sitio:
// tiñe el ticker, los precios, los filtros, los botones y los acentos.
function _hexARgb(hex) {
  const c = String(hex || '').trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(c)) return null;
  return [parseInt(c.slice(0,2),16), parseInt(c.slice(2,4),16), parseInt(c.slice(4,6),16)];
}
function _mezclar(hex, con, cantidad) {
  const rgb = _hexARgb(hex);
  if (!rgb) return hex;
  const m = rgb.map(v => Math.round(v + (con - v) * cantidad));
  return '#' + m.map(v => v.toString(16).padStart(2, '0')).join('');
}
const aclarar  = (hex, n) => _mezclar(hex, 255, n);
const oscurecer = (hex, n) => _mezclar(hex, 0, n);
function _rgba(hex, alfa) {
  const rgb = _hexARgb(hex);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alfa})` : hex;
}

function aplicarColorBazar(color) {
  const rgb = _hexARgb(color);
  if (!rgb) return;

  const raiz  = document.documentElement;
  const claro = aclarar(color, .28);
  const hondo = oscurecer(color, .55);

  raiz.style.setProperty('--bz-color', color);
  raiz.style.setProperty('--accent',  color);
  raiz.style.setProperty('--accent2', claro);
  raiz.style.setProperty('--accent-gradient', `linear-gradient(135deg, ${color} 0%, ${claro} 100%)`);
  raiz.style.setProperty('--hero-gradient', `linear-gradient(160deg, ${hondo} 0%, ${oscurecer(color,.2)} 60%, ${claro} 100%)`);
  raiz.style.setProperty('--bg-gradient', `linear-gradient(135deg, #f7f4ef 0%, ${aclarar(color,.92)} 50%, #e8e2d8 100%)`);
  raiz.style.setProperty('--bz-tinte-suave', _rgba(color, .10));
  raiz.style.setProperty('--bz-tinte-borde', _rgba(color, .24));
  document.body.classList.add('bz-tema');

  // Color de la barra del navegador en el celular
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', color);
}

function pintarPortadaBazar(b) {
  const hero = document.querySelector('.hero');
  if (!hero) return;

  const wrap = hero.querySelector('.h-wrap') || hero;
  const wa   = String(b.whatsapp || '').replace(/[^0-9]/g, '');
  const logo = b.logo || b.portada || '';
  const n    = getDB().filter(p => !p.vendido && !p.oculto &&
                Number(p.bazarId || 1) === Number(b.id)).length;
  // La reputación va junto al perfil: es lo primero que mira un comprador
  const rating = (typeof ratingDeBazar === 'function') ? ratingDeBazar(b.id) : { promedio: 0, total: 0 };

  // El bazar manda en su apartado: su color tiñe los acentos y su banner
  // se usa de fondo.
  hero.classList.add('bz-hero');
  if (b.color) {
    hero.style.setProperty('--bz-color', b.color);
    aplicarColorBazar(b.color);
  }
  if (b.banner) {
    hero.style.setProperty('--bz-banner', `url("${b.banner.replace(/"/g, '%22')}")`);
    hero.classList.add('has-banner');
  }

  wrap.innerHTML = `
    <a href="tienda.html" class="h-crumb">
      <svg viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
      Ver todos los bazares
    </a>
    <div class="bz-head">
      ${logo ? `<img class="bz-logo" src="${imgOptimizada(logo, 340)}" alt="Logo de ${esc(b.nombre)}">`
             : `<div class="bz-logo bz-logo-txt">${esc((b.nombre || '?').charAt(0))}</div>`}
      <div class="bz-head-info">
        <div class="bz-slug">@${esc(b.slug)}</div>
        <h2>${esc(b.nombre)}</h2>
        ${b.descripcion ? `<p>${esc(b.descripcion)}</p>` : ''}
        <div class="bz-meta">
          <span class="bz-meta-item"><b>${n}</b> prenda${n !== 1 ? 's' : ''} disponible${n !== 1 ? 's' : ''}</span>
          ${rating.total ? `<span class="bz-meta-item bz-meta-rating">
            ${estrellasHTML(rating.promedio, 'st-estrellas bz-rating-estrellas')}
            <b>${rating.promedio.toFixed(1)}</b> / 5.0
            <span class="bz-rating-total">(${rating.total})</span>
          </span>` : ''}
          ${b.ubicacion ? `<span class="bz-meta-item">${esc(b.ubicacion)}</span>` : ''}
        </div>
        <div class="bz-links">
          ${wa ? `<a class="bz-link bz-link-cta" href="https://wa.me/${wa}" target="_blank" rel="noopener">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 2.138.558 4.147 1.535 5.886L0 24l6.274-1.507A11.944 11.944 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.853 0-3.587-.5-5.084-1.367l-.361-.214-3.733.897.931-3.618-.235-.374A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
            Escribir por WhatsApp</a>` : ''}
          ${b.instagram ? `<a class="bz-link" href="https://www.instagram.com/${esc(String(b.instagram).replace(/^@/, ''))}" target="_blank" rel="noopener">Instagram</a>` : ''}
        </div>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   PESTAÑAS DEL BAZAR — Disponibles · Vendidos · Reseñas
   El catálogo activo no se mezcla con lo que ya salió: cada cosa
   tiene su pestaña bajo el perfil del bazar.
   ═══════════════════════════════════════════════════════════ */
let bazarTab = 'disponibles';

// Las prendas del bazar que se está viendo
function prendasDelBazar() {
  if (!filterBazar) return [];
  return getDB().filter(p => Number(p.bazarId || 1) === Number(filterBazar) && !p.oculto);
}

function setBazarTab(tab) {
  if (!filterBazar) return;
  bazarTab = tab;

  ['disponibles', 'vendidos', 'resenas'].forEach(t => {
    const btn = document.getElementById('bzTab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) {
      btn.classList.toggle('active', t === tab);
      btn.setAttribute('aria-selected', String(t === tab));
    }
  });

  // El catálogo activo trae su barra de filtros; las otras dos no
  const esCatalogo = tab === 'disponibles';
  document.querySelector('.shop-toolbar')?.classList.toggle('hidden', !esCatalogo);
  document.querySelector('.shop-layout')?.classList.toggle('hidden', !esCatalogo);
  document.getElementById('shopPaginacion')?.classList.toggle('hidden', !esCatalogo);
  document.querySelector('.cat-nav')?.classList.toggle('hidden', !esCatalogo);

  document.getElementById('bzPanelVendidos')?.classList.toggle('hidden', tab !== 'vendidos');
  document.getElementById('bzPanelResenas')?.classList.toggle('hidden', tab !== 'resenas');

  if (tab === 'vendidos') renderBazarVendidos();
  if (tab === 'resenas')  renderBazarResenas();
}

// Cuenta de cada pestaña, siempre a la vista
function actualizarContadoresBazar() {
  if (!filterBazar) return;
  const prendas = prendasDelBazar();
  const disp = prendas.filter(p => !p.vendido).length;
  const vend = prendas.filter(p =>  p.vendido).length;
  const res  = (typeof resenasDeBazar === 'function' ? resenasDeBazar(filterBazar) : []).length;

  const set = (id, n) => { const e = document.getElementById(id); if (e) e.textContent = n; };
  set('bzNDisponibles', disp);
  set('bzNVendidos', vend);
  set('bzNResenas', res);
}

// ── Pestaña "Vendidos": el archivo público de ventas ─────────
function renderBazarVendidos() {
  const cont = document.getElementById('bzVendidosCont');
  if (!cont) return;

  const vendidas = prendasDelBazar()
    .filter(p => p.vendido)
    .sort((a, b) => new Date(b.vendidoEn || 0) - new Date(a.vendidoEn || 0));

  if (!vendidas.length) {
    cont.innerHTML = `<div class="empty">
      <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      <div class="empty-title">Todavía sin ventas</div>
      <div class="empty-sub">Cuando este bazar entregue su primera prenda, aparecerá aquí.</div>
    </div>`;
    return;
  }

  cont.innerHTML = `
    <div class="bz-panel-head">
      <h3>Historial de ventas</h3>
      <p>${vendidas.length} prenda${vendidas.length !== 1 ? 's' : ''} entregada${vendidas.length !== 1 ? 's' : ''} por este bazar.</p>
    </div>
    <div class="grid bz-grid-vendidos">
      ${vendidas.map(tarjetaVendida).join('')}
    </div>`;
}

function tarjetaVendida(p) {
  const imgs = Array.isArray(p.imagenes) ? p.imagenes : [];
  const img  = imgs[0]
    ? `<img src="${imgOptimizada(imgs[0], 500)}" alt="${esc(p.nombre)}" loading="lazy" decoding="async">`
    : `<div class="no-photo">Sin foto</div>`;
  const fecha = p.vendidoEn
    ? new Date(p.vendidoEn).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  return `<article class="card card-vendida">
    <div class="card-img">
      ${img}
      <div class="card-vendida-sello">Vendido</div>
    </div>
    <div class="card-body">
      <div class="card-name">${esc(p.nombre)}</div>
      <div class="card-meta">Talla ${esc(p.talla || '–')}${p.marca ? ' · ' + esc(p.marca) : ''}</div>
      <div class="card-vendida-a">
        ${p.vendidoA
          ? `Vendido a <b>@${esc(p.vendidoA)}</b>`
          : 'Prenda entregada'}
      </div>
      ${fecha ? `<div class="card-vendida-fecha">${esc(fecha)}</div>` : ''}
    </div>
  </article>`;
}

// ── Pestaña "Reseñas": la reputación del bazar ───────────────
function renderBazarResenas() {
  const cont = document.getElementById('bzResenasCont');
  if (!cont) return;

  const lista  = (typeof resenasDeBazar === 'function' ? resenasDeBazar(filterBazar) : [])
    .slice().sort((a, b) => new Date(b.creadoEn || 0) - new Date(a.creadoEn || 0));
  const rating = (typeof ratingDeBazar === 'function') ? ratingDeBazar(filterBazar) : { promedio: 0, total: 0 };

  if (!lista.length) {
    cont.innerHTML = `<div class="empty">
      <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      <div class="empty-title">Sin reseñas todavía</div>
      <div class="empty-sub">Los compradores califican al bazar desde su cuenta después de recibir la prenda.</div>
    </div>`;
    return;
  }

  // Cuántas reseñas hay de cada puntuación, para la barra de la izquierda
  const conteo = [0, 0, 0, 0, 0];
  lista.forEach(r => {
    const n = Math.round(Number(r.estrellas) || 0);
    if (n >= 1 && n <= 5) conteo[n - 1]++;
  });

  const barras = [5, 4, 3, 2, 1].map(n => {
    const c   = conteo[n - 1];
    const pct = rating.total ? Math.round((c / rating.total) * 100) : 0;
    return `<div class="rs-barra">
      <span class="rs-barra-n">${n} ★</span>
      <span class="rs-barra-riel"><span class="rs-barra-relleno" style="width:${pct}%"></span></span>
      <span class="rs-barra-c">${c}</span>
    </div>`;
  }).join('');

  cont.innerHTML = `
    <div class="rs-resumen">
      <div class="rs-nota">
        <div class="rs-nota-num">${rating.promedio.toFixed(1)}</div>
        ${estrellasHTML(rating.promedio, 'st-estrellas rs-nota-estrellas')}
        <div class="rs-nota-total">${rating.total} reseña${rating.total !== 1 ? 's' : ''}</div>
      </div>
      <div class="rs-barras">${barras}</div>
    </div>

    <div class="rs-lista">
      ${lista.map(tarjetaResena).join('')}
    </div>`;
}

function tarjetaResena(r) {
  const fecha = r.creadoEn
    ? new Date(r.creadoEn).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  const inicial = (r.autor || '?').charAt(0).toUpperCase();

  return `<article class="rs-card">
    <div class="rs-card-head">
      <span class="rs-avatar">${esc(inicial)}</span>
      <div class="rs-card-quien">
        <div class="rs-autor">@${esc(r.autor || 'comprador')}</div>
        ${r.prendaNombre ? `<div class="rs-prenda">sobre ${esc(r.prendaNombre)}</div>` : ''}
      </div>
      ${estrellasHTML(r.estrellas, 'st-estrellas rs-card-estrellas')}
    </div>
    ${r.comentario ? `<p class="rs-comentario">${esc(r.comentario)}</p>` : ''}
    ${Array.isArray(r.etiquetas) && r.etiquetas.length
      ? `<div class="rs-etiquetas">${r.etiquetas.map(e => `<span class="rs-etiqueta">${esc(e)}</span>`).join('')}</div>`
      : ''}
    ${fecha ? `<div class="rs-fecha">${esc(fecha)}</div>` : ''}
  </article>`;
}

// Las reseñas y el inventario llegan por el poll: si estoy viendo una de
// esas pestañas, se repinta sola.
window.addEventListener('db:resenas', () => {
  if (!filterBazar) return;
  actualizarContadoresBazar();
  if (bazarTab === 'resenas') renderBazarResenas();
});
window.addEventListener('db:inventario', () => {
  if (!filterBazar) return;
  actualizarContadoresBazar();
  if (bazarTab === 'vendidos') renderBazarVendidos();
});

document.addEventListener('DOMContentLoaded', async () => {
  renderSkeletons();          // placeholders mientras carga la BD
  aplicarFiltrosURL();
  await waitForDB();
  aplicarBazarURL();
  buildDropdowns();
  buildShopFilters();
  renderGrid();
  updateWishlistBadge();
  checkDeepLink();

  // Event delegation en el grid — evita conflictos entre card-img y card-fav-btn
  document.getElementById('productGrid').addEventListener('click', e => {
    // Clic en el botón corazón
    const favBtn = e.target.closest('.card-fav-btn');
    if (favBtn) {
      e.stopPropagation();
      const product = JSON.parse(favBtn.dataset.product);
      toggleWishlist(product);
      return;
    }
    // Clic en la card (pero no en el botón corazón) → abre detalle
    const card = e.target.closest('.card');
    if (card && !e.target.closest('.btn-contact')) {
      const data = JSON.parse(card.dataset.product || '{}');
      openProductDetail(data);
    }
  });

  document.getElementById('pdDrawer').addEventListener('click', e => {
    const favBtn = e.target.closest('.pd-btn-fav');
    if (favBtn) {
      const product = JSON.parse(favBtn.dataset.product);
      toggleWishlist(product);
      favBtn.classList.toggle('active', isWishlisted(product.id));
      // Sync corazón en la card del grid
      document.querySelectorAll(`[data-wl-id="${product.id}"]`).forEach(b => {
        if (!b.classList.contains('pd-btn-fav'))
          b.classList.toggle('active', isWishlisted(product.id));
      });
    }
  });

  // Ocultar/mostrar nav al hacer scroll
  let lastY = 0;
  window.addEventListener('scroll', () => {
    const y   = window.scrollY;
    const nav = document.querySelector('.cat-nav');
    if (!nav) return;
    if (y > lastY && y > 80) {
      nav.classList.add('nav-hidden');
      document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
    } else {
      nav.classList.remove('nav-hidden');
    }
    lastY = y;
  }, { passive: true });

  let searchTimer;
  const input = document.getElementById('searchInput');
  if (input) {
    input.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => renderGrid(this.value), 250);
    });
  }
});

window.addEventListener('db:inventario', () => {
  renderGrid();
  buildDropdowns();
  buildShopFilters();
});

// ── SUBASTAS ────────────────────────────────────────────────
// Ofertar sin salir del catálogo: el panel es el mismo de la ficha,
// dentro de un modal (js/subasta.js).
function abrirSubasta(prendaId) {
  const p = (typeof getDB === 'function' ? getDB() : []).find(x => Number(x.id) === Number(prendaId));
  if (!p) { if (typeof aviso === 'function') aviso('No se encontró la prenda'); return; }
  if (typeof Subasta === 'undefined') { location.href = 'prenda.html?id=' + encodeURIComponent(prendaId); return; }
  Subasta.abrirModal(p);
}

// Una oferta hecha desde el modal cambia el precio que enseñan las
// tarjetas, así que el catálogo se repinta al vuelo.
window.addEventListener('subasta:oferta', () => {
  if (typeof pollAhora === 'function') pollAhora(400);
});
