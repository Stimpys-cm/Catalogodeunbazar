// Pruebas v54: texto de Instagram con aspecto profesional, sin emojis (estilo "limpio", de inicio):
// datos con etiqueta (Precio:, Marca:, Talla:, Estado:, Medidas:), sin emojis aunque la firma o la
// descripción los traigan. También el comentario de VENDIDA, el aviso de rebaja y el texto del drop.
// El estilo "Con emojis" sigue disponible en Ajustes.
process.env.SESSION_SECRET = 'secreto-de-prueba-v54';
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
  instagramConfig: { firma: '📦 Envíos a todo México · Entrega en persona en Reynosa', hashtags: '#bazar #reynosa #bazarreynosa #ropavintage #streetwear #segundamano #thrift #vintage' } }];
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


const EMOJI = /[\p{Extended_Pictographic}️]/u;
grupo('Estilo limpio (de inicio)');
ok(ig.configInstagram({}).estiloTexto === 'limpio' && !EMOJI.test(ig.CONFIG_DEFAULT.firma), 'de inicio: estilo limpio y firma sin emojis');
let t = ig.textoPublicacion({ ...LIONEL, marca: 'Lionel Richie Tour' }, fake.bazares[0]);
console.log(t.split('\n').map(l => '      │ ' + l).join('\n'));
ok(!EMOJI.test(t), 'sin ningún emoji (aunque la firma guardada traiga 📦)');
ok(t.startsWith('Sudadera Lionel Richie All Night Long con fechas de gira\n\nPrecio: $150 MXN\nMarca: Lionel Richie Tour\nTalla: L Hombre\nEstado: 9/10\nMedidas: Largo 70 cm · Ancho 58 cm\n\n'), 'datos con etiqueta, uno por línea');
ok(t.includes('\nA considerar: mancha pequeña en el puño izquierdo.\n'), 'las fallas con su etiqueta y punto final');
ok(t.includes('Envíos a todo México · Entrega en persona en Reynosa\nDisponible en stiimpys.store/p/160 (link en bio)'), 'firma sin emoji y "Disponible en" con link corto');
ok(/\n\n#lionelrichie #lionelrichietour #sudaderavintage #ropareynosa #allnightlong$/.test(t), '5 hashtags al final (con la marca)');
ok(/\n\n#lionelrichie #sudaderavintage #ropareynosa #allnightlong #vintagemexico$/.test(ig.textoPublicacion(LIONEL, fake.bazares[0])), 'sin marca: los mismos 5 hashtags de la v53');
ok(!/wa\.me|8995284602/.test(t), 'sin WhatsApp');
t = ig.textoPublicacion({ ...LIONEL, precioAnterior: 220, nombre: 'Playera Harley 🔥 Davidson ✨', descripcion: 'Playera negra 🖤 con águila al frente. Muy buena 👌\n\nA considerar: hoyito en la costura…' }, fake.bazares[0]);
ok(t.startsWith('Playera Harley Davidson\n\nPrecio: $150 MXN (antes $220)') && t.includes('Playera negra con águila al frente. Muy buena') && t.includes('A considerar: hoyito en la costura…\n') && !EMOJI.test(t), 'quita emojis del nombre y la descripción sin dejar espacios dobles; rebaja con "antes"');

grupo('Texto completo en estilo limpio');
t = ig.textoPublicacion(LIONEL, { ...fake.bazares[0], instagramConfig: { ...fake.bazares[0].instagramConfig, textoCorto: false } });
ok(!EMOJI.test(t) && t.includes('• Estampado Lionel Richie en el pecho') && t.includes('\nMedidas: Largo 70 cm · Ancho 58 cm') && t.includes('Precio: $150 MXN\nTalla: L Hombre'), 'toda la descripción, con "Medidas:" en lugar del 📐');

grupo('Con emojis (opcional)');
t = ig.textoPublicacion(LIONEL, { ...fake.bazares[0], instagramConfig: { ...fake.bazares[0].instagramConfig, estiloTexto: 'emojis' } });
ok(t.includes('💸 $150 MXN') && t.includes('🛒 Apártala en stiimpys.store/p/160') && t.includes('📦 Envíos'), 'con "Con emojis" queda como la v53');
ok(ig.configInstagram({ instagramConfig: { estiloTexto: 'raro' } }).estiloTexto === 'limpio', 'un estilo desconocido queda en limpio');

grupo('Comentario de VENDIDA, rebaja y drop');
ok(ig.textoComentarioVendido(fake.bazares[0]) === 'VENDIDA\nGracias por tu compra. Hay más prendas en stiimpys.store', 'VENDIDA sin emojis');
ok(EMOJI.test(ig.textoComentarioVendido({ instagramConfig: { estiloTexto: 'emojis' } })), 'con emojis si así se eligió');
const { textoDrop } = await import('./.tmp/api/_lib/instagramPanel.js');
t = textoDrop({ nombre: 'Viernes vintage' }, [LIONEL, { ...LIONEL, id: 161, nombre: 'Playera Nike', talla: 'M', precio_venta: 220 }], fake.bazares[0]);
ok(!EMOJI.test(t) && t.startsWith('DROP · Viernes vintage\n\n1. Sudadera Lionel Richie All Night Long con fechas de gira · L Hombre · $150\n2. Playera Nike · M · $220'), 'texto del drop sin emojis');
ok((t.match(/#[^\s#]+/g) || []).length === 5 && t.endsWith('#drop #stiimpys #bazar #reynosa #bazarreynosa'), `drop con máximo 5 hashtags (${(t.match(/#[^\s#]+/g) || []).length})`);
const { textoPrecio } = await import('./.tmp/api/_lib/igSync.js');   // v55: el aviso de rebaja vive en igSync.js
ok(textoPrecio({ id: 160 }, 120, 150, fake.bazares[0]) === 'Nuevo precio: $120 MXN (antes $150). Disponible en stiimpys.store/p/160', 'aviso de rebaja en el post: "Nuevo precio: $X MXN (antes $Y)" con link corto');

grupo('Guardar el estilo y publicar');
let rp = await pedir('ig-config', { estiloTexto: 'emojis' });
ok(rp.code === 200 && rp.body.config?.estiloTexto === 'emojis', 'se guarda "Con emojis"');
rp = await pedir('ig-config', { estiloTexto: '<script>' });
ok(rp.code === 200 && rp.body.config?.estiloTexto === 'emojis', 'un valor inventado no se guarda');
rp = await pedir('ig-config', { estiloTexto: 'limpio' });
ok(rp.code === 200 && rp.body.config?.estiloTexto === 'limpio', 'se regresa a limpio');
fake.inventario = [{ ...LIONEL, imagenes: fotos(2) }];
igCaps.length = 0;
await ig.publicarPrendaEnInstagram(fake.inventario[0], fake.bazares[0]);
const cap = igCaps.at(-1) || '';
ok(cap.includes('Precio: $150 MXN') && !EMOJI.test(cap), 'al publicar, Instagram recibe el texto limpio');

grupo('El panel arma el mismo texto');
const fs = await import('node:fs'); const vm = await import('node:vm');
const src = fs.readFileSync(new URL('../js/panel/instagram-panel.js', import.meta.url), 'utf8');
const trozo = src.slice(src.indexOf('function igHashLimpio('), src.indexOf('async function igLimpiarDescripciones('));
const ctx = { getDB: () => [], toast() {}, Avisos: {}, IG: {} }; vm.createContext(ctx);
vm.runInContext(trozo + '\nthis.T = igTextoPublicacion;', ctx);
const casos = [LIONEL, { ...LIONEL, nombre: 'Gorra 🧢 New Era', marca: 'New Era', precioAnterior: 300, descripcion: 'Gorra azul 💙. Ajustable.\n\n📐 Visera 7 cm' }, { id: 5, nombre: 'Gorra', precio_venta: 90 }];
const cfgs = [fake.bazares[0].instagramConfig, { ...fake.bazares[0].instagramConfig, textoCorto: false }, { estiloTexto: 'emojis' }, { estiloTexto: 'emojis', textoCorto: false, maxHashtags: 2 }];
let iguales = 0, total = 0;
for (const p of casos) for (const c of cfgs) {
  total++;
  const s1 = ig.textoPublicacion(p, { ...fake.bazares[0], instagramConfig: c });
  const s2 = ctx.T(p, ig.configInstagram({ instagramConfig: c }), fake.bazares[0]);
  if (s1 === s2) iguales++; else console.log('      distinto:\n' + s1 + '\n----\n' + s2);
}
ok(iguales === total, `servidor y panel dan el mismo texto (${iguales} de ${total})`);
