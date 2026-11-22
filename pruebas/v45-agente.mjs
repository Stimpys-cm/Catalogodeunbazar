// Pruebas v45: el agente investigador (tipo tasador) y crear marcas/categorías.
// La IA (Anthropic) y la búsqueda en internet son falsas y se programan respuesta por respuesta.
process.env.SESSION_SECRET = 'secreto-de-prueba-v45';
process.env.ANTHROPIC_API_KEY = 'sk-ant-prueba';
process.env.IA_TIEMPO_MS = '400'; process.env.IA_ESPERA_MS = '5'; process.env.IA_PRESUPUESTO_MS = '20000';
for (const k of ['MULTI_BAZAR', 'BAZAR_PRINCIPAL', 'IA_MODELO', 'IA_MODELO_RAPIDO']) delete process.env[k];

const { fake } = await import('./.tmp/api/_lib/db.js');
const acciones = (await import('./.tmp/api/acciones.js')).default;
const { hashPassword } = await import('./.tmp/api/_lib/password.js');
const ag = await import('./.tmp/api/_lib/agente.js');

let cola = [];
const vistas = [];
const J = (j, st = 200, h = {}) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j), headers: { get: k => h[String(k).toLowerCase()] ?? null } });
const err = (st, mensaje, tipo = 'api_error') => ({ st, j: { type: 'error', error: { type: tipo, message: mensaje } } });
// Respuesta del agente: búsquedas con resultados reales + texto final con el JSON
const informe = (extra = {}) => ({
  n: 'Playera Nirvana In Utero Tour 1993', m: 'Nirvana', modelo: 'In Utero Tour', c: 'Playera', cn: '', t: 'L', e: '9/10',
  epoca: { rango: '1993–1994', decada: '90s', pistas: ['Single stitch en mangas', 'Etiqueta Giant', '© 1993 en el estampado'] },
  origen: 'Made in USA', material: '100% algodón',
  rareza: { nivel: 4, senales: ['Merch original de gira', 'Single stitch', 'Etiqueta Giant'] },
  autenticidad: { nivel: 'alta', notas: ['Etiqueta y costuras corresponden a la época'] },
  comparables: [
    { titulo: 'Vintage Nirvana In Utero 1993 Tour Tee L', sitio: 'eBay', precio: 180, moneda: 'USD', vendido: true, fecha: 'oct 2026', url: 'https://www.ebay.com/itm/111' },
    { titulo: 'Nirvana 1993 In Utero tour shirt Giant', sitio: 'Grailed', precio: 150, moneda: 'USD', vendido: true, url: 'https://www.grailed.com/listings/222' },
    { titulo: 'Nirvana In Utero tour 93', sitio: 'eBay', precio: 120, moneda: 'USD', vendido: true, url: 'https://www.ebay.com/itm/333/' },
    { titulo: 'Inventado', sitio: 'eBay', precio: 900, moneda: 'USD', vendido: true, url: 'https://www.ebay.com/itm/999' },
    { titulo: 'Playera Nirvana vintage', sitio: 'Mercado Libre', precio: 3500, moneda: 'MXN', vendido: false, url: 'https://articulo.mercadolibre.com.mx/MLM-444' },
  ],
  mxn: { rapido: 1300, justo: 1500, maximo: 2200 }, evidencia: ['Tres vendidas en EE.UU. entre $120 y $180 USD'],
  d: 'Playera original de la gira In Utero de 1993.', h: ['#nirvana', 'intour', '#vintage'], conf: 0.7, ...extra,
});
const busqueda = urls => ({ type: 'web_search_tool_result', tool_use_id: 'x', content: urls.map(u => ({ type: 'web_search_result', url: u, title: 'resultado' })) });
const URLS = ['https://www.ebay.com/itm/111', 'https://grailed.com/listings/222', 'https://www.ebay.com/itm/333', 'https://articulo.mercadolibre.com.mx/MLM-444'];
const respAgente = (inf = informe(), { urls = URLS, stop = 'end_turn', sinTexto = false } = {}) => ({ st: 200, j: {
  content: [{ type: 'server_tool_use', name: 'web_search', id: 'x', input: { query: 'nirvana in utero tour 1993 sold' } }, busqueda(urls), ...(sinTexto ? [] : [{ type: 'text', text: 'Listo, aquí el informe: ' + JSON.stringify(inf) }])],
  usage: { input_tokens: 3000, output_tokens: 800, server_tool_use: { web_search_requests: 1 } }, stop_reason: stop } });
const respRapida = extra => ({ st: 200, j: { content: [{ type: 'text', text: JSON.stringify({ ok: true, n: 'Jersey Chivas 2006', m: 'Reebok', c: 'Jersey de futbol', cn: 'Jerseys', t: 'M', e: '8/10', d: 'x', h: '#chivas', p: 600, r: [500, 700], f: 0, conf: { m: 0.9, t: 0.8, p: 0.8 }, rz: 3, rs: ['Temporada 2006', 'Reebok'], ...extra }) }], usage: {}, stop_reason: 'end_turn' } });

globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  if (url.includes('api.anthropic.com')) {
    const cuerpo = JSON.parse(o.body); vistas.push(cuerpo);
    const r = cola.length ? cola.shift() : respAgente();
    if (r === 'red') throw new TypeError('fetch failed');
    return J(r.j, r.st);
  }
  if (url.includes('frankfurter')) return J({ rates: { MXN: 20 }, date: '2026-11-19' });
  if (url.startsWith('https://res.cloudinary.com/')) return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 1]).buffer };
  return J({}, 404);
};
const mk = () => ({ statusCode: 200, body: undefined, h: {}, headersSent: false, writableEnded: false,
  status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; this.headersSent = this.writableEnded = true; return this; },
  send(x) { this.body = x; return this; }, end(x) { if (x !== undefined) this.body = x; return this; },
  setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; } });
let ipN = 0;
const pedir = async (op, body, token = 'TA') => {
  const res = mk();
  await acciones({ method: 'POST', query: { op }, body, url: '/api/x', headers: { 'x-real-ip': '10.45.' + (ipN++ % 250) + '.1', host: 'stiimpys.store', authorization: 'Bearer ' + token } }, res);
  return { code: res.statusCode, body: res.body };
};
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);

fake.bazares = [{ id: 1, nombre: 'Stiimpys', slug: 'stiimpys', permisos: {} }, { id: 2, nombre: 'Otro', slug: 'otro', permisos: { gestionarCatalogo: false } }];
fake.usuarios = [
  { id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA', password: await hashPassword('x') },
  { id: 2, username: 'vende', role: 'vendedor', bazarId: 2, sessionToken: 'TV', password: await hashPassword('y') },
];
fake.inventario = [['Playera Nike', 'Nike', 'Playeras', 250], ['Playera Nike 2', 'Nike', 'Playeras', 300], ['Playera banda', 'Nirvana', 'Playeras', 900], ['Playera banda 2', 'Nirvana', 'Playeras', 1100]]
  .map(([nombre, marca, cat, precio], i) => ({ id: i + 1, bazarId: 1, nombre, marca, categorias: [cat], precio_venta: precio, imagenes: [] }));
fake.marcas = [{ id: 1, nombre: 'Nike', bazarId: null }, { id: 4, nombre: 'Nirvana', bazarId: null }];
fake.categorias = [{ id: 1, nombre: 'Playeras', bazarId: null }, { id: 2, nombre: 'Sudaderas', bazarId: null }];
for (const k of ['iaCache', 'iaUso', 'iaAprendizaje', 'actividad', 'rate_limits', 'tipoCambio', 'bloqueos']) fake[k] = [];
const CATS = ['Playeras', 'Sudaderas'], ESTADOS = ['Nueva', 'Nueva con etiqueta', '10/10', '9/10', '8/10', '7/10', '6/10', '5/10', 'Con mucho desgaste'];
const TALLAS = ['S Hombre', 'M Hombre', 'L Hombre', 'XL Hombre'];
let nF = 0;
const investigar = (extra = {}, token) => pedir('ia-agente', { imagenes: [`https://res.cloudinary.com/demo/image/upload/v1/bazar/a${++nF}.jpg`], categorias: CATS, tallas: TALLAS, estados: ESTADOS, marcas: ['Nike', 'Nirvana'], bazarId: 1, ...extra }, token);

// ═════════════════════════════════════════════════════════════
grupo('Informe tipo tasador');
cola = []; vistas.length = 0;
let r = await investigar({ datos: { nombre: 'Playera Nirvana', talla: 'L Hombre' } });
const b = r.body;
ok(r.code === 200 && b.nombre === 'Playera Nirvana In Utero Tour 1993', `identifica la prenda (${r.code} ${b?.nombre || b?.error})`);
ok(b.epoca?.rango === '1993–1994' && b.epoca.pistas.length === 3, `fecha con sus pistas (${b.epoca?.rango}: ${b.epoca?.pistas?.join(' · ')})`);
ok(b.rareza?.nivel === 4 && b.rareza.etiqueta === 'Muy rara' && b.rareza.senales.length === 3, `rareza con señales (${b.rareza?.etiqueta})`);
ok(b.autenticidad?.nivel === 'alta', 'autenticidad con notas');
ok(b.categoria === 'Playeras' && b.talla === 'L Hombre' && b.estado === '9/10', `acomoda categoría, talla y estado (${b.categoria} · ${b.talla} · ${b.estado})`);
ok(!b.comparables.some(c => c.titulo === 'Inventado'), 'un comparable cuyo link NO salió en la búsqueda no se muestra ni cuenta (no se inventan ventas)');
ok(b.comparables.filter(c => c.verificado).length === 4, `los 4 que sí salieron quedan verificados, aunque cambie "www." o la "/" final (${b.comparables.filter(c => c.verificado).length})`);
const ml = b.comparables.find(c => /mercado/i.test(c.sitio));
ok(ml && ml.usd === 175 && ml.mxn === 3500, `precio en pesos de Mercado Libre se convierte bien (${ml?.usd} USD)`);
// Precio: vendidos verificados 120/150/180 → 150 USD × 20 × 0.70 (muy rara) × 0.97 (9/10) = 2037; 70/30 con 1500 → 1876 → $1,900
ok(b.precios.usdMediana === 150 && b.precios.tc === 20, `mediana de vendidas reales: $${b.precios.usdMediana} USD con tipo de cambio ${b.precios.tc}`);
ok(b.precios.justo === 1900, `precio justo para México: $${b.precios.justo} (esperado $1,900)`);
ok(b.precios.rapido < b.precios.justo && b.precios.maximo > b.precios.justo, `rápido $${b.precios.rapido} < justo < máximo $${b.precios.maximo}`);
ok(b.precios.pctMexico === 70 && b.precios.mxnEEUU === 3000, `explica: en EE.UU. ≈ $${b.precios.mxnEEUU} MXN, para México ${b.precios.pctMexico} % por ser muy rara`);
ok(b.precios.verificados === 4 && b.confianza >= 0.8, `3 vendidas verificadas → confianza alta (${b.confianza})`);
ok(b.hashtags === '#nirvana #intour #vintage' && b.busquedas === 1, `hashtags y número de búsquedas (${b.busquedas})`);
const pedido = vistas[0];
ok(pedido.tools?.[0]?.type === 'web_search_20250305' && pedido.tools[0].max_uses === 3 && /Mercado Libre/.test(pedido.system[0].text), 'usa búsqueda en internet (máx. 3 si no se sabe que es muy rara) y busca también en Mercado Libre México');
ok(/eBay|Grailed/.test(pedido.system[0].text) && /no se regala/i.test(pedido.system[0].text) && /Nunca inventes links/.test(pedido.system[0].text), 'instrucciones: vendidas primero, no regalar piezas raras, no inventar links');
ok(b.costoUSD > 0, `costo anotado ($${b.costoUSD} USD)`);

grupo('No regalar piezas raras / no inflar comunes');
const pm = ag.precioMexico;
let p = pm({ comparables: [{ usd: 100, vendido: true, verificado: true }, { usd: 100, vendido: true, verificado: true }], nivel: 3, estado: '8/10', tc: 20, iaMxn: { justo: 100 } });
ok(p.justo === 1000 && p.notas.some(n => /no se regala/.test(n)), `rara con la IA proponiendo $100: no baja del 55 % de EE.UU. ($${p.justo})`);
p = pm({ comparables: [{ usd: 20, vendido: true, verificado: true }, { usd: 30, vendido: true, verificado: true }], nivel: 1, estado: '8/10', tc: 20 });
ok(p.justo === 180, `común de $25 USD → $${p.justo} (40 %)`);
p = pm({ comparables: [{ usd: 20, vendido: true, verificado: true }, { usd: 30, vendido: true, verificado: true }], nivel: 4, estado: '8/10', tc: 20, historial: 1000 });
ok(p.justo === 1000, `rara de una marca por la que sueles cobrar $1,000: no baja de tu historial ($${p.justo})`);
p = pm({ comparables: [{ usd: 400, vendido: false, verificado: false }], nivel: 2, tc: 20, iaMxn: { justo: 900 } });
ok(p.justo > 0 && p.verificados === 0, `sin verificados usa lo que hay, con menos peso ($${p.justo})`);
p = pm({ comparables: [], nivel: 5, tc: 20 });
ok(p.justo === 250 && p.notas.length, 'sin nada: precio de referencia y lo avisa');
ok(ag.redondearPrecio(1234) === 1250 && ag.redondearPrecio(437) === 440 && ag.redondearPrecio(12345) === 12300, 'redondea como en tienda (10, 50 o 100 según el precio)');
ok(Math.round(ag.aUSD(100, 'EUR', 20)) === 108 && ag.aUSD(2000, 'MXN', 20) === 100, 'convierte EUR y MXN a dólares');
cola = [respAgente(informe({ comparables: [] }), { urls: [] })];
r = await investigar();
ok(r.code === 200 && r.body.confianza <= 0.45 && r.body.precios.justo > 0, `sin comparables: confianza baja (${r.body.confianza}) y precio de la IA/historial ($${r.body.precios?.justo})`);

grupo('Búsqueda en pausa, fallas y respaldo');
cola = [respAgente(informe(), { stop: 'pause_turn', sinTexto: true }), respAgente()]; vistas.length = 0;
r = await investigar();
ok(r.code === 200 && vistas.length === 2 && vistas[1].messages.length === 2 && vistas[1].messages[1].role === 'assistant', `si la búsqueda se pausa, continúa donde iba (${vistas.length} llamadas)`);
cola = [err(529, 'Overloaded', 'overloaded_error'), err(529, 'Overloaded', 'overloaded_error')]; vistas.length = 0;
r = await investigar();
ok(r.code === 200 && /haiku/.test(r.body.modeloIA), `modelo grande saturado 2 veces → lo investiga el rápido (${r.body.modeloIA})`);
cola = [err(400, 'web_search tool is not enabled for this organization', 'invalid_request_error')]; vistas.length = 0;
r = await investigar();
ok(r.code === 200 && r.body.sinBusqueda && !vistas[1].tools, 'si la cuenta no permite buscar en internet, investiga sin búsqueda y lo dice');
cola = [err(404, 'model not found', 'not_found_error')]; vistas.length = 0;
r = await investigar();
ok(r.code === 200 && /haiku/.test(vistas[1].model), 'modelo mal escrito: pasa directo al rápido');
cola = ['red']; r = await investigar();
ok(r.code === 200, 'se cae la red: reintenta');
cola = [err(401, 'invalid x-api-key', 'authentication_error')]; vistas.length = 0;
r = await investigar();
ok(r.code === 503 && vistas.length === 1 && /no es válida/.test(r.body.error), 'clave mala: avisa y no reintenta');
cola = [err(400, 'Your credit balance is too low', 'invalid_request_error')];
r = await investigar();
ok(r.code === 402 && /saldo/.test(r.body.error), 'sin saldo: avisa');
cola = Array(8).fill({ st: 200, j: { content: [{ type: 'text', text: 'no pude' }], usage: {}, stop_reason: 'end_turn' } });
r = await investigar();
ok(r.code === 503 && r.body.reintentable && !/json|unexpected/i.test(r.body.error), `nunca devuelve el informe: error en español y reintentable (${r.body.error})`);
cola = [];
const fotosM = ['https://res.cloudinary.com/demo/image/upload/v1/bazar/memo.jpg'];
await investigar({ imagenes: fotosM }); vistas.length = 0;
r = await investigar({ imagenes: fotosM });
ok(r.body.desdeMemoria && vistas.length === 0, 'la misma prenda otra vez: de memoria, gratis');
r = await investigar({ imagenes: fotosM, forzar: true });
ok(!r.body.desdeMemoria && vistas.length === 1, '"Volver a investigar" sí pregunta de nuevo');
r = await pedir('ia-agente', { imagenes: ['https://evil.example/x.jpg'] });
ok(r.code === 400, 'solo fotos de tu Cloudinary');

grupo('Análisis rápido: rareza y catálogo nuevo');
cola = [respRapida()];
r = await pedir('ia-prenda', { imagenes: ['https://res.cloudinary.com/demo/image/upload/v1/bazar/j1.jpg'], categorias: CATS, tallas: TALLAS, estados: ESTADOS, marcas: ['Nike', 'Nirvana'], bazarId: 1 });
ok(r.code === 200 && r.body.rareza === 3 && r.body.senalesRareza.length === 2, `marca la rareza (${r.body.rareza}: ${r.body.senalesRareza})`);
ok(r.body.marcaNueva === true && r.body.marca === 'Reebok', `"Reebok" no existe → marca nueva (${r.body.marca})`);
ok((await import('./.tmp/api/_lib/ia.js')).elegirCategoria('Jersey', 'Playera Stüssy', CATS) === '', 'la IA dice "Jersey" y no tienes esa categoría: no la adivina por el nombre ("Playera…"), propone la nueva');
ok(r.body.categoria === '' && r.body.categoriaNueva === 'Jerseys', `ninguna categoría encaja → propone "Jerseys" (${r.body.categoriaNueva})`);
ok(/cn:/.test(vistas.at(-1).system[0].text) && /rz \(rareza/.test(vistas.at(-1).system[0].text), 'el análisis rápido pide rareza y categoría nueva');
cola = [respRapida({ c: 'Ropa', cn: 'Otros' })];
r = await pedir('ia-prenda', { imagenes: ['https://res.cloudinary.com/demo/image/upload/v1/bazar/j2.jpg'], categorias: CATS, tallas: TALLAS, estados: ESTADOS, marcas: ['Nike'], bazarId: 1, forzar: true });
ok(r.body.categoriaNueva === '', 'no propone categorías genéricas ("Otros", "Ropa")');

grupo('Crear marcas y categorías');
r = await pedir('ia-catalogo', { tipo: 'marca', nombre: 'Stüssy' });
ok(r.code === 200 && r.body.creada && r.body.id === 5 && fake.marcas.some(m => m.nombre === 'Stüssy' && m.bazarId === null), `crea la marca "Stüssy" (id ${r.body.id})`);
r = await pedir('ia-catalogo', { tipo: 'marca', nombre: 'stussy' });
ok(r.code === 200 && !r.body.creada && r.body.nombre === 'Stüssy', 'otra vez "stussy" (sin diéresis ni mayúscula): usa la que ya existe');
r = await pedir('ia-catalogo', { tipo: 'categoria', nombre: 'jerseys' });
ok(r.body.creada && r.body.nombre === 'Jerseys', `categoría con mayúscula inicial (${r.body.nombre})`);
const antes = fake.marcas.length;
const rs = await Promise.all(Array.from({ length: 6 }, () => pedir('ia-catalogo', { tipo: 'marca', nombre: 'Carhartt WIP' })));
ok(fake.marcas.length === antes + 1 && rs.every(x => x.code === 200) && new Set(rs.map(x => x.body.id)).size === 1, `6 prendas a la vez con la misma marca nueva: se crea una sola (${fake.marcas.length - antes})`);
for (const [nombre, por] of [['Ropa', 'genérica'], ['<>', 'vacía'], ['1', 'sin letras']]) {
  r = await pedir('ia-catalogo', { tipo: 'categoria', nombre });
  ok(r.code === 400, `no crea una categoría ${por} ("${nombre}")`);
}
r = await pedir('ia-catalogo', { tipo: 'marca', nombre: '<img src=x onerror=alert(1)>Supreme' });
ok(r.code === 200 && !/[<>]/.test(r.body.nombre), `quita etiquetas del nombre (${r.body.nombre})`);
r = await pedir('ia-catalogo', { tipo: 'usuarios', nombre: 'x' });
ok(r.code === 400, 'solo marcas o categorías (no otras colecciones)');
r = await pedir('ia-catalogo', { tipo: 'marca', nombre: 'Palace' }, 'TV');
ok(r.code === 403, 'un vendedor sin permiso de catálogo no puede crear');
r = await pedir('ia-catalogo', { tipo: 'marca', nombre: 'Palace' }, 'nadie');
ok(r.code === 401, 'sin sesión, nada');

console.log(`\nRESULTADO ${process.exitCode ? 'con fallas' : 'todo bien'}`);
