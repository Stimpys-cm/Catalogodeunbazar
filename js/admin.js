// js/admin.js

// Escapa cualquier texto que venga de la base de datos antes de meterlo en
// el HTML del panel. Sin esto, alguien podría guardar un <script> en el
// nombre de una prenda y que se ejecute en TU navegador de administrador,
// con tu sesión abierta.
const escAdmin = str => String(str ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// El acceso puede vivir en una dirección secreta (RUTA_PANEL): en ese caso
// /login.html devuelve 404 a todo el mundo. El servidor nos dijo al entrar
// cuál es esa dirección y quedó guardada en la sesión.
function rutaDeAcceso() {
  const guardada = getSession()?.panel;
  if (guardada) return guardada;
  // Sin dato guardado: si no estamos en /admin.html es que llegamos por la
  // dirección secreta, así que volver ahí es lo correcto.
  return location.pathname === '/admin.html' ? 'login.html' : location.pathname;
}

// Sale del panel soltando también la cookie del servidor: sin ella, la
// puerta vuelve a mostrar el formulario en vez del panel.
function salirDelPanel(destino) {
  fetch('/api/auth', { method: 'DELETE' })
    .catch(() => {})
    .finally(() => { window.location.href = destino; });
}

if (!isLoggedIn()) salirDelPanel(rutaDeAcceso());
// El panel abrió de verdad, así que el freno anti-bucle del login ya no
// hace falta en esta pestaña (js/login.js).
try { sessionStorage.removeItem('stmp_login_intento'); } catch (_) {}

const session = getSession();

function logout() {
  removeMyActivity();
  const destino = rutaDeAcceso();   // se lee antes de borrar la sesión
  clearSession();
  salirDelPanel(destino);
}

// Cierre forzado: cuando la cuenta inició sesión en otro dispositivo.
// NO llamamos removeMyActivity() para no borrar la actividad de la sesión
// nueva (que ahora es la legítima). Solo limpiamos esta sesión local.
let _kicked = false;
function forceLogout() {
  if (_kicked) return;
  _kicked = true;
  toast('Tu cuenta inició sesión en otro dispositivo');
  const destino = rutaDeAcceso();
  clearSession();
  setTimeout(() => salirDelPanel(destino), 1500);
}

// Si el admin cierra el panel mientras un bazar ya estaba dentro, se le
// avisa y se le saca. El admin general nunca se cierra la puerta a sí mismo.
let _panelCerrado = false;
function vigilarCierreDelPanel() {
  if (_panelCerrado) return;
  if (typeof esAdminGlobal === 'function' && esAdminGlobal()) return;
  if (typeof enMantenimiento !== 'function' || !enMantenimiento('panel')) return;

  _panelCerrado = true;
  const msg = (typeof mensajeMantenimiento === 'function' && mensajeMantenimiento('panel'))
    || 'El panel está en mantenimiento. Vuelve en un rato.';
  toast(msg, 6000);
  const destino = rutaDeAcceso();
  clearSession();
  setTimeout(() => salirDelPanel(destino), 2500);
}
window.addEventListener('db:ajustes', vigilarCierreDelPanel);
window.addEventListener('db:ready',   vigilarCierreDelPanel);

// ─── TABS ────────────────────────────────────────────────────
let currentTab = 'inventario';

// Pestañas válidas y las que requieren admin
const TABS_VALIDAS   = ['inventario','registrar','catalogo','vendedores','bazares','drops','subastas','ganancias','cuenta','sistema'];
const TABS_SOLO_ADMIN = ['catalogo'];
// Sistema (logs de toda la plataforma) es solo del admin principal
const TABS_SOLO_GLOBAL = ['sistema'];

// ─── MULTI-BAZAR ─────────────────────────────────────────────
// El admin principal ve y administra todos los bazares. Cada bazar
// solo ve, edita y borra lo suyo.
let invBazarFiltro = 'todos';   // solo lo usa el admin principal

// Prendas que esta cuenta puede ver en el panel
function prendasVisibles() {
  const db = getDB();
  if (!esAdminGlobal()) {
    const mio = miBazarId();
    if (!mio) return [];
    return db.filter(p => Number(p.bazarId || 1) === Number(mio));
  }
  if (invBazarFiltro === 'todos') return db;
  return db.filter(p => Number(p.bazarId || 1) === Number(invBazarFiltro));
}

// ¿Puedo tocar esta prenda? (el admin principal siempre)
function esMia(p) {
  if (esAdminGlobal()) return true;
  const mio = miBazarId();
  return !!mio && Number(p.bazarId || 1) === Number(mio);
}

// El bazar al que se le asignan las prendas nuevas
function bazarParaNuevas() {
  if (!esAdminGlobal()) return miBazarId();
  return invBazarFiltro !== 'todos' ? Number(invBazarFiltro) : 1;
}

// Muestra u oculta las pestañas según lo que el bazar tenga permitido
function aplicarVisibilidadTabs() {
  const vend = document.getElementById('tab-vendedores');
  if (vend) vend.classList.toggle('hidden', !(esAdminGlobal() || (isAdmin() && puedo('gestionarUsuarios'))));

  const baz = document.getElementById('tab-bazares');
  if (baz) baz.classList.toggle('hidden', !(esAdminGlobal() || puedo('personalizar')));

  // El registro de actividad de toda la plataforma es solo del admin principal
  const sis = document.getElementById('tab-sistema');
  if (sis) sis.classList.toggle('hidden', !esAdminGlobal());

  // Catálogo: el admin principal o un bazar con permiso para el suyo
  const cat = document.getElementById('tab-catalogo');
  if (cat) cat.classList.toggle('hidden', !(esAdminGlobal() || (isAdmin() && puedo('gestionarCatalogo'))));

  // El perfil del sidebar se arma con la sesión activa
  pintarPerfilSidebar();
}

// ─── PERFIL DEL SIDEBAR ──────────────────────────────────────
// La tarjeta de la barra lateral es del bazar que inició sesión: si entra
// Papu Bazar dice PAPU BAZAR · ADMIN · PAPU BAZAR; si entra Stiimpys, la
// interfaz cambia sola en cuanto la BD trae su bazar.
function pintarPerfilSidebar() {
  const s = (typeof getSession === 'function' && getSession()) || session || {};
  const nombreEl = document.getElementById('sidebarUsername');
  const rolEl    = document.getElementById('sidebarRole');

  const b    = (typeof miBazar === 'function') ? miBazar() : null;
  const base = s.role === 'admin' ? 'Admin' : 'Vendedor';

  // Mientras la BD carga todavía no sabemos el bazar: se usa el usuario
  const identidad = b?.nombre || s.username || '';

  if (nombreEl) {
    nombreEl.textContent = identidad;
    nombreEl.title = identidad;
  }
  if (rolEl) {
    rolEl.textContent = b ? `${base} · ${b.nombre}`
                         : (esAdminGlobal() ? 'Admin · STMP MARKET' : base);
  }

  // El color del bazar tiñe el panel, igual que en su tienda pública
  if (b?.color) document.documentElement.style.setProperty('--bz-color', b.color);
}

// Categorías y marcas: las generales (sin bazarId) son de todos; un bazar
// además puede tener las suyas y solo edita esas.
function esGeneral(item) { return !item.bazarId; }
// El catálogo es común a toda la plataforma: cada bazar ve las categorías
// y marcas de los demás y puede usarlas al publicar. Lo que no cambia es
// quién manda sobre cada una: la insignia dice de quién es y solo su
// dueño la edita o la borra (el servidor lo vuelve a verificar).
function catalogoVisible(items) { return items; }
function catalogoEditable(item) {
  if (esAdminGlobal()) return true;
  return Number(item.bazarId || 0) === Number(miBazarId());
}

function nombreDeBazar(id) {
  const b = getBazarById(id || 1);
  return b ? b.nombre : 'Sin bazar';
}

function showTab(tab, fromHash) {
  if (TABS_SOLO_ADMIN.includes(tab) && !isAdmin()) return;
  if (TABS_SOLO_GLOBAL.includes(tab) && !esAdminGlobal()) return;
  if (tab === 'vendedores' && !esAdminGlobal() && !puedo('gestionarUsuarios')) return;
  if (tab === 'bazares'    && !esAdminGlobal() && !puedo('personalizar'))     return;
  currentTab = tab;
  ['inventario','registrar','vendedores','catalogo','bazares','cuenta','drops','subastas','ganancias','sistema'].forEach(t => {
    const v = document.getElementById('view-'+t);
    const b = document.getElementById('tab-'+t);
    if (v) v.classList.toggle('hidden', t!==tab);
    if (b) b.classList.toggle('active', t===tab);
  });
  if (tab==='inventario')  { clearForm(); renderAll(); }
  if (tab==='vendedores')  renderVendedores();
  if (tab==='bazares')     renderBazares();
  if (tab==='catalogo')    renderCatalogo();
  if (tab==='cuenta')      renderCuenta();
  if (tab==='drops')       renderDrops();
  if (tab==='subastas')    cargarSubastas();
  if (tab==='ganancias')   cargarGanancias();
  if (tab==='sistema')     renderSistema();
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
    vendedores:'Vendedores', bazares:'Bazares', drops:'Drops', subastas:'Subastas', ganancias:'Ganancias', cuenta:'Mi cuenta', sistema:'Sistema'
  };
  document.title = `${titulos[tab] || 'Panel'} · STMP MARKET`;
}

// Lee el hash de la URL y muestra esa pestaña (con validaciones)
function aplicarHash() {
  let tab = (location.hash || '').replace(/^#\/?/, '').trim();
  if (!TABS_VALIDAS.includes(tab)) tab = 'inventario';
  // Si un no-admin intenta entrar a una pestaña de admin por URL, lo mandamos a inventario
  if (TABS_SOLO_ADMIN.includes(tab) && !isAdmin()) tab = 'inventario';
  if (TABS_SOLO_GLOBAL.includes(tab) && !esAdminGlobal()) tab = 'inventario';
  if (tab === 'vendedores' && !esAdminGlobal() && !puedo('gestionarUsuarios')) tab = 'inventario';
  if (tab === 'bazares'    && !esAdminGlobal() && !puedo('personalizar'))     tab = 'inventario';
  showTab(tab, true);
}

// Botones atrás/adelante del navegador
window.addEventListener('hashchange', aplicarHash);

// Cerrar el modal de edición con Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('reEditModal')?.classList.contains('open')) {
    cerrarReEdicion();
  }
  if (e.key === 'Escape' && document.getElementById('ventaModal')?.classList.contains('open')) {
    cerrarModalVenta();
  }
  if (e.key === 'Escape' && document.getElementById('dlg')?.classList.contains('open')) {
    _dlgCerrar(_dlgCancelarValor);
  }
});

// ─── INIT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Sidebar perfil (se repinta al llegar la BD con el bazar de la sesión)
  pintarPerfilSidebar();
  loadAvatarFromStorage();

  // Aplicar preferencia de vista compacta desde el inicio
  if (typeof pref === 'function' && pref('compacto')) {
    document.body.classList.add('vista-compacta');
  }

  const tc = document.getElementById('tab-catalogo');
  if (tc) tc.classList.toggle('hidden', !isAdmin());

  await waitForDB();   // espera el primer fetch a MongoDB

  // Migración única: si el servidor no tiene drops pero hay drops locales
  // viejos en este navegador, subirlos una sola vez.
  try {
    if (isAdmin() && getDrops().length === 0) {
      const local = JSON.parse(localStorage.getItem('bazar_drops') || '[]');
      if (Array.isArray(local) && local.length) {
        saveDrops(local);
        localStorage.removeItem('bazar_drops');
        toast('Drops migrados al servidor');
      }
    }
  } catch (_) {}

  // Pestañas que dependen del bazar (los permisos llegan con la BD)
  aplicarVisibilidadTabs();

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
    _invPagina = 0;
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

window.addEventListener('db:bazares', () => {
  aplicarVisibilidadTabs();
  if (currentTab === 'bazares')    renderBazares();
  if (currentTab === 'inventario') renderAll();
});

window.addEventListener('db:usuarios', () => {
  if (currentTab === 'vendedores') renderVendedores();
  loadAvatarFromStorage();   // por si cambió mi avatar desde otro dispositivo
});

// Activos se actualiza automáticamente con el poll de /api/sync
window.addEventListener('db:activos', () => {
  updateOnlineBadge();
});

// ─── SELECTS DEL FORM ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════
//  TALLAS Y CONDICIÓN — listas predefinidas (js/opciones.js)
// ═══════════════════════════════════════════════════════════════

// Llena los tres selectores de talla de un formulario ('f' o 're')
function poblarTallas(pre) {
  const base = document.getElementById(`${pre}_talla_base`);
  if (base) {
    base.innerHTML = '<option value="">Sin talla</option>' +
      TALLAS.map(g =>
        `<optgroup label="${escAdmin(g.grupo)}">` +
        g.opciones.map(t => `<option value="${escAdmin(t)}">${escAdmin(t)}</option>`).join('') +
        `</optgroup>`).join('');
  }

  const queda = document.getElementById(`${pre}_talla_queda`);
  if (queda) {
    queda.innerHTML = '<option value="">Le queda a su talla</option>' +
      QUEDA_COMO.map(t => `<option value="${escAdmin(t)}">Queda como ${escAdmin(t)}</option>`).join('');
  }

  const ajuste = document.getElementById(`${pre}_talla_ajuste`);
  if (ajuste) {
    ajuste.innerHTML = '<option value="">Corte normal</option>' +
      AJUSTES.map(a => `<option value="${escAdmin(a)}">${escAdmin(a)}</option>`).join('');
  }
}

// Botones de condición. El valor real va en el input oculto.
function poblarEstados(pre) {
  const wrap = document.getElementById(`${pre}_estado_pills`);
  if (!wrap) return;
  const oculto = document.getElementById(`${pre}_estado`);
  const actual = oculto ? oculto.value : '';

  wrap.innerHTML = ESTADOS.map(e =>
    `<button type="button" class="estado-pill ${e === actual ? 'active' : ''}"
       data-estado="${escAdmin(e)}" onclick="elegirEstado('${pre}', this)">${escAdmin(e)}</button>`
  ).join('');
}

function elegirEstado(pre, btn) {
  const wrap = document.getElementById(`${pre}_estado_pills`);
  const oculto = document.getElementById(`${pre}_estado`);
  if (!wrap || !oculto) return;

  const valor = btn.dataset.estado;
  // Volver a tocar el mismo botón lo deselecciona
  const yaEstaba = oculto.value === valor;
  oculto.value = yaEstaba ? '' : valor;
  wrap.querySelectorAll('.estado-pill').forEach(b =>
    b.classList.toggle('active', !yaEstaba && b === btn));
}

// Lee la talla compuesta de un formulario
function leerTalla(pre) {
  const base   = document.getElementById(`${pre}_talla_base`)?.value || '';
  const queda  = document.getElementById(`${pre}_talla_queda`)?.value || '';
  const ajuste = document.getElementById(`${pre}_talla_ajuste`)?.value || '';
  return componerTalla(base, ajuste, queda);
}

// Escribe una talla guardada en los selectores
function escribirTalla(pre, texto) {
  const { base, quedaComo, ajuste } = descomponerTalla(texto);
  const selBase = document.getElementById(`${pre}_talla_base`);
  if (selBase) {
    // Si la talla es vieja y no está en la lista, se agrega para no perderla
    if (base && !TALLAS_PLANAS.includes(base)) {
      selBase.insertAdjacentHTML('beforeend',
        `<optgroup label="Guardada"><option value="${escAdmin(base)}">${escAdmin(base)}</option></optgroup>`);
    }
    selBase.value = base;
  }
  const selQueda = document.getElementById(`${pre}_talla_queda`);
  if (selQueda) selQueda.value = QUEDA_COMO.includes(quedaComo) ? quedaComo : '';
  const selAjuste = document.getElementById(`${pre}_talla_ajuste`);
  if (selAjuste) {
    if (ajuste && !AJUSTES.includes(ajuste)) {
      selAjuste.insertAdjacentHTML('beforeend', `<option value="${escAdmin(ajuste)}">${escAdmin(ajuste)}</option>`);
    }
    selAjuste.value = ajuste;
  }
}

// Escribe una condición guardada en los botones
function escribirEstado(pre, valor) {
  const oculto = document.getElementById(`${pre}_estado`);
  if (oculto) oculto.value = valor || '';
  const wrap = document.getElementById(`${pre}_estado_pills`);
  if (!wrap) return;
  poblarEstados(pre);
  // Condición vieja que no está en la lista: se agrega al final
  if (valor && !ESTADOS.includes(valor)) {
    wrap.insertAdjacentHTML('beforeend',
      `<button type="button" class="estado-pill active" data-estado="${escAdmin(valor)}"
         onclick="elegirEstado('${pre}', this)">${escAdmin(valor)}</button>`);
  }
}

function populateSelects() {
  const brandSel = document.getElementById('f_marca');
  if (brandSel) {
    brandSel.innerHTML = `<option value="">Sin marca</option>` +
      catalogoVisible(getBrands()).map(b => `<option value="${escAdmin(b.nombre)}">${escAdmin(b.nombre)}</option>`).join('');
  }
  renderCatCheckboxes([]);
  poblarTallas('f');
  poblarEstados('f');
}

function renderCatCheckboxes(selected = []) {
  const wrap = document.getElementById('f_cats_wrap');
  if (!wrap) return;
  const cats = catalogoVisible(getCats());
  if (!cats.length) {
    wrap.innerHTML = '<span style="font-size:11px;color:var(--muted)">No hay categorías. Créalas en la pestaña Catálogo.</span>';
    return;
  }
  wrap.innerHTML = cats.map(c => `
    <label class="cat-check">
      <input type="checkbox" value="${escAdmin(c.nombre)}" ${selected.includes(c.nombre)?'checked':''}>
      <span>${escAdmin(c.nombre)}</span>
    </label>`).join('');
}

function getSelectedCats() {
  return [...document.querySelectorAll('#f_cats_wrap input:checked')].map(i => i.value);
}

// ─── STATS ───────────────────────────────────────────────────
function renderStats() {
  const db         = prendasVisibles();
  const vendidos   = db.filter(p => p.vendido);
  const totalVentas  = vendidos.reduce((s,p) => s + (parseFloat(p.precio_venta)||0), 0);
  const totalCostos  = vendidos.reduce((s,p) => s + (parseFloat(p.costo)||0), 0);
  const ganancia     = totalVentas - totalCostos;
  const disponibles  = db.filter(p => !p.vendido).length;

  const adminStats = isAdmin() ? `
    <div class="stat-card green">
      <div class="stat-label">Ganancia Neta</div>
      <div class="stat-value green">$${ganancia.toFixed(2)} <span class="cur">MXN</span></div>
    </div>
    <div class="stat-card yellow">
      <div class="stat-label">Total Ventas</div>
      <div class="stat-value yellow">$${totalVentas.toFixed(2)} <span class="cur">MXN</span></div>
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
  _invPagina = 0;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderInv();
}

function renderAll() { pintarSelectorBazar(); renderStats(); renderInv(); }

// Selector de bazar del inventario — solo para el admin principal
function pintarSelectorBazar() {
  const sel = document.getElementById('invBazarSelect');
  if (!sel) return;
  if (!esAdminGlobal()) { sel.classList.add('hidden'); return; }

  sel.classList.remove('hidden');
  const bazares = getBazares();
  const html = ['<option value="todos">Todos los bazares</option>']
    .concat(bazares.map(b => `<option value="${b.id}">${escAdmin(b.nombre)}</option>`))
    .join('');
  if (sel.innerHTML !== html) sel.innerHTML = html;
  sel.value = String(invBazarFiltro);
}

function setInvBazar(val) {
  invBazarFiltro = val;
  _invPagina = 0;
  renderStats();
  renderInv();
}

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
  const db = prendasVisibles();
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
    const navE = document.getElementById('invPaginacion');
    if (navE) navE.innerHTML = '';
    return;
  }

  // Paginación (50 por página)
  const totalPaginas = Math.ceil(items.length / INV_POR_PAGINA);
  if (_invPagina > totalPaginas - 1) _invPagina = totalPaginas - 1;
  if (_invPagina < 0) _invPagina = 0;
  const inicioInv = _invPagina * INV_POR_PAGINA;
  const itemsPagina = items.slice(inicioInv, inicioInv + INV_POR_PAGINA);

  grid.innerHTML = itemsPagina.map(p => {
    const imgs    = Array.isArray(p.imagenes) ? p.imagenes : [];
    const idx     = Math.min(cardImgIdx[p.id]||0, Math.max(imgs.length-1, 0));
    const src     = imgs[idx] || '';
    const imgHtml = src ? `<img src="${escAdmin(src)}" alt="${escAdmin(p.nombre)}" loading="lazy">` : `<div class="no-img">Sin foto</div>`;
    const navHtml = imgs.length > 1
      ? `<button class="img-nav left"  onclick="prevImg(event,${p.id})">‹</button>
         <button class="img-nav right" onclick="nextImg(event,${p.id})">›</button>` : '';
    const vendidoBadge    = p.vendido ? `<div class="vendido-badge">Vendido</div>` : '';
    const photoCounterHtml = imgs.length > 0 ? `<div class="photo-counter">${idx+1}/${imgs.length}</div>` : '';

    // Quién se la llevó: el @username es lo que conecta la venta con la
    // cuenta del comprador en STMP MARKET.
    const compradorHtml = p.vendido && p.vendidoA
      ? `<div class="inv-card-comprador">Vendido a <b>@${escAdmin(p.vendidoA)}</b></div>` : '';

    const vendBtn = p.vendido
      ? `<button class="act-btn unsell" onclick="toggleVenta(${p.id},0)">Reactivar</button>`
      : `<button class="act-btn sell"   onclick="toggleVenta(${p.id},1)">Marcar como Vendido ${IC_CHECK}</button>`;

    // Tras entregar, el bazar también puede dejar su valoración del comprador
    const calBtn = (p.vendido && p.ventaId && p.vendidoA)
      ? (p.resenadoComprador
          ? `<span class="act-btn cal-hecha" title="Ya calificaste a @${escAdmin(p.vendidoA)}">★ Calificado</span>`
          : `<button class="act-btn cal" onclick="abrirModalComprador(${p.id})">★ Calificar comprador</button>`)
      : '';
    const delBtn    = `<button class="act-btn del" onclick="delItem(${p.id})">${IC_TRASH}</button>`;
    const costoHtml = isAdmin() ? `<span class="item-costo">Costo: $${p.costo}</span>` : '';

    // Cuando el admin principal ve varios bazares, cada card dice de quién es
    const bazarHtml = (esAdminGlobal() && invBazarFiltro === 'todos')
      ? `<div class="inv-card-bazar">${escAdmin(nombreDeBazar(p.bazarId))}</div>` : '';

    const cats    = Array.isArray(p.categorias) ? p.categorias : [];
    const tagsHtml = [
      p.marca ? `<span class="tag tag-brand">${escAdmin(p.marca)}</span>` : '',
      ...cats.map(c => `<span class="tag tag-cat">${escAdmin(c)}</span>`)
    ].join('');

    const subCard = sbDe(p.id);
    const enSubasta = !!subCard && !p.vendido;

    return `<div class="item-card${p.vendido?' vendido':''}${
      enSubasta ? (sbViva(subCard) ? ' en-subasta' : ' subasta-cerrada') : ''}" id="card-${p.id}">
      <div class="item-img" data-imgs='${JSON.stringify(imgs).replace(/'/g,"&#39;")}'>
        ${imgHtml}${navHtml}${vendidoBadge}${photoCounterHtml}
      </div>
      <div class="item-body">
        <div class="item-name">${escAdmin(p.nombre)}</div>
        ${bazarHtml}
        <div class="item-tags">${tagsHtml}</div>
        <div class="item-meta">Talla ${p.talla||'–'} · ${p.estado||''}</div>
        ${compradorHtml}
        ${enSubasta ? '' : `<div class="item-prices">
          <span class="item-price">$${p.precio_venta} <span class="cur">MXN</span></span>
          ${costoHtml}
        </div>`}
        ${enSubasta ? bloqueSubasta(p) + (costoHtml ? `<div class="item-prices solo-costo">${costoHtml}</div>` : '') : ''}
        <div class="item-actions">
          ${vendBtn}
          ${calBtn}
          <button class="act-btn edit" onclick="re_editar_prenda(${p.id})">${IC_EDIT}</button>
          ${delBtn}
        </div>
      </div>
    </div>`;
  }).join('');

  // Controles de paginación del inventario (mismo estilo que logs)
  const nav = document.getElementById('invPaginacion');
  if (nav) {
    if (totalPaginas <= 1) {
      nav.innerHTML = '';
    } else {
      const desde = inicioInv + 1;
      const hasta = Math.min(inicioInv + INV_POR_PAGINA, items.length);
      const nums = paginacionNumeros(_invPagina, totalPaginas);
      const numsHtml = nums.map(n => {
        if (n === '...') return `<span class="pg-ellipsis">···</span>`;
        return `<button class="pg-num ${n === _invPagina ? 'active' : ''}" onclick="invIrPagina(${n})">${n + 1}</button>`;
      }).join('');
      nav.innerHTML = `
        <div class="pg-bar">
          <button class="pg-arrow" onclick="invPagina(-1)" ${_invPagina === 0 ? 'disabled' : ''} aria-label="Anterior">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="pg-nums">${numsHtml}</div>
          <button class="pg-arrow" onclick="invPagina(1)" ${_invPagina >= totalPaginas - 1 ? 'disabled' : ''} aria-label="Siguiente">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="pg-info">${desde}–${hasta} de ${items.length} prendas</div>`;
    }
  }
}

// Paginación del inventario
let _invPagina = 0;
const INV_POR_PAGINA = 50;
function invPagina(delta) {
  _invPagina += delta;
  renderInv();
  scrollInvArriba();
}
function invIrPagina(n) {
  _invPagina = n;
  renderInv();
  scrollInvArriba();
}
function scrollInvArriba() {
  const ancla = document.getElementById('invGrid');
  if (ancla) {
    const y = ancla.getBoundingClientRect().top + window.scrollY - 90;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
}

// ─── ACCIONES ────────────────────────────────────────────────
// Marcar una prenda como vendida abre el registro de la venta: el bazar
// escribe el @username del comprador y con eso la prenda pasa a la
// pestaña "Vendidos" de su tienda y a "Mis Compras" del comprador.
function toggleVenta(id, estado) {
  if (estado) return abrirModalVenta(id);
  return revertirVenta(id);
}

let _ventaPrendaId = null;
let _modalModo = 'venta';        // 'venta' | 'comprador'
let _calEstrellas = 0;
let _calEtiquetas = new Set();

const ETIQUETAS_COMPRADOR = [
  'Pago puntual', 'Buena comunicación', 'Sin complicaciones', 'Volvería a venderle',
];
// Dejar constancia de que algo salió mal. Con 4 o 5 estrellas se ocultan:
// el servidor también las descarta, así que no vale marcarlas y subir.
const ETIQUETAS_COMPRADOR_MALAS = [
  'Tardó en responder', 'No se presentó', 'No pagó',
];

function tituloModalVenta(titulo, sub, boton) {
  const t = document.getElementById('ventaTitulo');
  const s = document.querySelector('#ventaModal .re-modal-sub');
  const b = document.getElementById('ventaGuardar');
  if (t) t.textContent = titulo;
  if (s) s.textContent = sub;
  if (b) b.textContent = boton;
}

function abrirModalVenta(id) {
  _modalModo = 'venta';
  const p = getDB().find(x => x.id === id);
  if (!p) return;
  _ventaPrendaId = id;

  const img = (Array.isArray(p.imagenes) && p.imagenes[0]) || '';
  const cont = document.getElementById('ventaModalBody');
  if (!cont) return;

  cont.innerHTML = `
    <div class="vt-prenda">
      ${img ? `<img src="${escAdmin(img)}" alt="${escAdmin(p.nombre)}">`
            : `<div class="vt-prenda-sinfoto"></div>`}
      <div class="vt-prenda-datos">
        <div class="vt-prenda-nombre">${escAdmin(p.nombre || 'Prenda')}</div>
        <div class="vt-prenda-meta">Talla ${escAdmin(p.talla || '–')}${p.marca ? ' · ' + escAdmin(p.marca) : ''}</div>
        <div class="vt-prenda-precio">$${Number(p.precio_venta || 0).toLocaleString('es-MX')} <span class="cur">MXN</span></div>
      </div>
    </div>

    <label class="vt-campo">
      <span>@username del comprador</span>
      <div class="vt-input-wrap">
        <span class="vt-arroba">@</span>
        <input type="text" id="ventaUsername" autocomplete="off" spellcheck="false"
               maxlength="30" placeholder="moisescm">
      </div>
    </label>
    <p class="vt-ayuda">
      Es el nombre de usuario que el comprador tiene en su cuenta de STMP MARKET.
      Al guardar, la prenda sale del catálogo activo y aparece en sus compras.
    </p>
    <div class="vt-error" id="ventaError"></div>`;

  tituloModalVenta('Registrar venta', '¿A quién se la vendiste?', 'Marcar como vendido');
  document.getElementById('ventaOverlay')?.classList.add('active');
  document.getElementById('ventaModal')?.classList.add('open');

  const input = document.getElementById('ventaUsername');
  if (input) {
    setTimeout(() => input.focus(), 120);
    input.addEventListener('input', () => {
      // El @username vive en minúsculas en toda la plataforma
      input.value = input.value.replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9._-]/g, '');
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') confirmarVenta(); });
  }
}

// ── Calificar al comprador ───────────────────────────────────
// Cierra el círculo de la reputación: lo que el bazar escribe aquí es lo
// que el comprador ve en su pestaña "Mis Reseñas".
function abrirModalComprador(id) {
  const p = getDB().find(x => x.id === id);
  if (!p || !p.ventaId) return;

  _modalModo = 'comprador';
  _ventaPrendaId = id;
  _calEstrellas = 0;
  _calEtiquetas = new Set();

  const cont = document.getElementById('ventaModalBody');
  if (!cont) return;

  cont.innerHTML = `
    <p class="vt-ayuda vt-intro">
      ¿Cómo te fue vendiéndole <b>${escAdmin(p.nombre || 'la prenda')}</b> a
      <b>@${escAdmin(p.vendidoA)}</b>?
    </p>

    <div class="vt-estrellas" id="calEstrellas" role="radiogroup" aria-label="Puntuación">
      ${[1,2,3,4,5].map(n => `
        <button type="button" class="vt-estrella" data-n="${n}" role="radio" aria-checked="false"
                aria-label="${n} estrella${n !== 1 ? 's' : ''}"
                onclick="elegirEstrellasComprador(${n})">★</button>`).join('')}
      <span class="vt-estrellas-txt" id="calEstrellasTxt">Toca las estrellas</span>
    </div>

    <div class="vt-campo">
      <span>¿Qué salió bien?</span>
      <div class="vt-etiquetas">
        ${ETIQUETAS_COMPRADOR.map(e => `
          <button type="button" class="vt-etiqueta" data-e="${escAdmin(e)}"
                  onclick="alternarEtiquetaComprador(this)">${escAdmin(e)}</button>`).join('')}
      </div>
    </div>

    <div class="vt-campo vt-campo-avisos" id="calAvisos" hidden>
      <span>¿Algo salió mal?</span>
      <div class="vt-etiquetas">
        ${ETIQUETAS_COMPRADOR_MALAS.map(e => `
          <button type="button" class="vt-etiqueta mala" data-e="${escAdmin(e)}"
                  onclick="alternarEtiquetaComprador(this)">${escAdmin(e)}</button>`).join('')}
      </div>
      <p class="vt-aviso-nota">Esto queda en el perfil del comprador para que otros bazares lo vean.</p>
    </div>

    <label class="vt-campo">
      <span>Tu comentario</span>
      <textarea id="calComentario" maxlength="500" rows="3"
                placeholder="Opcional: cómo fue el trato con este comprador"></textarea>
    </label>

    <div class="vt-error" id="ventaError"></div>`;

  tituloModalVenta('Calificar comprador', `Tu valoración de @${p.vendidoA}`, 'Enviar valoración');
  document.getElementById('ventaOverlay')?.classList.add('active');
  document.getElementById('ventaModal')?.classList.add('open');
}

function elegirEstrellasComprador(n) {
  _calEstrellas = n;
  document.querySelectorAll('#calEstrellas .vt-estrella').forEach(b => {
    b.classList.toggle('on', Number(b.dataset.n) <= n);
    b.setAttribute('aria-checked', String(Number(b.dataset.n) === n));
  });
  const el = document.getElementById('calEstrellasTxt');
  if (el) el.textContent = ['', 'Mala', 'Regular', 'Bien', 'Muy bien', 'Excelente'][n] || '';

  // Las etiquetas de aviso solo aparecen con 3 estrellas o menos, y si
  // subes la calificación se sueltan las que ya habías marcado.
  const avisos = document.getElementById('calAvisos');
  const mostrar = n > 0 && n <= 3;
  if (avisos) avisos.hidden = !mostrar;
  if (!mostrar) {
    ETIQUETAS_COMPRADOR_MALAS.forEach(e => _calEtiquetas.delete(e));
    document.querySelectorAll('#calAvisos .vt-etiqueta').forEach(b => b.classList.remove('on'));
  }
}

function alternarEtiquetaComprador(btn) {
  const e = btn.dataset.e;
  if (_calEtiquetas.has(e)) _calEtiquetas.delete(e); else _calEtiquetas.add(e);
  btn.classList.toggle('on', _calEtiquetas.has(e));
}

async function enviarResenaComprador() {
  const p = getDB().find(x => x.id === _ventaPrendaId);
  if (!p) return;
  if (!_calEstrellas) return errorVenta('Elige de 1 a 5 estrellas');

  const btn = document.getElementById('ventaGuardar');
  const txt = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
  errorVenta('');

  try {
    await api('/api/acciones?op=resena-comprador', { method: 'POST', body: {
      ventaId: p.ventaId,
      estrellas: _calEstrellas,
      etiquetas: [..._calEtiquetas],
      comentario: document.getElementById('calComentario')?.value || '',
    } });

    p.resenadoComprador = true;
    if (typeof _actualizarInventarioLocal === 'function') _actualizarInventarioLocal(getDB());
    cerrarModalVenta();
    renderAll();
    playActionSound('ok');
    toast(`Valoraste a @${p.vendidoA}`);
    if (typeof pollAhora === 'function') pollAhora(800);
  } catch (err) {
    errorVenta(err.message || 'No se pudo enviar la valoración');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = txt; }
  }
}

// El botón del pie del modal hace una cosa u otra según el modo
function guardarModalVenta() {
  return _modalModo === 'comprador' ? enviarResenaComprador() : confirmarVenta();
}

function cerrarModalVenta() {
  document.getElementById('ventaOverlay')?.classList.remove('active');
  document.getElementById('ventaModal')?.classList.remove('open');
  _ventaPrendaId = null;
}

function errorVenta(msg) {
  const el = document.getElementById('ventaError');
  if (el) { el.textContent = msg || ''; el.classList.toggle('visible', !!msg); }
}

async function confirmarVenta() {
  const id = _ventaPrendaId;
  if (id == null) return;

  const comprador = (document.getElementById('ventaUsername')?.value || '').trim();
  if (comprador.length < 3) return errorVenta('Escribe el @username del comprador');

  const btn = document.getElementById('ventaGuardar');
  const txt = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Registrando…'; }
  errorVenta('');

  try {
    await api('/api/acciones?op=marcar-vendido', { method: 'POST', body: { id, comprador } });

    // Reflejo inmediato en el panel. El cambio ya está en el servidor, así
    // que solo se actualiza el caché local (con escudo, para que un sync
    // viejo de otra instancia no "reviva" la prenda por un instante).
    const db = getDB();
    const p  = db.find(x => x.id === id);
    if (p) { p.vendido = true; p.vendidoA = comprador; p.vendidoEn = new Date().toISOString(); }
    if (typeof _actualizarInventarioLocal === 'function') _actualizarInventarioLocal(db);

    cerrarModalVenta();
    renderAll();
    registrarLog('vender', p?.nombre || ('#' + id),
                 `Vendido a @${comprador} · $${p?.precio_venta ?? '-'} MXN`);
    playActionSound('sell');
    toast(`Vendido a @${comprador}`);
    if (typeof pollAhora === 'function') pollAhora(800);
  } catch (err) {
    errorVenta(err.message || 'No se pudo registrar la venta');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = txt; }
  }
}

// Deshacer una venta devuelve la prenda al catálogo y borra su reseña:
// si nunca ocurrió, tampoco debe quedar reputación de ella.
async function revertirVenta(id) {
  const p = getDB().find(x => x.id === id);
  if (!p) return;
  const seguro = await uiConfirm({
    titulo: 'Reactivar prenda',
    sub: p.nombre || ('#' + id),
    mensaje: `Se borra el registro de la venta${p.vendidoA ? ` a @${p.vendidoA}` : ''} y su reseña. La prenda vuelve al catálogo.`,
    ok: 'Reactivar', peligro: true,
  });
  if (!seguro) return;

  try {
    await api('/api/acciones?op=revertir-venta', { method: 'POST', body: { id } });
    p.vendido = false; delete p.vendidoA; delete p.vendidoEn; delete p.ventaId;
    if (typeof _actualizarInventarioLocal === 'function') _actualizarInventarioLocal(getDB());
    renderAll();
    registrarLog('reactivar', p.nombre || ('#' + id), '');
    playActionSound('ok');
    toast('Prenda reactivada');
    if (typeof pollAhora === 'function') pollAhora(800);
  } catch (err) {
    toast(err.message || 'No se pudo reactivar');
  }
}
async function delItem(id) {
  const admin = isAdmin();
  const prenda = getDB().find(x => x.id===id);
  // Respeta la preferencia "Confirmar antes de eliminar"
  if (pref('confirm_del')) {
    const segundos = admin ? 5 : 13;   // vendedor: cooldown mayor por seguridad
    const ok = await modalEliminarPrenda(prenda, segundos);
    if (!ok) return;
  }

  // Borrado en el servidor (valida el límite por hora para vendedores)
  try {
    const s = getSession();
    const r = await api('/api/acciones?op=borrar-prenda', {
      method: 'POST',
      body: { id, usuario: s.username, rol: s.role }
    });
    if (!r.ok) { toast('No se pudo eliminar'); return; }
  } catch (e) {
    // El servidor devuelve 429 si se pasó del límite
    toast(e.message || 'No se pudo eliminar');
    playActionSound('error');
    return;
  }

  // Reflejar en local sin re-enviar todo el inventario (ya se borró en el server)
  _actualizarInventarioLocal(getDB().filter(x => x.id!==id));
  registrarLog('eliminar', prenda?.nombre || ('#'+id), prenda?.marca ? `Marca: ${prenda.marca}` : '');
  playActionSound('del');
  renderAll(); toast('Prenda eliminada');
}

// Modal de confirmación premium para eliminar prenda (cooldown configurable)
function modalEliminarPrenda(prenda, segundos = 5) {
  return new Promise(resolve => {
    document.getElementById('modalEliminar')?.remove();

    const nombre = prenda?.nombre ? escapeHtml(prenda.nombre) : 'esta prenda';
    const ov = document.createElement('div');
    ov.id = 'modalEliminar';
    ov.className = 'del-modal-ov';
    ov.innerHTML = `
      <div class="del-modal">
        <div class="del-modal-icon">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        </div>
        <div class="del-modal-title">¿Eliminar prenda?</div>
        <div class="del-modal-text">Estás por eliminar <strong>${nombre}</strong>. Esta acción no se puede deshacer.</div>
        <div class="del-modal-actions">
          <button class="del-modal-cancel" id="delCancel">Cancelar</button>
          <button class="del-modal-confirm" id="delConfirm" disabled>
            <span id="delConfirmTxt">Espera ${segundos}s</span>
          </button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('show'));

    const btn    = ov.querySelector('#delConfirm');
    const btnTxt = ov.querySelector('#delConfirmTxt');
    const cancel = ov.querySelector('#delCancel');

    let restante = segundos;
    const tick = setInterval(() => {
      restante--;
      if (restante > 0) {
        btnTxt.textContent = `Espera ${restante}s`;
      } else {
        clearInterval(tick);
        btn.disabled = false;
        btn.classList.add('ready');
        btnTxt.textContent = 'Eliminar';
      }
    }, 1000);

    const cerrar = (valor) => {
      clearInterval(tick);
      ov.classList.remove('show');
      setTimeout(() => ov.remove(), 200);
      resolve(valor);
    };

    btn.onclick    = () => { if (!btn.disabled) cerrar(true); };
    cancel.onclick = () => cerrar(false);
    ov.onclick     = (e) => { if (e.target === ov) cerrar(false); };
    document.addEventListener('keydown', function esc(e){
      if (e.key === 'Escape') { document.removeEventListener('keydown', esc); cerrar(false); }
    });
  });
}
function editItem(id) {
  const p = getDB().find(x => x.id===id); if (!p) return;
  clearForm();
  document.getElementById('editId').value   = id;
  document.getElementById('f_nombre').value = p.nombre||'';
  document.getElementById('f_precio').value = p.precio_venta||'';
  document.getElementById('f_costo').value  = p.costo||'';
  poblarTallas('f');
  escribirTalla('f', p.talla || '');
  escribirEstado('f', p.estado || '');
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
      getBrands().map(b => `<option value="${escAdmin(b.nombre)}">${escAdmin(b.nombre)}</option>`).join('');
    brandSel.value = p.marca || '';
  }

  // Poblar categorías (checkboxes)
  reRenderCatChecks(Array.isArray(p.categorias) ? p.categorias : []);

  // Campos de texto
  document.getElementById('re_editId').value      = id;
  document.getElementById('re_nombre').value      = p.nombre || '';
  poblarTallas('re');
  escribirTalla('re', p.talla || '');
  document.getElementById('re_precio').value      = p.precio_venta ?? '';
  document.getElementById('re_costo').value       = p.costo ?? '';
  escribirEstado('re', p.estado || '');
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
  const cats = catalogoVisible(getCats());
  if (!cats.length) {
    wrap.innerHTML = '<span style="font-size:11px;color:var(--muted)">No hay categorías. Créalas en la pestaña Catálogo.</span>';
    return;
  }
  wrap.innerHTML = cats.map(c => `
    <label class="cat-check">
      <input type="checkbox" value="${escAdmin(c.nombre)}" ${selected.includes(c.nombre)?'checked':''}>
      <span>${escAdmin(c.nombre)}</span>
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
        toast('Foto subida');
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
      <img src="${escAdmin(src)}" alt="">
      <button onclick="reRemovePreview(${i})">${IC_X}</button>
    </div>`).join('');
}

function reRemovePreview(i) {
  reEditImgs.splice(i, 1);
  reRenderPreviews();
}

async function guardarReEdicion() {
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

  // Guardar estado anterior para comparar
  const antes = { nombre:p.nombre, precio_venta:p.precio_venta, costo:p.costo, talla:p.talla, marca:p.marca, estado:p.estado, categorias:p.categorias, imagenes:p.imagenes };

  // Actualizar SOLO esta prenda — sin crear una nueva
  p.nombre       = nombre;
  p.marca        = document.getElementById('re_marca').value;
  p.categorias   = reGetSelectedCats();
  p.talla        = leerTalla('re');
  p.precio_venta = precio;
  p.costo        = costo;
  p.estado       = (document.getElementById('re_estado').value || '').trim();
  p.descripcion  = document.getElementById('re_descripcion').value.trim();
  p.imagenes     = [...reEditImgs];

  try {
    await guardarPrenda(p.id, {
      nombre: p.nombre, marca: p.marca, categorias: p.categorias,
      talla: p.talla, precio_venta: p.precio_venta, costo: p.costo,
      estado: p.estado, descripcion: p.descripcion, imagenes: p.imagenes,
    });
  } catch (err) {
    toast(err.message || 'No se pudieron guardar los cambios');
    return;
  }
  registrarLog('editar', nombre, diffPrenda(antes, p));
  playActionSound('ok');
  cerrarReEdicion();
  renderAll();
  toast('Cambios guardados');
}

// ─── FORM ────────────────────────────────────────────────────
let newImages = [], editImages = [];

/* ── COMPRESIÓN DE FOTOS ──────────────────────────────────────
   Las fotos salían del teléfono con 3-4 MB y se guardaban así en
   Cloudinary, aunque la tienda nunca las muestra a más de 600 px de
   ancho. Eso gastaba la cuota por partida doble: al guardarlas y al
   servirlas. Aquí se reducen antes de subir, en el propio navegador.

   El cambio no se nota: a 1600 px sigue habiendo de sobra para el zoom
   de la ficha, y el peso baja del orden de seis veces. */
const IMG_LADO_MAX = 1600;   // px del lado más largo
const IMG_CALIDAD  = 0.82;   // suficiente para fotos de ropa
const IMG_YA_LIGERA = 300 * 1024;   // por debajo de esto no vale la pena tocarla

// data:...;base64 → Blob, sin pasar por fetch() (la política de seguridad
// del sitio restringe connect-src y bloquearía la petición).
function _dataUrlABlob(dataUrl) {
  const coma = dataUrl.indexOf(',');
  const tipo = (dataUrl.slice(0, coma).match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin  = atob(dataUrl.slice(coma + 1));
  const buf  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: tipo });
}

async function _aLienzo(dataUrl) {
  const blob = _dataUrlABlob(dataUrl);
  // createImageBitmap respeta la orientación EXIF. Dibujar un <img> en un
  // canvas NO siempre lo hace, y las fotos verticales salían giradas.
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
    catch (_) { /* sin soporte para la opción: se cae al plan B */ }
  }
  return await new Promise((ok, err) => {
    const img = new Image();
    img.onload  = () => ok(img);
    img.onerror = () => err(new Error('imagen ilegible'));
    img.src = dataUrl;
  });
}

async function comprimirImagen(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return dataUrl;

  const tipo = (dataUrl.slice(0, 40).match(/data:(image\/[a-z+-]+)/) || [])[1] || '';
  if (tipo === 'image/gif') return dataUrl;   // podría estar animado

  const pesoOriginal = Math.round(dataUrl.length * 0.75);   // base64 abulta ~33%

  try {
    const fuente = await _aLienzo(dataUrl);
    const ancho0 = fuente.width, alto0 = fuente.height;
    const lado   = Math.max(ancho0, alto0);
    const escala = lado > IMG_LADO_MAX ? IMG_LADO_MAX / lado : 1;

    // Ya es chica y ligera: recomprimirla solo la empeoraría
    if (escala === 1 && pesoOriginal <= IMG_YA_LIGERA) { fuente.close?.(); return dataUrl; }

    const lienzo = document.createElement('canvas');
    lienzo.width  = Math.round(ancho0 * escala);
    lienzo.height = Math.round(alto0  * escala);
    const ctx = lienzo.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(fuente, 0, 0, lienzo.width, lienzo.height);
    fuente.close?.();

    // WebP pesa menos y conserva la transparencia (importante para los
    // logos de los bazares). Si el navegador no lo genera, JPEG para las
    // fotos; lo que pueda tener alfa se deja intacto antes que estropearlo.
    const haceWebp = lienzo.toDataURL('image/webp', .5).startsWith('data:image/webp');
    let salida;
    if (haceWebp)                  salida = lienzo.toDataURL('image/webp', IMG_CALIDAD);
    else if (tipo === 'image/png') return dataUrl;
    else                           salida = lienzo.toDataURL('image/jpeg', IMG_CALIDAD);

    // Nunca devolver algo más pesado que lo que entró
    if (salida.length >= dataUrl.length) return dataUrl;

    const kb = n => (n / 1024).toFixed(0) + ' KB';
    console.info(`[foto] ${ancho0}×${alto0} ${kb(pesoOriginal)} → ` +
                 `${lienzo.width}×${lienzo.height} ${kb(salida.length * 0.75)}`);
    return salida;
  } catch (_) {
    return dataUrl;   // ante cualquier fallo, se sube tal cual
  }
}

// Sube una imagen a Cloudinary y devuelve la URL.
// Comprime antes: así todas las vías de subida quedan cubiertas sin
// tener que acordarse en cada una.
async function uploadToCloud(base64) {
  const archivo = await comprimirImagen(base64);
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: archivo })
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
        toast('Foto subida');
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
      <button onclick="removePreview(${i})">${IC_X}</button>
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
  ['f_nombre','f_precio','f_costo','f_estado','f_descripcion','f_dropNombre'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const brandSel = document.getElementById('f_marca');
  if (brandSel) brandSel.value = '';
  poblarTallas('f');
  escribirEstado('f', '');
  renderCatCheckboxes([]);
  newImages = []; editImages = [];
  renderPreviews();
  document.getElementById('formTitle').textContent = 'Nuevo Registro';
  const useDrop = document.getElementById('f_useDrop');
  if (useDrop) useDrop.checked = false;
  toggleDropField();
  ['f_sbInicial','f_sbFin','f_sbReserva'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const useSb = document.getElementById('f_useSubasta');
  if (useSb) useSb.checked = false;
  toggleSubastaField();
}
// Arma un texto con los datos clave de una prenda (para logs de "subir")
function detallePrenda({ precio, costo, talla, categorias }) {
  const cats = Array.isArray(categorias)
    ? categorias.map(c => (typeof c === 'object' ? c.nombre : c)).filter(Boolean).join(', ')
    : '';
  const partes = [];
  if (precio != null && !isNaN(precio)) partes.push(`Precio: $${precio}`);
  if (costo  != null && !isNaN(costo))  partes.push(`Costo: $${costo}`);
  if (talla)  partes.push(`Talla: ${talla}`);
  if (cats)   partes.push(`Cat: ${cats}`);
  return partes.join(' · ');
}

// Compara la prenda anterior con los valores nuevos y devuelve solo lo que cambió
function diffPrenda(anterior, nuevo) {
  const catsTxt = arr => (Array.isArray(arr)
    ? arr.map(c => (typeof c === 'object' ? c.nombre : c)).filter(Boolean).join(', ')
    : '');
  const campos = [
    ['Nombre', anterior.nombre,       nuevo.nombre],
    ['Precio', anterior.precio_venta, nuevo.precio_venta, true],
    ['Costo',  anterior.costo,        nuevo.costo, true],
    ['Talla',  anterior.talla,        nuevo.talla],
    ['Marca',  anterior.marca,        nuevo.marca],
    ['Estado', anterior.estado,       nuevo.estado],
    ['Cat',    catsTxt(anterior.categorias), catsTxt(nuevo.categorias)],
  ];
  const cambios = [];
  for (const [label, viejo, nvo, money] of campos) {
    const a = viejo == null ? '' : String(viejo);
    const b = nvo   == null ? '' : String(nvo);
    if (a !== b) {
      const fa = money ? `$${a || 0}` : (a || '—');
      const fb = money ? `$${b || 0}` : (b || '—');
      cambios.push(`${label}: ${fa} → ${fb}`);
    }
  }
  // Detectar cambio de imágenes (cantidad)
  const nA = Array.isArray(anterior.imagenes) ? anterior.imagenes.length : 0;
  const nB = Array.isArray(nuevo.imagenes)    ? nuevo.imagenes.length    : 0;
  if (nB && nA !== nB) cambios.push(`Fotos: ${nA} → ${nB}`);
  return cambios.length ? cambios.join(' · ') : 'Sin cambios de datos';
}

async function submitForm() {
  if (!esAdminGlobal() && !puedo('crearPrendas') && !puedo('editarPrendas')) {
    return toast('Tu bazar no tiene permitido publicar prendas');
  }
  const nombre = document.getElementById('f_nombre').value.trim();
  const precio = parseFloat(document.getElementById('f_precio').value);
  const costo  = parseFloat(document.getElementById('f_costo').value);
  if (!nombre)              { toast('El nombre es obligatorio'); return; }
  if (isNaN(precio)||precio<0) { toast('Precio inválido'); return; }
  if (isNaN(costo) ||costo <0) { toast('Costo inválido');  return; }

  // Subasta: se valida antes de guardar nada, para no dejar la prenda
  // publicada y la subasta a medias.
  const cfgSubasta = leerSubastaForm();
  if (cfgSubasta?.error) { toast(cfgSubasta.error); return; }

  const combined = [...editImages, ...newImages];
  const editId   = parseInt(document.getElementById('editId').value) || 0;
  let nuevoIdParaSubasta = editId || null;
  const marca     = document.getElementById('f_marca').value;
  const categorias = getSelectedCats();
  let db = getDB();

  if (editId) {
    const p = db.find(x => x.id===editId);
    let cambios = 'Sin cambios de datos';
    if (p) {
      const antes = { nombre:p.nombre, precio_venta:p.precio_venta, costo:p.costo, talla:p.talla, marca:p.marca, estado:p.estado, categorias:p.categorias, imagenes:p.imagenes };
      const nuevos = {
        nombre, marca, categorias,
        talla: leerTalla('f'),
        precio_venta: precio, costo,
        estado: document.getElementById('f_estado').value.trim(),
        descripcion: (document.getElementById('f_descripcion')?.value || '').trim(),
      };
      if (combined.length) nuevos.imagenes = combined;
      cambios = diffPrenda(antes, { ...p, ...nuevos });
      try {
        await guardarPrenda(editId, nuevos);
      } catch (err) {
        toast(err.message || 'No se pudo guardar');
        return;
      }
    }
    registrarLog('editar', nombre, cambios);
    playActionSound('ok');
    toast('Prenda actualizada');
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
        if (new Date(dropFecha).getTime() <= Date.now()) {
          toast('La fecha del drop debe ser futura');
          return;
        }
        dropIdFinal = 'drop_' + Date.now();
        const drops = getDrops();
        drops.push({ id: dropIdFinal, nombre: dropNombre, fecha: dropFecha, prendas: [], publicado: false, creadoEn: new Date().toISOString() });
        saveDrops(drops);
        registrarLog('drop_crear', dropNombre, `Fecha: ${dropFecha}`);
        playActionSound('ok');
      } else {
        dropIdFinal = dropId;
      }
    }

    // El id lo pone el servidor: dos vendedores publicando a la vez ya no
    // se pisan el número.
    let nuevaPrenda;
    try {
      nuevaPrenda = await crearPrenda({
        nombre, marca, categorias,
        talla: leerTalla('f'),
        precio_venta: precio, costo,
        estado: document.getElementById('f_estado').value.trim(),
        descripcion: (document.getElementById('f_descripcion')?.value||'').trim(),
        imagenes: combined, vendido: false,
        oculto: !!dropIdFinal,
        bazarId: bazarParaNuevas(),
      });
    } catch (err) {
      toast(err.message || 'No se pudo publicar la prenda');
      return;
    }
    nuevoIdParaSubasta = nuevaPrenda.id;

    const talla = leerTalla('f');
    if (dropIdFinal) {
      const drops = getDrops();
      const drop  = drops.find(d => d.id === dropIdFinal);
      if (drop) { drop.prendas.push(nuevaPrenda.id); saveDrops(drops); }
      registrarLog('subir', nombre, `${detallePrenda({ precio, costo, talla, categorias })} · En drop "${drop ? drop.nombre : ''}"`);
      playActionSound('ok');
      toast('Prenda guardada en el drop');
    } else {
      registrarLog('subir', nombre, `Marca: ${marca} · ${detallePrenda({ precio, costo, talla, categorias })}`);
      playActionSound('ok');
      toast('Prenda publicada');
    }
  }
  // La prenda ya está en el servidor (crearPrenda / guardarPrenda), así
  // que la subasta se le puede colgar directamente.
  if (cfgSubasta && nuevoIdParaSubasta != null) {
    const btn = document.getElementById('submitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'ABRIENDO SUBASTA…'; }
    await aplicarSubasta(nuevoIdParaSubasta, cfgSubasta);
    if (btn) { btn.disabled = false; btn.textContent = 'PUBLICAR EN BAZAR'; }
  }

  clearForm(); showTab('inventario');
}

// ═══════════════════════════════════════════════════════════════
//  BAZARES — el admin principal crea las tiendas y reparte permisos.
//  Cada bazar solo ve su propia ficha y la personaliza.
// ═══════════════════════════════════════════════════════════════
const PERMISOS_LBL = {
  crearPrendas:      'Publicar prendas',
  editarPrendas:     'Editar sus prendas',
  borrarPrendas:     'Borrar sus prendas',
  gestionarUsuarios: 'Crear cuentas de su bazar',
  gestionarCatalogo: 'Crear sus categorías y marcas',
  personalizar:      'Personalizar su apartado',
};

let _bazarAbierto = null;   // id del bazar que se está editando

// Colores sugeridos (el bazar puede escribir cualquier otro en hexadecimal)
const PALETA = ['#2d6be4', '#2e8b57', '#e05c5c', '#f2a01d', '#8b5cf6',
                '#0ea5a4', '#ec4899', '#1a1f2e'];

// Devuelve el hex normalizado (#rrggbb) o null si no es válido
function colorValido(v) {
  if (!v) return null;
  let c = String(v).trim();
  if (!c.startsWith('#')) c = '#' + c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    // #abc → #aabbcc
    c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  }
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : null;
}

// Mantiene sincronizados el selector visual y el campo hexadecimal
function sincronizarColor(id, origen) {
  const picker = document.getElementById(`bz_color_${id}`);
  const texto  = document.getElementById(`bz_colorhex_${id}`);
  const prev   = document.getElementById(`bz_colorprev_${id}`);
  if (!picker || !texto) return;

  if (origen === 'picker') {
    texto.value = picker.value;
    texto.classList.remove('malo');
  } else {
    const c = colorValido(texto.value);
    texto.classList.toggle('malo', !c && texto.value.trim() !== '');
    if (c) picker.value = c;
  }
  const actual = colorValido(texto.value) || picker.value;
  if (prev) prev.style.background = actual;
}

// Clic en uno de los colores sugeridos
function elegirColor(id, hex) {
  const picker = document.getElementById(`bz_color_${id}`);
  const texto  = document.getElementById(`bz_colorhex_${id}`);
  if (picker) picker.value = hex;
  if (texto)  texto.value  = hex;
  sincronizarColor(id, 'picker');
}

function renderBazares() {
  const wrap = document.getElementById('bazaresList');
  if (!wrap) return;

  const global = esAdminGlobal();
  const lista  = global ? getBazares() : getBazares().filter(b => Number(b.id) === Number(miBazarId()));

  const btnNuevo = document.getElementById('btnNuevoBazar');
  if (btnNuevo) btnNuevo.classList.toggle('hidden', !global);

  const sub = document.getElementById('bazaresSubtitle');
  if (sub) sub.textContent = global
    ? 'Crea bazares, define qué puede hacer cada uno y administra sus cuentas'
    : 'Personaliza cómo se ve tu bazar en el catálogo';

  if (!lista.length) {
    wrap.innerHTML = `<div class="bz-empty">
      ${global ? 'Aún no hay bazares. Crea el primero.' : 'Tu cuenta todavía no está asignada a un bazar.'}
    </div>`;
    return;
  }

  const conteo = {};
  getDB().forEach(p => {
    const id = String(p.bazarId || 1);
    conteo[id] = (conteo[id] || 0) + 1;
  });

  wrap.innerHTML = lista.map(b => {
    const abierto = Number(_bazarAbierto) === Number(b.id);
    const perms   = b.permisos || {};
    const n       = conteo[String(b.id)] || 0;

    return `<div class="bz-card ${abierto ? 'open' : ''}">
      <div class="bz-card-head" onclick="toggleBazar(${b.id})">
        <div class="bz-card-logo" style="background:${escAdmin(b.color || '#2d6be4')}">
          ${(b.logo || b.portada)
            ? `<img src="${escAdmin(b.logo || b.portada)}" alt="Logo de ${escAdmin(b.nombre)}">`
            : escAdmin((b.nombre || '?').charAt(0))}
        </div>
        <div class="bz-card-info">
          <div class="bz-card-name">${escAdmin(b.nombre)} ${b.activo === false ? '<span class="bz-off">Pausado</span>' : ''}</div>
          <div class="bz-card-slug">@${escAdmin(b.slug)} · ${n} prenda${n !== 1 ? 's' : ''}</div>
        </div>
        <span class="bz-card-caret">${abierto ? '▴' : '▾'}</span>
      </div>

      ${abierto ? `<div class="bz-card-body">
        <div class="bz-form">
          <label>Nombre del bazar
            <input type="text" id="bz_nombre_${b.id}" value="${escAdmin(b.nombre)}" maxlength="40">
          </label>
          <label>Usuario público (@)
            <input type="text" id="bz_slug_${b.id}" value="${escAdmin(b.slug)}" maxlength="30" ${global ? '' : 'disabled'}>
          </label>
          <label>WhatsApp (con lada)
            <input type="text" id="bz_wa_${b.id}" value="${escAdmin(b.whatsapp || '')}" inputmode="numeric" maxlength="15">
          </label>
          <label>Instagram
            <input type="text" id="bz_ig_${b.id}" value="${escAdmin(b.instagram || '')}" maxlength="40" placeholder="usuario, sin @">
          </label>
          <label>TikTok
            <input type="text" id="bz_tt_${b.id}" value="${escAdmin(b.tiktok || '')}" maxlength="40" placeholder="usuario, sin @">
          </label>
          <label>Facebook
            <input type="text" id="bz_fb_${b.id}" value="${escAdmin(b.facebook || '')}" maxlength="60" placeholder="nombre de la página">
          </label>
          <label>Ubicación
            <input type="text" id="bz_ubi_${b.id}" value="${escAdmin(b.ubicacion || '')}" maxlength="60">
          </label>
          <label class="bz-full">Descripción
            <textarea id="bz_desc_${b.id}" rows="3" maxlength="240">${escAdmin(b.descripcion || '')}</textarea>
          </label>
          <label class="bz-full">Color del bazar
            <span class="bz-color-row">
              <input type="color" id="bz_color_${b.id}" value="${escAdmin(colorValido(b.color) || '#2d6be4')}"
                class="bz-color" oninput="sincronizarColor(${b.id}, 'picker')">
              <input type="text" id="bz_colorhex_${b.id}" value="${escAdmin(colorValido(b.color) || '#2d6be4')}"
                class="bz-colorhex" maxlength="7" spellcheck="false" placeholder="#2d6be4"
                oninput="sincronizarColor(${b.id}, 'texto')" aria-label="Color en hexadecimal">
              <span class="bz-color-preview" id="bz_colorprev_${b.id}"
                style="background:${escAdmin(colorValido(b.color) || '#2d6be4')}"></span>
            </span>
            <span class="bz-color-sugerencias">
              ${PALETA.map(c => `<button type="button" class="bz-color-chip" style="background:${c}"
                  title="${c}" onclick="elegirColor(${b.id}, '${c}')"></button>`).join('')}
            </span>
            <span class="bz-color-nota">Se usa en su @, sus botones, sus tarjetas y su apartado.</span>
          </label>
        </div>

        <div class="bz-media">
          <div class="bz-media-item">
            <span class="bz-media-lbl">Logo</span>
            <div class="bz-logo-pick" id="bz_logo_prev_${b.id}">
              ${(b.logo || b.portada)
                ? `<img src="${escAdmin(b.logo || b.portada)}" alt="Logo">`
                : `<span class="bz-media-ph">${escAdmin((b.nombre || '?').charAt(0))}</span>`}
            </div>
            <input type="file" accept="image/*" id="bz_logo_file_${b.id}" hidden
              onchange="subirImagenBazar(${b.id}, 'logo', this.files[0])">
            <div class="bz-media-btns">
              <button type="button" class="bz-media-btn" onclick="document.getElementById('bz_logo_file_${b.id}').click()">Subir logo</button>
              ${(b.logo || b.portada) ? `<button type="button" class="bz-media-btn del" onclick="quitarImagenBazar(${b.id},'logo')">Quitar</button>` : ''}
            </div>
          </div>

          <div class="bz-media-item bz-media-wide">
            <span class="bz-media-lbl">Banner (imagen ancha de fondo)</span>
            <div class="bz-banner-pick" id="bz_banner_prev_${b.id}">
              ${b.banner ? `<img src="${escAdmin(b.banner)}" alt="Banner">` : `<span class="bz-media-ph">Sin banner</span>`}
            </div>
            <input type="file" accept="image/*" id="bz_banner_file_${b.id}" hidden
              onchange="subirImagenBazar(${b.id}, 'banner', this.files[0])">
            <div class="bz-media-btns">
              <button type="button" class="bz-media-btn" onclick="document.getElementById('bz_banner_file_${b.id}').click()">Subir banner</button>
              ${b.banner ? `<button type="button" class="bz-media-btn del" onclick="quitarImagenBazar(${b.id},'banner')">Quitar</button>` : ''}
            </div>
          </div>
        </div>

        ${global ? `
          <div class="bz-perms">
            <div class="bz-perms-title">Permisos de este bazar</div>
            ${Object.keys(PERMISOS_LBL).map(k => `
              <label class="bz-perm">
                <input type="checkbox" id="bz_perm_${b.id}_${k}" ${perms[k] ? 'checked' : ''}>
                <span>${PERMISOS_LBL[k]}</span>
              </label>`).join('')}
            <label class="bz-perm bz-perm-sep">
              <input type="checkbox" id="bz_activo_${b.id}" ${b.activo !== false ? 'checked' : ''}>
              <span>Visible en el catálogo público</span>
            </label>
          </div>` : `
          <div class="bz-perms bz-perms-ro">
            <div class="bz-perms-title">Lo que tu bazar puede hacer</div>
            ${Object.keys(PERMISOS_LBL).map(k => `
              <div class="bz-perm-ro ${perms[k] ? 'on' : 'off'}">
                ${perms[k] ? '✓' : '✕'} ${PERMISOS_LBL[k]}
              </div>`).join('')}
            <p class="bz-perms-nota">Solo el administrador principal cambia estos permisos.</p>
          </div>`}

        <div class="bz-actions">
          <button class="submit-btn" style="width:auto;padding:12px 24px" onclick="guardarBazar(${b.id})">Guardar cambios</button>
          <a class="btn-ghost" href="tienda.html?bazar=${encodeURIComponent(b.slug)}" target="_blank">Ver apartado público</a>
          ${global && Number(b.id) !== 1 ? `<button class="btn-danger" onclick="eliminarBazar(${b.id})">Eliminar bazar</button>` : ''}
        </div>
      </div>` : ''}
    </div>`;
  }).join('');
}

// Sube el logo o el banner del bazar y lo guarda al instante
async function subirImagenBazar(id, campo, file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('Ese archivo no es una imagen');
  if (file.size > 5 * 1024 * 1024)     return toast('La imagen pesa más de 5 MB');

  toast('Subiendo imagen...');
  const base64 = await new Promise((ok, err) => {
    const r = new FileReader();
    r.onload  = () => ok(r.result);
    r.onerror = err;
    r.readAsDataURL(file);
  });

  let url;
  try {
    url = await uploadToCloud(base64);
  } catch (e) {
    return toast('No se pudo subir: ' + e.message);
  }

  const lista = getBazares().map(b => ({ ...b }));
  const b = lista.find(x => Number(x.id) === Number(id));
  if (!b) return;
  b[campo] = url;
  if (campo === 'logo') b.portada = url;   // compatibilidad con el campo viejo

  saveBazares(lista)
    .then(() => {
      registrarLog('bazar_editar', b.nombre, campo === 'logo' ? 'Nuevo logo' : 'Nuevo banner');
      playActionSound('ok');
      toast(campo === 'logo' ? 'Logo actualizado' : 'Banner actualizado');
      renderBazares();
    })
    .catch(e => toast(e.message || 'No se pudo guardar'));
}

function quitarImagenBazar(id, campo) {
  const lista = getBazares().map(b => ({ ...b }));
  const b = lista.find(x => Number(x.id) === Number(id));
  if (!b) return;
  b[campo] = '';
  if (campo === 'logo') b.portada = '';

  saveBazares(lista)
    .then(() => { toast('Imagen quitada'); renderBazares(); })
    .catch(e => toast(e.message || 'No se pudo guardar'));
}

function toggleBazar(id) {
  _bazarAbierto = Number(_bazarAbierto) === Number(id) ? null : id;
  renderBazares();
}

async function nuevoBazar() {
  if (!esAdminGlobal()) return toast('Solo el administrador principal crea bazares');

  // Los tres datos de golpe: encadenar tres prompts era horrible
  const datos = await _dlgAbrir({
    titulo: 'Nuevo bazar',
    sub: 'Todo esto se puede cambiar después',
    cuerpo: `
      <label class="dlg-campo"><span>Nombre del bazar</span>
        <input id="dlgNombre" placeholder="Papu Bzr" autocomplete="off"></label>
      <label class="dlg-campo"><span>Usuario público (sin @)</span>
        <input id="dlgSlug" placeholder="papu_bzr" autocomplete="off" spellcheck="false"></label>
      <label class="dlg-campo"><span>WhatsApp con lada</span>
        <input id="dlgWa" placeholder="528995284602" inputmode="numeric" autocomplete="off"></label>`,
    ok: 'Crear bazar',
    leer: () => ({
      nombre: document.getElementById('dlgNombre')?.value || '',
      slug:   document.getElementById('dlgSlug')?.value   || '',
      wa:     document.getElementById('dlgWa')?.value     || '',
    }),
  });
  if (!datos) return;

  const nombre = datos.nombre;
  if (!nombre || !nombre.trim()) return toast('Escribe el nombre del bazar');

  let slug = datos.slug;
  if (!slug) return toast('Escribe el usuario público');
  slug = slug.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9._-]/g, '').trim();
  if (!slug) return toast('Ese usuario no es válido');
  if (getBazarBySlug(slug)) return toast('Ya existe un bazar con ese @');

  const whatsapp = String(datos.wa || '').replace(/[^0-9]/g, '');

  const lista = [...getBazares(), {
    id: nextBazarId(),
    slug, nombre: nombre.trim(), whatsapp,
    instagram: '', tiktok: '', facebook: '',
    descripcion: '', ubicacion: '', color: '', portada: '',
    activo: true,
    permisos: {
      crearPrendas: true, editarPrendas: true, borrarPrendas: true,
      gestionarUsuarios: false, gestionarCatalogo: true, personalizar: true,
    },
  }];

  saveBazares(lista)
    .then(() => {
      registrarLog('bazar_crear', nombre.trim(), `@${slug}`);
      toast('Bazar creado — ahora crea su cuenta en Vendedores');
      _bazarAbierto = lista[lista.length - 1].id;
      renderBazares();
    })
    .catch(e => toast(e.message || 'No se pudo crear'));
}

function guardarBazar(id) {
  const lista = getBazares().map(b => ({ ...b }));
  const b     = lista.find(x => Number(x.id) === Number(id));
  if (!b) return;

  const val = pre => (document.getElementById(`bz_${pre}_${id}`)?.value || '').trim();

  const nombre = val('nombre');
  if (!nombre) return toast('El bazar necesita nombre');

  b.nombre      = nombre;
  b.whatsapp    = val('wa').replace(/[^0-9]/g, '');
  b.instagram   = val('ig').replace(/^@/, '');
  b.tiktok      = val('tt').replace(/^@/, '');
  b.facebook    = val('fb').replace(/^@/, '');
  b.ubicacion   = val('ubi');
  b.descripcion = val('desc');
  const colorEscrito = colorValido(val('colorhex')) || colorValido(val('color'));
  if (val('colorhex') && !colorValido(val('colorhex'))) {
    return toast('Ese color no es válido. Usa formato #2d6be4');
  }
  b.color = colorEscrito || '';

  if (esAdminGlobal()) {
    const slug = val('slug').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9._-]/g, '');
    if (!slug) return toast('El bazar necesita un @usuario');
    const repetido = lista.find(x => Number(x.id) !== Number(id) && x.slug === slug);
    if (repetido) return toast('Ya existe otro bazar con ese @');
    b.slug = slug;

    b.permisos = { ...b.permisos };
    Object.keys(PERMISOS_LBL).forEach(k => {
      b.permisos[k] = !!document.getElementById(`bz_perm_${id}_${k}`)?.checked;
    });
    b.activo = !!document.getElementById(`bz_activo_${id}`)?.checked;
  }

  saveBazares(lista)
    .then(() => {
      registrarLog('bazar_editar', b.nombre, `@${b.slug}`);
      playActionSound('ok');
      toast('Bazar actualizado');
      renderBazares();
    })
    .catch(e => toast(e.message || 'No se pudo guardar'));
}

async function eliminarBazar(id) {
  if (!esAdminGlobal()) return;
  const b = getBazarById(id);
  if (!b) return;

  const prendas = getDB().filter(p => Number(p.bazarId || 1) === Number(id)).length;
  const usuarios = getUsers().filter(u => Number(u.bazarId || 0) === Number(id)).length;

  const ok = await confirmarEliminar(
    `Tiene ${prendas} prenda(s) y ${usuarios} cuenta(s). Las prendas dejan de mostrarse en el catálogo.`,
    `¿Eliminar "${b.nombre}"?`
  );
  if (!ok) return;

  saveBazares(getBazares().filter(x => Number(x.id) !== Number(id)))
    .then(() => {
      registrarLog('bazar_eliminar', b.nombre, `@${b.slug}`);
      _bazarAbierto = null;
      toast('Bazar eliminado');
      renderBazares();
    })
    .catch(e => toast(e.message || 'No se pudo eliminar'));
}

// Selector de bazar del formulario de cuentas: solo lo ve el admin principal
// (un dueño de bazar solo puede crear cuentas dentro del suyo).
function pintarSelectorBazarUsuario() {
  const wrap = document.getElementById('v_bazarWrap');
  const sel  = document.getElementById('v_bazarId');
  if (!wrap || !sel) return;

  if (!esAdminGlobal()) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');

  const previo = sel.value;
  sel.innerHTML = '<option value="">Sin bazar (staff principal)</option>' +
    getBazares().map(b => `<option value="${b.id}">${escAdmin(b.nombre)}</option>`).join('');
  if (previo) sel.value = previo;
}

// ─── VENDEDORES ──────────────────────────────────────────────
function renderVendedores() {
  if (!isAdmin()) return;
  pintarSelectorBazarUsuario();
  // Ajustar el selector de rol: solo el admin principal puede crear admins
  const btnAdminRol = document.querySelector('#v_roleSelect .role-opt[data-role="admin"]');
  if (btnAdminRol) {
    if (soyAdminPrincipal()) {
      btnAdminRol.style.display = '';
    } else {
      btnAdminRol.style.display = 'none';
      // Forzar que quede seleccionado "vendedor"
      if (_rolNuevoPerfil === 'admin') seleccionarRol('vendedor');
    }
  }
  // Un dueño de bazar solo ve las cuentas de su bazar
  const visibles = esAdminGlobal()
    ? getUsers()
    : getUsers().filter(u => Number(u.bazarId || 0) === Number(miBazarId()));

  // Mostrar todos los perfiles (admins y vendedores). Admins primero.
  const users = visibles.slice().sort((a, b) => {
    const rank = u => (esAdminPrincipal(u) ? 0 : u.role === 'admin' ? 1 : 2);
    return rank(a) - rank(b);
  });
  const grid = document.getElementById('vendedoresGrid');
  const countEl = document.getElementById('vendedorCount');
  if (!grid) return;

  if (countEl) countEl.textContent = users.length ? `${users.length}` : '';

  // Usuarios en línea (para el punto verde)
  const activos = (typeof _activos !== 'undefined' && Array.isArray(_activos)) ? _activos : [];
  const onlineSet = new Set(activos.map(a => a.username));

  if (!users.length) {
    grid.innerHTML = `<div class="vendedor-empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
      <span>Aún no hay perfiles</span>
      <small>Crea el primero con el formulario</small>
    </div>`;
    return;
  }

  const IC_SHIELD_SM = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
  const IC_BAG_SM = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>';

  grid.innerHTML = users.map((u, i) => {
    const online = onlineSet.has(u.username);
    const inicial = (u.username || '?').charAt(0).toUpperCase();
    const avatar = u.avatar
      ? `<img src="${u.avatar}" alt="${escapeHtml(u.username)}" class="vend-avatar-img">`
      : `<div class="vend-avatar-ph">${escapeHtml(inicial)}</div>`;
    const esAdmin = u.role === 'admin';
    const principal = esAdminPrincipal(u);
    const rolIco = esAdmin ? IC_SHIELD_SM : IC_BAG_SM;
    const bzUser = u.bazarId ? getBazarById(u.bazarId) : null;
    const rolTxt = principal
      ? 'Admin principal'
      : `${esAdmin ? 'Admin' : 'Vendedor'}${bzUser ? ' · ' + bzUser.nombre : ''}`;

    // Acciones según permisos
    const s = getSession();
    const esYo = s && (u.id === s.id || u.username === s.username);
    let acciones;
    if (principal) {
      // Admin principal: siempre protegido (candado)
      acciones = `<span class="vend-locked" title="Cuenta protegida">
           <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
         </span>`;
    } else if (esYo) {
      // Tu propio perfil: puedes cambiar tu contraseña pero no eliminarte
      acciones = `<button class="vend-act key" onclick="resetPassword(${u.id})" title="Cambiar contraseña">${IC_KEY}</button>`;
    } else if (esAdmin && !soyAdminPrincipal()) {
      // Otro admin, pero tú no eres el principal: solo cambiar contraseña, sin eliminar
      acciones = `<button class="vend-act key" onclick="resetPassword(${u.id})" title="Cambiar contraseña">${IC_KEY}</button>`;
    } else {
      // Caso normal: cambiar contraseña y eliminar
      acciones = `<button class="vend-act key" onclick="resetPassword(${u.id})" title="Cambiar contraseña">${IC_KEY}</button>
         <button class="vend-act del" onclick="deleteVendedor(${u.id})" title="Eliminar">${IC_TRASH}</button>`;
    }

    return `<div class="vend-card ${esAdmin ? 'is-admin' : ''} ${principal ? 'is-principal' : ''}" style="animation-delay:${Math.min(i*40,300)}ms">
      <div class="vend-avatar ${online ? 'online' : ''}">
        ${avatar}
        ${online ? '<span class="vend-online-dot" title="En línea"></span>' : ''}
      </div>
      <div class="vend-info">
        <div class="vend-name">${escapeHtml(u.username)}</div>
        <div class="vend-role ${esAdmin ? 'role-admin' : ''}">
          ${rolIco}
          ${rolTxt}${online ? ' · <span class="vend-online-txt">en línea</span>' : ''}
        </div>
      </div>
      <div class="vend-actions">${acciones}</div>
    </div>`;
  }).join('');
}
// Rol seleccionado para el nuevo perfil
let _rolNuevoPerfil = 'vendedor';
function seleccionarRol(rol) {
  _rolNuevoPerfil = rol;
  document.querySelectorAll('#v_roleSelect .role-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.role === rol);
  });
}

// Mostrar/ocultar contraseña
function togglePw(inputId, btn) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const ver = el.type === 'password';
  el.type = ver ? 'text' : 'password';
  btn.classList.toggle('showing', ver);
}

// Reglas de contraseña
function checkPassword(pw) {
  return {
    len:   pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    num:   /[0-9]/.test(pw),
    sym:   /[^A-Za-z0-9]/.test(pw),
  };
}
// Nombre: solo letras (incluye acentos), 2-20 caracteres, sin espacios
function nombreValido(n) {
  return /^[A-Za-zÁÉÍÓÚáéíóúÑñ]{2,20}$/.test(n);
}

// Validación en vivo del formulario de nuevo perfil
function validarPerfilForm() {
  const username = document.getElementById('v_username')?.value.trim() || '';
  const pw       = document.getElementById('v_password')?.value || '';
  const conf     = document.getElementById('v_confirm')?.value || '';

  // Nombre
  const uHint = document.getElementById('v_username_hint');
  if (uHint) {
    if (!username) { uHint.textContent = 'Solo letras, sin espacios ni símbolos'; uHint.className = 'fg-hint'; }
    else if (nombreValido(username)) { uHint.textContent = 'Nombre válido'; uHint.className = 'fg-hint ok'; }
    else { uHint.textContent = 'Solo letras (2-20), sin espacios ni números'; uHint.className = 'fg-hint bad'; }
  }

  // Requisitos de contraseña
  const reqs = checkPassword(pw);
  const cumplidos = Object.values(reqs).filter(Boolean).length;
  document.querySelectorAll('#v_pwReqs li').forEach(li => {
    li.classList.toggle('ok', !!reqs[li.dataset.req]);
  });
  // Medidor de fuerza
  const meter = document.querySelector('#v_pwMeter span');
  if (meter) {
    const pct = (cumplidos / 5) * 100;
    meter.style.width = pct + '%';
    meter.className = cumplidos <= 2 ? 'weak' : cumplidos <= 4 ? 'medium' : 'strong';
  }

  // Coincidencia
  const mHint = document.getElementById('v_match_hint');
  if (mHint) {
    if (!conf) { mHint.textContent = ''; mHint.className = 'fg-hint'; }
    else if (pw === conf) { mHint.textContent = 'Las contraseñas coinciden'; mHint.className = 'fg-hint ok'; }
    else { mHint.textContent = 'No coinciden'; mHint.className = 'fg-hint bad'; }
  }
  return { username, pw, conf, reqs, cumplidos };
}

async function createVendedor() {
  const btn   = document.getElementById('v_submitBtn');
  const errEl = document.getElementById('vendedorError');
  errEl.textContent = '';
  const { username, pw, conf, cumplidos } = validarPerfilForm();

  // Validaciones (frontend)
  if (!username)                { errEl.textContent = 'El nombre es obligatorio'; return; }
  if (!nombreValido(username))  { errEl.textContent = 'El nombre solo puede tener letras (2-20), sin espacios ni números'; return; }
  if (cumplidos < 5)            { errEl.textContent = 'La contraseña no cumple todos los requisitos de seguridad'; return; }
  if (pw !== conf)              { errEl.textContent = 'Las contraseñas no coinciden'; return; }
  if (getUsers().find(u => u.username.toLowerCase() === username.toLowerCase())) {
    errEl.textContent = 'Ese nombre ya existe'; return;
  }

  const rol = _rolNuevoPerfil === 'admin' ? 'admin' : 'vendedor';
  if (rol === 'admin' && !soyAdminPrincipal()) {
    errEl.textContent = 'Solo el admin principal puede crear otros administradores';
    playActionSound('error'); return;
  }

  // Crear en el servidor (valida sesión y reglas de rol de forma segura)
  const s = getSession();
  try {
    await api('/api/acciones?op=gestionar-usuario', {
      method: 'POST',
      body: {
        accion: 'crear', token: s.sessionToken, actor: s.username,
        username, password: pw, rol,
        bazarId: esAdminGlobal() ? (document.getElementById('v_bazarId')?.value || '') : undefined
      }
    });
  } catch (e) {
    errEl.textContent = e.message || 'No se pudo crear el perfil';
    playActionSound('error');
    return;
  }

  registrarLog('vendedor_crear', username, `Rol: ${rol}`);
  playActionSound('ok');

  // Limpiar formulario
  ['v_username','v_password','v_confirm'].forEach(id => document.getElementById(id).value = '');
  seleccionarRol('vendedor');
  validarPerfilForm();
  toast(`Perfil "${username}" creado (${rol})`);
  pollAhora(600);   // refrescar la lista pronto
  renderVendedores();

  // Cooldown de 15s antes de poder crear otro
  if (btn) {
    let restante = 15;
    btn.disabled = true;
    btn.classList.add('cooldown');
    const txtOrig = 'CREAR PERFIL';
    btn.textContent = `Espera ${restante}s`;
    const tick = setInterval(() => {
      restante--;
      if (restante > 0) {
        btn.textContent = `Espera ${restante}s`;
      } else {
        clearInterval(tick);
        btn.disabled = false;
        btn.classList.remove('cooldown');
        btn.textContent = txtOrig;
      }
    }, 1000);
  }
}
// Identifica la cuenta principal de admin (protegida)
function esAdminPrincipal(u) {
  if (!u) return false;
  return u.id === 1 || (u.username && u.username.toLowerCase() === 'admin');
}
// ¿El usuario logueado es el admin principal?
function soyAdminPrincipal() {
  const s = getSession();
  return esAdminPrincipal(s);
}

async function deleteVendedor(id) {
  const u = getUsers().find(x => x.id===id);
  const s = getSession();
  if (esAdminPrincipal(u)) { toast('No se puede eliminar la cuenta principal de admin'); playActionSound('error'); return; }
  if (s && u && (u.id === s.id || u.username === s.username)) {
    toast('No puedes eliminar tu propio perfil'); playActionSound('error'); return;
  }
  if (u && u.role === 'admin' && !soyAdminPrincipal()) {
    toast('Solo el admin principal puede eliminar a otros administradores'); playActionSound('error'); return;
  }
  if (!(await confirmarEliminar('La cuenta deja de poder entrar al panel.', '¿Eliminar este perfil?'))) return;

  try {
    await api('/api/acciones?op=gestionar-usuario', {
      method: 'POST',
      body: { accion: 'eliminar', token: s.sessionToken, actor: s.username, id }
    });
  } catch (e) {
    toast(e.message || 'No se pudo eliminar'); playActionSound('error'); return;
  }
  registrarLog('vendedor_eliminar', u?.username || ('#'+id));
  playActionSound('del');
  pollAhora(600);
  renderVendedores(); toast('Perfil eliminado');
}
async function resetPassword(id) {
  const users = getUsers();
  const u = users.find(x => x.id===id);
  if (esAdminPrincipal(u)) {
    toast('La contraseña del admin principal solo se cambia desde Mi Cuenta');
    playActionSound('error'); return;
  }
  const newPass = await uiPrompt({
    titulo: 'Nueva contraseña',
    sub: `Para ${u?.username || 'este perfil'}`,
    etiqueta: 'Contraseña', tipo: 'password',
    placeholder: 'Mínimo 4 caracteres', ok: 'Cambiar',
  });
  if (!newPass || newPass.length < 4) { toast('Contraseña inválida'); return; }
  const s = getSession();
  try {
    await api('/api/acciones?op=gestionar-usuario', {
      method: 'POST',
      body: { accion: 'password', token: s.sessionToken, actor: s.username, id, password: newPass }
    });
  } catch (e) {
    toast(e.message || 'No se pudo cambiar la contraseña'); playActionSound('error'); return;
  }
  registrarLog('vendedor_password', u.username);
  playActionSound('ok');
  toast('Contraseña actualizada');
}

// ─── CATÁLOGO ────────────────────────────────────────────────
function renderCatalogo() {
  if (!isAdmin()) return;
  renderCatList();
  renderBrandList();
}
function renderCatList() {
  const items = catalogoVisible(getCats());
  const el = document.getElementById('catList');
  if (!el) return;
  el.innerHTML = !items.length
    ? `<div class="cat-empty">No hay categorías todavía</div>`
    : items.map(c => {
        const mio  = catalogoEditable(c);
        const tag  = esGeneral(c)
          ? '<span class="cat-tag">General</span>'
          : `<span class="cat-tag ${mio ? 'cat-tag-mio' : 'cat-tag-otro'}"
                   title="${mio ? 'Tuya' : 'De ' + escAdmin(nombreDeBazar(c.bazarId)) + ' · puedes usarla, no editarla'}"
             >${escAdmin(nombreDeBazar(c.bazarId))}</span>`;
        // El admin principal puede pasar a general lo que creó un bazar
        const aGeneral = (esAdminGlobal() && !esGeneral(c))
          ? `<button class="act-btn general" onclick="hacerGeneral('cat',${c.id})"
                     title="Compartirla como general de STMP MARKET">Hacer general</button>` : '';
        const acciones = aGeneral + (mio ? `
          <button class="act-btn edit" onclick="editCat(${c.id},'${String(c.nombre).replace(/'/g, "\\'")}')">${IC_EDIT}</button>
          <button class="act-btn del"  onclick="deleteCat(${c.id})">${IC_TRASH}</button>` : '');
        return `<div class="cat-item">
          <span>${escAdmin(c.nombre)} ${tag}</span>
          <div style="display:flex;gap:6px">${acciones}</div>
        </div>`;
      }).join('');
}
function addCat() {
  const input = document.getElementById('newCatName');
  const name  = input.value.trim();
  if (!name) { toast('Escribe un nombre'); return; }
  const cats = getCats();
  if (cats.find(c => c.nombre.toLowerCase()===name.toLowerCase())) { toast('Ya existe esa categoría'); return; }
  cats.push({ id: nextCatId(), nombre: name, bazarId: esAdminGlobal() ? null : miBazarId() });
  saveCats(cats); input.value = '';
  registrarLog('catalogo_crear', name, 'Categoría');
  playActionSound('ok');
  renderCatList(); populateSelects();
  toast(`Categoría "${name}" creada`);
}
async function editCat(id, current) {
  const newName = await uiPrompt({
    titulo: 'Renombrar categoría', sub: current,
    etiqueta: 'Nuevo nombre', valor: current,
  });
  if (!newName || !newName.trim()) return;
  const cats = getCats(), c = cats.find(x => x.id===id);
  if (c) { c.nombre = newName.trim(); saveCats(cats); registrarLog('catalogo_editar', newName.trim(), `Categoría (antes: ${current})`); playActionSound('ok'); renderCatList(); populateSelects(); toast('Categoría actualizada'); }
}
// Pasa una categoría o marca de un bazar al fondo común de STMP MARKET.
// Solo el admin principal: a partir de ahí ya nadie la edita salvo él.
async function hacerGeneral(tipo, id) {
  if (!esAdminGlobal()) return toast('Solo el administrador principal');

  const esCat = tipo === 'cat';
  const lista = esCat ? getCats() : getBrands();
  const item  = lista.find(x => x.id === id);
  if (!item || esGeneral(item)) return;

  const ok = await uiConfirm({
    titulo: `¿Hacer general "${item.nombre}"?`,
    sub: `Ahora es de ${nombreDeBazar(item.bazarId)}`,
    mensaje: 'Pasa al catálogo común de STMP MARKET. Todos los bazares la seguirán viendo y usando, pero su dueño dejará de poder editarla o borrarla: solo tú.',
    ok: 'Hacer general',
  });
  if (!ok) return;

  item.bazarId = null;
  if (esCat) { saveCats(lista); renderCatList(); }
  else       { saveBrands(lista); renderBrandList(); }

  registrarLog('catalogo_editar', item.nombre, `${esCat ? 'Categoría' : 'Marca'} ahora general`);
  playActionSound('ok');
  populateSelects();
  toast(`"${item.nombre}" ahora es general`);
}

async function deleteCat(id) {
  const cat = getCats().find(c => c.id===id);
  if (!(await confirmarEliminar(
    `"${cat?.nombre || '#'+id}" desaparece del catálogo. Las prendas que la usan no se borran.`,
    '¿Eliminar esta categoría?'))) return;
  saveCats(getCats().filter(c => c.id!==id));
  registrarLog('catalogo_eliminar', cat?.nombre || ('#'+id), 'Categoría');
  playActionSound('del');
  renderCatList(); populateSelects(); toast('Categoría eliminada');
}
function renderBrandList() {
  const items = catalogoVisible(getBrands());
  const el = document.getElementById('brandList');
  if (!el) return;
  el.innerHTML = !items.length
    ? `<div class="cat-empty">No hay marcas todavía</div>`
    : items.map(c => {
        const mio  = catalogoEditable(c);
        const tag  = esGeneral(c)
          ? '<span class="cat-tag">General</span>'
          : `<span class="cat-tag ${mio ? 'cat-tag-mio' : 'cat-tag-otro'}"
                   title="${mio ? 'Tuya' : 'De ' + escAdmin(nombreDeBazar(c.bazarId)) + ' · puedes usarla, no editarla'}"
             >${escAdmin(nombreDeBazar(c.bazarId))}</span>`;
        // El admin principal puede pasar a general lo que creó un bazar
        const aGeneral = (esAdminGlobal() && !esGeneral(c))
          ? `<button class="act-btn general" onclick="hacerGeneral('brand',${c.id})"
                     title="Compartirla como general de STMP MARKET">Hacer general</button>` : '';
        const acciones = aGeneral + (mio ? `
          <button class="act-btn edit" onclick="editBrand(${c.id},'${String(c.nombre).replace(/'/g, "\\'")}')">${IC_EDIT}</button>
          <button class="act-btn del"  onclick="deleteBrand(${c.id})">${IC_TRASH}</button>` : '');
        return `<div class="cat-item">
          <span>${escAdmin(c.nombre)} ${tag}</span>
          <div style="display:flex;gap:6px">${acciones}</div>
        </div>`;
      }).join('');
}
function addBrand() {
  const input = document.getElementById('newBrandName');
  const name  = input.value.trim();
  if (!name) { toast('Escribe un nombre'); return; }
  const brands = getBrands();
  if (brands.find(b => b.nombre.toLowerCase()===name.toLowerCase())) { toast('Ya existe esa marca'); return; }
  brands.push({ id: nextBrandId(), nombre: name, bazarId: esAdminGlobal() ? null : miBazarId() });
  saveBrands(brands); input.value = '';
  registrarLog('catalogo_crear', name, 'Marca');
  playActionSound('ok');
  renderBrandList(); populateSelects();
  toast(`Marca "${name}" creada`);
}
async function editBrand(id, current) {
  const newName = await uiPrompt({
    titulo: 'Renombrar marca', sub: current,
    etiqueta: 'Nuevo nombre', valor: current,
  });
  if (!newName || !newName.trim()) return;
  const brands = getBrands(), b = brands.find(x => x.id===id);
  if (b) { b.nombre = newName.trim(); saveBrands(brands); registrarLog('catalogo_editar', newName.trim(), `Marca (antes: ${current})`); playActionSound('ok'); renderBrandList(); populateSelects(); toast('Marca actualizada'); }
}
async function deleteBrand(id) {
  const br = getBrands().find(b => b.id===id);
  if (!(await confirmarEliminar(
    `"${br?.nombre || '#'+id}" desaparece del catálogo. Las prendas que la usan no se borran.`,
    '¿Eliminar esta marca?'))) return;
  saveBrands(getBrands().filter(b => b.id!==id));
  registrarLog('catalogo_eliminar', br?.nombre || ('#'+id), 'Marca');
  playActionSound('del');
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
            ${escAdmin(u.username)}${u.username===session.username?' <small>(tú)</small>':''}
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

// ─── AVATAR (Cloudinary + servidor) ──────────────────────────
// La URL del avatar se guarda en el registro del usuario (colección
// 'usuarios' en el servidor), así se ve igual desde cualquier dispositivo.

function loadAvatarFromStorage() {
  const s = getSession();
  if (!s) { setAvatarUI(null); return; }
  // Buscar el usuario en el caché del servidor
  const u = (typeof getUsers === 'function' ? getUsers() : []).find(x => x.username === s.username);
  let url = u?.avatar || null;
  // Migración: si no hay en servidor pero sí en localStorage viejo, usarlo y subirlo
  if (!url) {
    const viejo = localStorage.getItem('bazar_avatar_' + s.username);
    if (viejo) { url = viejo; guardarAvatarEnServidor(viejo); localStorage.removeItem('bazar_avatar_' + s.username); }
  }
  setAvatarUI(url);
}

function setAvatarUI(url) {
  const sbImg = document.getElementById('sidebarAvatar');
  const sbPh  = document.getElementById('sidebarAvatarPlaceholder');
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

// Guarda la URL del avatar en el registro del usuario (servidor)
function guardarAvatarEnServidor(url) {
  const s = getSession();
  if (!s) return;
  const users = getUsers();
  const u = users.find(x => x.username === s.username);
  if (!u) return;
  u.avatar = url;
  saveUsers(users);   // hace PUT a /api/config (col: usuarios)
}

async function handleAvatarUpload(file) {
  if (!file) return;
  toast('Subiendo foto de perfil...');
  const r = new FileReader();
  r.onload = async e => {
    try {
      const url = await uploadToCloud(e.target.result);
      guardarAvatarEnServidor(url);
      setAvatarUI(url);
      toast('Foto de perfil actualizada');
    } catch (err) {
      toast('Error subiendo foto: ' + err.message);
    }
  };
  r.readAsDataURL(file);
}

// ─── MI CUENTA ───────────────────────────────────────────────
// Iconos SVG reutilizables (sin emojis)
const IC_CHECK = '<svg class="lucide" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const IC_CROSS = '<svg class="lucide" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const IC_SHIELD = '<svg class="lucide" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>';
const IC_BAG = '<svg class="lucide" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>';
// Iconos de acción (botones) — sin emojis
const IC_TRASH = '<svg class="lucide" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
const IC_EDIT = '<svg class="lucide" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>';
const IC_KEY = '<svg class="lucide" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>';
const IC_X = '<svg class="lucide" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const IC_ROCKET = '<svg class="lucide" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>';
const IC_CALENDAR = '<svg class="lucide" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
const IC_CLOCK = '<svg class="lucide" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
const IC_FLAME = '<svg class="lucide" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>';

function renderCuenta() {
  const s = getSession();
  const admin = s.role === 'admin';

  // Nombre y role (badge con icono SVG, sin emoji)
  const uEl = document.getElementById('cuentaUsername');
  const rEl = document.getElementById('cuentaRoleBadge');
  if (uEl) uEl.textContent = s.username;
  if (rEl) rEl.innerHTML = `${admin ? IC_SHIELD : IC_BAG}<span>${admin ? 'Admin' : 'Vendedor'}</span>`;

  // Permisos por rol
  // Comunes a ambos roles:
  const comunes = [
    ['Ver inventario', true],
    ['Agregar prendas', true],
    ['Editar prendas', true],
    ['Marcar vendido', true],
    ['Gestionar drops', true],
  ];
  // Exclusivos de admin (para el vendedor se muestran como no disponibles):
  const soloAdmin = [
    ['Ver ganancias', admin],
    ['Gestionar catálogo', admin],
    ['Gestionar vendedores', admin],
    ['Eliminar prendas', admin],
  ];
  const perms = document.getElementById('cuentaPermisos');
  if (perms) {
    const chip = ([label, ok]) =>
      `<span class="${ok ? 'perm-ok' : 'perm-no'}">${ok ? IC_CHECK : IC_CROSS}${label}</span>`;
    perms.innerHTML = [...comunes, ...soloAdmin].map(chip).join('');
  }

  // Datos de la cuenta
  const info = document.getElementById('cuentaInfo');
  if (info) {
    info.innerHTML = `
      <div class="cuenta-info-row"><span class="ci-label">Usuario</span><span class="ci-val">${escAdmin(s.username)}</span></div>
      <div class="cuenta-info-row"><span class="ci-label">Rol</span><span class="ci-val">${admin ? 'Administrador' : 'Vendedor'}</span></div>
      <div class="cuenta-info-row"><span class="ci-label">Sesión</span><span class="ci-val cuenta-online">Activa</span></div>
    `;
  }

  // Preferencias (persistidas en localStorage por usuario)
  initPreferencias(s.username);

  // Cargar avatar
  loadAvatarFromStorage();
}

// ─── PREFERENCIAS ─────────────────────────────────────────────
function prefsKey(u){ return 'bazar_prefs_' + (u || getSession()?.username || 'user'); }
function getPrefs(u){
  try { return JSON.parse(localStorage.getItem(prefsKey(u))) || {}; }
  catch { return {}; }
}
function setPref(k, v){
  const u = getSession()?.username;
  const p = getPrefs(u); p[k] = v;
  localStorage.setItem(prefsKey(u), JSON.stringify(p));
}
function initPreferencias(u){
  const p = getPrefs(u);
  const map = {
    pref_confirm_del: p.confirm_del !== false,   // por defecto ON
    pref_sonido:      p.sonido      === true,     // por defecto OFF
    pref_compacto:    p.compacto    === true,     // por defecto OFF
  };
  Object.entries(map).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.checked = val;
  });
  document.body.classList.toggle('vista-compacta', map.pref_compacto);
}
function onPrefChange(id){
  const el = document.getElementById(id);
  if (!el) return;
  if (id === 'pref_confirm_del') setPref('confirm_del', el.checked);
  if (id === 'pref_sonido')    { setPref('sonido', el.checked); if (el.checked) playActionSound('sell'); }
  if (id === 'pref_compacto')  { setPref('compacto', el.checked); document.body.classList.toggle('vista-compacta', el.checked); if(pref('sonido')) playActionSound('toggle'); }
  toast('Preferencia guardada');
}

// Lee una preferencia con su valor por defecto
function pref(nombre){
  const p = getPrefs();
  if (nombre === 'confirm_del') return p.confirm_del !== false; // default ON
  if (nombre === 'sonido')      return p.sonido === true;        // default OFF
  if (nombre === 'compacto')    return p.compacto === true;      // default OFF
  return false;
}

/* ═══════════════════════════════════════════════════════════
   DIÁLOGOS DEL PANEL
   Sustituyen a prompt() y confirm() del navegador, que rompían la
   estética y no se pueden estilizar. Devuelven una promesa, así que
   quien los usa hace `await`.
   ═══════════════════════════════════════════════════════════ */
let _dlgResolver = null;
let _dlgCancelarValor = null;

function _dlgCerrar(valor) {
  document.getElementById('dlgOverlay')?.classList.remove('active');
  document.getElementById('dlg')?.classList.remove('open');
  const resolver = _dlgResolver;
  _dlgResolver = null;
  if (resolver) resolver(valor);
}

function _dlgAbrir({ titulo, sub = '', cuerpo = '', ok = 'Aceptar',
                     cancelar = 'Cancelar', peligro = false,
                     leer = () => true, cancelarValor = null }) {
  const ov = document.getElementById('dlgOverlay');
  const dl = document.getElementById('dlg');
  // Si el HTML del diálogo no está, no bloqueamos: se cancela y ya
  if (!ov || !dl) return Promise.resolve(cancelarValor);

  // Un diálogo a la vez: el que estuviera abierto se cancela
  if (_dlgResolver) _dlgCerrar(_dlgCancelarValor);

  document.getElementById('dlgTitulo').textContent = titulo || '';
  const subEl = document.getElementById('dlgSub');
  subEl.textContent = sub || '';
  subEl.style.display = sub ? '' : 'none';
  document.getElementById('dlgBody').innerHTML = cuerpo;

  const bOk = document.getElementById('dlgAceptar');
  const bNo = document.getElementById('dlgCancelar');
  bOk.textContent = ok;
  bNo.textContent = cancelar;
  bOk.classList.toggle('dlg-peligro', !!peligro);

  ov.classList.add('active');
  dl.classList.add('open');

  const primero = dl.querySelector('.dlg-body input, .dlg-body textarea');
  if (primero) setTimeout(() => { primero.focus(); primero.select?.(); }, 120);
  else setTimeout(() => bOk.focus(), 120);

  return new Promise(resolver => {
    _dlgResolver = resolver;
    _dlgCancelarValor = cancelarValor;
    bOk.onclick = () => _dlgCerrar(leer());
    bNo.onclick = () => _dlgCerrar(cancelarValor);
    ov.onclick  = () => _dlgCerrar(cancelarValor);
    dl.querySelectorAll('.dlg-body input').forEach(i => {
      i.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); _dlgCerrar(leer()); } };
    });
  });
}

// Pide un texto. Devuelve la cadena, o null si se cancela.
function uiPrompt({ titulo, sub = '', etiqueta = '', valor = '', placeholder = '',
                    tipo = 'text', ok = 'Guardar' }) {
  const cuerpo = `
    <label class="dlg-campo">
      ${etiqueta ? `<span>${escAdmin(etiqueta)}</span>` : ''}
      <input type="${escAdmin(tipo)}" id="dlgInput" value="${escAdmin(valor)}"
             placeholder="${escAdmin(placeholder)}" autocomplete="off" spellcheck="false">
    </label>`;
  return _dlgAbrir({ titulo, sub, cuerpo, ok,
    leer: () => document.getElementById('dlgInput')?.value ?? null });
}

// Pregunta sí/no. Devuelve true o false.
function uiConfirm({ titulo, sub = '', mensaje = '', ok = 'Confirmar', peligro = false }) {
  const cuerpo = mensaje ? `<p class="dlg-msg">${escAdmin(mensaje)}</p>` : '';
  return _dlgAbrir({ titulo, sub, cuerpo, ok, peligro,
    leer: () => true, cancelarValor: false });
}

// Confirma una acción respetando la preferencia "Confirmar antes de eliminar"
async function confirmarEliminar(mensaje, titulo = '¿Eliminar?'){
  if (!pref('confirm_del')) return true;   // si está apagado, no pregunta
  return uiConfirm({ titulo, mensaje, ok: 'Eliminar', peligro: true });
}

// Reproduce un sonido corto y sutil (estilo iOS) según el tipo de acción.
// Tipos: 'ok' (guardar/crear), 'sell' (vender), 'del' (eliminar),
//        'toggle' (cambios menores), 'error' (fallo).
let _audioCtx = null;
function playActionSound(tipo){
  if (!pref('sonido')) return;
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;

    // Perfiles de sonido — notas suaves con leve armónico
    const perfiles = {
      ok:     { notas: [523.25, 783.99], dur: 0.16, vol: 0.05 },  // Do–Sol, positivo
      sell:   { notas: [659.25, 987.77], dur: 0.22, vol: 0.06 },  // Mi–Si, celebración
      del:    { notas: [392.00, 293.66], dur: 0.18, vol: 0.05 },  // Sol–Re, descendente
      toggle: { notas: [880.00],         dur: 0.09, vol: 0.035 }, // click corto
      error:  { notas: [220.00, 207.65], dur: 0.28, vol: 0.06 },  // grave y disonante
    };
    const p = perfiles[tipo] || perfiles.ok;

    // Filtro pasa-bajos compartido para suavizar (quita aspereza)
    const filtro = ctx.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = 2200;
    filtro.connect(ctx.destination);

    p.notas.forEach((freq, i) => {
      const inicio = t + i * (p.dur * 0.55);   // notas ligeramente encadenadas
      const osc  = ctx.createOscillator();
      const sub  = ctx.createOscillator();     // armónico suave para dar cuerpo
      const gain = ctx.createGain();

      osc.type = 'sine';  osc.frequency.value = freq;
      sub.type = 'triangle'; sub.frequency.value = freq * 2;

      const subGain = ctx.createGain();
      subGain.gain.value = 0.12;               // el armónico apenas se nota
      sub.connect(subGain); subGain.connect(gain);
      osc.connect(gain);
      gain.connect(filtro);

      // Envolvente suave: ataque rápido, caída exponencial (sensación "pop")
      gain.gain.setValueAtTime(0.0001, inicio);
      gain.gain.exponentialRampToValueAtTime(p.vol, inicio + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, inicio + p.dur);

      osc.start(inicio); sub.start(inicio);
      osc.stop(inicio + p.dur + 0.02);
      sub.stop(inicio + p.dur + 0.02);
    });
  } catch (_) {}
}

// Envoltura de toast: reproduce sonido de error en mensajes de fallo/validación
if (typeof toast === 'function' && !window._toastWrapped) {
  const _toastOrig = toast;
  window._toastWrapped = true;
  window.toast = function(msg, dur){
    const m = String(msg || '').toLowerCase();
    const esError = /inválid|invalid|obligatori|no se encontró|no encontrad|sin permiso|error|debe ser|espera a que|elige|escribe el|no coincide|futura|mínimo|incorrect/.test(m);
    if (esError && typeof playActionSound === 'function') playActionSound('error');
    return _toastOrig(msg, dur);
  };
  // Reasignar la referencia local usada en admin.js
  toast = window.toast;
}

// ─── SISTEMA (rendimiento · módulos · errores) ────────────────
/* ═══════════════════════════════════════════════════════════
   SUBASTAS — lado del bazar
   Poner una prenda a subasta, ver quién ofertó y, al cerrarse,
   cómo contactar al que ganó.

   Las ofertas NO viven en la prenda: viven en el servidor. Por eso
   guardar el inventario nunca puede borrarlas.
   ═══════════════════════════════════════════════════════════ */
const SB_INCREMENTO = 50;

const sbDinero = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');

// La subasta de una prenda, tal como llegó con el último sync
function sbDe(prendaId) {
  return (typeof subastaDe === 'function') ? subastaDe(prendaId) : null;
}
function sbViva(s) {
  return (typeof subastaAbierta === 'function') ? subastaAbierta(s) : false;
}

// ── Formulario de registro ──────────────────────────────────
function toggleSubastaField() {
  const on   = document.getElementById('f_useSubasta')?.checked;
  const wrap = document.getElementById('subastaWrap');
  if (wrap) wrap.classList.toggle('hidden', !on);
  if (on && !document.getElementById('f_sbFin')?.value) duracionSubasta(72);
  pistaSubasta();
}

// Botones de "1 día / 3 días / 1 semana": escriben la fecha por ti
function duracionSubasta(horas) {
  const d = new Date(Date.now() + horas * 3600000);
  d.setSeconds(0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  const campo = document.getElementById('f_sbFin');
  if (campo) campo.value = local.toISOString().slice(0, 16);
  pistaSubasta();
}

// Le dice al vendedor, en español, qué va a pasar con lo que escribió
function pistaSubasta() {
  const pista = document.getElementById('sbPista');
  if (!pista) return;
  const inicial = parseFloat(document.getElementById('f_sbInicial')?.value);
  const fin     = document.getElementById('f_sbFin')?.value;
  const reserva = parseFloat(document.getElementById('f_sbReserva')?.value) || 0;

  if (!inicial || !fin) {
    pista.textContent = 'Cada oferta tiene que subir al menos $50. Al cerrarse verás aquí quién ganó y cómo contactarlo.';
    pista.className = 'sb-pista';
    return;
  }
  const cierre  = new Date(fin);
  const minutos = (cierre.getTime() - Date.now()) / 60000;
  if (minutos < 10) {
    pista.textContent = 'La subasta tiene que durar al menos 10 minutos.';
    pista.className = 'sb-pista mal';
    return;
  }
  if (minutos > 60 * 24 * 30) {
    pista.textContent = 'La subasta no puede durar más de 30 días.';
    pista.className = 'sb-pista mal';
    return;
  }
  const horas = Math.round(minutos / 60);
  const dur = horas >= 48 ? `${Math.round(horas / 24)} días`
            : horas >= 1  ? `${horas} h`
            : `${Math.round(minutos)} min`;
  if (reserva && reserva < inicial) {
    pista.textContent = 'La reserva no puede ser menor que el precio de salida.';
    pista.className = 'sb-pista mal';
    return;
  }
  pista.textContent =
    `Empieza en ${sbDinero(inicial)} y dura ${dur}. La primera oferta será de ${sbDinero(inicial)} ` +
    `y de ahí sube de ${sbDinero(SB_INCREMENTO)} en ${sbDinero(SB_INCREMENTO)} como mínimo.` +
    (reserva ? ` Si no llega a ${sbDinero(reserva)}, no estás obligado a vender.` : '') +
    ' Una oferta en los últimos 3 minutos alarga el cierre otros 3.';
  pista.className = 'sb-pista bien';
}

// Lee el formulario. Devuelve null si la subasta está apagada.
function leerSubastaForm() {
  if (!document.getElementById('f_useSubasta')?.checked) return null;
  const inicial = parseFloat(document.getElementById('f_sbInicial')?.value);
  const fin     = document.getElementById('f_sbFin')?.value;
  const reserva = parseFloat(document.getElementById('f_sbReserva')?.value) || 0;
  if (!inicial || inicial <= 0) return { error: 'Escribe el precio de salida de la subasta' };
  if (!fin)                     return { error: 'Elige cuándo cierra la subasta' };
  const cierre = new Date(fin);
  if (isNaN(cierre.getTime()))  return { error: 'La fecha de cierre no es válida' };
  if ((cierre.getTime() - Date.now()) / 60000 < 10) {
    return { error: 'La subasta tiene que durar al menos 10 minutos' };
  }
  if (reserva && reserva < inicial) {
    return { error: 'La reserva no puede ser menor que el precio de salida' };
  }
  return { precioInicial: Math.round(inicial), fin: cierre.toISOString(), reserva: Math.round(reserva) };
}

// Se llama después de guardar la prenda: para entonces el servidor ya
// la tiene y se le puede colgar la subasta.
async function aplicarSubasta(prendaId, cfg) {
  if (!cfg) return;
  try {
    await api('/api/acciones?op=configurar-subasta', {
      method: 'POST',
      body: { prendaId, precioInicial: cfg.precioInicial, fin: cfg.fin, reserva: cfg.reserva },
    });
    if (typeof pollAhora === 'function') pollAhora(600);
    toast('Subasta abierta');
  } catch (err) {
    toast(err.message || 'La prenda se guardó, pero la subasta no');
  }
}


// ── El bloque de subasta dentro de la tarjeta ───────────────
// Una prenda subastada no se lee como una normal: lo que importa no es
// el precio que le puso el bazar, sino en cuánto va y cuánto le queda.
function bloqueSubasta(p) {
  const s = sbDe(p.id);
  if (!s) return '';

  const viva  = sbViva(s);
  const resto = viva && typeof tiempoRestante === 'function' ? tiempoRestante(s.fin) : '';
  const hayOfertas = s.totalOfertas > 0;

  // Menos de una hora: se avisa, porque es cuando hay que estar pendiente
  const apura = viva && (new Date(s.fin).getTime() - Date.now()) < 3600000;

  const cierre = new Date(s.fin).toLocaleString('es-MX',
    { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  const estado = viva
    ? `<span class="inv-sb-reloj${apura ? ' apura' : ''}">${resto || 'termina ya'}</span>`
    : `<span class="inv-sb-reloj fin">${hayOfertas ? 'Terminó' : 'Sin ofertas'}</span>`;

  return `
  <div class="inv-sb${viva ? '' : ' cerrada'}${!viva && hayOfertas ? ' ganada' : ''}">
    <div class="inv-sb-top">
      <span class="inv-sb-tag">${viva ? '<span class="inv-sb-punto"></span>Subasta' : 'Subasta'}</span>
      ${estado}
    </div>

    <div class="inv-sb-cifra">
      <span class="inv-sb-cifra-label">${hayOfertas
        ? (viva ? 'Última oferta' : 'Oferta ganadora')
        : 'Precio de salida'}</span>
      <span class="inv-sb-cifra-monto">${sbDinero(hayOfertas ? s.ofertaActual : s.precioInicial)}
        <span class="cur">MXN</span></span>
    </div>

    <div class="inv-sb-datos">
      ${hayOfertas
        ? `<span class="inv-sb-lider">${viva ? 'Va ganando' : 'Ganó'} <b>@${escAdmin(s.lider?.username || '')}</b></span>
           <span class="inv-sb-cuenta">${s.totalOfertas} oferta${s.totalOfertas === 1 ? '' : 's'}</span>`
        : `<span class="inv-sb-lider vacio">Todavía nadie oferta</span>`}
    </div>

    <div class="inv-sb-pie">
      <span class="inv-sb-cierre">${viva ? 'Cierra el' : 'Cerró el'} ${cierre}</span>
      ${hayOfertas ? `<span class="inv-sb-salida">desde ${sbDinero(s.precioInicial)}</span>` : ''}
    </div>

    <button class="inv-sb-btn" onclick="abrirModalSubasta(${p.id})">
      ${!viva && hayOfertas ? 'Ver al ganador y su contacto' : 'Ver las ofertas'}
    </button>
  </div>`;
}

// ── Modal de ofertas ────────────────────────────────────────
let _sbPrendaAbierta = null;
let _sbTimer = null;

async function abrirModalSubasta(prendaId) {
  _sbPrendaAbierta = prendaId;
  const prenda = getDB().find(x => Number(x.id) === Number(prendaId));

  document.getElementById('sbModalTitulo').textContent = prenda?.nombre || 'Subasta';
  document.getElementById('sbModalSub').textContent = 'Cargando las ofertas…';
  document.getElementById('sbModalBody').innerHTML = '<div class="sb-cargando">Un momento…</div>';
  document.getElementById('sbModal').classList.add('open');
  document.getElementById('sbModalFondo').classList.add('open');
  document.body.style.overflow = 'hidden';

  await refrescarModalSubasta();
  // Mientras la subasta está viva, el contador y las ofertas se refrescan solos
  clearInterval(_sbTimer);
  _sbTimer = setInterval(refrescarModalSubasta, 10000);
}

function cerrarModalSubasta() {
  clearInterval(_sbTimer);
  _sbTimer = null;
  _sbPrendaAbierta = null;
  document.getElementById('sbModal')?.classList.remove('open');
  document.getElementById('sbModalFondo')?.classList.remove('open');
  document.body.style.overflow = '';
}

async function refrescarModalSubasta() {
  const id = _sbPrendaAbierta;
  if (id == null) return;

  let datos;
  try {
    datos = await api(`/api/acciones?op=subasta-vendedor&id=${id}`, { method: 'GET' });
  } catch (err) {
    document.getElementById('sbModalBody').innerHTML =
      `<div class="sb-cargando">${escAdmin(err.message || 'No se pudo cargar')}</div>`;
    return;
  }
  if (_sbPrendaAbierta !== id) return;   // se cerró mientras cargaba

  const s = datos.subasta;
  const viva = !s.cerrada;
  const resto = viva && typeof tiempoRestante === 'function' ? tiempoRestante(s.fin) : '';

  document.getElementById('sbModalSub').textContent = viva
    ? `Termina en ${resto || 'un momento'} · ${s.totalOfertas} oferta${s.totalOfertas === 1 ? '' : 's'}`
    : `Cerró el ${new Date(s.fin).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;

  const g = datos.ganador;
  const wa = g?.telefono ? String(g.telefono).replace(/[^0-9]/g, '') : '';
  const prenda = getDB().find(x => Number(x.id) === Number(id));
  const waMsg = encodeURIComponent(
    `¡Hola @${g?.username || ''}! Ganaste la subasta de "${prenda?.nombre || ''}" con ` +
    `${sbDinero(s.ofertaActual)} MXN. ¿Cómo te la hacemos llegar?`);

  const cabecera = viva ? `
    <div class="sb-estado viva">
      <div class="sb-estado-label">Oferta más alta</div>
      <div class="sb-estado-monto">${s.totalOfertas ? sbDinero(s.ofertaActual) : sbDinero(s.precioInicial)}
        <span class="cur">MXN</span></div>
      <div class="sb-estado-pie">${s.totalOfertas
        ? `Va ganando <b>@${escAdmin(s.lider?.username || '')}</b>`
        : 'Todavía nadie ofrece. Ése es el precio de salida.'}</div>
    </div>` : `
    <div class="sb-estado ${s.totalOfertas ? 'ganada' : 'desierta'}">
      <div class="sb-estado-label">${s.totalOfertas ? 'Ganó la subasta' : 'Subasta terminada'}</div>
      <div class="sb-estado-monto">${s.totalOfertas ? sbDinero(s.ofertaActual) : '—'}
        ${s.totalOfertas ? '<span class="cur">MXN</span>' : ''}</div>
      <div class="sb-estado-pie">${s.totalOfertas
        ? `<b>@${escAdmin(g?.username || s.lider?.username || '')}</b>${g?.tipo === 'invitado' ? ' · sin cuenta' : ' · con cuenta'}`
        : 'Nadie ofertó. Puedes volver a abrirla o venderla normal.'}</div>
    </div>`;

  const contacto = (!viva && g) ? `
    <div class="sb-contacto">
      <div class="sb-contacto-titulo">Contacto del ganador</div>
      <div class="sb-contacto-datos">
        ${g.nombre ? `<div><span>Nombre</span><b>${escAdmin(g.nombre)}</b></div>` : ''}
        <div><span>Usuario</span><b>@${escAdmin(g.username)}</b></div>
        ${g.telefono ? `<div><span>Teléfono</span><b>${escAdmin(g.telefono)}</b></div>` : ''}
        ${g.email ? `<div><span>Correo</span><b>${escAdmin(g.email)}</b></div>` : ''}
      </div>
      ${wa ? `<a class="sb-contacto-wa" href="https://wa.me/${wa}?text=${waMsg}" target="_blank" rel="noopener">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 2.138.558 4.147 1.535 5.886L0 24l6.274-1.507A11.944 11.944 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.853 0-3.587-.5-5.084-1.367l-.361-.214-3.733.897.931-3.618-.235-.374A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
        Escribirle por WhatsApp</a>` : '<p class="sb-contacto-sin">No dejó teléfono.</p>'}
      ${!prenda?.vendido ? `<button class="sb-marcar" onclick="marcarGanadorVendido(${id}, '${escAdmin(g.username)}')">
        Marcar como vendida a @${escAdmin(g.username)}</button>` : ''}
    </div>` : '';

  // Puesto de cada persona en el podio: se cuenta por persona, no por
  // oferta, porque tres pujas del mismo no son tres lugares.
  const puestos = new Map();
  datos.historial.forEach(o => {
    if (!puestos.has(o.username)) puestos.set(o.username, puestos.size);
  });

  const lista = datos.historial.length ? `
    <div class="sb-ofertas">
      <div class="sb-ofertas-titulo">Ofertas (${datos.historial.length})</div>
      ${datos.historial.map((o, i) => {
        const puesto = puestos.get(o.username);
        const c = (!viva && puesto < (datos.puestosConContacto || 0))
          ? datos.contactos?.[o.username] : null;
        // El contacto se enseña una vez por persona, en su oferta más alta
        const primera = datos.historial.findIndex(x => x.username === o.username) === i;
        const tel = c && primera ? String(c.telefono || '').replace(/[^0-9]/g, '') : '';
        return `
        <div class="sb-oferta${i === 0 ? ' top' : ''}">
          <span class="sb-oferta-pos">${i + 1}</span>
          <span class="sb-oferta-user">@${escAdmin(o.username)}
            ${o.tipo === 'invitado' ? '<i class="sb-oferta-tag">sin cuenta</i>' : ''}</span>
          <span class="sb-oferta-monto">${sbDinero(o.monto)}</span>
          <span class="sb-oferta-fecha">${new Date(o.fecha).toLocaleString('es-MX',
            { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          ${c && primera ? `
            <div class="sb-oferta-contacto">
              ${c.nombre ? `<span>${escAdmin(c.nombre)}</span>` : ''}
              ${tel ? `<a href="https://wa.me/${tel}" target="_blank" rel="noopener">${escAdmin(c.telefono)}</a>`
                    : '<span class="vacio">Sin teléfono</span>'}
            </div>` : ''}
        </div>`;
      }).join('')}
      ${!viva ? `<p class="sb-ofertas-nota">
        Se muestra el contacto de los primeros ${datos.puestosConContacto} lugares,
        por si el ganador no responde.</p>` : ''}
    </div>` : '<div class="sb-sin-ofertas">Todavía no hay ofertas.</div>';

  const acciones = `
    <div class="sb-modal-pie">
      ${viva ? `<button class="sb-alargar" onclick="alargarSubasta(${id}, 24)">Darle 1 día más</button>` : ''}
      <button class="sb-cancelar" onclick="cancelarSubasta(${id})">
        ${viva ? 'Cancelar subasta' : 'Quitar la subasta'}
      </button>
    </div>`;

  document.getElementById('sbModalBody').innerHTML = cabecera + contacto + lista + acciones;
}

// Atajo: cerrar la subasta y registrar la venta al ganador de una vez
async function marcarGanadorVendido(prendaId, username) {
  const ok = await uiConfirm({
    titulo: '¿Marcar como vendida?',
    mensaje: `Se registra la venta a @${username} y la prenda sale del catálogo.`,
    ok: 'Sí, vendida',
  });
  if (!ok) return;
  try {
    await api('/api/acciones?op=marcar-vendido', { method: 'POST', body: { id: prendaId, comprador: username } });
    playActionSound('ok');
    toast(`Vendida a @${username}`);
    cerrarModalSubasta();
    if (typeof pollAhora === 'function') pollAhora(600);
    refrescarVistaSubastas();
  } catch (err) {
    toast(err.message || 'No se pudo registrar la venta');
  }
}

// Una subasta se puede alargar, pero nunca acortar: quien ya ofertó contaba
// con ese tiempo. El servidor vuelve a comprobarlo.
async function alargarSubasta(prendaId, horas) {
  const s = sbDe(prendaId);
  if (!s) return;
  const nuevoFin = new Date(new Date(s.fin).getTime() + horas * 3600000);
  try {
    await api('/api/acciones?op=configurar-subasta', {
      method: 'POST',
      // Sin 'reserva' a propósito: el panel no conoce el monto (no se
      // publica) y el servidor conserva el que ya estaba guardado.
      body: { prendaId, precioInicial: s.precioInicial, fin: nuevoFin.toISOString() },
    });
    playActionSound('ok');
    toast('La subasta dura un día más');
    if (typeof pollAhora === 'function') pollAhora(600);
    await refrescarModalSubasta();
    refrescarVistaSubastas();
  } catch (err) {
    toast(err.message || 'No se pudo alargar');
  }
}

async function cancelarSubasta(prendaId) {
  const s = sbDe(prendaId);
  const conOfertas = s && s.totalOfertas > 0;
  const ok = await uiConfirm({
    titulo: conOfertas ? '¿Cancelar una subasta con ofertas?' : '¿Quitar la subasta?',
    mensaje: conOfertas
      ? `Hay ${s.totalOfertas} oferta${s.totalOfertas === 1 ? '' : 's'} en juego. Se borran todas y la prenda vuelve a venderse a precio fijo.`
      : 'La prenda vuelve a venderse a precio fijo.',
    ok: conOfertas ? 'Sí, cancelarla' : 'Quitar',
    peligro: conOfertas,
  });
  if (!ok) return;

  try {
    await api('/api/acciones?op=quitar-subasta', {
      method: 'POST', body: { prendaId, confirmar: true },
    });
    playActionSound('ok');
    toast('Subasta cancelada');
    cerrarModalSubasta();
    if (typeof pollAhora === 'function') pollAhora(600);
    refrescarVistaSubastas();
  } catch (err) {
    toast(err.message || 'No se pudo cancelar');
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('sbModal')?.classList.contains('open')) {
    cerrarModalSubasta();
  }
});

/* ═══════════════════════════════════════════════════════════
   PESTAÑA SUBASTAS
   Todas las subastas del bazar en un sitio: en cuánto van, quién
   está ofertando y, cuando terminan, cómo contactar al que ganó.
   El admin general las ve de todos los bazares.
   ═══════════════════════════════════════════════════════════ */
let _suDatos    = null;
let _suFiltro   = 'activas';
let _suBazar    = 'todos';
let _suAbiertas = new Set();   // qué listas de participantes están desplegadas
let _suCargando = false;
let _suReloj    = null;

async function cargarSubastas(forzar) {
  if (_suCargando) return;
  if (_suDatos && !forzar) { pintarSubastas(); return; }

  _suCargando = true;
  const btn = document.getElementById('suRefrescar');
  if (btn) { btn.disabled = true; btn.textContent = 'Cargando…'; }
  const lista = document.getElementById('suLista');
  if (lista && !_suDatos) lista.innerHTML = '<div class="su-vacio">Buscando tus subastas…</div>';

  try {
    _suDatos = await api('/api/acciones?op=mis-subastas', { method: 'GET' });
    pintarSubastas();
    arrancarRelojSubastas();
  } catch (err) {
    if (lista) lista.innerHTML = `<div class="su-vacio">${escAdmin(err.message || 'No se pudieron cargar')}</div>`;
  } finally {
    _suCargando = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Actualizar'; }
  }
}

// Los contadores bajan solos; la lista se vuelve a pedir cada minuto
function arrancarRelojSubastas() {
  clearInterval(_suReloj);
  _suReloj = setInterval(() => {
    if (currentTab !== 'subastas') { clearInterval(_suReloj); _suReloj = null; return; }
    document.querySelectorAll('#suLista [data-fin]').forEach(el => {
      const ms = new Date(el.dataset.fin).getTime() - Date.now();
      if (ms <= 0) { el.textContent = 'Terminó'; el.classList.add('fin'); return; }
      el.textContent = tiempoRestante(el.dataset.fin);
      el.classList.toggle('apura', ms < 3600000);
    });
  }, 1000);
}

function filtrarSubastas(f) {
  _suFiltro = f;
  document.querySelectorAll('.su-filtro').forEach(b =>
    b.classList.toggle('active', b.dataset.f === f));
  pintarSubastas();
}

function verSubastasDe(id) {
  _suBazar = id;
  pintarSubastas();
}

// Una subasta "por entregar" ya terminó, tiene ganador y la prenda
// sigue sin marcarse como vendida: son las que piden acción.
const suPorEntregar = s => s.cerrada && !!s.ganador && !s.prenda?.vendido;

function suVisibles() {
  let lista = _suDatos?.subastas || [];
  if (_suBazar !== 'todos') {
    lista = lista.filter(s => Number(s.bazarId) === Number(_suBazar));
  }
  if (_suFiltro === 'activas')     return lista.filter(s => !s.cerrada);
  if (_suFiltro === 'terminadas')  return lista.filter(s => s.cerrada);
  if (_suFiltro === 'porEntregar') return lista.filter(suPorEntregar);
  return lista;
}

function pintarSubastas() {
  if (!_suDatos) return;
  pintarSelectorBazaresSubasta();
  pintarTilesSubastas();

  const cont = document.getElementById('suLista');
  if (!cont) return;

  const lista = suVisibles();
  if (!lista.length) {
    const vacios = {
      activas: 'No tienes subastas en curso. Puedes abrir una al publicar una prenda.',
      porEntregar: 'Nada pendiente: todas las subastas ganadas ya están entregadas.',
      terminadas: 'Todavía no ha terminado ninguna subasta.',
      todas: 'Aún no has puesto ninguna prenda en subasta.',
    };
    cont.innerHTML = `<div class="su-vacio">${vacios[_suFiltro]}</div>`;
    return;
  }

  // Las que están por entregar van primero: son las que piden algo de ti
  const orden = [...lista].sort((a, b) => {
    const pa = suPorEntregar(a) ? 0 : a.cerrada ? 2 : 1;
    const pb = suPorEntregar(b) ? 0 : b.cerrada ? 2 : 1;
    if (pa !== pb) return pa - pb;
    return new Date(b.fin) - new Date(a.fin);
  });

  cont.innerHTML = orden.map(filaSubasta).join('');
}

function filaSubasta(s) {
  const p = s.prenda;
  const hay = s.totalOfertas > 0;
  const entregar = suPorEntregar(s);
  const clase = entregar ? 'entregar' : s.cerrada ? 'cerrada' : 'viva';
  const abierta = _suAbiertas.has(s.prendaId);

  const bazar = (_suDatos?.esGlobal && _suDatos.bazares.length > 1)
    ? `<span class="su-chip-bazar">${escAdmin(
        _suDatos.bazares.find(b => Number(b.id) === Number(s.bazarId))?.nombre || '')}</span>`
    : '';

  // Una terminada que ya entregaste y una que sigue pendiente no son lo
  // mismo, y el color tiene que decirlo antes de leer nada.
  const estado = !s.cerrada
    ? `<span class="su-estado viva" data-fin="${escAdmin(s.fin)}">${tiempoRestante(s.fin) || 'termina ya'}</span>`
    : entregar
      ? `<span class="su-estado pendiente">Por entregar</span>`
      : `<span class="su-estado ${hay ? 'ganada' : 'desierta'}">${hay ? 'Entregada' : 'Sin ofertas'}</span>`;

  // Marcado de la venta: lo que hay que hacer después de que gana alguien
  const accion = entregar
    ? `<button class="su-accion" onclick="marcarGanadorVendido(${s.prendaId}, '${escAdmin(s.ganador.username)}')">
         Marcar vendida a @${escAdmin(s.ganador.username)}
       </button>`
    : (s.cerrada && p?.vendido
        ? `<span class="su-accion hecha">Entregada a @${escAdmin(p.vendidoA || s.ganador?.username || '')}</span>`
        : '');

  const wa = s.ganador?.telefono ? String(s.ganador.telefono).replace(/[^0-9]/g, '') : '';
  const waMsg = encodeURIComponent(
    `¡Hola @${s.ganador?.username || ''}! Ganaste la subasta de "${p?.nombre || ''}" con ` +
    `${sbDinero(s.ofertaActual)} MXN. ¿Cómo te la hacemos llegar?`);

  return `
  <div class="su-card ${clase}">
    <div class="su-card-main">
      <div class="su-foto">
        ${p?.imagen ? `<img src="${escAdmin(p.imagen)}" alt="" loading="lazy">` : '<span>Sin foto</span>'}
      </div>

      <div class="su-datos">
        <div class="su-titulo-fila">
          <div>
            ${p?.marca ? `<div class="su-marca">${escAdmin(p.marca)}</div>` : ''}
            <div class="su-nombre">${escAdmin(p?.nombre || 'Prenda borrada')}</div>
          </div>
          ${estado}
        </div>
        ${bazar}

        <div class="su-cifras">
          <div class="su-cifra">
            <span class="su-cifra-label">${hay ? (s.cerrada ? 'Ganó con' : 'Última oferta') : 'Salida'}</span>
            <span class="su-cifra-val">${sbDinero(hay ? s.ofertaActual : s.precioInicial)}</span>
          </div>
          <div class="su-cifra chico">
            <span class="su-cifra-label">Ofertas</span>
            <span class="su-cifra-val">${s.totalOfertas}</span>
          </div>
          <div class="su-cifra chico">
            <span class="su-cifra-label">Personas</span>
            <span class="su-cifra-val">${s.participantes.length}</span>
          </div>
          ${hay ? `
          <div class="su-cifra chico">
            <span class="su-cifra-label">Sobre la salida</span>
            <span class="su-cifra-val">+${sbDinero(s.ofertaActual - s.precioInicial)}</span>
          </div>` : ''}
        </div>

        <div class="su-pie">
          <span>${s.cerrada ? 'Cerró' : 'Cierra'} el ${new Date(s.fin).toLocaleString('es-MX',
            { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          <span>Salió en ${sbDinero(s.precioInicial)}</span>
        </div>
      </div>
    </div>

    ${s.cerrada && s.ganador ? `
      <div class="su-ganador">
        <div class="su-ganador-datos">
          <span class="su-ganador-label">Ganador</span>
          <b>@${escAdmin(s.ganador.username)}</b>
          <span class="su-tipo ${s.ganador.tipo}">${s.ganador.tipo === 'invitado' ? 'sin cuenta' : 'con cuenta'}</span>
          ${s.ganador.nombre ? `<span class="su-ganador-extra">${escAdmin(s.ganador.nombre)}</span>` : ''}
          ${s.ganador.telefono ? `<span class="su-ganador-extra">${escAdmin(s.ganador.telefono)}</span>` : ''}
        </div>
        <div class="su-ganador-btns">
          ${wa ? `<a class="su-wa" href="https://wa.me/${wa}?text=${waMsg}" target="_blank" rel="noopener">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 2.138.558 4.147 1.535 5.886L0 24l6.274-1.507A11.944 11.944 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.853 0-3.587-.5-5.084-1.367l-.361-.214-3.733.897.931-3.618-.235-.374A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
            WhatsApp</a>` : '<span class="su-sin-tel">No dejó teléfono</span>'}
          ${accion}
        </div>
      </div>` : ''}

    ${s.participantes.length ? `
      <button class="su-desplegar${abierta ? ' abierta' : ''}" onclick="alternarParticipantes(${s.prendaId})">
        <span class="su-desplegar-flecha">▸</span>
        ${s.participantes.length} participante${s.participantes.length === 1 ? '' : 's'}
      </button>
      <div class="su-participantes"${abierta ? '' : ' hidden'}>
        ${s.participantes.map((u, i) => filaParticipante(u, i, s)).join('')}
        <p class="su-privacidad">
          ${s.cerrada
            ? `Se muestra el contacto de los primeros ${PUESTOS_CONTACTO} lugares, por si el
               ganador no responde y quieres ofrecérsela al siguiente. Del resto no se comparte.`
            : 'Mientras la subasta corre no se muestra el teléfono de nadie. Al cerrar aparece el de los primeros ' + PUESTOS_CONTACTO + ' lugares.'}
        </p>
      </div>` : `
      <div class="su-sin-gente">Todavía nadie ha ofertado.</div>`}

    <div class="su-card-pie">
      <button class="su-link" onclick="abrirModalSubasta(${s.prendaId})">Ver el detalle</button>
      <a class="su-link" href="prenda.html?id=${s.prendaId}" target="_blank" rel="noopener">Ver en la tienda</a>
      ${!s.cerrada ? `<button class="su-link peligro" onclick="cancelarSubasta(${s.prendaId})">Cancelar</button>` : ''}
    </div>
  </div>`;
}

// Cuántos puestos llevan contacto. Tiene que coincidir con
// PUESTOS_CON_CONTACTO de api/_subastas.js, que es quien manda.
const PUESTOS_CONTACTO = 3;

function filaParticipante(u, i, s) {
  const podio = s.cerrada && i < PUESTOS_CONTACTO;
  const tel   = podio ? String(u.telefono || '').replace(/[^0-9]/g, '') : '';
  const prenda = s.prenda;

  const msg = encodeURIComponent(
    i === 0
      ? `¡Hola @${u.username}! Ganaste la subasta de "${prenda?.nombre || ''}" con ` +
        `${sbDinero(u.maxOferta)} MXN. ¿Cómo te la hacemos llegar?`
      : `¡Hola @${u.username}! Quedaste en el lugar ${i + 1} de la subasta de ` +
        `"${prenda?.nombre || ''}". Se liberó la prenda: ¿te interesa por tu oferta de ` +
        `${sbDinero(u.maxOferta)} MXN?`);

  return `
    <div class="su-persona${i === 0 ? ' top' : ''}${podio ? ' podio' : ''}">
      <span class="su-persona-pos">${i + 1}</span>
      <span class="su-persona-user">@${escAdmin(u.username)}
        <span class="su-tipo ${u.tipo}">${u.tipo === 'invitado' ? 'sin cuenta' : 'con cuenta'}</span>
      </span>
      <span class="su-persona-monto">${sbDinero(u.maxOferta)}</span>
      <span class="su-persona-meta">${u.ofertas} oferta${u.ofertas === 1 ? '' : 's'} ·
        última ${new Date(u.ultima).toLocaleString('es-MX',
          { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
      ${podio ? `
        <div class="su-persona-contacto">
          ${u.nombre ? `<span class="su-dato">${escAdmin(u.nombre)}</span>` : ''}
          ${tel ? `<span class="su-dato tel">${escAdmin(u.telefono)}</span>` : '<span class="su-dato vacio">Sin teléfono</span>'}
          ${u.email ? `<span class="su-dato">${escAdmin(u.email)}</span>` : ''}
          ${tel ? `<a class="su-persona-wa" href="https://wa.me/${tel}?text=${msg}" target="_blank" rel="noopener">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 2.138.558 4.147 1.535 5.886L0 24l6.274-1.507A11.944 11.944 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.853 0-3.587-.5-5.084-1.367l-.361-.214-3.733.897.931-3.618-.235-.374A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
            Escribirle</a>` : ''}
        </div>` : ''}
    </div>`;
}

function alternarParticipantes(prendaId) {
  if (_suAbiertas.has(prendaId)) _suAbiertas.delete(prendaId);
  else _suAbiertas.add(prendaId);
  pintarSubastas();
}

function pintarSelectorBazaresSubasta() {
  const cont = document.getElementById('suBazares');
  if (!cont) return;
  const lista = _suDatos?.bazares || [];
  const mostrar = _suDatos?.esGlobal && lista.length > 1;
  cont.classList.toggle('hidden', !mostrar);
  if (!mostrar) return;

  cont.innerHTML = [{ id: 'todos', nombre: 'Todos los bazares' }, ...lista].map(b => `
    <button type="button" class="su-chip${String(b.id) === String(_suBazar) ? ' active' : ''}"
            onclick="verSubastasDe('${b.id}')">${escAdmin(b.nombre)}</button>`).join('');
}

function pintarTilesSubastas() {
  const cont = document.getElementById('suTiles');
  if (!cont) return;

  let lista = _suDatos?.subastas || [];
  if (_suBazar !== 'todos') lista = lista.filter(s => Number(s.bazarId) === Number(_suBazar));

  const vivas     = lista.filter(s => !s.cerrada);
  const entregar  = lista.filter(suPorEntregar);
  const ganadas   = lista.filter(s => s.cerrada && s.totalOfertas > 0);
  const recaudado = ganadas.reduce((a, s) => a + s.ofertaActual, 0);

  // Gente distinta que ha ofertado, no ofertas: dos pujas de la misma
  // persona no son dos interesados.
  const gente = new Set();
  lista.forEach(s => s.participantes.forEach(u => gente.add(u.username)));

  const ofertasVivas = vivas.reduce((a, s) => a + s.totalOfertas, 0);
  const cierraPronto = vivas
    .filter(s => new Date(s.fin).getTime() - Date.now() < 86400000)
    .sort((a, b) => new Date(a.fin) - new Date(b.fin))[0];

  const tiles = [
    { label: 'En curso', val: vivas.length,
      pie: ofertasVivas ? `${ofertasVivas} oferta${ofertasVivas === 1 ? '' : 's'} recibidas` : 'sin ofertas todavía',
      fuerte: true },
    { label: 'Por entregar', val: entregar.length,
      pie: entregar.length ? 'ganadas, falta marcarlas vendidas' : 'nada pendiente',
      alerta: entregar.length > 0 },
    { label: 'Participantes', val: gente.size,
      pie: 'personas distintas que han ofertado' },
    { label: 'Recaudado', val: sbDinero(recaudado),
      pie: `${ganadas.length} subasta${ganadas.length === 1 ? '' : 's'} ganada${ganadas.length === 1 ? '' : 's'}` },
    { label: 'Cierra pronto', val: cierraPronto ? tiempoRestante(cierraPronto.fin) : '—',
      pie: cierraPronto ? escAdmin(cierraPronto.prenda?.nombre || '') : 'nada en las próximas 24 h' },
  ];

  cont.innerHTML = tiles.map(t => `
    <div class="su-tile${t.fuerte ? ' fuerte' : ''}${t.alerta ? ' alerta' : ''}">
      <div class="su-tile-label">${t.label}</div>
      <div class="su-tile-val">${t.val}</div>
      <div class="su-tile-pie">${t.pie}</div>
    </div>`).join('');
}

// Cuando el modal cambia algo (cancelar, alargar, marcar vendida), la
// lista de atrás tiene que enterarse.
function refrescarVistaSubastas() {
  if (currentTab === 'subastas') cargarSubastas(true);
}

/* ═══════════════════════════════════════════════════════════
   GANANCIAS
   Cuánto dejó cada venta, agrupado por mes y por semana. Un bazar
   ve lo suyo; el admin general puede cambiar de bazar y comparar.

   Los colores están validados para daltonismo: azul = ganancia,
   ámbar = costo. La barra completa es lo que entró.
   ═══════════════════════════════════════════════════════════ */
const GAN_MESES   = 12;
const GAN_SEMANAS = 12;

let _ganDatos    = null;      // respuesta del servidor
let _ganBazar    = null;      // id del bazar que se está viendo
let _ganPeriodo  = 'meses';   // 'meses' | 'semanas'
let _ganCargando = false;

// En el eje no cabe el año completo: "mar 2026" → "mar '26"
const ganEtiquetaCorta = etq => String(etq).replace(/\s(\d{2})(\d{2})$/, " '$2");

const ganDinero = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');

// Solo el bazar que se está mirando
function ganBazarActual() {
  if (!_ganDatos?.bazares?.length) return null;
  return _ganDatos.bazares.find(b => Number(b.id) === Number(_ganBazar))
      || _ganDatos.bazares[0];
}

async function cargarGanancias(forzar) {
  if (_ganCargando) return;
  if (_ganDatos && !forzar) { pintarGanancias(); return; }

  _ganCargando = true;
  const btn = document.getElementById('ganRefrescar');
  if (btn) { btn.disabled = true; btn.textContent = 'Cargando…'; }
  const plot = document.getElementById('ganPlot');
  if (plot && !_ganDatos) plot.innerHTML = '<div class="gan-vacio">Sacando cuentas…</div>';

  try {
    _ganDatos = await api(`/api/acciones?op=estadisticas&meses=${GAN_MESES}&semanas=${GAN_SEMANAS}`);
    if (_ganBazar == null || !_ganDatos.bazares.some(b => Number(b.id) === Number(_ganBazar))) {
      _ganBazar = _ganDatos.bazares[0] ? Number(_ganDatos.bazares[0].id) : null;
    }
    pintarGanancias();
  } catch (err) {
    if (plot) plot.innerHTML = `<div class="gan-vacio">${escAdmin(err.message || 'No se pudieron cargar las ganancias')}</div>`;
  } finally {
    _ganCargando = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Actualizar'; }
  }
}

function cambiarPeriodoGanancias(periodo) {
  _ganPeriodo = periodo === 'semanas' ? 'semanas' : 'meses';
  document.querySelectorAll('.gan-rango-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.periodo === _ganPeriodo));
  pintarGanancias();
}

function verGananciasDe(id) {
  _ganBazar = Number(id);
  pintarGanancias();
}

function pintarGanancias() {
  if (!_ganDatos) return;
  pintarSelectorBazares();
  const bz = ganBazarActual();
  if (!bz) {
    document.getElementById('ganTiles').innerHTML = '';
    document.getElementById('ganPlot').innerHTML  = '<div class="gan-vacio">Todavía no hay ventas registradas.</div>';
    document.getElementById('ganTabla').innerHTML = '';
    return;
  }
  pintarTilesGanancias(bz);
  pintarGraficaGanancias(bz);
  pintarTablaGanancias(bz);
  pintarComparativaGanancias();

  const sub = document.getElementById('ganSubtitulo');
  if (sub) {
    sub.textContent = esAdminGlobal()
      ? `Viendo ${bz.nombre} · ${_ganDatos.ventasConsideradas} venta${_ganDatos.ventasConsideradas === 1 ? '' : 's'} en total`
      : 'Lo que dejó cada venta, por mes y por semana';
  }

  const aviso = document.getElementById('ganAviso');
  if (aviso) {
    const sin = Number(bz.ventasSinCosto || 0);
    aviso.classList.toggle('hidden', sin === 0);
    if (sin) {
      aviso.textContent = `${sin} venta${sin === 1 ? '' : 's'} de antes no guardó su costo; ` +
        'para ésas se usa el costo actual de la prenda, así que la ganancia es aproximada.';
    }
  }
}

// ── Selector de bazar (admin general) ───────────────────────
function pintarSelectorBazares() {
  const cont = document.getElementById('ganBazares');
  if (!cont) return;
  const lista = _ganDatos?.bazares || [];
  const mostrar = esAdminGlobal() && lista.length > 1;
  cont.classList.toggle('hidden', !mostrar);
  if (!mostrar) return;

  cont.innerHTML = lista.map(b => `
    <button type="button" class="gan-bazar-chip${Number(b.id) === Number(_ganBazar) ? ' active' : ''}"
            onclick="verGananciasDe(${Number(b.id)})">
      ${escAdmin(b.nombre)}
      <span class="gan-bazar-monto">${ganDinero(b.total.ganancia)}</span>
    </button>`).join('');
}

// ── Números grandes ─────────────────────────────────────────
function pintarTilesGanancias(bz) {
  const cont = document.getElementById('ganTiles');
  if (!cont) return;

  const serie   = bz[_ganPeriodo] || [];
  const actual  = serie[serie.length - 1] || { ganancia: 0, unidades: 0 };
  const previo  = serie[serie.length - 2] || null;
  const conVentas = serie.filter(p => p.unidades > 0);
  const promedio  = conVentas.length
    ? conVentas.reduce((a, p) => a + p.ganancia, 0) / conVentas.length : 0;
  const mejor = serie.reduce((a, p) => (p.ganancia > (a?.ganancia ?? -Infinity) ? p : a), null);
  const ticket = bz.total.unidades ? bz.total.ganancia / bz.total.unidades : 0;

  let cambio = '';
  if (previo && previo.ganancia > 0) {
    const pct = Math.round(((actual.ganancia - previo.ganancia) / previo.ganancia) * 100);
    const clase = pct > 0 ? 'sube' : pct < 0 ? 'baja' : 'igual';
    cambio = `<span class="gan-delta ${clase}">${pct > 0 ? '+' : ''}${pct}%</span>`;
  }

  const unidad = _ganPeriodo === 'meses' ? 'mes' : 'semana';
  const tiles = [
    { etiqueta: 'Ganancia total',    valor: ganDinero(bz.total.ganancia),
      pie: `${bz.total.unidades} prenda${bz.total.unidades === 1 ? '' : 's'} vendida${bz.total.unidades === 1 ? '' : 's'}`, fuerte: true },
    { etiqueta: `Este ${unidad}`,    valor: ganDinero(actual.ganancia),
      pie: `${actual.unidades} vendida${actual.unidades === 1 ? '' : 's'} ${cambio}` },
    { etiqueta: `Promedio por ${unidad}`, valor: ganDinero(promedio),
      pie: conVentas.length ? `sobre ${conVentas.length} con ventas` : 'sin ventas todavía' },
    { etiqueta: 'Mejor periodo',     valor: ganDinero(mejor?.ganancia || 0),
      pie: mejor && mejor.ganancia > 0 ? escAdmin(mejor.etiqueta) : '—' },
    { etiqueta: 'Ingresos',          valor: ganDinero(bz.total.ingresos),
      pie: `costo ${ganDinero(bz.total.costo)}` },
    { etiqueta: 'Ganancia por prenda', valor: ganDinero(ticket),
      pie: 'promedio de todo el historial' },
  ];

  cont.innerHTML = tiles.map(t => `
    <div class="gan-tile${t.fuerte ? ' fuerte' : ''}">
      <div class="gan-tile-label">${t.etiqueta}</div>
      <div class="gan-tile-val">${t.valor} <span class="cur">MXN</span></div>
      <div class="gan-tile-pie">${t.pie}</div>
    </div>`).join('');
}

// ── Gráfica de barras apiladas: ganancia + costo = ingresos ──
function pintarGraficaGanancias(bz) {
  const cont = document.getElementById('ganPlot');
  if (!cont) return;

  const serie = bz[_ganPeriodo] || [];
  if (!serie.length) { cont.innerHTML = '<div class="gan-vacio">Sin datos.</div>'; return; }

  const tope = Math.max(...serie.map(p => Math.max(0, p.costo) + Math.max(0, p.ganancia)), 0);
  if (tope <= 0) {
    cont.innerHTML = '<div class="gan-vacio">Todavía no hay ventas en este periodo.</div>';
    return;
  }
  const escala = v => Math.max(0, v) / tope * 100;

  // Solo se etiqueta el periodo más alto: un número en cada barra es ruido
  const maxIdx = serie.reduce((mejor, p, i) => (p.ganancia > serie[mejor].ganancia ? i : mejor), 0);

  const rejilla = [1, 0.75, 0.5, 0.25, 0].map(f => `
    <div class="gan-linea" style="bottom:${f * 100}%">
      <span class="gan-linea-val">${f === 0 ? '0' : ganDinero(tope * f)}</span>
    </div>`).join('');

  const barras = serie.map((p, i) => {
    const hayVentas = p.unidades > 0;
    const hG = escala(p.ganancia), hC = escala(p.costo);
    const perdida = p.ganancia < 0;
    return `
    <div class="gan-col${hayVentas ? '' : ' vacia'}" tabindex="0"
         data-i="${i}"
         data-tip="${escAdmin(p.etiqueta)}|${ganDinero(p.ganancia)}|${ganDinero(p.ingresos)}|${ganDinero(p.costo)}|${p.unidades}|${perdida ? '1' : '0'}">
      ${i === maxIdx && p.ganancia > 0 ? `<span class="gan-col-label">${ganDinero(p.ganancia)}</span>` : ''}
      <div class="gan-barra">
        <div class="gan-seg costo"    style="height:${hC}%"></div>
        <div class="gan-seg ganancia" style="height:${hG}%"></div>
      </div>
      <div class="gan-col-x">${escAdmin(ganEtiquetaCorta(p.etiqueta))}</div>
    </div>`;
  }).join('');

  cont.innerHTML = `
    <div class="gan-chart">
      <div class="gan-rejilla">${rejilla}</div>
      <div class="gan-cols">${barras}</div>
      <div class="gan-tip" id="ganTip" hidden></div>
    </div>`;

  activarTipGanancias(cont);
}

// Crosshair sencillo: la columna entera es el blanco, no la barra
function activarTipGanancias(cont) {
  const chart = cont.querySelector('.gan-chart');
  const tip   = cont.querySelector('#ganTip');
  if (!chart || !tip) return;

  const mostrar = col => {
    const [etq, gan, ing, cos, uds, perdida] = (col.dataset.tip || '').split('|');
    tip.innerHTML = `
      <div class="gan-tip-tit">${etq}</div>
      <div class="gan-tip-fila"><i class="gan-swatch ganancia"></i>Ganancia<b>${gan}</b></div>
      <div class="gan-tip-fila"><i class="gan-swatch costo"></i>Costo<b>${cos}</b></div>
      <div class="gan-tip-fila neutra">Ingresos<b>${ing}</b></div>
      <div class="gan-tip-pie">${uds === '0' ? 'Sin ventas' : uds + (uds === '1' ? ' prenda vendida' : ' prendas vendidas')}${perdida === '1' ? ' · se vendió por debajo del costo' : ''}</div>`;
    tip.hidden = false;

    // Se coloca al lado de la columna, nunca encima: si tapa la barra,
    // no se puede comparar lo que dice el globo con lo que se ve.
    const cRect = chart.getBoundingClientRect();
    const bRect = col.getBoundingClientRect();
    const centro = bRect.left - cRect.left + bRect.width / 2;
    const ancho  = tip.offsetWidth;
    let x = centro < cRect.width / 2
      ? bRect.right - cRect.left + 12          // columna a la izquierda → globo a su derecha
      : bRect.left  - cRect.left - ancho - 12; // y al revés
    tip.style.left = Math.max(4, Math.min(cRect.width - ancho - 4, x)) + 'px';
    chart.querySelectorAll('.gan-col').forEach(c => c.classList.toggle('activa', c === col));
  };
  const ocultar = () => {
    tip.hidden = true;
    chart.querySelectorAll('.gan-col').forEach(c => c.classList.remove('activa'));
  };

  chart.addEventListener('pointermove', e => {
    const col = e.target.closest('.gan-col');
    if (col) mostrar(col); else ocultar();
  });
  chart.addEventListener('pointerleave', ocultar);
  chart.addEventListener('focusin',  e => { const c = e.target.closest('.gan-col'); if (c) mostrar(c); });
  chart.addEventListener('focusout', ocultar);
}

// ── Tabla: la misma información sin depender del color ──────
function pintarTablaGanancias(bz) {
  const cont = document.getElementById('ganTabla');
  if (!cont) return;
  const serie = [...(bz[_ganPeriodo] || [])].reverse();

  cont.innerHTML = `
    <table class="gan-table">
      <thead><tr>
        <th>${_ganPeriodo === 'meses' ? 'Mes' : 'Semana'}</th>
        <th>Vendidas</th><th>Ingresos</th><th>Costo</th><th>Ganancia</th>
      </tr></thead>
      <tbody>${serie.map(p => `
        <tr${p.unidades ? '' : ' class="sin"'}>
          <td>${escAdmin(p.etiqueta)}</td>
          <td>${p.unidades}</td>
          <td>${ganDinero(p.ingresos)}</td>
          <td>${ganDinero(p.costo)}</td>
          <td class="gan-td-fuerte${p.ganancia < 0 ? ' negativa' : ''}">${ganDinero(p.ganancia)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

// ── Comparativa entre bazares (admin general) ───────────────
function pintarComparativaGanancias() {
  const card = document.getElementById('ganComparativaCard');
  const cont = document.getElementById('ganRanking');
  if (!card || !cont) return;

  const lista = (_ganDatos?.bazares || []).filter(b => b.total.unidades > 0);
  const mostrar = esAdminGlobal() && lista.length > 1;
  card.classList.toggle('hidden', !mostrar);
  if (!mostrar) return;

  const orden = [...lista].sort((a, b) => b.total.ganancia - a.total.ganancia);
  const tope  = Math.max(...orden.map(b => b.total.ganancia), 1);

  cont.innerHTML = orden.map(b => `
    <button type="button" class="gan-rank${Number(b.id) === Number(_ganBazar) ? ' activo' : ''}"
            onclick="verGananciasDe(${Number(b.id)})">
      <span class="gan-rank-nombre">${escAdmin(b.nombre)}</span>
      <span class="gan-rank-pista">
        <span class="gan-rank-barra" style="width:${Math.max(2, (b.total.ganancia / tope) * 100)}%"></span>
      </span>
      <span class="gan-rank-val">${ganDinero(b.total.ganancia)}</span>
      <span class="gan-rank-uds">${b.total.unidades} vendida${b.total.unidades === 1 ? '' : 's'}</span>
    </button>`).join('');
}

/* ═══════════════════════════════════════════════════════════
   MANTENIMIENTO
   Cerrar el sitio entero, o solo una parte, para poder trabajar sin
   que la gente se encuentre cosas a medias. Solo el admin principal.
   ═══════════════════════════════════════════════════════════ */
const MNT_SECCIONES = [
  { id: 'sitio',   nombre: 'Todo el sitio',
    detalle: 'Cierra las páginas públicas por completo. El panel sigue abierto para ti.' },
  { id: 'tienda',  nombre: 'Catálogo y fichas',
    detalle: 'Deja fuera tienda.html y las prendas. El inicio y los bazares siguen visibles.' },
  { id: 'cuentas', nombre: 'Cuentas de compradores',
    detalle: 'Pausa el acceso y el registro. Nadie pierde sus datos ni sus favoritos.' },
  { id: 'panel',   nombre: 'Panel para vendedores',
    detalle: 'Los bazares no pueden entrar a administrar. Tú sí.' },
];

let _mntEstado = null;   // lo que hay guardado en el servidor

async function cargarMantenimiento() {
  try {
    _mntEstado = await api('/api/acciones?op=mantenimiento', { method: 'GET' });
  } catch (_) {
    _mntEstado = null;
  }
  pintarMantenimiento();
}

function pintarMantenimiento() {
  const cont = document.getElementById('mntControles');
  if (!cont) return;

  const m = _mntEstado?.mantenimiento || {};
  cont.innerHTML = MNT_SECCIONES.map(sec => {
    const v = m[sec.id] || {};
    const cerrado = v.cerrado === true;
    return `<div class="mnt-fila${cerrado ? ' cerrada' : ''}">
      <label class="mnt-switch">
        <input type="checkbox" id="mnt_${sec.id}" ${cerrado ? 'checked' : ''}
               onchange="alternarMantenimiento('${sec.id}')">
        <span class="mnt-palanca"></span>
      </label>
      <div class="mnt-datos">
        <div class="mnt-nombre">${escAdmin(sec.nombre)}
          <span class="mnt-chip">${cerrado ? 'Cerrado' : 'Abierto'}</span>
        </div>
        <div class="mnt-detalle">${escAdmin(sec.detalle)}</div>
        <div class="mnt-campos" ${cerrado ? '' : 'hidden'}>
          <label>Mensaje para quien entre
            <input type="text" id="mntmsg_${sec.id}" maxlength="200"
                   placeholder="Estamos haciendo mejoras. Volvemos en un rato."
                   value="${escAdmin(v.mensaje || '')}">
          </label>
          <label>Reabrir automáticamente (opcional)
            <input type="datetime-local" id="mnthasta_${sec.id}"
                   value="${v.hasta ? new Date(v.hasta).toISOString().slice(0,16) : ''}">
          </label>
        </div>
      </div>
    </div>`;
  }).join('');

  // Resumen de arriba
  const cerradas = MNT_SECCIONES.filter(sec => m[sec.id]?.cerrado);
  const estado = document.getElementById('mntEstado');
  if (estado) {
    estado.textContent = cerradas.length
      ? (cerradas.some(c => c.id === 'sitio') ? 'Sitio cerrado' : `${cerradas.length} cerrada${cerradas.length !== 1 ? 's' : ''}`)
      : 'Todo abierto';
    estado.classList.toggle('cerrado', cerradas.length > 0);
  }
  const ultimo = document.getElementById('mntUltimo');
  if (ultimo) {
    ultimo.textContent = _mntEstado?.actualizadoEn
      ? `Último cambio: ${new Date(_mntEstado.actualizadoEn).toLocaleString('es-MX', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` +
        (_mntEstado.actualizadoPor ? ` por ${_mntEstado.actualizadoPor}` : '')
      : '';
  }
}

// Muestra u oculta los campos de esa sección sin recargar todo
function alternarMantenimiento(id) {
  const marcado = document.getElementById('mnt_' + id)?.checked;
  const fila = document.getElementById('mnt_' + id)?.closest('.mnt-fila');
  if (!fila) return;
  fila.classList.toggle('cerrada', marcado);
  const campos = fila.querySelector('.mnt-campos');
  if (campos) campos.hidden = !marcado;
  const chip = fila.querySelector('.mnt-chip');
  if (chip) chip.textContent = marcado ? 'Cerrado' : 'Abierto';
}

async function guardarMantenimiento() {
  const btn = document.getElementById('mntGuardar');
  const txt = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

  const mantenimiento = {};
  for (const sec of MNT_SECCIONES) {
    const cerrado = document.getElementById('mnt_' + sec.id)?.checked === true;
    const hasta = document.getElementById('mnthasta_' + sec.id)?.value || '';
    mantenimiento[sec.id] = {
      cerrado,
      mensaje: document.getElementById('mntmsg_' + sec.id)?.value.trim() || '',
      hasta: hasta ? new Date(hasta).toISOString() : null,
    };
  }

  // Cerrar todo el sitio es de las cosas que conviene confirmar
  if (mantenimiento.sitio.cerrado && !_mntEstado?.mantenimiento?.sitio?.cerrado) {
    const ok = await uiConfirm({
      titulo: '¿Cerrar todo el sitio?',
      mensaje: 'Los visitantes solo verán la pantalla de mantenimiento. Tu panel sigue funcionando.',
      ok: 'Cerrar el sitio', peligro: true,
    });
    if (!ok) { if (btn) { btn.disabled = false; btn.textContent = txt; } return; }
  }

  try {
    _mntEstado = await api('/api/acciones?op=mantenimiento', { method: 'POST', body: { mantenimiento } });
    pintarMantenimiento();
    playActionSound('ok');
    toast('Estado del sitio actualizado');
  } catch (err) {
    toast(err.message || 'No se pudo guardar');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = txt; }
  }
}

function renderSistema() {
  if (!isAdmin()) return;
  cargarMantenimiento();
  renderLogs();
  renderRespaldos();
  const db = (typeof getDB === 'function' ? getDB() : []) || [];
  const t0 = performance.now();

  // ── Rendimiento ──
  const vendidos    = db.filter(p => p.vendido).length;
  const disponibles = db.filter(p => !p.vendido).length;
  const totalImgs   = db.reduce((s,p) => s + (Array.isArray(p.imagenes) ? p.imagenes.length : 0), 0);
  const base64Imgs  = db.reduce((s,p) => s + (Array.isArray(p.imagenes)
                        ? p.imagenes.filter(i => typeof i === 'string' && i.startsWith('data:')).length : 0), 0);
  const readMs      = (performance.now() - t0).toFixed(1);
  let lsBytes = 0;
  try { for (const k in localStorage) if (Object.prototype.hasOwnProperty.call(localStorage,k)) lsBytes += (localStorage[k]||'').length; } catch {}
  const lsKB = (lsBytes/1024).toFixed(0);

  const metric = (label, val, hint) =>
    `<div class="sis-metric"><div class="sis-metric-val">${val}</div><div class="sis-metric-label">${label}</div>${hint?`<div class="sis-metric-hint">${hint}</div>`:''}</div>`;
  const mEl = document.getElementById('sistemaMetrics');
  if (mEl) mEl.innerHTML =
    metric('Prendas totales', db.length) +
    metric('Disponibles', disponibles) +
    metric('Vendidas', vendidos) +
    metric('Imágenes', totalImgs, base64Imgs ? `${base64Imgs} en base64` : 'todas por URL') +
    metric('Lectura de datos', readMs + ' ms') +
    metric('Almacenamiento local', lsKB + ' KB');

  // ── Revisión de módulos ──
  // Cada módulo se valida por: función de render + contenedor DOM esperado.
  const modulos = [
    ['Inventario',   typeof renderAll === 'function',       'view-inventario'],
    ['Registrar',    typeof submitForm === 'function',      'view-registrar'],
    ['Catálogo',     typeof renderCatalogo === 'function',  'view-catalogo'],
    ['Vendedores',   typeof renderVendedores === 'function','view-vendedores'],
    ['Drops',        typeof renderDrops === 'function',     'view-drops'],
    ['Mi Cuenta',    typeof renderCuenta === 'function',    'view-cuenta'],
    ['Sistema',      typeof renderSistema === 'function',   'view-sistema'],
  ];
  const modEl = document.getElementById('sistemaModules');
  if (modEl) modEl.innerHTML = modulos.map(([name, fnOk, viewId]) => {
    const domOk = !!document.getElementById(viewId);
    const ok = fnOk && domOk;
    const estado = ok ? 'Operativo' : (!fnOk ? 'Falta lógica' : 'Falta vista');
    return `<div class="sis-mod ${ok?'ok':'bad'}">
      <span class="sis-mod-ico">${ok ? IC_CHECK : IC_CROSS}</span>
      <span class="sis-mod-name">${name}</span>
      <span class="sis-mod-estado">${estado}</span>
    </div>`;
  }).join('');

  // ── Verificación de errores (sobre los datos reales) ──
  const errores = [];
  db.forEach(p => {
    const ref = `#${p.id ?? '?'} ${p.nombre || 'sin nombre'}`;
    if (!p.nombre)                       errores.push(['Prenda sin nombre', ref]);
    if (!p.marca)                        errores.push(['Sin marca', ref]);
    if (!Array.isArray(p.categorias) || !p.categorias.length) errores.push(['Sin categoría', ref]);
    if (!Array.isArray(p.imagenes) || !p.imagenes.length)     errores.push(['Sin imágenes', ref]);
    if (p.costo == null || isNaN(parseFloat(p.costo)))        errores.push(['Costo inválido', ref]);
    if (p.vendido && (p.precio_venta == null || isNaN(parseFloat(p.precio_venta))))
                                         errores.push(['Vendida sin precio de venta', ref]);
    if (p.vendido && parseFloat(p.precio_venta) < parseFloat(p.costo))
                                         errores.push(['Vendida por debajo del costo', ref]);
  });
  // IDs duplicados
  const ids = db.map(p => p.id);
  const dup = ids.filter((id,i) => ids.indexOf(id) !== i);
  [...new Set(dup)].forEach(id => errores.push(['ID duplicado', '#' + id]));

  const errEl = document.getElementById('sistemaErrores');
  if (errEl) {
    if (!errores.length) {
      errEl.innerHTML = `<div class="sis-ok-box">${IC_CHECK}<span>Sin errores detectados. Todo en orden.</span></div>`;
    } else {
      errEl.innerHTML =
        `<div class="sis-err-count">${errores.length} ${errores.length===1?'incidencia':'incidencias'} encontradas</div>` +
        errores.map(([tipo, ref]) =>
          `<div class="sis-err-row"><span class="sis-err-tipo">${tipo}</span><span class="sis-err-ref">${ref}</span></div>`
        ).join('');
    }
  }
}

// ─── REGISTRO DE ACTIVIDAD (LOGS) ─────────────────────────────
const LOG_ACCIONES = {
  subir:              { txt: 'Subió prenda',        ico: IC_BAG,      cls: 'log-add'  },
  editar:             { txt: 'Editó prenda',        ico: IC_EDIT,     cls: 'log-edit' },
  eliminar:           { txt: 'Eliminó prenda',      ico: IC_TRASH,    cls: 'log-del'  },
  vender:             { txt: 'Marcó vendido',       ico: IC_CHECK,    cls: 'log-sell' },
  reactivar:          { txt: 'Reactivó prenda',     ico: IC_CLOCK,    cls: 'log-edit' },
  catalogo_crear:     { txt: 'Creó en catálogo',    ico: IC_BAG,      cls: 'log-add'  },
  catalogo_editar:    { txt: 'Editó catálogo',      ico: IC_EDIT,     cls: 'log-edit' },
  catalogo_eliminar:  { txt: 'Eliminó de catálogo', ico: IC_TRASH,    cls: 'log-del'  },
  vendedor_crear:     { txt: 'Creó vendedor',       ico: IC_BAG,      cls: 'log-add'  },
  vendedor_eliminar:  { txt: 'Eliminó vendedor',    ico: IC_TRASH,    cls: 'log-del'  },
  vendedor_password:  { txt: 'Cambió contraseña',   ico: IC_KEY,      cls: 'log-edit' },
  drop_crear:         { txt: 'Creó drop',           ico: IC_CALENDAR, cls: 'log-add'  },
  drop_publicar:      { txt: 'Publicó drop',        ico: IC_ROCKET,   cls: 'log-sell' },
  drop_editar:        { txt: 'Editó drop',          ico: IC_EDIT,     cls: 'log-edit' },
  drop_eliminar:      { txt: 'Eliminó drop',        ico: IC_TRASH,    cls: 'log-del'  },
  drop_quitar_prenda: { txt: 'Quitó prenda de drop',ico: IC_X,        cls: 'log-del'  },
};

function fmtLogFecha(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return '';
  const ahora = new Date();
  const difMin = Math.floor((ahora - d) / 60000);
  if (difMin < 1)  return 'hace un momento';
  if (difMin < 60) return `hace ${difMin} min`;
  const mismoDia = d.toDateString() === ahora.toDateString();
  const hora = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  if (mismoDia) return `hoy ${hora}`;
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) + ` ${hora}`;
}

// Hora exacta completa (para el renglón secundario y el tooltip)
function fmtLogFechaExacta(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return '';
  return d.toLocaleString('es-MX', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

let _logsPagina = 0;              // página actual (0-based)
const LOGS_POR_PAGINA = 40;

// Cambia de página (delta: -1 anterior, +1 siguiente)
function logsPagina(delta) {
  _logsPagina += delta;
  renderLogs(true);   // true = conservar página (no resetear)
  scrollLogsArriba();
}

// Lleva la vista al inicio del registro de actividad
function scrollLogsArriba() {
  const ancla = document.getElementById('logsLista');
  if (ancla) {
    const y = ancla.getBoundingClientRect().top + window.scrollY - 90;
    window.scrollTo({ top: y, behavior: 'smooth' });
  }
}

function renderLogs(mantenerPagina = false) {
  if (!isAdmin()) return;
  const logs = (typeof getLogs === 'function' ? getLogs() : []) || [];

  // Poblar filtros conservando la selección actual
  const selU = document.getElementById('logFiltroUsuario');
  const selA = document.getElementById('logFiltroAccion');
  const fUprev = selU ? selU.value : '';
  const fAprev = selA ? selA.value : '';
  if (selU) {
    const usuarios = [...new Set(logs.map(l => l.usuario))].sort();
    selU.innerHTML = `<option value="">Todos los usuarios</option>` +
      usuarios.map(u => `<option value="${u}">${u}</option>`).join('');
    if (fUprev && usuarios.includes(fUprev)) selU.value = fUprev;
  }
  if (selA && selA.options.length <= 1) {
    selA.innerHTML = `<option value="">Todas las acciones</option>` +
      Object.entries(LOG_ACCIONES).map(([k, v]) => `<option value="${k}">${v.txt}</option>`).join('');
  }

  const fU = selU ? selU.value : '';
  const fA = selA ? selA.value : '';

  // Si cambió un filtro, volver a la primera página
  if (!mantenerPagina || fU !== fUprev || fA !== fAprev) _logsPagina = 0;

  const filtrados = logs.filter(l =>
    (!fU || l.usuario === fU) && (!fA || l.accion === fA)
  );

  const cont = document.getElementById('logsLista');
  if (!cont) return;
  if (!filtrados.length) {
    cont.innerHTML = `<div class="logs-empty">Sin actividad registrada todavía.</div>`;
    const nav = document.getElementById('logsPaginacion');
    if (nav) nav.innerHTML = '';
    return;
  }

  // Calcular límites de página
  const totalPaginas = Math.ceil(filtrados.length / LOGS_POR_PAGINA);
  if (_logsPagina > totalPaginas - 1) _logsPagina = totalPaginas - 1;
  if (_logsPagina < 0) _logsPagina = 0;
  const inicio = _logsPagina * LOGS_POR_PAGINA;
  const pagina = filtrados.slice(inicio, inicio + LOGS_POR_PAGINA);

  cont.innerHTML = pagina.map((l, idx) => {
    const meta = LOG_ACCIONES[l.accion] || { txt: l.accion, ico: IC_CLOCK, cls: '' };
    const objeto  = l.objeto  ? `<span class="log-objeto">${escapeHtml(l.objeto)}</span>` : '';
    const detalle = l.detalle ? `<span class="log-detalle">${escapeHtml(l.detalle)}</span>` : '';
    return `<div class="log-row" style="animation-delay:${Math.min(idx * 18, 400)}ms">
      <span class="log-ico ${meta.cls}">${meta.ico}</span>
      <div class="log-body">
        <div class="log-line"><strong>${escapeHtml(l.usuario)}</strong> · ${meta.txt} ${objeto}</div>
        ${detalle ? `<div class="log-sub">${detalle}</div>` : ''}
      </div>
      <span class="log-fecha" title="${fmtLogFechaExacta(l.ts)}">
        ${fmtLogFecha(l.ts)}
        <span class="log-fecha-exacta">${fmtLogFechaExacta(l.ts)}</span>
      </span>
    </div>`;
  }).join('');
  // Reiniciar animación de entrada
  cont.classList.remove('logs-anim');
  void cont.offsetWidth;   // fuerza reflow para relanzar la animación
  cont.classList.add('logs-anim');

  // Controles de paginación premium
  const nav = document.getElementById('logsPaginacion');
  if (nav) {
    if (totalPaginas <= 1) {
      nav.innerHTML = '';
    } else {
      const desde = inicio + 1;
      const hasta = Math.min(inicio + LOGS_POR_PAGINA, filtrados.length);

      // Números de página con elipsis inteligente
      const nums = paginacionNumeros(_logsPagina, totalPaginas);
      const numsHtml = nums.map(n => {
        if (n === '...') return `<span class="pg-ellipsis">···</span>`;
        const activa = n === _logsPagina;
        return `<button class="pg-num ${activa ? 'active' : ''}" onclick="logsIrPagina(${n})">${n + 1}</button>`;
      }).join('');

      nav.innerHTML = `
        <div class="pg-bar">
          <button class="pg-arrow" onclick="logsPagina(-1)" ${_logsPagina === 0 ? 'disabled' : ''} aria-label="Anterior">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="pg-nums">${numsHtml}</div>
          <button class="pg-arrow" onclick="logsPagina(1)" ${_logsPagina >= totalPaginas - 1 ? 'disabled' : ''} aria-label="Siguiente">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="pg-info">${desde}–${hasta} de ${filtrados.length} registros</div>`;
    }
  }
}

// Devuelve el arreglo de páginas a mostrar con '...' donde se colapsan
function paginacionNumeros(actual, total) {
  const paginas = [];
  const rango = 1; // cuántas mostrar a cada lado de la actual
  for (let i = 0; i < total; i++) {
    if (i === 0 || i === total - 1 || (i >= actual - rango && i <= actual + rango)) {
      paginas.push(i);
    } else if (paginas[paginas.length - 1] !== '...') {
      paginas.push('...');
    }
  }
  return paginas;
}

// Ir a una página específica
function logsIrPagina(n) {
  _logsPagina = n;
  renderLogs(true);
  scrollLogsArriba();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// Refrescar en vivo cuando lleguen nuevos logs por el poll (sin sacar de la página actual)
window.addEventListener('db:logs', () => {
  if (currentTab === 'sistema') renderLogs(true);
});

// Refrescar drops cuando cambien en el servidor (otro usuario)
window.addEventListener('db:drops', () => {
  if (currentTab === 'drops') renderDrops();
  if (currentTab === 'registrar') populateDropSelect();
});

// Carga y muestra las tandas de respaldo como cards
async function renderRespaldos() {
  if (!isAdmin()) return;
  const cont = document.getElementById('respaldoLista');
  if (!cont) return;
  cont.innerHTML = `<div class="respaldo-empty">Cargando respaldos...</div>`;
  try {
    const res = await fetch('/api/acciones?op=logs&modo=lotes');
    if (!res.ok) throw new Error();
    const lotes = await res.json();
    if (!lotes.length) {
      cont.innerHTML = `<div class="respaldo-empty">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>Aún no hay respaldos</span>
        <small>Se crearán automáticamente cuando el registro llegue a su límite</small>
      </div>`;
      return;
    }
    cont.innerHTML = lotes.map((l, i) => {
      const d = new Date(l.fecha);
      const fecha = isNaN(d) ? '—' : d.toLocaleString('es-MX', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      return `<div class="respaldo-card" style="animation-delay:${Math.min(i*50,300)}ms">
        <div class="respaldo-ico">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </div>
        <div class="respaldo-info">
          <div class="respaldo-fecha">${fecha}</div>
          <div class="respaldo-meta">${l.cantidad} ${l.cantidad === 1 ? 'registro' : 'registros'}</div>
        </div>
        <button class="respaldo-dl" onclick="descargarLote('${l.loteId}','${fecha.replace(/[^0-9A-Za-z]/g,'-')}')" title="Descargar .txt">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
      </div>`;
    }).join('');
  } catch (e) {
    cont.innerHTML = `<div class="respaldo-empty">No se pudieron cargar los respaldos</div>`;
  }
}

// Descarga una tanda específica como .txt
async function descargarLote(loteId, fechaLabel) {
  if (!isAdmin()) return;
  toast('Generando respaldo...');
  try {
    const res = await fetch(`/api/acciones?op=logs&modo=archivo&lote=${encodeURIComponent(loteId)}`);
    if (!res.ok) throw new Error();
    const texto = await res.text();
    const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-bazar-${fechaLabel || 'respaldo'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    playActionSound('ok');
    toast('Respaldo descargado');
  } catch (e) {
    toast('No se pudo generar el respaldo');
    playActionSound('error');
  }
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
  // Las mismas reglas que aplica el servidor (api/change-password.js): así
  // el aviso sale al instante y no después de un viaje de ida y vuelta.
  if (nueva.length < 8)  { errEl.textContent = 'Mínimo 8 caracteres'; return; }
  if (!/[A-Z]/.test(nueva) || !/[a-z]/.test(nueva) || !/[0-9]/.test(nueva)) {
    errEl.textContent = 'Necesita mayúscula, minúscula y número'; return;
  }
  if (nueva === actual)  { errEl.textContent = 'La nueva debe ser distinta de la actual'; return; }
  if (nueva !== confirm) { errEl.textContent = 'Las contraseñas no coinciden'; return; }

  try {
    const r = await api('/api/change-password', {
      method: 'POST',
      body: { username: s.username, actual, nueva }
    });
    // El servidor rota el token para cerrar las sesiones de otros
    // dispositivos: hay que quedarse con el nuevo o nos expulsa a nosotros.
    if (r?.sessionToken) setSession({ ...s, sessionToken: r.sessionToken });
    ['cp_actual','cp_nueva','cp_confirm'].forEach(id => document.getElementById(id).value = '');
    toast('Contraseña actualizada. Se cerraron las sesiones en otros dispositivos.');
  } catch (err) {
    errEl.textContent = err.message || 'No se pudo cambiar la contraseña';
  }
}

// ─── PREVIEW EN TIEMPO REAL ───────────────────────────────────
let pvIdx = 0, pvImgs = [];

function updatePreview() {
  const nombre  = document.getElementById('f_nombre')?.value.trim()  || '';
  const marca   = document.getElementById('f_marca')?.value           || '';
  const talla   = (typeof leerTalla === 'function' ? leerTalla('f') : '');
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
  pvChips.innerHTML = cats.map(c => `<span class="cat-chip">${escAdmin(c)}</span>`).join('');

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
  document.getElementById('pvPrice').innerHTML = isNaN(p) ? '$0' : `$${p.toLocaleString('es-MX')} <span class="cur">MXN</span>`;

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
  const ids = ['f_nombre','f_marca','f_precio','f_descripcion',
               'f_talla_base','f_talla_queda','f_talla_ajuste'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updatePreview);
    if (el) el.addEventListener('change', updatePreview);
  });
  // Los botones de condición no disparan 'input': se refresca al tocarlos
  const estWrap = document.getElementById('f_estado_pills');
  if (estWrap) estWrap.addEventListener('click', () => setTimeout(updatePreview, 0));
  // Escuchar checkboxes de categorías (delegación)
  const catsWrap = document.getElementById('f_cats_wrap');
  if (catsWrap) catsWrap.addEventListener('change', updatePreview);
}

// renderPreviews ya llama updatePreview() internamente

// ═══════════════════════════════════════════════════════════════
//  SISTEMA DE DROPS
// ═══════════════════════════════════════════════════════════════
// Los drops ahora viven en el servidor: getDrops()/saveDrops() están en db.js

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
  const ahora = Date.now();
  // Solo drops no publicados y cuya fecha aún no llega
  const drops = getDrops().filter(d => {
    if (d.publicado) return false;
    const t = new Date(d.fecha).getTime();
    return isNaN(t) || t > ahora;   // si no tiene fecha válida, igual se muestra
  });
  sel.innerHTML = `<option value="">-- Selecciona un drop --</option>
    <option value="__nuevo__">+ Crear nuevo drop...</option>` +
    drops.map(d => {
      const fecha = new Date(d.fecha);
      const label = fecha.toLocaleDateString('es-MX', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
      return `<option value="${d.id}">${escAdmin(d.nombre)} · ${label} (${d.prendas.length} prendas)</option>`;
    }).join('');

  sel.onchange = () => {
    const nuevoWrap = document.getElementById('dropNuevoWrap');
    if (nuevoWrap) nuevoWrap.classList.toggle('hidden', sel.value !== '__nuevo__');
  };

  // Impedir elegir fecha/hora pasada en el calendario
  const fechaInput = document.getElementById('f_dropFecha');
  if (fechaInput) {
    const ahora = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    fechaInput.min = ahora.toISOString().slice(0, 16);
  }
}

// ── Render vista Drops ────────────────────────────────────────
function renderDrops() {
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
    pendientes.length ? `<div class="drops-section-label">${IC_CLOCK} Programados</div>` : '',
    ...pendientes.map(d => renderDropCard(d)),
    publicados.length ? `<div class="drops-section-label" style="margin-top:2rem">${IC_CHECK} Publicados</div>` : '',
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
    countdown = `<div class="drop-countdown">${IC_FLAME} Faltan ${h}h ${m}m</div>`;
  }

  const thumbs = prendas.slice(0,4).map(p => {
    const img = Array.isArray(p.imagenes) && p.imagenes[0]
      ? `<img src="${escAdmin(p.imagenes[0])}" alt="${escAdmin(p.nombre)}">`
      : `<div class="drop-thumb-placeholder"></div>`;
    return `<div class="drop-thumb">${img}</div>`;
  }).join('');
  const masLabel = prendas.length > 4 ? `<div class="drop-thumb-more">+${prendas.length-4}</div>` : '';

  const statusClass = d.publicado ? 'drop-status-ok' : vencido ? 'drop-status-warn' : 'drop-status-pending';
  const statusLabel = d.publicado ? 'Publicado' : vencido ? 'Listo para publicar' : 'Programado';

  const admin = isAdmin();
  const acciones = d.publicado ? `
    ${admin ? `<button class="drop-btn drop-btn-danger" onclick="eliminarDrop('${d.id}')">${IC_TRASH} Eliminar</button>` : ''}
  ` : `
    <button class="drop-btn drop-btn-primary" onclick="publicarDrop('${d.id}')">${IC_ROCKET} Publicar ahora</button>
    <button class="drop-btn drop-btn-edit" onclick="editarDropFecha('${d.id}')">${IC_CALENDAR} Cambiar fecha</button>
    ${admin ? `<button class="drop-btn drop-btn-danger" onclick="eliminarDrop('${d.id}')">${IC_TRASH} Cancelar drop</button>` : ''}
  `;

  return `<div class="drop-card ${d.publicado ? 'drop-card-done' : ''}">
    <div class="drop-card-header">
      <div>
        <div class="drop-card-name">${escAdmin(d.nombre)}</div>
        <div class="drop-card-fecha">${fechaStr}</div>
      </div>
      <span class="drop-status ${statusClass}">${statusLabel}</span>
    </div>
    ${countdown}
    <div class="drop-thumbs-row">${thumbs}${masLabel}</div>
    <div class="drop-prendas-label">${prendas.length} prenda${prendas.length!==1?'s':''}</div>
    <div class="drop-prendas-list">
      ${prendas.map(p => `<div class="drop-prenda-item">
        <span>${escAdmin(p.nombre)}</span>
        <span class="drop-prenda-precio">$${p.precio_venta} <span class="cur">MXN</span></span>
        ${admin ? `<button class="drop-prenda-remove" onclick="quitarPrendaDeDrop('${d.id}',${p.id})" title="Quitar del drop">${IC_X}</button>` : ''}
      </div>`).join('')}
    </div>
    <div class="drop-actions">${acciones}</div>
  </div>`;
}

// ── Publicar drop manualmente ─────────────────────────────────
async function publicarDrop(dropId) {
  const seguro = await uiConfirm({
    titulo: 'Publicar drop',
    mensaje: 'Las prendas del drop pasan a verse en la tienda ahora mismo.',
    ok: 'Publicar ahora',
  });
  if (!seguro) return;
  const drops = getDrops();
  const drop  = drops.find(d => d.id === dropId);
  if (!drop) return;

  // Una petición por prenda: un drop tiene unas cuantas, no el catálogo
  // entero, así que sale más barato que remandar todo el inventario.
  await Promise.all(drop.prendas.map(pId =>
    guardarPrenda(pId, { oculto: false }).catch(() => {})));
  drop.publicado = true;
  drop.publicadoEn = new Date().toISOString();
  saveDrops(drops);
  registrarLog('drop_publicar', drop.nombre, `${drop.prendas.length} prendas`);
  playActionSound('sell');
  toast(`Drop "${drop.nombre}" publicado`);
  renderDrops();
}

// ── Auto-publicar drops cuya hora ya llegó ────────────────────
function checkDropsAutoPublish() {
  const drops = getDrops();
  const ahora = new Date();
  let huboPublicacion = false;

  drops.forEach(drop => {
    if (!drop.publicado && new Date(drop.fecha) <= ahora) {
      drop.prendas.forEach(pId => { guardarPrenda(pId, { oculto: false }).catch(() => {}); });
      drop.publicado = true;
      drop.publicadoEn = ahora.toISOString();
      huboPublicacion = true;
      registrarLog('drop_publicar', drop.nombre, 'Automático');
      toast(`Drop "${drop.nombre}" publicado automáticamente`);
    }
  });

  if (huboPublicacion) saveDrops(drops);
}

// ── Quitar prenda de un drop ──────────────────────────────────
function quitarPrendaDeDrop(dropId, prendaId) {
  if (!isAdmin()) { toast('Sin permisos'); return; }
  const drops = getDrops();
  const drop  = drops.find(d => d.id === dropId);
  if (!drop) return;
  drop.prendas = drop.prendas.filter(id => id !== prendaId);
  const p = getDB().find(x => x.id === prendaId);
  if (p) guardarPrenda(prendaId, { oculto: false }).catch(() => {});
  saveDrops(drops);
  registrarLog('drop_quitar_prenda', p?.nombre || ('#'+prendaId), `Drop: ${drop.nombre}`);
  playActionSound('del');
  toast('Prenda quitada del drop');
  renderDrops();
}

// ── Cambiar fecha del drop ────────────────────────────────────
async function editarDropFecha(dropId) {
  const drops = getDrops();
  const drop  = drops.find(d => d.id === dropId);
  if (!drop) return;
  const nueva = await uiPrompt({
    titulo: 'Cambiar fecha del drop', sub: drop.nombre || '',
    etiqueta: 'Fecha y hora', tipo: 'datetime-local',
    valor: drop.fecha.slice(0, 16), ok: 'Guardar fecha',
  });
  if (!nueva) return;
  const fecha = new Date(nueva);
  if (isNaN(fecha)) { toast('Fecha inválida'); return; }
  if (fecha.getTime() <= Date.now()) { toast('La fecha debe ser futura'); return; }
  drop.fecha = new Date(nueva).toISOString();
  saveDrops(drops);
  registrarLog('drop_editar', drop.nombre, `Nueva fecha: ${nueva}`);
  playActionSound('ok');
  toast('Fecha actualizada');
  renderDrops();
}

// ── Eliminar drop ─────────────────────────────────────────────
async function eliminarDrop(dropId) {
  if (!isAdmin()) { toast('Sin permisos'); return; }
  const drop = getDrops().find(d => d.id === dropId);
  if (!(await confirmarEliminar(
    'Las prendas guardadas en él quedarán ocultas.',
    `¿Eliminar "${drop?.nombre || 'este drop'}"?`))) return;
  const drops = getDrops().filter(d => d.id !== dropId);
  saveDrops(drops);
  registrarLog('drop_eliminar', drop?.nombre || dropId);
  playActionSound('del');
  toast('Drop eliminado');
  renderDrops();
}

// ── Chequeo automático cada minuto ───────────────────────────
setInterval(() => {
  checkDropsAutoPublish();
  if (currentTab === 'drops') renderDrops();
}, 60000);
