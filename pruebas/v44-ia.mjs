// Pruebas v44: registro de prendas con IA a prueba de fallas.
// La IA (Anthropic) es falsa y se programa respuesta por respuesta para simular
// lo que pasa en la vida real: saturada (529), errores 500, internet que se cae,
// respuestas que tardan, JSON cortado o con texto, fotos que no puede bajar,
// datos raros, sin saldo, clave mala, modelo que no existe.
process.env.SESSION_SECRET = 'secreto-de-prueba-v44';
process.env.ANTHROPIC_API_KEY = 'sk-ant-prueba';
process.env.CLOUDINARY_CLOUD_NAME = 'demo'; process.env.CLOUDINARY_API_KEY = 'ck'; process.env.CLOUDINARY_API_SECRET = 'cs';
// Tiempos cortos para que las pruebas no tarden (en Vercel se usan los de verdad)
process.env.IA_TIEMPO_MS = '400'; process.env.IA_ESPERA_MS = '5'; process.env.IA_PRESUPUESTO_MS = '4000';
for (const k of ['MULTI_BAZAR', 'BAZAR_PRINCIPAL', 'IA_MODELO', 'IA_MODELO_RAPIDO']) delete process.env[k];

const { fake } = await import('./.tmp/api/_lib/db.js');
const acciones = (await import('./.tmp/api/acciones.js')).default;
const upload = (await import('./.tmp/api/upload.js')).default;
const { hashPassword } = await import('./.tmp/api/_lib/password.js');
const ia = await import('./.tmp/api/_lib/ia.js');

// ── IA falsa ──
let cola = [];             // respuestas programadas, en orden; vacía = respuesta buena
const vistas = [];         // lo que el servidor le mandó a la IA
const bien = (extra = {}) => ({ ok: true, n: 'Sudadera Nike Vintage 90s', m: 'Nike', c: 'Sudadera', t: 'M', e: '9/10', d: 'Sudadera gruesa, colores vivos.', x: [], md: '', h: '#nike #vintage #90s', p: 520, r: [450, 600], why: 'Nike vintage se vende bien', f: 0, conf: { m: 0.95, t: 0.9, p: 0.8 }, ...extra });
const resp = (texto, extra = {}) => ({ st: 200, j: { content: [{ type: 'text', text: texto }], usage: { input_tokens: 900, output_tokens: 180 }, stop_reason: 'end_turn', ...extra } });
const err = (st, mensaje, tipo = 'api_error', h = {}) => ({ st, j: { type: 'error', error: { type: tipo, message: mensaje } }, h });
const J = (j, st = 200, h = {}) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j), headers: { get: k => h[String(k).toLowerCase()] ?? null } });
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  if (url.includes('api.anthropic.com')) {
    const cuerpo = JSON.parse(o.body); vistas.push(cuerpo);
    const r = cola.length ? cola.shift() : resp(JSON.stringify(bien()));
    if (r === 'red') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    if (r === 'cuelga') return new Promise((_, mal) => o.signal?.addEventListener('abort', () => mal(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))));
    if (r === 'html') return { ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); }, text: async () => '<html>Bad gateway</html>', headers: { get: () => null } };
    return J(r.j, r.st, r.h);
  }
  // Fotos de Cloudinary (por si el servidor tiene que bajarlas él mismo)
  if (url.startsWith('https://res.cloudinary.com/')) return { ok: !url.includes('rota'), status: url.includes('rota') ? 404 : 200, headers: { get: k => /type/i.test(k) ? 'image/jpeg' : null }, arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).buffer };
  if (url.includes('api.cloudinary.com')) return J({ secure_url: 'https://res.cloudinary.com/demo/image/upload/v1/bazar/x.jpg', public_id: 'bazar/x' });
  return J({}, 404);
};

const mk = () => ({ statusCode: 200, body: undefined, h: {}, headersSent: false, writableEnded: false,
  status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; this.headersSent = this.writableEnded = true; return this; },
  send(x) { this.body = x; this.headersSent = this.writableEnded = true; return this; }, end(x) { if (x !== undefined) this.body = x; this.headersSent = this.writableEnded = true; return this; },
  setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; } });
let ipN = 0;
const pedir = async (fn, { method = 'POST', query = {}, body, token = 'TA', ip } = {}) => {
  const res = mk();
  await fn({ method, query, body, url: '/api/x', headers: { 'x-real-ip': ip || '10.44.' + (ipN++ % 250) + '.1', host: 'stiimpys.store', authorization: 'Bearer ' + token } }, res);
  return { code: res.statusCode, body: res.body, h: res.h };
};
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);

fake.bazares = [{ id: 1, nombre: 'Stiimpys', whatsapp: '8990000000', slug: 'stiimpys' }];
fake.usuarios = [
  { id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA', password: await hashPassword('x') },
  { id: 2, username: 'vende', role: 'vendedor', bazarId: 1, sessionToken: 'TV', password: await hashPassword('y') },
];
fake.inventario = [
  ['Sudadera Champion', 'Champion', 'Sudaderas', 380], ['Sudadera Nike', 'Nike', 'Sudaderas', 450], ['Playera Nike', 'Nike', 'Playeras', 250],
  ['Playera Harley', 'Harley Davidson', 'Playeras', 600], ['Jeans Levi\'s 501', 'Levi\'s', 'Pantalones', 420], ['Tenis Jordan 1', 'Jordan', 'Tenis', 1500],
].map(([nombre, marca, cat, precio], i) => ({ id: i + 1, bazarId: 1, nombre, marca, categorias: [cat], precio_venta: precio, imagenes: [], creadoEn: new Date().toISOString() }));
for (const k of ['iaCache', 'iaUso', 'iaAprendizaje', 'actividad', 'rate_limits']) fake[k] = [];

const CATS = ['Sudaderas', 'Playeras', 'Pantalones', 'Tenis', 'Gorras', 'Chamarras', 'Shorts', 'Accesorios'];
const ESTADOS = ['Nueva', 'Nueva con etiqueta', '10/10', '9/10', '8/10', '7/10', '6/10', '5/10', 'Con mucho desgaste'];
const TALLAS = ['XS Hombre', 'S Hombre', 'M Hombre', 'L Hombre', 'XL Hombre', 'XXL Hombre', 'XXXL Hombre', 'XS Mujer', 'S Mujer', 'M Mujer', 'L Mujer', 'XL Mujer', 'XXL Mujer',
  '1', '3', '5', '7', '9', '11', '13', '15', '26', '28', '29', '30', '31', '32', '33', '34', '36', '38', '40', '42', '22', '23', '24', '25', '25.5', '26', '26.5', '27', '27.5', '28', '29', '30', 'Unitalla', 'Talla única', 'Ajustable'];
let nFoto = 0;
const analizar = (extra = {}, args = {}) => {
  const fotos = extra.imagenes || [`https://res.cloudinary.com/demo/image/upload/v1/bazar/f${++nFoto}.jpg`, `https://res.cloudinary.com/demo/image/upload/v1/bazar/f${++nFoto}.jpg`];
  return pedir(acciones, { query: { op: 'ia-prenda' }, body: { imagenes: fotos, categorias: CATS, tallas: TALLAS, estados: ESTADOS, marcas: ['Nike', 'Champion', 'Levi\'s'], calidad: 'auto', bazarId: 1, ...extra }, ...args });
};
const sinIngles = m => !/unexpected|aborted|fetch failed|json|token|undefined|null|econn|syntax/i.test(String(m || ''));

// ═════════════════════════════════════════════════════════════
grupo('Respuesta normal');
cola = []; vistas.length = 0;
let r = await analizar();
ok(r.code === 200 && r.body.nombre === 'Sudadera Nike Vintage 90s', `200 con nombre (${r.code} ${r.body?.nombre || r.body?.error})`);
ok(r.body.categoria === 'Sudaderas' && r.body.talla === 'M Hombre' && r.body.estado === '9/10', `categoría, talla y estado acomodados a tus listas (${r.body.categoria} · ${r.body.talla} · ${r.body.estado})`);
ok(r.body.precioSugerido > 0 && vistas.length === 1, `precio sugerido y una sola llamada (${r.body.precioSugerido}, ${vistas.length})`);

grupo('La IA falla un rato y luego contesta');
for (const [nombre, falla] of [
  ['saturada (529)', [err(529, 'Overloaded', 'overloaded_error')]],
  ['error 500 y luego 503', [err(500, 'Internal server error'), err(503, 'Service unavailable')]],
  ['se cae el internet', ['red']],
  ['tarda demasiado', ['cuelga']],
  ['límite por minuto (429)', [err(429, 'Number of request tokens has exceeded your per-minute rate limit', 'rate_limit_error', { 'retry-after': '0' })]],
  ['contesta una página de error en vez de JSON', ['html']],
]) {
  cola = [...falla]; vistas.length = 0;
  r = await analizar();
  ok(r.code === 200 && r.body.nombre, `${nombre}: reintenta solo y sale bien (${r.code} ${r.body?.error || ''} · ${vistas.length} llamadas)`);
}

grupo('Respuestas con formato raro');
for (const [nombre, texto, extra] of [
  ['JSON dentro de ```json', '```json\n' + JSON.stringify(bien()) + '\n```'],
  ['texto con llaves antes del JSON', 'Veo una prenda {sudadera} de buena calidad. Aquí está: ' + JSON.stringify(bien()) + ' Espero que te sirva {:'],
  ['JSON cortado a la mitad', JSON.stringify(bien()).slice(0, 120), { stop_reason: 'max_tokens' }],
  ['comillas raras y coma de más', JSON.stringify(bien()).replace(/}$/, ',}').replace('"ok":true', '"ok":true,')],
]) {
  cola = [resp(texto, extra || {}), resp(texto, extra || {}), resp(texto, extra || {})]; vistas.length = 0;
  r = await analizar();
  ok(r.code === 200 && /Sudadera/.test(r.body.nombre || ''), `${nombre} → se entiende (${r.code} ${r.body?.nombre || r.body?.error})`);
}
// Texto partido en varios bloques (pasa con la búsqueda en internet y sus citas)
const t = JSON.stringify(bien());
cola = [{ st: 200, j: { content: [{ type: 'server_tool_use', name: 'web_search' }, { type: 'text', text: t.slice(0, 40) }, { type: 'text', text: t.slice(40, 90), citations: [{}] }, { type: 'text', text: t.slice(90) }], usage: {}, stop_reason: 'end_turn' } }];
r = await analizar();
ok(r.code === 200 && r.body.nombre === 'Sudadera Nike Vintage 90s', `texto partido en bloques (con citas) se une bien (${r.body?.nombre || r.body?.error})`);

grupo('Datos raros dentro del JSON');
cola = [resp(JSON.stringify(bien({ n: 12345, p: '$450 MXN', h: ['#nike', 'vintage', '#90s'], x: 'mancha en la manga', r: '400-500', conf: { m: '0.9', t: '0.8', p: '0.7' }, f: '7', e: 'Excelente', t: 'Large' })))];
r = await analizar();
ok(r.code === 200 && r.body.precioSugerido >= 400 && r.body.precioSugerido <= 520, `precio "$450 MXN" se lee como número (${r.body.precioSugerido})`);
ok(r.body.hashtags === '#nike #vintage #90s', `hashtags en lista y sin # se arreglan (${r.body.hashtags})`);
ok(JSON.stringify(r.body.fallas) === '["Mancha en la manga"]', `fallas como texto suelto → lista (desde la v49 con mayúscula inicial) (${JSON.stringify(r.body.fallas)})`);
ok(r.body.portada === 1 && r.body.confianza.marca === 0.9, `portada fuera de rango se acota y confianza en texto se convierte (${r.body.portada}, ${r.body.confianza.marca})`);
ok(r.body.estado === '9/10' && r.body.talla === 'L Hombre', `"Excelente" → 9/10 y "Large" → L Hombre (${r.body.estado} · ${r.body.talla})`);
ok(r.body.nombre && typeof r.body.nombre === 'string', `nombre numérico no truena (${r.body.nombre})`);
cola = [resp(JSON.stringify(bien({ p: 9999999 })))];
r = await analizar();
ok(r.body.precioSugerido <= 30000, `precio absurdo se acota (${r.body.precioSugerido})`);

grupo('Nunca sin nombre ni precio');
cola = [resp(JSON.stringify({ ok: true, m: 'Champion', c: 'Hoodie', conf: { m: 0.9, t: 0.2, p: 0.2 } })), resp(JSON.stringify({ ok: true, m: 'Champion', c: 'Hoodie', conf: { m: 0.9, t: 0.2, p: 0.2 } }))];
r = await analizar();
ok(r.code === 200 && r.body.categoria === 'Sudaderas', `"Hoodie" se acomoda en Sudaderas (${r.body.categoria})`);
ok(/Champion/.test(r.body.nombre || '') && r.body.precioSugerido > 0, `sin nombre ni precio de la IA: arma "${r.body.nombre}" y sugiere $${r.body.precioSugerido} con tu historial`);
cola = [resp(JSON.stringify({ ok: true })), resp(JSON.stringify({ ok: true }))];
r = await analizar();
ok(r.code === 200 && r.body.nombre && r.body.precioSugerido > 0, `ni categoría: aun así nombre y precio (${r.body.nombre} · $${r.body.precioSugerido})`);

grupo('Tallas y estados como los escribe la IA');
const tl = (v, c = '') => ia.elegirTalla(v, TALLAS, c);
for (const [v, c, esperado] of [['M', '', 'M Hombre'], ['XXL', '', 'XXL Hombre'], ['2XL', '', 'XXL Hombre'], ['Small', '', 'S Hombre'], ['Mediana', '', 'M Hombre'],
  ['M (dama)', '', 'M Mujer'], ['W32 L30', 'Pantalones', '32'], ['32x30', 'Pantalones', '32'], ['35', 'Pantalones', '34'], ['US 9.5', 'Tenis', '27.5'], ['27 MX', 'Tenis', '27'],
  ['9 US', 'Tenis', '27'], ['One size', '', 'Unitalla'], ['OS', 'Gorras', 'Unitalla'], ['Talla L', '', 'L Hombre'], ['M Mujer', '', 'M Mujer'], ['26.5', 'Tenis', '26.5']]) {
  ok(tl(v, c) === esperado, `talla "${v}"${c ? ` (${c})` : ''} → ${esperado} (${tl(v, c)})`);
}
const es = v => ia.elegirEstado(v, ESTADOS);
for (const [v, esperado] of [['9/10', '9/10'], ['9.5/10', '9/10'], ['Excelente', '9/10'], ['Muy buen estado', '8/10'], ['Nuevo con etiquetas', 'Nueva con etiqueta'], ['NWT', 'Nueva con etiqueta'], ['Nueva', 'Nueva'], ['desgastada', 'Con mucho desgaste'], ['raro', '']]) {
  ok(es(v) === esperado, `estado "${v}" → "${esperado}" (${es(v)})`);
}
const ct = (v, n = '') => ia.elegirCategoria(v, n, CATS);
for (const [v, n, esperado] of [['Hoodie', '', 'Sudaderas'], ['Crewneck', '', 'Sudaderas'], ['T-shirt', '', 'Playeras'], ['Jeans', '', 'Pantalones'], ['Sneakers', '', 'Tenis'], ['Cap', '', 'Gorras'], ['Jacket', '', 'Chamarras'], ['Bermuda', '', 'Shorts'], ['', 'Gorra New Era', 'Gorras'], ['Ropa', 'Playera Metallica', 'Playeras'], ['Cinturón', '', 'Accesorios']]) {
  ok(ct(v, n) === esperado, `categoría "${v || n}" → ${esperado} (${ct(v, n)})`);
}

grupo('Respaldo entre modelos');
cola = [err(529, 'Overloaded', 'overloaded_error'), err(529, 'Overloaded', 'overloaded_error'), err(529, 'Overloaded', 'overloaded_error')]; vistas.length = 0;
r = await analizar({ calidad: 'maxima' });
ok(r.code === 200 && /haiku/.test(r.body.modelo), `"Máxima precisión" con el modelo grande saturado: usa el rápido (${r.code} ${r.body?.modelo || r.body?.error})`);
cola = [err(404, 'model: claude-sonnet-9', 'not_found_error')]; vistas.length = 0;
r = await analizar({ calidad: 'maxima' });
ok(r.code === 200 && vistas.length === 2, `modelo mal escrito en Vercel: no reintenta el mismo, pasa al otro (${r.code} · ${vistas.length} llamadas)`);
cola = [resp(JSON.stringify(bien({ conf: { m: 0.3, t: 0.3, p: 0.3 } }))), err(529, 'Overloaded', 'overloaded_error'), err(529, 'Overloaded', 'overloaded_error'), err(529, 'Overloaded', 'overloaded_error')];
r = await analizar();
ok(r.code === 200 && /haiku/.test(r.body.modelo), `"Automático": si el grande no contesta, se queda con lo del rápido (${r.code} ${r.body?.modelo})`);
cola = [resp('no sé qué es esto'), resp('nada'), resp('tampoco'), resp(JSON.stringify(bien()))]; vistas.length = 0;
r = await analizar();
ok(r.code === 200 && r.body.nombre, `el rápido no devuelve datos 2 veces: lo intenta el grande (${r.code} · ${vistas.length} llamadas)`);

grupo('Fotos que la IA no puede bajar');
cola = [err(400, 'Unable to download the file. Please verify the URL and try again.', 'invalid_request_error')]; vistas.length = 0;
r = await analizar();
const fuentes = vistas.at(-1)?.messages?.[0]?.content?.filter(c => c.type === 'image').map(c => c.source.type);
ok(r.code === 200 && fuentes?.every(x => x === 'base64'), `el servidor baja las fotos y se las manda directo (${r.code} · ${fuentes})`);
cola = [err(400, 'Could not process image', 'invalid_request_error'), err(400, 'Could not process image', 'invalid_request_error')]; vistas.length = 0;
r = await analizar({ imagenes: ['https://res.cloudinary.com/demo/image/upload/v1/bazar/rota1.jpg', 'https://res.cloudinary.com/demo/image/upload/v1/bazar/buena.jpg'] });
const ultima = vistas.at(-1)?.messages?.[0]?.content?.filter(c => c.type === 'image') || [];
ok(r.code === 200 && ultima.length === 1, `una foto rota se salta y se analiza con las demás (${r.code} · ${ultima.length} foto)`);

grupo('Errores que no se arreglan reintentando');
cola = [err(400, 'Your credit balance is too low to access the Anthropic API.', 'invalid_request_error')]; vistas.length = 0;
r = await analizar();
ok(r.code >= 400 && /saldo/.test(r.body.error) && vistas.length === 1, `sin saldo: avisa en español y no gasta más intentos (${r.code} · ${vistas.length} · ${r.body.error})`);
cola = [err(401, 'invalid x-api-key', 'authentication_error')]; vistas.length = 0;
r = await analizar();
ok(r.code === 503 && /no es válida/.test(r.body.error) && vistas.length === 1, `clave mala: avisa y no reintenta (${r.code} · ${vistas.length})`);
cola = Array(40).fill(err(529, 'Overloaded', 'overloaded_error')); vistas.length = 0;
const t0 = Date.now();
r = await analizar();
ok(r.code === 503 && sinIngles(r.body.error) && /intenta|ocupada|saturada/i.test(r.body.error), `IA caída todo el rato: mensaje claro en español (${r.code} · ${r.body.error})`);
ok(r.body.reintentable === true, 'y le dice al panel que puede reintentar solo');
ok(vistas.length <= 8 && Date.now() - t0 < 6000, `sin pasarse del tiempo de Vercel (${vistas.length} llamadas, ${Date.now() - t0} ms)`);
cola = Array(10).fill(resp('lo siento, no puedo')); vistas.length = 0;
r = await analizar();
ok(r.code >= 500 && sinIngles(r.body.error) && r.body.reintentable, `si nunca devuelve datos: error en español y reintentable (${r.code} · ${r.body.error})`);
cola = [];

grupo('Memoria (caché)');
const fotosC = ['https://res.cloudinary.com/demo/image/upload/v1/bazar/cache1.jpg'];
cola = [resp(JSON.stringify({ ok: true, m: 'Nike' })), resp(JSON.stringify({ ok: true, m: 'Nike' }))];
await analizar({ imagenes: fotosC });
vistas.length = 0;
r = await analizar({ imagenes: fotosC });
ok(!r.body.desdeMemoria && vistas.length >= 1, 'un resultado incompleto NO se guarda en memoria (la siguiente vez se vuelve a preguntar)');
r = await analizar({ imagenes: fotosC }); vistas.length = 0;
r = await analizar({ imagenes: fotosC });
ok(r.body.desdeMemoria && vistas.length === 0, 'un resultado completo sí se recuerda (gratis)');

grupo('Aprender de correcciones');
fake.iaAprendizaje = [];
r = await pedir(acciones, { query: { op: 'ia-aprender' }, body: { bazarId: 1, casos: [{ ia: { precio: 'abc', nombre: { a: 1 } }, final: { precio: -50, nombre: 'Sudadera' } }, ...Array(150).fill({ ia: { precio: 100 }, final: { precio: 120 } })] } });
ok(r.code === 200 && fake.iaAprendizaje.length === 100, `máx. 100 por envío (${fake.iaAprendizaje.length})`);
ok(fake.iaAprendizaje[0].ia.precio === 0 && fake.iaAprendizaje[0].final.precio === 0 && fake.iaAprendizaje[0].ia.nombre === '', 'precios y nombres basura se limpian');

grupo('Textos para Instagram');
cola = [err(529, 'Overloaded', 'overloaded_error'), resp('Sudadera Nike vintage 🔥 talla M')];
r = await pedir(acciones, { query: { op: 'ia-texto' }, body: { tipo: 'caption', prenda: { nombre: 'Sudadera Nike' } } });
ok(r.code === 200 && /Sudadera/.test(r.body.texto), `caption: si la IA está saturada reintenta una vez (${r.code} ${r.body?.texto || r.body?.error})`);
cola = [err(400, 'Your credit balance is too low', 'invalid_request_error')];
r = await pedir(acciones, { query: { op: 'ia-texto' }, body: { tipo: 'caption', prenda: { nombre: 'Sudadera Nike' } } });
ok(r.code === 402 && /saldo/.test(r.body.error), `caption sin saldo: aviso claro (${r.code} ${r.body?.error})`);
cola = ['red', 'red'];
r = await pedir(acciones, { query: { op: 'ia-texto' }, body: { tipo: 'dm', mensajes: [{ texto: 'hola' }], usuario: 'x' } });
ok(r.code === 502 && sinIngles(r.body.error), `caption sin internet: mensaje en español (${r.body?.error})`);
cola = [];

grupo('Subir fotos');
const foto = tipo => `data:image/${tipo};base64,` + Buffer.alloc(2000, 7).toString('base64');
r = await pedir(upload, { body: { file: foto('heif') } });
ok(r.code === 200, `fotos .heif (iPhone) se aceptan (${r.code} ${r.body?.error || ''})`);
fake.rate_limits = [];
let tope = 0;
for (let i = 0; i < 400; i++) { const x = await pedir(upload, { body: { file: foto('jpeg') }, ip: '10.99.0.1' }); if (x.code === 429) { tope = i; break; } }
ok(tope === 0 || tope >= 300, `un ZIP grande (300+ fotos en una hora) no topa con el límite de subidas (${tope || 'sin tope'})`);
fake.rate_limits = [];
r = await pedir(upload, { body: { file: 'data:application/octet-stream;base64,' + Buffer.alloc(100).toString('base64') } });
ok(r.code === 400, 'algo que no es imagen se sigue rechazando');

const crypto = await import('node:crypto');
r = await pedir(upload, { method: 'GET', query: { op: 'firma' } });
const esperada = crypto.createHash('sha1').update(`allowed_formats=${r.body?.allowed_formats}&folder=bazar&timestamp=${r.body?.timestamp}cs`).digest('hex');
ok(r.code === 200 && r.body.signature === esperada && r.body.folder === 'bazar' && !JSON.stringify(r.body).includes('"cs"'), 'firma para subir directo (fotos muy pesadas): solo carpeta bazar y sin revelar el secreto');
ok(/heic/.test(r.body.allowed_formats) && !/pdf|svg|html/.test(r.body.allowed_formats), 'la firma solo permite formatos de imagen (nada de PDF/SVG)');
r = await pedir(upload, { method: 'GET', query: { op: 'firma' }, token: 'nadie' });
ok(r.code === 401, 'sin sesión del panel no hay firma');

console.log(`\nRESULTADO ${process.exitCode ? 'con fallas' : 'todo bien'}`);
