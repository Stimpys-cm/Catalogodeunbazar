// ─────────────────────────────────────────────────────────────
//  api/_lib/rastreo.js — Rastreo automático de envíos · v42
//
//  Una vez al día (y con el botón "Revisar rastreo" del panel) se preguntan a
//  envia.com los estados de las guías generadas ahí y que aún no se entregan:
//    · Delivered        → el pedido pasa a "entregado" y se le manda correo al cliente
//    · Shipped / tránsito → si seguía "por enviar", pasa a "enviado"
//    · Pickup at Office → correo al cliente: recoge en la oficina de la paquetería
//    · Canceled / Delivered at Origin / devuelto → aviso urgente a la dueña
//  Solo se rastrean guías hechas con envia.com (su API no rastrea guías de fuera).
// ─────────────────────────────────────────────────────────────
import { tokenEnvia, esPrueba } from './envios.js';

const URL_ENVIOS = b => esPrueba(b) ? 'https://api-test.envia.com' : 'https://api.envia.com';
const HORA = 3600e3;

// Estado de envia.com (texto o id del catálogo) → lo que significa para Stiimpys
export function estadoRastreo(x) {
  const t = String(x?.status ?? x?.statusName ?? '').toLowerCase(), id = Number(x?.statusId ?? x?.status_id);
  if (id === 13 || /origin|origen|return|devuel/.test(t)) return 'devuelto';
  if (id === 3 || /^delivered|^entregado/.test(t)) return 'entregado';
  if (id === 12 || /pickup at office|oficina|ocurre/.test(t)) return 'oficina';
  if (id === 4 || /cancel/.test(t)) return 'cancelado';
  if (id === 2 || /shipped|transit|tr[aá]nsito|out for delivery|en ruta|recolectado|picked/.test(t)) return 'camino';
  if (id === 1 || /created|creado/.test(t)) return 'creado';
  return t ? 'otro' : null;
}

async function consultar(bazarId, guias) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(`${URL_ENVIOS(bazarId)}/ship/generaltrack/`, {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${tokenEnvia(bazarId)}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ trackingNumbers: guias }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(r.status === 401 || r.status === 403 ? 'envia.com rechazó el token.' : `envia.com respondió ${r.status}.`), { status: 502 });
    return Array.isArray(j?.data) ? j.data : [];
  } finally { clearTimeout(t); }
}

export async function revisarRastreos(db, bazar, { forzar = false, limite = 40 } = {}) {
  const bazarId = Number(bazar?.id) || 1;
  if (!tokenEnvia(bazarId)) return [];
  const hace = new Date(Date.now() - (forzar ? 10 * 60e3 : 6 * HORA)).toISOString();
  const pedidos = await db.collection('pedidos').find({
    bazarId, estado: 'pagado', entrega: 'envio', entregaEstado: { $in: ['pendiente', 'enviado'] }, 'guiaEnvia.guia': { $exists: true, $ne: '' },
    $or: [{ 'rastreoAuto.en': { $exists: false } }, { 'rastreoAuto.en': { $lt: hace } }],
  }).sort({ pagadoEn: 1 }).limit(limite).toArray();
  // La guía que se rastrea es la de envia.com, mientras no se haya escrito otra a mano
  const conGuia = pedidos.filter(p => p.guiaEnvia?.guia && (!p.guia || p.guia === p.guiaEnvia.guia));
  if (!conGuia.length) return [];
  const { historialPedido, pendiente, correoPedido } = await import('./crecer.js');
  const { invalidarSyncCache } = await import('./db.js');
  const hechos = [];
  for (let i = 0; i < conGuia.length; i += 20) {
    const grupo = conGuia.slice(i, i + 20);
    let datos;
    try { datos = await consultar(bazarId, grupo.map(p => p.guiaEnvia.guia)); }
    catch (e) { hechos.push({ tipo: 'error', texto: `Rastreo: ${e.message}` }); break; }
    const ahora = new Date().toISOString();
    for (const p of grupo) {
      const x = datos.find(d => String(d.trackingNumber || d.tracking_number || '').replace(/\s+/g, '') === p.guiaEnvia.guia);
      const est = x ? estadoRastreo(x) : null;
      const previo = p.rastreoAuto?.estado || null;
      await db.collection('pedidos').updateOne({ id: p.id }, { $set: { rastreoAuto: { estado: est || previo, texto: String(x?.status || '').slice(0, 60), en: ahora } } });
      if (!est || est === previo) continue;
      const paq = p.guiaEnvia.paqueteria || p.paqueteria || '';
      if (est === 'entregado') {
        const r = await db.collection('pedidos').updateOne({ id: p.id, estado: 'pagado', entregaEstado: { $ne: 'entregado' } },
          { $set: { entregaEstado: 'entregado', entregadoEn: ahora, estadoPor: 'rastreo automático' } });
        if (!r.modifiedCount) continue;
        await historialPedido(db, p, { accion: `${paq || 'La paquetería'} confirmó la entrega (rastreo automático)`, por: 'sistema', tipo: 'entrega.entregado', detalle: { guia: p.guiaEnvia.guia } });
        await correoPedido(db, p, 'entregado', { paqueteria: paq });
        hechos.push({ tipo: 'rastreo', texto: `Pedido ${p.id} entregado (${paq}).` });
      } else if (est === 'camino' && p.entregaEstado === 'pendiente') {
        const r = await db.collection('pedidos').updateOne({ id: p.id, entregaEstado: 'pendiente' },
          { $set: { entregaEstado: 'enviado', enviadoEn: ahora, paqueteria: paq, guia: p.guiaEnvia.guia, estadoPor: 'rastreo automático' } });
        if (!r.modifiedCount) continue;
        await historialPedido(db, p, { accion: `La paquetería recogió el paquete (rastreo automático)`, por: 'sistema', tipo: 'entrega.enviado' });
        await correoPedido(db, p, 'enviado', { paqueteria: paq, guia: p.guiaEnvia.guia });
        hechos.push({ tipo: 'rastreo', texto: `Pedido ${p.id} va en camino.` });
      } else if (est === 'oficina') {
        await correoPedido(db, p, 'oficina', { paqueteria: paq, guia: p.guiaEnvia.guia });
        await pendiente(db, bazarId, 'recuperar', `El paquete de ${String(p.nombre || '').split(' ')[0]} está en la oficina de ${paq}: avísale que lo recoja.`,
          { pedido: p.id, titulo: 'Paquete en oficina', cliente: p.nombre, detalle: `Guía ${p.guiaEnvia.guia}` }).catch(() => {});
        hechos.push({ tipo: 'rastreo', texto: `Pedido ${p.id}: en oficina de la paquetería.` });
      } else if (est === 'devuelto' || est === 'cancelado') {
        await pendiente(db, bazarId, 'venta', `⚠️ La guía ${p.guiaEnvia.guia} del pedido ${p.id} aparece como ${est === 'devuelto' ? 'devuelta al origen' : 'cancelada'}. Revisa con ${paq || 'la paquetería'}.`,
          { pedido: p.id, titulo: 'Problema con un envío', urgente: true, cliente: p.nombre }).catch(() => {});
        hechos.push({ tipo: 'rastreo', texto: `Pedido ${p.id}: guía ${est}.` });
      }
    }
  }
  if (hechos.some(h => h.tipo === 'rastreo')) invalidarSyncCache();
  return hechos;
}
