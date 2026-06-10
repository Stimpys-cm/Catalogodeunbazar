// js/admin.js

if (!isLoggedIn()) window.location.href = 'login.html';
const session = getSession();

function logout() { removeMyActivity(); clearSession(); window.location.href = 'login.html'; }

// ─── TABS ────────────────────────────────────────────────────
let currentTab = 'inventario';

function showTab(tab) {
  if ((tab==='vendedores'||tab==='catalogo') && !isAdmin()) return;
  currentTab = tab;
  ['inventario','registrar','vendedores','catalogo'].forEach(t => {
    const v = document.getElementById('view-'+t);
    const b = document.getElementById('tab-'+t);
    if (v) v.classList.toggle('hidden', t!==tab);
    if (b) b.classList.toggle('active', t===tab);
  });
  if (tab==='inventario')  { clearForm(); renderAll(); }
  if (tab==='vendedores')  renderVendedores();
  if (tab==='catalogo')    renderCatalogo();
}

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('navUsername').textContent = session.username;
  document.getElementById('navRole').textContent = session.role==='admin' ? 'Admin' : 'Vendedor';

  ['tab-vendedores','tab-catalogo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !isAdmin());
  });

  await waitForDB();   // espera el primer fetch a MongoDB

  renderAll();
  populateSelects();
  await updateMyActivity();
  await updateOnlineBadge();

  // Solo ping de actividad cada 20s — el badge se actualiza con el poll (3s)
  setInterval(async () => { await updateMyActivity(); }, 20000);

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
  let items = db;
  if (activeFilter==='disponibles') items = db.filter(p => !p.vendido);
  if (activeFilter==='vendidos')    items = db.filter(p =>  p.vendido);
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
      <div class="item-img" onclick="if(event.target.tagName==='IMG'||event.target.classList.contains('item-img')){openMod(${JSON.stringify(imgs)},${idx});}">
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
          <button class="act-btn edit" onclick="editItem(${p.id})">✏️</button>
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
  const brandSel = document.getElementById('f_marca');
  if (brandSel) brandSel.value = p.marca||'';
  renderCatCheckboxes(Array.isArray(p.categorias) ? p.categorias : []);
  editImages = Array.isArray(p.imagenes) ? [...p.imagenes] : [];
  renderPreviews();
  document.getElementById('formTitle').textContent = 'Editar Prenda';
  showTab('registrar');
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
  ['f_nombre','f_talla','f_precio','f_costo','f_estado'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const brandSel = document.getElementById('f_marca');
  if (brandSel) brandSel.value = '';
  renderCatCheckboxes([]);
  newImages = []; editImages = [];
  renderPreviews();
  document.getElementById('formTitle').textContent = 'Nuevo Registro';
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
      if (combined.length) p.imagenes = combined;
    }
    toast('Prenda actualizada ✓');
  } else {
    db.unshift({
      id: nextId(), nombre, marca, categorias,
      talla: document.getElementById('f_talla').value.trim(),
      precio_venta: precio, costo,
      estado: document.getElementById('f_estado').value.trim(),
      imagenes: combined, vendido: false
    });
    toast('Prenda publicada ✓');
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
