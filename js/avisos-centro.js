/* ═══════════════════════════════════════════════════════════
   CENTRO DE NOTIFICACIONES (campana del panel)
   Solo pinta lo que guarda el servicio Avisos (js/db.js): no es
   otro sistema. Historial por usuario en este navegador.
   ═══════════════════════════════════════════════════════════ */
(() => {
  if (typeof Avisos !== 'object') return;
  const A = Avisos;
  const S = { abierto: false, filtro: 'todas', limpiar: false, abiertos: new Set(), origen: null };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CAMPANA = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>';

  // ── A dónde lleva la "acción relacionada" de cada aviso ──
  A.alIr(d => {
    if (d.url) return false;
    cerrar();
    if (d.tab && typeof showTab === 'function') showTab(d.tab);
    setTimeout(() => {
      if (d.tab === 'instagram' && d.vista && typeof igVista === 'function') igVista(d.vista);
      if (d.tab === 'ventas') {
        if (d.pedido && typeof vnIrPedido === 'function') vnIrPedido(d.pedido, d.filtro || 'entregar');
        else if (d.sec && typeof vnIr === 'function') vnIr(d.sec);
      }
      if (d.prenda && typeof editItem === 'function') editItem(d.prenda);
    }, 350);
  });
  A.registrarAccion('sesion', { texto: 'Iniciar sesión', principal: true,
    al: () => { location.href = typeof rutaDeAcceso === 'function' ? rutaDeAcceso() : 'login.html'; } });

  // ── Fechas ──
  const diaDe = iso => new Date(iso).toLocaleDateString('en-CA');
  function hace(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    const min = Math.round((Date.now() - d) / 6e4);
    if (min < 1) return 'Ahora';
    if (min < 60) return `Hace ${min} min`;
    const hora = d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
    if (diaDe(iso) === diaDe(Date.now())) return hora;
    if (diaDe(iso) === diaDe(Date.now() - 864e5)) return `Ayer, ${hora}`;
    return d.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  const completa = iso => new Date(iso).toLocaleString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  function tituloDia(iso) {
    if (diaDe(iso) === diaDe(Date.now())) return 'Hoy';
    if (diaDe(iso) === diaDe(Date.now() - 864e5)) return 'Ayer';
    const t = new Date(iso).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // ── Campanas (barra lateral y barra del celular) ──
  const campanas = [];
  function crearCampana(donde, clase) {
    if (!donde || donde.querySelector('.ac-campana')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ac-campana ' + clase;
    b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', 'acPanel');
    b.innerHTML = `${CAMPANA}<span class="ac-globo" hidden></span>`;
    b.onclick = e => { e.stopPropagation(); S.abierto ? cerrar() : abrir(b); };
    donde.appendChild(b);
    campanas.push(b);
  }
  function pintarCampanas() {
    const n = A.noLeidas();
    campanas.forEach(b => {
      const g = b.querySelector('.ac-globo');
      g.hidden = !n; g.textContent = n > 9 ? '9+' : String(n);
      b.setAttribute('aria-label', n ? `Notificaciones, ${n} sin leer` : 'Notificaciones');
      b.classList.toggle('ac-hay', !!n);
    });
  }

  // ── Panel ──
  let panel, capa;
  function crearPanel() {
    capa = document.createElement('div'); capa.className = 'ac-capa'; capa.hidden = true;
    capa.onclick = cerrar;
    panel = document.createElement('section');
    panel.className = 'ac-panel'; panel.id = 'acPanel'; panel.hidden = true; panel.tabIndex = -1;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'acTitulo');
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(); } });
    panel.addEventListener('click', clic);
    document.body.append(capa, panel);
  }
  function filtrados() {
    const h = A.historial();
    if (S.filtro === 'sinleer') return h.filter(e => !e.leido);
    if (S.filtro === 'errores') return h.filter(e => e.tipo === 'error');
    return h;
  }
  function item(e) {
    const accion = A.accionDe(e.id);
    const abierto = S.abiertos.has(e.id);
    const det = (e.detalles || []).length;
    return `<li class="ac-item${e.leido ? '' : ' ac-nueva'}" data-tipo="${esc(e.tipo)}" data-id="${esc(e.id)}">
      <span class="ac-ic">${A.svg(e.tipo, 17)}</span>
      <div class="ac-tx">
        <div class="ac-fila"><b>${esc(e.titulo)}${e.cuenta > 1 ? `<span class="ac-n">×${e.cuenta}</span>` : ''}</b>
          <time datetime="${esc(e.en)}" title="${esc(completa(e.en))}">${esc(hace(e.en))}</time></div>
        ${e.cuerpo ? `<p>${esc(e.cuerpo)}</p>` : ''}
        <div class="ac-meta"><span class="ac-tipo">${esc(A.NOMBRE_TIPO[e.tipo] || e.tipo)}</span><span>${esc(A.NOMBRE_ORIGEN[e.origen] || 'General')}</span>${e.critico ? '<span>Requiere atención</span>' : ''}</div>
      </div>
      ${e.leido ? '' : '<button type="button" class="ac-punto" data-acc="leer" title="Marcar como leída" aria-label="Sin leer. Marcar como leída"><span></span></button>'}
        ${det ? `<ul class="ac-det" id="acDet-${esc(e.id)}"${abierto ? '' : ' hidden'}>${e.detalles.slice(0, 30).map(d => `<li>${esc(d)}</li>`).join('')}${det > 30 ? `<li>y ${det - 30} más</li>` : ''}</ul>` : ''}
        ${accion || det ? `<div class="ac-botones">
          ${accion ? `<button type="button" class="ac-btn ac-principal" data-acc="ir">${esc(accion)}</button>` : ''}
          ${det ? `<button type="button" class="ac-btn" data-acc="det" aria-expanded="${abierto}" aria-controls="acDet-${esc(e.id)}">${abierto ? 'Ocultar detalles' : `Ver detalles (${det})`}</button>` : ''}
        </div>` : ''}
    </li>`;
  }
  function pintar() {
    if (!panel || panel.hidden) return;
    const h = A.historial(), sin = h.filter(e => !e.leido).length, err = h.filter(e => e.tipo === 'error').length;
    const lista = filtrados();
    const dias = [];
    for (const e of lista) { const t = tituloDia(e.en); let g = dias.find(x => x.t === t); if (!g) dias.push(g = { t, l: [] }); g.l.push(e); }
    const chip = (k, t, n) => `<button type="button" role="tab" class="ac-chip" aria-selected="${S.filtro === k}" data-filtro="${k}">${t}${n ? `<span>${n}</span>` : ''}</button>`;
    const vacio = { todas: ['Sin notificaciones', 'Aquí quedan los avisos de fotos, Instagram, pedidos y lo demás que pase en el panel.'],
      sinleer: ['Todo leído', 'No tienes avisos pendientes por revisar.'], errores: ['Sin errores', 'Nada ha fallado recientemente.'] }[S.filtro];
    panel.innerHTML = `
      <header class="ac-cab">
        <div><h2 id="acTitulo">Notificaciones</h2><p>${sin ? `${sin} sin leer` : 'Todo al día'}</p></div>
        <button type="button" class="ac-x" data-acc="cerrar" aria-label="Cerrar notificaciones">${A.svg('cerrar', 17)}</button>
      </header>
      <div class="ac-herr">
        <div class="ac-chips" role="tablist" aria-label="Filtrar">${chip('todas', 'Todas', h.length)}${chip('sinleer', 'Sin leer', sin)}${chip('errores', 'Errores', err)}</div>
        <div class="ac-gen">
          <button type="button" class="ac-link" data-acc="todas" ${sin ? '' : 'disabled'}>Marcar todo como leído</button>
          <button type="button" class="ac-link ${S.limpiar ? 'ac-peligro' : ''}" data-acc="limpiar" ${h.length ? '' : 'disabled'}>${S.limpiar ? '¿Borrar todo? Toca otra vez' : 'Limpiar historial'}</button>
        </div>
      </div>
      <div class="ac-lista">${lista.length ? dias.map(g => `<h3>${esc(g.t)}</h3><ul>${g.l.map(item).join('')}</ul>`).join('')
        : `<div class="ac-vacio">${CAMPANA}<b>${vacio[0]}</b><span>${vacio[1]}</span></div>`}</div>
      ${S.filtro === 'errores' && A.errores().length ? `<footer class="ac-pie"><button type="button" class="ac-link" data-acc="registro">Copiar registro técnico (${A.errores().length})</button><span>Para mandarlo a soporte si algo sigue fallando.</span></footer>` : ''}`;
  }
  function clic(e) {
    requestAnimationFrame(() => { if (S.abierto && !panel.contains(document.activeElement)) panel.focus(); });
    const b = e.target.closest('[data-acc],[data-filtro]');
    const li = e.target.closest('.ac-item');
    if (b?.dataset.filtro) { S.filtro = b.dataset.filtro; S.limpiar = false; return pintar(); }
    const acc = b?.dataset.acc;
    if (acc === 'cerrar') return cerrar();
    if (acc === 'todas') { A.marcarTodas(); return; }
    if (acc === 'limpiar') {
      if (!S.limpiar) { S.limpiar = true; pintar(); clearTimeout(S.tl); S.tl = setTimeout(() => { S.limpiar = false; pintar(); }, 4000); return; }
      S.limpiar = false; A.limpiar(); return;
    }
    if (acc === 'registro') { A.copiar(JSON.stringify(A.errores(), null, 2), { que: 'Registro', historial: false }); return; }
    if (!li) return;
    const id = li.dataset.id;
    if (acc === 'ir') { A.ejecutar(id); return; }
    if (acc === 'det') { S.abiertos.has(id) ? S.abiertos.delete(id) : S.abiertos.add(id); A.marcarLeida(id); pintar(); panel.querySelector(`.ac-item[data-id="${CSS.escape(id)}"] [data-acc="det"]`)?.focus(); return; }
    if (acc === 'leer') { A.marcarLeida(id); return; }
    if (!b) A.marcarLeida(id);
  }
  function ubicar(boton) {
    const movil = matchMedia('(max-width: 640px)').matches;
    panel.classList.toggle('ac-hoja', movil);
    capa.classList.toggle('ac-oscura', movil);
    if (movil) { panel.style.left = panel.style.top = ''; return; }
    // Se abre pegado al borde del menú lateral (mismo espacio que hay entre la campana y el borde)
    const r = boton.getBoundingClientRect(), ancho = Math.min(420, innerWidth - 24);
    const borde = boton.closest('.sidebar')?.getBoundingClientRect().right ?? r.right;
    const izq = borde + 12 + ancho < innerWidth ? borde + 12 : Math.max(12, innerWidth - ancho - 12);
    panel.style.left = izq + 'px';
    panel.style.top = Math.max(12, Math.min(r.top, innerHeight - 520)) + 'px';
  }
  function abrir(boton) {
    if (!panel) crearPanel();
    S.boton = boton; S.abierto = true;
    panel.hidden = false; capa.hidden = false;
    ubicar(boton);
    pintar();
    campanas.forEach(c => c.setAttribute('aria-expanded', 'true'));
    requestAnimationFrame(() => { panel.classList.add('ac-ver'); panel.focus(); });
  }
  function cerrar() {
    if (!S.abierto) return;
    S.abierto = false; S.limpiar = false;
    panel.classList.remove('ac-ver');
    campanas.forEach(c => c.setAttribute('aria-expanded', 'false'));
    setTimeout(() => { if (!S.abierto) { panel.hidden = true; capa.hidden = true; } }, 180);
    S.boton?.focus();
  }

  window.addEventListener('avisos:cambio', () => { pintarCampanas(); pintar(); });
  // Escape cierra aunque el foco se haya perdido al repintar; el foco no se sale del panel
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.abierto && !panel.contains(e.target)) cerrar(); });
  window.addEventListener('resize', () => { if (S.abierto && S.boton) ubicar(S.boton); });
  function montar(intento = 0) {
    // La barra de "Personalizar menú" la arma panel-prefs.js; se espera un poco a que exista
    const barra = document.querySelector('.pp-barra');
    if (!barra && intento < 20) { setTimeout(() => montar(intento + 1), 250); if (intento) return; }
    if (barra || intento >= 20) crearCampana(barra || document.querySelector('.sidebar-profile'), 'ac-en-lateral');
    crearCampana(document.querySelector('.topbar-mobile'), 'ac-en-barra');
    pintarCampanas();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar); else montar();
  window.CentroAvisos = { abrir: () => abrir(campanas.find(b => b.offsetParent) || campanas[0]), cerrar, pintar };
})();
