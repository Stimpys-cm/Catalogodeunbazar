// Pruebas v46: contador del saldo de la IA (Anthropic no tiene API de saldo:
// la dueña lo escribe y cada uso se descuenta con su costo real; con llave de
// administrador se usa el reporte de costos de Anthropic).
process.env.SESSION_SECRET = 'secreto-de-prueba-v46';
process.env.ANTHROPIC_API_KEY = 'sk-ant-prueba';
process.env.IA_TIEMPO_MS = '400'; process.env.IA_ESPERA_MS = '5'; process.env.IA_PRESUPUESTO_MS = '20000';
process.env.TELEGRAM_BOT_TOKEN = 'tg'; process.env.TELEGRAM_CHAT_ID = '123';
for (const k of ['MULTI_BAZAR', 'BAZAR_PRINCIPAL', 'IA_MODELO', 'IA_MODELO_RAPIDO', 'ANTHROPIC_ADMIN_KEY', 'RESEND_API_KEY', 'AVISOS_CORREO']) delete process.env[k];

const { fake } = await import('./.tmp/api/_lib/db.js');
const acciones = (await import('./.tmp/api/acciones.js')).default;
const { hashPassword } = await import('./.tmp/api/_lib/password.js');
const { leerComprobante } = await import('./.tmp/api/_lib/comprobante.js');

let cola = [], centavos = 0, reporteFalla = false;
const telegram = [], reportes = [];
const J = (j, st = 200) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j), headers: { get: () => null } });
const prenda = { ok: true, n: 'Sudadera Nike', m: 'Nike', c: 'Sudaderas', t: 'M', e: '9/10', d: 'x', h: '#nike', p: 450, r: [400, 500], f: 0, conf: { m: 0.9, t: 0.9, p: 0.9 }, rz: 1 };
const USO = { input_tokens: 2000, output_tokens: 300 };      // Haiku: 2000×0.10 + 300×0.50 = 0.00035 USD
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  if (url.includes('/v1/organizations/cost_report')) { reportes.push({ url, key: o.headers?.['x-api-key'] }); return reporteFalla ? J({ error: { message: 'no' } }, 403) : J({ data: [{ starting_at: 'x', results: [{ amount: String(centavos), currency: 'USD' }] }], has_more: false }); }
  if (url.includes('api.anthropic.com')) {
    const r = cola.length ? cola.shift() : null;
    if (r) return J(r.j, r.st);
    const cuerpo = JSON.parse(o.body);
    if (String(cuerpo.system?.[0]?.text || cuerpo.system).includes('tasador')) return J({ content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'web_search_tool_result', content: [] }, { type: 'text', text: JSON.stringify({ n: 'Playera', m: 'Nike', c: 'Playeras', rareza: { nivel: 2 }, comparables: [], mxn: { justo: 300 }, conf: 0.5 }) }], usage: { input_tokens: 20000, output_tokens: 1000, server_tool_use: { web_search_requests: 2 } }, stop_reason: 'end_turn' });
    if (String(cuerpo.system).includes('comprobantes')) return J({ content: [{ type: 'text', text: JSON.stringify({ esComprobante: true, monto: 500 }) }], usage: USO });
    return J({ content: [{ type: 'text', text: JSON.stringify(prenda) }], usage: USO });
  }
  if (url.includes('api.telegram.org')) { telegram.push(JSON.parse(o.body || '{}').text || ''); return J({ ok: true }); }
  if (url.includes('frankfurter')) return J({ rates: { MXN: 18 }, date: 'hoy' });
  return J({}, 404);
};
const mk = () => ({ statusCode: 200, body: undefined, h: {}, headersSent: false, writableEnded: false,
  status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; this.headersSent = this.writableEnded = true; return this; },
  send(x) { this.body = x; return this; }, end(x) { if (x !== undefined) this.body = x; return this; },
  setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; } });
let ipN = 0;
const pedir = async (op, body, token = 'TA', method = 'POST') => {
  const res = mk();
  await acciones({ method, query: { op }, body, url: '/api/x', headers: { 'x-real-ip': '10.46.' + (ipN++ % 250) + '.1', host: 'stiimpys.store', authorization: 'Bearer ' + token } }, res);
  return { code: res.statusCode, body: res.body };
};
const estado = (token = 'TA') => pedir('ia-estado', undefined, token, 'GET');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);
const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

fake.bazares = [{ id: 1, nombre: 'Stiimpys', slug: 'stiimpys', permisos: {} }];
fake.usuarios = [
  { id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA', password: await hashPassword('x') },
  { id: 2, username: 'vende', role: 'vendedor', bazarId: 1, sessionToken: 'TV', password: await hashPassword('y') },
];
fake.inventario = [];
for (const k of ['iaCache', 'iaUso', 'iaAprendizaje', 'actividad', 'rate_limits', 'tipoCambio', 'bloqueos', 'iaSaldo', 'sistema']) fake[k] = [];
let nF = 0;
const analizar = () => pedir('ia-prenda', { imagenes: [`https://res.cloudinary.com/demo/image/upload/v1/bazar/s${++nF}.jpg`], categorias: ['Sudaderas', 'Playeras'], tallas: ['M Hombre'], estados: ['9/10'], marcas: ['Nike'], bazarId: 1 });
const investigar = () => pedir('ia-agente', { imagenes: [`https://res.cloudinary.com/demo/image/upload/v1/bazar/a${++nF}.jpg`], categorias: ['Playeras'], tallas: [], estados: [], marcas: ['Nike'], bazarId: 1 });

// ═════════════════════════════════════════════════════════════
grupo('Sin saldo puesto');
let r = await estado();
ok(r.code === 200 && r.body.saldo === null && r.body.puedeSaldo === true, 'al principio no hay saldo y la jefa puede ponerlo');
ok(r.body.promedio?.investigacion === 0.1 && r.body.promedio?.prenda === 0.003 && r.body.tc === 18, `promedios de referencia y dólar del día (${JSON.stringify(r.body.promedio)} · ${r.body.tc})`);
r = await estado('TV');
ok(r.body.saldo === null && r.body.puedeSaldo === false, 'un vendedor no ve ni cambia el saldo');

grupo('Poner el saldo');
r = await pedir('ia-saldo', { usd: 5 }, 'TV');
ok(r.code === 403, 'un vendedor no puede poner el saldo');
for (const malo of ['', 'abc', -1, 999999]) { r = await pedir('ia-saldo', { usd: malo }); ok(r.code === 400, `saldo inválido (${JSON.stringify(malo)}) → error claro`); }
r = await pedir('ia-saldo', { usd: '$4.32', umbral: '0.5' });
ok(r.code === 200 && r.body.saldo.inicial === 4.32 && r.body.saldo.queda === 4.32 && r.body.saldo.umbral === 0.5 && r.body.saldo.fuente === 'conteo', `"$4.32" se guarda; queda $${r.body.saldo?.queda}, aviso en $0.5`);

grupo('Cada uso se descuenta con su costo real');
r = await analizar();
const c1 = r.body.costoUSD;
ok(r.code === 200 && cerca(c1, 0.00035, 1e-4), `una prenda con la IA rápida costó $${c1}`);
let s = (await estado()).body.saldo;
ok(cerca(s.gastado, 0.00035, 1e-4) && cerca(s.queda, 4.32 - 0.00035, 1e-4), `el saldo bajó exactamente eso ($${s.queda})`);
r = await investigar();
const c2 = r.body.costoUSD;
ok(r.code === 200 && cerca(c2, 20000 * 2 / 1e6 + 1000 * 10 / 1e6 + 0.02, 1e-4), `una investigación a fondo costó $${c2} (tokens + 2 búsquedas)`);
s = (await estado()).body.saldo;
ok(cerca(s.gastado, 0.00035 + c2, 1e-4), `también se descuenta ($${s.gastado.toFixed(4)} gastado)`);
r = await pedir('ia-texto', { tipo: 'caption', prenda: { nombre: 'x' } });
const l = await leerComprobante('https://res.cloudinary.com/demo/image/upload/v1/c.jpg');
s = (await estado()).body.saldo;
ok(l.monto === 500 && s.gastado > 0.00035 + c2 + 0.0003, 'los textos de Instagram y la lectura de comprobantes SPEI también cuentan');
await investigar(); await investigar();
r = await estado();
ok(cerca(r.body.promedio.investigacion, c2, 1e-3), `con 3+ investigaciones, el promedio sale de tus datos ($${r.body.promedio.investigacion})`);
const gastadoAntes = r.body.saldo.gastado;
r = await analizar(); await analizar();
const memoria = await pedir('ia-prenda', { imagenes: [`https://res.cloudinary.com/demo/image/upload/v1/bazar/s${nF}.jpg`], categorias: ['Sudaderas'], tallas: ['M Hombre'], estados: ['9/10'], marcas: ['Nike'], bazarId: 1 });
s = (await estado()).body.saldo;
ok(memoria.body.desdeMemoria && cerca(s.gastado, gastadoAntes + 2 * 0.00035, 1e-5), 'lo que sale de memoria (gratis) no descuenta nada');

grupo('Aviso cuando se acaba');
telegram.length = 0;
await pedir('ia-saldo', { usd: 0.1, umbral: 0.05 });
await investigar();
s = (await estado()).body.saldo;
ok(s.bajo && telegram.length === 1 && /saldo de la IA/i.test(telegram[0]), `al bajar de $0.05 avisa por Telegram (${telegram.length})`);
await investigar(); await analizar();
ok(telegram.length === 1, 'y solo una vez por saldo (no llena el celular)');
await pedir('ia-saldo', { usd: 10 });
s = (await estado()).body.saldo;
ok(!s.bajo && s.queda === 10 && s.gastado === 0, 'al actualizar el saldo se reinicia la cuenta y el aviso');

grupo('Anthropic dice "sin saldo"');
telegram.length = 0;
cola = [{ st: 400, j: { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } } }];
r = await analizar();
s = (await estado()).body.saldo;
ok(r.code === 402 && s.sinSaldo && s.queda === 0 && s.bajo, 'queda marcado como agotado (aunque la cuenta dijera que había)');
ok(telegram.length === 1 && /sin saldo/i.test(telegram[0]), 'y avisa por Telegram');
cola = [{ st: 400, j: { type: 'error', error: { message: 'credit balance is too low' } } }];
await investigar();
ok(telegram.length === 1, 'otro intento sin saldo no vuelve a avisar');
await pedir('ia-saldo', { usd: 25 });
s = (await estado()).body.saldo;
ok(!s.sinSaldo && s.queda === 25, 'al recargar y actualizar, se quita lo de agotado');
fake.iaSaldo = [];
cola = [{ st: 400, j: { type: 'error', error: { message: 'credit balance is too low' } } }];
await analizar();
s = (await estado()).body.saldo;
ok(s && s.sinSaldo && s.queda === 0, 'aunque nunca se haya puesto saldo, "sin saldo" se muestra');

grupo('Exacto con la llave de administrador de Anthropic');
process.env.ANTHROPIC_ADMIN_KEY = 'sk-ant-admin01-prueba';
centavos = 130;                                     // lo que ya se gastó hoy antes de poner el saldo ($1.30)
await pedir('ia-saldo', { usd: 20 });
centavos = 130 + 250;                               // luego se gastan $2.50 (también fuera de la página)
fake.iaSaldo[0].real = null;
s = (await estado()).body.saldo;
ok(s.fuente === 'anthropic' && cerca(s.gastado, 2.5, 1e-6) && cerca(s.queda, 17.5, 1e-6), `usa el reporte de Anthropic: gastado $${s.gastado}, queda $${s.queda} (no cuenta lo de antes de ponerlo)`);
ok(reportes.at(-1).key === 'sk-ant-admin01-prueba' && /bucket_width=1d/.test(reportes.at(-1).url), 'pregunta con la llave de administrador, por día');
const n = reportes.length;
await estado(); await estado();
ok(reportes.length === n, 'no pregunta a Anthropic más de una vez cada 5 minutos');
await analizar();
fake.iaSaldo[0].real = null; centavos = 130 + 250;
s = (await estado()).body.saldo;
ok(s.gastado >= 2.5, 'el reporte va atrasado unos minutos: nunca muestra menos de lo que ya se contó aquí');
reporteFalla = true; fake.iaSaldo[0].real = null;
s = (await estado()).body.saldo;
ok(s.fuente === 'conteo' && s.gastado > 0, 'si el reporte falla, sigue con el conteo propio');
reporteFalla = false; delete process.env.ANTHROPIC_ADMIN_KEY;
r = await estado();
ok(!JSON.stringify(r.body).includes('sk-ant'), 'ninguna llave sale al panel');

console.log(`\nRESULTADO ${process.exitCode ? 'con fallas' : 'todo bien'}`);
