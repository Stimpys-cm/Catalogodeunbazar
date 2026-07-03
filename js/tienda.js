// js/tienda.js

let filterCat   = null;
let filterBrand = null;
let searchQuery = '';

// ─── Estado de filtros del sidebar + orden ───────────────────
const shopFilters = { tallas:new Set(), marcas:new Set(), estados:new Set(), maxPrecio:Infinity };
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
    wrap.classList.add('expanded');
    setTimeout(() => input.focus(), 50);
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
function updateWishlistBadge() {
  const count = getWishlist().length;
  const badge = document.getElementById('wishlistCount');
  const panelCount = document.getElementById('wishlistPanelCount');
  if (!badge) return;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
  if (panelCount) panelCount.textContent = count;
  const bn = document.getElementById('bnWlCount');
  if (bn) { bn.textContent = count; bn.style.display = count > 0 ? 'flex' : 'none'; }
}

// ─── PANEL WISHLIST ───────────────────────────────────────────
function toggleWishlistPanel() {
  const panel   = document.getElementById('wishlistPanel');
  const overlay = document.getElementById('wishlistOverlay');
  const isOpen  = panel.classList.contains('open');
  if (isOpen) {
    closeWishlistPanel();
  } else {
    renderWishlistPanel();
    panel.classList.add('open');
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}
function closeWishlistPanel() {
  document.getElementById('wishlistPanel')?.classList.remove('open');
  document.getElementById('wishlistOverlay')?.classList.remove('active');
  document.body.style.overflow = '';
}
function renderWishlistPanel() {
  const list    = getWishlist();
  const body    = document.getElementById('wishlistPanelBody');
  const footer  = document.getElementById('wishlistPanelFooter');
  const btnTodo = document.getElementById('wlBtnTodo');
  if (!body) return;

  if (!list.length) {
    body.innerHTML = '<div class="wishlist-empty">No tienes prendas guardadas aún.<br><br>Toca el ❤️ en cualquier prenda.</div>';
    if (footer) footer.style.display = 'none';
    return;
  }

  // Mostrar botón "Preguntar por todo" con mensaje armado
  if (footer) footer.style.display = 'block';
  if (btnTodo) {
    const todoMsg = encodeURIComponent(
      'Hola! Me interesan estas prendas:\n\n' +
      list.map((p, i) =>
        `${i + 1}. ${p.nombre} · Talla ${p.talla || '–'} · $${p.precio_venta}`
      ).join('\n') +
      '\n\n¿Están disponibles?'
    );
    btnTodo.href = `https://wa.me/528995284602?text=${todoMsg}`;
  }

  body.innerHTML = list.map(p => {
    const img = Array.isArray(p.imagenes) && p.imagenes[0]
      ? `<img class="wl-item-img" src="${p.imagenes[0]}" alt="${p.nombre}" loading="lazy">`
      : `<div class="wl-item-img" style="display:flex;align-items:center;justify-content:center;font-size:10px;color:#aaa">Sin foto</div>`;
    const waMsg = encodeURIComponent(`Hola! Me interesa: ${p.nombre} · Talla ${p.talla} · $${p.precio_venta}`);
    // Serializar datos del producto de forma segura para el onclick
    const pData = JSON.stringify(p).replace(/\\/g, '\\\\').replace(/`/g, '\\`');
    return `<div class="wl-item" onclick="(function(e){
        if(e.target.closest('.wl-btn-wa')||e.target.closest('.wl-btn-remove'))return;
        closeWishlistPanel();
        setTimeout(()=>openProductDetail(${pData.replace(/'/g, "\\'")}),320);
      })(event)">
      ${img}
      <div class="wl-item-info">
        <div class="wl-item-name">${p.nombre}</div>
        <div class="wl-item-sub">Talla ${p.talla||'–'} · ${p.estado||''}</div>
        <span class="wl-item-price">$${p.precio_venta}</span>
        <div class="wl-item-actions">
          <a href="https://wa.me/528995284602?text=${waMsg}" target="_blank" class="wl-btn-wa">WhatsApp</a>
          <button class="wl-btn-remove" onclick="removeFromWishlist('${p.id}')" aria-label="Eliminar">✕</button>
        </div>
      </div>
    </div>`;
  }).join('');
}
function removeFromWishlist(id) {
  const list = getWishlist().filter(i => String(i.id) !== String(id) && String(i._id) !== String(id));
  saveWishlist(list);
  updateWishlistBadge();
  renderWishlistPanel();
  document.querySelectorAll(`[data-wl-id="${id}"]`).forEach(btn => btn.classList.remove('active'));
}

// ─── POBLAR DROPDOWNS ────────────────────────────────────────
function buildDropdowns() {
  const cats   = getCats();
  const brands = getBrands();

  document.getElementById('dropCatsList').innerHTML =
    `<a class="drop-link ${!filterCat?'active':''}" onclick="setFilterCat(null)">Todas las categorías</a>` +
    cats.map(c =>
      `<a class="drop-link ${filterCat===c.nombre?'active':''}" onclick="setFilterCat('${c.nombre}')">${c.nombre}</a>`
    ).join('');

  const bl = document.getElementById('dropBrandsList');
  bl.className = 'drop-inner' + (brands.length > 8 ? ' drop-cols' : '');
  bl.innerHTML =
    `<a class="drop-link ${!filterBrand?'active':''}" onclick="setFilterBrand(null)">Todas las marcas</a>` +
    brands.map(b =>
      `<a class="drop-link ${filterBrand===b.nombre?'active':''}" onclick="setFilterBrand('${b.nombre}')">${b.nombre}</a>`
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
  const wrap  = document.getElementById('activeFilters');
  const clear = document.getElementById('clearFiltersBtn');
  const chips = [];
  if (filterCat)   chips.push(`<span class="filter-chip">${filterCat} <button onclick="setFilterCat(null)">✕</button></span>`);
  if (filterBrand) chips.push(`<span class="filter-chip">${filterBrand} <button onclick="setFilterBrand(null)">✕</button></span>`);
  wrap.innerHTML = chips.join('');
  clear.classList.toggle('hidden', chips.length === 0);
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
const money = n => '$' + Number(n||0).toLocaleString('es-MX');

// ─── RENDER GRID ─────────────────────────────────────────────
function renderGrid(query) {
  if (query !== undefined) searchQuery = query;
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

  // Filtros del sidebar
  if (shopFilters.tallas.size)  items = items.filter(p => shopFilters.tallas.has(String(p.talla)));
  if (shopFilters.marcas.size)  items = items.filter(p => shopFilters.marcas.has(p.marca));
  if (shopFilters.estados.size) items = items.filter(p => shopFilters.estados.has(p.estado));
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
    grid.innerHTML = '<div class="empty">No hay prendas con esos filtros</div>';
    return;
  }

  grid.innerHTML = items.map(p => {
    const imgs    = Array.isArray(p.imagenes) ? p.imagenes : [];
    const imgHtml = imgs[0]
      ? `<img src="${imgs[0]}" alt="${p.nombre}" loading="lazy">`
      : `<div class="no-photo">Sin foto</div>`;
    const marcaTag  = p.marca ? `<div class="brand-tag">${p.marca}</div>` : '';
    const waMsg     = encodeURIComponent(`Hola! Me interesa: ${p.nombre} · Talla ${p.talla} · $${p.precio_venta}`);
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
      imagenes: imgs
    }).replace(/'/g, '&#39;');

    return `<div class="card" data-product='${productData}' style="cursor:pointer">
      <div class="card-img">
        ${imgHtml}${marcaTag}
        <button class="card-fav-btn ${favActive}" data-wl-id="${favId}" data-product='${productData}'
          aria-label="Guardar en wishlist">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>
        <a href="https://wa.me/528995284602?text=${waMsg}" target="_blank" class="card-quick" onclick="event.stopPropagation()">
          Contactar por WhatsApp
        </a>
      </div>
      <div class="card-body" data-marca="${p.marca||''}">
        <div class="card-row">
          <div class="card-titles">
            <div class="card-brand">${p.marca||''}</div>
            <div class="card-name">${p.nombre}</div>
          </div>
          <div class="card-price">$${p.precio_venta}</div>
        </div>
        <div class="card-sub"><span class="size-tag">Talla ${p.talla||'–'}</span>${p.estado?' · '+p.estado:''}</div>
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
}

// ─── SIDEBAR DE FILTROS: construir + conectar ────────────────
function buildShopFilters() {
  const all = getDB().filter(p => !p.vendido && !p.oculto);
  const tallas  = [...new Set(all.map(p=>String(p.talla)).filter(Boolean))].sort((a,b)=> (parseFloat(a)-parseFloat(b)) || a.localeCompare(b));
  const marcas  = [...new Set(all.map(p=>p.marca).filter(Boolean))].sort();
  const estados = [...new Set(all.map(p=>p.estado).filter(Boolean))].sort();
  const precios = all.map(p=>Number(p.precio_venta)).filter(n=>!isNaN(n));
  shopPriceMax  = precios.length ? Math.max(...precios) : 0;
  if (shopFilters.maxPrecio === Infinity) shopFilters.maxPrecio = shopPriceMax;

  const checkList = (title,key,vals) => !vals.length ? '' : `
    <div class="fblock">
      <button class="ftoggle" type="button"><span class="lbl">${title}</span>
        <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>
      <div class="freveal"><div>${vals.map(v=>`
        <label class="fcheck">
          <input type="checkbox" class="fchk" data-key="${key}" data-val="${v}" ${shopFilters[key].has(v)?'checked':''}>
          <span class="fbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg></span>
          <span class="ftxt">${v}</span>
        </label>`).join('')}</div></div>
    </div>`;

  const tallasHtml = !tallas.length ? '' : `
    <div class="fblock">
      <button class="ftoggle" type="button"><span class="lbl">Talla</span>
        <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>
      <div class="freveal"><div class="fpills">${tallas.map(t=>`<button type="button" class="fpill ${shopFilters.tallas.has(t)?'active':''}" data-key="tallas" data-val="${t}">${t}</button>`).join('')}</div></div>
    </div>`;

  const priceHtml = !shopPriceMax ? '' : `
    <div class="fblock">
      <button class="ftoggle" type="button"><span class="lbl">Precio</span>
        <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button>
      <div class="freveal"><div class="fprice">
        <input type="range" class="fprice-range" min="0" max="${shopPriceMax}" step="10" value="${shopFilters.maxPrecio===Infinity?shopPriceMax:shopFilters.maxPrecio}">
        <div class="fprice-labels"><span>$0</span><span>Hasta <b class="fprice-val">${money(shopFilters.maxPrecio===Infinity?shopPriceMax:shopFilters.maxPrecio)}</b></span></div>
      </div></div>
    </div>`;

  const html = tallasHtml + checkList('Marca','marcas',marcas) + priceHtml + checkList('Condición','estados',estados);
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
  if (range) range.oninput = ()=>{ shopFilters.maxPrecio = Number(range.value); syncShopFilters(); renderGrid(); };
}
function toggleShopSet(key,val){ shopFilters[key].has(val) ? shopFilters[key].delete(val) : shopFilters[key].add(val); }
function syncShopFilters(){
  document.querySelectorAll('.fchk').forEach(c=> c.checked = shopFilters[c.dataset.key].has(c.dataset.val));
  document.querySelectorAll('.fpill').forEach(p=> p.classList.toggle('active', shopFilters[p.dataset.key].has(p.dataset.val)));
  document.querySelectorAll('.fprice-range').forEach(r=> r.value = shopFilters.maxPrecio);
  document.querySelectorAll('.fprice-val').forEach(v=> v.textContent = money(shopFilters.maxPrecio));
}
function clearShopFilters(){
  shopFilters.tallas.clear(); shopFilters.marcas.clear(); shopFilters.estados.clear();
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

function openProductDetail(p) {
  pdImgs = Array.isArray(p.imagenes) ? p.imagenes : [];
  pdIdx  = 0;
  const favActive = isWishlisted(p.id) ? 'active' : '';
  const cats      = Array.isArray(p.categorias) ? p.categorias : [];
  const catChips  = cats.map(c => `<span class="cat-chip">${c}</span>`).join('');
  const waMsg     = encodeURIComponent(`Hola! Me interesa: ${p.nombre} · Talla ${p.talla} · $${p.precio_venta}`);
  const productData = JSON.stringify(p).replace(/'/g, '&#39;');

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
            <div class="pd-sim-img">${simg ? `<img src="${simg}" alt="${s.nombre}" loading="lazy">` : `<span class="pd-sim-nophoto">Sin foto</span>`}</div>
            <div class="pd-sim-info">
              ${s.marca ? `<span class="pd-sim-brand">${s.marca}</span>` : ''}
              <span class="pd-sim-name">${s.nombre}</span>
              <span class="pd-sim-price">$${s.precio_venta}</span>
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
          ${p.marca ? `<div class="pd-brand">${p.marca}</div>` : ''}
          <h2 class="pd-name">${p.nombre}</h2>
          ${cats.length ? `<div class="pd-chips">${catChips}</div>` : ''}
        </div>

        <div class="pd-price">$${p.precio_venta}</div>

        <div class="pd-specs">
          ${p.talla  ? `<div class="pd-spec"><span class="pd-spec-k">Talla</span><span class="pd-spec-v">${p.talla}</span></div>`  : ''}
          ${p.estado ? `<div class="pd-spec"><span class="pd-spec-k">Estado</span><span class="pd-spec-v">${p.estado}</span></div>` : ''}
          <div class="pd-spec"><span class="pd-spec-k">Ubicación</span><span class="pd-spec-v">Reynosa, Tamps.</span></div>
        </div>

        ${p.descripcion ? `
        <div class="pd-desc-block">
          <h3 class="pd-desc-title">Descripción</h3>
          <div class="pd-desc">${p.descripcion}</div>
        </div>` : ''}

        <button class="pd-btn-share" onclick="compartirPrenda(this)" data-url="">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Compartir prenda
        </button>

        ${similaresHtml}
      </div>

      <div class="pd-actions">
        <a href="https://wa.me/528995284602?text=${waMsg}" target="_blank" class="pd-btn-wa">
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
  document.title = `${p.nombre} · Bazar En Linea`;

  document.getElementById('pdDrawer').classList.add('open');
  document.getElementById('pdOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closePD() {
  document.getElementById('pdDrawer').classList.remove('open');
  document.getElementById('pdOverlay').classList.remove('active');
  document.body.style.overflow = '';
  history.pushState({}, '', location.pathname);
  document.title = 'Bazar En Linea | Prendas Disponibles';
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
async function checkDeepLink() {
  const id = parseInt(new URLSearchParams(location.search).get('id'));
  if (!id) return;
  const p = getDB().find(x => x.id === id);
  if (p) openProductDetail(p);
}

// Botón atrás del browser cierra el drawer
window.addEventListener('popstate', () => {
  if (!new URLSearchParams(location.search).get('id')) closePD();
});

document.addEventListener('DOMContentLoaded', async () => {
  await waitForDB();
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
