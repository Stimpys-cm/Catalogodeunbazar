// ─────────────────────────────────────────────────────────────
//  js/automatico.js — Lo que el sistema hace solo
//   · Panel de Instagram → "Automático" (ajustes + bitácora)
//   · Panel de Instagram → "Reporte" (ventas y posts)
//   · Aviso de token por vencer
//   · Apartados con fecha límite (cards del inventario)
//   · Drops → carrusel en Instagram + historias de anuncio
// Usa IG, igApi, igEsc, igCabecera, I (instagram-panel.js) y api,
// toast, _dlgAbrir, getDB, getDrops (admin.js / db.js).
// ─────────────────────────────────────────────────────────────

const AUTO_ICONOS = {
  rebaja: 'fuego', respuesta: 'chat', historia: 'chispas', apartado: 'reloj', 'post-borrado': 'escoba', error: 'alerta',
};
const autoNum = n => Number(n || 0).toLocaleString('es-MX');
const autoFecha = iso => {
  const d = new Date(iso); if (isNaN(d)) return '';
  return d.toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

// ── Aviso de token ───────────────────────────────────────────
function igAvisoToken(t) {
  if (!t) return '';
  if (t.valido === false) return `<div class="aut-aviso rojo"><b>El token de Instagram ya no es válido.</b>
    Genera uno nuevo en el Graph API Explorer, extiéndelo a 60 días y ponlo en Vercel (IG_STIIMPYS_TOKEN). Mientras tanto no se publica nada.</div>`;
  if (!t.vence) return '';
  const dias = Math.ceil((new Date(t.vence) - Date.now()) / 86400000);
  if (dias > 14) return '';
  return `<div class="aut-aviso ${dias <= 3 ? 'rojo' : ''}"><b>${dias <= 0 ? 'El token de Instagram venció' : `El token de Instagram vence en ${dias} día${dias === 1 ? '' : 's'}`}</b>
    (${new Date(t.vence).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}). Renuévalo: Graph API Explorer → Generate Access Token →
    Access Token Debugger → "Extend Access Token" → pégalo en Vercel (IG_STIIMPYS_TOKEN) → Redeploy.</div>`;
}

// ═════════════════════════════════════════════════════════════
//  AUTOMÁTICO
// ═════════════════════════════════════════════════════════════
async function igCargarAuto() {
  IG.cargandoAuto = true;
  try { IG.auto = await igApi('ig-automatico'); }
  catch (e) { IG.auto = { log: [], error: e.message }; }
  IG.cargandoAuto = false;
  if (IG.vista === 'auto') igRefrescar();
}

function igVistaAuto() {
  const a = IG.estado?.config?.automatico || {};
  const admin = typeof isAdmin === 'function' ? isAdmin() : true;
  const dis = admin ? '' : 'disabled';
  const sw = (k, titulo, desc) => `
    <label class="igx-switch"><input type="checkbox" id="aut_${k}" ${a[k] ? 'checked' : ''} ${dis}><span class="igx-switch-ui"></span>
      <span><b>${titulo}</b><small>${desc}</small></span></label>`;
  const num = (k, etiqueta, sufijo, min, max) => `
    <label class="aut-num"><span>${etiqueta}</span><input type="number" id="aut_${k}" value="${igEsc(a[k])}" min="${min}" max="${max}" ${dis}><em>${sufijo}</em></label>`;
  const log = IG.auto?.log || [];
  const tk = IG.auto?.token || IG.estado?.token;
  const dias = tk?.vence ? Math.ceil((new Date(tk.vence) - Date.now()) / 86400000) : null;

  return `
    ${igCabecera('Automático', 'Lo que el sistema hace solo, todos los días a las 9:00 a.m. y cada vez que abres este panel')}
    <div class="igx-col2 arriba">
      <div class="igx-card">
        <div class="igx-card-tit">Precios</div>
        ${sw('rebaja', 'Bajar precio a lo que no se vende', 'Cuando una prenda lleva varios días publicada sin venderse, baja su precio. En la tienda aparece tachado el precio anterior.')}
        <div class="aut-nums">
          ${num('rebajaDias', 'Después de', 'días', 3, 120)}
          ${num('rebajaPct', 'Bajar', '%', 5, 50)}
          ${num('rebajaMin', 'Nunca menos de', 'MXN', 0, 100000)}
          ${num('rebajaVeces', 'Máximo', 'rebajas', 1, 5)}
        </div>
        ${sw('rebajaComentar', 'Avisar en su post', 'Comenta "Nuevo precio: $X MXN (antes $Y)" en la publicación de la prenda.')}
        ${sw('rebajaHistoria', 'Subir historia de "Nuevo precio"', 'Con el diseño editorial y el precio anterior.')}
      </div>
      <div class="igx-card">
        <div class="igx-card-tit">Comentarios</div>
        ${sw('respuestas', 'Responder solo a quien pregunta', 'Si alguien comenta una palabra clave, se le contesta con el nombre, la talla, el precio y el link. Nunca responde dos veces al mismo comentario ni a comentarios de más de 7 días.')}
        <div class="fg"><label>Palabras clave (separadas por coma)</label>
          <input type="text" id="aut_respuestaPalabras" data-borrador="aut:respuestaPalabras" value="${igEsc(a.respuestaPalabras || '')}" maxlength="400" ${dis}></div>
        <div class="fg"><label>Respuesta (prenda disponible)</label>
          <textarea id="aut_respuestaTexto" data-borrador="aut:respuestaTexto" class="igx-textarea" rows="2" maxlength="400" ${dis}>${igEsc(a.respuestaTexto || '')}</textarea></div>
        <div class="fg"><label>Respuesta (prenda vendida)</label>
          <textarea id="aut_respuestaVendida" data-borrador="aut:respuestaVendida" class="igx-textarea" rows="2" maxlength="400" ${dis}>${igEsc(a.respuestaVendida || '')}</textarea></div>
        <p class="igx-nota mini">Puedes usar {usuario} {nombre} {talla} {precio} {link} {sitio}. Responde máximo 10 comentarios por vuelta.</p>
      </div>
    </div>
    <div class="igx-col2 arriba">
      <div class="igx-card">
        <div class="igx-card-tit">Historias y posts</div>
        ${sw('historiaNuevas', 'Historias de "Nuevo ingreso"', 'Cada mañana sube una historia por cada prenda que subiste en las últimas 24 horas.')}
        <div class="aut-nums">${num('historiaNuevasMax', 'Máximo', 'historias al día', 1, 10)}</div>
        ${sw('verificarPosts', 'Verificar que los posts sigan vivos', 'Si borraste un post desde la app, la prenda se desliga para que puedas volver a publicarla.')}
      </div>
      <div class="igx-card">
        <div class="igx-card-tit">Apartados</div>
        <div class="aut-nums">${num('apartadoHoras', 'Se liberan después de', 'horas', 6, 240)}</div>
        <p class="igx-nota mini">Desde cada prenda del inventario usa el botón <b>⏳ Apartar</b>. En la tienda sale como <b>Apartada</b> y si no se paga a tiempo vuelve a estar disponible sola. Aquí abajo te aparece un botón para avisarle al cliente por WhatsApp.</p>
        <div class="igx-sub">Token de Instagram</div>
        <p class="igx-nota mini">${tk?.vence ? `Vence el <b>${new Date(tk.vence).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}</b> (${dias} días). Te avisamos arriba 14 días antes.` : tk?.valido ? 'No tiene fecha de vencimiento.' : 'No se pudo leer.'}</p>
      </div>
    </div>
    ${admin ? `<div class="aut-btns">
      <button class="igx-btn grad grande" id="autGuardar" onclick="igGuardarAuto()">Guardar</button>
      <button class="igx-btn ghost" id="autCorrer" onclick="igCorrerAuto()">Correr ahora</button>
    </div>` : ''}
    <div class="igx-card">
      <div class="igx-card-tit">Lo que hizo el sistema${IG.auto?.diario ? ` · última vuelta diaria: ${igEsc(IG.auto.diario)}` : ''}</div>
      ${IG.cargandoAuto && !IG.auto ? '<div class="igx-cargando"><span class="igx-spin"></span>Cargando…</div>'
        : !log.length ? '<p class="igx-nota">Todavía no hay nada. Activa algo arriba y presiona "Correr ahora".</p>'
        : `<ul class="aut-log">${log.map(x => `<li class="t-${igEsc(x.tipo)}">
            <span class="aut-ic t-${x.tipo}">${ico(AUTO_ICONOS[x.tipo] || 'chispas', 16)}</span>
            <span class="aut-tx">${igEsc(x.texto)}<small>${autoFecha(x.en)}</small></span>
            ${x.whatsapp ? `<a class="igx-btn ghost mini" href="${igEsc(x.whatsapp)}" target="_blank" rel="noopener">Avisar por WhatsApp</a>` : ''}
          </li>`).join('')}</ul>`}
    </div>`;
}

function igLeerAuto() {
  const v = id => document.getElementById('aut_' + id);
  const o = {};
  for (const k of ['rebaja', 'rebajaComentar', 'rebajaHistoria', 'respuestas', 'historiaNuevas', 'verificarPosts']) o[k] = !!v(k)?.checked;
  for (const k of ['rebajaDias', 'rebajaPct', 'rebajaMin', 'rebajaVeces', 'historiaNuevasMax', 'apartadoHoras']) o[k] = Number(v(k)?.value);
  for (const k of ['respuestaPalabras', 'respuestaTexto', 'respuestaVendida']) o[k] = v(k)?.value || '';
  return o;
}

async function igGuardarAuto() {
  const btn = document.getElementById('autGuardar');
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    const r = await igApi('ig-config', { automatico: igLeerAuto() });
    IG.estado.config = r.config;
    toast('Automático guardado');
    if (typeof igBorrarTexto === 'function') ['respuestaPalabras', 'respuestaTexto', 'respuestaVendida'].forEach(k => igBorrarTexto('aut:' + k));
    igRefrescar();
  } catch (e) { toast(e.message); if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; } }
}

async function igCorrerAuto() {
  const btn = document.getElementById('autCorrer');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="igx-spin"></span> Corriendo…'; }
  try {
    await igApi('ig-config', { automatico: igLeerAuto() }).then(r => { IG.estado.config = r.config; });
    const r = await igApi('ig-correr-automatico', {});
    toast(r.hechos.length ? `Listo: ${r.hechos.length} acción(es)` : 'Listo: no había nada que hacer');
    IG.auto = null; igCargarAuto();
    if (typeof pollAhora === 'function') pollAhora(400);
  } catch (e) { toast(e.message); }
  if (btn) { btn.disabled = false; btn.textContent = 'Correr ahora'; }
}

// ═════════════════════════════════════════════════════════════
//  REPORTE
// ═════════════════════════════════════════════════════════════
async function igCargarReporte(dias) {
  IG.cargandoReporte = true; IG.reporteDias = dias || IG.reporteDias || 7;
  if (IG.vista === 'reporte') igRefrescar();
  try { IG.reporte = await igApi('ig-reporte', undefined, `&dias=${IG.reporteDias}`); }
  catch (e) { IG.reporte = { error: e.message }; }
  IG.cargandoReporte = false;
  if (IG.vista === 'reporte') igRefrescar();
}

function igVistaReporte() {
  const r = IG.reporte, d = IG.reporteDias || 7;
  const chips = [7, 30, 90].map(n => `<button class="igx-tono ${d === n ? 'on' : ''}" onclick="igCargarReporte(${n})">${n} días</button>`).join('');
  const cab = `${igCabecera('Reporte', 'Cómo van tus ventas y qué está funcionando')}<div class="aut-chips">${chips}</div>`;
  if (!r || IG.cargandoReporte) return cab + '<div class="igx-cargando"><span class="igx-spin"></span>Armando el reporte…</div>';
  if (r.error) return cab + `<div class="igx-alerta">${igEsc(r.error)}</div>`;
  const kpi = (n, t, s = '') => `<div class="aut-kpi"><b>${n}</b><span>${t}</span>${s ? `<small>${s}</small>` : ''}</div>`;
  const tabla = (lista, titulo) => `<div class="igx-card"><div class="igx-card-tit">${titulo}</div>
    ${lista.length ? `<table class="aut-tabla"><thead><tr><th></th><th>Vendidas</th><th>Ingresos</th><th>Días en venderse</th></tr></thead><tbody>
      ${lista.map(x => `<tr><td>${igEsc(x.nombre)}</td><td>${x.vendidas}</td><td>$${autoNum(x.ingresos)}</td><td>${x.diasPromedio ?? '—'}</td></tr>`).join('')}
    </tbody></table>` : '<p class="igx-nota">Sin ventas en este periodo.</p>'}</div>`;
  return `${cab}
    <div class="aut-kpis">
      ${kpi(r.vendidas, 'vendidas')}
      ${kpi('$' + autoNum(r.ingresos), 'ingresos', r.ganancia ? `$${autoNum(r.ganancia)} de ganancia` : '')}
      ${kpi(r.diasPromedio ?? '—', 'días promedio', 'en venderse')}
      ${kpi(r.nuevas, 'prendas nuevas')}
      ${kpi(r.disponibles, 'disponibles', r.sinVender30 ? `${r.sinVender30} con más de 30 días` : '')}
    </div>
    <div class="igx-col2 arriba">${tabla(r.marcas, 'Marcas que más se venden')}${tabla(r.tallas, 'Tallas que más se venden')}</div>
    <div class="igx-card"><div class="igx-card-tit">Tus posts con más interacción (últimos 24)</div>
      ${r.posts.length ? `<div class="aut-posts">${r.posts.map(p => `<a href="${igEsc(p.permalink)}" target="_blank" rel="noopener">
          <img src="${igEsc(igPx(p.miniatura))}" alt="" loading="lazy">
          <span>${igEsc(p.texto || 'Publicación')}</span><em>${ico('corazon', 13)} ${autoNum(p.likes)} ${ico('chat', 13)} ${autoNum(p.comentarios)}</em></a>`).join('')}</div>`
        : '<p class="igx-nota">No se pudieron leer los posts.</p>'}
    </div>
    ${r.sinVender30 ? `<p class="igx-nota">${ico('foco', 15)} Tienes ${r.sinVender30} prenda(s) con más de 30 días. En <b>Automático</b> puedes activar que bajen de precio solas.</p>` : ''}`;
}

// ═════════════════════════════════════════════════════════════
//  APARTADOS (cards del inventario)
// ═════════════════════════════════════════════════════════════
function apRestante(p) {
  const ms = new Date(p.reservedUntil) - Date.now();
  if (!(ms > 0)) return 'vence ya';
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h >= 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h} h ${m} min`;
}

function apChip(p) {
  if (!p.apartada || p.vendido) return '';
  const c = p.reservedBy || {};
  const reloj = typeof ico === 'function' ? ico('reloj', 13) : '⏳';   // v56: ícono de línea
  // v56: si el apartado ya venció, el panel lo dice (la tienda ya la muestra disponible y se suelta sola)
  if (!c.anticipo && p.reservedUntil && new Date(p.reservedUntil) <= Date.now())
    return `<div class="ap-chip ap-chip-vencido">${reloj} Apartado vencido${c.nombre ? ` (${escAdmin(c.nombre)})` : ''} · ya está disponible en la tienda</div>`;
  // v36: alguien la está pagando en línea (apartado de 10 min): contador en vivo
  if (c.pedido && !c.anticipo && p.reservedUntil && new Date(p.reservedUntil) > Date.now() && window.Contador)
    return `<div class="ap-chip ap-chip-pago">${reloj} Pagando en línea${c.nombre ? `: <b>${escAdmin(String(c.nombre).split(' ')[0])}</b>` : ''} · ${Contador.html(p.reservedUntil, { fin: 'se liberó' })}</div>`;
  return `<div class="ap-chip">${reloj} Apartada${c.nombre ? ` por <b>${escAdmin(c.nombre)}</b>` : ''} · ${p.reservedUntil ? apRestante(p) : ''}</div>`;
}

function apBotonPrenda(p) {
  if (p.vendido) return '';
  const icono = typeof ico === 'function' ? ico('reloj', 18) : '⏳';   // v56: ícono de línea como los demás botones
  return p.apartada
    ? `<button class="act-btn ap on" onclick="apLiberar(${p.id})" title="Quitar apartado" aria-label="Quitar apartado">${icono}</button>`
    : `<button class="act-btn ap" onclick="apAbrir(${p.id})" title="Apartar con fecha límite" aria-label="Apartar">${icono}</button>`;
}

async function apAbrir(id) {
  const p = getDB().find(x => x.id === id); if (!p) return;
  const horas = (typeof bazarDePrenda === 'function' && bazarDePrenda(p.bazarId)?.instagramConfig?.automatico?.apartadoHoras) || 48;
  const datos = await _dlgAbrir({
    titulo: 'Apartar prenda', sub: p.nombre, ok: 'Apartar',
    cuerpo: `
      <label class="dlg-campo"><span>Nombre del cliente</span><input type="text" id="apNombre" maxlength="80" autocomplete="off"></label>
      <label class="dlg-campo"><span>WhatsApp (10 dígitos)</span><input type="tel" id="apTel" maxlength="16" inputmode="tel" autocomplete="off"></label>
      <label class="dlg-campo"><span>Horas para pagar</span><input type="number" id="apHoras" value="${horas}" min="1" max="240"></label>
      <p class="dlg-msg">En la tienda saldrá como "Apartada". Si no la pagan a tiempo, vuelve a estar disponible sola y te aparece un botón para avisarle al cliente.</p>`,
    leer: () => ({ nombre: document.getElementById('apNombre').value, telefono: document.getElementById('apTel').value, horas: Number(document.getElementById('apHoras').value) }),
  });
  if (!datos) return;
  try {
    const r = await api(`/api/inventario-item?op=apartar&id=${id}`, { method: 'POST', body: { accion: 'apartar', ...datos } });
    Object.assign(p, { apartada: true, reservedUntil: r.hasta, reservedBy: { nombre: datos.nombre, telefono: datos.telefono } });
    toast(`Apartada hasta ${new Date(r.hasta).toLocaleString('es-MX', { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`);
    if (typeof registrarLog === 'function') registrarLog('apartado', p.nombre, datos.nombre || '');
    if (typeof renderAll === 'function') renderAll();
  } catch (e) { toast(e.message); }
}

async function apLiberar(id) {
  const p = getDB().find(x => x.id === id); if (!p) return;
  const ok = await uiConfirm({ titulo: 'Quitar apartado', mensaje: `"${p.nombre}" vuelve a estar disponible en la tienda.`, ok: 'Quitar apartado' });
  if (!ok) return;
  try {
    await api(`/api/inventario-item?op=apartar&id=${id}`, { method: 'POST', body: { accion: 'liberar' } });
    p.apartada = false; delete p.reservedUntil; delete p.reservedBy;
    toast('Apartado quitado');
    if (typeof renderAll === 'function') renderAll();
  } catch (e) { toast(e.message); }
}

// ═════════════════════════════════════════════════════════════
//  DROPS → Instagram
// ═════════════════════════════════════════════════════════════
function dropBotonIg(d) {
  if (d.igId) return d.igUrl ? `<a class="drop-btn drop-btn-edit" href="${escAdmin(d.igUrl)}" target="_blank" rel="noopener">Ver en Instagram</a>` : '';
  return `<button class="drop-btn drop-btn-edit" onclick="dropIg('${escAdmin(d.id)}')">${ico('instagram', 15)} Instagram</button>`;
}

async function dropIg(dropId) {
  const d = (typeof getDrops === 'function' ? getDrops() : []).find(x => x.id === dropId); if (!d) return;
  const futuro = new Date(d.fecha) > Date.now() + 70 * 60000;
  const op = await _dlgAbrir({
    titulo: 'Drop en Instagram', sub: d.nombre, ok: 'Programar',
    cuerpo: `
      <p class="dlg-msg">A la hora del drop se publica un carrusel: portada "DROP · ${escAdmin(d.nombre)}" y una foto con la plantilla de cada prenda (máx. 9), con la lista de precios en el texto. Cuando vendas una, también se comenta en el carrusel.</p>
      <label class="dlg-check"><input type="checkbox" id="drAnunciar" checked> Subir ahora una historia de anuncio con la fecha</label>
      ${futuro ? '<label class="dlg-check"><input type="checkbox" id="drRecordar" checked> Historia de "Falta 1 hora" antes del drop</label>' : ''}
      <p class="dlg-msg"><small>${new Date(d.fecha) > Date.now() ? `Sale el ${new Date(d.fecha).toLocaleString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}.` : 'La fecha ya pasó: el carrusel sale en 2 minutos.'}</small></p>`,
    leer: () => ({ anunciar: !!document.getElementById('drAnunciar')?.checked, recordatorio: !!document.getElementById('drRecordar')?.checked }),
  });
  if (!op) return;
  try {
    const r = await igApi('ig-drop', { dropId, ...op });
    toast(r.hechos.join(' · '));
    if (typeof IG !== 'undefined') IG.programados = null;
  } catch (e) { toast(e.message); }
}
