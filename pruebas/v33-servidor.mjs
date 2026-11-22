// Pruebas automáticas v33 (base en memoria + Clip/Resend/Cloudinary simulados)
// Nada aquí toca servicios reales.
process.env.CLIP_API_KEY = 'k'; process.env.CLIP_SECRET_KEY = 's';
process.env.RESEND_API_KEY = 're_x'; process.env.CORREO_DESDE = 'Stiimpys <hola@stiimpys.store>';
process.env.CLOUDINARY_CLOUD_NAME = 'demo'; process.env.CLOUDINARY_API_KEY = 'ck'; process.env.CLOUDINARY_API_SECRET = 'cs';

const { fake } = await import('./.tmp/api/_lib/db.js');
const acciones = (await import('./.tmp/api/acciones.js')).default;
const itemApi = (await import('./.tmp/api/inventario-item.js')).default;
const authApi = (await import('./.tmp/api/auth.js')).default;
const syncApi = (await import('./.tmp/api/sync.js')).default;
const { hashPassword } = await import('./.tmp/api/_lib/password.js');

// ── Servicios simulados ──
let n = 0; const clip = {}; let clipCaido = false, clipCred = true, resendModo = 'ok', resendDominios = 'restricted', cloudOk = true;
const enviados = [];
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  const J = (j, st = 200) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j) });
  if (url.includes('payclip.com/v2/checkout') && o.method === 'POST') {
    if (clipCaido) return J({ message: 'caído' }, 503);
    const b = JSON.parse(o.body); const id = 'pr_' + (++n); clip[id] = { status: 'CHECKOUT_CREATED', amount: b.amount };   // estado inicial real de Clip
    return J({ payment_request_id: id, payment_request_url: 'https://clip/' + id });
  }
  if (url.includes('payclip.com/v2/checkout/')) {
    if (!clipCred) return J({ message: 'unauthorized' }, 401);
    const id = decodeURIComponent(url.split('/').pop()); const c = clip[id];
    return c ? J({ status: c.status, amount: c.amount, receipt_no: 'R' + id }) : J({ message: 'not found' }, 404);
  }
  if (url === 'https://api.resend.com/emails') {
    const b = JSON.parse(o.body); enviados.push(b);
    return resendModo === 'ok' ? J({ id: 'em_' + enviados.length }) : J({ name: 'validation_error', message: 'The domain is not verified' }, 403);
  }
  if (url === 'https://api.resend.com/domains') {
    if (resendDominios === 'restricted') return J({ name: 'restricted_api_key', message: 'This API key is restricted to only send emails' }, 401);
    return J({ data: [{ name: 'stiimpys.store', status: resendDominios }] });
  }
  if (url.includes('api.cloudinary.com') && url.endsWith('/ping')) return cloudOk ? J({ status: 'ok' }) : J({ error: { message: 'bad' } }, 401);
  return J({}, 404);
};

const mk = () => ({ statusCode: 200, body: undefined, h: {}, headersSent: false, writableEnded: false,
  status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; this.headersSent = this.writableEnded = true; return this; },
  send(x) { this.body = x; this.headersSent = this.writableEnded = true; return this; }, end(x) { if (x !== undefined) this.body = x; this.headersSent = this.writableEnded = true; return this; },
  setHeader(k, v) { this.h[k.toLowerCase()] = v; } });
let ipN = 0;
const pedir = async (fn, { method = 'POST', query = {}, body, token, headers = {} } = {}) => {
  const res = mk();
  await fn({ method, query, body, url: '/api/x', headers: { 'x-real-ip': '10.0.0.' + (++ipN % 250), ...(token ? { authorization: 'Bearer ' + token } : {}), ...headers } }, res);
  return { code: res.statusCode, body: res.body, h: res.h };
};
const op = (o, args = {}) => pedir(acciones, { ...args, query: { op: o, ...(args.query || {}) } });

const resultados = [];
const ok = (c, m) => { resultados.push([!!c, m]); console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);

// ── Datos ──
const futuro = h => new Date(Date.now() + h * 3600e3).toISOString();
fake.bazares = [{ id: 1, nombre: 'Stiimpys', whatsapp: '8990000000', slug: 'stiimpys', permisos: {} },
  { id: 2, nombre: 'Otro', slug: 'otro', permisos: { crearPrendas: true, editarPrendas: true, borrarPrendas: true } }];
fake.usuarios = [
  { id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA', password: await hashPassword('Secreta#2026') },
  { id: 2, username: 'vende', role: 'vendedor', bazarId: 1, sessionToken: 'TV' },
  { id: 3, username: 'admin2', role: 'admin', bazarId: 2, sessionToken: 'T2' },
];
fake.clientes = [{ username: 'compradora' }];
const prenda = (id, precio, extra = {}) => ({ id, bazarId: 1, nombre: `Prenda ${id}`, precio_venta: precio, talla: 'M', imagenes: ['https://x/' + id + '.jpg'], ...extra });
fake.inventario = [prenda(1, 300), prenda(2, 500), prenda(3, 800), prenda(4, 400), prenda(5, 250), prenda(6, 600), prenda(7, 350), prenda(8, 450),
  { ...prenda(20, 200), bazarId: 2, nombre: 'Gorra bazar 2' }];
fake.tiendaConfig = [{ bazarId: 1, cupones: [{ codigo: 'MITAD', tipo: 'pct', valor: 50, activo: true }] }];
const cli = (x = {}) => ({ ids: [1], nombre: 'Ana López Ruiz', telefono: '8991234567', email: 'ana.lopez@gmail.com', punto: 'zona-centro', metodo: 'clip', ...x });
const pedidoDe = id => fake.pedidos.find(p => p.id === id);
const pr = id => fake.inventario.find(p => p.id === id);
const ev = f => (fake.actividad || []).filter(f);

// ═══════════════════════════════════════════════════════════
grupo('1 · Compatibilidad con v32: flujo de pago completo');
const c1 = await op('v-pagar', { body: cli({ cupon: 'MITAD', ids: [2] }) });
ok(c1.code === 200 && c1.body.total === 250, `pedido creado con cupón: $${c1.body?.total}`);
const p1 = pedidoDe(c1.body.pedido);
ok(pr(2).apartada && pr(2).reservedBy.pedido === p1.id, 'la prenda queda apartada al pedido mientras paga');
clip[p1.clipId].status = 'CHECKOUT_COMPLETED';
const w1 = await op('v-clip-webhook', { body: { payment_request_id: p1.clipId, status: 'COMPLETED' } });
ok(w1.code === 200 && pedidoDe(p1.id).estado === 'pagado' && pr(2).vendido, 'aviso de Clip → se consulta a Clip → pagado y vendida');
ok((fake.ventas || []).length === 1, 'se registra una venta');
const w1b = await op('v-clip-webhook', { body: { payment_request_id: p1.clipId } });
ok(w1b.code === 200 && fake.ventas.length === 1 && fake.tiendaConfig[0].cupones[0].usos === 1, 'aviso repetido: no duplica la venta ni el uso del cupón');

grupo('2 · Centro de actividad: eventos de pagos, pedidos, cupones y correos');
ok(ev(e => e.tipo === 'pedido.creado' && e.pedidoId === p1.id).length === 1, 'evento "pedido creado"');
ok(ev(e => e.tipo === 'pago.confirmado' && e.pedidoId === p1.id && e.resultado === 'ok').length === 1, 'evento "pago confirmado" (una sola vez)');
ok(ev(e => e.tipo === 'clip.webhook' && e.pedidoId === p1.id).length === 2, 'cada aviso de Clip queda registrado');
ok(ev(e => e.tipo === 'cupon.aplicado').length === 1 && ev(e => e.tipo === 'cupon.uso').length === 1, 'cupón aplicado y uso contado');
const correo = ev(e => e.categoria === 'correo' && e.pedidoId === p1.id);
ok(correo.length === 1 && correo[0].resultado === 'ok' && correo[0].detalle.para === 'an•••@gmail.com', `correo de recibo registrado con destinatario enmascarado (${correo[0]?.detalle?.para})`);
ok(enviados.length === 1 && enviados[0].to[0] === 'ana.lopez@gmail.com', 'el correo sí se mandó a la dirección real');
const h1 = pedidoDe(p1.id).historial || [];
ok(h1.length >= 2 && h1[0].a === 'pendiente' && h1.some(x => x.a === 'pagado'), `historial del pedido: ${h1.map(x => x.a || '·').join(' → ')}`);

grupo('3 · Sin datos sensibles en el registro');
const todo = JSON.stringify(fake.actividad);
ok(!todo.includes('8991234567'), 'no aparece ningún teléfono completo');
ok(!todo.includes('ana.lopez@gmail.com'), 'no aparece ningún correo completo');
ok(!todo.includes(p1.clave), 'no aparece la clave privada del pedido');
ok(!/"TA"|"TV"|Bearer TA/.test(todo), 'no aparecen tokens de sesión');

grupo('4 · Cancelar pedidos con validaciones');
const c2 = await op('v-pagar', { body: cli({ ids: [3], telefono: '8111111111', nombre: 'Beto' }) });
const p2 = pedidoDe(c2.body.pedido);
const x1 = await op('v-pedido-estado', { token: 'TA', body: { id: p2.id, accion: 'cancelar', motivo: 'El cliente avisó que no lo quiere' } });
ok(x1.code === 200 && pedidoDe(p2.id).estado === 'cancelado' && !pr(3).apartada, 'pedido pendiente (Clip sin pago) → cancelado y prenda liberada');
ok((pedidoDe(p2.id).historial || []).some(h => h.a === 'cancelado' && h.por === 'jefa'), 'el historial dice quién lo canceló');
const x1b = await op('v-pedido-estado', { token: 'TA', body: { id: p2.id, accion: 'cancelar' } });
ok(x1b.code === 409, 'cancelar dos veces → rechazado');
// Pago que llega después de cancelar
clip[p2.clipId].status = 'CHECKOUT_COMPLETED';
await op('v-clip-webhook', { body: { payment_request_id: p2.clipId } });
ok(pedidoDe(p2.id).estado === 'cancelado' && pedidoDe(p2.id).pagoTrasCancelar && !pr(3).vendido, 'pago tras cancelar: NO se vende, se marca para devolver');
ok(fake.pendientes.some(p => p.pedido === p2.id && p.titulo === 'Devolver dinero'), 'llega "Devolver dinero" a Pendientes');
// Cancelar uno que sí pagó (aviso perdido)
const c3 = await op('v-pagar', { body: cli({ ids: [4], telefono: '8112222222', nombre: 'Caro' }) });
const p3 = pedidoDe(c3.body.pedido);
clip[p3.clipId].status = 'CHECKOUT_COMPLETED';
const x2 = await op('v-pedido-estado', { token: 'TA', body: { id: p3.id, accion: 'cancelar' } });
ok(x2.code === 409 && x2.body.yaPagado && pedidoDe(p3.id).estado === 'pagado' && pr(4).vendido, 'si Clip confirma el pago al intentar cancelar → no se cancela y queda pagado');
const x3 = await op('v-pedido-estado', { token: 'TA', body: { id: p3.id, accion: 'cancelar' } });
ok(x3.code === 409 && /pago confirmado/.test(x3.body.error), 'un pedido pagado no se cancela');

grupo('5 · Apartados: no liberar con pagos confirmados');
const c4 = await op('v-pagar', { body: cli({ ids: [6], modo: 'apartado', telefono: '8113333333', nombre: 'Dani' }) });
const p4 = pedidoDe(c4.body.pedido);
clip[p4.clipId].status = 'CHECKOUT_COMPLETED';
await op('v-pedido', { method: 'GET', query: { id: p4.id, k: p4.clave } });
ok(pedidoDe(p4.id).estado === 'apartado' && pr(6).reservedBy.anticipo === 300, 'anticipo pagado → apartado');
const del = await op('borrar-prenda', { token: 'TA', body: { id: 6 } });
ok(del.code === 409 && pr(6), 'no se puede borrar una prenda con anticipo pagado');
const vend = await op('marcar-vendido', { token: 'TA', body: { id: 6, comprador: 'compradora' } });
ok(vend.code === 409 && !pr(6).vendido, 'no se puede vender en persona una prenda con anticipo de otra persona');
const pat = await pedir(itemApi, { method: 'PATCH', query: { id: '6' }, token: 'TA', body: { apartada: false } });
ok(pat.code === 409 && pr(6).apartada, 'editar la prenda no puede soltar el apartado');
const apa = await pedir(itemApi, { method: 'POST', query: { id: '6', op: 'apartar' }, token: 'TA', body: { accion: 'liberar' } });
ok(apa.code === 409 && pr(6).apartada, '"Quitar apartado" del inventario tampoco');
await op('v-pagar-resto', { body: { id: p4.id, k: p4.clave } });
const liq = pedidoDe(p4.id).liquidaciones.at(-1);
clip[liq.clipId].status = 'CHECKOUT_COMPLETED';
const lib = await op('v-pedido-estado', { token: 'TA', body: { id: p4.id, accion: 'liberar' } });
ok(lib.code === 409 && lib.body.yaPagado && pedidoDe(p4.id).estado === 'pagado' && pr(6).vendido, 'Liberar revisa antes: el resto ya estaba pagado → queda pagado, no se libera');

grupo('6 · Operaciones simultáneas');
const c5 = await op('v-pagar', { body: cli({ ids: [7], modo: 'apartado', telefono: '8114444444', nombre: 'Eva' }) });
const p5 = pedidoDe(c5.body.pedido);
clip[p5.clipId].status = 'CHECKOUT_COMPLETED';
await op('v-pedido', { method: 'GET', query: { id: p5.id, k: p5.clave } });
const [s1, s2] = await Promise.all([
  op('v-pedido-estado', { token: 'TA', body: { id: p5.id, accion: 'liquidar' } }),
  op('v-pedido-estado', { token: 'TA', body: { id: p5.id, accion: 'liberar' } }),
]);
const fin5 = pedidoDe(p5.id).estado;
ok([s1.code, s2.code].filter(c => c === 200).length === 1 && ((fin5 === 'pagado' && pr(7).vendido) || (fin5 === 'cancelado' && !pr(7).apartada)),
  `"Cobré el resto" y "Liberar" al mismo tiempo → solo uno (${s1.code}/${s2.code}, quedó ${fin5})`);
ok((fake.ventas || []).filter(v => v.prendaId === 7).length <= 1, 'nunca se duplica la venta');
// Doble clic en "Marcar enviado"
const [e1, e2] = await Promise.all([
  op('v-pedido-estado', { token: 'TA', body: { id: p1.id, accion: 'enviado', paqueteria: 'Estafeta', guia: 'ABC12345' } }),
  op('v-pedido-estado', { token: 'TA', body: { id: p1.id, accion: 'enviado', paqueteria: 'Estafeta', guia: 'ABC12345' } }),
]);
ok([e1.code, e2.code].sort().join() === '200,409', `doble clic en "Marcar enviado" → uno pasa, el otro se bloquea (${e1.code}/${e2.code})`);
ok((pedidoDe(p1.id).historial || []).filter(h => /enviado/.test(h.accion)).length === 1, 'el historial lo anota una sola vez');
// Dos clientes, la misma prenda
const [k1, k2] = await Promise.all([op('v-pagar', { body: cli({ ids: [8], telefono: '8115555555', nombre: 'F' }) }), op('v-pagar', { body: cli({ ids: [8], telefono: '8116666666', nombre: 'G' }) })]);
ok([k1.code, k2.code].sort().join() === '200,409', 'dos clientes pagando la misma prenda → uno recibe link, el otro un aviso');
ok(ev(e => e.tipo === 'pedido.conflicto' && e.prendaId === 8).length === 1, 'el choque queda registrado');
// El mismo cliente con doble toque en "Pagar"
const [d1, d2] = await Promise.all([op('v-pagar', { body: cli({ ids: [5], telefono: '8117777777' }) }), op('v-pagar', { body: cli({ ids: [5], telefono: '8117777777' }) })]);
ok([d1.code, d2.code].sort().join() === '200,409' && (fake.pedidos.filter(p => p.ids.includes(5)).length === 1), 'doble toque en "Pagar" → un solo pedido');

grupo('7 · Permisos y aislamiento entre bazares');
ok((await op('v-actividad', { method: 'GET', token: 'TV' })).code === 403, 'un vendedor no ve el Centro de actividad');
ok((await op('v-sistema', { method: 'GET', token: 'TV' })).code === 403, 'un vendedor no ve el monitor');
ok((await op('v-sistema-reparar', { token: 'TV', body: { tipo: 'soltar-apartado', prendaId: 1 } })).code === 403, 'un vendedor no repara');
ok((await op('v-actividad', { method: 'GET' })).code === 401, 'sin sesión → 401');
fake.actividad.push({ id: 'b2', en: new Date().toISOString(), categoria: 'admin', tipo: 'x', accion: 'Evento del bazar 2', resultado: 'ok', usuario: 'admin2', bazarId: 2 });
const a2 = await op('v-actividad', { method: 'GET', token: 'T2', query: { porPagina: '100' } });
ok(a2.code === 200 && a2.body.eventos.length >= 1 && a2.body.eventos.every(e => e.bazarId === 2), 'el admin del bazar 2 solo ve eventos de su bazar');
const a1 = await op('v-actividad', { method: 'GET', token: 'TA', query: { porPagina: '100' } });
ok(a1.body.eventos.some(e => e.bazarId === 2) && a1.body.eventos.some(e => e.bazarId === 1), 'el admin principal ve todos');
ok((await op('v-pedido-historial', { method: 'GET', token: 'T2', query: { id: p1.id } })).code === 404, 'el bazar 2 no ve el historial de pedidos del bazar 1');
ok((await op('v-pedido-estado', { token: 'T2', body: { id: p1.id, accion: 'entregado' } })).code === 404, 'el bazar 2 no cambia pedidos del bazar 1');
ok((await op('logs', { method: 'GET' })).code === 401, 'el registro del panel (v32) ya no es público');
ok((await op('solicitud-bazar', { method: 'GET', token: 'T2' })).code === 403, 'las solicitudes de bazar solo las ve el admin principal');

grupo('8 · Filtros, búsqueda y paginación del Centro de actividad');
const fp = await op('v-actividad', { method: 'GET', token: 'TA', query: { categoria: 'pago', porPagina: '5' } });
ok(fp.body.eventos.every(e => e.categoria === 'pago') && fp.body.porPagina === 5 && fp.body.eventos.length <= 5, `filtro por categoría + 5 por página (${fp.body.total} en total, ${fp.body.paginas} páginas)`);
const fp2 = await op('v-actividad', { method: 'GET', token: 'TA', query: { categoria: 'pago', porPagina: '5', pagina: '2' } });
ok(fp.body.paginas < 2 || (fp2.body.pagina === 2 && fp2.body.eventos[0]?.id !== fp.body.eventos[0]?.id), 'la página 2 trae otros eventos');
const fr = await op('v-actividad', { method: 'GET', token: 'TA', query: { resultado: 'rechazado' } });
ok(fr.body.total > 0 && fr.body.eventos.every(e => e.resultado === 'rechazado'), 'filtro por resultado');
const fu = await op('v-actividad', { method: 'GET', token: 'TA', query: { usuario: 'jefa' } });
ok(fu.body.total > 0 && fu.body.eventos.every(e => e.usuario === 'jefa') && fu.body.usuarios.includes('jefa'), 'filtro por usuario y lista de usuarios');
const fq = await op('v-actividad', { method: 'GET', token: 'TA', query: { q: p2.id } });
ok(fq.body.total > 0 && fq.body.eventos.every(e => e.pedidoId === p2.id || JSON.stringify(e).includes(p2.id)), 'búsqueda por número de pedido');
const hoy = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
const fd = await op('v-actividad', { method: 'GET', token: 'TA', query: { desde: hoy, hasta: hoy } });
const fd2 = await op('v-actividad', { method: 'GET', token: 'TA', query: { desde: '2020-01-01', hasta: '2020-01-02' } });
ok(fd.body.total > 0 && fd2.body.total === 0, 'filtro por fechas');
ok(fd.body.resumen && typeof fd.body.resumen.resultado === 'object', 'trae indicadores por resultado y categoría');
const csv = await op('v-actividad', { method: 'GET', token: 'TA', query: { formato: 'csv' } });
ok(csv.h['content-type']?.startsWith('text/csv') && !String(csv.body).includes('8991234567') && !String(csv.body).includes('ana.lopez@'), 'exportar CSV sin datos sensibles');

grupo('9 · Historial de un pedido');
const hp = await op('v-pedido-historial', { method: 'GET', token: 'TV', query: { id: p2.id } });
ok(hp.code === 200 && hp.body.historial.length >= 2 && hp.body.prendas.length === 1, 'un vendedor del mismo bazar ve el historial');
ok(hp.body.eventos.some(e => e.tipo === 'pago.tras-cancelar'), 'incluye los eventos relacionados (pago tras cancelar)');
fake.pedidos.push({ id: 'PVIEJO', bazarId: 1, estado: 'pagado', en: '2026-10-01T10:00:00Z', pagadoEn: '2026-10-01T10:05:00Z', entregadoEn: '2026-10-03T10:00:00Z', items: [{ id: '1', nombre: 'Prenda 1', precio: 300 }], nombre: 'Viejo', total: 300 });
const hv = await op('v-pedido-historial', { method: 'GET', token: 'TA', query: { id: 'PVIEJO' } });
ok(hv.body.reconstruido && hv.body.historial.length === 3, 'pedidos de antes de la v33: historial reconstruido con sus fechas');

grupo('10 · Monitor de sistema');
const m1 = await op('v-sistema', { method: 'GET', token: 'TA', query: { fresco: '1' } });
const sv = id => m1.body.servicios.find(s => s.id === id);
ok(m1.code === 200 && sv('mongo').estado === 'operativo', `MongoDB: ${sv('mongo').estado}`);
ok(sv('clip').estado === 'operativo', `Clip: ${sv('clip').estado} (${sv('clip').detalle})`);
ok(sv('resend').estado === 'operativo' && /solo de envío/.test(sv('resend').detalle), `Resend: ${sv('resend').estado} (${sv('resend').detalle})`);
ok(sv('cloudinary').estado === 'operativo', `Cloudinary: ${sv('cloudinary').estado}`);
ok(sv('paypal').estado === 'sin configurar', 'PayPal: sin configurar (opcional)');
ok(m1.body.ultimas.webhookClip && m1.body.ultimas.ultimoPago && m1.body.ultimas.actividad, 'muestra último aviso de Clip, último pago y última actividad');
ok(m1.body.pendientes.devolverDinero >= 1, `operaciones pendientes: ${m1.body.pendientes.devolverDinero} para devolver dinero`);
clipCred = false; resendDominios = 'pending'; cloudOk = false;
const m2 = await op('v-sistema', { method: 'GET', token: 'TA', query: { fresco: '1' } });
const sv2 = id => m2.body.servicios.find(s => s.id === id);
ok(sv2('clip').estado === 'no disponible' && sv2('resend').estado === 'degradado' && sv2('cloudinary').estado === 'no disponible' && m2.body.general === 'no disponible',
  `distingue estados: Clip ${sv2('clip').estado}, Resend ${sv2('resend').estado}, Cloudinary ${sv2('cloudinary').estado} → general ${m2.body.general}`);
clipCred = true; resendDominios = 'restricted'; cloudOk = true;
globalThis.__FAKE_PING_FALLA__ = true;
const m3 = await op('v-sistema', { method: 'GET', token: 'TA', query: { fresco: '1' } });
ok(m3.body.servicios.find(s => s.id === 'mongo').estado === 'no disponible', 'si MongoDB no contesta → no disponible');
globalThis.__FAKE_PING_FALLA__ = false;
delete process.env.RESEND_API_KEY;
const m4 = await op('v-sistema', { method: 'GET', token: 'TA', query: { fresco: '1' } });
ok(m4.body.servicios.find(s => s.id === 'resend').estado === 'sin configurar', 'Resend sin variables → sin configurar');
process.env.RESEND_API_KEY = 're_x';

grupo('11 · Consistencia pedidos ↔ inventario y reparaciones');
// Prenda que sigue apartada para un pedido ya cancelado
fake.inventario.push(prenda(30, 100, { apartada: true, reservedUntil: futuro(1), reservedBy: { pedido: p2.id, nombre: 'Beto', canal: 'clip' } }));
// Pedido con anticipo cuya prenda ya no está apartada a su nombre
fake.inventario.push(prenda(31, 400));
fake.pedidos.push({ id: 'PAPX', bazarId: 1, estado: 'apartado', modalidad: 'apartado', anticipo: 200, resta: 200, total: 400, liquidarAntes: futuro(72), en: new Date().toISOString(), items: [{ id: '31', nombre: 'Prenda 31', precio: 400 }], nombre: 'Hugo', telefono: '8118888888' });
const m5 = await op('v-sistema', { method: 'GET', token: 'TA', query: { fresco: '1' } });
const inc = m5.body.inconsistencias;
ok(inc.some(i => i.prendaId === 30 && i.reparar === 'soltar-apartado'), 'detecta prenda apartada para un pedido cancelado');
ok(inc.some(i => i.prendaId === 31 && i.reparar === 'reapartar'), 'detecta anticipo pagado sin la prenda apartada');
const r1 = await op('v-sistema-reparar', { token: 'TA', body: { tipo: 'soltar-apartado', prendaId: 30 } });
ok(r1.code === 200 && !pr(30).apartada, 'reparar: suelta el apartado huérfano');
const r2 = await op('v-sistema-reparar', { token: 'TA', body: { tipo: 'soltar-apartado', prendaId: 7 } });
ok(r2.code === 409 || r2.code === 404 || !pr(7)?.apartada, 'no suelta prendas de pedidos activos o vendidas');
const r3 = await op('v-sistema-reparar', { token: 'TA', body: { tipo: 'reapartar', prendaId: 31, pedidoId: 'PAPX' } });
ok(r3.code === 200 && pr(31).reservedBy.pedido === 'PAPX' && pr(31).reservedBy.anticipo === 200, 'reparar: vuelve a apartar la prenda del anticipo');
ok(ev(e => e.op === 'v-sistema-reparar' && e.resultado === 'ok').length >= 2, 'cada reparación queda registrada');
const r4 = await op('v-sistema-reparar', { token: 'TA', body: { tipo: 'soltar-apartado', prendaId: 31 } });
ok(r4.code === 409 && pr(31).apartada, 'nunca suelta una prenda con anticipo pagado (pedido activo)');

grupo('12 · Venta en línea: reactivar exige confirmar el reembolso');
const rv = await op('revertir-venta', { token: 'TA', body: { id: 2 } });
ok(rv.code === 409 && rv.body.requiereConfirmar && pr(2).vendido, 'reactivar una prenda pagada en línea pide confirmar que se devolvió el dinero');
const rv2 = await op('revertir-venta', { token: 'TA', body: { id: 2, confirmarReembolso: true } });
ok(rv2.code === 200 && !pr(2).vendido && (pedidoDe(p1.id).historial || []).some(h => /reactivó/.test(h.accion)), 'con confirmación: se reactiva y queda en el historial del pedido');

grupo('13 · Sesiones');
const l1 = await pedir(authApi, { body: { username: 'Secreta#2026', password: 'x' } });
ok(l1.code === 401 && !JSON.stringify(fake.actividad).includes('Secreta#2026') && ev(e => e.tipo === 'auth.entrar' && e.detalle?.intento === 'Se•••').length === 1, 'usuario inexistente: se guarda solo el inicio de lo escrito');
const l2 = await pedir(authApi, { body: { username: 'jefa', password: 'mala' } });
ok(l2.code === 401 && ev(e => e.tipo === 'auth.entrar' && e.usuario === 'jefa' && e.resultado === 'rechazado').length === 1, 'contraseña incorrecta registrada');
fake.activos = [];
const l3 = await pedir(authApi, { body: { username: 'jefa', password: 'Secreta#2026' } });
ok(l3.code === 200 && ev(e => e.tipo === 'auth.entrar' && e.usuario === 'jefa' && e.resultado === 'ok').length === 1, 'entrada correcta registrada');
ok(!JSON.stringify(fake.actividad).includes(l3.body.sessionToken), 'el token nuevo no se guarda en el registro');
fake.usuarios.find(u => u.id === 1).sessionToken = 'TA';

grupo('14 · Errores: Resend que falla y aviso de Clip desconocido');
resendModo = 'falla';
const c6 = await op('v-pagar', { body: cli({ ids: [1], telefono: '8119999999', email: 'otra.persona@hotmail.com' }) });
ok(c6.code === 409 || c6.code === 200, 'pedido extra para probar correo');
const pzz = fake.inventario.find(p => p.id === 31);
resendModo = 'falla';
fake.pedidos.push({ id: 'PCORREO', bazarId: 1, estado: 'pendiente', modalidad: 'completo', proveedor: 'clip', clipId: 'pr_correo', total: 100, items: [{ id: '40', nombre: 'Prenda 40', precio: 100 }], nombre: 'Iris', telefono: '8110000001', email: 'iris.x@gmail.com', en: new Date().toISOString(), clave: 'zzz' });
fake.inventario.push(prenda(40, 100, { apartada: true, reservedUntil: futuro(1), reservedBy: { pedido: 'PCORREO' } }));
clip.pr_correo = { status: 'CHECKOUT_COMPLETED', amount: 100 };
await op('v-clip-webhook', { body: { payment_request_id: 'pr_correo' } });
const ce = ev(e => e.categoria === 'correo' && e.pedidoId === 'PCORREO');
ok(ce.length === 1 && ce[0].resultado === 'error' && ce[0].detalle.para === 'ir•••@gmail.com' && /Resend 403/.test(ce[0].error.mensaje), 'correo fallido: error registrado sin mostrar el correo completo');
ok(pedidoDe('PCORREO').estado === 'pagado', 'que falle el correo no detiene la venta');
resendModo = 'ok';
await op('v-clip-webhook', { body: { payment_request_id: 'pr_desconocido' } });
ok(ev(e => e.tipo === 'clip.webhook' && e.resultado === 'rechazado').length === 1, 'aviso de Clip sin pedido → registrado como rechazado');
const m6 = await op('v-sistema', { method: 'GET', token: 'TA', query: { fresco: '1' } });
ok(m6.body.servicios.find(s => s.id === 'resend').estado === 'degradado', 'el monitor marca Resend degradado si el último correo falló');

grupo('15 · Auditoría de operaciones del panel');
const pc = await pedir(itemApi, { method: 'POST', token: 'TA', body: { nombre: 'Nueva <b>', precio_venta: 99 } });
ok(pc.code === 201 && ev(e => e.op === 'prenda-crear' && e.usuario === 'jefa' && e.resultado === 'ok').length === 1, 'registrar prenda queda auditado');
const pdup = await Promise.all([1, 2].map(() => pedir(itemApi, { method: 'POST', token: 'TA', body: { nombre: 'Doble', precio_venta: 10 } })));
ok(pdup.map(x => x.code).sort().join() === '201,409' && fake.inventario.filter(p => p.nombre === 'Doble').length === 1, 'doble clic en "Registrar" → una sola prenda');
const pcfg = await op('v-config', { token: 'TA', body: { cupones: [{ codigo: 'MITAD', tipo: 'pct', valor: 50, activo: true }, { codigo: 'NUEVO10', tipo: 'pct', valor: 10, activo: true }] } });
ok(pcfg.code === 200 && ev(e => e.tipo === 'cupon.creado' && /NUEVO10/.test(e.accion)).length === 1, 'crear un cupón queda registrado');
const syncPanel = await pedir(syncApi, { method: 'GET', token: 'T2' });
ok(syncPanel.code === 200, 'sync del panel sigue funcionando');
ok(!!fake.sistema?.[0]?.syncPanel, 'se anota la última sincronización');

// ── Resumen ──
const pasaron = resultados.filter(r => r[0]).length;
console.log(`\nRESULTADO: ${pasaron} de ${resultados.length} pruebas pasaron`);
