// Pruebas v58: publicar en Instagram sin quedarse atorado.
// - El candado lleva hora: uno viejo (o de las versiones anteriores, sin hora) se toma solo.
// - Antes de reintentar se busca si el post sí salió: se liga en lugar de publicarlo dos veces.
// - Las fotos del carrusel se suben a la vez y hay un tope de tiempo antes del límite del servidor.
// - El error queda guardado en la prenda; "Con problemas" lista prendas y programados; destrabar,
//   cancelar y reintentar (también programados, sin duplicar).
process.env.SESSION_SECRET = 'secreto-de-prueba-v58';
process.env.IG_STIIMPYS_USER_ID = '1784'; process.env.IG_STIIMPYS_TOKEN = 'tok-prueba';
for (const k of ['MULTI_BAZAR', 'BAZAR_PRINCIPAL', 'IG_STIIMPYS_MODO']) delete process.env[k];
const { fake, getDB } = await import('./.tmp/api/_lib/db.js');
const acciones = (await import('./.tmp/api/acciones.js')).default;
const itemApi = (await import('./.tmp/api/inventario-item.js')).default;
const { hashPassword } = await import('./.tmp/api/_lib/password.js');
const ig = await import('./.tmp/api/_lib/instagram.js');
const igp = await import('./.tmp/api/_lib/instagramPanel.js');
const bz = await import('./.tmp/api/_lib/bazar.js');

// ── Instagram falso
const posts = [];          // lo publicado (más nuevo primero)
const contenedores = {};   // id → { caption }
let nId = 0, publicaciones = 0, enVuelo = 0, maxVuelo = 0, estadoFotos = 'FINISHED', fallarMedia = false, demora = 0;
const J = (j, st = 200) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j), headers: { get: () => null } });
const dormir = ms => new Promise(r => setTimeout(r, ms));
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  if (!url.includes('graph.instagram.com')) return J({}, 404);
  const u = new URL(url), m = o.method || 'GET', partes = u.pathname.split('/');
  if (m === 'POST') {
    const p = new URLSearchParams(String(o.body));
    if (u.pathname.endsWith('/media')) {
      if (fallarMedia) return J({ error: { message: 'Media download has failed.', code: 9004 } }, 400);
      enVuelo++; maxVuelo = Math.max(maxVuelo, enVuelo); if (demora) await dormir(demora); enVuelo--;
      const id = 'c' + (++nId); contenedores[id] = { caption: p.get('caption') || '' }; return J({ id });
    }
    if (u.pathname.endsWith('/media_publish')) {
      publicaciones++; const id = 'post' + (++nId);
      posts.unshift({ id, caption: contenedores[p.get('creation_id')]?.caption || '', permalink: `https://www.instagram.com/p/${id}/`, timestamp: new Date().toISOString() });
      return J({ id });
    }
    return J({ id: 'x' + (++nId) });
  }
  const f = u.searchParams.get('fields') || '';
  if (u.pathname.endsWith('/media') && f.includes('caption')) return J({ data: posts.slice(0, Number(u.searchParams.get('limit') || 25)) });
  if (f === 'status_code') return J({ status_code: estadoFotos });
  if (f === 'permalink') return J({ permalink: `https://www.instagram.com/p/${partes.at(-1)}/` });
  if (f === 'id') return J({ id: partes.at(-1) });
  return J({});
};
const mk = () => ({ statusCode: 200, body: undefined, h: {}, status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; return this; },
  send(x) { this.body = x; return this; }, end(x) { if (x !== undefined) this.body = x; return this; }, setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; } });
let ipN = 0;
const llamar = async (fn, { method = 'POST', query = {}, body = {} } = {}) => { const res = mk(); await fn({ method, query, body: { ...body }, url: '/api/x', headers: { 'x-real-ip': '10.58.' + (ipN++ % 250) + '.1', host: 'stiimpys.store', authorization: 'Bearer TA' } }, res); return { code: res.statusCode, body: res.body }; };
const publicar = id => llamar(itemApi, { query: { op: 'instagram', id: String(id) } });
const op = (o, body = {}, method = 'POST') => llamar(acciones, { method, query: { op: o }, body });
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);
const inv = id => fake.inventario.find(p => p.id === id);
const hace = s => new Date(Date.now() - s * 1000).toISOString();

fake.bazares = [{ id: 1, nombre: 'Stiimpys', slug: 'stiimpys', permisos: {}, instagramConfig: { plantilla: false } }];
fake.usuarios = [{ id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA', password: await hashPassword('x') }];
for (const k of ['actividad', 'rate_limits', 'bloqueos', 'sistema', 'igProgramados', 'tiendaConfig', 'drops']) fake[k] = [];
const P = (id, extra = {}) => ({ id, bazarId: 1, nombre: `Playera ${id}`, talla: 'M', estado: '9/10', precio_venta: 200, vendido: false,
  imagenes: [1, 2, 3].map(n => `https://res.cloudinary.com/demo/image/upload/v1/bazar/p${id}-${n}.jpg`), ...extra });
fake.inventario = [P(701, { instagramPublicando: true }), P(702, { instagramPublicando: hace(10) }), P(703, { instagramPublicando: hace(300) }), P(704), P(705, { instagramPublicando: hace(400) }), P(706)];
const db = await getDB();

grupo('Candado con hora');
let r = await publicar(701);
ok(r.code === 200 && inv(701).instagramId && !('instagramPublicando' in inv(701)), 'un candado viejo (de antes, sin hora) ya no bloquea: se publica');
r = await publicar(702);
ok(r.code === 409 && r.body.publicandoDesde && /desde hace \d+ s/.test(r.body.error) && /Con problemas/.test(r.body.error), `uno de hace 10 s sí bloquea, con mensaje claro (${r.body.error})`);
r = await publicar(703);
ok(r.code === 200 && inv(703).instagramId, 'uno de hace 5 min (se cortó) se toma solo y se publica');
ok(typeof inv(704).instagramPublicando === 'undefined', 'las demás no tienen candado');

grupo('Si sí salió, se liga (no se duplica)');
posts.unshift({ id: 'postViejo', caption: 'Playera 705\n\nDisponible en stiimpys.store/p/705 (link en bio)', permalink: 'https://www.instagram.com/p/postViejo/', timestamp: hace(420) });
let antes = publicaciones;
r = await publicar(705);
ok(r.code === 200 && r.body.recuperada === true && inv(705).instagramId === 'postViejo' && publicaciones === antes, 'el intento anterior sí había salido: se liga y no se publica otra vez');
posts.unshift({ id: 'postOtro', caption: 'Disponible en stiimpys.store/p/7060', permalink: 'x', timestamp: hace(5) });
inv(706).instagramError = { mensaje: 'x', en: hace(60), intentos: 1 };
antes = publicaciones;
r = await publicar(706);
ok(r.code === 200 && !r.body.recuperada && inv(706).instagramId !== 'postOtro' && publicaciones === antes + 1, 'no confunde la prenda 706 con la 7060: publica la suya');
ok(!inv(706).instagramError, 'al publicar bien se borra el error');

grupo('Errores guardados');
fake.inventario.push(P(710));
fallarMedia = true;
r = await publicar(710);
ok(r.code === 502 && inv(710).instagramError?.intentos === 1 && /Media download/.test(inv(710).instagramError.mensaje) && !inv(710).instagramPublicando, 'si falla: error guardado, sin candado (se puede reintentar)');
r = await publicar(710);
ok(inv(710).instagramError?.intentos === 2, 'cuenta los intentos');
fallarMedia = false;
const pub = bz.prendaPublica({ ...inv(710), instagramPublicando: hace(1), instagramPrecio: { comentario: 'c' }, instagramVendido: { comentario: 'c' } });
ok(!('instagramError' in pub) && !('instagramPublicando' in pub) && !('instagramPrecio' in pub) && !('instagramVendido' in pub), 'la tienda no recibe errores, candados ni ids de comentarios');

grupo('Más rápido y con tope de tiempo');
demora = 150; maxVuelo = 0;
let t0 = Date.now();
await ig.publicarImagenes(fake.bazares[0], [1, 2, 3, 4, 5, 6].map(n => `https://res.cloudinary.com/demo/image/upload/v1/x${n}.jpg`), 'Carrusel');
ok(maxVuelo >= 6 && Date.now() - t0 < 600, `las 6 fotos del carrusel se suben a la vez (${maxVuelo} a la vez, ${Date.now() - t0} ms; antes ~${6 * 150} ms en fila)`);
demora = 0; estadoFotos = 'IN_PROGRESS'; antes = publicaciones; t0 = Date.now();
let err = null;
try { await ig.publicarImagenes(fake.bazares[0], ['https://res.cloudinary.com/demo/image/upload/v1/a.jpg', 'https://res.cloudinary.com/demo/image/upload/v1/b.jpg'], 'x', { limiteMs: 200 }); } catch (e) { err = e; }
ok(err && /tardando/.test(err.message) && publicaciones === antes && Date.now() - t0 < 3000, 'si Instagram tarda, se detiene a tiempo y no publica nada (antes el servidor la cortaba a medias)');
estadoFotos = 'FINISHED';

grupo('Con problemas');
fake.inventario.push(P(720, { instagramPublicando: hace(20) }), P(721, { instagramPublicando: hace(600) }), P(722, { vendido: true, instagramError: { mensaje: 'x' } }));
fake.igProgramados.push(
  { _id: 'prog1', id: 1, bazarId: 1, tipo: 'post', imagenes: ['https://res.cloudinary.com/demo/image/upload/v1/q.jpg'], caption: 'Programado que falló', estado: 'error', error: 'Instagram no pudo procesar una de las fotos.', publicarEn: hace(3600) },
  { _id: 'prog2', id: 2, bazarId: 1, tipo: 'post', imagenes: ['https://res.cloudinary.com/demo/image/upload/v1/q.jpg'], caption: 'Programado que se cortó', estado: 'publicando', tomadoEn: hace(1200), publicarEn: hace(1300) },
  { _id: 'prog3', id: 3, bazarId: 1, tipo: 'post', imagenes: ['https://res.cloudinary.com/demo/image/upload/v1/q.jpg'], caption: 'Bien', estado: 'pendiente', publicarEn: hace(-3600) },
);
r = await op('ig-problemas', {}, 'GET');
const est = Object.fromEntries((r.body.prendas || []).map(p => [p.id, p.estado]));
ok(est[710] === 'error' && est[720] === 'publicando' && est[721] === 'atorada', `lista prendas con error, publicándose y a medias (${JSON.stringify(est)})`);
ok(!(722 in est) && !(701 in est) && !(702 in est && est[702] !== 'publicando'), 'sin vendidas ni ya publicadas');
ok((r.body.programados || []).map(x => x.id).sort().join() === '1,2', 'programados con error o atorados (no los que van bien)');
ok(r.body.total === 2 + 2 + (est[702] ? 0 : 0), `el número rojo cuenta solo lo que necesita atención (${r.body.total})`);

grupo('Destrabar, cancelar y reintentar');
r = await op('ig-destrabar', { id: 720 });
ok(r.code === 409 && /espera un poco/.test(r.body.error), 'si empezó hace poco, no se destraba sin confirmar');
r = await op('ig-destrabar', { id: 720, forzar: true });
ok(r.code === 200 && r.body.libre && !inv(720).instagramPublicando, 'con confirmación, se destraba');
posts.unshift({ id: 'post721', caption: 'Playera 721 · Disponible en stiimpys.store/p/721', permalink: 'https://www.instagram.com/p/post721/', timestamp: hace(590) });
r = await op('ig-destrabar', { id: 721 });
ok(r.code === 200 && r.body.vinculada && inv(721).instagramId === 'post721' && !inv(721).instagramPublicando, 'si el post sí salió, destrabar lo liga (no hay que publicar)');
r = await op('ig-destrabar', { id: 721, _n: 2 });   // (_n: el panel frena dos envíos idénticos en 6 s)
ok(r.code === 200 && r.body.yaPublicada, 'una ya publicada no se toca');
r = await op('ig-descartar-error', { id: 710 });
ok(r.code === 200 && !inv(710).instagramError, '"Cancelar" quita el error');
posts.unshift({ id: 'postProg2', caption: 'Programado que se cortó', permalink: 'https://www.instagram.com/p/postProg2/', timestamp: hace(1190) });
antes = publicaciones;
r = await op('ig-programado-reintentar', { id: 2 });
ok(r.code === 200 && r.body.yaSalio && fake.igProgramados.find(x => x.id === 2).estado === 'publicado' && publicaciones === antes, 'uno que se cortó pero sí salió: se marca publicado, sin duplicar');
antes = publicaciones;
r = await op('ig-programado-reintentar', { id: 1 });
ok(r.code === 200 && fake.igProgramados.find(x => x.id === 1).estado === 'publicado' && publicaciones === antes + 1, 'reintentar un programado con error: se publica');
r = await op('ig-programado-reintentar', { id: 3 });
ok(r.code === 400, 'uno que va bien no se toca');

grupo('Rescate automático de programados');
fake.igProgramados.push({ _id: 'prog4', id: 4, bazarId: 1, tipo: 'post', imagenes: ['https://res.cloudinary.com/demo/image/upload/v1/q.jpg'], caption: 'Se cortó y salió', estado: 'publicando', tomadoEn: hace(1500), publicarEn: hace(1600) },
  { _id: 'prog5', id: 5, bazarId: 1, tipo: 'post', imagenes: ['https://res.cloudinary.com/demo/image/upload/v1/q.jpg'], caption: 'Se cortó y NO salió', estado: 'publicando', tomadoEn: hace(1500), publicarEn: hace(-99999) });
posts.unshift({ id: 'postProg4', caption: 'Se cortó y salió', permalink: 'p4', timestamp: hace(1490) });
await igp.procesarProgramados(db, 0);
ok(fake.igProgramados.find(x => x.id === 4).estado === 'publicado' && fake.igProgramados.find(x => x.id === 5).estado === 'pendiente', 'si sí salió → publicado; si no → vuelve a la fila');
