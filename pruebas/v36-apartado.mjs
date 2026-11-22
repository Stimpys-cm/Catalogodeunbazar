// Pruebas v36: apartado de 10 minutos mientras se paga en línea, con contador
// (base en memoria + Clip y PayPal simulados; nada toca servicios reales)
process.env.CLIP_API_KEY = 'k'; process.env.CLIP_SECRET_KEY = 's';
process.env.PAYPAL_CLIENT_ID = 'pp'; process.env.PAYPAL_CLIENT_SECRET = 'pps';

const { fake, getDB } = await import('./.tmp/api/_lib/db.js');
const acciones = (await import('./.tmp/api/acciones.js')).default;
const syncApi = (await import('./.tmp/api/sync.js')).default;
const { prendaPublica } = await import('./.tmp/api/_lib/bazar.js');
const { vigenciaClip, MINUTOS_PAGO, revisarPagoDePedido } = await import('./.tmp/api/_lib/crecer.js');

// ── Servicios simulados ──
let n = 0; const clip = {}, ordenes = {}; let capturas = 0; const clipCuerpos = [];
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  const J = (j, st = 200) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j) });
  if (url.includes('payclip.com/v2/checkout') && o.method === 'POST') {
    const b = JSON.parse(o.body); clipCuerpos.push(b); const id = 'pr_' + (++n); clip[id] = { status: 'CHECKOUT_CREATED', amount: b.amount };
    return J({ payment_request_id: id, payment_request_url: 'https://clip/' + id });
  }
  if (url.includes('payclip.com/v2/checkout/')) {
    const id = decodeURIComponent(url.split('/').pop()); const c = clip[id];
    return c ? J({ status: c.status, amount: c.amount, receipt_no: 'R' + id }) : J({}, 404);
  }
  if (url.endsWith('/v1/oauth2/token')) return J({ access_token: 'tok', expires_in: 3600 });
  if (url.endsWith('/v2/checkout/orders') && o.method === 'POST') {
    const b = JSON.parse(o.body); const id = 'OP' + (++n);
    ordenes[id] = { id, status: 'CREATED', total: b.purchase_units[0].amount.value };
    return J({ id, links: [{ rel: 'payer-action', href: 'https://paypal/' + id }] });
  }
  if (url.includes('/v2/checkout/orders/') && url.endsWith('/capture')) {
    const id = decodeURIComponent(url.split('/').slice(-2)[0]); const ord = ordenes[id]; capturas++;
    ord.status = 'COMPLETED';
    return J({ id, status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP' + id, status: 'COMPLETED', amount: { value: ord.total, currency_code: 'MXN' } }] } }] });
  }
  if (url.includes('/v2/checkout/orders/')) {
    const id = decodeURIComponent(url.split('/').pop()); const ord = ordenes[id];
    if (!ord) return J({}, 404);
    return J(ord.status === 'COMPLETED'
      ? { id, status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP' + id, status: 'COMPLETED', amount: { value: ord.total, currency_code: 'MXN' } }] } }] }
      : { id, status: ord.status });
  }
  return J({}, 404);
};

const mk = () => ({ statusCode: 200, body: undefined, h: {}, headersSent: false, writableEnded: false,
  status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; this.headersSent = this.writableEnded = true; return this; },
  send(x) { this.body = x; this.headersSent = this.writableEnded = true; return this; }, end(x) { if (x !== undefined) this.body = x; this.headersSent = this.writableEnded = true; return this; },
  setHeader(k, v) { this.h[k.toLowerCase()] = v; } });
let ipN = 0;
const pedir = async (fn, { method = 'POST', query = {}, body, token } = {}) => {
  const res = mk();
  await fn({ method, query, body, url: '/api/x', headers: { 'x-real-ip': '10.1.0.' + (++ipN % 250), ...(token ? { authorization: 'Bearer ' + token } : {}) } }, res);
  return { code: res.statusCode, body: res.body, h: res.h };
};
const op = (o, args = {}) => pedir(acciones, { ...args, query: { op: o, ...(args.query || {}) } });
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);

fake.bazares = [{ id: 1, nombre: 'Stiimpys', whatsapp: '8990000000', slug: 'stiimpys', permisos: {} }];
fake.usuarios = [{ id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA' }];
const prenda = (id, precio, extra = {}) => ({ id, bazarId: 1, nombre: `Prenda ${id}`, precio_venta: precio, talla: 'M', imagenes: ['https://x/' + id + '.jpg'], ...extra });
fake.inventario = [prenda(1, 300), prenda(2, 500), prenda(3, 400), prenda(4, 250)];
fake.tiendaConfig = [{ bazarId: 1 }];
const cli = (x = {}) => ({ ids: [1], nombre: 'Ana López', telefono: '8991234567', punto: 'zona-centro', metodo: 'clip', ...x });
const pr = id => fake.inventario.find(p => p.id === id);
const pedidoDe = id => fake.pedidos.find(p => p.id === id);
const minDesde = iso => (Date.parse(iso) - Date.now()) / 60000;

// ═══════════════════════════════════════════════════════════
grupo('1 · El apartado mientras se paga dura 10 minutos');
ok(MINUTOS_PAGO === 10, 'MINUTOS_PAGO = 10');
const r1 = await op('v-pagar', { body: cli() });
ok(r1.code === 200, `pedido creado (${r1.code} ${r1.body?.error || ''})`);
const p1 = pedidoDe(r1.body.pedido);
// Fuera de los minutos finales del día de Clip, el link y el apartado vencen a los 10 min
const v = vigenciaClip(Date.now());
if (v) {
  ok(Math.abs(minDesde(p1.expira) - 10) < 0.2 || minDesde(p1.expira) <= 10, `el pedido vence en ~10 min (${minDesde(p1.expira).toFixed(2)})`);
  ok(Math.abs(minDesde(pr(1).reservedUntil) - minDesde(p1.expira)) < 0.01, 'la prenda queda apartada hasta la misma hora');
  ok(clipCuerpos.at(-1).expires_at && Math.abs(minDesde(clipCuerpos.at(-1).expires_at) - minDesde(p1.expira)) < 0.05, 'el link de Clip vence junto con el apartado');
} else ok(true, 'hora límite de Clip del día: el link usa su vigencia normal (caso de borde)');
// vigenciaClip en distintas horas
const base = Date.UTC(2026, 10, 18, 15, 0, 0);   // 9:00 a. m. en Reynosa
const v9 = vigenciaClip(base);
ok(v9 && Math.round((Date.parse(v9.iso) - base) / 60000) === 10, `9:00 → el link vence a los 10 min (${v9 && Math.round((Date.parse(v9.iso) - base) / 60000)})`);
const cerca = Date.UTC(2026, 10, 18, 23, 52, 0);  // 6 min antes del corte de Clip (23:58 UTC)
const vc = vigenciaClip(cerca);
ok(vc && Math.round((Date.parse(vc.iso) - cerca) / 60000) === 6, 'a 6 min del corte del día: vence en el corte (6 min)');
ok(vigenciaClip(Date.UTC(2026, 10, 18, 23, 56, 0)) === null, 'a 2 min del corte: Clip usa su vigencia normal');

// ═══════════════════════════════════════════════════════════
grupo('2 · La tienda recibe el contador, nunca quién está pagando');
const pub = prendaPublica(pr(1));
ok(pub.apartada === true && pub.pagandoHasta && Math.abs(minDesde(pub.pagandoHasta) - minDesde(p1.expira)) < 0.01, 'prenda en pago: apartada + pagandoHasta');
ok(!('reservedBy' in pub) && !('reservedUntil' in pub) && !JSON.stringify(pub).includes('Ana'), 'no sale el nombre ni los datos de quien paga');
const vieja = prendaPublica({ ...pr(1), reservedUntil: new Date(Date.now() - 60e3).toISOString() });
ok(vieja.apartada === false && !vieja.pagandoHasta, 'apartado de pago vencido: se ve libre');
const conAnticipo = prendaPublica(prenda(9, 100, { apartada: true, reservedUntil: new Date(Date.now() - 60e3).toISOString(), reservedBy: { pedido: 'PX', anticipo: 50 } }));
ok(conAnticipo.apartada === true && !conAnticipo.pagandoHasta, 'apartado con anticipo: sigue apartado aunque pase la fecha (no lleva contador de 10 min)');
const manual = prendaPublica(prenda(9, 100, { apartada: true, reservedUntil: new Date(Date.now() + 86400e3).toISOString(), reservedBy: { nombre: 'Beto', telefono: '1' } }));
ok(manual.apartada === true && !manual.pagandoHasta, 'apartado por WhatsApp desde el panel: igual que antes, sin contador');
const s1 = await pedir(syncApi, { method: 'GET', query: { scope: 'publico' } });
const sb = typeof s1.body === 'string' ? JSON.parse(s1.body) : s1.body;
const enSync = (sb?.inventario || []).find(x => x.id === 1);
ok(enSync?.pagandoHasta && !enSync.reservedBy, '/api/sync público trae pagandoHasta');
// v37 · La página del carrito muestra el contador de la prenda que alguien más está pagando
const cq = await op('v-cotizar', { body: { ids: [1], bazarId: 1 } });
const nd = (cq.body?.noDisponibles || []).find(x => x.id === 1);
ok(nd && nd.motivo === 'apartada' && nd.hasta && Math.abs(minDesde(nd.hasta) - minDesde(p1.expira)) < 0.01 && !JSON.stringify(cq.body).includes('Ana'),
  'v-cotizar: la prenda en pago sale como no disponible con su hora de fin (sin datos de quien paga)');

// ═══════════════════════════════════════════════════════════
grupo('3 · Otro cliente: bloqueado mientras corre; libre al terminar');
const r2 = await op('v-pagar', { body: cli({ ids: [1], nombre: 'Beto Ruiz', telefono: '8997654321' }) });
ok(r2.code === 409, `mientras corre el contador, otro cliente no la puede pagar (${r2.code})`);
// Se acaban los 10 minutos
pr(1).reservedUntil = p1.expira = new Date(Date.now() - 1000).toISOString();
const r3 = await op('v-pagar', { body: cli({ ids: [1], nombre: 'Beto Ruiz', telefono: '8997654321' }) });
ok(r3.code === 200 && pr(1).reservedBy?.pedido === r3.body.pedido, 'al vencer, el segundo cliente sí la puede pagar');

// ═══════════════════════════════════════════════════════════
grupo('4 · PayPal: aprobado tarde y la prenda ya la tiene otro → NO se cobra');
const r4 = await op('v-pagar', { body: cli({ ids: [2], metodo: 'paypal' }) });
ok(r4.code === 200 && r4.body.proveedor === 'paypal', `pedido PayPal creado (${r4.code} ${r4.body?.error || ''})`);
const p4 = pedidoDe(r4.body.pedido);
// Pasan los 10 min, otro cliente la aparta con Clip, y luego el primero aprueba en PayPal
pr(2).reservedUntil = p4.expira = new Date(Date.now() - 1000).toISOString();
const r5 = await op('v-pagar', { body: cli({ ids: [2], nombre: 'Caro Díaz', telefono: '8990001111' }) });
ok(r5.code === 200, 'otro cliente la aparta con Clip después de los 10 min');
ordenes[p4.paypalId].status = 'APPROVED';
const antes = capturas;
const db = await getDB();
const est = await revisarPagoDePedido(db, pedidoDe(p4.id));
ok(capturas === antes, 'no se cobró la orden de PayPal');
ok(est === 'expirado' && pedidoDe(p4.id).estado === 'expirado' && pedidoDe(p4.id).noCobrado, `el pedido queda vencido sin cobro (${est})`);
ok(!pr(2).vendido && pr(2).reservedBy?.pedido === r5.body.pedido, 'la prenda sigue apartada para quien sí llegó a tiempo');
ok((pedidoDe(p4.id).historial || []).some(h => /no se cobró/.test(h.accion)), 'queda en el historial del pedido');

grupo('5 · PayPal: aprobado tarde pero la prenda sigue libre → se cobra y se vende');
const r6 = await op('v-pagar', { body: cli({ ids: [3], metodo: 'paypal', nombre: 'Dani Paz', telefono: '8992223333' }) });
const p6 = pedidoDe(r6.body.pedido);
pr(3).reservedUntil = p6.expira = new Date(Date.now() - 1000).toISOString();
ordenes[p6.paypalId].status = 'APPROVED';
const est6 = await revisarPagoDePedido(db, pedidoDe(p6.id));
ok(est6 === 'pagado' && pr(3).vendido, `nadie la tomó: se cobra y queda vendida (${est6})`);

grupo('6 · Clip a tiempo: se cobra normal');
const r7 = await op('v-pagar', { body: cli({ ids: [4], nombre: 'Eva Sol', telefono: '8994445555' }) });
clip[pedidoDe(r7.body.pedido).clipId].status = 'CHECKOUT_COMPLETED';
const est7 = await revisarPagoDePedido(db, pedidoDe(r7.body.pedido));
ok(est7 === 'pagado' && pr(4).vendido, 'pago de Clip dentro de los 10 min: vendido');
