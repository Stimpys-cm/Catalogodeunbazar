// js/admin.js

if (!isLoggedIn()) window.location.href = 'login.html';
const session = getSession();

function logout() { removeMyActivity(); clearSession(); window.location.href = 'login.html'; }

// Cierre forzado: cuando la cuenta inició sesión en otro dispositivo.
// NO llamamos removeMyActivity() para no borrar la actividad de la sesión
// nueva (que ahora es la legítima). Solo limpiamos esta sesión local.
let _kicked = false;
function forceLogout() {
  if (_kicked) return;
  _kicked = true;
  toast('Tu cuenta inició sesión en otro dispositivo');
  clearSession();
  setTimeout(() => { window.location.href = 'login.html'; }, 1500);
}

// ─── TABS ────────────────────────────────────────────────────
let currentTab = 'inventario';

// Pestañas válidas y las que requieren admin
const TABS_VALIDAS   = ['inventario','registrar','catalogo','vendedores','drops','cuenta'];
const TABS_SOLO_ADMIN = ['vendedores','catalogo','drops'];

function showTab(tab, fromHash) {
  if (TABS_SOLO_ADMIN.includes(tab) && !isAdmin()) return;
  currentTab = tab;
  ['inventario','registrar','vendedores','catalogo','cuenta','drops'].forEach(t => {
    const v = document.getElementById('view-'+t);
    const b = document.getElementById('tab-'+t);
    if (v) v.classList.toggle('hidden', t!==tab);
    if (b) b.classList.toggle('active', t===tab);
  });
  if (tab==='inventario')  { clearForm(); renderAll(); }
  if (tab==='vendedores')  renderVendedores();
  if (tab==='catalogo')    renderCatalogo();
  if (tab==='cuenta')      renderCuenta();
  if (tab==='drops')       renderDrops();
  if (tab==='registrar')   { setTimeout(() => { initPreviewListeners(); updatePreview(); populateDropSelect(); }, 0); }
  closeSidebar();

  // Sincronizar el hash de la URL (admin.html#registrar, etc.)
  // fromHash = true cuando el cambio vino de la propia URL, para no duplicar historial
  if (!fromHash && location.hash.slice(1) !== tab) {
    location.hash = tab;
  }
  // Título de la pestaña en el navegador
  const titulos = {
    inventario:'Inventario', registrar:'Registrar', catalogo:'Catálogo',
    vendedores:'Vendedores', drops:'Drops', cuenta:'Mi cuenta'
  };
  document.title = `${titulos[tab] || 'Panel'} · Bazar En Linea`;
}

// Lee el hash de la URL y muestra esa pestaña (con validaciones)
function aplicarHash() {
  let tab = (location.hash || '').replace(/^#\/?/, '').trim();
  if (!TABS_VALIDAS.includes(tab)) tab = 'inventario';
  // Si un no-admin intenta entrar a una pestaña de admin por URL, lo mandamos a inventario
  if (TABS_SOLO_ADMIN.includes(tab) && !isAdmin()) tab = 'inventario';
  showTab(tab, true);
}

// Botones atrás/adelante del navegador
window.addEventListener('hashchange', aplicarHash);

// Cerrar el modal de edición con Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('reEditModal')?.classList.contains('open')) {
    cerrarReEdicion();
  }
});

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Sidebar perfil
  const sidebarU = document.getElementById('sidebarUsername');
  const sidebarR = document.getElementById('sidebarRole');
  if (sidebarU) sidebarU.textContent = session.username;
  if (sidebarR) sidebarR.textContent = session.role === 'admin' ? 'Admin' : 'Vendedor';
  loadAvatarFromStorage();

  ['tab-vendedores','tab-catalogo','tab-drops'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !isAdmin());
  });

  await waitForDB();   // espera el primer fetch a MongoDB

  renderAll();
  populateSelects();

  // Abrir la pestaña indicada en la URL (admin.html#registrar, etc.)
  aplicarHash();

  await updateMyActivity();
  await updateOnlineBadge();

  // Validar que nuestra sesión siga vigente (no reemplazada por otro login admin)
  if (!(await checkMySession())) return forceLogout();

  // Solo ping de actividad cada 20s — el badge se actualiza con el poll (10s)
  setInterval(async () => {
    await updateMyActivity();
    if (!(await checkMySession())) forceLogout();
  }, 20000);

  let searchTmr;
  document.getElementById('invSearch').addEventListener('input', function () {
    clearTimeout(searchTmr);
    invQuery = this.value;
    searchTmr = setTimeout(renderInv, 200);
  });

  const uz = document.getElementById('uploadZone');
  if (uz) {
    uz.addEventListener('dragover',  e => { e.preventDefault(); uz.classList.add('drag'); });
    uz.addEventListener('dragleave', ()  => uz.classList.remove('drag'));
    uz.addEventListener('drop',      e  => { e.preventDefault(); uz.classList.remove('drag'); handleFiles(e.dataTransfer.files); });
  }

  // Drag & drop del modal de edición
  const ruz = document.getElementById('reUploadZone');
  if (ruz) {
    ruz.addEventListener('dragover',  e => { e.preventDefault(); ruz.classList.add('drag'); });
    ruz.addEventListener('dragleave', ()  => ruz.classList.remove('drag'));
    ruz.addEventListener('drop',      e  => { e.preventDefault(); ruz.classList.remove('drag'); reHandleFiles(e.dataTransfer.files); });
  }
});

// ─── TIEMPO REAL — escucha cambios de todas las colecciones ──
window.addEventListener('db:inventario', () => {
  if (currentTab === 'inventario') {
    renderAll();
    toast('Inventario actualizado 🔄');
  }
});

window.addEventListener('db:categorias', () => {
  populateSelects();
  if (currentTab === 'catalogo')    renderCatList();
  if (currentTab === 'inventario')  renderInv();
});

window.addEventListener('db:marcas', () => {
  populateSelects();
  if (currentTab === 'catalogo')    renderBrandList();
  if (currentTab === 'inventario')  renderInv();
});

window.addEventListener('db:usuarios', () => {
  if (currentTab === 'vendedores') renderVendedores();
});

// Activos se actualiza automáticamente con el poll de /api/sync
window.addEventListener('db:activos', () => {
  updateOnlineBadge();
});

// ─── SELECTS DEL FORM ────────────────────────────────────────
function populateSelects() {
  const brandSel = document.getElementById('f_marca');
  if (brandSel) {
    brandSel.innerHTML = `<option value="">Sin marca</option>` +
      getBrands().map(b => `<option value="${b.nombre}">${b.nombre}</option>`).join('');
  }
  renderCatCheckboxes([]);
}

function renderCatCheckboxes(selected = []) {
  const wrap = document.getElementById('f_cats_wrap');
  if (!wrap) return;
  const cats = getCats();
  if (!cats.length) {
    wrap.innerHTML = '<span style="font-size:11px;color:var(--muted)">No hay categorías. Créalas en la pestaña Catálogo.</span>';
    return;
  }
  wrap.innerHTML = cats.map(c => `
    <label class="cat-check">
      <input type="checkbox" value="${c.nombre}" ${selected.includes(c.nombre)?'checked':''}>
      <span>${c.nombre}</span>
    </label>`).join('');
}

function getSelectedCats() {
  return [...document.querySelectorAll('#f_cats_wrap input:checked')].map(i => i.value);
}

// ─── STATS ───────────────────────────────────────────────────
function renderStats() {
  const db         = getDB();
  const vendidos   = db.filter(p => p.vendido);
  const totalVentas  = vendidos.reduce((s,p) => s + (parseFloat(p.precio_venta)||0), 0);
  const totalCostos  = vendidos.reduce((s,p) => s + (parseFloat(p.costo)||0), 0);
  const ganancia     = totalVentas - totalCostos;
  const disponibles  = db.filter(p => !p.vendido).length;

  const adminStats = isAdmin() ? `
    <div class="stat-card green">
      <div class="stat-label">Ganancia Neta</div>
      <div class="stat-value green">$${ganancia.toFixed(2)}</div>
    </div>
    <div class="stat-card yellow">
      <div class="stat-label">Total Ventas</div>
      <div class="stat-value yellow">$${totalVentas.toFixed(2)}</div>
    </div>` : '';

  document.getElementById('statsGrid').innerHTML = `${adminStats}
    <div class="stat-card muted">
      <div class="stat-label">Prendas Vendidas</div>
      <div class="stat-value muted">${vendidos.length}</div>
    </div>
    <div class="stat-card muted">
      <div class="stat-label">Disponibles</div>
      <div class="stat-value muted">${disponibles}</div>
    </div>`;
}

// ─── FILTROS ─────────────────────────────────────────────────
let activeFilter = 'todos', invQuery = '';

function setFilter(f, el) {
  activeFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderInv();
}

function renderAll() { renderStats(); renderInv(); }

// ─── IMG NAV EN CARDS ────────────────────────────────────────
const cardImgIdx = {};
function prevImg(e, id) {
  e.stopPropagation();
  const p = getDB().find(x => x.id===id); if (!p) return;
  const imgs = Array.isArray(p.imagenes) ? p.imagenes : [];
  cardImgIdx[id] = ((cardImgIdx[id]||0) - 1 + imgs.length) % imgs.length;
  renderInv();
}
function nextImg(e, id) {
  e.stopPropagation();
  const p = getDB().find(x => x.id===id); if (!p) return;
  const imgs = Array.isArray(p.imagenes) ? p.imagenes : [];
  cardImgIdx[id] = ((cardImgIdx[id]||0) + 1) % imgs.length;
  renderInv();
}

// ─── RENDER INVENTARIO ───────────────────────────────────────
function renderInv() {
  const db = getDB();
  const q  = invQuery.toLowerCase().trim();
  // Ordenar: más reciente primero. Sin fecha → usar id como proxy
  let items = [...db].sort((a, b) => {
    const ta = a.creadoEn ? new Date(a.creadoEn).getTime() : (a.id * 1000);
    const tb = b.creadoEn ? new Date(b.creadoEn).getTime() : (b.id * 1000);
    return tb - ta;
  });
  if (activeFilter==='disponibles') items = items.filter(p => !p.vendido);
  if (activeFilter==='vendidos')    items = items.filter(p =>  p.vendido);
  if (q) items = items.filter(p =>
    (p.nombre||'').toLowerCase().includes(q) ||
    (p.marca||'').toLowerCase().includes(q)  ||
    (p.talla||'').toLowerCase().includes(q)  ||
    (p.estado||'').toLowerCase().includes(q) ||
    (Array.isArray(p.categorias)?p.categorias:[]).some(c => c.toLowerCase().includes(q))
  );

  const grid = document.getElementById('invGrid');
  if (!items.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;padding:4rem;text-align:center;font-size:11px;color:var(--muted);letter-spacing:.2em;text-transform:uppercase">Sin resultados</div>';
    return;
  }

  grid.innerHTML = items.map(p => {
    const imgs    = Array.isArray(p.imagenes) ? p.imagenes : [];
    const idx     = Math.min(cardImgIdx[p.id]||0, Math.max(imgs.length-1, 0));
    const src     = imgs[idx] || '';
    const imgHtml = src ? `<img src="${src}" alt="${p.nombre}" loading="lazy">` : `<div class="no-img">Sin foto</div>`;
    const navHtml = imgs.length > 1
      ? `<button class="img-nav left"  onclick="prevImg(event,${p.id})">‹</button>
         <button class="img-nav right" onclick="nextImg(event,${p.id})">›</button>` : '';
    const vendidoBadge    = p.vendido ? `<div class="vendido-badge">Vendido</div>` : '';
    const photoCounterHtml = imgs.length > 0 ? `<div class="photo-counter">${idx+1}/${imgs.length}</div>` : '';

    const vendBtn = p.vendido
      ? `<button class="act-btn unsell" onclick="toggleVenta(${p.id},0)">Reactivar</button>`
      : `<button class="act-btn sell"   onclick="toggleVenta(${p.id},1)">Vendido ✓</button>`;
    const delBtn    = isAdmin() ? `<button class="act-btn del" onclick="delItem(${p.id})">🗑</button>` : '';
    const costoHtml = isAdmin() ? `<span class="item-costo">Costo: $${p.costo}</span>` : '';

    const cats    = Array.isArray(p.categorias) ? p.categorias : [];
    const tagsHtml = [
      p.marca ? `<span class="tag tag-brand">${p.marca}</span>` : '',
      ...cats.map(c => `<span class="tag tag-cat">${c}</span>`)
    ].join('');

    return `<div class="item-card${p.vendido?' vendido':''}" id="card-${p.id}">
      <div class="item-img" data-imgs='${JSON.stringify(imgs).replace(/'/g,"&#39;")}'>
        ${imgHtml}${navHtml}${vendidoBadge}${photoCounterHtml}
      </div>
      <div class="item-body">
        <div class="item-name">${p.nombre}</div>
        <div class="item-tags">${tagsHtml}</div>
        <div class="item-meta">Talla ${p.talla||'–'} · ${p.estado||''}</div>
        <div class="item-prices">
          <span class="item-price">$${p.precio_venta}</span>
          ${costoHtml}
        </div>
        <div class="item-actions">
          ${vendBtn}
          <button class="act-btn edit" onclick="re_editar_prenda(${p.id})">✏️</button>
          ${delBtn}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ─── ACCIONES ────────────────────────────────────────────────
function toggleVenta(id, estado) {
  const db = getDB(), p = db.find(x => x.id===id);
  if (p) { p.vendido = !!estado; saveDB(db); renderAll(); toast(estado ? 'Marcado como vendido ✓' : 'Reactivado'); }
}
function delItem(id) {
  if (!isAdmin()) { toast('Sin permisos'); return; }
  if (!confirm('¿Eliminar esta prenda?')) return;
  saveDB(getDB().filter(x => x.id!==id));
  renderAll(); toast('Prenda eliminada');
}
function editItem(id) {
  const p = getDB().find(x => x.id===id); if (!p) return;
  clearForm();
  document.getElementById('editId').value   = id;
  document.getElementById('f_nombre').value = p.nombre||'';
  document.getElementById('f_talla').value  = p.talla||'';
  document.getElementById('f_precio').value = p.precio_venta||'';
  document.getElementById('f_costo').value  = p.costo||'';
  document.getElementById('f_estado').value = p.estado||'';
  const descEl = document.getElementById('f_descripcion');
  if (descEl) descEl.value = p.descripcion||'';
  const brandSel = document.getElementById('f_marca');
  if (brandSel) brandSel.value = p.marca||'';
  renderCatCheckboxes(Array.isArray(p.categorias) ? p.categorias : []);
  editImages = Array.isArray(p.imagenes) ? [...p.imagenes] : [];
  renderPreviews();
  document.getElementById('formTitle').textContent = 'Editar Prenda';
  showTab('registrar');
}

// ═══════════════════════════════════════════════════════════════
//  EDICIÓN EN MODAL — re_editar_prenda (edita en sitio, sin ir a Registrar)
// ═══════════════════════════════════════════════════════════════
let reEditImgs = [];   // imágenes actuales de la prenda en edición (URLs o base64)

function re_editar_prenda(id) {
  const p = getDB().find(x => x.id === id);
  if (!p) { toast('No se encontró la prenda'); return; }

  // Poblar marca
  const brandSel = document.getElementById('re_marca');
  if (brandSel) {
    brandSel.innerHTML = `<option value="">Sin marca</option>` +
      getBrands().map(b => `<option value="${b.nombre}">${b.nombre}</option>`).join('');
    brandSel.value = p.marca || '';
  }

  // Poblar categorías (checkboxes)
  reRenderCatChecks(Array.isArray(p.categorias) ? p.categorias : []);

  // Campos de texto
  document.getElementById('re_editId').value      = id;
  document.getElementById('re_nombre').value      = p.nombre || '';
  document.getElementById('re_talla').value       = p.talla || '';
  document.getElementById('re_precio').value      = p.precio_venta ?? '';
  document.getElementById('re_costo').value       = p.costo ?? '';
  document.getElementById('re_estado').value      = p.estado || '';
  document.getElementById('re_descripcion').value = p.descripcion || '';

  // Fotos
  reEditImgs = Array.isArray(p.imagenes) ? [...p.imagenes] : [];
  reRenderPreviews();

  document.getElementById('reEditSub').textContent = `Editando: ${p.nombre || 'prenda'}`;

  // Abrir modal
  document.getElementById('reEditOverlay').classList.add('active');
  document.getElementById('reEditModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function cerrarReEdicion() {
  document.getElementById('reEditOverlay').classList.remove('active');
  document.getElementById('reEditModal').classList.remove('open');
  document.body.style.overflow = '';
  reEditImgs = [];
}

function reRenderCatChecks(selected = []) {
  const wrap = document.getElementById('re_cats_wrap');
  if (!wrap) return;
  const cats = getCats();
  if (!cats.length) {
    wrap.innerHTML = '<span style="font-size:11px;color:var(--muted)">No hay categorías. Créalas en la pestaña Catálogo.</span>';
    return;
  }
  wrap.innerHTML = cats.map(c => `
    <label class="cat-check">
      <input type="checkbox" value="${c.nombre}" ${selected.includes(c.nombre)?'checked':''}>
      <span>${c.nombre}</span>
    </label>`).join('');
}

function reGetSelectedCats() {
  return [...document.querySelectorAll('#re_cats_wrap input:checked')].map(i => i.value);
}

// Fotos del modal (independiente del formulario de registrar)
function reHandleFiles(files) {
  const fileArr = Array.from(files);
  const input = document.getElementById('reFileInput');
  if (input) input.value = '';
  fileArr.forEach(file => {
    const r = new FileReader();
    r.onload = async e => {
      const base64 = e.target.result;
      const idx = reEditImgs.length;
      reEditImgs.push(base64);          // preview inmediata
      reRenderPreviews();
      try {
        toast('Subiendo foto...');
        const url = await uploadToCloud(base64);
        reEditImgs[idx] = url;          // reemplaza por URL de Cloudinary
        reRenderPreviews();
        toast('Foto subida ✓');
      } catch (err) {
        toast('Error subiendo foto: ' + err.message);
        reEditImgs.splice(idx, 1);
        reRenderPreviews();
      }
    };
    r.readAsDataURL(file);
  });
}

function reRenderPreviews() {
  const strip = document.getElementById('rePreviewStrip');
  if (!strip) return;
  strip.innerHTML = reEditImgs.map((src, i) => `
    <div class="preview-thumb">
      <img src="${src}" alt="">
      <button onclick="reRemovePreview(${i})">✕</button>
    </div>`).join('');
}

function reRemovePreview(i) {
  reEditImgs.splice(i, 1);
  reRenderPreviews();
}

function guardarReEdicion() {
  const id     = parseInt(document.getElementById('re_editId').value) || 0;
  const nombre = document.getElementById('re_nombre').value.trim();
  const precio = parseFloat(document.getElementById('re_precio').value);
  const costo  = parseFloat(document.getElementById('re_costo').value);

  if (!id)                    { toast('Prenda inválida'); return; }
  if (!nombre)                { toast('El nombre es obligatorio'); return; }
  if (isNaN(precio)||precio<0){ toast('Precio inválido'); return; }
  if (isNaN(costo) ||costo <0){ toast('Costo inválido');  return; }

  // Evitar guardar con fotos aún subiendo (base64 sin reemplazar por URL)
  const subiendo = reEditImgs.some(s => typeof s === 'string' && s.startsWith('data:'));
  if (subiendo) { toast('Espera a que terminen de subir las fotos'); return; }

  const db = getDB();
  const p  = db.find(x => x.id === id);
  if (!p) { toast('No se encontró la prenda'); return; }

  // Actualizar SOLO esta prenda — sin crear una nueva
  p.nombre       = nombre;
  p.marca        = document.getElementById('re_marca').value;
  p.categorias   = reGetSelectedCats();
  p.talla        = document.getElementById('re_talla').value.trim();
  p.precio_venta = precio;
  p.costo        = costo;
  p.estado       = document.getElementById('re_estado').value.trim();
  p.descripcion  = document.getElementById('re_descripcion').value.trim();
  p.imagenes     = [...reEditImgs];

  saveDB(db);
  cerrarReEdicion();
  renderAll();
  toast('Cambios guardados ✓');
}

// ─── FORM ────────────────────────────────────────────────────
let newImages = [], editImages = [];

// Sube una imagen a Cloudinary y devuelve la URL
async function uploadToCloud(base64) {
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: base64 })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error al subir imagen');
  return data.url;
}

function handleFiles(files) {
  const fileArr = Array.from(files);
  document.getElementById('fileInput').value = '';

  // Mostrar previews locales inmediatamente mientras suben
  fileArr.forEach(file => {
    const r = new FileReader();
    r.onload = async e => {
      const base64 = e.target.result;
      // Preview local temporal
      const tempIdx = newImages.length;
      newImages.push(base64);
      renderPreviews();

      try {
        toast('Subiendo foto...');
        const url = await uploadToCloud(base64);
        // Reemplazar base64 con URL de Cloudinary
        newImages[tempIdx] = url;
        renderPreviews();
        toast('Foto subida ✓');
      } catch (err) {
        toast('Error subiendo foto: ' + err.message);
        newImages.splice(tempIdx, 1);
        renderPreviews();
      }
    };
    r.readAsDataURL(file);
  });
}
function renderPreviews() {
  const combined = [...editImages, ...newImages];
  document.getElementById('previewStrip').innerHTML = combined.map((src, i) => `
    <div class="preview-thumb">
      <img src="${src}" alt="">
      <button onclick="removePreview(${i})">✕</button>
    </div>`).join('');
  updatePreview();
}
function removePreview(i) {
  const combined = [...editImages, ...newImages];
  combined.splice(i, 1);
  editImages = combined.slice(0, Math.min(editImages.length, combined.length));
  newImages  = combined.slice(editImages.length);
  renderPreviews();
}
function clearForm() {
  document.getElementById('editId').value = '';
  ['f_nombre','f_talla','f_precio','f_costo','f_estado','f_descripcion','f_dropNombre'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const brandSel = document.getElementById('f_marca');
  if (brandSel) brandSel.value = '';
  renderCatCheckboxes([]);
  newImages = []; editImages = [];
  renderPreviews();
  document.getElementById('formTitle').textContent = 'Nuevo Registro';
  const useDrop = document.getElementById('f_useDrop');
  if (useDrop) useDrop.checked = false;
  toggleDropField();
}
function submitForm() {
  const nombre = document.getElementById('f_nombre').value.trim();
  const precio = parseFloat(document.getElementById('f_precio').value);
  const costo  = parseFloat(document.getElementById('f_costo').value);
  if (!nombre)              { toast('El nombre es obligatorio'); return; }
  if (isNaN(precio)||precio<0) { toast('Precio inválido'); return; }
  if (isNaN(costo) ||costo <0) { toast('Costo inválido');  return; }

  const combined = [...editImages, ...newImages];
  const editId   = parseInt(document.getElementById('editId').value) || 0;
  const marca     = document.getElementById('f_marca').value;
  const categorias = getSelectedCats();
  let db = getDB();

  if (editId) {
    const p = db.find(x => x.id===editId);
    if (p) {
      p.nombre = nombre; p.marca = marca; p.categorias = categorias;
      p.talla  = document.getElementById('f_talla').value.trim();
      p.precio_venta = precio; p.costo = costo;
      p.estado = document.getElementById('f_estado').value.trim();
      p.descripcion = (document.getElementById('f_descripcion')?.value||'').trim();
      if (combined.length) p.imagenes = combined;
    }
    toast('Prenda actualizada ✓');
  } else {
    const useDrop = document.getElementById('f_useDrop')?.checked;
    const dropId  = document.getElementById('f_dropId')?.value;
    const esNuevoDrop = dropId === '__nuevo__';
    let dropIdFinal = null;

    if (useDrop && dropId) {
      if (esNuevoDrop) {
        const dropNombre = document.getElementById('f_dropNombre')?.value.trim();
        const dropFecha  = document.getElementById('f_dropFecha')?.value;
        if (!dropNombre) { toast('Escribe el nombre del drop'); return; }
        if (!dropFecha)  { toast('Elige la fecha del drop');    return; }
        dropIdFinal = 'drop_' + Date.now();
        const drops = getDrops();
        drops.push({ id: dropIdFinal, nombre: dropNombre, fecha: dropFecha, prendas: [], publicado: false, creadoEn: new Date().toISOString() });
        saveDrops(drops);
      } else {
        dropIdFinal = dropId;
      }
    }

    const nuevaPrenda = {
      id: nextId(), nombre, marca, categorias,
      talla: document.getElementById('f_talla').value.trim(),
      precio_venta: precio, costo,
      estado: document.getElementById('f_estado').value.trim(),
      descripcion: (document.getElementById('f_descripcion')?.value||'').trim(),
      imagenes: combined, vendido: false,
      creadoEn: new Date().toISOString(),
      oculto: !!dropIdFinal
    };
    db.unshift(nuevaPrenda);

    if (dropIdFinal) {
      const drops = getDrops();
      const drop  = drops.find(d => d.id === dropIdFinal);
      if (drop) { drop.prendas.push(nuevaPrenda.id); saveDrops(drops); }
      toast('Prenda guardada en el drop ✓');
    } else {
      toast('Prenda publicada ✓');
    }
  }
  saveDB(db); clearForm(); showTab('inventario');
}

// ─── VENDEDORES ──────────────────────────────────────────────
function renderVendedores() {
  if (!isAdmin()) return;
  const users = getUsers().filter(u => u.role==='vendedor');
  const tbody = document.getElementById('vendedoresTable');
  tbody.innerHTML = !users.length
    ? `<tr><td colspan="3" style="text-align:center;padding:2rem;color:var(--muted);font-size:12px;letter-spacing:.1em;text-transform:uppercase">No hay vendedores creados</td></tr>`
    : users.map(u => `<tr>
        <td>${u.username}</td>
        <td><span class="role-badge vendedor">Vendedor</span></td>
        <td><div style="display:flex;gap:6px;justify-content:flex-end">
          <button class="act-btn edit" onclick="resetPassword(${u.id})" title="Cambiar contraseña">🔑</button>
          <button class="act-btn del"  onclick="deleteVendedor(${u.id})" title="Eliminar">🗑</button>
        </div></td>
      </tr>`).join('');
}
function createVendedor() {
  const username = document.getElementById('v_username').value.trim();
  const password = document.getElementById('v_password').value;
  const confirm  = document.getElementById('v_confirm').value;
  const errEl    = document.getElementById('vendedorError');
  errEl.textContent = '';
  if (!username)              { errEl.textContent = 'El usuario es obligatorio'; return; }
  if (password.length < 4)    { errEl.textContent = 'Mínimo 4 caracteres'; return; }
  if (password !== confirm)   { errEl.textContent = 'Las contraseñas no coinciden'; return; }
  const users = getUsers();
  if (users.find(u => u.username===username)) { errEl.textContent = 'Ese usuario ya existe'; return; }
  users.push({ id: nextUserId(), username, password, role: 'vendedor' });
  saveUsers(users);
  ['v_username','v_password','v_confirm'].forEach(id => document.getElementById(id).value = '');
  toast(`Vendedor "${username}" creado ✓`);
  renderVendedores();
}
function deleteVendedor(id) {
  if (!confirm('¿Eliminar este vendedor?')) return;
  saveUsers(getUsers().filter(u => u.id!==id));
  renderVendedores(); toast('Vendedor eliminado');
}
function resetPassword(id) {
  const newPass = prompt('Nueva contraseña:');
  if (!newPass || newPass.length < 4) { toast('Contraseña inválida'); return; }
  const users = getUsers();
  const u = users.find(x => x.id===id);
  if (u) { u.password = newPass; saveUsers(users); toast('Contraseña actualizada ✓'); }
}

// ─── CATÁLOGO ────────────────────────────────────────────────
function renderCatalogo() {
  if (!isAdmin()) return;
  renderCatList();
  renderBrandList();
}
function renderCatList() {
  const cats = getCats();
  document.getElementById('catList').innerHTML = !cats.length
    ? `<div class="cat-empty">No hay categorías todavía</div>`
    : cats.map(c => `
      <div class="cat-item">
        <span>${c.nombre}</span>
        <div style="display:flex;gap:6px">
          <button class="act-btn edit" onclick="editCat(${c.id},'${c.nombre}')">✏️</button>
          <button class="act-btn del"  onclick="deleteCat(${c.id})">🗑</button>
        </div>
      </div>`).join('');
}
function addCat() {
  const input = document.getElementById('newCatName');
  const name  = input.value.trim();
  if (!name) { toast('Escribe un nombre'); return; }
  const cats = getCats();
  if (cats.find(c => c.nombre.toLowerCase()===name.toLowerCase())) { toast('Ya existe esa categoría'); return; }
  cats.push({ id: nextCatId(), nombre: name });
  saveCats(cats); input.value = '';
  renderCatList(); populateSelects();
  toast(`Categoría "${name}" creada ✓`);
}
function editCat(id, current) {
  const newName = prompt('Nuevo nombre:', current);
  if (!newName || !newName.trim()) return;
  const cats = getCats(), c = cats.find(x => x.id===id);
  if (c) { c.nombre = newName.trim(); saveCats(cats); renderCatList(); populateSelects(); toast('Categoría actualizada ✓'); }
}
function deleteCat(id) {
  if (!confirm('¿Eliminar esta categoría?')) return;
  saveCats(getCats().filter(c => c.id!==id));
  renderCatList(); populateSelects(); toast('Categoría eliminada');
}
function renderBrandList() {
  const brands = getBrands();
  document.getElementById('brandList').innerHTML = !brands.length
    ? `<div class="cat-empty">No hay marcas todavía</div>`
    : brands.map(b => `
      <div class="cat-item">
        <span>${b.nombre}</span>
        <div style="display:flex;gap:6px">
          <button class="act-btn edit" onclick="editBrand(${b.id},'${b.nombre}')">✏️</button>
          <button class="act-btn del"  onclick="deleteBrand(${b.id})">🗑</button>
        </div>
      </div>`).join('');
}
function addBrand() {
  const input = document.getElementById('newBrandName');
  const name  = input.value.trim();
  if (!name) { toast('Escribe un nombre'); return; }
  const brands = getBrands();
  if (brands.find(b => b.nombre.toLowerCase()===name.toLowerCase())) { toast('Ya existe esa marca'); return; }
  brands.push({ id: nextBrandId(), nombre: name });
  saveBrands(brands); input.value = '';
  renderBrandList(); populateSelects();
  toast(`Marca "${name}" creada ✓`);
}
function editBrand(id, current) {
  const newName = prompt('Nuevo nombre:', current);
  if (!newName || !newName.trim()) return;
  const brands = getBrands(), b = brands.find(x => x.id===id);
  if (b) { b.nombre = newName.trim(); saveBrands(brands); renderBrandList(); populateSelects(); toast('Marca actualizada ✓'); }
}
function deleteBrand(id) {
  if (!confirm('¿Eliminar esta marca?')) return;
  saveBrands(getBrands().filter(b => b.id!==id));
  renderBrandList(); populateSelects(); toast('Marca eliminada');
}

// ─── ONLINE BADGE ────────────────────────────────────────────
async function updateOnlineBadge() {
  const activeUsers = await getActiveUsers();
  const countEl = document.getElementById('onlineCount');
  const listEl  = document.getElementById('onlineUsersList');
  if (countEl) countEl.textContent = activeUsers.length;
  if (listEl) {
    listEl.innerHTML = activeUsers.length === 0
      ? '<li>Nadie activo</li>'
      : activeUsers.map(u => `
          <li>
            <span class="user-dot-online"></span>
            ${u.username}${u.username===session.username?' <small>(tú)</small>':''}
          </li>`).join('');
  }
}

// ─── SIDEBAR MÓVIL ───────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('active');
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.remove('active');
}

// ─── AVATAR (Cloudinary + localStorage) ──────────────────────
const AVATAR_KEY = 'bazar_avatar_' + (getSession()?.username || 'user');

function loadAvatarFromStorage() {
  const url = localStorage.getItem(AVATAR_KEY);
  setAvatarUI(url);
}

function setAvatarUI(url) {
  // Sidebar
  const sbImg = document.getElementById('sidebarAvatar');
  const sbPh  = document.getElementById('sidebarAvatarPlaceholder');
  // Cuenta
  const ctImg = document.getElementById('cuentaAvatarImg');
  const ctPh  = document.getElementById('cuentaAvatarPlaceholder');

  if (url) {
    if (sbImg)  { sbImg.src = url; sbImg.style.display = 'block'; }
    if (sbPh)   sbPh.style.display = 'none';
    if (ctImg)  { ctImg.src = url; ctImg.style.display = 'block'; }
    if (ctPh)   ctPh.style.display = 'none';
  } else {
    if (sbImg)  sbImg.style.display = 'none';
    if (sbPh)   sbPh.style.display = 'flex';
    if (ctImg)  ctImg.style.display = 'none';
    if (ctPh)   ctPh.style.display = 'flex';
  }
}

async function handleAvatarUpload(file) {
  if (!file) return;
  toast('Subiendo foto de perfil...');
  const r = new FileReader();
  r.onload = async e => {
    try {
      const url = await uploadToCloud(e.target.result);
      localStorage.setItem(AVATAR_KEY, url);
      setAvatarUI(url);
      toast('Foto de perfil actualizada ✓');
    } catch (err) {
      toast('Error subiendo foto: ' + err.message);
    }
  };
  r.readAsDataURL(file);
}

// ─── MI CUENTA ───────────────────────────────────────────────
function renderCuenta() {
  const s = getSession();

  // Nombre y role
  const uEl = document.getElementById('cuentaUsername');
  const rEl = document.getElementById('cuentaRoleBadge');
  if (uEl) uEl.textContent = s.username;
  if (rEl) rEl.textContent = s.role === 'admin' ? '👑 Admin' : '🛍 Vendedor';

  // Permisos
  const perms = document.getElementById('cuentaPermisos');
  if (perms) {
    const adminPerms = s.role === 'admin' ? `
      <span class="perm-ok">✓ Ver ganancias</span>
      <span class="perm-ok">✓ Gestionar catálogo</span>
      <span class="perm-ok">✓ Gestionar vendedores</span>
      <span class="perm-ok">✓ Eliminar prendas</span>
    ` : `
      <span class="perm-no">✗ Ver ganancias</span>
      <span class="perm-no">✗ Gestionar catálogo</span>
      <span class="perm-no">✗ Gestionar vendedores</span>
      <span class="perm-no">✗ Eliminar prendas</span>
    `;
    perms.innerHTML = `
      <span class="perm-ok">✓ Ver inventario</span>
      <span class="perm-ok">✓ Agregar prendas</span>
      <span class="perm-ok">✓ Editar prendas</span>
      <span class="perm-ok">✓ Marcar vendido</span>
      ${adminPerms}
    `;
  }

  // Cargar avatar
  loadAvatarFromStorage();
}

// ─── CAMBIAR CONTRASEÑA ───────────────────────────────────────
// La verificación de la contraseña actual se hace en el servidor
// (api/change-password.js): el frontend ya no recibe las contraseñas.
async function cambiarPassword() {
  const actual  = document.getElementById('cp_actual').value;
  const nueva   = document.getElementById('cp_nueva').value;
  const confirm = document.getElementById('cp_confirm').value;
  const errEl   = document.getElementById('cpError');
  errEl.textContent = '';

  const s = getSession();
  if (!s)                { errEl.textContent = 'Sesión no encontrada'; return; }
  if (!actual)           { errEl.textContent = 'Escribe tu contraseña actual'; return; }
  if (nueva.length < 4)  { errEl.textContent = 'Mínimo 4 caracteres'; return; }
  if (nueva !== confirm) { errEl.textContent = 'Las contraseñas no coinciden'; return; }

  try {
    await api('/api/change-password', {
      method: 'POST',
      body: { username: s.username, actual, nueva }
    });
    ['cp_actual','cp_nueva','cp_confirm'].forEach(id => document.getElementById(id).value = '');
    toast('Contraseña actualizada ✓');
  } catch (err) {
    errEl.textContent = err.message || 'No se pudo cambiar la contraseña';
  }
}

// ─── PREVIEW EN TIEMPO REAL ───────────────────────────────────
let pvIdx = 0, pvImgs = [];

function updatePreview() {
  const nombre  = document.getElementById('f_nombre')?.value.trim()  || '';
  const marca   = document.getElementById('f_marca')?.value           || '';
  const talla   = document.getElementById('f_talla')?.value.trim()   || '';
  const estado  = document.getElementById('f_estado')?.value.trim()  || '';
  const precio  = document.getElementById('f_precio')?.value         || '0';
  const desc    = document.getElementById('f_descripcion')?.value.trim() || '';
  const cats    = getSelectedCats();
  pvImgs        = [...editImages, ...newImages].filter(s => s && !s.startsWith('data:'));
  // incluir también base64 para ver inmediatamente
  const allImgs = [...editImages, ...newImages];

  // Nombre
  document.getElementById('pvName').textContent = nombre || 'Nombre de la prenda';

  // Marca
  const pvBrand = document.getElementById('pvBrand');
  pvBrand.textContent = marca;
  pvBrand.style.display = marca ? 'block' : 'none';

  // Chips de categorías
  const pvChips = document.getElementById('pvChips');
  pvChips.innerHTML = cats.map(c => `<span class="cat-chip">${c}</span>`).join('');

  // Talla
  const pvTalla = document.getElementById('pvTalla');
  const pvTallaV = document.getElementById('pvTallaVal');
  if (talla) { pvTalla.style.display = 'flex'; pvTallaV.textContent = talla; }
  else pvTalla.style.display = 'none';

  // Estado
  const pvEstado = document.getElementById('pvEstado');
  const pvEstadoV = document.getElementById('pvEstadoVal');
  if (estado) { pvEstado.style.display = 'flex'; pvEstadoV.textContent = estado; }
  else pvEstado.style.display = 'none';

  // Descripción
  const pvDesc = document.getElementById('pvDesc');
  if (desc) { pvDesc.style.display = 'block'; pvDesc.textContent = desc; }
  else pvDesc.style.display = 'none';

  // Precio
  const p = parseFloat(precio);
  document.getElementById('pvPrice').textContent = isNaN(p) ? '$0' : `$${p.toLocaleString('es-MX')}`;

  // Galería
  pvImgs = allImgs;
  pvIdx  = Math.min(pvIdx, Math.max(allImgs.length - 1, 0));
  pvRenderGallery();
}

function pvRenderGallery() {
  const noPhoto = document.getElementById('pvNoPhoto');
  const mainImg = document.getElementById('pvMainImg');
  const thumbsEl = document.getElementById('pvThumbs');
  const prev = document.getElementById('pvPrev');
  const next = document.getElementById('pvNext');

  if (!pvImgs.length) {
    noPhoto.style.display = 'flex';
    mainImg.style.display = 'none';
    if (thumbsEl) thumbsEl.innerHTML = '';
    if (prev) prev.style.display = 'none';
    if (next) next.style.display = 'none';
    return;
  }

  noPhoto.style.display = 'none';
  mainImg.style.display = 'block';
  mainImg.src = pvImgs[pvIdx] || '';

  if (prev) prev.style.display = pvImgs.length > 1 ? 'flex' : 'none';
  if (next) next.style.display = pvImgs.length > 1 ? 'flex' : 'none';

  if (thumbsEl) {
    thumbsEl.innerHTML = pvImgs.map((src, i) =>
      `<button class="pdp-thumb ${i===pvIdx?'active':''}" onclick="pvSetImg(${i})">
        <img src="${src}" alt="">
      </button>`
    ).join('');
  }
}

function pvSetImg(i) {
  pvIdx = i;
  pvRenderGallery();
}

function pvChg(d) {
  pvIdx = (pvIdx + d + pvImgs.length) % pvImgs.length;
  pvRenderGallery();
}

// Enganchar listeners cuando se carga la vista registrar
function initPreviewListeners() {
  const ids = ['f_nombre','f_marca','f_talla','f_precio','f_estado','f_descripcion'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updatePreview);
    if (el) el.addEventListener('change', updatePreview);
  });
  // Escuchar checkboxes de categorías (delegación)
  const catsWrap = document.getElementById('f_cats_wrap');
  if (catsWrap) catsWrap.addEventListener('change', updatePreview);
}

// renderPreviews ya llama updatePreview() internamente

// ═══════════════════════════════════════════════════════════════
//  SISTEMA DE DROPS
// ═══════════════════════════════════════════════════════════════
const DROPS_KEY = 'bazar_drops';

function getDrops() {
  try { return JSON.parse(localStorage.getItem(DROPS_KEY)) || []; }
  catch { return []; }
}
function saveDrops(list) {
  localStorage.setItem(DROPS_KEY, JSON.stringify(list));
}

// ── Toggle campo drop en el form ─────────────────────────────
function toggleDropField() {
  const checked  = document.getElementById('f_useDrop')?.checked;
  const wrap     = document.getElementById('dropFieldWrap');
  const submitBtn = document.getElementById('submitBtn');
  if (!wrap) return;
  document.querySelectorAll('.drop-field').forEach(el => el.classList.toggle('hidden', !checked));
  if (submitBtn) submitBtn.textContent = checked ? 'GUARDAR EN DROP' : 'PUBLICAR EN BAZAR';
  if (checked) populateDropSelect();
}

function populateDropSelect() {
  const sel = document.getElementById('f_dropId');
  if (!sel) return;
  const drops = getDrops().filter(d => !d.publicado);
  sel.innerHTML = `<option value="">-- Selecciona un drop --</option>
    <option value="__nuevo__">+ Crear nuevo drop...</option>` +
    drops.map(d => {
      const fecha = new Date(d.fecha);
      const label = fecha.toLocaleDateString('es-MX', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
      return `<option value="${d.id}">${d.nombre} · ${label} (${d.prendas.length} prendas)</option>`;
    }).join('');

  sel.onchange = () => {
    const nuevoWrap = document.getElementById('dropNuevoWrap');
    if (nuevoWrap) nuevoWrap.classList.toggle('hidden', sel.value !== '__nuevo__');
  };
}

// ── Render vista Drops ────────────────────────────────────────
function renderDrops() {
  if (!isAdmin()) return;
  checkDropsAutoPublish();
  const drops = getDrops();
  const grid  = document.getElementById('dropsGrid');
  if (!grid) return;

  if (!drops.length) {
    grid.innerHTML = `<div class="drops-empty">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <p>No hay drops creados todavía.</p>
      <p style="font-size:11px;color:var(--muted)">Ve a Registrar → activa "Agregar a un Drop" para crear uno.</p>
    </div>`;
    return;
  }

  // Separar pendientes y publicados
  const pendientes = drops.filter(d => !d.publicado).sort((a,b) => new Date(a.fecha)-new Date(b.fecha));
  const publicados  = drops.filter(d =>  d.publicado).sort((a,b) => new Date(b.fecha)-new Date(a.fecha));

  grid.innerHTML = [
    pendientes.length ? `<div class="drops-section-label">⏳ Programados</div>` : '',
    ...pendientes.map(d => renderDropCard(d)),
    publicados.length ? `<div class="drops-section-label" style="margin-top:2rem">✅ Publicados</div>` : '',
    ...publicados.map(d => renderDropCard(d))
  ].join('');
}

function renderDropCard(d) {
  const db        = getDB();
  const prendas   = d.prendas.map(id => db.find(p => p.id === id)).filter(Boolean);
  const fecha     = new Date(d.fecha);
  const ahora     = new Date();
  const diff      = fecha - ahora;
  const esHoy     = diff > 0 && diff < 86400000;
  const vencido   = diff < 0 && !d.publicado;
  const fechaStr  = fecha.toLocaleDateString('es-MX', { weekday:'short', day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });

  // Countdown si es hoy
  let countdown = '';
  if (esHoy) {
    const h = Math.floor(diff/3600000);
    const m = Math.floor((diff%3600000)/60000);
    countdown = `<div class="drop-countdown">🔥 Faltan ${h}h ${m}m</div>`;
  }

  const thumbs = prendas.slice(0,4).map(p => {
    const img = Array.isArray(p.imagenes) && p.imagenes[0]
      ? `<img src="${p.imagenes[0]}" alt="${p.nombre}">`
      : `<div class="drop-thumb-placeholder"></div>`;
    return `<div class="drop-thumb">${img}</div>`;
  }).join('');
  const masLabel = prendas.length > 4 ? `<div class="drop-thumb-more">+${prendas.length-4}</div>` : '';

  const statusClass = d.publicado ? 'drop-status-ok' : vencido ? 'drop-status-warn' : 'drop-status-pending';
  const statusLabel = d.publicado ? 'Publicado' : vencido ? 'Listo para publicar' : 'Programado';

  const acciones = d.publicado ? `
    <button class="drop-btn drop-btn-danger" onclick="eliminarDrop('${d.id}')">🗑 Eliminar</button>
  ` : `
    <button class="drop-btn drop-btn-primary" onclick="publicarDrop('${d.id}')">🚀 Publicar ahora</button>
    <button class="drop-btn drop-btn-edit" onclick="editarDropFecha('${d.id}')">📅 Cambiar fecha</button>
    <button class="drop-btn drop-btn-danger" onclick="eliminarDrop('${d.id}')">🗑 Cancelar drop</button>
  `;

  return `<div class="drop-card ${d.publicado ? 'drop-card-done' : ''}">
    <div class="drop-card-header">
      <div>
        <div class="drop-card-name">${d.nombre}</div>
        <div class="drop-card-fecha">${fechaStr}</div>
      </div>
      <span class="drop-status ${statusClass}">${statusLabel}</span>
    </div>
    ${countdown}
    <div class="drop-thumbs-row">${thumbs}${masLabel}</div>
    <div class="drop-prendas-label">${prendas.length} prenda${prendas.length!==1?'s':''}</div>
    <div class="drop-prendas-list">
      ${prendas.map(p => `<div class="drop-prenda-item">
        <span>${p.nombre}</span>
        <span class="drop-prenda-precio">$${p.precio_venta}</span>
        <button class="drop-prenda-remove" onclick="quitarPrendaDeDrop('${d.id}',${p.id})" title="Quitar del drop">✕</button>
      </div>`).join('')}
    </div>
    <div class="drop-actions">${acciones}</div>
  </div>`;
}

// ── Publicar drop manualmente ─────────────────────────────────
function publicarDrop(dropId) {
  if (!confirm('¿Publicar este drop ahora? Las prendas serán visibles en la tienda.')) return;
  const drops = getDrops();
  const drop  = drops.find(d => d.id === dropId);
  if (!drop) return;

  const db = getDB();
  drop.prendas.forEach(pId => {
    const p = db.find(x => x.id === pId);
    if (p) p.oculto = false;
  });
  drop.publicado = true;
  drop.publicadoEn = new Date().toISOString();
  saveDB(db);
  saveDrops(drops);
  toast(`Drop "${drop.nombre}" publicado ✓`);
  renderDrops();
}

// ── Auto-publicar drops cuya hora ya llegó ────────────────────
function checkDropsAutoPublish() {
  const drops = getDrops();
  const ahora = new Date();
  let huboPublicacion = false;

  drops.forEach(drop => {
    if (!drop.publicado && new Date(drop.fecha) <= ahora) {
      const db = getDB();
      drop.prendas.forEach(pId => {
        const p = db.find(x => x.id === pId);
        if (p) p.oculto = false;
      });
      drop.publicado = true;
      drop.publicadoEn = ahora.toISOString();
      saveDB(db);
      huboPublicacion = true;
      toast(`🔥 Drop "${drop.nombre}" publicado automáticamente`);
    }
  });

  if (huboPublicacion) saveDrops(drops);
}

// ── Quitar prenda de un drop ──────────────────────────────────
function quitarPrendaDeDrop(dropId, prendaId) {
  const drops = getDrops();
  const drop  = drops.find(d => d.id === dropId);
  if (!drop) return;
  drop.prendas = drop.prendas.filter(id => id !== prendaId);
  const db = getDB();
  const p  = db.find(x => x.id === prendaId);
  if (p) { p.oculto = false; saveDB(db); }
  saveDrops(drops);
  toast('Prenda quitada del drop');
  renderDrops();
}

// ── Cambiar fecha del drop ────────────────────────────────────
function editarDropFecha(dropId) {
  const drops = getDrops();
  const drop  = drops.find(d => d.id === dropId);
  if (!drop) return;
  const nueva = prompt('Nueva fecha y hora (YYYY-MM-DDTHH:MM):', drop.fecha.slice(0,16));
  if (!nueva) return;
  const fecha = new Date(nueva);
  if (isNaN(fecha)) { toast('Fecha inválida'); return; }
  drop.fecha = new Date(nueva).toISOString();
  saveDrops(drops);
  toast('Fecha actualizada ✓');
  renderDrops();
}

// ── Eliminar drop ─────────────────────────────────────────────
function eliminarDrop(dropId) {
  if (!confirm('¿Eliminar este drop? Las prendas guardadas en él quedarán ocultas.')) return;
  const drops = getDrops().filter(d => d.id !== dropId);
  saveDrops(drops);
  toast('Drop eliminado');
  renderDrops();
}

// ── Chequeo automático cada minuto ───────────────────────────
setInterval(() => {
  checkDropsAutoPublish();
  if (currentTab === 'drops') renderDrops();
}, 60000);
