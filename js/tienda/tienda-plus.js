// ─────────────────────────────────────────────────────────────
//  js/tienda-plus.js — Lo que hace que la tienda venda más
//  (lo cargan tienda.html y prenda.html, después de sus scripts)
//
//  · Bolsa con descuento por volumen ("llévate 2 y ahorra 10%"), cupón,
//    total real, apartar por WhatsApp con el total y pagar en línea.
//  · Regreso del pago (Clip o PayPal): confirma el pago y avisa por WhatsApp.
//  · Ficha: hacer oferta, "avísame si se libera", personas que la vieron hoy,
//    info de envíos/entrega/pagos y "más en tu talla".
//  · Catálogo: "mi talla", banner del próximo drop con cuenta regresiva,
//    "avísame cuando llegue mi talla".
//  · Métricas sin datos personales: vistas, clics a WhatsApp, guardados.
// ─────────────────────────────────────────────────────────────
(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pesos = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');
  const WL = 'bazar_wishlist';
  const TALLA_KEY = 'stmp-mi-talla';
  const CUPON_KEY = 'stmp-cupon';
  const tienda = () => (typeof getTienda === 'function' && getTienda()) || { porBazar: {}, drops: [] };
  const cfgDe = bazarId => tienda().porBazar?.[String(bazarId || 1)] || tienda().porBazar?.[Number(bazarId || 1)] || null;
  // Iconos de línea (js/iconos.js) y módulos que se pueden apagar desde el panel
  const ic = (n, t = 16, c = '') => typeof window.ico === 'function' ? window.ico(n, t, c) : '';
  const mod = (k, bazarId = 1) => cfgDe(bazarId)?.modulos?.[k] !== false;
  const enFicha = /prenda\.html/.test(location.pathname) || !!document.getElementById('ppContenido');
  // Se lee al cargar: el catálogo reescribe la URL con sus filtros después
  const Q_INICIAL = new URLSearchParams(location.search);
  const tallaBase = t => String(t || '').split('·')[0].trim().replace(/\s*(hombre|mujer|unisex)$/i, '').trim().toUpperCase();

  // ── API ────────────────────────────────────────────────────
  async function post(op, body) {
    const r = await fetch(`/api/acciones?op=${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'No se pudo completar'), j);
    return j;
  }
  const evento = (prendaId, tipo) => post('v-evento', { prendaId, tipo }).catch(() => null);

  // ── Ventanita (modal) ──────────────────────────────────────
  function modal(html, { onAbrir, enPesos } = {}) {
    cerrarModalTP();
    const m = document.createElement('div');
    if (enPesos) m.dataset.sinMoneda = '';   // la pantalla de cobro siempre en pesos
    m.className = 'tp-modal'; m.id = 'tpModal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = `<div class="tp-caja"><button class="tp-x" onclick="tpCerrar()" aria-label="Cerrar">${ic('equis', 18)}</button>${html}</div>`;
    m.addEventListener('click', e => { if (e.target === m) cerrarModalTP(); });
    document.body.appendChild(m); document.body.classList.add('tp-sin-scroll');
    requestAnimationFrame(() => m.classList.add('abierto'));
    onAbrir?.(m);
    m.querySelector('input')?.focus();
    return m;
  }
  function cerrarModalTP() { const m = $('#tpModal'); if (m) m.remove(); document.body.classList.remove('tp-sin-scroll'); }
  window.tpCerrar = cerrarModalTP;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarModalTP(); });

  // Datos de contacto recordados (para no pedirlos dos veces)
  const contacto = () => { try { return JSON.parse(localStorage.getItem('stmp-contacto') || '{}'); } catch { return {}; } };
  const guardarContacto = c => { try { localStorage.setItem('stmp-contacto', JSON.stringify(c)); } catch {} };
  const camposContacto = () => {
    const c = contacto();
    return `<label class="tp-campo"><span>Tu nombre</span><input id="tpNombre" maxlength="60" autocomplete="name" value="${esc(c.nombre || '')}"></label>
      <label class="tp-campo"><span>Tu WhatsApp (10 dígitos)</span><input id="tpTel" maxlength="16" inputmode="tel" autocomplete="tel" value="${esc(c.telefono || '')}"></label>`;
  };
  const leerContacto = () => {
    const c = { nombre: $('#tpNombre')?.value.trim(), telefono: $('#tpTel')?.value.replace(/\D/g, '') };
    if (!c.nombre) throw new Error('Escribe tu nombre');
    if (c.telefono.length < 10) throw new Error('Escribe tu WhatsApp a 10 dígitos');
    guardarContacto(c); return c;
  };
  function mensaje(m, tipo = '') { const el = $('#tpMsg'); if (el) { el.textContent = m; el.className = 'tp-msg ' + tipo; } }


  // ═════════════════════════════════════════════════════════
  //  MONEDA: ver precios en MXN o en USD
  //  Los precios se guardan y se cobran en pesos; esto solo cambia cómo se
  //  muestran. Se convierte el texto que ya pintó la página ("$350 MXN"),
  //  así funciona en catálogo, ficha, bolsa e inicio sin tocar cada pantalla.
  // ═════════════════════════════════════════════════════════
  const MONEDA_KEY = 'stmp-moneda';
  const MON = { originales: new Map(), activa: 'MXN' };
  const tasa = () => Number(tienda().moneda?.mxnPorUsd) || 0;
  function monedaInicial() {
    const g = localStorage.getItem(MONEDA_KEY);
    if (g === 'USD' || g === 'MXN') return g;
    // Dólares por defecto solo a quien tiene el teléfono en inglés Y está fuera de México
    // (en Reynosa mucha gente tiene el cel en inglés pero paga en pesos).
    const idioma = (navigator.languages?.[0] || navigator.language || '').toLowerCase();
    let zona = ''; try { zona = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
    const enMexico = /^America\/(Mexico_City|Matamoros|Monterrey|Tijuana|Hermosillo|Mazatlan|Chihuahua|Ciudad_Juarez|Ojinaga|Cancun|Merida|Bahia_Banderas)$/.test(zona);
    return idioma.startsWith('en') && !enMexico ? 'USD' : 'MXN';
  }
  const RE_PRECIO = /(-?)\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(\s*MXN)?/g;
  const fmtUSD = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const NO_TOCAR = 'script,style,textarea,input,select,option,[data-sin-moneda],.tp-moneda';
  function convertirTexto(t, sigueMXN) {
    const k = tasa();
    return t.replace(RE_PRECIO, (m, signo, entero, dec, mxn) => {
      const mxnVal = Number(entero.replace(/,/g, '') + (dec ? '.' + dec : ''));
      const usd = mxnVal / k;
      return `${signo}${fmtUSD(usd)}${mxn && !sigueMXN ? ' USD' : ''}`;   // misma forma que el original
    }).replace(/^(\s*)MXN(\s*)$/, '$1USD$2');
  }
  function tocarNodo(n) {
    if (n.nodeType !== 3 || !n.nodeValue || (!n.nodeValue.includes('$') && !/^\s*MXN\s*$/.test(n.nodeValue))) return;
    const p = n.parentElement; if (!p || p.closest(NO_TOCAR)) return;
    const guardado = MON.originales.get(n);
    if (guardado && n.nodeValue === guardado.convertido) return;     // ya está en USD
    const original = n.nodeValue;
    const sig = n.nextSibling;
    const sigueMXN = sig && sig.nodeType === 1 && /^\s*MXN\s*$/.test(sig.textContent || '');
    const convertido = convertirTexto(original, sigueMXN);
    if (convertido === original) return;
    MON.originales.set(n, { original, convertido });
    n.nodeValue = convertido;
  }
  function recorrer(raiz) {
    if (MON.activa !== 'USD' || !tasa() || !raiz) return;
    if (raiz.nodeType === 3) return tocarNodo(raiz);
    if (raiz.nodeType !== 1 || raiz.closest?.(NO_TOCAR)) return;
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    const nodos = []; while (w.nextNode()) nodos.push(w.currentNode);
    nodos.forEach(tocarNodo);
  }
  function restaurar() {
    for (const [n, g] of MON.originales) { if (n.isConnected && n.nodeValue === g.convertido) n.nodeValue = g.original; }
    MON.originales.clear();
  }
  function ponerMoneda(m) {
    MON.activa = m === 'USD' && tasa() ? 'USD' : 'MXN';
    try { localStorage.setItem(MONEDA_KEY, MON.activa); } catch {}
    document.documentElement.dataset.moneda = MON.activa;
    if (MON.activa === 'USD') recorrer(document.body); else restaurar();
    pintarSelectorMoneda();
  }
  window.tpMoneda = ponerMoneda;
  function pintarSelectorMoneda() {
    if (!tasa() || tienda().moneda === null) return;
    let sel = document.getElementById('tpMoneda');
    if (!sel) {
      const ancla = document.getElementById('wishlistHeaderBtn'); if (!ancla) return;
      sel = document.createElement('div'); sel.id = 'tpMoneda'; sel.className = 'tp-moneda';
      sel.setAttribute('role', 'group'); sel.setAttribute('aria-label', 'Moneda');
      ancla.before(sel);
    }
    const k = tasa();
    sel.title = `1 USD = $${k.toFixed(2)} MXN${tienda().moneda?.fuente === 'fijo' ? '' : ' · tipo de cambio del día'}. Se cobra en pesos.`;
    const otra = MON.activa === 'USD' ? 'MXN' : 'USD';
    // En celular se ve un solo botón con la moneda actual; al tocarlo cambia a la otra
    sel.innerHTML = ['MXN', 'USD'].map(m => `<button type="button" class="tp-mon-op ${MON.activa === m ? 'on' : ''}" aria-pressed="${MON.activa === m}" onclick="tpMoneda('${m}')">${m}</button>`).join('')
      + `<button type="button" class="tp-mon-corto" onclick="tpMoneda('${otra}')" aria-label="Precios en ${MON.activa}. Cambiar a ${otra}">${MON.activa}${ic('recargar')}</button>`;
  }
  new MutationObserver(ms => {
    if (MON.activa !== 'USD' || !tasa()) return;
    for (const m of ms) {
      if (m.type === 'characterData') tocarNodo(m.target);
      else m.addedNodes.forEach(recorrer);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // ═════════════════════════════════════════════════════════
  //  CARRITO: descuentos, cupón, total y pago
  // ═════════════════════════════════════════════════════════
  const lista = () => { try { return JSON.parse(localStorage.getItem(WL)) || []; } catch { return []; } };
  function vivo(p) {
    const v = (typeof getDB === 'function' ? getDB() : []).find(x => String(x.id) === String(p.id));
    return v ? { ...p, ...v } : p;
  }
  const disponible = p => !p.vendido && !p.oculto && !p.apartada;
  const cuponGuardado = () => { try { return JSON.parse(localStorage.getItem(CUPON_KEY) || 'null'); } catch { return null; } };

  function cuenta(cfg, precios, cupon) {
    const subtotal = precios.reduce((t, p) => t + p, 0);
    const tramo = [...(cfg?.volumen || [])].reverse().find(v => precios.length >= v.n);
    const descVolumen = tramo ? Math.round(subtotal * tramo.pct / 100) : 0;
    let descCupon = 0;
    if (cupon && subtotal >= (cupon.minimo || 0)) descCupon = cupon.tipo === 'monto' ? Math.min(cupon.valor, subtotal - descVolumen) : Math.round((subtotal - descVolumen) * cupon.valor / 100);
    const siguiente = (cfg?.volumen || []).find(v => precios.length < v.n);
    return { subtotal, tramo, descVolumen, descCupon, total: Math.max(0, subtotal - descVolumen - descCupon), siguiente };
  }

  function grupos() {
    const g = new Map();
    lista().map(vivo).forEach(p => { const k = String(p.bazarId || 1); if (!g.has(k)) g.set(k, []); g.get(k).push(p); });
    return [...g.entries()];
  }

  function mejorarBolsa() {
    const secciones = document.querySelectorAll('#wishlistPanelBody .wl-grupo');
    if (!secciones.length) return;
    const gs = grupos();
    secciones.forEach((sec, i) => {
      const [bazarId, items] = gs[i] || [];
      if (!bazarId) return;
      const cfg = cfgDe(bazarId);
      const libres = items.filter(disponible);
      if (!libres.length) return;
      const cup = cuponGuardado();
      const cupon = cup && String(cup.bazarId) === String(bazarId) ? cup : null;
      const c = cuenta(cfg, libres.map(p => Number(p.precio_venta) || 0), cupon);
      const bz = typeof getBazares === 'function' ? getBazares().find(b => String(b.id) === String(bazarId)) : null;
      const wa = typeof whatsappDe === 'function' ? whatsappDe(libres[0]) : '';
      const lineas = libres.map((p, k) => `${k + 1}. ${p.nombre} · Talla ${p.talla || '–'} · ${pesos(p.precio_venta)}`).join('\n');
      const msg = `Hola ${bz?.nombre || ''}! Quiero apartar estas prendas:\n\n${lineas}\n\nSubtotal: ${pesos(c.subtotal)}` +
        (c.descVolumen ? `\nDescuento por ${libres.length} prendas (${c.tramo.pct}%): -${pesos(c.descVolumen)}` : '') +
        (c.descCupon ? `\nCupón ${cupon.codigo}: -${pesos(c.descCupon)}` : '') +
        `\nTotal: ${pesos(c.total)} MXN\n\n¿Siguen disponibles?`;
      const btnWa = sec.querySelector('.wl-grupo-wa');
      if (btnWa) {
        btnWa.href = `https://wa.me/${wa}?text=${encodeURIComponent(msg)}`;
        btnWa.lastChild.textContent = ` Apartar por WhatsApp · ${pesos(c.total)}`;
        btnWa.onclick = () => libres.forEach(p => evento(p.id, 'wa'));
      }
      sec.querySelector('.tp-bolsa')?.remove();
      const bloque = document.createElement('div');
      bloque.className = 'tp-bolsa';
      bloque.innerHTML = `
        ${cfg?.volumen?.length ? `<div class="tp-vol ${c.tramo ? 'ok' : ''}">${c.tramo
          ? `${ic('check', 15)} Llevas ${libres.length}: <b>${c.tramo.pct}% de descuento</b>${c.siguiente ? ` · con ${c.siguiente.n} prendas ahorras ${c.siguiente.pct}%` : ''}`
          : `Agrega ${c.siguiente.n - libres.length} prenda${c.siguiente.n - libres.length === 1 ? '' : 's'} más y ahorra <b>${c.siguiente.pct}%</b>`}</div>` : ''}
        <div class="tp-filas">
          <div><span>Subtotal</span><span>${pesos(c.subtotal)}</span></div>
          ${c.descVolumen ? `<div class="desc"><span>Descuento ${c.tramo.pct}%</span><span>−${pesos(c.descVolumen)}</span></div>` : ''}
          ${c.descCupon ? `<div class="desc"><span>Cupón ${esc(cupon.codigo)} <button class="tp-link" onclick="tpQuitarCupon()">quitar</button></span><span>−${pesos(c.descCupon)}</span></div>` : ''}
          <div class="total"><span>Total</span><span>${pesos(c.total)} MXN</span></div>
        </div>
        ${cfg?.hayCupones && !cupon ? `<div class="tp-cupon"><input id="tpCupon${bazarId}" placeholder="¿Tienes cupón?" maxlength="24" autocapitalize="characters"><button onclick="tpAplicarCupon('${esc(bazarId)}', ${c.subtotal})">Aplicar</button></div>` : ''}
        ${cfg?.pagoEnLinea ? `<button class="tp-pagar clip" onclick="tpPagar('${esc(bazarId)}')">Pagar en línea ${pesos(c.total)}</button>
          <small class="tp-seguro">${ic('candado', 13)} <span>Pago seguro procesado por ${cfg.metodos?.includes('paypal') ? 'Clip o PayPal, intermediarios' : 'Clip, intermediario'} de pago. <a href="terminos.html#pagos">Más info</a></span></small>` : ''}
        ${cfg?.info?.envios || cfg?.info?.entrega ? `<small class="tp-info">${esc([cfg.info.entrega, cfg.info.envios].filter(Boolean).join(' · '))}</small>` : ''}`;
      if (btnWa) btnWa.before(bloque); else sec.appendChild(bloque);
    });
  }

  window.tpAplicarCupon = async (bazarId, subtotal) => {
    const input = document.getElementById('tpCupon' + bazarId);
    const codigo = input?.value.trim(); if (!codigo) return;
    try {
      const r = await post('v-cupon', { bazarId, codigo, subtotal });
      localStorage.setItem(CUPON_KEY, JSON.stringify({ ...r.cupon, bazarId }));
      window.renderWishlistPanel?.();
    } catch (e) { input.value = ''; input.placeholder = e.message; input.classList.add('mal'); }
  };
  window.tpQuitarCupon = () => { localStorage.removeItem(CUPON_KEY); window.renderWishlistPanel?.(); };

  // El pago se hace en su propia página (pagar.html): datos, entrega, resumen y pago seguro
  window.tpPagar = bazarId => { location.href = `pagar.html?bazar=${encodeURIComponent(bazarId)}`; };

  // ── Regreso del pago (Clip o PayPal) ───────────────────────
  // Links viejos de regreso (tienda.html?pedido=…) → página de confirmación
  function revisarPedido() {
    const id = Q_INICIAL.get('pedido'); if (!id || revisarPedido.hecho) return;
    revisarPedido.hecho = true;
    const k = Q_INICIAL.get('k') || (() => { try { const p = JSON.parse(localStorage.getItem('stmp-pedido') || 'null'); return p?.id === id ? p.clave : ''; } catch { return ''; } })();
    location.replace(`pagar.html?pedido=${encodeURIComponent(id)}${k ? `&k=${encodeURIComponent(k)}` : ''}${Q_INICIAL.get('fallo') ? '&fallo=1' : ''}`);
  }

  // ═════════════════════════════════════════════════════════
  //  FICHA DE LA PRENDA
  // ═════════════════════════════════════════════════════════
  // ── Calculadora de envío (envia.com, cotiza el servidor) ─────
  const leerCP = () => { try { return JSON.parse(localStorage.getItem('stmp-cp') || '""') || ''; } catch { return ''; } };
  window.tpCalcularEnvio = async id => {
    const cp = (document.getElementById('tpCp' + id)?.value || '').replace(/\D/g, '');
    const res = document.getElementById('tpEnvioRes' + id); if (!res) return;
    if (cp.length !== 5) { res.innerHTML = '<span class="tp-mal">Escribe tu código postal de 5 números.</span>'; return; }
    res.innerHTML = '<span class="tp-gris">Cotizando con las paqueterías…</span>';
    try {
      const r = await post('v-envio-cotizar', { ids: [id], cp });
      try { localStorage.setItem('stmp-cp', JSON.stringify(cp)); } catch {}
      const ops = r.opciones || [];
      res.innerHTML = `<b>A ${esc(r.ciudad)}${r.estado ? `, ${esc(r.estado)}` : ''}</b>
        <ul>${ops.map(o => `<li><span>${esc(o.paqueteria)} ${esc(o.servicio)}${o.dias ? ` <em>${esc(o.dias)}</em>` : ''}</span><strong>${o.precio ? pesos(o.precio) : 'Gratis'}</strong></li>`).join('')}</ul>
        ${r.gratisDesde && !ops.some(o => o.gratis) ? `<small>Envío gratis en compras desde ${pesos(r.gratisDesde)}.</small>` : ''}
        <small>Si llevas más prendas, se cotizan juntas en un solo paquete.</small>`;
    } catch (e) { res.innerHTML = `<span class="tp-mal">${esc(e.message)}</span>`; }
  };

  // "Entrega en persona: Zona Morelos y UTTN gratis; Plaza Real y Periférico $50 (gratis en compras de más de $550)"
  function textoPuntos(cfg) {
    const y = l => l.join(' y ').replace(/ y (?=.* y )/g, ', ');
    const grupos = {};
    cfg.puntosEntrega.forEach(p => { (grupos[p.costo] ||= []).push(p.nombre); });
    const partes = Object.keys(grupos).map(Number).sort((a, b) => a - b)
      .map(c => `${y(grupos[c])} ${c ? pesos(c) : 'gratis'}`);
    const conCosto = cfg.puntosEntrega.some(p => p.costo > 0);
    return `Entrega en persona: ${partes.join('; ')}${conCosto && cfg.entregaGratisDesde ? ` (gratis en compras de más de ${pesos(cfg.entregaGratisDesde)})` : ''}.`;
  }

  function mejorarFicha(p) {
    if (!p || document.getElementById('tpFicha' + p.id)) return;
    const acciones = document.querySelector('.pp-acciones'); if (!acciones) return;
    const cfg = cfgDe(p.bazarId) || {};
    const enSubasta = typeof subastaDe === 'function' && !!subastaDe(p.id) && !p.vendido;
    const caja = document.createElement('div');
    caja.className = 'tp-ficha'; caja.id = 'tpFicha' + p.id;
    const botones = [];
    if (!p.vendido && !p.apartada && !enSubasta && cfg.ofertas?.activas !== false)
      botones.push(`<button class="tp-btn" onclick="tpOferta(${p.id})">${ic('oferta')} Hacer una oferta</button>`);
    if ((p.vendido || p.apartada) && mod('avisame', p.bazarId))
      botones.push(`<button class="tp-btn" onclick="tpAvisame(${p.id})">${ic('campana')} ${p.vendido ? 'Avísame de algo parecido' : 'Avísame si se libera'}</button>`);
    const vol = cfg.volumen?.[0];
    caja.innerHTML = `
      ${botones.length ? `<div class="tp-ficha-btns">${botones.join('')}</div>` : ''}
      ${vol && !p.vendido && mod('promoBarra', p.bazarId) ? `<div class="tp-promo">${ic('bolsa')}<span>Llévate ${vol.n} prendas y ahorra ${vol.pct}%${cfg.volumen[1] ? ` · ${cfg.volumen[1].n}+ ahorras ${cfg.volumen[1].pct}%` : ''}.</span><button class="tp-link" onclick="document.getElementById('ppFav')?.click()">Agregar al carrito</button></div>` : ''}
      <div class="tp-vistas" id="tpVistas" hidden></div>
      ${cfg.envia && !p.vendido && mod('calculadoraEnvio', p.bazarId) ? `<form class="tp-envio" id="tpEnvio${p.id}" onsubmit="event.preventDefault(); tpCalcularEnvio(${p.id})">
        <label for="tpCp${p.id}">${ic('camion')} ¿Cuánto cuesta el envío a tu casa?</label>
        <div><input id="tpCp${p.id}" inputmode="numeric" maxlength="5" placeholder="Tu código postal" autocomplete="postal-code" value="${esc(leerCP())}">
        <button type="submit">Calcular</button></div>
        <div class="tp-envio-res" id="tpEnvioRes${p.id}" aria-live="polite"></div>
      </form>` : ''}
      ${!p.vendido && window.FormasPago ? window.FormasPago.html('ficha') : ''}
      ${/^https:\/\/(www\.)?instagram\.com\/[\w/-]+\/?$/.test(p.instagramUrl || '') ? `<a class="tp-ig" href="${esc(p.instagramUrl)}" target="_blank" rel="noopener">${ic('instagram')}<span>${p.vendido ? 'Ver su publicación en Instagram' : 'Ver esta prenda en Instagram'}</span></a>` : ''}
      ${(cfg.info?.envios || cfg.info?.entrega || cfg.info?.pagos || cfg.puntosEntrega?.length) ? `<ul class="tp-info-lista">
        ${cfg.puntosEntrega?.length ? `<li>${ic('ubicacion')}<span>${esc(textoPuntos(cfg))}</span></li>` : cfg.info.entrega ? `<li>${ic('ubicacion')}<span>${esc(cfg.info.entrega)}</span></li>` : ''}${cfg.info.envios ? `<li>${ic('camion')}<span>${esc(cfg.info.envios)}</span></li>` : ''}${cfg.info.pagos ? `<li>${ic('tarjeta')}<span>${esc(cfg.info.pagos)}</span></li>` : ''}
      </ul>` : ''}`;
    acciones.after(caja);

    // Comprar ahora: directo a la página de pago con esta prenda (sin pasar por el carrito)
    if (cfg.pagoEnLinea && mod('comprarAhora', p.bazarId) && !p.vendido && !p.apartada && !enSubasta && !document.getElementById('tpComprar')) {
      const btn = document.createElement('a');
      btn.id = 'tpComprar'; btn.className = 'tp-comprar';
      btn.href = `pagar.html?bazar=${encodeURIComponent(p.bazarId || 1)}&ids=${p.id}`;
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3"/></svg><span>Comprar ahora</span><b>${pesos(p.precio_venta)}</b>`;
      btn.addEventListener('click', () => { evento(p.id, 'compra'); });
      acciones.before(btn);
      const nota = document.createElement('p'); nota.className = 'tp-comprar-nota';
      const precio = Number(p.precio_venta) || 0, ap = cfg.apartado;
      const anticipo = ap && precio >= (ap.minimo || 0) ? Math.min(precio, Math.max(1, Math.ceil(precio * ap.pct / 100))) : 0;
      // v56: el texto dice cómo se cobra de verdad (si no hay tarjeta, no promete Clip)
      nota.innerHTML = (cfg.metodos?.includes('clip') ? `Pago seguro con tarjeta a través de Clip${cfg.metodos?.includes('paypal') ? ' o PayPal' : ''}.`
        : cfg.metodos?.includes('paypal') ? 'Pago seguro con PayPal.' : 'Pago por transferencia SPEI desde tu banco.')
        + (anticipo ? ` ¿Prefieres apartarla? <a class="tp-apartar" href="pagar.html?bazar=${encodeURIComponent(p.bazarId || 1)}&ids=${p.id}&modo=apartado">Apártala con $${anticipo.toLocaleString('es-MX')}</a> y paga el resto en ${ap.dias} días.`
          : ((window.FormasPago ? window.FormasPago.alternativas() : 'efectivo o transferencia') ? ` Si prefieres ${(window.FormasPago ? window.FormasPago.alternativas() : 'efectivo o transferencia')}, apártala por WhatsApp.` : ''));   // v56
      btn.after(nota);
    }

    // Modo vendedor: si este navegador tiene sesión del panel (por ejemplo al
    // escanear la etiqueta QR en un bazar), vender o apartar en un toque.
    const ses = typeof getSession === 'function' ? getSession() : null;
    if (ses?.role && !document.getElementById('tpStaff')) {
      const barra = document.createElement('div'); barra.id = 'tpStaff'; barra.className = 'tp-staff';
      barra.innerHTML = `<span>Modo vendedor · #${p.id}</span>
        ${!p.vendido ? `<a href="admin.html?vender=${p.id}">${ic('dinero')} Vender</a><a href="admin.html?apartar=${p.id}">${ic('reloj')} Apartar</a>` : ''}<a href="admin.html?editar=${p.id}">${ic('editar')} Editar</a>`;
      document.body.appendChild(barra);
    }

    // Métricas: vista + personas que la vieron hoy (solo si son varias)
    const visto = 'stmp-visto-' + p.id + '-' + new Date().toISOString().slice(0, 10);
    const yaVista = sessionStorage.getItem(visto);
    (yaVista ? Promise.resolve(null) : evento(p.id, 'vista')).then(r => {
      if (!yaVista) sessionStorage.setItem(visto, '1');
      const n = r?.hoy;
      const el = document.getElementById('tpVistas');
      if (el && n >= 5 && !p.vendido && mod('vistasHoy', p.bazarId)) { el.hidden = false; el.innerHTML = `${ic('ojo')} ${n} personas la vieron hoy`; }
    });
    acciones.querySelector('.pp-btn-wa')?.addEventListener('click', () => evento(p.id, 'wa'));
    acciones.querySelector('#ppFav')?.addEventListener('click', () => setTimeout(() => { if (document.getElementById('ppFav')?.classList.contains('active')) evento(p.id, 'bolsa'); }, 50));
    acciones.querySelector('.pp-btn-share')?.addEventListener('click', () => evento(p.id, 'compartir'));
    if (mod('masTalla', p.bazarId)) railEnTuTalla(p);
  }

  function railEnTuTalla(p) {
    const base = tallaBase(p.talla); if (!base || document.getElementById('tpRailTalla')) return;
    const otras = (typeof getDB === 'function' ? getDB() : []).filter(x => !x.vendido && !x.oculto && x.id !== p.id && tallaBase(x.talla) === base).slice(0, 10);
    const ref = document.getElementById('ppSeccionSimilares'); if (!ref || otras.length < 2 || typeof tarjeta !== 'function') return;
    const sec = ref.cloneNode(true);
    sec.id = 'tpSeccionTalla'; sec.hidden = false; sec.style.display = '';
    const titulo = sec.querySelector('h2, .h-section-title, h3'); if (titulo) titulo.textContent = `Más en talla ${base}`;
    const rail = sec.querySelector('.h-rail'); if (rail) { rail.id = 'tpRailTalla'; rail.innerHTML = otras.map(tarjeta).join(''); }
    ref.after(sec);
  }

  window.tpOferta = id => {
    const p = (getDB() || []).find(x => Number(x.id) === Number(id)); if (!p) return;
    modal(`
      <h3>Haz tu oferta</h3>
      <p class="tp-sub">${esc(p.nombre)} · Precio: <b>${pesos(p.precio_venta)}</b></p>
      <label class="tp-campo"><span>¿Cuánto ofreces? (en pesos MXN)</span><input id="tpMonto" type="number" min="1" step="10" inputmode="numeric" placeholder="$" oninput="tpOfertaUSD(this.value)"></label>
      ${tasa() ? `<small class="tp-seguro" id="tpOfUSD" data-sin-moneda></small>` : ''}
      ${camposContacto()}
      <p class="tp-msg" id="tpMsg"></p>
      <button class="tp-pagar" id="tpBtnOf" onclick="tpEnviarOferta(${p.id})">Enviar oferta</button>
      <small class="tp-seguro">El bazar te responde por WhatsApp. Si la aceptan, te la apartan 24 horas.</small>`);
  };
  window.tpOfertaUSD = v => { const el = document.getElementById('tpOfUSD'); if (el) el.textContent = Number(v) > 0 && tasa() ? `≈ ${fmtUSD(Number(v) / tasa())} USD` : ''; };
  window.tpEnviarOferta = async id => {
    const btn = $('#tpBtnOf');
    try {
      const c = leerContacto(); const monto = Number($('#tpMonto').value);
      if (!(monto > 0)) throw new Error('Escribe cuánto ofreces');
      btn.disabled = true;
      await post('v-oferta', await conTurnstile({ prendaId: id, monto, ...c }));
      $('#tpModal .tp-caja').innerHTML = `<button class="tp-x" onclick="tpCerrar()" aria-label="Cerrar">${ic('equis', 18)}</button><div class="tp-ok">${ic('check', 26)}</div><h3>¡Oferta enviada!</h3><p>Te contestamos por WhatsApp muy pronto. Mientras, agrégala a tu carrito para no perderla de vista.</p><button class="tp-pagar" onclick="tpCerrar()">Listo</button>`;
    } catch (e) { mensaje(e.message, 'mal'); if (btn) btn.disabled = false; }
  };

  window.tpAvisame = id => {
    const p = (getDB() || []).find(x => Number(x.id) === Number(id)); if (!p) return;
    modal(`
      <h3>${p.vendido ? 'Te avisamos de algo parecido' : 'Te avisamos si se libera'}</h3>
      <p class="tp-sub">${esc(p.nombre)}${p.talla ? ` · Talla ${esc(tallaBase(p.talla))}` : ''}</p>
      ${camposContacto()}
      <p class="tp-msg" id="tpMsg"></p>
      <button class="tp-pagar" id="tpBtnEs" onclick="tpEnviarEspera({tipo:'prenda', prendaId:${p.id}})">Avísame por WhatsApp</button>`);
  };
  window.tpEnviarEspera = async datos => {
    const btn = $('#tpBtnEs');
    try {
      const c = leerContacto(); btn.disabled = true;
      await post('v-espera', await conTurnstile({ ...datos, ...c }));
      $('#tpModal .tp-caja').innerHTML = `<button class="tp-x" onclick="tpCerrar()" aria-label="Cerrar">${ic('equis', 18)}</button><div class="tp-ok">${ic('check', 26)}</div><h3>¡Listo!</h3><p>Te escribimos por WhatsApp en cuanto haya noticias.</p><button class="tp-pagar" onclick="tpCerrar()">Listo</button>`;
    } catch (e) { mensaje(e.message, 'mal'); if (btn) btn.disabled = false; }
  };

  // ═════════════════════════════════════════════════════════
  //  CATÁLOGO: mi talla, drop, avísame cuando llegue
  // ═════════════════════════════════════════════════════════
  const miTalla = () => { try { return JSON.parse(localStorage.getItem(TALLA_KEY) || 'null'); } catch { return null; } };
  function tallasDisponibles() {
    const set = new Map();
    (getDB() || []).filter(p => !p.vendido && !p.oculto).forEach(p => { const b = tallaBase(p.talla); if (b && b.length <= 6) set.set(b, (set.get(b) || 0) + 1); });
    const orden = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
    return [...set.entries()].sort((a, b) => {
      const ia = orden.indexOf(a[0]), ib = orden.indexOf(b[0]);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return parseFloat(a[0]) - parseFloat(b[0]) || a[0].localeCompare(b[0]);
    }).slice(0, 18);
  }
  function aplicarMiTalla() {
    const m = miTalla();
    if (typeof shopFilters === 'undefined' || typeof renderGrid !== 'function') return;
    // Se quitan las tallas que puso "mi talla" antes
    [...shopFilters.tallas].forEach(t => { if (ZONA.puestas.has(t)) shopFilters.tallas.delete(t); });
    ZONA.puestas.clear();
    if (m?.solo) {
      (getDB() || []).forEach(p => { if (tallaBase(p.talla) === m.base && p.talla) { shopFilters.tallas.add(String(p.talla)); ZONA.puestas.add(String(p.talla)); } });
    }
    if (typeof syncShopFilters === 'function') syncShopFilters();
    renderGrid();
  }
  const ZONA = { puestas: new Set() };
  function pintarBarraTalla() {
    if (!mod('miTalla')) return;
    if (enFicha || !document.getElementById('shopGrid') && !document.querySelector('.col-central')) return;
    let barra = document.getElementById('tpTalla');
    const tallas = tallasDisponibles(); if (!tallas.length) return;
    const m = miTalla();
    if (!barra) {
      barra = document.createElement('div'); barra.id = 'tpTalla'; barra.className = 'tp-talla';
      const ancla = document.querySelector('.col-central');
      if (!ancla) return;
      ancla.prepend(barra);
    }
    barra.innerHTML = `<span class="tp-talla-lbl">Mi talla</span>
      <div class="tp-talla-ops">${tallas.map(([t, n]) => `<button class="${m?.base === t ? 'on' : ''}" onclick="tpElegirTalla(${esc(JSON.stringify(String(t)))})" title="${n} disponibles">${esc(t)}</button>`).join('')}</div>
      ${m ? `<label class="tp-check"><input type="checkbox" ${m.solo ? 'checked' : ''} onchange="tpSoloTalla(this.checked)"> Ver solo mi talla</label>` : ''}
      ${mod('avisame') ? `<button class="tp-link" onclick="tpAvisameBusqueda()">${ic('campana')} Avísame cuando llegue algo en mi talla</button>` : ''}`;
  }
  window.tpElegirTalla = base => {
    const m = miTalla();
    const nueva = m?.base === base ? null : { base, solo: true };
    if (nueva) localStorage.setItem(TALLA_KEY, JSON.stringify(nueva)); else localStorage.removeItem(TALLA_KEY);
    aplicarMiTalla(); pintarBarraTalla();
  };
  window.tpSoloTalla = solo => { const m = miTalla(); if (!m) return; m.solo = solo; localStorage.setItem(TALLA_KEY, JSON.stringify(m)); aplicarMiTalla(); };
  window.tpAvisameBusqueda = () => {
    const m = miTalla();
    const cats = (typeof getCats === 'function' ? getCats() : []).map(c => c.nombre).filter(Boolean);
    modal(`
      <h3>Te avisamos cuando llegue</h3>
      <p class="tp-sub">Cada semana entran prendas nuevas. Dinos qué buscas y te escribimos.</p>
      <label class="tp-campo"><span>Talla</span><input id="tpBTalla" maxlength="20" value="${esc(m?.base || '')}" placeholder="Ej. M, L, 32"></label>
      <label class="tp-campo"><span>Tipo de prenda (opcional)</span><select id="tpBCat"><option value="">Lo que sea</option>${cats.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
      <label class="tp-campo"><span>Marca (opcional)</span><input id="tpBMarca" maxlength="40" placeholder="Ej. Nike, Carhartt"></label>
      ${camposContacto()}
      <p class="tp-msg" id="tpMsg"></p>
      <button class="tp-pagar" id="tpBtnEs" onclick="tpEnviarEspera({tipo:'busqueda', talla: document.getElementById('tpBTalla').value, categoria: document.getElementById('tpBCat').value, marca: document.getElementById('tpBMarca').value})">Avísame por WhatsApp</button>`);
  };

  // Próximo drop con cuenta regresiva
  function pintarDrop() {
    if (enFicha || !mod('dropBanner')) return;
    const d = tienda().drops?.[0]; const ancla = document.querySelector('.col-central');
    if (!d || !ancla || document.getElementById('tpDrop')) return;
    const el = document.createElement('div'); el.id = 'tpDrop'; el.className = 'tp-drop';
    el.innerHTML = `<div><span class="tp-drop-et">Próximo drop</span><b>${esc(d.nombre)}</b><small>${d.n} pieza${d.n === 1 ? '' : 's'} única${d.n === 1 ? '' : 's'} · ${new Date(d.fecha).toLocaleString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}</small></div>
      <div class="tp-drop-reloj" id="tpReloj"></div>
      ${mod('avisame', d.bazarId) ? `<button class="tp-btn claro" onclick="tpAvisameDrop('${esc(d.id)}')">${ic('campana')} Avísame</button>` : ''}
      ${cfgDe(d.bazarId)?.modulos?.dropPagina === true ? `<a class="tp-btn claro" href="/drop/${encodeURIComponent(d.id)}">Ver el drop</a>` : ''}`;
    ancla.prepend(el);
    const tic = () => {
      const ms = new Date(d.fecha) - Date.now(), r = document.getElementById('tpReloj'); if (!r) return;
      if (ms <= 0) { r.textContent = '¡Ya salió!'; return; }
      const dd = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4), s = Math.floor(ms % 6e4 / 1e3);
      r.innerHTML = [[dd, 'd'], [h, 'h'], [m, 'm'], [s, 's']].filter(([v], i) => i > 0 || v).map(([v, u]) => `<span><b>${String(v).padStart(2, '0')}</b>${u}</span>`).join('');
    };
    tic(); setInterval(tic, 1000);
    // v43: llega desde /drop/<id> con "Avísame" → abre el formulario de aviso
    const pide = Q_INICIAL.get('avisame-drop');
    if (pide && tienda().drops?.some(x => x.id === pide) && mod('avisame')) setTimeout(() => window.tpAvisameDrop(pide), 300);
  }
  window.tpAvisameDrop = id => {
    const d = tienda().drops.find(x => x.id === id);
    modal(`<h3>Te avisamos cuando salga</h3><p class="tp-sub">Drop "${esc(d?.nombre || '')}" · piezas únicas, se van rápido.</p>${camposContacto()}
      <p class="tp-msg" id="tpMsg"></p><button class="tp-pagar" id="tpBtnEs" onclick="tpEnviarEspera({tipo:'drop', dropId:'${esc(id)}'})">Avísame por WhatsApp</button>`);
  };

  // Banner de promoción por volumen (catálogo)
  function pintarPromo() {
    if (enFicha || document.getElementById('tpPromoBar') || !mod('promoBarra')) return;
    const cfg = cfgDe(1); const v = cfg?.volumen; const ancla = document.querySelector('.col-central');
    if (!v?.length || !ancla) return;
    const el = document.createElement('div'); el.id = 'tpPromoBar'; el.className = 'tp-promobar';
    el.innerHTML = `${ic('bolsa')} <b>Llévate ${v[0].n} y ahorra ${v[0].pct}%</b>${v[1] ? ` · ${v[1].n} o más: ${v[1].pct}%` : ''}${cfg.pagoEnLinea ? ' · Paga en línea con tarjeta' : ''}`;
    ancla.prepend(el);
  }

  // Marca "Tu talla" en las tarjetas
  function marcarTarjetas() {
    const m = miTalla(); if (!m || !mod('miTalla')) return;
    document.querySelectorAll('.card[data-product]').forEach(c => {
      if (c.querySelector('.tp-tu-talla')) return;
      let p; try { p = JSON.parse(c.dataset.product); } catch { return; }
      if (tallaBase(p.talla) === m.base) c.querySelector('.card-img')?.insertAdjacentHTML('beforeend', '<span class="tp-tu-talla">Tu talla</span>');
    });
  }

  // Clics a WhatsApp desde las tarjetas (métrica)
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[href*="wa.me"]'); if (!a) return;
    const card = a.closest('[data-product]');
    if (card) { try { evento(JSON.parse(card.dataset.product).id, 'wa'); } catch {} }
  }, true);

  // ═════════════════════════════════════════════════════════
  //  Enganches
  // ═════════════════════════════════════════════════════════
  function enganchar() {
    // La bolsa se repinta desde wishlist.js: se observa su contenedor
    const cuerpo = document.getElementById('wishlistPanelBody');
    if (cuerpo && !cuerpo._tp) {
      cuerpo._tp = true;
      new MutationObserver(() => { try { mejorarBolsa(); } catch (e) { console.warn(e); } }).observe(cuerpo, { childList: true });
    }
    if (enFicha && typeof pintarPrenda === 'function' && !pintarPrenda._tp) {
      const orig = pintarPrenda;
      // eslint-disable-next-line no-global-assign
      pintarPrenda = function (p) { const r = orig.apply(this, arguments); try { mejorarFicha(p); } catch (e) { console.warn(e); } return r; };
      pintarPrenda._tp = true;
      if (typeof prenda !== 'undefined' && prenda && document.querySelector('.pp-acciones')) mejorarFicha(prenda);
    }
    if (!enFicha && typeof renderGrid === 'function' && !renderGrid._tp) {
      const orig = renderGrid;
      renderGrid = function () { const r = orig.apply(this, arguments); try { marcarTarjetas(); } catch {} return r; };
      renderGrid._tp = true;
    }
  }

  // "Mis pedidos": recibos de las compras en línea hechas en este celular
  function pintarMisPedidos() {
    let n = 0; try { n = (JSON.parse(localStorage.getItem('stmp-mis-pedidos') || '[]') || []).length; } catch {}
    if (!n || document.getElementById('tpMisPedidos') || !mod('misPedidos')) return;
    const ancla = document.getElementById('tpMoneda') || document.getElementById('wishlistHeaderBtn'); if (!ancla) return;
    const a = document.createElement('a');
    a.id = 'tpMisPedidos'; a.className = 'tp-mis'; a.href = 'pagar.html?mis=1';
    a.setAttribute('aria-label', `Mis pedidos (${n})`); a.title = 'Mis pedidos y recibos';
    a.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3"/></svg><span>Mis pedidos</span>`;
    ancla.before(a);
  }

  function alListo() {
    enganchar();
    ponerMoneda(monedaInicial());
    pintarMisPedidos();
    if (enFicha && typeof prenda !== 'undefined' && prenda) mejorarFicha(prenda);
    if (!enFicha) {
      pintarPromo(); pintarDrop(); pintarBarraTalla();
      if (miTalla()?.solo) aplicarMiTalla(); else marcarTarjetas();
    }
    revisarPedido();
  }
  window.addEventListener('db:ready', () => setTimeout(alListo, 50));
  window.addEventListener('db:inventario', () => { if (!enFicha) { pintarBarraTalla(); marcarTarjetas(); } });
  document.addEventListener('DOMContentLoaded', enganchar);
  if (typeof getDB === 'function' && (getDB() || []).length) setTimeout(alListo, 0);
})();
