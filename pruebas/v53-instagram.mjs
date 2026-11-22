// Pruebas v53: el texto de Instagram lleva solo lo importante, nunca el WhatsApp de la
// tienda (ni teléfonos de la descripción) y máximo 5 hashtags (límite de Instagram desde dic 2025).
// - El panel arma el mismo texto que el servidor (vista previa = lo que se publica).
// - Link corto stiimpys.store/p/<id> → la ficha de la prenda.
process.env.SESSION_SECRET = 'secreto-de-prueba-v53';
process.env.ANTHROPIC_API_KEY = 'sk-ant-prueba';
process.env.IA_TIEMPO_MS = '2000'; process.env.IA_ESPERA_MS = '5'; process.env.IA_PRESUPUESTO_MS = '20000';
process.env.IG_STIIMPYS_USER_ID = '1784'; process.env.IG_STIIMPYS_TOKEN = 'tok-prueba';
for (const k of ['MULTI_BAZAR', 'BAZAR_PRINCIPAL', 'IA_MODELO', 'IA_MODELO_RAPIDO', 'ANTHROPIC_ADMIN_KEY', 'TELEGRAM_BOT_TOKEN', 'IG_STIIMPYS_MODO']) delete process.env[k];

const { fake } = await import('./.tmp/api/_lib/db.js');
const acciones = (await import('./.tmp/api/acciones.js')).default;
const { hashPassword } = await import('./.tmp/api/_lib/password.js');
const ia = await import('./.tmp/api/_lib/ia.js');
const ig = await import('./.tmp/api/_lib/instagram.js');

let cola = [];
const vistas = [], igMedia = [], igCaps = [];
const J = (j, st = 200) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j), headers: { get: () => null } });
const prenda = (extra = {}) => ({ ok: true, n: 'Sudadera Nike Vintage', m: 'Nike', c: 'Sudaderas', t: 'M', e: '9/10', d: 'Sudadera gruesa y cómoda.', h: '#nike', p: 450, r: [400, 500], f: 0, conf: { m: 0.9, t: 0.9, p: 0.9 }, rz: 1, rs: [], ...extra });
const resp = d => ({ j: { content: [{ type: 'text', text: JSON.stringify(d) }], usage: { input_tokens: 2000, output_tokens: 400 } } });
let nMedia = 0;
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  if (url.includes('api.anthropic.com')) {
    vistas.push(JSON.parse(o.body));
    const r = cola.length ? cola.shift() : null;
    if (r) return J(r.j || r, r.st || 200);
    return J({ content: [{ type: 'text', text: JSON.stringify(prenda()) }], usage: { input_tokens: 2000, output_tokens: 300 } });
  }
  if (url.includes('graph.instagram.com')) {
    const u = new URL(url);
    if ((o.method || 'GET') === 'POST') {
      const p = new URLSearchParams(String(o.body));
      if (u.pathname.endsWith('/media') && p.get('image_url')) igMedia.push(p.get('image_url'));
      if (p.get('caption')) igCaps.push(p.get('caption'));
      return J({ id: 'm' + (++nMedia) });
    }
    if (u.searchParams.get('fields') === 'status_code') return J({ status_code: 'FINISHED' });
    if (u.searchParams.get('fields') === 'permalink') return J({ permalink: 'https://instagram.com/p/x' });
    return J({});
  }
  if (url.includes('frankfurter')) return J({ rates: { MXN: 20 } });
  return J({}, 404);
};
const mk = () => ({ statusCode: 200, body: undefined, h: {}, headersSent: false, writableEnded: false,
  status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; this.headersSent = this.writableEnded = true; return this; },
  send(x) { this.body = x; return this; }, end(x) { if (x !== undefined) this.body = x; return this; },
  setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; } });
let ipN = 0;
const pedir = async (op, body, token = 'TA') => {
  const res = mk();
  await acciones({ method: 'POST', query: { op }, body, url: '/api/x', headers: { 'x-real-ip': '10.53.' + (ipN++ % 250) + '.1', host: 'stiimpys.store', authorization: 'Bearer ' + token } }, res);
  return { code: res.statusCode, body: res.body };
};
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);


fake.bazares = [{ id: 1, nombre: 'Stiimpys', slug: 'stiimpys', permisos: {}, whatsapp: '528995284602', ubicacion: 'Reynosa',
  instagramConfig: { estiloTexto: 'emojis', hashtags: '#bazar #reynosa #bazarreynosa #ropavintage #streetwear #segundamano #thrift #vintage' } }];
fake.usuarios = [{ id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA', password: await hashPassword('x') }];
fake.inventario = [];
for (const k of ['iaCache', 'iaUso', 'iaAprendizaje', 'actividad', 'rate_limits', 'tipoCambio', 'bloqueos', 'iaSaldo', 'sistema', 'igProgramados']) fake[k] = [];
let nF = 0;
const fotos = n => Array.from({ length: n }, () => `https://res.cloudinary.com/demo/image/upload/v1/bazar/d${++nF}.jpg`);
const nHash = t => (String(t).match(/#[^\s#]+/g) || []).length;
const DESC = `Sudadera azul grisáceo de cuello redondo con el estampado de Lionel Richie y estrellitas en el frente. Por atrás trae una luna amarilla con la lista de ciudades de la gira. Pieza de merch musical muy coleccionable.

• Estampado Lionel Richie en el pecho
• Estampado "All Night Long" en la manga
• Luna y título estampados en la espalda
• Lista de ciudades de la gira en la espalda

A considerar: mancha pequeña en el puño izquierdo.

📐 Largo 70 cm · Ancho 58 cm`;
const LIONEL = { id: 160, bazarId: 1, nombre: 'Sudadera Lionel Richie All Night Long con fechas de gira', talla: 'L Hombre', estado: '9/10', precio_venta: 150,
  descripcion: DESC, hashtags: '#lionelrichie #allnightlong #tourmerch #bandmerch #sudadera #crewneck #80smusic #vintagestyle #merchdegira', categorias: ['Sudaderas'] };

grupo('Texto corto: solo lo importante');
let t = ig.textoPublicacion(LIONEL, fake.bazares[0]);
console.log(t.split('\n').map(l => '      │ ' + l).join('\n'));
ok(!/wa\.me|whatsapp|8995284602/i.test(t), 'no lleva el WhatsApp de la tienda');
ok(nHash(t) === 5, `lleva 5 hashtags (${nHash(t)})`);
ok(/#lionelrichie #sudaderavintage #ropareynosa #allnightlong #vintagemexico$/.test(t), 'los hashtags más útiles: lo específico, el tipo de prenda, la ciudad y uno general');
ok(t.includes('💸 $150 MXN') && t.includes('📏 Talla L Hombre · ✨ 9/10'), 'precio, talla y estado arriba');
ok(t.includes('📐 Largo 70 cm · Ancho 58 cm'), 'las medidas (sirven para comprar)');
ok(t.includes('Sudadera azul grisáceo de cuello redondo con el estampado de Lionel Richie y estrellitas en el frente.') && !t.includes('Por atrás trae'), 'de la descripción solo la primera frase');
ok(!t.includes('•'), 'la lista de detalles se queda en la tienda');
ok(t.includes('⚠️ A considerar: mancha pequeña en el puño izquierdo'), 'las fallas sí van (evitan reclamos)');
ok(t.includes('stiimpys.store/p/160 (link en bio)') && !t.includes('prenda.html'), 'link corto a la prenda');
ok(t.length < 600, `mucho más corto (${t.length} letras; antes ~1,050)`);
ok(t.split('\n').length <= 14, `pocas líneas (${t.split('\n').length})`);
t = ig.textoPublicacion({ ...LIONEL, marca: 'Nike', precioAnterior: 200 }, fake.bazares[0]);
ok(t.includes('💸 $150 MXN (antes $200)') && t.includes('🏷️ Nike · 📏 Talla L Hombre'), 'rebaja y marca en la misma línea');

grupo('Nunca teléfonos ni WhatsApp en el post');
const conTel = { ...LIONEL, descripcion: 'Playera negra de algodón. Mándame WhatsApp al 899 528 4602 o wa.me/528995284602.\n\n• Logo bordado\n\nTel: +52 1 899 528 4602\nInfo por wsp' };
for (const corto of [true, false]) {
  t = ig.textoPublicacion(conTel, { ...fake.bazares[0], instagramConfig: { ...fake.bazares[0].instagramConfig, textoCorto: corto } });
  ok(!/899|528|wa\.me|whats|wsp|tel:/i.test(t) && t.includes('Playera negra de algodón.'), `${corto ? 'texto corto' : 'texto completo'}: se quitan las frases con teléfono o WhatsApp y queda lo demás`);
}
ok(ig.sinTelefonos('Gira 1985 - 1986 en Dallas. Largo 70 x 58 cm. $1,200.') === 'Gira 1985 - 1986 en Dallas. Largo 70 x 58 cm. $1,200.', 'años, medidas y precios no se confunden con teléfonos');
ok(ig.sinTelefonos('Pregunta por DM o WhatsApp! Envíos a todo México.') === 'Envíos a todo México.', 'frase que pide escribir por WhatsApp: fuera');

grupo('Texto completo (si se prefiere) y número de hashtags');
t = ig.textoPublicacion(LIONEL, { ...fake.bazares[0], instagramConfig: { ...fake.bazares[0].instagramConfig, textoCorto: false } });
ok(t.includes('• Estampado Lionel Richie en el pecho') && t.includes('Por atrás trae') && nHash(t) === 5 && !/wa\.me/.test(t), 'completo: toda la descripción, pero igual 5 hashtags y sin WhatsApp');
ok(nHash(ig.hashtagsPrenda(LIONEL, { maxHashtags: 3 }, fake.bazares[0])) === 3, 'se puede bajar a 3');
ok(ig.hashtagsPrenda(LIONEL, { maxHashtags: 0 }, fake.bazares[0]) === '', '0 = sin hashtags');
ok(nHash(ig.hashtagsPrenda(LIONEL, { maxHashtags: 30 }, fake.bazares[0])) === 5, 'aunque pidan 30, nunca más de 5');
ok(ig.hashtagsPrenda({ nombre: 'Playera', hashtags: '#uno #dos' }, { hashtagsInteligentes: false, hashtags: '#tres #cuatro #cinco #seis' }) === '#uno #dos #tres #cuatro #cinco', 'sin "hashtags por prenda": los de la prenda y luego los de la tienda');
ok(ig.configInstagram({ instagramConfig: { maxHashtags: 9 } }).maxHashtags === 5 && ig.configInstagram({ instagramConfig: { maxHashtags: -2 } }).maxHashtags === 0
  && ig.configInstagram({ instagramConfig: { maxHashtags: 'abc' } }).maxHashtags === 5 && ig.configInstagram({}).textoCorto === true, 'ajustes: corto por defecto y hashtags entre 0 y 5');

grupo('Guardar ajustes y publicar');
let rp = await pedir('ig-config', { textoCorto: false, maxHashtags: 3 });
ok(rp.code === 200 && rp.body.config?.textoCorto === false && rp.body.config?.maxHashtags === 3, 'se guardan "texto corto" y "hashtags por publicación"');
rp = await pedir('ig-config', { textoCorto: true, maxHashtags: 99 });
ok(rp.code === 200 && rp.body.config?.textoCorto === true && rp.body.config?.maxHashtags === 5, 'un número fuera de rango queda en 5');
fake.inventario = [{ ...LIONEL, imagenes: fotos(2) }];
igCaps.length = 0;
await ig.publicarPrendaEnInstagram(fake.inventario[0], fake.bazares[0]);
const cap = igCaps.at(-1) || '';
ok(cap && !/wa\.me|8995284602/.test(cap) && nHash(cap) === 5 && cap.includes('/p/160'), `al publicar una prenda, Instagram recibe el texto corto (${cap.length} letras)`);

grupo('El panel arma el mismo texto (vista previa = lo que se publica)');
const fs = await import('node:fs'); const vm = await import('node:vm');
const src = fs.readFileSync(new URL('../js/panel/instagram-panel.js', import.meta.url), 'utf8');
const trozo = src.slice(src.indexOf('function igHashLimpio('), src.indexOf('async function igLimpiarDescripciones('));
const ctx = { getDB: () => [], toast() {}, Avisos: {}, IG: {} }; vm.createContext(ctx);
vm.runInContext(trozo + '\nthis.T = igTextoPublicacion; this.H = igHashtagsPrenda;', ctx);
const casos = [LIONEL, conTel, { ...LIONEL, marca: "Levi's", nombre: 'Jeans Levi\'s 501', categorias: ['Pantalones'], hashtags: '', precioAnterior: 400 }, { id: 5, nombre: 'Gorra', precio_venta: 90 }];
const cfgs = [{ ...fake.bazares[0].instagramConfig, firma: '📦 Envíos a todo México' }, { textoCorto: false, maxHashtags: 2 }, { hashtagsInteligentes: false, hashtags: '#a1 #b2' }];
let iguales = 0, total = 0;
for (const p of casos) for (const c of cfgs) {
  total++;
  const s1 = ig.textoPublicacion(p, { ...fake.bazares[0], instagramConfig: c });
  const s2 = ctx.T(p, ig.configInstagram({ instagramConfig: c }), fake.bazares[0]);
  if (s1 === s2) iguales++; else console.log('      distinto:\n' + s1 + '\n----\n' + s2);
}
ok(iguales === total, `servidor y panel dan el mismo texto (${iguales} de ${total})`);

grupo('Link corto /p/<id>');
const mw = (await import('../middleware.js')).default;
let r = await mw(new Request('https://stiimpys.store/p/160'));
ok(r?.status === 302 && r.headers.get('location') === 'https://stiimpys.store/prenda.html?id=160', '/p/160 lleva a la ficha de la prenda 160');
r = await mw(new Request('https://stiimpys.store/p/160/'));
ok(r?.status === 302 && r.headers.get('location').endsWith('/prenda.html?id=160'), 'también con barra al final');
r = await mw(new Request('https://stiimpys.store/p/abc'));
ok(!r || r.status !== 302 || !String(r.headers.get('location')).includes('prenda.html'), '/p/abc no es un link de prenda');
r = await mw(new Request('https://stiimpys.store/p/1;alert(1)'));
ok(!r || !String(r.headers.get('location') || '').includes('alert'), 'nada raro pasa al link');
