// ─────────────────────────────────────────────────────────────
//  js/ventas-panel.js — Pestaña "Ventas" del panel
//
//  Pendientes (avisos listos para WhatsApp) · Pedidos en línea · Ofertas · Interesados ·
//  Corte de caja · Métricas · Etiquetas QR · Promociones y pagos ·
//  Equipo (permisos) · Respaldo
// ─────────────────────────────────────────────────────────────
const VN = { sec: 'pendientes', pedidos: null, filtroPed: 'entregar', waPed: {}, datos: null, cargando: false, corte: null, metricas: null, respaldos: null, etiquetas: new Set(), buscaEt: '' };
const vnEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vnPesos = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');
const vnFecha = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); };
const vnHoy = () => new Date(Date.now() - 6 * 36e5).toISOString().slice(0, 10);
const vnApi = (op, body, extra = '') => api(`/api/acciones?op=${op}${extra}`, body ? { method: 'POST', body } : undefined);

const VN_SECCIONES = [
  ['pendientes', 'Pendientes', 'bandeja'], ['pedidos', 'Pedidos en línea', 'caja'], ['ofertas', 'Ofertas', 'oferta'], ['interesados', 'Interesados', 'campana'],
  ['corte', 'Corte de caja', 'recibo'], ['metricas', 'Qué se ve y qué se vende', 'grafica'], ['etiquetas', 'Etiquetas y SKU', 'qr'],
  ['promos', 'Promociones y pagos', 'porcentaje', true], ['modulos', 'Módulos', 'modulos', true], ['equipo', 'Equipo', 'personas', true], ['respaldo', 'Respaldo', 'respaldo', true],
];
// Secciones en el orden que eligió el usuario (favoritos arriba, sin las ocultas)
function vnSeccionesOrden(admin) {
  const disp = VN_SECCIONES.filter(s => !s[3] || admin);
  if (typeof PanelPrefs === 'undefined') return disp;
  return PanelPrefs.ordenar('ventas', disp.map(s => s[0])).map(k => disp.find(s => s[0] === k));
}
if (typeof PanelPrefs !== 'undefined') PanelPrefs.alCambiar(z => { if ((z === 'ventas' || z === '*') && document.getElementById('vtRaiz')?.children.length) vnPintar(); });

async function vtAbrir() {
  // Al entrar, la primera sección es tu favorita (o la primera de tu orden)
  if (!VN.elegida) { const p = vnSeccionesOrden(isAdmin())[0]; if (p) VN.sec = p[0]; }
  vnPintar();
  await vnCargar();
}
async function vnCargar() {
  VN.cargando = true; vnPintar();
  try { VN.datos = await vnApi('v-panel'); } catch (e) { VN.error = e.message; }
  VN.cargando = false; vnPintar(); vnGlobo();
  vnAvisarNuevos(VN.datos, { silencio: VN.sec === 'pendientes' });
}

// Pagos, reseñas y pagos sin terminar que llegaron desde la última vez: aviso + campana.
// La primera vez en este navegador solo se marcan como vistos (para no inundar).
function vnAvisarNuevos(d, { silencio = false } = {}) {
  if (!d?.pendientes || typeof Avisos !== 'object') return;
  const k = 'stmp-avisados:' + (getSession()?.username || '');
  let vistos = null; try { vistos = JSON.parse(localStorage.getItem(k)); } catch {}
  const lista = d.pendientes.filter(p => ['venta', 'recuperar', 'resena', 'interesado', 'apartado'].includes(p.tipo));
  const nuevos = Array.isArray(vistos) ? lista.filter(p => !vistos.includes(p.id)) : [];
  try { localStorage.setItem(k, JSON.stringify([...new Set([...lista.map(p => p.id), ...(vistos || [])])].slice(0, 300))); } catch {}
  if (!nuevos.length || silencio) return;
  const verPend = { texto: 'Ver pendientes', tab: 'ventas', sec: 'pendientes' };
  const linea = x => [x.cliente, x.monto ? vnPesos(x.monto) + (x.metodo ? ` con ${x.metodo}` : '') : ''].filter(Boolean).join(' · ');
  for (const p of nuevos.filter(p => vnPendDatos(p).urgente)) {
    const x = vnPendDatos(p);
    toast(x.titulo, { tipo: 'error', critico: true, origen: 'pedidos', log: false, clave: 'urgente-' + p.id, titulo: x.titulo, cuerpo: x.detalle || linea(x),
      ir: p.pedido ? { texto: 'Ver pedido', tab: 'ventas', pedido: p.pedido, filtro: 'entregar' } : verPend });
  }
  const pagos = nuevos.filter(p => p.tipo === 'venta' && !vnPendDatos(p).urgente);
  if (pagos.length === 1) {
    const x = vnPendDatos(pagos[0]);
    toast(x.titulo, { tipo: 'ok', origen: 'pedidos', importante: true, titulo: x.titulo, cuerpo: [linea(x), x.entrega].filter(Boolean).join(' · '),
      detalles: x.prendas, ir: pagos[0].pedido ? { texto: 'Ver pedido', tab: 'ventas', pedido: pagos[0].pedido, filtro: 'entregar' } : verPend });
  } else if (pagos.length > 1) {
    const total = pagos.reduce((t, p) => t + (Number(p.monto) || 0), 0);
    toast(`${pagos.length} pagos nuevos`, { tipo: 'ok', origen: 'pedidos', importante: true, titulo: `${pagos.length} pagos nuevos`,
      cuerpo: total ? `${vnPesos(total)} en total` : '', detalles: pagos.map(p => linea(vnPendDatos(p)) || sinEmojiInicial(p.texto)), ir: verPend });
  }
  const otros = nuevos.filter(p => p.tipo !== 'venta');
  if (otros.length) {
    const uno = otros.length === 1 ? vnPendDatos(otros[0]) : null;
    toast(uno ? uno.titulo : `${otros.length} avisos nuevos en Pendientes`, { tipo: otros.some(p => p.tipo === 'recuperar') ? 'alerta' : 'info', origen: 'pedidos', importante: true,
      titulo: uno ? uno.titulo : `${otros.length} avisos nuevos en Pendientes`, cuerpo: uno ? (linea(uno) || uno.detalle) : '',
      detalles: uno ? (uno.detalle && linea(uno) ? [uno.detalle] : []) : otros.map(p => { const x = vnPendDatos(p); return `${x.titulo}: ${x.cliente || x.detalle}`; }), ir: verPend });
  }
}
function vnGlobo() {
  const d = VN.datos; const g = document.getElementById('vtGlobo'); if (!g || !d) return;
  const n = d.pendientes.length + d.ofertas.filter(o => o.estado === 'nueva').length + (d.porEntregar || 0);
  g.textContent = n; g.classList.toggle('hidden', !n);
}
function vnIr(sec) {
  VN.sec = sec; VN.elegida = true; vnPintar();
  if (sec === 'pedidos') vnCargarPedidos();
  if (sec === 'corte' && !VN.corte) vnCargarCorte();
  if (sec === 'metricas' && !VN.metricas) vnCargarMetricas();
  if (sec === 'respaldo' && !VN.respaldos) vnCargarRespaldos();
}

function vnPintar() {
  const raiz = document.getElementById('vtRaiz'); if (!raiz) return;
  const admin = isAdmin();
  const d = VN.datos;
  const cuenta = k => !d ? '' : k === 'pendientes' ? d.pendientes.length : k === 'ofertas' ? d.ofertas.filter(o => o.estado === 'nueva').length : k === 'interesados' ? d.espera.length : k === 'pedidos' ? ((d.porEntregar || 0) + (d.apartados || 0) || '') : '';
  raiz.innerHTML = `
    <div class="vn">
      <nav class="vn-nav">${vnSeccionesOrden(admin).map(([k, t, ic]) => {
        const fav = typeof PanelPrefs !== 'undefined' && PanelPrefs.esFav('ventas', k);
        return `<button class="${VN.sec === k ? 'on' : ''} ${fav ? 'fav' : ''}" onclick="vnIr('${k}')"><span class="vn-nav-ic">${ico(ic, 17)}</span>${t}${cuenta(k) ? `<em>${cuenta(k)}</em>` : ''}
          <span class="pp-estrella" role="button" tabindex="-1" title="${fav ? 'Quitar de favoritos' : 'Fijar arriba'}" onclick="event.stopPropagation();PanelPrefs.alternarFav('ventas','${k}')">${ico('estrella', 14, fav ? 'lleno' : '')}</span></button>`;
      }).join('')}
        ${typeof PanelPrefs !== 'undefined' ? `<button class="vn-nav-ordenar" onclick="PanelPrefs.editor('ventas', 'Ordenar la pestaña Ventas', VN_SECCIONES.filter(s => !s[3] || isAdmin()).map(([id, nombre, ic]) => ({ id, nombre, icono: ico(ic, 17) })))">${ico('ajustes', 15)} Ordenar</button>` : ''}</nav>
      <section class="vn-cuerpo">${VN.error && !d ? `<div class="vn-aviso rojo">${vnEsc(VN.error)}</div>` : !d ? '<div class="vn-cargando"><span class="vn-spin"></span>Cargando…</div>' : vnSeccion()}</section>
    </div>`;
}

function vnSeccion() {
  switch (VN.sec) {
    case 'pendientes': return vnPendientes();
    case 'pedidos': return vnPedidos();
    case 'ofertas': return vnOfertas();
    case 'interesados': return vnInteresados();
    case 'corte': return vnCorte();
    case 'metricas': return vnMetricas();
    case 'etiquetas': return vnEtiquetas();
    case 'promos': return vnPromos();
    case 'modulos': return vnModulos();
    case 'equipo': return vnEquipo();
    case 'respaldo': return vnRespaldo();
  }
  return '';
}
const vnCab = (t, s, acc = '') => `<header class="vn-cab"><div><h2>${t}</h2>${s ? `<p>${s}</p>` : ''}</div>${acc}</header>`;

// ── Pendientes ───────────────────────────────────────────────

// ── Pedidos en línea ─────────────────────────────────────────
const VN_PAQUETERIAS = ['Estafeta', 'DHL', 'FedEx', 'J&T Express', 'Paquetexpress', '99 Minutos', 'Redpack', 'Correos de México'];
async function vnCargarPedidos() {
  try { VN.pedidos = (await vnApi('v-pedidos')).pedidos; } catch (e) { VN.pedidos = []; toast(e.message); }
  if (VN.sec === 'pedidos') vnPintar();
}
// v33: búsqueda, "Mostrar más", cancelados y alertas de pedidos atorados
const VN_PED_PAG = 20;
function vnPedGrupos() {
  const P = VN.pedidos || [];
  return {
    entregar: P.filter(p => p.estado === 'pagado' && p.entregaEstado !== 'entregado'),
    apartados: P.filter(p => p.estado === 'apartado').sort((a, b) => String(a.liquidarAntes).localeCompare(String(b.liquidarAntes))),
    entregados: P.filter(p => p.estado === 'pagado' && p.entregaEstado === 'entregado'),
    sinpagar: P.filter(p => !['pagado', 'apartado', 'cancelado', 'reemplazado'].includes(p.estado)),
    cancelados: P.filter(p => p.estado === 'cancelado'),
  };
}
function vnPedListaHtml() {
  const grupos = vnPedGrupos();
  const q = String(VN.buscaPed || '').trim().toLowerCase();
  let lista = grupos[VN.filtroPed] || [];
  if (q) lista = (VN.pedidos || []).filter(p => [p.id, p.nombre, p.telefono, p.email, ...(p.items || []).map(x => x.nombre)].some(v => String(v || '').toLowerCase().includes(q)));
  const ver = VN.verPed || VN_PED_PAG;
  const vacio = q ? `Ningún pedido coincide con "${vnEsc(VN.buscaPed)}".` : VN.filtroPed === 'entregar' ? 'No hay pedidos por entregar' : VN.filtroPed === 'apartados' ? 'No hay apartados pendientes de liquidar.' : VN.filtroPed === 'entregados' ? 'Aún no hay pedidos entregados.' : VN.filtroPed === 'cancelados' ? 'No hay pedidos cancelados recientes.' : 'Nadie dejó un pago sin terminar.';
  if (!lista.length) return `<div class="vn-vacio">${vacio}</div>`;
  return `${q ? `<p class="vn-gris vn-ped-busca-info">${lista.length} pedido${lista.length === 1 ? '' : 's'} en todas las pestañas</p>` : ''}
    <div class="vn-pedidos">${lista.slice(0, ver).map(vnPedido).join('')}</div>
    ${lista.length > ver ? `<button type="button" class="vn-btn ghost vn-ped-mas" onclick="VN.verPed=${ver + VN_PED_PAG};vnPedRepintarLista()">Mostrar más (${lista.length - ver} restantes)</button>` : ''}`;
}
function vnPedRepintarLista() { const c = document.getElementById('vnPedLista'); if (c) c.innerHTML = vnPedListaHtml(); }
function vnPedBuscar(v) { VN.buscaPed = v; VN.verPed = VN_PED_PAG; vnPedRepintarLista(); }
function vnPedidos() {
  if (!VN.pedidos) return vnCab('Pedidos en línea', '') + '<div class="vn-cargando"><span class="vn-spin"></span>Cargando…</div>';
  const grupos = vnPedGrupos();
  const atorados = (VN.pedidos || []).filter(p => (p.alertas || []).length && !['cancelado', 'reemplazado'].includes(p.estado)).length;
  const chip = (k, t) => `<button class="${VN.filtroPed === k ? 'on' : ''}" onclick="VN.filtroPed='${k}';VN.verPed=0;VN.buscaPed='';vnPintar()">${t}<em>${grupos[k].length}</em></button>`;
  const conAp = grupos.apartados.length || VN.filtroPed === 'apartados', conCan = grupos.cancelados.length || VN.filtroPed === 'cancelados';
  return `${vnCab('Pedidos en línea', 'Lo que pagaron en la tienda. Marca cada pedido como enviado o entregado y el cliente lo ve en su página de pedido.', `${VN.datos?.envia?.token && vnEsAdmin() ? `<button class="vn-btn ghost" onclick="vnRastreo(this)">${ico('camion', 15)} Revisar rastreo</button>` : ''}<button class="vn-btn" onclick="VN.pedidos=null;vnPintar();vnCargarPedidos()">${ico('recargar', 15)} Revisar</button>`)}
    ${atorados ? `<div class="vn-aviso">${ico('alerta', 15)} ${atorados} pedido${atorados === 1 ? ' necesita' : 's necesitan'} atención (marcados en amarillo o rojo). <a href="#" onclick="event.preventDefault();typeof spIrMonitor==='function'&&spIrMonitor()">Ver en el monitor</a></div>` : ''}
    <div class="vn-chips vn-chips-parejos ${conAp ? 'cuatro' : ''}">${chip('entregar', 'Por entregar')}${conAp ? chip('apartados', 'Apartados') : ''}${chip('entregados', 'Entregados')}${chip('sinpagar', 'Sin pagar')}${conCan ? chip('cancelados', 'Cancelados') : ''}</div>
    <label class="vn-ped-busca"><span class="vn-sr">Buscar pedido</span>${ico('buscar', 15)}<input class="vn-input" type="search" placeholder="Buscar por nombre, teléfono, número de pedido o prenda" value="${vnEsc(VN.buscaPed || '')}" oninput="vnPedBuscar(this.value)"></label>
    <datalist id="vnPaqs">${VN_PAQUETERIAS.map(p => `<option value="${p}">`).join('')}</datalist>
    ${VN.filtroPed === 'entregar' ? vnRecoleccionHtml() : ''}
    <div id="vnPedLista">${vnPedListaHtml()}</div>`;
}
function vnPedido(p) {
  const envio = p.entrega === 'envio', ee = p.entregaEstado;
  const vencido = p.estado === 'apartado' && p.liquidarAntes && p.liquidarAntes < new Date().toISOString();
  const estado = p.estado === 'apartado' ? `<span class="vn-tag ${vencido ? 'rojo' : 'azul'}">${vencido ? 'Apartado vencido' : 'Apartado'}</span>`
    : p.estado === 'cancelado' ? `<span class="vn-tag gris">Cancelado</span>`
    : p.estado !== 'pagado' && p.speiComprobante ? '<span class="vn-tag ambar">Transferencia por revisar</span>'
    : p.estado !== 'pagado' && p.proveedor === 'spei' ? `<span class="vn-tag gris">${p.estado === 'pendiente' ? 'Esperando transferencia' : 'No transfirió'}</span>`
    : p.estado !== 'pagado' ? `<span class="vn-tag gris">${p.estado === 'pendiente' ? 'Pagando ahora' : 'No pagó'}</span>`
    : ee === 'entregado' ? '<span class="vn-tag verde">Entregado</span>' : ee === 'enviado' ? '<span class="vn-tag azul">Enviado</span>' : `<span class="vn-tag ambar">${envio ? 'Por enviar' : 'Por entregar'}</span>`;
  const wa = VN.waPed[p.id];
  let accion = '';
  if (p.estado === 'apartado') accion = `<button class="vn-btn negro" onclick="vnApartado('${p.id}','liquidar')">${ico('dinero', 15)} Cobré el resto (${vnPesos(p.resta)})</button>
      <button class="vn-btn ghost" onclick="vnApartado('${p.id}','extender')">${ico('reloj', 15)} 3 días más</button>
      <button class="vn-btn ghost peligro" onclick="vnApartado('${p.id}','liberar')">${ico('equis', 15)} Liberar</button>`;
  if (p.estado === 'pagado') {
    // v41: generar la guía con envia.com (llena sola paquetería y número)
    const guiaBtn = envio && ee !== 'entregado' && VN.datos?.envia?.listo && vnEsAdmin()
      ? `<button class="vn-btn negro" onclick="vnGuia('${vnEsc(p.id)}', this)">${ico('caja', 15)} ${p.guiaEnvia ? 'Generar otra guía' : 'Generar guía con envia.com'}</button>` : '';
    if (ee === 'pendiente' && envio) accion = guiaBtn + `<div class="vn-envio">
        <input class="vn-input" list="vnPaqs" id="vnPaq-${p.id}" placeholder="Paquetería" maxlength="40" value="${vnEsc(p.envioDetalle?.paqueteria || '')}">
        <input class="vn-input" id="vnGuia-${p.id}" placeholder="Número de guía" maxlength="60">
        <button class="vn-btn" onclick="vnPedEstado('${p.id}','enviado')">Marcar enviado</button></div>`;
    else if (ee !== 'entregado') accion = `<button class="vn-btn" onclick="vnPedEstado('${p.id}','entregado')">Marcar entregado</button>`;
    if (p.guiaEnvia?.etiqueta) accion += ` <a class="vn-btn" href="${vnEsc(p.guiaEnvia.etiqueta)}" target="_blank" rel="noopener">${ico('recibo', 15)} Etiqueta ${vnEsc(p.guiaEnvia.paqueteria || '')} ${vnEsc(p.guiaEnvia.guia || '')}${p.guiaEnvia.prueba ? ' (prueba)' : ''}</a>`;
    if (p.guiaEnvia?.rastreo) accion += ` <a class="vn-btn ghost" href="${vnEsc(p.guiaEnvia.rastreo)}" target="_blank" rel="noopener">Rastrear</a>`;
    // v43: cancelar la guía (envíos desde el panel)
    if (p.guiaEnvia?.guia && ee !== 'entregado' && VN.datos?.config?.modulos?.enviosPanel === true && vnEsAdmin()) accion += ` <button class="vn-btn ghost peligro" onclick="vnCancelarGuia('${vnEsc(p.id)}',this)">${ico('equis', 15)} Cancelar guía</button>`;
    if (p.recoleccion) accion += ` <span class="vn-tag azul">Recolección ${vnEsc(p.recoleccion.numero || '')} · ${vnEsc(p.recoleccion.fecha)}</span>`;
    if (ee !== 'pendiente') accion += ` <button class="vn-btn ghost" onclick="vnPedEstado('${p.id}','deshacer')">Deshacer</button>`;
  }
  // v33: cancelar (sin pago confirmado), revisar el pago y ver el historial
  // v42: transferencia SPEI → ver comprobante y aprobar o rechazar (solo admin)
  // v43: lo que dijeron la IA y Banxico del comprobante
  const rev = p.speiComprobante?.revision;
  const revHtml = p.proveedor === 'spei' && ['pendiente', 'expirado'].includes(p.estado) && p.speiComprobante ? `<div class="vn-spei-rev ${rev ? vnEsc(rev.nivel) : ''}">
      ${rev ? `<b>${rev.nivel === 'verde' ? '✅' : rev.nivel === 'rojo' ? '⚠️' : '🔎'} ${vnEsc(rev.texto)}</b>
        ${rev.lectura && !rev.lectura.error ? `<small>Comprobante: ${rev.lectura.monto != null ? vnPesos(rev.lectura.monto) : 'monto ?'} · ${vnEsc(rev.lectura.bancoEmisor || 'banco ?')} · rastreo ${vnEsc(rev.lectura.claveRastreo || '?')} · ${vnEsc(rev.lectura.fecha || '')}</small>` : ''}
        ${(rev.avisos || []).map(a => `<small class="rojo">${vnEsc(a)}</small>`).join('')}` : '<small>Sin revisión automática todavía.</small>'}
      ${VN.datos?.config?.modulos?.speiIA === true && vnEsAdmin() ? `<button class="vn-btn ghost" onclick="vnSpeiVerificar('${vnEsc(p.id)}',this)">${ico('chispas', 15)} Revisar con IA y Banxico</button>` : ''}
    </div>` : '';
  if (['pendiente', 'expirado'].includes(p.estado) && p.proveedor === 'spei' && vnEsAdmin()) accion += `${revHtml}${p.speiComprobante?.url && /^https:\/\//.test(p.speiComprobante.url) ? `<a class="vn-btn" href="${vnEsc(p.speiComprobante.url)}" target="_blank" rel="noopener">${ico('recibo', 15)} Ver comprobante</a>` : ''}
      <button class="vn-btn negro" onclick="vnSpei('${vnEsc(p.id)}',true,this)">${ico('dinero', 15)} Ya me llegó</button>
      ${p.estado === 'pendiente' ? `<button class="vn-btn ghost peligro" onclick="vnSpei('${vnEsc(p.id)}',false,this)">${ico('equis', 15)} No llegó</button>` : ''}`;
  if (['pendiente', 'expirado'].includes(p.estado) && p.proveedor !== 'spei') accion += `<button class="vn-btn ghost" onclick="spAccionPedido('${vnEsc(p.id)}','revisar',this)">${ico('recargar', 15)} Revisar pago</button>
      <button class="vn-btn ghost peligro" onclick="spAccionPedido('${vnEsc(p.id)}','cancelar',this)">${ico('equis', 15)} Cancelar pedido</button>`;
  const alertas = (p.alertas || []).filter(a => !(a.tipo === 'apartado-vencido' && vencido));
  const nivel = alertas.some(a => a.nivel === 'rojo') ? ' alerta-roja' : alertas.length ? ' alerta-ambar' : '';
  return `<article class="vn-ped ${wa ? 'aviso' : ''}${VN.resaltarPed === p.id ? ' resaltado' : ''}${nivel}" id="vnPed-${vnEsc(p.id)}">
    <header><div><b>${vnEsc(p.nombre)}</b> <span class="vn-gris">${vnEsc(p.telefono)}</span></div>${estado}</header>
    ${alertas.length ? `<div class="vn-ped-alertas">${alertas.map(a => `<span class="vn-ped-alerta ${vnEsc(a.nivel)}">${ico('alerta', 13)} ${vnEsc(a.texto)}</span>`).join('')}</div>` : ''}
    ${p.estado === 'cancelado' ? `<p class="vn-gris vn-ped-cancel">Cancelado ${p.canceladoEn ? vnFecha(p.canceladoEn) : ''}${p.canceladoPor ? ` por ${vnEsc(p.canceladoPor)}` : ''}${p.motivoCancelacion ? ` · ${vnEsc(p.motivoCancelacion)}` : ''}</p>` : ''}
    <div class="vn-ped-items">${p.items.map(x => `<span>${x.imagen ? `<img src="${vnEsc(x.imagen)}" alt="" loading="lazy">` : ''}${vnEsc(x.nombre)} <em>${vnPesos(x.precio)}</em></span>`).join('')}</div>
    <dl>
      <div><dt>Total</dt><dd>${vnPesos(p.total)} ${p.estado === 'pagado' && p.modalidad !== 'apartado' ? `con ${p.proveedor === 'paypal' ? 'PayPal' : 'Clip'}` : ''}<span class="vn-gris"> · ${vnFecha(p.pagadoEn || p.en)} · ${vnEsc(p.id)}</span></dd></div>
      ${p.modalidad === 'apartado' && (p.pagos || []).length ? `<div><dt>Pagos</dt><dd>${p.pagos.map(x => `${x.tipo === 'anticipo' ? 'Anticipo' : 'Resto'} ${vnPesos(x.monto)} <span class="vn-gris">${x.proveedor === 'persona' ? 'en persona' : `con ${VN_CANAL[x.proveedor] || x.proveedor}`} · ${vnFecha(x.en)}</span>`).join('<br>')}</dd></div>` : ''}
      ${p.estado === 'apartado' ? `<div><dt>Falta</dt><dd><b>${vnPesos(p.resta)}</b> <span class="${vencido ? 'vn-rojo' : 'vn-gris'}">· ${vencido ? 'venció el' : 'liquidar antes del'} ${vnEsc(new Date(p.liquidarAntes).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' }))}</span>${p.restoEnLinea ? '<br><span class="vn-gris">Abrió el pago en línea del resto; revisa antes de cobrarle en persona.</span>' : ''}</dd></div>` : ''}
      <div><dt>Entrega</dt><dd>${!envio && p.punto ? `En persona: <b>${vnEsc(p.punto.nombre)}</b>${p.punto.costo ? ` <span class="vn-gris">(cobró ${vnPesos(p.punto.costo)})</span>` : ' <span class="vn-gris">(gratis)</span>'}` : envio ? `Envío a domicilio${p.envioDetalle ? ` con <b>${vnEsc(p.envioDetalle.paqueteria)} ${vnEsc(p.envioDetalle.servicio)}</b> <span class="vn-gris">(${p.envioDetalle.gratis ? 'gratis para el cliente' : `cobrado ${vnPesos(p.envioDetalle.cobrado)}`}, te cuesta ${vnPesos(p.envioDetalle.costo)})</span>` : ''}${p.direccion ? `<span class="vn-dir">${vnEsc(p.direccion)}</span>` : ''}` : 'En persona'}</dd></div>
      ${ee !== 'pendiente' && p.guia ? `<div><dt>Guía</dt><dd>${vnEsc(p.paqueteria)} <b>${vnEsc(p.guia)}</b></dd></div>` : ''}
      ${p.resena ? `<div><dt>Reseña</dt><dd class="vn-estrellas" aria-label="${p.resena.estrellas} de 5">${ico('estrella', 15, 'lleno').repeat(p.resena.estrellas)}</dd></div>` : ''}
      ${p.revisar ? '<div><dt>Ojo</dt><dd>Una prenda ya se había vendido: revisa Pendientes para devolver ese monto.</dd></div>' : ''}
    </dl>
    ${wa ? `<a class="vn-btn wa grande" href="${vnEsc(wa)}" target="_blank" rel="noopener" onclick="delete VN.waPed['${p.id}'];setTimeout(vnPintar,300)">Avisar a ${vnEsc(String(p.nombre).split(' ')[0])} por WhatsApp</a>` : ''}
    <footer>${accion}
      <a class="vn-btn ghost" href="${vnEsc(p.recordar || p.whatsapp)}" target="_blank" rel="noopener">${p.recordar ? 'Recordar por WhatsApp' : 'WhatsApp'}</a>
      ${p.link ? `<a class="vn-btn ghost" href="${vnEsc(p.link)}" target="_blank" rel="noopener">Ver su página</a>` : ''}
      ${typeof spHistorial === 'function' ? `<button class="vn-btn ghost" onclick="spHistorial('${vnEsc(p.id)}')">${ico('reloj', 15)} Historial${p.historialN ? ` (${p.historialN})` : ''}</button>` : ''}</footer>
  </article>`;
}
const vnFilaPunto = p => `<tr data-punto><td><input class="vn-input" data-k="nombre" maxlength="50" value="${vnEsc(p.nombre)}" placeholder="Ej. Plaza Real"></td>
  <td><input class="vn-input chico" data-k="costo" type="number" min="0" step="10" value="${Number(p.costo) || 0}"></td>
  <td><button class="vn-btn ghost" onclick="this.closest('tr').remove()" aria-label="Quitar punto">${ico('equis', 15)}</button></td></tr>`;

// ── Módulos: prender o apagar cada función ─────────────────
// k: interruptor en config.modulos; o una función para los que ya tenían su propio ajuste
const VN_MODULOS = [
  ['Tienda (lo que ven tus clientes)', [
    ['comprarAhora', 'Comprar ahora', 'Botón en cada prenda que lleva directo al pago.', 'bolsa'],
    ['ofertas', 'Hacer una oferta', 'El cliente propone un precio y te llega a Ofertas.', 'oferta', c => c.ofertas?.activas !== false, (c, v) => ({ ofertas: { ...c.ofertas, activas: v } })],
    ['avisame', 'Avísame', '"Avísame si se libera", alertas de drops y de su talla.', 'campana'],
    ['vistasHoy', 'Personas que la vieron hoy', 'Muestra "N personas la vieron hoy" cuando son 5 o más.', 'ojo'],
    ['miTalla', 'Mi talla', 'Barra para filtrar el catálogo por su talla.', 'regla'],
    ['dropBanner', 'Aviso del próximo drop', 'Banner con cuenta regresiva en el catálogo.', 'fuego'],
    ['promoBarra', 'Barra de promoción', 'Anuncia el descuento por llevar varias.', 'porcentaje'],
    ['masTalla', 'Más en tu talla', 'Otras prendas de la misma talla en la ficha.', 'camisa'],
    ['calculadoraEnvio', 'Calculadora de envío', '"¿Cuánto cuesta el envío a tu casa?" en cada prenda.', 'camion'],
    ['misPedidos', 'Mis pedidos', 'Botón con los recibos del cliente.', 'recibo'],
    ['usd', 'Precios en dólares', 'Selector MXN / USD.', 'dinero', c => c.moneda?.usd !== false, (c, v) => ({ moneda: { ...c.moneda, usd: v } })],
  ]],
  ['Pago y entrega', [
    ['pagoEnLinea', 'Pago en línea', 'Botón "Pagar en línea" con Clip.', 'tarjeta', c => !!c.pagoEnLinea, (c, v) => ({ pagoEnLinea: v })],
    ['paypal', 'PayPal', 'Ofrecer PayPal además de Clip (si está conectado).', 'tarjeta', c => c.paypal !== false, (c, v) => ({ paypal: v })],
    ['cupones', 'Cupones', 'Campo de cupón en el carrito y al pagar.', 'oferta'],
    ['sugerencias', 'Sugerencias de su talla', 'Al pagar, prendas para llegar al siguiente descuento.', 'chispas'],
    ['apartado', 'Apartar con anticipo', 'El cliente paga una parte para apartar y el resto después.', 'reloj'],
    ['puntosEntrega', 'Puntos de entrega', 'Elegir Zona Centro, UTTN, Plaza Real… al pagar.', 'ubicacion'],
    ['envia', 'Envíos con envia.com', 'Cotizar el envío real por código postal.', 'camion', c => c.envia?.activo !== false, (c, v) => ({ envia: { ...c.envia, activo: v } })],
  ]],
  ['Después de vender', [
    ['recuperarPagos', 'Recuperar pagos sin terminar', 'Aviso en Pendientes con el WhatsApp listo.', 'carrito'],
    ['resenas', 'Reseñas', 'Pedir reseña al cliente cuando ya recibió su pedido.', 'estrella'],
  ]],
  // v42/v43: todo lo nuevo se prende y apaga aquí
  ['Para vender más', [
    ['spei', 'Transferencia SPEI', 'Pago a tu CLABE (se configura en Promociones y pagos).', 'dinero', c => !!c.spei?.activo, (c, v) => ({ spei: { ...c.spei, activo: v } })],
    ['speiIA', 'Revisar comprobantes solo', 'La IA lee el comprobante y se pregunta a Banxico si el dinero llegó.', 'chispas'],
    ['speiAuto', 'Aprobar sola si Banxico confirma', 'Si Banxico confirma monto y cuenta, el pedido queda pagado sin que toques nada.', 'check'],
    ['frecuente', 'Cliente frecuente', 'Cada N compras, la siguiente con descuento (ajústalo en Promociones y pagos).', 'estrella', c => !!c.frecuente?.activo, (c, v) => ({ frecuente: { ...c.frecuente, activo: v } })],
    ['carritosWA', 'Carritos olvidados por WhatsApp', 'Cada día, en Pendientes, el mensaje listo para quien dejó prendas en su carrito.', 'carrito'],
    ['dropPagina', 'Página del drop', 'Página con cuenta regresiva y "Avísame" para compartir en historias.', 'fuego'],
    ['outfit', 'Arma tu outfit', '"Completa el outfit" en cada prenda y % extra al combinar tipos.', 'camisa'],
    ['referidos', 'Invita a tus amigos', 'Cada cliente tiene su código: el amigo tiene descuento y quien invita gana un cupón.', 'regalo'],
  ]],
  ['Para trabajar menos', [
    ['resumenSemanal', 'Resumen de cada lunes', 'Ventas, de dónde vinieron y qué conviene rebajar, a tu Telegram o correo.', 'recibo'],
    ['cajaTicketWA', 'Ticket de la Caja con extras', 'El ticket por WhatsApp lleva su avance de cliente frecuente, su código y el link a la tienda.', 'qr'],
    ['enviosPanel', 'Envíos desde el panel', 'Cancelar guías y pedir que la paquetería pase a recoger.', 'camion'],
  ]],
  ['Para que te encuentren', [
    ['paginasMarca', 'Páginas por marca y categoría', '/marca/nike, /categoria/sudaderas… para Google.', 'buscar'],
    ['paginasTalla', 'Páginas por talla y precio', '/talla/m, /precio/menos-de-500…', 'regla'],
    ['guias', 'Guías', 'Artículos (originales, tallas, cuidado) que traen gente desde Google.', 'recibo'],
    ['feedGoogle', 'Catálogo para Google Shopping', 'Link para Google Merchant Center: tus prendas en la pestaña de compras, gratis.', 'buscar'],
    ['googleMaps', 'Google Maps', 'Tu perfil de Google en el inicio y "Déjanos tu reseña en Google" al entregar.', 'ubicacion'],
    ['origenVentas', 'Medir de dónde vienen las ventas', 'Cuenta visitas y ventas por Instagram, TikTok, Google, QR…', 'ojo'],
  ]],
  ['Para dar más confianza', [
    ['selloRevisada', 'Sello "Revisada a mano" y medidas', 'Sello y medidas en cm en la ficha (se llenan al editar cada prenda).', 'check'],
  ]],
];
const vnModOn = (c, m) => m[4] ? m[4](c) : c.modulos?.[m[0]] !== false;
function vnModulos() {
  const c = VN.datos.config;
  return `${vnCab('Módulos', 'Prende o apaga cada función. Lo que apagues deja de verse en la tienda al momento; tus datos no se borran.')}
    ${VN_MODULOS.map(([titulo, lista]) => `<div class="vn-card"><h3>${titulo}</h3>
      <ul class="vn-mods">${lista.map(m => `<li>
        <span class="vn-mod-ic">${ico(m[3], 18)}</span>
        <label class="vn-mod-tx" for="vnMod_${m[0]}"><b>${m[1]}</b><small>${m[2]}</small></label>
        <span class="vn-switch"><input type="checkbox" role="switch" id="vnMod_${m[0]}" data-mod="${m[0]}" ${vnModOn(c, m) ? 'checked' : ''} onchange="vnModCambio(this)"><span aria-hidden="true"></span></span>
      </li>`).join('')}</ul></div>`).join('')}`;
}
async function vnModCambio(input) {
  const c = VN.datos.config;
  const m = VN_MODULOS.flatMap(g => g[1]).find(x => x[0] === input.dataset.mod); if (!m) return;
  // _t: dos cambios iguales seguidos (prender/apagar/prender) no cuentan como envío repetido
  const cuerpo = { ...(m[5] ? m[5](c, input.checked) : { modulos: { ...(c.modulos || {}), [m[0]]: input.checked } }), _t: Date.now() };
  input.disabled = true;
  try {
    const r = await vnApi('v-config', cuerpo);
    VN.datos.config = r.config;
    // v43: si el servidor no lo dejó prender (p. ej. SPEI sin CLABE válida), se dice por qué
    if (input.checked && !vnModOn(r.config, m)) { input.checked = false; toast(m[0] === 'spei' ? 'Primero pon tu CLABE en Promociones y pagos → Transferencia SPEI' : `${m[1]}: no se pudo prender`, { tipo: 'error' }); }
    else toast(`${m[1]}: ${input.checked ? 'prendido' : 'apagado'}`);
  } catch (e) { input.checked = !input.checked; toast(e.message); }
  input.disabled = false;
}

// ── Envíos con envia.com (configuración y prueba) ─────────────
function vnEnvia(c) {
  const e = c.envia || { origen: {} }, o = e.origen || {}, st = VN.datos.envia || {};
  const estado = !st.token ? `<div class="vn-aviso">Falta conectar tu cuenta. En envia.com → <b>Desarrolladores → API Keys</b> crea una clave y ponla en Vercel como <code>ENVIA_TOKEN</code>; luego Redeploy. La clave nunca se escribe aquí.</div>`
    : st.listo ? `<div class="vn-aviso verde">${ico('check', 15)} Cotizando con envia.com${st.prueba ? ' (modo de prueba: ENVIA_SANDBOX)' : ''}. Los clientes ven el precio real según su código postal.</div>`
    : `<div class="vn-aviso">Token conectado${st.prueba ? ' (modo de prueba)' : ''}. Falta la dirección de salida de los paquetes.</div>`;
  const f = (id, label, val, extra = '') => `<label class="vn-campo"><span>${label}</span><input class="vn-input" id="${id}" value="${vnEsc(val || '')}" ${extra}></label>`;
  return `${estado}
    <label class="vn-check"><input type="checkbox" id="vnEnvAct" ${e.activo !== false ? 'checked' : ''}> Cotizar el envío en la página de pago y en cada prenda</label>
    <p class="vn-nota">Dirección desde donde salen los paquetes (la ven las paqueterías, no los clientes):</p>
    <div class="vn-grid2 vn-grid3">
      ${f('vnEnvNom', 'Nombre', o.nombre, 'maxlength="60" placeholder="Stiimpys"')}
      ${f('vnEnvTel', 'Teléfono', o.telefono, 'maxlength="14" inputmode="tel"')}
      ${f('vnEnvCalle', 'Calle', o.calle, 'maxlength="80"')}
      ${f('vnEnvNum', 'Número', o.numero, 'maxlength="20"')}
      ${f('vnEnvCol', 'Colonia', o.colonia, 'maxlength="80"')}
      ${f('vnEnvCp', 'Código postal', o.cp, 'maxlength="5" inputmode="numeric"')}
    </div>
    <div class="vn-fila"><span>Sumar al costo de la paquetería</span>
      <input class="vn-input chico" type="number" min="0" max="100" id="vnEnvPct" value="${e.margenPct || 0}"><span>% y</span>
      <input class="vn-input chico" type="number" min="0" max="500" id="vnEnvFijo" value="${e.margenFijo || 0}"><span>pesos (caja, traslado)</span></div>
    <div class="vn-fila"><span>Envío gratis (la opción más barata) desde</span>
      <input class="vn-input chico" type="number" min="0" step="50" id="vnEnvGratis" value="${e.gratisDesde || 0}"><span>pesos <span class="vn-gris">(0 = nunca)</span></span></div>
    <div class="vn-fila"><span>Paqueterías</span><input class="vn-input ancho" id="vnEnvPaqs" value="${vnEsc((e.paqueterias || []).join(', '))}" placeholder="Automático (las de tu cuenta). Ej: dhl, fedex, estafeta"></div>
    <p class="vn-nota">El peso y la caja se calculan por tipo de prenda (playera 300 g, sudadera 700 g, chamarra 1.1 kg, tenis 1.3 kg en caja…). Se cotiza con varias paqueterías y al cliente se le muestran la más barata, la más rápida y otra opción.</p>
    ${st.listo ? `<div class="vn-fila"><span>Probar:</span><input class="vn-input chico" id="vnEnvPruebaCp" maxlength="5" inputmode="numeric" placeholder="CP" style="width:90px">
      <select class="vn-input" id="vnEnvPruebaTipo"><option>Playera</option><option>Sudadera</option><option>Chamarra</option><option>Tenis</option></select>
      <button class="vn-btn" onclick="vnEnvPrueba()">Cotizar</button></div><div id="vnEnvPruebaRes"></div>` : ''}`;
}
function vnLeerEnvia(c) {
  const v = id => document.getElementById(id)?.value.trim() || '';
  if (!document.getElementById('vnEnvCp')) return c.envia;
  return { activo: document.getElementById('vnEnvAct').checked,
    origen: { nombre: v('vnEnvNom'), telefono: v('vnEnvTel'), calle: v('vnEnvCalle'), numero: v('vnEnvNum'), colonia: v('vnEnvCol'), cp: v('vnEnvCp'), referencia: c.envia?.origen?.referencia || '' },
    margenPct: Number(v('vnEnvPct')) || 0, margenFijo: Number(v('vnEnvFijo')) || 0, gratisDesde: Number(v('vnEnvGratis')) || 0,
    paqueterias: v('vnEnvPaqs').split(/[,\s]+/).filter(Boolean) };
}
async function vnEnvPrueba() {
  const caja = document.getElementById('vnEnvPruebaRes');
  caja.innerHTML = '<div class="vn-cargando"><span class="vn-spin"></span>Cotizando con las paqueterías…</div>';
  try {
    const r = await vnApi('v-envio-prueba', { cp: document.getElementById('vnEnvPruebaCp').value, tipo: document.getElementById('vnEnvPruebaTipo').value });
    caja.innerHTML = `<p class="vn-nota">A ${vnEsc(r.ciudad)}, ${vnEsc(r.estado)} · caja ${r.paquete.dimensions.length}×${r.paquete.dimensions.width}×${r.paquete.dimensions.height} cm, ${r.paquete.weight} kg</p>
      <table class="vn-tabla"><tr><th>Paquetería</th><th>Llega en</th><th>Te cuesta</th><th>Ve el cliente</th></tr>
      ${r.opciones.map(o => `<tr><td>${vnEsc(o.paqueteria)} ${vnEsc(o.servicio)}</td><td>${vnEsc(o.dias || '—')}</td><td>${vnPesos(o.costo)}</td><td>${o.gratis ? 'Gratis' : vnPesos(o.precio)}</td></tr>`).join('')}</table>`;
  } catch (e) { caja.innerHTML = `<div class="vn-aviso rojo">${vnEsc(e.message)}</div>`; }
}

// v41 · Guía con envia.com: se cobra del saldo de envia.com, así que se confirma antes
const vnEsAdmin = () => (typeof isAdmin === 'function' ? isAdmin() : true);
// v42 · Rastreo automático: corre solo una vez al día; este botón lo hace ya
async function vnRastreo(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Revisando guías…'; }
  try {
    const r = await vnApi('v-rastreo-revisar', {});
    toast(r.hechos.length ? `Rastreo: ${r.hechos.length} cambio(s)` : 'Rastreo al día: sin cambios', { tipo: 'ok', origen: 'pedidos', cuerpo: r.hechos.join(' · ') });
    VN.pedidos = null; vnPintar(); vnCargarPedidos();
  } catch (e) { toast(e.message, { tipo: 'error', origen: 'pedidos' }); if (btn) { btn.disabled = false; btn.textContent = 'Revisar rastreo'; } }
}

// v43 · Revisar el comprobante con IA + Banxico
async function vnSpeiVerificar(id, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Revisando… (hasta 30 s)'; }
  try {
    const r = await vnApi('v-spei-verificar', { id });
    toast(r.aprobado ? 'Banxico confirmó: pedido pagado' : r.revision.texto, { tipo: r.revision.nivel === 'verde' ? 'ok' : r.revision.nivel === 'rojo' ? 'error' : 'info', origen: 'pedidos' });
    VN.pedidos = null; vnPintar(); vnCargarPedidos();
  } catch (e) { toast(e.message, { tipo: 'error' }); if (btn) { btn.disabled = false; btn.textContent = 'Revisar con IA y Banxico'; } }
}
// v43 · Cancelar una guía de envia.com
async function vnCancelarGuia(id, btn) {
  const p = VN.pedidos.find(x => x.id === id); if (!p) return;
  if (!confirm(`¿Cancelar la guía ${p.guiaEnvia?.guia} de ${p.nombre}?\n\nenvia.com te regresa el saldo si la paquetería todavía no la usó. El pedido vuelve a "Por enviar".`)) return;
  if (btn) btn.disabled = true;
  try { const r = await vnApi('v-envio-cancelar', { id }); toast(r.saldoDevuelto ? 'Guía cancelada y saldo devuelto' : 'Guía cancelada', { tipo: 'ok', origen: 'pedidos' }); VN.pedidos = null; vnPintar(); vnCargarPedidos(); }
  catch (e) { toast(e.message, { tipo: 'error' }); if (btn) btn.disabled = false; }
}
// v43 · Pedir recolección (todas las guías de esa paquetería que esperan)
function vnRecoleccionHtml() {
  if (VN.datos?.config?.modulos?.enviosPanel !== true || !vnEsAdmin()) return '';
  const conGuia = (VN.pedidos || []).filter(p => p.estado === 'pagado' && p.entregaEstado !== 'entregado' && p.guiaEnvia?.guia && !p.recoleccion);
  const carriers = [...new Set(conGuia.map(p => String(p.guiaEnvia.carrier || p.guiaEnvia.paqueteria || '').toLowerCase()).filter(Boolean))];
  if (!carriers.length) return '';
  const hoy = new Date(Date.now() - 6 * 36e5).toISOString().slice(0, 10);
  return `<div class="vn-card vn-recoleccion"><h3>${ico('camion', 16)} Pedir recolección</h3>
    <p class="vn-nota">${conGuia.length} paquete(s) con guía esperando. La paquetería pasa por ellos a tu dirección de salida.</p>
    <div class="vn-fila"><select class="vn-input" id="vnRecCarrier">${carriers.map(c => `<option value="${vnEsc(c)}">${vnEsc(c)} (${conGuia.filter(p => String(p.guiaEnvia.carrier || p.guiaEnvia.paqueteria || '').toLowerCase() === c).length})</option>`).join('')}</select>
      <input class="vn-input" type="date" id="vnRecFecha" min="${hoy}" value="${hoy}">
      <span>de</span><input class="vn-input chico" type="number" id="vnRecDesde" min="7" max="19" value="10"><span>a</span><input class="vn-input chico" type="number" id="vnRecHasta" min="9" max="21" value="18"><span>h</span>
      <button class="vn-btn negro" onclick="vnPedirRecoleccion(this)">Pedir recolección</button></div></div>`;
}
async function vnPedirRecoleccion(btn) {
  const v = id => document.getElementById(id)?.value;
  btn.disabled = true;
  try { const r = await vnApi('v-envio-recoleccion', { carrier: v('vnRecCarrier'), fecha: v('vnRecFecha'), desde: Number(v('vnRecDesde')), hasta: Number(v('vnRecHasta')) });
    toast(`Recolección agendada${r.numero ? ' · ' + r.numero : ''} (${r.paquetes} paquete(s))`, { tipo: 'ok', origen: 'pedidos' }); VN.pedidos = null; vnPintar(); vnCargarPedidos(); }
  catch (e) { toast(e.message, { tipo: 'error' }); btn.disabled = false; }
}
// v43 · Resumen semanal: verlo y mandarlo
async function vnResumen(mandar, btn) {
  if (btn) btn.disabled = true;
  try {
    const r = await vnApi('v-resumen', mandar ? { mandar: true } : {});
    if (mandar) toast(r.texto || 'Listo', { tipo: r.enviado ? 'ok' : 'info' });
    else { VN.resumen = r.resumen; vnPintar(); }
  } catch (e) { toast(e.message, { tipo: 'error' }); }
  if (btn) btn.disabled = false;
}

// v42 · Reseñas con foto: la dueña decide qué se publica
async function vnModerar(id, accion, pendId, btn) {
  if (accion === 'ocultar' && !confirm('¿Ocultar esta reseña de la tienda? Puedes volver a mostrarla después.')) return;
  if (btn) btn.disabled = true;
  try {
    await vnApi('v-resena-moderar', { id, accion });
    toast(accion === 'aprobar' ? 'Reseña publicada con sus fotos' : accion === 'sinfotos' ? 'Reseña publicada sin fotos' : 'Reseña oculta', { tipo: 'ok', origen: 'general' });
    const l = VN.datos.pendientes, i = l.findIndex(x => x.id === pendId); if (i >= 0) l.splice(i, 1);
    vnPintar(); vnGlobo();
  } catch (e) { toast(e.message, { tipo: 'error' }); if (btn) btn.disabled = false; }
}

// v42 · Transferencia SPEI: la dueña confirma que el dinero llegó a su cuenta (o lo rechaza)
async function vnSpei(id, aprobar, btn) {
  const p = VN.pedidos.find(x => x.id === id); if (!p) return;
  let motivo = '';
  if (aprobar) { if (!confirm(`¿Ya ves ${vnPesos(p.modalidad === 'apartado' ? p.anticipo : p.total)} de ${p.nombre} en tu cuenta de banco?\n\nRevisa tu app del banco antes: al confirmar, el pedido queda pagado.`)) return; }
  else { motivo = prompt('¿Qué le decimos al cliente? (se suelta la prenda)', 'No encontramos la transferencia'); if (motivo == null) return; }
  if (btn) btn.disabled = true;
  try {
    const r = await vnApi('v-spei-revisar', { id, aprobar, motivo });
    p.estado = r.estado; if (r.whatsapp) VN.waPed[id] = r.whatsapp;
    toast(aprobar ? 'Transferencia confirmada: pedido pagado' : 'Pedido cancelado y prenda liberada', { tipo: 'ok', origen: 'pedidos',
      acciones: r.whatsapp ? [{ texto: 'Avisar por WhatsApp', al: () => window.open(r.whatsapp, '_blank', 'noopener'), principal: true }] : [] });
    VN.pedidos = null; vnPintar(); vnCargarPedidos();
  } catch (e) { toast(e.message, { tipo: 'error', origen: 'pedidos' }); if (btn) btn.disabled = false; }
}

async function vnGuia(id, btn) {
  const p = VN.pedidos.find(x => x.id === id); if (!p) return;
  const otra = !!p.guiaEnvia;
  const det = p.envioDetalle ? `${p.envioDetalle.paqueteria} ${p.envioDetalle.servicio || ''}`.trim() : 'la paquetería que eligió el cliente';
  if (!confirm(`${otra ? '¿Generar OTRA guía' : '¿Generar la guía'} de ${p.nombre} con ${det}?\n\nenvia.com la cobra de tu saldo.${otra ? '\nLa guía anterior no se cancela sola: cancélala en envia.com si ya no la usarás.' : ''}`)) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Generando guía…'; }
  try {
    const r = await vnApi('v-envio-guia', { id, otra });
    Object.assign(p, { guiaEnvia: r.guiaEnvia, entregaEstado: r.entregaEstado, paqueteria: r.paqueteria, guia: r.guia });
    if (r.whatsapp) VN.waPed[id] = r.whatsapp;
    toast('Guía generada', { tipo: 'ok', origen: 'pedidos', cuerpo: `${r.paqueteria} ${r.guia}${r.guiaEnvia?.prueba ? ' (modo prueba)' : ''}`,
      acciones: r.guiaEnvia?.etiqueta ? [{ texto: 'Abrir etiqueta', al: () => window.open(r.guiaEnvia.etiqueta, '_blank', 'noopener'), principal: true }] : [] });
    vnPintar(); vnGlobo();
  } catch (e) {
    toast(e.message, { tipo: 'error', origen: 'pedidos', titulo: 'No se generó la guía', cuerpo: e.message || '' });
    if (btn) { btn.disabled = false; btn.textContent = otra ? 'Generar otra guía' : 'Generar guía con envia.com'; }
  }
}

async function vnPedEstado(id, accion) {
  const body = { id, accion };
  if (accion === 'enviado') { body.paqueteria = document.getElementById('vnPaq-' + id)?.value.trim(); body.guia = document.getElementById('vnGuia-' + id)?.value.trim(); }
  try {
    const r = await vnApi('v-pedido-estado', body);
    const p = VN.pedidos.find(x => x.id === id);
    Object.assign(p, { entregaEstado: r.entregaEstado, paqueteria: r.paqueteria ?? p.paqueteria, guia: r.guia ?? p.guia });
    if (r.whatsapp) VN.waPed[id] = r.whatsapp; else delete VN.waPed[id];
    if (VN.datos) VN.datos.porEntregar = VN.pedidos.filter(x => x.estado === 'pagado' && x.entregaEstado !== 'entregado').length;
    const nombre = p?.nombre || '';
    if (accion === 'deshacer') toast('Cambio deshecho', { tipo: 'info', origen: 'pedidos', cuerpo: nombre, historial: false });
    else toast(accion === 'enviado' ? 'Pedido marcado como enviado' : 'Pedido marcado como entregado', { tipo: 'ok', origen: 'pedidos',
      cuerpo: [nombre, accion === 'enviado' && r.guia ? `${r.paqueteria || ''} ${r.guia}`.trim() : ''].filter(Boolean).join(' · '),
      deshacer: () => vnPedEstado(id, 'deshacer') });
    vnPintar(); vnGlobo();
  } catch (e) {
    toast(e.message, { tipo: 'error', origen: 'pedidos', titulo: 'No se pudo actualizar el pedido', cuerpo: e.message || '', reintentar: () => vnPedEstado(id, accion) });
  }
}
// Apartado con anticipo: cobrar el resto en persona, dar más días o liberar las prendas
async function vnApartado(id, accion) {
  const p = VN.pedidos.find(x => x.id === id); if (!p) return;
  const primero = String(p.nombre || '').split(' ')[0];
  if (accion === 'liquidar' && typeof uiConfirm === 'function' && !(await uiConfirm({ titulo: `¿${primero} te pagó el resto?`, ok: `Sí, cobré ${vnPesos(p.resta)}`,
    mensaje: `Se marca pagado completo (${vnPesos(p.total)}) y las prendas quedan vendidas.${p.restoEnLinea ? ' Antes se revisa que no lo haya pagado ya en línea.' : ''}` }))) return;
  if (accion === 'liberar' && typeof uiConfirm === 'function' && !(await uiConfirm({ titulo: `¿Liberar el apartado de ${primero}?`, ok: 'Liberar prendas', peligro: true,
    mensaje: `Las prendas regresan a la tienda. Su anticipo de ${vnPesos(p.anticipo)} lo resuelves con ${primero} (devolverlo o dejarlo a cuenta).` }))) return;
  try {
    const r = await vnApi('v-pedido-estado', { id, accion, dias: 3 });
    if (r.whatsapp) VN.waPed[id] = r.whatsapp;
    if (accion === 'liquidar') { Object.assign(p, { estado: 'pagado', liquidadoCon: 'persona', pagos: [...(p.pagos || []), { tipo: 'resto', monto: p.resta, proveedor: 'persona', en: new Date().toISOString() }] }); VN.filtroPed = 'entregar'; VN.resaltarPed = id; }
    if (accion === 'extender') p.liquidarAntes = r.liquidarAntes;
    if (accion === 'liberar') p.estado = 'cancelado';
    toast(accion === 'liquidar' ? 'Apartado liquidado' : accion === 'extender' ? 'Le diste 3 días más' : 'Apartado liberado', { tipo: accion === 'liberar' ? 'info' : 'ok', origen: 'pedidos',
      cuerpo: accion === 'liquidar' ? `${p.nombre} · pagó el resto en persona` : accion === 'extender' ? `Ahora liquida antes del ${new Date(r.liquidarAntes).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}` : 'Las prendas volvieron a la tienda' });
    if (VN.datos) VN.datos.apartados = VN.pedidos.filter(x => x.estado === 'apartado').length;
    vnPintar(); vnGlobo();
  } catch (e) {
    if (e.status === 409 || /ya pagó/.test(e.message)) { toast(e.message, { tipo: 'alerta', origen: 'pedidos', titulo: 'Ya estaba pagado en línea', cuerpo: e.message }); vnCargarPedidos(); return; }
    toast(e.message, { tipo: 'error', origen: 'pedidos', titulo: 'No se pudo actualizar el apartado', cuerpo: e.message || '', reintentar: () => vnApartado(id, accion) });
  }
}

// Cada aviso se ve como tarjeta: qué pasó, quién, cuánto y qué hacer.
const VN_PEND = {
  venta: { ic: 'tarjeta', titulo: 'Pago recibido' },
  recuperar: { ic: 'carrito', titulo: 'Pago sin terminar' },
  resena: { ic: 'estrella', titulo: 'Reseña nueva' },
  interesado: { ic: 'campana', titulo: 'Cliente interesado' },
  apartado: { ic: 'reloj', titulo: 'Apartado vencido' },
  spei: { ic: 'dinero', titulo: 'Revisar transferencia' },
  carrito: { ic: 'carrito', titulo: 'Carrito olvidado' },
};
const vnLocal = iso => new Date(new Date(iso).getTime() - 6 * 36e5).toISOString().slice(0, 10);
const vnHora = d => d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
function vnHace(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const min = Math.round((Date.now() - d) / 6e4);
  if (min < 1) return 'Hace un momento';
  if (min < 60) return `Hace ${min} min`;
  if (min < 6 * 60) return `Hace ${Math.round(min / 60)} h`;
  const dia = vnLocal(iso), hoy = vnHoy(), ayer = vnLocal(new Date(Date.now() - 864e5).toISOString());
  if (dia === hoy) return `Hoy, ${vnHora(d)}`;
  if (dia === ayer) return `Ayer, ${vnHora(d)}`;
  return d.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
function vnDiaTitulo(iso) {
  const dia = vnLocal(iso), ayer = vnLocal(new Date(Date.now() - 864e5).toISOString());
  if (dia === vnHoy()) return 'Hoy';
  if (dia === ayer) return 'Ayer';
  const t = new Date(dia + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}
// Avisos viejos (antes de v28) solo traen el texto: se arma la tarjeta con lo que haya.
function vnPendDatos(p) {
  const base = VN_PEND[p.tipo] || { ic: 'bandeja', titulo: 'Aviso' };
  const crudo = String(p.texto || '');
  const urgente = p.urgente || /^⚠/u.test(crudo);
  const estrellas = p.estrellas || (crudo.match(/⭐/gu) || []).length || 0;
  const limpio = sinEmojiInicial(crudo.replace(/⭐/gu, '')).trim();
  return {
    ic: urgente ? 'alerta' : base.ic,
    titulo: p.titulo || (urgente ? 'Devolver dinero' : base.titulo),
    urgente, estrellas,
    cliente: p.cliente || '',
    monto: Number(p.monto) || 0,
    metodo: p.metodo || '',
    detalle: p.titulo ? (p.detalle || '') : limpio,
    entrega: p.entrega || '',
    prendas: Array.isArray(p.prendas) ? p.prendas : [],
  };
}
function vnPendTarjeta(p) {
  const d = vnPendDatos(p);
  const estrellas = d.estrellas ? `<span class="vn-pend-estrellas" aria-label="${d.estrellas} de 5 estrellas">${[1, 2, 3, 4, 5].map(n => ico('estrella', 14, n <= d.estrellas ? 'lleno' : '')).join('')}</span>` : '';
  const filtroDe = ['recuperar', 'spei'].includes(p.tipo) ? 'sinpagar' : p.tipo === 'apartado' || /^Apartado con anticipo|^Revisar apartado/.test(p.titulo || '') ? 'apartados' : 'entregar';
  const verPedido = p.pedido && ['venta', 'recuperar', 'apartado', 'spei'].includes(p.tipo)
    ? `<button class="vn-btn ghost" onclick="vnIrPedido('${vnEsc(p.pedido)}','${filtroDe}')">${ico('recibo', 15)} Ver pedido</button>` : '';
  return `<li class="vn-pend t-${vnEsc(p.tipo)}${d.urgente ? ' urgente' : ''}" id="vnPend-${vnEsc(p.id)}">
    <span class="vn-ic t-${vnEsc(p.tipo)}${d.urgente ? ' t-urgente' : ''}">${ico(d.ic, 18)}</span>
    <div class="vn-pend-cuerpo">
      <div class="vn-pend-arriba">
        <span class="vn-pend-tipo">${vnEsc(d.titulo)}</span>
        <time datetime="${vnEsc(p.en)}" title="${vnEsc(vnFecha(p.en))}">${vnHace(p.en)}</time>
      </div>
      ${d.cliente || d.monto ? `<div class="vn-pend-linea">
        ${d.cliente ? `<b class="vn-pend-quien">${vnEsc(d.cliente)}</b>` : '<span></span>'}
        ${d.monto ? `<span class="vn-pend-monto">${vnPesos(d.monto)}${d.metodo ? `<small>${vnEsc(d.metodo)}</small>` : ''}</span>` : ''}
      </div>` : ''}
      ${estrellas}
      ${d.entrega ? `<p class="vn-pend-entrega">${ico(/^Envío/.test(d.entrega) ? 'camion' : 'ubicacion', 15)} ${vnEsc(d.entrega)}</p>` : ''}
      ${d.detalle ? `<p class="vn-pend-det">${p.tipo === 'resena' && p.titulo ? `“${vnEsc(d.detalle)}”` : vnEsc(d.detalle)}</p>` : ''}
      ${Array.isArray(p.fotos) && p.fotos.length ? `<div class="vn-pend-fotos">${p.fotos.filter(u => /^https:\/\//.test(u)).map(u => `<a href="${vnEsc(u)}" target="_blank" rel="noopener"><img src="${vnEsc(u)}" alt="Foto de la reseña" loading="lazy"></a>`).join('')}</div>
        ${p.resenaId && vnEsAdmin() ? `<div class="vn-pend-acc"><button class="vn-btn negro" onclick="vnModerar(${Number(p.resenaId)},'aprobar','${vnEsc(p.id)}',this)">${ico('check', 15)} Publicar con fotos</button>
          <button class="vn-btn ghost" onclick="vnModerar(${Number(p.resenaId)},'sinfotos','${vnEsc(p.id)}',this)">Publicar sin fotos</button>
          <button class="vn-btn ghost peligro" onclick="vnModerar(${Number(p.resenaId)},'ocultar','${vnEsc(p.id)}',this)">${ico('equis', 15)} Ocultar reseña</button></div>` : ''}` : ''}
      ${d.prendas.length ? `<p class="vn-pend-prendas">${ico('camisa', 14)} ${d.prendas.map(vnEsc).join(' · ')}</p>` : ''}
      ${p.direccion ? `<details class="vn-pend-dir"><summary>${ico('caja', 14)} Dirección de envío</summary><pre>${vnEsc(p.direccion)}</pre></details>` : ''}
      <div class="vn-pend-acc">
        ${p.whatsapp ? `<a class="vn-btn wa" href="${vnEsc(p.whatsapp)}" target="_blank" rel="noopener" onclick="vnHecho('${vnEsc(p.id)}', 'Mensaje abierto en WhatsApp')">${ico('chat', 15)} Avisar por WhatsApp</a>` : ''}
        ${verPedido}
        <button class="vn-btn ghost vn-pend-listo" onclick="vnHecho('${vnEsc(p.id)}')">${ico('check', 15)} Listo</button>
      </div>
    </div>
  </li>`;
}
function vnPendientes() {
  const l = VN.datos.pendientes;
  const urgentes = l.filter(p => vnPendDatos(p).urgente);
  const resto = l.filter(p => !urgentes.includes(p));
  const dias = [];
  for (const p of resto) { const t = vnDiaTitulo(p.en); let g = dias.find(x => x.t === t); if (!g) dias.push(g = { t, l: [] }); g.l.push(p); }
  const grupo = (t, lista, clase = '') => `<section class="vn-pend-grupo ${clase}"><h4>${t}<span>${lista.length}</span></h4><ul class="vn-lista vn-pends">${lista.map(vnPendTarjeta).join('')}</ul></section>`;
  return `${vnCab('Pendientes', 'Lo que necesita tu atención: pagos, clientes esperando una prenda, apartados vencidos y reseñas. Cada aviso trae el WhatsApp listo.', `<button class="vn-btn" onclick="vnCargar()">${ico('recargar', 15)} Revisar</button>`)}
    ${!l.length ? `<div class="vn-vacio vn-vacio-ok">${ico('listo', 26)}<b>Todo al día</b><span>Cuando alguien pague, se interese en una prenda o deje una reseña, aparece aquí.</span></div>`
      : `${urgentes.length ? grupo('Urgente', urgentes, 'urgente') : ''}${dias.map(g => grupo(g.t, g.l)).join('')}`}`;
}
async function vnHecho(id, texto = 'Marcado como hecho') {
  const lista = VN.datos.pendientes, i = lista.findIndex(p => p.id === id); if (i < 0) return;
  const p = lista[i];
  document.getElementById('vnPend-' + id)?.classList.add('saliendo');
  VN.datos.pendientes = lista.filter(x => x.id !== id);
  setTimeout(vnPintar, 260); vnGlobo();
  vnApi('v-pendiente-hecho', { id }).catch(() => {});
  toast(texto, { tipo: 'ok', accion: { texto: 'Deshacer', al: () => vnDeshacerHecho(p, i) } });
}
function vnDeshacerHecho(p, i) {
  if (VN.datos.pendientes.some(x => x.id === p.id)) return;
  VN.datos.pendientes.splice(Math.min(i, VN.datos.pendientes.length), 0, p);
  vnPintar(); vnGlobo();
  vnApi('v-pendiente-hecho', { id: p.id, deshacer: true }).catch(() => toast('No se pudo regresar el aviso', 'error'));
}
function vnIrPedido(id, filtro) {
  VN.filtroPed = filtro; VN.resaltarPed = id; vnIr('pedidos');
  let n = 0; const buscar = () => { const el = document.getElementById('vnPed-' + id); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(() => { VN.resaltarPed = null; el.classList.remove('resaltado'); }, 2600); } else if (n++ < 30) setTimeout(buscar, 120); };
  buscar();
}

// ── Ofertas ──────────────────────────────────────────────────
function vnOfertas() {
  const l = VN.datos.ofertas;
  const nuevas = l.filter(o => o.estado === 'nueva'), viejas = l.filter(o => o.estado !== 'nueva');
  const fila = o => {
    const pct = o.precio ? Math.round((1 - o.monto / o.precio) * 100) : 0;
    const p = getDB().find(x => x.id === o.prendaId);
    const ocupada = p && (p.vendido || p.apartada);
    return `<li class="vn-of ${o.estado}">
      ${o.foto ? `<img src="${vnEsc(imgOptimizada ? imgOptimizada(o.foto, 120) : o.foto)}" alt="">` : '<span class="vn-sinfoto"></span>'}
      <span class="vn-tx"><b>${vnEsc(o.prendaNombre)}</b>
        <span class="vn-of-montos"><s>${vnPesos(o.precio)}</s> → <b>${vnPesos(o.monto)}</b> <em>−${pct}%</em>${o.contra ? ` · contraoferta ${vnPesos(o.contra)}` : ''}</span>
        <small>${vnEsc(o.nombre)} · ${vnEsc(o.telefono)} · ${vnFecha(o.en)}${ocupada ? ' · <b class="rojo">la prenda ya no está libre</b>' : ''}</small></span>
      <span class="vn-acc">${o.estado === 'nueva' ? `
        <button class="vn-btn verde" onclick="vnResponder(${o.id},'aceptar')" ${ocupada ? 'disabled' : ''}>Aceptar</button>
        <button class="vn-btn" onclick="vnResponder(${o.id},'contra', ${Math.round((o.monto + o.precio) / 2 / 10) * 10})">Contraoferta</button>
        <button class="vn-btn ghost" onclick="vnResponder(${o.id},'rechazar')">Rechazar</button>` : `<span class="vn-estado">${o.estado}</span>`}</span>
    </li>`;
  };
  return `${vnCab('Ofertas', 'Lo que la gente ofrece desde la tienda. Al aceptar, la prenda se aparta 24 h y se abre WhatsApp con el mensaje listo.')}
    ${!nuevas.length ? '<div class="vn-vacio">No hay ofertas nuevas.</div>' : `<ul class="vn-lista">${nuevas.map(fila).join('')}</ul>`}
    ${viejas.length ? `<details class="vn-hist"><summary>Historial (${viejas.length})</summary><ul class="vn-lista">${viejas.slice(0, 40).map(fila).join('')}</ul></details>` : ''}`;
}
async function vnResponder(id, accion, sugerido) {
  let monto;
  if (accion === 'contra') {
    const v = prompt('¿En cuánto se la dejas? (MXN)', sugerido || ''); if (!v) return;
    monto = Number(String(v).replace(/[^\d.]/g, '')); if (!(monto > 0)) return toast('Monto inválido');
  }
  try {
    const r = await vnApi('v-oferta-responder', { id, accion, monto });
    const o = VN.datos.ofertas.find(x => x.id === id); if (o) { o.estado = r.estado; if (monto) o.contra = monto; }
    if (accion === 'aceptar') { const p = getDB().find(x => x.id === o?.prendaId); if (p) p.apartada = true; }
    if (r.whatsapp) window.open(r.whatsapp, '_blank', 'noopener');
    vnPintar(); vnGlobo();
  } catch (e) { toast(e.message); }
}

// ── Interesados ──────────────────────────────────────────────
function vnInteresados() {
  const l = VN.datos.espera;
  const que = e => e.tipo === 'prenda' ? `Espera "${vnEsc(e.prendaNombre)}"` : e.tipo === 'drop' ? `Drop "${vnEsc(e.dropNombre)}"` : `Busca ${vnEsc([e.categoria, e.marca, e.talla && 'talla ' + e.talla].filter(Boolean).join(' '))}`;
  return `${vnCab('Interesados', 'Gente que pidió que le avises. Cuando llega o se libera lo que buscan, aparece en Pendientes con el mensaje listo.')}
    ${!l.length ? '<div class="vn-vacio">Todavía nadie se ha apuntado. En la tienda aparece "Avísame" en prendas apartadas, vendidas, drops y en "Mi talla".</div>' : `
    <ul class="vn-lista">${l.map(e => `<li><span class="vn-ic">${ico(e.tipo === 'drop' ? 'fuego' : e.tipo === 'prenda' ? 'camisa' : 'buscar', 18)}</span>
      <span class="vn-tx"><b>${vnEsc(e.nombre)}</b> · ${que(e)}<small>${vnEsc(e.telefono)} · ${vnFecha(e.en)}</small></span>
      <span class="vn-acc"><a class="vn-btn wa" href="https://wa.me/${e.telefono.length === 10 ? '52' + e.telefono : e.telefono}" target="_blank" rel="noopener">WhatsApp</a>
        <button class="vn-btn ghost" onclick="vnBorrarEspera('${e.id}')" aria-label="Quitar">${ico('equis', 15)}</button></span></li>`).join('')}</ul>`}`;
}
async function vnBorrarEspera(id) {
  VN.datos.espera = VN.datos.espera.filter(x => x.id !== id); vnPintar();
  vnApi('v-espera-borrar', { id }).catch(() => {});
}

// ── Corte de caja ────────────────────────────────────────────
async function vnCargarCorte(dia) {
  VN.corte = { cargando: true, dia: dia || VN.corte?.dia || vnHoy() }; vnPintar();
  try { VN.corte = await vnApi('v-corte', null, `&dia=${VN.corte.dia}`); } catch (e) { VN.corte = { error: e.message, dia }; }
  vnPintar();
}
const VN_CANAL = { clip: 'Clip', paypal: 'PayPal', mercadopago: 'Mercado Pago', efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta: 'Tarjeta', persona: 'En persona', otro: 'Otro' };
function vnCorte() {
  const c = VN.corte;
  const cab = vnCab('Corte de caja', 'Lo que se vendió en el día, lo apartado y lo que entró.', `<input type="date" class="vn-input" value="${vnEsc(c?.dia || vnHoy())}" onchange="vnCargarCorte(this.value)">`);
  if (!c || c.cargando) return cab + '<div class="vn-cargando"><span class="vn-spin"></span>Sumando…</div>';
  if (c.error) return cab + `<div class="vn-aviso rojo">${vnEsc(c.error)}</div>`;
  // v41: la ganancia solo llega (y se muestra) a un administrador
  const conGan = c.ganancia != null;
  const texto = `🧾 Corte ${c.dia}\nVendidas: ${c.ventas.length}\nTotal: ${vnPesos(c.total)}\n${conGan ? `Ganancia: ${vnPesos(c.ganancia)}\n` : ''}${Object.entries(c.porCanal).map(([k, v]) => `${k}: ${vnPesos(v)}`).join('\n')}\nApartadas: ${c.apartadas.length} · Nuevas: ${c.nuevas} · Ofertas: ${c.ofertas}`;
  return `${cab}
    <div class="vn-kpis" style="--n:${conGan ? 6 : 5}">
      <div><b>${c.ventas.length}</b><span>vendidas</span></div>
      <div><b>${vnPesos(c.total)}</b><span>total</span></div>
      ${conGan ? `<div><b>${vnPesos(c.ganancia)}</b><span>ganancia</span></div>` : ''}
      <div><b>${c.apartadas.length}</b><span>apartadas</span></div>
      <div><b>${c.nuevas}</b><span>prendas nuevas</span></div>
      <div><b>${c.ofertas}</b><span>ofertas</span></div>
    </div>
    ${Object.keys(c.porCanal).length ? `<div class="vn-canales">${Object.entries(c.porCanal).map(([k, v]) => `<span>${vnEsc(VN_CANAL[k] || k.charAt(0).toUpperCase() + k.slice(1))}<b>${vnPesos(v)}</b></span>`).join('')}</div>` : ''}
    <div class="vn-card"><h3>Ventas</h3>${c.ventas.length ? `<table class="vn-tabla"><thead><tr><th>Prenda</th><th class="num">Precio</th>${conGan ? '<th class="num">Ganancia</th>' : ''}<th>Cliente</th><th>Quién</th></tr></thead><tbody>
      ${c.ventas.map(v => `<tr><td>${vnEsc(v.nombre)}</td><td class="num">${vnPesos(v.precio)}</td>${conGan ? `<td class="num">${vnPesos(v.precio - v.costo)}</td>` : ''}<td>${vnEsc(v.comprador || '—')}</td><td>${vnEsc(v.canal === 'clip' ? 'Pago en línea (Clip)' : v.canal === 'paypal' ? 'Pago en línea (PayPal)' : v.canal === 'mercadopago' ? 'Pago en línea (MP)' : v.vendedor || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="vn-nota">Sin ventas este día.</p>'}</div>
    ${(c.anticipos || []).length ? `<div class="vn-card"><h3>Anticipos de apartados</h3><p class="vn-nota">Dinero que entró hoy por apartados. La venta cuenta completa el día que se liquida.</p>
      <table class="vn-tabla"><thead><tr><th>Cliente</th><th>Método</th><th class="num">Anticipo</th><th class="num">Falta</th></tr></thead><tbody>
      ${c.anticipos.map(a => `<tr><td>${vnEsc(a.nombre)}</td><td>${vnEsc(VN_CANAL[a.proveedor] || a.proveedor)}</td><td class="num">${vnPesos(a.monto)}</td><td class="num">${a.resta ? vnPesos(a.resta) : '—'}</td></tr>`).join('')}
      <tr class="vn-total"><td colspan="2">Total</td><td class="num">${vnPesos(c.anticipos.reduce((t, a) => t + a.monto, 0))}</td><td></td></tr></tbody></table></div>` : ''}
    ${c.apartadas.length ? `<div class="vn-card"><h3>Apartadas ahora</h3><ul class="vn-mini">${c.apartadas.map(a => `<li>${vnEsc(a.nombre)} · ${vnEsc(a.quien)} · hasta ${vnFecha(a.hasta)}</li>`).join('')}</ul></div>` : ''}
    <div class="vn-fila"><a class="vn-btn wa" href="https://wa.me/?text=${encodeURIComponent(texto)}" target="_blank" rel="noopener">${ico('chat', 15)} Mandarme el corte por WhatsApp</a>
      <button class="vn-btn" onclick="window.print()">${ico('recibo', 15)} Imprimir</button></div>`;
}

// ── Métricas ─────────────────────────────────────────────────
async function vnCargarMetricas() {
  VN.metricas = { cargando: true }; vnPintar();
  try { VN.metricas = await vnApi('v-metricas'); } catch (e) { VN.metricas = { error: e.message }; }
  vnPintar();
}
function vnMetricas() {
  const m = VN.metricas;
  const cab = vnCab('Qué se ve y qué se vende', 'Últimos 30 días en la tienda: visitas, clics a WhatsApp, agregadas al carrito y ofertas. Sin datos personales.', `<button class="vn-btn" onclick="vnCargarMetricas()">${ico('recargar', 15)} Actualizar</button>`);
  if (!m || m.cargando) return cab + '<div class="vn-cargando"><span class="vn-spin"></span>Calculando…</div>';
  if (m.error) return cab + `<div class="vn-aviso rojo">${vnEsc(m.error)}</div>`;
  const nombre = id => vnEsc(getDB().find(p => p.id === id)?.nombre || '#' + id);
  return `${cab}
    <div class="vn-kpis" style="--n:5">
      <div><b>${m.totales.vista}</b><span>visitas</span></div><div><b>${m.totales.wa}</b><span>clics a WhatsApp</span></div>
      <div><b>${m.totales.bolsa}</b><span>al carrito</span></div><div><b>${m.totales.oferta}</b><span>ofertas</span></div>
      <div><b>${m.diasPromedio ?? '—'}</b><span>días en venderse</span></div>
    </div>
    ${vnOrigenes(m.origenes || [])}
    ${vnEsAdmin() ? `<div class="vn-card vn-resumen"><h3>Resumen de la semana</h3>
      ${VN.resumen ? `<pre class="vn-resumen-txt">${vnEsc(VN.resumen.texto)}</pre>` : '<p class="vn-nota">Lo que te llega cada lunes si prendes "Resumen de cada lunes" en Módulos.</p>'}
      <div class="vn-fila"><button class="vn-btn" onclick="vnResumen(false,this)">${ico('recibo', 15)} Ver resumen ahora</button>
      <button class="vn-btn ghost" onclick="vnResumen(true,this)">Mandármelo al celular</button></div></div>` : ''}
    ${m.ideas.map(i => `<div class="vn-idea">${ico('foco', 17)}<span>${vnEsc(i.texto)}${i.ids?.length ? `<small>${i.ids.map(nombre).join(' · ')}</small>` : ''}</span></div>`).join('')}
    <div class="vn-card"><table class="vn-tabla"><thead><tr><th></th><th>Prenda</th><th class="num">Visitas</th><th class="num">WhatsApp</th><th class="num">Carrito</th><th class="num">Ofertas</th><th class="num">Días</th></tr></thead><tbody>
      ${m.filas.slice(0, 60).map(f => `<tr class="${f.vendido ? 'vendida' : ''}"><td>${f.foto ? `<img src="${vnEsc(imgOptimizada ? imgOptimizada(f.foto, 80) : f.foto)}" alt="">` : ''}</td>
        <td>${vnEsc(f.nombre)}${f.vendido ? ' <em>vendida</em>' : ''}</td><td class="num">${f.vista}</td><td class="num">${f.wa}</td><td class="num">${f.bolsa}</td><td class="num">${f.oferta}</td><td class="num">${f.dias ?? '—'}</td></tr>`).join('')}
    </tbody></table></div>`;
}

// v42 · De dónde vienen tus ventas (30 días) + links listos para compartir con su etiqueta
const VN_FUENTE = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', whatsapp: 'WhatsApp', google: 'Google', marketplace: 'Marketplace',
  qr: 'QR de etiquetas', correo: 'Correos', 'otra web': 'Otras páginas', directo: 'Directo (escribieron la dirección)', 'bazar en persona': 'Bazar en persona (Caja)', 'panel (WhatsApp/DM)': 'Registradas en el panel' };
function vnOrigenes(lista) {
  const total = lista.reduce((t, x) => t + x.dinero, 0) || 1;
  const base = location.origin + '/';
  const links = [['instagram', 'bio', 'Bio de Instagram'], ['instagram', 'historia', 'Historias'], ['tiktok', 'bio', 'TikTok'], ['facebook', 'post', 'Facebook'], ['whatsapp', 'estado', 'Estados de WhatsApp']];
  return `<div class="vn-card vn-origenes"><h3>De dónde vienen tus ventas <small class="vn-gris">últimos 30 días</small></h3>
    ${lista.length ? `<table class="vn-tabla"><thead><tr><th>Fuente</th><th class="num">Visitas</th><th class="num">Ventas</th><th class="num">Conversión</th><th class="num">Dinero</th><th style="width:30%"></th></tr></thead><tbody>
      ${lista.map(x => `<tr><td><b>${vnEsc(VN_FUENTE[x.fuente] || x.fuente)}</b></td><td class="num">${x.visitas || '—'}</td><td class="num">${x.ventas}</td>
        <td class="num">${x.conversion != null ? x.conversion + ' %' : '—'}</td><td class="num">${vnPesos(x.dinero)}</td>
        <td><span class="vn-barra"><i style="width:${Math.round(x.dinero / total * 100)}%"></i></span></td></tr>`).join('')}
    </tbody></table>` : '<p class="vn-nota">Todavía no hay datos. Se empiezan a contar desde esta versión.</p>'}
    <details class="vn-links-origen"><summary>Links para compartir (así sabes qué red te vende más)</summary>
      <p class="vn-nota">Usa estos links en lugar del normal: la tienda anota de dónde llegó cada cliente.</p>
      ${links.map(([f, m, t]) => { const u = `${base}?utm_source=${f}&utm_medium=${m}`; return `<div class="vn-fila"><span style="min-width:150px">${t}</span><input class="vn-input ancho" readonly value="${vnEsc(u)}" onclick="this.select()"><button class="vn-btn" onclick="Avisos.copiar('${vnEsc(u)}')">Copiar</button></div>`; }).join('')}
    </details></div>`;
}

// ── Etiquetas QR ─────────────────────────────────────────────
function vnEtiquetas() {
  const q = VN.buscaEt.toLowerCase();
  const lista = getDB().filter(p => !p.vendido && (!q || `${p.nombre} ${p.marca} ${p.talla}`.toLowerCase().includes(q)))
    .sort((a, b) => String(b.creadoEn || '').localeCompare(String(a.creadoEn || ''))).slice(0, 120);
  const fmt = VN.etFormato || 'carta';
  return `${vnCab('Etiquetas y SKU', 'Para bazares en persona (Barrio Chido y otros): cada prenda tiene su SKU (STI-00012) y su QR. El cliente lo escanea y ve la prenda; en la Caja lo escaneas y se cobra.',
      `<a class="vn-btn" href="caja.html" target="_blank" rel="noopener">${ico('recibo', 15)} Abrir la Caja</a><button class="vn-btn negro" onclick="vnImprimirEtiquetas()" ${VN.etiquetas.size ? '' : 'disabled'}>Imprimir ${VN.etiquetas.size || ''}</button>`)}
    <div class="vn-fila"><span>Formato</span>
      <label class="vn-check"><input type="radio" name="vnEtFmt" ${fmt === 'carta' ? 'checked' : ''} onchange="VN.etFormato='carta'"> Hoja carta (3 por fila, para cortar)</label>
      <label class="vn-check"><input type="radio" name="vnEtFmt" ${fmt === 'termica' ? 'checked' : ''} onchange="VN.etFormato='termica'"> Impresora térmica 50 × 30 mm (una por etiqueta)</label></div>
    <div class="vn-fila"><input class="vn-input ancho" placeholder="Buscar prenda…" value="${vnEsc(VN.buscaEt)}" oninput="VN.buscaEt=this.value;clearTimeout(VN._t);VN._t=setTimeout(vnPintar,250)">
      <button class="vn-btn" onclick="vnEtTodas(true)">Elegir todas</button><button class="vn-btn ghost" onclick="vnEtTodas(false)">Ninguna</button></div>
    <div class="vn-et-grid">${lista.map(p => `<label class="vn-et ${VN.etiquetas.has(p.id) ? 'on' : ''}">
      <input type="checkbox" ${VN.etiquetas.has(p.id) ? 'checked' : ''} onchange="vnEtSel(${p.id}, this.checked)">
      ${p.imagenes?.[0] ? `<img src="${vnEsc(imgOptimizada ? imgOptimizada(p.imagenes[0], 160) : p.imagenes[0])}" alt="" loading="lazy">` : '<span class="vn-sinfoto"></span>'}
      <b>${vnEsc(p.nombre)}</b><small>${vnEsc(vnSku(p))} · ${vnEsc(String(p.talla || '').split('·')[0])} · ${vnPesos(p.precio_venta)}</small></label>`).join('')}</div>`;
}
function vnEtSel(id, on) { on ? VN.etiquetas.add(id) : VN.etiquetas.delete(id); vnPintar(); }
function vnEtTodas(on) {
  if (!on) VN.etiquetas.clear();
  else getDB().filter(p => !p.vendido).filter(p => !VN.buscaEt || `${p.nombre} ${p.marca} ${p.talla}`.toLowerCase().includes(VN.buscaEt.toLowerCase())).forEach(p => VN.etiquetas.add(p.id));
  vnPintar();
}
function vnQR(texto) {
  if (typeof qrcode !== 'function') return '';
  const q = qrcode(0, 'M'); q.addData(texto); q.make();
  return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
}
// v42 · SKU de cada prenda: STI- + número de 5 dígitos (o el que se le haya puesto a mano)
const vnSku = p => p?.sku ? String(p.sku) : 'STI-' + String(p?.id ?? '').padStart(5, '0');
function vnImprimirEtiquetas() {
  const sitio = location.origin;
  const prendas = getDB().filter(p => VN.etiquetas.has(p.id));
  const w = window.open('', '_blank'); if (!w) return toast('Permite ventanas emergentes para imprimir');
  if ((VN.etFormato || 'carta') === 'termica') return vnEtiquetasTermicas(w, prendas, sitio);
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas</title><style>
    @page { size: letter; margin: 10mm; } * { box-sizing: border-box; } body { margin: 0; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #111; }
    .g { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
    .e { border: 1px dashed #bbb; border-radius: 3mm; padding: 4mm; display: grid; grid-template-columns: 1fr 24mm; gap: 3mm; align-items: center; height: 38mm; break-inside: avoid; }
    .m { font-size: 7pt; letter-spacing: .18em; text-transform: uppercase; color: #666; }
    .n { font-size: 9.5pt; font-weight: 700; line-height: 1.15; margin: 1mm 0; max-height: 11mm; overflow: hidden; }
    .t { font-size: 8pt; color: #444; } .p { font-size: 17pt; font-weight: 800; margin-top: 1mm; } .a { font-size: 9pt; color: #888; text-decoration: line-through; margin-left: 2mm; font-weight: 400; }
    .q svg { width: 24mm; height: 24mm; display: block; } .q small { display: block; text-align: center; font-size: 7pt; font-weight: 700; color: #111; margin-top: 1mm; letter-spacing: .04em; }
    .lg { height: 7mm; width: auto; display: block; margin-bottom: 1mm; }
  </style></head><body><div class="g">${prendas.map(p => `<div class="e"><div>
      <img class="lg" src="${sitio}/img/logo-negro-chico.png" alt=""><div class="m">${vnEsc(p.marca || 'Stiimpys')}</div><div class="n">${vnEsc(p.nombre)}</div>
      <div class="t">Talla ${vnEsc(String(p.talla || '—').split('·')[0])}${p.estado ? ' · ' + vnEsc(p.estado) : ''}</div>
      <div class="p">${vnPesos(p.precio_venta)}${Number(p.precioAnterior) > Number(p.precio_venta) ? `<span class="a">${vnPesos(p.precioAnterior)}</span>` : ''}</div></div>
      <div class="q">${vnQR(`${sitio}/prenda.html?id=${p.id}&o=qr`)}<small>${vnEsc(vnSku(p))}</small></div></div>`).join('')}</div>
    <script>setTimeout(() => window.print(), 300)<\/script></body></html>`);
  w.document.close();
}

// v42 · Etiquetas para impresora térmica (50 × 30 mm, una por página)
function vnEtiquetasTermicas(w, prendas, sitio) {
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas 50x30</title><style>
    @page { size: 50mm 30mm; margin: 0; } * { box-sizing: border-box; } body { margin: 0; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #000; }
    .e { width: 50mm; height: 30mm; padding: 1.6mm 2mm; display: grid; grid-template-columns: 1fr 19mm; gap: 1.5mm; align-items: center; page-break-after: always; overflow: hidden; }
    .lg { height: 5.5mm; width: auto; display: block; }
    .n { font-size: 7pt; font-weight: 700; line-height: 1.1; margin: .6mm 0; max-height: 7.8mm; overflow: hidden; }
    .t { font-size: 6.5pt; } .p { font-size: 13pt; font-weight: 800; line-height: 1; margin-top: .6mm; }
    .q svg { width: 19mm; height: 19mm; display: block; } .s { font-size: 6.5pt; font-weight: 800; text-align: center; margin-top: .4mm; letter-spacing: .03em; }
  </style></head><body>${prendas.map(p => `<div class="e"><div>
      <img class="lg" src="${sitio}/img/logo-negro-chico.png" alt=""><div class="n">${vnEsc(p.nombre)}</div>
      <div class="t">Talla ${vnEsc(String(p.talla || '—').split('·')[0])}</div><div class="p">${vnPesos(p.precio_venta)}</div></div>
      <div class="q">${vnQR(`${sitio}/prenda.html?id=${p.id}&o=qr`)}<div class="s">${vnEsc(vnSku(p))}</div></div></div>`).join('')}
    <script>window.onload = () => setTimeout(() => window.print(), 300)<\/script></body></html>`);
  w.document.close();
}

// ── Promociones y pagos ──────────────────────────────────────
function vnPromos() {
  const c = VN.datos.config, pp = VN.datos.paypal || {}, clip = VN.datos.clip || {}, metodos = VN.datos.metodos || [];
  const vol = c.volumen.length ? c.volumen : [{ n: 2, pct: 10 }];
  const tc = VN.datos.tipoCambio;
  return `${vnCab('Promociones y pagos', 'Lo que hace que te compren más de una prenda, cómo te pagan y cómo les llega.')}
    <h4 class="vn-bloque">Vender más</h4>
    <div class="vn-col2">
      <div class="vn-card"><h3>Descuento por llevar varias</h3>
        <p class="vn-nota">Se aplica solo en el carrito de la tienda y en el pago en línea. Sube el ticket promedio.</p>
        <div id="vnVol">${vol.map((v, i) => `<div class="vn-fila"><span>Desde</span><input class="vn-input chico" type="number" min="2" max="10" value="${v.n}" data-vol-n="${i}"><span>prendas</span><input class="vn-input chico" type="number" min="1" max="60" value="${v.pct}" data-vol-p="${i}"><span>% menos</span></div>`).join('')}</div>
        <div class="vn-fila"><button class="vn-btn ghost" onclick="vnVolAgregar()">${ico('mas', 15)} Otro nivel</button><label class="vn-check"><input type="checkbox" id="vnVolOff" ${c.volumen.length ? '' : 'checked'}> Sin descuento por volumen</label></div>
      </div>
      <div class="vn-card"><h3>Ofertas desde la tienda</h3>
        <label class="vn-check"><input type="checkbox" id="vnOfAct" ${c.ofertas.activas ? 'checked' : ''}> Permitir "Hacer una oferta"</label>
        <div class="vn-fila"><span>Rechazar solas las menores a</span><input class="vn-input chico" type="number" min="30" max="95" id="vnOfMin" value="${c.ofertas.minimoPct}"><span>% del precio</span></div>
        <p class="vn-nota">Así no te llegan ofertas ridículas; al cliente se le pide ofrecer un poco más.</p>
      </div>
    </div>
    <div class="vn-card"><h3>Cupones</h3>
      <p class="vn-nota">Ej. <b>PRIMERA50</b>: $50 menos en la primera compra desde $300. Compártelos en historias o con clientes frecuentes.</p>
      <table class="vn-tabla vn-cupones"><thead><tr><th>Código</th><th>Tipo</th><th>Valor</th><th>Compra mínima</th><th>Máx. usos</th><th class="num">Usado</th><th class="centro">Activo</th><th></th></tr></thead><tbody id="vnCupones">${c.cupones.map((x, i) => vnFilaCupon(x, i)).join('')}</tbody></table>
      <div class="vn-fila"><button class="vn-btn ghost" onclick="vnCuponAgregar()">${ico('mas', 15)} Agregar cupón</button></div>
    </div>

    <h4 class="vn-bloque">Cobro</h4>
    <div class="vn-col2">
      <div class="vn-card"><h3>Pago en línea</h3>
        ${metodos.length ? `<div class="vn-aviso verde">${ico('check', 15)} La tienda cobra con <b>${metodos.map(m => m === 'paypal' ? 'PayPal' : 'Clip').join(' y ')}</b>.</div>` : '<div class="vn-aviso">Todavía no hay cobro en línea conectado.</div>'}
        <div class="vn-pagos">
          <div class="vn-pago clip ${clip.configurado ? 'ok' : ''}"><b>Clip</b> ${clip.configurado ? `${ico('check', 13)} conectado` : '· sin conectar'}<small>Tarjeta de crédito o débito</small></div>
          <div class="vn-pago paypal ${pp.configurado ? 'ok' : ''}"><b>PayPal</b> ${pp.configurado ? `${ico('check', 13)} conectado${pp.prueba ? ' (prueba)' : ''}` : '· opcional'}<small>Cuenta PayPal o tarjeta, sirve para clientes de EE. UU.</small></div>
        </div>
        ${!clip.configurado ? `<details class="vn-pasos" open><summary>Conectar Clip</summary><ol>
          <li>Entra a tu cuenta Clip → <b>Panel de desarrolladores</b> (última opción del menú). Clip pide tener la identidad verificada.</li>
          <li><b>Crear credencial</b>, ponle un nombre y copia la <b>Clave API</b> y la <b>Clave secreta</b>.</li>
          <li>En Vercel → Settings → Environment Variables agrega <code>CLIP_API_KEY</code> y <code>CLIP_SECRET_KEY</code> con esas claves; luego <b>Redeploy</b>.</li>
          <li>En el panel de Clip → <b>Postback Webhook</b>, pega este link, Guardar y activa la recepción de notificaciones:</li></ol>
          <div class="vn-fila"><input class="vn-input ancho" readonly value="${vnEsc(clip.webhook || '')}" onclick="this.select()"><button class="vn-btn" onclick="Avisos.copiar('${vnEsc(clip.webhook || '')}')">Copiar</button></div>
          <p class="vn-nota">Las claves nunca se escriben aquí ni se mandan por chat: solo en Vercel.</p></details>`
        : `<p class="vn-nota">Aviso de pagos de Clip (Panel de desarrolladores → Postback Webhook):</p>
          <div class="vn-fila"><input class="vn-input ancho" readonly value="${vnEsc(clip.webhook || '')}" onclick="this.select()"><button class="vn-btn" onclick="Avisos.copiar('${vnEsc(clip.webhook || '')}')">Copiar</button></div>`}
        ${!pp.configurado ? `<details class="vn-pasos"><summary>Conectar PayPal (opcional)</summary><ol>
          <li>Entra a <b>developer.paypal.com</b> con tu cuenta PayPal de negocio → <b>Apps &amp; Credentials</b> → pestaña <b>Live</b>.</li>
          <li><b>Create App</b>, ponle un nombre y copia el <b>Client ID</b> y el <b>Secret</b>.</li>
          <li>En Vercel agrega <code>PAYPAL_CLIENT_ID</code> y <code>PAYPAL_CLIENT_SECRET</code>; luego <b>Redeploy</b>.</li></ol>
          <p class="vn-nota">PayPal cobra en pesos; si el cliente paga con tarjeta en dólares, PayPal hace la conversión. Sus comisiones son distintas a las de Clip.</p></details>`
        : `<label class="vn-check"><input type="checkbox" id="vnPaypal" ${c.paypal !== false ? 'checked' : ''}> Ofrecer PayPal además de Clip</label>`}
        <label class="vn-check"><input type="checkbox" id="vnMpAct" ${c.pagoEnLinea ? 'checked' : ''}> Mostrar "Pagar en línea" en la tienda</label>
        <p class="vn-nota">Al pagar, la prenda se marca vendida sola, se comenta VENDIDA en Instagram y te llega a Pendientes para coordinar la entrega.</p>
      </div>
      <div class="vn-card"><h3>Apartar con anticipo</h3>
        <p class="vn-nota">El cliente paga una parte en línea y la prenda queda apartada a su nombre. El resto lo paga antes de la fecha límite, en línea desde su recibo o en persona.</p>
        <label class="vn-check"><input type="checkbox" id="vnApAct" ${c.modulos?.apartado !== false ? 'checked' : ''}> Ofrecer "Apartar" al pagar</label>
        <div class="vn-fila"><span>Anticipo</span><input class="vn-input chico" type="number" min="10" max="90" step="5" id="vnApPct" value="${c.apartado?.pct ?? 50}"><span>% del total</span></div>
        <div class="vn-fila"><span>Para liquidar tiene</span><input class="vn-input chico" type="number" min="1" max="30" id="vnApDias" value="${c.apartado?.dias ?? 7}"><span>días</span></div>
        <div class="vn-fila"><span>Solo en compras desde</span><input class="vn-input chico" type="number" min="0" step="50" id="vnApMin" value="${c.apartado?.minimo || 0}"><span>pesos</span></div>
        <p class="vn-nota">Si vence sin liquidar, la prenda no se suelta sola: te llega un aviso para darle más días o liberarla.</p>
      </div>
    </div>

    <h4 class="vn-bloque">Entrega</h4>
    <div class="vn-card vn-ancha vn-puntos-card"><h3>Entrega en persona</h3>
      <div class="vn-dos">
        <div>
        <p class="vn-nota">Los puntos donde entregas. El cliente elige uno al pagar; el día y la hora se acuerdan por WhatsApp.</p>
        <table class="vn-tabla vn-puntos" id="vnPuntos"><thead><tr><th>Punto</th><th>Costo</th><th></th></tr></thead><tbody>${(c.puntosEntrega || []).map(vnFilaPunto).join('')}</tbody></table>
        <div class="vn-fila"><button class="vn-btn ghost" onclick="document.querySelector('#vnPuntos tbody').insertAdjacentHTML('beforeend', vnFilaPunto({ nombre: '', costo: 0 }))">${ico('mas', 15)} Agregar punto</button></div>
        </div>
        <div class="vn-dos-lado">
        <div class="vn-fila"><span>Gratis en compras de más de</span><input class="vn-input chico" type="number" min="0" step="50" id="vnPuntosGratis" value="${c.entregaGratisDesde || 0}"><span>pesos</span></div>
        <p class="vn-nota">Pon 0 si nunca es gratis.</p>
        </div>
      </div>
      </div>
    <div class="vn-card vn-ancha"><h3>Envíos a domicilio</h3>
      ${vnEnvia(c)}
      <div class="vn-fila"><span>${VN.datos.envia?.listo ? 'Costo fijo si envia.com no responde' : 'Costo de envío fijo (opcional)'}</span><input class="vn-input chico" type="number" min="0" id="vnEnvio" value="${c.envioCosto || ''}" placeholder="$"><span>pesos</span></div>
    </div>

    <h4 class="vn-bloque">Tienda</h4>
    <div class="vn-col2">
      <div class="vn-card"><h3>Precios en dólares</h3>
        <label class="vn-check"><input type="checkbox" id="vnUsd" ${c.moneda?.usd !== false ? 'checked' : ''}> Mostrar el selector MXN / USD en la tienda</label>
        <div class="vn-fila"><label class="vn-check"><input type="radio" name="vnTC" value="auto" ${c.moneda?.modo !== 'fijo' ? 'checked' : ''}> Tipo de cambio del día</label></div>
        <div class="vn-fila"><label class="vn-check"><input type="radio" name="vnTC" value="fijo" ${c.moneda?.modo === 'fijo' ? 'checked' : ''}> Fijo:</label>
          <span>1 USD =</span><input class="vn-input chico" type="number" step="0.01" min="5" max="60" id="vnTCfijo" value="${c.moneda?.fijo || ''}" placeholder="18.50"><span>MXN</span></div>
        <p class="vn-nota">${tc ? `Hoy: 1 USD = $${Number(tc.mxnPorUsd).toFixed(2)} MXN (${vnEsc(tc.fuente)}${tc.fecha ? ', ' + vnEsc(tc.fecha.slice(0, 16)) : ''}). ` : ''}Solo cambia cómo se ven los precios; siempre se cobra en pesos. Si pones un tipo fijo un poco más bajo que el del día, el cobro real nunca le sale al cliente más caro de lo que vio.</p>
      </div>
      <div class="vn-card"><h3>Catálogo para Instagram Shopping y Google</h3>
        <p class="vn-nota">En Meta Commerce Manager → Catálogo → Orígenes de datos → <b>Feed programado</b>, pega este link (se actualiza cada hora). Sirve para etiquetar productos en Instagram y para anuncios.</p>
        <div class="vn-fila"><input class="vn-input ancho" readonly value="${vnEsc(VN.datos.feed)}" onclick="this.select()"><button class="vn-btn" onclick="Avisos.copiar('${vnEsc(VN.datos.feed)}')">Copiar</button></div>
      </div>
    </div>
    <div class="vn-card vn-ancha"><h3>Info del negocio</h3>
      <p class="vn-nota">Sale en la ficha de cada prenda y la IA la usa al contestar comentarios y DMs (así no inventa).</p>
      <div class="vn-grid2">${[['entrega', 'Entrega', 'Ej. En persona en Reynosa, Plaza Real'], ['envios', 'Envíos', 'Ej. A todo México por $120 (Estafeta)'], ['pagos', 'Nota de pagos (opcional)', 'Ej. Pago al recoger, sin comisión'], ['horario', 'Horario', 'Ej. Lunes a sábado 11 a 8'], ['apartado', 'Apartados', 'Ej. Se aparta con 50%, 3 días para liquidar']]
        .map(([k, t, ph]) => `<label class="vn-campo"><span>${t}</span><input class="vn-input" maxlength="300" id="vnInfo_${k}" value="${vnEsc(c.info[k] || '')}" placeholder="${ph}"></label>`).join('')}</div>
    </div>
    <div class="vn-col2">
      <div class="vn-card" id="vnFormasCard"><h3>Formas de pago que aceptas</h3>
        <p class="vn-nota">Se anuncian en la tienda (inicio, cada prenda, carrito y pie de página) y en el texto de tus posts de Instagram. Es la misma información en todos lados.</p>
        <p class="vn-nota">También manda en el cobro en línea: sin <b>Tarjeta</b> no se cobra con Clip ni PayPal, y sin <b>Transferencia</b> no se ofrece SPEI.</p>
        ${[['tarjeta', 'Tarjeta', 'crédito o débito'], ['efectivo', 'Efectivo', 'al entregar en persona'], ['transferencia', 'Transferencia', 'SPEI desde su banco']]
          .map(([k, t, d]) => `<label class="vn-check"><input type="checkbox" id="vnFP_${k}" ${c.formasPago?.[k] !== false ? 'checked' : ''}> ${t} <span class="vn-nota" style="display:inline">(${d})</span></label>`).join('')}
      </div>
      <div class="vn-card"><h3>Apartado mientras pagan</h3>
        <p class="vn-nota">Al tocar Pagar, las prendas se apartan para esa persona mientras termina el pago. El link de Clip vence a la misma hora.</p>
        <div class="vn-fila"><span>Apartar</span><input class="vn-input chico" type="number" min="5" max="30" id="vnMinPago" value="${c.minutosPago || 10}"><span>minutos (de 5 a 30)</span></div>
        <p class="vn-nota">Menos minutos = la prenda vuelve antes a la tienda si no pagan. Más minutos = más tiempo para pagar con calma.</p>
      </div>
      <div class="vn-card" id="vnSpeiCard"><h3>Transferencia SPEI</h3>
        <p class="vn-nota">El cliente ve tu CLABE en su recibo, transfiere desde su banco y sube la captura. Te llega el aviso y tú confirmas en <b>Pedidos → Sin pagar</b> cuando veas el dinero. Sin comisión.</p>
        <label class="vn-check"><input type="checkbox" id="vnSpeiAct" ${c.spei?.activo ? 'checked' : ''}> Aceptar transferencias</label>
        <div class="vn-grid2">
          <label class="vn-campo"><span>CLABE (18 números)</span><input class="vn-input" id="vnSpeiClabe" inputmode="numeric" maxlength="22" value="${vnEsc(c.spei?.clabe || '')}" placeholder="012345678901234567"></label>
          <label class="vn-campo"><span>Banco</span><input class="vn-input" id="vnSpeiBanco" maxlength="40" value="${vnEsc(c.spei?.banco || '')}" placeholder="Ej. BBVA"></label>
          <label class="vn-campo"><span>Titular de la cuenta</span><input class="vn-input" id="vnSpeiTitular" maxlength="80" value="${vnEsc(c.spei?.titular || '')}" placeholder="Nombre como aparece en el banco"></label>
          <label class="vn-campo"><span>Horas para transferir</span><input class="vn-input chico" type="number" min="1" max="48" id="vnSpeiHoras" value="${c.spei?.horas || 3}"></label>
        </div>
        <p class="vn-nota" id="vnSpeiNota">${c.spei?.activo ? 'Activo: sale como opción en el pago.' : 'La prenda queda apartada esas horas; al subir el comprobante se aparta 48 h más mientras lo revisas.'}</p>
      </div>
      <div class="vn-card"><h3>Cliente frecuente</h3>
        <p class="vn-nota">Se cuenta por número de teléfono. Al pagar, la tienda reconoce al cliente y le aplica el descuento sola.</p>
        <label class="vn-check"><input type="checkbox" id="vnFrecAct" ${c.frecuente?.activo ? 'checked' : ''}> Premiar a los que regresan</label>
        <div class="vn-fila"><span>Cada</span><input class="vn-input chico" type="number" min="2" max="20" id="vnFrecCada" value="${c.frecuente?.cada || 3}"><span>compras, la siguiente con</span>
          <input class="vn-input chico" type="number" min="1" max="50" id="vnFrecPct" value="${c.frecuente?.pct || 10}"><span>% de descuento</span></div>
        <label class="vn-check"><input type="checkbox" id="vnFrecCumple" ${c.frecuente?.cumple ? 'checked' : ''}> Cupón de cumpleaños por correo de</label>
        <div class="vn-fila"><input class="vn-input chico" type="number" min="1" max="50" id="vnFrecCumplePct" value="${c.frecuente?.cumplePct || 15}"><span>% (vale 7 días; el cliente da su fecha en su recibo)</span></div>
      </div>
      <div class="vn-card"><h3>Outfit e invitar amigos</h3>
        <p class="vn-nota">Se prenden en <b>Módulos</b>. Aquí eliges los porcentajes.</p>
        <div class="vn-fila"><span>Outfit: al combinar 2 tipos de prenda,</span><input class="vn-input chico" type="number" min="1" max="30" id="vnOutfitPct" value="${c.outfit?.pct || 5}"><span>% extra</span></div>
        <div class="vn-fila"><span>Amigo invitado:</span><input class="vn-input chico" type="number" min="1" max="50" id="vnRefAmigo" value="${c.referidos?.pctAmigo || 10}"><span>% en su 1.ª compra · quien invita gana</span>
          <input class="vn-input chico" type="number" min="1" max="50" id="vnRefPremio" value="${c.referidos?.pctPremio || 10}"><span>% (cupón de 60 días)</span></div>
      </div>
      <div class="vn-card"><h3>Google</h3>
        <p class="vn-nota"><b>Google Maps:</b> crea tu perfil gratis en <b>business.google.com</b> (Stiimpys, categoría "Tienda de ropa usada", zona de entrega Reynosa). Luego pega aquí el link de tu perfil y el de "Pedir reseñas".</p>
        <label class="vn-campo"><span>Link de tu perfil en Google Maps</span><input class="vn-input" id="vnGMaps" maxlength="300" value="${vnEsc(c.google?.maps || '')}" placeholder="https://maps.app.goo.gl/…"></label>
        <label class="vn-campo"><span>Link para dejar reseña</span><input class="vn-input" id="vnGResena" maxlength="300" value="${vnEsc(c.google?.resena || '')}" placeholder="https://g.page/r/…/review"></label>
        <p class="vn-nota"><b>Google Shopping gratis:</b> en <b>merchants.google.com</b> → Productos → Agregar productos → Feed programado, pega este link (se actualiza solo):</p>
        <div class="vn-fila"><input class="vn-input ancho" readonly value="${vnEsc(VN.datos.feedGoogle || '')}" onclick="this.select()"><button class="vn-btn" onclick="Avisos.copiar('${vnEsc(VN.datos.feedGoogle || '')}')">Copiar</button></div>
        <p class="vn-nota">${c.modulos?.feedGoogle === true ? 'El catálogo para Google está prendido.' : 'Prende "Catálogo para Google Shopping" en Módulos para que el link funcione.'}</p>
      </div>
      <div class="vn-card"><h3>Datos del vendedor (ley)</h3>
        <p class="vn-nota">La Ley Federal de Protección al Consumidor (art. 76 Bis) pide mostrarlos antes de la compra. Salen en el pie de todas las páginas y en los términos. Si un campo queda vacío, no se muestra.</p>
        <div class="vn-grid2">${[['nombre', 'Nombre o razón social', 'Ej. Ana López / Stiimpys'], ['domicilio', 'Domicilio físico', 'Calle, número, colonia, Reynosa, Tamps., CP'], ['telefono', 'Teléfono', 'Ej. 899 123 4567'], ['correo', 'Correo para reclamaciones', 'Ej. hola@stiimpys.store'], ['horario', 'Horario de atención', 'Ej. Lunes a sábado, 10 a 7']]
          .map(([k, t, ph]) => `<label class="vn-campo"><span>${t}</span><input class="vn-input" maxlength="${k === 'domicilio' ? 300 : 120}" id="vnLegal_${k}" value="${vnEsc(c.legal?.[k] || '')}" placeholder="${ph}"></label>`).join('')}</div>
      </div>
    </div>
    <div class="vn-guardar-barra"><span>Los cambios se ven en la tienda al guardar.</span><button class="vn-btn negro grande" id="vnGuardarPromos" onclick="vnGuardarPromos()">Guardar cambios</button></div>`;
}
// Dígito verificador de la CLABE (pesos 3, 7, 1) — evita un número mal copiado
function vnClabeValida(c) {
  if (!/^\d{18}$/.test(c)) return false;
  const pesos = [3, 7, 1]; let suma = 0;
  for (let i = 0; i < 17; i++) suma += (Number(c[i]) * pesos[i % 3]) % 10;
  return (10 - (suma % 10)) % 10 === Number(c[17]);
}
function vnFilaCupon(x = {}, i) {
  return `<tr data-cupon="${i}"><td><input class="vn-input" maxlength="24" data-k="codigo" value="${vnEsc(x.codigo || '')}" placeholder="PRIMERA50"></td>
    <td><select class="vn-input" data-k="tipo"><option value="monto" ${x.tipo === 'monto' ? 'selected' : ''}>$ pesos</option><option value="pct" ${x.tipo === 'pct' ? 'selected' : ''}>% por ciento</option></select></td>
    <td><input class="vn-input chico" type="number" min="1" data-k="valor" value="${x.valor || ''}"></td>
    <td><input class="vn-input chico" type="number" min="0" data-k="minimo" value="${x.minimo || ''}"></td>
    <td><input class="vn-input chico" type="number" min="1" data-k="maxUsos" value="${x.maxUsos || ''}" placeholder="∞"></td>
    <td class="num">${x.usos || 0}</td>
    <td class="centro"><input type="checkbox" data-k="activo" ${x.activo !== false ? 'checked' : ''}></td>
    <td><button class="vn-btn ghost" onclick="this.closest('tr').remove()" aria-label="Quitar">${ico('equis', 15)}</button></td></tr>`;
}
function vnCuponAgregar() { document.getElementById('vnCupones')?.insertAdjacentHTML('beforeend', vnFilaCupon({ tipo: 'monto', activo: true }, Date.now())); }
function vnVolAgregar() {
  const cont = document.getElementById('vnVol'); const i = cont.children.length;
  cont.insertAdjacentHTML('beforeend', `<div class="vn-fila"><span>Desde</span><input class="vn-input chico" type="number" min="2" max="10" value="${i + 2}" data-vol-n="${i}"><span>prendas</span><input class="vn-input chico" type="number" min="1" max="60" value="${10 + i * 5}" data-vol-p="${i}"><span>% menos</span></div>`);
}
async function vnGuardarPromos() {
  const v = id => document.getElementById(id);
  const volumen = v('vnVolOff').checked ? [] : [...document.querySelectorAll('[data-vol-n]')].map(el => ({ n: Number(el.value), pct: Number(document.querySelector(`[data-vol-p="${el.dataset.volN}"]`)?.value) }));
  const cupones = [...document.querySelectorAll('#vnCupones tr')].map(tr => {
    const g = k => tr.querySelector(`[data-k="${k}"]`);
    return { codigo: g('codigo').value, tipo: g('tipo').value, valor: Number(g('valor').value), minimo: Number(g('minimo').value), maxUsos: Number(g('maxUsos').value) || null, activo: g('activo').checked };
  }).filter(x => x.codigo && x.valor);
  const info = {}; ['entrega', 'envios', 'pagos', 'horario', 'apartado'].forEach(k => info[k] = v('vnInfo_' + k).value);
  const linkG = x => !x || /^https:\/\/(www\.)?(google\.[a-z.]+|maps\.app\.goo\.gl|g\.page|goo\.gl)\//i.test(x);
  if (!linkG((v('vnGMaps')?.value || '').trim()) || !linkG((v('vnGResena')?.value || '').trim())) { toast('Los links de Google deben empezar con https://maps.app.goo.gl/, https://g.page/ o https://www.google.com/', { tipo: 'error' }); return; }
  const clabe = v('vnSpeiClabe').value.replace(/\D/g, '');
  if (v('vnSpeiAct').checked && clabe.length !== 18) { toast('La CLABE debe tener 18 números', { tipo: 'error' }); v('vnSpeiClabe').focus(); return; }
  if (v('vnSpeiAct').checked && !vnClabeValida(clabe)) { toast('Esa CLABE no pasa la revisión del banco (último dígito). Revísala.', { tipo: 'error' }); v('vnSpeiClabe').focus(); return; }
  const btn = v('vnGuardarPromos'); btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    const r = await vnApi('v-config', { volumen, cupones, info, ofertas: { activas: v('vnOfAct').checked, minimoPct: Number(v('vnOfMin').value) }, pagoEnLinea: v('vnMpAct').checked, envioCosto: Number(v('vnEnvio').value) || 0,
      paypal: document.getElementById('vnPaypal') ? document.getElementById('vnPaypal').checked : VN.datos.config.paypal !== false,
      envia: vnLeerEnvia(VN.datos.config),
      puntosEntrega: [...document.querySelectorAll('#vnPuntos tr[data-punto]')].map(tr => ({ nombre: tr.querySelector('[data-k="nombre"]').value.trim(), costo: Number(tr.querySelector('[data-k="costo"]').value) || 0 })).filter(p => p.nombre),
      entregaGratisDesde: Number(document.getElementById('vnPuntosGratis')?.value) || 0,
      minutosPago: Math.max(5, Math.min(30, Number(v('vnMinPago')?.value) || 10)),
      formasPago: Object.fromEntries(['tarjeta', 'efectivo', 'transferencia'].map(k => [k, !!v('vnFP_' + k)?.checked])),   // v55
      spei: { activo: v('vnSpeiAct').checked, clabe: v('vnSpeiClabe').value, banco: v('vnSpeiBanco').value.trim(), titular: v('vnSpeiTitular').value.trim(), horas: Number(v('vnSpeiHoras').value) || 3 },
      outfit: { pct: Number(v('vnOutfitPct')?.value) || 5 },
      referidos: { pctAmigo: Number(v('vnRefAmigo')?.value) || 10, pctPremio: Number(v('vnRefPremio')?.value) || 10 },
      google: { maps: (v('vnGMaps')?.value || '').trim(), resena: (v('vnGResena')?.value || '').trim() },
      frecuente: { activo: v('vnFrecAct').checked, cada: Number(v('vnFrecCada').value) || 3, pct: Number(v('vnFrecPct').value) || 10, cumple: v('vnFrecCumple').checked, cumplePct: Number(v('vnFrecCumplePct').value) || 15 },
      legal: Object.fromEntries(['nombre', 'domicilio', 'telefono', 'correo', 'horario'].map(k => [k, v('vnLegal_' + k)?.value.trim() || ''])),
      moneda: { usd: v('vnUsd').checked, modo: document.querySelector('input[name="vnTC"]:checked')?.value || 'auto', fijo: Number(v('vnTCfijo').value) || 0 },
      ...(v('vnApPct') ? { apartado: { pct: Number(v('vnApPct').value) || 50, dias: Number(v('vnApDias').value) || 7, minimo: Number(v('vnApMin').value) || 0 },
        modulos: { ...(VN.datos.config.modulos || {}), apartado: v('vnApAct').checked } } : {}) });
    VN.datos.config = r.config;
    // v55 · Instagram usa la misma línea de formas de pago: se actualiza sin recargar
    if (typeof IG !== 'undefined' && IG?.estado) {
      const l = ['tarjeta', 'efectivo', 'transferencia'].filter(k => r.config.formasPago?.[k]);
      IG.estado.pagos = l.length ? 'Aceptamos ' + (l.length === 1 ? l[0] : l.slice(0, -1).join(', ') + ' y ' + l.at(-1)) : '';
    }
    VN.datos.metodos = [...(VN.datos.clip?.configurado ? ['clip'] : []), ...(VN.datos.paypal?.configurado && r.config.paypal !== false ? ['paypal'] : []), ...(r.config.spei?.activo ? ['spei'] : [])];
    toast('Cambios guardados', { tipo: 'ok', origen: 'general', cuerpo: 'Promociones y pagos' }); vnPintar();
  } catch (e) { toast(e.message, { tipo: 'error', titulo: 'No se guardaron los cambios', cuerpo: e.message, reintentar: () => vnGuardarPromos() }); btn.disabled = false; btn.textContent = 'Guardar cambios'; }
}

// ── Equipo (permisos por vendedor) ───────────────────────────
function vnEquipo() {
  const vendedores = (typeof getUsers === 'function' ? getUsers() : []).filter(u => u.role === 'vendedor' && (esAdminGlobal() || Number(u.bazarId) === Number(miBazarId())));
  return `${vnCab('Equipo', 'Qué puede hacer cada vendedor. Por defecto pueden todo lo de su bazar.')}
    ${!vendedores.length ? '<div class="vn-vacio">No hay vendedores. Créalos en la pestaña Vendedores.</div>' : `<div class="vn-card"><table class="vn-tabla"><thead><tr><th>Vendedor</th><th class="centro">Puede borrar prendas</th><th class="centro">Puede cambiar precios</th></tr></thead><tbody>
      ${vendedores.map(u => { const p = u.permisos || {}; return `<tr><td><b>${vnEsc(u.username)}</b></td>
        <td class="centro"><label class="vn-switch"><input type="checkbox" ${p.borrar !== false ? 'checked' : ''} onchange="vnPermiso(${u.id},'borrar',this.checked)"><span></span></label></td>
        <td class="centro"><label class="vn-switch"><input type="checkbox" ${p.precios !== false ? 'checked' : ''} onchange="vnPermiso(${u.id},'precios',this.checked)"><span></span></label></td></tr>`; }).join('')}
    </tbody></table></div>`}`;
}
async function vnPermiso(id, k, v) {
  const u = getUsers().find(x => x.id === id); if (!u) return;
  const permisos = { borrar: u.permisos?.borrar !== false, precios: u.permisos?.precios !== false, [k]: v };
  try { const r = await vnApi('v-permisos-usuario', { id, permisos }); u.permisos = r.permisos; toast('Permiso actualizado'); }
  catch (e) { toast(e.message); vnPintar(); }
}

// ── Respaldo ─────────────────────────────────────────────────
async function vnCargarRespaldos() {
  try { VN.respaldos = (await vnApi('v-respaldos')).respaldos; } catch { VN.respaldos = []; }
  vnPintar();
}
function vnRespaldo() {
  const l = VN.respaldos;
  return `${vnCab('Respaldo', 'Tu inventario y tus ventas en un archivo. Además, cada semana se guarda una copia automática (se conservan las últimas 8).')}
    <div class="vn-fila">
      <a class="vn-btn negro" href="/api/acciones?op=v-respaldo&que=inventario&formato=csv">Inventario (Excel)</a>
      <a class="vn-btn negro" href="/api/acciones?op=v-respaldo&que=ventas&formato=csv">Ventas (Excel)</a>
      <a class="vn-btn" href="/api/acciones?op=v-respaldo&formato=json">Todo (JSON)</a>
    </div>
    <div class="vn-card"><h3>Copias automáticas</h3>${!l ? '<div class="vn-cargando"><span class="vn-spin"></span></div>' : !l.length ? '<p class="vn-nota">La primera copia se guarda en la próxima vuelta diaria (9:00 a.m.).</p>'
      : `<ul class="vn-mini">${l.map(r => `<li>${vnFecha(r.en)} · ${r.prendas} prendas · ${r.ventas} ventas · <a href="/api/acciones?op=v-respaldos&id=${vnEsc(r.id)}">Descargar</a></li>`).join('')}</ul>`}</div>`;
}

// ── Enlaces directos desde el QR / la ficha: admin.html?vender=ID ──
window.addEventListener('db:ready', () => setTimeout(() => {
  const q = new URLSearchParams(location.search);
  const vender = Number(q.get('vender')), apartar = Number(q.get('apartar')), editar = Number(q.get('editar'));
  if (!(vender || apartar || editar)) return;
  history.replaceState(null, '', location.pathname + location.hash);
  if (vender && typeof abrirModalVenta === 'function') abrirModalVenta(vender);
  else if (apartar && typeof apAbrir === 'function') apAbrir(apartar);
  else if (editar && typeof editItem === 'function') { showTab('inventario'); editItem(editar); }
}, 400));

// Globo de pendientes al entrar al panel
window.addEventListener('db:ready', () => setTimeout(() => { if (typeof isLoggedIn === 'function' && isLoggedIn()) vnApi('v-panel').then(d => { VN.datos = d; vnGlobo(); vnAvisarNuevos(d); }).catch(() => {}); }, 1500));

// Cada 2½ min (con la pestaña a la vista) se revisa si llegaron pagos o avisos nuevos.
// Solo se actualizan los avisos: lo que estés editando en Ventas no se toca.
setInterval(() => {
  if (document.hidden || typeof isLoggedIn !== 'function' || !isLoggedIn() || !VN.datos) return;
  vnApi('v-panel').then(d => {
    Object.assign(VN.datos, { pendientes: d.pendientes, ofertas: d.ofertas, porEntregar: d.porEntregar, apartados: d.apartados });
    vnGlobo(); vnAvisarNuevos(d);
    const raiz = document.getElementById('vtRaiz');
    if (VN.sec === 'pendientes' && raiz?.offsetParent && !raiz.contains(document.activeElement)) vnPintar();
  }).catch(() => {});
}, 150000);
