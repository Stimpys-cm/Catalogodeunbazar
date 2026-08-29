// js/redes.js — la página de los bazares.
//
// Un bloque por bazar con su identidad, sus redes, su reputación y lo
// último que ha publicado.
//
// Sobre "posts recientes": no se pueden traer las publicaciones reales de
// Instagram o TikTok desde una página estática. Esas plataformas exigen
// su API con credenciales y una cuenta de empresa; además la política de
// seguridad del sitio no permite incrustar nada de terceros. Así que lo
// que se muestra es la actividad real que sí tenemos: las últimas prendas
// que el bazar publicó aquí, con enlace directo a cada una.

(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  const POR_BAZAR = 6;   // cuántas prendas recientes se muestran

  const pesos = n => '$' + Number(n || 0).toLocaleString('es-MX');

  // Iconos de cada red
  const IC = {
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 2.138.558 4.147 1.535 5.886L0 24l6.274-1.507A11.944 11.944 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.853 0-3.587-.5-5.084-1.367l-.361-.214-3.733.897.931-3.618-.235-.374A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5 2.59 2.59 0 0 1 0-5.18c.27 0 .52.04.76.12v-3.2a5.83 5.83 0 0 0-.76-.05 5.7 5.7 0 1 0 5.7 5.7V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3a4.3 4.3 0 0 1-3.26-1.48z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.45 2.89h-2.33v6.99A10 10 0 0 0 22 12z"/></svg>',
  };

  // Las redes que tenga configuradas ese bazar, en orden de utilidad
  function redesDe(b) {
    const wa = String(b.whatsapp || '').replace(/[^0-9]/g, '');
    const ig = String(b.instagram || '').replace(/^@/, '').trim();
    const tt = String(b.tiktok || '').replace(/^@/, '').trim();
    const fb = String(b.facebook || '').replace(/^@/, '').trim();
    const salida = [];
    if (wa) salida.push({ id: 'whatsapp',  etiqueta: 'WhatsApp',  cuenta: 'Escribir',  url: `https://wa.me/${wa}` });
    if (ig) salida.push({ id: 'instagram', etiqueta: 'Instagram', cuenta: '@' + ig,    url: `https://www.instagram.com/${encodeURIComponent(ig)}` });
    if (tt) salida.push({ id: 'tiktok',    etiqueta: 'TikTok',    cuenta: '@' + tt,    url: `https://www.tiktok.com/@${encodeURIComponent(tt)}` });
    if (fb) salida.push({ id: 'facebook',  etiqueta: 'Facebook',  cuenta: fb,          url: `https://www.facebook.com/${encodeURIComponent(fb)}` });
    return salida;
  }

  function pintar() {
    const cont = document.getElementById('rdContenido');
    if (!cont) return;

    const bazares = (typeof getBazaresActivos === 'function') ? getBazaresActivos() : [];
    if (!bazares.length) {
      cont.innerHTML = `<div class="rd-vacio">
        <div class="rd-vacio-titulo">Todavía no hay bazares publicando</div>
        <p>En cuanto se sumen, aquí aparecerán con sus redes y sus prendas.</p>
      </div>`;
      return;
    }

    const catalogo = (typeof getDB === 'function') ? getDB() : [];
    cont.innerHTML = bazares.map(b => bloque(b, catalogo)).join('');
  }

  function bloque(b, catalogo) {
    const suyas      = catalogo.filter(p => Number(p.bazarId || 1) === Number(b.id) && !p.oculto);
    const disponibles = suyas.filter(p => !p.vendido);
    const vendidas    = suyas.filter(p => p.vendido);

    // Lo último que publicó, que es la actividad real que sí conocemos
    const recientes = disponibles.slice().sort((a, x) => {
      const ta = new Date(a.creadoEn || 0).getTime() || a.id || 0;
      const tx = new Date(x.creadoEn || 0).getTime() || x.id || 0;
      return tx - ta;
    }).slice(0, POR_BAZAR);

    const rating = (typeof ratingDeBazar === 'function') ? ratingDeBazar(b.id) : { promedio: 0, total: 0 };
    const estrellas = (typeof estrellasHTML === 'function') ? estrellasHTML(rating.promedio, 'st-estrellas rd-estrellas') : '';
    const redes = redesDe(b);
    const logo  = b.logo || b.portada || '';
    const color = b.color || '#2d6be4';

    return `<section class="rd-bazar" style="--bz:${esc(color)}">
      <div class="rd-banner"${b.banner ? ` style="background-image:url('${esc(b.banner)}')"` : ''}></div>

      <div class="rd-cabecera">
        ${logo ? `<img class="rd-logo" src="${esc(imgOptimizada ? imgOptimizada(logo, 220) : logo)}" alt="Logo de ${esc(b.nombre)}">`
               : `<span class="rd-logo rd-logo-txt">${esc((b.nombre || '?').charAt(0))}</span>`}
        <div class="rd-identidad">
          <span class="rd-slug">@${esc(b.slug)}</span>
          <h3 class="rd-nombre">${esc(b.nombre)}</h3>
          ${b.ubicacion ? `<div class="rd-ubi">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            ${esc(b.ubicacion)}</div>` : ''}
        </div>
      </div>

      ${b.descripcion ? `<p class="rd-desc">${esc(b.descripcion)}</p>` : ''}

      <div class="rd-cifras">
        <div class="rd-cifra"><b>${disponibles.length}</b><span>disponible${disponibles.length !== 1 ? 's' : ''}</span></div>
        <div class="rd-cifra"><b>${vendidas.length}</b><span>vendida${vendidas.length !== 1 ? 's' : ''}</span></div>
        <div class="rd-cifra rd-cifra-rep">
          ${rating.total
            ? `<b>${rating.promedio.toFixed(1)}</b>${estrellas}<span>${rating.total} reseña${rating.total !== 1 ? 's' : ''}</span>`
            : `<b>—</b><span>sin reseñas</span>`}
        </div>
      </div>

      ${redes.length ? `<div class="rd-redes">
        ${redes.map(r => `<a class="rd-red rd-red-${r.id}" href="${esc(r.url)}" target="_blank" rel="noopener">
          <span class="rd-red-ico">${IC[r.id]}</span>
          <span class="rd-red-txt">
            <span class="rd-red-nombre">${esc(r.etiqueta)}</span>
            <span class="rd-red-cuenta">${esc(r.cuenta)}</span>
          </span>
        </a>`).join('')}
      </div>` : `<p class="rd-sin-redes">Este bazar todavía no ha compartido sus redes.</p>`}

      <div class="rd-posts-head">
        <h4>Lo último que publicó</h4>
        <a class="rd-ver-todo" href="tienda.html?bazar=${encodeURIComponent(b.slug)}">${
          disponibles.length === 1 ? 'Ver su prenda' : `Ver sus ${disponibles.length} prendas`
        }</a>
      </div>

      ${recientes.length ? `<div class="rd-posts">
        ${recientes.map(tarjetaPost).join('')}
      </div>` : `<p class="rd-sin-posts">Todavía no tiene prendas publicadas.</p>`}
    </section>`;
  }

  function tarjetaPost(p) {
    const foto = (Array.isArray(p.imagenes) && p.imagenes[0]) || '';
    const src  = foto && typeof imgOptimizada === 'function' ? imgOptimizada(foto, 400) : foto;
    return `<a class="rd-post" href="prenda.html?id=${encodeURIComponent(p._id || p.id)}">
      ${src ? `<img src="${esc(src)}" alt="${esc(p.nombre)}" loading="lazy" decoding="async">`
            : `<span class="rd-post-sinfoto">Sin foto</span>`}
      <span class="rd-post-info">
        <span class="rd-post-nombre">${esc(p.nombre)}</span>
        <span class="rd-post-precio">${pesos(p.precio_venta)} <span class="cur">MXN</span></span>
      </span>
    </a>`;
  }

  // La BD llega por el poll de db.js: se pinta al tenerla y se repinta
  // si cambia el inventario, los bazares o las reseñas.
  document.addEventListener('DOMContentLoaded', async () => {
    if (typeof waitForDB === 'function') await waitForDB();
    pintar();
  });
  ['db:inventario', 'db:bazares', 'db:resenas'].forEach(ev =>
    window.addEventListener(ev, pintar));
})();
