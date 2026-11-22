// ─────────────────────────────────────────────────────────────
//  api/_lib/agrupar.js — Separar un lote de fotos en prendas con IA (v50)
//
//   POST /api/acciones?op=ia-agrupar  { imagenes: [urls de Cloudinary EN ORDEN] (2–48), desde: 1, calidad?, bazarId? }
//        → { prendas: [{ f: [números de foto], n: 'Playera Jordan negra', s: 0.9 }], x: [no son ropa], sin: [sin decidir] }
//
//  Para que la dueña no tenga que acomodar una carpeta por prenda: la IA ve las
//  fotos en el orden en que se tomaron (miniaturas de 320 px) y dice qué fotos
//  son de la misma prenda. El panel manda tramos de 40 fotos que se enciman 6
//  para que no se corte una prenda entre dos tramos, y junta el resultado.
//  Costo aproximado: ~1.5 centavos de dólar por cada 40 fotos con el modelo
//  preciso (~0.1 con el rápido en "Ahorro"). Lo mismo dos veces es gratis.
// ─────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { rateLimit } from './rateLimit.js';
import {
  ErrorIA, clasificar, MENSAJES, texto, c01, GRANDE, RAPIDO, anotarUso, URL_CLOUD, lista, numEnv, esperar, ESPERA,
  leerJSON, marcarSinSaldo, costo, esperarOtroIgual, soltarIgual,
} from './ia.js';

export const MAX_TRAMO = 48;
const miniatura = u => u.replace('/upload/', '/upload/c_limit,w_320,h_320,q_auto:eco,f_jpg/');

export function sistemaAgrupar() {
  return `Eres experto en ropa de segunda mano y ayudas a separar un lote de fotos en prendas para una tienda.
Las fotos van EN EL ORDEN en que se tomaron, cada una con su número ("Foto 12"). Normalmente se toman varias fotos seguidas de la MISMA prenda (frente, espalda, etiqueta, talla, detalles de cerca, defectos) y luego se pasa a la siguiente prenda.
Tu trabajo: decir qué fotos son de cada prenda.
Cómo decidir:
- Misma prenda = mismo color, tela, corte y estampado o bordado, aunque cambie el ángulo (frente/espalda), la luz, la distancia o si está doblada.
- Una foto de cerca (etiqueta de marca, talla, cuidado, cuello, puño, bordado, mancha, hoyo) es de la prenda cuyo color y tela coinciden; casi siempre la de antes o la de después.
- La espalda de una prenda puede verse muy distinta al frente (otro estampado): si el color, la tela y el corte coinciden y va seguida, es la misma prenda.
- Dos prendas parecidas seguidas (p. ej. dos playeras negras) son DISTINTAS si cambia el estampado, la etiqueta, el cuello, las mangas o el corte. El fondo, el gancho o la mesa son pista débil: muchas prendas se fotografían en el mismo lugar.
- Una prenda puede tener de 1 a 10 fotos.
- Si una foto no es de ropa ni accesorio (captura de pantalla, foto en negro o borrosa sin nada, una persona sin prenda a la venta, otra cosa), ponla en "x".
- No inventes: si de verdad dudas, júntala con la prenda de junto más parecida y baja "s".
Responde SOLO JSON, sin texto extra:
{"p":[{"f":[1,2,3],"n":"Playera Jordan negra","s":0.9}],"x":[]}
- "f": números de foto de esa prenda (los que ves, en orden).
- "n": nombre corto para reconocerla: tipo + marca si se lee + color (máx. 40 caracteres).
- "s": qué tan segura estás de que esas fotos son una sola prenda y de que no le falta ninguna (0 a 1).
Cada foto debe aparecer exactamente una vez, en "p" o en "x".`;
}

// Números de foto: 12, "12", "Foto 12", "12-14" (rango)
function numeros(v) {
  const out = [];
  for (const x of Array.isArray(v) ? v : [v]) {
    if (typeof x === 'number' && Number.isFinite(x)) { out.push(Math.round(x)); continue; }
    const s = String(x ?? '');
    const r = s.match(/(\d+)\s*[-–a]\s*(\d+)/);
    if (r) { const a = +r[1], b = +r[2]; if (b >= a && b - a <= 60) for (let k = a; k <= b; k++) out.push(k); continue; }
    const m = s.match(/\d+/); if (m) out.push(+m[0]);
  }
  return out;
}

// Lo que dijo la IA → prendas limpias dentro del rango [desde, desde + n − 1]
export function leerAgrupacion(d, desde, n) {
  const fin = desde + n - 1, dueño = new Map(), prendas = [];
  for (const it of (Array.isArray(d?.p) ? d.p : Array.isArray(d?.prendas) ? d.prendas : [])) {
    if (!it || typeof it !== 'object') continue;
    const f = [...new Set(numeros(it.f ?? it.fotos))].filter(k => k >= desde && k <= fin && !dueño.has(k)).sort((a, b) => a - b);
    if (!f.length) continue;
    const nombre = texto(it.n ?? it.nombre, 60).replace(/[<>{}\[\]"`\\]/g, '').slice(0, 40);
    const s = it.s == null ? 0.7 : c01(it.s);
    f.forEach(k => dueño.set(k, prendas.length));
    prendas.push({ f, n: nombre, s: Math.round(s * 100) / 100 });
  }
  const x = [...new Set(numeros(d?.x ?? []))].filter(k => k >= desde && k <= fin && !dueño.has(k)).sort((a, b) => a - b);
  x.forEach(k => dueño.set(k, -1));
  const sin = [];
  for (let k = desde; k <= fin; k++) if (!dueño.has(k)) sin.push(k);
  prendas.sort((a, b) => a.f[0] - b.f[0]);
  return { prendas, x, sin, cubiertas: n - sin.length };
}

async function llamar({ modelo, fuentes, desde, limiteMs, maxTokens }) {
  const content = [];
  fuentes.forEach((source, i) => { content.push({ type: 'text', text: `Foto ${desde + i}` }); content.push({ type: 'image', source }); });
  content.push({ type: 'text', text: `Son ${fuentes.length} fotos (de la ${desde} a la ${desde + fuentes.length - 1}). Sepáralas en prendas.` });
  const cuerpo = {
    model: modelo, max_tokens: maxTokens || 1800,
    system: [{ type: 'text', text: sistemaAgrupar(), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
  };
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
    if (!j && r.ok) throw new ErrorIA('saturada', MENSAJES.saturada);
    const e = clasificar(r.status, j?.error?.message, j?.error?.type);
    const ra = Number(r.headers?.get?.('retry-after'));
    if (ra >= 0 && !Number.isNaN(ra)) e.retryAfter = ra * 1000;
    throw e;
  }
  const llamada = { uso: j.usage || {}, modelo };
  const leido = leerJSON((j.content || []).filter(b => b.type === 'text').map(b => b.text || '').join(''));
  if (!leido) throw new ErrorIA('formato', MENSAJES.formato, { llamada, cortado: j.stop_reason === 'max_tokens' });
  return { d: leido.obj, cortado: leido.cortado || j.stop_reason === 'max_tokens', ...llamada };
}

export async function iaAgrupar(req, res, db, user, bazarId) {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Falta configurar la IA: agrega ANTHROPIC_API_KEY en Vercel y vuelve a desplegar.' });
  if (!(await rateLimit(req, res, { key: 'ia-agrupar-' + user.username, max: 300, windowSec: 3600 }))) return;
  const inicio = Date.now();
  const restante = () => numEnv('IA_PRESUPUESTO_MS', 50000) - (Date.now() - inicio);
  const b = req.body || {};
  const crudas = lista(b.imagenes, MAX_TRAMO + 1, 600);
  if (crudas.length > MAX_TRAMO) return res.status(400).json({ error: `Máximo ${MAX_TRAMO} fotos por tramo.` });
  const imagenes = crudas.filter(u => URL_CLOUD.test(u));
  if (imagenes.length !== crudas.length || imagenes.length < 2) return res.status(400).json({ error: 'Faltan las fotos (deben estar subidas).' });
  const desde = Math.max(1, Math.min(100000, Math.round(Number(b.desde) || 1)));
  const ahorro = b.calidad === 'ahorro';
  const n = imagenes.length;

  // Mismas fotos en el mismo orden → gratis
  const clave = 'agrupar|' + createHash('sha256').update(`${imagenes.join('|')}|${desde}|${ahorro ? 'r' : 'g'}|v50`).digest('hex');
  const cache = db.collection('iaCache');
  const gratis = async previo => {
    await anotarUso(db, bazarId, [], { prendas: 0, cacheGratis: 1 });
    return res.status(200).json({ ...previo.resultado, desdeMemoria: true, costoUSD: 0 });
  };
  if (!b.forzar) { const previo = await cache.findOne({ clave }).catch(() => null); if (previo) return gratis(previo); }
  const igual = await esperarOtroIgual(db, cache, clave, restante);
  if (igual.hecho) return gratis(igual.hecho);

  const llamadas = [];
  try {
    let fuentes = imagenes.map(u => ({ type: 'url', url: miniatura(u) }));
    // El modelo preciso separa mejor prendas parecidas; si no puede, el rápido (y al revés en "Ahorro")
    const modelos = ahorro ? [RAPIDO(), RAPIDO(), GRANDE()] : [GRANDE(), GRANDE(), RAPIDO()];
    let ultimo = null, resultado = null, maxTokens = 0;
    for (let i = 0; i < modelos.length && !resultado; i++) {
      if (restante() < 4000) break;
      try {
        const r = await llamar({ modelo: modelos[i], fuentes, desde, maxTokens, limiteMs: Math.min(numEnv('IA_TIEMPO_MS', 40000), 40000, restante() - 800) });
        llamadas.push(r);
        const a = leerAgrupacion(r.d, desde, n);
        // Si dejó sin decidir más de la mitad, no sirve (otra vez, con más espacio si se cortó)
        if (a.cubiertas < Math.ceil(n / 2)) { ultimo = new ErrorIA('formato', MENSAJES.formato); if (r.cortado) maxTokens = 3200; continue; }
        resultado = { ...a, modelo: r.modelo };
      } catch (e) {
        if (!(e instanceof ErrorIA)) throw e;
        if (e.llamada) llamadas.push(e.llamada);
        ultimo = e;
        if (e.fatal || e.tipo === 'pedido') throw e;
        if (e.cortado) maxTokens = 3200;
        if (e.tipo === 'imagen' && fuentes[0]?.url) {
          // Cloudinary no le pasó alguna foto a la IA: con las fotos originales en tamaño chico
          fuentes = imagenes.map(u => ({ type: 'url', url: u.replace('/upload/', '/upload/w_320,f_jpg/') }));
        }
        if (i < modelos.length - 1) await esperar(Math.min(e.retryAfter ?? Infinity, 5000, ESPERA() * (i ? 2.5 : 1)) || ESPERA());
      }
    }
    if (!resultado) throw ultimo instanceof ErrorIA ? ultimo : new ErrorIA('tiempo', MENSAJES.tiempo);
    const costoUSD = llamadas.reduce((t, l) => t + costo(l), 0);
    await anotarUso(db, bazarId, llamadas, { prendas: 0, agrupadas: n });
    const { cubiertas, ...publico } = resultado;
    await cache.updateOne({ clave }, { $set: { clave, resultado: publico, en: new Date().toISOString() } }, { upsert: true }).catch(() => {});
    return res.status(200).json({ ...publico, costoUSD: Math.round(costoUSD * 100000) / 100000 });
  } catch (e) {
    if (llamadas.length) await anotarUso(db, bazarId, llamadas, { prendas: 0, fallas: 1 }).catch(() => {});
    if (e instanceof ErrorIA) {
      if (e.tipo === 'saldo') await marcarSinSaldo(db).catch(() => {});
      const st = { saldo: 402, imagen: 422, formato: 502, pedido: 400 }[e.tipo] || 503;
      const msg = e.tipo === 'formato' ? 'La IA no pudo separar estas fotos. Se vuelve a intentar sola.'
        : e.tipo === 'imagen' ? 'La IA no pudo abrir algunas fotos de este tramo.' : e.message;
      return res.status(st).json({ error: msg, reintentable: !e.fatal && e.tipo !== 'pedido', tipo: e.tipo });
    }
    throw e;
  } finally { await soltarIgual(db, clave, igual.token).catch(() => {}); }
}
