/* ═════════════════════════════════════════════════════════════
   Panel → Borradores (v52)
   Las prendas que ya subiste en el Registro rápido y todavía no registras.
   Se guardan solas en el servidor (se ven desde cualquier dispositivo).
   Desde aquí: registrar una o varias (se abren en "Revisar" con todo lo que
   ya llenó la IA), agregar más fotos, o borrarlas.
   ═════════════════════════════════════════════════════════════ */
const BR = { lista: null, sel: new Set(), lote: '', cargando: false, error: '' };

async function brCargar() {
  BR.cargando = true; BR.error = '';
  try {
    const r = await api('/api/acciones?op=b-lista');   // el servidor ya da solo los de tu bazar (el admin global ve todos)
    BR.lista = Array.isArray(r?.borradores) ? r.borradores : [];
    const ids = new Set(BR.lista.map(d => d.id));
    BR.sel.forEach(id => { if (!ids.has(id)) BR.sel.delete(id); });
  } catch (e) { BR.error = e.message || 'No se pudieron cargar los borradores'; if (!BR.lista) BR.lista = []; }
  BR.cargando = false;
  brGlobo();
}
// Globito con cuántos hay (en el menú)
function brGlobo() {
  const b = document.getElementById('brGlobo'); if (!b) return;
  const n = BR.lista?.length || 0;
  b.textContent = n > 99 ? '99+' : String(n); b.classList.toggle('hidden', !n);
}
let _brContarT = 0;
function brContar() {
  clearTimeout(_brContarT);
  _brContarT = setTimeout(async () => { await brCargar(); if (currentTab === 'borradores') brPintar(); }, 400);
}

async function brAbrir() {
  const v = document.getElementById('brCaja'); if (!v) return;
  if (!BR.lista) v.innerHTML = '<div class="br-vacio"><span class="zi-spin"></span> Cargando borradores…</div>';
  await brCargar(); brPintar();
}

const brMini = u => String(u || '').replace('/upload/', '/upload/c_fill,w_300,h_375,q_auto,f_auto/');
const brPrecio = v => v === '' || v == null || !(Number(v) > 0) ? '' : '$' + Number(v).toLocaleString('es-MX');
const brFecha = iso => { try { return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

function brPintar() {
  const v = document.getElementById('brCaja'); if (!v) return;
  const todos = BR.lista || [];
  const lotes = [...new Set(todos.map(d => d.lote || 'Sin lote'))];
  if (BR.lote && !lotes.includes(BR.lote)) BR.lote = '';
  const lista = BR.lote ? todos.filter(d => (d.lote || 'Sin lote') === BR.lote) : todos;
  const nSel = lista.filter(d => BR.sel.has(d.id)).length;
  if (!todos.length) {
    v.innerHTML = `${BR.error ? `<div class="zi-error">${escAdmin(BR.error)}</div>` : ''}
      <div class="br-vacio">
        <b>No tienes borradores</b>
        <p>Cuando subes fotos en el Registro rápido, cada prenda se guarda aquí sola hasta que la registras. Así no se pierde nada si cierras la ventana o cambias de dispositivo.</p>
        <button class="zi-btn negro" onclick="ziAbrir()">＋ Nuevo registro rápido</button>
      </div>`;
    return;
  }
  v.innerHTML = `
    ${BR.error ? `<div class="zi-error">${escAdmin(BR.error)}</div>` : ''}
    <div class="br-barra">
      <div class="br-barra-izq">
        <label class="zi-check sola"><input type="checkbox" ${nSel && nSel === lista.length ? 'checked' : ''} onchange="brTodos(this.checked)"> Todos</label>
        ${lotes.length > 1 ? `<select class="br-lote" onchange="BR.lote=this.value;brPintar()" aria-label="Lote">
          <option value="">Todos los lotes (${todos.length})</option>
          ${lotes.map(l => `<option value="${escAdmin(l)}" ${l === BR.lote ? 'selected' : ''}>${escAdmin(l)} (${todos.filter(d => (d.lote || 'Sin lote') === l).length})</option>`).join('')}
        </select>` : `<span class="br-cuenta">${todos.length} borrador${todos.length === 1 ? '' : 'es'}</span>`}
      </div>
      <div class="br-barra-der">
        <button class="zi-btn" onclick="ziAbrir()">＋ Nuevo registro rápido</button>
        <button class="zi-btn" onclick="brBorrar()" ${nSel ? '' : 'disabled'}>Borrar${nSel ? ` (${nSel})` : ''}</button>
        <button class="zi-btn negro" onclick="brRegistrar()" ${nSel ? '' : 'disabled'}>Registrar${nSel ? ` ${nSel}` : ''}</button>
      </div>
    </div>
    <div class="br-rejilla">${lista.map(d => {
      const f = d.f || {}, ia = d.ia || {};
      const nombre = f.nombre || ia.nombre || 'Sin nombre todavía';
      const datos = [f.talla, f.marca].filter(Boolean).map(escAdmin).join(' · ');
      const listo = !!(f.nombre && Number(f.precio) > 0);
      return `<article class="br-card${BR.sel.has(d.id) ? ' sel' : ''}" data-id="${escAdmin(d.id)}">
        <label class="br-foto" title="Seleccionar">
          <input type="checkbox" ${BR.sel.has(d.id) ? 'checked' : ''} onchange="brMarcar('${escAdmin(d.id)}', this.checked)" aria-label="Seleccionar ${escAdmin(nombre)}">
          <img src="${escAdmin(brMini(d.fotos[0]))}" alt="" loading="lazy" decoding="async">
          <span class="br-nfotos">${d.fotos.length} foto${d.fotos.length === 1 ? '' : 's'}</span>
        </label>
        <div class="br-info">
          <b class="br-nombre">${escAdmin(nombre)}</b>
          <span class="br-datos">${datos || '&nbsp;'}</span>
          <span class="br-precio">${brPrecio(f.precio) || '<i>sin precio</i>'}</span>
          <span class="br-meta">${d.ia ? (listo ? '<em class="ok">Lista para registrar</em>' : '<em>Revisar datos</em>') : '<em>Falta analizar con IA</em>'}</span>
          <small class="br-lote-txt">${escAdmin(d.lote || 'Sin lote')} · ${escAdmin(brFecha(d.actualizado || d.en))}</small>
        </div>
        <div class="br-acc">
          <button class="zi-btn mini negro" onclick="brRegistrar(['${escAdmin(d.id)}'])">Registrar</button>
          <button class="zi-btn mini" onclick="brBorrar(['${escAdmin(d.id)}'])" aria-label="Borrar ${escAdmin(nombre)}">Borrar</button>
        </div>
      </article>`;
    }).join('')}</div>
    <p class="br-nota">Para <b>agregar más fotos</b> a una prenda, ábrela con <b>Registrar</b> y toca <b>＋ Fotos</b>. Para más prendas, en el registro rápido toca <b>＋ Agregar más prendas</b>.</p>`;
}
function brMarcar(id, on) { on ? BR.sel.add(id) : BR.sel.delete(id); brPintar(); }
function brTodos(on) {
  const lista = (BR.lista || []).filter(d => !BR.lote || (d.lote || 'Sin lote') === BR.lote);
  lista.forEach(d => on ? BR.sel.add(d.id) : BR.sel.delete(d.id)); brPintar();
}
async function brRegistrar(ids) {
  ids = ids || [...BR.sel];
  const lista = (BR.lista || []).filter(d => ids.includes(d.id));
  if (!lista.length) return;
  await ziAbrirBorradores(lista);
  ids.forEach(id => BR.sel.delete(id));
}
async function brBorrar(ids) {
  ids = ids || [...BR.sel];
  if (!ids.length) return;
  const n = ids.length;
  const ok = await uiConfirm({ titulo: `¿Borrar ${n} borrador${n === 1 ? '' : 'es'}?`, mensaje: 'Se quitan de esta lista y no se puede deshacer. Las prendas que ya registraste no se tocan.', ok: 'Borrar', peligro: true });
  if (!ok) return;
  try {
    await api('/api/acciones?op=b-borrar', { method: 'POST', body: { ids } });
    BR.lista = (BR.lista || []).filter(d => !ids.includes(d.id)); ids.forEach(id => BR.sel.delete(id));
    // si estaban abiertos en el registro rápido, ya no se vuelven a guardar como borrador
    if (typeof ZI !== 'undefined') ZI.grupos.forEach(g => { if (ids.includes(g.bid)) { g.bid = null; g._bHash = null; g.sinBorrador = true; } });
    brGlobo(); brPintar(); toast(`${n} borrador${n === 1 ? '' : 'es'} borrado${n === 1 ? '' : 's'}`, 'ok');
  } catch (e) { toast('No se pudieron borrar: ' + (e.message || 'error'), 'error'); }
}
// Al entrar al panel, el globito del menú
document.addEventListener('DOMContentLoaded', () => setTimeout(() => { if (document.getElementById('brGlobo')) brCargar().catch(() => {}); }, 1500));
