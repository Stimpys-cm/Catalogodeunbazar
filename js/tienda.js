// tienda.js

let filterCat   = null;
let filterBrand = null;
let searchQuery = '';

// ─── DROPDOWNS ───────────────────────────────────────────────
function toggleDrop(id) {
  const drop = document.getElementById(id);
  const isOpen = drop.classList.contains('open');
  // cerrar todos
  document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
  if (!isOpen) drop.classList.add('open');
}

// Cerrar dropdowns al hacer clic fuera
document.addEventListener('click', e => {
  if (!e.target.closest('.nav-item')) {
    document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
  }
});

// ─── POBLAR DROPDOWNS ────────────────────────────────────────
function buildDropdowns() {
  const cats   = getCats();
  const brands = getBrands();

  // Categorías
  const catList = document.getElementById('dropCatsList');
  catList.innerHTML = `<a class="drop-link ${!filterCat?'active':''}" onclick="setFilterCat(null)">Todas las categorías</a>` +
    cats.map(c =>
      `<a class="drop-link ${filterCat===c.nombre?'active':''}" onclick="setFilterCat('${c.nombre}')">${c.nombre}</a>`
    ).join('');

  // Marcas — columnas si hay muchas
  const brandList = document.getElementById('dropBrandsList');
  brandList.className = 'drop-inner' + (brands.length > 8 ? ' drop-cols' : '');
  brandList.innerHTML = `<a class="drop-link ${!filterBrand?'active':''}" onclick="setFilterBrand(null)">Todas las marcas</a>` +
    brands.map(b =>
      `<a class="drop-link ${filterBrand===b.nombre?'active':''}" onclick="setFilterBrand('${b.nombre}')">${b.nombre}</a>`
    ).join('');
}

// ─── FILTROS ─────────────────────────────────────────────────
function setFilterCat(cat) {
  filterCat = cat;
  document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
  updateActiveFilters();
  renderGrid();
  buildDropdowns();
}

function setFilterBrand(brand) {
  filterBrand = brand;
  document.querySelectorAll('.nav-dropdown').forEach(d => d.classList.remove('open'));
  updateActiveFilters();
  renderGrid();
  buildDropdowns();
}

function clearFilters() {
  filterCat = null;
  filterBrand = null;
  updateActiveFilters();
  renderGrid();
  buildDropdowns();
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

// ─── RENDER GRID ─────────────────────────────────────────────
function renderGrid(query) {
  if (query !== undefined) searchQuery = query;

  const inventario = getDB();
  let items = inventario.filter(p => !p.vendido);

  // Filtro búsqueda
  const q = searchQuery.toLowerCase().trim();
  if (q) items = items.filter(p =>
    (p.nombre||'').toLowerCase().includes(q) ||
    (p.marca||'').toLowerCase().includes(q) ||
    (p.estado||'').toLowerCase().includes(q) ||
    (p.talla||'').toLowerCase().includes(q) ||
    (Array.isArray(p.categorias)?p.categorias:[]).some(c=>c.toLowerCase().includes(q))
  );

  // Filtro categoría
  if (filterCat) items = items.filter(p =>
    Array.isArray(p.categorias) && p.categorias.includes(filterCat)
  );

  // Filtro marca
  if (filterBrand) items = items.filter(p => p.marca === filterBrand);

  const grid  = document.getElementById('productGrid');
  const label = document.getElementById('countLabel');
  label.innerHTML = `<span class="count">${items.length}</span> resultado${items.length!==1?'s':''}`;

  if (!items.length) {
    grid.innerHTML = '<div class="empty">No hay prendas disponibles</div>';
    return;
  }

  grid.innerHTML = items.map(p => {
    const imgs  = Array.isArray(p.imagenes) ? p.imagenes : [];
    const first = imgs[0] || null;
    const imgHtml = first
      ? `<img src="${first}" alt="${p.nombre}" loading="lazy">`
      : `<div class="no-photo">Sin foto</div>`;

    // Etiqueta de marca
    const marcaTag = p.marca
      ? `<div class="brand-tag">${p.marca}</div>` : '';

    // Chips de categorías
    const cats = Array.isArray(p.categorias) ? p.categorias : [];
    const catChips = cats.map(c => `<span class="cat-chip">${c}</span>`).join('');

    const waMsg = encodeURIComponent(`Hola! Me interesa: ${p.nombre} · Talla ${p.talla} · $${p.precio_venta}`);

    return `<div class="card">
      <div class="card-img" onclick='openModal(${JSON.stringify(imgs)}, 0)' style="cursor:zoom-in">
        ${imgHtml}${marcaTag}
      </div>
      <div class="card-body">
        <div class="card-name">${p.nombre}</div>
        <div class="card-chips">${catChips}</div>
        <div class="card-sub">Talla ${p.talla||'–'} · ${p.estado||''}</div>
        <div class="card-price">$${p.precio_venta}</div>
        <a href="https://wa.me/528995284602?text=${waMsg}" target="_blank" class="btn-contact">
          Contactar por WhatsApp
        </a>
      </div>
    </div>`;
  }).join('');
}

// modal re-usa mChg de db.js pero con variable local
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
function mChg(d) {
  modalIdx = (modalIdx + d + modalImages.length) % modalImages.length;
  document.getElementById('modImg').src = modalImages[modalIdx] || '';
}

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  buildDropdowns();
  renderGrid();

  let searchTimer;
  const input = document.getElementById('searchInput');
  if (input) {
    input.addEventListener('input', function() {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => renderGrid(this.value), 250);
    });
  }
});

window.addEventListener('storage', e => {
  if (e.key === DB_KEY || e.key === CATS_KEY || e.key === BRANDS_KEY) {
    buildDropdowns();
    renderGrid();
  }
});
