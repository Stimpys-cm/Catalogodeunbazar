// ─────────────────────────────────────────────────────────────
//  api/_lib/extras.js — Funciones para vender más · v43
//
//  Cada una tiene su interruptor en Ventas → Módulos (todas apagadas al
//  instalar). Aquí viven:
//    · Outfit: de qué tipo es cada prenda y el descuento por combinar.
//    · Referidos: código de cada cliente y premio para quien invita.
//    · Carritos olvidados: aviso con el WhatsApp listo en Pendientes.
//    · Resumen semanal: lo que se vendió, de dónde y qué conviene rebajar.
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';

const DIA = 864e5;
const hoyMx = (t = Date.now()) => new Date(t - 6 * 3600e3).toISOString().slice(0, 10);
const pesos = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');
const tel10 = t => String(t || '').replace(/\D/g, '').slice(-10);
const SITIO = () => (process.env.SITE_URL || 'https://stiimpys.store').replace(/\/$/, '');
const linkWA = (t, m) => `https://wa.me/52${tel10(t)}?text=${encodeURIComponent(m)}`;

// ── Outfit ─────────────────────────────────────────────────
const GRUPOS = [
  ['arriba', /playera|camiseta|camisa|sudadera|hoodie|chamarra|chaqueta|jersey|polo|\btop\b|chaleco|su[eé]ter|crewneck|tank|blusa|abrigo|rompevientos|tee\b|t-shirt/i],
  ['abajo', /pantal[oó]n|jeans?\b|short|bermuda|jogger|falda|cargo|baggy|denim/i],
  ['calzado', /tenis|zapat|bota|sneaker|sandalia|jordan|dunk/i],
  ['accesorio', /gorra|cachucha|sombrero|bolsa|mochila|cintur[oó]n|lentes|accesorio|calcet|bufanda|beanie|gorro|cartera|reloj|collar|pulsera/i],
];
// Primero se mira el nombre ("Pantalón cargo"); si no dice, las categorías
export function grupoPrenda(p) {
  const buscar = t => (GRUPOS.find(([, re]) => re.test(t || '')) || [])[0] || null;
  return buscar(p?.nombre) || buscar([...(Array.isArray(p?.categorias) ? p.categorias : []), p?.categoria].filter(Boolean).join(' '));
}
export const NOMBRE_GRUPO = { arriba: 'Arriba', abajo: 'Abajo', calzado: 'Tenis', accesorio: 'Accesorio' };
// Descuento por combinar: al menos 2 tipos distintos (p. ej. sudadera + pantalón)
export function aplicarOutfit(cuenta, prendas, cfg, activo) {
  if (!activo || !(cuenta.total > 0)) return cuenta;
  const grupos = new Set(prendas.map(grupoPrenda).filter(Boolean));
  if (grupos.size < 2) return cuenta;
  const d = Math.round((cuenta.subtotal - (cuenta.descVolumen || 0)) * (cfg.outfit?.pct || 5) / 100);
  return d > 0 ? { ...cuenta, descOutfit: d, total: Math.max(0, cuenta.total - d) } : cuenta;
}

// ── Referidos ──────────────────────────────────────────────
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const alAzar = n => [...crypto.randomBytes(n)].map(b => LETRAS[b % LETRAS.length]).join('');
// Código del cliente (uno por teléfono; se crea la primera vez que se pide)
export async function codigoReferido(db, bazarId, telefono, nombre) {
  const t = tel10(telefono); if (t.length !== 10) return null;
  const col = db.collection('referidos');
  const ya = await col.findOne({ bazarId, tel10: t });
  if (ya) return ya;
  const doc = { codigo: 'REF-' + alAzar(5), bazarId, tel10: t, nombre: String(nombre || '').split(' ')[0].slice(0, 30), invitados: 0, en: new Date().toISOString() };
  try { await col.insertOne(doc); } catch (_) { return col.findOne({ bazarId, tel10: t }); }
  return doc;
}
export async function cuponReferido(db, cfg, bazarId, codigo, telefono) {
  codigo = String(codigo || '').trim().toUpperCase();
  if (!/^REF-[A-Z0-9]{5}$/.test(codigo)) return null;
  if (cfg?.modulos?.referidos !== true) return { error: 'Por ahora no estamos usando códigos de amigos.' };
  const r = await db.collection('referidos').findOne({ codigo, bazarId });
  if (!r) return { error: 'Ese código no existe.' };
  const t = tel10(telefono);
  if (t && t === r.tel10) return { error: 'Ese es tu propio código: compártelo con tus amigos.' };
  if (t.length === 10) {
    const re = new RegExp(t + '$');
    const compras = await db.collection('pedidos').countDocuments({ bazarId, estado: { $in: ['pagado', 'apartado'] }, telefono: re });
    if (compras > 0) return { error: 'El código de amigo es para la primera compra.' };
  }
  return { cupon: { codigo, tipo: 'pct', valor: cfg.referidos?.pctAmigo || 10, minimo: 0, referido: true } };
}
// Cuando el amigo paga: premio para quien lo invitó (cupón personal que vale 60 días)
export async function premiarReferido(db, cfg, pedido) {
  const r = await db.collection('referidos').findOneAndUpdate({ codigo: pedido.cupon, bazarId: pedido.bazarId }, { $inc: { invitados: 1 } }, { returnDocument: 'after' });
  const ref = r && r.lastErrorObject ? r.value : r;
  if (!ref || tel10(pedido.telefono) === ref.tel10) return null;
  const codigo = 'REGALO-' + alAzar(6), vence = hoyMx(Date.now() + 60 * DIA), pct = cfg.referidos?.pctPremio || 10;
  await db.collection('cuponesPersonales').insertOne({ codigo, bazarId: pedido.bazarId, tel10: ref.tel10, valor: pct, vence, usado: false, motivo: 'referido', pedido: pedido.id, en: new Date().toISOString() });
  return { codigo, pct, vence, tel: ref.tel10, nombre: ref.nombre,
    whatsapp: linkWA(ref.tel10, `¡Hola ${ref.nombre || ''}! 🎁 Tu amigo ${String(pedido.nombre || '').split(' ')[0]} compró en Stiimpys con tu código. Te ganaste ${pct}% en tu próxima compra: ${codigo} (vale hasta el ${vence.split('-').reverse().join('/')}). ${SITIO()}/tienda.html`) };
}

// ── Carritos olvidados → WhatsApp en Pendientes ────────────
// Clientes con cuenta, WhatsApp y prendas disponibles en su carrito que no han
// comprado. Una vez cada 7 días por cliente; respeta "no quiero avisos".
export async function carritosWhatsApp(db, bazar, { pendiente }) {
  const hace7 = new Date(Date.now() - 7 * DIA).toISOString();
  const clientes = await db.collection('clientes').find({ telefono: { $exists: true, $ne: '' }, avisosCarrito: { $ne: false },
    $or: [{ carritoWA: { $exists: false } }, { carritoWA: { $lt: hace7 } }] }).limit(400).toArray();
  const hechos = [];
  for (const c of clientes) {
    if (hechos.length >= 25) break;
    const t = tel10(c.telefono); if (t.length !== 10) continue;
    const ids = (Array.isArray(c.wishlist) ? c.wishlist : []).map(x => Number(x?.id ?? x)).filter(Boolean).slice(0, 20);
    if (!ids.length) continue;
    const libres = (await db.collection('inventario').find({ id: { $in: ids }, vendido: { $ne: true }, oculto: { $ne: true } }).toArray())
      .filter(p => Number(p.bazarId || 1) === Number(bazar.id) && (!p.apartada || (p.reservedUntil && p.reservedUntil < new Date().toISOString())));
    if (!libres.length) continue;
    const compro = await db.collection('pedidos').findOne({ telefono: new RegExp(t + '$'), estado: { $in: ['pagado', 'apartado', 'pendiente'] }, en: { $gt: hace7 } });
    if (compro) continue;
    const primero = String(c.nombre || c.username || '').split(' ')[0];
    const lista = libres.slice(0, 3).map(p => `"${p.nombre}"`).join(', ') + (libres.length > 3 ? ` y ${libres.length - 3} más` : '');
    const link = `${SITIO()}/carrito.html?utm_source=whatsapp&utm_medium=carrito`;
    await pendiente(db, bazar.id, 'carrito', `${primero || 'Un cliente'} tiene ${libres.length} prenda(s) en su carrito sin comprar.`, {
      titulo: 'Carrito olvidado', cliente: primero, prendas: libres.slice(0, 5).map(p => p.nombre), monto: libres.reduce((s, p) => s + (Number(p.precio_venta) || 0), 0),
      whatsapp: linkWA(t, `¡Hola ${primero}! 👋 Vimos que dejaste ${lista} en tu carrito de Stiimpys. ${libres.length === 1 ? 'Sigue disponible, pero es pieza única' : 'Siguen disponibles, pero son piezas únicas'}. Aquí lo tienes: ${link}`) });
    await db.collection('clientes').updateOne({ _id: c._id }, { $set: { carritoWA: new Date().toISOString() } });
    hechos.push({ tipo: 'carrito', texto: `Carrito olvidado de ${primero || 'un cliente'} listo para WhatsApp.` });
  }
  return hechos;
}

// ── Resumen semanal ────────────────────────────────────────
export async function armarResumen(db, bazarId) {
  const ahora = Date.now(), ini = new Date(ahora - 7 * DIA), iniAnt = new Date(ahora - 14 * DIA);
  const ventas = (await db.collection('ventas').find({ bazarId, anulada: { $ne: true } }, { projection: { precio: 1, fecha: 1, canal: 1, origen: 1, pedido: 1 } }).toArray());
  const semana = ventas.filter(v => new Date(v.fecha) >= ini), antes = ventas.filter(v => new Date(v.fecha) >= iniAnt && new Date(v.fecha) < ini);
  const suma = l => l.reduce((t, v) => t + (Number(v.precio) || 0), 0);
  const porFuente = {};
  for (const v of semana) { const f = v.canal === 'bazar' ? 'bazar en persona' : v.pedido ? (v.origen || 'directo') : 'panel'; porFuente[f] = (porFuente[f] || 0) + (Number(v.precio) || 0); }
  const top = Object.entries(porFuente).sort((a, b) => b[1] - a[1]);
  const inv = await db.collection('inventario').find({ bazarId, vendido: { $ne: true }, oculto: { $ne: true } }, { projection: { id: 1, nombre: 1, precio_venta: 1, creadoEn: 1 } }).toArray();
  const viejas = inv.filter(p => p.creadoEn && ahora - new Date(p.creadoEn) > 45 * DIA).sort((a, b) => new Date(a.creadoEn) - new Date(b.creadoEn));
  const desde = hoyMx(ahora - 7 * DIA);
  const stats = await db.collection('prendaStats').find({ dia: { $gte: desde } }).toArray();
  const vistas = new Map(); for (const s of stats) vistas.set(s.prendaId, (vistas.get(s.prendaId) || 0) + (s.vista || 0));
  const miradas = inv.map(p => ({ ...p, v: vistas.get(p.id) || 0 })).filter(p => p.v >= 15).sort((a, b) => b.v - a.v).slice(0, 3);
  const porEntregar = await db.collection('pedidos').countDocuments({ bazarId, estado: 'pagado', entregaEstado: { $ne: 'entregado' } });
  const cambio = suma(antes) ? Math.round((suma(semana) - suma(antes)) / suma(antes) * 100) : null;
  const lineas = [
    `📊 Tu semana en Stiimpys`,
    `Vendiste ${semana.length} prenda(s) por ${pesos(suma(semana))}${cambio != null ? ` (${cambio >= 0 ? '+' : ''}${cambio}% vs. la semana pasada)` : ''}.`,
    top.length ? `Lo que más te vendió: ${top.slice(0, 3).map(([f, d]) => `${f} ${pesos(d)}`).join(' · ')}.` : 'Esta semana no hubo ventas registradas.',
    porEntregar ? `📦 Tienes ${porEntregar} pedido(s) por entregar.` : '',
    viejas.length ? `🏷️ ${viejas.length} prenda(s) llevan más de 45 días sin venderse. Prueba bajarles 10–15%: ${viejas.slice(0, 3).map(p => `${p.nombre} (${pesos(p.precio_venta)})`).join(', ')}.` : '',
    miradas.length ? `👀 Muy vistas y sin vender: ${miradas.map(p => `${p.nombre} (${p.v} visitas)`).join(', ')}. Súbelas a historias o mejora la foto.` : '',
  ].filter(Boolean);
  return { texto: lineas.join('\n'), ventas: semana.length, dinero: suma(semana), cambio, top, viejas: viejas.length, porEntregar };
}
export async function resumenSemanal(db, bazar, cfg, { forzar = false } = {}) {
  if (cfg?.modulos?.resumenSemanal !== true && !forzar) return [];
  const hoy = new Date(Date.now() - 6 * 3600e3);
  if (!forzar && hoy.getUTCDay() !== 1) return [];   // los lunes (hora de Reynosa)
  const semana = hoyMx();
  if (!forzar) {
    const r = await db.collection('bazares').updateOne({ id: bazar.id, resumenSemana: { $ne: semana } }, { $set: { resumenSemana: semana } });
    if (!r.modifiedCount) return [];
  }
  const res = await armarResumen(db, bazar.id);
  const { avisarDuena } = await import('./alertas.js');
  const r = await avisarDuena(db, { clave: `resumen:${semana}`, forzar, icono: '📊 ', titulo: 'Resumen semanal', texto: res.texto }).catch(() => null);
  return [{ tipo: 'resumen', texto: r?.ok ? 'Se mandó el resumen semanal.' : 'Resumen listo (no hay Telegram ni correo de avisos configurados).', enviado: !!r?.ok, resumen: res }];
}
