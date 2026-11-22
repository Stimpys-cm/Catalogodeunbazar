// js/inicio.js — portada oficial de Stiimpys (usa la misma BD que la tienda)

const WA_NUM = '528995284602';

const hEsc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
// Precios en pesos mexicanos: el MXN va en pequeño junto al importe
const hMoney = n => '$' + Number(n || 0).toLocaleString('es-MX') + ' <span class="cur">MXN</span>';

// Oferta: si la prenda trae un precio anterior mayor, se muestra tachado
// junto al precio nuevo y una etiqueta con el porcentaje de descuento.
const hHayOferta = p => { const a = Number(p.precioAnterior); return a > 0 && a > Number(p.precio_venta); };
const hPrecio = p => hHayOferta(p)
  ? `<span class="of-antes">$${Number(p.precioAnterior).toLocaleString('es-MX')}</span>` +
    `<span class="of-ahora">${hMoney(p.precio_venta)}</span>` +
    `<span class="of-badge">-${Math.round((1 - Number(p.precio_venta) / Number(p.precioAnterior)) * 100)}%</span>`
  : hMoney(p.precio_venta);

// "Nuevo": subida en los últimos 7 días (misma ventana que el contador del hero).
const hEsNuevo = p => { const t = new Date(p.creadoEn || 0).getTime() || 0; return t && (Date.now() - t) < 7 * 86400000; };

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
      ${hHayOferta(p) ? `<span class="of-corner">-${Math.round((1 - Number(p.precio_venta) / Number(p.precioAnterior)) * 100)}%</span>` : ''}
      ${(!badge && hEsNuevo(p)) ? `<span class="nuevo-corner">Nuevo</span>` : ''}
    </div>
    <div class="h-card-body">
      ${p.marca
        ? `<div class="h-card-brand">${hEsc(p.marca)}</div>`
        : '<div class="h-card-brand sin-marca">Sin marca</div>'}
      <div class="h-card-name">${hEsc(p.nombre)}</div>
      <div class="h-card-foot">
        <span class="h-card-price${hHayOferta(p) ? ' tiene-oferta' : ''}">${hPrecio(p)}</span>
        <span class="h-card-size" title="${hEsc(p.talla || '')}">Talla ${hEsc(etiquetaTalla(p.talla) || '–')}</span>
      </div>
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

// ── Stiimpys: el bazar oficial de la página ─────────────────
// Se toma de la base de datos (logo, WhatsApp, Instagram). Si no se
// encuentra por su @, se usa el primer bazar activo.
function bazarOficial() {
  const activos = typeof getBazaresActivos === 'function' ? getBazaresActivos() : [];
  return activos.find(b => String(b.slug).toLowerCase() === 'stiimpys')
      || activos.find(b => Number(b.id) === 1)
      || activos[0] || null;
}
const waOficial = () => String(bazarOficial()?.whatsapp || '').replace(/[^0-9]/g, '') || WA_NUM;
const igOficial = () => String(bazarOficial()?.instagram || 'stiimpys').replace(/^@/, '');
const linkWA = texto => `https://wa.me/${waOficial()}?text=${encodeURIComponent(texto)}`;

const IC_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

// ── HERO: tarjeta oficial + números ──────────────────────────
function pintarHero(items) {
  const b    = bazarOficial();
  const wrap = document.getElementById('heroBazares');
  if (wrap) {
    const n      = items.length;
    const nombre = b?.nombre || 'Stiimpys';
    const logo   = b?.logo || b?.portada || '';
    const color  = b?.color || '#2d6be4';
    const ig     = igOficial();
    const desc   = b?.descripcion || 'Streetwear y vintage seleccionado a mano en Reynosa. Piezas únicas y envíos a todo México.';
    wrap.dataset.cuantos = 1;
    wrap.innerHTML = `<div class="hb-card hb-card-oficial" style="--bz-color:${hEsc(color)}">
      ${b?.banner ? `<div class="hb-banner" style="background-image:url('${imgOptimizada(b.banner, 700)}')"></div>` : '<div class="hb-banner hb-banner-plain"></div>'}
      <a class="hb-logo-link" href="tienda.html">
        ${logo ? `<img class="hb-logo" src="${imgOptimizada(logo, 240)}" alt="Logo de ${hEsc(nombre)}">`
               : `<div class="hb-logo hb-logo-txt">${hEsc(nombre.charAt(0))}</div>`}
      </a>
      <div class="hb-body">
        <div class="hb-oficial">${IC_OK} Página oficial</div>
        <div class="hb-slug">@${hEsc(ig)}</div>
        <h2 class="hb-name">${hEsc(nombre)}</h2>
        <p class="hb-desc">${hEsc(desc)}</p>
        <div class="hb-meta"><b>${n}</b> prenda${n !== 1 ? 's' : ''} disponible${n !== 1 ? 's' : ''} · ${hEsc(b?.ubicacion || 'Reynosa')}</div>
        <div class="hb-btns">
          <a class="hb-btn hb-btn-primary" href="tienda.html">Ver catálogo</a>
          <a class="hb-btn" href="${linkWA('Hola Stiimpys! Vengo de la página y quiero preguntar por una prenda.')}" target="_blank" rel="noopener">WhatsApp</a>
          <a class="hb-btn" href="https://www.instagram.com/${hEsc(ig)}" target="_blank" rel="noopener">Instagram</a>
        </div>
      </div>
    </div>`;
  }

  const nuevas = items.filter(hEsNuevo).length;
  const marcas = new Set(items.map(p => String(p.marca || '').trim().toLowerCase()).filter(Boolean)).size;
  const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  set('statPrendas', items.length || '—');
  set('statNuevas',  nuevas);
  set('statNuevasLbl', nuevas === 1 ? 'Prenda nueva esta semana' : 'Prendas nuevas esta semana');
  set('statMarcas',  marcas || '—');
  set('statMarcasLbl', marcas === 1 ? 'Marca en el catálogo' : 'Marcas en el catálogo');
}

// WhatsApp de Stiimpys en el hero, la invitación y el footer
function pintarContacto() {
  const poner = (id, texto) => { const a = document.getElementById(id); if (a) a.href = linkWA(texto); };
  poner('waHero',   'Hola Stiimpys! Vengo de la página y quiero preguntar por una prenda.');
  poner('waUnete',  'Hola Stiimpys! Me interesa formar parte de la página para vender mis prendas.');
  poner('waFooter', 'Hola Stiimpys!');
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

// ── Render completo ──────────────────────────────────────────
function pintarInicio() {
  const items = disponibles();
  pintarHero(items);
  pintarContacto();

  // "En oferta": prendas rebajadas, ordenadas por mayor descuento. Si no hay
  // ninguna, la sección entera se oculta.
  const pctOff = p => hHayOferta(p) ? (1 - Number(p.precio_venta) / Number(p.precioAnterior)) : 0;
  const ofertas = items.filter(hHayOferta).sort((a, b) => pctOff(b) - pctOff(a)).slice(0, 10);
  const secOfertas = document.getElementById('ofertasSeccion');
  if (secOfertas) secOfertas.classList.toggle('hidden', ofertas.length === 0);
  if (ofertas.length) pintarRail('railOfertas', ofertas);

  // "Recién llegadas": lo último que se subió
  pintarRail('railNuevas', items.slice(0, 10));

  // "Bajo presupuesto": lo más económico disponible
  const baratos = [...items].sort((a, b) => Number(a.precio_venta) - Number(b.precio_venta)).slice(0, 10);
  pintarRail('railPrecio', baratos);

  pintarCategorias(items);
  pintarMarcas(items);
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

  pintarContacto();   // con el número de respaldo mientras carga la base

  await waitForDB();
  pintarInicio();
});

window.addEventListener('db:inventario', pintarInicio);
window.addEventListener('db:categorias', () => pintarCategorias(disponibles()));
window.addEventListener('db:marcas',     () => pintarMarcas(disponibles()));
window.addEventListener('db:bazares',    () => pintarInicio());
