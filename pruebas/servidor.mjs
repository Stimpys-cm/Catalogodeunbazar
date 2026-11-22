// Servidor local de pruebas (node pruebas/correr.mjs --servidor): archivos del proyecto + las 12 funciones reales de /api
// con la base en memoria y Clip/Resend/Cloudinary simulados. Nada sale a internet.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
process.env.CLIP_API_KEY = 'k'; process.env.CLIP_SECRET_KEY = 's';
process.env.RESEND_API_KEY = 're_x'; process.env.CORREO_DESDE = 'Stiimpys <hola@stiimpys.store>';
process.env.ANTHROPIC_API_KEY = 'sk-prueba';
process.env.CLOUDINARY_CLOUD_NAME = 'demo'; process.env.CLOUDINARY_API_KEY = 'ck'; process.env.CLOUDINARY_API_SECRET = 'cs';

const { fake } = await import('./.tmp/api/_lib/db.js');
const funciones = {};
for (const f of fs.readdirSync(path.join(AQUI, '.tmp/api')).filter(f => !f.startsWith('_') && f.endsWith('.js'))) funciones[f.replace('.js', '')] = (await import('./.tmp/api/' + f)).default;
console.log('funciones:', Object.keys(funciones).length, Object.keys(funciones).join(', '));

// Servicios externos simulados
let n = 0; const clip = {};
globalThis.fetch = async (url, o = {}) => {
  url = String(url);
  const J = (j, st = 200) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j) });
  if (url.includes('payclip.com/v2/checkout') && o.method === 'POST') { const b = JSON.parse(o.body); const id = 'pr_' + (++n); clip[id] = { status: 'CHECKOUT_CREATED', amount: b.amount }; return J({ payment_request_id: id, payment_request_url: 'https://clip.example/' + id }); }
  if (url.includes('payclip.com/v2/checkout/')) { const c = clip[decodeURIComponent(url.split('/').pop())]; return c ? J({ status: c.status, amount: c.amount, receipt_no: 'R1' }) : J({}, 404); }
  if (url === 'https://api.resend.com/emails') return J({ id: 'em' });
  if (url === 'https://api.resend.com/domains') return J({ name: 'restricted_api_key', message: 'restricted' }, 401);
  if (url.includes('api.cloudinary.com') && url.endsWith('/ping')) return J({ status: 'ok' });
  // v42: comprobantes y fotos de reseñas
  if (url.includes('api.cloudinary.com') && url.endsWith('/image/upload')) { const f = new URLSearchParams(String(o.body)); return J({ secure_url: `https://res.cloudinary.com/demo/image/upload/v1/${f.get('folder')}/${f.get('public_id')}.jpg` }); }
  // v43: IA que lee comprobantes y Banxico (CEP)
  // v45: el agente investigador (su sistema dice "tasador"): búsquedas reales + informe
  if (url.includes('api.anthropic.com') && String(o.body || '').includes('tasador')) {
    const urls = ['https://www.ebay.com/itm/9001', 'https://www.grailed.com/listings/9002', 'https://www.ebay.com/itm/9003'];
    return J({ content: [
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'stussy world tour 1990 tee sold' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: urls.map(u => ({ type: 'web_search_result', url: u, title: 'Stussy World Tour' })) },
      { type: 'text', text: JSON.stringify({ n: 'Playera Stüssy World Tour 1990', m: 'Stüssy', modelo: 'World Tour', c: 'Jersey', cn: 'Jerseys', t: 'L', e: '9/10',
        epoca: { rango: '1989–1992', decada: '90s', pistas: ['Etiqueta negra Stüssy con corona', 'Single stitch', 'Made in USA'] }, origen: 'Made in USA', material: '100% algodón',
        rareza: { nivel: 4, senales: ['Diseño World Tour original', 'Single stitch'] }, autenticidad: { nivel: 'alta', notas: ['Etiqueta y costuras de la época'] },
        comparables: [{ titulo: 'Vintage Stussy World Tour 90s tee', sitio: 'eBay', precio: 210, moneda: 'USD', vendido: true, url: urls[0] }, { titulo: 'Stussy World Tour single stitch', sitio: 'Grailed', precio: 250, moneda: 'USD', vendido: true, url: urls[1] },
          { titulo: 'Stussy world tour L', sitio: 'eBay', precio: 190, moneda: 'USD', vendido: true, url: urls[2] }, { titulo: 'Link inventado', sitio: 'eBay', precio: 999, moneda: 'USD', vendido: true, url: 'https://www.ebay.com/itm/inventado' }],
        mxn: { rapido: 2200, justo: 2600, maximo: 3500 }, evidencia: ['Tres vendidas entre $190 y $250 USD'], d: 'Playera Stüssy World Tour original de principios de los 90.', h: '#stussy #worldtour #vintage', conf: 0.75 }) }],
      usage: { input_tokens: 4000, output_tokens: 900, server_tool_use: { web_search_requests: 1 } }, stop_reason: 'end_turn' });
  }
  // v50: separar un lote en prendas (el sistema dice "separar un lote de fotos"). Cada link lleva "-pNN-" con la
  // prenda real; "-noropa-" = no es ropa; "-duda-" = la IA no está segura; "-sinver-" = la IA no la decide.
  if (url.includes('api.anthropic.com') && String(o.body || '').includes('separar un lote de fotos')) {
    globalThis.__agruparLlamadas = (globalThis.__agruparLlamadas || 0) + 1;
    const c = JSON.parse(String(o.body)).messages[0].content;
    const fotos = [];
    for (let i = 0; i < c.length - 1; i++) if (c[i].type === 'text' && /^Foto \d+$/.test(c[i].text) && c[i + 1].type === 'image') fotos.push({ n: Number(c[i].text.slice(5)), u: c[i + 1].source.url });
    const p = [], x = [];
    let prev = null;
    for (const f of fotos) {
      if (/-sinver-/.test(f.u)) continue;
      if (/-noropa-/.test(f.u)) { x.push(f.n); prev = null; continue; }
      const id = (f.u.match(/-p(\d+)-/) || [])[1] || 'x' + f.n;
      const ya = p.find(q => q.id === id);
      if (ya) { ya.f.push(f.n); if (/-duda-/.test(f.u)) ya.s = 0.4; }
      else p.push({ id, f: [f.n], n: 'Prenda ' + id, s: /-duda-/.test(f.u) ? 0.4 : 0.92 });
      prev = id;
    }
    return J({ content: [{ type: 'text', text: JSON.stringify({ p: p.map(({ id, ...r }) => r), x }) }], usage: { input_tokens: 110 * fotos.length + 900, output_tokens: 25 * p.length + 20 }, stop_reason: 'end_turn' });
  }
  // v44: el registro de prendas con IA (el sistema empieza con "Experto en ropa"); v45: fotos con "rara" en el link = pieza rara de marca nueva
  if (url.includes('api.anthropic.com') && String(o.body || '').includes('Experto en ropa')) {
    const rara = JSON.stringify(JSON.parse(String(o.body)).messages || '').includes('-rara-');
    return J({ content: [{ type: 'text', text: 'Aquí está: ```json\n' + JSON.stringify(rara
      ? { ok: true, n: 'Playera Stüssy vintage', m: 'Stüssy', c: 'Jersey de futbol', cn: 'Jerseys', t: 'L', e: '9/10', d: 'Playera vintage.', x: [], h: '#stussy', p: 600, r: [500, 700], why: 'Stüssy vintage', f: 0, conf: { m: 0.9, t: 0.8, p: 0.6 }, rz: 4, rs: ['Single stitch', 'Etiqueta vieja'] }
      : JSON.stringify(JSON.parse(String(o.body)).messages || '').includes('-detalles-')
        // v49: prenda con detalles y fallas (la mancha en la foto 3)
        ? { ok: true, n: 'Sudadera Nike Vintage', m: 'Nike', c: 'Hoodie', t: 'Large', e: 'Excelente', d: 'Sudadera gruesa.', dt: ['Logo bordado en el pecho', 'Bolsa canguro', '<img src=x onerror="window.__xss=1">Capucha'], x: ['Mancha chica en la manga (foto 3)'], h: ['#nike'], p: 480, r: [400, 550], why: 'Nike', f: 1, conf: { m: 0.9, t: 0.8, p: 0.7 } }
        : { ok: true, n: 'Sudadera Nike Vintage', m: 'Nike', c: 'Hoodie', t: 'Large', e: 'Excelente', d: 'Sudadera gruesa, sin detalles.', x: [], h: ['#nike', 'vintage'], p: '$480', r: [400, 550], why: 'Nike vintage se mueve rápido', f: 0, conf: { m: 0.9, t: 0.8, p: 0.7 } }) + '\n```' }], usage: { input_tokens: 800, output_tokens: 150 } });
  }
  if (url.includes('api.anthropic.com')) return J({ content: [{ type: 'text', text: JSON.stringify({ esComprobante: true, monto: globalThis.__montoIA || 650, claveRastreo: 'MBAN01002', fecha: new Date(Date.now() - 6 * 36e5).toISOString().slice(0, 10), bancoEmisor: 'BBVA', estado: 'exitosa' }) }] });
  if (url.includes('banxico.org.mx/cep/valida.do')) return { ok: true, status: 200, text: async () => '<html>Descarga</html>', headers: { get: () => 'JSESSIONID=x', getSetCookie: () => ['JSESSIONID=x'] } };
  if (url.includes('banxico.org.mx/cep/descarga.do')) return J('<SPEI_Tercero cadenaCDA="x"><Beneficiario Cuenta="" MontoPago="650.00"/></SPEI_Tercero>');
  if (url.includes('/ship/pickup/')) return J({ meta: 'pickup', data: [{ pickupNumber: 'PRP-777', pickupDate: '2099-01-01' }] });
  if (url.includes('frankfurter') || url.includes('er-api')) return J({ rates: { MXN: 18.2 }, date: '2026-11-17' });
  return J({}, 404);
};

// Llamar una función como lo hace Vercel
async function llamar(nombre, { method = 'GET', query = {}, body, headers = {} } = {}) {
  const res = respuesta();
  await funciones[nombre]({ method, query, body, headers, url: `/api/${nombre}` }, res);
  return res;
}
function respuesta(nodeRes) {
  return { statusCode: 200, _h: {}, headersSent: false, writableEnded: false, body: undefined,
    setHeader(k, v) { this._h[k.toLowerCase()] = v; }, getHeader(k) { return this._h[k.toLowerCase()]; },
    status(c) { this.statusCode = c; return this; },
    json(j) { this._h['content-type'] ||= 'application/json; charset=utf-8'; return this.end(JSON.stringify(j)); },
    send(x) { if (typeof x === 'object' && !Buffer.isBuffer(x)) return this.json(x); return this.end(x); },
    end(x) { this.body = x; this.headersSent = this.writableEnded = true;
      if (nodeRes) { nodeRes.writeHead(this.statusCode, this._h); nodeRes.end(x ?? ''); } return this; } };
}

// ── Datos de ejemplo ──
const { hashPassword } = await import('./.tmp/api/_lib/password.js');
const hace = (h) => new Date(Date.now() - h * 3600e3).toISOString();
fake.bazares = [{ id: 1, nombre: 'Stiimpys', whatsapp: '8990000000', slug: 'stiimpys', activo: true, permisos: {} }];
fake.usuarios = [{ id: 1, username: 'admin', role: 'admin', bazarId: null, sessionToken: 'TA', password: await hashPassword('Prueba#2026') },
  { id: 2, username: 'vende', role: 'vendedor', bazarId: 1, sessionToken: 'TV' }];
fake.categorias = [{ id: 1, nombre: 'Playeras' }]; fake.marcas = [{ id: 1, nombre: 'Nike' }];
const img = i => `https://res.cloudinary.com/demo/image/upload/sample.jpg`;
fake.inventario = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, bazarId: 1, nombre: ['Playera Nike 90s', 'Sudadera Carhartt', 'Chamarra Levi\'s', 'Jersey vintage', 'Gorra New Era', 'Pantalón Dickies', 'Tenis Adidas'][i % 7] + ` #${i + 1}`,
  marca: 'Nike', talla: ['S', 'M', 'L'][i % 3], estado: 'Muy bueno', precio_venta: 250 + i * 50, costo: 100, categorias: ['Playeras'], imagenes: [img(i)], creadoEn: hace(48 + i) }));
fake.tiendaConfig = [{ bazarId: 1, cupones: [{ codigo: 'BIENVENIDA', tipo: 'pct', valor: 10, activo: true }] }];
fake.pendientes = []; fake.ofertas = []; fake.listaEspera = [];
// v43: un drop lejano para probar su página (la base de pruebas no hace bulkWrite de /api/config)
fake.drops = [{ id: 'drop_v43', nombre: 'Drop Navidad', fecha: '2099-12-20T20:00:00.000Z', prendas: [5], publicado: false, bazarId: 1 }];

// Movimientos reales a través de la API (así el registro tiene datos de verdad)
const cliente = (x) => ({ nombre: 'Ana López', telefono: '8991234567', email: 'ana@gmail.com', punto: 'zona-centro', metodo: 'clip', ...x });
const pagar = async x => (await llamar('acciones', { method: 'POST', query: { op: 'v-pagar' }, body: cliente(x), headers: { 'x-real-ip': String(Math.random()) } })).body;
const avisar = id => llamar('acciones', { method: 'POST', query: { op: 'v-clip-webhook' }, body: { payment_request_id: id } });
const pedidos = () => fake.pedidos;
let r = JSON.parse(await pagar({ ids: [1, 2], cupon: 'BIENVENIDA' }));
let p = pedidos().find(x => x.id === r.pedido); clip[p.clipId].status = 'CHECKOUT_COMPLETED'; await avisar(p.clipId);
r = JSON.parse(await pagar({ ids: [3], modo: 'apartado', nombre: 'Beto Ruiz', telefono: '8112223344' }));
p = pedidos().find(x => x.id === r.pedido); clip[p.clipId].status = 'CHECKOUT_COMPLETED'; await avisar(p.clipId);
r = JSON.parse(await pagar({ ids: [4], nombre: 'Carla Mendoza', telefono: '8113334455' }));
p = pedidos().find(x => x.id === r.pedido); p.expira = hace(3); p.en = hace(4);   // pago que se quedó abierto
r = JSON.parse(await pagar({ ids: [5], nombre: 'Diego Paz', telefono: '8114445566' }));
await llamar('acciones', { method: 'POST', query: { op: 'v-pedido-estado' }, body: { id: r.pedido, accion: 'cancelar', motivo: 'Se equivocó de talla' }, headers: { authorization: 'Bearer TA' } });
await avisar('pr_no_existe');
for (let i = 0; i < 40; i++) await llamar('acciones', { method: 'POST', query: { op: 'v-pendiente-hecho' }, body: { id: 'x' + i }, headers: { authorization: 'Bearer TA' } });
console.log('datos listos:', pedidos().length, 'pedidos ·', fake.actividad.length, 'eventos');

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.map': 'application/json' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname.startsWith('/api/')) {
      const nombre = u.pathname.split('/')[2];
      if (!funciones[nombre]) { res.writeHead(404); return res.end('{}'); }
      let datos = ''; for await (const c of req) datos += c;
      const headers = Object.fromEntries(Object.entries(req.headers));
      headers['x-real-ip'] = '127.0.0.1';
      const r2 = respuesta(res);
      await funciones[nombre]({ method: req.method, query: Object.fromEntries(u.searchParams), body: datos ? JSON.parse(datos) : undefined, headers, url: req.url }, r2);
      if (!r2.writableEnded) { res.writeHead(r2.statusCode, r2._h); res.end(''); }
      return;
    }
    // v42: lo mismo que hacen los rewrites de vercel.json para /marca/:slug y /categoria/:slug
    const landing = /^\/(marca|categoria|talla|precio|guias|drop)(?:\/([^/]+))?$/.exec(u.pathname);
    if (landing) { const q = landing[1] === 'drop' ? { landing: 'drop', id: decodeURIComponent(landing[2] || '') } : { landing: landing[1], slug: decodeURIComponent(landing[2] || '') };
      const r3 = respuesta(res); await funciones.prenda({ method: 'GET', query: q, headers: {}, url: req.url }, r3); return; }
    let ruta = u.pathname === '/' ? '/inicio.html' : u.pathname;
    const archivo = path.join(RAIZ, decodeURIComponent(ruta));
    if (!archivo.startsWith(RAIZ) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) { res.writeHead(404); return res.end('no existe'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
    fs.createReadStream(archivo).pipe(res);
  } catch (e) { console.error('ERROR', req.url, e); res.writeHead(500); res.end('{}'); }
}).listen(8766, () => console.log('listo en 8766'));
