// api/_ventas.js
// ─────────────────────────────────────────────────────────────
// Helpers del ciclo de venta de STMP MARKET.
//
// El identificador que une a compradores y vendedores en toda la
// plataforma es el @username del comprador. Aquí vive todo lo que
// tocan a la vez el panel del bazar (marcar vendido) y la cuenta del
// comprador (mis compras, calificar).
//
// Colecciones:
//   ventas  { id, prendaId, bazarId, comprador, prenda:{...},
//             fecha, resenaBazar, resenaComprador }
//   resenas { id, ventaId, tipo:'bazar'|'comprador', bazarId,
//             estrellas, etiquetas[], comentario, creadoEn }
//
// Los archivos con "_" son helpers: no gastan Serverless Functions.
// ─────────────────────────────────────────────────────────────

import { getDB } from './_db.js';

export const ETIQUETAS_BAZAR = [
  'Envío rápido',
  'Prenda en excelente estado',
  'Buena atención',
  'Tal como se describe',
  'Buen precio',
];

export const ETIQUETAS_COMPRADOR = [
  'Pago puntual',
  'Buena comunicación',
  'Sin complicaciones',
  'Volvería a venderle',
];

// Un @username es minúsculas, sin arroba, sin espacios: así se puede
// comparar sin sorpresas entre el panel y la cuenta del comprador.
export function normalizarUsername(v) {
  return String(v ?? '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 30);
}

export function usernameValido(u) {
  return /^[a-z0-9._-]{3,30}$/.test(u);
}

// Propone un @username libre a partir del nombre o del correo.
export async function generarUsername(base) {
  const db  = await getDB();
  const col = db.collection('clientes');
  let raiz  = normalizarUsername(base) || 'user';
  if (raiz.length < 3) raiz = (raiz + 'user').slice(0, 8);

  for (let intento = 0; intento < 40; intento++) {
    const candidato = intento === 0 ? raiz : `${raiz}${intento + 1}`.slice(0, 30);
    const ocupado = await col.findOne({ username: candidato });
    if (!ocupado) return candidato;
  }
  return `${raiz}${Date.now().toString(36).slice(-5)}`.slice(0, 30);
}

// Siguiente id incremental de una colección (mismo patrón que el resto
// del proyecto: ids numéricos legibles en vez de ObjectId).
export async function siguienteId(nombreColeccion) {
  const db = await getDB();
  const ultimo = await db.collection(nombreColeccion)
    .find({}).sort({ id: -1 }).limit(1).toArray();
  return (ultimo[0]?.id || 0) + 1;
}

const num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// La compra guarda una foto del momento: si el bazar edita o borra la
// prenda después, el historial del comprador no se queda en blanco.
export function instantaneaPrenda(p) {
  return {
    id: p.id,
    nombre: String(p.nombre || 'Prenda'),
    marca: String(p.marca || ''),
    talla: String(p.talla || ''),
    estado: String(p.estado || ''),
    precio: num(p.precio_venta),
    imagenes: Array.isArray(p.imagenes) ? p.imagenes.slice(0, 3) : [],
  };
}

export function ventaPublica(v) {
  return {
    id: v.id,
    prendaId: v.prendaId,
    bazarId: v.bazarId,
    comprador: v.comprador,
    prenda: v.prenda || {},
    fecha: v.fecha,
    resenaBazar: !!v.resenaBazar,
    resenaComprador: !!v.resenaComprador,
  };
}

// Lo que se publica en la pestaña "Reseñas" de un bazar. Nunca sale el
// correo ni nada más de la cuenta: solo el @username.
export function resenaPublica(r) {
  return {
    id: r.id,
    tipo: r.tipo,
    bazarId: r.bazarId,
    ventaId: r.ventaId,
    prendaId: r.prendaId,
    prendaNombre: r.prendaNombre || '',
    autor: r.autor || '',
    destino: r.destino || '',
    estrellas: num(r.estrellas),
    etiquetas: Array.isArray(r.etiquetas) ? r.etiquetas : [],
    comentario: r.comentario || '',
    creadoEn: r.creadoEn,
  };
}

// Promedio y total de un conjunto de reseñas, redondeado a un decimal.
export function promedio(resenas) {
  const lista = (resenas || []).filter(r => num(r.estrellas) > 0);
  if (!lista.length) return { promedio: 0, total: 0 };
  const suma = lista.reduce((s, r) => s + num(r.estrellas), 0);
  return {
    promedio: Math.round((suma / lista.length) * 10) / 10,
    total: lista.length,
  };
}

// Índices (una sola vez por instancia serverless)
export async function asegurarIndices() {
  if (global._idxVentas) return;
  const db = await getDB();
  try { await db.collection('ventas').createIndex({ comprador: 1 }); } catch (_) {}
  try { await db.collection('ventas').createIndex({ bazarId: 1 }); } catch (_) {}
  try { await db.collection('ventas').createIndex({ prendaId: 1 }); } catch (_) {}
  try { await db.collection('resenas').createIndex({ bazarId: 1, tipo: 1 }); } catch (_) {}
  try { await db.collection('resenas').createIndex({ ventaId: 1, tipo: 1 }, { unique: true }); } catch (_) {}
  global._idxVentas = true;
}
