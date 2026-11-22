// Pruebas v49: la IA detecta detalles y fallas (con su foto) y el carrusel de Instagram
// repite la foto de la portada sin textos.
// - La IA revisa de cerca cada foto: detalles visibles (bordado, estampado, corte, tela si la
//   etiqueta lo dice) y fallas con la foto donde se ven.
// - Todo llega limpio (sin "(foto 3)", sin "ninguna", sin repetidos) y la descripción lo lleva.
// - Instagram: [portada con plantilla, la misma foto limpia, las demás] (máx. 10); se puede apagar.
process.env.SESSION_SECRET = 'secreto-de-prueba-v49';
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
const vistas = [], igMedia = [];
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
  await acciones({ method: 'POST', query: { op }, body, url: '/api/x', headers: { 'x-real-ip': '10.49.' + (ipN++ % 250) + '.1', host: 'stiimpys.store', authorization: 'Bearer ' + token } }, res);
  return { code: res.statusCode, body: res.body };
};
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const grupo = t => console.log('\n── ' + t);

fake.bazares = [{ id: 1, nombre: 'Stiimpys', slug: 'stiimpys', permisos: {} }];
fake.usuarios = [{ id: 1, username: 'jefa', role: 'admin', bazarId: null, sessionToken: 'TA', password: await hashPassword('x') }];
fake.inventario = [];
for (const k of ['iaCache', 'iaUso', 'iaAprendizaje', 'actividad', 'rate_limits', 'tipoCambio', 'bloqueos', 'iaSaldo', 'sistema', 'igProgramados']) fake[k] = [];
let nF = 0;
const fotos = n => Array.from({ length: n }, () => `https://res.cloudinary.com/demo/image/upload/v1/bazar/d${++nF}.jpg`);
const listas = { categorias: ['Sudaderas', 'Playeras'], tallas: ['M Hombre', 'L Hombre'], estados: ['9/10'], marcas: ['Nike'], bazarId: 1 };

// ═════════════════════════════════════════════════════════════
grupo('La IA busca detalles y fallas en todas las fotos');
let im = fotos(5);
cola = [resp(prenda({ dt: ['Logo bordado en el pecho', 'Estampado grande en la espalda', 'Capucha con cordón', '80% algodón, 20% poliéster'],
  x: ['Mancha chica en la manga izquierda (foto 4)', 'Bolitas en los puños (foto 2)'] }))];
let r = await pedir('ia-prenda', { imagenes: im, ...listas });
const sys = vistas[vistas.length - 1].system[0].text;
ok(/dt \(detalles\)/.test(sys) && /bordado/.test(sys) && /SOLO si la etiqueta lo dice/.test(sys) && /Nada que no se vea/.test(sys), 'instrucción: detalles que se ven (bordado, estampado, corte…), la tela solo si la etiqueta lo dice, nada inventado');
ok(/con su foto/.test(sys) && /Revisa de cerca TODAS las fotos/.test(sys) && /"dt":\[\]/.test(sys), 'instrucción: cada falla con la foto donde se ve, revisando todas las fotos; el JSON pide "dt"');
ok(r.code === 200 && r.body.detalles.length === 4 && r.body.detalles[0] === 'Logo bordado en el pecho', `devuelve los detalles (${r.body.detalles?.join(' | ')})`);
ok(r.body.fallas.join('|') === 'Mancha chica en la manga izquierda|Bolitas en los puños', `fallas sin "(foto N)" en el texto (${r.body.fallas?.join(' | ')})`);
ok(r.body.fallasFoto[0] === im[3] && r.body.fallasFoto[1] === im[1], 'cada falla dice en qué foto está (la URL, así sirve aunque cambies el orden)');
const d = r.body.descripcion;
ok(d.startsWith('Sudadera gruesa y cómoda.') && d.includes('• Logo bordado en el pecho\n• Estampado grande en la espalda'), 'la descripción lleva el texto y los detalles en lista');
ok(/A considerar: mancha chica en la manga izquierda, bolitas en los puños\./.test(d), 'la descripción avisa de las fallas (para evitar reclamos)');
ok(!/foto \d/i.test(d), 'la descripción no menciona números de foto');

grupo('Respuestas desordenadas de la IA');
cola = [resp(prenda({ dt: 'Cierre completo; • Bolsas laterales · Puños acanalados\n- ninguno', x: [{ t: 'costura abierta en el hombro', f: 3 }, { texto: 'Hoyo chico', foto: 9 }, 'ninguna', 'n/a'] }))];
r = await pedir('ia-prenda', { imagenes: fotos(3), ...listas });
ok(r.body.detalles.join('|') === 'Cierre completo|Bolsas laterales|Puños acanalados', `detalles en texto con ; • · y guiones se separan y "ninguno" se ignora (${r.body.detalles.join(' | ')})`);
ok(r.body.fallas.join('|') === 'Costura abierta en el hombro|Hoyo chico' && r.body.fallasFoto[1] === null, 'fallas como objetos {t,f}; "ninguna"/"n/a" fuera; foto que no existe (9 de 3) → sin foto');
cola = [resp(prenda({ dt: ['Logo bordado', 'logo bordado', 'LOGO BORDADO', 'Mancha en la manga', ...Array.from({ length: 12 }, (_, i) => 'Detalle ' + (i + 1))], x: ['Mancha en la manga'] }))];
r = await pedir('ia-prenda', { imagenes: fotos(2), ...listas });
ok(r.body.detalles.filter(x => /logo bordado/i.test(x)).length === 1, 'detalles repetidos (con otras mayúsculas) salen una vez');
ok(!r.body.detalles.includes('Mancha en la manga'), 'una falla no se cuenta también como "detalle"');
ok(r.body.detalles.length === 8, `máximo 8 detalles (${r.body.detalles.length})`);
cola = [resp(prenda({ dt: ['x'.repeat(200)], x: [12, null, { t: '' }] }))];
r = await pedir('ia-prenda', { imagenes: fotos(2), ...listas });
ok(r.body.detalles[0].length <= 60 && r.body.fallas.length === 0, 'textos largos se recortan; basura (números, vacíos) se ignora');
cola = [resp(prenda({ dt: [], x: [] }))];
r = await pedir('ia-prenda', { imagenes: fotos(2), ...listas });
ok(r.body.descripcion === 'Sudadera gruesa y cómoda.' && Array.isArray(r.body.detalles) && !r.body.detalles.length, 'sin detalles ni fallas: la descripción queda como antes');
cola = [resp(prenda({ dt: ['<img src=x onerror=alert(1)>Bordado'], x: [] }))];
r = await pedir('ia-prenda', { imagenes: fotos(2), ...listas });
ok(typeof r.body.detalles[0] === 'string', 'un detalle con código llega como texto (el panel lo muestra escapado)');

grupo('Memoria: la segunda vez es gratis y trae los detalles');
im = fotos(3);
cola = [resp(prenda({ dt: ['Estampado en la manga'], x: ['Decoloración leve (foto 2)'] }))];
const n0 = vistas.length;
const r1 = await pedir('ia-prenda', { imagenes: im, ...listas });
const r2 = await pedir('ia-prenda', { imagenes: im, ...listas });
ok(vistas.length === n0 + 1 && r2.body.desdeMemoria && r2.body.detalles[0] === 'Estampado en la manga' && r2.body.fallasFoto[0] === im[1], 'mismas fotos: no se vuelve a pagar y conserva detalles y fallas');
ok(r1.body.costoUSD > 0 && r2.body.costoUSD === 0, 'la primera cuesta, la segunda no');

grupo('Ayudantes (los usa también el panel)');
ok(ia.armarDescripcion('', [], ['USA tag roto'], '') === 'A considerar: USA tag roto.', 'siglas al inicio de una falla no se cambian a minúsculas');
ok(ia.armarDescripcion('a'.repeat(950), ['b'], [], '').length <= 900, 'la descripción nunca pasa de 900 caracteres');
ok(ia.leerFallas('hoyo en foto 2, mancha (fotos 1 y 3)', ['u1', 'u2', 'u3']).fallas.join('|') === 'Hoyo|Mancha', 'quita "en foto 2" y "(fotos 1 y 3)" del texto');

// ═════════════════════════════════════════════════════════════
grupo('Instagram: la foto de la portada sale también sola');
const cfgDef = ig.configInstagram({});
ok(cfgDef.portadaSola === true, 'viene prendido de inicio');
ok(ig.configInstagram({ instagramConfig: { portadaSola: false } }).portadaSola === false && ig.configInstagram({ instagramConfig: { portadaSola: 'no' } }).portadaSola === true, 'se puede apagar (y un valor raro no lo cambia)');
ok(JSON.stringify(ig.carruselConPortada('P', ['a', 'b', 'c'], cfgDef)) === '["P","a","b","c"]', 'carrusel: [portada con plantilla, la misma foto limpia, las demás]');
ok(JSON.stringify(ig.carruselConPortada('P', ['a', 'b', 'c'], { portadaSola: false })) === '["P","b","c"]', 'apagado: la plantilla reemplaza a la primera (como antes)');
ok(ig.carruselConPortada('P', Array.from({ length: 10 }, (_, i) => 'f' + i), cfgDef).length === 10, 'con 10 fotos queda en 10 (máximo de Instagram)');
ok(JSON.stringify(ig.carruselConPortada('P', ['a'], cfgDef)) === '["P","a"]', 'una sola foto: carrusel de 2 (portada + foto limpia)');

const bz = { id: 1, nombre: 'Stiimpys', slug: 'stiimpys', instagramConfig: {} };
const pr = { id: 77, nombre: 'Sudadera Nike', talla: 'M Hombre', estado: '9/10', precio_venta: 450, imagenes: fotos(3) };
igMedia.length = 0;
await ig.publicarPrendaEnInstagram(pr, bz);
ok(igMedia.length === 4, `al publicar una prenda de 3 fotos van 4 (${igMedia.length})`);
ok(/l_text/.test(igMedia[0]) && /e_colorize/.test(igMedia[0]), '1ª: la portada con la plantilla (nombre, talla, precio)');
const archivo = u => '/bazar/' + u.split('/bazar/')[1];
ok(!/l_text/.test(igMedia[1]) && igMedia[1].endsWith(archivo(pr.imagenes[0])) && igMedia[0].endsWith(archivo(pr.imagenes[0])), '2ª: la MISMA foto de la portada, sola y sin textos');
ok(igMedia[2].includes('/d' + pr.imagenes[1].match(/d(\d+)\.jpg/)[1] + '.jpg') && igMedia[3].includes('/d' + pr.imagenes[2].match(/d(\d+)\.jpg/)[1] + '.jpg'), '3ª y 4ª: las demás fotos en su orden');
igMedia.length = 0;
await ig.publicarPrendaEnInstagram(pr, { ...bz, instagramConfig: { portadaSola: false } });
ok(igMedia.length === 3 && /l_text/.test(igMedia[0]), 'apagado: 3 fotos, la portada reemplaza a la primera');
igMedia.length = 0;
await ig.publicarPrendaEnInstagram(pr, { ...bz, instagramConfig: { plantilla: false } });
ok(igMedia.length === 3 && !igMedia.some(u => /l_text/.test(u)), 'sin plantilla: las fotos tal cual, sin repetir nada');
igMedia.length = 0;
await ig.publicarPrendaEnInstagram({ ...pr, imagenes: fotos(10) }, bz);
ok(igMedia.length === 10, 'prenda con 10 fotos: el carrusel queda en 10');

grupo('Instagram desde el panel (Crear post)');
fake.inventario = [{ id: 88, bazarId: 1, nombre: 'Playera Nike', talla: 'L Hombre', estado: '9/10', precio_venta: 300, imagenes: fotos(2) }];
fake.bazares[0].instagramConfig = {};
igMedia.length = 0;
let rp = await pedir('ig-publicar', { tipo: 'post', imagenes: fake.inventario[0].imagenes, caption: 'Hola', prendaId: 88, plantilla: true });
ok(rp.code === 200 && igMedia.length === 3 && /l_text/.test(igMedia[0]) && !/l_text/.test(igMedia[1]), `con plantilla: portada + la misma foto limpia + la otra (${igMedia.length})`);
igMedia.length = 0;
fake.inventario[0].instagramId = null;
rp = await pedir('ig-publicar', { tipo: 'post', imagenes: fake.inventario[0].imagenes, caption: 'Hola', prendaId: 88, plantilla: false });
ok(rp.code === 200 && igMedia.length === 2 && !igMedia.some(u => /l_text/.test(u)), 'sin plantilla: solo sus 2 fotos');
rp = await pedir('ig-config', { portadaSola: false });
ok(rp.code === 200 && rp.body.config?.portadaSola === false && fake.bazares[0].instagramConfig.portadaSola === false, 'el ajuste "Repetir la foto de la portada" se guarda');
igMedia.length = 0; fake.inventario[0].instagramId = null;
rp = await pedir('ig-publicar', { tipo: 'post', imagenes: fake.inventario[0].imagenes, caption: 'Hola otra vez', prendaId: 88, plantilla: true });
ok(rp.code === 200 && igMedia.length === 2 && /l_text/.test(igMedia[0]), `con el ajuste apagado ya no se repite (${igMedia.length})`);
