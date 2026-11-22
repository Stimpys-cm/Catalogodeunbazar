// ─────────────────────────────────────────────────────────────
//  api/_lib/paginas.js — Páginas que arma el servidor (Google las lee completas)
//
//    /marca/nike, /categoria/sudaderas            (v42, módulo "paginasMarca")
//    /talla/m, /precio/menos-de-500               (v43, módulo "paginasTalla")
//    /guias, /guias/<slug>                         (v43, módulo "guias")
//    /drop/<id>                                    (v43, módulo "dropPagina")
//  Las llama api/prenda.js (el plan gratis de Vercel solo da 12 funciones).
//  Todo lo que viene de la base pasa por esc() antes de ir al HTML.
// ─────────────────────────────────────────────────────────────
import { getDB } from './db.js';
import { filtroTienda } from './bazar.js';
import { registrarFalla } from './actividad.js';

const SITIO = () => (process.env.SITE_URL || 'https://stiimpys.store').replace(/\/$/, '');
export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escJson = o => JSON.stringify(o).replace(/</g, '\\u003c');
export const slugDe = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/['’´`]/g, '').replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
export const categoriasDe = p => (Array.isArray(p.categorias) ? p.categorias : p.categoria ? [p.categoria] : []).filter(Boolean).map(String);
export const tallaDe = p => String(p.talla || '').split('·')[0].trim().replace(/\s*(hombre|mujer|unisex)$/i, '').trim();
export const PRECIOS = [300, 500, 800, 1000];
const pesos = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');
const img = (u, w = 480, h = 600, extra = '') => /^https:\/\/res\.cloudinary\.com\//.test(u || '') ? String(u).replace('/upload/', `/upload/f_auto,q_auto,c_fill,w_${w},h_${h}${extra}/`) : (u || '');
const redirigir = (res, a = '/tienda.html') => { res.setHeader('Location', a); res.setHeader('Cache-Control', 'public, max-age=300'); return res.status(302).end(); };

async function configTienda(db) {
  const { leerConfigTienda } = await import('./crecer.js');
  return leerConfigTienda(db, 1);
}
const prendido = (cfg, k, def = false) => cfg?.modulos?.[k] === undefined ? def : cfg.modulos[k] !== false;

export async function disponibles(db) {
  const deAqui = await filtroTienda(db);
  return (await db.collection('inventario').find({ vendido: { $ne: true }, oculto: { $ne: true } },
    { projection: { _id: 0, id: 1, nombre: 1, marca: 1, categorias: 1, categoria: 1, talla: 1, estado: 1, precio_venta: 1, precioAnterior: 1, imagenes: 1, bazarId: 1, creadoEn: 1, revisada: 1 } })
    .sort({ _id: -1 }).limit(3000).toArray()).filter(p => deAqui(p));
}

// ── Molde común (logo, encabezado, pie, estilos) ────────────
function molde({ titulo, desc, url, imagen, datos = [], cuerpo, tipoOg = 'website' }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(titulo)}</title>
  <meta name="description" content="${esc(desc)}">
  <link rel="canonical" href="${esc(url)}">
  <link rel="icon" href="/icons/favicon-48.png" sizes="48x48">
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
  <meta name="theme-color" content="#111111">
  <meta property="og:type" content="${tipoOg}">
  <meta property="og:locale" content="es_MX">
  <meta property="og:site_name" content="Stiimpys">
  <meta property="og:title" content="${esc(titulo)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(imagen || SITIO() + '/img/compartir.jpg')}">
  <meta name="twitter:card" content="summary_large_image">
  ${datos.length ? `<script type="application/ld+json">${escJson(datos.length === 1 ? datos[0] : datos)}</script>` : ''}
  <style>
    @font-face { font-family: 'Bebas Neue'; src: url(/css/fuentes/bebas-neue-latin-400-normal.woff2) format('woff2'); font-display: swap; }
    @font-face { font-family: 'DM Sans'; font-weight: 100 1000; src: url(/css/fuentes/dm-sans-latin-wght-normal.woff2) format('woff2'); font-display: swap; }
    * { box-sizing: border-box; } body { margin: 0; font-family: 'DM Sans', system-ui, sans-serif; color: #111; background: #faf9f6; }
    a { color: inherit; } .w { max-width: 1180px; margin: 0 auto; padding: 0 20px; }
    header { background: #fff; border-bottom: 1px solid #e8e5df; position: sticky; top: 0; z-index: 2; }
    header .w { display: flex; align-items: center; justify-content: space-between; height: 64px; }
    .logo { display: flex; align-items: center; gap: 10px; text-decoration: none; font-family: 'Bebas Neue', sans-serif; font-size: 26px; letter-spacing: .06em; }
    .logo img { width: 44px; height: 44px; }
    nav a { text-decoration: none; font-weight: 600; font-size: 15px; margin-left: 18px; }
    .migas { font-size: 13px; color: #777; margin: 22px 0 6px; } .migas a { text-decoration: none; }
    h1 { font-family: 'Bebas Neue', sans-serif; font-weight: 400; font-size: clamp(44px, 8vw, 84px); line-height: .95; margin: 0; letter-spacing: .01em; }
    .sub { color: #555; margin: 10px 0 26px; font-size: 16px; max-width: 720px; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 16px; }
    @media (max-width: 560px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } .card > div { padding: 8px 10px 12px; } }
    .card { text-decoration: none; background: #fff; border-radius: 14px; overflow: hidden; border: 1px solid #ece9e3; display: flex; flex-direction: column; transition: transform .15s; }
    .card:hover { transform: translateY(-2px); }
    .card img, .card .sin { width: 100%; aspect-ratio: 4/5; object-fit: cover; display: block; background: #eee; }
    .card > div { padding: 10px 12px 14px; } .card b { display: block; font-size: 14px; line-height: 1.3; max-height: 2.6em; overflow: hidden; }
    .card small { color: #777; font-size: 12.5px; } .card .p { font-weight: 800; font-size: 16px; margin-top: 4px; } .card s { color: #999; font-weight: 400; font-size: 13px; margin-left: 6px; }
    .cta { display: inline-block; margin: 28px 0 8px; background: #111; color: #fff; text-decoration: none; padding: 14px 22px; border-radius: 12px; font-weight: 700; border: 0; font: inherit; font-weight: 700; cursor: pointer; }
    .otras { margin: 34px 0 50px; } .otras h2 { font-size: 18px; margin: 0 0 12px; }
    .otras a { display: inline-block; margin: 0 8px 8px 0; padding: 8px 14px; border-radius: 999px; border: 1px solid #ddd; text-decoration: none; font-size: 14px; background: #fff; }
    article { max-width: 720px; font-size: 17px; line-height: 1.65; } article h2 { font-size: 22px; margin: 32px 0 8px; } article li { margin: 6px 0; }
    .lista-guias a { display: block; text-decoration: none; background: #fff; border: 1px solid #ece9e3; border-radius: 14px; padding: 18px 20px; margin-bottom: 12px; }
    .lista-guias b { font-size: 19px; } .lista-guias span { display: block; color: #666; margin-top: 4px; }
    .reloj { display: flex; gap: 10px; margin: 24px 0; max-width: 520px; } .reloj span { flex: 1 1 0; min-width: 0; background: #111; color: #fff; border-radius: 14px; padding: 14px 6px; text-align: center; }
    .reloj b { display: block; font-family: 'Bebas Neue', sans-serif; font-size: clamp(30px, 10vw, 46px); font-weight: 400; line-height: 1; overflow-wrap: anywhere; } .reloj small { font-size: 12px; opacity: .7; }
    .teaser { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; margin: 20px 0; } .teaser img { width: 100%; aspect-ratio: 4/5; object-fit: cover; border-radius: 12px; }
    footer { background: #111; color: #ccc; padding: 30px 0; font-size: 13px; margin-top: 40px; } footer img { width: 120px; display: block; margin-bottom: 10px; } footer a { color: #fff; }
  </style>
</head>
<body>
  <header><div class="w"><a class="logo" href="/inicio.html"><img src="/img/logo-negro-chico.webp" alt="" width="44" height="44">STIIMPYS</a>
    <nav><a href="/tienda.html">Tienda</a><a href="/carrito.html">Carrito</a></nav></div></header>
  <main class="w">${cuerpo}</main>
  <footer><div class="w"><img src="/img/logo-blanco-chico.webp" alt="Stiimpys" width="120" height="120">Stiimpys · Streetwear y vintage en Reynosa, Tamaulipas · Envíos a todo México</div></footer>
  <script src="/js/tienda/origen.js" defer></script>
</body>
</html>`;
}
function tarjetas(lista) {
  return `<div class="grid">${lista.map(p => `<a class="card" href="/prenda.html?id=${Number(p.id)}">
      ${p.imagenes?.[0] ? `<img src="${esc(img(p.imagenes[0]))}" alt="${esc(p.nombre)}" loading="lazy" width="240" height="300">` : '<span class="sin"></span>'}
      <div><b>${esc(p.nombre)}</b><small>${esc([tallaDe(p) && 'Talla ' + tallaDe(p), p.estado].filter(Boolean).join(' · '))}</small>
      <div class="p">${pesos(p.precio_venta)}${Number(p.precioAnterior) > Number(p.precio_venta) ? `<s>${pesos(p.precioAnterior)}</s>` : ''}</div></div></a>`).join('')}</div>`;
}
function responder(res, html, s = 900) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${s}, stale-while-revalidate=3600`);
  return res.status(200).send(html);
}

// ── Marca, categoría, talla y precio ───────────────────────
const TIPOS = {
  marca:     { modulo: 'paginasMarca', def: true,  valores: p => [p.marca], nombre: v => v, titulo: v => `${v} en Stiimpys · ropa ${v} original de segunda mano`, h1: v => v, filtro: v => `marca=${encodeURIComponent(v)}`, otras: 'Otras marcas' },
  categoria: { modulo: 'paginasMarca', def: true,  valores: categoriasDe, nombre: v => v, titulo: v => `${v} · streetwear y vintage en Stiimpys`, h1: v => v, filtro: v => `cat=${encodeURIComponent(v)}`, otras: 'Otras categorías' },
  talla:     { modulo: 'paginasTalla', def: false, valores: p => [tallaDe(p)], nombre: v => v.toUpperCase(), titulo: v => `Ropa talla ${v.toUpperCase()} · streetwear y vintage en Stiimpys`, h1: v => `Talla ${v.toUpperCase()}`, filtro: v => `tallas=${encodeURIComponent(v)}`, otras: 'Otras tallas' },
};
export async function landing(req, res) {
  const tipo = String(req.query.landing || ''), slug = slugDe(req.query.slug);
  if (!slug) return redirigir(res);
  let db, todas, cfg;
  try { db = await getDB(); [todas, cfg] = await Promise.all([disponibles(db), configTienda(db)]); }
  catch (err) { await registrarFalla(err, { origen: 'landing' }); return redirigir(res); }
  // Precio: /precio/menos-de-500
  if (tipo === 'precio') {
    if (!prendido(cfg, 'paginasTalla')) return redirigir(res);
    const tope = Number((/^menos-de-(\d+)$/.exec(slug) || [])[1]);
    if (!PRECIOS.includes(tope)) return redirigir(res);
    const prendas = todas.filter(p => Number(p.precio_venta) > 0 && Number(p.precio_venta) <= tope).sort((a, b) => a.precio_venta - b.precio_venta);
    if (!prendas.length) return redirigir(res);
    return responder(res, pagina({ tipo, slug, nombre: `Menos de ${pesos(tope)}`, prendas, todas, titulo: `Ropa de menos de ${pesos(tope)} · streetwear y vintage en Stiimpys`,
      h1: `Menos de ${pesos(tope)}`, cta: `/tienda.html?max=${tope}`, otras: PRECIOS.filter(n => n !== tope).map(n => [`Menos de ${pesos(n)}`, `/precio/menos-de-${n}`]) }));
  }
  const T = TIPOS[tipo];
  if (!T || !prendido(cfg, T.modulo, T.def)) return redirigir(res);
  const prendas = todas.filter(p => T.valores(p).some(v => slugDe(v) === slug));
  const valor = prendas.length ? T.valores(prendas[0]).find(v => slugDe(v) === slug) : null;
  if (!prendas.length || !valor) return redirigir(res);
  const conteo = new Map();
  for (const p of todas) for (const v of T.valores(p)) if (v && slugDe(v) && slugDe(v) !== slug) conteo.set(v, (conteo.get(v) || 0) + 1);
  const otras = [...conteo.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([v, n]) => [`${T.nombre(v)} (${n})`, `/${tipo}/${slugDe(v)}`]);
  return responder(res, pagina({ tipo, slug, nombre: T.nombre(valor), prendas, todas, titulo: T.titulo(valor), h1: T.h1(valor), cta: `/tienda.html?${T.filtro(valor)}`, otrasTitulo: T.otras, otras }));
}
function pagina({ tipo, slug, nombre, prendas, titulo, h1, cta, otras = [], otrasTitulo = 'Ver también' }) {
  const url = `${SITIO()}/${tipo}/${slug}`;
  const desc = `${prendas.length} ${prendas.length === 1 ? 'prenda disponible' : 'prendas disponibles'}${tipo === 'precio' ? ' de' : ' de'} ${nombre} en Stiimpys, Reynosa. Piezas únicas revisadas a mano, envío a todo México y pago seguro con tarjeta, PayPal o transferencia.`;
  const min = Math.min(...prendas.map(p => Number(p.precio_venta) || 0).filter(n => n > 0));
  const lista = prendas.slice(0, 120);
  const datos = [
    { '@context': 'https://schema.org', '@type': 'CollectionPage', name: titulo, description: desc, url,
      mainEntity: { '@type': 'ItemList', numberOfItems: prendas.length, itemListElement: lista.slice(0, 60).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITIO()}/prenda.html?id=${p.id}`, name: p.nombre })) } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Stiimpys', item: `${SITIO()}/` },
      { '@type': 'ListItem', position: 2, name: 'Tienda', item: `${SITIO()}/tienda.html` },
      { '@type': 'ListItem', position: 3, name: nombre, item: url }] },
  ];
  return molde({ titulo, desc, url, imagen: img(lista[0]?.imagenes?.[0]), datos, cuerpo: `
    <p class="migas"><a href="/inicio.html">Inicio</a> › <a href="/tienda.html">Tienda</a> › ${esc(nombre)}</p>
    <h1>${esc(h1)}</h1>
    <p class="sub">${esc(desc)}${min > 0 && isFinite(min) ? ` Desde ${pesos(min)} MXN.` : ''}</p>
    ${tarjetas(lista)}
    <a class="cta" href="${esc(cta)}">Ver en la tienda con filtros</a>
    ${otras.length ? `<section class="otras"><h2>${esc(otrasTitulo)}</h2>${otras.map(([t, h]) => `<a href="${esc(h)}">${esc(t)}</a>`).join('')}</section>` : ''}` });
}

// ── Guías ──────────────────────────────────────────────────
export async function guias(req, res) {
  let db, cfg;
  try { db = await getDB(); cfg = await configTienda(db); } catch (err) { await registrarFalla(err, { origen: 'guias' }); return redirigir(res); }
  if (!prendido(cfg, 'guias')) return redirigir(res, '/inicio.html');
  const { GUIAS } = await import('./guias.js');
  const slug = slugDe(req.query.slug);
  if (!slug) {
    const url = `${SITIO()}/guias`;
    return responder(res, molde({ titulo: 'Guías de Stiimpys · streetwear, vintage y compras seguras', desc: 'Cómo reconocer prendas originales, elegir tu talla en ropa vintage, cuidar tu ropa y comprar en Stiimpys.', url,
      cuerpo: `<p class="migas"><a href="/inicio.html">Inicio</a> › Guías</p><h1>Guías</h1><p class="sub">Lo que aprendimos revisando miles de prendas, para que compres con confianza.</p>
        <div class="lista-guias">${GUIAS.map(g => `<a href="/guias/${esc(g.slug)}"><b>${esc(g.titulo)}</b><span>${esc(g.resumen)}</span></a>`).join('')}</div>` }), 3600);
  }
  const g = GUIAS.find(x => x.slug === slug);
  if (!g) return redirigir(res, '/guias');
  const url = `${SITIO()}/guias/${g.slug}`;
  const relacionadas = g.buscar ? (await disponibles(db)).filter(p => g.buscar.test(`${p.nombre} ${p.marca || ''} ${categoriasDe(p).join(' ')}`)).slice(0, 8) : [];
  const datos = [{ '@context': 'https://schema.org', '@type': 'Article', headline: g.titulo, description: g.resumen, datePublished: g.fecha, dateModified: g.fecha,
    author: { '@type': 'Organization', name: 'Stiimpys' }, publisher: { '@type': 'Organization', name: 'Stiimpys', logo: { '@type': 'ImageObject', url: `${SITIO()}/icons/icon-512.png` } }, mainEntityOfPage: url }];
  return responder(res, molde({ titulo: `${g.titulo} | Stiimpys`, desc: g.resumen, url, datos, tipoOg: 'article', cuerpo: `
    <p class="migas"><a href="/inicio.html">Inicio</a> › <a href="/guias">Guías</a></p>
    <h1>${esc(g.titulo)}</h1><p class="sub">${esc(g.resumen)}</p>
    <article>${g.html}</article>
    ${relacionadas.length ? `<section class="otras"><h2>Prendas relacionadas</h2>${tarjetas(relacionadas)}</section>` : ''}
    <a class="cta" href="/tienda.html">Ver todo el catálogo</a>
    <section class="otras"><h2>Más guías</h2>${GUIAS.filter(x => x.slug !== g.slug).map(x => `<a href="/guias/${esc(x.slug)}">${esc(x.titulo)}</a>`).join('')}</section>` }), 3600);
}

// ── Página del drop con cuenta regresiva ───────────────────
export async function drop(req, res) {
  let db, cfg;
  try { db = await getDB(); cfg = await configTienda(db); } catch (err) { await registrarFalla(err, { origen: 'drop' }); return redirigir(res); }
  if (!prendido(cfg, 'dropPagina')) return redirigir(res);
  const id = String(req.query.id || '').slice(0, 60);
  const d = id && await db.collection('drops').findOne({ id });
  if (!d || !(await filtroTienda(db))({ bazarId: d.bazarId || 1 })) return redirigir(res);
  const fecha = new Date(d.fecha), salio = d.publicado || fecha <= new Date();
  const ids = (d.prendas || []).map(Number).filter(Boolean).slice(0, 40);
  const prendas = ids.length ? await db.collection('inventario').find({ id: { $in: ids } }, { projection: { _id: 0, id: 1, nombre: 1, imagenes: 1, precio_venta: 1, vendido: 1, oculto: 1, talla: 1, estado: 1, precioAnterior: 1 } }).toArray() : [];
  const url = `${SITIO()}/drop/${encodeURIComponent(d.id)}`;
  const cuando = fecha.toLocaleString('es-MX', { timeZone: 'America/Matamoros', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  // Antes de salir: fotos borrosas (adelanto) y sin nombres ni precios
  const teaser = prendas.filter(p => p.imagenes?.[0]).slice(0, 8).map(p => img(p.imagenes[0], 300, 375, ',e_blur:1200'));
  const desc = salio ? `Ya salió el drop "${d.nombre}" de Stiimpys: ${prendas.length} piezas únicas.` : `Drop "${d.nombre}" de Stiimpys: ${prendas.length || 'varias'} piezas únicas el ${cuando}. Pide tu aviso.`;
  const cuerpo = salio ? `
    <p class="migas"><a href="/inicio.html">Inicio</a> › Drop</p><h1>${esc(d.nombre)}</h1>
    <p class="sub">¡Ya salió! Son piezas únicas: la primera persona que paga se la lleva.</p>
    ${tarjetas(prendas.filter(p => !p.oculto && !p.vendido))}
    <a class="cta" href="/tienda.html">Ver todo el catálogo</a>` : `
    <p class="migas"><a href="/inicio.html">Inicio</a> › Próximo drop</p><h1>${esc(d.nombre)}</h1>
    <p class="sub">${prendas.length ? `${prendas.length} pieza${prendas.length === 1 ? '' : 's'} única${prendas.length === 1 ? '' : 's'}` : 'Piezas únicas'} · sale el ${esc(cuando)} (hora de Reynosa).</p>
    <div class="reloj" id="reloj" data-fin="${esc(fecha.toISOString())}" aria-live="polite"></div>
    ${teaser.length ? `<div class="teaser" aria-label="Adelanto del drop">${teaser.map(u => `<img src="${esc(u)}" alt="" loading="lazy">`).join('')}</div>` : ''}
    <a class="cta" href="/tienda.html?avisame-drop=${encodeURIComponent(d.id)}">🔔 Avísame por WhatsApp cuando salga</a>
    <script>(function(){var r=document.getElementById('reloj');var f=new Date(r.dataset.fin).getTime();function t(){var ms=f-Date.now();if(ms<=0){location.reload();return}
      var d=Math.floor(ms/864e5),h=Math.floor(ms%864e5/36e5),m=Math.floor(ms%36e5/6e4),s=Math.floor(ms%6e4/1e3);
      r.innerHTML=[[d,'días'],[h,'horas'],[m,'min'],[s,'seg']].map(function(x){return '<span><b>'+String(x[0]).padStart(2,'0')+'</b><small>'+x[1]+'</small></span>'}).join('')}
      t();setInterval(t,1000)})();</script>`;
  return responder(res, molde({ titulo: `${d.nombre} · Drop de Stiimpys`, desc, url, imagen: teaser[0] ? teaser[0] : undefined, cuerpo,
    datos: [{ '@context': 'https://schema.org', '@type': 'Event', name: `Drop ${d.nombre} · Stiimpys`, startDate: fecha.toISOString(), eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
      eventStatus: 'https://schema.org/EventScheduled', location: { '@type': 'VirtualLocation', url }, organizer: { '@type': 'Organization', name: 'Stiimpys', url: SITIO() } }] }), 120);
}

// ── Entradas del sitemap según los módulos prendidos ───────
export async function entradasSitemap(db, prendas) {
  const cfg = await configTienda(db).catch(() => null);
  const cuenta = valores => { const m = new Map(); for (const v of valores) { const s = slugDe(v); if (s) m.set(s, (m.get(s) || 0) + 1); }
    return [...m.entries()].filter(([, n]) => n >= 2).map(([s]) => s); };
  const out = [];
  if (prendido(cfg, 'paginasMarca', true)) {
    out.push(...cuenta(prendas.map(p => p.marca)).map(s => `/marca/${s}`), ...cuenta(prendas.flatMap(categoriasDe)).map(s => `/categoria/${s}`));
  }
  if (prendido(cfg, 'paginasTalla')) {
    out.push(...cuenta(prendas.map(tallaDe)).map(s => `/talla/${s}`));
    out.push(...PRECIOS.filter(n => prendas.some(p => Number(p.precio_venta) > 0 && Number(p.precio_venta) <= n)).map(n => `/precio/menos-de-${n}`));
  }
  if (prendido(cfg, 'guias')) {
    const { GUIAS } = await import('./guias.js');
    out.push('/guias', ...GUIAS.map(g => `/guias/${g.slug}`));
  }
  return out;
}
