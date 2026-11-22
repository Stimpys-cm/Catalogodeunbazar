// ─────────────────────────────────────────────────────────────
//  api/_ia.js — Reconoce prendas a partir de sus fotos (Claude)
//
//   GET  /api/acciones?op=ia-estado     → ¿está configurada? + gasto de hoy / del mes
//   POST /api/acciones?op=ia-prenda     { imagenes, huellas?, categorias, tallas, estados,
//                                         marcas?, buscar, calidad: ahorro|auto|maxima,
//                                         bazarId, pista? }
//   POST /api/acciones?op=ia-texto      { tipo: caption|comentario|dm, ... } → texto listo (modelo rápido)
//   POST /api/acciones?op=ia-aprender   { casos:[{ ia:{...}, final:{...} }] }
//        → guarda cómo corregiste a la IA; lo usa en las siguientes prendas
//
//  Cómo ahorra:
//   · "auto": primero el modelo rápido (≈20× más barato); solo si duda de
//     la marca o del precio se le pregunta al modelo grande.
//   · Las instrucciones van en caché (las siguientes veces cuestan ~10 %).
//   · Fotos a 640 px y máx. 4 por prenda. Respuesta en JSON compacto.
//   · Mismas fotos otra vez → se responde de la memoria, gratis.
//   · Aprende de lo que corriges: marcas mal leídas, tu forma de nombrar y
//     cuánto sueles cobrar respecto a lo que propone.
//
//  Variables (Vercel): ANTHROPIC_API_KEY (obligatoria)
//    IA_MODELO (grande, def. claude-sonnet-5-5) · IA_MODELO_RAPIDO (def. claude-haiku-5-5)
// ─────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { getDB } from './_db.js';
import { requireAuth } from './_auth.js';
import { rateLimit } from './_rateLimit.js';
import { esGlobal } from './_bazar.js';

const GRANDE = () => process.env.IA_MODELO || 'claude-sonnet-5-5';
const RAPIDO = () => process.env.IA_MODELO_RAPIDO || 'claude-haiku-5-5';
// USD por millón de tokens: [entrada, salida, factor de lectura de caché]
const PRECIOS = { sonnet: [2, 10, 0.05], haiku: [0.10, 0.50, 0.10], opus: [5, 25, 0.05] };
const precioDe = m => PRECIOS[Object.keys(PRECIOS).find(k => String(m).includes(k)) || 'sonnet'];

const URL_CLOUD = /^https:\/\/res\.cloudinary\.com\/[\w-]+\/image\/upload\//;
const lista = (x, max = 80, largo = 60) => (Array.isArray(x) ? x : []).map(v => String(v || '').trim().slice(0, largo)).filter(Boolean).slice(0, max);
const ligera = u => u.replace('/upload/', '/upload/c_limit,w_640,h_640,q_auto:eco,f_jpg/');
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const mediana = arr => {
  const a = arr.filter(n => n > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const redondear = n => Math.max(50, Math.round(n / 10) * 10);
const hoy = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);

// ── Lo que el bazar ya sabe ─────────────────────────────────
async function historialPrecios(db, bazarId) {
  const prendas = await db.collection('inventario').find(bazarId ? { bazarId } : {}).toArray();
  const porCat = new Map(), porMarca = new Map(), diasMarca = new Map(), diasCat = new Map();
  for (const p of prendas) {
    const precio = Number(p.precio_venta) || 0;
    if (!precio) continue;
    // Qué tan rápido se vende (solo prendas registradas aquí, no importadas)
    if (p.vendido && p.creadoEn && p.vendidoEn && !p.importadoDeInstagram) {
      const d = (new Date(p.vendidoEn) - new Date(p.creadoEn)) / 864e5;
      if (d >= 0 && d < 365) {
        if (p.marca) { const k = norm(p.marca); (diasMarca.get(k) || diasMarca.set(k, []).get(k)).push(d); }
        for (const c of p.categorias || []) (diasCat.get(c) || diasCat.set(c, []).get(c)).push(d);
      }
    }
    for (const c of p.categorias || []) (porCat.get(c) || porCat.set(c, []).get(c)).push(precio);
    if (p.marca) { const k = norm(p.marca); (porMarca.get(k) || porMarca.set(k, []).get(k)).push(precio); }
  }
  return { porCat, porMarca, diasMarca, diasCat };
}

async function memoria(db, bazarId) {
  const casos = await db.collection('iaAprendizaje').find(bazarId ? { bazarId } : {}).sort({ en: -1 }).limit(300).toArray();
  const marcas = new Map(), ratios = new Map(), nombres = [], estados = new Map();
  const push = (k, v) => (ratios.get(k) || ratios.set(k, []).get(k)).push(v);
  for (const c of casos) {
    const a = c.ia || {}, f = c.final || {};
    if (f.marca && norm(a.marca) !== norm(f.marca)) {
      const k = `${a.marca || '(sin marca)'} → ${f.marca}`;
      marcas.set(k, (marcas.get(k) || 0) + 1);
    }
    if (a.precio > 0 && f.precio > 0) { push(f.categoria || '*', f.precio / a.precio); if (f.categoria) push('*', f.precio / a.precio); }
    if (f.estado && a.estado && f.estado !== a.estado) { const k = `${a.estado}→${f.estado}`; estados.set(k, (estados.get(k) || 0) + 1); }
    if (f.nombre && nombres.length < 8 && norm(f.nombre) !== norm(a.nombre) && !nombres.includes(f.nombre)) nombres.push(f.nombre);
  }
  const ajuste = new Map();
  for (const [k, v] of ratios) if (v.length >= 3) { const r = mediana(v); if (Math.abs(r - 1) >= 0.05) ajuste.set(k, Math.max(0.5, Math.min(1.6, r))); }
  return { casos: casos.length, marcas, ajuste, nombres, estados };
}

function textoMemoria(mem) {
  if (!mem.casos) return '';
  const l = [`Aprendido de ${mem.casos} prendas que el dueño revisó:`];
  const m = [...mem.marcas].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k);
  if (m.length) l.push(`- Marcas que corrigió (lo que dijiste → lo correcto): ${m.join(' · ')}`);
  const e = [...mem.estados].filter(([, n]) => n >= 2).map(([k]) => k);
  if (e.length) l.push(`- Estado: suele corregir ${e.join(', ')}`);
  if (mem.nombres.length) l.push(`- Así nombra sus prendas: ${mem.nombres.map(n => `"${n}"`).join(', ')}`);
  return l.length > 1 ? l.join('\n') : '';
}

function contextoPrecios(h) {
  const cats = [...h.porCat].filter(([, v]) => v.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 14)
    .map(([c, v]) => `${c} $${Math.round(mediana(v))}`);
  const marcas = [...h.porMarca].filter(([, v]) => v.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 20)
    .map(([m, v]) => `${m} $${Math.round(mediana(v))}`);
  return [cats.length ? `Medianas por categoría: ${cats.join(', ')}` : '', marcas.length ? `Por marca: ${marcas.join(', ')}` : ''].filter(Boolean).join('\n');
}

// Instrucciones fijas (van en caché). Lo que cambia por prenda va en el mensaje.
export function sistema({ categorias, tallas, estados, marcas = [], precios = '', mem = '', buscar = false }) {
  return `Experto en ropa de "Stiimpys", bazar de segunda mano (vintage, streetwear, de marca) en Reynosa, México. Recibes fotos de UNA prenda/tenis/accesorio y devuelves sus datos para venderla.

Reglas:
- Marca y talla: léelas de etiquetas, logos, bordados. Sin etiqueta visible: talla probable y confianza de talla baja.
- c (categoría): EXACTAMENTE una de [${categorias.join('|') || 'libre'}]
- t (talla): EXACTAMENTE una de [${tallas.join('|')}] (pantalón = cintura en pulgadas)
- e (estado): EXACTAMENTE uno de [${estados.join('|')}] (revisa manchas, bolitas, desgaste, roturas)
${marcas.length ? `- m (marca): si es una de estas, escríbela igual: ${marcas.join(', ')}\n` : ''}- n (nombre): tipo + marca + detalle atractivo (modelo, colab, gira, año, estampado). ≤60 caracteres, español, sin talla ni precio. Ej. "Playera The Weeknd After Hours Tour".
- d (descripción): 2–3 frases cortas que vendan; menciona defectos. Sin precio ni talla.
- x (fallas): lista corta de defectos visibles (manchas, hoyos, bolitas, decoloración, costuras). [] si no hay.
- md (medidas): si en alguna foto hay cinta métrica o regla, mide en cm (ej. "Largo 72 cm · Axila a axila 56 cm" o "Cintura 40 cm · Largo 104 cm"). "" si no hay cinta.
- h: 6–10 hashtags específicos (marca, modelo, artista, estilo, época). Sin #reynosa ni #bazar.
- p (precio MXN, bazar local): común $120–350, marca conocida $250–700, vintage buscado/hype/merch $400–2,500; ajusta por estado. r = rango [mín, máx].
${precios ? `- Precios de este bazar (referencia principal):\n${precios}\n` : ''}- f: índice (desde 0) de la foto con la prenda completa de frente.
- conf: 0 a 1 qué tan seguro estás de marca (m), talla (t) y precio (p).
- Si no es ropa/accesorio vendible: "ok":false.
${mem ? `\n${mem}\n` : ''}${buscar ? '\nPuedes buscar en internet (máx. 2 búsquedas) cuánto se vende usada (eBay, Grailed, Mercado Libre, Vinted, Depop). ~18 MXN por USD; en un bazar local se vende más barato.\n' : ''}
Responde SOLO JSON compacto, sin texto extra:
{"ok":true,"n":"","m":"","c":"","t":"","e":"","d":"","x":[],"md":"","h":"#a #b","p":0,"r":[0,0],"why":"razón del precio, ≤20 palabras","f":0,"conf":{"m":0,"t":0,"p":0}}`;
}

async function llamarClaude({ modelo, system, imagenes, pista, buscar }) {
  const cuerpo = {
    model: modelo,
    max_tokens: buscar ? 1200 : 600,
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [
      ...imagenes.map(url => ({ type: 'image', source: { type: 'url', url } })),
      { type: 'text', text: pista ? `Analiza esta prenda. Datos que ya tengo (pueden estar incompletos o mal): ${pista}` : 'Analiza esta prenda.' },
    ] }],
  };
  if (buscar) cuerpo.tools = [{
    type: 'web_search_20250305', name: 'web_search', max_uses: 2,
    user_location: { type: 'approximate', city: 'Reynosa', region: 'Tamaulipas', country: 'MX', timezone: 'America/Matamoros' },
  }];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), buscar ? 45000 : 30000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(cuerpo),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j?.error?.message || `HTTP ${r.status}`;
      const e = new Error(r.status === 401 ? 'La clave ANTHROPIC_API_KEY no es válida.' : r.status === 429 ? 'La IA está saturada, intenta en un minuto.' : /credit|billing|balance/i.test(msg) ? 'Tu cuenta de Anthropic no tiene saldo. Recarga en console.anthropic.com → Billing.' : `IA: ${msg}`);
      e.status = r.status; throw e;
    }
    const texto = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const m = texto.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('La IA no devolvió datos. Intenta de nuevo.');
    return { d: JSON.parse(m[0]), uso: j.usage || {}, modelo };
  } finally { clearTimeout(t); }
}

export function costo({ uso, modelo }) {
  const [inp, out, lect] = precioDe(modelo);
  const busquedas = Number(uso.server_tool_use?.web_search_requests || 0);
  return ((uso.input_tokens || 0) * inp + (uso.cache_creation_input_tokens || 0) * inp * 1.25
    + (uso.cache_read_input_tokens || 0) * inp * lect + (uso.output_tokens || 0) * out) / 1e6 + busquedas * 0.01;
}

async function anotarUso(db, bazarId, llamadas, extra = {}) {
  const $inc = { prendas: 1, llamadas: 0, entrada: 0, cacheLeida: 0, salida: 0, usd: 0, ...extra };
  for (const l of llamadas) {
    const u = l.uso;
    $inc.llamadas++;
    $inc.entrada += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    $inc.cacheLeida += u.cache_read_input_tokens || 0;
    $inc.salida += u.output_tokens || 0;
    $inc.usd += costo(l);
  }
  try { await db.collection('iaUso').updateOne({ bazarId: bazarId || 0, dia: hoy() }, { $inc }, { upsert: true }); } catch {}
}

const dudosa = d => d.ok === false || (d.conf?.m ?? 0) < 0.55 || (d.conf?.p ?? 0) < 0.45;

// ═════════════════════════════════════════════════════════════
export async function handleIA(req, res, op) {
  const user = await requireAuth(req, res); if (!user) return;
  const db = await getDB();
  const bazarDe = b => esGlobal(user) ? (Number(b?.bazarId) || null) : Number(user.bazarId) || null;

  if (op === 'ia-estado') {
    const bazarId = bazarDe(req.query);
    const filas = await db.collection('iaUso').find(bazarId ? { bazarId } : {}).toArray();
    const mes = hoy().slice(0, 7);
    const suma = arr => arr.reduce((t, f) => ({
      prendas: t.prendas + (f.prendas || 0), usd: t.usd + (f.usd || 0), gratis: t.gratis + (f.cacheGratis || 0),
      entrada: t.entrada + (f.entrada || 0), leida: t.leida + (f.cacheLeida || 0),
    }), { prendas: 0, usd: 0, gratis: 0, entrada: 0, leida: 0 });
    const aprendidas = (await db.collection('iaAprendizaje').find(bazarId ? { bazarId } : {}).toArray()).length;
    return res.status(200).json({
      activa: !!process.env.ANTHROPIC_API_KEY, modelo: GRANDE(), rapido: RAPIDO(),
      hoy: suma(filas.filter(f => f.dia === hoy())), mes: suma(filas.filter(f => String(f.dia).startsWith(mes))), aprendidas,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });

  if (op === 'ia-aprender') {
    const casos = (Array.isArray(req.body?.casos) ? req.body.casos : []).slice(0, 100);
    const bazarId = bazarDe(req.body);
    const limpio = o => ({
      nombre: String(o?.nombre || '').slice(0, 80), marca: String(o?.marca || '').slice(0, 40),
      categoria: String(o?.categoria || '').slice(0, 40), talla: String(o?.talla || '').slice(0, 30),
      estado: String(o?.estado || '').slice(0, 30), precio: Number(o?.precio) || 0,
    });
    for (const c of casos) await db.collection('iaAprendizaje').insertOne({ bazarId, en: new Date().toISOString(), ia: limpio(c.ia), final: limpio(c.final) });
    return res.status(200).json({ ok: true, guardados: casos.length });
  }

  if (op === 'ia-texto') return iaTexto(req, res, db, user, bazarDe(req.body));
  if (op !== 'ia-prenda') return res.status(400).json({ error: 'op no reconocida' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Falta configurar la IA: agrega ANTHROPIC_API_KEY en Vercel y vuelve a desplegar.' });
  if (!(await rateLimit(req, res, { key: 'ia-prenda-' + user.username, max: 600, windowSec: 3600 }))) return;

  const b = req.body || {};
  const todas = lista(b.imagenes, 10, 600).filter(u => URL_CLOUD.test(u));
  if (!todas.length) return res.status(400).json({ error: 'Faltan las fotos (deben estar subidas).' });
  const imagenes = todas.slice(0, 4);
  const bazarId = bazarDe(b);
  const calidad = ['ahorro', 'auto', 'maxima'].includes(b.calidad) ? b.calidad : 'auto';
  const pista = String(b.pista || '').slice(0, 300);

  // ¿Ya analizamos exactamente estas fotos? → gratis
  const huellas = lista(b.huellas, 10, 80);
  const base = (huellas.length === todas.length ? huellas : todas).slice().sort().join('|');
  const clave = createHash('sha256').update(`${base}|${pista}|${calidad}|${!!b.buscar}`).digest('hex');
  const cache = db.collection('iaCache');
  const previo = await cache.findOne({ clave });
  if (previo && !b.forzar) {
    await anotarUso(db, bazarId, [], { cacheGratis: 1 });
    return res.status(200).json({ ...previo.resultado, desdeMemoria: true, costoUSD: 0 });
  }

  const categorias = lista(b.categorias), tallas = lista(b.tallas, 120), estados = lista(b.estados, 20), marcas = lista(b.marcas, 150, 40);
  const [h, mem] = await Promise.all([historialPrecios(db, bazarId), memoria(db, bazarId)]);
  const sys = buscar => sistema({ categorias, tallas, estados, marcas, precios: contextoPrecios(h), mem: textoMemoria(mem), buscar });
  const urls = imagenes.map(ligera);

  const llamadas = [];
  const pedir = async (modelo, buscar) => {
    try { const r = await llamarClaude({ modelo, system: sys(buscar), imagenes: urls, pista, buscar }); llamadas.push(r); return r.d; }
    catch (e) {
      // Si la búsqueda en internet falla o tarda, se intenta sin ella
      if (buscar && e.status !== 401 && !/saldo/.test(e.message)) { const r = await llamarClaude({ modelo, system: sys(false), imagenes: urls, pista, buscar: false }); llamadas.push(r); return r.d; }
      throw e;
    }
  };

  let d, escalada = false;
  try {
    if (calidad === 'maxima') d = await pedir(GRANDE(), !!b.buscar);
    else {
      d = await pedir(RAPIDO(), calidad === 'ahorro' && !!b.buscar);
      // "auto": el grande solo si el rápido duda, o si pediste buscar precios
      if (calidad === 'auto' && (dudosa(d) || b.buscar)) {
        try { d = await pedir(GRANDE(), !!b.buscar); escalada = true; } catch (e) { if (/saldo|no es válida/.test(e.message)) throw e; }
      }
    }
  } catch (e) {
    await anotarUso(db, bazarId, llamadas);
    return res.status(e.status === 401 ? 503 : 502).json({ error: e.message });
  }
  await anotarUso(db, bazarId, llamadas);

  // Normaliza a las listas del sistema
  const elegir = (v, opciones) => {
    if (!opciones.length) return String(v || '').trim();
    const n = norm(v);
    return opciones.find(o => norm(o) === n) || opciones.find(o => n && (norm(o).startsWith(n) || n.startsWith(norm(o)))) || '';
  };
  const categoria = elegir(d.c, categorias);
  const marca = (marcas.find(m => norm(m) === norm(d.m)) || String(d.m || '').trim()).slice(0, 40);
  let precio = Number(d.p) || 0;
  const refMarca = marca ? mediana(h.porMarca.get(norm(marca)) || []) : null;
  const refCat = categoria ? mediana(h.porCat.get(categoria) || []) : null;
  const ref = refMarca || refCat;
  if (precio && ref) precio = precio * 0.7 + ref * 0.3;
  else if (!precio && ref) precio = ref;
  const aj = mem.ajuste.get(categoria) || mem.ajuste.get('*');     // cómo sueles corregir el precio
  if (precio && aj) precio *= aj;
  // Rapidez: si esa marca/categoría se vende en ≤4 días (con ≥3 ventas), sube 10%; si tarda >30, baja 5%
  const dias = (marca && h.diasMarca.get(norm(marca))?.length >= 3 ? h.diasMarca.get(norm(marca)) : null) || (categoria && h.diasCat.get(categoria)?.length >= 3 ? h.diasCat.get(categoria) : null);
  const medDias = dias ? mediana(dias.map(d => d + 0.01)) : null;
  let notaRapidez = '';
  if (precio && medDias != null) {
    if (medDias <= 4) { precio *= 1.10; notaRapidez = ` · +10%: ${marca || categoria} se vende en ~${Math.max(1, Math.round(medDias))} días.`; }
    else if (medDias > 30) { precio *= 0.95; notaRapidez = ` · −5%: ${marca || categoria} tarda ~${Math.round(medDias)} días en venderse.`; }
  }

  const c01 = x => Math.max(0, Math.min(1, Number(x) || 0));
  const resultado = {
    esPrenda: d.ok !== false,
    nombre: String(d.n || '').trim().slice(0, 80), marca, categoria,
    talla: elegir(d.t, tallas) || String(d.t || '').slice(0, 30),
    estado: elegir(d.e, estados),
    descripcion: [String(d.d || '').trim(), d.md ? `📐 ${String(d.md).trim()}` : ''].filter(Boolean).join('\n').slice(0, 700),
    fallas: (Array.isArray(d.x) ? d.x : []).map(x => String(x).slice(0, 80)).filter(Boolean).slice(0, 6),
    medidas: String(d.md || '').slice(0, 120),
    hashtags: String(d.h || '').match(/#[\p{L}\p{N}_]+/gu)?.slice(0, 12).join(' ') || '',
    precioSugerido: precio ? redondear(precio) : null,
    rangoPrecio: Array.isArray(d.r) ? d.r.map(n => redondear(Number(n) || 0)).slice(0, 2) : null,
    razonPrecio: String(d.why || '').slice(0, 200) + (aj ? ` · Ajustado ${aj > 1 ? '+' : ''}${Math.round((aj - 1) * 100)}% por cómo sueles cobrar.` : '') + notaRapidez,
    diasVenta: medDias != null ? Math.round(medDias) : null,
    portada: Math.max(0, Math.min(imagenes.length - 1, Number(d.f) || 0)),
    confianza: { marca: c01(d.conf?.m), talla: c01(d.conf?.t), precio: c01(d.conf?.p) },
    historial: { marca: refMarca && Math.round(refMarca), categoria: refCat && Math.round(refCat) },
    modelo: llamadas.at(-1)?.modelo, escalada,
    costoUSD: Math.round(llamadas.reduce((t, l) => t + costo(l), 0) * 10000) / 10000,
  };
  try { await cache.updateOne({ clave }, { $set: { clave, resultado, en: new Date().toISOString() } }, { upsert: true }); } catch {}
  return res.status(200).json(resultado);
}

// ── Textos cortos con el modelo rápido (≈ 1/20 del costo) ────
// caption  { prenda?, caption?, firma, hashtags, imagenes? }
// comentario { comentario, usuario, post }   ·   dm { mensajes:[{deMi,texto}], usuario }
const ESTILO_TEXTO = `Escribes como el community manager de "Stiimpys", bazar de ropa de segunda mano (vintage y streetwear) en Reynosa, México. Español mexicano, cercano y breve, sin exagerar con emojis (máx. 2-3). Nunca inventes datos que no te den (precio, talla, envíos). Si preguntan algo que no sabes, invita a mandar DM. Devuelve SOLO el texto final, sin comillas ni explicaciones.`;

async function iaTexto(req, res, db, user, bazarId) {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Falta configurar la IA (ANTHROPIC_API_KEY).' });
  if (!(await rateLimit(req, res, { key: 'ia-texto-' + user.username, max: 300, windowSec: 3600 }))) return;
  const b = req.body || {};
  const corto = (x, n) => String(x || '').slice(0, n);
  let negocio = '';
  try {
    const { leerConfigTienda } = await import('./_crecer.js');
    const i = (await leerConfigTienda(db, bazarId || 1)).info || {};
    negocio = [i.envios && `Envíos: ${i.envios}`, i.entrega && `Entrega: ${i.entrega}`, i.pagos && `Pagos: ${i.pagos}`, i.horario && `Horario: ${i.horario}`, i.apartado && `Apartados: ${i.apartado}`].filter(Boolean).join('\n');
  } catch {}
  const p = b.prenda || {};
  const datosPrenda = p.nombre ? `Prenda: ${corto(p.nombre, 80)}${p.marca ? ` · marca ${corto(p.marca, 40)}` : ''}${p.talla ? ` · talla ${corto(p.talla, 30)}` : ''}${p.estado ? ` · estado ${corto(p.estado, 20)}` : ''}${p.precio ? ` · $${Number(p.precio)} MXN` : ''}${p.descripcion ? `\nDescripción: ${corto(p.descripcion, 400)}` : ''}${p.link ? `\nLink: ${corto(p.link, 120)}` : ''}` : '';
  let pedido;
  if (b.tipo === 'caption') {
    pedido = `Escribe la descripción de un post de Instagram para vender ${datosPrenda ? 'esta prenda' : 'esto'}.
${datosPrenda}
${b.caption ? `Borrador actual (mejóralo, conserva los datos): ${corto(b.caption, 1200)}` : ''}
Formato: 1 línea gancho; luego líneas con emoji para Marca/Talla/Estado/Precio (solo las que tengas); 1-2 frases de por qué está chida; ${b.firma ? `la firma "${corto(b.firma, 200)}"; ` : ''}la línea del link para apartar si la tienes; al final ${b.hashtags ? `estos hashtags: ${corto(b.hashtags, 400)}` : '8-12 hashtags relevantes'}. Máx. 1,200 caracteres.`;
  } else if (b.tipo === 'comentario') {
    pedido = `Responde este comentario de @${corto(b.usuario, 40)} en un post: "${corto(b.comentario, 400)}".
Texto del post (datos reales de la prenda): ${corto(b.post, 700) || '(no disponible)'}
Respuesta pública de 1-2 frases, empieza con @${corto(b.usuario, 40)}.`;
  } else if (b.tipo === 'dm') {
    const msgs = (Array.isArray(b.mensajes) ? b.mensajes : []).slice(-8).map(m => `${m.deMi ? 'Stiimpys' : 'Cliente'}: ${corto(m.texto, 300)}`).join('\n');
    pedido = `Conversación por DM con @${corto(b.usuario, 40)}:\n${msgs}\n\nEscribe la siguiente respuesta de Stiimpys (1-3 frases).${datosPrenda ? `\nDatos que puedes usar: ${datosPrenda}` : ''}`;
  } else return res.status(400).json({ error: 'Tipo de texto no válido.' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: RAPIDO(), max_tokens: b.tipo === 'caption' ? 700 : 200,
        system: [{ type: 'text', text: ESTILO_TEXTO + (negocio ? `\n\nDatos reales del negocio (úsalos cuando pregunten, no inventes otros):\n${negocio}` : '') }], messages: [{ role: 'user', content: pedido }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j?.error?.message || `HTTP ${r.status}`;
      return res.status(502).json({ error: /credit|billing|balance/i.test(msg) ? 'Tu cuenta de Anthropic no tiene saldo.' : `IA: ${msg}` });
    }
    const texto = (j.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').trim().replace(/^["“]|["”]$/g, '');
    const llamada = { uso: j.usage || {}, modelo: RAPIDO() };
    await anotarUso(db, bazarId, [llamada], { prendas: 0, textos: 1 });
    return res.status(200).json({ texto: texto.slice(0, b.tipo === 'caption' ? 2200 : 1000), costoUSD: Math.round(costo(llamada) * 100000) / 100000 });
  } catch (e) { return res.status(502).json({ error: e.message }); }
}
