// js/inicio.js — portada del catálogo (usa la misma BD que la tienda)

const WA_NUM = '528995284602';

const hEsc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
// Precios en pesos mexicanos: el MXN va en pequeño junto al importe
const hMoney = n => '$' + Number(n || 0).toLocaleString('es-MX') + ' <span class="cur">MXN</span>';

// Prendas visibles (no vendidas ni ocultas), de la más reciente a la más vieja
function disponibles() {
  return getDB()
    .filter(p => !p.vendido && !p.oculto)
    .sort((a, b) => {
      const ta = new Date(a.creadoEn || 0).getTime() || 0;
      const tb = new Date(b.creadoEn || 0).getTime() || 0;
      return tb - ta || (b.id || 0) - (a.id || 0);
    });
}

const primeraImg = p => (Array.isArray(p.imagenes) && p.imagenes[0]) || '';
const linkPrenda = p => `prenda.html?id=${encodeURIComponent(p.id)}`;

// ── Card de prenda ───────────────────────────────────────────
function cardHTML(p, badge) {
  const bz  = bazarDe(p);
  const img = primeraImg(p);
  const imgHTML = img
    ? `<img src="${imgOptimizada(img, 400)}"
            srcset="${imgSrcSet(img, [280, 400, 640])}"
            sizes="(max-width: 700px) 45vw, 220px"
            alt="${hEsc(p.nombre)}" loading="lazy" decoding="async">`
    : `<div class="h-card-nophoto">Sin foto</div>`;
  return `<a class="h-card" href="${linkPrenda(p)}">
    <div class="h-card-img">
      ${imgHTML}
      ${badge ? `<span class="h-badge">${hEsc(badge)}</span>` : ''}
    </div>
    <div class="h-card-body">
      ${p.marca
        ? `<div class="h-card-brand">${hEsc(p.marca)}</div>`
        : '<div class="h-card-brand sin-marca">Sin marca</div>'}
      <div class="h-card-name">${hEsc(p.nombre)}</div>
      <div class="h-card-foot">
        <span class="h-card-price">${hMoney(p.precio_venta)}</span>
        <span class="h-card-size" title="${hEsc(p.talla || '')}">Talla ${hEsc(etiquetaTalla(p.talla) || '–')}</span>
      </div>
      ${bz ? `<div class="card-bazar-row"><span class="card-bazar" style="--bz-color:${hEsc(bz.color || '#2d6be4')}">@${hEsc(bz.slug)}</span></div>` : ''}
    </div>
  </a>`;
}

function pintarRail(id, items, badge) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `<p style="font-size:13px;color:var(--text2)">Aún no hay prendas en esta sección. ¡Vuelve pronto!</p>`;
    el.style.display = 'block';
    return;
  }
  el.style.display = '';
  el.innerHTML = items.map(p => cardHTML(p, badge)).join('');
}

// ── HERO: los dos bazares son el protagonista ────────────────
// Con muchos bazares la portada no puede crecer sin límite: el hero muestra
// los que más publican y el resto vive en la sección "Los bazares".
const MAX_HERO   = 4;   // tarjetas grandes en el hero
const MAX_FILAS  = 4;   // filas de novedades por bazar

function conteoPorBazar(items) {
  const conteo = {};
  items.forEach(p => {
    const id = String(p.bazarId || 1);
    conteo[id] = (conteo[id] || 0) + 1;
  });
  return conteo;
}

// Bazares ordenados por cuántas prendas tienen disponibles
function bazaresPorActividad(items) {
  const conteo = conteoPorBazar(items);
  return getBazaresActivos()
    .slice()
    .sort((a, b) => (conteo[String(b.id)] || 0) - (conteo[String(a.id)] || 0));
}

function pintarHero(items) {
  const todos   = bazaresPorActividad(items);
  const bazares = todos.slice(0, MAX_HERO);
  const conteo  = conteoPorBazar(items);

  // Tarjetas grandes con el logo de cada bazar dentro del hero
  const wrap = document.getElementById('heroBazares');
  if (wrap) {
    wrap.dataset.cuantos = bazares.length;
    wrap.innerHTML = bazares.map(b => {
      const n    = conteo[String(b.id)] || 0;
      const logo = b.logo || b.portada || '';
      const wa   = String(b.whatsapp || '').replace(/[^0-9]/g, '');
      const color = b.color || '#2d6be4';
      return `<div class="hb-card" style="--bz-color:${hEsc(color)}">
        ${b.banner ? `<div class="hb-banner" style="background-image:url('${imgOptimizada(b.banner, 700)}')"></div>` : '<div class="hb-banner hb-banner-plain"></div>'}
        <a class="hb-logo-link" href="tienda.html?bazar=${encodeURIComponent(b.slug)}">
          ${logo ? `<img class="hb-logo" src="${imgOptimizada(logo, 240)}" alt="Logo de ${hEsc(b.nombre)}">`
                 : `<div class="hb-logo hb-logo-txt">${hEsc((b.nombre || '?').charAt(0))}</div>`}
        </a>
        <div class="hb-body">
          <div class="hb-slug">@${hEsc(b.slug)}</div>
          <h3 class="hb-name">${hEsc(b.nombre)}</h3>
          ${b.descripcion ? `<p class="hb-desc">${hEsc(b.descripcion)}</p>` : ''}
          <div class="hb-meta">
            <b>${n}</b> prenda${n !== 1 ? 's' : ''} disponible${n !== 1 ? 's' : ''}
            ${b.ubicacion ? ` · ${hEsc(b.ubicacion)}` : ''}
          </div>
          <div class="hb-btns">
            <a class="hb-btn hb-btn-primary" href="tienda.html?bazar=${encodeURIComponent(b.slug)}">Ver sus prendas</a>
            ${wa ? `<a class="hb-btn" href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
            ${b.instagram ? `<a class="hb-btn" href="https://www.instagram.com/${hEsc(String(b.instagram).replace(/^@/, ''))}" target="_blank" rel="noopener">Instagram</a>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  pintarTextosBazares(todos);

  const nPrendas = items.length;
  const nBazares = todos.length;
  const nuevas   = items.filter(p => {
    const t = new Date(p.creadoEn || 0).getTime() || 0;
    return t && (Date.now() - t) < 7 * 86400000;
  }).length;

  const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  set('statPrendas', nPrendas || '—');
  set('statBazares', nBazares || '—');
  set('statBazaresLbl', nBazares === 1 ? 'Bazar publicando' : 'Bazares publicando');
  set('statNuevas',  nuevas);
  set('statNuevasLbl', nuevas === 1 ? 'Prenda nueva esta semana' : 'Prendas nuevas esta semana');
}

// ── Categorías ───────────────────────────────────────────────
function pintarCategorias(items) {
  const el = document.getElementById('homeCats');
  if (!el) return;

  const conteo = {};
  items.forEach(p => (Array.isArray(p.categorias) ? p.categorias : []).forEach(c => {
    conteo[c] = conteo[c] || { n: 0, img: '' };
    conteo[c].n++;
    if (!conteo[c].img) conteo[c].img = primeraImg(p);
  }));

  const cats = getCats()
    .map(c => ({ nombre: c.nombre, ...(conteo[c.nombre] || { n: 0, img: '' }) }))
    .filter(c => c.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);

  if (!cats.length) { el.closest('.h-section')?.classList.add('hidden'); return; }

  el.innerHTML = cats.map(c => `
    <a class="h-cat" href="tienda.html?cat=${encodeURIComponent(c.nombre)}">
      ${c.img ? `<img src="${imgOptimizada(c.img, 400)}" alt="${hEsc(c.nombre)}" loading="lazy" decoding="async">` : ''}
      <div class="h-cat-label">
        <div class="h-cat-name">${hEsc(c.nombre)}</div>
        <div class="h-cat-count">${c.n} prenda${c.n !== 1 ? 's' : ''}</div>
      </div>
    </a>`).join('');
}

// Los textos de la portada se arman con los bazares que existan
// "@uno, @dos y @tres" — lista natural en español
function listaSlugs(bazares, comoHTML) {
  const partes = bazares.map(b => comoHTML
    ? `<a href="tienda.html?bazar=${encodeURIComponent(b.slug)}">@${hEsc(b.slug)}</a>`
    : `@${b.slug}`);
  if (partes.length <= 1) return partes[0] || '';
  return partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1];
}

function pintarTextosBazares(bazares) {
  const n = bazares.length;

  // Los @ bajo el título, cada uno con su color
  const slugs = document.getElementById('heroSlugs');
  if (slugs) {
    // Con muchos bazares la tira de @ se vuelve ruido: se muestran los
    // primeros y el resto queda en la sección de bazares.
    const enTitulo = bazares.slice(0, 4);
    slugs.innerHTML = enTitulo
      .map(b => `<a href="tienda.html?bazar=${encodeURIComponent(b.slug)}" style="color:${hEsc(b.color || '#2d6be4')}">@${hEsc(b.slug)}</a>`)
      .join('<span class="hero-sep">+</span>') +
      (n > enTitulo.length ? `<a class="hero-mas" href="#bazares">+${n - enTitulo.length} más</a>` : '');
    slugs.style.display = n ? '' : 'none';
  }

  // "Multi bazares" es la frase de la marca: no cambia con la cantidad
  const titulo = document.getElementById('heroTitulo');
  if (titulo) {
    titulo.innerHTML = 'Multi bazares.<br><em>Un solo catálogo.</em>';
  }

  const sub = document.getElementById('heroSub');
  if (sub && n) {
    sub.innerHTML = n === 1
      ? `Streetwear, vintage y piezas únicas de <b>@${hEsc(bazares[0].slug)}</b>. Le escribes directo por WhatsApp para apartar.`
      : `Streetwear, vintage y piezas únicas de ${listaSlugs(bazares.slice(0, 4), true)}${n > 4 ? ' y más' : ''}. ` +
        `Cada prenda es de un bazar y le escribes directo a su dueño por WhatsApp.`;
  }

  const aTit = document.getElementById('aboutTitulo');
  if (aTit) {
    aTit.innerHTML = 'Multi bazares, <em>un solo lugar</em>';
  }

  const aTxt = document.getElementById('aboutTexto');
  if (aTxt && n) {
    // Se nombran los bazares que existan: "como @uno y @dos"
    const ejemplos = listaSlugs(bazares.slice(0, 3), true);
    aTxt.innerHTML =
      `STMP MARKET es una plataforma que reúne el catálogo digital de diferentes ` +
      `bazares independientes de México, como ${ejemplos}${n > 3 ? ' y más' : ''}. ` +
      `Aquí encontrarás prendas streetwear, vintage y piezas únicas de segunda mano. ` +
      `Nada de stock repetido: casi todas son piezas únicas en talla exclusiva.`;
  }

  // Las ciudades salen de los bazares registrados
  const aUbi = document.getElementById('aboutUbicacion');
  if (aUbi) {
    const ciudades = [...new Set(bazares.map(b => b.ubicacion).filter(Boolean))];
    aUbi.textContent = ciudades.length ? `${ciudades.join(' · ')} · México` : 'México';
  }
}

// ── Bazares ──────────────────────────────────────────────────
// El catálogo es compartido: aquí se listan los bazares que publican.
function pintarBazares(items) {
  const el = document.getElementById('homeBazares');
  if (!el) return;

  const conteo = {};
  items.forEach(p => {
    const id = String(p.bazarId || 1);
    conteo[id] = (conteo[id] || 0) + 1;
  });

  const bazares = getBazaresActivos();
  const sec = el.closest('.h-section');
  if (bazares.length < 2) { sec?.classList.add('hidden'); return; }
  sec?.classList.remove('hidden');

  el.innerHTML = bazares.map(b => {
    const n = conteo[String(b.id)] || 0;
    const src  = b.logo || b.portada || '';
    const logo = src
      ? `<img class="h-bazar-logo" src="${imgOptimizada(src, 160)}" alt="Logo de ${hEsc(b.nombre)}" loading="lazy" decoding="async">`
      : `<div class="h-bazar-logo">${hEsc((b.nombre || '?').charAt(0))}</div>`;
    return `<a class="h-bazar" href="tienda.html?bazar=${encodeURIComponent(b.slug)}" style="--bz-color:${hEsc(b.color || '#2d6be4')}">
      ${logo}
      <div>
        <div class="h-bazar-name">${hEsc(b.nombre)}</div>
        <div class="h-bazar-slug">@${hEsc(b.slug)}</div>
        <div class="h-bazar-count">${n} prenda${n !== 1 ? 's' : ''} disponible${n !== 1 ? 's' : ''}</div>
      </div>
    </a>`;
  }).join('');
}

// ── Marcas ───────────────────────────────────────────────────
function pintarMarcas(items) {
  const el = document.getElementById('homeBrands');
  if (!el) return;

  const conteo = {};
  items.forEach(p => { if (p.marca) conteo[p.marca] = (conteo[p.marca] || 0) + 1; });

  const marcas = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 14);
  if (!marcas.length) { el.closest('.h-section')?.classList.add('hidden'); return; }

  el.innerHTML = marcas.map(([nombre, n]) =>
    `<a class="h-brand" href="tienda.html?marca=${encodeURIComponent(nombre)}">${hEsc(nombre)}<span>${n}</span></a>`
  ).join('');
}

// ── Una fila de novedades por cada bazar ─────────────────────
function pintarFilasPorBazar(items) {
  const cont = document.getElementById('filasBazares');
  if (!cont) return;

  const bazares = bazaresPorActividad(items).slice(0, MAX_FILAS);
  if (!bazares.length) { cont.innerHTML = ''; return; }

  cont.innerHTML = bazares.map(b => {
    const suyas = items.filter(p => Number(p.bazarId || 1) === Number(b.id)).slice(0, 10);
    const logo  = b.logo || b.portada || '';
    const color = b.color || '#2d6be4';

    const cuerpo = suyas.length
      ? `<div class="h-rail">${suyas.map(p => cardHTML(p)).join('')}</div>`
      : `<p class="hb-vacio">Todavía no hay prendas de este bazar. ¡Vuelve pronto!</p>`;

    return `<section class="h-section h-wrap" style="--bz-color:${hEsc(color)}">
      <div class="h-section-head h-section-head-bz">
        <div class="hb-head-row">
          <a class="hb-head-logo" href="tienda.html?bazar=${encodeURIComponent(b.slug)}">
            ${logo ? `<img src="${imgOptimizada(logo, 160)}" alt="Logo de ${hEsc(b.nombre)}" loading="lazy" decoding="async">`
                   : `<span>${hEsc((b.nombre || '?').charAt(0))}</span>`}
          </a>
          <div>
            <h2>Lo nuevo de <em style="color:${hEsc(color)}">${hEsc(b.nombre)}</em></h2>
            <p>@${hEsc(b.slug)}${b.ubicacion ? ' · ' + hEsc(b.ubicacion) : ''}</p>
          </div>
        </div>
        <a href="tienda.html?bazar=${encodeURIComponent(b.slug)}" class="h-see-more" style="color:${hEsc(color)}">Ver su bazar</a>
      </div>
      ${cuerpo}
    </section>`;
  }).join('');
}

// ── Render completo ──────────────────────────────────────────
function pintarInicio() {
  const items = disponibles();
  pintarHero(items);
  // "Precio accesible": lo más económico disponible
  const baratos = [...items].sort((a, b) => Number(a.precio_venta) - Number(b.precio_venta)).slice(0, 10);
  pintarRail('railPrecio', baratos);

  pintarFilasPorBazar(items);
  pintarCategorias(items);
  pintarMarcas(items);
  pintarBazares(items);
}

// ── Búsqueda del header → manda a la tienda ──────────────────
function irABuscar(e) {
  e.preventDefault();
  const q = (document.getElementById('homeSearch')?.value || '').trim();
  location.href = q ? `tienda.html?q=${encodeURIComponent(q)}` : 'tienda.html';
}

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('homeSearchForm');
  if (form) form.addEventListener('submit', irABuscar);

  const wa = document.getElementById('waHero');
  if (wa) wa.href = `https://wa.me/${WA_NUM}?text=` +
    encodeURIComponent('Hola! Vengo del catálogo STMP MARKET y quiero preguntar por una prenda.');

  await waitForDB();
  pintarInicio();
});

window.addEventListener('db:inventario', pintarInicio);
window.addEventListener('db:categorias', () => pintarCategorias(disponibles()));
window.addEventListener('db:marcas',     () => pintarMarcas(disponibles()));
window.addEventListener('db:bazares',    () => pintarInicio());
