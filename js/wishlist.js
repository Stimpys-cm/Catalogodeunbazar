// js/wishlist.js — el panel de prendas guardadas, compartido.
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
    return { ...p, ...vivo, id: p.id, _vendida: !!vivo.vendido, _fuera: !!vivo.oculto };
  }

  const disponible = p => !p._vendida && !p._fuera;

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
    guardar(lista().filter(i => String(i.id) !== String(id)));
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          <div class="wl-vacio-titulo">Todavía no guardas nada</div>
          <p>Toca el corazón en cualquier prenda y la encontrarás aquí, lista para preguntar por WhatsApp.</p>
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

    const activas = items.filter(disponible);
    const total   = activas.reduce((s, p) => s + Number(p.precio_venta || 0), 0);
    const caidas  = items.length - activas.length;

    const resumen = `
      <div class="wl-resumen">
        <div class="wl-resumen-n"><b>${items.length}</b> prenda${items.length !== 1 ? 's' : ''} guardada${items.length !== 1 ? 's' : ''}</div>
        <div class="wl-resumen-total">${pesosHTML(total)}</div>
      </div>
      ${caidas ? `<button class="wl-aviso" onclick="limpiarNoDisponibles()">
        ${caidas} prenda${caidas !== 1 ? 's ya no están' : ' ya no está'} disponible${caidas !== 1 ? 's' : ''} · quitar
      </button>` : ''}`;

    const html = [...grupos.values()].map(g => {
      const nombre = g.bazar?.nombre || 'Bazar';
      const color  = g.bazar?.color || '#2d6be4';
      const libres = g.items.filter(disponible);
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
          Preguntar por ${libres.length === 1 ? 'esta prenda' : `estas ${libres.length}`}
        </a>` : ''}
      </section>`;
    }).join('');

    cuerpo.innerHTML = resumen + html;
  }

  function tarjeta(p) {
    const foto = (Array.isArray(p.imagenes) && p.imagenes[0]) || '';
    const src  = foto && typeof imgOptimizada === 'function' ? imgOptimizada(foto, 200) : foto;
    const img  = src
      ? `<img class="wl-item-img" src="${esc(src)}" alt="${esc(p.nombre)}" loading="lazy">`
      : `<span class="wl-item-img wl-item-sinfoto">Sin foto</span>`;

    const fuera = !disponible(p);
    const sello = p._vendida ? 'Vendida' : (fuera ? 'No disponible' : '');

    return `<article class="wl-item${fuera ? ' wl-item-fuera' : ''}"
      onclick="if(!event.target.closest('.wl-btn-remove'))abrirPrendaGuardada('${esc(String(p.id))}')">
      <div class="wl-item-foto">
        ${img}
        ${sello ? `<span class="wl-item-sello">${esc(sello)}</span>` : ''}
      </div>
      <div class="wl-item-info">
        <div class="wl-item-name">${esc(p.nombre)}</div>
        <div class="wl-item-sub">Talla ${esc(p.talla || '–')}${p.estado ? ' · ' + esc(p.estado) : ''}</div>
        <span class="wl-item-price${wlHayOferta(p) ? ' tiene-oferta' : ''}">${wlPrecioHTML(p)}</span>
      </div>
      <button class="wl-btn-remove" onclick="removeFromWishlist('${esc(String(p.id))}')"
              aria-label="Quitar ${esc(p.nombre)} de la wishlist" title="Quitar">✕</button>
    </article>`;
  }

  // Se refresca solo cuando cambia la lista (también desde otra pestaña)
  window.addEventListener('wishlist:cambio', updateWishlistBadge);
  window.addEventListener('storage', e => {
    if (e.key === WL_LLAVE) { updateWishlistBadge(); renderWishlistPanel(); }
  });
  document.addEventListener('DOMContentLoaded', updateWishlistBadge);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeWishlistPanel();
  });

  // Se exponen con los mismos nombres que ya usaban las páginas
  window.updateWishlistBadge   = updateWishlistBadge;
  window.toggleWishlistPanel   = toggleWishlistPanel;
  window.closeWishlistPanel    = closeWishlistPanel;
  window.renderWishlistPanel   = renderWishlistPanel;
  window.removeFromWishlist    = removeFromWishlist;
  window.limpiarNoDisponibles  = limpiarNoDisponibles;
  window.vaciarWishlist        = vaciarWishlist;
  window.abrirPrendaGuardada   = abrirPrenda;
})();
