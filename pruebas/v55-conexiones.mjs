// Pruebas v55: Instagram, tienda y panel con la misma información.
// - Venta en la Caja → "VENDIDA" en su post y en el carrusel del drop; ticket anulado → se borran.
// - Venta revertida en el panel → se borra el "VENDIDA".
// - Precio nuevo en el panel → un solo comentario con el precio vigente (se reemplaza);
//   cambio de nombre/talla/estado → el panel recibe "texto viejo" para ofrecer copiar el nuevo.
// - Prenda borrada → "ya no está disponible"; restaurada → se borra ese comentario.
// - Formas de pago: una sola configuración (Ventas → Promociones y pagos) para la tienda, Instagram y el panel.
// - La tienda ve los cambios en segundos (caché de 5 s; antes 15 s + 2 min).
// Base en memoria; la API de Instagram es falsa y registra cada comentario y borrado.
process.env.SESSION_SECRET = 'secreto-de-prueba-v55';
process.env.IG_STIIMPYS_USER_ID = '1784'; process.env.IG_STIIMPYS_TOKEN = 'tok-prueba';
for (const k of ['MULTI_BAZAR', 'BAZAR_PRINCIPAL', 'TELEGRAM_BOT_TOKEN', 'IG_STIIMPYS_MODO', 'TURNSTILE_SECRET_KEY']) delete process.env[k];

const { fake, getDB } = await import('./.tmp/api/_lib/db.js');
const acciones = (await import('./.tmp/api/acciones.js')).default;
const itemApi = (await import('./.tmp/api/inventario-item.js')).default;
const syncApi = (await import('./.tmp/api/sync.js')).default;
const { hashPassword } = await import('./.tmp/api/_lib/password.js');
const ig = await import('./.tmp/api/_lib/instagram.js');
const igs = await import('./.tmp/api/_lib/igSync.js');
const crecer = await import('./.tmp/api/_lib/crecer.js');
const fs = await import('node:fs');

// ── Instagram falso: guarda comentarios, borrados y textos de posts
const comentarios = [], borrados = [], captions = [];
let nId = 0;
const J = (j, st = 200) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j), headers: { get: () => null } });
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  if (!url.includes('graph.instagram.com')) return J({}, 404);
  const u = new URL(url), m = o.method || 'GET';
  if (m === 'DELETE') { borrados.push(u.pathname.split('/').pop()); return J({ success: true }); }
  if (m === 'POST') {
    const p = new URLSearchParams(String(o.body));
    if (u.pathname.endsWith('/comments')) { const id = 'c' + (++nId); comentarios.push({ id, post: u.pathname.split('/').at(-2), texto: p.get('message') }); return J({ id }); }
    if (p.get('caption')) captions.push(p.get('caption'));
    return J({ id: 'm' + (++nId) });
  }
  if (u.searchParams.get('fields') === 'id') return J({ id: u.pathname.split('/').pop() });
  if (u.searchParams.get('fields') === 'status_code') return J({ status_code: 'FINISHED' });
  if (u.searchParams.get('fields') === 'permalink') return J({ permalink: 'https://instagram.com/p/x' });
  return J({});
};

const mk = () => ({ statusCode: 200, body: undefined, h: {}, headersSent: false, writableEnded: false,
  status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; this.headersSent = this.writableEnded = true; return this; },
  send(x) { this.body = x; return this; }, end(x) { if (x !== undefined) this.body = x; this.writableEnded = true; return this; },
  setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; } });
let ipN = 0, nVar = 0;
const llamar = async (fn, { method = 'POST', query = {}, body, token = 'TA' } = {}) => {
  const res = mk();
  await fn({ method, query, body: body && typeof body === 'object' ? { ...body } : body, url: '/api/x', headers: { 'x-real-ip': '10.55.' + (ipN++ % 250) + '.1', host: 'stiimpys.store', authorization: 'Bearer ' + token } }, res);
  return { code: res.statusCode, body: res.body, h: res.h };
};
const op = (o, body, extra = {}) => llamar(acciones, { query: { op: o }, body, ...extra });
const patch = (id, body) => llamar(itemApi, { method: 'PATCH', query: { id: String(id) }, body: { ...body } });
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);
const inv = id => fake.inventario.find(p => p.id === id);
const sinCache = () => { global._syncCache = null; global._syncCacheTime = 0; global._syncCachePub = null; global._syncCachePubTime = 0; };

fake.bazares = [{ id: 1, nombre: 'Stiimpys', slug: 'stiimpys', permisos: {}, ubicacion: 'Reynosa', instagramConfig: {} }];
fake.usuarios = [{ id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA', password: await hashPassword('x') }];
for (const k of ['ventas', 'papelera', 'tiendaConfig', 'pedidos', 'actividad', 'rate_limits', 'bloqueos', 'sistema', 'resenas', 'igProgramados', 'drops', 'categorias', 'marcas', 'subastas', 'ajustes', 'contadores', 'clientes', 'referidos']) fake[k] = fake[k] || [];
const P = (id, extra = {}) => ({ id, bazarId: 1, nombre: `Prenda ${id}`, talla: 'M', estado: '9/10', precio_venta: 300, costo: 100, imagenes: [`https://res.cloudinary.com/demo/image/upload/v1/bazar/p${id}.jpg`], vendido: false, creadoEn: new Date().toISOString(), ...extra });
fake.inventario = [
  P(501, { instagramId: 'P501' }), P(502, { instagramId: 'P502', dropIgId: 'D1', nombre: 'Playera Nike' }), P(503), P(504, { instagramId: 'P504' }), P(505, { instagramId: 'P505' }),
];

grupo('Venta en la Caja → Instagram');
let r = await op('v-pos-venta', { idLocal: 'L1', ids: [501, 502, 503], evento: 'Barrio Chido', metodo: 'efectivo', cliente: { nombre: 'Ana', telefono: '' } });
ok(r.code === 200 && (r.body.vendidas || []).length === 3, `la Caja vende 3 prendas (${r.code} ${JSON.stringify(r.body).slice(0, 120)})`);
const enPost = id => comentarios.filter(c => c.post === id);
ok(enPost('P501').some(c => c.texto.startsWith('VENDIDA')) && enPost('P502').some(c => c.texto.startsWith('VENDIDA')), 'se comenta VENDIDA en el post de cada prenda que tenía post');
ok(enPost('D1').some(c => c.texto === 'Playera Nike: VENDIDA'), 'y en el carrusel del drop, sin emojis');
ok(inv(501).instagramVendido?.comentario && inv(502).instagramVendido?.drop, 'queda anotado qué se comentó');
ok(comentarios.length === 3, `la prenda sin post no comenta nada (${comentarios.length} comentarios)`);

grupo('Ticket anulado → se quita el VENDIDA');
const ticket = fake.ventas.find(v => v.prendaId === 501)?.ticket;
const antesB = borrados.length;
r = await op('v-pos-anular', { ticket });
ok(r.code === 200 && !inv(501).vendido && !inv(502).vendido, 'el ticket se anula y las prendas regresan a la tienda');
const quit = borrados.slice(antesB);
ok(quit.length === 3 && !inv(501).instagramVendido && !inv(502).instagramVendido, `se borran los 3 comentarios de VENDIDA (${quit.join(', ')})`);

grupo('Venta revertida en el panel → se quita el VENDIDA');
Object.assign(inv(504), { vendido: true, vendidoA: '@ana', instagramVendido: { comentario: 'cVIEJO', en: new Date().toISOString() } });
r = await op('revertir-venta', { id: 504 });
ok(r.code === 200 && !inv(504).vendido && borrados.includes('cVIEJO') && !inv(504).instagramVendido, 'al revertir, el comentario de VENDIDA se borra');

grupo('Precio nuevo → un solo comentario con el precio vigente');
let n0 = comentarios.length;
r = await patch(501, { precio_venta: 250 });
let c = comentarios.at(-1);
ok(r.code === 200 && c?.post === 'P501' && c.texto === 'Nuevo precio: $250 MXN (antes $300). Disponible en stiimpys.store/p/501', `se comenta "Nuevo precio" en su post (${c?.texto})`);
ok(r.body.instagram?.precioComentado === true && r.body.instagram?.campos?.includes('precio'), 'el panel sabe que se comentó');
const primero = c.id;
r = await patch(501, { precio_venta: 200 });
ok(borrados.includes(primero) && comentarios.at(-1).texto.startsWith('Nuevo precio: $200 MXN (antes $250)'), 'al cambiarlo otra vez, se borra el comentario anterior y queda solo el vigente');
r = await patch(501, { precio_venta: 260 });
ok(comentarios.at(-1).texto === 'Precio actualizado: $260 MXN. Disponible en stiimpys.store/p/501', 'si sube: "Precio actualizado"');
ok(inv(501).instagramPrecio?.precio === 260, 'queda anotado el precio comentado');
n0 = comentarios.length;
r = await patch(501, { nombre: 'Sudadera Champion', talla: 'L' });
ok(comentarios.length === n0 && r.body.instagram?.textoViejo === true && r.body.instagram.campos.join() === 'nombre,talla', 'cambiar nombre o talla no comenta, pero avisa que el texto del post ya no coincide');
r = await patch(503, { precio_venta: 120 });
ok(r.code === 200 && r.body.instagram === null && comentarios.length === n0, 'prenda sin post: nada que avisar');
fake.bazares[0].instagramConfig = { avisarCambios: false };
r = await patch(505, { precio_venta: 180 });
ok(comentarios.length === n0 && r.body.instagram?.textoViejo === true && r.body.instagram.precioComentado === false, 'con "Avisar cambios en el post" apagado no comenta (y el panel igual avisa)');
fake.bazares[0].instagramConfig = {};

grupo('Borrar y restaurar');
n0 = comentarios.length;
r = await op('borrar-prenda', { id: 505 });
c = comentarios.at(-1);
ok(r.code === 200 && comentarios.length === n0 + 1 && c.post === 'P505' && c.texto === 'Esta prenda ya no está disponible. Hay más en stiimpys.store', 'al borrarla se avisa en su post que ya no está disponible');
ok(fake.papelera.at(-1)?.prenda?.instagramBaja?.comentario === c.id, 'la papelera recuerda el comentario');
r = await op('restaurar-prenda', { id: 505 });
ok(r.code === 200 && borrados.includes(c.id) && inv(505) && !inv(505).instagramBaja, 'al restaurarla se borra el aviso y vuelve a la tienda');
n0 = comentarios.length;
Object.assign(inv(504), { vendido: true });
r = await op('borrar-prenda', { id: 504 });
ok(r.code === 200 && comentarios.length === n0, 'borrar una vendida no comenta nada');

grupo('Venta en línea y modo automático usan lo mismo');
const crecerSrc = fs.readFileSync(new URL('../api/_lib/crecer.js', import.meta.url), 'utf8');
const autoSrc = fs.readFileSync(new URL('../api/_lib/automatico.js', import.meta.url), 'utf8');
ok(/igAvisarVenta\(db, p, bazar, \{ origen: `pedido \$\{pedido\.id\}` \}\)/.test(crecerSrc), 'la venta en línea avisa con igAvisarVenta (post y carrusel del drop)');
ok(autoSrc.includes('igAvisarPrecio(db, p, nuevo, antes, bazar, { siempre: true })'), 'la rebaja automática usa el mismo comentario de precio (y reemplaza el anterior)');
const db = await getDB();
const pz = P(506, { instagramId: 'P506', dropIgId: 'D2' });
fake.inventario.push(pz);
n0 = comentarios.length;
let out = await igs.igAvisarVenta(db, pz, fake.bazares[0], { origen: 'prueba' });
ok(out.comentario && out.drop && comentarios.length === n0 + 2, 'vendida: post + drop');
out = await igs.igAvisarVenta(db, inv(506), fake.bazares[0], { origen: 'prueba' });
ok(comentarios.length === n0 + 2, 'una segunda vez no repite');
fake.bazares[0].instagramConfig = { autoComentario: false };
out = await igs.igAvisarVenta(db, P(507, { instagramId: 'P507' }), fake.bazares[0]);
ok(!out.comentario && comentarios.length === n0 + 2, 'con "Comentar VENDIDA" apagado no comenta');
fake.bazares[0].instagramConfig = { estiloTexto: 'emojis' };
ok(igs.textoPrecio({ id: 9 }, 100, 150, fake.bazares[0]).startsWith('🔥 NUEVO PRECIO') && igs.textoVendidaDrop({ nombre: 'X' }, fake.bazares[0]).includes('❌'), 'con estilo "Con emojis" los avisos llevan emojis');
fake.bazares[0].instagramConfig = {};

grupo('Formas de pago: una sola configuración');
ok(crecer.textoFormasPago({ tarjeta: true, efectivo: true, transferencia: true }) === 'Aceptamos tarjeta, efectivo y transferencia'
  && crecer.textoFormasPago({ tarjeta: true, efectivo: false, transferencia: true }) === 'Aceptamos tarjeta y transferencia'
  && crecer.textoFormasPago({ efectivo: true }) === 'Aceptamos efectivo' && crecer.textoFormasPago({}) === '', 'el texto se arma con lo que esté marcado');
sinCache();
let pub = await crecer.datosTiendaPublica(db);
ok(JSON.stringify(pub.porBazar[1].formasPago) === '{"tarjeta":true,"efectivo":true,"transferencia":true}', 'de inicio: tarjeta, efectivo y transferencia');
r = await op('v-config', { formasPago: { tarjeta: true, efectivo: true, transferencia: false, raro: true }, _n: 1 });
ok(r.code === 200 && r.body.config.formasPago.transferencia === false && !('raro' in r.body.config.formasPago), 'se guarda desde Promociones y pagos (solo las tres conocidas)');
sinCache();
pub = await crecer.datosTiendaPublica(db);
ok(pub.porBazar[1].formasPago.transferencia === false, 'la tienda recibe el cambio');
r = await llamar(acciones, { method: 'GET', query: { op: 'ig-estado' } });
ok(r.body?.pagos === 'Aceptamos tarjeta y efectivo', `el panel de Instagram recibe la misma línea ("${r.body?.pagos}")`);
captions.length = 0;
await ig.publicarPrendaEnInstagram({ ...P(508), descripcion: 'Sudadera gris.' }, fake.bazares[0]);
ok((captions.at(-1) || '').includes('\nAceptamos tarjeta y efectivo\nDisponible en stiimpys.store/p/508'), 'y el texto del post en Instagram también');
const { textoDrop } = await import('./.tmp/api/_lib/instagramPanel.js');
ok(textoDrop({ nombre: 'Drop' }, [P(509)], { ...fake.bazares[0], _pagos: 'Aceptamos tarjeta y efectivo' }).includes('Aceptamos tarjeta y efectivo'), 'el texto de los drops también');
r = await op('v-config', { formasPago: { tarjeta: true, efectivo: true, transferencia: true }, _n: 2 });

grupo('La tienda ve los cambios en segundos');
sinCache();
r = await llamar(syncApi, { method: 'GET', query: { scope: 'publico' }, token: '' });
ok(/s-maxage=5\b/.test(r.h['cache-control'] || '') && /stale-while-revalidate=15\b/.test(r.h['cache-control'] || ''), `caché del CDN: 5 s (${r.h['cache-control']})`);
ok(fs.readFileSync(new URL('../api/sync.js', import.meta.url), 'utf8').includes('const TTL_PUBLICO = 5000;'), 'caché del servidor: 5 s (antes 30 s)');
const dbjs = fs.readFileSync(new URL('../js/comun/db.js', import.meta.url), 'utf8');
ok(dbjs.includes('const POLL_LENTO  = MODO_PUBLICO ? 30000 : 15000;') && dbjs.includes('const POLL_RAPIDO = MODO_PUBLICO ?  8000 : 3000;'), 'la tienda abierta revisa cada 8–30 s (antes hasta 5 min)');
