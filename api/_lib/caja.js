// ─────────────────────────────────────────────────────────────
//  api/_lib/caja.js — Punto de venta para bazares en persona · v42
//
//  Lo usa caja.html (Barrio Chido y cualquier evento donde Stiimpys venda
//  en persona). Requiere sesión del panel.
//
//   POST v-pos-venta   { idLocal, ids[], evento, metodo, descuento, recibido, cliente:{nombre,telefono} }
//        Vende varias prendas de un jalón. Cada prenda se marca vendida de forma
//        atómica (si otra persona la está pagando en línea, tiene anticipo o ya
//        se vendió, esa prenda NO se cobra y se avisa). idLocal hace la venta
//        idempotente: si la caja sin internet la reintenta, no se duplica.
//   GET  v-pos-resumen ?evento=…&dia=AAAA-MM-DD   → lo vendido en ese evento/día
//   POST v-pos-anular  { ticket }                  → regresa las prendas a la tienda
//
//  Cada prenda vendida queda en "ventas" con canal: 'bazar', evento, método de
//  pago, ticket y origen: 'bazar' (para el reporte de "de dónde vienen tus ventas").
// ─────────────────────────────────────────────────────────────
import { getDB, invalidarSyncCache } from './db.js';
import { requireAuth } from './auth.js';
import { mismoBazar, esGlobal } from './bazar.js';
import { siguienteId, instantaneaPrenda } from './ventas.js';
import { registrarEvento } from './actividad.js';
import { igAvisarVenta, igQuitarVenta } from './igSync.js';

export const OPS_CAJA = ['v-pos-venta', 'v-pos-resumen', 'v-pos-anular'];
const METODOS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta (terminal)', transferencia: 'Transferencia' };
const texto = (v, n = 80) => String(v ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const hoyMx = () => new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10);
export const skuDe = p => (p?.sku ? String(p.sku) : 'STI-' + String(p?.id ?? '').padStart(5, '0'));

// ¿Se puede vender ya? (no vendida, nadie pagándola en línea, sin anticipo)
function bloqueo(p, ahoraIso) {
  if (!p) return 'No existe';
  if (p.vendido) return 'Ya estaba vendida';
  if (p.apartada && p.reservedUntil && p.reservedUntil > ahoraIso) return 'Alguien la está pagando en línea en este momento';
  if (p.apartada && p.anticipo) return 'Está apartada con anticipo';
  return null;
}

export async function handleCaja(req, res, op) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const db = await getDB();

  if (op === 'v-pos-resumen') {
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dia || '')) ? req.query.dia : hoyMx();
    const ini = new Date(`${dia}T06:00:00.000Z`), fin = new Date(ini.getTime() + 864e5);
    const filtro = { canal: 'bazar', ...(req.query.evento ? { evento: texto(req.query.evento, 60) } : {}), ...(esGlobal(user) ? {} : { bazarId: Number(user.bazarId) }) };
    const ventas = (await db.collection('ventas').find(filtro).toArray()).filter(v => new Date(v.fecha) >= ini && new Date(v.fecha) < fin && !v.anulada);
    const porMetodo = {};
    for (const v of ventas) porMetodo[v.metodo || 'efectivo'] = (porMetodo[v.metodo || 'efectivo'] || 0) + (Number(v.precio) || 0);
    const tickets = [...new Set(ventas.map(v => v.ticket))];
    return res.status(200).json({ dia, prendas: ventas.length, tickets: tickets.length, total: ventas.reduce((t, v) => t + (Number(v.precio) || 0), 0), porMetodo,
      ultimas: ventas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 15).map(v => ({ ticket: v.ticket, nombre: v.prenda?.nombre, precio: v.precio, metodo: v.metodo, fecha: v.fecha })) });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });
  const b = req.body || {};

  if (op === 'v-pos-anular') {
    const ticket = texto(b.ticket, 40);
    const ventas = await db.collection('ventas').find({ ticket, canal: 'bazar', anulada: { $ne: true } }).toArray();
    if (!ventas.length) return res.status(404).json({ error: 'No encontré ese ticket.' });
    if (!ventas.every(v => mismoBazar(user, v.bazarId))) return res.status(403).json({ error: 'Ese ticket es de otro bazar.' });
    if (user.role !== 'admin' && ventas.some(v => Date.now() - new Date(v.fecha).getTime() > 12 * 3600e3)) return res.status(403).json({ error: 'Solo un administrador anula tickets de más de 12 horas.' });
    for (const v of ventas) {
      await db.collection('ventas').updateOne({ id: v.id }, { $set: { anulada: true, anuladaPor: user.username, anuladaEn: new Date().toISOString() } });
      await db.collection('inventario').updateOne({ id: v.prendaId, ventaId: v.id }, { $set: { vendido: false, apartada: false }, $unset: { vendidoA: '', vendidoEn: '', ventaId: '' } });
      // v55 · vuelve a estar a la venta: se quita el "VENDIDA" de Instagram
      const p = await db.collection('inventario').findOne({ id: v.prendaId });
      if (p?.instagramVendido && !p.vendido) { try { await igQuitarVenta(db, p, await db.collection('bazares').findOne({ id: Number(p.bazarId || 1) })); } catch {} }
    }
    invalidarSyncCache();
    await registrarEvento({ categoria: 'venta', tipo: 'caja.anular', usuario: user.username, accion: `Ticket ${ticket} anulado: ${ventas.length} prenda(s) regresan a la tienda` }, db);
    return res.status(200).json({ ok: true, regresan: ventas.map(v => v.prendaId) });
  }

  // ── v-pos-venta ──
  const idLocal = texto(b.idLocal, 60);
  if (!idLocal) return res.status(400).json({ error: 'Falta idLocal' });
  const ya = await db.collection('ventas').find({ idLocal }).toArray();
  if (ya.length) return res.status(200).json({ ok: true, repetida: true, ticket: ya[0].ticket, vendidas: ya.map(v => v.prendaId), rechazadas: [] });

  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 60);
  if (!ids.length) return res.status(400).json({ error: 'No hay prendas en el ticket.' });
  const metodo = METODOS[b.metodo] ? b.metodo : 'efectivo';
  const evento = texto(b.evento, 60) || 'Venta en persona';
  const cliente = { nombre: texto(b.cliente?.nombre, 60), telefono: String(b.cliente?.telefono || '').replace(/\D/g, '').slice(-10) };
  const ahora = new Date(), ahoraIso = ahora.toISOString();
  const ticket = 'T' + ahora.getTime().toString(36).toUpperCase().slice(-6) + Math.floor(Math.random() * 36 ** 2).toString(36).toUpperCase().padStart(2, '0');

  const prendas = await db.collection('inventario').find({ id: { $in: ids } }).toArray();
  const porId = new Map(prendas.map(p => [p.id, p]));
  const vendidas = [], rechazadas = [];
  for (const id of ids) {
    const p = porId.get(id);
    if (p && !mismoBazar(user, p.bazarId)) { rechazadas.push({ id, motivo: 'Es de otro bazar' }); continue; }
    const motivo = bloqueo(p, ahoraIso);
    if (motivo) { rechazadas.push({ id, nombre: p?.nombre, motivo }); continue; }
    const ventaId = await siguienteId('ventas');
    // Atómico: solo si sigue libre en este instante (nadie la tomó entre la lectura y aquí)
    const r = await db.collection('inventario').updateOne(
      { id, vendido: { $ne: true }, $or: [{ apartada: { $ne: true } }, { reservedUntil: { $lte: ahoraIso }, anticipo: { $exists: false } }] },
      { $set: { vendido: true, vendidoEn: ahora, ventaId, apartada: false, vendidoA: cliente.nombre ? cliente.nombre.split(' ')[0] : 'En persona' }, $unset: { reservedUntil: '', reservedBy: '' } });
    if (!r.modifiedCount) { rechazadas.push({ id, nombre: p.nombre, motivo: 'Se vendió o apartó en línea hace un momento' }); continue; }
    vendidas.push({ p, ventaId });
  }

  // Descuento del ticket (en pesos o %) repartido entre las prendas vendidas
  const subtotal = vendidas.reduce((t, x) => t + (Number(x.p.precio_venta) || 0), 0);
  let desc = 0;
  if (b.descuento && subtotal) {
    const d = b.descuento;
    desc = d.tipo === 'pct' ? Math.round(subtotal * Math.min(90, Math.max(0, Number(d.valor) || 0)) / 100) : Math.min(subtotal, Math.max(0, Math.round(Number(d.valor) || 0)));
  }
  let restante = desc;
  for (const [i, x] of vendidas.entries()) {
    const precioLista = Number(x.p.precio_venta) || 0;
    const parte = i === vendidas.length - 1 ? restante : Math.round(desc * precioLista / subtotal);
    restante -= parte;
    await db.collection('ventas').insertOne({
      id: x.ventaId, prendaId: x.p.id, bazarId: Number(x.p.bazarId || 1), comprador: null, vendedor: user.username,
      prenda: instantaneaPrenda(x.p), costo: Number(x.p.costo) || 0, precio: precioLista - parte, precioLista, descuento: parte,
      fecha: ahora, canal: 'bazar', origen: 'bazar', evento, metodo, ticket, idLocal, cliente: cliente.nombre || cliente.telefono ? cliente : null,
      resenaBazar: false, resenaComprador: false,
    });
  }
  if (vendidas.length) invalidarSyncCache();
  // v55 · Instagram: "VENDIDA" en el post de cada prenda (y en el carrusel del drop), como en las ventas en línea
  if (vendidas.length) {
    const bazares = new Map();
    await Promise.allSettled(vendidas.map(async x => {
      const bid = Number(x.p.bazarId || 1);
      if (!bazares.has(bid)) bazares.set(bid, db.collection('bazares').findOne({ id: bid }));
      const fresca = await db.collection('inventario').findOne({ id: x.p.id });
      if (fresca?.instagramId || fresca?.dropIgId) await igAvisarVenta(db, fresca, await bazares.get(bid), { origen: 'Caja' });
    }));
  }
  const total = subtotal - desc;
  const recibido = metodo === 'efectivo' ? Math.max(0, Number(b.recibido) || 0) : null;
  await registrarEvento({ categoria: 'venta', tipo: 'caja.venta', usuario: user.username, resultado: rechazadas.length ? 'parcial' : 'ok',
    accion: `${evento}: ticket ${ticket}, ${vendidas.length} prenda(s), $${total} (${METODOS[metodo]})${rechazadas.length ? `; ${rechazadas.length} no se pudieron vender` : ''}` }, db);
  // v43 · Ticket con extras (si el módulo está prendido y dejó su WhatsApp): link a la tienda,
  // su avance de cliente frecuente y su código para invitar amigos
  let extras = null;
  if (cliente.telefono.length === 10 && vendidas.length) {
    try {
      const { leerConfigTienda, frecuenteDe } = await import('./crecer.js');
      const bz = Number(vendidas[0].p.bazarId || 1), cfg = await leerConfigTienda(db, bz);
      if (cfg?.modulos?.cajaTicketWA === true) {
        extras = { tienda: `${(process.env.SITE_URL || 'https://stiimpys.store').replace(/\/$/, '')}/tienda.html?utm_source=qr&utm_medium=ticket` };
        const f = await frecuenteDe(db, cfg, bz, cliente.telefono);
        if (f) extras.frecuente = { faltan: f.aplica ? 0 : f.faltan, pct: f.pct };
        if (cfg.modulos.referidos === true) {
          const { codigoReferido } = await import('./extras.js');
          const r = await codigoReferido(db, bz, cliente.telefono, cliente.nombre);
          if (r) extras.referido = { codigo: r.codigo, pct: cfg.referidos.pctAmigo };
        }
      }
    } catch (e) { console.error('[caja extras]', e); }
  }
  return res.status(200).json({
    ok: true, ticket, evento, metodo, metodoNombre: METODOS[metodo], fecha: ahoraIso, extras,
    vendidas: vendidas.map(x => ({ id: x.p.id, sku: skuDe(x.p), nombre: x.p.nombre, talla: x.p.talla, precio: Number(x.p.precio_venta) || 0 })),
    rechazadas, subtotal, descuento: desc, total, recibido, cambio: recibido != null && recibido >= total ? recibido - total : null,
  });
}
