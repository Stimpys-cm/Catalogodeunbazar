// Pruebas v39: la página es solo de Stiimpys (sin otros bazares en lo público)
// (base en memoria; nada toca servicios reales)
process.env.CLIP_API_KEY = 'k'; process.env.CLIP_SECRET_KEY = 's';
delete process.env.MULTI_BAZAR; delete process.env.BAZAR_PRINCIPAL;

const { fake } = await import('./.tmp/api/_lib/db.js');
const acciones = (await import('./.tmp/api/acciones.js')).default;
const syncApi = (await import('./.tmp/api/sync.js')).default;
const prendaApi = (await import('./.tmp/api/prenda.js')).default;
const { idPrincipal } = await import('./.tmp/api/_lib/bazar.js');
const mw = (await import('../middleware.js')).default;

globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  const J = (j, st = 200) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j) });
  if (url.includes('payclip.com/v2/checkout') && o.method === 'POST') return J({ payment_request_id: 'pr_1', payment_request_url: 'https://clip/pr_1' });
  return J({}, 404);
};
const mk = () => ({ statusCode: 200, body: undefined, h: {}, headersSent: false, writableEnded: false,
  status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; this.headersSent = this.writableEnded = true; return this; },
  send(x) { this.body = x; this.headersSent = this.writableEnded = true; return this; }, end(x) { if (x !== undefined) this.body = x; this.headersSent = this.writableEnded = true; return this; },
  setHeader(k, v) { this.h[k.toLowerCase()] = v; } });
let ipN = 0;
const pedir = async (fn, { method = 'POST', query = {}, body, token } = {}) => {
  const res = mk();
  await fn({ method, query, body, url: '/api/x', headers: { 'x-real-ip': '10.9.0.' + (++ipN % 250), host: 'stiimpys.store', ...(token ? { authorization: 'Bearer ' + token } : {}) } }, res);
  return { code: res.statusCode, body: res.body, h: res.h };
};
const op = (o, args = {}) => pedir(acciones, { ...args, query: { op: o, ...(args.query || {}) } });
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);
const json = x => typeof x === 'string' ? JSON.parse(x) : x;
const publico = async () => { global._syncCachePub = null; global._syncCachePubTime = 0;
  const r = await pedir(syncApi, { method: 'GET', query: { scope: 'publico' } }); return json(r.body)?.datos || json(r.body); };

fake.bazares = [{ id: 1, nombre: 'Stiimpys', whatsapp: '8990000000', slug: 'stiimpys', permisos: {} },
                { id: 2, nombre: 'Otro Bazar', whatsapp: '8991111111', slug: 'otro', permisos: {} }];
fake.usuarios = [{ id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA' }];
const prenda = (id, precio, extra = {}) => ({ id, bazarId: 1, nombre: `Prenda ${id}`, precio_venta: precio, talla: 'M', imagenes: ['https://x/' + id + '.jpg'], ...extra });
fake.inventario = [prenda(1, 300), prenda(2, 500), prenda(20, 200, { bazarId: 2, nombre: 'Gorra de otro bazar' })];
fake.tiendaConfig = [{ bazarId: 1 }, { bazarId: 2 }];
fake.resenas = [{ id: 'r1', tipo: 'bazar', bazarId: 1, texto: 'Bien', estrellas: 5, creadoEn: new Date() },
                { id: 'r2', tipo: 'bazar', bazarId: 2, texto: 'Otro', estrellas: 4, creadoEn: new Date() }];
fake.subastas = [{ prendaId: 2, bazarId: 1, precioInicial: 100, fin: new Date(Date.now() + 864e5).toISOString() },
                 { prendaId: 20, bazarId: 2, precioInicial: 50, fin: new Date(Date.now() + 864e5).toISOString() }];

// ═══════════════════════════════════════════════════════════
grupo('1 · Lo público solo trae a Stiimpys');
let d = await publico();
ok(d.inventario.map(p => p.id).join() === '1,2' || d.inventario.map(p => p.id).sort().join() === '1,2', `inventario público sin prendas de otros bazares (${d.inventario.map(p => p.id)})`);
ok(d.bazares.length === 1 && d.bazares[0].slug === 'stiimpys', 'bazares públicos: solo Stiimpys');
ok(d.resenas.every(r => r.bazarId === 1) && d.resenas.length === 1, 'reseñas públicas: solo las de Stiimpys');
ok(d.subastas.every(s => s.bazarId === 1) && d.subastas.length === 1, 'subastas públicas: solo las de Stiimpys');
ok(d.modo?.multiBazar === false && d.modo?.principal === 1, 'el paquete público dice que es una sola tienda');
const panel = json((await pedir(syncApi, { method: 'GET', query: {}, token: 'TA' })).body);
ok((panel.datos || panel).inventario.some(p => p.id === 20), 'el panel sigue viendo las prendas de los otros bazares (nada se borra)');

grupo('2 · No se puede cotizar, pagar, ofertar ni pedir aviso de prendas de otros bazares');
let r = await op('v-cotizar', { body: { ids: [20] } });
ok(r.code === 200 ? !(r.body.prendas || []).some(p => p.id === 20) : r.code >= 400, `cotizar la prenda de otro bazar no la incluye (${r.code})`);
r = await op('v-cotizar', { body: { ids: [1, 20] } });
ok(r.code === 200 && r.body.prendas.map(p => p.id).join() === '1' && r.body.bazar?.id === 1, 'cotizar Stiimpys + otra: solo cuenta la de Stiimpys');
r = await op('v-pagar', { body: { ids: [20], nombre: 'Ana López', telefono: '8991234567', punto: 'zona-centro', metodo: 'clip' } });
ok(r.code === 400 && /ya no existe/.test(r.body.error), `pagar la de otro bazar: rechazado (${r.code} ${r.body?.error})`);
ok(!fake.pedidos?.length, 'no se creó ningún pedido ni link de pago');
r = await op('v-oferta', { body: { prendaId: 20, monto: 150, nombre: 'Ana', telefono: '8991234567' } });
ok(r.code === 400, `ofertar por la de otro bazar: rechazado (${r.code})`);
r = await op('v-espera', { body: { tipo: 'prenda', prendaId: 20, nombre: 'Ana', telefono: '8991234567' } });
ok(r.code === 404, `"Avísame" de la de otro bazar: rechazado (${r.code})`);

grupo('3 · Ya no se reciben bazares nuevos');
const antes = (fake.solicitudes || []).length;
r = await op('solicitud-bazar', { body: { nombre: 'Luis', bazar: 'Mi bazar', whatsapp: '8991234567' } });
ok(r.code === 410 && /ya no está recibiendo/.test(r.body.error), `formulario "Vende con nosotros": cerrado (${r.code})`);
ok((fake.solicitudes || []).length === antes, 'no se guardó la solicitud');

grupo('4 · Ficha para robots y mapa del sitio');
r = await pedir(prendaApi, { method: 'GET', query: { id: '20' } });
ok(r.code === 302 && /tienda\.html/.test(r.h.location || ''), 'ficha de una prenda de otro bazar → tienda');
r = await pedir(prendaApi, { method: 'GET', query: { id: '1', vista: 'bot' } });
ok(r.code === 200 && /\| Stiimpys</.test(String(r.body)) && !/STMP MARKET/.test(String(r.body)), 'la ficha para WhatsApp/Google dice "Stiimpys"');
r = await pedir(prendaApi, { method: 'GET', query: { sitemap: '1' } });
const mapa = String(r.body);
ok(!/vender\.html|redes\.html|\?bazar=/.test(mapa) && /prenda\.html\?id=1/.test(mapa) && !/prenda\.html\?id=20/.test(mapa), 'sitemap sin "Vende con nosotros", "Los bazares" ni prendas de otros bazares');

grupo('5 · Quién es Stiimpys');
ok(idPrincipal([{ id: 5, slug: 'Stiimpys' }, { id: 1, slug: 'otro' }]) === 5, 'se reconoce por el @stiimpys aunque no sea el bazar 1');
ok(idPrincipal([{ id: 3, slug: 'x' }]) === 1, 'si no hay @stiimpys, el bazar 1');
process.env.BAZAR_PRINCIPAL = '7'; ok(idPrincipal([{ id: 5, slug: 'stiimpys' }]) === 7, 'BAZAR_PRINCIPAL manda si se define'); delete process.env.BAZAR_PRINCIPAL;

grupo('6 · Redirecciones al inicio');
for (const ruta of ['/redes.html', '/redes', '/vender.html', '/index.html']) {
  const x = await mw(new Request('https://stiimpys.store' + ruta, { headers: { 'user-agent': 'Mozilla/5.0' } }));
  ok(x?.status === 302 && x.headers.get('location') === 'https://stiimpys.store/inicio.html', `${ruta} → inicio`);
}
const t = await mw(new Request('https://stiimpys.store/tienda.html', { headers: { 'user-agent': 'Mozilla/5.0' } }));
ok(t === undefined, 'el catálogo pasa normal');

grupo('7 · MULTI_BAZAR=1 lo regresa como antes');
process.env.MULTI_BAZAR = '1';
d = await publico();
ok(d.inventario.some(p => p.id === 20) && d.bazares.length === 2 && d.modo.multiBazar === true, 'lo público vuelve a mostrar los demás bazares');
r = await op('solicitud-bazar', { body: { nombre: 'Luis', bazar: 'Mi bazar', whatsapp: '8991234567' } });
ok(r.code === 200 || r.code === 201, `el formulario vuelve a recibir solicitudes (${r.code})`);
// v41: redes.html y vender.html se archivaron (docs/archivo/multi-bazar), así que siempre van al inicio
const x = await mw(new Request('https://stiimpys.store/redes.html', { headers: { 'user-agent': 'Mozilla/5.0' } }));
ok(x?.status === 302, '"Los bazares" sigue llevando al inicio (la página está archivada desde la v41)');
delete process.env.MULTI_BAZAR;

console.log('\nRESULTADO v39 servidor');
