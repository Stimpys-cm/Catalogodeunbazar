// api/prenda.js
// Lo que leen los buscadores y las apps de mensajería.
//
//   GET /api/prenda?id=X    → HTML con Open Graph de esa prenda.
//                             WhatsApp/Discord/Twitter lo usan para el
//                             preview; a la persona se le redirige a la ficha.
//   GET /sitemap.xml        → el mapa del sitio (vercel.json lo reescribe
//                             hasta aquí). Se arma con las prendas y los
//                             bazares que hay ahora mismo.
//
// Los dos viven en el mismo archivo porque el plan gratis de Vercel solo
// admite 12 Serverless Functions y ya están todas ocupadas.

import { getDB } from './_lib/db.js';
import { registrarFalla } from './_lib/actividad.js';
import { filtroTienda, multiBazar } from './_lib/bazar.js';

import { conEscudo } from './_lib/escudo.js';
async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.query.sitemap === '1') return sitemap(req, res);
  if (['marca', 'categoria', 'talla', 'precio'].includes(req.query.landing)) return landing(req, res);
  if (req.query.landing === 'guias') return guias(req, res);
  if (req.query.landing === 'drop') return drop(req, res);
  if (req.query.llms === '1') return llms(req, res);   // v57: /llms.txt (para buscadores con IA)

  const id = parseInt(req.query.id);
  // vista=bot: la pide el middleware para los robots (WhatsApp, Google…) y se
  // sirve en la MISMA dirección de la ficha. Va sin redirección: antes el robot
  // iba de /prenda.html a /api/prenda y de regreso, y Google lo veía como un
  // círculo de redirecciones que no podía indexar.
  const paraRobot = req.query.vista === 'bot';
  const SITIO = (process.env.SITE_URL || 'https://stiimpys.store').replace(/\/$/, '');

  // Si no hay id, redirigir a la tienda directamente
  if (!id) {
    res.setHeader('Location', '/tienda.html');
    return res.status(302).end();
  }

  try {
    const db   = await getDB();
    const col  = db.collection('inventario');
    const item = await col.findOne({ id });

    // Si no existe la prenda (o está oculta, o es de otro bazar: v39), redirigir a la tienda
    if (!item || item.oculto || !(await filtroTienda(db))(item)) {
      res.setHeader('Location', '/tienda.html');
      return res.status(302).end();
    }

    // Bazar dueño de la prenda (para el nombre en el preview)
    let bazar = null;
    try {
      bazar = await db.collection('bazares').findOne({ id: Number(item.bazarId || 1) });
    } catch (_) {}
    // v39 · La página es de Stiimpys
    const sitio = multiBazar() && bazar?.nombre && !/^stiimpys$/i.test(bazar.nombre) ? `${bazar.nombre} · Stiimpys` : 'Stiimpys';

    const imgs  = Array.isArray(item.imagenes) ? item.imagenes : [];
    const img   = imgs[0] || '';
    const title = `${item.nombre}${item.marca ? ' · ' + item.marca : ''} | ${sitio}`;
    const precio = Number(item.precio_venta) || 0;
    const desc  = [
      item.vendido ? 'Vendida' : `$${precio.toLocaleString('es-MX')} MXN`,
      item.talla  ? `Talla ${item.talla}`  : '',
      item.estado ? item.estado            : '',
      item.vendido ? 'Mira prendas parecidas en la tienda' : 'Pieza única · Compra en línea o apártala por WhatsApp',
    ].filter(Boolean).join(' · ');

    // El dominio sale de SITE_URL, no de la cabecera Host (que la puede poner cualquiera)
    const tiendaUrl = `${SITIO}/prenda.html?id=${id}`;

    // Datos estructurados: es lo que permite que Google muestre la prenda
    // con foto, precio y disponibilidad en vez de un enlace azul.
    const datos = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: item.nombre,
      sku: String(item.id),
      image: imgs.length ? imgs : undefined,
      description: item.descripcion || desc,
      brand: item.marca ? { '@type': 'Brand', name: item.marca } : undefined,
      size: item.talla || undefined,
      itemCondition: /nuev/i.test(String(item.estado || ''))
        ? 'https://schema.org/NewCondition'
        : 'https://schema.org/UsedCondition',
      offers: {
        '@type': 'Offer',
        price: precio,
        priceCurrency: 'MXN',
        itemCondition: /nuev/i.test(String(item.estado || ''))
          ? 'https://schema.org/NewCondition'
          : 'https://schema.org/UsedCondition',
        availability: item.vendido
          ? 'https://schema.org/SoldOut'
          : 'https://schema.org/InStock',
        url: tiendaUrl,
        seller: { '@type': 'Organization', name: multiBazar() ? (bazar?.nombre || 'Stiimpys') : 'Stiimpys' },
      },
    };

    const cabeza = `
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(item.descripcion ? String(item.descripcion).slice(0, 160) : desc)}">
  <link rel="canonical" href="${escHtml(tiendaUrl)}">

  <!-- Open Graph — WhatsApp, Facebook, Discord, iMessage -->
  <meta property="og:type"        content="product">
  <meta property="og:locale"      content="es_MX">
  <meta property="og:site_name"   content="${escHtml(sitio)}">
  <meta property="og:title"       content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(desc)}">
  <meta property="og:url"         content="${escHtml(tiendaUrl)}">
  ${img ? `<meta property="og:image"       content="${escHtml(img)}">
  <meta property="og:image:width"  content="1080">
  <meta property="og:image:height" content="1350">
  <meta property="og:image:alt"    content="${escHtml(item.nombre)}">` : ''}
  <meta property="product:price:amount"   content="${precio}">
  <meta property="product:price:currency" content="MXN">
  <meta property="product:availability"   content="${item.vendido ? 'out of stock' : 'in stock'}">

  <!-- Twitter Card -->
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="${escHtml(title)}">
  <meta name="twitter:description" content="${escHtml(desc)}">
  ${img ? `<meta name="twitter:image" content="${escHtml(img)}">` : ''}

  <script type="application/ld+json">${escJson(datos)}</script>`;

    // Para robots: una página con contenido real (sin saltos). Para personas
    // que abran /api/prenda directo: el mismo encabezado y se les manda a la ficha.
    const html = paraRobot
      ? `<!DOCTYPE html>
<html lang="es">
<head>${cabeza}
</head>
<body>
  <main>
    <h1>${escHtml(item.nombre)}</h1>
    ${img ? `<img src="${escHtml(img)}" alt="${escHtml(item.nombre)}" width="540" height="675">` : ''}
    <p>${escHtml(desc)}</p>
    ${item.marca ? `<p>Marca: ${escHtml(item.marca)}</p>` : ''}
    ${item.descripcion ? `<p>${escHtml(item.descripcion)}</p>` : ''}
    <p><a href="${escHtml(tiendaUrl)}">Ver la prenda en ${escHtml(bazar?.nombre || 'la tienda')}</a> · <a href="${escHtml(SITIO)}/tienda.html">Ver todo el catálogo</a></p>
  </main>
</body>
</html>`
      : `<!DOCTYPE html>
<html lang="es">
<head>${cabeza}
  <meta http-equiv="refresh" content="0;url=${escHtml(tiendaUrl)}">
</head>
<body>
  <p>Redirigiendo... <a href="${escHtml(tiendaUrl)}">Click aquí si no redirige</a></p>
  <script>location.replace("${escJs(tiendaUrl)}");</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Cache 5 min — suficiente para que WhatsApp lea los tags
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(html);

  } catch (err) {
    console.error('[prenda]', err);
    await registrarFalla(err, { origen: 'prenda' });
    res.setHeader('Location', '/tienda.html');
    return res.status(302).end();
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// JSON dentro de <script>: lo único peligroso es un "</script>" en el texto.
function escJson(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function escJs(str) {
  return String(str).replace(/"/g, '\\"').replace(/\//g, '\\/');
}

// ── v42/v43 · Páginas de marca, categoría, talla, precio, guías y drop ──
// Viven en api/_lib/paginas.js; aquí solo se enrutan (12 funciones como máximo en Vercel).
import { landing, guias, drop, entradasSitemap, slugDe } from './_lib/paginas.js';
export { slugDe };

// ── Mapa del sitio ───────────────────────────────────────────
// El dominio sale de la propia petición, así el sitemap es correcto tanto
// en el dominio de Vercel como en uno propio, sin configurar nada.
// ── v57 · /llms.txt ──────────────────────────────────────────
// Resumen en texto para buscadores con IA (ChatGPT, Perplexity, Gemini…), que casi no
// ejecutan JavaScript y por eso no ven el catálogo. Sale de los mismos datos que la tienda:
// formas de pago (Promociones y pagos), entrega, categorías y marcas con prendas disponibles.
async function llms(req, res) {
  const base = (process.env.SITE_URL || 'https://stiimpys.store').replace(/\/$/, '');
  let cats = [], marcas = [], total = 0, pagos = '', entrega = '';
  try {
    const db = await getDB();
    const deAqui = await filtroTienda(db);
    const prendas = (await db.collection('inventario').find({ vendido: { $ne: true }, oculto: { $ne: true } },
      { projection: { _id: 0, bazarId: 1, marca: 1, categorias: 1 } }).toArray()).filter(p => deAqui(p));
    total = prendas.length;
    const cuenta = lista => Object.entries(lista.reduce((m, k) => (k ? (m[k] = (m[k] || 0) + 1, m) : m), {})).sort((a, b) => b[1] - a[1]);
    cats = cuenta(prendas.flatMap(p => Array.isArray(p.categorias) ? p.categorias : [])).slice(0, 15);
    marcas = cuenta(prendas.map(p => String(p.marca || '').trim())).filter(([, n]) => n >= 2).slice(0, 20);
    const { leerConfigTienda, textoFormasPago } = await import('./_lib/crecer.js');
    const cfg = await leerConfigTienda(db, 1);
    pagos = textoFormasPago(cfg.formasPago);
    const puntos = (cfg.puntosEntrega || []).filter(x => x.activo !== false).map(x => x.nombre).filter(Boolean);
    entrega = puntos.length ? `Entrega en persona en Reynosa (${puntos.slice(0, 6).join(', ')})` : 'Entrega en persona en Reynosa';
  } catch (e) { console.error('[llms]', e); }
  const limpio = t => String(t).replace(/[\[\]()<>\n\r]/g, ' ').trim();
  const { slugDe } = await import('./_lib/paginas.js');
  const txt = [
    '# Stiimpys',
    '',
    '> Tienda oficial de Stiimpys en Reynosa, Tamaulipas (México): streetwear y ropa vintage de segunda mano. Cada prenda es una pieza única, revisada a mano y con fotos reales. Envíos a todo México.',
    '',
    `- Prendas disponibles ahora: ${total}. Cada una es única: cuando se vende, sale del catálogo.`,
    pagos ? `- Formas de pago: ${pagos.replace(/^Aceptamos /, '')}. Precios en pesos mexicanos (MXN).` : '- Precios en pesos mexicanos (MXN).',
    `- ${entrega} o envío a domicilio a todo México con guía rastreable.`,
    '- Las prendas se venden tal como se muestran: no hay cambios ni devoluciones (ver términos).',
    '- Contacto: Instagram @stiimpys y WhatsApp (link en la página).',
    '',
    '## Páginas',
    `- [Inicio](${base}/): presentación de la tienda, lo más nuevo y preguntas frecuentes`,
    `- [Catálogo](${base}/tienda.html): todas las prendas disponibles, con filtros por categoría, marca, talla y precio`,
    `- [Ficha de una prenda](${base}/prenda.html?id=1): fotos, talla, estado, medidas y precio (link corto: ${base.replace(/^https?:\/\//, '')}/p/ID)`,
    `- [Términos y condiciones](${base}/terminos.html): compras, pagos, envíos, apartados y privacidad`,
    ...(cats.length ? ['', '## Categorías con prendas disponibles', ...cats.map(([c, n]) => `- [${limpio(c)}](${base}/categoria/${slugDe(c)}): ${n} prenda${n === 1 ? '' : 's'}`)] : []),
    ...(marcas.length ? ['', '## Marcas con varias prendas', ...marcas.map(([m, n]) => `- [${limpio(m)}](${base}/marca/${slugDe(m)}): ${n} prendas`)] : []),
    '',
    '## Opcional',
    `- [Mapa del sitio](${base}/sitemap.xml)`,
    '- [Instagram @stiimpys](https://www.instagram.com/stiimpys)',
    '',
  ].join('\n');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(txt);
}

async function sitemap(req, res) {
  const base = (process.env.SITE_URL || 'https://stiimpys.store').replace(/\/$/, '');
  // v57: "/" sirve la portada directamente (sin redirección) y es su dirección canónica
  // v39 · Sin "Vende con nosotros" ni "Los bazares": la página es solo de Stiimpys
  const fijas = ['/tienda.html', '/terminos.html'];   // v41: redes.html y vender.html se archivaron

  let prendas = [], bazares = [];
  try {
    const db = await getDB();
    [prendas, bazares] = await Promise.all([
      // Solo lo que hace falta para el mapa: id y fecha de alta
      db.collection('inventario')
        .find({ vendido: { $ne: true }, oculto: { $ne: true } }, { projection: { id: 1, bazarId: 1, creadoEn: 1, createdAt: 1, marca: 1, categorias: 1, categoria: 1, talla: 1, precio_venta: 1, _id: 0 } })
        .sort({ _id: -1 }).limit(5000).toArray(),
      db.collection('bazares')
        .find({ activo: { $ne: false } }, { projection: { slug: 1, _id: 0 } }).toArray(),
    ]);
    const deAqui = await filtroTienda(db);
    prendas = prendas.filter(p => deAqui(p));
    if (!multiBazar()) bazares = [];
  } catch (err) {
    console.error('[sitemap]', err);
  }

  let extra = [];
  try { extra = await entradasSitemap(await getDB(), prendas); } catch (err) { console.error('[sitemap extra]', err); }
  const url = (ruta, prioridad, fecha) =>
    `  <url>\n    <loc>${escHtml(base + ruta)}</loc>\n` +
    (fecha ? `    <lastmod>${escHtml(String(fecha).slice(0, 10))}</lastmod>\n` : '') +
    `    <priority>${prioridad}</priority>\n  </url>`;

  const cuerpo = [
    url('/', '1.0'),   // v57: la portada es la raíz (canónica); /inicio.html apunta aquí
    ...fijas.map(r => url(r, '0.8')),
    ...bazares.map(b => url(`/tienda.html?bazar=${encodeURIComponent(b.slug)}`, '0.7')),
    // v42/v43: marca, categoría, talla, precio y guías (según los módulos prendidos)
    ...extra.map(r => url(r, '0.7')),
    ...prendas.map(p => url(`/prenda.html?id=${p.id}`, '0.6', p.creadoEn || p.createdAt)),
  ].join('\n');

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${cuerpo}\n</urlset>\n`
  );
}

// v40 · Todas las funciones pasan primero por el escudo (ver api/_lib/escudo.js)
export default conEscudo(handler);
