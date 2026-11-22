// ─────────────────────────────────────────────────────────────
//  js/carrito-pagina.js — Página del carrito (carrito.html) · v37
//
//  Como en Mercado Libre o Amazon: la lista de prendas a la izquierda,
//  el "Resumen de compra" fijo a la derecha y "Continuar compra" para
//  ir a pagar. Los montos los calcula el servidor (v-cotizar), igual que
//  en pagar.html, así que lo que se ve aquí es lo que se cobra.
//
//  El carrito se guarda en la llave de siempre (bazar_wishlist). Cada
//  bazar se paga por separado (el dinero va a la cuenta de cada uno).
// ─────────────────────────────────────────────────────────────
(() => {
  'use strict';
  const K = 'bazar_wishlist', KC = 'stmp-cupon';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pesos = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');
  const leer = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
  const lista = () => (leer(K, []) || []).filter(p => p && p.id != null);
  const guardar = l => { try { localStorage.setItem(K, JSON.stringify(l)); } catch {} window.dispatchEvent(new CustomEvent('wishlist:cambio')); };
  const img = (u, w = 240) => !u ? '' : (typeof imgOptimizada === 'function' ? imgOptimizada(u, w) : u);
  const raiz = $('#cr');
  const SVG = {
    carrito: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2.4l2.2 10.3a1.7 1.7 0 0 0 1.7 1.3h8.1a1.7 1.7 0 0 0 1.6-1.2L21 8H6.2"/><circle cx="9.6" cy="19.6" r="1.3"/><circle cx="17.2" cy="19.6" r="1.3"/></svg>',
    candado: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    reloj: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M12 9v4l2.5 2M9.5 2.5h5"/></svg>',
    camion: '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="17.5" r="1.6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    wa: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.373 0 0 5.373 0 12c0 2.138.558 4.147 1.535 5.886L0 24l6.274-1.507A11.944 11.944 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.853 0-3.587-.5-5.084-1.367l-.361-.214-3.733.897.931-3.618-.235-.374A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>',
  };

  async function api(op, body) {
    const r = await fetch(`/api/acciones?op=${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'No hay conexión. Revisa tu internet e intenta de nuevo.'), { status: r.status });
    return j;
  }

  // ── Estado: un grupo por bazar, con su cotización del servidor ──
  const G = new Map();   // bazarId → { ids, d, error }
  let cargando = true;

  function agrupar() {
    const porBazar = new Map();
    // v39 · Una sola tienda: todo va con Stiimpys (lo de otros bazares sale como "Ya no está en la tienda")
    const modo = typeof getModo === 'function' ? getModo() : null;
    const unico = modo && modo.multiBazar === false ? String(modo.principal || 1) : null;
    lista().forEach(p => { const b = unico || String(p.bazarId || 1); if (!porBazar.has(b)) porBazar.set(b, []); porBazar.get(b).push(Number(p.id)); });
    return porBazar;
  }
  async function cotizarTodo() {
    const porBazar = agrupar();
    for (const b of [...G.keys()]) if (!porBazar.has(b)) G.delete(b);
    const cup = leer(KC, null);
    await Promise.all([...porBazar.entries()].map(async ([b, ids]) => {
      try {
        const d = await api('v-cotizar', { ids, bazarId: b, cupon: cup && String(cup.bazarId) === b ? cup.codigo : undefined });
        if (d.cupon) localStorage.setItem(KC, JSON.stringify({ ...d.cupon, bazarId: b }));
        else if (cup && String(cup.bazarId) === b && d.cuponError) localStorage.removeItem(KC);
        G.set(b, { ids, d, error: null });
      } catch (e) { G.set(b, { ids, d: null, error: e.message }); }
    }));
    // v39 · Si mientras cotizaba llegaron los datos (una sola tienda) y los grupos cambiaron, otra vez
    if ([...agrupar().keys()].join() !== [...porBazar.keys()].join()) return cotizarTodo();
    cargando = false;
  }
  async function refrescar() { await cotizarTodo(); pintar(); }

  // ── Bazar (nombre, color, logo) ──
  function bazar(b, d) {
    const bz = (typeof getBazares === 'function' ? getBazares() : []).find(x => String(x.id) === String(b)) || {};
    return { nombre: bz.nombre || d?.bazar?.nombre || 'Bazar', slug: bz.slug || '', color: bz.color || '#2d6be4', logo: bz.logo || '', wa: d?.bazar?.whatsapp || '' };
  }
  // Datos guardados de la prenda (para foto y nombre de las que ya no están)
  const guardada = id => lista().find(p => String(p.id) === String(id)) || {};
  const vivo = id => (typeof getDB === 'function' ? getDB() : []).find(p => String(p.id) === String(id));

  // ═════════════════════════════════════════════════════════
  //  Pintar
  // ═════════════════════════════════════════════════════════
  function pasos() {
    return `<ol class="ck-pasos" aria-label="Pasos de la compra">
      <li class="on" aria-current="step"><i>1</i><span>Carrito</span></li>
      <li><i>2</i><span>Entrega y pago</span></li>
      <li><i>3</i><span>Confirmación</span></li></ol>`;
  }

  function pintar() {
    const items = lista();
    if (cargando) { raiz.innerHTML = `${pasos()}<div class="ck-cargando"><span></span><span></span><span></span></div>`; return; }
    if (!items.length) { raiz.innerHTML = `${pasos()}${vacio()}${recomendaciones([])}`; enganchar(); return; }
    const grupos = [...G.entries()];
    const nTotal = grupos.reduce((t, [, g]) => t + (g.d?.prendas.length || 0), 0);
    raiz.innerHTML = `${pasos()}
      <div class="cr-cab"><h1>Carrito <small>(${nTotal} ${nTotal === 1 ? 'prenda' : 'prendas'})</small></h1></div>
      ${grupos.length > 1 ? `<p class="cr-varios">Tu carrito tiene prendas de ${grupos.length} bazares. Cada bazar se paga por separado porque el dinero va directo a su cuenta.</p>` : ''}
      <div class="cr-grid">
        <div class="cr-lista">${grupos.map(([b, g]) => grupoHTML(b, g)).join('')}</div>
        <aside class="cr-lado" aria-label="Resumen de compra">${grupos.map(([b, g]) => resumenHTML(b, g, grupos.length > 1)).join('')}
          <p class="cr-confianza">${SVG.candado}<span>Pago seguro a través de intermediarios de pago (Clip y PayPal). <a href="terminos.html#pagos">Cómo funciona</a></span></p>
        </aside>
      </div>
      ${recomendaciones(items.map(p => Number(p.id)))}
      ${grupos.length === 1 ? barraFija(grupos[0][0], grupos[0][1]) : ''}`;
    enganchar();
  }

  function vacio() {
    return `<section class="cr-vacio">
      <div class="cr-vacio-ic">${SVG.carrito}</div>
      <h1>Tu carrito está vacío</h1>
      <p>Agrega prendas con el botón del carrito y aquí las pagas juntas, con descuento por llevar varias.</p>
      <a class="cr-btn" href="tienda.html">Descubrir prendas</a>
    </section>`;
  }

  function grupoHTML(b, g) {
    const d = g.d, bz = bazar(b, d);
    if (!d) return `<section class="cr-card"><p class="cr-error">${esc(g.error || 'No se pudo cargar esta parte del carrito.')} <button type="button" class="cr-link" data-accion="reintentar">Reintentar</button></p></section>`;
    const devueltos = new Set([...d.prendas.map(p => String(p.id)), ...(d.noDisponibles || []).map(p => String(p.id))]);
    const desaparecidas = g.ids.filter(id => !devueltos.has(String(id))).map(id => ({ id, nombre: guardada(id).nombre || 'Prenda', motivo: 'retirada' }));
    const fuera = [...(d.noDisponibles || []), ...desaparecidas];
    return `<section class="cr-card" style="--bz:${esc(bz.color)}" aria-label="Prendas de ${esc(bz.nombre)}">
      <div class="cr-bz">
        ${bz.logo ? `<img src="${esc(img(bz.logo, 80))}" alt="">` : `<span class="cr-bz-ini">${esc(bz.nombre.charAt(0))}</span>`}
        <div><b>${esc(bz.nombre)}</b>${bz.slug ? `<a href="tienda.html?bazar=${encodeURIComponent(bz.slug)}">@${esc(bz.slug)}</a>` : ''}</div>
        <span class="cr-bz-n">${d.prendas.length} ${d.prendas.length === 1 ? 'prenda' : 'prendas'}</span>
      </div>
      ${progresoHTML(d)}
      <ul class="cr-items">${d.prendas.map(p => itemHTML(b, d, p)).join('')}</ul>
      ${fuera.length ? `<div class="cr-fuera">
        <h2>No disponibles ahora <button type="button" class="cr-link" data-accion="quitar-fuera" data-bazar="${esc(b)}">Quitarlas</button></h2>
        <ul class="cr-items">${fuera.map(p => fueraHTML(p)).join('')}</ul></div>` : ''}
    </section>`;
  }

  // Barra de avance como la de "te faltan $X para envío gratis"
  function progresoHTML(d) {
    const n = d.prendas.length; if (!n) return '';
    const filas = [];
    if (d.siguiente) {
      const falta = d.siguiente.n - n;
      filas.push(`<div class="cr-prog"><p>${d.tramo ? `Ya ahorras <b>${d.tramo.pct}%</b>. ` : ''}Agrega ${falta} ${falta === 1 ? 'prenda' : 'prendas'} más y ahorra <b>${d.siguiente.pct}%</b> en todo.</p>
        <div class="cr-barra"><i style="width:${Math.round(n / d.siguiente.n * 100)}%"></i></div></div>`);
    } else if (d.tramo) {
      filas.push(`<div class="cr-prog ok"><p>${SVG.check} Ahorras <b>${d.tramo.pct}%</b> por llevar ${n} prendas.</p><div class="cr-barra"><i style="width:100%"></i></div></div>`);
    }
    const gratis = Number(d.entregaGratisDesde) || 0;
    if (gratis && (d.puntosEntrega || []).some(p => p.costo > 0)) {
      const falta = gratis - d.total;
      filas.push(falta >= 0
        ? `<div class="cr-prog"><p>${SVG.camion} Te faltan <b>${pesos(falta + 1)}</b> para la entrega gratis en cualquier punto.</p><div class="cr-barra"><i style="width:${Math.min(99, Math.round(d.total / gratis * 100))}%"></i></div></div>`
        : `<div class="cr-prog ok"><p>${SVG.check} Entrega en persona <b>gratis</b> en cualquier punto.</p><div class="cr-barra"><i style="width:100%"></i></div></div>`);
    }
    return filas.join('');
  }

  function itemHTML(b, d, p) {
    const g = guardada(p.id);
    const foto = p.imagen || (g.imagenes || [])[0] || '';
    const oferta = p.antes > p.precio;
    return `<li class="cr-item">
      <a class="cr-foto" href="prenda.html?id=${encodeURIComponent(p.id)}">${foto ? `<img src="${esc(img(foto))}" alt="${esc(p.nombre)}" loading="lazy">` : '<span></span>'}</a>
      <div class="cr-info">
        <a class="cr-nombre" href="prenda.html?id=${encodeURIComponent(p.id)}">${esc(p.nombre)}</a>
        <p class="cr-meta">${esc([p.marca, p.talla && `Talla ${p.talla}`, p.estado].filter(Boolean).join(' · '))}</p>
        <span class="cr-unica">Pieza única</span>
        <div class="cr-acc">
          <button type="button" class="cr-link" data-accion="quitar" data-id="${esc(p.id)}">Eliminar</button>
          ${d.pagoEnLinea ? `<a class="cr-link" href="pagar.html?bazar=${encodeURIComponent(b)}&ids=${encodeURIComponent(p.id)}">Comprar solo esta</a>` : ''}
        </div>
      </div>
      <div class="cr-precio">${oferta ? `<s>${pesos(p.antes)}</s><em>-${Math.round((1 - p.precio / p.antes) * 100)}%</em>` : ''}<b>${pesos(p.precio)}</b></div>
    </li>`;
  }

  function fueraHTML(p) {
    const g = guardada(p.id), foto = (g.imagenes || [])[0] || '';
    const enPago = p.motivo === 'apartada' && p.hasta && Date.parse(p.hasta) > Date.now();
    const motivo = p.motivo === 'vendida' ? 'Se vendió' : p.motivo === 'retirada' ? 'Ya no está en la tienda'
      : enPago ? `Alguien la está pagando · se libera en ${window.Contador ? Contador.html(p.hasta, { fin: '0:00' }) : ''} si no termina` : 'Apartada por otra persona';
    return `<li class="cr-item cr-item-fuera${enPago ? ' en-pago' : ''}">
      <span class="cr-foto">${foto ? `<img src="${esc(img(foto))}" alt="" loading="lazy">` : '<span></span>'}</span>
      <div class="cr-info"><span class="cr-nombre">${esc(p.nombre || g.nombre || 'Prenda')}</span>
        <p class="cr-motivo">${enPago ? SVG.reloj : ''}${motivo}</p>
        <div class="cr-acc"><button type="button" class="cr-link" data-accion="quitar" data-id="${esc(p.id)}">Eliminar</button></div></div>
    </li>`;
  }

  function resumenHTML(b, g, varios) {
    const d = g.d; if (!d) return '';
    const bz = bazar(b, d), n = d.prendas.length;
    const msgWA = `Hola ${bz.nombre}! Quiero apartar:\n\n${d.prendas.map((p, i) => `${i + 1}. ${p.nombre}${p.talla ? ` (talla ${p.talla})` : ''}: ${pesos(p.precio)}`).join('\n')}\n\nTotal: ${pesos(d.total)}${d.cupon ? ` (con cupón ${d.cupon.codigo})` : ''}`;
    const wa = bz.wa ? `https://wa.me/${bz.wa}?text=${encodeURIComponent(msgWA)}` : '';
    const gratisPersona = (d.puntosEntrega || []).some(p => !p.costo) || ((Number(d.entregaGratisDesde) || 0) && d.total > d.entregaGratisDesde);
    return `<section class="cr-resumen" data-bazar="${esc(b)}">
      <h2>Resumen de compra${varios ? ` <small>${esc(bz.nombre)}</small>` : ''}</h2>
      ${n ? `<dl>
        <div><dt>Productos (${n})</dt><dd>${pesos(d.subtotal)}</dd></div>
        ${d.descVolumen ? `<div class="desc"><dt>Descuento por llevar ${n} (${d.tramo?.pct}%)</dt><dd>−${pesos(d.descVolumen)}</dd></div>` : ''}
        ${d.descOutfit ? `<div class="desc"><dt>Outfit completo (${d.outfit?.pct || ''}%)</dt><dd>−${pesos(d.descOutfit)}</dd></div>` : ''}
        ${!d.descOutfit && d.outfit && n && (d.outfit.grupos || []).length === 1 ? `<div class="cr-outfit-tip"><dt>💡 Agrega una prenda de otro tipo (${d.outfit.grupos[0] === 'arriba' ? 'pantalón, tenis o gorra' : d.outfit.grupos[0] === 'abajo' ? 'playera, sudadera o gorra' : 'playera o pantalón'}) y llévate ${d.outfit.pct}% extra.</dt></div>` : ''}
        ${d.descCupon ? `<div class="desc"><dt>Cupón ${esc(d.cupon?.codigo || '')} <button type="button" class="cr-link" data-accion="sin-cupon" data-bazar="${esc(b)}">Quitar</button></dt><dd>−${pesos(d.descCupon)}</dd></div>` : ''}
        <div><dt>Entrega</dt><dd class="cr-gris">${gratisPersona ? 'Gratis en persona · envío se calcula al pagar' : 'Se calcula al pagar'}</dd></div>
        <div class="total"><dt>Total</dt><dd>${pesos(d.total)}</dd></div>
      </dl>
      ${d.hayCupones && !d.cupon ? `<form class="cr-cupon" data-bazar="${esc(b)}"><label class="sr" for="crCupon${esc(b)}">Código de descuento</label>
        <input id="crCupon${esc(b)}" placeholder="Código de descuento" maxlength="24" autocomplete="off" autocapitalize="characters"><button type="submit">Aplicar</button></form>
        ${d.cuponError ? `<p class="cr-cupon-msg" role="alert">${esc(d.cuponError)}</p>` : ''}` : ''}
      ${d.pagoEnLinea
        ? `<a class="cr-btn cr-continuar" href="pagar.html?bazar=${encodeURIComponent(b)}" data-continuar="${esc(b)}">Continuar compra</a>`
        : wa ? `<a class="cr-btn" href="${esc(wa)}" target="_blank" rel="noopener">${SVG.wa} Mandar pedido por WhatsApp</a>` : ''}
      ${d.pagoEnLinea && wa && (window.FormasPago ? window.FormasPago.alternativas() : 'efectivo o transferencia') ? `<a class="cr-alt" href="${esc(wa)}" target="_blank" rel="noopener">${SVG.wa} ¿Prefieres ${(window.FormasPago ? window.FormasPago.alternativas() : 'efectivo o transferencia')}? Apártalas por WhatsApp</a>` : ''}
      ${window.FormasPago ? window.FormasPago.html('carrito') : ''}
      ` : `<p class="cr-gris">No hay prendas disponibles para pagar en este bazar.</p>`}
    </section>`;
  }

  // Barra fija abajo en celular (como el botón de Mercado Libre)
  function barraFija(b, g) {
    const d = g.d; if (!d || !d.prendas.length) return '';
    return `<div class="cr-fija" role="region" aria-label="Total y continuar">
      <div><small>Total (${d.prendas.length})</small><b>${pesos(d.total)}</b>${d.descVolumen || d.descCupon || d.descOutfit ? `<em>Ahorras ${pesos((d.descVolumen || 0) + (d.descCupon || 0) + (d.descOutfit || 0))}</em>` : ''}</div>
      ${d.pagoEnLinea ? `<a class="cr-btn" href="pagar.html?bazar=${encodeURIComponent(b)}" data-continuar="${esc(b)}">Continuar compra</a>` : ''}
    </div>`;
  }

  // "También te puede gustar": del mismo bazar, disponibles, primero tu talla
  function recomendaciones(enCarrito) {
    const db = typeof getDB === 'function' ? getDB() : [];
    if (!db.length) return '<div id="crRecos"></div>';
    const bazares = new Set(lista().map(p => String(p.bazarId || 1)));
    const tallas = new Set(lista().map(p => String((vivo(p.id) || p).talla || '').split('·')[0].trim().toUpperCase()).filter(Boolean));
    const cand = db.filter(p => !p.vendido && !p.apartada && !p.oculto && !enCarrito.includes(Number(p.id)) && (p.imagenes || []).length
      && (!bazares.size || bazares.has(String(p.bazarId || 1))));
    const puntos = p => (tallas.has(String(p.talla || '').split('·')[0].trim().toUpperCase()) ? 2 : 0) + (Number(p.precioAnterior) > Number(p.precio_venta) ? 1 : 0);
    const top = cand.map(p => [puntos(p), p]).sort((a, b) => b[0] - a[0] || Number(b[1].id) - Number(a[1].id)).slice(0, 8).map(x => x[1]);
    if (!top.length) return '<div id="crRecos"></div>';
    return `<section class="cr-recos" id="crRecos" aria-labelledby="crRecosH">
      <h2 id="crRecosH">${enCarrito.length ? 'También te puede gustar' : 'Lo más nuevo'}</h2>
      <ul>${top.map(p => `<li>
        <a href="prenda.html?id=${encodeURIComponent(p.id)}"><img src="${esc(img(p.imagenes[0], 360))}" alt="${esc(p.nombre)}" loading="lazy"></a>
        <div><a class="cr-nombre" href="prenda.html?id=${encodeURIComponent(p.id)}">${esc(p.nombre)}</a>
          <p class="cr-meta">${esc(p.talla ? `Talla ${p.talla}` : '')}</p>
          <b>${pesos(p.precio_venta)}</b></div>
        <button type="button" class="cr-btn cr-btn-suave" data-accion="agregar" data-id="${esc(p.id)}">Agregar al carrito</button>
      </li>`).join('')}</ul></section>`;
  }

  // ═════════════════════════════════════════════════════════
  //  Acciones
  // ═════════════════════════════════════════════════════════
  function quitar(id) {
    const antes = lista(), q = antes.find(p => String(p.id) === String(id));
    guardar(antes.filter(p => String(p.id) !== String(id)));
    if (q && typeof Avisos === 'object') Avisos.info('Quitada de tu carrito', { origen: 'wishlist', clave: 'wl-' + id, cuerpo: q.nombre || '',
      deshacer: () => { if (!lista().some(p => String(p.id) === String(id))) { guardar([...lista(), q]); refrescar(); } } });
    refrescar();
  }
  function agregar(id) {
    const p = vivo(id); if (!p || lista().some(x => String(x.id) === String(id))) return;
    guardar([...lista(), { ...p, id: p.id }]);
    if (typeof Avisos === 'object') Avisos.ok('Agregada a tu carrito', { origen: 'wishlist', clave: 'wl-' + id, cuerpo: p.nombre || '' });
    refrescar();
  }

  function enganchar() {
    raiz.onclick = e => {
      const el = e.target.closest('[data-accion]'); if (!el) return;
      const a = el.dataset.accion;
      if (a === 'quitar') quitar(el.dataset.id);
      else if (a === 'agregar') { el.disabled = true; el.textContent = 'Agregando…'; agregar(el.dataset.id); }
      else if (a === 'quitar-fuera') {
        const g = G.get(el.dataset.bazar); if (!g?.d) return;
        const disp = new Set(g.d.prendas.map(p => String(p.id)));
        guardar(lista().filter(p => String(p.bazarId || 1) !== el.dataset.bazar || disp.has(String(p.id)))); refrescar();
      }
      else if (a === 'sin-cupon') { localStorage.removeItem(KC); refrescar(); }
      else if (a === 'reintentar') refrescar();
    };
    raiz.querySelectorAll('.cr-cupon').forEach(f => f.onsubmit = async e => {
      e.preventDefault();
      const b = f.dataset.bazar, codigo = f.querySelector('input').value.trim(); if (!codigo) return;
      const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Revisando…';
      const g = G.get(b);
      try {
        const d = await api('v-cotizar', { ids: g.ids, bazarId: b, cupon: codigo });
        if (d.cupon) { localStorage.setItem(KC, JSON.stringify({ ...d.cupon, bazarId: b })); if (typeof Avisos === 'object') Avisos.ok(`Cupón ${d.cupon.codigo} aplicado`); }
        G.set(b, { ...g, d });
      } catch (err) { G.set(b, { ...g, d: { ...g.d, cuponError: err.message } }); }
      pintar();
    });
  }
  // Un apartado de pago que termina: se vuelve a preguntar si ya está libre
  raiz.addEventListener('cuenta:fin', () => setTimeout(refrescar, 1200));

  // Si el carrito cambia en otra pestaña (o desde la cuenta), se actualiza aquí
  window.addEventListener('storage', e => { if (e.key === K) refrescar(); });
  window.addEventListener('db:ready', () => {
    // v39 · Con los datos ya se sabe si es una sola tienda: si los grupos cambian, se vuelve a cotizar
    if (!cargando && [...agrupar().keys()].join() !== [...G.keys()].join()) refrescar();
    else if (!cargando) pintar();
  });
  // Las otras páginas abren el carrito con esta función: aquí ya estamos
  window.toggleWishlistPanel = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  pintar();
  refrescar();
})();
