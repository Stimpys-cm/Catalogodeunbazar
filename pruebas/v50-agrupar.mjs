// Pruebas v50: separar un lote de fotos en prendas con IA (op ia-agrupar).
// - La IA ve las fotos en orden, numeradas, en miniatura, y dice qué fotos son de cada prenda.
// - La respuesta se limpia: rangos, "Foto 7", repetidas, fuera de rango, sin decidir, no es ropa.
// - Memoria (gratis la segunda vez), dos pedidos iguales pagan una vez, reintentos, otro modelo, sin saldo.
process.env.SESSION_SECRET = 'secreto-de-prueba-v50';
process.env.ANTHROPIC_API_KEY = 'sk-ant-prueba';
process.env.IA_TIEMPO_MS = '2000'; process.env.IA_ESPERA_MS = '5'; process.env.IA_PRESUPUESTO_MS = '20000';
for (const k of ['MULTI_BAZAR', 'BAZAR_PRINCIPAL', 'IA_MODELO', 'IA_MODELO_RAPIDO', 'ANTHROPIC_ADMIN_KEY', 'TELEGRAM_BOT_TOKEN']) delete process.env[k];

const { fake } = await import('./.tmp/api/_lib/db.js');
const acciones = (await import('./.tmp/api/acciones.js')).default;
const { hashPassword } = await import('./.tmp/api/_lib/password.js');
const ag = await import('./.tmp/api/_lib/agrupar.js');

let cola = [], retraso = 0;
const vistas = [];
const J = (j, st = 200, h = {}) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j), headers: { get: k => h[k.toLowerCase()] ?? null } });
const resp = (d, extra = {}) => ({ j: { content: [{ type: 'text', text: typeof d === 'string' ? d : JSON.stringify(d) }], usage: { input_tokens: 5000, output_tokens: 500 }, stop_reason: 'end_turn', ...extra } });
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  if (url.includes('api.anthropic.com')) {
    vistas.push(JSON.parse(o.body));
    if (retraso) await new Promise(r => setTimeout(r, retraso));
    const r = cola.length ? cola.shift() : resp({ p: [{ f: [1, 2], n: 'Algo', s: 0.9 }], x: [] });
    return J(r.j || r, r.st || 200, r.h || {});
  }
  return J({}, 404);
};
const mk = () => ({ statusCode: 200, body: undefined, h: {}, headersSent: false, writableEnded: false,
  status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; this.headersSent = this.writableEnded = true; return this; },
  send(x) { this.body = x; return this; }, end(x) { if (x !== undefined) this.body = x; return this; },
  setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; } });
let ipN = 0;
const pedir = async (body, token = 'TA') => {
  const res = mk();
  await acciones({ method: 'POST', query: { op: 'ia-agrupar' }, body, url: '/api/x', headers: { 'x-real-ip': '10.50.' + (ipN++ % 250) + '.1', host: 'stiimpys.store', ...(token ? { authorization: 'Bearer ' + token } : {}) } }, res);
  return { code: res.statusCode, body: res.body };
};
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);

fake.bazares = [{ id: 1, nombre: 'Stiimpys', slug: 'stiimpys', permisos: {} }];
fake.usuarios = [{ id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA', password: await hashPassword('x') }];
for (const k of ['iaCache', 'iaUso', 'iaAprendizaje', 'actividad', 'rate_limits', 'bloqueos', 'iaSaldo', 'sistema']) fake[k] = [];
fake.iaSaldo = [{ id: 'actual', usd: 5, en: new Date().toISOString(), gastado: 0, umbral: 1 }];
let nF = 0;
const fotos = n => Array.from({ length: n }, () => `https://res.cloudinary.com/demo/image/upload/v1/bazar/a${++nF}.jpg`);

// ═════════════════════════════════════════════════════════════
grupo('Lo que ve la IA');
let im = fotos(6);
cola = [resp({ p: [{ f: [1, 2, 3], n: 'Playera Jordan negra', s: 0.95 }, { f: [4, 5], n: 'Sudadera Nike gris', s: 0.8 }], x: [6] })];
let r = await pedir({ imagenes: im, desde: 1 });
let v = vistas.at(-1), c = v.messages[0].content;
ok(r.code === 200, `responde (${r.code} ${r.body?.error || ''})`);
ok(c.filter(x => x.type === 'image').length === 6 && c[0].text === 'Foto 1' && c[1].type === 'image' && c[10].text === 'Foto 6', 'cada foto va con su número ("Foto 1"… "Foto 6") en el orden en que se tomaron');
ok(c.filter(x => x.type === 'image').every(x => /\/upload\/c_limit,w_320,h_320,q_auto:eco,f_jpg\//.test(x.source.url)), 'van en miniatura de 320 px (barato)');
ok(/separar un lote de fotos en prendas/.test(v.system[0].text) && /etiqueta/.test(v.system[0].text) && /DISTINTAS/.test(v.system[0].text) && /No inventes/.test(v.system[0].text), 'instrucciones: misma prenda por color/tela/estampado, acercamientos y etiquetas con su prenda, parecidas pero distintas, no inventar');
ok(v.model === 'claude-sonnet-5-5' && v.system[0].cache_control?.type === 'ephemeral', 'usa el modelo preciso, con las instrucciones en caché');
ok(JSON.stringify(r.body.prendas) === JSON.stringify([{ f: [1, 2, 3], n: 'Playera Jordan negra', s: 0.95 }, { f: [4, 5], n: 'Sudadera Nike gris', s: 0.8 }]) && JSON.stringify(r.body.x) === '[6]' && r.body.sin.length === 0, 'devuelve las prendas con sus fotos, nombre y seguridad; la foto 6 no es ropa');
ok(r.body.costoUSD > 0 && r.body.costoUSD < 0.05, `cuesta centavos (${r.body.costoUSD} USD)`);

grupo('Tramos que no empiezan en la foto 1');
cola = [resp({ p: [{ f: [35, 36], n: 'A' }, { f: ['Foto 37', '38-40'], n: 'B' }], x: [] })];
im = fotos(6);
r = await pedir({ imagenes: im, desde: 35 });
c = vistas.at(-1).messages[0].content;
ok(c[0].text === 'Foto 35' && c.at(-1).text.includes('de la 35 a la 40'), 'el tramo se numera desde donde va (Foto 35…)');
ok(JSON.stringify(r.body.prendas.map(p => p.f)) === '[[35,36],[37,38,39,40]]', 'acepta "Foto 37" y rangos "38-40"');

grupo('Respuestas desordenadas');
const L = ag.leerAgrupacion;
let a = L({ p: [{ f: [3, 1, 2], n: '<script>x</script>Playera', s: 95 }, { f: [2, 4, 99, 0] }, { f: [] }, 'basura'], x: ['5', 4] }, 1, 6);
ok(JSON.stringify(a.prendas.map(p => p.f)) === '[[1,2,3],[4]]', 'ordena las fotos; una foto repetida se queda con la primera prenda; fuera de rango se ignora');
ok(!/[<>]/.test(a.prendas[0].n) && a.prendas[0].s === 0.95 && a.prendas[1].s === 0.7, 'nombre sin código; seguridad de 0 a 1 (95 se lee como 95 %; 0.7 si no la dijo)');
ok(JSON.stringify(a.x) === '[5]' && JSON.stringify(a.sin) === '[6]', '"x" sin repetir lo que ya tiene prenda; la foto 6 quedó sin decidir');
a = L({ prendas: [{ fotos: ['1 a 3'], nombre: 'Gorra' }] }, 1, 3);
ok(a.prendas[0].f.join() === '1,2,3' && a.prendas[0].n === 'Gorra', 'también entiende "prendas"/"fotos"/"nombre" y "1 a 3"');
a = L({ p: [{ f: ['1-500'] }] }, 1, 40);
ok(a.prendas.length === 0 || a.prendas[0].f.length <= 40, 'un rango absurdo no se expande de más');

grupo('Si no sirve lo que dijo, lo intenta otra vez');
cola = [resp({ p: [{ f: [1] }], x: [] }), resp({ p: [{ f: [1, 2, 3, 4] }], x: [] })];
let n0 = vistas.length;
r = await pedir({ imagenes: fotos(4), desde: 1 });
ok(r.code === 200 && vistas.length === n0 + 2 && r.body.prendas[0].f.length === 4, 'si dejó sin decidir más de la mitad, pide otra vez');
cola = [resp('no sé'), resp('nada'), resp('tampoco')];
r = await pedir({ imagenes: fotos(4), desde: 1 });
ok(r.code === 502 && /no pudo separar estas fotos/.test(r.body.error) && r.body.reintentable === true, `si nunca contesta bien: error claro y reintentable (${r.code})`);
cola = [{ j: { error: { type: 'overloaded_error', message: 'Overloaded' } }, st: 529 }, { j: { error: { type: 'overloaded_error', message: 'Overloaded' } }, st: 529 }, resp({ p: [{ f: [1, 2], n: 'X' }], x: [] })];
n0 = vistas.length;
r = await pedir({ imagenes: fotos(2), desde: 1 });
ok(r.code === 200 && vistas.length === n0 + 3 && vistas.at(-1).model === 'claude-haiku-5-5', 'saturada dos veces: lo hace el modelo rápido');
cola = [{ j: { error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }, st: 400 }];
r = await pedir({ imagenes: fotos(2), desde: 1 });
ok(r.code === 402 && r.body.reintentable === false && fake.iaSaldo[0].sinSaldoEn, `sin saldo: 402, no se reintenta y queda marcado (${r.code})`);
delete fake.iaSaldo[0].sinSaldoEn;

grupo('Modo "Ahorro"');
cola = [resp({ p: [{ f: [1, 2] }], x: [] })];
r = await pedir({ imagenes: fotos(2), desde: 1, calidad: 'ahorro' });
ok(vistas.at(-1).model === 'claude-haiku-5-5', 'en "Ahorro" usa el modelo rápido');

grupo('Memoria: no se paga dos veces');
im = fotos(5);
cola = [resp({ p: [{ f: [1, 2, 3, 4, 5], n: 'Chamarra' }], x: [] })];
n0 = vistas.length;
const r1 = await pedir({ imagenes: im, desde: 1 });
const r2 = await pedir({ imagenes: im, desde: 1 });
ok(vistas.length === n0 + 1 && r2.body.desdeMemoria && r2.body.costoUSD === 0 && r2.body.prendas[0].n === 'Chamarra', 'las mismas fotos otra vez: gratis, de memoria');
cola = [resp({ p: [{ f: [3, 4, 5, 6, 7] }], x: [] })];
await pedir({ imagenes: im, desde: 3 });
ok(vistas.length === n0 + 2, 'mismas fotos con otra numeración sí se preguntan (el resultado depende de los números)');
im = fotos(4); retraso = 150;
cola = [resp({ p: [{ f: [1, 2, 3, 4] }], x: [] })];
n0 = vistas.length;
const [d1, d2] = await Promise.all([pedir({ imagenes: im, desde: 1 }), pedir({ imagenes: im, desde: 1 })]);
retraso = 0;
ok(vistas.length === n0 + 1 && d1.code === 200 && d2.code === 200 && (d1.body.desdeMemoria || d2.body.desdeMemoria), 'dos pedidos iguales al mismo tiempo (doble clic, dos pestañas): se paga uno');

grupo('Gasto y saldo');
const uso = fake.iaUso.reduce((t, f) => ({ usd: t.usd + (f.usd || 0), ag: t.ag + (f.agrupadas || 0), pr: t.pr + (f.prendas || 0) }), { usd: 0, ag: 0, pr: 0 });
ok(uso.ag > 0 && uso.usd > 0 && uso.pr === 0, `se anota en el uso de IA (${uso.ag} fotos separadas) sin contarlas como prendas analizadas`);
ok(fake.iaSaldo[0].gastado > 0, 'se descuenta del saldo de la IA');

grupo('Seguridad y límites');
r = await pedir({ imagenes: fotos(2), desde: 1 }, null);
ok(r.code === 401, 'sin sesión del panel: no');
r = await pedir({ imagenes: ['https://evil.example/x.jpg', ...fotos(2)], desde: 1 });
ok(r.code === 400, 'solo fotos de Cloudinary');
r = await pedir({ imagenes: fotos(1), desde: 1 });
ok(r.code === 400, 'mínimo 2 fotos');
r = await pedir({ imagenes: fotos(49), desde: 1 });
ok(r.code === 400 && /48/.test(r.body.error), 'máximo 48 fotos por tramo');
n0 = vistas.length;
cola = [resp({ p: [{ f: [1, 2] }], x: [] })];
r = await pedir({ imagenes: fotos(2), desde: '1; DROP' });
ok(r.code === 200 && vistas.at(-1).messages[0].content[0].text === 'Foto 1', '"desde" raro se vuelve un número');
delete process.env.ANTHROPIC_API_KEY;
r = await pedir({ imagenes: fotos(2), desde: 1 });
ok(r.code === 503 && /ANTHROPIC_API_KEY/.test(r.body.error), 'sin la llave de la IA: aviso claro');
