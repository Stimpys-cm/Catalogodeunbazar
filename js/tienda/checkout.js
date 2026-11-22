// ─────────────────────────────────────────────────────────────
//  js/checkout.js — Página de pago (pagar.html)
//
//  pagar.html?bazar=1           → datos, entrega y pago del carrito
//  pagar.html?bazar=1&ids=4,7   → "Comprar ahora" (esas prendas, sin tocar el carrito)
//  pagar.html?pedido=ID&k=CLAVE → confirmación / recibo del pedido
//  pagar.html?mis=1             → "Mis pedidos": los recibos guardados en este celular
//                                  y recuperar un pedido con WhatsApp + número de pedido
//
//  Los montos siempre los calcula el servidor (v-cotizar) para que lo
//  que se ve sea exactamente lo que se cobra. Se cobra en pesos.
// ─────────────────────────────────────────────────────────────
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pesos = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');
  const Q = new URLSearchParams(location.search);
  const K = { bolsa: 'bazar_wishlist', cupon: 'stmp-cupon', contacto: 'stmp-contacto', dir: 'stmp-direccion', pedido: 'stmp-pedido', moneda: 'stmp-moneda', cp: 'stmp-cp', punto: 'stmp-punto', entrega: 'stmp-entrega', metodo: 'stmp-metodo', historial: 'stmp-mis-pedidos' };

  // ── Historial de pedidos en este celular (para no perder ningún recibo) ──
  const historial = () => (leer(K.historial, []) || []).filter(x => x?.id && x?.k);
  function agregarHistorial(x) {
    if (!x?.id || !x?.k) return;
    const lista = historial().filter(h => h.id !== x.id);
    const previo = historial().find(h => h.id === x.id) || {};
    lista.unshift({ ...previo, ...x });
    guardar(K.historial, lista.slice(0, 30));
  }
  const linkRecibo = (id, k) => `${location.origin}/pagar.html?pedido=${encodeURIComponent(id)}&k=${encodeURIComponent(k)}`;
  const leer = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
  const guardar = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const raiz = $('#ck');
  const ESTADOS_MX = ['Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche', 'Chiapas', 'Chihuahua', 'Ciudad de México', 'Coahuila', 'Colima', 'Durango', 'Estado de México', 'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco', 'Michoacán', 'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro', 'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora', 'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas'];
  const ICONO = {
    candado: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3"/></svg>',
    escudo: '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6zM9 12l2 2 4-4"/></svg>',
    flecha: '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    equis: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" d="M7 7l10 10M17 7L7 17"/></svg>',
    reloj: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M12 7.5V12l3 2"/></svg>',
  };

  // ── v36 · Apartado de 10 minutos mientras se paga, con contador ──
  const MIN_APARTADO = 10;
  const fmtCuenta = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const apartadoVigente = r => !!(r && r.expira && Date.parse(r.expira) > Date.now());
  function cajaCuenta(r) {
    if (!apartadoVigente(r)) return '';
    const ms = Date.parse(r.expira) - Date.now();
    return `<div class="ck-cuenta${ms < 60000 ? ' poca' : ''}" role="status">${ICONO.reloj}
      <span>Tus prendas siguen apartadas para ti: <b class="ck-cuenta-num" data-hasta="${esc(r.expira)}">${fmtCuenta(ms)}</b></span></div>`;
  }
  // Un solo reloj para la página: al llegar a cero se revisa el pedido otra vez
  setInterval(() => {
    document.querySelectorAll('.ck-cuenta-num[data-hasta]').forEach(el => {
      const ms = Date.parse(el.dataset.hasta) - Date.now();
      el.textContent = fmtCuenta(ms);
      el.closest('.ck-cuenta')?.classList.toggle('poca', ms < 60000);
      if (ms <= 0 && !el.dataset.fin) { el.dataset.fin = '1'; setTimeout(() => location.reload(), 1500); }
    });
  }, 1000);

  // ── v37 · Pasos de la compra y botones fijos (como Mercado Libre / Amazon) ──
  function pasosCompra(actual) {
    const p = [['Carrito', 'carrito.html'], ['Entrega y pago', ''], ['Confirmación', '']];
    return `<ol class="ck-pasos" aria-label="Pasos de la compra">${p.map(([t, href], i) => {
      const n = i + 1, estado = n < actual ? 'ok' : n === actual ? 'on' : '';
      const txt = n < actual && href ? `<a href="${href}">${t}</a>` : t;
      return `<li class="${estado}" ${n === actual ? 'aria-current="step"' : ''}><i>${n < actual ? '✓' : n}</i><span>${txt}</span></li>`;
    }).join('')}</ol>`;
  }
  // En el resumen (computadora): "Pagar" y "Modificar carrito". En celular: barra fija con
  // el total y el botón, que se esconde cuando el botón de pagar del formulario ya se ve.
  function ladoYBarraFija() {
    const pagar = $('#ckPagar'), lado = $('#ckAside');
    if (!pagar || !lado) return;
    lado.insertAdjacentHTML('beforeend', `<div class="ck-lado-acc">
      <button type="button" class="ck-pagar ck-pagar-lado ${S.metodo}" id="ckPagarLado">${ICONO.candado}<span>${esc(pagar.querySelector('span').textContent)}</span></button>
      ${S.directo ? '' : '<a class="ck-modificar" href="carrito.html">Modificar carrito</a>'}</div>`);
    document.body.insertAdjacentHTML('beforeend', `<div class="ck-fija" id="ckFija" role="region" aria-label="Total y pagar">
      <div><small id="ckFijaEt">Total</small><b id="ckFijaTotal"></b></div>
      <button type="button" class="ck-pagar ${S.metodo}" id="ckFijaPagar">${ICONO.candado}<span>Pagar</span></button></div>`);
    const ir = () => { if (!$('#ckPagar')?.disabled) $('#ckPagar').click(); };
    $('#ckPagarLado').onclick = ir; $('#ckFijaPagar').onclick = ir;
    if ('IntersectionObserver' in window) new IntersectionObserver(es => es.forEach(e => $('#ckFija')?.classList.toggle('oculta', e.isIntersecting)), { threshold: .6 }).observe(pagar);
    // El color del botón sigue al método elegido (Clip naranja, PayPal amarillo)
    new MutationObserver(() => { const m = pagar.classList.contains('paypal') ? 'paypal' : pagar.classList.contains('spei') ? 'spei' : 'clip';
      ['#ckPagarLado', '#ckFijaPagar'].forEach(sel => { const b = $(sel); if (b) { b.classList.remove('clip', 'paypal', 'spei'); b.classList.add(m); b.disabled = pagar.disabled; } }); })
      .observe(pagar, { attributes: true, attributeFilter: ['class', 'disabled'] });
    actualizarTotales();
  }

  async function api(op, body, query = '') {
    const r = await fetch(`/api/acciones?op=${op}${query}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'No hay conexión. Revisa tu internet e intenta de nuevo.'); e.status = r.status; e.recotizar = !!j.recotizar; throw e; }
    return j;
  }
  const waLink = (num, texto) => num ? `https://wa.me/${num}?text=${encodeURIComponent(texto)}` : '';
  const usd = (mxn, moneda) => {
    if (!moneda?.mxnPorUsd || leer(K.moneda, null) !== 'USD') return '';
    return `Aprox. US$${(mxn / moneda.mxnPorUsd).toFixed(2)}. Se cobra en pesos mexicanos.`;
  };

  // ═════════════════════════════════════════════════════════
  //  Resumen (la etiqueta)
  // ═════════════════════════════════════════════════════════
  function etiqueta(d, { envio = 0, pagado = false, editable = true, sello = '', apartadoInfo = '' } = {}) {
    const total = d.total + envio;
    const items = d.prendas.map(p => `<li class="ck-item">
        ${p.imagen ? `<img src="${esc(p.imagen)}" alt="" loading="lazy" width="60" height="74">` : '<div class="ck-sinfoto"></div>'}
        <div><b>${esc(p.nombre)}</b><span>${esc([p.talla && `Talla ${p.talla}`, p.estado].filter(Boolean).join(', '))}</span></div>
        <div class="ck-precio">${p.antes > p.precio ? `<s>${pesos(p.antes)}</s>` : ''}${pesos(p.precio)}</div></li>`).join('');
    const cupon = d.cupon;
    const marca = sello || (pagado ? 'Pagado' : '');
    return `<div class="ck-tag ${marca ? 'pagado' : ''} ${sello === 'Apartado' ? 'apartado' : ''}">
      ${marca ? `<div class="ck-sello" aria-hidden="true">${marca}</div>` : ''}
      <h2 class="ck-tag-h">Tu pedido <small>${d.prendas.length} ${d.prendas.length === 1 ? 'prenda' : 'prendas'}</small></h2>
      <ul class="ck-items">${items}</ul>
      ${editable && d.noDisponibles?.length ? `<p class="ck-falta">${d.noDisponibles.map(x => `“${esc(x.nombre)}”`).join(', ')} ya ${d.noDisponibles.length === 1 ? 'no está disponible' : 'no están disponibles'} y no se cobra.</p>` : ''}
      ${editable && d.siguiente && !d.sugerencias?.length ? `<p class="ck-mas">Agrega ${d.siguiente.n - d.prendas.length} ${d.siguiente.n - d.prendas.length === 1 ? 'prenda' : 'prendas'} más y te descontamos ${d.siguiente.pct}%. <a href="tienda.html">Ver prendas</a></p>` : ''}
      ${editable && d.hayCupones && !cupon ? `<form class="ck-cupon" id="ckCupon"><label class="sr" for="ckCuponIn">Código de descuento</label><input id="ckCuponIn" placeholder="Código de descuento" maxlength="24" autocomplete="off" autocapitalize="characters"><button type="submit">Aplicar</button></form>
        ${d.cuponError ? `<p class="ck-cupon-msg" role="alert">${esc(d.cuponError)}</p>` : ''}` : ''}
      <dl class="ck-lineas">
        <div><dt>Subtotal</dt><dd>${pesos(d.subtotal)}</dd></div>
        ${d.descVolumen ? `<div class="desc"><dt>Descuento por llevar ${d.prendas.length} (${d.tramo?.pct}%)</dt><dd>−${pesos(d.descVolumen)}</dd></div>` : ''}
        ${d.descOutfit ? `<div class="desc"><dt>Outfit completo</dt><dd>−${pesos(d.descOutfit)}</dd></div>` : ''}
        ${d.descFrecuente ? `<div class="desc"><dt>Cliente frecuente (${d.frecuente?.pct || ''}%)</dt><dd>−${pesos(d.descFrecuente)}</dd></div>` : ''}
        ${d.descCupon ? `<div class="desc"><dt>Cupón ${esc(cupon?.codigo || d.cuponCodigo || '')}${editable ? '<button type="button" id="ckQuitarCupon">Quitar</button>' : ''}</dt><dd>−${pesos(d.descCupon)}</dd></div>` : ''}
        <div><dt>Entrega</dt><dd id="ckLineaEnvio">${envio ? pesos(envio) : 'Gratis'}</dd></div>
      </dl>
      <div class="ck-perf" aria-hidden="true"></div>
      <div class="ck-total"><span>Total</span><b id="ckTotal">${pesos(total)}<small>MXN</small></b></div>
      <p class="ck-usd" id="ckUsd">${esc(usd(total, d.moneda))}</p>
      ${apartadoInfo ? `<dl class="ck-apartado">${apartadoInfo}</dl>` : editable ? '<dl class="ck-apartado" id="ckApartadoLineas" hidden></dl>' : ''}
    </div>`;
  }
  function aside(d, opciones, { siempre = false } = {}) {
    const total = d.total + (opciones.envio || 0);
    return `<aside class="ck-aside ${siempre ? 'siempre' : ''}" id="ckAside" aria-label="Resumen del pedido">
      <span class="ck-hilo" aria-hidden="true"></span>
      <button type="button" class="ck-barra" aria-expanded="false" aria-controls="ckTagWrap" id="ckBarra">
        <span><span class="ck-barra-tx">Ver tu pedido <i id="ckNum">${d.prendas.length}</i></span>${ICONO.flecha}</span><b id="ckTotalBarra">${pesos(total)}</b></button>
      <div id="ckTagWrap">${etiqueta(d, opciones)}</div>
    </aside>`;
  }
  function engancharBarra() {
    const b = $('#ckBarra'); if (!b) return;
    b.onclick = () => {
      const abierto = $('#ckAside').classList.toggle('abierto');
      b.setAttribute('aria-expanded', abierto);
      b.querySelector('span').innerHTML = abierto ? `<span class="ck-barra-tx">Ocultar tu pedido</span>${ICONO.flecha}` : `<span class="ck-barra-tx">Ver tu pedido <i id="ckNum">${S.d?.prendas.length || ''}</i></span>${ICONO.flecha}`;
    };
  }

  // ═════════════════════════════════════════════════════════
  //  Pantalla de pago
  // ═════════════════════════════════════════════════════════
  const S = { d: null, bazarId: null, ids: [], entrega: 'persona', enviando: false };
  // Último intento de pago de este cliente (si falló, sus prendas siguen apartadas a su nombre)
  const previo = () => { const p = leer(K.pedido, null); return p?.id && p?.clave ? { id: p.id, clave: p.clave } : undefined; };

  async function cotizar(cupon) {
    // v42: con el WhatsApp, el servidor reconoce al cliente frecuente y aplica su descuento
    const telefono = (($('#ckForm')?.elements?.telefono?.value) || leer(K.contacto, {})?.telefono || '').replace(/\D/g, '');
    S.d = await api('v-cotizar', { ids: S.ids, bazarId: S.bazarId, cupon: cupon || undefined, previo: previo(), telefono: telefono.length >= 10 ? telefono : undefined });
    if (S.d.cupon) guardar(K.cupon, { ...S.d.cupon, bazarId: S.bazarId });
    else if (cupon && S.d.cuponError) { /* se muestra junto al campo */ }
    return S.d;
  }

  async function iniciarPago() {
    const bolsa = leer(K.bolsa, []);
    const directos = (Q.get('ids') || '').split(',').map(Number).filter(Boolean).slice(0, 20);
    if (['persona', 'envio'].includes(leer(K.entrega, ''))) S.entrega = leer(K.entrega, '');
    S.directo = directos.length > 0;
    S.bazarId = Q.get('bazar') || String(bolsa[0]?.bazarId || 1);
    S.ids = S.directo ? directos : bolsa.filter(p => String(p.bazarId || 1) === String(S.bazarId)).map(p => Number(p.id)).filter(Boolean);
    if (!S.ids.length) return vacio();
    const cup = leer(K.cupon, null);
    try { await cotizar(cup && String(cup.bazarId) === String(S.bazarId) ? cup.codigo : null); }
    catch (e) { return error(e.message); }
    if (!S.d.prendas.length) return vacio(true);
    if (S.d.modulos?.misPedidos === false) document.querySelectorAll('.ck-pie a[href*="mis=1"], .site-footer a[href*="mis=1"]').forEach(a => a.remove());
    if (S.d.cuponError && cup) { guardar(K.cupon, null); S.d.cuponError = null; }
    S.modo = Q.get('modo') === 'apartado' && S.d.apartado ? 'apartado' : 'completo';
    pintarPago();
  }

  function vacio(vendidas) {
    raiz.innerHTML = `<div class="ck-vacio"><h1>${vendidas ? 'Ya no hay prendas para pagar' : 'Tu carrito está vacío'}</h1>
      <p>${vendidas ? 'Las prendas de tu carrito ya se vendieron o están apartadas. Cada pieza es única.' : 'Agrega prendas al carrito desde la tienda y vuelve aquí para pagar.'}</p>
      <a class="ck-pagar" href="tienda.html">Ver prendas disponibles</a></div>`;
  }
  function error(msg) {
    raiz.innerHTML = `<div class="ck-vacio"><h1>No se pudo cargar tu pedido</h1><p>${esc(msg)}</p>
      <button class="ck-pagar" type="button" onclick="location.reload()">Intentar de nuevo</button></div>`;
  }

  function pintarPago() {
    const d = S.d, c = leer(K.contacto, {}), dir = leer(K.dir, {});
    const hayEnvio = d.envioCosto > 0 || !!d.envia;
    const puntos = d.puntosEntrega || [];
    if (puntos.length && !puntos.some(p => p.id === S.punto)) S.punto = puntos.some(p => p.id === leer(K.punto, '')) ? leer(K.punto, '') : null;
    const cotiza = !!d.envia;   // envia.com: el precio sale del código postal
    if (!dir.cp && leer(K.cp, '')) dir.cp = leer(K.cp, '');
    if (!hayEnvio) S.entrega = 'persona';
    const metodos = d.metodos?.length ? d.metodos : ['clip'];
    if (!metodos.includes(S.metodo)) S.metodo = metodos.includes(leer(K.metodo, '')) ? leer(K.metodo, '') : metodos[0];
    const msgWA = `Hola ${d.bazar.nombre}! Quiero apartar:\n\n${d.prendas.map((p, i) => `${i + 1}. ${p.nombre}${p.talla ? ` (talla ${p.talla})` : ''}: ${pesos(p.precio)}`).join('\n')}\n\nTotal: ${pesos(d.total)}${d.cupon ? ` (con cupón ${d.cupon.codigo})` : ''}`;
    const wa = waLink(d.bazar.whatsapp, msgWA);
    $('#ckAyuda').innerHTML = d.bazar.whatsapp ? `¿Dudas? <a href="${esc(waLink(d.bazar.whatsapp, 'Hola! Tengo una duda sobre mi pedido.'))}" target="_blank" rel="noopener">Escríbenos por WhatsApp</a>` : '';

    raiz.innerHTML = `${pasosCompra(2)}<form class="ck-form" id="ckForm" novalidate>
      <h1>Finaliza tu compra</h1>
      <p class="ck-lead">Cada prenda es pieza única. Al tocar Pagar te la apartamos <b>${MIN_APARTADO} minutos</b> para que nadie más la compre mientras pagas.</p>
      <div id="ckMsg"></div>
      <div id="ckSug">${sugerencias(d)}</div>

      <section class="ck-sec" aria-labelledby="ckH1">
        <h2 id="ckH1"><span class="ck-num">1</span>Tus datos</h2>
        <div class="ck-fila">
          ${campo('nombre', 'Nombre y apellido', c.nombre, { auto: 'name', max: 60 })}
          ${campo('telefono', 'WhatsApp', c.telefono, { auto: 'tel-national', max: 16, modo: 'tel', ayuda: '10 dígitos. Por aquí coordinamos tu entrega.' })}
        </div>
        ${campo('email', 'Correo <em>(opcional, para tu recibo)</em>', c.email, { auto: 'email', max: 120, tipo: 'email', modo: 'email' })}
      </section>

      <section class="ck-sec" aria-labelledby="ckH2">
        <h2 id="ckH2"><span class="ck-num">2</span>¿Cómo quieres recibir tu compra?</h2>
        <div class="ck-opciones" role="radiogroup" aria-labelledby="ckH2">
          <label class="ck-op"><input type="radio" name="entrega" value="persona" ${S.entrega === 'persona' ? 'checked' : ''}>
            <div><b>Entrega en persona</b><span>${esc(puntos.length ? 'Elige el punto; el día y la hora los acordamos por WhatsApp.' : (d.info.entrega || 'En Reynosa. Acordamos lugar y hora por WhatsApp.'))}</span></div><strong id="ckPersonaPrecio">${precioPersona()}</strong></label>
          ${puntos.length ? `<div class="ck-dir" id="ckPuntos" ${S.entrega === 'persona' ? '' : 'hidden'}>
            <div role="radiogroup" aria-label="Punto de entrega" class="ck-puntos">${puntos.map(p => `
              <label class="ck-paq ${S.punto === p.id ? 'on' : ''}"><input type="radio" name="punto" value="${esc(p.id)}" ${S.punto === p.id ? 'checked' : ''}>
                <span><b>${esc(p.nombre)}</b>${p.nota ? `<small>${esc(p.nota)}</small>` : ''}</span>
                <span class="ck-paq-der"><strong data-punto-precio="${esc(p.id)}">${precioPuntoTxt(p)}</strong></span></label>`).join('')}</div>
            <p class="ck-paqs-nota" id="ckPuntoNota">${notaPuntos()}</p>
          </div>` : ''}
          ${hayEnvio ? `<label class="ck-op"><input type="radio" name="entrega" value="envio" ${S.entrega === 'envio' ? 'checked' : ''}>
            <div><b>Envío a domicilio</b><span>${esc(d.info.envios || 'A todo México. Te mandamos la guía por WhatsApp.')}</span></div><strong id="ckEnvioPrecio">${cotiza ? (S.envio?.opciones?.length ? `Desde ${pesos(Math.min(...S.envio.opciones.map(o => o.precio)))}` : 'Según tu CP') : pesos(d.envioCosto)}</strong></label>
          <div class="ck-dir" id="ckDir" ${S.entrega === 'envio' ? '' : 'hidden'}>
            ${campo('cp', 'Código postal', dir.cp, { auto: 'postal-code', max: 5, modo: 'numeric', ayuda: cotiza ? 'Con tu código postal calculamos el envío y llenamos tu ciudad.' : '' })}
            ${cotiza ? '<div id="ckPaqs" class="ck-paqs" aria-live="polite"></div>' : ''}
            ${campo('calle', 'Calle y número', dir.calle, { auto: 'address-line1', max: 120 })}
            ${campo('colonia', 'Colonia', dir.colonia, { auto: 'address-line2', max: 80, lista: 'ckColonias' })}
            <datalist id="ckColonias"></datalist>
            <div class="ck-fila">
              ${campo('ciudad', 'Ciudad', dir.ciudad, { auto: 'address-level2', max: 60 })}
              <div class="ck-campo" id="cEstado"><label for="fEstado">Estado</label>
                <select id="fEstado" name="estado" autocomplete="address-level1"><option value="">Elige tu estado</option>
                ${ESTADOS_MX.map(e => `<option ${dir.estado === e ? 'selected' : ''}>${e}</option>`).join('')}</select><small></small></div>
            </div>
            ${campo('referencias', 'Referencias <em>(opcional)</em>', dir.referencias, { max: 200, ayuda: 'Entre calles, color de la casa, etc.' })}
          </div>` : ''}
        </div>
      </section>

      ${d.pagoEnLinea ? `<section class="ck-sec" aria-labelledby="ckH3">
        <h2 id="ckH3"><span class="ck-num">3</span>¿Cómo quieres pagar?</h2>
        ${d.apartado ? `<div class="ck-opciones ck-modos" id="ckModos" role="radiogroup" aria-label="Cómo quieres pagar">
          <label class="ck-op"><input type="radio" name="modo" value="completo" ${S.modo !== 'apartado' ? 'checked' : ''}>
            <div><b>Pagar todo ahora</b><span>Las prendas son tuyas al momento.</span></div><span class="ck-op-precio" id="ckModoTotal"></span></label>
          <label class="ck-op"><input type="radio" name="modo" value="apartado" ${S.modo === 'apartado' ? 'checked' : ''}>
            <div><b>Apartar con el ${d.apartado.pct}%</b><span id="ckModoNota"></span></div><span class="ck-op-precio" id="ckModoAnticipo"></span></label>
        </div>
        <p class="ck-modo-min" id="ckModoMin" hidden></p>` : ''}
        <div class="ck-opciones ck-metodos" role="radiogroup" aria-labelledby="ckH3">
          ${metodos.includes('clip') ? `<label class="ck-op ck-met clip ${metodos.length === 1 ? 'ck-solo' : ''}">${metodos.length > 1 ? `<input type="radio" name="metodo" value="clip" ${S.metodo === 'clip' ? 'checked' : ''}>` : ''}
            <div><b>Tarjeta de crédito o débito</b><span>Pago seguro procesado por <strong class="ck-clip-txt">Clip</strong></span>
            <div class="ck-marcas" aria-label="Tarjetas aceptadas"><i>Visa</i><i>Mastercard</i></div></div>
            <span class="ck-sello-met clip" aria-hidden="true">Clip</span></label>` : ''}
          ${metodos.includes('paypal') ? `<label class="ck-op ck-met paypal">${metodos.length > 1 ? `<input type="radio" name="metodo" value="paypal" ${S.metodo === 'paypal' ? 'checked' : ''}>` : ''}
            <div><b>PayPal</b><span>Con tu cuenta PayPal o con tarjeta. Útil si tu tarjeta es de Estados Unidos.</span></div>
            <span class="ck-sello-met paypal" aria-hidden="true">PayPal</span></label>` : ''}
          ${metodos.includes('spei') ? `<label class="ck-op ck-met spei ${metodos.length === 1 ? 'ck-solo' : ''}">${metodos.length > 1 ? `<input type="radio" name="metodo" value="spei" ${S.metodo === 'spei' ? 'checked' : ''}>` : ''}
            <div><b>Transferencia SPEI</b><span>Desde la app de tu banco, sin comisión. Te apartamos la prenda ${d.spei?.horas || 3} h mientras transfieres.</span></div>
            <span class="ck-sello-met spei" aria-hidden="true">SPEI</span></label>` : ''}
          <div class="ck-escudo">${ICONO.escudo}<span id="ckEscudoTxt">${textoEscudo()}</span></div>
        </div>
        <button class="ck-pagar ${S.metodo}" type="submit" id="ckPagar">${ICONO.candado}<span>${textoBoton(d.total + envioActual())}</span></button>
        <p class="ck-bajo">Al pagar aceptas los <a href="terminos.html" target="_blank">términos de compra</a>. Los pagos se procesan a través de intermediarios de pago (Clip y PayPal) y llegan a la cuenta del bazar que vende. <a href="terminos.html#pagos" target="_blank">Cómo funciona</a></p>
        ${wa && (window.FormasPago ? window.FormasPago.alternativas() : 'efectivo o transferencia') ? `<p class="ck-alt">¿Prefieres pagar con ${(window.FormasPago ? window.FormasPago.alternativas() : 'efectivo o transferencia')}? <a href="${esc(wa)}" target="_blank" rel="noopener">Apártalas por WhatsApp</a></p>` : ''}
      </section>` : `<section class="ck-sec"><h2><span class="ck-num">3</span>¿Cómo quieres pagar?</h2>
        <p class="ck-nota" style="margin-top:0">Por ahora no estamos recibiendo pagos en línea. Manda tu pedido por WhatsApp y te decimos cómo pagar${(window.FormasPago ? window.FormasPago.alternativas() : 'efectivo o transferencia') ? ` (${(window.FormasPago ? window.FormasPago.alternativas() : 'efectivo o transferencia')})` : ''}.</p>
        ${wa ? `<a class="ck-pagar wa" href="${esc(wa)}" target="_blank" rel="noopener">Mandar pedido por WhatsApp</a>` : ''}</section>`}
    </form>
    ${aside(d, { envio: envioActual() })}`;

    engancharBarra();
    engancharResumen();
    ladoYBarraFija();
    const form = $('#ckForm');
    form.addEventListener('change', e => {
      if (e.target.name === 'entrega') {
        S.entrega = e.target.value; guardar(K.entrega, S.entrega);
        const dirEl = $('#ckDir'); if (dirEl) dirEl.hidden = S.entrega !== 'envio';
        const ptEl = $('#ckPuntos'); if (ptEl) ptEl.hidden = S.entrega !== 'persona';
        if (S.entrega === 'envio' && S.d.envia) revisarCP(true);
        actualizarTotales();
      }
      if (e.target.name === 'paqueteria') { S.opcionEnvio = e.target.value; pintarPaqs(); actualizarTotales(); }
      // v42: cliente frecuente → al terminar de escribir su WhatsApp se vuelve a cotizar
      if (e.target.name === 'telefono' && S.d?.frecuente && !S.d.cupon) {
        const t = e.target.value.replace(/\D/g, '');
        if (t.length >= 10 && t !== S.telFrec) { S.telFrec = t; const antes = S.d.descFrecuente || 0;
          cotizar(null).then(() => { repintarResumen(); if (S.d.descFrecuente && !antes) avisar(`¡Gracias por volver! Por ser cliente frecuente te descontamos ${S.d.frecuente.pct}%.`, 'ok'); }).catch(() => {}); }
      }
      if (e.target.name === 'modo') { S.modo = e.target.value; actualizarTotales(); }
      if (e.target.name === 'metodo') {
        S.metodo = e.target.value; guardar(K.metodo, S.metodo);
        const b = $('#ckPagar'); if (b) { b.classList.remove('clip', 'paypal', 'spei'); b.classList.add(S.metodo); }
        const t = $('#ckEscudoTxt'); if (t) t.textContent = textoEscudo();
        actualizarTotales();
      }
      if (e.target.name === 'punto') {
        S.punto = e.target.value;
        document.querySelectorAll('#ckPuntos .ck-paq').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
        document.getElementById('ckPuntos')?.classList.remove('mal');
        actualizarTotales();
      }
    });
    form.addEventListener('input', e => { if (e.target.name === 'cp' && S.d.envia) revisarCP(); });
    if (S.entrega === 'envio' && S.d.envia) revisarCP(true);
    form.addEventListener('input', e => { const c = e.target.closest('.ck-campo'); if (c?.classList.contains('mal')) { c.classList.remove('mal'); const s = c.querySelector('small'); if (s) s.textContent = s.dataset.ayuda || ''; } });
    form.addEventListener('submit', pagar);
    $('#ckSug').addEventListener('click', e => { const b = e.target.closest('[data-agregar]'); if (b) agregarSugerida(Number(b.dataset.agregar), b); });
    actualizarTotales();
  }

  // ── Envío con envia.com: CP → ciudad/estado/colonias → opciones de paquetería ──
  const sinAcentos = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const ALIAS_ESTADO = { 'distrito federal': 'Ciudad de México', 'mexico': 'Estado de México', 'coahuila de zaragoza': 'Coahuila', 'michoacan de ocampo': 'Michoacán', 'veracruz de ignacio de la llave': 'Veracruz' };
  const estadoDe = nombre => { const n = sinAcentos(nombre); return ESTADOS_MX.find(e => sinAcentos(e) === n) || ALIAS_ESTADO[n] || ESTADOS_MX.find(e => n.startsWith(sinAcentos(e))) || ''; };
  let tCP = null;
  function revisarCP(ya) {
    clearTimeout(tCP);
    tCP = setTimeout(async () => {
      const cp = ($('#fCp')?.value || '').replace(/\D/g, '');
      if (cp.length !== 5) { if (S.envio && S.envio.cp !== cp) { S.envio = null; S.opcionEnvio = null; pintarPaqs(); actualizarTotales(); } return; }
      if (S.envio?.cp === cp && S.envio.ids === S.ids.join(',')) return;
      await cotizarEnvio(cp);
    }, ya ? 0 : 350);
  }
  async function cotizarEnvio(cp) {
    const caja = $('#ckPaqs'); if (!caja) return;
    S.envio = { cp, cargando: true, ids: S.ids.join(',') }; S.opcionEnvio = null;
    pintarPaqs(); actualizarTotales();
    try {
      const r = await api('v-envio-cotizar', { ids: S.d.prendas.map(p => p.id), cp, bazarId: S.bazarId });
      if (($('#fCp')?.value || '').replace(/\D/g, '') !== cp) return;      // ya escribió otro CP
      S.envio = { ...r, cp, ids: S.ids.join(',') };
      S.opcionEnvio = r.opciones[0]?.key || null;
      guardar(K.cp, cp);
      // Llena ciudad, estado y colonias si están vacíos o los había llenado el CP anterior
      const ciudad = $('#fCiudad'), estado = $('#fEstado');
      if (ciudad && (!ciudad.value || ciudad.dataset.auto) && r.ciudad) { ciudad.value = r.ciudad; ciudad.dataset.auto = '1'; }
      const est = estadoDe(r.estado);
      if (estado && est && (!estado.value || estado.dataset.auto)) { estado.value = est; estado.dataset.auto = '1'; }
      const dl = $('#ckColonias'); if (dl) dl.innerHTML = (r.colonias || []).map(c => `<option value="${esc(c)}">`).join('');
      ['cCiudad', 'cEstado'].forEach(id => document.getElementById(id)?.classList.remove('mal'));
    } catch (e) {
      S.envio = { cp, error: e.message, ids: S.ids.join(',') };
    }
    pintarPaqs(); actualizarTotales();
  }
  function pintarPaqs() {
    const caja = $('#ckPaqs'); if (!caja) return;
    const e = S.envio;
    const precioTxt = $('#ckEnvioPrecio');
    if (precioTxt) precioTxt.textContent = e?.opciones?.length ? `Desde ${pesos(Math.min(...e.opciones.map(o => o.precio)))}`.replace('Desde $0', 'Gratis') : 'Según tu CP';
    if (!e) { caja.innerHTML = ''; return; }
    if (e.cargando) { caja.innerHTML = '<p class="ck-paqs-nota"><span class="ck-gira chico"></span>Calculando el envío…</p>'; return; }
    if (e.error) { caja.innerHTML = `<p class="ck-paqs-nota mal">${esc(e.error)}</p>`; return; }
    caja.innerHTML = `<p class="ck-paqs-tit">Envío a ${esc(e.ciudad)}${e.estado ? `, ${esc(e.estado)}` : ''}</p>
      <div role="radiogroup" aria-label="Paquetería">${e.opciones.map(o => `
        <label class="ck-paq ${S.opcionEnvio === o.key ? 'on' : ''}"><input type="radio" name="paqueteria" value="${esc(o.key)}" ${S.opcionEnvio === o.key ? 'checked' : ''}>
          <span><b>${esc(o.paqueteria)}</b> ${esc(o.servicio)}${o.dias ? `<small>Llega en ${esc(o.dias)}</small>` : ''}</span>
          <span class="ck-paq-der">${o.etiqueta ? `<em class="${o.gratis ? 'gratis' : ''}">${esc(o.etiqueta)}</em>` : ''}<strong>${o.precio ? pesos(o.precio) : 'Gratis'}</strong></span></label>`).join('')}</div>
      ${e.gratisDesde && !e.opciones.some(o => o.gratis) ? `<p class="ck-paqs-nota">Envío gratis en compras desde ${pesos(e.gratisDesde)}.</p>` : ''}`;
  }

  // Le falta poco para el siguiente descuento: prendas de su talla para agregar con un toque
  function sugerencias(d) {
    if (!d.sugerencias?.length || !d.siguiente) return '';
    const faltan = d.siguiente.n - d.prendas.length;
    return `<section class="ck-sug" aria-labelledby="ckSugH">
      <h2 id="ckSugH">Agrega ${faltan === 1 ? 'una prenda más' : `${faltan} prendas más`} y te descontamos ${d.siguiente.pct}% en todo</h2>
      <p>De tu talla, por si te gusta alguna:</p>
      <ul>${d.sugerencias.map(p => `<li>
        <a href="prenda.html?id=${p.id}" target="_blank" rel="noopener"><img src="${esc(p.imagen)}" alt="" loading="lazy" width="112" height="140"></a>
        <b>${esc(p.nombre)}</b><span>${esc(p.talla ? `Talla ${p.talla}` : '')}</span>
        <div class="ck-sug-pie"><strong>${p.antes > p.precio ? `<s>${pesos(p.antes)}</s>` : ''}${pesos(p.precio)}</strong>
        <button type="button" data-agregar="${p.id}" aria-label="Agregar ${esc(p.nombre)} a tu pedido">Agregar</button></div></li>`).join('')}</ul>
    </section>`;
  }
  async function agregarSugerida(id, btn) {
    const sug = S.d.sugerencias.find(x => x.id === id); if (!sug) return;
    btn.disabled = true; btn.textContent = 'Agregando…';
    S.ids.push(id);
    if (!S.directo) {
      const bolsa = leer(K.bolsa, []);
      if (!bolsa.some(x => Number(x.id) === id)) guardar(K.bolsa, [...bolsa, { id, bazarId: Number(S.bazarId), nombre: sug.nombre, precio_venta: sug.precio, talla: sug.talla, imagenes: [sug.imagen] }]);
    }
    const antes = S.d.descVolumen;
    try { await cotizar(S.d.cupon?.codigo); }
    catch (e) { S.ids = S.ids.filter(x => x !== id); btn.disabled = false; btn.textContent = 'Agregar'; return avisar(e.message); }
    $('#ckSug').innerHTML = sugerencias(S.d);
    repintarResumen();
    if (S.entrega === 'envio' && S.envio?.cp) cotizarEnvio(S.envio.cp);
    const ahorro = S.d.descVolumen - antes;
    avisar(`Agregaste "${sug.nombre}".${ahorro > 0 ? ` Te ahorras ${pesos(ahorro)} más con el descuento por volumen.` : ''}`, 'ok');
  }

  // ── Métodos de pago: Clip (tarjeta) y PayPal ──
  const nombreMetodo = m => m === 'paypal' ? 'PayPal' : m === 'spei' ? 'transferencia' : 'Clip';
  // ── Apartar con anticipo ──
  const apartadoDisp = total => !!S.d?.apartado && total >= (S.d.apartado.minimo || 0);
  const anticipoDe = total => Math.min(total, Math.max(1, Math.ceil(total * (S.d?.apartado?.pct || 50) / 100)));
  const fechaLarga = iso => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' });
  const fechaLimite = () => fechaLarga(Date.now() + (S.d?.apartado?.dias || 7) * 864e5);
  const textoBoton = total => {
    const ap = S.modo === 'apartado' && apartadoDisp(total);
    const monto = ap ? anticipoDe(total) : total;
    if (S.metodo === 'spei') return `Apartar y transferir ${pesos(monto)}`;
    return `${ap ? 'Apartar con' : 'Pagar'} ${pesos(monto)} MXN${S.metodo === 'paypal' ? ' con PayPal' : ''}`;
  };
  const textoEscudo = () => S.metodo === 'spei'
    ? 'Al tocar el botón te mostramos la CLABE y el monto exacto. Transfiere desde tu banco y sube la captura en tu recibo; en cuanto lo confirmamos, tu pedido queda pagado.'
    : S.metodo === 'paypal'
    ? 'PayPal procesa este pago como intermediario: al tocar Pagar te llevamos a PayPal para aprobarlo. Se cobra en pesos; si tu tarjeta es en dólares, PayPal hace la conversión. Stiimpys no ve tus datos de pago.'
    : 'Clip procesa este pago como intermediario: al tocar Pagar te llevamos a su página segura para poner tu tarjeta. Stiimpys no ve ni guarda los datos de tu tarjeta.';

  function campo(id, etiquetaTxt, valor, { auto = 'off', max = 80, tipo = 'text', modo, ayuda = '', lista } = {}) {
    const fid = 'f' + id[0].toUpperCase() + id.slice(1);
    return `<div class="ck-campo" id="c${id[0].toUpperCase() + id.slice(1)}"><label for="${fid}">${etiquetaTxt}</label>
      <input id="${fid}" name="${id}" type="${tipo}" maxlength="${max}" autocomplete="${auto}" ${modo ? `inputmode="${modo}"` : ''} ${lista ? `list="${lista}"` : ''} value="${esc(valor || '')}" aria-describedby="${fid}Ayuda">
      <small id="${fid}Ayuda" data-ayuda="${esc(ayuda)}">${esc(ayuda)}</small></div>`;
  }
  // ── Puntos de entrega en persona ──
  const puntoGratis = () => S.d.entregaGratisDesde > 0 && S.d.total > S.d.entregaGratisDesde;
  const costoPunto = p => !p ? 0 : puntoGratis() ? 0 : p.costo;
  const precioPuntoTxt = p => costoPunto(p) ? pesos(costoPunto(p)) : (p.costo && puntoGratis() ? `<s>${pesos(p.costo)}</s> Gratis` : 'Gratis');
  function precioPersona() {
    const pts = S.d.puntosEntrega || [];
    if (!pts.length) return 'Gratis';
    const sel = pts.find(p => p.id === S.punto);
    if (sel) return costoPunto(sel) ? pesos(costoPunto(sel)) : 'Gratis';
    const max = Math.max(...pts.map(costoPunto));
    return max ? `Gratis o ${pesos(max)}` : 'Gratis';
  }
  function notaPuntos() {
    const pts = S.d.puntosEntrega || [], umbral = S.d.entregaGratisDesde;
    const conCosto = pts.filter(p => p.costo > 0);
    if (!conCosto.length || !umbral) return '';
    const nombres = conCosto.map(p => p.nombre).join(' y ').replace(/ y (?=.* y )/g, ', ');
    if (puntoGratis()) return `Tu compra es de más de ${pesos(umbral)}: la entrega es gratis en cualquier punto.`;
    return `${nombres}: gratis en compras de más de ${pesos(umbral)}. Te faltan ${pesos(umbral - S.d.total + 1)}.`;
  }
  const envioActual = () => {
    if (S.entrega === 'persona') return costoPunto((S.d?.puntosEntrega || []).find(p => p.id === S.punto));
    if (S.entrega !== 'envio') return 0;
    if (S.d?.envia) return S.envio?.opciones?.find(o => o.key === S.opcionEnvio)?.precio || 0;
    return S.d?.envioCosto > 0 ? S.d.envioCosto : 0;
  };
  const envioPorCalcular = () => (S.entrega === 'envio' && !!S.d?.envia && !S.envio?.opciones?.find(o => o.key === S.opcionEnvio))
    || (S.entrega === 'persona' && (S.d?.puntosEntrega || []).length > 0 && !S.punto);
  function actualizarTotales() {
    const total = S.d.total + envioActual();
    const set = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };
    set('#ckLineaEnvio', envioPorCalcular() ? (S.entrega === 'persona' ? 'Elige un punto' : 'Por calcular') : envioActual() ? pesos(envioActual()) : 'Gratis');
    if ((S.d.puntosEntrega || []).length) {
      set('#ckPersonaPrecio', precioPersona());
      set('#ckPuntoNota', notaPuntos());
      S.d.puntosEntrega.forEach(p => { const el = document.querySelector(`[data-punto-precio="${p.id}"]`); if (el) el.innerHTML = precioPuntoTxt(p); });
    }
    set('#ckTotal', `${pesos(total)}<small>MXN</small>`);
    set('#ckTotalBarra', pesos(total));
    // Apartado: qué paga hoy y qué paga después (si la compra llega al mínimo)
    if (S.d.apartado) {
      const puede = apartadoDisp(total), anticipo = anticipoDe(total);
      if (!puede && S.modo === 'apartado') { S.modo = 'completo'; const r = document.querySelector('input[name="modo"][value="completo"]'); if (r) r.checked = true; }
      const modos = $('#ckModos'); if (modos) modos.hidden = !puede;
      const min = $('#ckModoMin'); if (min) { min.hidden = puede || !S.d.apartado.minimo; min.textContent = `Puedes apartar con el ${S.d.apartado.pct}% en compras desde ${pesos(S.d.apartado.minimo)}.`; }
      set('#ckModoTotal', pesos(total));
      set('#ckModoAnticipo', pesos(anticipo));
      set('#ckModoNota', `Hoy pagas ${pesos(anticipo)} y el resto, ${pesos(total - anticipo)}, antes del ${fechaLimite()}: en línea desde tu recibo${S.entrega === 'envio' ? '. Lo enviamos cuando liquides.' : ' o en persona al recogerla.'}`);
      const ap = puede && S.modo === 'apartado';
      const caja = $('#ckApartadoLineas');
      if (caja) { caja.hidden = !ap; if (ap) caja.innerHTML = `<div><dt>Hoy pagas (${S.d.apartado.pct}%)</dt><dd>${pesos(anticipo)}</dd></div><div><dt>Antes del ${fechaLimite()}</dt><dd>${pesos(total - anticipo)}</dd></div>`; }
    }
    set('#ckNum', String(S.d.prendas.length));
    set('#ckUsd', esc(usd(total, S.d.moneda)));
    const btn = $('#ckPagar span'); if (btn && !S.enviando) btn.textContent = textoBoton(total);
    const lado = $('#ckPagarLado span'); if (lado && !S.enviando) lado.textContent = textoBoton(total);
    set('#ckFijaTotal', pesos(S.modo === 'apartado' && S.d.apartado && apartadoDisp(total) ? anticipoDe(total) : total));
    set('#ckFijaEt', S.modo === 'apartado' && S.d.apartado && apartadoDisp(total) ? 'Hoy pagas' : 'Total');
  }
  function engancharResumen() {
    const f = $('#ckCupon');
    if (f) f.onsubmit = async e => {
      e.preventDefault();
      const codigo = $('#ckCuponIn').value.trim(); if (!codigo) return;
      const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Revisando…';
      try { await cotizar(codigo); } catch (err) { S.d.cuponError = err.message; }
      repintarResumen();
      if (S.d.cupon) avisar(`Cupón ${S.d.cupon.codigo} aplicado.`, 'ok');
    };
    const q = $('#ckQuitarCupon');
    if (q) q.onclick = async () => { guardar(K.cupon, null); try { await cotizar(null); } catch {} repintarResumen(); };
  }
  function repintarResumen() {
    const abierto = $('#ckAside')?.classList.contains('abierto');
    $('#ckTagWrap').innerHTML = etiqueta(S.d, { envio: envioActual() });
    if (abierto) $('#ckAside').classList.add('abierto');
    engancharResumen(); actualizarTotales();
  }
  function avisar(texto, tipo = 'mal') {
    const m = $('#ckMsg'); if (!m) return;
    m.innerHTML = texto ? `<p class="ck-aviso ${tipo}" role="${tipo === 'mal' ? 'alert' : 'status'}">${esc(texto)}</p>` : '';
    if (texto && tipo === 'mal') m.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function validar() {
    const form = $('#ckForm'), v = n => (form.elements[n]?.value || '').trim();
    const errores = [];
    const marcar = (id, msg) => {
      const c = document.getElementById('c' + id[0].toUpperCase() + id.slice(1)); if (!c) return;
      c.classList.add('mal'); const s = c.querySelector('small'); if (s) s.textContent = msg;
      errores.push(c.querySelector('input,select'));
    };
    if (v('nombre').length < 2) marcar('nombre', 'Escribe tu nombre.');
    if (v('telefono').replace(/\D/g, '').length < 10) marcar('telefono', 'Escribe tu WhatsApp a 10 dígitos.');
    if (v('email') && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v('email'))) marcar('email', 'Revisa tu correo.');
    if (S.entrega === 'persona' && (S.d.puntosEntrega || []).length && !S.punto) {
      const pt = $('#ckPuntos'); pt?.classList.add('mal');
      errores.push(pt?.querySelector('input'));
    }
    if (S.entrega === 'envio') {
      if (v('calle').length < 4) marcar('calle', 'Escribe calle y número.');
      if (!v('colonia')) marcar('colonia', 'Escribe tu colonia.');
      if (v('cp').replace(/\D/g, '').length !== 5) marcar('cp', 'El código postal tiene 5 números.');
      if (!v('ciudad')) marcar('ciudad', 'Escribe tu ciudad.');
      if (!v('estado')) marcar('estado', 'Elige tu estado.');
      if (S.d.envia && v('cp').replace(/\D/g, '').length === 5 && envioPorCalcular()) {
        errores.push($('#fCp'));
        avisar(S.envio?.error ? 'No se pudo calcular el envío a ese código postal. Revisa el código o elige entrega en persona.' : 'Espera a que calculemos el envío y elige una paquetería.');
        return false;
      }
    }
    if (errores.length) {
      errores[0]?.focus();
      avisar(errores.length === 1 && $('#ckPuntos')?.classList.contains('mal') ? 'Elige dónde te entregamos tu pedido.' : errores.length === 1 ? 'Revisa el campo marcado en rojo.' : `Revisa los ${errores.length} campos marcados en rojo.`);
    }
    return !errores.length;
  }

  async function pagar(e) {
    e.preventDefault();
    if (S.enviando || !S.d.pagoEnLinea) return;
    avisar('');
    if (!validar()) return;
    const f = $('#ckForm').elements, v = n => (f[n]?.value || '').trim();
    const contacto = { nombre: v('nombre'), telefono: v('telefono'), email: v('email') };
    guardar(K.contacto, contacto);
    let direccion;
    if (S.entrega === 'envio') { direccion = { calle: v('calle'), colonia: v('colonia'), cp: v('cp'), ciudad: v('ciudad'), estado: v('estado'), referencias: v('referencias') }; guardar(K.dir, direccion); }
    const btn = $('#ckPagar'); S.enviando = true; btn.disabled = true;
    btn.querySelector('span').textContent = S.metodo === 'spei' ? 'Apartando tu pedido…' : `Abriendo ${S.metodo === 'paypal' ? 'PayPal' : 'el pago seguro de Clip'}…`;
    try {
      const r = await api('v-pagar', { ids: S.d.prendas.map(p => p.id), ...contacto, entrega: S.entrega, direccion, cupon: S.d.cupon?.codigo, previo: previo(),
        envioCotizacion: S.entrega === 'envio' ? S.envio?.cotizacion : undefined, envioOpcion: S.entrega === 'envio' ? S.opcionEnvio : undefined,
        punto: S.entrega === 'persona' ? S.punto || undefined : undefined, metodo: S.metodo, origen: window.StmpOrigen?.get() || undefined,
        modo: S.modo === 'apartado' && apartadoDisp(S.d.total + envioActual()) ? 'apartado' : undefined });
      if (S.entrega === 'persona' && S.punto) guardar(K.punto, S.punto);
      guardar(K.pedido, { id: r.pedido, clave: r.clave, bazarId: S.bazarId, ids: S.d.prendas.map(p => p.id), directo: S.directo, en: Date.now() });
      agregarHistorial({ id: r.pedido, k: r.clave, total: r.total, en: new Date().toISOString(), estado: 'pendiente' });
      location.href = r.url;
    } catch (err) {
      S.enviando = false; btn.disabled = false; actualizarTotales();
      if (err.status === 409) { try { await cotizar(S.d.cupon?.codigo); repintarResumen(); } catch {} }
      if (err.recotizar && S.envio?.cp) { await cotizarEnvio(S.envio.cp); }
      avisar(err.message);
    }
  }

  // ═════════════════════════════════════════════════════════
  //  Confirmación del pedido
  // ═════════════════════════════════════════════════════════
  async function iniciarConfirmacion() {
    const id = Q.get('pedido');
    const local = leer(K.pedido, null);
    const k = Q.get('k') || (local?.id === id ? local.clave : '');
    S.k = k;
    const fallo = Q.get('fallo') === '1';
    let intentos = 0;
    const revisar = async () => {
      let r;
      try { r = await api('v-pedido', null, `&id=${encodeURIComponent(id)}&k=${encodeURIComponent(k || '')}`); }
      catch (e) { if (e.status === 404) return pintarConf({ estado: 'noexiste', id }); r = null; }
      if (r?.estado === 'pagado' || r?.estado === 'cancelado') return pintarConf(r);
      // v42: transferencia SPEI → datos de la cuenta y subir comprobante; se revisa cada 30 s por si ya lo confirmaron
      if (r?.estado === 'pendiente' && r.spei && !(r.expira && Date.parse(r.expira) < Date.now() - 5000)) {
        if (!$('#ckSpei')) pintarConf({ ...r, estado: 'spei' });
        else if (r.spei.enRevision) marcarSpeiEnRevision();
        return setTimeout(revisar, 30000);
      }
      if (r?.estado === 'apartado') {
        // Regresa de pagar el resto: se espera unos segundos a que el pago se confirme
        const esperando = Q.get('resto') === '1' && !fallo && intentos < 6;
        if (!esperando) return pintarConf({ ...r, falloResto: fallo && Q.get('resto') === '1', restoTarda: Q.get('resto') === '1' && !fallo });
      }
      else if (r && (r.estado === 'expirado' || fallo)) return pintarConf({ ...r, estado: fallo ? 'fallo' : 'expirado' });
      // v36: el apartado de 10 minutos ya pasó y no llegó ningún pago
      else if (r && r.estado === 'pendiente' && r.expira && Date.parse(r.expira) < Date.now() - 5000) return pintarConf({ ...r, estado: 'expirado' });
      if (++intentos > 20) return pintarConf({ ...(r || { id }), estado: 'proceso' });
      if (intentos === 1) pintarConf({ ...(r || { id }), estado: 'revisando' });
      setTimeout(revisar, 3000);
    };
    revisar();
  }

  // v42 · Comprobante de transferencia: se achica en el navegador (máx. 1600 px, JPG) y se sube
  function marcarSpeiEnRevision() {
    const c = $('#ckSpeiSubir'); if (c) c.innerHTML = `<p class="ck-aviso ok">${ICONO.check} Recibimos tu comprobante. En cuanto veamos el dinero en la cuenta, esta página cambia a <b>Pagado</b> y te avisamos por WhatsApp. Tu prenda sigue apartada.</p>`;
  }
  function achicarFoto(file, max = 1600) {
    return new Promise((ok, mal) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No pudimos leer esa imagen. Prueba con una captura de pantalla.')); };
      img.src = url;
    });
  }
  function engancharSpei(r) {
    const inp = $('#ckSpeiFoto'); if (!inp) return;
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      const msg = $('#ckSpeiMsg'), lbl = inp.closest('label');
      if (f.size > 15 * 1024 * 1024) { msg.className = 'ck-resto-msg mal'; msg.textContent = 'Esa imagen es muy pesada. Toma una captura de pantalla.'; return; }
      lbl.classList.add('cargando'); lbl.querySelector('span').textContent = 'Subiendo…'; msg.textContent = '';
      try {
        const imagen = await achicarFoto(f);
        const sub = await api('v-spei-comprobante', { id: r.id, k: S.k, imagen });
        marcarSpeiEnRevision();
        // v43: si la revisión automática está prendida, la IA lo lee y se pregunta a Banxico
        if (sub.revisar) api('v-spei-verificar', { id: r.id, k: S.k }).then(v => { if (v.pagado) location.reload(); }).catch(() => {});
      } catch (e) {
        lbl.classList.remove('cargando'); lbl.querySelector('span').textContent = 'Subir comprobante'; inp.value = '';
        msg.className = 'ck-resto-msg mal'; msg.textContent = e.message;
      }
    };
  }

  function datosParaEtiqueta(r) {
    const items = r.items || [];
    // Precio de lista de cada prenda (el descuento se muestra abajo, una sola vez)
    const prendas = items.filter(x => x.id !== 'envio').map(x => ({ id: x.id, nombre: x.nombre, precio: x.lista ?? x.precio, imagen: x.imagen || '', talla: x.talla || '', estado: '' }));
    const subtotalItems = prendas.reduce((t, x) => t + x.precio, 0);
    return { prendas, subtotal: r.subtotal ?? subtotalItems, descVolumen: r.descVolumen || 0, descCupon: r.descCupon || 0, descFrecuente: r.descFrecuente || 0, descOutfit: r.descOutfit || 0, frecuente: r.descFrecuente ? { pct: Math.round(r.descFrecuente / Math.max(1, (r.subtotal || 0) - (r.descVolumen || 0) - (r.descCupon || 0)) * 100) } : null, cuponCodigo: r.cupon,
      tramo: r.descVolumen && r.subtotal ? { pct: Math.round(r.descVolumen / r.subtotal * 100) } : null, total: (r.total || 0) - (r.envio || 0), moneda: null };
  }

  // Línea de tiempo del pedido: Pagado → (Enviado) → Entregado
  function seguimiento(r) {
    const f = iso => iso ? new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
    const ee = r.entregaEstado || 'pendiente', envio = r.entrega === 'envio';
    const ap = r.apartado;
    const pasos = ap ? [{ t: 'Apartado', d: `${f(ap.anticipoPagadoEn)} · anticipo de ${pesos(ap.anticipo)}`, ok: true },
      { t: 'Liquidado', ok: r.estado === 'pagado', d: r.estado === 'pagado' ? `${f(ap.liquidadoEn || r.pagadoEn)} · resto de ${pesos(ap.resta)}` : `Faltan ${pesos(ap.resta)}${ap.liquidarAntes ? ` antes del ${fechaLarga(ap.liquidarAntes)}` : ''}.` }]
      : [{ t: 'Pagado', d: f(r.pagadoEn), ok: true }];
    if (envio) pasos.push({ t: 'Enviado', ok: ee !== 'pendiente', d: ee !== 'pendiente'
      ? `${f(r.enviadoEn)}<br>${esc(r.paqueteria)}, guía <span class="ck-guia">${esc(r.guia)}</span> <button type="button" class="ck-copiar" data-copiar="${esc(r.guia)}">Copiar</button>${r.rastreo && /^https:\/\//.test(r.rastreo) ? ` <a class="ck-copiar" href="${esc(r.rastreo)}" target="_blank" rel="noopener">Rastrear</a>` : ''}`
      : 'Preparamos tu paquete. Te mandamos la guía por WhatsApp.' });
    pasos.push({ t: 'Entregado', ok: ee === 'entregado', d: ee === 'entregado' ? f(r.entregadoEn) : envio ? (ee === 'enviado' ? 'En camino. Rastréalo con tu número de guía en la página de la paquetería.' : '') : r.punto ? `Te escribimos para quedar el día y la hora en ${esc(r.punto.nombre)}.` : 'Te escribimos para quedar en el lugar y la hora.' });
    const actual = pasos.findIndex(p => !p.ok);
    return `<ol class="ck-linea" aria-label="Estado de tu pedido">${pasos.map((p, i) => `
      <li class="${p.ok ? 'hecho' : i === actual ? 'actual' : ''}" ${i === actual ? 'aria-current="step"' : ''}>
        <b>${p.t}</b>${p.d ? `<span>${p.d}</span>` : ''}</li>`).join('')}</ol>`;
  }

  // Reseña verificada (se pide cuando ya lo recibió)
  const ESTRELLA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6-4.5-4.2 6.1-.8z"/></svg>';
  // v42 · Cliente frecuente (cuántas compras lleva) y cupón de cumpleaños
  function bloqueCliente(r) {
    let h = '';
    // v43: su código para invitar amigos
    if (r.referido) {
      const txt = `Te regalo ${r.referido.pctAmigo}% en tu primera compra en Stiimpys con mi código ${r.referido.codigo} 👉 ${location.origin}/tienda.html?utm_source=whatsapp&utm_medium=referido`;
      h += `<section class="ck-frec ck-ref" aria-label="Invita a tus amigos"><b>👯 Invita a tus amigos</b>
        <p>Ellos tienen <b>${r.referido.pctAmigo}%</b> en su primera compra con tu código <b class="ck-ref-cod">${esc(r.referido.codigo)}</b>, y tú ganas <b>${r.referido.pctPremio}%</b> por cada amigo que compre.${r.referido.invitados ? ` Llevas ${r.referido.invitados}.` : ''}</p>
        <div class="ck-ref-acc"><a class="ck-copiar" href="https://wa.me/?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">Mandar por WhatsApp</a>
        <button type="button" class="ck-copiar" data-copiar="${esc(r.referido.codigo)}">Copiar código</button></div></section>`;
    }
    if (r.googleResena && /^https:\/\//.test(r.googleResena)) h += `<p class="ck-google"><a class="ck-pagar sec" href="${esc(r.googleResena)}" target="_blank" rel="noopener">⭐ Déjanos tu reseña en Google</a></p>`;
    const f = r.frecuente;
    if (f) {
      const hechas = f.faltan === 0 ? f.cada : f.cada - f.faltan;
      h += `<section class="ck-frec" aria-label="Cliente frecuente"><div class="ck-frec-puntos">${Array.from({ length: f.cada }, (_, i) => `<i class="${i < hechas ? 'on' : ''}"></i>`).join('')}<b>+${f.pct}%</b></div>
        <p>${f.faltan === 0 ? `¡Tu siguiente compra tiene <b>${f.pct}% de descuento</b>! Se aplica solo al pagar con este WhatsApp.` : `Llevas ${hechas} de ${f.cada}. Te ${f.faltan === 1 ? 'falta 1 compra' : `faltan ${f.faltan} compras`} para tu <b>${f.pct}% de descuento</b>.`}</p></section>`;
    }
    if (r.cumple && !r.cumple.dado) {
      const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
      h += `<form class="ck-cumple" id="ckCumple"><b>🎂 ¿Cuándo es tu cumpleaños?</b><span>Te mandamos ${r.cumple.pct}% de regalo a tu correo ese día.</span>
        <div class="ck-cumple-f"><label class="sr" for="ckCumDia">Día</label><select id="ckCumDia" required><option value="">Día</option>${Array.from({ length: 31 }, (_, i) => `<option>${i + 1}</option>`).join('')}</select>
        <label class="sr" for="ckCumMes">Mes</label><select id="ckCumMes" required><option value="">Mes</option>${meses.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select>
        <button type="submit" class="ck-copiar">Guardar</button></div><small id="ckCumMsg" role="status"></small></form>`;
    }
    return h;
  }
  function engancharCumple(r) {
    const f = $('#ckCumple'); if (!f) return;
    f.onsubmit = async e => {
      e.preventDefault();
      const d = $('#ckCumDia').value, m = $('#ckCumMes').value; if (!d || !m) return;
      const msg = $('#ckCumMsg');
      try { await api('v-cumple', { id: r.id, k: S.k, cumple: `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` }); f.innerHTML = '<b>🎂 ¡Listo!</b><span>Ese día te llega tu regalo al correo.</span>'; }
      catch (err) { msg.textContent = err.message; }
    };
  }
  function formResena(r) {
    if (r.resena) return `<p class="ck-resena-hecha"><span class="ck-estrellas-fijas" aria-label="${r.resena.estrellas} de 5 estrellas">${ESTRELLA.repeat(r.resena.estrellas)}</span>Gracias por calificar tu compra.</p>`;
    return `<section class="ck-resena" id="ckResena" aria-labelledby="ckResH">
      <h2 id="ckResH">¿Cómo te fue con tu compra?</h2>
      <p>Tu reseña aparece en la tienda como compra verificada y le ayuda a otros a comprar con confianza.</p>
      <div class="ck-estrellas" role="radiogroup" aria-label="Calificación">${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" aria-checked="false" aria-label="${n} ${n === 1 ? 'estrella' : 'estrellas'}" data-est="${n}">${ESTRELLA}</button>`).join('')}</div>
      <div class="ck-etiq">${(r.etiquetas || []).map(e => `<button type="button" aria-pressed="false" data-etiq="${esc(e)}">${esc(e)}</button>`).join('')}</div>
      <label class="sr" for="ckComent">Comentario</label>
      <textarea id="ckComent" maxlength="500" rows="3" placeholder="Cuéntanos qué te pareció (opcional)"></textarea>
      <div class="ck-res-fotos" id="ckResFotos"><label class="ck-res-mas"><input type="file" id="ckResFoto" accept="image/*" multiple hidden><span>+ Agregar fotos</span><small>Hasta 3. ¿Cómo te queda?</small></label></div>
      <p class="ck-cupon-msg" id="ckResErr" role="alert"></p>
      <button type="button" class="ck-pagar" id="ckResBtn" disabled>Publicar reseña</button>
    </section>`;
  }
  function engancharResena(r) {
    const sec = $('#ckResena'); if (!sec) return;
    let estrellas = 0;
    const pintar = n => sec.querySelectorAll('[data-est]').forEach(b => { const on = Number(b.dataset.est) <= n; b.classList.toggle('on', on); b.setAttribute('aria-checked', Number(b.dataset.est) === n); });
    sec.querySelectorAll('[data-est]').forEach(b => {
      b.onclick = () => { estrellas = Number(b.dataset.est); pintar(estrellas); $('#ckResBtn').disabled = false; };
      b.onmouseenter = () => pintar(Number(b.dataset.est));
      b.onmouseleave = () => pintar(estrellas);
    });
    sec.querySelectorAll('[data-etiq]').forEach(b => b.onclick = () => b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true'));
    // v42: fotos de la reseña (se achican antes de subir)
    const fotos = [];
    const pintarFotos = () => {
      const cont = $('#ckResFotos'); cont.querySelectorAll('.ck-res-foto').forEach(x => x.remove());
      cont.insertAdjacentHTML('afterbegin', fotos.map((f, i) => `<span class="ck-res-foto"><img src="${f}" alt="Foto ${i + 1}"><button type="button" data-quitar="${i}" aria-label="Quitar foto">×</button></span>`).join(''));
      cont.querySelector('.ck-res-mas').hidden = fotos.length >= 3;
      cont.querySelectorAll('[data-quitar]').forEach(b => b.onclick = () => { fotos.splice(Number(b.dataset.quitar), 1); pintarFotos(); });
    };
    $('#ckResFoto').onchange = async e => {
      for (const f of [...e.target.files].slice(0, 3 - fotos.length)) {
        try { fotos.push(await achicarFoto(f, 1200)); } catch (err) { $('#ckResErr').textContent = err.message; }
      }
      e.target.value = ''; pintarFotos();
    };
    $('#ckResBtn').onclick = async () => {
      const btn = $('#ckResBtn'); btn.disabled = true; btn.textContent = 'Publicando…';
      try {
        if (fotos.length) btn.textContent = 'Subiendo fotos…';
        const res = await api('v-resena', { id: r.id, k: S.k, estrellas, comentario: $('#ckComent').value.trim(), fotos: fotos.length ? fotos : undefined,
          etiquetas: [...sec.querySelectorAll('[data-etiq][aria-pressed="true"]')].map(b => b.dataset.etiq) });
        sec.outerHTML = formResena({ resena: { estrellas } }) + (res.revision ? '<p class="ck-nota">Tus fotos aparecen en la tienda en cuanto las revisemos. ¡Gracias!</p>' : '');
      } catch (e) { $('#ckResErr').textContent = e.message; btn.disabled = false; btn.textContent = 'Publicar reseña'; }
    };
  }

  // ── Guardar el recibo: compartir, mandárselo por WhatsApp, PDF ──
  function cajaGuardar(r) {
    const puedeCompartir = typeof navigator.share === 'function';
    return `<section class="ck-guardar" aria-labelledby="ckGuardarH">
      <h2 id="ckGuardarH">Guarda tu recibo</h2>
      <p>Este link es tu recibo y el seguimiento de tu pedido. También queda en <a href="pagar.html?mis=1">Mis pedidos</a> en este celular, y te lo mandamos por WhatsApp.</p>
      <div class="ck-guardar-btns">
        ${r.telefono ? `<button type="button" class="ck-pagar wa" data-guardar="wa">Mandármelo por WhatsApp</button>` : ''}
        <button type="button" class="ck-pagar sec" data-guardar="${puedeCompartir ? 'compartir' : 'copiar'}">${puedeCompartir ? 'Compartir o guardar link' : 'Copiar link'}</button>
        <button type="button" class="ck-pagar sec" data-guardar="pdf">Guardar en PDF</button>
      </div>
      <p class="ck-guardar-ok" id="ckGuardarOk" role="status"></p>
    </section>`;
  }
  async function guardarRecibo(como, r) {
    const url = linkRecibo(r.id, S.k);
    const texto = `Mi recibo de ${r.bazar || 'Stiimpys'}, pedido ${r.id} (${pesos(r.total)}):\n${url}`;
    const ok = t => { const el = $('#ckGuardarOk'); if (el) el.textContent = t; };
    if (como === 'pdf') return print();
    if (como === 'wa') {
      // WhatsApp permite mandarse mensajes a uno mismo: el link queda en su chat
      const n = String(r.telefono || '').replace(/\D/g, '').slice(-10);
      window.open(`https://wa.me/52${n}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
      return ok('Se abrió WhatsApp con tu recibo. Mándalo a tu propio chat para tenerlo siempre.');
    }
    if (como === 'compartir') {
      try { await navigator.share({ title: `Recibo ${r.id}`, text: texto, url }); return ok('Listo.'); } catch (e) { if (e?.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); ok('Link copiado. Pégalo en tus notas o mándatelo por correo.'); }
    catch { prompt('Copia el link de tu recibo:', url); }
  }

  // ═════════════════════════════════════════════════════════
  //  Mis pedidos
  // ═════════════════════════════════════════════════════════
  const ESTADO_TXT = p => p.estado === 'apartado' ? [`Apartado, faltan ${pesos(p.resta)}`, 'ambar'] : p.estado === 'cancelado' ? ['Apartado cancelado', 'gris']
    : p.estado !== 'pagado' ? (p.estado === 'pendiente' ? ['Pago sin terminar', 'gris'] : ['No se pagó', 'gris'])
    : p.entregaEstado === 'entregado' ? ['Entregado', 'ok'] : p.entregaEstado === 'enviado' ? ['En camino', 'azul'] : [p.entrega === 'envio' ? 'Pagado, por enviar' : 'Pagado, por entregar', 'ambar'];
  async function iniciarMisPedidos() {
    document.title = 'Mis pedidos | Stiimpys';
    const lista = historial();
    let pedidos = [];
    if (lista.length) {
      try { pedidos = (await api('v-mis-pedidos', { pedidos: lista.map(x => ({ id: x.id, k: x.k })) })).pedidos; } catch (e) { pedidos = null; }
    }
    pintarMisPedidos(pedidos, lista);
  }
  function tarjetaPedido(p, k) {
    const [txt, cls] = ESTADO_TXT(p);
    const fecha = new Date(p.pagadoEn || p.en).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
    return `<li class="ck-mp"><a href="${esc(linkRecibo(p.id, k))}">
      <div class="ck-mp-fotos">${p.items.slice(0, 3).map(i => i.imagen ? `<img src="${esc(i.imagen)}" alt="" loading="lazy">` : '<span></span>').join('')}</div>
      <div class="ck-mp-txt"><b>${esc(p.items.map(i => i.nombre).join(', '))}</b>
        <span>${esc(fecha)}, pedido ${esc(p.id)}</span>
        <span>${p.estado === 'apartado' ? `Liquida antes del ${p.liquidarAntes ? esc(fechaLarga(p.liquidarAntes)) : 'la fecha acordada'}` : p.estado === 'pagado' ? (p.entrega === 'envio' ? `Envío${p.paqueteria ? ` con ${esc(p.paqueteria)}` : ''}${p.guia ? `, guía ${esc(p.guia)}` : ''}` : `Entrega en persona${p.punto ? `: ${esc(p.punto)}` : ''}`) : ''}</span></div>
      <div class="ck-mp-der"><em class="${cls}">${txt}</em><strong>${pesos(p.total)}</strong></div></a></li>`;
  }
  function pintarMisPedidos(pedidos, lista) {
    const ks = Object.fromEntries(lista.map(x => [x.id, x.k]));
    const pagados = (pedidos || []).filter(p => ['pagado', 'apartado'].includes(p.estado));
    const otros = (pedidos || []).filter(p => !['pagado', 'apartado'].includes(p.estado));
    raiz.innerHTML = `<section class="ck-form ck-mis">
      <h1>Mis pedidos</h1>
      <p class="ck-lead">Tus recibos y el seguimiento de lo que compraste en línea desde este celular.</p>
      <div id="ckMsg"></div>
      ${pedidos === null ? '<p class="ck-aviso mal">No se pudieron cargar tus pedidos. Revisa tu internet e intenta de nuevo.</p>' : ''}
      ${pagados.length ? `<ul class="ck-mp-lista">${pagados.map(p => tarjetaPedido(p, ks[p.id])).join('')}</ul>` : pedidos !== null ? `<p class="ck-mis-vacio">${lista.length ? 'Aún no tienes compras pagadas en este celular.' : 'Aquí aparecen tus compras en línea. Si compraste en otro celular o borraste los datos del navegador, recupera tu pedido abajo.'}</p>` : ''}
      ${otros.length ? `<h2 class="ck-mis-sub">Pagos sin terminar</h2><ul class="ck-mp-lista">${otros.map(p => tarjetaPedido(p, ks[p.id])).join('')}</ul>` : ''}
      <section class="ck-recuperar" aria-labelledby="ckRecH">
        <h2 id="ckRecH">¿No ves tu pedido?</h2>
        <p>Escribe el WhatsApp con el que compraste y tu número de pedido (viene en tu recibo y en el WhatsApp que te mandamos; bastan los últimos 6 caracteres). Si diste tu correo, también sirve.</p>
        <form id="ckRecForm" novalidate>
          <div class="ck-fila">
            ${campo('recTel', 'WhatsApp', leer(K.contacto, {})?.telefono || '', { auto: 'tel-national', max: 16, modo: 'tel' })}
            ${campo('recCodigo', 'Número de pedido o correo', '', { max: 120 })}
          </div>
          <button class="ck-pagar" type="submit">Buscar mi pedido</button>
        </form>
        <div id="ckRecRes"></div>
      </section>
      <div class="ck-acciones"><a class="ck-pagar sec" href="tienda.html">Seguir comprando</a></div>
    </section>`;
    $('#ckRecForm').onsubmit = async e => {
      e.preventDefault();
      const t = $('#fRecTel').value, c = $('#fRecCodigo').value.trim();
      const res = $('#ckRecRes'); res.innerHTML = '<p class="ck-paqs-nota"><span class="ck-gira chico"></span>Buscando…</p>';
      try {
        const r = await api('v-recuperar-pedido', c.includes('@') ? { telefono: t, email: c } : { telefono: t, codigo: c.slice(-12) });
        r.pedidos.forEach(p => agregarHistorial({ id: p.id, k: p.k, total: p.total, en: p.en, estado: p.estado }));
        res.innerHTML = `<p class="ck-aviso ok">Encontramos ${r.pedidos.length === 1 ? 'tu pedido' : `${r.pedidos.length} pedidos`}. Ya quedaron guardados en este celular.</p>
          <ul class="ck-mp-lista">${r.pedidos.map(p => tarjetaPedido(p, p.k)).join('')}</ul>`;
      } catch (err) { res.innerHTML = `<p class="ck-aviso mal">${esc(err.message)}</p>`; }
    };
  }

  function pintarConf(r) {
    const d = datosParaEtiqueta(r);
    const proveedor = nombreMetodo(r.proveedor);
    const ultimo = leer(K.pedido, {}) || {};
    const idsReintento = (r.ids || (ultimo.id === r.id ? ultimo.ids : null) || []).join(',');
    const reintentar = `pagar.html?bazar=${encodeURIComponent(ultimo.bazarId || 1)}${idsReintento ? `&ids=${idsReintento}` : ''}`;
    const wa = (t) => waLink(r.whatsapp, t);
    let cabeza, cuerpo = '', acciones = '';
    const quitarDeBolsa = () => {
      const pagadas = new Set((r.items || []).map(x => String(x.id)));
      guardar(K.bolsa, leer(K.bolsa, []).filter(p => !pagadas.has(String(p.id))));
      guardar(K.cupon, null);
      if (leer(K.pedido, null)?.id === r.id) guardar(K.pedido, null);
    };
    const datosEntrega = () => {
      const dir = r.direccion;
      return r.entrega === 'envio' && dir ? esc(`Envío a domicilio${r.envioDetalle ? ` con ${r.envioDetalle.paqueteria} ${r.envioDetalle.servicio}${r.envioDetalle.dias ? ` (${r.envioDetalle.dias})` : ''}` : ''}\n${dir.calle}\nCol. ${dir.colonia}\n${dir.cp}, ${dir.ciudad}, ${dir.estado}${dir.referencias ? `\nRef: ${dir.referencias}` : ''}`) : esc(`Entrega en persona${r.punto ? `: ${r.punto.nombre}` : ''}${r.punto ? '\nEl día y la hora los acordamos por WhatsApp.' : r.entregaInfo ? `\n${r.entregaInfo}` : ''}`);
    };
    const fechaPago = iso => iso ? new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }) : '';
    const lineaPagos = () => (r.apartado?.pagos || []).map(x => `${x.tipo === 'anticipo' ? 'Anticipo' : 'Resto'}: ${pesos(x.monto)} con ${x.proveedor === 'persona' ? 'pago en persona' : nombreMetodo(x.proveedor)}, ${fechaPago(x.en)}`).join('\n');
    if (r.estado === 'apartado') {
      quitarDeBolsa();
      const ap = r.apartado || {}, primero = esc(String(r.nombre || '').split(' ')[0]);
      cabeza = `<div class="ck-icono">${ICONO.check}</div><h1>Apartado, ${primero}</h1>
        <p class="ck-lead">Tu pedido <b>${esc(r.id)}</b> quedó apartado${ap.anticipo ? ` con ${pesos(ap.anticipo)}` : ''}. Las prendas son tuyas; nadie más las puede comprar.</p>`;
      if (r.completo) {
        const metodos = ap.metodos || [];
        cuerpo += `<section class="ck-resto ${ap.vencido ? 'vencido' : ''}" aria-labelledby="ckRestoH">
          <div class="ck-resto-cab"><div><h2 id="ckRestoH">Te faltan ${pesos(ap.resta)}</h2>
            <p>${ap.vencido ? `La fecha para liquidar fue el ${esc(fechaLarga(ap.liquidarAntes))}. Págalo hoy o escríbenos si necesitas unos días más.` : ap.liquidarAntes ? `Liquida antes del <b>${esc(fechaLarga(ap.liquidarAntes))}</b>.` : ''} ${r.entrega === 'envio' ? 'Te enviamos tu pedido en cuanto liquides.' : 'También puedes pagarlo en persona cuando te entreguemos.'}</p></div>
            <div class="ck-resto-barra" aria-hidden="true"><i style="width:${Math.round((ap.anticipo / (ap.anticipo + ap.resta)) * 100)}%"></i></div></div>
          ${r.falloResto ? '<p class="ck-aviso mal">El pago del resto no se completó. No se hizo ningún cargo; puedes intentar otra vez.</p>' : ''}
          ${ap.restoEnProceso || r.restoTarda ? '<p class="ck-aviso">Si ya pagaste el resto, se confirma en unos minutos y esta página cambia a pagado. No hace falta pagar otra vez.</p>' : ''}
          ${metodos.length ? `<div class="ck-resto-btns">${metodos.map(m => `<button type="button" class="ck-pagar ${m}" data-resto="${m}">${ICONO.candado}<span>Pagar ${pesos(ap.resta)}${metodos.length > 1 ? (m === 'paypal' ? ' con PayPal' : ' con tarjeta') : ''}</span></button>`).join('')}</div>` : ''}
          <p class="ck-resto-msg" id="ckRestoMsg" role="status"></p>
        </section>`;
        cuerpo += seguimiento(r);
        cuerpo += `<dl class="ck-datos">
          <div><dt>Entrega</dt><dd>${datosEntrega()}</dd></div>
          <div><dt>Contacto</dt><dd>${esc([r.nombre, r.telefono, r.email].filter(Boolean).join('\n'))}</dd></div>
          <div><dt>Pagos</dt><dd>${esc(`${lineaPagos()}\nFalta: ${pesos(ap.resta)} de ${pesos(r.total)}`)}</dd></div>
        </dl>`;
      }
      if (r.revisar) cuerpo += `<p class="ck-aviso">Una de tus prendas se vendió justo antes de confirmar tu anticipo. Te escribimos por WhatsApp para ajustarlo.</p>`;
      acciones = `${r.whatsapp ? `<a class="ck-pagar wa" href="${esc(wa(`Hola! Aparté el pedido ${r.id} con ${pesos(ap.anticipo)}. ¿Cómo coordinamos el resto y la entrega?`))}" target="_blank" rel="noopener">Coordinar por WhatsApp</a>` : ''}
        <a class="ck-pagar ${r.whatsapp ? 'sec' : ''}" href="tienda.html">Seguir comprando</a>`;
    } else if (r.estado === 'cancelado') {
      cabeza = `<div class="ck-icono mal">${ICONO.equis}</div><h1>Este apartado se canceló</h1>
        <p class="ck-lead">Las prendas del pedido <b>${esc(r.id)}</b> volvieron a la tienda. Si tienes dudas sobre tu anticipo, escríbenos.</p>`;
      acciones = `${r.whatsapp ? `<a class="ck-pagar wa" href="${esc(wa(`Hola! Tengo una duda sobre mi apartado ${r.id}.`))}" target="_blank" rel="noopener">Escribir por WhatsApp</a>` : ''}
        <a class="ck-pagar ${r.whatsapp ? 'sec' : ''}" href="tienda.html">Ir a la tienda</a>`;
    } else if (r.estado === 'pagado') {
      // Se quitan de la bolsa las prendas pagadas
      const pagadas = new Set((r.items || []).map(x => String(x.id)));
      guardar(K.bolsa, leer(K.bolsa, []).filter(p => !pagadas.has(String(p.id))));
      guardar(K.cupon, null);
      if (leer(K.pedido, null)?.id === r.id) guardar(K.pedido, null);
      const fecha = r.pagadoEn ? new Date(r.pagadoEn).toLocaleString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
      const ee = r.entregaEstado || 'pendiente';
      cabeza = `<div class="ck-icono">${ICONO.check}</div><h1>Gracias, ${esc(String(r.nombre || '').split(' ')[0])}</h1>
        <p class="ck-lead">${ee === 'entregado' ? `Tu pedido <b>${esc(r.id)}</b> ya está contigo. Gracias por comprar en ${esc(r.bazar || 'Stiimpys')}.` : `Tu pedido <b>${esc(r.id)}</b> está pagado. Las prendas ya son tuyas.`}</p>`;
      if (r.completo) cuerpo += seguimiento(r);
      if (r.revisar) cuerpo += `<p class="ck-aviso">Una de tus prendas se vendió justo antes de confirmar tu pago. Te escribimos por WhatsApp para devolverte ese monto o mostrarte otra.</p>`;
      if (r.completo) {
        const dir = r.direccion;
        cuerpo += `<dl class="ck-datos">
          <div><dt>Entrega</dt><dd>${r.entrega === 'envio' && dir ? esc(`Envío a domicilio${r.envioDetalle ? ` con ${r.envioDetalle.paqueteria} ${r.envioDetalle.servicio}${r.envioDetalle.dias ? ` (${r.envioDetalle.dias})` : ''}` : ''}\n${dir.calle}\nCol. ${dir.colonia}\n${dir.cp}, ${dir.ciudad}, ${dir.estado}${dir.referencias ? `\nRef: ${dir.referencias}` : ''}`) : esc(`Entrega en persona${r.punto ? `: ${r.punto.nombre}` : ''}${r.punto ? '\nEl día y la hora los acordamos por WhatsApp.' : r.entregaInfo ? `\n${r.entregaInfo}` : ''}`)}</dd></div>
          <div><dt>Contacto</dt><dd>${esc([r.nombre, r.telefono, r.email].filter(Boolean).join('\n'))}</dd></div>
          <div><dt>Pago</dt><dd>${esc(r.apartado ? `${lineaPagos()}\nTotal: ${pesos(r.total)} MXN` : `${pesos(r.total)} MXN con ${proveedor}${fecha ? `\n${fecha}` : ''}`)}</dd></div>
        </dl>`;
      }
      if (r.completo && (r.puedeResenar || r.resena)) cuerpo += formResena(r);
      if (r.completo) cuerpo += bloqueCliente(r);
      if (ee === 'pendiente') cuerpo += `<p class="ck-sigue">${r.entrega === 'envio' ? 'Te escribimos por WhatsApp con tu número de guía cuando salga el paquete.' : r.punto ? `Si quieres, escríbenos tú primero por WhatsApp para quedar el día y la hora en ${esc(r.punto.nombre)}.` : 'Te escribimos por WhatsApp para quedar en el lugar y la hora de entrega. Si quieres, escríbenos tú primero.'}</p>`;
      acciones = `${r.whatsapp && ee !== 'entregado' ? `<a class="ck-pagar wa" href="${esc(wa(ee === 'enviado' ? `Hola! Tengo una duda sobre el envío de mi pedido ${r.id}.` : `Hola! Ya pagué mi pedido ${r.id} (${pesos(r.total)}). ¿Cómo coordinamos la entrega?`))}" target="_blank" rel="noopener">${ee === 'enviado' ? 'Preguntar por WhatsApp' : 'Coordinar por WhatsApp'}</a>` : ''}
        <a class="ck-pagar ${r.whatsapp && ee !== 'entregado' ? 'sec' : ''}" href="tienda.html">Seguir comprando</a>`;
    } else if (r.estado === 'spei') {
      const sp = r.spei, primero = esc(String(r.nombre || '').split(' ')[0]);
      const hasta = r.expira ? new Date(r.expira).toLocaleString('es-MX', { weekday: 'long', hour: 'numeric', minute: '2-digit' }) : '';
      const fila = (t, v, copiar) => `<div><dt>${t}</dt><dd><b>${esc(v)}</b>${copiar ? ` <button type="button" class="ck-copiar" data-copiar="${esc(copiar)}">Copiar</button>` : ''}</dd></div>`;
      cabeza = `<div class="ck-icono espera">${ICONO.reloj}</div><h1>${primero ? `${primero}, ya` : 'Ya'} casi es tuyo</h1>
        <p class="ck-lead">Tu pedido <b>${esc(r.id)}</b> está apartado${hasta ? ` hasta el <b>${esc(hasta)}</b>` : ''}: transfiere el monto exacto y sube tu comprobante aquí mismo.</p>`;
      cuerpo += `<section class="ck-spei" id="ckSpei" aria-labelledby="ckSpeiH">
        <h2 id="ckSpeiH">1. Transfiere desde tu banco</h2>
        <dl class="ck-datos ck-spei-datos">
          ${fila('Monto', pesos(sp.monto) + ' MXN', String(sp.monto))}
          ${fila('CLABE', String(sp.clabe).replace(/(\d{3})(\d{3})(\d{11})(\d)/, '$1 $2 $3 $4'), sp.clabe)}
          ${sp.banco ? fila('Banco', sp.banco) : ''}
          ${sp.titular ? fila('Titular', sp.titular) : ''}
          ${fila('Concepto', sp.referencia, sp.referencia)}
        </dl>
        <h2>2. Sube la captura del comprobante</h2>
        <div id="ckSpeiSubir">${sp.enRevision ? '' : `<label class="ck-pagar spei ck-spei-btn"><input type="file" id="ckSpeiFoto" accept="image/*" hidden>${ICONO.candado}<span>Subir comprobante</span></label>
          <p class="ck-nota">Una foto o captura de pantalla donde se vea el monto y la clave de rastreo.</p>`}</div>
        <p class="ck-resto-msg" id="ckSpeiMsg" role="status">${sp.enRevision ? '' : ''}</p>
      </section>`;
      acciones = r.whatsapp ? `<a class="ck-pagar sec" href="${esc(wa(`Hola! Hice la transferencia del pedido ${r.id}.`))}" target="_blank" rel="noopener">Escribir por WhatsApp</a>` : '';
    } else if (r.estado === 'revisando') {
      cabeza = `<div class="ck-icono espera"><div class="ck-gira"></div></div><h1>Confirmando tu pago</h1>
        <p class="ck-lead">Estamos esperando la confirmación de ${esc(proveedor)}. Tarda unos segundos; no cierres esta página.</p>${cajaCuenta(r)}`;
    } else if (r.estado === 'proceso') {
      cabeza = `<div class="ck-icono espera">${ICONO.reloj}</div><h1>Tu pago está en proceso</h1>
        <p class="ck-lead">Todavía no recibimos la confirmación. Si ya pagaste, te avisamos por WhatsApp en cuanto se acredite; no hace falta pagar otra vez.</p>${cajaCuenta(r)}`;
      acciones = `<button class="ck-pagar" type="button" onclick="location.reload()">Revisar otra vez</button>
        ${r.whatsapp ? `<a class="ck-pagar sec" href="${esc(wa(`Hola! Pagué el pedido ${r.id || ''} y aún no se confirma.`))}" target="_blank" rel="noopener">Escribir por WhatsApp</a>` : ''}`;
    } else if (r.estado === 'fallo' || r.estado === 'expirado') {
      const expiro = r.estado === 'expirado';
      const sigue = !expiro && apartadoVigente(r);
      cabeza = `<div class="ck-icono mal">${ICONO.equis}</div><h1>${expiro ? 'Se terminó el tiempo para pagar' : 'El pago no se completó'}</h1>
        <p class="ck-lead">${expiro && r.proveedor === 'spei' ? 'No recibimos tu transferencia a tiempo y las prendas volvieron a la tienda. Si ya transferiste, escríbenos por WhatsApp con tu comprobante y lo resolvemos.'
          : expiro ? `Pasaron los ${MIN_APARTADO} minutos del apartado y las prendas volvieron a la tienda. No se hizo ningún cargo. Si siguen disponibles, puedes pagarlas de nuevo.`
          : sigue ? 'No se hizo ningún cargo a tu tarjeta. Tus prendas siguen apartadas para ti mientras corre el contador: puedes intentar otra vez o usar otra tarjeta.'
          : 'No se hizo ningún cargo a tu tarjeta. El apartado ya terminó y las prendas volvieron a la tienda; si siguen disponibles, puedes pagarlas de nuevo.'}</p>${sigue ? cajaCuenta(r) : ''}`;
      acciones = `<a class="ck-pagar" href="${esc(reintentar)}">Intentar de nuevo</a>
        ${r.whatsapp ? `<a class="ck-pagar sec" href="${esc(wa(`Hola! Intenté pagar el pedido ${r.id || ''} y no pude. ¿Me ayudan?`))}" target="_blank" rel="noopener">Pedir ayuda por WhatsApp</a>` : ''}`;
    } else {
      cabeza = `<div class="ck-icono mal">${ICONO.equis}</div><h1>No encontramos ese pedido</h1>
        <p class="ck-lead">Revisa el link o escríbenos por WhatsApp con tu número de pedido.</p>`;
      acciones = `<a class="ck-pagar" href="tienda.html">Ir a la tienda</a>`;
    }
    const conResumen = d.prendas.length > 0;
    // v37: con el pago confirmado, los tres pasos quedan completos
    const pasosConf = ['pagado', 'apartado'].includes(r.estado) ? pasosCompra(4) : '';
    document.getElementById('ckFija')?.remove();
    raiz.innerHTML = `${pasosConf}<section class="ck-form ck-conf">${cabeza}${cuerpo}
      ${['pagado', 'apartado'].includes(r.estado) && r.completo && S.k ? cajaGuardar(r) : ''}
      ${acciones ? `<div class="ck-acciones">${acciones}</div>` : ''}
      ${r.estado === 'pagado' && !(r.completo && S.k) ? '<button class="ck-imprimir" type="button" onclick="print()">Imprimir o guardar recibo</button>' : ''}</section>
      ${conResumen ? aside(d, { envio: r.envio || 0, pagado: r.estado === 'pagado', editable: false, sello: r.estado === 'apartado' ? 'Apartado' : '',
        apartadoInfo: r.estado === 'apartado' && r.apartado ? `<div><dt>Pagado</dt><dd>${pesos(r.apartado.anticipo)}</dd></div><div><dt>Falta</dt><dd>${pesos(r.apartado.resta)}</dd></div>` : '' },
        { siempre: ['pagado', 'apartado'].includes(r.estado) }) : ''}`;
    engancharBarra();
    engancharResena(r);
    if (r.estado === 'spei') { if (r.spei.enRevision) marcarSpeiEnRevision(); engancharSpei(r); }
    engancharCumple(r);
    raiz.querySelectorAll('[data-copiar]').forEach(b => b.onclick = () => navigator.clipboard?.writeText(b.dataset.copiar).then(() => { b.textContent = 'Copiada'; }));
    document.title = r.estado === 'pagado' ? `Pedido ${r.id} | Stiimpys` : r.estado === 'apartado' ? `Apartado ${r.id} | Stiimpys` : 'Tu pedido | Stiimpys';
    // Pagar el resto del apartado
    raiz.querySelectorAll('[data-resto]').forEach(b => b.onclick = async () => {
      const msg = $('#ckRestoMsg'); raiz.querySelectorAll('[data-resto]').forEach(x => { x.disabled = true; });
      b.querySelector('span').textContent = `Abriendo ${b.dataset.resto === 'paypal' ? 'PayPal' : 'el pago seguro de Clip'}…`;
      try {
        const res = await api('v-pagar-resto', { id: r.id, k: S.k, metodo: b.dataset.resto });
        if (res.pagado) return location.reload();
        location.href = res.url;
      } catch (err) {
        raiz.querySelectorAll('[data-resto]').forEach(x => { x.disabled = false; });
        b.querySelector('span').textContent = `Pagar ${pesos(r.apartado.resta)}`;
        if (msg) { msg.className = 'ck-resto-msg mal'; msg.textContent = err.message; }
      }
    });
    if (r.estado !== 'revisando') history.replaceState(null, '', `pagar.html?pedido=${encodeURIComponent(r.id || '')}${S.k ? `&k=${encodeURIComponent(S.k)}` : ''}`);
    if (r.completo && S.k && r.id) agregarHistorial({ id: r.id, k: S.k, total: r.total, en: r.en, estado: r.estado === 'pagado' ? 'pagado' : r.estado });
    raiz.querySelectorAll('[data-guardar]').forEach(b => b.onclick = () => guardarRecibo(b.dataset.guardar, r));
  }

  // ═════════════════════════════════════════════════════════
  if (Q.get('pedido')) iniciarConfirmacion(); else if (Q.has('mis')) iniciarMisPedidos(); else iniciarPago();
})();
