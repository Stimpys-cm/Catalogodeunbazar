// Pruebas v57: SEO (auditoría de SEOptimer del 20 nov 2026) y barrido de errores.
// - "/" ya no redirige: se sirve la portada directo (antes 302 → /inicio.html, ~1 s más en celular).
// - Portada canónica en la raíz; sitemap con "/" en lugar de /inicio.html; migas con la raíz.
// - Título ≤ 60 y descripción 120–160 en inicio, catálogo y términos.
// - /llms.txt con los mismos datos que la tienda (formas de pago, entrega, categorías y marcas disponibles).
process.env.SESSION_SECRET = 'secreto-de-prueba-v57';
for (const k of ['MULTI_BAZAR', 'BAZAR_PRINCIPAL']) delete process.env[k];
const fs = await import('node:fs');
const { fake } = await import('./.tmp/api/_lib/db.js');
const prendaApi = (await import('./.tmp/api/prenda.js')).default;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);
const mk = () => ({ statusCode: 200, body: undefined, h: {}, status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; return this; },
  send(x) { this.body = x; return this; }, end(x) { if (x !== undefined) this.body = x; return this; }, setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; } });
const llamar = async query => { const res = mk(); await prendaApi({ method: 'GET', query, url: '/api/prenda', headers: { host: 'stiimpys.store', 'x-real-ip': '10.57.0.1' } }, res); return res; };
const leer = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

grupo('Portada sin redirección');
const v = JSON.parse(leer('vercel.json'));
ok(!(v.redirects || []).some(r => r.source === '/'), 'ya no hay redirección de "/" a /inicio.html');
ok(v.rewrites[0].source === '/' && v.rewrites[0].destination === '/inicio.html', '"/" muestra la portada directamente');
ok(v.rewrites.some(r => r.source === '/llms.txt' && r.destination === '/api/prenda?llms=1'), '/llms.txt sale de la API');
const inicio = leer('inicio.html');
ok(inicio.includes('<link rel="canonical" href="https://stiimpys.store/">') && inicio.includes('<meta property="og:url" content="https://stiimpys.store/">'), 'canónica y og:url en la raíz');
ok(!leer('middleware.js').match(/ARCHIVOS_PRIVADOS = [^\n]*llms/), 'el middleware no bloquea /llms.txt');

grupo('Título y descripción');
const meta = f => { const s = leer(f); return { t: (s.match(/<title>([^<]*)<\/title>/) || [])[1] || '', d: (s.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '' }; };
for (const f of ['inicio.html', 'tienda.html', 'terminos.html']) {
  const { t, d } = meta(f);
  ok(t.length <= 60 && t.length >= 30, `${f}: título de ${t.length} letras (≤ 60): "${t}"`);
  ok(d.length >= 120 && d.length <= 160, `${f}: descripción de ${d.length} letras (120–160)`);
}
ok(/streetwear/i.test(meta('inicio.html').t) && /ropa vintage/i.test(meta('inicio.html').t) && /Reynosa/.test(meta('inicio.html').t), 'el título de la portada lleva las palabras clave (streetwear, ropa vintage, Reynosa)');
ok(/<h1 id="heroTitulo">[\s\S]*Streetwear/i.test(inicio), 'el H1 también');

grupo('Sitemap');
fake.bazares = [{ id: 1, nombre: 'Stiimpys', slug: 'stiimpys' }];
fake.inventario = [
  { id: 1, bazarId: 1, nombre: 'Playera Nike', marca: 'Nike', categorias: ['Playeras'], precio_venta: 200, creadoEn: '2026-11-01' },
  { id: 2, bazarId: 1, nombre: 'Sudadera Nike', marca: 'Nike', categorias: ['Sudaderas'], precio_venta: 400, creadoEn: '2026-11-02' },
  { id: 3, bazarId: 1, nombre: 'Gorra', marca: 'New Era', categorias: ['Gorras'], precio_venta: 150, vendido: true },
  { id: 4, bazarId: 1, nombre: 'Playera Levi\'s', marca: "Levi's", categorias: ['Playeras'], precio_venta: 180 },
];
fake.tiendaConfig = [{ bazarId: 1, formasPago: { tarjeta: true, efectivo: true, transferencia: false }, puntosEntrega: [{ nombre: 'Zona Centro', costo: 0 }, { nombre: 'UTTN', costo: 0 }] }];
for (const k of ['drops', 'ajustes', 'actividad', 'sistema']) fake[k] = fake[k] || [];
let r = await llamar({ sitemap: '1' });
const xml = String(r.body);
ok(xml.includes('<loc>https://stiimpys.store/</loc>') && !xml.includes('/inicio.html</loc>'), 'el sitemap pone la portada en la raíz');

grupo('/llms.txt');
r = await llamar({ llms: '1' });
const t = String(r.body);
console.log(t.split('\n').slice(0, 14).map(l => '      │ ' + l).join('\n'));
ok(r.statusCode === 200 && /text\/plain/.test(r.h['content-type']), 'responde texto');
ok(t.startsWith('# Stiimpys\n\n> ') && t.includes('## Páginas'), 'con el formato de llms.txt (título, resumen y secciones)');
ok(t.includes('Prendas disponibles ahora: 3.'), 'cuenta solo las disponibles (3)');
ok(t.includes('Formas de pago: tarjeta y efectivo.'), 'formas de pago = las de Promociones y pagos');
ok(t.includes('Entrega en persona en Reynosa (Zona Centro, UTTN)'), 'puntos de entrega de la configuración');
ok(t.includes('- [Playeras](https://stiimpys.store/categoria/playeras): 2 prendas') && t.includes('- [Nike](https://stiimpys.store/marca/nike): 2 prendas'), 'categorías y marcas con prendas, con su página');
ok(!t.includes('New Era') && !t.includes('Levi'), 'sin marcas vendidas ni marcas de una sola prenda');
ok(!/wa\.me|\d{10}/.test(t), 'sin teléfono ni WhatsApp');
