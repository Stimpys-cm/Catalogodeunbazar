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
  ['corte', 'Corte de caja', 'recibo'], ['metricas', 'Qué se ve y qué se vende', 'grafica'], ['etiquetas', 'Etiquetas QR', 'qr'],
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
  return `${vnCab('Pedidos en línea', 'Lo que pagaron en la tienda. Marca cada pedido como enviado o entregado y el cliente lo ve en su página de pedido.', `<button class="vn-btn" onclick="VN.pedidos=null;vnPintar();vnCargarPedidos()">${ico('recargar', 15)} Revisar</button>`)}
    ${atorados ? `<div class="vn-aviso">${ico('alerta', 15)} ${atorados} pedido${atorados === 1 ? ' necesita' : 's necesitan'} atención (marcados en amarillo o rojo). <a href="#" onclick="event.preventDefault();typeof spIrMonitor==='function'&&spIrMonitor()">Ver en el monitor</a></div>` : ''}
    <div class="vn-chips vn-chips-parejos ${conAp ? 'cuatro' : ''}">${chip('entregar', 'Por entregar')}${conAp ? chip('apartados', 'Apartados') : ''}${chip('entregados', 'Entregados')}${chip('sinpagar', 'Sin pagar')}${conCan ? chip('cancelados', 'Cancelados') : ''}</div>
    <label class="vn-ped-busca"><span class="vn-sr">Buscar pedido</span>${ico('buscar', 15)}<input class="vn-input" type="search" placeholder="Buscar por nombre, teléfono, número de pedido o prenda" value="${vnEsc(VN.buscaPed || '')}" oninput="vnPedBuscar(this.value)"></label>
    <datalist id="vnPaqs">${VN_PAQUETERIAS.map(p => `<option value="${p}">`).join('')}</datalist>
    <div id="vnPedLista">${vnPedListaHtml()}</div>`;
}
function vnPedido(p) {
  const envio = p.entrega === 'envio', ee = p.entregaEstado;
  const vencido = p.estado === 'apartado' && p.liquidarAntes && p.liquidarAntes < new Date().toISOString();
  const estado = p.estado === 'apartado' ? `<span class="vn-tag ${vencido ? 'rojo' : 'azul'}">${vencido ? 'Apartado vencido' : 'Apartado'}</span>`
    : p.estado === 'cancelado' ? `<span class="vn-tag gris">Cancelado</span>`
    : p.estado !== 'pagado' ? `<span class="vn-tag gris">${p.estado === 'pendiente' ? 'Pagando ahora' : 'No pagó'}</span>`
    : ee === 'entregado' ? '<span class="vn-tag verde">Entregado</span>' : ee === 'enviado' ? '<span class="vn-tag azul">Enviado</span>' : `<span class="vn-tag ambar">${envio ? 'Por enviar' : 'Por entregar'}</span>`;
  const wa = VN.waPed[p.id];
  let accion = '';
  if (p.estado === 'apartado') accion = `<button class="vn-btn negro" onclick="vnApartado('${p.id}','liquidar')">${ico('dinero', 15)} Cobré el resto (${vnPesos(p.resta)})</button>
      <button class="vn-btn ghost" onclick="vnApartado('${p.id}','extender')">${ico('reloj', 15)} 3 días más</button>
      <button class="vn-btn ghost peligro" onclick="vnApartado('${p.id}','liberar')">${ico('equis', 15)} Liberar</button>`;
  if (p.estado === 'pagado') {
    if (ee === 'pendiente' && envio) accion = `<div class="vn-envio">
        <input class="vn-input" list="vnPaqs" id="vnPaq-${p.id}" placeholder="Paquetería" maxlength="40" value="${vnEsc(p.envioDetalle?.paqueteria || '')}">
        <input class="vn-input" id="vnGuia-${p.id}" placeholder="Número de guía" maxlength="60">
        <button class="vn-btn" onclick="vnPedEstado('${p.id}','enviado')">Marcar enviado</button></div>`;
    else if (ee !== 'entregado') accion = `<button class="vn-btn" onclick="vnPedEstado('${p.id}','entregado')">Marcar entregado</button>`;
    if (ee !== 'pendiente') accion += ` <button class="vn-btn ghost" onclick="vnPedEstado('${p.id}','deshacer')">Deshacer</button>`;
  }
  // v33: cancelar (sin pago confirmado), revisar el pago y ver el historial
  if (['pendiente', 'expirado'].includes(p.estado)) accion += `<button class="vn-btn ghost" onclick="spAccionPedido('${vnEsc(p.id)}','revisar',this)">${ico('recargar', 15)} Revisar pago</button>
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
  const cuerpo = m[5] ? m[5](c, input.checked) : { modulos: { ...(c.modulos || {}), [m[0]]: input.checked } };
  input.disabled = true;
  try {
    const r = await vnApi('v-config', cuerpo);
    VN.datos.config = r.config;
    toast(`${m[1]}: ${input.checked ? 'prendido' : 'apagado'}`);
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
  const filtroDe = p.tipo === 'recuperar' ? 'sinpagar' : p.tipo === 'apartado' || /^Apartado con anticipo|^Revisar apartado/.test(p.titulo || '') ? 'apartados' : 'entregar';
  const verPedido = p.pedido && ['venta', 'recuperar', 'apartado'].includes(p.tipo)
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
  const texto = `🧾 Corte ${c.dia}\nVendidas: ${c.ventas.length}\nTotal: ${vnPesos(c.total)}\nGanancia: ${vnPesos(c.ganancia)}\n${Object.entries(c.porCanal).map(([k, v]) => `${k}: ${vnPesos(v)}`).join('\n')}\nApartadas: ${c.apartadas.length} · Nuevas: ${c.nuevas} · Ofertas: ${c.ofertas}`;
  return `${cab}
    <div class="vn-kpis" style="--n:6">
      <div><b>${c.ventas.length}</b><span>vendidas</span></div>
      <div><b>${vnPesos(c.total)}</b><span>total</span></div>
      <div><b>${vnPesos(c.ganancia)}</b><span>ganancia</span></div>
      <div><b>${c.apartadas.length}</b><span>apartadas</span></div>
      <div><b>${c.nuevas}</b><span>prendas nuevas</span></div>
      <div><b>${c.ofertas}</b><span>ofertas</span></div>
    </div>
    ${Object.keys(c.porCanal).length ? `<div class="vn-canales">${Object.entries(c.porCanal).map(([k, v]) => `<span>${vnEsc(VN_CANAL[k] || k.charAt(0).toUpperCase() + k.slice(1))}<b>${vnPesos(v)}</b></span>`).join('')}</div>` : ''}
    <div class="vn-card"><h3>Ventas</h3>${c.ventas.length ? `<table class="vn-tabla"><thead><tr><th>Prenda</th><th class="num">Precio</th><th class="num">Ganancia</th><th>Cliente</th><th>Quién</th></tr></thead><tbody>
      ${c.ventas.map(v => `<tr><td>${vnEsc(v.nombre)}</td><td class="num">${vnPesos(v.precio)}</td><td class="num">${vnPesos(v.precio - v.costo)}</td><td>${vnEsc(v.comprador || '—')}</td><td>${vnEsc(v.canal === 'clip' ? 'Pago en línea (Clip)' : v.canal === 'paypal' ? 'Pago en línea (PayPal)' : v.canal === 'mercadopago' ? 'Pago en línea (MP)' : v.vendedor || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="vn-nota">Sin ventas este día.</p>'}</div>
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
    ${m.ideas.map(i => `<div class="vn-idea">${ico('foco', 17)}<span>${vnEsc(i.texto)}${i.ids?.length ? `<small>${i.ids.map(nombre).join(' · ')}</small>` : ''}</span></div>`).join('')}
    <div class="vn-card"><table class="vn-tabla"><thead><tr><th></th><th>Prenda</th><th class="num">Visitas</th><th class="num">WhatsApp</th><th class="num">Carrito</th><th class="num">Ofertas</th><th class="num">Días</th></tr></thead><tbody>
      ${m.filas.slice(0, 60).map(f => `<tr class="${f.vendido ? 'vendida' : ''}"><td>${f.foto ? `<img src="${vnEsc(imgOptimizada ? imgOptimizada(f.foto, 80) : f.foto)}" alt="">` : ''}</td>
        <td>${vnEsc(f.nombre)}${f.vendido ? ' <em>vendida</em>' : ''}</td><td class="num">${f.vista}</td><td class="num">${f.wa}</td><td class="num">${f.bolsa}</td><td class="num">${f.oferta}</td><td class="num">${f.dias ?? '—'}</td></tr>`).join('')}
    </tbody></table></div>`;
}

// ── Etiquetas QR ─────────────────────────────────────────────
function vnEtiquetas() {
  const q = VN.buscaEt.toLowerCase();
  const lista = getDB().filter(p => !p.vendido && (!q || `${p.nombre} ${p.marca} ${p.talla}`.toLowerCase().includes(q)))
    .sort((a, b) => String(b.creadoEn || '').localeCompare(String(a.creadoEn || ''))).slice(0, 120);
  return `${vnCab('Etiquetas QR', 'Para bazares en persona: imprime etiquetas con precio y un QR. El cliente lo escanea y ve la prenda; tú (con sesión abierta) puedes venderla o apartarla desde ahí.',
      `<button class="vn-btn negro" onclick="vnImprimirEtiquetas()" ${VN.etiquetas.size ? '' : 'disabled'}>Imprimir ${VN.etiquetas.size || ''}</button>`)}
    <div class="vn-fila"><input class="vn-input ancho" placeholder="Buscar prenda…" value="${vnEsc(VN.buscaEt)}" oninput="VN.buscaEt=this.value;clearTimeout(VN._t);VN._t=setTimeout(vnPintar,250)">
      <button class="vn-btn" onclick="vnEtTodas(true)">Elegir todas</button><button class="vn-btn ghost" onclick="vnEtTodas(false)">Ninguna</button></div>
    <div class="vn-et-grid">${lista.map(p => `<label class="vn-et ${VN.etiquetas.has(p.id) ? 'on' : ''}">
      <input type="checkbox" ${VN.etiquetas.has(p.id) ? 'checked' : ''} onchange="vnEtSel(${p.id}, this.checked)">
      ${p.imagenes?.[0] ? `<img src="${vnEsc(imgOptimizada ? imgOptimizada(p.imagenes[0], 160) : p.imagenes[0])}" alt="" loading="lazy">` : '<span class="vn-sinfoto"></span>'}
      <b>${vnEsc(p.nombre)}</b><small>${vnEsc(String(p.talla || '').split('·')[0])} · ${vnPesos(p.precio_venta)}</small></label>`).join('')}</div>`;
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
function vnImprimirEtiquetas() {
  const sitio = location.origin;
  const prendas = getDB().filter(p => VN.etiquetas.has(p.id));
  const w = window.open('', '_blank'); if (!w) return toast('Permite ventanas emergentes para imprimir');
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas</title><style>
    @page { size: letter; margin: 10mm; } * { box-sizing: border-box; } body { margin: 0; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #111; }
    .g { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; }
    .e { border: 1px dashed #bbb; border-radius: 3mm; padding: 4mm; display: grid; grid-template-columns: 1fr 24mm; gap: 3mm; align-items: center; height: 38mm; break-inside: avoid; }
    .m { font-size: 7pt; letter-spacing: .18em; text-transform: uppercase; color: #666; }
    .n { font-size: 9.5pt; font-weight: 700; line-height: 1.15; margin: 1mm 0; max-height: 11mm; overflow: hidden; }
    .t { font-size: 8pt; color: #444; } .p { font-size: 17pt; font-weight: 800; margin-top: 1mm; } .a { font-size: 9pt; color: #888; text-decoration: line-through; margin-left: 2mm; font-weight: 400; }
    .q svg { width: 24mm; height: 24mm; display: block; } .q small { display: block; text-align: center; font-size: 6pt; color: #666; margin-top: 1mm; }
  </style></head><body><div class="g">${prendas.map(p => `<div class="e"><div>
      <div class="m">${vnEsc(p.marca || 'Stiimpys')}</div><div class="n">${vnEsc(p.nombre)}</div>
      <div class="t">Talla ${vnEsc(String(p.talla || '—').split('·')[0])}${p.estado ? ' · ' + vnEsc(p.estado) : ''}</div>
      <div class="p">${vnPesos(p.precio_venta)}${Number(p.precioAnterior) > Number(p.precio_venta) ? `<span class="a">${vnPesos(p.precioAnterior)}</span>` : ''}</div></div>
      <div class="q">${vnQR(`${sitio}/prenda.html?id=${p.id}`)}<small>#${p.id}</small></div></div>`).join('')}</div>
    <script>setTimeout(() => window.print(), 300)<\/script></body></html>`);
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
      <div class="vn-grid2">${[['entrega', 'Entrega', 'Ej. En persona en Reynosa, Plaza Real'], ['envios', 'Envíos', 'Ej. A todo México por $120 (Estafeta)'], ['pagos', 'Formas de pago', 'Ej. Transferencia, efectivo, tarjeta'], ['horario', 'Horario', 'Ej. Lunes a sábado 11 a 8'], ['apartado', 'Apartados', 'Ej. Se aparta con 50%, 3 días para liquidar']]
        .map(([k, t, ph]) => `<label class="vn-campo"><span>${t}</span><input class="vn-input" maxlength="300" id="vnInfo_${k}" value="${vnEsc(c.info[k] || '')}" placeholder="${ph}"></label>`).join('')}</div>
    </div>
    <div class="vn-guardar-barra"><span>Los cambios se ven en la tienda al guardar.</span><button class="vn-btn negro grande" id="vnGuardarPromos" onclick="vnGuardarPromos()">Guardar cambios</button></div>`;
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
  const btn = v('vnGuardarPromos'); btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    const r = await vnApi('v-config', { volumen, cupones, info, ofertas: { activas: v('vnOfAct').checked, minimoPct: Number(v('vnOfMin').value) }, pagoEnLinea: v('vnMpAct').checked, envioCosto: Number(v('vnEnvio').value) || 0,
      paypal: document.getElementById('vnPaypal') ? document.getElementById('vnPaypal').checked : VN.datos.config.paypal !== false,
      envia: vnLeerEnvia(VN.datos.config),
      puntosEntrega: [...document.querySelectorAll('#vnPuntos tr[data-punto]')].map(tr => ({ nombre: tr.querySelector('[data-k="nombre"]').value.trim(), costo: Number(tr.querySelector('[data-k="costo"]').value) || 0 })).filter(p => p.nombre),
      entregaGratisDesde: Number(document.getElementById('vnPuntosGratis')?.value) || 0,
      moneda: { usd: v('vnUsd').checked, modo: document.querySelector('input[name="vnTC"]:checked')?.value || 'auto', fijo: Number(v('vnTCfijo').value) || 0 },
      ...(v('vnApPct') ? { apartado: { pct: Number(v('vnApPct').value) || 50, dias: Number(v('vnApDias').value) || 7, minimo: Number(v('vnApMin').value) || 0 },
        modulos: { ...(VN.datos.config.modulos || {}), apartado: v('vnApAct').checked } } : {}) });
    VN.datos.config = r.config;
    VN.datos.metodos = [...(VN.datos.clip?.configurado ? ['clip'] : []), ...(VN.datos.paypal?.configurado && r.config.paypal !== false ? ['paypal'] : [])];
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
