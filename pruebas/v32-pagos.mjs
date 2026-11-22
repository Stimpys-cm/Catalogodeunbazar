process.env.CLIP_API_KEY = 'k'; process.env.CLIP_SECRET_KEY = 's';
const { fake } = await import('./.tmp/api/_lib/db.js');
const { handleCrecer } = await import('./.tmp/api/_lib/crecer.js');
let n = 0; const clipEstado = {}; const clipMonto = {}; let falla = false;
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  const J = (j, st = 200) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j) });
  if (url.includes('payclip.com/v2/checkout') && o.method === 'POST') {
    if (falla) return J({ message: 'caído' }, 500);
    const b = JSON.parse(o.body); const id = 'pr_' + (++n); clipEstado[id] = 'CHECKOUT_CREATED'; clipMonto[id] = b.amount;
    return J({ payment_request_id: id, payment_request_url: 'https://clip/' + id });
  }
  if (url.includes('payclip.com/v2/checkout/')) { const id = url.split('/').pop(); return J({ status: clipEstado[id], amount: clipMonto[id], receipt_no: 'R' + id }); }
  return J({}, 404);
};
const call = async (op, body = {}, query = {}, method = 'POST', headers = {}) => {
  const res = { code: 200, body: null, h: {}, status(c) { this.code = c; return this; }, json(j) { this.body = j; return this; }, end() { return this; }, send(x) { this.body = x; return this; }, setHeader(k, v) { this.h[k] = v; } };
  await handleCrecer({ method, body, query, headers: { 'x-real-ip': String(Math.random()), ...headers } }, res, op);
  return res;
};
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
fake.inventario = [
  { _id: 1, id: 1, bazarId: 1, nombre: 'Playera A', precio_venta: 300, talla: 'M', imagenes: ['https://x/a.jpg'] },
  { _id: 2, id: 2, bazarId: 1, nombre: 'Sudadera B', precio_venta: 500, talla: 'L', imagenes: ['https://x/b.jpg'] },
  { _id: 3, id: 3, bazarId: 1, nombre: 'Chamarra C', precio_venta: 800, talla: 'L', imagenes: ['https://x/c.jpg'] },
];
fake.bazares = [{ id: 1, nombre: 'Stiimpys', whatsapp: '8990000000', slug: 'stiimpys' }];
fake.tiendaConfig = [{ bazarId: 1, cupones: [{ codigo: 'MITAD', tipo: 'pct', valor: 50, activo: true }, { codigo: 'LOCO', tipo: 'pct', valor: 150, activo: true }] }];
const cli = (x = {}) => ({ ids: [1], nombre: 'Ana López Ruiz', telefono: '8991234567', punto: 'zona-centro', metodo: 'clip', ...x });

// 1) Dos personas pagan la misma prenda al mismo tiempo
const [r1, r2] = await Promise.all([call('v-pagar', cli()), call('v-pagar', cli({ nombre: 'Beto', telefono: '8997654321' }))]);
ok([r1.code, r2.code].sort().join() === '200,409', `carrera: una sola obtiene link (${r1.code}, ${r2.code})`);
const gana = r1.code === 200 ? r1 : r2;
const p1 = fake.inventario.find(p => p.id === 1);
ok(p1.apartada && p1.reservedBy.pedido === gana.body.pedido, 'la prenda queda apartada al pedido que ganó');

// 2) Falla Clip: la prenda vuelve como estaba
falla = true;
const r3 = await call('v-pagar', cli({ ids: [2] }));
falla = false;
const p2 = fake.inventario.find(p => p.id === 2);
ok(r3.code === 502 && !p2.apartada && !p2.reservedBy, 'si Clip falla, se suelta el apartado temporal');

// 3) Reintento del mismo cliente con su pedido previo (debe poder)
const r4 = await call('v-pagar', cli({ previo: { id: gana.body.pedido, clave: gana.body.clave } , nombre: gana === r1 ? 'Ana López Ruiz' : 'Beto'}));
ok(r4.code === 200, 'el mismo cliente puede reintentar con su pedido previo');
ok(fake.pedidos.find(p => p.id === gana.body.pedido).estado === 'reemplazado', 'el pedido anterior queda reemplazado');

// 4) Se paga: webhook → vendida + venta + pendiente
const ped = fake.pedidos.find(p => p.id === r4.body.pedido);
clipEstado[ped.clipId] = 'CHECKOUT_COMPLETED';
await call('v-clip-webhook', { payment_request_id: ped.clipId });
ok(fake.inventario.find(p => p.id === 1).vendido === true, 'webhook confirma y marca vendida');
ok(fake.ventas?.length === 1 && fake.ventas[0].precio === 300, 'se registra 1 venta por $300');
ok(fake.pendientes.some(p => p.titulo === 'Pago recibido'), 'llega "Pago recibido" a Pendientes');

// 5) Cupón: tope de 100 % y uso atómico
const r5 = await call('v-cotizar', { ids: [2], cupon: 'LOCO' });
ok(r5.body.descCupon <= r5.body.subtotal, `cupón de 150 % no pasa del subtotal (desc ${r5.body.descCupon} de ${r5.body.subtotal})`);
const r6 = await call('v-pagar', cli({ ids: [2], cupon: 'MITAD' }));
const ped6 = fake.pedidos.find(p => p.id === r6.body.pedido);
ok(r6.body.total === 250, `cupón 50% sobre $500 = $250 (${r6.body.total})`);
clipEstado[ped6.clipId] = 'CHECKOUT_COMPLETED';
await call('v-pedido', {}, { id: ped6.id, k: ped6.clave }, 'GET');
ok(fake.tiendaConfig[0].cupones.find(c => c.codigo === 'MITAD').usos === 1, 'el uso del cupón se suma una vez');
await call('v-clip-webhook', { payment_request_id: ped6.clipId });
ok(fake.tiendaConfig[0].cupones.find(c => c.codigo === 'MITAD').usos === 1, 'webhook repetido no vuelve a sumar');

// 6) Apartado con anticipo
const r7 = await call('v-pagar', cli({ ids: [3], modo: 'apartado' }));
ok(r7.code === 200 && r7.body.cobrar === 400, `anticipo 50% de $800 = $400 (${r7.body.cobrar})`);
const ped7 = fake.pedidos.find(p => p.id === r7.body.pedido);
clipEstado[ped7.clipId] = 'CHECKOUT_COMPLETED';
const v7 = await call('v-pedido', {}, { id: ped7.id, k: ped7.clave }, 'GET');
ok(v7.body.estado === 'apartado' && v7.body.apartado.resta === 400, 'queda apartado y faltan $400');
const r8 = await call('v-pagar', cli({ ids: [3], nombre: 'Otra', telefono: '8110000000' }));
ok(r8.code === 409, 'nadie más puede pagar una prenda apartada con anticipo');
const r9 = await call('v-pagar-resto', { id: ped7.id, k: ped7.clave });
ok(r9.code === 200 && r9.body.monto === 400, 'link para pagar el resto por $400');
const liq = fake.pedidos.find(p => p.id === ped7.id).liquidaciones.at(-1);
clipEstado[liq.clipId] = 'CHECKOUT_COMPLETED';
const v9 = await call('v-pedido', {}, { id: ped7.id, k: ped7.clave }, 'GET');
ok(v9.body.estado === 'pagado' && fake.inventario.find(p => p.id === 3).vendido, 'al pagar el resto queda pagado y vendida');

// 7) Panel: permisos
fake.usuarios = [{ id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA' }, { id: 2, username: 'vende', role: 'vendedor', bazarId: 2, sessionToken: 'TV' }];
fake.listaEspera = [{ id: 'e1', bazarId: 1, nombre: 'X', telefono: '8990001111', tipo: 'prenda', avisado: false }];
const r10 = await call('v-espera-borrar', { id: 'e1' }, {}, 'POST', { authorization: 'Bearer TV' });
ok(r10.code === 404 && fake.listaEspera.length === 1, 'un vendedor de otro bazar no borra interesados ajenos');
const r11 = await call('v-respaldos', {}, {}, 'GET', { authorization: 'Bearer TV' });
ok(r11.code === 403, 'un vendedor no descarga respaldos');
const r12 = await call('v-espera-borrar', { id: 'e1' }, {}, 'POST', { authorization: 'Bearer TA' });
ok(r12.code === 200 && fake.listaEspera.length === 0, 'la administradora sí lo borra');
// Oferta aceptada no pisa apartado ajeno
fake.inventario.push({ _id: 9, id: 9, bazarId: 1, nombre: 'Gorra', precio_venta: 200, apartada: true, reservedUntil: new Date(Date.now() + 3600e3).toISOString(), reservedBy: { nombre: 'Luis', pedido: 'PX', canal: 'clip' } });
fake.ofertas = [{ id: 5, prendaId: 9, bazarId: 1, nombre: 'Rosa', telefono: '8992223333', monto: 150, prendaNombre: 'Gorra', estado: 'nueva' }];
const r13 = await call('v-oferta-responder', { id: 5, accion: 'aceptar' }, {}, 'POST', { authorization: 'Bearer TA' });
ok(r13.code === 409 && fake.inventario.find(p => p.id === 9).reservedBy.nombre === 'Luis', 'aceptar oferta no pisa un apartado de otra persona');
fake.inventario.push({ _id: 10, id: 10, bazarId: 1, nombre: 'Lentes', precio_venta: 100 });
const r14 = await call('v-pagar', cli({ ids: [10], cupon: 'LOCO' }));
ok(r14.code === 400 && !fake.inventario.find(p => p.id === 10).apartada, 'pedido en $0 se rechaza sin dejar la prenda apartada');
