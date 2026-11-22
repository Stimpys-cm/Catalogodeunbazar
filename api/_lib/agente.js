// ─────────────────────────────────────────────────────────────
//  api/_lib/agente.js — El agente que investiga cada prenda a fondo (v45)
//
//   POST /api/acciones?op=ia-agente    { imagenes, datos?, categorias, tallas, estados, marcas, bazarId, forzar? }
//        → informe tipo tasador: qué es, de qué época, qué tan rara es, si parece
//          auténtica, comparables reales con link y precio para México con su porqué.
//   POST /api/acciones?op=ia-catalogo  { tipo: 'marca'|'categoria', nombre, bazarId? }
//        → crea la marca o categoría si no existe (sin duplicar) y devuelve su nombre.
//
//  Cómo decide el precio (no se deja solo a la IA):
//   1. La IA busca en internet piezas iguales: primero VENDIDAS (eBay, Grailed,
//      Depop, Vinted), luego a la venta (también Mercado Libre México).
//   2. Solo cuentan los links que de verdad salieron en la búsqueda (verificados);
//      un comparable inventado no se muestra ni se usa para el precio (v47).
//   3. Mediana en dólares × tipo de cambio del día × factor de México según la
//      rareza (común 40 % … grial 80 %) × estado. Se mezcla 70/30 con lo que
//      propone la IA y nunca baja de lo que sueles cobrar por esa marca/categoría
//      (con 2+ prendas de historial; 85 % para piezas comunes);
//      una pieza rara nunca baja del 55 % de lo que se paga en EE.UU.
//   4. Tres precios: rápido (se va en días), justo (recomendado) y máximo.
// ─────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';
import { rateLimit } from './rateLimit.js';
import { esGlobal, puede } from './bazar.js';
import { invalidarSyncCache } from './db.js';
import { tomarBloqueo, soltarBloqueo } from './actividad.js';
import {
  ErrorIA, clasificar, MENSAJES, fotosDirectas, numero, texto, c01, norm, mediana, historialPrecios,
  GRANDE, RAPIDO, anotarUso, ligera, URL_CLOUD, lista, numEnv, esperar, ESPERA, costo,
  elegirTalla, elegirEstado, elegirCategoria, nombreCatalogo, leerJSON, marcarSinSaldo,
} from './ia.js';

// ── Precio para México ──────────────────────────────────────
export const FACTOR_RAREZA = [0, 0.40, 0.50, 0.60, 0.70, 0.80];
export const ETIQUETA_RAREZA = ['', 'Común', 'Buscada', 'Rara', 'Muy rara', 'Grial'];
const AJ_ESTADO = { 'Nueva con etiqueta': 1.05, 'Nueva': 1, '10/10': 1, '9/10': 0.97, '8/10': 0.92, '7/10': 0.86, '6/10': 0.8, '5/10': 0.72, 'Con mucho desgaste': 0.6 };
const A_USD = { USD: 1, US$: 1, EUR: 1.08, GBP: 1.27, CAD: 0.72, AUD: 0.66, JPY: 0.0066 };
const percentil = (arr, p) => { const a = arr.filter(n => n > 0).sort((x, y) => x - y); if (!a.length) return null; const i = (a.length - 1) * p; const b = Math.floor(i); return a[b] + (a[Math.min(b + 1, a.length - 1)] - a[b]) * (i - b); };
export const redondearPrecio = n => {
  n = Math.max(50, Number(n) || 0);
  const paso = n < 1000 ? 10 : n < 5000 ? 50 : 100;
  return Math.round(n / paso) * paso;
};
export function aUSD(precio, moneda, tc) {
  const p = numero(precio); if (!(p > 0)) return 0;
  const m = String(moneda || 'USD').toUpperCase().replace(/[^A-Z$]/g, '');
  if (m === 'MXN' || m === 'MX' || m === 'MXP') return p / tc;
  return p * (A_USD[m] ?? 1);
}
export function precioMexico({ comparables = [], nivel = 1, estado = '', tc = 18, iaMxn = {}, historial = 0 }) {
  nivel = Math.max(1, Math.min(5, Math.round(nivel) || 1));
  const validos = comparables.filter(c => c.usd > 0 && c.usd < 25000);
  const verificados = validos.filter(c => c.verificado);
  const base = verificados.length ? verificados : validos;
  const vendidos = base.filter(c => c.vendido);
  const usados = vendidos.length >= 2 ? vendidos.map(c => c.usd) : base.map(c => (c.vendido ? c.usd : c.usd * 0.85));
  const usdMediana = mediana(usados), usdAlto = percentil(usados, 0.75);
  const aj = AJ_ESTADO[estado] ?? 0.92;
  const factor = FACTOR_RAREZA[nivel] * aj;
  const iaJusto = numero(iaMxn?.justo) > 0 && numero(iaMxn.justo) < 300000 ? numero(iaMxn.justo) : 0;
  let justo = usdMediana ? usdMediana * tc * factor : 0;
  const notas = [];
  if (justo && iaJusto) justo = justo * 0.7 + iaJusto * 0.3;
  else if (!justo) justo = iaJusto;
  if (historial > 0) {
    const piso = historial * (nivel >= 3 ? 1 : 0.85);
    if (justo < piso) { justo = piso; notas.push(nivel >= 3 ? 'Subido: por ser pieza rara no baja de lo que sueles cobrar por esa marca.' : 'Ajustado a lo que sueles cobrar por esa marca o categoría.'); }
  }
  if (nivel >= 3 && usdMediana) {
    const piso = usdMediana * tc * 0.55 * aj;
    if (justo < piso) { justo = piso; notas.push('Subido: una pieza rara no se regala (mínimo 55 % de lo que se paga en EE.UU.).'); }
  }
  if (!justo) { justo = historial || 250; notas.push('Sin comparables: precio de referencia, revísalo.'); }
  const maximo = Math.max(justo * 1.3, usdAlto ? usdAlto * tc * Math.min(0.95, FACTOR_RAREZA[nivel] + 0.1) * aj : 0);
  return {
    rapido: redondearPrecio(justo * 0.85), justo: redondearPrecio(justo), maximo: redondearPrecio(Math.min(maximo, 300000)),
    usdMediana: usdMediana ? Math.round(usdMediana) : null, mxnEEUU: usdMediana ? redondearPrecio(usdMediana * tc) : null,
    factor: Math.round(factor * 100) / 100, pctMexico: Math.round(FACTOR_RAREZA[nivel] * 100), tc,
    base: usados.length, vendidos: vendidos.length, verificados: verificados.length, notas,
  };
}

// ── Links: solo cuentan los que salieron en la búsqueda ─────
const limpiarUrl = u => { try { const x = new URL(String(u)); if (!/^https?:$/.test(x.protocol)) return ''; x.hash = ''; return x.toString(); } catch { return ''; } };
const claveUrl = u => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '')).toLowerCase(); } catch { return ''; } };
const sitioDe = u => { try { return new URL(u).hostname.replace(/^www\./, '').replace(/^(m|es|mx|articulo|listado)\./, ''); } catch { return ''; } };

// ── Instrucciones del agente ────────────────────────────────
export function sistemaAgente({ categorias, tallas, estados, marcas, precios }) {
  return `Eres el agente experto de "Stiimpys", bazar de ropa vintage, streetwear y de segunda mano en Reynosa, México. Trabajas como un tasador profesional de ropa vintage: identificas la prenda, la fechas, mides su rareza, revisas que sea auténtica y das un precio CON EVIDENCIA. Hablas español de México.

Cómo trabajas:
NO INVENTES NADA. Solo cuenta lo que se ve en las fotos o lo que encontraste en la búsqueda. Si algo no se puede saber, déjalo vacío.
1. Revisa TODAS las fotos (pueden ser hasta 8; la etiqueta puede estar en cualquiera): etiquetas (marca, país, RN/CA, composición, cuidado, fecha), costuras (single stitch = una sola costura en mangas y bastilla, casi siempre antes de ~1995), estampado (gira, fechas, ©, licencias), botones, remaches, cierres (Talon, Scovill, YKK), tela y desgaste.
2. Fecha la prenda SOLO con pistas que se vean y di cuáles usaste. Sin pistas: epoca vacía.
3. Rareza 1–5: 1 común (básicos, marcas de tienda), 2 buscada (marca conocida, buen diseño), 3 rara (vintage auténtico 80s/90s, merch original, colab), 4 muy rara (gira o artista muy buscado, ediciones limitadas, piezas de culto), 5 grial (lo que los coleccionistas buscan por nombre). No infles la rareza: cada nivel de 3 en adelante necesita señales que se vean.
4. Autenticidad: busca señales de réplica, bootleg o reimpresión (etiqueta nueva en diseño viejo, estampado digital, tag que no corresponde a la época). Di qué viste.
5. Busca en internet precios de piezas iguales o casi iguales. Primero VENDIDAS (eBay sold, Grailed sold, Depop, Vinted), luego a la venta (Grailed, eBay, Mercado Libre México, tiendas vintage de México). Búsquedas específicas: marca + modelo/gira/diseño + época + "vintage". No repitas una búsqueda casi igual; cuando ya tengas 3 vendidas muy parecidas, deja de buscar.
6. Comparables: SOLO de lo que encontraste en la búsqueda, con el link exacto. Nunca inventes links ni precios. Si no encontraste nada parecido, deja la lista vacía.
7. Precio para México: aquí se paga menos que en EE.UU., pero una pieza rara NO se regala. Guía: común ~40 % de lo que se vende usada en EE.UU., buscada ~50 %, rara ~60 %, muy rara ~70 %, grial ~80 %; ajusta por estado. Da tres precios en pesos: rápido (se vende en días), justo (recomendado) y máximo (para esperar al comprador indicado).

Listas de la tienda:
- c (categoría): una de [${categorias.join('|') || 'libre'}]. cn: SOLO si ninguna encaja, la categoría nueva (español, plural, ej. "Jerseys").
- t (talla): una de [${tallas.join('|')}] (pantalón = cintura en pulgadas; tenis = talla MX).
- e (estado): uno de [${estados.join('|')}].
${marcas.length ? `- m (marca): si es una de estas, escríbela igual: ${marcas.join(', ')}. Si es otra, con su nombre oficial.\n` : ''}${precios ? `Lo que cobra este bazar (referencia): \n${precios}\n` : ''}
Responde al final SOLO este JSON (sin texto después):
{"n":"nombre ≤60, sin talla ni precio","m":"","modelo":"","c":"","cn":"","t":"","e":"",
"epoca":{"rango":"ej. 1994–1997","decada":"ej. 90s","pistas":["..."]},"origen":"país de fabricación","material":"",
"rareza":{"nivel":1,"senales":["..."]},"autenticidad":{"nivel":"alta|media|baja","notas":["..."]},
"comparables":[{"titulo":"","sitio":"","precio":0,"moneda":"USD","vendido":true,"fecha":"","url":""}],
"mxn":{"rapido":0,"justo":0,"maximo":0},"evidencia":["por qué ese precio, frases cortas"],
"d":"2–3 frases que vendan; menciona época y defectos","h":"#hashtags específicos","conf":0.0}`;
}

// Una investigación (con búsqueda en internet). Si la búsqueda se pausa, se sigue.
async function investigarUnaVez({ modelo, system, fuentes, pista, buscar, restante, maxBusquedas = 5 }) {
  let mensajes = [{ role: 'user', content: [
    ...fuentes.map(source => ({ type: 'image', source })),
    { type: 'text', text: `Investiga esta prenda a fondo.${pista ? ` Lo que ya sé (puede estar mal): ${pista}` : ''}` },
  ] }];
  const bloques = [], llamadas = [];
  let fin = null;
  for (let vuelta = 0; vuelta < 4; vuelta++) {
    const limiteMs = Math.min(numEnv('IA_TIEMPO_MS', 48000), restante() - 1000);
    if (limiteMs < Math.min(2500, numEnv('IA_TIEMPO_MS', 48000))) break;
    const cuerpo = { model: modelo, max_tokens: 3000, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], messages: mensajes };
    if (buscar) cuerpo.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxBusquedas,
      user_location: { type: 'approximate', city: 'Reynosa', region: 'Tamaulipas', country: 'MX', timezone: 'America/Matamoros' } }];
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), limiteMs);
    let r, j;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(cuerpo) });
      j = await r.json().catch(() => null);
    } catch (e) {
      if (bloques.length) break;                                   // ya hay algo: se usa lo que llegó
      throw e?.name === 'AbortError' || ctrl.signal.aborted ? new ErrorIA('tiempo', MENSAJES.tiempo) : new ErrorIA('red', MENSAJES.red);
    } finally { clearTimeout(t); }
    if (!r.ok || !j) {
      const e = clasificar(r.status, j?.error?.message, j?.error?.type);
      if (!j && r.ok) throw new ErrorIA('saturada', MENSAJES.saturada);
      if (buscar && /web_search|tool/i.test(j?.error?.message || '')) e.sinBusqueda = true;
      const ra = Number(r.headers?.get?.('retry-after')); if (ra >= 0 && !Number.isNaN(ra)) e.retryAfter = ra * 1000;
      throw e;
    }
    llamadas.push({ uso: j.usage || {}, modelo });
    bloques.push(...(j.content || []));
    fin = j.stop_reason;
    if (j.stop_reason !== 'pause_turn') break;
    mensajes = [...mensajes, { role: 'assistant', content: j.content }];
  }
  const textoFinal = bloques.filter(b => b.type === 'text').map(b => b.text || '').join('');
  const leido = leerJSON(textoFinal);
  // Links que de verdad salieron en la búsqueda
  const encontrados = new Map();
  for (const b of bloques) {
    if (b.type !== 'web_search_tool_result' || !Array.isArray(b.content)) continue;
    for (const x of b.content) if (x?.url) { const u = limpiarUrl(x.url); if (u) encontrados.set(claveUrl(u), { url: u, titulo: texto(x.title, 120) }); }
  }
  const busquedas = bloques.filter(b => b.type === 'server_tool_use' && b.name === 'web_search').length;
  if (!leido) throw Object.assign(new ErrorIA('formato', MENSAJES.formato), { llamadas });
  return { d: leido.obj, cortado: leido.cortado || fin === 'max_tokens', encontrados, busquedas, llamadas, modelo };
}

// ═════════════════════════════════════════════════════════════
export async function iaAgente(req, res, db, user, bazarId) {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Falta configurar la IA: agrega ANTHROPIC_API_KEY en Vercel y vuelve a desplegar.' });
  if (!(await rateLimit(req, res, { key: 'ia-agente-' + user.username, max: 200, windowSec: 3600 }))) return;
  const inicio = Date.now();
  const restante = () => numEnv('IA_PRESUPUESTO_MS', 52000) - (Date.now() - inicio);
  const b = req.body || {};
  const imagenes = lista(b.imagenes, 10, 600).filter(u => URL_CLOUD.test(u)).slice(0, 8);
  const ligeraN = u => ligera(u, imagenes.length);
  // v47: menos búsquedas para lo que no parece tan raro (cada búsqueda cuesta)
  const maxBusquedas = numero(b.rareza) >= 4 ? 5 : 3;
  if (!imagenes.length) return res.status(400).json({ error: 'Faltan las fotos (deben estar subidas).' });
  const categorias = lista(b.categorias), tallas = lista(b.tallas, 120), estados = lista(b.estados, 20), marcas = lista(b.marcas, 150, 40);
  const datos = b.datos && typeof b.datos === 'object' ? b.datos : {};
  const pista = [texto(datos.nombre, 80), datos.marca && `marca ${texto(datos.marca, 40)}`, datos.talla && `talla ${texto(datos.talla, 30)}`, datos.estado && `estado ${texto(datos.estado, 30)}`].filter(Boolean).join(', ');

  // La memoria depende solo de las fotos: cambiar el nombre no hace que se pague otra investigación
  const clave = 'agente|' + createHash('sha256').update(imagenes.slice().sort().join('|')).digest('hex');
  const cache = db.collection('iaCache');
  const previo = await cache.findOne({ clave }).catch(() => null);
  const gratis = async previo => {
    await anotarUso(db, bazarId, [], { prendas: 0, cacheGratis: 1 });
    return res.status(200).json({ ...previo.resultado, desdeMemoria: true, costoUSD: 0 });
  };
  if (previo && !b.forzar && Date.now() - new Date(previo.en) < 7 * 864e5) return gratis(previo);
  // Doble clic o dos pestañas: la segunda espera a la primera y no paga
  const igual = await esperarIgual(db, cache, clave, restante);
  if (igual.hecho) return gratis(igual.hecho);
  try {

  const h = await historialPrecios(db, bazarId).catch(() => ({ porCat: new Map(), porMarca: new Map() }));
  const precios = [...h.porMarca].filter(([, v]) => v.length >= 2).sort((a, c) => c[1].length - a[1].length).slice(0, 20).map(([m, v]) => `${m} $${Math.round(mediana(v))}`).join(', ');
  const system = sistemaAgente({ categorias, tallas, estados, marcas, precios: precios ? `Por marca: ${precios}` : '' });
  let fuentes = imagenes.map(u => ({ type: 'url', url: ligeraN(u) }));
  const llamadas = [];

  // Intentos: modelo grande con búsqueda → (saturado/no existe) el rápido → sin búsqueda si la cuenta no la permite
  let r = null, ultimo = null, buscar = true, directas = false;
  const modelos = [GRANDE(), GRANDE(), RAPIDO(), RAPIDO()];
  for (let i = 0; i < modelos.length && !r; i++) {
    if (restante() < 8000) break;
    try { r = await investigarUnaVez({ modelo: modelos[i], system, fuentes, pista, buscar, restante, maxBusquedas }); llamadas.push(...r.llamadas); }
    catch (e) {
      if (!(e instanceof ErrorIA)) throw e;
      if (e.llamadas) llamadas.push(...e.llamadas);
      ultimo = e;
      if (e.fatal) break;
      if (e.sinBusqueda) { buscar = false; i--; continue; }
      if (e.tipo === 'imagen' && !directas) { directas = true; fuentes = await fotosDirectas(imagenes.map(ligeraN)); if (!fuentes.length) break; i--; continue; }
      if (e.tipo === 'modelo' && i < 2) { i = 1; continue; }        // salta al rápido
      if (e.tipo === 'pedido') break;
      await esperar(Math.min(e.retryAfter ?? Infinity, 4000, ESPERA() * 2) || ESPERA());
    }
  }
  if (!r) {
    await anotarUso(db, bazarId, llamadas, { prendas: 0, fallas: 1, agente: 0 });
    const e = ultimo || new ErrorIA('tiempo', MENSAJES.tiempo);
    if (e.tipo === 'saldo') await marcarSinSaldo(db);
    const reintentable = !e.fatal && e.tipo !== 'pedido';
    return res.status(e.tipo === 'clave' ? 503 : e.tipo === 'saldo' ? 402 : e.tipo === 'imagen' ? 422 : 503)
      .json({ error: e.tipo === 'formato' ? 'El agente no pudo terminar la investigación de esta prenda. Intenta de nuevo.' : e.message, reintentable, tipo: e.tipo || 'otro' });
  }
  await anotarUso(db, bazarId, llamadas, { prendas: 0, agente: 1 });

  // ── Armar el informe ──
  const d = r.d;
  const tc = (await import('./crecer.js').then(m => m.tipoDeCambio(db)).catch(() => null)) || null;
  const mxnPorUsd = tc?.mxnPorUsd || 18;
  const nombreIA = texto(d.n, 80);
  const categoria = elegirCategoria(d.c, nombreIA, categorias);
  const marcaTxt = texto(d.m, 40);
  const marca = (marcas.find(m => norm(m) === norm(marcaTxt)) || nombreCatalogo(marcaTxt)).slice(0, 40);
  const estado = elegirEstado(d.e, estados) || elegirEstado(datos.estado, estados);
  const listaTxt = (x, n, largo) => (Array.isArray(x) ? x : typeof x === 'string' && x ? x.split(/[;·\n]/) : []).map(v => texto(v, largo)).filter(Boolean).slice(0, n);
  // v47: la rareza necesita señales que se vean (3 = al menos 1; 4–5 = al menos 2) y la época, pistas
  const senales = listaTxt(d.rareza?.senales, 6, 80);
  const nivelIA = Math.max(1, Math.min(5, Math.round(numero(d.rareza?.nivel ?? d.rz)) || 1));
  const nivel = Math.min(nivelIA, senales.length >= 2 ? 5 : senales.length === 1 ? 3 : 2);
  const pistasEpoca = listaTxt(d.epoca?.pistas, 5, 120);
  const comparables = (Array.isArray(d.comparables) ? d.comparables : []).slice(0, 10).map(c => {
    const url = limpiarUrl(c?.url);
    const hallado = url ? r.encontrados.get(claveUrl(url)) : null;
    const usd = aUSD(c?.precio, c?.moneda, mxnPorUsd);
    return {
      titulo: texto(c?.titulo, 120) || hallado?.titulo || '', sitio: texto(c?.sitio, 40) || sitioDe(url),
      precio: Math.round(numero(c?.precio) * 100) / 100, moneda: texto(c?.moneda, 6).toUpperCase() || 'USD',
      usd: Math.round(usd * 100) / 100, mxn: usd ? redondearPrecio(usd * mxnPorUsd) : 0,
      vendido: c?.vendido === true || /vend|sold/i.test(String(c?.vendido || '')), fecha: texto(c?.fecha, 30),
      url: hallado ? hallado.url : '', verificado: !!hallado,
    };
  }).filter(c => c.usd > 0 && c.verificado);     // v47: lo que no salió en la búsqueda no se muestra ni cuenta
  // Tu historial solo cuenta como piso si hay al menos 2 prendas de esa marca/categoría
  const med2 = arr => (arr || []).filter(n => n > 0).length >= 2 ? mediana(arr) : null;
  const histMarca = marca ? med2(h.porMarca.get(norm(marca))) : null;
  const histCat = categoria ? med2(h.porCat.get(categoria)) : null;
  const precios2 = precioMexico({ comparables, nivel, estado, tc: mxnPorUsd, iaMxn: d.mxn, historial: histMarca || histCat || 0 });
  let confianza = c01(d.conf);
  const vendVerif = comparables.filter(c => c.verificado && c.vendido).length;
  if (vendVerif >= 3) confianza = Math.max(confianza, 0.8);
  else if (!comparables.some(c => c.verificado)) confianza = Math.min(confianza || 0.4, 0.45);
  const tags = [...new Set((Array.isArray(d.h) ? d.h.join(' ') : texto(d.h, 600)).split(/[\s,]+/).map(x => x.replace(/[^#\p{L}\p{N}_]/gu, '').replace(/^#*/, '')).filter(Boolean).map(x => '#' + x))].slice(0, 12).join(' ');

  const resultado = {
    nombre: /\p{L}/u.test(nombreIA) ? nombreIA : '', marca, marcaNueva: !!marca && !marcas.some(m => norm(m) === norm(marca)),
    categoria, categoriaNueva: categoria ? '' : nombreCatalogo(texto(d.cn, 40) || texto(d.c, 40), true),
    talla: elegirTalla(d.t, tallas, categoria || texto(d.c, 30)), estado, modelo: texto(d.modelo, 80),
    epoca: pistasEpoca.length ? { rango: texto(d.epoca?.rango, 40), decada: texto(d.epoca?.decada, 20), pistas: pistasEpoca } : { rango: '', decada: '', pistas: [] },
    origen: texto(d.origen, 40), material: texto(d.material, 60),
    rareza: { nivel, etiqueta: ETIQUETA_RAREZA[nivel], senales, ajustada: nivel < nivelIA },
    autenticidad: { nivel: ['alta', 'media', 'baja'].includes(norm(d.autenticidad?.nivel)) ? norm(d.autenticidad.nivel) : 'media', notas: listaTxt(d.autenticidad?.notas, 4, 140) },
    comparables, precios: { ...precios2, fuenteTc: tc?.fuente || 'aproximado' },
    evidencia: [...listaTxt(d.evidencia, 5, 160), ...precios2.notas].slice(0, 7),
    descripcion: texto(d.d, 600), hashtags: tags,
    confianza: Math.round(confianza * 100) / 100,
    busquedas: r.busquedas, sinBusqueda: !buscar, incompleta: !!r.cortado,
    modeloIA: r.modelo, costoUSD: Math.round(llamadas.reduce((t, l) => t + costo(l), 0) * 10000) / 10000,
    en: new Date().toISOString(),
  };
  if (!r.cortado && (resultado.comparables.some(c => c.verificado) || confianza >= 0.5)) {
    try { await cache.updateOne({ clave }, { $set: { clave, resultado, en: resultado.en } }, { upsert: true }); } catch {}
  }
  return res.status(200).json(resultado);
  } finally { if (igual.token && igual.token !== 'sin-candado') await soltarBloqueo(db, 'ia:' + clave, igual.token); }
}

async function esperarIgual(db, cache, clave, restante) {
  const token = await tomarBloqueo(db, 'ia:' + clave, 60).catch(() => 'sin-candado');
  if (token) return { token };
  const hasta = Date.now() + Math.max(0, Math.min(45000, restante() - 10000));
  while (Date.now() < hasta) {
    await esperar(Math.max(5, Math.min(1000, ESPERA())));
    const hecho = await cache.findOne({ clave }).catch(() => null);
    if (hecho) return { hecho };
  }
  return { token: null };
}

// ═════════════════════════════════════════════════════════════
//  Crear marca o categoría (sin duplicar; con candado)
// ═════════════════════════════════════════════════════════════
export async function iaCatalogo(req, res, db, user) {
  if (!(await rateLimit(req, res, { key: 'ia-catalogo-' + user.username, max: 120, windowSec: 3600 }))) return;
  const b = req.body || {};
  const col = b.tipo === 'marca' ? 'marcas' : b.tipo === 'categoria' ? 'categorias' : null;
  if (!col) return res.status(400).json({ error: 'Tipo no válido (marca o categoria).' });
  const nombre = nombreCatalogo(b.nombre, col === 'categorias');
  if (!nombre) return res.status(400).json({ error: 'Ese nombre no sirve para una marca o categoría.' });
  const global = esGlobal(user);
  if (!global && (!user.bazarId || !(await puede(user, 'gestionarCatalogo')))) return res.status(403).json({ error: 'Tu bazar no tiene permitido gestionar el catálogo.' });
  const mio = global ? null : Number(user.bazarId);
  const visible = x => global || x.bazarId == null || Number(x.bazarId) === mio;
  const buscar = async () => (await db.collection(col).find({}).toArray()).find(x => visible(x) && norm(x.nombre) === norm(nombre));
  const ya = await buscar();
  if (ya) return res.status(200).json({ id: ya.id, nombre: ya.nombre, bazarId: ya.bazarId ?? null, creada: false });
  // Candado: dos prendas con la misma marca nueva no la crean dos veces
  let token = null;
  for (let i = 0; i < 12 && !token; i++) { token = await tomarBloqueo(db, 'catalogo:' + col, 10); if (!token) await esperar(250); }
  if (!token) return res.status(503).json({ error: 'El catálogo está ocupado, intenta en un momento.', reintentable: true });
  try {
    const otra = await buscar();
    if (otra) return res.status(200).json({ id: otra.id, nombre: otra.nombre, bazarId: otra.bazarId ?? null, creada: false });
    const todas = await db.collection(col).find({}).toArray();
    const id = todas.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
    const doc = { id, nombre, bazarId: mio, creadaPor: 'ia', creadaEn: new Date().toISOString() };
    await db.collection(col).insertOne({ ...doc });
    invalidarSyncCache();
    req._evento = { accion: `Creó la ${col === 'marcas' ? 'marca' : 'categoría'} "${nombre}"`, detalle: 'Desde el registro con IA' };
    return res.status(200).json({ id, nombre, bazarId: mio, creada: true });
  } finally { await soltarBloqueo(db, 'catalogo:' + col, token); }
}
