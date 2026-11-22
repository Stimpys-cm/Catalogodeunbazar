// Pruebas v40: seguridad (escudo de /api, fugas de datos, acaparar prendas, código del panel)
// (base en memoria; nada toca servicios reales)
process.env.CLIP_API_KEY = 'k'; process.env.CLIP_SECRET_KEY = 's';
process.env.SESSION_SECRET = 'secreto-de-prueba-v40';
delete process.env.MULTI_BAZAR; delete process.env.BAZAR_PRINCIPAL; delete process.env.RUTA_PANEL;

const { fake } = await import('./.tmp/api/_lib/db.js');
const acciones = (await import('./.tmp/api/acciones.js')).default;
const syncApi = (await import('./.tmp/api/sync.js')).default;
const configApi = (await import('./.tmp/api/config.js')).default;
const authApi = (await import('./.tmp/api/auth.js')).default;
const cuentaApi = (await import('./.tmp/api/cuenta.js')).default;
const { limpiar, esDeOtroSitio } = await import('./.tmp/api/_lib/escudo.js');
const { hashPassword, verifyPassword } = await import('./.tmp/api/_lib/password.js');
const { firmarAcceso } = await import('./.tmp/api/_lib/firma.js');
const mw = (await import('../middleware.js')).default;

let clip = 0;
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  const J = (j, st = 200) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j) });
  if (url.includes('payclip.com/v2/checkout') && o.method === 'POST') { clip++; return J({ payment_request_id: 'pr_' + clip, payment_request_url: 'https://clip/pr_' + clip }); }
  if (url.includes('payclip.com/v2/checkout/')) return J({ status: 'CHECKOUT_CREATED' });
  return J({}, 404);
};
const mk = () => ({ statusCode: 200, body: undefined, h: {}, headersSent: false, writableEnded: false,
  status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; this.headersSent = this.writableEnded = true; return this; },
  send(x) { this.body = x; this.headersSent = this.writableEnded = true; return this; }, end(x) { if (x !== undefined) this.body = x; this.headersSent = this.writableEnded = true; return this; },
  setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; } });
const pedir = async (fn, { method = 'POST', query = {}, body, token, ip = '10.40.0.1', headers = {} } = {}) => {
  const res = mk();
  await fn({ method, query, body, url: '/api/x', headers: { 'x-real-ip': ip, host: 'stiimpys.store', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers } }, res);
  return { code: res.statusCode, body: typeof res.body === 'string' ? (() => { try { return JSON.parse(res.body); } catch { return res.body; } })() : res.body, h: res.h };
};
const op = (o, args = {}) => pedir(acciones, { ...args, query: { op: o, ...(args.query || {}) } });
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);
const llaves = (o, out = new Set()) => { if (Array.isArray(o)) o.forEach(x => llaves(x, out)); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.add(k); llaves(v, out); } return out; };

fake.bazares = [{ id: 1, nombre: 'Stiimpys', whatsapp: '8990000000', slug: 'stiimpys', permisos: { crearPrendas: true },
  instagramConfig: { hashtags: '#x', automatico: { rebaja: true } }, autoDiario: '2026-11-18' }];
fake.usuarios = [
  { id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA', password: await hashPassword('Correcta#2026') },
  { id: 2, username: 'vende', role: 'vendedor', bazarId: 1, sessionToken: 'TV', password: await hashPassword('Otra#2026') },
];
const prenda = (id, precio) => ({ id, bazarId: 1, nombre: `Prenda ${id}`, precio_venta: precio, costo: 50, talla: 'M', imagenes: ['https://x/' + id + '.jpg'] });
fake.inventario = Array.from({ length: 12 }, (_, i) => prenda(i + 1, 200 + i * 10));
fake.tiendaConfig = [{ bazarId: 1, pagoEnLinea: true }];
fake.ventas = []; fake.pedidos = []; fake.pendientes = [];

// ═══════════════════════════════════════════════════════════
grupo('1 · Escudo: limpia lo que manda el navegador');
let l = limpiar({ username: { $ne: null }, a: 1, b: { $gt: '' , c: 2 }, ['__proto__']: { admin: true }, lista: [{ $where: 'x', ok: 1 }] });
ok(JSON.stringify(l) === '{"username":{},"a":1,"b":{"c":2},"lista":[{"ok":1}]}', `operadores de Mongo y __proto__ fuera (${JSON.stringify(l)})`);
ok(({}).admin === undefined, 'nadie se vuelve admin por contaminación de prototipos');
let hondo = {}; let x = hondo; for (let i = 0; i < 40; i++) { x.a = {}; x = x.a; }
let r = await pedir(acciones, { query: { op: 'v-cotizar' }, body: hondo });
ok(r.code === 400, `JSON anidado 40 niveles → 400 (${r.code})`);
r = await pedir(acciones, { method: 'TRACE', query: { op: 'logs' } });
ok(r.code === 405, `método raro (TRACE) → 405 (${r.code})`);
ok(r.h['x-content-type-options'] === 'nosniff' && /no-store/.test(r.h['cache-control'] || '') && r.h['x-frame-options'] === 'DENY', 'cabeceras seguras en las respuestas del API');

grupo('2 · Escrituras desde otro sitio (CSRF) se bloquean');
ok(esDeOtroSitio({ headers: { origin: 'https://malo.example', host: 'stiimpys.store' } }), 'Origin de otro dominio → otro sitio');
ok(!esDeOtroSitio({ headers: { origin: 'https://stiimpys.store', host: 'stiimpys.store' } }), 'Origin propio → pasa');
ok(!esDeOtroSitio({ headers: { origin: 'https://rama-x.vercel.app', host: 'rama-x.vercel.app' } }), 'vista previa de Vercel (mismo host) → pasa');
ok(esDeOtroSitio({ headers: { 'sec-fetch-site': 'cross-site', host: 'stiimpys.store' } }), 'Sec-Fetch-Site: cross-site → otro sitio');
r = await op('borrar-prenda', { body: { id: 3 }, token: 'TA', headers: { origin: 'https://malo.example' } });
ok(r.code === 403 && fake.inventario.some(p => p.id === 3), `borrar una prenda desde otra página con la sesión de la dueña → 403 y no se borra (${r.code})`);
r = await op('v-clip-webhook', { body: { payment_request_id: 'nada' }, headers: { origin: 'https://clip.mx' } });
ok(r.code === 200, `el aviso de Clip (servidor a servidor) sí pasa (${r.code})`);

grupo('3 · Inyección NoSQL en el acceso');
r = await pedir(authApi, { body: { username: { $ne: '' }, password: { $ne: '' } } });
ok(r.code === 400, `usuario/contraseña como objetos → 400, no entra (${r.code})`);
r = await pedir(authApi, { body: { username: 'jefa', password: 'mala' }, ip: '10.40.1.1' });
ok(r.code === 401, `contraseña mala → 401 (${r.code})`);
r = await pedir(cuentaApi, { query: { op: 'entrar' }, body: { email: { $ne: '' }, password: { $ne: '' } } });
ok(r.code >= 400 && r.code < 500, `cuenta de cliente con operadores → rechazo sin entrar (${r.code})`);
r = await op('v-mis-pedidos', { body: { pedidos: [{ id: { $ne: '' }, k: { $ne: '' } }] } });
ok(r.code === 200 && r.body.pedidos.length === 0, '"Mis pedidos" con operadores no devuelve pedidos ajenos');

grupo('4 · Adivinar la contraseña desde muchas conexiones');
let ultimo = 0;
for (let i = 0; i < 22; i++) ultimo = (await pedir(authApi, { body: { username: 'vende', password: 'x' + i }, ip: '10.41.' + i + '.1' })).code;
ok(ultimo === 429, `más de 20 intentos a la misma cuenta desde IPs distintas → 429 (${ultimo})`);

grupo('5 · Contraseñas');
ok(/^\$2[aby]\$/.test(await hashPassword('Hola#2026')), 'se guardan con bcrypt');
ok(await verifyPassword('vieja', 'vieja') && !(await verifyPassword('viej', 'vieja')), 'las viejas en texto plano se comparan en tiempo constante (y se cifran al entrar)');

grupo('6 · Lo público no trae datos internos');
global._syncCachePub = null; global._syncCachePubTime = 0;
r = await pedir(syncApi, { method: 'GET', query: { scope: 'publico' } });
let d = r.body?.datos || r.body;
const k = llaves({ ...d, tienda: undefined });   // (tienda trae el "costo" de los puntos de entrega, que es público)
ok(!['costo', 'password', 'sessionToken', 'reservedBy', 'instagramConfig', 'permisos', 'autoDiario', 'telefono', 'email', 'clave'].some(x => k.has(x)),
  `catálogo público sin costos, cuentas, apartados ni configuración interna (${['costo', 'instagramConfig', 'permisos'].filter(x => k.has(x))})`);
r = await pedir(configApi, { method: 'GET', query: { col: 'bazares' } });
ok(r.code === 200 && !llaves(r.body).has('permisos') && !llaves(r.body).has('instagramConfig') && !llaves(r.body).has('autoDiario'), 'ficha pública del bazar sin configuración interna');
r = await pedir(configApi, { method: 'GET', query: { col: 'bazares' }, token: 'TA' });
ok(r.code === 200 && llaves(r.body).has('permisos'), 'el panel sí la sigue viendo');
r = await pedir(configApi, { method: 'GET', query: { col: 'usuarios' } });
ok(r.code === 401, `lista de cuentas sin sesión → 401 (${r.code})`);
r = await op('estadisticas', { method: 'GET', token: 'TV' });
ok(r.code === 403, `ganancias (con costos) para un vendedor → 403 (${r.code})`);
r = await op('estadisticas', { method: 'GET', token: 'TA' });
ok(r.code === 200, `ganancias para la administradora → 200 (${r.code})`);

grupo('7 · Nadie puede acaparar la tienda abriendo pagos sin pagar');
const pagar = (ids, tel, ip) => op('v-pagar', { ip, body: { ids, nombre: 'Robot', telefono: tel, metodo: 'clip', entrega: 'persona', punto: 'zona-centro' } });
const codigos = [];
for (let i = 0; i < 4; i++) codigos.push((await pagar([i + 1], '8991230000', '10.42.0.' + i)).code);
ok(codigos.slice(0, 3).every(c => c === 200) && codigos[3] === 429, `mismo WhatsApp: 3 pagos abiertos y el 4.º se frena (${codigos})`);
const c2 = [];
for (let i = 0; i < 4; i++) c2.push((await pagar([i + 5], '81' + (10000000 + i), '10.43.0.9')).code);
ok(c2.slice(0, 3).every(c => c === 200) && c2[3] === 429, `misma conexión con WhatsApps distintos: el 4.º se frena (${c2})`);
ok(!fake.inventario.find(p => p.id === 8)?.apartada, 'la prenda del pago frenado no quedó apartada');
const ped = fake.pedidos.find(p => p.ipHash);
ok(ped && !/^10\./.test(ped.ipHash) && !JSON.stringify(ped).includes('10.43.0.9'), 'el pedido guarda una huella de la conexión, nunca la IP');

grupo('8 · Recibos y errores');
const unPedido = fake.pedidos[0];
r = await op('v-pedido', { method: 'GET', query: { id: unPedido.id } });
ok(r.code === 200 && !r.body.nombre && !r.body.telefono && !r.body.direccion, 'recibo sin la clave: ni nombre, ni teléfono, ni dirección');
r = await op('v-pedido', { method: 'GET', query: { id: unPedido.id, k: unPedido.clave } });
ok(r.code === 200 && r.body.nombre === 'Robot' && r.body.completo, 'con la clave del recibo sí se ve completo');
globalThis.fetch = async () => { throw new Error('ECONNRESET 10.0.0.5:443 api-key=sk_live_x'); };
r = await pagar([11], '8995550000', '10.44.0.1');
ok(r.code === 502 && !/sk_live|ECONNRESET|10\.0\.0\.5/.test(JSON.stringify(r.body)), `si Clip falla, el cliente no ve el detalle técnico (${JSON.stringify(r.body)})`);

grupo('9 · Código del panel y Estudio, ocultos sin sesión');
const pide = (ruta, cookie) => mw(new Request('https://stiimpys.store' + ruta, { headers: cookie ? { cookie } : {} }));
for (const ruta of ['/js/dist/admin.js', '/css/dist/admin.css', '/js/panel/admin.js', '/css/panel/admin.css', '/js/dist/admin.js.map', '/estudio.html', '/estudio'])
  ok((await pide(ruta))?.status === 404, `${ruta} sin sesión → 404`);
const acceso = 'acceso=' + firmarAcceso('jefa', 'admin');
ok((await pide('/js/dist/admin.js', acceso)) === undefined, 'con sesión del panel el código sí se descarga');
ok((await pide('/estudio.html', acceso)) === undefined, 'con sesión del panel el Estudio abre');
ok((await pide('/js/dist/inicio.js')) === undefined && (await pide('/css/dist/login.css')) === undefined && (await pide('/js/dist/tema.js')) === undefined,
  'lo de la tienda y del formulario de acceso se sigue descargando sin sesión');
ok((await pide('/js/dist/admin.js', 'acceso=jefa.9999999999999.a.firmafalsa'))?.status === 404, 'una cookie inventada no sirve');

grupo('10 · Archivos internos del proyecto no se sirven');
for (const ruta of ['/middleware.js', '/package.json', '/package-lock.json', '/vercel.json', '/README.md', '/.env', '/.git/config', '/.vercel/project.json', '/pruebas/servidor.mjs', '/herramientas/paquetes.json', '/docs/HISTORIAL-VERSIONES.txt'])
  ok((await pide(ruta))?.status === 404, `${ruta} → 404`);
ok((await pide('/inicio.html')) === undefined && (await pide('/robots.txt')) === undefined && (await pide('/')) === undefined, 'las páginas normales siguen pasando');
