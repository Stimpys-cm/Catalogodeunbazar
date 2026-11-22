const { fake } = await import('./.tmp/api/_lib/db.js');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const mk = () => ({ code: 200, body: null, h: {}, status(c) { this.code = c; return this; }, json(j) { this.body = j; return this; }, end() { return this; }, send(x) { this.body = x; return this; }, setHeader(k, v) { this.h[k] = v; } });
fake.usuarios = [{ id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA' }, { id: 2, username: 'b2', role: 'admin', bazarId: 2, sessionToken: 'T2' }];
fake.bazares = [{ id: 1, nombre: 'Stiimpys', permisos: {} }, { id: 2, nombre: 'Otro', permisos: { crearPrendas: true, editarPrendas: true, borrarPrendas: true } }];
fake.inventario = [{ id: 1, bazarId: 1, nombre: 'Playera', precio_venta: 300, vendido: true, vendidoA: 'Ana López Ruiz', costo: 100 },
  { id: 2, bazarId: 1, nombre: 'Oculta', precio_venta: 1, oculto: true }];
const item = (await import('./.tmp/api/inventario-item.js')).default;
let r = mk();
await item({ method: 'POST', headers: { authorization: 'Bearer TA' }, query: {}, body: { nombre: 'Gorra <img src=x onerror=alert(1)>', marca: '"><script>', precio_venta: '250', imagenes: ['https://res.cloudinary.com/a.jpg', 'javascript:alert(1)', 'https://x" onerror="y'], categorias: 'Gorras', vendido: 'no', hackeo: 1 } }, r);
const g = r.body.prenda;
ok(r.code === 201 && !/[<>]/.test(g.nombre + g.marca), 'nombre/marca sin etiquetas: ' + JSON.stringify([g.nombre, g.marca]));
ok(g.precio_venta === 250 && g.imagenes.length === 1 && Array.isArray(g.categorias) && g.vendido === false && !('hackeo' in g), 'tipos correctos y fotos inválidas descartadas');
// PUT: otro bazar no puede reemplazar la prenda 1
const inv = (await import('./.tmp/api/inventario.js')).default;
r = mk(); await inv({ method: 'PUT', headers: { authorization: 'Bearer T2' }, query: {}, body: { list: [{ id: 1, nombre: 'Robada' }] } }, r);
ok(r.code === 403 && fake.inventario.find(p => p.id === 1).nombre === 'Playera', 'un bazar no puede reemplazar prendas de otro con PUT');
// Público
r = mk(); await inv({ method: 'GET', headers: {}, query: {} }, r);
const pub = r.body.find(p => p.id === 1);
ok(!r.body.some(p => p.oculto) && pub.vendidoA === 'Ana L.' && !('costo' in pub), 'público: sin ocultas, sin costo y "Vendido a" con nombre corto (' + pub.vendidoA + ')');
const sync = (await import('./.tmp/api/sync.js')).default;
r = mk(); await sync({ method: 'GET', headers: {}, query: {} }, r);
ok(r.h['Cache-Control'] === 'private, no-store', 'sync sin sesión y sin scope no se guarda en el CDN');
r = mk(); global._syncCache = null; await sync({ method: 'GET', headers: { authorization: 'Bearer TA' }, query: {} }, r);
ok(r.h['Cache-Control'].startsWith('private'), 'sync del panel es private: ' + r.h['Cache-Control']);
r = mk(); await sync({ method: 'GET', headers: {}, query: { scope: 'publico' } }, r);
ok(JSON.parse(r.body).inventario.every(p => !p.oculto), 'sync público sin prendas ocultas');
// Ficha para robots
const prenda = (await import('./.tmp/api/prenda.js')).default;
r = mk(); await prenda({ method: 'GET', headers: { host: 'evil.com' }, query: { id: '1', vista: 'bot' } }, r);
ok(r.code === 200 && !r.body.includes('location.replace') && r.body.includes('https://stiimpys.store/prenda.html?id=1') && !r.body.includes('evil.com'), 'vista de robot: sin redirección y con el dominio real');
r = mk(); await prenda({ method: 'GET', headers: { host: 'x' }, query: { id: '2' } }, r);
ok(r.code === 302, 'prenda oculta no genera preview');
r = mk(); await prenda({ method: 'GET', headers: { host: 'x' }, query: { sitemap: '1' } }, r);
ok(!r.body.includes('id=2') && r.body.includes('<loc>https://stiimpys.store/</loc>'), 'sitemap sin ocultas y con la portada (desde la v57 en la raíz)');
// Salir invalida el token
const auth = (await import('./.tmp/api/auth.js')).default;
r = mk(); await auth({ method: 'DELETE', headers: { authorization: 'Bearer TA' }, query: {} }, r);
ok(!fake.usuarios.find(u => u.id === 1).sessionToken, 'cerrar sesión invalida el token en el servidor');
