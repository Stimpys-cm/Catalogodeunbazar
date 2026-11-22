// Pruebas v42: transferencia SPEI, cliente frecuente, cupón de cumpleaños, reseñas con
// foto (y su moderación), rastreo automático, páginas por marca/categoría y origen de
// las ventas. Base en memoria; Cloudinary, envia.com y Resend son falsos.
process.env.CLIP_API_KEY = 'k'; process.env.CLIP_SECRET_KEY = 's';
process.env.SESSION_SECRET = 'secreto-de-prueba-v42';
process.env.ENVIA_TOKEN = 'tok-envia';
process.env.CLOUDINARY_CLOUD_NAME = 'demo'; process.env.CLOUDINARY_API_KEY = 'ck'; process.env.CLOUDINARY_API_SECRET = 'cs';
process.env.RESEND_API_KEY = 're_x'; process.env.CORREO_DESDE = 'Stiimpys <hola@stiimpys.store>';
for (const k of ['MULTI_BAZAR', 'BAZAR_PRINCIPAL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'AVISOS_CORREO', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'ENVIA_SANDBOX']) delete process.env[k];

const { fake } = await import('./.tmp/api/_lib/db.js');
const acciones = (await import('./.tmp/api/acciones.js')).default;
const syncApi = (await import('./.tmp/api/sync.js')).default;
const prendaApi = (await import('./.tmp/api/prenda.js')).default;
const { hashPassword } = await import('./.tmp/api/_lib/password.js');
const { clabeValida, origenDe } = await import('./.tmp/api/_lib/crecer.js');
const { revisarRastreos, estadoRastreo } = await import('./.tmp/api/_lib/rastreo.js');
const { cumpleanos, cumpleValido } = await import('./.tmp/api/_lib/clientes.js');
const { imagenValida } = await import('./.tmp/api/_lib/nube.js');

// ── fetch falso ──
const salidas = { correos: [], subidas: [], rastreo: [] };
let clip = 0, estadosEnvia = {};
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  const J = (j, st = 200) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j) });
  if (url.includes('payclip.com/v2/checkout') && o.method === 'POST') { clip++; return J({ payment_request_id: 'pr_' + clip, payment_request_url: 'https://clip/pr_' + clip }); }
  if (url.includes('payclip.com/v2/checkout/')) return J({ status: 'CHECKOUT_CREATED' });
  if (url.includes('api.cloudinary.com')) { const f = new URLSearchParams(String(o.body)); salidas.subidas.push({ folder: f.get('folder'), firma: f.get('signature'), public_id: f.get('public_id') });
    return J({ secure_url: `https://res.cloudinary.com/demo/image/upload/v1/${f.get('folder')}/${f.get('public_id')}.jpg` }); }
  if (url.includes('api.resend.com/emails')) { salidas.correos.push(JSON.parse(o.body)); return J({ id: 'em_' + salidas.correos.length }); }
  if (url.includes('/ship/generaltrack/')) { const b = JSON.parse(o.body); salidas.rastreo.push(b);
    return J({ meta: 'generaltrack', data: b.trackingNumbers.map(t => ({ trackingNumber: t, status: estadosEnvia[t] || 'Created' })) }); }
  return J({}, 404);
};
const mk = () => ({ statusCode: 200, body: undefined, h: {}, headersSent: false, writableEnded: false,
  status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; this.headersSent = this.writableEnded = true; return this; },
  send(x) { this.body = x; this.headersSent = this.writableEnded = true; return this; }, end(x) { if (x !== undefined) this.body = x; this.headersSent = this.writableEnded = true; return this; },
  setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; } });
let ipN = 0;
const pedir = async (fn, { method = 'POST', query = {}, body, token, headers = {} } = {}) => {
  const res = mk();
  await fn({ method, query, body, url: '/api/x', headers: { 'x-real-ip': '10.42.' + (ipN++ % 250) + '.1', host: 'stiimpys.store', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers } }, res);
  return { code: res.statusCode, body: typeof res.body === 'string' ? (() => { try { return JSON.parse(res.body); } catch { return res.body; } })() : res.body, h: res.h };
};
const op = (o, args = {}) => pedir(acciones, { ...args, query: { op: o, ...(args.query || {}) } });
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);
const sinCache = () => { global._syncCache = null; global._syncCacheTime = 0; global._syncCachePub = null; global._syncCachePubTime = 0; };
const foto = (n = 3000) => 'data:image/jpeg;base64,' + Buffer.alloc(n, 7).toString('base64');
const conDigito = b => { let s = 0; for (let i = 0; i < 17; i++) s += (Number(b[i]) * [3, 7, 1][i % 3]) % 10; return b + ((10 - s % 10) % 10); };
const CLABE = conDigito('01258000123456789');

fake.bazares = [{ id: 1, nombre: 'Stiimpys', whatsapp: '8990000000', slug: 'stiimpys' }];
fake.usuarios = [
  { id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA', password: await hashPassword('x') },
  { id: 2, username: 'vende', role: 'vendedor', bazarId: 1, sessionToken: 'TV', password: await hashPassword('y') },
];
const prenda = (id, precio, extra = {}) => ({ id, bazarId: 1, nombre: `Sudadera ${id}`, marca: id <= 4 ? 'Nike' : id === 5 ? 'Carhartt <script>' : 'Levi\'s', categorias: id % 2 ? ['Sudaderas'] : ['Playeras'],
  precio_venta: precio, costo: 100 + id, talla: 'M', estado: 'Seminueva', imagenes: ['https://res.cloudinary.com/demo/image/upload/v1/p' + id + '.jpg'], creadoEn: new Date().toISOString(), ...extra });
fake.inventario = Array.from({ length: 14 }, (_, i) => prenda(i + 1, 300 + i * 10));
fake.inventario.push(prenda(99, 500, { oculto: true, marca: 'Nike' }));
fake.tiendaConfig = [{ bazarId: 1, pagoEnLinea: true, minutosPago: 10, modulos: { resenas: true, cupones: true } }];
fake.ventas = []; fake.pedidos = []; fake.pendientes = []; fake.ofertas = []; fake.listaEspera = []; fake.clientes = []; fake.sistema = []; fake.actividad = [];
fake.resenas = []; fake.cuponesPersonales = []; fake.cumpleanos = []; fake.origenStats = [];

// ═══════════════════════════════════════════════════════════
grupo('1 · CLABE y configuración de transferencia');
ok(clabeValida(CLABE) && !clabeValida(CLABE.slice(0, 17) + ((Number(CLABE[17]) + 1) % 10)) && !clabeValida('123'), 'dígito verificador de la CLABE');
let r = await op('v-config', { token: 'TA', body: { spei: { activo: true, clabe: '012580001234567890', banco: 'BBVA', titular: 'Ana', horas: 4 } } });
ok(r.code === 200 && r.body.config.spei.activo === false && r.body.config.spei.clabe === '', 'una CLABE con dígito mal no se activa');
r = await op('v-config', { token: 'TV', body: { spei: { activo: true, clabe: CLABE } } });
ok(r.code === 403, 'un vendedor no cambia la cuenta de banco');
r = await op('v-config', { token: 'TA', body: { spei: { activo: true, clabe: CLABE.replace(/(\d{3})/, '$1 '), banco: 'BBVA <b>', titular: 'Ana López', horas: 99 },
  frecuente: { activo: true, cada: 2, pct: 10, cumple: true, cumplePct: 15 } } });
ok(r.code === 200 && r.body.config.spei.activo && r.body.config.spei.clabe === CLABE && r.body.config.spei.horas === 48 && !/[<>]/.test(r.body.config.spei.banco), 'CLABE con espacios se limpia, horas topadas a 48, sin < >');
sinCache();
r = await pedir(syncApi, { method: 'GET', query: { scope: 'publico' } });
const pub = JSON.stringify(r.body);
ok(!pub.includes(CLABE) && /"spei":\{"horas":48\}/.test(pub), 'la tienda pública sabe que hay SPEI pero no ve la CLABE');
ok((r.body?.datos || r.body).tienda.porBazar['1'].metodos.includes('spei'), 'SPEI aparece entre los métodos de pago');

// ═══════════════════════════════════════════════════════════
grupo('2 · Pagar por transferencia');
const cliente = { nombre: 'Luisa Pérez', telefono: '899 555 0101', email: 'luisa@correo.mx', entrega: 'persona', punto: 'zona-centro' };
const clipAntes = clip;
r = await op('v-pagar', { body: { ids: [1], ...cliente, metodo: 'spei', origen: { fuente: 'instagram', medio: 'bio' } } });
ok(r.code === 200 && /^\/pagar\.html\?pedido=/.test(r.body.url) && clip === clipAntes, 'no se abre Clip: lleva directo al recibo');
const P1 = fake.pedidos.find(p => p.id === r.body.pedido), K1 = r.body.clave;
ok(P1.proveedor === 'spei' && P1.spei.clabe === CLABE && P1.spei.monto === 300 && P1.spei.referencia === P1.id, 'el pedido guarda cuenta, monto y referencia');
const horas = (new Date(P1.expira) - Date.now()) / 3600e3;
ok(horas > 47 && horas <= 48, `la prenda queda apartada las horas configuradas (${horas.toFixed(1)} h)`);
ok(fake.inventario.find(p => p.id === 1).apartada === true, 'la prenda se aparta');
ok(P1.origen?.fuente === 'instagram' && P1.origen.medio === 'bio', 'se guarda de dónde vino (instagram · bio)');
r = await op('v-pedido', { method: 'GET', query: { id: P1.id, k: K1 } });
ok(r.body.estado === 'pendiente' && r.body.spei?.clabe === CLABE && r.body.spei.enRevision === false, 'el dueño del recibo ve la CLABE');
r = await op('v-pedido', { method: 'GET', query: { id: P1.id } });
ok(!JSON.stringify(r.body).includes(CLABE) && !r.body.spei, 'sin la clave del recibo no sale la cuenta');

// ═══════════════════════════════════════════════════════════
grupo('3 · Comprobante');
r = await op('v-spei-comprobante', { body: { id: P1.id, k: 'mala', imagen: foto() } });
ok(r.code === 404, 'con otra clave: 404 (no se sabe si existe)');
for (const [img, nombre] of [['data:text/html;base64,PHNjcmlwdD4=', 'HTML'], ['data:image/svg+xml;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64'), 'SVG'],
  ['data:image/png;base64,AAAA', 'vacía'], ['data:image/jpeg;base64,' + 'A'.repeat(100) + '<>', 'con basura'], [foto(3.3 * 1024 * 1024), 'de más de 3 MB']]) {
  r = await op('v-spei-comprobante', { body: { id: P1.id, k: K1, imagen: img } });
  ok(r.code === 400, `imagen ${nombre} rechazada`);
}
ok(salidas.subidas.length === 0, 'nada de eso llegó a Cloudinary');
r = await op('v-spei-comprobante', { body: { id: P1.id, k: K1, imagen: foto() } });
const pedP1 = fake.pedidos.find(p => p.id === P1.id);
ok(r.code === 200 && r.body.enRevision && /^https:\/\/res\.cloudinary\.com\//.test(pedP1.speiComprobante.url), 'comprobante subido');
ok(salidas.subidas[0].folder === 'stiimpys/comprobantes' && salidas.subidas[0].public_id.length >= 24 && /^[0-9a-f]{40}$/.test(salidas.subidas[0].firma), 'subida firmada, nombre al azar');
ok((new Date(pedP1.expira) - Date.now()) / 3600e3 > 47.9, 'el apartado se alarga mientras se revisa');
ok(fake.pendientes.some(p => p.tipo === 'spei' && p.pedido === P1.id && !p.hecho), 'a la dueña le aparece "Revisar transferencia"');
r = await op('v-pedido', { method: 'GET', query: { id: P1.id, k: K1 } });
ok(r.body.estado === 'pendiente' && r.body.spei.enRevision === true, 'el recibo dice "en revisión" (no pagado todavía)');

// ═══════════════════════════════════════════════════════════
grupo('4 · La dueña aprueba o rechaza');
r = await op('v-spei-revisar', { token: 'TV', body: { id: P1.id, aprobar: true } });
ok(r.code === 403 && fake.pedidos.find(p => p.id === P1.id).estado === 'pendiente', 'un vendedor NO puede dar por pagada una transferencia');
r = await op('v-spei-revisar', { body: { id: P1.id, aprobar: true } });
ok(r.code === 401 || r.code === 403, 'sin sesión: rechazado');
r = await op('v-spei-revisar', { token: 'TA', body: { id: P1.id, aprobar: true } });
ok(r.code === 200 && r.body.estado === 'pagado' && /wa\.me/.test(r.body.whatsapp), 'la administradora la aprueba: pagado + WhatsApp listo');
const v1 = fake.ventas.find(v => v.pedido === P1.id);
ok(v1 && v1.canal === 'spei' && v1.origen === 'instagram' && fake.inventario.find(p => p.id === 1).vendido, 'se registra la venta (canal spei, origen instagram) y la prenda se vende');
ok(fake.pendientes.filter(p => p.tipo === 'spei' && p.pedido === P1.id).every(p => p.hecho), 'el pendiente se cierra solo');
r = await op('v-spei-revisar', { token: 'TA', body: { id: P1.id, aprobar: true } });
ok(r.code === 409 && fake.ventas.filter(v => v.pedido === P1.id).length === 1, 'aprobar dos veces no duplica la venta');
r = await op('v-pagar', { body: { ids: [2], ...cliente, telefono: '8995550202', metodo: 'spei' } });
const P2 = r.body.pedido;
r = await op('v-spei-revisar', { token: 'TA', body: { id: P2, aprobar: false, motivo: 'No vemos el depósito <b>' } });
const ped2 = fake.pedidos.find(p => p.id === P2);
ok(r.code === 200 && ped2.estado === 'cancelado' && !/[<>]/.test(ped2.motivoCancelacion), 'rechazar: pedido cancelado, motivo sin HTML');
ok(!fake.inventario.find(p => p.id === 2).apartada, 'y la prenda vuelve a la tienda');
r = await op('v-pagar', { body: { ids: [3], ...cliente, telefono: '8995550303', metodo: 'clip' } });
r = await op('v-spei-revisar', { token: 'TA', body: { id: r.body.pedido, aprobar: true } });
ok(r.code === 400, 'un pedido con tarjeta no se puede "aprobar" a mano por esta vía');

// ═══════════════════════════════════════════════════════════
grupo('5 · Cliente frecuente');
const TF = '8997778899';
fake.pedidos.push({ id: 'PF1', bazarId: 1, estado: 'pagado', telefono: '52' + TF, total: 300, en: new Date().toISOString() },
  { id: 'PF2', bazarId: 1, estado: 'pagado', telefono: TF, total: 300, en: new Date().toISOString() });
r = await op('v-cotizar', { body: { ids: [4] } });
ok(r.code === 200 && !r.body.descFrecuente && r.body.frecuente?.pct === 10, 'sin WhatsApp: no hay descuento (pero sabe que existe el programa)');
r = await op('v-cotizar', { body: { ids: [4], telefono: TF } });
ok(r.body.descFrecuente === 33 && r.body.total === 297 && r.body.frecuente.aplica === true, `con 2 compras y "cada 2": 10 % (${r.body.descFrecuente})`);
ok(!('compras' in r.body.frecuente) && !('faltan' in r.body.frecuente), 'la cotización no dice cuántas compras lleva ese teléfono');
r = await op('v-cotizar', { body: { ids: [4], telefono: '8990001111' } });
ok(!r.body.descFrecuente, 'otro teléfono: sin descuento');
r = await op('v-pagar', { body: { ids: [4], nombre: 'Frecu Ente', telefono: TF, email: 'f@x.mx', entrega: 'persona', punto: 'zona-centro', metodo: 'spei' } });
const PF = fake.pedidos.find(p => p.id === r.body.pedido);
ok(PF.descFrecuente === 33 && PF.total === 297 && PF.spei.monto === 297, 'al pagar, el servidor aplica el descuento (no lo manda el navegador)');
fake.pedidos.find(p => p.id === 'PF2').estado = 'cancelado';
r = await op('v-cotizar', { body: { ids: [5], telefono: TF } });
ok(!r.body.descFrecuente, 'con 1 compra ya no toca');

// ═══════════════════════════════════════════════════════════
grupo('6 · Cupón de cumpleaños');
ok(cumpleValido('02-29') && !cumpleValido('02-30') && !cumpleValido('13-01') && !cumpleValido('1-1'), 'fecha de cumpleaños válida');
r = await op('v-cumple', { body: { id: P1.id, k: 'mala', cumple: '05-10' } });
ok(r.code === 404, 'sin la clave del recibo: 404');
r = await op('v-cumple', { body: { id: P1.id, k: K1, cumple: '31-31' } });
ok(r.code === 400, 'fecha imposible: 400');
const hoy = new Date(Date.now() - 6 * 3600e3).toISOString().slice(5, 10);
r = await op('v-cumple', { body: { id: P1.id, k: K1, cumple: hoy } });
ok(r.code === 200 && fake.cumpleanos.some(c => c.tel10 === '8995550101' && c.cumple === hoy && !('anio' in c)) && !fake.clientes.length, 'se guarda día y mes (nunca el año), aparte de las cuentas de clientes');
r = await op('v-pedido', { method: 'GET', query: { id: P1.id, k: K1 } });
ok(r.body.cumple?.dado === true && r.body.frecuente?.cada === 2, 'el recibo ya no lo vuelve a pedir y muestra su avance de cliente frecuente');
const correos0 = salidas.correos.length;
let hechos = await cumpleanos(await (await import('./.tmp/api/_lib/db.js')).getDB(), { id: 1 }, { frecuente: { cumple: true, cumplePct: 15 } });
const cup = fake.cuponesPersonales[0];
ok(hechos.length === 1 && salidas.correos.length === correos0 + 1 && /^CUMPLE-[A-Z2-9]{6}$/.test(cup.codigo) && salidas.correos.at(-1).html.includes(cup.codigo), 'el día del cumpleaños sale el correo con un código personal');
hechos = await cumpleanos(await (await import('./.tmp/api/_lib/db.js')).getDB(), { id: 1 }, { frecuente: { cumple: true, cumplePct: 15 } });
ok(hechos.length === 0 && fake.cuponesPersonales.length === 1, 'una sola vez por año');
r = await op('v-cotizar', { body: { ids: [6], cupon: cup.codigo.toLowerCase() } });
ok(r.body.descCupon === Math.round(350 * 0.15) && !r.body.cuponError, 'el cupón personal funciona en el pago');
r = await op('v-cotizar', { body: { ids: [6], cupon: 'CUMPLE-AAAAAA' } });
ok(!!r.body.cuponError && !r.body.descCupon, 'un código inventado no sirve');
fake.cuponesPersonales[0].vence = '2020-01-01';
r = await op('v-cotizar', { body: { ids: [6], cupon: cup.codigo } });
ok(/venci/.test(r.body.cuponError || ''), 'vencido: avisa');

// ═══════════════════════════════════════════════════════════
grupo('7 · Reseñas con foto');
const pr = fake.pedidos.find(p => p.id === P1.id); pr.entregaEstado = 'entregado';
const subAntes = salidas.subidas.length;
r = await op('v-resena', { body: { id: P1.id, k: K1, estrellas: 5, comentario: 'Me encantó', fotos: [foto(), foto(), foto(), foto()] } });
const res1 = fake.resenas.find(x => x.pedido === P1.id);
ok(r.code === 200 && r.body.revision === true && res1.fotos.length === 3 && salidas.subidas.length === subAntes + 3, 'máximo 3 fotos, se suben a Cloudinary');
ok(salidas.subidas.slice(-3).every(s => s.folder === 'stiimpys/resenas') && res1.fotosOk === false, 'quedan en revisión');
ok(fake.pendientes.some(p => p.resenaId === res1.id && p.fotos?.length === 3), 'a la dueña le llegan para revisarlas');
sinCache();
r = await pedir(syncApi, { method: 'GET', query: { scope: 'publico' } });
let rp = (r.body?.datos || r.body).resenas.find(x => x.id === res1.id);
ok(rp && rp.fotos.length === 0, 'antes de aprobar, la tienda no muestra las fotos');
r = await op('v-resena-moderar', { token: 'TV', body: { id: res1.id, accion: 'aprobar' } });
ok(r.code === 403, 'un vendedor no modera');
r = await op('v-resena-moderar', { token: 'TA', body: { id: res1.id, accion: 'borrar-todo' } });
ok(r.code === 400, 'acción desconocida: 400');
r = await op('v-resena-moderar', { token: 'TA', body: { id: res1.id, accion: 'aprobar' } });
sinCache();
r = await pedir(syncApi, { method: 'GET', query: { scope: 'publico' } });
rp = (r.body?.datos || r.body).resenas.find(x => x.id === res1.id);
ok(rp.fotos.length === 3 && rp.fotos.every(u => u.startsWith('https://res.cloudinary.com/')), 'aprobada: las fotos salen en la tienda');
fake.resenas.find(x => x.id === res1.id).fotos.push('javascript:alert(1)', 'https://malo.com/x.jpg');
sinCache();
r = await pedir(syncApi, { method: 'GET', query: { scope: 'publico' } });
rp = (r.body?.datos || r.body).resenas.find(x => x.id === res1.id);
ok(rp.fotos.every(u => u.startsWith('https://res.cloudinary.com/')), 'solo salen direcciones de Cloudinary');
await op('v-resena-moderar', { token: 'TA', body: { id: res1.id, accion: 'ocultar' } });
sinCache();
r = await pedir(syncApi, { method: 'GET', query: { scope: 'publico' } });
ok(!(r.body?.datos || r.body).resenas.some(x => x.id === res1.id), 'ocultar la quita de la tienda');
r = await op('v-resena', { body: { id: P1.id, k: K1, estrellas: 4 } });
ok(r.code === 409, 'no se califica dos veces');

// ═══════════════════════════════════════════════════════════
grupo('8 · Rastreo automático');
ok(estadoRastreo({ status: 'Delivered' }) === 'entregado' && estadoRastreo({ status: 'Shipped' }) === 'camino' && estadoRastreo({ statusId: 12 }) === 'oficina'
  && estadoRastreo({ status: 'Delivered at Origin' }) === 'devuelto' && estadoRastreo({ status: 'Canceled' }) === 'cancelado', 'estados de envia.com');
const envioP = (id, guia, extra = {}) => ({ id, bazarId: 1, estado: 'pagado', entrega: 'envio', entregaEstado: 'enviado', nombre: 'Cli ' + id, telefono: '8991000000', email: id + '@x.mx',
  items: [{ id: 7, nombre: 'Sudadera 7', precio: 360 }], total: 360, guia, paqueteria: 'Estafeta', guiaEnvia: { guia, paqueteria: 'Estafeta' }, pagadoEn: new Date().toISOString(), clave: 'k' + id, historial: [], ...extra });
fake.pedidos.push(envioP('E1', '111'), envioP('E2', '222', { entregaEstado: 'pendiente', guia: '' }), envioP('E3', '333'), envioP('E4', '444'), envioP('E5', '555', { guia: 'OTRA-GUIA' }));
estadosEnvia = { 111: 'Delivered', 222: 'Shipped', 333: 'Pickup at Office', 444: 'Delivered at Origin', 555: 'Delivered' };
const c0 = salidas.correos.length;
hechos = await revisarRastreos(await (await import('./.tmp/api/_lib/db.js')).getDB(), { id: 1 });
const E = id => fake.pedidos.find(p => p.id === id);
ok(E('E1').entregaEstado === 'entregado' && E('E1').entregadoEn && E('E1').estadoPor === 'rastreo automático', 'Delivered → entregado');
ok(E('E2').entregaEstado === 'enviado' && E('E2').guia === '222', 'Shipped → enviado con su guía');
ok(E('E3').entregaEstado === 'enviado' && fake.pendientes.some(p => p.pedido === 'E3' && /oficina/.test(p.texto)), 'En oficina → aviso a la dueña');
ok(fake.pendientes.some(p => p.pedido === 'E4' && p.urgente), 'Devuelto al origen → aviso urgente');
ok(E('E5').entregaEstado === 'enviado' && !salidas.rastreo.flatMap(x => x.trackingNumbers).includes('555'), 'si la guía se cambió a mano, no se rastrea la de envia.com');
const asuntos = salidas.correos.slice(c0).map(c => c.subject);
ok(asuntos.some(a => /ya llegó/.test(a)) && asuntos.some(a => /va en camino/.test(a)) && asuntos.some(a => /paquetería/.test(a)), 'correos al cliente: llegó, en camino, recoger en oficina');
const consultas = salidas.rastreo.length;
hechos = await revisarRastreos(await (await import('./.tmp/api/_lib/db.js')).getDB(), { id: 1 });
ok(salidas.rastreo.length === consultas && hechos.length === 0, 'no se vuelve a preguntar antes de 6 horas');
r = await op('v-rastreo-revisar', { token: 'TV', body: {} });
ok(r.code === 403, 'el botón "Revisar rastreo" es solo para la administradora');
r = await op('v-rastreo-revisar', { token: 'TA', body: {} });
ok(r.code === 200 && Array.isArray(r.body.hechos), 'la administradora lo corre a mano');

// ═══════════════════════════════════════════════════════════
grupo('9 · Páginas por marca y categoría');
r = await pedir(prendaApi, { method: 'GET', query: { landing: 'marca', slug: 'nike' } });
let html = String(r.body);
ok(r.code === 200 && /<h1>Nike<\/h1>/.test(html) && /rel="canonical" href="https:\/\/stiimpys\.store\/marca\/nike"/.test(html), 'la página /marca/nike existe con su canónica');
ok(/"@type":"ItemList"/.test(html) && /"@type":"BreadcrumbList"/.test(html), 'datos estructurados para Google');
ok(!html.includes('prenda.html?id=99') && !html.includes('prenda.html?id=1"'), 'sin prendas ocultas ni vendidas');
ok(html.includes('logo-negro-chico.webp') && html.includes('/js/tienda/origen.js'), 'con el logo y la medición de origen');
r = await pedir(prendaApi, { method: 'GET', query: { landing: 'marca', slug: 'carhartt-script' } });
html = String(r.body);
ok(r.code === 200 && !html.includes('<script>"') && !/Carhartt <script>/.test(html) && html.includes('Carhartt &lt;script&gt;'), 'una marca con HTML se escapa');
r = await pedir(prendaApi, { method: 'GET', query: { landing: 'categoria', slug: 'sudaderas' } });
ok(r.code === 200 && /<h1>Sudaderas<\/h1>/.test(String(r.body)) && /Otras categorías/.test(String(r.body)), '/categoria/sudaderas con enlaces a otras categorías');
r = await pedir(prendaApi, { method: 'GET', query: { landing: 'marca', slug: 'no-existe' } });
ok(r.code === 302 && r.h.location === '/tienda.html', 'marca sin prendas → a la tienda');
r = await pedir(prendaApi, { method: 'GET', query: { landing: 'marca', slug: '../../etc/passwd' } });
ok(r.code === 302, 'slug raro: redirige sin error');
r = await pedir(prendaApi, { method: 'GET', query: { sitemap: '1' } });
ok(/\/marca\/nike</.test(String(r.body)) && /\/categoria\/sudaderas</.test(String(r.body)) && /\/marca\/levis</.test(String(r.body)), 'el sitemap incluye las páginas de marca y categoría');

// ═══════════════════════════════════════════════════════════
grupo('10 · De dónde vienen las ventas');
ok(origenDe({ fuente: 'IG' }).fuente === 'instagram' && origenDe({ ref: 'l.instagram.com' }).fuente === 'instagram' && origenDe({ ref: 'www.google.com' }).fuente === 'google'
  && origenDe({ fuente: 'qr' }).fuente === 'qr' && origenDe({ ref: 'm.facebook.com' }).fuente === 'facebook' && origenDe(null).fuente === 'directo', 'fuentes reconocidas');
const raro = origenDe({ fuente: '<img src=x onerror=alert(1)>', campana: { $gt: '' }, ref: 'x'.repeat(500) });
ok(!/[<>=]/.test(JSON.stringify(raro)) && (raro.ref || '').length <= 80, 'lo que llega se limpia y se corta');
r = await op('v-evento', { body: { tipo: 'llegada', origen: { fuente: 'tiktok' } } });
await op('v-evento', { body: { tipo: 'llegada', origen: { ref: 'www.instagram.com' } } });
await op('v-evento', { body: { tipo: 'llegada', origen: { ref: 'www.instagram.com' } } });
ok(r.code === 200 && fake.origenStats.find(x => x.fuente === 'instagram')?.visitas === 2 && fake.origenStats.find(x => x.fuente === 'tiktok')?.visitas === 1, 'cada llegada se cuenta por fuente (sin datos personales)');
ok(Object.keys(fake.origenStats[0]).every(k => ['_id', 'dia', 'fuente', 'visitas'].includes(k)), 'solo día, fuente y número');
fake.ventas.push({ id: 900, bazarId: 1, canal: 'bazar', ticket: 'T1', precio: 250, fecha: new Date().toISOString() });
r = await op('v-metricas', { method: 'GET', token: 'TA' });
const ig = r.body.origenes.find(x => x.fuente === 'instagram'), bz = r.body.origenes.find(x => x.fuente === 'bazar en persona');
ok(ig && ig.visitas === 2 && ig.ventas === 1 && ig.dinero === 300 && ig.conversion === 50, `Instagram: 2 visitas, 1 venta, $300, 50 % (${JSON.stringify(ig)})`);
ok(bz && bz.dinero === 250, 'las ventas de la Caja salen como "bazar en persona"');

console.log(process.exitCode ? '\n✘ v42 con fallas' : '\n✔ v42: todo bien');
