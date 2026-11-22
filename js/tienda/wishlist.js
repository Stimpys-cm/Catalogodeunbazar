// js/wishlist.js — el carrito de compras, compartido.
//
// v35: la antigua "wishlist" ahora es el carrito. Se guarda en la misma
// llave de siempre (bazar_wishlist), así lo que cada cliente ya tenía
// guardado aparece en su carrito sin perder nada, y pagar.html lo cobra.
//
// Antes vivía duplicado en tienda.js y en ficha.js, así que cualquier
// mejora había que hacerla dos veces. Ahora está aquí y lo cargan las
// dos páginas; el almacenamiento es el mismo de siempre (localStorage),
// para que lo guardado desde el catálogo se vea en la ficha y al revés.
//
// La lista se agrupa por bazar porque cada uno tiene su propio WhatsApp:
// no existe un "preguntar por todo", existe un mensaje por bazar.

(function () {
  const WL_LLAVE = 'bazar_wishlist';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  const pesos = n => '$' + Number(n || 0).toLocaleString('es-MX');
  const pesosHTML = n => pesos(n) + ' <span class="cur">MXN</span>';
  // Oferta: precio anterior tachado + precio nuevo + % de descuento.
  const wlHayOferta = p => { const a = Number(p.precioAnterior); return a > 0 && a > Number(p.precio_venta); };
  const wlPrecioHTML = p => wlHayOferta(p)
    ? `<span class="of-antes">${pesos(p.precioAnterior)}</span>` +
      `<span class="of-ahora">${pesosHTML(p.precio_venta)}</span>` +
      `<span class="of-badge">-${Math.round((1 - Number(p.precio_venta) / Number(p.precioAnterior)) * 100)}%</span>`
    : pesosHTML(p.precio_venta);

  function lista() {
    try { return JSON.parse(localStorage.getItem(WL_LLAVE)) || []; }
    catch { return []; }
  }
  function guardar(l) {
    try { localStorage.setItem(WL_LLAVE, JSON.stringify(l)); } catch (_) {}
    window.dispatchEvent(new CustomEvent('wishlist:cambio'));
  }

  // La prenda guardada es una copia del momento en que se guardó. Si sigue
  // en el catálogo usamos los datos vivos: así el precio está al día y
  // sabemos si ya se vendió.
  function estadoActual(p) {
    const catalogo = (typeof getDB === 'function') ? getDB() : [];
    const vivo = catalogo.find(x => String(x.id) === String(p.id) || String(x._id) === String(p.id));
    if (!vivo) return { ...p, _vendida: false, _fuera: catalogo.length > 0 };
    // v36: apartada por otra persona (por ejemplo, alguien la está pagando: 10 min)
    return { ...p, ...vivo, id: p.id, _vendida: !!vivo.vendido, _fuera: !!vivo.oculto, _apartada: !vivo.vendido && !!vivo.apartada };
  }

  const disponible = p => !p._vendida && !p._fuera;
  // Se puede pagar ahora (las apartadas por alguien más esperan a liberarse)
  const libreAhora = p => disponible(p) && !p._apartada;

  /* ── Contador del encabezado ─────────────────────────────── */
  function updateWishlistBadge() {
    const n = lista().length;
    const badge = document.getElementById('wishlistCount');
    if (badge) {
      badge.textContent = n;
      badge.style.display = n > 0 ? 'flex' : 'none';
    }
    const enPanel = document.getElementById('wishlistPanelCount');
    if (enPanel) enPanel.textContent = n;
    // La barra inferior del móvil, solo en el catálogo
    const bn = document.getElementById('bnWlCount');
    if (bn) { bn.textContent = n; bn.style.display = n > 0 ? 'flex' : 'none'; }
  }

  /* ── Abrir y cerrar ──────────────────────────────────────── */
  function toggleWishlistPanel() {
    const panel = document.getElementById('wishlistPanel');
    if (!panel) return;
    if (panel.classList.contains('open')) return closeWishlistPanel();
    renderWishlistPanel();
    panel.classList.add('open');
    document.getElementById('wishlistOverlay')?.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeWishlistPanel() {
    document.getElementById('wishlistPanel')?.classList.remove('open');
    document.getElementById('wishlistOverlay')?.classList.remove('active');
    document.body.style.overflow = '';
  }

  /* ── Quitar ──────────────────────────────────────────────── */
  function removeFromWishlist(id) {
    const antes = lista(), quitada = antes.find(i => String(i.id) === String(id));
    guardar(antes.filter(i => String(i.id) !== String(id)));
    if (quitada && typeof Avisos === 'object') Avisos.info('Quitada de tu carrito', { origen: 'wishlist', clave: 'wl-' + id, cuerpo: quitada.nombre || '',
      deshacer: () => {
        if (lista().some(i => String(i.id) === String(id))) return;
        guardar([...lista(), quitada]); updateWishlistBadge(); renderWishlistPanel();
        document.querySelectorAll(`[data-wl-id="${id}"]`).forEach(b => b.classList.add('active'));
        const ficha = document.getElementById('ppFav');
        if (ficha && String(window.prenda?._id || window.prenda?.id) === String(id)) ficha.classList.add('active');
      } });
    updateWishlistBadge();
    renderWishlistPanel();
    // Apagar el corazón allá donde se esté viendo esa prenda
    document.querySelectorAll(`[data-wl-id="${id}"]`).forEach(b => b.classList.remove('active'));
    const ficha = document.getElementById('ppFav');
    if (ficha && String(window.prenda?._id || window.prenda?.id) === String(id)) {
      ficha.classList.remove('active');
    }
  }

  // Quita de un golpe lo que ya no se puede comprar
  function limpiarNoDisponibles() {
    const quedan = lista().filter(p => disponible(estadoActual(p)));
    guardar(quedan);
    updateWishlistBadge();
    renderWishlistPanel();
  }

  function vaciarWishlist() {
    guardar([]);
    updateWishlistBadge();
    renderWishlistPanel();
    document.querySelectorAll('[data-wl-id]').forEach(b => b.classList.remove('active'));
  }

  /* ── Abrir una prenda ────────────────────────────────────── */
  // En el catálogo hay un cajón de detalle; en la ficha no, así que ahí
  // se navega a la página de la prenda.
  function abrirPrenda(id) {
    const p = lista().find(x => String(x.id) === String(id));
    if (typeof openProductDetail === 'function' && p) {
      closeWishlistPanel();
      setTimeout(() => openProductDetail(p), 300);
    } else {
      location.href = `prenda.html?id=${encodeURIComponent(id)}`;
    }
  }

  /* ── Pintar ──────────────────────────────────────────────── */
  function renderWishlistPanel() {
    const cuerpo = document.getElementById('wishlistPanelBody');
    const pie    = document.getElementById('wishlistPanelFooter');
    if (!cuerpo) return;

    updateWishlistBadge();
    const items = lista().map(estadoActual);

    if (!items.length) {
      cuerpo.innerHTML = `
        <div class="wishlist-empty">
          <svg class="wl-vacio-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 4h2.4l2.2 10.3a1.7 1.7 0 0 0 1.7 1.3h8.1a1.7 1.7 0 0 0 1.6-1.2L21 8H6.2"/><circle cx="9.6" cy="19.6" r="1.3"/><circle cx="17.2" cy="19.6" r="1.3"/>
          </svg>
          <div class="wl-vacio-titulo">Tu carrito está vacío</div>
          <p>Toca el botón del carrito en cualquier prenda. Desde aquí la pagas en línea o la apartas por WhatsApp.</p>
          <a class="wl-vacio-cta" href="tienda.html">Ver el catálogo</a>
        </div>`;
      if (pie) pie.style.display = 'none';
      return;
    }
    if (pie) pie.style.display = 'block';

    // Cada bazar es un grupo: su color, su cuenta, su subtotal y su mensaje
    const grupos = new Map();
    items.forEach(p => {
      const clave = String(p.bazarId || 1);
      if (!grupos.has(clave)) {
        grupos.set(clave, {
          bazar: (typeof bazarDe === 'function') ? bazarDe(p) : null,
          wa: (typeof whatsappDe === 'function') ? whatsappDe(p) : '',
          items: [],
        });
      }
      grupos.get(clave).items.push(p);
    });

    const activas = items.filter(libreAhora);
    const total   = activas.reduce((s, p) => s + Number(p.precio_venta || 0), 0);
    const caidas  = items.filter(p => !disponible(p)).length;   // vendidas u ocultas (las apartadas pueden liberarse)

    const resumen = `
      <div class="wl-resumen">
        <div class="wl-resumen-n"><b>${items.length}</b> prenda${items.length !== 1 ? 's' : ''} en tu carrito</div>
        <div class="wl-resumen-total">${pesosHTML(total)}</div>
      </div>
      ${caidas ? `<button class="wl-aviso" onclick="limpiarNoDisponibles()">
        ${caidas} prenda${caidas !== 1 ? 's ya no están' : ' ya no está'} disponible${caidas !== 1 ? 's' : ''} · quitar
      </button>` : ''}`;

    const html = [...grupos.values()].map(g => {
      const nombre = g.bazar?.nombre || 'Bazar';
      const color  = g.bazar?.color || '#2d6be4';
      const libres = g.items.filter(libreAhora);
      const sub    = libres.reduce((s, p) => s + Number(p.precio_venta || 0), 0);

      const mensaje = encodeURIComponent(
        `Hola ${nombre}! Me interesan estas prendas:\n\n` +
        libres.map((p, i) => `${i + 1}. ${p.nombre} · Talla ${p.talla || '–'} · ${pesos(p.precio_venta)} MXN`).join('\n') +
        '\n\n¿Siguen disponibles?'
      );

      return `<section class="wl-grupo" style="--bz:${esc(color)}">
        <div class="wl-grupo-head">
          ${g.bazar?.logo
            ? `<img class="wl-grupo-logo" src="${esc(g.bazar.logo)}" alt="">`
            : `<span class="wl-grupo-logo wl-grupo-inicial">${esc(nombre.charAt(0))}</span>`}
          <div class="wl-grupo-datos">
            <span class="wl-grupo-nombre">${esc(nombre)}</span>
            ${g.bazar?.slug ? `<span class="wl-grupo-slug">@${esc(g.bazar.slug)}</span>` : ''}
          </div>
          <span class="wl-grupo-sub">${g.items.length} · ${pesos(sub)}</span>
        </div>

        <div class="wl-grupo-items">${g.items.map(tarjeta).join('')}</div>

        ${libres.length ? `<a class="wl-grupo-wa" href="https://wa.me/${g.wa}?text=${mensaje}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 0C5.373 0 0 5.373 0 12c0 2.138.558 4.147 1.535 5.886L0 24l6.274-1.507A11.944 11.944 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.853 0-3.587-.5-5.084-1.367l-.361-.214-3.733.897.931-3.618-.235-.374A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
          Apartar por WhatsApp
        </a>` : ''}
      </section>`;
    }).join('');

    // Lo que conviene saber antes de pagar: el carrito no aparta y quién cobra
    const nota = `<p class="wl-nota">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6h.01"/></svg>
        <span>Cada prenda es única: agregarla al carrito no la aparta. Al tocar Pagar se aparta para ti ${typeof minutosPago === 'function' ? minutosPago() : 10} minutos mientras completas el pago.
        Los pagos se procesan a través de intermediarios de pago (Clip y PayPal).
        <a href="terminos.html#pagos">Cómo funciona</a></span></p>`;
    cuerpo.innerHTML = resumen + html + nota;
  }

  function tarjeta(p) {
    const foto = (Array.isArray(p.imagenes) && p.imagenes[0]) || '';
    const src  = foto && typeof imgOptimizada === 'function' ? imgOptimizada(foto, 200) : foto;
    const img  = src
      ? `<img class="wl-item-img" src="${esc(src)}" alt="${esc(p.nombre)}" loading="lazy">`
      : `<span class="wl-item-img wl-item-sinfoto">Sin foto</span>`;

    const fuera = !disponible(p);
    const sello = p._vendida ? 'Vendida' : (fuera ? 'No disponible' : '');
    // Apartada por alguien que la está pagando: contador hasta que se libere
    const enPago = !fuera && p._apartada;
    const selloPago = enPago ? (p.pagandoHasta && window.Contador ? `Apartada ${Contador.html(p.pagandoHasta, { fin: '…' })}` : 'Apartada') : '';

    return `<article class="wl-item${fuera ? ' wl-item-fuera' : ''}${enPago ? ' wl-item-en-pago' : ''}"
      onclick="if(!event.target.closest('.wl-btn-remove'))abrirPrendaGuardada('${esc(String(p.id))}')">
      <div class="wl-item-foto">
        ${img}
        ${sello ? `<span class="wl-item-sello">${esc(sello)}</span>` : selloPago ? `<span class="wl-item-sello en-pago">${selloPago}</span>` : ''}
      </div>
      <div class="wl-item-info">
        <div class="wl-item-name">${esc(p.nombre)}</div>
        <div class="wl-item-sub">${enPago ? 'Alguien la está pagando · si no termina, se libera' : `Talla ${esc(p.talla || '–')}${p.estado ? ' · ' + esc(p.estado) : ''}`}</div>
        <span class="wl-item-price${wlHayOferta(p) ? ' tiene-oferta' : ''}">${wlPrecioHTML(p)}</span>
      </div>
      <button class="wl-btn-remove" onclick="removeFromWishlist('${esc(String(p.id))}')"
              aria-label="Quitar ${esc(p.nombre)} del carrito" title="Quitar del carrito">✕</button>
    </article>`;
  }

  // Se refresca solo cuando cambia la lista (también desde otra pestaña)
  window.addEventListener('wishlist:cambio', updateWishlistBadge);
  // v36: si una prenda del carrito se libera (o la apartan) con el panel abierto
  window.addEventListener('db:inventario', () => {
    if (document.getElementById('wishlistPanel')?.classList.contains('open')) renderWishlistPanel();
  });
  window.addEventListener('storage', e => {
    if (e.key === WL_LLAVE) { updateWishlistBadge(); renderWishlistPanel(); }
  });
  document.addEventListener('DOMContentLoaded', updateWishlistBadge);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeWishlistPanel();
  });

  // ── v37 · "Agregaste a tu carrito" (como Amazon / Mercado Libre) ──
  // Hoja con la prenda, el subtotal del carrito, el descuento que ya lleva
  // o el que le falta, y los botones "Ir a pagar" y "Ver carrito".
  // En computadora sale a la derecha; en celular sube desde abajo.
  const IR_CARRITO = 'carrito.html';
  function cfgBazar(b) {
    const t = (typeof getTienda === 'function' && getTienda()) || {};
    return t.porBazar?.[String(b)] || t.porBazar?.[Number(b)] || null;
  }
  function mostrarAgregada(p) {
    cerrarAgregada(true);
    const b = String(p.bazarId || 1), cfg = cfgBazar(b);
    const delBazar = lista().map(estadoActual).filter(x => String(x.bazarId || 1) === b && libreAhora(x));
    const n = delBazar.length, sub = delBazar.reduce((t, x) => t + Number(x.precio_venta || 0), 0);
    const vol = [...(cfg?.volumen || [])].sort((a, c) => a.n - c.n);
    const tramo = [...vol].reverse().find(v => n >= v.n), sig = vol.find(v => n < v.n);
    const conDesc = tramo ? Math.round(sub * (1 - tramo.pct / 100)) : sub;
    const foto = (Array.isArray(p.imagenes) && p.imagenes[0]) || '';
    const src = foto && typeof imgOptimizada === 'function' ? imgOptimizada(foto, 200) : foto;
    const pagar = cfg ? cfg.pagoEnLinea !== false : true;
    const fondo = document.createElement('div'); fondo.className = 'ca-fondo'; fondo.id = 'caFondo';
    const hoja = document.createElement('aside'); hoja.className = 'ca-hoja'; hoja.id = 'caHoja';
    hoja.setAttribute('role', 'dialog'); hoja.setAttribute('aria-modal', 'true'); hoja.setAttribute('aria-labelledby', 'caTitulo');
    hoja.innerHTML = `
      <div class="ca-agarre" aria-hidden="true"></div>
      <div class="ca-cab"><span class="ca-ok"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
        <h2 id="caTitulo">Agregaste a tu carrito</h2>
        <button type="button" class="ca-x" aria-label="Cerrar">✕</button></div>
      <div class="ca-prenda">
        ${src ? `<img src="${esc(src)}" alt="">` : '<span class="ca-sinfoto"></span>'}
        <div><b>${esc(p.nombre || 'Prenda')}</b><small>${esc([p.talla && `Talla ${p.talla}`, p.estado].filter(Boolean).join(' · '))}</small>
          <span class="ca-precio">${wlPrecioHTML(p)}</span></div>
      </div>
      <div class="ca-sub">
        <p>Subtotal del carrito <span>(${n} ${n === 1 ? 'prenda' : 'prendas'})</span></p>
        <p class="ca-total">${tramo ? `<s>${pesos(sub)}</s> ` : ''}${pesosHTML(conDesc)}</p>
        ${tramo ? `<p class="ca-ok-txt">Ya tienes ${tramo.pct}% de descuento por llevar ${n}.</p>` : ''}
        ${sig ? `<p class="ca-sig">Agrega ${sig.n - n} ${sig.n - n === 1 ? 'prenda' : 'prendas'} más y ahorra <b>${sig.pct}%</b> en todo.</p>
          <div class="ca-barra"><i style="width:${Math.round(n / sig.n * 100)}%"></i></div>` : ''}
      </div>
      <div class="ca-btns">
        ${pagar ? `<a class="ca-btn" href="pagar.html?bazar=${encodeURIComponent(b)}">Ir a pagar</a>` : ''}
        <a class="ca-btn ${pagar ? 'suave' : ''}" href="${IR_CARRITO}">Ver carrito</a>
        <button type="button" class="ca-seguir">Seguir comprando</button>
      </div>`;
    document.body.append(fondo, hoja);
    const cerrar = () => cerrarAgregada();
    fondo.onclick = cerrar; hoja.querySelector('.ca-x').onclick = cerrar; hoja.querySelector('.ca-seguir').onclick = cerrar;
    requestAnimationFrame(() => { fondo.classList.add('ver'); hoja.classList.add('ver'); });
    setTimeout(() => hoja.querySelector('.ca-btn')?.focus({ preventScroll: true }), 80);
    // Deslizar hacia abajo para cerrar (celular)
    let y0 = null;
    hoja.addEventListener('touchstart', e => { if (e.touches[0].clientY - hoja.getBoundingClientRect().top < 60) y0 = e.touches[0].clientY; }, { passive: true });
    hoja.addEventListener('touchmove', e => { if (y0 == null) return; const dy = Math.max(0, e.touches[0].clientY - y0); hoja.style.transform = `translateY(${dy}px)`; }, { passive: true });
    hoja.addEventListener('touchend', e => { if (y0 == null) return; const dy = (e.changedTouches[0]?.clientY || y0) - y0; y0 = null; hoja.style.transform = ''; if (dy > 90) cerrar(); });
  }
  function cerrarAgregada(ya) {
    const f = document.getElementById('caFondo'), h = document.getElementById('caHoja');
    if (!f && !h) return;
    if (ya) { f?.remove(); h?.remove(); return; }
    f?.classList.remove('ver'); h?.classList.remove('ver');
    setTimeout(() => { f?.remove(); h?.remove(); }, 320);
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrarAgregada(); });

  // ── API del carrito para las demás páginas ─────────────────
  function avisarAgregada(nombre, id) {
    // Las páginas guardan la lista justo después de avisar: se espera un instante
    setTimeout(() => avisarYa(nombre, id), 0);
  }
  function avisarYa(nombre, id) {
    const p = lista().find(x => String(x.id) === String(id));
    if (p) { mostrarAgregada(estadoActual(p)); return; }
    if (typeof Avisos === 'object') Avisos.ok('Agregada a tu carrito', { origen: 'wishlist', clave: 'wl-' + id, cuerpo: nombre || '',
      acciones: [{ texto: 'Ver carrito', principal: true, al: () => { location.href = IR_CARRITO; } }] });
  }
  // v37: el carrito es una página propia (carrito.html), como en las tiendas grandes
  function abrirCarrito() { location.href = IR_CARRITO; }
  window.Carrito = {
    lista, tiene: id => lista().some(i => String(i.id) === String(id)),
    abrir: abrirCarrito, quitar: removeFromWishlist, avisarAgregada,
  };

  // Se exponen con los mismos nombres que ya usaban las páginas
  window.updateWishlistBadge   = updateWishlistBadge;
  // v37: el ícono del carrito, la barra de abajo y "Ver carrito" llevan a carrito.html.
  // El panel lateral de antes queda disponible como abrirPanelLateral().
  window.toggleWishlistPanel   = abrirCarrito;
  window.abrirPanelLateral     = toggleWishlistPanel;
  window.closeWishlistPanel    = closeWishlistPanel;
  window.renderWishlistPanel   = renderWishlistPanel;
  window.removeFromWishlist    = removeFromWishlist;
  window.limpiarNoDisponibles  = limpiarNoDisponibles;
  window.vaciarWishlist        = vaciarWishlist;
  window.abrirPrendaGuardada   = abrirPrenda;
})();
