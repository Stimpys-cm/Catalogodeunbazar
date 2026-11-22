// ─────────────────────────────────────────────────────────────
//  js/panel/hoy.js — Pantalla "Hoy" y buscador del panel · v41
//
//  · "Hoy": arriba del Inventario (la vista con la que abre el panel), un
//    resumen de lo que hay que atender: por enviar, por entregar, pagando
//    ahora, apartados que vencen, ofertas nuevas, avisos y lo vendido hoy.
//    Cada cuadro lleva a su sección. Se puede plegar (se recuerda por equipo).
//  · Buscador: Ctrl+K o ⌘K (o el botón "Buscar" del encabezado de Hoy) busca a
//    la vez pedidos (número, nombre, teléfono, correo), prendas (nombre, marca,
//    id) y clientes con cuenta (solo administradores).
// ─────────────────────────────────────────────────────────────
(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pesos = n => '$' + Number(n || 0).toLocaleString('es-MX');
  const llamar = (op, extra = '') => api(`/api/acciones?op=${op}${extra}`);
  const icono = (n, t = 18) => (typeof ico === 'function' ? ico(n, t) : '');
  const LLAVE = 'stmp-hoy-plegado';
  let datos = null, cargando = false, ultimo = 0;

  // ── Ir a una sección del panel ────────────────────────────
  function irVentas(sec, filtro) {
    showTab('ventas');
    setTimeout(() => {
      if (typeof VN === 'object' && filtro) { VN.filtroPed = filtro; VN.verPed = 0; VN.buscaPed = ''; }
      if (typeof vnIr === 'function') vnIr(sec);
    }, 60);
  }
  window.hoyIr = function (destino) {
    const m = {
      enviar: () => irVentas('pedidos', 'entregar'), entregar: () => irVentas('pedidos', 'entregar'),
      pagando: () => irVentas('pedidos', 'sinpagar'), apartados: () => irVentas('pedidos', 'apartados'),
      ofertas: () => irVentas('ofertas'), espera: () => irVentas('interesados'), pendientes: () => irVentas('pendientes'),
      corte: () => irVentas('corte'), registrar: () => showTab('registrar'),
    };
    (m[destino] || (() => {}))();
  };

  // ── Pintar ────────────────────────────────────────────────
  function cuadro(clave, n, texto, color, icon) {
    const vacio = !n;
    return `<button class="hoy-cuadro ${vacio ? 'vacio' : color}" onclick="hoyIr('${clave}')">
      <span class="hoy-ico">${icono(icon, 18)}</span><b>${n}</b><span>${texto}</span></button>`;
  }
  function pintar() {
    const caja = document.getElementById('hoyPanel');
    if (!caja) return;
    const plegado = (() => { try { return localStorage.getItem(LLAVE) === '1'; } catch { return false; } })();
    const fecha = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Matamoros' });
    const cab = `<div class="hoy-cab"><div><h2>Hoy</h2><span>${esc(fecha.charAt(0).toUpperCase() + fecha.slice(1))}</span></div>
      <div class="hoy-cab-acc"><a class="hoy-buscar" href="caja.html" target="_blank" rel="noopener">${icono('recibo', 16)} Caja</a><button class="hoy-buscar" onclick="Buscador.abrir()">${icono('buscar', 16)} Buscar <kbd>${/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl'} K</kbd></button>
      <button class="hoy-plegar" onclick="hoyPlegar()" aria-label="${plegado ? 'Mostrar' : 'Ocultar'} resumen">${plegado ? 'Mostrar' : 'Ocultar'}</button></div></div>`;
    if (plegado) { caja.innerHTML = cab; caja.classList.add('plegado'); return; }
    caja.classList.remove('plegado');
    if (!datos) { caja.innerHTML = cab + `<div class="hoy-cargando">${cargando ? 'Revisando lo de hoy…' : ''}</div>`; return; }
    if (datos.error) { caja.innerHTML = cab + `<p class="hoy-error">${esc(datos.error)}</p>`; return; }
    const d = datos;
    const urgentes = d.porEnviar + d.porEntregar + d.apartadosVencidos + d.ofertas + d.pendientes;
    caja.innerHTML = cab + `
      <p class="hoy-resumen">${urgentes ? `Tienes <b>${urgentes}</b> cosa${urgentes === 1 ? '' : 's'} por atender.` : 'Todo al día. 🙌'}
        Hoy: <b>${d.ventasHoy.n}</b> venta${d.ventasHoy.n === 1 ? '' : 's'} (${pesos(d.ventasHoy.total)}) · <b>${d.nuevasHoy}</b> prenda${d.nuevasHoy === 1 ? '' : 's'} nueva${d.nuevasHoy === 1 ? '' : 's'} · <b>${d.disponibles}</b> disponibles.</p>
      <div class="hoy-cuadros">
        ${cuadro('enviar', d.porEnviar, 'por enviar', 'rojo', 'caja')}
        ${cuadro('entregar', d.porEntregar, 'por entregar en persona', 'ambar', 'ubicacion')}
        ${cuadro('pagando', d.pagando, 'pagando ahora', 'azul', 'reloj')}
        ${cuadro('apartados', d.apartadosVencidos + d.apartadosVencen, d.apartadosVencidos ? `apartado${d.apartadosVencidos + d.apartadosVencen === 1 ? '' : 's'} vencido${d.apartadosVencidos === 1 ? '' : 's'} o por vencer` : 'apartados que vencen en 48 h', d.apartadosVencidos ? 'rojo' : 'ambar', 'reloj')}
        ${cuadro('ofertas', d.ofertas, 'ofertas sin responder', 'ambar', 'oferta')}
        ${cuadro('pendientes', d.pendientes, 'avisos pendientes', 'azul', 'bandeja')}
        ${cuadro('espera', d.espera, 'interesados esperando', 'gris', 'campana')}
        ${cuadro('corte', d.ventasHoy.n, 'vendidas hoy', 'verde', 'recibo')}
      </div>
      ${d.ultimos?.length ? `<div class="hoy-ultimos"><span>Últimos pedidos:</span>${d.ultimos.map(p => `<button onclick="Buscador.irPedido('${esc(p.id)}','${esc(p.estado)}','${esc(p.entregaEstado || '')}')">${esc(p.nombre || '—')} · ${pesos(p.total)} <em>${p.estado === 'apartado' ? 'apartado' : p.entregaEstado === 'entregado' ? 'entregado' : p.entregaEstado === 'enviado' ? 'enviado' : 'pagado'}</em></button>`).join('')}</div>` : ''}`;
  }
  window.hoyPlegar = function () {
    try { localStorage.setItem(LLAVE, localStorage.getItem(LLAVE) === '1' ? '0' : '1'); } catch (_) {}
    pintar(); if (!datos) cargar();
  };

  async function cargar(forzar) {
    if (cargando || (!forzar && Date.now() - ultimo < 30e3 && datos)) return pintar();
    cargando = true; pintar();
    try { datos = await llamar('v-hoy'); ultimo = Date.now(); }
    catch (e) { datos = { error: e.status === 401 ? 'Tu sesión terminó.' : 'No se pudo cargar el resumen de hoy.' }; }
    cargando = false; pintar();
  }
  window.Hoy = { cargar, pintar };

  // Se muestra cuando se abre el Inventario (la vista de entrada del panel)
  function montar() {
    const vista = document.getElementById('view-inventario');
    if (!vista || document.getElementById('hoyPanel')) return;
    const caja = document.createElement('section');
    caja.id = 'hoyPanel'; caja.className = 'hoy'; caja.setAttribute('aria-label', 'Resumen de hoy');
    const cab = vista.querySelector('.view-header');
    cab ? cab.after(caja) : vista.prepend(caja);
    pintar(); cargar();
  }
  const viejoShow = window.showTab;
  if (typeof viejoShow === 'function') {
    window.showTab = function (tab, ...resto) {
      const r = viejoShow.call(this, tab, ...resto);
      if (tab === 'inventario') cargar();
      return r;
    };
  }
  document.addEventListener('DOMContentLoaded', () => setTimeout(montar, 0));
  if (document.readyState !== 'loading') setTimeout(montar, 0);

  // ── Buscador (Ctrl+K / ⌘K) ────────────────────────────────
  let t = 0, ultimoQ = '';
  function modal() {
    let m = document.getElementById('buscadorPanel');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'buscadorPanel'; m.className = 'bp'; m.hidden = true;
    m.innerHTML = `<div class="bp-fondo" onclick="Buscador.cerrar()"></div>
      <div class="bp-caja" role="dialog" aria-modal="true" aria-label="Buscar en el panel">
        <div class="bp-entrada">${icono('buscar', 18)}<input id="bpQ" type="search" autocomplete="off" placeholder="Pedido, cliente, teléfono, prenda o marca…" aria-label="Buscar">
          <button class="bp-cerrar" onclick="Buscador.cerrar()" aria-label="Cerrar">Esc</button></div>
        <div class="bp-res" id="bpRes"><p class="bp-nota">Escribe al menos 2 letras. Busca pedidos por número, nombre, teléfono o correo; prendas por nombre, marca o número.</p></div>
      </div>`;
    document.body.appendChild(m);
    const q = m.querySelector('#bpQ');
    q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => buscar(q.value), 220); });
    q.addEventListener('keydown', e => {
      const items = [...m.querySelectorAll('.bp-item')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (items[0])?.focus(); }
      if (e.key === 'Enter' && items[0]) { e.preventDefault(); items[0].click(); }
      if (i === -1) return;
    });
    m.addEventListener('keydown', e => {
      const items = [...m.querySelectorAll('.bp-item')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'Escape') cerrar();
      if (i > -1 && e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(i + 1, items.length - 1)].focus(); }
      if (i > -1 && e.key === 'ArrowUp') { e.preventDefault(); i === 0 ? q.focus() : items[i - 1].focus(); }
    });
    return m;
  }
  function abrir() {
    const m = modal(); m.hidden = false; document.body.classList.add('bp-abierto');
    const q = m.querySelector('#bpQ'); q.value = ''; setTimeout(() => q.focus(), 10);
  }
  function cerrar() {
    const m = document.getElementById('buscadorPanel'); if (!m) return;
    m.hidden = true; document.body.classList.remove('bp-abierto');
  }
  async function buscar(q) {
    q = String(q || '').trim(); ultimoQ = q;
    const res = document.getElementById('bpRes'); if (!res) return;
    if (q.length < 2) { res.innerHTML = '<p class="bp-nota">Escribe al menos 2 letras.</p>'; return; }
    res.innerHTML = '<p class="bp-nota">Buscando…</p>';
    let r;
    try { r = await llamar('v-buscar', '&q=' + encodeURIComponent(q)); }
    catch (e) { if (q === ultimoQ) res.innerHTML = `<p class="bp-nota">${esc(e.message || 'No se pudo buscar')}</p>`; return; }
    if (q !== ultimoQ) return;
    const est = p => p.estado === 'pagado' ? (p.entregaEstado === 'entregado' ? 'entregado' : p.entregaEstado === 'enviado' ? 'enviado' : 'pagado') : p.estado;
    const grupos = [];
    if (r.pedidos.length) grupos.push(`<h4>Pedidos</h4>${r.pedidos.map(p => `<button class="bp-item" onclick="Buscador.irPedido('${esc(p.id)}','${esc(p.estado)}','${esc(p.entregaEstado || '')}')">
      ${icono('caja', 16)}<span><b>${esc(p.nombre)}</b> · ${esc(p.id)}<small>${esc(p.telefono || '')} · ${pesos(p.total)} · ${esc(est(p))} · ${new Date(p.en).toLocaleDateString('es-MX')}</small></span></button>`).join('')}`);
    if (r.prendas.length) grupos.push(`<h4>Prendas</h4>${r.prendas.map(p => `<button class="bp-item" onclick="Buscador.irPrenda(${Number(p.id)})">
      ${p.imagen ? `<img src="${esc(typeof imgOptimizada === 'function' ? imgOptimizada(p.imagen, 80) : p.imagen)}" alt="" loading="lazy">` : icono('camisa', 16)}
      <span><b>${esc(p.nombre)}</b> #${Number(p.id)}<small>${esc([p.marca, p.talla && 'Talla ' + p.talla, pesos(p.precio_venta), p.vendido ? 'vendida' : p.apartada ? 'apartada' : 'disponible'].filter(Boolean).join(' · '))}</small></span></button>`).join('')}`);
    if (r.clientes.length) grupos.push(`<h4>Clientes con cuenta</h4>${r.clientes.map(c => `<button class="bp-item" onclick="Buscador.irCliente('${esc(c.telefono || c.email || '')}')">
      ${icono('personas', 16)}<span><b>${esc(c.nombre)}</b>${c.username ? ' @' + esc(c.username) : ''}<small>${esc([c.email, c.telefono].filter(Boolean).join(' · '))}</small></span></button>`).join('')}`);
    res.innerHTML = grupos.join('') || `<p class="bp-nota">Nada coincide con "${esc(q)}".</p>`;
  }
  function irPedido(id, estado, entrega) {
    cerrar();
    const filtro = estado === 'apartado' ? 'apartados' : estado === 'cancelado' ? 'cancelados' : estado === 'pagado' ? (entrega === 'entregado' ? 'entregados' : 'entregar') : 'sinpagar';
    showTab('ventas');
    setTimeout(() => { if (typeof vnIrPedido === 'function') vnIrPedido(id, filtro); }, 80);
  }
  function irPrenda(id) {
    cerrar();
    if (typeof re_editar_prenda === 'function' && getDB().some(p => p.id === id)) return re_editar_prenda(id);
    toast('Esa prenda no está en este panel', 'info');
  }
  function irCliente(dato) {
    cerrar();
    if (!dato) return;
    showTab('ventas');
    setTimeout(() => { if (typeof VN === 'object') { VN.filtroPed = 'entregados'; VN.buscaPed = dato; } if (typeof vnIr === 'function') vnIr('pedidos'); }, 80);
  }
  window.Buscador = { abrir, cerrar, buscar, irPedido, irPrenda, irCliente };
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); abrir(); }
  });
})();
