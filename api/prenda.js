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

import { getDB } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.query.sitemap === '1') return sitemap(req, res);

  const id = parseInt(req.query.id);

  // Si no hay id, redirigir a la tienda directamente
  if (!id) {
    res.setHeader('Location', '/tienda.html');
    return res.status(302).end();
  }

  try {
    const db   = await getDB();
    const col  = db.collection('inventario');
    const item = await col.findOne({ id });

    // Si no existe la prenda, redirigir a la tienda
    if (!item) {
      res.setHeader('Location', '/tienda.html');
      return res.status(302).end();
    }

    // Bazar dueño de la prenda (para el nombre en el preview)
    let bazar = null;
    try {
      bazar = await db.collection('bazares').findOne({ id: Number(item.bazarId || 1) });
    } catch (_) {}
    const sitio = bazar?.nombre ? `${bazar.nombre} · STMP MARKET` : 'STMP MARKET';

    const imgs  = Array.isArray(item.imagenes) ? item.imagenes : [];
    const img   = imgs[0] || '';
    const title = `${item.nombre}${item.marca ? ' · ' + item.marca : ''} | ${sitio}`;
    const desc  = [
      `$${item.precio_venta} MXN`,
      item.talla  ? `Talla ${item.talla}`  : '',
      item.estado ? item.estado            : '',
      'Contacta por WhatsApp para apartar'
    ].filter(Boolean).join(' · ');

    const tiendaUrl = `https://${req.headers.host}/prenda.html?id=${id}`;

    // Datos estructurados: es lo que permite que Google muestre la prenda
    // con foto, precio y disponibilidad en vez de un enlace azul.
    const datos = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: item.nombre,
      image: imgs.length ? imgs : undefined,
      description: item.descripcion || desc,
      brand: item.marca ? { '@type': 'Brand', name: item.marca } : undefined,
      size: item.talla || undefined,
      itemCondition: /nuev/i.test(String(item.estado || ''))
        ? 'https://schema.org/NewCondition'
        : 'https://schema.org/UsedCondition',
      offers: {
        '@type': 'Offer',
        price: Number(item.precio_venta) || 0,
        priceCurrency: 'MXN',
        availability: item.vendido
          ? 'https://schema.org/SoldOut'
          : 'https://schema.org/InStock',
        url: tiendaUrl,
        seller: { '@type': 'Organization', name: bazar?.nombre || 'STMP MARKET' },
      },
    };

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${escHtml(title)}</title>

  <!-- Open Graph — WhatsApp, Facebook, Discord, iMessage -->
  <meta property="og:type"        content="product">
  <meta property="og:site_name"   content="${escHtml(sitio)}">
  <meta property="og:title"       content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(desc)}">
  <meta property="og:url"         content="${escHtml(tiendaUrl)}">
  ${img ? `<meta property="og:image"       content="${escHtml(img)}">
  <meta property="og:image:width"  content="1080">
  <meta property="og:image:height" content="1350">` : ''}

  <!-- Twitter Card -->
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="${escHtml(title)}">
  <meta name="twitter:description" content="${escHtml(desc)}">
  ${img ? `<meta name="twitter:image" content="${escHtml(img)}">` : ''}

  <script type="application/ld+json">${escJson(datos)}</script>

  <!-- Redirigir al usuario a la tienda -->
  <meta http-equiv="refresh" content="0;url=${escHtml(tiendaUrl)}">
  <link rel="canonical" href="${escHtml(tiendaUrl)}">
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

// ── Mapa del sitio ───────────────────────────────────────────
// El dominio sale de la propia petición, así el sitemap es correcto tanto
// en el dominio de Vercel como en uno propio, sin configurar nada.
async function sitemap(req, res) {
  const base = `https://${req.headers.host}`;
  const fijas = ['/inicio.html', '/tienda.html', '/redes.html', '/terminos.html'];

  let prendas = [], bazares = [];
  try {
    const db = await getDB();
    [prendas, bazares] = await Promise.all([
      // Solo lo que hace falta para el mapa: id y fecha de alta
      db.collection('inventario')
        .find({ vendido: { $ne: true } }, { projection: { id: 1, creadoEn: 1, createdAt: 1, _id: 0 } })
        .sort({ _id: -1 }).limit(5000).toArray(),
      db.collection('bazares')
        .find({ activo: { $ne: false } }, { projection: { slug: 1, _id: 0 } }).toArray(),
    ]);
  } catch (err) {
    console.error('[sitemap]', err);
  }

  const url = (ruta, prioridad, fecha) =>
    `  <url>\n    <loc>${escHtml(base + ruta)}</loc>\n` +
    (fecha ? `    <lastmod>${escHtml(String(fecha).slice(0, 10))}</lastmod>\n` : '') +
    `    <priority>${prioridad}</priority>\n  </url>`;

  const cuerpo = [
    url('/', '1.0'),
    ...fijas.map(r => url(r, '0.8')),
    ...bazares.map(b => url(`/tienda.html?bazar=${encodeURIComponent(b.slug)}`, '0.7')),
    ...prendas.map(p => url(`/prenda.html?id=${p.id}`, '0.6', p.creadoEn || p.createdAt)),
  ].join('\n');

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${cuerpo}\n</urlset>\n`
  );
}
