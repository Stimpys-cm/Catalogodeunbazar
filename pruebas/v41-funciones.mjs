// Pruebas v41: costos solo para administradores, minutos del apartado, datos legales,
// avisos del carrito por correo, avisos a la dueña, guías de envia.com, "Hoy",
// buscador y freno para robots. (base en memoria; nada toca servicios reales)
process.env.CLIP_API_KEY = 'k'; process.env.CLIP_SECRET_KEY = 's';
process.env.SESSION_SECRET = 'secreto-de-prueba-v41';
process.env.ENVIA_TOKEN = 'tok-envia'; process.env.CRON_SECRET = 'cron-v41';
for (const k of ['MULTI_BAZAR', 'BAZAR_PRINCIPAL', 'RESEND_API_KEY', 'CORREO_DESDE', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'AVISOS_CORREO', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY']) delete process.env[k];

const { fake } = await import('./.tmp/api/_lib/db.js');
const acciones = (await import('./.tmp/api/acciones.js')).default;
const syncApi = (await import('./.tmp/api/sync.js')).default;
const invApi = (await import('./.tmp/api/inventario.js')).default;
const itemApi = (await import('./.tmp/api/inventario-item.js')).default;
const cuentaApi = (await import('./.tmp/api/cuenta.js')).default;
const { avisosCarrito, cambioPrenda, enlaceBaja, firmaBaja } = await import('./.tmp/api/_lib/carrito-avisos.js');
const { avisarDuena, avisarServicios } = await import('./.tmp/api/_lib/alertas.js');
const { hashPassword } = await import('./.tmp/api/_lib/password.js');

// ── fetch falso: Clip, envia.com, Resend, Telegram y Cloudflare ──
const salidas = { correos: [], telegram: [], envia: [], turnstile: [] };
let clip = 0, cloudflare = 'ok';
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  const J = (j, st = 200) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j) });
  if (url.includes('payclip.com/v2/checkout') && o.method === 'POST') { clip++; return J({ payment_request_id: 'pr_' + clip, payment_request_url: 'https://clip/pr_' + clip }); }
  if (url.includes('payclip.com/v2/checkout/')) return J({ status: 'CHECKOUT_CREATED' });
  if (url.includes('api.resend.com/emails')) { salidas.correos.push(JSON.parse(o.body)); return J({ id: 'em_' + salidas.correos.length }); }
  if (url.includes('api.telegram.org')) { salidas.telegram.push(JSON.parse(o.body || '{}')); return J({ ok: true }); }
  if (url.includes('/ship/generate/')) { const b = JSON.parse(o.body); salidas.envia.push(b);
    return J({ meta: 'generate', data: [{ carrier: b.shipment.carrier, service: b.shipment.service, trackingNumber: '7781 2345 6789', trackUrl: 'https://envia.com/rastreo?label=778123456789', label: 'https://s3.envia.com/etiqueta.pdf', totalPrice: 151.5, currency: 'MXN' }] }); }
  if (url.includes('turnstile/v0/siteverify')) { salidas.turnstile.push(String(o.body)); if (cloudflare === 'caido') throw new Error('ECONNRESET');
    return J({ success: String(o.body).includes('response=bueno') }); }
  return J({}, 404);
};
const mk = () => ({ statusCode: 200, body: undefined, h: {}, headersSent: false, writableEnded: false,
  status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; this.headersSent = this.writableEnded = true; return this; },
  send(x) { this.body = x; this.headersSent = this.writableEnded = true; return this; }, end(x) { if (x !== undefined) this.body = x; this.headersSent = this.writableEnded = true; return this; },
  setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; } });
let ipN = 0;
const pedir = async (fn, { method = 'POST', query = {}, body, token, headers = {} } = {}) => {
  const res = mk();
  await fn({ method, query, body, url: '/api/x', headers: { 'x-real-ip': '10.41.' + (ipN++ % 250) + '.1', host: 'stiimpys.store', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers } }, res);
  return { code: res.statusCode, body: typeof res.body === 'string' ? (() => { try { return JSON.parse(res.body); } catch { return res.body; } })() : res.body, h: res.h };
};
const op = (o, args = {}) => pedir(acciones, { ...args, query: { op: o, ...(args.query || {}) } });
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);
const sinCache = () => { global._syncCache = null; global._syncCacheTime = 0; global._syncCachePub = null; global._syncCachePubTime = 0; };

fake.bazares = [{ id: 1, nombre: 'Stiimpys', whatsapp: '8990000000', slug: 'stiimpys' }];
fake.usuarios = [
  { id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA', password: await hashPassword('x') },
  { id: 2, username: 'vende', role: 'vendedor', bazarId: 1, sessionToken: 'TV', password: await hashPassword('y') },
];
const prenda = (id, precio, extra = {}) => ({ id, bazarId: 1, nombre: `Sudadera ${id}`, marca: id === 3 ? 'Carhartt' : 'Nike', precio_venta: precio, costo: 100 + id, talla: 'M', imagenes: ['https://x/' + id + '.jpg'], creadoEn: new Date().toISOString(), ...extra });
fake.inventario = Array.from({ length: 10 }, (_, i) => prenda(i + 1, 300 + i * 10));
fake.tiendaConfig = [{ bazarId: 1, pagoEnLinea: true, minutosPago: 17,
  legal: { nombre: 'Ana López', domicilio: 'Calle 1 #2, Centro, Reynosa, Tamps. 88500', telefono: '899 123 4567', correo: 'hola@stiimpys.store', horario: '' },
  envia: { activo: true, origen: { nombre: 'Stiimpys', telefono: '8991234567', calle: 'Calle 1', numero: '2', colonia: 'Centro', cp: '88500' } } }];
fake.ventas = [{ id: 1, bazarId: 1, prendaId: 9, precio: 380, costo: 109, fecha: new Date().toISOString(), canal: 'panel', prenda: { nombre: 'Sudadera 9' } }];
fake.pedidos = []; fake.pendientes = []; fake.ofertas = []; fake.listaEspera = []; fake.clientes = []; fake.sistema = []; fake.actividad = [];
fake.codigosPostales = [
  { cp: '88500', ciudad: 'Reynosa', estado: 'Tamaulipas', estadoCodigo: 'TM', colonias: ['Centro'], en: new Date().toISOString() },
  { cp: '64000', ciudad: 'Monterrey', estado: 'Nuevo León', estadoCodigo: 'NL', colonias: ['Centro'], en: new Date().toISOString() },
];

// ═══════════════════════════════════════════════════════════
grupo('1 · Costos y ganancias solo para administradores');
sinCache();
let r = await pedir(syncApi, { method: 'GET', token: 'TV' });
let inv = (r.body?.datos || r.body).inventario;
ok(inv.length && inv.every(p => !('costo' in p)), 'el panel de un vendedor llega sin costos');
sinCache();
r = await pedir(syncApi, { method: 'GET', token: 'TA' });
ok((r.body?.datos || r.body).inventario.every(p => 'costo' in p), 'la administradora sí ve los costos');
r = await pedir(invApi, { method: 'GET', token: 'TV' });
ok(r.body.every(p => !('costo' in p)), 'GET /api/inventario con sesión de vendedor: sin costos');
r = await pedir(itemApi, { method: 'PATCH', query: { id: '2' }, body: { nombre: 'Sudadera dos', costo: 1 }, token: 'TV' });
ok(r.code === 200 && fake.inventario.find(p => p.id === 2).costo === 102 && fake.inventario.find(p => p.id === 2).nombre === 'Sudadera dos', `un vendedor edita la prenda pero no le cambia el costo (${r.code})`);
const lista = fake.inventario.map(({ costo, ...p }) => p);
r = await pedir(invApi, { method: 'PUT', body: { list: lista }, token: 'TV' });
ok(r.code === 200 && fake.inventario.every(p => p.costo === 100 + p.id), `guardar la lista desde un vendedor no borra los costos (${r.code})`);
r = await op('v-corte', { method: 'GET', token: 'TV' });
ok(r.code === 200 && r.body.ganancia === undefined && r.body.costo === undefined && r.body.ventas.every(v => v.costo === undefined), 'corte de caja del vendedor: sin ganancia ni costo');
r = await op('v-corte', { method: 'GET', token: 'TA' });
ok(r.code === 200 && r.body.ganancia === 380 - 109, `corte de la administradora con ganancia (${r.body.ganancia})`);

grupo('2 · Minutos del apartado y datos del vendedor (ley)');
r = await op('v-pagar', { body: { ids: [1], nombre: 'Lupita Ruiz', telefono: '8991110001', metodo: 'clip', entrega: 'persona', punto: 'zona-centro' } });
const ped1 = fake.pedidos.find(p => p.id === r.body?.pedido);
const mins = ped1 ? (new Date(ped1.expira) - new Date(ped1.en)) / 60000 : 0;
ok(r.code === 200 && mins > 16.5 && mins < 17.5, `con 17 minutos configurados, el apartado dura 17 (${mins.toFixed(1)})`);
r = await op('v-config', { body: { minutosPago: 99, legal: { domicilio: '<b>x</b> Calle 9' } }, token: 'TA' });
ok(r.code === 200 && r.body.config.minutosPago === 30 && !/[<>]/.test(r.body.config.legal.domicilio), `minutos con tope de 30 y datos legales limpios (${r.body?.config?.minutosPago})`);
await op('v-config', { body: { minutosPago: 17, legal: { nombre: 'Ana López', domicilio: 'Calle 1 #2, Centro, Reynosa', telefono: '899 123 4567', correo: 'hola@stiimpys.store' } }, token: 'TA' });
sinCache();
r = await pedir(syncApi, { method: 'GET', query: { scope: 'publico' } });
const t1 = (r.body?.datos || r.body).tienda.porBazar['1'];
ok(t1.minutosPago === 17 && t1.legal.domicilio && t1.legal.telefono && !('horario' in t1.legal), 'la tienda recibe los minutos y solo los datos legales que sí se llenaron');
r = await op('v-config', { body: { minutosPago: 10 }, token: 'TV' });
ok(r.code === 403, `un vendedor no cambia la configuración (${r.code})`);

grupo('3 · Avisos del carrito por correo');
ok(cambioPrenda({ precio: 400, vendido: false, apartada: false }, { precio: 350, vendido: false, apartada: false }) === 'bajo', 'detecta "bajó de precio"');
ok(cambioPrenda({ precio: 400, vendido: false, apartada: true }, { precio: 400, vendido: false, apartada: false }) === 'libre', 'detecta "se liberó"');
ok(cambioPrenda({ precio: 400, vendido: false, apartada: false }, { precio: 400, vendido: true, apartada: false }) === 'vendida', 'detecta "se vendió"');
ok(cambioPrenda(null, { precio: 1, vendido: false, apartada: false }) === null && cambioPrenda({ precio: 400 }, { precio: 450, vendido: false, apartada: false }) === null, 'la primera vez y las subidas de precio no avisan');
fake.clientes = [
  { id: 7, nombre: 'Karla Soto', email: 'karla@correo.mx', wishlist: ['3', '4', '5'] },
  { id: 8, nombre: 'Beto', email: 'beto@correo.mx', wishlist: ['3'], avisosCarrito: false },
];
const db = await (await import('./.tmp/api/_lib/db.js')).getDB();
let a = await avisosCarrito(db);
ok(a.sinCorreo === true && !fake.clientes[0].carritoVisto, 'sin Resend configurado no hace nada (los cambios quedan para después)');
process.env.RESEND_API_KEY = 're_x'; process.env.CORREO_DESDE = 'Stiimpys <hola@stiimpys.store>';
a = await avisosCarrito(db);
ok(a.enviados === 0 && fake.clientes[0].carritoVisto?.['3'], 'la primera revisión solo anota cómo están (sin correo)');
fake.inventario.find(p => p.id === 3).precio_venta = 250;
fake.inventario.find(p => p.id === 4).vendido = true;
a = await avisosCarrito(db);
const c1 = salidas.correos.at(-1);
ok(a.enviados === 1 && JSON.stringify(c1 || {}).includes('karla@correo.mx'), `un solo correo a Karla con los cambios (${a.enviados})`);
ok(/bajó de precio/i.test(c1?.html || '') && /ya se vendió/i.test(c1?.html || '') && (c1?.html || '').includes('op=avisos-baja') && (c1?.html || '').includes(firmaBaja(7)), 'el correo dice qué bajó, qué se vendió y trae el enlace para darse de baja');
ok(!salidas.correos.some(c => JSON.stringify(c).includes('beto@correo.mx')), 'a quien apagó los avisos no le llega nada');
a = await avisosCarrito(db);
ok(a.enviados === 0, 'no se repite el mismo aviso al día siguiente');
r = await pedir(cuentaApi, { method: 'GET', query: { op: 'avisos-baja', c: '7', t: 'firmafalsa' + 'x'.repeat(22) } });
ok(r.code === 302 && fake.clientes[0].avisosCarrito !== false, 'un enlace de baja falso no apaga nada');
r = await pedir(cuentaApi, { method: 'GET', query: { op: 'avisos-baja', c: '7', t: firmaBaja(7) } });
ok(r.code === 302 && fake.clientes[0].avisosCarrito === false && /cuenta\.html\?avisos=apagados/.test(r.h.location), 'el enlace del correo apaga los avisos y lleva a Mi cuenta');

grupo('4 · Avisos a la dueña (Telegram / correo)');
let x = await avisarDuena(db, { clave: 'prueba', titulo: 'Algo', texto: 'pasó' });
ok(x.sinConfigurar, 'sin canales configurados no intenta nada');
process.env.TELEGRAM_BOT_TOKEN = '123:abc'; process.env.TELEGRAM_CHAT_ID = '555';
x = await avisarDuena(db, { clave: 'prueba', titulo: 'Clip falla', texto: 'detalle' });
ok(x.ok && salidas.telegram.at(-1)?.chat_id === '555' && /Clip falla/.test(salidas.telegram.at(-1)?.text), 'llega a Telegram');
const nTg = salidas.telegram.length;
x = await avisarDuena(db, { clave: 'prueba', titulo: 'Clip falla', texto: 'detalle' });
ok(x.repetido && salidas.telegram.length === nTg, 'el mismo aviso no se repite antes de 3 horas');
await avisarServicios(db, [{ id: 'clip', nombre: 'Clip', estado: 'no disponible', detalle: 'rechazó credenciales' }]);
await avisarServicios(db, [{ id: 'clip', nombre: 'Clip', estado: 'operativo', detalle: 'ok' }]);
ok(salidas.telegram.slice(nTg).some(m => /no disponible/.test(m.text)) && salidas.telegram.slice(nTg).some(m => /ya funciona/.test(m.text)), 'avisa cuando un servicio se cae y cuando vuelve');
process.env.AVISOS_CORREO = 'duena@correo.mx';
fake.inventario.find(p => p.id === 9).nombre = 'x';
const antesCorreos = salidas.correos.length;
globalThis.fetch = (f => async (url, o) => String(url).includes('payclip.com/v2/checkout') && o?.method === 'POST' ? { ok: false, status: 500, json: async () => ({ message: 'caído' }), text: async () => 'caído' } : f(url, o))(globalThis.fetch);
r = await op('v-pagar', { body: { ids: [10], nombre: 'Rosa', telefono: '8991110009', metodo: 'clip', entrega: 'persona', punto: 'zona-centro' } });
ok(r.code === 502 && salidas.correos.slice(antesCorreos).some(c => /no pudo pagar/i.test(c.subject)), `si un cliente no puede pagar, la dueña se entera (${r.code})`);

grupo('5 · Guía de envío con envia.com desde el panel');
fake.enviosCotizaciones = [{ id: 'E1', bazarId: 1, cp: '64000', ids: [5], subtotal: 340, paquete: { type: 'box', content: 'Ropa', amount: 1, declaredValue: 340, lengthUnit: 'CM', weightUnit: 'KG', weight: 0.7, dimensions: { length: 30, width: 25, height: 10 } },
  opciones: [{ key: 'estafeta:ground', carrier: 'estafeta', paqueteria: 'Estafeta', servicio: 'Terrestre', costo: 140, precio: 150 }], en: new Date().toISOString() }];
fake.pedidos.push({ id: 'PENVIO1', bazarId: 1, estado: 'pagado', entrega: 'envio', ids: [5], nombre: 'Mario Pérez', telefono: '8112223344', email: 'mario@correo.mx', total: 490, subtotal: 340, clave: 'k1',
  direccion: { calle: 'Av. Juárez 100', colonia: 'Centro', cp: '64000', ciudad: 'Monterrey', estado: 'Nuevo León', referencias: 'portón negro' },
  envioDetalle: { paqueteria: 'Estafeta', carrier: 'estafeta', servicio: 'Terrestre', costo: 140, cobrado: 150, cotizacion: 'E1' }, entregaEstado: 'pendiente', en: new Date().toISOString(), historial: [] });
fake.pedidos.push({ id: 'PPERSONA', bazarId: 1, estado: 'pagado', entrega: 'persona', ids: [6], nombre: 'Luz', telefono: '8990001111', total: 350, clave: 'k2', entregaEstado: 'pendiente', en: new Date().toISOString() });
r = await op('v-envio-guia', { body: { id: 'PENVIO1' }, token: 'TV' });
ok(r.code === 403 && !salidas.envia.length, `un vendedor no puede generar guías (cuestan saldo) (${r.code})`);
r = await op('v-envio-guia', { body: { id: 'PPERSONA' }, token: 'TA' });
ok(r.code === 400, `un pedido de entrega en persona no lleva guía (${r.code})`);
r = await op('v-envio-guia', { body: { id: 'PENVIO1' }, token: 'TA' });
const penv = fake.pedidos.find(p => p.id === 'PENVIO1');
const enviado = salidas.envia.at(-1);
ok(r.code === 200 && enviado?.shipment?.carrier === 'estafeta' && enviado.shipment.service === 'ground', `usa la misma paquetería y servicio que eligió el cliente (${r.code} ${enviado?.shipment?.carrier}:${enviado?.shipment?.service})`);
ok(enviado?.destination?.postalCode === '64000' && enviado.destination.state === 'NL' && enviado.destination.name === 'Mario Pérez' && enviado.origin.postalCode === '88500', 'origen y destino correctos');
ok(penv.entregaEstado === 'enviado' && penv.guia === '778123456789' && penv.paqueteria === 'Estafeta' && penv.guiaEnvia?.etiqueta, 'el pedido queda enviado con número de guía y etiqueta');
ok(r.body.whatsapp && decodeURIComponent(r.body.whatsapp).includes('778123456789') && decodeURIComponent(r.body.whatsapp).includes('envia.com/rastreo'), 'mensaje de WhatsApp listo con guía y rastreo');
const nEnv = salidas.envia.length;
r = await op('v-envio-guia', { body: { id: 'PENVIO1' }, token: 'TA' });
ok(r.code === 409 && salidas.envia.length === nEnv, `no genera (ni cobra) una segunda guía sin confirmar (${r.code})`);
r = await op('v-pedido', { method: 'GET', query: { id: 'PENVIO1', k: 'k1' } });
ok(r.code === 200 && /^https:\/\/envia\.com\/rastreo/.test(r.body.rastreo || ''), 'el recibo del cliente trae el enlace de rastreo');

grupo('6 · Pantalla Hoy y buscador');
fake.ofertas.push({ id: 1, bazarId: 1, prendaId: 7, estado: 'nueva', en: new Date().toISOString() });
r = await op('v-hoy', { method: 'GET', token: 'TA' });
ok(r.code === 200 && r.body.ofertas === 1 && r.body.porEntregar >= 1 && typeof r.body.ventasHoy.total === 'number' && r.body.disponibles > 0, `resumen de hoy (${JSON.stringify({ o: r.body.ofertas, e: r.body.porEntregar, d: r.body.disponibles })})`);
ok(!JSON.stringify(r.body).includes('costo') && r.body.ultimos.every(p => !/\s/.test(p.nombre)), 'sin costos y solo el primer nombre en "últimos pedidos"');
r = await op('v-buscar', { method: 'GET', query: { q: '8112223344' }, token: 'TA' });
ok(r.code === 200 && r.body.pedidos.some(p => p.id === 'PENVIO1'), 'encuentra un pedido por teléfono');
r = await op('v-buscar', { method: 'GET', query: { q: 'carhartt' }, token: 'TV' });
ok(r.code === 200 && r.body.prendas.some(p => p.id === 3) && r.body.prendas.every(p => !('costo' in p)), 'encuentra prendas por marca (sin costo)');
r = await op('v-buscar', { method: 'GET', query: { q: 'karla' }, token: 'TA' });
const rv = await op('v-buscar', { method: 'GET', query: { q: 'karla' }, token: 'TV' });
ok(r.body.clientes.length === 1 && rv.body.clientes.length === 0, 'clientes con cuenta: solo los ve la administradora');
r = await op('v-buscar', { method: 'GET', query: { q: '.*(' } , token: 'TA' });
ok(r.code === 200, 'texto raro (regex) no rompe la búsqueda');
r = await op('v-hoy', { method: 'GET' });
ok(r.code === 401, `sin sesión no hay resumen (${r.code})`);

grupo('7 · Freno para robots (Turnstile)');
r = await op('v-oferta', { body: { prendaId: 7, monto: 330, nombre: 'Robot', telefono: '8990001234' } });
ok(r.code === 200, `sin claves de Turnstile todo sigue igual (${r.code})`);
process.env.TURNSTILE_SITE_KEY = 'site'; process.env.TURNSTILE_SECRET_KEY = 'secret';
r = await op('v-oferta', { body: { prendaId: 7, monto: 330, nombre: 'Robot', telefono: '8990001235' } });
ok(r.code === 403 && r.body.turnstile, `con Turnstile activo, sin confirmación → 403 (${r.code})`);
r = await op('v-oferta', { body: { prendaId: 7, monto: 330, nombre: 'Robot', telefono: '8990001236', cfTurnstile: 'malo' } });
ok(r.code === 403, 'confirmación falsa → 403');
r = await op('v-oferta', { body: { prendaId: 7, monto: 330, nombre: 'Persona', telefono: '8990001237', cfTurnstile: 'bueno' } });
ok(r.code === 200, `confirmación válida → pasa (${r.code})`);
r = await pedir(cuentaApi, { query: { op: 'registro' }, body: { nombre: 'Robot', email: 'r@x.mx', password: 'Clave#2026x' } });
ok(r.code === 403, `crear cuenta sin confirmación → 403 (${r.code})`);
cloudflare = 'caido';
r = await op('v-espera', { body: { tipo: 'busqueda', nombre: 'Ana', telefono: '8990001238', talla: 'M', cfTurnstile: 'lo-que-sea' } });
ok(r.code === 200, `si Cloudflare no contesta, no se cae la tienda (${r.code})`);
sinCache();
r = await pedir(syncApi, { method: 'GET', query: { scope: 'publico' } });
ok((r.body?.datos || r.body).tienda.turnstile === 'site' && !JSON.stringify(r.body).includes('secret'), 'la tienda recibe solo la clave pública');
delete process.env.TURNSTILE_SITE_KEY; delete process.env.TURNSTILE_SECRET_KEY;

grupo('8 · Tarea diaria');
fake.clientes[0].avisosCarrito = true; fake.inventario.find(p => p.id === 5).precio_venta = 200;
r = await op('ig-cron', { method: 'GET', headers: { authorization: 'Bearer cron-v41' } });
ok(r.code === 200 && r.body.carrito && typeof r.body.carrito.enviados === 'number' && r.body.alertas !== undefined, `la tarea diaria corre los avisos del carrito y revisa servicios (${JSON.stringify(r.body?.carrito)})`);
