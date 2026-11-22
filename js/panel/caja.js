// ─────────────────────────────────────────────────────────────
//  js/panel/caja.js — Punto de venta para bazares (caja.html) · v42
//
//  · Busca por SKU (STI-00012), número, nombre o marca; acepta lectores de
//    código USB/Bluetooth (escriben el SKU y Enter) y la cámara del celular
//    (QR de la etiqueta; con BarcodeDetector si existe, si no con jsQR).
//  · Cobra en efectivo (con cambio), tarjeta (terminal) o transferencia.
//  · La venta va al servidor (op v-pos-venta); si no hay internet, se guarda
//    en "stmp-caja-cola" y se reintenta sola. La prenda se quita del catálogo
//    local al momento para no venderla dos veces en la misma caja.
// ─────────────────────────────────────────────────────────────
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pesos = n => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
  const skuDe = p => p?.sku ? String(p.sku) : 'STI-' + String(p?.id ?? '').padStart(5, '0');
  const leer = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const COLA = 'stmp-caja-cola', TICKET = 'stmp-caja-ticket', EVENTO = 'stmp-caja-evento', VENDIDAS = 'stmp-caja-vendidas';

  if (!leer('stiimpys_session', null)) { location.href = 'login.html?sesion=vencida'; return; }

  let ticket = leer(TICKET, []);           // [{ id, sku, nombre, talla, precio, imagen }]
  let metodo = 'efectivo';
  const vendidasLocal = new Set(leer(VENDIDAS, []));   // vendidas en esta caja (aún sin confirmar o ya confirmadas)

  // ── Catálogo ──────────────────────────────────────────────
  const catalogo = () => (typeof getDB === 'function' ? getDB() : []).filter(p => !p.vendido && !vendidasLocal.has(p.id));
  function buscarPrenda(q) {
    q = String(q || '').trim();
    if (!q) return [];
    // QR de la etiqueta: …/prenda.html?id=12
    const url = q.match(/[?&]id=(\d+)/); if (url) q = url[1];
    const todas = typeof getDB === 'function' ? getDB() : [];
    const sku = q.toUpperCase().replace(/\s+/g, '');
    const exacta = todas.find(p => skuDe(p).toUpperCase() === sku || (/^\d+$/.test(q) && p.id === Number(q)) || (/^STI-?\d+$/.test(sku) && p.id === Number(sku.replace(/\D/g, ''))));
    if (exacta) return [exacta];
    const t = q.toLowerCase();
    return todas.filter(p => `${p.nombre} ${p.marca || ''} ${p.talla || ''} ${skuDe(p)}`.toLowerCase().includes(t)).slice(0, 12);
  }
  function estadoDe(p) {
    if (p.vendido || vendidasLocal.has(p.id)) return 'vendida';
    if (p.apartada && p.reservedUntil && p.reservedUntil > new Date().toISOString()) return 'pagándose en línea';
    if (p.apartada && p.anticipo) return 'apartada con anticipo';
    return '';
  }

  function agregar(p) {
    const est = estadoDe(p);
    if (est) return toast(`"${p.nombre}" está ${est}`, 'alerta');
    if (ticket.some(x => x.id === p.id)) return toast('Ya está en el ticket', 'info');
    ticket.push({ id: p.id, sku: skuDe(p), nombre: p.nombre, talla: String(p.talla || '').split('·')[0].trim(), precio: Number(p.precio_venta) || 0,
      imagen: p.imagenes?.[0] ? (typeof imgOptimizada === 'function' ? imgOptimizada(p.imagenes[0], 120) : p.imagenes[0]) : '' });
    guardar(TICKET, ticket); $('cjQ').value = ''; $('cjRes').innerHTML = ''; pintar();
    if (navigator.vibrate) navigator.vibrate(40);
  }
  window.cjAgregar = id => { const p = (getDB() || []).find(x => x.id === id); if (p) agregar(p); };
  window.cjQuitar = id => { ticket = ticket.filter(x => x.id !== id); guardar(TICKET, ticket); pintar(); };

  function mostrarResultados(lista, q) {
    $('cjRes').innerHTML = !q ? '' : !lista.length ? `<p class="cj-nota">Nada con "${esc(q)}".</p>` :
      lista.map(p => { const est = estadoDe(p); return `<button type="button" class="cj-item ${est ? 'no' : ''}" onclick="cjAgregar(${p.id})">
        ${p.imagenes?.[0] ? `<img src="${esc(typeof imgOptimizada === 'function' ? imgOptimizada(p.imagenes[0], 120) : p.imagenes[0])}" alt="" loading="lazy">` : '<span class="cj-sinfoto"></span>'}
        <span><b>${esc(p.nombre)}</b><small>${esc(skuDe(p))} · Talla ${esc(String(p.talla || '—').split('·')[0])}${est ? ' · ' + est : ''}</small></span><em>${pesos(p.precio_venta)}</em></button>`; }).join('');
  }

  // ── Totales ───────────────────────────────────────────────
  function calcular() {
    const subtotal = ticket.reduce((t, x) => t + x.precio, 0);
    const v = Math.max(0, Number($('cjDesc').value) || 0);
    const desc = $('cjDescTipo').value === 'pct' ? Math.round(subtotal * Math.min(90, v) / 100) : Math.min(subtotal, Math.round(v));
    return { subtotal, desc, total: subtotal - desc };
  }
  function pintar() {
    const { subtotal, desc, total } = calcular();
    $('cjN').textContent = ticket.length ? `${ticket.length} prenda${ticket.length === 1 ? '' : 's'}` : '';
    $('cjTicket').innerHTML = ticket.length ? ticket.map(x => `<li>${x.imagen ? `<img src="${esc(x.imagen)}" alt="">` : '<span class="cj-sinfoto"></span>'}
      <span><b>${esc(x.nombre)}</b><small>${esc(x.sku)}${x.talla ? ' · Talla ' + esc(x.talla) : ''}</small></span><em>${pesos(x.precio)}</em>
      <button type="button" onclick="cjQuitar(${x.id})" aria-label="Quitar ${esc(x.nombre)}">✕</button></li>`).join('')
      : '<li class="cj-vacio">Escanea una etiqueta o busca una prenda para empezar.</li>';
    $('cjTotales').innerHTML = `<div><span>Subtotal</span><b>${pesos(subtotal)}</b></div>${desc ? `<div><span>Descuento</span><b>−${pesos(desc)}</b></div>` : ''}
      <div class="cj-total"><span>Total</span><b>${pesos(total)}</b></div>`;
    const rec = Number($('cjRecibido').value) || 0;
    $('cjRecibidoFila').hidden = metodo !== 'efectivo';
    $('cjCambio').textContent = metodo === 'efectivo' && rec ? (rec >= total ? `Cambio: ${pesos(rec - total)}` : `Faltan ${pesos(total - rec)}`) : '';
    $('cjCobrar').disabled = !ticket.length || (metodo === 'efectivo' && rec > 0 && rec < total);
    $('cjCobrar').textContent = ticket.length ? `Cobrar ${pesos(total)}` : 'Cobrar';
  }

  // ── Cobrar ────────────────────────────────────────────────
  async function mandar(venta) {
    const { _local, ...cuerpo } = venta;      // lo de _local solo sirve para pintar el ticket aquí
    return api('/api/acciones?op=v-pos-venta', { method: 'POST', body: cuerpo });
  }
  async function cobrar() {
    if (!ticket.length) return;
    const { subtotal, desc, total } = calcular();
    const venta = {
      idLocal: 'C' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      ids: ticket.map(x => x.id), evento: $('cjEvento').value.trim() || 'Venta en persona', metodo,
      descuento: desc ? { tipo: 'pesos', valor: desc } : null, recibido: Number($('cjRecibido').value) || null,
      cliente: { nombre: $('cjNombre').value.trim(), telefono: $('cjTel').value.trim() },
      _local: { items: ticket, subtotal, desc, total, en: new Date().toISOString() },
    };
    $('cjCobrar').disabled = true; $('cjCobrar').textContent = 'Cobrando…';
    ticket.forEach(x => vendidasLocal.add(x.id)); guardar(VENDIDAS, [...vendidasLocal].slice(-500));
    let r = null;
    try { r = await mandar(venta); }
    catch (e) {
      if (e.status && e.status < 500 && e.status !== 409 && e.status !== 429) {   // error real (sin sesión, etc.)
        ticket.forEach(x => vendidasLocal.delete(x.id)); guardar(VENDIDAS, [...vendidasLocal]);
        toast(e.message || 'No se pudo cobrar', 'error'); pintar(); return;
      }
      const cola = leer(COLA, []); cola.push(venta); guardar(COLA, cola);   // sin internet: se manda después
    }
    mostrarTicket(r, venta);
    ticket = []; guardar(TICKET, ticket);
    $('cjDesc').value = ''; $('cjRecibido').value = ''; $('cjNombre').value = ''; $('cjTel').value = '';
    pintar(); estado();
  }

  function mostrarTicket(r, venta) {
    const L = venta._local, enCola = !r;
    const vendidas = r ? r.vendidas : L.items;
    const total = r ? r.total : L.total;
    const lineas = vendidas.map(x => `• ${x.nombre} (${x.sku}) ${pesos(x.precio)}`).join('\n');
    let msj = `¡Gracias por tu compra en Stiimpys! 🖤\n${venta.evento}\n${lineas}${(r ? r.descuento : L.desc) ? `\nDescuento: −${pesos(r ? r.descuento : L.desc)}` : ''}\nTotal: ${pesos(total)}${r ? `\nTicket: ${r.ticket}` : ''}\n\nMás prendas en stiimpys.store`;
    // v43: extras del ticket (si "Ticket de la Caja con extras" está prendido)
    const ex = r?.extras;
    if (ex) msj = msj.replace('\n\nMás prendas en stiimpys.store', '\n') + [
      ex.frecuente ? (ex.frecuente.faltan === 0 ? `\n🎁 Tu próxima compra tiene ${ex.frecuente.pct}% de descuento.` : `\n⭐ Te ${ex.frecuente.faltan === 1 ? 'falta 1 compra' : `faltan ${ex.frecuente.faltan} compras`} para tu ${ex.frecuente.pct}% de descuento.`) : '',
      ex.referido ? `\n👯 Invita a tus amigos con tu código ${ex.referido.codigo}: ellos tienen ${ex.referido.pct}% en su primera compra y tú ganas un regalo.` : '',
      ex.tienda ? `\n🛍️ Más prendas en ${ex.tienda}` : '',
    ].join('');
    const tel = (venta.cliente.telefono || '').replace(/\D/g, '').slice(-10);
    const d = $('cjDlg');
    d.innerHTML = `<div class="cj-dlg-in">
      <h2>${enCola ? 'Venta guardada' : r.rechazadas.length ? 'Venta con avisos' : '¡Vendido!'}</h2>
      ${enCola ? '<p class="cj-aviso">No hay internet: la venta se guardó en esta caja y se manda sola cuando vuelva la señal.</p>' : ''}
      ${r?.rechazadas?.length ? `<div class="cj-aviso rojo"><b>No se cobraron:</b><ul>${r.rechazadas.map(x => `<li>${esc(x.nombre || '#' + x.id)}: ${esc(x.motivo)}</li>`).join('')}</ul>Ajusta el cobro con el cliente.</div>` : ''}
      <ul class="cj-lineas">${vendidas.map(x => `<li><span>${esc(x.nombre)}<small>${esc(x.sku)}</small></span><b>${pesos(x.precio)}</b></li>`).join('')}</ul>
      ${(r ? r.descuento : L.desc) ? `<p class="cj-fila-t"><span>Descuento</span><b>−${pesos(r ? r.descuento : L.desc)}</b></p>` : ''}
      <p class="cj-fila-t total"><span>Total (${esc(r?.metodoNombre || venta.metodo)})</span><b>${pesos(total)}</b></p>
      ${r?.cambio != null ? `<p class="cj-fila-t"><span>Cambio</span><b>${pesos(r.cambio)}</b></p>` : ''}
      ${r ? `<p class="cj-nota">Ticket ${esc(r.ticket)} · ${esc(venta.evento)}</p>` : ''}
      <div class="cj-dlg-acc">
        ${tel.length === 10 ? `<a class="cj-btn verde" target="_blank" rel="noopener" href="https://wa.me/52${tel}?text=${encodeURIComponent(msj)}">Mandar ticket por WhatsApp</a>` : ''}
        <button type="button" class="cj-btn" onclick="navigator.clipboard?.writeText(${esc(JSON.stringify(msj))}).then(()=>toast('Ticket copiado','ok'))">Copiar ticket</button>
        <button type="button" class="cj-cobrar" onclick="document.getElementById('cjDlg').close(); document.getElementById('cjQ').focus()">Nueva venta</button>
      </div></div>`;
    d.showModal();
  }

  // ── Cola sin internet ─────────────────────────────────────
  let enviando = false;
  async function vaciarCola() {
    const cola = leer(COLA, []);
    if (!cola.length || enviando || !navigator.onLine) return estado();
    enviando = true;
    const quedan = [];
    for (const v of cola) {
      try {
        const r = await mandar(v);
        if (r.rechazadas?.length) toast(`Venta guardada (${v.evento}): ${r.rechazadas.length} prenda(s) ya se habían vendido en línea`, { tipo: 'alerta', fijo: true,
          detalles: r.rechazadas.map(x => `${x.nombre || '#' + x.id}: ${x.motivo}`) });
      } catch (e) {
        if (e.status && e.status < 500 && e.status !== 409 && e.status !== 429) toast(`Una venta guardada no se pudo mandar: ${e.message}`, { tipo: 'error', fijo: true });
        else quedan.push(v);
      }
    }
    guardar(COLA, quedan); enviando = false; estado();
    if (cola.length > quedan.length) toast(`${cola.length - quedan.length} venta(s) guardada(s) ya se mandaron`, 'ok');
  }
  function estado() {
    const n = leer(COLA, []).length;
    $('cjEstado').innerHTML = `<span class="${navigator.onLine ? 'on' : 'off'}">${navigator.onLine ? 'En línea' : 'Sin internet'}</span>${n ? `<button type="button" onclick="cjCola()">${n} por mandar</button>` : ''}`;
  }
  window.cjCola = () => { vaciarCola(); };
  window.addEventListener('online', vaciarCola);
  window.addEventListener('offline', estado);
  setInterval(vaciarCola, 20000);

  // ── Resumen del día ──────────────────────────────────────
  async function resumen() {
    const caja = $('cjResumenCuerpo');
    caja.innerHTML = '<p class="cj-nota">Cargando…</p>';
    try {
      const ev = $('cjEvento').value.trim();
      const r = await api(`/api/acciones?op=v-pos-resumen${ev ? '&evento=' + encodeURIComponent(ev) : ''}`);
      caja.innerHTML = `<div class="cj-res-kpi"><div><b>${pesos(r.total)}</b><span>vendido</span></div><div><b>${r.prendas}</b><span>prendas</span></div><div><b>${r.tickets}</b><span>tickets</span></div></div>
        <p class="cj-nota">${Object.entries(r.porMetodo).map(([m, t]) => `${m}: ${pesos(t)}`).join(' · ') || 'Sin ventas todavía'}</p>
        <ul class="cj-lineas">${r.ultimas.map(v => `<li><span>${esc(v.nombre)}<small>${esc(v.ticket)} · ${new Date(v.fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</small></span><b>${pesos(v.precio)}</b>
          <button type="button" class="cj-anular" onclick="cjAnular('${esc(v.ticket)}')">Anular ticket</button></li>`).join('')}</ul>`;
    } catch (e) { caja.innerHTML = `<p class="cj-nota">${esc(e.message || 'No se pudo cargar')}</p>`; }
  }
  window.cjAnular = async t => {
    if (!confirm(`¿Anular el ticket ${t}? Sus prendas regresan a la tienda.`)) return;
    try { const r = await api('/api/acciones?op=v-pos-anular', { method: 'POST', body: { ticket: t } }); r.regresan.forEach(id => vendidasLocal.delete(id)); guardar(VENDIDAS, [...vendidasLocal]); toast('Ticket anulado', 'ok'); resumen(); }
    catch (e) { toast(e.message, 'error'); }
  };

  // ── Cámara ───────────────────────────────────────────────
  let flujo = null, detector = null, leyendo = false;
  async function abrirCamara() {
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch (_) { return toast('No se pudo abrir la cámara. Revisa el permiso del navegador.', 'error'); }
    const vid = $('cjVid'); vid.srcObject = flujo; await vid.play().catch(() => {});
    $('cjVideo').hidden = false;
    if ('BarcodeDetector' in window) {
      try { detector = new BarcodeDetector({ formats: ['qr_code', 'code_128'] }); } catch (_) { detector = null; }
    }
    if (!detector && !window.jsQR) await new Promise(ok => { const s = document.createElement('script'); s.src = 'js/vendor/jsqr.js'; s.onload = ok; s.onerror = ok; document.head.appendChild(s); });
    leyendo = true; leer1();
  }
  function cerrarCamara() {
    leyendo = false; $('cjVideo').hidden = true;
    flujo?.getTracks().forEach(t => t.stop()); flujo = null;
  }
  const lienzo = document.createElement('canvas');
  async function leer1() {
    if (!leyendo) return;
    const vid = $('cjVid');
    let texto = null;
    try {
      if (detector) { const r = await detector.detect(vid); texto = r[0]?.rawValue || null; }
      else if (window.jsQR && vid.videoWidth) {
        lienzo.width = vid.videoWidth; lienzo.height = vid.videoHeight;
        const c = lienzo.getContext('2d', { willReadFrequently: true }); c.drawImage(vid, 0, 0);
        const r = window.jsQR(c.getImageData(0, 0, lienzo.width, lienzo.height).data, lienzo.width, lienzo.height, { inversionAttempts: 'dontInvert' });
        texto = r?.data || null;
      }
    } catch (_) {}
    if (texto) {
      const [p] = buscarPrenda(texto);
      if (p) { agregar(p); cerrarCamara(); return; }
      toast('Esa etiqueta no es de una prenda de la tienda', 'alerta');
      await new Promise(r => setTimeout(r, 1200));
    }
    setTimeout(leer1, 180);
  }

  // ── Eventos ──────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    $('cjEvento').value = localStorage.getItem(EVENTO) || '';
    $('cjEvento').addEventListener('input', e => { try { localStorage.setItem(EVENTO, e.target.value); } catch (_) {} });
    let t = 0;
    $('cjQ').addEventListener('input', e => { clearTimeout(t); const q = e.target.value; t = setTimeout(() => mostrarResultados(buscarPrenda(q), q.trim()), 120); });
    $('cjForm').addEventListener('submit', e => {    // Enter (o el lector de códigos)
      e.preventDefault();
      const q = $('cjQ').value; const r = buscarPrenda(q);
      if (r.length === 1) agregar(r[0]); else mostrarResultados(r, q.trim());
    });
    $('cjCam').addEventListener('click', abrirCamara);
    $('cjCamCerrar').addEventListener('click', cerrarCamara);
    document.querySelectorAll('[data-metodo]').forEach(b => b.addEventListener('click', () => {
      metodo = b.dataset.metodo; document.querySelectorAll('[data-metodo]').forEach(x => x.classList.toggle('on', x === b)); pintar();
    }));
    ['cjDesc', 'cjDescTipo', 'cjRecibido'].forEach(id => $(id).addEventListener('input', pintar));
    $('cjCobrar').addEventListener('click', cobrar);
    $('cjVaciar').addEventListener('click', () => { if (ticket.length && confirm('¿Vaciar el ticket?')) { ticket = []; guardar(TICKET, ticket); pintar(); } });
    $('cjResumen').addEventListener('toggle', e => { if (e.target.open) resumen(); });
    pintar(); estado(); vaciarCola();
  });
  window.addEventListener('db:ready', () => { if ($('cjQ').value) mostrarResultados(buscarPrenda($('cjQ').value), $('cjQ').value.trim()); });
})();
