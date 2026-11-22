// ─────────────────────────────────────────────────────────────
//  js/tienda/extras.js — Lo nuevo de la tienda · v43
//
//  Cada cosa sale solo si su interruptor está prendido (Ventas → Módulos):
//    · selloRevisada → sello "Revisada a mano" y medidas en cm en la ficha
//    · outfit        → "Completa el outfit" en la ficha (con su % extra)
//    · paginasTalla  → la talla de la ficha lleva a /talla/…
//    · guias         → "Guías" en el pie de todas las páginas
//    · googleMaps    → "Encuéntranos en Google Maps" en el inicio + datos del negocio para Google
//  Todo lo que viene de la base se escapa antes de pintarse.
// ─────────────────────────────────────────────────────────────
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cfg = () => (typeof getTienda === 'function' && getTienda()?.porBazar?.['1']) || null;
  const mod = k => cfg()?.modulos?.[k] === true;
  const slug = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’´`]/g, '').replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const pesos = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');
  const img = (u, w) => typeof imgOptimizada === 'function' ? imgOptimizada(u, w) : u;
  // Mismo criterio que el servidor (api/_lib/extras.js → grupoPrenda)
  const GRUPOS = [
    ['arriba', /playera|camiseta|camisa|sudadera|hoodie|chamarra|chaqueta|jersey|polo|\btop\b|chaleco|su[eé]ter|crewneck|tank|blusa|abrigo|rompevientos|tee\b|t-shirt/i],
    ['abajo', /pantal[oó]n|jeans?\b|short|bermuda|jogger|falda|cargo|baggy|denim/i],
    ['calzado', /tenis|zapat|bota|sneaker|sandalia|jordan|dunk/i],
    ['accesorio', /gorra|cachucha|sombrero|bolsa|mochila|cintur[oó]n|lentes|accesorio|calcet|bufanda|beanie|gorro|cartera|reloj|collar|pulsera/i],
  ];
  const buscarG = t => (GRUPOS.find(([, re]) => re.test(t || '')) || [])[0] || null;
  const grupo = p => buscarG(p.nombre) || buscarG([...(p.categorias || []), p.categoria].filter(Boolean).join(' '));   // primero el nombre
  const MEDIDAS = [['largo', 'Largo'], ['ancho', 'Ancho (axila a axila)'], ['hombros', 'Hombros'], ['manga', 'Manga'], ['cintura', 'Cintura'], ['cadera', 'Cadera'], ['tiro', 'Tiro'], ['entrepierna', 'Entrepierna']];

  // ── Ficha de la prenda ──
  function ficha() {
    const cont = document.getElementById('ppContenido'); if (!cont || cont.dataset.ex) return;
    const id = Number(new URLSearchParams(location.search).get('id'));
    const p = (typeof getDB === 'function' ? getDB() : []).find(x => x.id === id);
    if (!p || !cont.querySelector('.pp-info')) return;
    cont.dataset.ex = '1';
    const info = cont.querySelector('.pp-info');
    if (mod('selloRevisada')) {
      if (p.revisada) info.querySelector('.pp-nombre')?.insertAdjacentHTML('afterend', `<div class="ex-sello" title="Revisamos etiqueta, costuras, manchas y cierres antes de publicarla">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>Revisada a mano por Stiimpys</div>`);
      const m = MEDIDAS.filter(([k]) => Number(p.medidas?.[k]) > 0);
      if (m.length) (cont.querySelector('.pp-ficha') || info).insertAdjacentHTML('beforeend', `<div class="ex-medidas"><h3>Medidas en centímetros</h3>
        <dl>${m.map(([k, t]) => `<div><dt>${t}</dt><dd>${Number(p.medidas[k])} cm</dd></div>`).join('')}</dl>
        <small>Medidas de la prenda acostada. Compáralas con una prenda tuya que te quede bien.</small></div>`);
    }
    if (mod('paginasTalla')) {
      const t = String(p.talla || '').split('·')[0].trim();
      if (t && slug(t)) (info.querySelector('.pp-chips') || info.querySelector('.pp-precio-fila'))?.insertAdjacentHTML('beforeend', ` <a class="pp-chip" href="/talla/${slug(t)}">Más en talla ${esc(t)}</a>`);
    }
    if (mod('outfit') && !p.vendido) {
      const g = grupo(p);
      const base = String(p.talla || '').split('·')[0].trim().toUpperCase();
      const otras = (getDB() || []).filter(x => x.id !== p.id && !x.vendido && !x.oculto && !x.apartada && grupo(x) && grupo(x) !== g)
        .sort((a, b) => (String(b.talla || '').toUpperCase().startsWith(base) - String(a.talla || '').toUpperCase().startsWith(base)) || ((b.marca === p.marca) - (a.marca === p.marca)))
        .slice(0, 4);
      if (otras.length && g) {
        document.getElementById('exOutfit')?.remove();
        const sec = document.createElement('section');
        sec.className = 'h-section h-wrap ex-outfit'; sec.id = 'exOutfit';
        sec.innerHTML = `<div class="h-section-head"><div><h2>Completa el <em>outfit</em></h2>
          <p>Llévala con otra prenda de distinto tipo y te descontamos <b>${Number(cfg().outfit?.pct || 5)}% extra</b> al pagar.</p></div></div>
          <div class="ex-outfit-lista">${otras.map(x => `<a class="ex-outfit-item" href="prenda.html?id=${Number(x.id)}">
            ${x.imagenes?.[0] ? `<img src="${esc(img(x.imagenes[0], 360))}" alt="" loading="lazy">` : '<span></span>'}
            <b>${esc(x.nombre)}</b><small>${esc(String(x.talla || '').split('·')[0])} · ${pesos(x.precio_venta)}</small></a>`).join('')}</div>`;
        const ancla = document.getElementById('ppSeccionSimilares') || document.querySelector('main section.h-section');
        ancla ? ancla.parentNode.insertBefore(sec, ancla) : document.querySelector('main')?.appendChild(sec);
      }
    }
  }

  // ── Pie: "Guías" ──
  function pie() {
    if (!mod('guias') || document.querySelector('.ex-guias-link')) return;
    const col = [...document.querySelectorAll('.sf-col')].find(c => /Stiimpys/.test(c.querySelector('h2, h3')?.textContent || ''));   // v57: los títulos del pie ahora son h2
    col?.insertAdjacentHTML('beforeend', '<a class="ex-guias-link" href="/guias">Guías</a>');
  }

  // ── Inicio: Google Maps y datos del negocio para Google ──
  function google() {
    const c = cfg(); if (!mod('googleMaps') || !c?.google || document.getElementById('exMaps')) return;
    const facts = document.querySelector('.h-facts');
    if (facts && c.google.maps) facts.insertAdjacentHTML('beforeend', `<div class="h-fact" id="exMaps"><div class="h-fact-k">Google Maps</div>
      <div class="h-fact-v"><a href="${esc(c.google.maps)}" target="_blank" rel="noopener">Encuéntranos y mira nuestras reseñas</a></div></div>`);
    if (!document.getElementById('exNegocio') && /inicio\.html$|\/$/.test(location.pathname)) {
      const l = c.legal || {};
      const datos = { '@context': 'https://schema.org', '@type': 'ClothingStore', name: 'Stiimpys', url: location.origin, image: location.origin + '/img/compartir.jpg',
        logo: location.origin + '/icons/icon-512.png', sameAs: ['https://www.instagram.com/stiimpys', c.google.maps].filter(Boolean),
        ...(l.telefono ? { telephone: l.telefono } : {}), ...(l.domicilio ? { address: { '@type': 'PostalAddress', streetAddress: l.domicilio, addressLocality: 'Reynosa', addressRegion: 'Tamaulipas', addressCountry: 'MX' } } : { address: { '@type': 'PostalAddress', addressLocality: 'Reynosa', addressRegion: 'Tamaulipas', addressCountry: 'MX' } }),
        ...(c.google.maps ? { hasMap: c.google.maps } : {}) };
      const s = document.createElement('script'); s.type = 'application/ld+json'; s.id = 'exNegocio'; s.textContent = JSON.stringify(datos).replace(/</g, '\\u003c');
      document.head.appendChild(s);
    }
  }

  function todo() { try { ficha(); pie(); google(); } catch (e) { console.warn('[extras]', e); } }
  window.addEventListener('db:ready', todo);
  window.addEventListener('db:ajustes', todo);
  const cont = document.getElementById('ppContenido');
  if (cont) new MutationObserver(() => { if (!cont.querySelector('.pp-info')) delete cont.dataset.ex; ficha(); }).observe(cont, { childList: true });
  if (typeof getTienda === 'function' && getTienda()) todo();
})();
