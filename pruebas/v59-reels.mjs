// Pruebas v59: Reels profesionales.
// - El MP4 se arma a mano (js/panel/ig-mp4.js): cajas en orden (ftyp, moov, mdat), índice correcto,
//   cuadros clave, duración, tamaño 1080×1920 y desfases (ctts) si el codificador reordena.
// - ig-reel-crear solo acepta videos y portadas de TU Cloudinary (no de otra cuenta ni otra página),
//   manda la portada como cover_url y convierte a H.264.
// - Las piezas nuevas están en el paquete del panel.
process.env.SESSION_SECRET = 'secreto-de-prueba-v59';
process.env.IG_STIIMPYS_USER_ID = '1784'; process.env.IG_STIIMPYS_TOKEN = 'tok-prueba';
process.env.CLOUDINARY_CLOUD_NAME = 'minube'; process.env.CLOUDINARY_API_KEY = 'llave'; process.env.CLOUDINARY_API_SECRET = 'secreto';
for (const k of ['MULTI_BAZAR', 'BAZAR_PRINCIPAL', 'IG_STIIMPYS_MODO']) delete process.env[k];
import fs from 'fs';
import vm from 'vm';
import crypto from 'crypto';
const raiz = f => new URL('../' + f, import.meta.url);
const { fake, getDB } = await import('./.tmp/api/_lib/db.js');
const acciones = (await import('./.tmp/api/acciones.js')).default;
const { hashPassword } = await import('./.tmp/api/_lib/password.js');
const igp = await import('./.tmp/api/_lib/instagramPanel.js');

const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);

// ── 1. El empaquetador MP4 ───────────────────────────────────
grupo('MP4 hecho a mano');
const RlMp4 = vm.runInNewContext(fs.readFileSync(raiz('js/panel/ig-mp4.js'), 'utf8') + ';RlMp4', { TextEncoder, Blob, Uint8Array, ArrayBuffer, Math, Error });
const avcC = new Uint8Array([1, 0x42, 0xe0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x42, 0xe0, 0x28, 1, 0, 4, 0x68, 0xce, 0x3c, 0x80]);
const trozo = (i, n, ts) => ({ byteLength: n, type: i % 60 === 0 ? 'key' : 'delta', timestamp: ts ?? Math.round(i * 1e6 / 30), copyTo: d => d.fill((i % 250) + 1) });
async function armar(cuadros, tsDe) {
  const m = RlMp4.nuevo({ ancho: 1080, alto: 1920, fps: 30 });
  for (let i = 0; i < cuadros; i++) m.agregar(trozo(i, 100 + (i % 7) * 13, tsDe?.(i)), i === 0 ? { decoderConfig: { description: avcC.buffer } } : undefined);
  return new Uint8Array(await m.terminar().arrayBuffer());
}
const leer = (b, o) => (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
const tipo = (b, o) => String.fromCharCode(...b.subarray(o + 4, o + 8));
function cajas(b, ini = 0, fin = b.length) { const out = []; let o = ini; while (o < fin) { const n = leer(b, o); out.push({ t: tipo(b, o), o, n }); if (n < 8) break; o += n; } return out; }
function buscar(b, ruta) {
  let ini = 0, fin = b.length, c;
  for (const t of ruta) { c = cajas(b, ini, fin).find(x => x.t === t); if (!c) return null; ini = c.o + 8 + (t === 'stsd' ? 8 : 0); fin = c.o + c.n; }
  return c;
}
let b = await armar(600);
const top = cajas(b).map(c => c.t);
ok(top.join(',') === 'ftyp,moov,mdat', `cajas en orden de "inicio rápido" (${top})`);
const ST = ['moov', 'trak', 'mdia', 'minf', 'stbl'];
const stco = buscar(b, [...ST, 'stco']), mdat = cajas(b).find(c => c.t === 'mdat');
ok(leer(b, stco.o + 16) === mdat.o + 8, 'el índice apunta justo al inicio de los datos');
const stsz = buscar(b, [...ST, 'stsz']);
ok(leer(b, stsz.o + 16) === 600 && leer(b, stsz.o + 20) === 100 && leer(b, stsz.o + 24) === 113, '600 cuadros con su tamaño');
let suma = 0; for (let i = 0; i < 600; i++) suma += leer(b, stsz.o + 20 + i * 4);
ok(mdat.n === suma + 8, 'los datos miden lo que dice el índice');
ok(b[mdat.o + 8] === 1 && b[mdat.o + 8 + 100] === 2, 'los cuadros van en orden dentro de los datos');
const stss = buscar(b, [...ST, 'stss']);
ok(leer(b, stss.o + 12) === 10 && leer(b, stss.o + 16) === 1 && leer(b, stss.o + 20) === 61, 'cuadro clave cada 2 segundos (10 en 20 s)');
const mvhd = buscar(b, ['moov', 'mvhd']);
ok(leer(b, mvhd.o + 20) === 1000 && leer(b, mvhd.o + 24) === 20000, 'duración 20.000 s');
const tkhd = buscar(b, ['moov', 'trak', 'tkhd']);
ok(leer(b, tkhd.o + tkhd.n - 8) === 1080 * 65536 && leer(b, tkhd.o + tkhd.n - 4) === 1920 * 65536, 'pista de 1080 × 1920');
const mdhd = buscar(b, ['moov', 'trak', 'mdia', 'mdhd']);
ok(leer(b, mdhd.o + 20) === 30000 && leer(b, mdhd.o + 24) === 600000, '30 cuadros por segundo exactos');
const stts = buscar(b, [...ST, 'stts']);
ok(leer(b, stts.o + 16) === 600 && leer(b, stts.o + 20) === 1000, 'cada cuadro dura lo mismo');
const avc1 = buscar(b, [...ST, 'stsd', 'avc1']);
ok(avc1 && b.subarray(avc1.o, avc1.o + avc1.n).includes(0x67), 'lleva la configuración del codificador (avcC)');
ok(!buscar(b, [...ST, 'ctts']), 'sin cuadros reordenados no hace falta ctts');
// Codificador que reordena (I P B B): se agregan desfases
const orden = [0, 3, 1, 2, 6, 4, 5, 9, 7, 8, 12, 10, 11];
b = await armar(orden.length, i => Math.round(orden[i] * 1e6 / 30));
const ctts = buscar(b, [...ST, 'ctts']);
ok(ctts && b[ctts.o + 8] === 1 && leer(b, ctts.o + 12) === orden.length, 'si reordena, agrega ctts (versión 1) con un desfase por cuadro');
ok(leer(b, ctts.o + 20) === 0 && leer(b, ctts.o + 28) === 2000 && (leer(b, ctts.o + 36) | 0) === -1000, 'los desfases son los correctos (+2 y -1 cuadros)');
let falla = '';
try { RlMp4.nuevo({ ancho: 10, alto: 10 }).terminar(); } catch (e) { falla = e.message; }
ok(/configuración/.test(falla), 'sin datos del codificador avisa en lugar de hacer un archivo roto');

// ── 2. Servidor ──────────────────────────────────────────────
const enviados = [];
const J = (j, st = 200) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j), headers: { get: () => null } });
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  if (!url.includes('graph.instagram.com')) return J({}, 404);
  if ((o.method || 'GET') === 'POST') { enviados.push(Object.fromEntries(new URLSearchParams(String(o.body)))); return J({ id: '178' + enviados.length }); }
  return J({ status_code: 'FINISHED' });
};
const mk = () => ({ statusCode: 200, body: undefined, h: {}, status(c) { this.statusCode = c; return this; }, json(j) { this.body = j; return this; },
  send(x) { this.body = x; return this; }, end(x) { if (x !== undefined) this.body = x; return this; }, setHeader(k, v) { this.h[k.toLowerCase()] = v; }, getHeader(k) { return this.h[k.toLowerCase()]; } });
let ipN = 0;
const op = async (o, body = {}, auth = 'Bearer TA') => { const res = mk(); await acciones({ method: 'POST', query: { op: o }, body: { ...body, _n: ipN }, url: '/api/acciones', headers: { 'x-real-ip': '10.59.' + (ipN++ % 250) + '.1', host: 'stiimpys.store', ...(auth ? { authorization: auth } : {}) } }, res); return { code: res.statusCode, body: res.body }; };

fake.bazares = [{ id: 1, nombre: 'Stiimpys', slug: 'stiimpys', permisos: {}, instagramConfig: { plantilla: false } },
  { id: 2, nombre: 'Otro', slug: 'otro', permisos: { crearPrendas: false }, instagramConfig: {} }];
fake.usuarios = [{ id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA', password: await hashPassword('x') },
  { id: 2, username: 'vende', role: 'vendedor', bazarId: 2, sessionToken: 'TV', password: await hashPassword('x') }];
for (const k of ['actividad', 'rate_limits', 'bloqueos', 'sistema', 'igProgramados', 'tiendaConfig', 'drops', 'inventario']) fake[k] = [];
await getDB();

grupo('Firma para subir');
let r = await op('ig-firma-video');
const esperada = crypto.createHash('sha1').update(`folder=bazar/reels&timestamp=${r.body.timestamp}secreto`).digest('hex');
ok(r.code === 200 && r.body.cloud === 'minube' && r.body.signature === esperada && !JSON.stringify(r.body).includes('"secreto"'), 'firma válida y nunca manda el secreto');
r = await op('ig-firma-video', {}, null);
ok(r.code === 401 || r.code === 403, `sin sesión no hay firma (${r.code})`);
r = await op('ig-firma-video', {}, 'Bearer TV');
ok(r.code === 403, `un bazar sin permiso para publicar no recibe firma (${r.code})`);

grupo('Crear el Reel con portada');
const V = 'https://res.cloudinary.com/minube/video/upload/v1732000000/bazar/reels/abc_12-x.mp4';
const F = 'https://res.cloudinary.com/minube/image/upload/v1732000001/bazar/reels/portada_1.jpg';
r = await op('ig-reel-crear', { video: V, caption: 'NUEVOS INGRESOS', portada: F });
let e = enviados.at(-1);
ok(r.code === 200 && r.body.id, 'acepta video y portada de tu Cloudinary');
ok(e.media_type === 'REELS' && e.cover_url === F && e.share_to_feed === 'true', 'manda la portada a Instagram (cover_url) y lo comparte al perfil');
ok(e.video_url === V.replace('/video/upload/', '/video/upload/vc_h264,ac_aac,f_mp4,q_auto:good/'), 'pide el video en H.264 con buena calidad');
r = await op('ig-reel-crear', { video: V.replace('.mp4', '.webm'), caption: 'x' });
e = enviados.at(-1);
ok(r.code === 200 && !('cover_url' in e) && /\.mp4$/.test(e.video_url), 'sin portada también funciona (y un .webm se convierte a .mp4)');
r = await op('ig-reel-crear', { video: 'https://res.cloudinary.com/minube/video/upload/v1/abc.mp4', caption: 'x' });
ok(r.code === 200, 'acepta archivos sin carpeta (Cloudinary con carpetas dinámicas)');

grupo('Direcciones que no son tuyas');
const antes = enviados.length;
const malas = [
  ['otra cuenta de Cloudinary', { video: V.replace('/minube/', '/otra/') }],
  ['otra página', { video: 'https://evil.example/minube/video/upload/v1/bazar/reels/a.mp4' }],
  ['http sin candado', { video: V.replace('https:', 'http:') }],
  ['con parámetros', { video: V + '?x=1' }],
  ['con usuario en la dirección', { video: V.replace('https://', 'https://a:b@') }],
  ['salir de la carpeta con ..', { video: 'https://res.cloudinary.com/minube/video/upload/v1/../../otra/video/upload/a.mp4' }],
  ['una imagen como video', { video: F }],
  ['video no es texto', { video: { $gt: '' } }],
  ['portada de otra cuenta', { video: V, portada: F.replace('/minube/', '/otra/') }],
  ['portada de otra página', { video: V, portada: 'https://evil.example/p.jpg' }],
  ['portada con parámetros', { video: V, portada: F + '#x' }],
  ['un video como portada', { video: V, portada: V }],
  ['portada que no es texto', { video: V, portada: ['x'] }],
];
for (const [nombre, body] of malas) {
  r = await op('ig-reel-crear', { caption: 'x', ...body });
  ok(r.code === 400, `rechaza ${nombre}`);
}
ok(enviados.length === antes, 'a Instagram no le llegó ninguna de esas');
ok(igp.urlReelPropia(V, 'video') === V && igp.urlReelPropia('x'.repeat(700), 'video') === '', 'el revisor de direcciones también limita el largo');
const nube = process.env.CLOUDINARY_CLOUD_NAME; delete process.env.CLOUDINARY_CLOUD_NAME;
ok(igp.urlReelPropia(V, 'video') === '', 'sin la nube configurada no acepta nada');
process.env.CLOUDINARY_CLOUD_NAME = nube;
r = await op('ig-reel-estado', { id: '../x' });
ok(r.code === 400, 'estado con id raro: rechazado');
r = await op('ig-reel-publicar', { id: 'abc' });
ok(r.code === 400, 'publicar con id raro: rechazado');

// ── 3. Paquete del panel ─────────────────────────────────────
grupo('Paquete del panel');
const paquetes = JSON.parse(fs.readFileSync(raiz('herramientas/paquetes.json'), 'utf8'));
const lista = JSON.stringify(paquetes);
ok(lista.indexOf('js/panel/ig-crecer.js') < lista.indexOf('js/panel/ig-mp4.js') && lista.indexOf('js/panel/ig-mp4.js') < lista.indexOf('js/panel/ig-reels.js'), 'ig-mp4 e ig-reels van en el paquete del panel, después de ig-crecer');
const src = fs.readFileSync(raiz('js/panel/ig-reels.js'), 'utf8');
ok(/arriba: 270, abajo: 1480, izq: 72, der: 1008, derRiel: 930/.test(src), 'zona segura definida (arriba 270, abajo 440, orillas 72, botones 150)');
ok(!/rlArmar|captureStream\(30\)/.test(fs.readFileSync(raiz('js/panel/ig-crecer.js'), 'utf8')), 'el creador viejo ya no está en ig-crecer.js');
ok(!/WhatsApp|wa\.me/i.test(src), 'los Reels no llevan WhatsApp');
