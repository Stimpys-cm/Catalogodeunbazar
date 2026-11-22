// Pruebas v52: borradores de prendas (lo que se subió en el Registro rápido y falta registrar).
process.env.SESSION_SECRET = 'secreto-de-prueba-v52';
for (const k of ['MULTI_BAZAR', 'BAZAR_PRINCIPAL']) delete process.env[k];

const { fake } = await import('./.tmp/api/_lib/db.js');
const acciones = (await import('./.tmp/api/acciones.js')).default;
const { hashPassword } = await import('./.tmp/api/_lib/password.js');

const mk = () => ({ statusCode: 200, body: undefined, h: {}, headersSent: false, writableEnded: false,
  status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; this.headersSent = this.writableEnded = true; return this; },
  send(x) { this.body = x; return this; }, end(x) { if (x !== undefined) this.body = x; return this; },
  setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; } });
let ipN = 0;
const pedir = async (op, body, token = 'TA', method = 'POST', query = {}) => {
  const res = mk();
  await acciones({ method, query: { op, ...query }, body, url: '/api/x', headers: { 'x-real-ip': '10.52.' + (ipN++ % 250) + '.1', host: 'stiimpys.store', ...(token ? { authorization: 'Bearer ' + token } : {}) } }, res);
  return { code: res.statusCode, body: res.body };
};
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);

fake.bazares = [{ id: 1, nombre: 'Stiimpys', slug: 'stiimpys', permisos: {} }, { id: 2, nombre: 'Otro', slug: 'otro', permisos: {} }];
fake.usuarios = [
  { id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA', password: await hashPassword('x') },
  { id: 2, username: 'vende1', role: 'vendedor', bazarId: 1, sessionToken: 'TV1', password: await hashPassword('x') },
  { id: 3, username: 'vende2', role: 'vendedor', bazarId: 2, sessionToken: 'TV2', password: await hashPassword('x') },
];
for (const k of ['borradores', 'actividad', 'rate_limits', 'bloqueos', 'sistema']) fake[k] = [];
const foto = n => `https://res.cloudinary.com/demo/image/upload/v1/bazar/b${n}.jpg`;
const uid = n => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

grupo('Guardar');
let r = await pedir('b-guardar', { borradores: [
  { id: uid(1), fotos: [foto(1), foto(2)], f: { nombre: '<script>x</script>Playera Jordan', marca: 'Jordan', precio: '450', costo: '', incluir: true, categoria: 'Playeras' }, ia: { detalles: ['Logo bordado'], fallas: [] }, lote: 'DROP 19-11 · 20 nov' },
  { id: 'malo', fotos: [foto(3)], f: {} },
  { id: uid(2), fotos: ['https://evil.example/x.jpg'], f: {} },
  { id: uid(3), fotos: [foto(4)], f: { nombre: 'x'.repeat(500), precio: -5 } },
], bazarId: 1 });
ok(r.code === 200 && r.body.guardados.join() === [uid(1), uid(3)].join() && r.body.rechazados.length === 2, `guarda los válidos; rechaza id raro y fotos que no son de Cloudinary (${JSON.stringify(r.body)})`);
let d = fake.borradores.find(x => x.id === uid(1));
ok(d && !/[<>]/.test(d.f.nombre) && d.f.precio === 450 && d.f.costo === '' && d.f.incluir === true && d.bazarId === 1 && d.en && d.por === 'jefa', 'limpia los textos, precio como número, guarda bazar, fecha y quién');
ok(fake.borradores.find(x => x.id === uid(3)).f.nombre.length <= 140 && !('precio' in fake.borradores.find(x => x.id === uid(3)).f), 'nombre con tope; precio negativo no se guarda');
ok(d.ia?.detalles?.[0] === 'Logo bordado' && d.lote === 'DROP 19-11 · 20 nov', 'guarda lo que vio la IA y el lote');
const en0 = d.en;
await new Promise(x => setTimeout(x, 15));
r = await pedir('b-guardar', { borradores: [{ id: uid(1), fotos: [foto(2), foto(1)], f: { nombre: 'Playera Jordan negra', precio: 480 } }] });
d = fake.borradores.find(x => x.id === uid(1));
ok(r.code === 200 && d.f.precio === 480 && d.fotos[0] === foto(2) && d.en === en0 && d.actualizado > en0 && fake.borradores.length === 2, 'guardar otra vez el mismo: se actualiza (orden de fotos y datos), no se duplica');
r = await pedir('b-guardar', { borradores: [{ id: uid(1), fotos: [foto(2), foto(1)], f: { nombre: 'Playera Jordan negra', precio: 480 } }] });
ok(r.code === 200, 'el mismo pedido dos veces seguidas no da "operación repetida" (se guarda solo cada que cambias algo)');
const grande = { detalles: ['x'], fallas: [], porque: 'y'.repeat(40000) };
r = await pedir('b-guardar', { borradores: [{ id: uid(4), fotos: [foto(5)], f: {}, ia: grande, agente: { r: 'z'.repeat(50000) } }] });
d = fake.borradores.find(x => x.id === uid(4));
ok(r.code === 200 && d.ia && !d.ia.porque && d.ia.detalles?.[0] === 'x' && d.agente === null, 'lo de la IA demasiado grande se recorta a lo importante');
r = await pedir('b-guardar', { borradores: Array.from({ length: 51 }, (_, i) => ({ id: uid(100 + i), fotos: [foto(1)] })) });
ok(r.code === 400, 'máximo 50 por vez');
r = await pedir('b-guardar', { borradores: [] });
ok(r.code === 400, 'vacío: no');

grupo('Cada bazar ve lo suyo');
r = await pedir('b-guardar', { borradores: [{ id: uid(20), fotos: [foto(20)], f: { nombre: 'Del bazar 2' } }] }, 'TV2');
ok(r.code === 200 && fake.borradores.find(x => x.id === uid(20)).bazarId === 2, 'el vendedor guarda en su bazar (aunque mande otro bazarId)');
r = await pedir('b-guardar', { borradores: [{ id: uid(1), fotos: [foto(9)], f: { nombre: 'Robado' } }] }, 'TV2');
ok(r.code === 200 && r.body.rechazados.includes(uid(1)) && fake.borradores.find(x => x.id === uid(1)).f.nombre === 'Playera Jordan negra', 'no puede cambiar un borrador de otro bazar');
r = await pedir('b-lista', null, 'TV2', 'GET');
ok(r.code === 200 && r.body.borradores.length === 1 && r.body.borradores[0].id === uid(20) && !('_id' in r.body.borradores[0]), 'la lista del vendedor solo trae los de su bazar');
r = await pedir('b-lista', null, 'TA', 'GET');
ok(r.body.borradores.length === 4 && r.body.borradores[0].id === uid(20), 'el admin global ve todos, lo más reciente primero');
r = await pedir('b-lista', null, 'TA', 'GET', { bazarId: '2' });
ok(r.body.borradores.length === 1, 'el admin puede filtrar por bazar');
r = await pedir('b-borrar', { ids: [uid(1)] }, 'TV2');
ok(r.code === 200 && r.body.borrados === 0 && fake.borradores.some(x => x.id === uid(1)), 'no puede borrar los de otro bazar');

grupo('Borrar');
r = await pedir('b-borrar', { ids: [uid(1), uid(3), 'no-existe-123'] });
ok(r.code === 200 && r.body.borrados === 2 && !fake.borradores.some(x => [uid(1), uid(3)].includes(x.id)), 'borra los que le pides');
r = await pedir('b-borrar', { ids: ['<x>'] });
ok(r.code === 400, 'ids raros: no');

grupo('Seguridad y límites');
r = await pedir('b-lista', null, null, 'GET');
ok(r.code === 401, 'sin sesión: no');
r = await pedir('b-guardar', null, 'TA', 'GET');
ok(r.code === 405, 'guardar solo con POST');
for (let i = 0; i < 2000; i++) fake.borradores.push({ id: 'relleno-' + i, bazarId: 2, fotos: [foto(1)], f: {} });
r = await pedir('b-guardar', { borradores: [{ id: uid(30), fotos: [foto(30)] }] }, 'TV2');
ok(r.code === 409 && /2000|2,000/.test(r.body.error), 'tope de 2,000 borradores por bazar');
r = await pedir('b-guardar', { borradores: [{ id: uid(20), fotos: [foto(21)], f: { nombre: 'Cambio' } }] }, 'TV2');
ok(r.code === 200 && fake.borradores.find(x => x.id === uid(20)).f.nombre === 'Cambio', 'con el tope lleno aún se pueden actualizar los que ya existen');
