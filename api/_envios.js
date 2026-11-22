// ─────────────────────────────────────────────────────────────
//  api/_envios.js — Cotización de envíos con envia.com
//
//  · El token vive en Vercel: ENVIA_TOKEN (o ENVIA_TOKEN_2 para otro bazar).
//    ENVIA_SANDBOX=1 usa el ambiente de pruebas (api-test / queries.test).
//  · Código postal → ciudad, estado y colonias (geocodes.envia.com, sin token).
//  · Cotiza con varias paqueterías a la vez (una llamada por paquetería),
//    elige las mejores (más barata y más rápida) y les aplica el margen
//    del bazar. La cotización se guarda: al pagar se cobra exactamente lo
//    que el cliente vio (no se confía en el precio que manda el navegador).
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';

const HORA = 3600 * 1000;
const varBazar = (nombre, bazarId) => process.env[`${nombre}_${bazarId}`] || (Number(bazarId) === 1 ? process.env[nombre] : '') || '';
export const tokenEnvia = bazarId => String(varBazar('ENVIA_TOKEN', bazarId) || '').trim();
export const esPrueba = bazarId => /^(1|true|si|sí)$/i.test(String(varBazar('ENVIA_SANDBOX', bazarId) || process.env.ENVIA_SANDBOX || ''));
const URL_ENVIOS = b => esPrueba(b) ? 'https://api-test.envia.com' : 'https://api.envia.com';
const URL_CONSULTAS = b => esPrueba(b) ? 'https://queries.test.envia.com' : 'https://queries.envia.com';
const texto = (v, n = 120) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);

// Paqueterías que se prueban primero (si la cuenta las tiene activas)
const PREFERIDAS = ['dhl', 'fedex', 'estafeta', 'paquetexpress', 'redpack', 'ups', 'jtexpress', '99minutos', 'sendex', 'ampm'];

export const CONFIG_ENVIA = {
  activo: true,
  origen: { nombre: '', telefono: '', calle: '', numero: '', colonia: '', cp: '', referencia: '' },
  paqueterias: [],          // vacío = automático
  margenPct: 0,             // % que se suma al costo de la paquetería
  margenFijo: 0,            // $ que se suma (empaque, traslado a la sucursal…)
  gratisDesde: 0,           // envío gratis (la opción más barata) desde este monto; 0 = nunca
};
export function normalizarEnvia(c = {}) {
  const o = JSON.parse(JSON.stringify(CONFIG_ENVIA));
  if (typeof c.activo === 'boolean') o.activo = c.activo;
  for (const k of Object.keys(o.origen)) o.origen[k] = texto(c.origen?.[k], k === 'referencia' ? 120 : 80);
  o.origen.cp = o.origen.cp.replace(/\D/g, '').slice(0, 5);
  o.origen.telefono = o.origen.telefono.replace(/\D/g, '').slice(-10);
  if (Array.isArray(c.paqueterias)) o.paqueterias = c.paqueterias.map(x => texto(x, 30).toLowerCase().replace(/[^a-z0-9_-]/g, '')).filter(Boolean).slice(0, 8);
  o.margenPct = Math.max(0, Math.min(100, Number(c.margenPct) || 0));
  o.margenFijo = Math.max(0, Math.min(500, Number(c.margenFijo) || 0));
  o.gratisDesde = Math.max(0, Math.min(100000, Number(c.gratisDesde) || 0));
  return o;
}
// Listo para cotizar: hay token, está activo y el bazar tiene dirección de salida
export const enviaListo = (cfg, bazarId) => !!tokenEnvia(bazarId) && !!cfg?.envia?.activo && cfg.envia.origen.cp.length === 5 && !!cfg.envia.origen.calle;

async function pedir(url, opciones = {}, ms = 7000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opciones, signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  } finally { clearTimeout(t); }
}

// ── Código postal → ciudad, estado, colonias ──────────────────
export async function consultarCP(db, cp) {
  cp = String(cp || '').replace(/\D/g, '').slice(0, 5);
  if (cp.length !== 5) return null;
  const col = db.collection('codigosPostales');
  const guardado = await col.findOne({ cp });
  const limpio = d => ({ cp: d.cp, ciudad: d.ciudad, estado: d.estado, estadoCodigo: d.estadoCodigo, colonias: d.colonias || [] });
  if (guardado && Date.now() - new Date(guardado.en) < 60 * 24 * HORA) return limpio(guardado);
  let r = null;
  try { r = await pedir(`https://geocodes.envia.com/zipcode/MX/${cp}`, {}, 5000); } catch {}
  const j = r?.j;
  const x = Array.isArray(j) ? j[0] : Array.isArray(j?.data) ? j.data[0] : j?.data;
  const estadoCodigo = x ? String(x.state?.code?.['2digit'] || (typeof x.state === 'string' ? x.state : '') || '').toUpperCase() : '';
  if (!x || !estadoCodigo) return guardado ? limpio(guardado) : null;
  const doc = { cp, ciudad: texto(x.locality || x.city || x.regions?.region_2, 80), estado: texto(x.state?.name || '', 60), estadoCodigo,
    colonias: (Array.isArray(x.suburbs) ? x.suburbs : []).map(s => texto(s, 80)).filter(Boolean).slice(0, 120), en: new Date().toISOString() };
  await col.updateOne({ cp }, { $set: doc }, { upsert: true });
  return limpio(doc);
}

// ── Paquete: peso y medidas estimados por tipo de prenda ──────
const TIPOS = [
  [/tenis|sneaker|zapat|bota|jordan|dunk|yeezy|vans|converse|air ?max|new balance/i, 1.3, 'caja'],
  [/chamarra|abrigo|campera|puffer|parka|jacket|chaleco|rompevientos|gabardina/i, 1.1],
  [/sudadera|hoodie|sweater|su[eé]ter|crewneck|polar|cardigan|fleece/i, 0.7],
  [/jean|pantal[oó]n|jogger|cargo|overol|pants/i, 0.7],
  [/bolsa|mochila|backpack|cartera|bag|ri[nñ]onera/i, 0.6],
  [/vestido|falda|enterizo|jumpsuit/i, 0.4],
  [/short|bermuda/i, 0.35],
  [/gorra|cap\b|sombrero|beanie|gorro|bucket/i, 0.2, 'gorra'],
  [/playera|camiseta|t-?shirt|tee|polo|blusa|top|jersey|camisa|tank/i, 0.3],
];
export function pesoDe(p) {
  if (Number(p.pesoKg) > 0) return { kg: Math.min(30, Number(p.pesoKg)), forma: null };
  const t = [p.nombre, ...(Array.isArray(p.categorias) ? p.categorias : []), p.categoria, p.tipo].filter(Boolean).join(' ');
  for (const [re, kg, forma] of TIPOS) if (re.test(t)) return { kg, forma: forma || null };
  return { kg: 0.5, forma: null };
}
export function paqueteDe(prendas, valor) {
  let kg = 0.2, pares = 0, gorras = 0;   // 200 g de empaque
  for (const p of prendas) { const x = pesoDe(p); kg += x.kg; if (x.forma === 'caja') pares++; if (x.forma === 'gorra') gorras++; }
  kg = Math.round(kg * 100) / 100;
  let dim = kg <= 1 ? [30, 25, 10] : kg <= 2 ? [35, 30, 12] : kg <= 4 ? [40, 35, 18] : kg <= 7 ? [50, 40, 25] : [60, 45, 35];
  if (pares) dim = [Math.max(dim[0], 36), Math.max(dim[1], 26), Math.max(dim[2], Math.min(60, 14 * pares))];
  if (gorras) dim = [Math.max(dim[0], 28), Math.max(dim[1], 28), Math.max(dim[2], 15)];
  return {
    type: 'box', content: 'Ropa', amount: 1, declaredValue: Math.max(1, Math.round(valor || 0)),
    lengthUnit: 'CM', weightUnit: 'KG', weight: Math.max(0.3, kg),
    dimensions: { length: dim[0], width: dim[1], height: dim[2] },
  };
}

// ── Paqueterías con las que se cotiza ─────────────────────────
async function paqueteriasDe(db, bazarId, cfg) {
  if (cfg.envia.paqueterias.length) return cfg.envia.paqueterias.slice(0, 6);
  const col = db.collection('enviaCache');
  const id = `paqueterias-MX-${esPrueba(bazarId) ? 'prueba' : 'real'}`;
  let doc = await col.findOne({ id });
  if (!doc || Date.now() - new Date(doc.en) > 24 * HORA) {
    try {
      const r = await pedir(`${URL_CONSULTAS(bazarId)}/carrier?country_code=MX`, { headers: { Authorization: `Bearer ${tokenEnvia(bazarId)}` } }, 5000);
      const lista = (Array.isArray(r.j?.data) ? r.j.data : []).filter(c => c?.name && c.active !== false && c.active !== 0)
        .map(c => ({ name: String(c.name).toLowerCase(), descripcion: c.description || c.name }));
      if (lista.length) { doc = { id, lista, en: new Date().toISOString() }; await col.updateOne({ id }, { $set: doc }, { upsert: true }); }
    } catch {}
  }
  const disponibles = (doc?.lista || []).map(c => c.name);
  const orden = disponibles.length ? [...PREFERIDAS.filter(p => disponibles.includes(p)), ...disponibles.filter(d => !PREFERIDAS.includes(d))] : PREFERIDAS;
  return orden.slice(0, 6);
}

const direccionEnvia = (d, info) => ({
  name: texto(d.nombre || 'Cliente', 60), phone: String(d.telefono || '').replace(/\D/g, '').slice(-10) || '8180000000',
  street: texto(d.calle || 'Por definir', 80), number: texto(d.numero || 'S/N', 20), district: texto(d.colonia || info?.colonias?.[0] || 'Centro', 60),
  city: info.ciudad, state: info.estadoCodigo, country: 'MX', postalCode: info.cp, reference: texto(d.referencia || '', 80),
});

// Tarifas "crudas" de envia.com (se guardan 6 h por ruta y paquete)
async function tarifas(db, bazarId, cfg, paquete, destinoCP) {
  const origenInfo = await consultarCP(db, cfg.envia.origen.cp);
  if (!origenInfo) throw new Error('No se pudo leer el código postal de salida del bazar.');
  const destino = await consultarCP(db, destinoCP);
  if (!destino) { const e = new Error('No encontramos ese código postal. Revísalo.'); e.status = 400; throw e; }
  const paqs = await paqueteriasDe(db, bazarId, cfg);
  const firma = crypto.createHash('sha1').update(JSON.stringify([esPrueba(bazarId), cfg.envia.origen.cp, destino.cp, paquete.weight, paquete.dimensions, Math.round(paquete.declaredValue / 100), paqs])).digest('hex');
  const cache = db.collection('enviaCache');
  const previo = await cache.findOne({ id: 'tarifa-' + firma });
  if (previo && Date.now() - new Date(previo.en) < 6 * HORA) return { destino, todas: previo.todas };

  const cuerpoBase = { origin: direccionEnvia(cfg.envia.origen, origenInfo), destination: direccionEnvia({}, destino), packages: [paquete], settings: { currency: 'MXN' } };
  const respuestas = await Promise.all(paqs.map(carrier =>
    pedir(`${URL_ENVIOS(bazarId)}/ship/rate/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenEnvia(bazarId)}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...cuerpoBase, shipment: { type: 1, carrier } }),
    }).catch(() => null)));
  const todas = [];
  let errorToken = false;
  for (const r of respuestas) {
    if (r?.status === 401 || r?.status === 403) errorToken = true;
    for (const x of (Array.isArray(r?.j?.data) ? r.j.data : [])) {
      const costo = Number(x.totalPrice);
      if (!(costo > 0) || (x.currency && x.currency !== 'MXN')) continue;
      const paqueteria = texto(x.carrierDescription || x.carrier, 40);
      // "DHL Express" → "Express" (la paquetería ya se muestra aparte)
      const servicio = texto(x.serviceDescription || x.service, 60).replace(new RegExp('^' + paqueteria.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+', 'i'), '') || texto(x.service, 40);
      todas.push({
        key: `${x.carrier}:${x.service}`, carrier: String(x.carrier || ''), paqueteria,
        servicio, dias: texto(x.deliveryEstimate, 30),
        diasN: Number.isFinite(Number(x.deliveryDate?.dateDifference)) ? Number(x.deliveryDate.dateDifference) : null, costo,
      });
    }
  }
  if (!todas.length) {
    const e = new Error(errorToken ? 'envia.com rechazó el token. Revisa ENVIA_TOKEN en Vercel.' : 'Ninguna paquetería dio precio para ese código postal.');
    e.status = errorToken ? 502 : 404; throw e;
  }
  await cache.updateOne({ id: 'tarifa-' + firma }, { $set: { id: 'tarifa-' + firma, todas, en: new Date().toISOString() } }, { upsert: true });
  return { destino, todas };
}

// Precio al cliente: costo + margen, redondeado hacia arriba a múltiplos de $5
const precioCliente = (costo, cfg) => Math.ceil((costo * (1 + cfg.envia.margenPct / 100) + cfg.envia.margenFijo) / 5) * 5;

// Elige hasta 3 opciones: la más barata, la más rápida y otra paquetería barata
export function elegirOpciones(todas, cfg, subtotal) {
  const unicas = Object.values(todas.reduce((m, x) => { if (!m[x.key] || x.costo < m[x.key].costo) m[x.key] = x; return m; }, {}));
  if (!unicas.length) return [];
  const porPrecio = [...unicas].sort((a, b) => a.costo - b.costo);
  const barata = porPrecio[0];
  const conDias = unicas.filter(x => x.diasN != null);
  const rapida = conDias.sort((a, b) => a.diasN - b.diasN || a.costo - b.costo)[0];
  const elegidas = [{ ...barata, etiqueta: 'Más barato' }];
  if (rapida && rapida.key !== barata.key && (barata.diasN == null || rapida.diasN < barata.diasN)) elegidas.push({ ...rapida, etiqueta: 'Más rápido' });
  const otra = porPrecio.find(x => !elegidas.some(e => e.key === x.key || e.carrier === x.carrier));
  if (otra && elegidas.length < 3) elegidas.push({ ...otra, etiqueta: '' });
  const gratis = cfg.envia.gratisDesde > 0 && subtotal >= cfg.envia.gratisDesde;
  const base = precioCliente(barata.costo, cfg);
  return elegidas.map((x, i) => {
    const p = precioCliente(x.costo, cfg);
    return { ...x, precio: gratis ? (i === 0 ? 0 : Math.max(5, p - base)) : p, gratis: gratis && i === 0, etiqueta: gratis && i === 0 ? 'Gratis' : x.etiqueta };
  });
}

// Cotiza y guarda la cotización (para cobrar exactamente eso al pagar)
export async function cotizarEnvio(db, { bazarId, cfg, prendas, cp, subtotal, valor }) {
  const paquete = paqueteDe(prendas, valor ?? subtotal);
  const { destino, todas } = await tarifas(db, bazarId, cfg, paquete, cp);
  const opciones = elegirOpciones(todas, cfg, subtotal);
  const id = 'E' + crypto.randomBytes(8).toString('hex');
  await db.collection('enviosCotizaciones').insertOne({
    id, bazarId: Number(bazarId), cp: destino.cp, ids: prendas.map(p => Number(p.id)).sort((a, b) => a - b),
    subtotal, opciones, paquete, en: new Date().toISOString(),
  });
  return {
    cotizacion: id, cp: destino.cp, ciudad: destino.ciudad, estado: destino.estado, colonias: destino.colonias,
    gratisDesde: cfg.envia.gratisDesde || 0,
    opciones: opciones.map(({ key, paqueteria, servicio, dias, precio, gratis, etiqueta }) => ({ key, paqueteria, servicio, dias, precio, gratis, etiqueta })),
  };
}

// Al pagar: la opción elegida, solo si la cotización corresponde a este pedido
export async function opcionCotizada(db, { cotizacion, opcion, bazarId, cp, ids }) {
  const c = await db.collection('enviosCotizaciones').findOne({ id: String(cotizacion || '').slice(0, 40) });
  if (!c || Number(c.bazarId) !== Number(bazarId) || c.cp !== cp) return null;
  if (Date.now() - new Date(c.en) > 3 * HORA) return null;
  const mismos = [...ids].map(Number).sort((a, b) => a - b);
  if (mismos.length !== c.ids.length || mismos.some((x, i) => x !== c.ids[i])) return null;
  return c.opciones.find(o => o.key === opcion) || null;
}
