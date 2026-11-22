// Pruebas v56: lo que no cuadraba entre Instagram, la tienda y el panel.
// - Apartado vencido: la tienda ya no dice "Apartada" (el cobro ya la dejaba comprar) y se suelta
//   en la siguiente sincronización (máx. 1 min), no al día siguiente a las 9:00.
// - Apartar a mano → "Apartada por ahora" en Instagram; liberar o vender → se borra.
// - Rebaja a mano: la tienda tacha el precio anterior igual que el comentario de Instagram;
//   si es una corrección, ni la tienda ni Instagram dicen "antes".
// - Programados desde "Crear": no se publica una prenda vendida y el texto sale con el precio del día.
// - Lo que se cobra en línea coincide con las formas de pago anunciadas.
// - Renombrar una categoría o marca también cambia sus prendas.
// - El panel sabe si es una sola tienda (la tarjeta ya no repite "STIIMPYS").
process.env.SESSION_SECRET = 'secreto-de-prueba-v56';
process.env.CLIP_API_KEY = 'k'; process.env.CLIP_SECRET_KEY = 's';
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
const igp = await import('./.tmp/api/_lib/instagramPanel.js');
const bz = await import('./.tmp/api/_lib/bazar.js');
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
  await fn({ method, query, body: body && typeof body === 'object' ? { ...body } : body, url: '/api/x', headers: { 'x-real-ip': '10.56.' + (ipN++ % 250) + '.1', host: 'stiimpys.store', authorization: 'Bearer ' + token } }, res);
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
fake.inventario = [];

const db = await getDB();
const hace = h => new Date(Date.now() - h * 3600e3).toISOString();
const en = h => new Date(Date.now() + h * 3600e3).toISOString();
fake.pendientes = fake.pendientes || []; fake.automaticoLog = fake.automaticoLog || [];

grupo('Apartado vencido: la tienda y el panel dicen lo mismo');
let pp = bz.prendaPublica(P(601, { apartada: true, reservedUntil: hace(1), reservedBy: { nombre: 'Ana' } }));
ok(pp.apartada === false, 'apartado a mano vencido → la tienda la muestra disponible');
pp = bz.prendaPublica(P(602, { apartada: true, reservedUntil: en(5), reservedBy: { nombre: 'Ana' } }));
ok(pp.apartada === true, 'apartado vigente → "Apartada"');
pp = bz.prendaPublica(P(603, { apartada: true, reservedUntil: hace(1), reservedBy: { anticipo: 200, pedido: 'X1' } }));
ok(pp.apartada === true, 'apartado con anticipo pagado vencido → sigue apartada (la dueña decide)');
fake.inventario.push(P(610, { instagramId: 'P610', apartada: true, reservedUntil: hace(2), reservedBy: { nombre: 'Luis', telefono: '8991112233' }, instagramApartado: { comentario: 'cAP1' } }),
  P(611, { apartada: true, reservedUntil: hace(2), reservedBy: { pedido: 'PED9', canal: 'clip' } }));
global._liberarApartadosEn = 0; sinCache();
let r = await llamar(syncApi, { method: 'GET', query: { scope: 'publico' }, token: '' });
ok(r.code === 200 && inv(610).apartada === false && !inv(610).reservedUntil, 'la sincronización suelta el apartado vencido (sin esperar a las 9:00)');
ok(borrados.includes('cAP1') && !inv(610).instagramApartado, 'y borra el "Apartada" de Instagram');
ok(fake.pendientes.some(x => x.prendaId === 610 && x.tipo === 'apartado'), 'la dueña recibe el aviso de apartado vencido (con WhatsApp)');
ok(inv(611).apartada === true, 'un pago en línea sin terminar no lo toca la sincronización (eso revisa Clip/PayPal aparte)');
const nPend = fake.pendientes.length;
inv(610).apartada = true; inv(610).reservedUntil = hace(1);
r = await llamar(syncApi, { method: 'GET', query: { scope: 'publico', fresh: '1' }, token: '' });
ok(inv(610).apartada === true && fake.pendientes.length === nPend, 'como mucho una vez por minuto');
const { liberarApartados } = await import('./.tmp/api/_lib/automatico.js');
await Promise.all([liberarApartados(db, fake.bazares[0], { soloManuales: true }), liberarApartados(db, fake.bazares[0], { soloManuales: true })]);
ok(fake.pendientes.length === nPend + 1, `dos procesos a la vez avisan una sola vez (${fake.pendientes.length - nPend})`);

grupo('Apartar a mano → Instagram');
fake.inventario.push(P(620, { instagramId: 'P620' }));
r = await llamar(itemApi, { query: { op: 'apartar', id: '620' }, body: { accion: 'apartar', nombre: 'Mar', horas: 24 } });
let c = comentarios.at(-1);
ok(r.code === 200 && r.body.instagram === true && c.post === 'P620' && c.texto === 'Apartada por ahora. Si se libera, la verás disponible en stiimpys.store/p/620', `se comenta "Apartada por ahora" (${c?.texto})`);
ok(inv(620).instagramApartado?.comentario === c.id, 'queda anotado');
r = await llamar(itemApi, { query: { op: 'apartar', id: '620' }, body: { accion: 'liberar' } });
ok(r.code === 200 && borrados.includes(c.id) && !inv(620).instagramApartado && !inv(620).apartada, 'al liberarla se borra el comentario');
await llamar(itemApi, { query: { op: 'apartar', id: '620' }, body: { accion: 'apartar', nombre: 'Mar', horas: 24 } });
const cAp = comentarios.at(-1).id;
r = await op('v-pos-venta', { idLocal: 'L620', ids: [620], evento: 'Bazar', metodo: 'efectivo', cliente: { nombre: 'Mar', telefono: '' } });
ok(r.code === 200 && comentarios.at(-1).texto.startsWith('VENDIDA') && borrados.includes(cAp) && !inv(620).instagramApartado, 'si se vende: "VENDIDA" y se borra el "Apartada"');

grupo('Rebaja a mano: tienda e Instagram dicen lo mismo');
fake.inventario.push(P(630, { instagramId: 'P630', precio_venta: 400 }));
r = await patch(630, { precio_venta: 320 });
ok(inv(630).precioAnterior === 400 && comentarios.at(-1).texto === 'Nuevo precio: $320 MXN (antes $400). Disponible en stiimpys.store/p/630', 'baja el precio → la tienda tacha $400 y el post dice "(antes $400)"');
ok(bz.prendaPublica(inv(630)).precioAnterior === 400, 'la tienda recibe el precio anterior');
r = await patch(630, { precio_venta: 300 });
ok(inv(630).precioAnterior === 400 && comentarios.at(-1).texto.includes('(antes $320)'), 'otra rebaja: se conserva el precio original tachado');
let n0 = comentarios.length;
r = await patch(630, { precio_venta: 300, nombre: 'Prenda 630 nueva' });
ok(comentarios.length === n0, 'mismo precio → no se repite el comentario');
r = await patch(630, { precio_venta: 450 });
ok(!('precioAnterior' in inv(630)) && comentarios.at(-1).texto === 'Precio actualizado: $450 MXN. Disponible en stiimpys.store/p/630', 'sube arriba del anterior → se quita lo tachado y el post dice "Precio actualizado"');
fake.inventario.push(P(631, { instagramId: 'P631', precio_venta: 1500 }));
r = await patch(631, { precio_venta: 150, precioAnterior: 0 });
ok(!(Number(inv(631).precioAnterior) > 150) && comentarios.at(-1).texto === 'Precio actualizado: $150 MXN. Disponible en stiimpys.store/p/631', 'corrección (no rebaja): sin tachado y sin "antes"');

grupo('Programados desde "Crear"');
fake.inventario.push(P(640, { precio_venta: 500, descripcion: 'Chamarra.' }), P(641, { precio_venta: 300 }), P(642, { vendido: true }));
const foto = 'https://res.cloudinary.com/demo/image/upload/v1/bazar/p640.jpg';
r = await op('ig-programar', { tipo: 'post', imagenes: [foto], caption: 'Texto del panel $500 MXN', prendaId: 640, plantilla: false, captionAuto: true, publicarEn: en(2) });
ok(r.code === 200 && r.body.programado?.captionAuto === true && r.body.programado.precioAlProgramar === 500, 'se programa recordando que el texto es el automático y el precio de ese día');
r = await op('ig-programar', { tipo: 'post', imagenes: [foto], caption: 'Mi texto: solo $300 MXN, corre', prendaId: 641, captionAuto: false, publicarEn: en(2) });
ok(r.code === 200, 'texto editado a mano: también se programa');
r = await op('ig-programar', { tipo: 'post', imagenes: [foto], caption: 'x', prendaId: 642, publicarEn: en(2) });
ok(r.code === 400 && /vendió/.test(r.body.error), 'una prenda vendida no se puede programar');
inv(640).precio_venta = 420; inv(641).precio_venta = 250;
for (const d of fake.igProgramados) d.publicarEn = hace(0.1);
captions.length = 0;
let hechos = await igp.procesarProgramados(db, 5);
ok(captions.some(t => t.startsWith('Prenda 640') && t.includes('Precio: $420 MXN')), 'texto automático: se arma al publicar con el precio nuevo ($420)');
ok(captions.includes('Mi texto: solo $250 MXN, corre'), 'texto editado: se respeta, solo cambia el precio');
fake.inventario.push(P(643, { precio_venta: 200 }));
await op('ig-programar', { tipo: 'post', imagenes: [foto], caption: 'x', prendaId: 643, captionAuto: true, publicarEn: en(2) });
inv(643).vendido = true; fake.igProgramados.at(-1).publicarEn = hace(0.1);
hechos = await igp.procesarProgramados(db, 5);
ok(hechos.some(h => !h.ok && /ya se vendió/.test(h.error)) && fake.igProgramados.at(-1).estado === 'error', 'si se vendió antes de la hora, no se publica');

grupo('Lo que se cobra = lo que se anuncia');
const CLABE = (b => { let s = 0; for (let i = 0; i < 17; i++) s += (Number(b[i]) * [3, 7, 1][i % 3]) % 10; return b + ((10 - s % 10) % 10); })('73096930000819908');
const base = { spei: { activo: true, clabe: CLABE }, paypal: false };
ok(crecer.metodosPago({ ...base, formasPago: { tarjeta: true, efectivo: true, transferencia: true } }, 1).join() === 'clip,spei', 'las tres marcadas → Clip y SPEI');
ok(crecer.metodosPago({ ...base, formasPago: { tarjeta: true, efectivo: true, transferencia: false } }, 1).join() === 'clip', 'sin "Transferencia" → no se ofrece SPEI');
ok(crecer.metodosPago({ ...base, formasPago: { tarjeta: false, efectivo: true, transferencia: true } }, 1).join() === 'spei', 'sin "Tarjeta" → no se cobra con Clip');
const src = fs.readFileSync(new URL('../js/tienda/formas-pago.js', import.meta.url), 'utf8');
ok(src.includes("lista().filter(k => k !== 'tarjeta')") && fs.readFileSync(new URL('../js/tienda/carrito-pagina.js', import.meta.url), 'utf8').includes('window.FormasPago.alternativas()'), '"¿Prefieres efectivo o transferencia?" sale de lo marcado');

grupo('Renombrar categoría o marca');
fake.inventario.push(P(650, { marca: 'Champion', categorias: ['Sudaderas', 'Vintage'] }), P(651, { marca: 'champion ', categorias: ['sudaderas'] }), P(652, { marca: 'Nike', categorias: ['Playeras'] }));
r = await op('catalogo-renombrar', { tipo: 'categoria', de: 'Sudaderas', a: 'Sudaderas y hoodies' });
ok(r.code === 200 && r.body.prendas === 2 && inv(650).categorias.join() === 'Sudaderas y hoodies,Vintage' && inv(651).categorias.join() === 'Sudaderas y hoodies' && inv(652).categorias.join() === 'Playeras', 'la categoría nueva llega a sus 2 prendas (sin importar mayúsculas)');
r = await op('catalogo-renombrar', { tipo: 'marca', de: 'Champion', a: 'Champion Reverse Weave' });
ok(r.code === 200 && r.body.prendas === 2 && inv(651).marca === 'Champion Reverse Weave' && inv(652).marca === 'Nike', 'la marca también');
fake.inventario.push(P(653, { marca: 'Puma' }));
r = await op('catalogo-renombrar', { tipo: 'marca', de: 'Puma', a: '<img src=x onerror=alert(1)>Puma' });
ok(r.code === 200 && !/[<>]/.test(inv(653).marca), `no deja meter código (${inv(653).marca})`);
fake.usuarios.push({ id: 2, username: 'vende', role: 'vendedor', bazarId: 2, sessionToken: 'TV', password: await hashPassword('x') });
fake.bazares.push({ id: 2, nombre: 'Otro', slug: 'otro', permisos: { gestionarCatalogo: true } });
r = await llamar(acciones, { query: { op: 'catalogo-renombrar' }, body: { tipo: 'marca', de: 'Nike', a: 'Nike SB' }, token: 'TV' });
ok(r.code === 200 && r.body.prendas === 0 && inv(652).marca === 'Nike', 'un bazar solo cambia sus propias prendas');

grupo('El panel sabe si es una sola tienda');
sinCache();
r = await llamar(syncApi, { method: 'GET', query: {} });
const cuerpo = typeof r.body === 'string' ? JSON.parse(r.body) : r.body;
ok(cuerpo?.modo && cuerpo.modo.multiBazar === false && cuerpo.modo.principal === 1, `el sync del panel trae el modo (${JSON.stringify(cuerpo?.modo)})`);
