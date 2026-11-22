// ─────────────────────────────────────────────────────────────
//  js/sistema-panel.js — Panel → Sistema · v33
//
//  Monitor (estado de MongoDB, Clip, Resend, Cloudinary y PayPal; pendientes,
//  inconsistencias y errores) · Actividad (registro del servidor con filtros,
//  búsqueda y paginación) · Historial de un pedido (ventana que también usa
//  Ventas → Pedidos en línea).
//  Todo se lee de /api/acciones?op=v-sistema | v-actividad | v-pedido-historial.
// ─────────────────────────────────────────────────────────────
const SP = {
  sec: (() => { try { return sessionStorage.getItem('sp-sec') || 'monitor'; } catch (_) { return 'monitor'; } })(),
  monitor: null, cargandoMon: false, errorMon: '', timer: null,
  act: null, cargandoAct: false, errorAct: '', abiertos: new Set(),
  f: { q: '', categoria: '', resultado: '', usuario: '', desde: '', hasta: '', pagina: 1, porPagina: 25 },
};
const spEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const spJs = s => spEsc(JSON.stringify(String(s ?? '')));   // valor seguro dentro de onclick="fn(...)"
const spPesos = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');
const spIco = (n, t = 15) => (typeof ico === 'function' ? ico(n, t) : '');
const spApi = (op, extra = '', body) => api(`/api/acciones?op=${op}${extra}`, body ? { method: 'POST', body } : undefined);
const spFecha = iso => { const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };
function spHace(iso) {
  if (!iso) return 'sin registro';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (isNaN(s)) return '—';
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}
const SP_ESTADO = { operativo: ['verde', 'Operativo'], degradado: ['ambar', 'Degradado'], 'no disponible': ['rojo', 'No disponible'], 'sin configurar': ['gris', 'Sin configurar'] };
const SP_RES = { ok: ['verde', 'Correcto'], info: ['azul', 'Informativo'], rechazado: ['ambar', 'Rechazado'], error: ['rojo', 'Error'] };
const spChip = (cls, txt) => `<span class="sp-chip ${cls}">${spEsc(txt)}</span>`;
const SP_PED_ESTADO = { pendiente: ['ambar', 'Pagando'], expirado: ['gris', 'No pagó'], apartado: ['azul', 'Apartado'], pagado: ['verde', 'Pagado'], cancelado: ['gris', 'Cancelado'], reemplazado: ['gris', 'Reemplazado'] };

// ── Secciones ────────────────────────────────────────────────
function spIr(sec) {
  SP.sec = sec;
  try { sessionStorage.setItem('sp-sec', sec); } catch (_) {}
  document.querySelectorAll('#spTabs [data-sp]').forEach(b => {
    const on = b.dataset.sp === sec;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll('#view-sistema [data-sp-sec]').forEach(s => s.classList.toggle('sp-oculta', s.dataset.spSec !== sec));
  clearTimeout(SP.timer);
  if (sec === 'monitor') spCargarMonitor();
  if (sec === 'actividad') { if (!SP.act) spCargarActividad(); else spPintarActividad(); }
}
// Flechas izquierda/derecha entre pestañas (accesible con teclado)
document.addEventListener('keydown', e => {
  if (!e.target.closest?.('#spTabs') || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const tabs = [...document.querySelectorAll('#spTabs [data-sp]')].filter(b => !b.hidden);
  const i = tabs.indexOf(e.target), sig = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  if (sig) { sig.focus(); spIr(sig.dataset.sp); }
});

// El botón "Volver a revisar" y la pestaña del menú llaman renderSistema(): se amplía
if (typeof renderSistema === 'function') {
  const _renderSistemaV32 = renderSistema;
  // eslint-disable-next-line no-func-assign
  renderSistema = function () {
    _renderSistemaV32();
    const global = typeof esAdminGlobal === 'function' ? esAdminGlobal() : true;
    const mnt = document.querySelector('#spTabs [data-sp="mantenimiento"]');
    if (mnt) mnt.hidden = !global;                       // el mantenimiento es de toda la plataforma
    if (!global && SP.sec === 'mantenimiento') SP.sec = 'monitor';
    if (SP.sec === 'monitor') SP.monitor = SP.monitor && { ...SP.monitor, viejo: true };
    if (SP.sec === 'actividad') SP.act = null;
    spIr(SP.sec);
    if (SP.sec === 'monitor') spCargarMonitor(true);
  };
}

// ═════════════════════════════════════════════════════════════
//  MONITOR
// ═════════════════════════════════════════════════════════════
async function spCargarMonitor(fresco = false) {
  if (SP.cargandoMon) return;
  SP.cargandoMon = true; SP.errorMon = '';
  if (!SP.monitor) spPintarMonitor();
  try { SP.monitor = await spApi('v-sistema', fresco ? '&fresco=1' : ''); }
  catch (e) { SP.errorMon = e.message || 'No se pudo revisar el sistema.'; }
  SP.cargandoMon = false;
  spPintarMonitor();
  // Se vuelve a revisar solo cada minuto mientras el monitor esté a la vista
  clearTimeout(SP.timer);
  SP.timer = setTimeout(() => { if (SP.sec === 'monitor' && document.getElementById('spMonitor')?.offsetParent) spCargarMonitor(); }, 60e3);
}

function spPintarMonitor() {
  const raiz = document.getElementById('spMonitor');
  if (!raiz) return;
  const m = SP.monitor;
  if (!m) { raiz.innerHTML = SP.errorMon ? `<div class="sp-aviso rojo">${spEsc(SP.errorMon)}</div>` : '<div class="sp-cargando"><span class="vn-spin"></span>Revisando servicios…</div>'; return; }
  const g = { operativo: ['verde', 'check', 'Todo operativo', 'Todos los servicios responden y no hay inconsistencias.'],
    degradado: ['ambar', 'alerta', 'Funciona con detalles', 'Algún servicio está lento, hay errores recientes o algo por revisar.'],
    'no disponible': ['rojo', 'alerta', 'Hay servicios sin funcionar', 'Revisa abajo cuál y qué hacer.'] }[m.general] || ['gris', 'alerta', m.general, ''];
  const p = m.pendientes || {};
  const kpi = (n, t, cls = '', accion = '') => `<button type="button" class="sp-kpi ${cls}" ${accion ? `onclick="${accion}"` : 'disabled'}><b>${n ?? '—'}</b><span>${t}</span></button>`;
  const fila = (t, n, accion, nivel) => n ? `<tr><td>${t}</td><td class="num"><span class="sp-chip ${nivel}">${n}</span></td><td class="der">${accion}</td></tr>` : '';
  const irPed = f => `<button type="button" class="vn-btn ghost chico" onclick="spIrVentas('pedidos', ${spJs(f)})">Ver pedidos</button>`;
  const filasPend = [
    fila('Pagos que se quedaron abiertos', p.pagosSinCerrar, irPed('sinpagar'), 'ambar'),
    fila('Apartados vencidos', p.apartadosVencidos, irPed('apartados'), 'rojo'),
    fila('Apartados que vencen en menos de 2 días', p.apartadosPorVencer, irPed('apartados'), 'ambar'),
    fila('Pagados hace días sin entregar', p.sinEntregar, irPed('entregar'), 'ambar'),
    fila('Dinero por devolver', p.devolverDinero, `<button type="button" class="vn-btn ghost chico" onclick="spIrVentas('pendientes')">Ver pendientes</button>`, 'rojo'),
    fila('Avisos sin atender en Pendientes', p.avisos, `<button type="button" class="vn-btn ghost chico" onclick="spIrVentas('pendientes')">Ver pendientes</button>`, 'azul'),
  ].join('');
  const u = m.ultimas || {};
  const mov = (t, iso, extra = '') => `<div class="sp-mov"><dt>${t}</dt><dd><b>${spHace(iso)}</b>${iso ? `<span>${spFecha(iso)}</span>` : ''}${extra}</dd></div>`;
  raiz.innerHTML = `
    <div class="sp-estado ${g[0]}" role="status">
      <span class="sp-estado-ic">${spIco(g[1], 22)}</span>
      <div><h2>${g[2]}</h2><p>${g[3]}</p></div>
      <div class="sp-estado-der"><span>Revisado ${spHace(m.generado)}${m.deCache ? ' (guardado)' : ''}</span>
        <button type="button" class="vn-btn" onclick="spCargarMonitor(true)" ${SP.cargandoMon ? 'disabled' : ''}>${spIco('recargar')} ${SP.cargandoMon ? 'Revisando…' : 'Revisar ahora'}</button></div>
    </div>
    ${(m.avisosSistema || []).map(a => `<div class="sp-aviso ${a.nivel === 'rojo' ? 'rojo' : ''}">${spEsc(a.texto)}</div>`).join('')}
    ${m.alertas ? `<div class="sp-aviso sp-alertas">${m.alertas.telegram || m.alertas.correo
        ? `Avisos a tu celular: <b>${[m.alertas.telegram && 'Telegram', m.alertas.correo && 'correo'].filter(Boolean).join(' y ')}</b>. Si algo se cae, te avisamos (máximo cada 3 horas por cosa).`
        : m.alertas.botSinChat ? 'Avisos a tu celular: falta TELEGRAM_CHAT_ID. Mándale "hola" a tu bot y toca Probar aviso para saber cuál es.'
        : 'Avisos a tu celular: apagados. Pon TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID (o AVISOS_CORREO) en Vercel. Pasos en LEEME.txt.'}
      <button type="button" class="vn-btn ghost" onclick="spProbarAvisos(this)">Probar aviso</button></div>` : ''}
    ${SP.errorMon ? `<div class="sp-aviso rojo">${spEsc(SP.errorMon)}</div>` : ''}

    <div class="sp-kpis">
      ${kpi(m.errores?.ultimas24h, 'Errores en 24 h', m.errores?.ultimas24h ? 'rojo' : '', "spVerActividad({ resultado: 'error' })")}
      ${kpi(p.pagandoAhora, 'Pagando ahora', '', '')}
      ${kpi(p.apartados, 'Apartados activos', '', "spIrVentas('pedidos', 'apartados')")}
      ${kpi(p.porEntregar, 'Por entregar', p.porEntregar ? 'ambar' : '', "spIrVentas('pedidos', 'entregar')")}
    </div>

    <h3 class="sp-h">Servicios</h3>
    <div class="sp-servicios">${(m.servicios || []).map(s => { const [c, t] = SP_ESTADO[s.estado] || ['gris', s.estado];
      return `<article class="sp-serv ${c}"><header><b>${spEsc(s.nombre)}</b>${spChip(c, t)}</header><p>${spEsc(s.detalle || '')}</p>${s.ms != null ? `<small>${s.ms} ms</small>` : ''}</article>`; }).join('')}</div>

    <div class="sp-dos">
      <section class="sp-caja">
        <h3 class="sp-h">Operaciones pendientes</h3>
        ${filasPend ? `<table class="sp-tabla"><tbody>${filasPend}</tbody></table>` : `<div class="sp-vacio">${spIco('listo')} Nada pendiente.</div>`}
      </section>
      <section class="sp-caja">
        <h3 class="sp-h">Últimos movimientos</h3>
        <dl class="sp-movs">
          ${mov('Sincronización del panel', u.syncPanel)}
          ${mov('Sincronización de la tienda', u.syncPublico)}
          ${mov('Tarea automática diaria', u.cron)}
          ${mov('Último aviso de Clip', u.webhookClip)}
          ${mov('Último pago confirmado', u.ultimoPago)}
          ${mov('Último correo enviado', u.ultimoCorreo)}
          ${mov('Última actividad', u.actividad?.en, u.actividad ? `<em>${spEsc(u.actividad.accion)} · ${spEsc(u.actividad.usuario)}</em>` : '')}
        </dl>
      </section>
    </div>

    ${(p.atorados || []).length ? `<h3 class="sp-h">Pedidos que necesitan atención</h3>
      <div class="sp-tabla-envuelta"><table class="sp-tabla sp-resp">
        <thead><tr><th>Pedido</th><th>Cliente</th><th>Estado</th><th>Qué pasa</th><th class="der">Acciones</th></tr></thead>
        <tbody>${p.atorados.map(x => { const [c, t] = SP_PED_ESTADO[x.estado] || ['gris', x.estado];
          return `<tr><td data-l="Pedido"><code>${spEsc(x.id)}</code></td><td data-l="Cliente">${spEsc(x.nombre)} · ${spPesos(x.total)}</td><td data-l="Estado">${spChip(c, t)}</td>
            <td data-l="Qué pasa">${(x.alertas || []).map(a => `<span class="sp-alerta ${a.nivel}">${spEsc(a.texto)}</span>`).join('')}</td>
            <td class="der" data-l=""><button type="button" class="vn-btn ghost chico" onclick="spHistorial(${spJs(x.id)})">Historial</button>
            ${x.estado === 'pendiente' ? `<button type="button" class="vn-btn chico" onclick="spReparar('revisar-pedido', null, ${spJs(x.id)}, this)">Revisar pago</button>` : ''}</td></tr>`; }).join('')}</tbody>
      </table></div>` : ''}

    <h3 class="sp-h">Consistencia entre pedidos, pagos e inventario</h3>
    ${(m.inconsistencias || []).length ? `<div class="sp-tabla-envuelta"><table class="sp-tabla sp-resp">
        <thead><tr><th>Nivel</th><th>Qué se encontró</th><th>Pedido</th><th class="der">Acción</th></tr></thead>
        <tbody>${m.inconsistencias.map(i => `<tr><td data-l="Nivel">${spChip(i.nivel === 'rojo' ? 'rojo' : 'ambar', i.nivel === 'rojo' ? 'Importante' : 'Revisar')}</td>
          <td data-l="Qué">${spEsc(i.texto)}</td><td data-l="Pedido">${i.pedidoId ? `<button type="button" class="sp-link" onclick="spHistorial(${spJs(i.pedidoId)})">${spEsc(i.pedidoId)}</button>` : '—'}</td>
          <td class="der" data-l="">${i.reparar ? `<button type="button" class="vn-btn chico" onclick="spReparar(${spJs(i.reparar)}, ${Number(i.prendaId) || 'null'}, ${spJs(i.pedidoId || '')}, this)">${{ 'soltar-apartado': 'Soltar apartado', reapartar: 'Volver a apartar', 'revisar-pedido': 'Revisar pago' }[i.reparar] || 'Reparar'}</button>` : '<span class="sp-gris">Resolver a mano</span>'}</td></tr>`).join('')}</tbody>
      </table></div>` : `<div class="sp-vacio">${spIco('listo')} Pedidos, pagos e inventario coinciden.</div>`}

    <h3 class="sp-h">Errores recientes <button type="button" class="sp-link" onclick="spVerActividad({ resultado: 'error' })">Ver todos</button></h3>
    ${(m.errores?.recientes || []).length ? `<div class="sp-tabla-envuelta"><table class="sp-tabla sp-resp">
        <thead><tr><th>Cuándo</th><th>Área</th><th>Qué pasó</th><th>Detalle</th></tr></thead>
        <tbody>${m.errores.recientes.map(e => `<tr><td data-l="Cuándo" title="${spEsc(spFecha(e.en))}">${spHace(e.en)}</td><td data-l="Área">${spChip('gris', spCategoria(e.categoria))}</td>
          <td data-l="Qué pasó">${spEsc(e.accion)}${e.pedidoId ? ` <button type="button" class="sp-link" onclick="spHistorial(${spJs(e.pedidoId)})">${spEsc(e.pedidoId)}</button>` : ''}</td><td data-l="Detalle" class="sp-gris">${spEsc(e.error?.mensaje || '')}</td></tr>`).join('')}</tbody>
      </table></div>` : `<div class="sp-vacio">${spIco('listo')} Sin errores registrados.</div>`}
    ${m.errores?.cliente24h ? `<p class="sp-nota">Además, el panel reportó ${m.errores.cliente24h} error(es) del navegador en 24 h (campana → Errores).</p>` : ''}`;
}

async function spReparar(tipo, prendaId, pedidoId, btn) {
  const textos = { 'soltar-apartado': ['¿Soltar este apartado?', 'La prenda vuelve a estar disponible en la tienda. Solo se hace si su pedido ya está cerrado.', 'Soltar'],
    reapartar: ['¿Volver a apartar la prenda?', 'Queda apartada a nombre del cliente que pagó el anticipo, hasta su fecha límite.', 'Apartar'],
    'revisar-pedido': ['¿Revisar el pago con Clip/PayPal?', 'Se consulta el estado real del pago. Si no pagó y ya venció, el pedido se cierra.', 'Revisar'] }[tipo];
  if (textos && typeof uiConfirm === 'function' && !(await uiConfirm({ titulo: textos[0], mensaje: textos[1], ok: textos[2] }))) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Revisando…'; }
  try {
    const r = await spApi('v-sistema-reparar', '', { tipo, prendaId, pedidoId });
    toast(tipo === 'revisar-pedido' ? `Pedido revisado: quedó ${r.estado}` : 'Listo, se corrigió', { tipo: 'ok', origen: 'sistema' });
  } catch (e) {
    toast(e.message, { tipo: e.status === 409 ? 'alerta' : 'error', origen: 'sistema', titulo: 'No se pudo reparar' });
  }
  spCargarMonitor(true);
  if (typeof vnCargarPedidos === 'function' && typeof VN !== 'undefined' && VN.pedidos) vnCargarPedidos();
}

function spIrVentas(sec, filtro) {
  if (typeof VN !== 'undefined') { VN.sec = sec; VN.elegida = true; if (filtro) VN.filtroPed = filtro; }
  if (typeof showTab === 'function') showTab('ventas');
  if (sec === 'pedidos' && typeof vnCargarPedidos === 'function') vnCargarPedidos();
}

// ═════════════════════════════════════════════════════════════
//  ACTIVIDAD
// ═════════════════════════════════════════════════════════════
const SP_CAT = { pago: 'Pagos', pedido: 'Pedidos', apartado: 'Apartados', cupon: 'Cupones', correo: 'Correos', instagram: 'Instagram', inventario: 'Inventario', admin: 'Administración', auth: 'Sesiones', db: 'MongoDB', sistema: 'Sistema' };
const spCategoria = c => (SP.act?.categorias || SP_CAT)[c] || c;
function spQuery() {
  const f = SP.f, q = new URLSearchParams();
  for (const k of ['q', 'categoria', 'resultado', 'usuario', 'desde', 'hasta']) if (f[k]) q.set(k, f[k]);
  q.set('pagina', f.pagina); q.set('porPagina', f.porPagina);
  return '&' + q.toString();
}
async function spCargarActividad() {
  SP.cargandoAct = true; SP.errorAct = '';
  spPintarActividad();
  try { SP.act = await spApi('v-actividad', spQuery()); }
  catch (e) { SP.errorAct = e.message || 'No se pudo cargar la actividad.'; }
  SP.cargandoAct = false;
  spPintarActividad();
}
function spVerActividad(filtros = {}) {
  SP.f = { ...SP.f, q: '', categoria: '', resultado: '', usuario: '', desde: '', hasta: '', ...filtros, pagina: 1 };
  if (typeof showTab === 'function' && typeof currentTab !== 'undefined' && currentTab !== 'sistema') showTab('sistema');
  SP.act = null; spIr('actividad');
}
function spFiltro(k, v) { SP.f[k] = v; SP.f.pagina = 1; SP.abiertos.clear(); spCargarActividad(); }
let _spBusca;
function spBuscar(v) { clearTimeout(_spBusca); _spBusca = setTimeout(() => spFiltro('q', v.trim()), 350); }
function spAlternarFiltros(btn) {
  const form = document.querySelector('#spActividad .sp-filtros'); if (!form) return;
  const abierto = form.classList.toggle('abiertos');
  btn.setAttribute('aria-expanded', abierto ? 'true' : 'false');
}
function spLimpiar() { SP.f = { ...SP.f, q: '', categoria: '', resultado: '', usuario: '', desde: '', hasta: '', pagina: 1 }; spCargarActividad(); }
function spPagina(n) { SP.f.pagina = n; SP.abiertos.clear(); spCargarActividad(); document.getElementById('spActividad')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function spAbrir(id) { SP.abiertos.has(id) ? SP.abiertos.delete(id) : SP.abiertos.add(id); spPintarActividad(); }
function spExportar() {
  const q = spQuery().replace(/&pagina=\d+|&porPagina=\d+/g, '');
  window.open(`/api/acciones?op=v-actividad&formato=csv${q}`, '_blank', 'noopener');
}

function spDetalle(e) {
  const filas = [];
  const val = v => typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
  if (e.tipo) filas.push(['Tipo', e.tipo]);
  if (e.op) filas.push(['Operación', e.op]);
  if (e.rol) filas.push(['Rol', e.rol]);
  if (e.bazarId) filas.push(['Bazar', '#' + e.bazarId]);
  if (e.prendaId) filas.push(['Prenda', '#' + e.prendaId]);
  if (e.ms != null) filas.push(['Duración', `${e.ms} ms`]);
  for (const [k, v] of Object.entries(e.detalle || {})) if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) filas.push([k, val(v)]);
  return `<div class="sp-det">
    ${e.error ? `<div class="sp-det-error"><b>${spEsc(e.error.nombre || 'Error')}${e.error.estado ? ` · ${spEsc(e.error.estado)}` : ''}</b><span>${spEsc(e.error.mensaje || '')}</span></div>` : ''}
    <dl>${filas.map(([k, v]) => `<div><dt>${spEsc(k)}</dt><dd>${spEsc(v)}</dd></div>`).join('')}</dl>
    <small>Fecha exacta: ${spEsc(new Date(e.en).toLocaleString('es-MX'))} · id ${spEsc(e.id)}</small></div>`;
}

function spPintarActividad() {
  const raiz = document.getElementById('spActividad');
  if (!raiz) return;
  const a = SP.act, f = SP.f;
  const cats = a?.categorias || SP_CAT, ress = a?.resultados || { ok: 'Correcto', info: 'Informativo', rechazado: 'Rechazado', error: 'Error' };
  const opc = (obj, sel, todos) => `<option value="">${todos}</option>` + Object.entries(obj).map(([k, t]) => `<option value="${spEsc(k)}" ${sel === k ? 'selected' : ''}>${spEsc(t)}</option>`).join('');
  const usuarios = a?.usuarios || [];
  const r = a?.resumen?.resultado || {};
  const chipRes = (k, t, c) => `<button type="button" class="sp-filtro-chip ${c} ${f.resultado === k ? 'on' : ''}" onclick="spFiltro('resultado', ${spJs(f.resultado === k ? '' : k)})">${t}<em>${r[k] || 0}</em></button>`;
  const hayFiltro = f.q || f.categoria || f.resultado || f.usuario || f.desde || f.hasta;
  // Solo se repinta el formulario si no existe (para no perder el foco al escribir)
  if (!raiz.querySelector('.sp-filtros')) {
    raiz.innerHTML = `<form class="sp-filtros" onsubmit="event.preventDefault()" role="search" aria-label="Filtrar actividad">
        <label class="sp-campo ancho"><span>Buscar</span><input class="vn-input" type="search" id="spQ" placeholder="Pedido, acción, usuario o error…" value="${spEsc(f.q)}" oninput="spBuscar(this.value)"></label>
        <label class="sp-campo"><span>Área</span><select class="vn-input" id="spCat" onchange="spFiltro('categoria', this.value)"></select></label>
        <label class="sp-campo"><span>Resultado</span><select class="vn-input" id="spRes" onchange="spFiltro('resultado', this.value)"></select></label>
        <label class="sp-campo"><span>Usuario</span><select class="vn-input" id="spUsu" onchange="spFiltro('usuario', this.value)"></select></label>
        <label class="sp-campo"><span>Desde</span><input class="vn-input" type="date" id="spDesde" value="${spEsc(f.desde)}" onchange="spFiltro('desde', this.value)"></label>
        <label class="sp-campo"><span>Hasta</span><input class="vn-input" type="date" id="spHasta" value="${spEsc(f.hasta)}" onchange="spFiltro('hasta', this.value)"></label>
        <div class="sp-filtros-acc"><button type="button" class="vn-btn ghost sp-filtros-toggle" id="spFiltrosBtn" aria-expanded="false" onclick="spAlternarFiltros(this)">${spIco('ajustes')} Filtros</button>
          <button type="button" class="vn-btn ghost" id="spLimpiarBtn" onclick="spLimpiar()">Limpiar</button>
          <button type="button" class="vn-btn" onclick="spExportar()">${spIco('respaldo')} Exportar CSV</button></div>
      </form>
      <div id="spResumen"></div><div id="spTabla"></div>`;
  }
  const setSel = (id, html, v) => { const el = document.getElementById(id); if (el) { el.innerHTML = html; el.value = v; } };
  setSel('spCat', opc(cats, f.categoria, 'Todas'), f.categoria);
  setSel('spRes', opc(ress, f.resultado, 'Todos'), f.resultado);
  setSel('spUsu', `<option value="">Todos</option>` + [...new Set([...(f.usuario ? [f.usuario] : []), ...usuarios])].map(u => `<option value="${spEsc(u)}">${spEsc(u)}</option>`).join(''), f.usuario);
  const q = document.getElementById('spQ'); if (q && document.activeElement !== q) q.value = f.q;
  ['spDesde', 'spHasta'].forEach((id, i) => { const el = document.getElementById(id); if (el) el.value = i ? f.hasta : f.desde; });
  const lb = document.getElementById('spLimpiarBtn'); if (lb) lb.disabled = !hayFiltro;
  const nf = ['categoria', 'resultado', 'usuario', 'desde', 'hasta'].filter(k => f[k]).length;
  const fb = document.getElementById('spFiltrosBtn'); if (fb) fb.innerHTML = `${spIco('ajustes')} Filtros${nf ? ` <em>${nf}</em>` : ''}`;

  document.getElementById('spResumen').innerHTML = a ? `<div class="sp-resumen" role="group" aria-label="Resultados">
      <span class="sp-total"><b>${a.total.toLocaleString('es-MX')}</b> evento${a.total === 1 ? '' : 's'}${hayFiltro ? ' con estos filtros' : ''}</span>
      ${chipRes('ok', 'Correctos', 'verde')}${chipRes('info', 'Informativos', 'azul')}${chipRes('rechazado', 'Rechazados', 'ambar')}${chipRes('error', 'Errores', 'rojo')}
    </div>` : '';

  const tabla = document.getElementById('spTabla');
  if (SP.errorAct) { tabla.innerHTML = `<div class="sp-aviso rojo">${spEsc(SP.errorAct)} <button type="button" class="vn-btn chico" onclick="spCargarActividad()">Reintentar</button></div>`; return; }
  if (!a) { tabla.innerHTML = '<div class="sp-cargando"><span class="vn-spin"></span>Cargando actividad…</div>'; return; }
  if (!a.eventos.length) { tabla.innerHTML = `<div class="sp-vacio">${hayFiltro ? 'Ningún evento coincide con estos filtros.' : 'Todavía no hay actividad registrada. Aparecerá aquí en cuanto haya pagos, pedidos o cambios en el panel.'}</div>`; return; }

  const desde = (a.pagina - 1) * a.porPagina + 1, hasta = Math.min(a.total, a.pagina * a.porPagina);
  const paginas = typeof paginacionNumeros === 'function' ? paginacionNumeros(a.pagina - 1, a.paginas).map(x => x === '...' ? x : x + 1) : Array.from({ length: a.paginas }, (_, i) => i + 1);
  tabla.innerHTML = `<div class="sp-tabla-envuelta ${SP.cargandoAct ? 'sp-cargando-suave' : ''}"><table class="sp-tabla sp-resp sp-act">
      <thead><tr><th>Fecha y hora</th><th>Área</th><th>Acción</th><th>Usuario</th><th>Relacionado</th><th>Resultado</th><th class="sp-col-ico"><span class="sr">Detalle</span></th></tr></thead>
      <tbody>${a.eventos.map(e => { const [c, t] = SP_RES[e.resultado] || ['gris', e.resultado]; const abierto = SP.abiertos.has(e.id);
        return `<tr class="${abierto ? 'abierto' : ''} res-${spEsc(e.resultado)}">
          <td data-l="Fecha" title="${spEsc(new Date(e.en).toLocaleString('es-MX'))}"><span class="sp-fecha">${spFecha(e.en)}</span><small>${spHace(e.en)}</small></td>
          <td data-l="Área">${spChip('gris', cats[e.categoria] || e.categoria)}</td>
          <td data-l="Acción" class="sp-accion">${spEsc(e.accion)}${e.error?.mensaje && !abierto ? `<small class="sp-rojo">${spEsc(e.error.mensaje)}</small>` : ''}</td>
          <td data-l="Usuario">${spEsc(e.usuario)}</td>
          <td data-l="Relacionado">${e.pedidoId ? `<button type="button" class="sp-link" onclick="spHistorial(${spJs(e.pedidoId)})">${spEsc(e.pedidoId)}</button>` : ''}${e.prendaId ? `${e.pedidoId ? '<br>' : ''}<span class="sp-gris">Prenda #${e.prendaId}</span>` : ''}${!e.pedidoId && !e.prendaId ? '<span class="sp-gris">—</span>' : ''}</td>
          <td data-l="Resultado">${spChip(c, t)}</td>
          <td class="sp-col-ico"><button type="button" class="sp-abrir" aria-expanded="${abierto}" aria-label="Ver detalle" onclick="spAbrir(${spJs(e.id)})">${spIco(abierto ? 'arriba' : 'abajo', 16)}</button></td>
        </tr>${abierto ? `<tr class="sp-fila-det"><td colspan="7">${spDetalle(e)}</td></tr>` : ''}`; }).join('')}</tbody>
    </table></div>
    <nav class="sp-pag" aria-label="Páginas">
      <span>${desde.toLocaleString('es-MX')}–${hasta.toLocaleString('es-MX')} de ${a.total.toLocaleString('es-MX')}</span>
      <div class="sp-pag-nums">
        <button type="button" class="pg-arrow" ${a.pagina <= 1 ? 'disabled' : ''} onclick="spPagina(${a.pagina - 1})" aria-label="Anterior">‹</button>
        ${paginas.map(x => x === '...' ? '<span class="pg-ellipsis">···</span>' : `<button type="button" class="pg-num ${x === a.pagina ? 'active' : ''}" onclick="spPagina(${x})" ${x === a.pagina ? 'aria-current="page"' : ''}>${x}</button>`).join('')}
        <button type="button" class="pg-arrow" ${a.pagina >= a.paginas ? 'disabled' : ''} onclick="spPagina(${a.pagina + 1})" aria-label="Siguiente">›</button>
      </div>
      <label class="sp-por">Por página <select class="vn-input" onchange="SP.f.porPagina = Number(this.value); spPagina(1)">${[25, 50, 100].map(n => `<option ${n === a.porPagina ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    </nav>`;
}

// ═════════════════════════════════════════════════════════════
//  HISTORIAL DE UN PEDIDO (ventana)
// ═════════════════════════════════════════════════════════════
let _spFocoAntes = null;
function spCerrarModal() {
  document.getElementById('spModal')?.remove();
  document.removeEventListener('keydown', spTeclaModal);
  if (_spFocoAntes?.focus) _spFocoAntes.focus();
}
function spTeclaModal(e) {
  if (document.getElementById('dlg')?.classList.contains('open')) return;   // hay un diálogo de confirmación encima
  if (e.key === 'Escape') return spCerrarModal();
  if (e.key !== 'Tab') return;
  const caja = document.querySelector('#spModal .sp-modal'); if (!caja) return;
  const f = [...caja.querySelectorAll('button, a[href], input, select, textarea')].filter(x => !x.disabled);
  if (!f.length) return;
  if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
  else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
}
async function spHistorial(id) {
  spCerrarModal();
  _spFocoAntes = document.activeElement;
  const fondo = document.createElement('div');
  fondo.id = 'spModal'; fondo.className = 'sp-modal-fondo sp';
  fondo.innerHTML = `<div class="sp-modal" role="dialog" aria-modal="true" aria-labelledby="spModalTit">
      <header class="sp-modal-cab"><div><small>Historial del pedido</small><h2 id="spModalTit">${spEsc(id)}</h2></div>
      <button type="button" class="sp-cerrar" onclick="spCerrarModal()" aria-label="Cerrar">${spIco('equis', 18)}</button></header>
      <div class="sp-modal-cuerpo"><div class="sp-cargando"><span class="vn-spin"></span>Cargando historial…</div></div></div>`;
  fondo.addEventListener('click', e => { if (e.target === fondo) spCerrarModal(); });
  document.body.appendChild(fondo);
  document.addEventListener('keydown', spTeclaModal);
  fondo.querySelector('.sp-cerrar').focus();
  let d;
  try { d = await spApi('v-pedido-historial', `&id=${encodeURIComponent(id)}`); }
  catch (e) { fondo.querySelector('.sp-modal-cuerpo').innerHTML = `<div class="sp-aviso rojo">${spEsc(e.message)}</div>`; return; }
  if (!document.getElementById('spModal')) return;
  const p = d.pedido, [c, t] = SP_PED_ESTADO[p.estado] || ['gris', p.estado];
  const ee = { pendiente: 'sin entregar', enviado: 'enviado', entregado: 'entregado' }[p.entregaEstado] || p.entregaEstado;
  fondo.querySelector('#spModalTit').insertAdjacentHTML('afterend', spChip(c, t));
  fondo.querySelector('.sp-modal-cuerpo').innerHTML = `
    <dl class="sp-resumen-ped">
      <div><dt>Cliente</dt><dd>${spEsc(p.nombre)}</dd></div>
      <div><dt>Total</dt><dd>${spPesos(p.total)}${p.modalidad === 'apartado' ? ` <span class="sp-gris">(anticipo ${spPesos(p.anticipo)}, resto ${spPesos(p.resta)})</span>` : ''}</dd></div>
      <div><dt>Pago</dt><dd>${p.proveedor === 'paypal' ? 'PayPal' : 'Clip'}${p.cupon ? ` · cupón ${spEsc(p.cupon)}` : ''}</dd></div>
      <div><dt>Entrega</dt><dd>${p.entrega === 'envio' ? 'Envío' : 'En persona'} · ${spEsc(ee)}</dd></div>
      <div><dt>Creado</dt><dd>${spFecha(p.en)}</dd></div>
      ${p.liquidarAntes && p.estado === 'apartado' ? `<div><dt>Liquidar antes</dt><dd>${spFecha(p.liquidarAntes)}</dd></div>` : ''}
      ${p.canceladoEn ? `<div><dt>Cancelado</dt><dd>${spFecha(p.canceladoEn)}${p.canceladoPor ? ` por ${spEsc(p.canceladoPor)}` : ''}${p.motivoCancelacion ? `<br><span class="sp-gris">${spEsc(p.motivoCancelacion)}</span>` : ''}</dd></div>` : ''}
    </dl>
    ${(d.alertas || []).map(a => `<div class="sp-aviso ${a.nivel === 'rojo' ? 'rojo' : ''}">${spEsc(a.texto)}</div>`).join('')}

    <h3 class="sp-h">Prendas ${d.consistente ? spChip('verde', 'Todo coincide') : spChip('rojo', 'Revisar')}</h3>
    <ul class="sp-prendas">${d.prendas.map(x => `<li class="${x.ok ? '' : 'mal'}">${x.imagen ? `<img src="${spEsc(x.imagen)}" alt="" loading="lazy">` : '<span class="sp-sinfoto"></span>'}
      <div><b>${spEsc(x.nombre)}</b><span>${spPesos(x.precio)} · ${spEsc(x.estado)}${x.yaVendida ? ' · ya estaba vendida al pagar' : ''}</span></div>
      ${x.ok ? `<span class="sp-ok" aria-label="Coincide">${spIco('check', 16)}</span>` : `<span class="sp-mal" aria-label="No coincide">${spIco('alerta', 16)}</span>`}</li>`).join('')}</ul>

    <h3 class="sp-h">Historial ${d.reconstruido ? '<small class="sp-gris">(armado con las fechas del pedido: es de antes de la v33)</small>' : ''}</h3>
    <ol class="sp-linea">${[...d.historial].reverse().map(h => `<li class="${h.resultado === 'error' ? 'error' : ''}">
      <time>${spFecha(h.en)}</time><div><b>${spEsc(h.accion)}</b>
      <span>${h.de || h.a ? `${h.de ? spEsc((SP_PED_ESTADO[h.de] || [0, h.de])[1]) + ' → ' : ''}${spEsc((SP_PED_ESTADO[h.a] || [0, h.a || ''])[1])} · ` : ''}${spEsc(h.por || 'sistema')}</span></div></li>`).join('')}</ol>

    ${(d.eventos || []).length ? `<details class="sp-eventos"><summary>Eventos relacionados (${d.eventos.length})</summary>
      <ul>${d.eventos.map(e => { const [cc, tt] = SP_RES[e.resultado] || ['gris', e.resultado]; return `<li><time>${spFecha(e.en)}</time> ${spChip(cc, tt)} <span>${spEsc(e.accion)}</span>${e.error?.mensaje ? `<small class="sp-rojo">${spEsc(e.error.mensaje)}</small>` : ''}</li>`; }).join('')}</ul></details>` : ''}

    <footer class="sp-modal-pie">
      ${d.acciones.revisar ? `<button type="button" class="vn-btn" onclick="spAccionPedido(${spJs(p.id)}, 'revisar', this)">${spIco('recargar')} Revisar pago</button>` : ''}
      ${d.acciones.cancelar ? `<button type="button" class="vn-btn ghost peligro" onclick="spAccionPedido(${spJs(p.id)}, 'cancelar', this)">${spIco('equis')} Cancelar pedido</button>` : ''}
      <button type="button" class="vn-btn negro" onclick="spCerrarModal()">Cerrar</button>
    </footer>`;
}

// Acciones desde la ventana del historial (y desde Pedidos en línea)
async function spAccionPedido(id, accion, btn) {
  let motivo;
  if (accion === 'cancelar') {
    if (typeof _dlgAbrir !== 'function') { if (!confirm('¿Cancelar este pedido?')) return; }
    else {
      motivo = await _dlgAbrir({ titulo: '¿Cancelar este pedido?', sub: id, ok: 'Cancelar pedido', cancelar: 'No, dejarlo', peligro: true,
        cuerpo: `<p class="dlg-msg">Antes se confirma con Clip/PayPal que no haya pagado. Si ya pagó, no se cancela. Las prendas vuelven a la tienda.</p>
          <label class="sp-campo ancho"><span>Motivo (opcional, queda en el historial)</span><textarea id="spMotivo" class="vn-input" rows="2" maxlength="200" placeholder="Ej. el cliente avisó que ya no lo quiere"></textarea></label>`,
        leer: () => document.getElementById('spMotivo')?.value.trim() || '', cancelarValor: null });
      if (motivo === null) return;
    }
  }
  const txt = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.textContent = accion === 'cancelar' ? 'Cancelando…' : 'Revisando…'; }
  try {
    const r = await spApi('v-pedido-estado', '', { id, accion, ...(motivo ? { motivo } : {}) });
    toast(accion === 'cancelar' ? 'Pedido cancelado' : r.cambio ? `Pago revisado: el pedido quedó ${r.estado}` : r.enProceso ? 'El pago sigue en proceso' : 'Pago revisado: sin cambios',
      { tipo: accion === 'cancelar' ? 'info' : 'ok', origen: 'pedidos', cuerpo: accion === 'cancelar' && r.liberadas ? `${r.liberadas} prenda(s) volvieron a la tienda` : id });
  } catch (e) {
    toast(e.message, { tipo: e.status === 409 ? 'alerta' : 'error', origen: 'pedidos', titulo: accion === 'cancelar' ? 'No se canceló' : 'No se pudo revisar', cuerpo: e.message });
  }
  if (btn && document.body.contains(btn)) { btn.disabled = false; btn.innerHTML = txt; }
  if (document.getElementById('spModal')) spHistorial(id);
  if (typeof vnCargarPedidos === 'function' && typeof VN !== 'undefined' && VN.pedidos) vnCargarPedidos();
  if (SP.monitor) spCargarMonitor(true);
}

// Ir al monitor desde otras pestañas (p. ej. el aviso de Pedidos en línea)
function spIrMonitor() {
  SP.sec = 'monitor';
  if (typeof showTab === 'function') showTab('sistema'); else spIr('monitor');
}

// Al cargar: solo la sección elegida a la vista (sin pedir datos hasta abrir Sistema)
(function spInicio() {
  const sec = SP.sec;
  document.querySelectorAll('#spTabs [data-sp]').forEach(b => { const on = b.dataset.sp === sec; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
  document.querySelectorAll('#view-sistema [data-sp-sec]').forEach(s => s.classList.toggle('sp-oculta', s.dataset.spSec !== sec));
})();

// v41 · Probar los avisos al celular (Telegram) y por correo
async function spProbarAvisos(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Probando…'; }
  try {
    const r = await spApi('v-avisos-prueba', '', {});
    const lineas = [r.telegram && 'Telegram: ' + r.telegram, r.correo && 'Correo: ' + r.correo, r.chatId && 'Tu número de chat: ' + r.chatId].filter(Boolean);
    toast('Prueba de avisos', { tipo: r.telegramListo || r.correoListo || r.chatId ? 'ok' : 'info', origen: 'general', detalles: lineas, fijo: !!r.chatId,
      acciones: r.chatId ? [{ texto: 'Copiar número', al: () => Avisos.copiar(r.chatId), principal: true }] : [] });
  } catch (e) { toast(e.message, { tipo: 'error', titulo: 'No se pudo probar', cuerpo: e.message || '' }); }
  if (btn) { btn.disabled = false; btn.textContent = 'Probar aviso'; }
}
