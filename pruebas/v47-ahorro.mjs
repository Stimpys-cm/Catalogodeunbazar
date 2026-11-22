// Pruebas v47: la IA no gasta de más, no repite trabajo y no inventa.
// - Hasta 8 fotos por prenda (la etiqueta puede estar en cualquiera) sin subir el costo.
// - Marca/talla poco seguras se dejan vacías (y la marca dudosa sale del nombre).
// - Si el agente va a investigar una pieza rara, el análisis rápido no paga el modelo grande.
// - Lo que ya analizó el modelo preciso sirve para "Automático"; dos pedidos iguales a la vez pagan una sola vez.
// - Agente: memoria por fotos (no por nombre), búsquedas según rareza, sin comparables inventados,
//   rareza y época solo con pruebas.
process.env.SESSION_SECRET = 'secreto-de-prueba-v47';
process.env.ANTHROPIC_API_KEY = 'sk-ant-prueba';
process.env.IA_TIEMPO_MS = '2000'; process.env.IA_ESPERA_MS = '5'; process.env.IA_PRESUPUESTO_MS = '20000';
for (const k of ['MULTI_BAZAR', 'BAZAR_PRINCIPAL', 'IA_MODELO', 'IA_MODELO_RAPIDO', 'ANTHROPIC_ADMIN_KEY', 'TELEGRAM_BOT_TOKEN']) delete process.env[k];

const { fake } = await import('./.tmp/api/_lib/db.js');
const acciones = (await import('./.tmp/api/acciones.js')).default;
const { hashPassword } = await import('./.tmp/api/_lib/password.js');

let cola = [], demora = 0;
const vistas = [];
const J = (j, st = 200) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j), headers: { get: () => null } });
const prenda = (extra = {}) => ({ ok: true, n: 'Sudadera Nike Vintage', m: 'Nike', c: 'Sudaderas', t: 'M', e: '9/10', d: 'x', h: '#nike', p: 450, r: [400, 500], f: 0, conf: { m: 0.9, t: 0.9, p: 0.9 }, rz: 1, rs: [], ...extra });
const informe = (extra = {}) => ({ n: 'Playera Nirvana', m: 'Nirvana', c: 'Playeras', t: 'L', e: '9/10', epoca: { rango: '1993', decada: '90s', pistas: ['Single stitch'] },
  rareza: { nivel: 4, senales: ['Merch original', 'Single stitch'] }, autenticidad: { nivel: 'alta', notas: [] },
  comparables: [{ titulo: 'Real', sitio: 'eBay', precio: 150, moneda: 'USD', vendido: true, url: 'https://www.ebay.com/itm/1' }, { titulo: 'Inventado', sitio: 'eBay', precio: 900, moneda: 'USD', vendido: true, url: 'https://www.ebay.com/itm/999' }],
  mxn: { justo: 1500 }, conf: 0.7, ...extra });
const respAgente = (inf, urls = ['https://www.ebay.com/itm/1']) => ({ content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: urls.map(url => ({ type: 'web_search_result', url })) }, { type: 'text', text: JSON.stringify(inf) }], usage: { input_tokens: 5000, output_tokens: 500 }, stop_reason: 'end_turn' });
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  if (url.includes('api.anthropic.com')) {
    const cuerpo = JSON.parse(o.body); vistas.push(cuerpo);
    if (demora) await new Promise(r => setTimeout(r, demora));
    const r = cola.length ? cola.shift() : null;
    if (r) return J(r.j || r, r.st || 200);
    const esAgente = String(cuerpo.system?.[0]?.text || '').includes('tasador');
    return J(esAgente ? respAgente(informe()) : { content: [{ type: 'text', text: JSON.stringify(prenda()) }], usage: { input_tokens: 2000, output_tokens: 300 } });
  }
  if (url.includes('frankfurter')) return J({ rates: { MXN: 20 } });
  return J({}, 404);
};
const mk = () => ({ statusCode: 200, body: undefined, h: {}, headersSent: false, writableEnded: false,
  status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; this.headersSent = this.writableEnded = true; return this; },
  send(x) { this.body = x; return this; }, end(x) { if (x !== undefined) this.body = x; return this; },
  setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; } });
let ipN = 0;
const pedir = async (op, body) => {
  const res = mk();
  await acciones({ method: 'POST', query: { op }, body, url: '/api/x', headers: { 'x-real-ip': '10.47.' + (ipN++ % 250) + '.1', host: 'stiimpys.store', authorization: 'Bearer TA' } }, res);
  return { code: res.statusCode, body: res.body };
};
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);
const resp = d => ({ j: { content: [{ type: 'text', text: JSON.stringify(d) }], usage: { input_tokens: 2000, output_tokens: 300 } } });

fake.bazares = [{ id: 1, nombre: 'Stiimpys', slug: 'stiimpys', permisos: {} }];
fake.usuarios = [{ id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA', password: await hashPassword('x') }];
fake.inventario = [];
for (const k of ['iaCache', 'iaUso', 'iaAprendizaje', 'actividad', 'rate_limits', 'tipoCambio', 'bloqueos', 'iaSaldo', 'sistema']) fake[k] = [];
let nF = 0;
const fotos = n => Array.from({ length: n }, () => `https://res.cloudinary.com/demo/image/upload/v1/bazar/f${++nF}.jpg`);
const listas = { categorias: ['Sudaderas', 'Playeras'], tallas: ['M Hombre', 'L Hombre'], estados: ['9/10'], marcas: ['Nike', 'Nirvana'], bazarId: 1 };
const analizar = (extra = {}) => pedir('ia-prenda', { imagenes: fotos(3), ...listas, ...extra });
const imgs = c => c.messages[0].content.filter(x => x.type === 'image');

// ═════════════════════════════════════════════════════════════
grupo('Hasta 8 fotos por prenda, sin subir el costo');
vistas.length = 0; await analizar({ imagenes: fotos(3) });
ok(imgs(vistas[0]).length === 3 && imgs(vistas[0]).every(i => /w_640/.test(i.source.url)), 'con 3 fotos: las 3 a 640 px');
vistas.length = 0; await analizar({ imagenes: fotos(6) });
ok(imgs(vistas[0]).length === 6 && imgs(vistas[0]).every(i => /w_512/.test(i.source.url)), 'con 6 fotos: las 6 a 512 px (la etiqueta puede ser la 6ª)');
vistas.length = 0; await analizar({ imagenes: fotos(10) });
ok(imgs(vistas[0]).length === 8, 'con 10 fotos: la IA ve 8 (las demás van a la tienda e Instagram)');
const sys = vistas[0].system[0].text;
ok(/Revisa TODAS las fotos/.test(sys) && /NO INVENTES/.test(sys) && /No adivines/.test(sys) && /NO la infles/.test(sys), 'instrucciones: revisar todas las fotos, no inventar, no adivinar la talla, no inflar la rareza');
const r6 = await analizar({ imagenes: fotos(6) });
ok(r6.body.portada >= 0 && r6.body.portada <= 5, 'la portada puede ser cualquiera de las 6');

grupo('No inventar marca ni talla');
cola = [resp(prenda({ conf: { m: 0.3, t: 0.9, p: 0.8 } })), resp(prenda({ conf: { m: 0.3, t: 0.9, p: 0.8 } }))];
let r = await analizar();
ok(r.body.marca === '' && r.body.nombre === 'Sudadera Vintage' && r.body.sinConfirmar.includes('marca'), `ni el modelo rápido ni el preciso están seguros de la marca: vacía y fuera del nombre ("${r.body.nombre}")`);
cola = [resp(prenda({ conf: { m: 0.9, t: 0.2, p: 0.8 } })), resp(prenda({ conf: { m: 0.9, t: 0.2, p: 0.8 } }))];
r = await analizar();
ok(r.body.talla === '' && r.body.sinConfirmar.includes('talla') && r.body.marca === 'Nike', 'talla poco segura: vacía para revisarla en la etiqueta');
cola = [resp(prenda())];
r = await analizar();
ok(r.body.marca === 'Nike' && r.body.talla === 'M Hombre' && r.body.sinConfirmar.length === 0, 'con buena seguridad se llenan normal');

grupo('No pagar dos veces el modelo grande');
cola = [resp(prenda({ rz: 4, rs: ['Single stitch'], conf: { m: 0.4, t: 0.5, p: 0.3 } }))]; vistas.length = 0;
r = await analizar({ investigarRaras: true });
ok(vistas.length === 1 && /haiku/.test(r.body.modelo), 'pieza rara que va a investigar el agente: el análisis rápido NO escala al modelo grande (1 llamada)');
cola = [resp(prenda({ rz: 4, rs: ['Single stitch'], conf: { m: 0.4, t: 0.5, p: 0.3 } }))]; vistas.length = 0;
r = await analizar();
ok(vistas.length === 2, 'sin agente después, la duda sí se revisa con el grande (2 llamadas)');
cola = [resp(prenda({ rz: 1, conf: { m: 0.4, t: 0.5, p: 0.3 } }))]; vistas.length = 0;
await analizar({ investigarRaras: true });
ok(vistas.length === 2, 'una pieza común que duda sí se revisa con el grande (el agente no la va a ver)');

grupo('No repetir trabajo');
const f3 = fotos(3); vistas.length = 0;
await pedir('ia-prenda', { imagenes: f3, ...listas, calidad: 'maxima' });
r = await pedir('ia-prenda', { imagenes: f3, ...listas, calidad: 'auto' });
ok(vistas.length === 1 && r.body.desdeMemoria, 'lo que ya analizó "Máxima precisión" sirve para "Automático" (gratis)');
const f4 = fotos(3); vistas.length = 0; demora = 60;
const tres = await Promise.all([1, 2, 3].map(() => pedir('ia-prenda', { imagenes: f4, ...listas })));
demora = 0;
ok(vistas.length === 1 && tres.every(x => x.code === 200) && tres.filter(x => x.body.desdeMemoria).length === 2, `3 pedidos iguales al mismo tiempo (doble clic, dos pestañas): se paga 1 (${vistas.length} llamada)`);

grupo('Agente: gastar solo lo necesario');
const fa = fotos(4); vistas.length = 0;
r = await pedir('ia-agente', { imagenes: fa, ...listas, datos: { nombre: 'Playera' } });
ok(r.code === 200 && vistas[0].tools[0].max_uses === 3, 'sin saber que es muy rara: máximo 3 búsquedas');
const r2 = await pedir('ia-agente', { imagenes: fa, ...listas, datos: { nombre: 'Playera Nirvana editada', talla: 'L Hombre' } });
ok(vistas.length === 1 && r2.body.desdeMemoria, 'cambiar el nombre o la talla no vuelve a pagar la investigación (memoria por fotos)');
vistas.length = 0;
await pedir('ia-agente', { imagenes: fotos(4), ...listas, rareza: 4 });
ok(vistas[0].tools[0].max_uses === 5, 'si el análisis rápido dijo "muy rara": hasta 5 búsquedas');
ok(/deja de buscar/.test(vistas[0].system[0].text) && /No repitas una búsqueda/.test(vistas[0].system[0].text), 'le pide no repetir búsquedas y parar cuando ya tiene 3 vendidas');
vistas.length = 0;
await pedir('ia-agente', { imagenes: fotos(7), ...listas });
ok(imgs(vistas[0]).length === 7 && imgs(vistas[0]).every(i => /w_512/.test(i.source.url)), 'el agente también ve hasta 8 fotos');
const fb = fotos(3); vistas.length = 0; demora = 60;
const dos = await Promise.all([1, 2].map(() => pedir('ia-agente', { imagenes: fb, ...listas })));
demora = 0;
ok(vistas.length === 1 && dos.some(x => x.body.desdeMemoria), 'doble clic en "Investigar": se paga una sola investigación');

grupo('Agente: no inventar');
r = await pedir('ia-agente', { imagenes: fotos(2), ...listas });
ok(r.body.comparables.length === 1 && r.body.comparables[0].titulo === 'Real', 'un comparable que no salió en la búsqueda no se muestra');
cola = [{ j: respAgente(informe({ rareza: { nivel: 4, senales: [] } })) }];
r = await pedir('ia-agente', { imagenes: fotos(2), ...listas });
ok(r.body.rareza.nivel === 2 && r.body.rareza.ajustada, '"muy rara" sin ninguna señal que se vea → baja a "buscada"');
cola = [{ j: respAgente(informe({ rareza: { nivel: 5, senales: ['Una sola'] } })) }];
r = await pedir('ia-agente', { imagenes: fotos(2), ...listas });
ok(r.body.rareza.nivel === 3, '"grial" con una sola señal → "rara" (para 4–5 hacen falta 2 señales)');
cola = [{ j: respAgente(informe({ epoca: { rango: '1985', decada: '80s', pistas: [] } })) }];
r = await pedir('ia-agente', { imagenes: fotos(2), ...listas });
ok(r.body.epoca.rango === '' && r.body.epoca.decada === '', 'una época sin pistas que se vean no se muestra');
cola = [{ j: { content: [{ type: 'text', text: JSON.stringify(informe()) }], usage: {}, stop_reason: 'end_turn' } }];
r = await pedir('ia-agente', { imagenes: fotos(2), ...listas });
ok(r.body.comparables.length === 0 && r.body.confianza <= 0.45, 'si no buscó en internet, no presenta "ventas" de memoria y baja la confianza');
ok(/NO INVENTES NADA/.test(vistas.at(-1).system[0].text), 'instrucción: no inventar nada');

console.log(`\nRESULTADO ${process.exitCode ? 'con fallas' : 'todo bien'}`);
