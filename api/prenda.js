// api/prenda.js
// GET /api/prenda?id=X
// Devuelve HTML con Open Graph meta tags de la prenda específica
// WhatsApp/Discord/Twitter leen este HTML para generar el preview
// El usuario es redirigido automáticamente a la tienda

import { getDB } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

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

    const imgs  = Array.isArray(item.imagenes) ? item.imagenes : [];
    const img   = imgs[0] || '';
    const title = `${item.nombre}${item.marca ? ' · ' + item.marca : ''} | Bazar En Linea`;
    const desc  = [
      `$${item.precio_venta} MXN`,
      item.talla  ? `Talla ${item.talla}`  : '',
      item.estado ? item.estado            : '',
      'Contacta por WhatsApp para apartar'
    ].filter(Boolean).join(' · ');

    const tiendaUrl = `https://${req.headers.host}/tienda.html?id=${id}`;

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${escHtml(title)}</title>

  <!-- Open Graph — WhatsApp, Facebook, Discord, iMessage -->
  <meta property="og:type"        content="product">
  <meta property="og:site_name"   content="Bazar En Linea">
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

function escJs(str) {
  return String(str).replace(/"/g, '\\"').replace(/\//g, '\\/');
}
