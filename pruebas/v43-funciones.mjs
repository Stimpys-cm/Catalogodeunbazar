// Pruebas v43: interruptores, comprobante con IA + Banxico, outfit, referidos, carritos por
// WhatsApp, resumen semanal, ticket de la Caja, cancelar guía y recolección, Google Shopping,
// páginas por talla/precio, guías, página del drop, medidas y sello, origen apagado.
// Base en memoria; Anthropic, Banxico, Cloudinary, envia.com y Resend son falsos.
process.env.CLIP_API_KEY = 'k'; process.env.CLIP_SECRET_KEY = 's';
process.env.SESSION_SECRET = 'secreto-de-prueba-v43';
process.env.ENVIA_TOKEN = 'tok-envia'; process.env.ANTHROPIC_API_KEY = 'sk-ant-prueba';
process.env.CLOUDINARY_CLOUD_NAME = 'demo'; process.env.CLOUDINARY_API_KEY = 'ck'; process.env.CLOUDINARY_API_SECRET = 'cs';
process.env.RESEND_API_KEY = 're_x'; process.env.CORREO_DESDE = 'Stiimpys <hola@stiimpys.store>'; process.env.AVISOS_CORREO = 'duena@stiimpys.store';
for (const k of ['MULTI_BAZAR', 'BAZAR_PRINCIPAL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'ENVIA_SANDBOX']) delete process.env[k];

const { fake, getDB } = await import('./.tmp/api/_lib/db.js');
const acciones = (await import('./.tmp/api/acciones.js')).default;
const syncApi = (await import('./.tmp/api/sync.js')).default;
const prendaApi = (await import('./.tmp/api/prenda.js')).default;
const itemApi = (await import('./.tmp/api/inventario-item.js')).default;
const { hashPassword } = await import('./.tmp/api/_lib/password.js');
const { grupoPrenda, carritosWhatsApp, armarResumen } = await import('./.tmp/api/_lib/extras.js');
const { prefijoBanco, dictamen } = await import('./.tmp/api/_lib/comprobante.js');
const { pendiente } = await import('./.tmp/api/_lib/crecer.js');

// ── fetch falso ──
const salidas = { ia: 0, banxico: [], cancel: [], pickup: [], correos: [] };
let lecturaIA = null, banxico = 'ok';
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  const J = (j, st = 200, extra = {}) => ({ ok: st < 300, status: st, json: async () => j, text: async () => typeof j === 'string' ? j : JSON.stringify(j), headers: { get: () => null, getSetCookie: () => [] }, ...extra });
  if (url.includes('payclip.com/v2/checkout') && o.method === 'POST') return J({ payment_request_id: 'pr_1', payment_request_url: 'https://clip/pr_1' });
  if (url.includes('payclip.com')) return J({ status: 'CHECKOUT_CREATED' });
  if (url.includes('api.cloudinary.com')) { const f = new URLSearchParams(String(o.body)); return J({ secure_url: `https://res.cloudinary.com/demo/image/upload/v1/${f.get('folder')}/${f.get('public_id')}.jpg` }); }
  if (url.includes('api.anthropic.com')) { salidas.ia++; return J({ content: [{ type: 'text', text: JSON.stringify(lecturaIA) }] }); }
  if (url.includes('banxico.org.mx/cep/valida.do')) {
    const f = new URLSearchParams(String(o.body)); salidas.banxico.push(Object.fromEntries(f));
    if (banxico === 'caido') throw new Error('ECONNRESET');
    const ok = banxico === 'ok' && f.get('emisor') === '40012' && f.get('receptor') === '90730';
    return { ok: true, status: 200, text: async () => ok ? '<html>Descarga tu comprobante</html>' : '<html>No se encontró información</html>', headers: { get: () => 'JSESSIONID=abc; Path=/', getSetCookie: () => ['JSESSIONID=abc; Path=/'] } };
  }
  if (url.includes('banxico.org.mx/cep/descarga.do')) {
    if (!String(o.headers?.cookie || '').includes('JSESSIONID=abc')) return J('<html>sesión</html>');
    const monto = banxico === 'otroMonto' ? '10.00' : '650.00';
    return J(`<SPEI_Tercero FechaOperacion="2026-11-18" cadenaCDA="x"><Ordenante Nombre="CLIENTE"/><Beneficiario Nombre="DUENA" Cuenta="${CLABE}" MontoPago="${monto}" IVA="0" Concepto="P"/></SPEI_Tercero>`);
  }
  if (url.includes('/ship/cancel/')) { salidas.cancel.push(JSON.parse(o.body)); return J({ meta: 'cancel', data: { carrier: 'estafeta', trackingNumber: '999', balanceReturned: true } }); }
  if (url.includes('/ship/pickup/')) { salidas.pickup.push(JSON.parse(o.body)); return J({ meta: 'pickup', data: [{ carrier: 'estafeta', pickupNumber: 'PRP-123', pickupDate: '2026-11-20' }] }); }
  if (url.includes('api.resend.com/emails')) { salidas.correos.push(JSON.parse(o.body)); return J({ id: 'em' }); }
  return J({}, 404);
};
const mk = () => ({ statusCode: 200, body: undefined, h: {}, headersSent: false, writableEnded: false,
  status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; this.headersSent = this.writableEnded = true; return this; },
  send(x) { this.body = x; this.headersSent = this.writableEnded = true; return this; }, end(x) { if (x !== undefined) this.body = x; this.headersSent = this.writableEnded = true; return this; },
  setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; } });
let ipN = 0;
const pedir = async (fn, { method = 'POST', query = {}, body, token, headers = {} } = {}) => {
  const res = mk();
  await fn({ method, query, body, url: '/api/x', headers: { 'x-real-ip': '10.43.' + (ipN++ % 250) + '.1', host: 'stiimpys.store', ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers } }, res);
  return { code: res.statusCode, body: typeof res.body === 'string' ? (() => { try { return JSON.parse(res.body); } catch { return res.body; } })() : res.body, h: res.h };
};
const op = (o, args = {}) => pedir(acciones, { ...args, query: { op: o, ...(args.query || {}) } });
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);
const sinCache = () => { global._syncCache = null; global._syncCacheTime = 0; global._syncCachePub = null; global._syncCachePubTime = 0; };
const foto = (n = 3000) => 'data:image/jpeg;base64,' + Buffer.alloc(n, 7).toString('base64');
const conDigito = b => { let s = 0; for (let i = 0; i < 17; i++) s += (Number(b[i]) * [3, 7, 1][i % 3]) % 10; return b + ((10 - s % 10) % 10); };
const CLABE = conDigito('73096930000819908');
let nMod = 0;   // (cada cambio con un número distinto: el panel frena dos envíos idénticos en 6 s)
const modulos = async m => { const r = await op('v-config', { token: 'TA', body: { modulos: { ...(await cfgActual()).modulos, ...m }, _n: ++nMod } }); sinCache(); return r; };
const cfgActual = async () => (await op('v-panel', { method: 'GET', token: 'TA' })).body.config;
const html = r => String(r.body);

fake.bazares = [{ id: 1, nombre: 'Stiimpys', whatsapp: '8990000000', slug: 'stiimpys' }];
fake.usuarios = [
  { id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA', password: await hashPassword('x') },
  { id: 2, username: 'vende', role: 'vendedor', bazarId: 1, sessionToken: 'TV', password: await hashPassword('y') },
];
const nombres = ['Sudadera Nike', 'Pantalón cargo Dickies', 'Gorra New Era', 'Playera vintage', 'Tenis Jordan', 'Jeans Levi\'s', 'Chamarra Carhartt', 'Short Nike', 'Sudadera Champion', 'Playera Nike', 'Pantalón Nike', 'Gorra Nike'];
fake.inventario = nombres.map((n, i) => ({ id: i + 1, bazarId: 1, nombre: n, marca: n.split(' ').pop().replace("'s", "'s"), categorias: [n.split(' ')[0] + 's'], talla: ['M', 'L', '32'][i % 3], estado: 'Seminueva',
  precio_venta: 300 + i * 50, costo: 100, imagenes: [`https://res.cloudinary.com/demo/image/upload/v1/p${i + 1}.jpg`], creadoEn: new Date(Date.now() - (i === 11 ? 60 : 2) * 864e5).toISOString() }));
fake.tiendaConfig = [{ bazarId: 1, pagoEnLinea: true, envia: { activo: true, origen: { nombre: 'Stiimpys', telefono: '8991234567', calle: 'Calle 1', numero: '2', colonia: 'Centro', cp: '88500' } } }];
for (const k of ['ventas', 'pedidos', 'pendientes', 'ofertas', 'listaEspera', 'clientes', 'sistema', 'actividad', 'resenas', 'cuponesPersonales', 'cumpleanos', 'origenStats', 'referidos', 'drops', 'prendaStats']) fake[k] = [];
fake.codigosPostales = [{ cp: '88500', ciudad: 'Reynosa', estado: 'Tamaulipas', estadoCodigo: 'TM', colonias: ['Centro'], en: new Date().toISOString() }];

// ═══════════════════════════════════════════════════════════
grupo('1 · Interruptores (todo lo nuevo viene apagado)');
let cfg = await cfgActual();
const nuevos = ['speiIA', 'speiAuto', 'carritosWA', 'dropPagina', 'outfit', 'referidos', 'resumenSemanal', 'cajaTicketWA', 'enviosPanel', 'feedGoogle', 'paginasTalla', 'guias', 'googleMaps', 'selloRevisada'];
ok(nuevos.every(k => cfg.modulos[k] === false), 'los 14 interruptores nuevos están apagados al instalar');
ok(cfg.modulos.paginasMarca === true && cfg.modulos.origenVentas === true, 'lo de la v42 (páginas por marca, origen) sigue prendido');
let r = await op('v-config', { token: 'TV', body: { modulos: { outfit: true } } });
ok(r.code === 403, 'un vendedor no prende módulos');
r = await op('v-config', { token: 'TA', body: { modulos: { ...cfg.modulos, outfit: true, inventado: true } } });
ok(r.code === 200 && r.body.config.modulos.outfit === true && !('inventado' in r.body.config.modulos), 'la administradora los prende; llaves inventadas se ignoran');
await modulos({ outfit: false });

// ═══════════════════════════════════════════════════════════
grupo('2 · Comprobante SPEI revisado por la IA y Banxico');
ok(prefijoBanco('BBVA México') === '012' && prefijoBanco('Mercado Pago') === '722' && prefijoBanco('Banco Inventado') === null, 'banco del comprobante → clave de la CLABE');
await op('v-config', { token: 'TA', body: { spei: { activo: true, clabe: CLABE, banco: 'Clip', titular: 'Dueña', horas: 3 } } });
const cli = { nombre: 'Rosa Díaz', telefono: '8997770001', email: 'rosa@x.mx', entrega: 'persona', punto: 'zona-centro', metodo: 'spei' };
r = await op('v-pagar', { body: { ids: [8], ...cli } });   // Short Nike $650
const P1 = r.body.pedido, K1 = r.body.clave;
r = await op('v-spei-comprobante', { body: { id: P1, k: K1, imagen: foto() } });
ok(r.code === 200 && r.body.revisar === false, 'con la revisión automática apagada, el recibo no la pide');
r = await op('v-spei-verificar', { body: { id: P1, k: K1 } });
ok(r.code === 400, 'revisar con el módulo apagado: 400');
await modulos({ speiIA: true });
lecturaIA = { esComprobante: true, monto: 650, claveRastreo: 'MBAN0100211118', fecha: '2026-11-18', bancoEmisor: 'BBVA', cuentaDestino: CLABE, estado: 'exitosa' };
r = await op('v-spei-verificar', { body: { id: P1, k: 'mala' } });
ok(r.code === 404, 'sin la clave del recibo ni sesión de admin: 404');
r = await op('v-spei-verificar', { token: 'TV', body: { id: P1 } });
ok(r.code === 404, 'un vendedor no puede pedir la revisión');
r = await op('v-spei-verificar', { body: { id: P1, k: K1 } });
let ped = fake.pedidos.find(p => p.id === P1);
ok(r.code === 200 && r.body.verificado === true && r.body.pagado === false, 'IA + Banxico: verificado, pero NO se aprueba solo (speiAuto apagado)');
ok(ped.estado === 'pendiente' && ped.speiComprobante.revision.nivel === 'verde' && ped.speiComprobante.revision.cep.estado === 'confirmado', 'el panel ve "Banxico confirma" en verde');
const q = salidas.banxico.find(x => x.emisor === '40012' && x.receptor === '90730');
ok(q && q.criterio === 'MBAN0100211118' && q.fecha === '18-11-2026' && q.cuenta === CLABE && q.tipoCriterio === 'T', 'a Banxico se le pregunta con clave de rastreo, fecha dd-mm-aaaa, bancos y tu CLABE');
r = await op('v-spei-verificar', { body: { id: P1, k: K1 } });
ok(r.code === 200 && salidas.ia === 1, 'el cliente no puede pedir revisiones seguidas (se reusa la de hace menos de 3 min)');
await modulos({ speiAuto: true });
r = await op('v-spei-verificar', { token: 'TA', body: { id: P1 } });
ped = fake.pedidos.find(p => p.id === P1);
ok(r.code === 200 && r.body.aprobado === true && ped.estado === 'pagado' && fake.ventas.some(v => v.pedido === P1 && v.canal === 'spei'), 'con "Aprobar sola" prendido: Banxico confirma → pedido pagado y venta registrada');
ok((ped.historial || []).some(h => /Banxico/.test(h.accion)), 'queda en el historial del pedido que lo aprobó Banxico');
// Monto que no coincide → rojo y no se aprueba
r = await op('v-pagar', { body: { ids: [9], ...cli, telefono: '8997770002' } });
const P2 = r.body.pedido, K2 = r.body.clave;
await op('v-spei-comprobante', { body: { id: P2, k: K2, imagen: foto() } });
lecturaIA = { ...lecturaIA, monto: 10 }; banxico = 'otroMonto';
r = await op('v-spei-verificar', { token: 'TA', body: { id: P2 } });
ped = fake.pedidos.find(p => p.id === P2);
ok(r.body.aprobado === false && ped.estado === 'pendiente' && ped.speiComprobante.revision.nivel === 'rojo', 'monto distinto: alerta roja y no se aprueba aunque "Aprobar sola" esté prendido');
banxico = 'no'; lecturaIA = { ...lecturaIA, monto: 700 };
r = await op('v-spei-verificar', { token: 'TA', body: { id: P2 } });
ok(fake.pedidos.find(p => p.id === P2).speiComprobante.revision.cep.estado === 'no encontrado' && !r.body.aprobado, 'Banxico no la encuentra: queda en ámbar para revisar a mano');
banxico = 'caido';
r = await op('v-spei-verificar', { token: 'TA', body: { id: P2 } });
ok(r.code === 200 && /No se pudo verificar/.test(fake.pedidos.find(p => p.id === P2).speiComprobante.revision.texto), 'si Banxico no contesta, no se cae: "no se pudo verificar"');
banxico = 'ok';
const dic = dictamen({ esComprobante: false }, { estado: 'confirmado' }, { clabe: CLABE, monto: 100 });
ok(dic.nivel === 'rojo', 'una imagen que no parece comprobante nunca sale en verde');
await modulos({ speiAuto: false, speiIA: false });

// ═══════════════════════════════════════════════════════════
grupo('3 · Arma tu outfit');
ok(grupoPrenda({ nombre: 'Sudadera Nike' }) === 'arriba' && grupoPrenda({ nombre: 'Pantalón cargo' }) === 'abajo' && grupoPrenda({ nombre: 'Gorra New Era' }) === 'accesorio' && grupoPrenda({ nombre: 'Tenis Jordan' }) === 'calzado', 'tipo de cada prenda');
r = await op('v-cotizar', { body: { ids: [1, 2] } });
ok(!r.body.descOutfit && r.body.outfit === null, 'apagado: no hay descuento por outfit');
await modulos({ outfit: true });
await op('v-config', { token: 'TA', body: { outfit: { pct: 7 } } });
r = await op('v-cotizar', { body: { ids: [1, 2] } });   // 300 + 350 = 650, volumen 10 % → 585, outfit 7 % de 585 = 41
ok(r.body.descOutfit === 41 && r.body.total === 650 - 65 - 41, `sudadera + pantalón: ${r.body.outfit?.pct}% extra (−${r.body.descOutfit})`);
r = await op('v-cotizar', { body: { ids: [1, 4] } });
ok(!r.body.descOutfit && r.body.outfit.grupos.length === 1, 'dos prendas de arriba: sin outfit (y el carrito sugiere agregar otro tipo)');
r = await op('v-pagar', { body: { ids: [3, 6], nombre: 'Ana Outfit', telefono: '8997770003', entrega: 'persona', punto: 'zona-centro', metodo: 'spei' } });
ped = fake.pedidos.find(p => p.id === r.body.pedido);
ok(ped.descOutfit > 0 && ped.total === ped.subtotal - ped.descVolumen - ped.descOutfit, 'al pagar, el servidor recalcula y guarda el descuento');
await modulos({ outfit: false });

// ═══════════════════════════════════════════════════════════
grupo('4 · Invita a tus amigos');
r = await op('v-pedido', { method: 'GET', query: { id: P1, k: K1 } });
ok(r.body.estado === 'pagado' && !r.body.referido, 'apagado: el recibo no muestra código');
await modulos({ referidos: true });
r = await op('v-pedido', { method: 'GET', query: { id: P1, k: K1 } });
const COD = r.body.referido?.codigo;
ok(/^REF-[A-Z2-9]{5}$/.test(COD || '') && r.body.referido.pctAmigo === 10, `el recibo pagado trae su código (${COD})`);
r = await op('v-pedido', { method: 'GET', query: { id: P1, k: K1 } });
ok(r.body.referido.codigo === COD && fake.referidos.length === 1, 'el código es siempre el mismo (uno por teléfono)');
r = await op('v-cotizar', { body: { ids: [10], cupon: COD.toLowerCase(), telefono: '8997770001' } });
ok(/propio código/.test(r.body.cuponError || ''), 'no se puede usar tu propio código');
r = await op('v-cotizar', { body: { ids: [10], cupon: COD, telefono: '8997770002' } });
ok(/primera compra/.test(r.body.cuponError || '') || r.body.descCupon > 0, 'quien ya compró no lo usa (o, si su pedido no se pagó, sí)');
r = await op('v-cotizar', { body: { ids: [10], cupon: COD, telefono: '8995550999' } });
ok(r.body.descCupon === Math.round(r.body.subtotal * 0.1) && !r.body.cuponError, 'un amigo nuevo tiene 10 % en su primera compra');
r = await op('v-pagar', { body: { ids: [10], nombre: 'Amiga Nueva', telefono: '8995550999', entrega: 'persona', punto: 'zona-centro', metodo: 'spei', cupon: COD } });
const PA = r.body.pedido;
r = await op('v-spei-revisar', { token: 'TA', body: { id: PA, aprobar: true } });
const regalo = fake.cuponesPersonales.find(c => /^REGALO-/.test(c.codigo));
ok(r.body.estado === 'pagado' && regalo && regalo.tel10 === '8997770001' && regalo.valor === 10, 'cuando la amiga paga, quien la invitó gana su cupón REGALO');
ok(fake.pendientes.some(p => p.titulo === 'Premio por invitar' && /wa\.me\/528997770001/.test(p.whatsapp) && p.whatsapp.includes(encodeURIComponent(regalo.codigo))), 'a la dueña le llega el WhatsApp listo para mandarle su regalo');
ok(fake.referidos[0].invitados === 1, 'se cuenta 1 amigo invitado');
r = await op('v-cotizar', { body: { ids: [11], cupon: regalo.codigo, telefono: '8995550123' } });
ok(/personal/.test(r.body.cuponError || ''), 'el cupón REGALO es personal: otro teléfono no lo usa');
r = await op('v-cotizar', { body: { ids: [11], cupon: regalo.codigo, telefono: '8997770001' } });
ok(r.body.descCupon > 0, 'su dueño sí lo usa');
await modulos({ referidos: false });
r = await op('v-cotizar', { body: { ids: [11], cupon: COD, telefono: '8995550444' } });
ok(!!r.body.cuponError, 'con el módulo apagado los códigos de amigo no sirven');

// ═══════════════════════════════════════════════════════════
grupo('5 · Carritos olvidados por WhatsApp');
fake.clientes.push({ id: 'c1', nombre: 'Lalo Ruiz', telefono: '899-111-2233', wishlist: [{ id: 5 }, { id: 99 }] },
  { id: 'c2', nombre: 'Sin Avisos', telefono: '8991112244', wishlist: [{ id: 5 }], avisosCarrito: false },
  { id: 'c3', nombre: 'Sin Tel', wishlist: [{ id: 5 }] }, { id: 'c4', nombre: 'Vendida', telefono: '8991112255', wishlist: [{ id: 8 }] });
const db = await getDB();
let hechos = await (async () => { const { correrAutomatico } = await import('./.tmp/api/_lib/automatico.js'); return correrAutomatico(db, fake.bazares[0], { forzarDiario: true }); })();
ok(!fake.pendientes.some(p => p.tipo === 'carrito'), 'apagado: la tarea diaria no crea avisos de carrito');
await modulos({ carritosWA: true });
hechos = await carritosWhatsApp(db, { id: 1 }, { pendiente });
const pc = fake.pendientes.filter(p => p.tipo === 'carrito');
ok(pc.length === 1 && pc[0].cliente === 'Lalo' && /wa\.me\/528991112233/.test(pc[0].whatsapp) && pc[0].prendas.includes('Tenis Jordan'), 'aviso con el WhatsApp de Lalo y su prenda disponible');
ok(!pc.some(p => p.cliente === 'Sin'), 'respeta a quien apagó los avisos y a quien no tiene WhatsApp');
ok(!pc.some(p => p.cliente === 'Vendida'), 'si su prenda ya se vendió, no se le escribe');
hechos = await carritosWhatsApp(db, { id: 1 }, { pendiente });
ok(fake.pendientes.filter(p => p.tipo === 'carrito').length === 1, 'una vez cada 7 días por cliente');
await modulos({ carritosWA: false });

// ═══════════════════════════════════════════════════════════
grupo('6 · Resumen de cada lunes');
const res6 = await armarResumen(db, 1);
ok(/Tu semana en Stiimpys/.test(res6.texto) && res6.ventas >= 2 && /más de 45 días/.test(res6.texto), 'el resumen trae ventas, dinero y prendas viejas para rebajar');
r = await op('v-resumen', { token: 'TV', body: {} });
ok(r.code === 403, 'un vendedor no ve el resumen');
r = await op('v-resumen', { token: 'TA', body: {} });
ok(r.code === 200 && r.body.resumen.texto.includes('Vendiste'), 'la administradora lo ve en Métricas');
const c0 = salidas.correos.length;
r = await op('v-resumen', { token: 'TA', body: { mandar: true } });
ok(r.body.enviado === true && salidas.correos.length === c0 + 1 && /Resumen semanal/.test(salidas.correos.at(-1).subject), '"Mandármelo al celular" lo manda a su correo de avisos');

// ═══════════════════════════════════════════════════════════
grupo('7 · Ticket de la Caja con extras');
const venta = (ids, tel) => op('v-pos-venta', { token: 'TA', body: { idLocal: 'L' + Math.random(), ids, evento: 'Barrio Chido', metodo: 'efectivo', cliente: { nombre: 'Mario', telefono: tel } } });
r = await venta([12], '8994440001');
ok(r.code === 200 && r.body.extras === null, 'apagado: el ticket va como antes');
await modulos({ cajaTicketWA: true, referidos: true });
await op('v-config', { token: 'TA', body: { frecuente: { activo: true, cada: 3, pct: 10 } } });
r = await venta([7], '8994440001');
ok(r.body.extras?.tienda?.includes('utm_source=qr') && r.body.extras.frecuente?.faltan === 1 && /^REF-/.test(r.body.extras.referido?.codigo || ''), 'prendido: link a la tienda, "te falta 1 compra" y su código para invitar');
r = await venta([], '8994440001');
ok(r.code === 400, 'ticket vacío: 400');
await modulos({ cajaTicketWA: false, referidos: false });

// ═══════════════════════════════════════════════════════════
grupo('8 · Envíos desde el panel');
fake.pedidos.push({ id: 'G1', bazarId: 1, estado: 'pagado', entrega: 'envio', entregaEstado: 'enviado', nombre: 'Envio Uno', telefono: '8991', guia: '999', paqueteria: 'Estafeta',
  guiaEnvia: { guia: '999', carrier: 'estafeta', paqueteria: 'Estafeta' }, clave: 'kg1', historial: [], items: [] },
  { id: 'G2', bazarId: 1, estado: 'pagado', entrega: 'envio', entregaEstado: 'enviado', nombre: 'Envio Dos', telefono: '8992', guia: '888', guiaEnvia: { guia: '888', carrier: 'estafeta' }, clave: 'kg2', historial: [], items: [] });
r = await op('v-envio-cancelar', { token: 'TA', body: { id: 'G1' } });
ok(r.code === 400 && !salidas.cancel.length, 'apagado: no se cancela nada');
await modulos({ enviosPanel: true });
r = await op('v-envio-cancelar', { token: 'TV', body: { id: 'G1' } });
ok(r.code === 403, 'un vendedor no cancela guías');
r = await op('v-envio-cancelar', { token: 'TA', body: { id: 'G1' } });
const g1 = fake.pedidos.find(p => p.id === 'G1');
ok(r.code === 200 && r.body.saldoDevuelto && salidas.cancel[0].carrier === 'estafeta' && salidas.cancel[0].trackingNumber === '999', 'cancela en envia.com con paquetería y guía');
ok(!g1.guiaEnvia && g1.entregaEstado === 'pendiente' && g1.guiasAnteriores[0].cancelada, 'el pedido vuelve a "Por enviar" y la guía queda en el historial');
r = await op('v-envio-recoleccion', { token: 'TA', body: { carrier: 'estafeta', fecha: '2020-01-01', desde: 9, hasta: 18 } });
ok(r.code === 400, 'una fecha pasada no se acepta');
r = await op('v-envio-recoleccion', { token: 'TA', body: { carrier: 'estafeta', fecha: '2099-01-10', desde: 9, hasta: 10 } });
ok(r.code === 400, 'horario de menos de 2 horas: 400');
r = await op('v-envio-recoleccion', { token: 'TA', body: { carrier: 'estafeta', fecha: '2099-01-10', desde: 9, hasta: 18 } });
ok(r.code === 200 && r.body.numero === 'PRP-123' && salidas.pickup[0].shipment.pickup.trackingNumbers.join() === '888' && salidas.pickup[0].origin.postalCode === '88500', 'recolección agendada con las guías que esperan y tu dirección de salida');
ok(fake.pedidos.find(p => p.id === 'G2').recoleccion?.numero === 'PRP-123', 'el pedido muestra su número de recolección');
r = await op('v-envio-recoleccion', { token: 'TA', body: { carrier: 'estafeta', fecha: '2099-01-10', desde: 9, hasta: 18 } });
ok([400, 409].includes(r.code) && salidas.pickup.length === 1, 'no se pide dos veces para los mismos paquetes');
await modulos({ enviosPanel: false });

// ═══════════════════════════════════════════════════════════
grupo('9 · Catálogo para Google Shopping');
r = await op('v-feed', { method: 'GET', query: { formato: 'google' } });
ok(r.code === 404, 'apagado: el link de Google no da catálogo');
await modulos({ feedGoogle: true });
r = await op('v-feed', { method: 'GET', query: { formato: 'google' } });
const csv = String(r.body);
ok(r.code === 200 && csv.split('\n')[0].includes('google_product_category') && csv.includes('"identifier_exists"') === false && csv.includes('"no"'), 'prendido: columnas que pide Google (categoría, sin código de barras)');
ok(/"5","Tenis Jordan".*"187"/.test(csv.replace(/\n/g, ' ')) || csv.includes('"187"'), 'los tenis van en la categoría de calzado de Google');
r = await op('v-feed', { method: 'GET' });
ok(!String(r.body).split('\n')[0].includes('google_product_category'), 'el catálogo de Instagram sigue igual');
await modulos({ feedGoogle: false });

// ═══════════════════════════════════════════════════════════
grupo('10 · Páginas por talla, precio, guías y drop');
r = await pedir(prendaApi, { method: 'GET', query: { landing: 'talla', slug: 'm' } });
ok(r.code === 302, 'apagado: /talla/m lleva a la tienda');
await modulos({ paginasTalla: true, guias: true, dropPagina: true });
r = await pedir(prendaApi, { method: 'GET', query: { landing: 'talla', slug: 'm' } });
ok(r.code === 200 && /<h1>Talla M<\/h1>/.test(html(r)) && /canonical" href="https:\/\/stiimpys\.store\/talla\/m"/.test(html(r)), '/talla/m con su título y canónica');
r = await pedir(prendaApi, { method: 'GET', query: { landing: 'precio', slug: 'menos-de-500' } });
ok(r.code === 200 && /Menos de \$500/.test(html(r)) && !/\$550/.test(html(r).replace(/Desde \$[\d,]+/, '')), '/precio/menos-de-500 solo con prendas de hasta $500');
r = await pedir(prendaApi, { method: 'GET', query: { landing: 'precio', slug: 'menos-de-123' } });
ok(r.code === 302, 'un precio que no está en la lista: a la tienda');
r = await pedir(prendaApi, { method: 'GET', query: { landing: 'guias' } });
ok(r.code === 200 && (html(r).match(/class="lista-guias"/) || []).length === 1 && /\/guias\/tallas-vintage-vs-actuales/.test(html(r)), '/guias con la lista');
r = await pedir(prendaApi, { method: 'GET', query: { landing: 'guias', slug: 'como-saber-si-unos-nike-son-originales' } });
ok(r.code === 200 && /"@type":"Article"/.test(html(r)) && /Prendas relacionadas/.test(html(r)) && /prenda\.html\?id=1"/.test(html(r)), 'una guía: artículo para Google y prendas Nike relacionadas');
r = await pedir(prendaApi, { method: 'GET', query: { landing: 'guias', slug: 'no-existe' } });
ok(r.code === 302 && r.h.location === '/guias', 'guía inexistente: a la lista');
fake.drops.push({ id: 'drop_1', nombre: 'Drop <Invierno>', fecha: new Date(Date.now() + 2 * 864e5).toISOString(), prendas: [2], publicado: false, bazarId: 1 });
fake.inventario.find(p => p.id === 2).oculto = true;
r = await pedir(prendaApi, { method: 'GET', query: { landing: 'drop', id: 'drop_1' } });
ok(r.code === 200 && /id="reloj"/.test(html(r)) && /e_blur:1200/.test(html(r)) && !html(r).includes('Pantalón cargo Dickies') && html(r).includes('Drop &lt;Invierno&gt;'), 'drop antes de salir: cuenta regresiva, fotos borrosas, sin nombres, nombre escapado');
ok(html(r).includes('/tienda.html?avisame-drop=drop_1'), 'botón "Avísame" que abre el aviso en la tienda');
fake.drops[0].fecha = new Date(Date.now() - 1000).toISOString(); fake.inventario.find(p => p.id === 2).oculto = false;
r = await pedir(prendaApi, { method: 'GET', query: { landing: 'drop', id: 'drop_1' } });
ok(r.code === 200 && /Ya salió/.test(html(r)) && html(r).includes('Pantalón cargo Dickies'), 'ya salió: muestra las prendas');
r = await pedir(prendaApi, { method: 'GET', query: { landing: 'drop', id: 'nada' } });
ok(r.code === 302, 'drop inexistente: a la tienda');
r = await pedir(prendaApi, { method: 'GET', query: { sitemap: '1' } });
ok(/\/talla\/m</.test(html(r)) && /\/precio\/menos-de-500</.test(html(r)) && /\/guias\/como-cuidar-ropa-vintage</.test(html(r)), 'el sitemap agrega tallas, precios y guías');
await modulos({ paginasMarca: false });
r = await pedir(prendaApi, { method: 'GET', query: { landing: 'marca', slug: 'nike' } });
ok(r.code === 302, 'apagar "Páginas por marca" las quita');
r = await pedir(prendaApi, { method: 'GET', query: { sitemap: '1' } });
ok(!/\/marca\//.test(html(r)), 'y salen del sitemap');
await modulos({ paginasMarca: true, paginasTalla: false, guias: false, dropPagina: false });
r = await pedir(prendaApi, { method: 'GET', query: { landing: 'guias' } });
ok(r.code === 302, 'apagar "Guías" las quita');

// ═══════════════════════════════════════════════════════════
grupo('11 · Medidas y sello "Revisada a mano"');
r = await pedir(itemApi, { method: 'PATCH', query: { id: '4' }, token: 'TA', body: { medidas: { largo: 72, ancho: '55.5', manga: -3, cintura: 9999, inventada: 5, $where: 1 }, revisada: 'true' } });
const p4 = fake.inventario.find(p => p.id === 4);
ok(r.code === 200 && p4.medidas.largo === 72 && p4.medidas.ancho === 55.5 && !('manga' in p4.medidas) && !('cintura' in p4.medidas) && !('inventada' in p4.medidas) && p4.revisada === true, 'solo medidas conocidas y razonables (1–300 cm); el sello es sí/no');
r = await pedir(itemApi, { method: 'PATCH', query: { id: '4' }, token: 'TA', body: { medidas: '<script>' } });
ok(fake.inventario.find(p => p.id === 4).medidas === null, 'basura en medidas: se borra');
sinCache();
r = await pedir(syncApi, { method: 'GET', query: { scope: 'publico' } });
ok('revisada' in (r.body?.datos || r.body).inventario.find(p => p.id === 4), 'la tienda recibe el sello');

// ═══════════════════════════════════════════════════════════
grupo('12 · Google Maps y origen apagado');
r = await op('v-config', { token: 'TA', body: { google: { maps: 'https://maps.app.goo.gl/abc', resena: 'javascript:alert(1)' } } });
ok(r.body.config.google.maps === 'https://maps.app.goo.gl/abc' && r.body.config.google.resena === '', 'solo se aceptan links de Google');
await op('v-config', { token: 'TA', body: { google: { maps: 'https://maps.app.goo.gl/abc', resena: 'https://g.page/r/xyz/review' } } });
fake.pedidos.find(p => p.id === P1).entregaEstado = 'entregado';
r = await op('v-pedido', { method: 'GET', query: { id: P1, k: K1 } });
ok(!r.body.googleResena, 'apagado: no se pide reseña en Google');
await modulos({ googleMaps: true });
r = await op('v-pedido', { method: 'GET', query: { id: P1, k: K1 } });
ok(r.body.googleResena === 'https://g.page/r/xyz/review', 'prendido y entregado: "Déjanos tu reseña en Google"');
sinCache();
r = await pedir(syncApi, { method: 'GET', query: { scope: 'publico' } });
ok((r.body?.datos || r.body).tienda.porBazar['1'].google?.maps === 'https://maps.app.goo.gl/abc', 'la tienda recibe el link del perfil para el inicio');
await modulos({ origenVentas: false });
const antes = fake.origenStats.length;
r = await op('v-evento', { body: { tipo: 'llegada', origen: { fuente: 'tiktok' } } });
ok(r.body.apagado === true && fake.origenStats.length === antes, 'origen apagado: no se cuentan visitas');
r = await op('v-pagar', { body: { ids: [11], nombre: 'Sin Origen', telefono: '8997770009', entrega: 'persona', punto: 'zona-centro', metodo: 'spei', origen: { fuente: 'instagram' } } });
ok(fake.pedidos.find(p => p.id === r.body.pedido).origen.fuente === 'directo', 'ni se guarda de dónde vino el pedido');

console.log(process.exitCode ? '\n✘ v43 con fallas' : '\n✔ v43: todo bien');
