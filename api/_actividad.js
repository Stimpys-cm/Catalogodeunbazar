// ─────────────────────────────────────────────────────────────
//  api/_actividad.js — Centro de actividad (registro del servidor) · v33
//
//  Un solo lugar donde queda lo que pasa en el sistema: pagos de Clip y
//  PayPal, pedidos, apartados, cupones, correos, Instagram, errores de
//  MongoDB y operaciones del panel. Lo escribe SOLO el servidor (el
//  navegador no puede inventar eventos) y nunca guarda contraseñas,
//  tokens, claves de pedido ni datos completos de contacto.
//
//  Colecciones:
//    actividad  → un documento por evento (se borra solo a los ACTIVIDAD_DIAS días, 90 por defecto)
//    bloqueos   → candados cortos contra operaciones duplicadas (se borran solos)
//    sistema    → marcas de "lo último que pasó" (sync, cron, aviso de Clip, último pago)
//
//  Nada de lo de aquí detiene una venta: si registrar falla, solo se avisa en consola.
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { getDB } from './_db.js';

export const CATEGORIAS = {
  pago: 'Pagos', pedido: 'Pedidos', apartado: 'Apartados', cupon: 'Cupones', correo: 'Correos',
  instagram: 'Instagram', inventario: 'Inventario', admin: 'Administración', auth: 'Sesiones',
  db: 'MongoDB', sistema: 'Sistema',
};
export const RESULTADOS = { ok: 'Correcto', info: 'Informativo', rechazado: 'Rechazado', error: 'Error' };

const DIAS = Math.max(7, Math.min(365, Number(process.env.ACTIVIDAD_DIAS) || 90));
const DIA = 864e5;

// ── Limpieza de datos sensibles ──────────────────────────────
// Llaves que nunca se guardan (aunque vengan dentro del cuerpo de una petición)
const LLAVE_SENSIBLE = /pass|contrase|token|secret|clave|^k$|authorization|cookie|sesion|session|override|api.?key|firma|signature|tarjeta|card|cvv|cvc|file|base64|imagen(es)?$|fotos?$|caption|direccion|calle|referencias/i;
const RE_CORREO = /([A-Za-z0-9._%+-]{1,64})@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const RE_TELEFONO = /(?<![\w-])\+?\d[\d\s-]{8,}\d(?![\w-])/g;

export function enmascararCorreo(e) {
  const m = String(e || '').match(/^([^@]+)@(.+)$/);
  return m ? `${m[1].slice(0, 2)}•••@${m[2]}` : '';
}
export function enmascararTelefono(t) {
  const d = String(t || '').replace(/\D/g, '');
  return d.length >= 4 ? `•••${d.slice(-4)}` : '';
}
// Quita correos y teléfonos completos de un texto libre (mensajes de error, etc.)
export function textoSeguro(v, max = 300) {
  return String(v ?? '')
    .replace(RE_CORREO, (_, u, d) => `${u.slice(0, 2)}•••@${d}`)
    // 10 a 13 dígitos = teléfono (los ids de Instagram tienen 17 o más y se dejan)
    .replace(RE_TELEFONO, m => { const d = m.replace(/\D/g, ''); return d.length >= 10 && d.length <= 13 ? `•••${d.slice(-4)}` : m; })
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 •••')
    .replace(/[\u0000-\u001F]/g, ' ')
    .slice(0, max);
}
// Copia "segura" de un objeto: sin llaves sensibles, textos cortos, sin anidar de más
export function sanear(v, nivel = 0) {
  if (v == null) return v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return textoSeguro(v, 160);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) {
    if (nivel >= 2) return `[${v.length}]`;
    return v.slice(0, 10).map(x => sanear(x, nivel + 1));
  }
  if (typeof v === 'object') {
    if (nivel >= 2) return '{…}';
    const o = {};
    for (const [k, x] of Object.entries(v).slice(0, 20)) {
      if (LLAVE_SENSIBLE.test(k) || k === '_id') continue;
      if (/^(telefono|whatsapp|tel)$/i.test(k)) { o[k] = enmascararTelefono(x); continue; }
      if (/^(email|correo|para)$/i.test(k)) { o[k] = enmascararCorreo(x); continue; }
      o[k] = sanear(x, nivel + 1);
    }
    return o;
  }
  return undefined;
}
function errorSeguro(e) {
  if (!e) return null;
  if (typeof e === 'string') return { mensaje: textoSeguro(e) };
  return {
    nombre: textoSeguro(e.name || 'Error', 60),
    mensaje: textoSeguro(e.message || String(e)),
    ...(e.code != null ? { codigo: textoSeguro(e.code, 40) } : {}),
    ...(e.status != null ? { estado: Number(e.status) || null } : {}),
  };
}

// ── Índices (una vez por instancia) ──────────────────────────
async function indices(db) {
  if (global._idxActividad) return;
  global._idxActividad = true;
  const c = (col, k, o) => db.collection(col).createIndex(k, o).catch(() => {});
  await Promise.all([
    c('actividad', { expira: 1 }, { expireAfterSeconds: 0 }),
    c('actividad', { en: -1 }),
    c('actividad', { bazarId: 1, en: -1 }),
    c('actividad', { categoria: 1, en: -1 }),
    c('actividad', { pedidoId: 1, en: -1 }, { sparse: true }),
    c('bloqueos', { expira: 1 }, { expireAfterSeconds: 0 }),
    c('pedidos', { id: 1 }),
    c('pedidos', { estado: 1, bazarId: 1 }),
  ]);
}

// Para no llenar el registro con lo mismo (p. ej. Clip caído y un cliente
// revisando su recibo cada 3 s): una vez cada `ms` por instancia y clave.
const _ultimos = new Map();
function repetido(clave, ms) {
  if (!clave) return false;
  const ahora = Date.now(), antes = _ultimos.get(clave);
  if (antes && ahora - antes < ms) return true;
  _ultimos.set(clave, ahora);
  if (_ultimos.size > 500) _ultimos.delete(_ultimos.keys().next().value);
  return false;
}

/**
 * Guarda un evento. Nunca lanza error.
 * ev: { categoria, tipo, accion, resultado, usuario, rol, bazarId, prendaId, pedidoId, op, detalle, error, ms, unaVezCada:{clave, ms} }
 */
export async function registrarEvento(ev = {}, dbOpt) {
  try {
    if (ev.unaVezCada && repetido(ev.unaVezCada.clave, ev.unaVezCada.ms)) return null;
    const db = dbOpt || await getDB();
    await indices(db);
    const ahora = new Date();
    const doc = {
      id: crypto.randomBytes(8).toString('hex'),
      en: ahora.toISOString(),
      expira: new Date(ahora.getTime() + DIAS * DIA),
      categoria: CATEGORIAS[ev.categoria] ? ev.categoria : 'sistema',
      tipo: textoSeguro(ev.tipo || ev.categoria || 'evento', 60),
      accion: textoSeguro(ev.accion || ev.tipo || '', 200),
      resultado: RESULTADOS[ev.resultado] ? ev.resultado : 'ok',
      usuario: textoSeguro(ev.usuario || 'sistema', 60),
      rol: ev.rol ? textoSeguro(ev.rol, 20) : null,
      bazarId: ev.bazarId != null && Number(ev.bazarId) ? Number(ev.bazarId) : null,
      prendaId: ev.prendaId != null && Number(ev.prendaId) ? Number(ev.prendaId) : null,
      pedidoId: ev.pedidoId ? textoSeguro(ev.pedidoId, 40) : null,
      op: ev.op ? textoSeguro(ev.op, 40) : null,
      detalle: ev.detalle != null ? sanear(ev.detalle) : null,
      error: errorSeguro(ev.error),
      ms: Number.isFinite(ev.ms) ? Math.round(ev.ms) : null,
    };
    await db.collection('actividad').insertOne(doc);
    if (doc.resultado === 'error') await marcarSistema('ultimoError', db, 0);
    return doc;
  } catch (e) {
    console.error('[actividad]', e?.message || e);
    return null;
  }
}

// Fallas de MongoDB y excepciones: se guardan también en memoria (por si la
// base es justo lo que está fallando y no se puede escribir en ella).
global._fallasRecientes = global._fallasRecientes || [];
export const esErrorMongo = e => /^Mongo/.test(e?.name || '') || /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|topology|server selection/i.test(e?.message || '');
export async function registrarFalla(err, { origen = 'servidor', op = null, usuario = null, bazarId = null, pedidoId = null } = {}) {
  const mongo = esErrorMongo(err);
  global._fallasRecientes.unshift({ en: new Date().toISOString(), origen, op, mongo, ...errorSeguro(err) });
  global._fallasRecientes.length = Math.min(global._fallasRecientes.length, 30);
  return registrarEvento({
    categoria: mongo ? 'db' : 'sistema', tipo: mongo ? 'mongo.error' : 'excepcion', resultado: 'error',
    accion: mongo ? `Error de MongoDB en ${origen}${op ? ` (${op})` : ''}` : `Error inesperado en ${origen}${op ? ` (${op})` : ''}`,
    usuario, bazarId, pedidoId, op, error: err,
    unaVezCada: { clave: `falla:${origen}:${op}:${err?.message}`, ms: 60e3 },
  });
}

// ── "Lo último que pasó" ─────────────────────────────────────
const _marcas = {};
export async function marcarSistema(campo, dbOpt, cadaMs = 30e3) {
  try {
    const ahora = Date.now();
    if (cadaMs && _marcas[campo] && ahora - _marcas[campo] < cadaMs) return;
    _marcas[campo] = ahora;
    const db = dbOpt || await getDB();
    await db.collection('sistema').updateOne({ id: 'estado' }, { $set: { [campo]: new Date(ahora).toISOString() } }, { upsert: true });
  } catch (e) { console.error('[sistema]', e?.message || e); }
}
export async function leerSistema(db) {
  return (await db.collection('sistema').findOne({ id: 'estado' })) || {};
}

// ── Candados contra operaciones duplicadas ───────────────────
// Un documento con _id = clave. Insertar es atómico: si ya existe y no ha
// vencido, otra petición igual está en curso (o acaba de terminar).
export async function tomarBloqueo(db, clave, segundos = 15) {
  await indices(db);
  const col = db.collection('bloqueos');
  const token = crypto.randomBytes(6).toString('hex');
  const ahora = new Date();
  const expira = new Date(ahora.getTime() + segundos * 1000);
  try {
    await col.insertOne({ _id: clave, token, expira, en: ahora.toISOString() });
    return token;
  } catch (e) {
    if (e?.code !== 11000) throw e;
    // Ya existe: solo se toma si venció (Mongo borra los vencidos cada ~60 s, no al instante)
    const r = await col.findOneAndUpdate({ _id: clave, expira: { $lt: ahora } }, { $set: { token, expira, en: ahora.toISOString() } });
    const doc = r && r.lastErrorObject ? r.value : r;
    return doc ? token : null;
  }
}
export async function soltarBloqueo(db, clave, token) {
  try { await db.collection('bloqueos').deleteOne({ _id: clave, token }); } catch (_) {}
}
// Ejecuta fn con el candado; si está ocupado, responde 409 y devuelve null.
export async function conBloqueo(db, res, clave, segundos, fn, mensaje = 'Esa operación ya se está procesando. Espera un momento.') {
  const token = await tomarBloqueo(db, clave, segundos);
  if (!token) { res.status(409).json({ error: mensaje, duplicado: true }); return null; }
  try { return await fn(); }
  finally { await soltarBloqueo(db, clave, token); }
}

// ── Consulta (Centro de actividad del panel) ─────────────────
const escRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const diaMx = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null;

export function filtroActividad(q = {}, user, esGlobalUser) {
  const f = {};
  if (!esGlobalUser) f.bazarId = Number(user.bazarId);
  else if (q.bazarId && Number(q.bazarId)) f.bazarId = Number(q.bazarId);
  if (CATEGORIAS[q.categoria]) f.categoria = q.categoria;
  if (RESULTADOS[q.resultado]) f.resultado = q.resultado;
  if (q.usuario) f.usuario = String(q.usuario).slice(0, 60);
  if (q.pedido) f.pedidoId = String(q.pedido).slice(0, 40);
  if (q.prenda && Number(q.prenda)) f.prendaId = Number(q.prenda);
  const desde = diaMx(q.desde), hasta = diaMx(q.hasta);
  // Los días son de Reynosa (UTC-6)
  if (desde || hasta) {
    f.en = {};
    if (desde) f.en.$gte = new Date(`${desde}T06:00:00.000Z`).toISOString();
    if (hasta) f.en.$lt = new Date(new Date(`${hasta}T06:00:00.000Z`).getTime() + DIA).toISOString();
  }
  const texto = String(q.q || '').trim().slice(0, 80);
  if (texto) {
    const re = { $regex: escRegex(texto), $options: 'i' };
    f.$or = [{ accion: re }, { tipo: re }, { usuario: re }, { pedidoId: re }, { 'error.mensaje': re }, { op: re }];
  }
  return f;
}

export async function consultarActividad(db, filtro, { pagina = 1, porPagina = 25 } = {}) {
  await indices(db);
  const col = db.collection('actividad');
  porPagina = Math.max(5, Math.min(100, Number(porPagina) || 25));
  const total = await col.countDocuments(filtro);
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  pagina = Math.max(1, Math.min(paginas, Number(pagina) || 1));
  const eventos = await col.find(filtro, { projection: { _id: 0, expira: 0 } })
    .sort({ en: -1 }).skip((pagina - 1) * porPagina).limit(porPagina).toArray();
  const [porResultado, porCategoria] = await Promise.all([
    col.aggregate([{ $match: filtro }, { $group: { _id: '$resultado', n: { $sum: 1 } } }]).toArray(),
    col.aggregate([{ $match: filtro }, { $group: { _id: '$categoria', n: { $sum: 1 } } }]).toArray(),
  ]);
  const aObj = l => Object.fromEntries(l.filter(x => x._id).map(x => [x._id, x.n]));
  return { eventos, total, pagina, paginas, porPagina, resumen: { resultado: aObj(porResultado), categoria: aObj(porCategoria) } };
}

export const csvActividad = eventos => {
  const cols = ['en', 'categoria', 'tipo', 'accion', 'resultado', 'usuario', 'bazarId', 'pedidoId', 'prendaId', 'error', 'detalle'];
  const celda = v => `"${String(v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v).replace(/"/g, '""')}"`;
  return [cols.join(','), ...eventos.map(e => cols.map(c => celda(c === 'error' ? e.error?.mensaje : e[c])).join(','))].join('\n');
};
