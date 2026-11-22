/* ═══════════════════════════════════════════════════════════════
   js/panel-app.js — El panel como app · v34
   ───────────────────────────────────────────────────────────────
   • Computadora: selector rápido de tema en el menú lateral y
     encabezado translúcido que se marca al hacer scroll.
   • Celular: barra de pestañas abajo (como las apps de iPhone),
     hoja "Más" con todas las secciones agrupadas, títulos grandes
     que pasan a la barra de arriba al desplazarse y ventanas que
     se cierran deslizando hacia abajo.
   • Mi cuenta → Apariencia: Automático / Claro / Oscuro + acento.
   No cambia ninguna función existente: lee el menú lateral (que
   sigue siendo la fuente de verdad de permisos y avisos) y llama a
   las mismas funciones (showTab, logout).
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (!document.body || !document.body.classList.contains('stmp-admin')) return;
  const T = window.Tema;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const celular = matchMedia('(max-width: 768px)');
  const reducido = matchMedia('(prefers-reduced-motion: reduce)');

  const SVG = (d, w = 2) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    auto: SVG('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>'),
    sol: SVG('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    luna: SVG('<path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/>'),
    mas: SVG('<circle cx="5.5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor"/>'),
    chevron: '<svg class="pa-chevron" width="9" height="15" viewBox="0 0 9 15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m1.5 1.5 6 6-6 6"/></svg>',
    cerrar: SVG('<path d="M6 6l12 12M18 6 6 18"/>', 2.6),
    persona: SVG('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>', 1.8),
    tienda: SVG('<path d="M3 9.5 4.5 4h15L21 9.5"/><path d="M4 9.5V20h16V9.5"/><path d="M3 9.5c0 1.4 1.1 2.5 2.5 2.5S8 10.9 8 9.5c0 1.4 1.1 2.5 2.5 2.5S13 10.9 13 9.5c0 1.4 1.1 2.5 2.5 2.5S18 10.9 18 9.5c0 1.4 1.1 2.5 2.5 2.5"/>'),
    paleta: SVG('<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.8 1.6-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.4 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10" cy="7.3" r="1.2" fill="currentColor"/><circle cx="14.5" cy="7.3" r="1.2" fill="currentColor"/>'),
    ajustes: SVG('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
  };

  const ACENTO_INFO = {
    azul:      { nombre: 'Azul STMP', c: '#2d6be4' },
    grafito:   { nombre: 'Grafito',   c: '#2a2b30' },
    esmeralda: { nombre: 'Esmeralda', c: '#0f9f6e' },
    violeta:   { nombre: 'Violeta',   c: '#7356e8' },
    coral:     { nombre: 'Coral',     c: '#e5573f' },
  };
  // Colores de los iconos de la hoja "Más" (como en Ajustes del iPhone)
  const COLOR_ICONO = {
    inventario: '#0a84ff', registrar: '#30b955', drops: '#ff9500', subastas: '#ff3b30',
    bazares: '#5e5ce6', vendedores: '#32ade6', catalogo: '#a2845e', solicitudes: '#ff9500',
    anuncios: '#ff2d55', instagram: '#d6336c', marketplace: '#5856d6', ventas: '#30b955',
    estudio: '#af52de', ganancias: '#ff9500', cuenta: '#8e8e93', sistema: '#636366',
  };
  // Pestañas de abajo: las primeras 4 visibles de esta lista (respeta permisos)
  const PREFERIDAS = ['inventario', 'registrar', 'ventas', 'instagram', 'ganancias', 'drops', 'cuenta'];

  /* ── Lectura del menú lateral ─────────────────────────────── */
  const visible = el => el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';
  const idDe = el => (el.id || '').replace(/^tab-/, '');
  // Grupos del menú lateral con sus secciones, en el orden que la persona
  // eligió (panel-prefs mueve las favoritas a "Favoritos" pero recuerda su grupo).
  const disponible = el => !el.classList.contains('hidden') && !el.classList.contains('pp-oculto');
  function seccionesDelMenu() {
    const nav = $('.sidebar-nav'); if (!nav) return [];
    const items = $$('.sidebar-item[id]', nav).filter(disponible);
    return $$('.sidebar-group', nav).filter(g => g.id !== 'ppFavoritos').map(g => ({
      titulo: ($('.sidebar-nav-label', g)?.textContent || '').trim(),
      items: items.filter(el => (el._grupo || el.parentElement) === g),
    })).filter(g => g.items.length);
  }
  const itemsMenu = () => $$('.sidebar-nav .sidebar-item[id]').filter(disponible);
  const etiqueta = el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim() || el.title || idDe(el);
  const icono = el => { const s = el.querySelector(':scope > svg'); return s ? s.outerHTML : ''; };
  const globo = el => { const b = el.querySelector('.sidebar-badge'); return b && !b.classList.contains('hidden') && +b.textContent > 0 ? +b.textContent : 0; };
  const pestanaActual = () => idDe($('.sidebar-nav .sidebar-item.active') || { id: 'tab-inventario' });

  /* ── Tema: controles ──────────────────────────────────────── */
  function pintarControles() {
    if (!T) return;
    const modo = T.modo, acento = T.acento;
    $$('[data-modo]').forEach(b => { const on = b.dataset.modo === modo; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); b.setAttribute('aria-pressed', on); });
    $$('.pa-acento').forEach(b => { const on = b.dataset.a === acento; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    $$('[data-pa-acento-nombre]').forEach(n => { n.textContent = ACENTO_INFO[acento]?.nombre || ''; });
  }
  function htmlAcentos() {
    return (T?.ACENTOS || []).map(a => `<button type="button" class="pa-acento" role="radio" data-a="${a}" style="--c:${ACENTO_INFO[a]?.c}" title="${ACENTO_INFO[a]?.nombre}" aria-label="${ACENTO_INFO[a]?.nombre}"></button>`).join('');
  }
  function enlazarControles(raiz) {
    $$('[data-modo]', raiz).forEach(b => { if (!b.dataset.paOk) { b.dataset.paOk = 1; b.addEventListener('click', () => T.poner(b.dataset.modo)); } });
    $$('[data-pa-acentos]', raiz).forEach(c => { if (!c.dataset.paOk) { c.dataset.paOk = 1; c.setAttribute('role', 'radiogroup'); c.innerHTML = htmlAcentos(); } });
    $$('.pa-acento', raiz).forEach(b => { if (!b.dataset.paOk) { b.dataset.paOk = 1; b.addEventListener('click', () => T.ponerAcento(b.dataset.a)); } });
    pintarControles();
  }

  // Selector rápido en el pie del menú lateral (computadora)
  function montarSelectorLateral() {
    const pie = $('.sidebar-footer'); if (!pie || $('.pa-tema-rapido', pie) || !T) return;
    const g = document.createElement('div');
    g.className = 'pa-tema-rapido'; g.setAttribute('role', 'group'); g.setAttribute('aria-label', 'Tema del panel');
    g.innerHTML = `<button type="button" data-modo="auto" title="Automático (como tu dispositivo)" aria-label="Tema automático">${IC.auto}</button>
      <button type="button" data-modo="claro" title="Claro" aria-label="Tema claro">${IC.sol}</button>
      <button type="button" data-modo="oscuro" title="Oscuro" aria-label="Tema oscuro">${IC.luna}</button>`;
    pie.insertBefore(g, pie.firstChild);
    enlazarControles(g);
  }

  /* ── Scroll: encabezado translúcido y título grande ───────── */
  let pendiente = false;
  function alDesplazar() {
    if (pendiente) return; pendiente = true;
    requestAnimationFrame(() => {
      pendiente = false;
      const y = window.scrollY || 0;
      document.body.classList.toggle('pp-desplazado', y > 6);
      if (celular.matches) {
        const vista = $('.admin-main > [id^="view-"]:not(.hidden)');
        const t = vista && $('.view-title', vista);
        const barra = $('.topbar-mobile');
        const limite = barra ? barra.getBoundingClientRect().bottom : 60;
        document.body.classList.toggle('pp-titulo-chico', !!t && t.getBoundingClientRect().bottom < limite + 2);
      }
    });
  }

  /* ── Celular: barra de navegación ─────────────────────────── */
  function tituloDe(tab) {
    const v = document.getElementById('view-' + tab);
    return (v && $('.view-title', v)?.textContent.trim()) || 'STMP MARKET';
  }
  function avatarHTML() {
    const img = document.getElementById('sidebarAvatar');
    return img && img.getAttribute('src') && img.style.display !== 'none'
      ? `<img src="${img.getAttribute('src')}" alt="">` : IC.persona;
  }
  function montarBarraSuperior() {
    const barra = $('.topbar-mobile'); if (!barra || $('.pa-perfil-mini', barra)) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pa-perfil-mini'; b.setAttribute('aria-label', 'Tu cuenta y más opciones');
    b.innerHTML = avatarHTML();
    b.addEventListener('click', () => abrirMas());
    barra.insertBefore(b, barra.firstChild);
    const img = document.getElementById('sidebarAvatar');
    if (img) new MutationObserver(() => { b.innerHTML = avatarHTML(); }).observe(img, { attributes: true, attributeFilter: ['src', 'style'] });
  }
  function ponerTituloBarra() {
    const t = $('.topbar-mobile .topbar-title'); if (t) t.textContent = tituloDe(pestanaActual());
  }

  /* ── Celular: barra de pestañas ───────────────────────────── */
  let tabbar = null, enTabbar = [];
  function elegirPestanas() {
    const vis = itemsMenu().filter(el => el.tagName === 'BUTTON');
    const porId = Object.fromEntries(vis.map(el => [idDe(el), el]));
    // Primero los favoritos del menú (si la persona marcó alguno), luego los preferidos
    let favs = [];
    try { favs = (window.PanelPrefs?.zona('menu').fav || []).map(x => String(x).replace(/^tab-/, '')); } catch (_) {}
    const orden = [...favs, ...PREFERIDAS, ...vis.map(idDe)];
    const elegidas = [];
    for (const id of orden) { if (porId[id] && !elegidas.includes(id)) elegidas.push(id); if (elegidas.length === 4) break; }
    return elegidas.map(id => porId[id]);
  }
  function pintarTabbar() {
    if (!tabbar) return;
    enTabbar = elegirPestanas();
    const act = pestanaActual();
    const enBarra = enTabbar.some(el => idDe(el) === act);
    const restoGlobos = itemsMenu().filter(el => !enTabbar.includes(el)).reduce((n, el) => n + globo(el), 0);
    tabbar.innerHTML = enTabbar.map(el => {
      const id = idDe(el), n = globo(el);
      return `<button type="button" class="pa-tab ${id === act ? 'on' : ''}" data-tab="${id}" aria-label="${etiqueta(el)}" ${id === act ? 'aria-current="page"' : ''}>${icono(el)}<span>${etiqueta(el)}</span>${n ? `<b class="pa-tab-badge">${n > 99 ? '99+' : n}</b>` : ''}</button>`;
    }).join('') + `<button type="button" class="pa-tab ${!enBarra || hojaAbierta === 'mas' ? 'on' : ''}" data-tab="__mas" aria-label="Más secciones">${IC.mas}<span>Más</span>${restoGlobos ? `<b class="pa-tab-badge">${restoGlobos > 99 ? '99+' : restoGlobos}</b>` : ''}</button>`;
    $$('.pa-tab svg', tabbar).forEach(s => { s.setAttribute('width', 25); s.setAttribute('height', 25); });
  }
  function montarTabbar() {
    if (tabbar) return;
    tabbar = document.createElement('nav');
    tabbar.className = 'pa-tabbar'; tabbar.setAttribute('aria-label', 'Secciones principales');
    tabbar.addEventListener('click', e => {
      const b = e.target.closest('.pa-tab'); if (!b) return;
      const id = b.dataset.tab;
      if (id === '__mas') { hojaAbierta === 'mas' ? cerrarHoja() : abrirMas(); return; }
      cerrarHoja(true);
      if (id === pestanaActual()) { window.scrollTo({ top: 0, behavior: reducido.matches ? 'auto' : 'smooth' }); return; }
      if (typeof window.showTab === 'function') window.showTab(id);
    });
    document.body.appendChild(tabbar);
    pintarTabbar();
  }

  /* ── Hojas (bottom sheets) ────────────────────────────────── */
  let fondo = null, hoja = null, hojaAbierta = null, focoPrevio = null;
  function montarHoja() {
    if (hoja) return;
    fondo = document.createElement('div'); fondo.className = 'pa-hoja-fondo';
    fondo.addEventListener('click', () => cerrarHoja());
    hoja = document.createElement('section'); hoja.className = 'pa-hoja';
    hoja.setAttribute('role', 'dialog'); hoja.setAttribute('aria-modal', 'true'); hoja.setAttribute('aria-labelledby', 'paHojaTitulo');
    hoja.innerHTML = `<div class="pa-agarradera" aria-hidden="true"></div>
      <header class="pa-hoja-cab"><h2 id="paHojaTitulo"></h2><button type="button" aria-label="Cerrar">${IC.cerrar}</button></header>
      <div class="pa-hoja-cuerpo"></div>`;
    $('.pa-hoja-cab button', hoja).addEventListener('click', () => cerrarHoja());
    document.body.append(fondo, hoja);
    arrastrable(hoja, $('.pa-agarradera', hoja), () => cerrarHoja(), $('.pa-hoja-cab', hoja));
  }
  function abrirHoja(nombre, titulo, html, alPintar) {
    montarHoja();
    focoPrevio = document.activeElement;
    hojaAbierta = nombre;
    $('#paHojaTitulo', hoja).textContent = titulo;
    const cuerpo = $('.pa-hoja-cuerpo', hoja);
    cuerpo.innerHTML = html; cuerpo.scrollTop = 0;
    alPintar && alPintar(cuerpo);
    hoja.style.transform = '';
    requestAnimationFrame(() => { fondo.classList.add('abierta'); hoja.classList.add('abierta'); });
    document.documentElement.style.overflow = 'hidden';
    pintarTabbar();
    setTimeout(() => $('.pa-hoja-cab button', hoja)?.focus({ preventScroll: true }), 60);
  }
  function cerrarHoja(sinFoco) {
    if (!hoja || !hojaAbierta) return;
    hojaAbierta = null;
    fondo.classList.remove('abierta'); hoja.classList.remove('abierta'); hoja.style.transform = '';
    document.documentElement.style.overflow = '';
    pintarTabbar();
    if (!sinFoco && focoPrevio && document.contains(focoPrevio)) focoPrevio.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && hojaAbierta && !document.getElementById('dlg')?.classList.contains('open')) { e.stopPropagation(); cerrarHoja(); }
  }, true);

  // Deslizar hacia abajo para cerrar (agarradera o cabecera)
  function arrastrable(panel, ...args) {
    const alCerrar = args.find(a => typeof a === 'function');
    const zonas = args.filter(a => a && a.nodeType === 1);
    let y0 = 0, dy = 0, t0 = 0, activo = false;
    const inicio = e => {
      if (e.target.closest('button:not(.pa-agarradera)') && !e.target.closest('.pa-agarradera')) return;
      activo = true; y0 = e.clientY; dy = 0; t0 = performance.now();
      panel.classList.add('arrastrando');
      e.currentTarget.setPointerCapture?.(e.pointerId);
    };
    const mover = e => {
      if (!activo) return;
      dy = Math.max(0, e.clientY - y0);
      panel.style.setProperty('transform', `translateY(${dy}px)`, 'important');
    };
    const fin = () => {
      if (!activo) return; activo = false;
      panel.classList.remove('arrastrando');
      const rapido = dy / Math.max(1, performance.now() - t0) > .55;
      panel.style.removeProperty('transform');
      if (dy > Math.min(140, panel.offsetHeight * .28) || (rapido && dy > 30)) alCerrar();
    };
    zonas.forEach(z => {
      z.style.touchAction = 'none';
      z.addEventListener('pointerdown', inicio);
      z.addEventListener('pointermove', mover);
      z.addEventListener('pointerup', fin);
      z.addEventListener('pointercancel', fin);
    });
  }

  /* ── Hoja "Más" ───────────────────────────────────────────── */
  function filaSeccion(el) {
    const id = idDe(el), n = globo(el), act = id === pestanaActual();
    const esLink = el.tagName === 'A';
    return `<button type="button" class="pa-fila ${act ? 'activa' : ''}" data-ir="${id}" ${esLink ? 'data-link="1"' : ''}>
      <span class="pa-ico" style="--ic:${COLOR_ICONO[id] || '#8e8e93'}">${icono(el)}</span>
      <span class="pa-fila-txt">${etiqueta(el)}</span>
      ${n ? `<span class="pa-num">${n > 99 ? '99+' : n}</span>` : ''}${IC.chevron}</button>`;
  }
  function abrirMas() {
    const s = (typeof getSession === 'function' && getSession()) || {};
    const rol = s.role === 'admin' ? 'Administrador' : (s.role ? 'Vendedor' : '');
    const bazar = s.bazarNombre || s.bazar || '';
    const enLinea = document.getElementById('onlineCount')?.textContent;
    const grupos = seccionesDelMenu();
    const html = `
      <div class="pa-grupo"><button type="button" class="pa-fila pa-perfil" data-ir="cuenta">
        <span class="pa-av">${avatarHTML()}</span>
        <span class="pa-fila-txt"><b>${escapar(s.username || 'Mi cuenta')}</b><small>${escapar([rol, bazar].filter(Boolean).join(' · ') || 'Perfil, contraseña y preferencias')}</small></span>${IC.chevron}
      </button></div>
      ${grupos.map(g => `${g.titulo ? `<div class="pa-grupo-tit">${escapar(g.titulo)}</div>` : ''}<div class="pa-grupo">${g.items.map(filaSeccion).join('')}</div>`).join('')}
      <div class="pa-grupo-tit">Apariencia</div>
      <div class="pa-grupo"><div class="pa-control">
        <div class="pa-seg" role="radiogroup" aria-label="Tema">
          <button type="button" data-modo="auto" role="radio">Auto</button>
          <button type="button" data-modo="claro" role="radio">Claro</button>
          <button type="button" data-modo="oscuro" role="radio">Oscuro</button>
        </div>
        <div class="pa-acentos" data-pa-acentos></div>
      </div></div>
      <div class="pa-grupo-tit">General</div>
      <div class="pa-grupo">
        ${$('.pp-ordenar') ? `<button type="button" class="pa-fila" data-accion="ordenar"><span class="pa-ico" style="--ic:#8e8e93">${IC.ajustes}</span><span class="pa-fila-txt">Personalizar menú<small>Favoritos aparecen abajo como pestañas</small></span>${IC.chevron}</button>` : ''}
        <button type="button" class="pa-fila" data-accion="tienda"><span class="pa-ico" style="--ic:#34c759">${IC.tienda}</span><span class="pa-fila-txt">Ver tienda${enLinea && enLinea !== '0' ? `<small>${enLinea} en línea ahora</small>` : ''}</span>${IC.chevron}</button>
      </div>
      <div class="pa-grupo" style="margin-top:22px"><button type="button" class="pa-fila peligro" data-accion="salir">Cerrar sesión</button></div>
      <p style="text-align:center;font-size:12px;color:var(--p-text-4);margin:18px 0 4px">STMP MARKET · Panel</p>`;
    abrirHoja('mas', 'Más', html, cuerpo => {
      enlazarControles(cuerpo);
      cuerpo.addEventListener('click', e => {
        const f = e.target.closest('[data-ir],[data-accion]'); if (!f) return;
        if (f.dataset.ir) {
          const el = document.getElementById('tab-' + f.dataset.ir);
          cerrarHoja(true);
          if (f.dataset.link && el) { el.click(); return; }
          if (typeof window.showTab === 'function') window.showTab(f.dataset.ir);
          return;
        }
        const a = f.dataset.accion;
        if (a === 'tienda') { window.open('tienda.html', '_blank'); return; }
        if (a === 'ordenar') { cerrarHoja(true); setTimeout(() => $('.pp-ordenar')?.click(), 200); return; }
        if (a === 'salir') { cerrarHoja(true); if (typeof window.logout === 'function') window.logout(); }
      });
    });
  }
  function escapar(t) { return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /* ── Ventanas del panel: deslizar hacia abajo para cerrar ─── */
  // En celular, .dlg / .re-modal / .sb-modal se muestran como hojas. Si se
  // arrastran desde el borde de arriba, se cierran con el mismo fondo que ya
  // las cierra al tocarlo (sin inventar otra forma de cerrar).
  function cierreDeslizable() {
    let modal = null, y0 = 0, dy = 0, t0 = 0;
    document.addEventListener('touchstart', e => {
      if (!celular.matches || e.touches.length !== 1) return;
      const m = e.target.closest('.dlg.open, .re-modal.open, .sb-modal.open'); if (!m) return;
      const r = m.getBoundingClientRect();
      if (e.touches[0].clientY - r.top > 34) return;           // solo desde la agarradera
      modal = m; y0 = e.touches[0].clientY; dy = 0; t0 = performance.now();
      m.style.setProperty('transition', 'none', 'important');
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (!modal) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      modal.style.setProperty('transform', `translateY(${dy}px)`, 'important');
    }, { passive: true });
    const fin = () => {
      if (!modal) return; const m = modal; modal = null;
      m.style.removeProperty('transition'); m.style.removeProperty('transform');
      const rapido = dy / Math.max(1, performance.now() - t0) > .55;
      if (!(dy > 120 || (rapido && dy > 30))) return;
      const fondoDe = m.classList.contains('dlg') ? document.querySelector('.dlg-overlay.active')
        : m.classList.contains('re-modal') ? (m.previousElementSibling?.classList.contains('re-overlay') ? m.previousElementSibling : document.querySelector('.re-overlay.active'))
        : document.querySelector('.sb-modal-fondo.open, .sb-modal-fondo.active');
      fondoDe?.click();
    };
    document.addEventListener('touchend', fin);
    document.addEventListener('touchcancel', fin);
  }

  /* ── Sincronía con el resto del panel ─────────────────────── */
  function alCambiarSeccion() {
    ponerTituloBarra();
    pintarTabbar();
    alDesplazar();
  }
  function observarMenu() {
    const nav = $('.sidebar-nav'); if (!nav) return;
    let t = 0;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(alCambiarSeccion, 30); })
      .observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true, characterData: true });
  }

  function montar() {
    montarSelectorLateral();
    enlazarControles(document);
    montarBarraSuperior();
    montarTabbar();
    ponerTituloBarra();
    observarMenu();
    cierreDeslizable();
    window.addEventListener('scroll', alDesplazar, { passive: true });
    window.addEventListener('resize', alDesplazar, { passive: true });
    celular.addEventListener?.('change', () => { cerrarHoja(true); alCambiarSeccion(); });
    T?.alCambiar(() => { pintarControles(); });
    alDesplazar();
  }
  window.PanelApp = { abrirMas, cerrar: cerrarHoja, repintar: alCambiarSeccion };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar); else montar();
})();
