// ─────────────────────────────────────────────────────────────
//  api/_lib/ia.js — Reconoce prendas a partir de sus fotos (Claude)
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
//  A prueba de fallas (v44):
//   · Reintenta sola si la IA está saturada (429/5xx/529), se cae la red o tarda;
//     respeta "retry-after" y nunca se pasa de ~50 s (Vercel corta a los 60).
//   · Si un modelo no puede (saturado, mal escrito en Vercel, no entiende),
//     lo intenta el otro. "Automático" se queda con lo del rápido si el grande falla.
//   · Lee el JSON aunque venga con texto, en ```json, partido en bloques o cortado.
//   · Si la IA no puede bajar las fotos, el servidor las baja y se las manda;
//     una foto rota se salta.
//   · Talla, estado y categoría se acomodan a tus listas ("Hoodie" → Sudaderas,
//     "W32 L30" → 32, "US 9.5" → 27.5, "Excelente" → 9/10).
//   · Nunca devuelve una prenda sin nombre ni precio; lo incompleto no se guarda
//     en la memoria. Los errores salen en español y dicen si se puede reintentar.
//
//  Variables (Vercel): ANTHROPIC_API_KEY (obligatoria)
//    IA_MODELO (grande, def. claude-sonnet-5-5) · IA_MODELO_RAPIDO (def. claude-haiku-5-5)
// ─────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { getDB } from './db.js';
import { requireAuth } from './auth.js';
import { rateLimit } from './rateLimit.js';
import { esGlobal } from './bazar.js';
import { estadoSaldo, sumarGasto, marcarSinSaldo, ponerSaldo } from './saldo.js';

const GRANDE = () => process.env.IA_MODELO || 'claude-sonnet-5-5';
const RAPIDO = () => process.env.IA_MODELO_RAPIDO || 'claude-haiku-5-5';
// USD por millón de tokens: [entrada, salida, factor de lectura de caché]
const PRECIOS = { sonnet: [2, 10, 0.05], haiku: [0.10, 0.50, 0.10], opus: [5, 25, 0.05] };
const precioDe = m => PRECIOS[Object.keys(PRECIOS).find(k => String(m).includes(k)) || 'sonnet'];

const URL_CLOUD = /^https:\/\/res\.cloudinary\.com\/[\w-]+\/image\/upload\//;
const lista = (x, max = 80, largo = 60) => (Array.isArray(x) ? x : []).map(v => String(v || '').trim().slice(0, largo)).filter(Boolean).slice(0, max);
// v47: hasta 8 fotos por prenda para que la IA encuentre la etiqueta donde esté.
// Con 1–4 fotos van a 640 px; con 5–8, a 512 px (casi el mismo costo total).
const MAX_FOTOS_IA = 8;
const ligera = (u, n = 1) => { const px = n > 4 ? 512 : 640; return u.replace('/upload/', `/upload/c_limit,w_${px},h_${px},q_auto:eco,f_jpg/`); };
// Dos pedidos iguales al mismo tiempo (dos pestañas, doble clic): el segundo espera al primero y no paga
async function esperarOtroIgual(db, cache, clave, restante) {
  const { tomarBloqueo } = await import('./actividad.js');
  const token = await tomarBloqueo(db, 'ia:' + clave, 60).catch(() => 'sin-candado');
  if (token) return { token };
  const hasta = Date.now() + Math.max(0, Math.min(40000, restante() - 12000));
  while (Date.now() < hasta) {
    await esperar(Math.max(5, Math.min(1000, ESPERA())));
    const hecho = await cache.findOne({ clave }).catch(() => null);
    if (hecho) return { hecho };
  }
  return { token: null };
}
async function soltarIgual(db, clave, token) { if (token && token !== 'sin-candado') { const { soltarBloqueo } = await import('./actividad.js'); await soltarBloqueo(db, 'ia:' + clave, token); } }
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
// ── v49: detalles y fallas ───────────────────────────────────
const NADA = /^(ninguna?o?s?|no hay( nada)?|n\/?a|none|sin (detalles|fallas|defectos)|-|—)$/i;
const sinFoto = t => t.replace(/\s*[([]\s*(fotos?|imagen|img)\s*#?\s*\d+(\s*(y|,|-)\s*\d+)*\s*[)\]]\s*/gi, ' ')
  .replace(/[,;]?\s*\b(en|de)?\s*(la\s+)?(fotos?|imagen|img)\s*#?\s*\d+(\s*(y|,|-)\s*\d+)*\b/gi, ' ')
  .replace(/\s{2,}/g, ' ').replace(/[\s,.;:]+$/, '').trim();
const mayus = t => t ? t[0].toLocaleUpperCase('es') + t.slice(1) : t;
// Lista que puede venir como arreglo, texto separado o con viñetas
const comoLista = v => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\n|;|·|•|\s-\s|,(?![^(]*\))/) : []);
export function leerFallas(x, imagenes = []) {
  const fallas = [], fallasFoto = [];
  for (const it of comoLista(x)) {
    const crudo = typeof it === 'object' && it ? texto(it.t ?? it.texto ?? it.d ?? '', 100) : texto(it, 100);
    let n = typeof it === 'object' && it ? Math.round(numero(it.f ?? it.foto)) : NaN;
    const m = crudo.match(/(?:fotos?|imagen|img)\s*#?\s*(\d+)/i);
    if (!(n >= 1) && m) n = Number(m[1]);
    const t = mayus(sinFoto(crudo.replace(/^[-•*·\s]+/, ''))).slice(0, 80);
    if (!t || NADA.test(t) || !/\p{L}/u.test(t)) continue;
    if (fallas.some(f => norm(f) === norm(t))) continue;
    fallas.push(t);
    // "foto 4" es la 4ª foto que vio la IA (la 1ª es la foto 1)
    fallasFoto.push(n >= 1 && n <= imagenes.length ? imagenes[n - 1] : null);
    if (fallas.length >= 6) break;
  }
  return { fallas, fallasFoto };
}
export function leerDetalles(dt, fallas = []) {
  const out = [];
  for (const it of comoLista(dt)) {
    const t = mayus(sinFoto(texto(typeof it === 'object' && it ? (it.t ?? it.texto ?? '') : it, 80).replace(/^[-•*·✔✓\s]+/, ''))).slice(0, 60);
    if (!t || NADA.test(t) || !/\p{L}/u.test(t)) continue;
    if (out.some(x => norm(x) === norm(t)) || fallas.some(f => norm(f) === norm(t))) continue;
    out.push(t);
    if (out.length >= 8) break;
  }
  return out;
}
// Descripción para la tienda e Instagram: lo que vende, los detalles, las fallas (para evitar reclamos) y las medidas
export function armarDescripcion(d, detalles = [], fallas = [], medidas = '') {
  const partes = [];
  if (d) partes.push(d);
  if (detalles.length) partes.push(detalles.map(x => `• ${x}`).join('\n'));
  if (fallas.length) partes.push(`A considerar: ${fallas.map(f => /^\p{Lu}{2}/u.test(f) ? f : f.charAt(0).toLocaleLowerCase('es') + f.slice(1)).join(', ')}.`);
  if (medidas) partes.push(`📐 ${medidas}`);
  let out = partes.join('\n\n');
  if (out.length > 900) out = out.slice(0, 899).replace(/\s+\S*$/, '') + '…';
  return out;
}

export function sistema({ categorias, tallas, estados, marcas = [], precios = '', mem = '', buscar = false }) {
  return `Experto en ropa de "Stiimpys", bazar de segunda mano (vintage, streetwear, de marca) en Reynosa, México. Recibes de 1 a 8 fotos de UNA prenda/tenis/accesorio y devuelves sus datos para venderla. Revisa TODAS las fotos: la etiqueta puede estar en cualquiera.

NO INVENTES. Solo escribe lo que se ve en las fotos o lo que la pista confirma:
- Marca: solo si se ve (etiqueta, logo, bordado). Si no se ve, m = "" y conf.m baja.
- Talla: solo si se ve en una etiqueta o es inconfundible. Si no, t = "" y conf.t baja. No adivines.
- Modelo, gira, año, colab, artista: solo si están escritos o impresos en la prenda. Nada de "probablemente".
- Medidas solo con cinta métrica en la foto.

Reglas:
- c (categoría): EXACTAMENTE una de [${categorias.join('|') || 'libre'}]
- cn: SOLO si ninguna categoría encaja de verdad, la categoría nueva que propones (español, plural, 1–2 palabras, ej. "Jerseys"); si no, "".
- t (talla): EXACTAMENTE una de [${tallas.join('|')}] (pantalón = cintura en pulgadas)
- e (estado): EXACTAMENTE uno de [${estados.join('|')}] (revisa manchas, bolitas, desgaste, roturas)
${marcas.length ? `- m (marca): si es una de estas, escríbela igual: ${marcas.join(', ')}. Si es otra, escríbela con su nombre oficial (ej. "Stüssy", "BAPE", "Carhartt").\n` : ''}- n (nombre): tipo + marca + detalle que SE VEA (modelo, colab, gira, año, estampado). ≤60 caracteres, español, sin talla ni precio. Ej. "Playera The Weeknd After Hours Tour".
- d (descripción): 2–3 frases cortas que vendan, solo con lo que se ve. No repitas la lista de detalles ni de fallas. Sin precio ni talla.
- dt (detalles): 3–8 detalles que SE VEN y ayudan a venderla, cada uno ≤45 caracteres. Revisa de cerca cada foto:
  · estampado o bordado: técnica y dónde va (ej. "Logo bordado en el pecho", "Estampado grande en la espalda", "Estampado en la manga")
  · corte y forma (oversize, cropped, boxy, cuello en V, capucha, medio cierre)
  · cierres, botones, bolsas, puños, ajustadores
  · tela o composición SOLO si la etiqueta lo dice (ej. "100% algodón"); "Hecho en X" solo si se lee
  · etiqueta original o colgante, costura single stitch, parches, colores principales
  Nada que no se vea. [] si no hay nada que destacar.
- x (fallas): cada defecto visible con su foto, como "mancha chica en la manga (foto 4)": manchas, hoyos, bolitas, decoloración, estampado agrietado, costuras abiertas, cierre roto. Revisa de cerca TODAS las fotos. [] si no hay.
- md (medidas): si en alguna foto hay cinta métrica o regla, mide en cm (ej. "Largo 72 cm · Axila a axila 56 cm" o "Cintura 40 cm · Largo 104 cm"). "" si no hay cinta.
- h: 6–10 hashtags específicos (marca, modelo, artista, estilo, época). Sin #reynosa ni #bazar.
- p (precio MXN, bazar local): común $120–350, marca conocida $250–700, vintage buscado/hype/merch $400–2,500; ajusta por estado. r = rango [mín, máx].
${precios ? `- Precios de este bazar (referencia principal):\n${precios}\n` : ''}- f: índice (desde 0) de la foto con la prenda completa de frente.
- conf: 0 a 1 qué tan seguro estás de marca (m), talla (t) y precio (p).
- rz (rareza 1–5, NO la infles; casi todo es 1 o 2): 1 común, 2 buscada, 3 rara, 4 muy rara, 5 grial. Señales: etiqueta vieja (single stitch, Made in USA, Screen Stars, Hanes 50/50, Big E, tag de los 80/90), gira o merch original, colab, edición limitada, deadstock, marca de culto. rs: lista corta de esas señales que SÍ ves.
- Si no es ropa/accesorio vendible: "ok":false.
${mem ? `\n${mem}\n` : ''}${buscar ? '\nPuedes buscar en internet (máx. 2 búsquedas) cuánto se vende usada (eBay, Grailed, Mercado Libre, Vinted, Depop). ~18 MXN por USD; en un bazar local se vende más barato.\n' : ''}
Responde SOLO JSON compacto, sin texto extra:
{"ok":true,"n":"","m":"","c":"","cn":"","t":"","e":"","d":"","dt":[],"x":[],"md":"","h":"#a #b","p":0,"r":[0,0],"why":"razón del precio, ≤20 palabras","f":0,"conf":{"m":0,"t":0,"p":0},"rz":1,"rs":[]}`;
}

// ── Tiempos (Vercel corta la función a los 60 s) ────────────
//   IA_TIEMPO_MS: tope por llamada · IA_ESPERA_MS: base de la espera entre
//   reintentos · IA_PRESUPUESTO_MS: tiempo total para una prenda.
const numEnv = (k, def) => { const n = Number(process.env[k]); return n > 0 ? n : def; };
const PRESUPUESTO = () => numEnv('IA_PRESUPUESTO_MS', 50000);
const ESPERA = () => numEnv('IA_ESPERA_MS', 800);
const esperar = ms => new Promise(r => setTimeout(r, ms));

// Un error de la IA ya clasificado: qué decirle a la dueña y qué hacer después.
//   tipo: red | saturada | tiempo | formato | cortado | imagen | modelo | saldo | clave | pedido
class ErrorIA extends Error {
  constructor(tipo, mensaje, extra = {}) { super(mensaje); this.tipo = tipo; Object.assign(this, extra); }
  get fatal() { return this.tipo === 'saldo' || this.tipo === 'clave'; }
}
const MENSAJES = {
  saturada: 'La IA está muy ocupada en este momento. Se vuelve a intentar sola en unos segundos.',
  red: 'No hubo conexión con la IA. Se vuelve a intentar sola en unos segundos.',
  tiempo: 'La IA tardó demasiado en contestar. Se vuelve a intentar sola en unos segundos.',
  formato: 'La IA no pudo leer bien esta prenda. Se vuelve a intentar sola; si sigue, prueba con una foto de frente más clara.',
  imagen: 'La IA no pudo abrir las fotos de esta prenda. Revisa que sean JPG o PNG y vuelve a intentar.',
};
function clasificar(status, msg, tipoApi) {
  const m = String(msg || '');
  if (status === 401 || status === 403) return new ErrorIA('clave', 'La clave ANTHROPIC_API_KEY no es válida.', { status });
  if (/credit|billing|balance|saldo/i.test(m)) return new ErrorIA('saldo', 'Tu cuenta de Anthropic no tiene saldo. Recarga en console.anthropic.com → Billing.', { status });
  if (status === 429 || tipoApi === 'rate_limit_error') return new ErrorIA('saturada', MENSAJES.saturada, { status });
  if (status === 529 || status >= 500 || tipoApi === 'overloaded_error' || tipoApi === 'api_error') return new ErrorIA('saturada', MENSAJES.saturada, { status });
  if (status === 404 || tipoApi === 'not_found_error' || /model/i.test(m) && status === 400) return new ErrorIA('modelo', `IA: ${m || 'modelo no encontrado'}`, { status });
  if (status === 413 || /image|imagen|download|url|media|fetch/i.test(m)) return new ErrorIA('imagen', MENSAJES.imagen, { status });
  return new ErrorIA('pedido', `IA: ${m || 'HTTP ' + status}`, { status });
}

// ── Leer el JSON aunque venga con texto, en ```json, cortado o con comas de más ──
const CLAVES_PRENDA = ['ok', 'n', 'm', 'c', 't', 'e', 'd', 'p', 'h'];
function cierre(s, i) {
  let prof = 0, enTexto = false, esc = false;
  for (let k = i; k < s.length; k++) {
    const ch = s[k];
    if (enTexto) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') enTexto = false; continue; }
    if (ch === '"') enTexto = true;
    else if (ch === '{') prof++;
    else if (ch === '}' && --prof === 0) return k;
  }
  return -1;
}
// Cierra comillas, llaves y corchetes que quedaron abiertos y quita comas de más
function reparar(t) {
  let s = String(t).replace(/[“”]/g, '"').replace(/,\s*,+/g, ',').replace(/,\s*([}\]])/g, '$1');
  const pila = []; let enTexto = false, esc = false;
  for (const ch of s) {
    if (enTexto) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') enTexto = false; continue; }
    if (ch === '"') enTexto = true; else if (ch === '{' || ch === '[') pila.push(ch); else if (ch === '}' || ch === ']') pila.pop();
  }
  if (enTexto) s += '"';
  s = s.replace(/\\$/, '')
    .replace(/,?\s*"[^"]*"\s*:\s*$/, '')          // clave sin valor
    .replace(/,\s*"[^"]*"\s*$/, m => (pila.at(-1) === '{' ? '' : m))   // clave suelta
    .replace(/[,:]\s*$/, '');
  while (pila.length) s += pila.pop() === '{' ? '}' : ']';
  return s.replace(/,\s*([}\]])/g, '$1');
}
const intentar = t => { try { return JSON.parse(t); } catch { return undefined; } };
export function leerJSON(texto) {
  const s = String(texto || '').replace(/```(?:json)?/gi, ' ');
  let mejor = null;
  for (let i = s.indexOf('{'); i >= 0 && i < s.length; i = s.indexOf('{', i + 1)) {
    const fin = cierre(s, i);
    const trozo = fin > 0 ? s.slice(i, fin + 1) : s.slice(i);
    let obj = intentar(trozo), cortado = false;
    if (obj === undefined) { obj = intentar(reparar(trozo)); cortado = fin < 0; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    const puntos = CLAVES_PRENDA.filter(k => k in obj).length;
    if (!mejor || puntos > mejor.puntos) mejor = { obj, puntos, cortado };
    if (puntos >= 6 && !cortado) break;
  }
  return mejor && mejor.puntos ? mejor : null;
}

// Las fotos se mandan como link; si la IA no las puede bajar, el servidor las
// baja él mismo y se las manda dentro del mensaje (se salta las que no abren).
async function fotosDirectas(urls) {
  const una = async u => {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 9000);
    try {
      const r = await fetch(u, { signal: ctrl.signal });
      if (!r.ok) return null;
      const tipo = String(r.headers?.get?.('content-type') || '').split(';')[0];
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length || buf.length > 4.5e6) return null;
      return { type: 'base64', media_type: /^image\/(jpeg|png|gif|webp)$/.test(tipo) ? tipo : 'image/jpeg', data: buf.toString('base64') };
    } catch { return null; } finally { clearTimeout(t); }
  };
  return (await Promise.all(urls.map(una))).filter(Boolean);
}

async function llamarClaude({ modelo, system, fuentes, pista, buscar, maxTokens, limiteMs }) {
  const cuerpo = {
    model: modelo,
    max_tokens: maxTokens || (buscar ? 1400 : 900),
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [
      ...fuentes.map(source => ({ type: 'image', source })),
      { type: 'text', text: pista ? `Analiza esta prenda. Datos que ya tengo (pueden estar incompletos o mal): ${pista}` : 'Analiza esta prenda.' },
    ] }],
  };
  if (buscar) cuerpo.tools = [{
    type: 'web_search_20250305', name: 'web_search', max_uses: 2,
    user_location: { type: 'approximate', city: 'Reynosa', region: 'Tamaulipas', country: 'MX', timezone: 'America/Matamoros' },
  }];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(500, limiteMs));
  let r, j;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(cuerpo),
    });
    j = await r.json().catch(() => null);
  } catch (e) {
    if (e?.name === 'AbortError' || ctrl.signal.aborted) throw new ErrorIA('tiempo', MENSAJES.tiempo);
    throw new ErrorIA('red', MENSAJES.red);
  } finally { clearTimeout(t); }
  if (!r.ok || !j) {
    const e = clasificar(r.status, j?.error?.message, j?.error?.type);
    if (!j && r.ok) throw new ErrorIA('saturada', MENSAJES.saturada);
    const ra = Number(r.headers?.get?.('retry-after'));
    if (ra >= 0 && !Number.isNaN(ra)) e.retryAfter = ra * 1000;
    throw e;
  }
  // Con la búsqueda en internet el texto llega partido en bloques (citas): se une sin separar
  const texto = (j.content || []).filter(b => b.type === 'text').map(b => b.text || '').join('');
  const leido = leerJSON(texto);
  const llamada = { uso: j.usage || {}, modelo };
  if (!leido) throw new ErrorIA('formato', MENSAJES.formato, { llamada, cortado: j.stop_reason === 'max_tokens' });
  const cortado = leido.cortado || j.stop_reason === 'max_tokens';
  return { d: leido.obj, cortado, ...llamada };
}

// ── Acomodar lo que dice la IA a las listas de la tienda ────
const numero = x => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : 0;
  const m = String(x ?? '').replace(/(\d),(\d{3})\b/g, '$1$2').match(/-?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(',', '.')) : 0;
};
const c01 = x => { let n = numero(x); if (n > 1 && n <= 100) n /= 100; return Math.max(0, Math.min(1, n || 0)); };
const texto = (x, max) => (Array.isArray(x) ? x.join(' ') : x == null || typeof x === 'object' ? '' : String(x)).replace(/\s+/g, ' ').trim().slice(0, max);
const cercano = (n, opciones) => opciones.reduce((a, o) => (a == null || Math.abs(Number(o) - n) < Math.abs(Number(a) - n) ? o : a), null);

export function elegirTalla(v, tallas = [], categoria = '') {
  const crudo = texto(v, 40);
  if (!crudo) return '';
  if (!tallas.length) return crudo.slice(0, 30);
  const n = norm(crudo);
  const exacta = tallas.find(o => norm(o) === n);
  if (exacta) return exacta;
  const hay = x => tallas.find(o => norm(o) === norm(x)) || '';
  if (/one ?size|unitalla|talla unica|\bos\b|osfa|\bunica\b|\bu\b/.test(n)) return hay('Unitalla') || hay('Talla única') || crudo;
  if (/ajustable|adjustable|snapback|strapback/.test(n)) return hay('Ajustable') || hay('Unitalla') || crudo;
  const cat = norm(categoria);
  const nums = tallas.filter(o => /^\d+(\.5)?$/.test(o));
  const num = numero(n);
  // Calzado (MX). US hombre ≈ MX − 18 · EUR ≈ MX + 15
  if (/tenis|calzado|zapat|sneaker|bota|shoe|sandal/.test(cat) || /\b(us|eur|eu|cm|mx)\b/.test(n) && num) {
    let mx = num;
    if (/\bus\b/.test(n)) mx = num + 18; else if (/\beur?\b/.test(n) || num >= 35) mx = num - 15;
    const op = nums.filter(o => Number(o) >= 20 && Number(o) <= 32);
    if (mx >= 18 && mx <= 34 && op.length) return cercano(mx, op);
  }
  // Pantalón (cintura en pulgadas): "W32 L30", "32x30", "32/30"
  if (/pantal|jean|cargo|short|bermuda|falda|jogger/.test(cat) || /\bw\s?\d{2}\b|\b\d{2}\s?[x\/]\s?\d{2}\b/.test(n)) {
    const w = Number((n.match(/\bw\s?(\d{2})\b/) || n.match(/\b(\d{2})\s?[x\/]\s?\d{2}\b/) || n.match(/\b(\d{2})\b/) || [])[1]);
    const op = nums.filter(o => Number(o) >= 24 && Number(o) <= 44 && !o.includes('.'));
    if (w >= 22 && w <= 48 && op.length) return cercano(w, op.sort((a, b) => a - b));
  }
  // Letras (con o sin "mujer")
  const mujer = /mujer|dama|women|woman|female|ladies|\bwmns\b/.test(n);
  const tokens = n.split(/[^a-z0-9]+/).filter(Boolean);
  const LETRAS = [['XXXL', ['xxxl', '3xl', 'xxxlarge']], ['XXL', ['xxl', '2xl', 'xxlarge']], ['XL', ['xl', 'xlarge', 'extragrande', 'eg']],
    ['XS', ['xs', 'xsmall', 'extrachica']], ['S', ['s', 'small', 'chica', 'ch', 'sm']], ['M', ['m', 'medium', 'mediana', 'med', 'md']], ['L', ['l', 'large', 'grande', 'g', 'lg']]];
  const junto = n.replace(/[^a-z0-9]+/g, '');
  const letra = LETRAS.find(([, alias]) => alias.some(a => tokens.includes(a)))?.[0] || LETRAS.find(([, alias]) => alias.some(a => a.length > 2 && junto.includes(a)))?.[0];
  if (letra) return hay(`${letra} ${mujer ? 'Mujer' : 'Hombre'}`) || hay(`${letra} Hombre`) || hay(letra) || crudo.slice(0, 30);
  return crudo.slice(0, 30);
}

export function elegirEstado(v, estados = []) {
  const crudo = texto(v, 40);
  if (!crudo) return '';
  if (!estados.length) return crudo.slice(0, 30);
  const n = norm(crudo);
  const exacta = estados.find(o => norm(o) === n);
  if (exacta) return exacta;
  const hay = x => estados.find(o => norm(o) === norm(x)) || '';
  if (/etiqueta|\bnwt\b|with tags|\btags\b|deadstock|\bds\b/.test(n)) return hay('Nueva con etiqueta') || hay('Nueva');
  const m = n.match(/(\d+(?:[.,]\d+)?)\s*\/\s*10/);
  if (m) { const k = Math.min(10, Math.floor(Number(m[1].replace(',', '.')))); return hay(`${k}/10`) || (k < 5 ? hay('Con mucho desgaste') : ''); }
  if (/como nuev|like new|impecable|perfect/.test(n)) return hay('10/10');
  if (/^nuev|\bnew\b|sin usar/.test(n)) return hay('Nueva');
  if (/excelente|excellent/.test(n)) return hay('9/10');
  if (/muy buen|very good|great/.test(n)) return hay('8/10');
  if (/desgast|worn|mal estado|poor|danad|rot[ao]/.test(n)) return hay('Con mucho desgaste');
  if (/buen|good/.test(n)) return hay('7/10');
  if (/regular|fair|usad|used/.test(n)) return hay('6/10');
  return '';
}

const SINONIMOS = [
  [/sudader|hoodie|hoody|crewneck|crew neck|sweatshirt|sweater|sueter|sweter|buzo|capucha/, ['sudader', 'sueter', 'hoodie', 'crewneck']],
  [/jersey|camiseta de futbol|\bnba\b|\bnfl\b|\bmlb\b/, ['jersey']],
  [/playera|camiseta|t[ -]?shirt|\btee\b|remera|tank|musculosa/, ['playera', 'camiseta', 'tee']],
  [/camisa|button|polo|flannel|franela/, ['camisa', 'polo']],
  [/short|bermuda/, ['short', 'bermuda']],
  [/jean|pantal|cargo|jogger|\bpants\b|trouser|mezclilla|denim/, ['pantal', 'jean']],
  [/tenis|sneaker|zapat|calzado|shoe|jordan|\bdunk|bota|boot|sandalia/, ['tenis', 'calzado', 'zapat']],
  [/gorra|\bcap\b|\bhat\b|gorro|beanie|snapback|trucker|sombrero/, ['gorra', 'gorro', 'sombrero']],
  [/chamarra|jacket|chaqueta|abrigo|\bcoat\b|rompevient|windbreaker|chaleco|\bvest\b|puffer|bomber|parka/, ['chamarr', 'chaquet', 'abrigo']],
  [/vestido|dress/, ['vestido']],
  [/falda|skirt/, ['falda']],
  [/accesori|cintur|belt|lentes|bolsa|\bbag\b|mochila|cartera|wallet|calcet|sock|bufanda|reloj|collar|pulsera|llavero/, ['accesori']],
];
export function elegirCategoria(v, nombre = '', categorias = []) {
  const crudo = texto(v, 40);
  if (!categorias.length) return crudo;
  const n = norm(crudo);
  if (n) {
    const directa = categorias.find(o => norm(o) === n) || (n.length >= 4 && categorias.find(o => norm(o).startsWith(n) || n.startsWith(norm(o))));
    if (directa) return directa;
  }
  // Si la IA dijo un tipo concreto (p. ej. "Jersey") y no tienes esa categoría, no se adivina por el
  // nombre: queda vacía para proponer la categoría nueva. El nombre solo ayuda si dijo algo vago ("Ropa").
  let reconocida = false;
  for (const t of [n, norm(nombre)]) {
    if (!t || (reconocida && t !== n)) continue;
    for (const [re, raices] of SINONIMOS) {
      if (!re.test(t)) continue;
      if (t === n) reconocida = true;
      const c = categorias.find(o => raices.some(r => norm(o).includes(r)));
      if (c) return c;
    }
    const raiz = categorias.find(o => { const r = norm(o).replace(/(es|s)$/, ''); return r.length >= 4 && t.includes(r); });
    if (raiz) return raiz;
  }
  return '';
}
// Nombre limpio para una marca o categoría nueva (sin etiquetas ni basura; nada genérico)
const GENERICAS = /^(ropa|prenda|prendas|otro|otros|otra|otras|varios|varias|general|n\/?a|ninguna?|sin categoria|desconocid[ao]s?|unknown|other|clothing|item)$/i;
export function nombreCatalogo(v, esCategoria = false) {
  let n = String(v ?? '').replace(/[<>{}\[\]"`\\]/g, '').replace(/[\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (n.length < 2 || !/\p{L}/u.test(n) || GENERICAS.test(norm(n))) return '';
  if (esCategoria) n = n.charAt(0).toUpperCase() + n.slice(1);
  return n;
}
const singular = c => { const n = String(c || ''); if (/pantalones$/i.test(n)) return n.replace(/ones$/i, 'ón'); if (/(is|us)$/i.test(n)) return n; return n.replace(/(?<=[^aeiou])es$/i, '').replace(/s$/i, ''); };

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
  if (extra.agente) $inc.usdAgente = $inc.usd;
  try { await db.collection('iaUso').updateOne({ bazarId: bazarId || 0, dia: hoy() }, { $inc }, { upsert: true }); } catch {}
  await sumarGasto(db, $inc.usd);       // v46: descuenta del saldo de la IA
}

const dudosa = d => d.ok === false || d.ok === 'false' || c01(d.conf?.m) < 0.55 || c01(d.conf?.p) < 0.45;
const completa = d => !!(texto(d.n, 80) && numero(d.p) > 0 && d.c);

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
    // v46: saldo (solo administradores) y cuánto cuesta en promedio cada cosa (últimos 30 días)
    let saldo = null, promedio = null, tc = null;
    if (user.role === 'admin') {
      saldo = await estadoSaldo(db).catch(() => null);
      const desde = new Date(Date.now() - 30 * 864e5 - 6 * 3600e3).toISOString().slice(0, 10);
      const ult = (await db.collection('iaUso').find({}).toArray()).filter(f => String(f.dia) >= desde);
      const t = ult.reduce((a, f) => ({ usd: a.usd + (f.usd || 0), ag: a.ag + (f.usdAgente || 0), nAg: a.nAg + (f.agente || 0), n: a.n + (f.prendas || 0) }), { usd: 0, ag: 0, nAg: 0, n: 0 });
      promedio = { prenda: t.n >= 5 ? Math.round((t.usd - t.ag) / t.n * 10000) / 10000 : 0.003, investigacion: t.nAg >= 3 ? Math.round(t.ag / t.nAg * 10000) / 10000 : 0.1 };
      tc = await import('./crecer.js').then(m => m.tipoDeCambio(db)).then(x => x?.mxnPorUsd || null).catch(() => null);
    }
    return res.status(200).json({
      activa: !!process.env.ANTHROPIC_API_KEY, modelo: GRANDE(), rapido: RAPIDO(),
      hoy: suma(filas.filter(f => f.dia === hoy())), mes: suma(filas.filter(f => String(f.dia).startsWith(mes))), aprendidas,
      saldo, promedio, tc, puedeSaldo: user.role === 'admin', exacto: !!process.env.ANTHROPIC_ADMIN_KEY,
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });

  if (op === 'ia-aprender') {
    if (!(await rateLimit(req, res, { key: 'ia-aprender-' + user.username, max: 120, windowSec: 3600 }))) return;
    const casos = (Array.isArray(req.body?.casos) ? req.body.casos : []).filter(c => c && typeof c === 'object').slice(0, 100);
    const bazarId = bazarDe(req.body);
    const limpio = o => ({
      nombre: texto(o?.nombre, 80), marca: texto(o?.marca, 40),
      categoria: texto(o?.categoria, 40), talla: texto(o?.talla, 30),
      estado: texto(o?.estado, 30), precio: Math.max(0, Math.min(100000, Math.round(numero(o?.precio)))),
    });
    for (const c of casos) await db.collection('iaAprendizaje').insertOne({ bazarId, en: new Date().toISOString(), ia: limpio(c.ia), final: limpio(c.final) });
    return res.status(200).json({ ok: true, guardados: casos.length });
  }

  if (op === 'ia-texto') return iaTexto(req, res, db, user, bazarDe(req.body));
  if (op === 'ia-saldo') return ponerSaldo(req, res, db, user);
  // v45: el agente que investiga a fondo y crea marcas/categorías nuevas
  if (op === 'ia-agente' || op === 'ia-catalogo') {
    const { iaAgente, iaCatalogo } = await import('./agente.js');
    return op === 'ia-agente' ? iaAgente(req, res, db, user, bazarDe(req.body)) : iaCatalogo(req, res, db, user);
  }
  // v50: separar un lote de fotos en prendas (sin tener que hacer una carpeta por prenda)
  if (op === 'ia-agrupar') {
    const { iaAgrupar } = await import('./agrupar.js');
    return iaAgrupar(req, res, db, user, bazarDe(req.body));
  }
  if (op !== 'ia-prenda') return res.status(400).json({ error: 'op no reconocida' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Falta configurar la IA: agrega ANTHROPIC_API_KEY en Vercel y vuelve a desplegar.' });
  if (!(await rateLimit(req, res, { key: 'ia-prenda-' + user.username, max: 600, windowSec: 3600 }))) return;

  const inicio = Date.now();
  const restante = () => PRESUPUESTO() - (Date.now() - inicio);
  const b = req.body || {};
  const todas = lista(b.imagenes, 10, 600).filter(u => URL_CLOUD.test(u));
  if (!todas.length) return res.status(400).json({ error: 'Faltan las fotos (deben estar subidas).' });
  const imagenes = todas.slice(0, MAX_FOTOS_IA);
  const ligeraN = u => ligera(u, imagenes.length);
  const bazarId = bazarDe(b);
  const calidad = ['ahorro', 'auto', 'maxima'].includes(b.calidad) ? b.calidad : 'auto';
  const pista = texto(b.pista, 300);

  // ¿Ya analizamos exactamente estas fotos? → gratis
  const huellas = lista(b.huellas, 10, 80);
  const base = (huellas.length === todas.length ? huellas : todas).slice().sort().join('|');
  const claveDe = cal => createHash('sha256').update(`${base}|${pista}|${cal}|${!!b.buscar}|v49`).digest('hex');
  const clave = claveDe(calidad);
  const cache = db.collection('iaCache');
  const gratis = async previo => {
    await anotarUso(db, bazarId, [], { cacheGratis: 1, prendas: 1 });
    return res.status(200).json({ ...previo.resultado, desdeMemoria: true, costoUSD: 0 });
  };
  if (!b.forzar) {
    // Lo que ya analizó el modelo preciso sirve también para "Automático" y "Ahorro"
    const previo = await cache.findOne({ clave }).catch(() => null) || (calidad !== 'maxima' ? await cache.findOne({ clave: claveDe('maxima') }).catch(() => null) : null);
    if (previo) return gratis(previo);
  }
  const igual = await esperarOtroIgual(db, cache, clave, restante);
  if (igual.hecho) return gratis(igual.hecho);
  try {

  const categorias = lista(b.categorias), tallas = lista(b.tallas, 120), estados = lista(b.estados, 20), marcas = lista(b.marcas, 150, 40);
  const [h, mem] = await Promise.all([
    historialPrecios(db, bazarId).catch(() => ({ porCat: new Map(), porMarca: new Map(), diasMarca: new Map(), diasCat: new Map() })),
    memoria(db, bazarId).catch(() => ({ casos: 0, marcas: new Map(), ajuste: new Map(), nombres: [], estados: new Map() })),
  ]);
  const sys = buscar => sistema({ categorias, tallas, estados, marcas, precios: contextoPrecios(h), mem: textoMemoria(mem), buscar });
  const ctx = { fuentes: imagenes.map(u => ({ type: 'url', url: ligeraN(u) })), directas: false };
  const llamadas = [];

  // Un modelo, con reintentos: espera un poco si está saturada o se cayó la red,
  // baja las fotos él mismo si la IA no pudo, quita la búsqueda si estorba y
  // pide más espacio si la respuesta se cortó. Nunca se pasa del tiempo de Vercel.
  const conReintentos = async (modelo, buscar) => {
    const minimo = Math.min(6000, PRESUPUESTO() * 0.12);
    let ultimo = null, formatos = 0, maxTokens = 0;
    for (let intento = 0; intento < 3; intento++) {
      if (restante() < minimo) break;
      const tope = (buscar ? 42000 : /haiku/.test(modelo) ? 22000 : 32000);
      const limiteMs = Math.min(numEnv('IA_TIEMPO_MS', tope), tope, restante() - 800);
      try {
        const r = await llamarClaude({ modelo, system: sys(buscar), fuentes: ctx.fuentes, pista, buscar, maxTokens, limiteMs });
        llamadas.push(r);
        // Cortada y le falta lo importante: una vez más con más espacio
        if (r.cortado && !completa(r.d) && intento < 2 && restante() > minimo * 2) { ultimo = r; maxTokens = buscar ? 2200 : 1600; continue; }
        return r.d;
      } catch (e) {
        if (!(e instanceof ErrorIA)) throw e;
        if (e.llamada) llamadas.push(e.llamada);
        ultimo = e;
        if (e.fatal || e.tipo === 'modelo' || e.tipo === 'pedido') throw e;
        if (e.tipo === 'imagen') {
          if (!ctx.directas) {
            ctx.directas = true;
            const directas = await fotosDirectas(imagenes.map(ligeraN));
            if (!directas.length) throw new ErrorIA('imagen', MENSAJES.imagen);
            ctx.fuentes = directas; intento--; continue;
          }
          if (ctx.fuentes.length > 1) { ctx.fuentes = ctx.fuentes.slice(0, 1); continue; }
        }
        if (buscar) { buscar = false; continue; }                       // sin búsqueda en internet
        if (e.tipo === 'formato' && ++formatos >= 2) break;               // que lo intente el otro modelo
        if (e.cortado) maxTokens = 1600;
        if (intento < 2) await esperar(Math.min(e.retryAfter ?? Infinity, 5000, ESPERA() * (intento ? 2.5 : 1)) || ESPERA());
      }
    }
    if (ultimo && !(ultimo instanceof Error) && ultimo.d) return ultimo.d;   // cortada, pero algo sirve
    throw ultimo instanceof ErrorIA ? ultimo : new ErrorIA('tiempo', MENSAJES.tiempo);
  };
  // Si un modelo no puede (saturado, mal escrito en Vercel, no entiende), lo intenta el otro
  const conRespaldo = async (primero, segundo, buscar) => {
    try { return { d: await conReintentos(primero, buscar), modelo: primero }; }
    catch (e) {
      if (e.fatal || segundo === primero || restante() < PRESUPUESTO() * 0.15) throw e;
      try { return { d: await conReintentos(segundo, false), modelo: segundo }; }
      catch (e2) { throw e2.fatal ? e2 : e; }
    }
  };

  let d, escalada = false, modeloUsado;
  try {
    if (calidad === 'maxima') ({ d, modelo: modeloUsado } = await conRespaldo(GRANDE(), RAPIDO(), !!b.buscar));
    else {
      ({ d, modelo: modeloUsado } = await conRespaldo(RAPIDO(), GRANDE(), calidad === 'ahorro' && !!b.buscar));
      // "auto": el grande solo si el rápido duda, o si pediste buscar precios (y hay tiempo).
      // v47: si es pieza rara y el agente la va a investigar a fondo, no se paga el grande dos veces.
      const laInvestigaraElAgente = b.investigarRaras === true && numero(d.rz) >= 3 && d.ok !== false;
      if (calidad === 'auto' && !laInvestigaraElAgente && modeloUsado !== GRANDE() && (dudosa(d) || !completa(d) || b.buscar) && restante() > PRESUPUESTO() * 0.35) {
        try { d = await conReintentos(GRANDE(), !!b.buscar); escalada = true; modeloUsado = GRANDE(); }
        catch (e) { if (e.fatal) throw e; }
      }
    }
  } catch (e) {
    await anotarUso(db, bazarId, llamadas, { prendas: 0, fallas: 1 });
    if (e.tipo === 'saldo') await marcarSinSaldo(db);
    const reintentable = !e.fatal && e.tipo !== 'pedido';
    const status = e.tipo === 'clave' ? 503 : e.tipo === 'saldo' ? 402 : e.tipo === 'imagen' ? 422 : reintentable ? (e.tipo === 'formato' ? 502 : 503) : 502;
    const msg = e instanceof ErrorIA ? e.message : 'La IA no pudo analizar esta prenda. Se vuelve a intentar sola en unos segundos.';
    return res.status(status).json({ error: msg, reintentable, tipo: e.tipo || 'otro' });
  }
  await anotarUso(db, bazarId, llamadas);

  // ── Acomodar a las listas del sistema ──
  const nombreIA = texto(d.n, 80);
  const categoria = elegirCategoria(d.c, nombreIA, categorias);
  // v47: no inventar. Marca o talla con poca seguridad se dejan vacías para que las revises
  const sinConfirmar = [];
  let marcaTxt = texto(d.m, 40);
  let marcaDudosa = '';
  if (marcaTxt && d.conf && c01(d.conf.m) < 0.4) { sinConfirmar.push('marca'); marcaDudosa = marcaTxt; marcaTxt = ''; }
  const marca = (marcas.find(m => norm(m) === norm(marcaTxt)) || marcaTxt).slice(0, 40);
  let tallaTxt = d.t;
  if (texto(tallaTxt, 30) && d.conf && c01(d.conf.t) < 0.35) { sinConfirmar.push('talla'); tallaTxt = ''; }
  let precio = numero(d.p);
  if (!(precio > 0 && precio <= 30000)) precio = 0;
  const precioIA = precio;
  const refMarca = marca ? mediana(h.porMarca.get(norm(marca)) || []) : null;
  const refCat = categoria ? mediana(h.porCat.get(categoria) || []) : null;
  const ref = refMarca || refCat;
  if (precio && ref) precio = precio * 0.7 + ref * 0.3;
  else if (!precio && ref) precio = ref;
  const aj = mem.ajuste.get(categoria) || mem.ajuste.get('*');     // cómo sueles corregir el precio
  if (precio && aj) precio *= aj;
  // Rapidez: si esa marca/categoría se vende en ≤4 días (con ≥3 ventas), sube 10%; si tarda >30, baja 5%
  const dias = (marca && h.diasMarca.get(norm(marca))?.length >= 3 ? h.diasMarca.get(norm(marca)) : null) || (categoria && h.diasCat.get(categoria)?.length >= 3 ? h.diasCat.get(categoria) : null);
  const medDias = dias ? mediana(dias.map(x => x + 0.01)) : null;
  let notaRapidez = '';
  if (precio && medDias != null) {
    if (medDias <= 4) { precio *= 1.10; notaRapidez = ` · +10%: ${marca || categoria} se vende en ~${Math.max(1, Math.round(medDias))} días.`; }
    else if (medDias > 30) { precio *= 0.95; notaRapidez = ` · −5%: ${marca || categoria} tarda ~${Math.round(medDias)} días en venderse.`; }
  }
  // Nunca sin precio: la mediana de todo tu inventario o un precio de bazar normal
  let notaPrecio = '';
  if (!precio) {
    const todos = mediana([...h.porCat.values()].flat());
    precio = todos || 250;
    notaPrecio = todos ? 'Precio de referencia: la mediana de tu inventario; ajústalo.' : 'Precio de referencia; ajústalo.';
  }
  precio = Math.min(30000, precio);
  // Nunca sin nombre: tipo + marca
  // Si la marca no era segura, tampoco va en el nombre
  const sinMarcaDudosa = t => marcaDudosa ? t.replace(new RegExp('\\s*' + marcaDudosa.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), '').replace(/\s{2,}/g, ' ').trim() : t;
  const nombreLimpio = sinMarcaDudosa(nombreIA);
  const nombre = /\p{L}/u.test(nombreLimpio) ? nombreLimpio : [singular(categoria) || texto(d.c, 30) || 'Prenda', marca].filter(Boolean).join(' ').slice(0, 80);
  const rango = (Array.isArray(d.r) ? d.r : String(d.r ?? '').split(/[-–a]/)).map(numero).filter(n => n > 0 && n <= 30000).slice(0, 2);
  const tags = [...new Set((Array.isArray(d.h) ? d.h.join(' ') : texto(d.h, 600)).split(/[\s,]+/)
    .map(x => x.replace(/[^#\p{L}\p{N}_]/gu, '').replace(/^#*/, '')).filter(x => x && !/^hashtags?$/i.test(x)).map(x => '#' + x))].slice(0, 12).join(' ');
  // v49: fallas con la foto donde se ven ("(foto 4)" o {t, f}) y detalles visibles
  const { fallas, fallasFoto } = leerFallas(d.x, imagenes);
  const detalles = leerDetalles(d.dt, fallas);
  const medidas = texto(d.md, 120);
  const confianza = { marca: c01(d.conf?.m), talla: c01(d.conf?.t), precio: c01(d.conf?.p) };
  const llenoIA = !!(/\p{L}/u.test(nombreIA) && precioIA > 0 && categoria);

  const resultado = {
    esPrenda: d.ok !== false && d.ok !== 'false',
    nombre, marca, categoria,
    talla: elegirTalla(tallaTxt, tallas, categoria || texto(d.c, 30)),
    sinConfirmar,
    estado: elegirEstado(d.e, estados),
    descripcion: armarDescripcion(texto(d.d, 600), detalles, fallas, medidas),
    fallas, fallasFoto, detalles, medidas,
    hashtags: tags,
    precioSugerido: redondear(precio),
    rangoPrecio: rango.length === 2 ? rango.map(redondear) : null,
    razonPrecio: [texto(d.why, 200), notaPrecio].filter(Boolean).join(' · ') + (aj ? ` · Ajustado ${aj > 1 ? '+' : ''}${Math.round((aj - 1) * 100)}% por cómo sueles cobrar.` : '') + notaRapidez,
    diasVenta: medDias != null ? Math.round(medDias) : null,
    portada: Math.max(0, Math.min(imagenes.length - 1, Math.round(numero(d.f)) || 0)),
    confianza: precioIA > 0 ? confianza : { ...confianza, precio: Math.min(confianza.precio, 0.3) },
    historial: { marca: refMarca && Math.round(refMarca), categoria: refCat && Math.round(refCat) },
    incompleta: !llenoIA,
    rareza: Math.max(1, Math.min(5, Math.round(numero(d.rz)) || 1)),
    senalesRareza: (Array.isArray(d.rs) ? d.rs : typeof d.rs === 'string' ? d.rs.split(/[,;·]/) : []).map(x => texto(x, 60)).filter(Boolean).slice(0, 6),
    marcaNueva: !!marca && marcas.length > 0 && !marcas.some(m => norm(m) === norm(marca)),
    categoriaNueva: categoria ? '' : nombreCatalogo(texto(d.cn, 40) || texto(d.c, 40), true),
    modelo: modeloUsado, escalada,
    costoUSD: Math.round(llamadas.reduce((t, l) => t + costo(l), 0) * 10000) / 10000,
  };
  // Solo se recuerda lo que la IA llenó completo (lo incompleto se vuelve a preguntar)
  if (llenoIA) { try { await cache.updateOne({ clave }, { $set: { clave, resultado, en: new Date().toISOString() } }, { upsert: true }); } catch {} }
  return res.status(200).json(resultado);
  } finally { await soltarIgual(db, clave, igual.token); }
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
    const { leerConfigTienda } = await import('./crecer.js');
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

  // v44: un reintento si la IA está saturada o se cayó la red
  let ultimo = null;
  for (let intento = 0; intento < 2; intento++) {
    if (intento) await esperar(ESPERA() * 2);
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), numEnv('IA_TIEMPO_MS', 25000));
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: RAPIDO(), max_tokens: b.tipo === 'caption' ? 700 : 200,
          system: [{ type: 'text', text: ESTILO_TEXTO + (negocio ? `\n\nDatos reales del negocio (úsalos cuando pregunten, no inventes otros):\n${negocio}` : '') }], messages: [{ role: 'user', content: pedido }] }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) { ultimo = clasificar(r.status, j?.error?.message, j?.error?.type); if (ultimo.tipo === 'saturada') continue; break; }
      const salida = (j.content || []).filter(x => x.type === 'text').map(x => x.text).join('').trim().replace(/^["“]|["”]$/g, '');
      if (!salida) { ultimo = new ErrorIA('formato', 'La IA no escribió nada. Intenta de nuevo.'); continue; }
      const llamada = { uso: j.usage || {}, modelo: RAPIDO() };
      await anotarUso(db, bazarId, [llamada], { prendas: 0, textos: 1 });
      return res.status(200).json({ texto: salida.slice(0, b.tipo === 'caption' ? 2200 : 1000), costoUSD: Math.round(costo(llamada) * 100000) / 100000 });
    } catch (e) {
      ultimo = new ErrorIA(e?.name === 'AbortError' ? 'tiempo' : 'red', e?.name === 'AbortError' ? MENSAJES.tiempo : MENSAJES.red);
    } finally { clearTimeout(t); }
  }
  if (ultimo?.tipo === 'saldo') await marcarSinSaldo(db);
  const status = ultimo?.tipo === 'clave' ? 503 : ultimo?.tipo === 'saldo' ? 402 : 502;
  return res.status(status).json({ error: ultimo?.tipo === 'saldo' ? 'Tu cuenta de Anthropic no tiene saldo.' : ultimo?.message || 'La IA no contestó. Intenta de nuevo.', reintentable: !ultimo?.fatal });
}

// Lo comparten el agente investigador (agente.js) y el catálogo
export { esperarOtroIgual, soltarIgual, marcarSinSaldo, ErrorIA, clasificar, MENSAJES, fotosDirectas, numero, texto, c01, norm, mediana, singular, historialPrecios, GRANDE, RAPIDO, anotarUso, ligera, URL_CLOUD, lista, numEnv, esperar, ESPERA, redondear };
