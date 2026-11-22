// ─────────────────────────────────────────────────────────────
//  api/_lib/carrito-avisos.js — "Algo de tu carrito cambió" por correo · v41
//
//  Lo corre la tarea diaria (api/acciones.js → ig-cron). Para cada cliente
//  con cuenta, correo y prendas en su carrito, compara cada prenda con cómo
//  estaba la última vez que se revisó (clientes.carritoVisto) y, si algo
//  cambió, le manda UN correo con todo junto:
//    · bajó de precio,
//    · otra persona la soltó y vuelve a estar libre,
//    · se vendió (para que no la espere).
//  La primera vez que se ve una prenda solo se anota (no hay aviso).
//
//  Cada correo trae un enlace para dejar de recibirlos (sin iniciar sesión,
//  firmado con SESSION_SECRET) y en Mi cuenta → Mi Carrito se apaga o prende.
//  Si Resend no está configurado no se manda nada y no se toca carritoVisto
//  (así, cuando se configure, los cambios siguen pendientes de avisar).
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { enviarCorreo, correoConfigurado, plantilla } from './correo.js';

const SITIO = () => (process.env.SITE_URL || 'https://stiimpys.store').replace(/\/$/, '');
const MAX_CORREOS = 300;                 // por corrida (el plan gratis de Resend da 3,000 al mes)
const pesos = n => '$' + Number(n || 0).toLocaleString('es-MX');

const secreto = () => process.env.SESSION_SECRET || process.env.MASTER_KEY || 'stiimpys';
export const firmaBaja = idCliente => crypto.createHmac('sha256', secreto()).update('baja-carrito:' + idCliente).digest('hex').slice(0, 32);
export function firmaBajaValida(idCliente, firma) {
  const a = Buffer.from(firmaBaja(idCliente)), b = Buffer.from(String(firma || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const enlaceBaja = idCliente => `${SITIO()}/api/cuenta?op=avisos-baja&c=${encodeURIComponent(idCliente)}&t=${firmaBaja(idCliente)}`;

// Cómo está una prenda ahora (lo que se compara entre un día y otro)
export function estadoPrenda(p, ahoraIso = new Date().toISOString()) {
  return {
    precio: Number(p.precio_venta) || 0,
    vendido: !!p.vendido,
    apartada: !p.vendido && !!p.apartada && (!p.reservedUntil || p.reservedUntil > ahoraIso),
    oculto: !!p.oculto,
  };
}

// Qué cambió desde la última vez (null si nada)
export function cambioPrenda(antes, ahora) {
  if (!antes || ahora.oculto) return null;
  if (!antes.vendido && ahora.vendido) return 'vendida';
  if (ahora.vendido) return null;
  if (ahora.precio > 0 && ahora.precio < antes.precio) return 'bajo';
  if (antes.apartada && !ahora.apartada) return 'libre';
  return null;
}

function correoCambios(cliente, cambios) {
  const nombre = String(cliente.nombre || '').split(' ')[0] || 'hola';
  const linea = c => {
    const link = `${SITIO()}/prenda.html?id=${encodeURIComponent(c.p.id)}`;
    const n = String(c.p.nombre || 'Una prenda');
    if (c.tipo === 'bajo') return { html: `<b>${esc(n)}</b> bajó de precio: <s>${pesos(c.antes.precio)}</s> → <b>${pesos(c.ahora.precio)}</b>. <a href="${link}">Verla</a>`, txt: `${n} bajó de ${pesos(c.antes.precio)} a ${pesos(c.ahora.precio)}: ${link}` };
    if (c.tipo === 'libre') return { html: `<b>${esc(n)}</b> volvió a estar disponible (alguien la soltó). <a href="${link}">Verla</a>`, txt: `${n} volvió a estar disponible: ${link}` };
    return { html: `<b>${esc(n)}</b> ya se vendió. Lo sentimos: cada prenda es única.`, txt: `${n} ya se vendió.` };
  };
  const filas = cambios.map(linea);
  const hayBuenas = cambios.some(c => c.tipo !== 'vendida');
  const asunto = cambios.length === 1
    ? (cambios[0].tipo === 'bajo' ? `Bajó de precio algo de tu carrito` : cambios[0].tipo === 'libre' ? 'Algo de tu carrito volvió a estar disponible' : 'Una prenda de tu carrito ya se vendió')
    : `${cambios.length} cambios en tu carrito de Stiimpys`;
  const html = plantilla({
    titulo: hayBuenas ? `${nombre}, algo de tu carrito cambió` : `${nombre}, una prenda de tu carrito se vendió`,
    cuerpo: `<ul style="padding-left:18px;margin:0">${filas.map(f => `<li style="margin:6px 0">${f.html}</li>`).join('')}</ul>
      <p style="margin-top:14px">Recuerda: el carrito no aparta. Se aparta para ti solo cuando tocas Pagar.</p>`,
    boton: hayBuenas ? 'Ir a mi carrito' : 'Ver más prendas',
    enlace: hayBuenas ? `${SITIO()}/carrito.html` : `${SITIO()}/tienda.html`,
    pie: `Te llega porque guardaste estas prendas en tu carrito con tu cuenta de Stiimpys. <a href="${enlaceBaja(cliente.id)}">No quiero estos avisos</a> (también se apagan en Mi cuenta → Mi Carrito).`,
  });
  const texto = `${filas.map(f => '• ' + f.txt).join('\n')}\n\nTu carrito: ${SITIO()}/carrito.html\nDejar de recibir estos avisos: ${enlaceBaja(cliente.id)}`;
  return { asunto, html, texto };
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function avisosCarrito(db) {
  if (!correoConfigurado()) return { enviados: 0, sinCorreo: true };
  const ahoraIso = new Date().toISOString();
  const inv = new Map((await db.collection('inventario').find({}).toArray()).map(p => [String(p.id), p]));
  const clientes = await db.collection('clientes').find({ avisosCarrito: { $ne: false } }).toArray();
  let enviados = 0, revisados = 0;
  for (const c of clientes) {
    const lista = Array.isArray(c.wishlist) ? c.wishlist.map(String) : [];
    if (!c.email || !lista.length) continue;
    revisados++;
    const visto = c.carritoVisto && typeof c.carritoVisto === 'object' ? c.carritoVisto : {};
    const nuevo = {}, cambios = [];
    for (const id of lista) {
      const p = inv.get(id);
      if (!p) continue;
      const ahora = estadoPrenda(p, ahoraIso);
      const tipo = cambioPrenda(visto[id], ahora);
      if (tipo) cambios.push({ tipo, p, antes: visto[id], ahora });
      nuevo[id] = ahora;
    }
    if (cambios.length && enviados < MAX_CORREOS) {
      const { asunto, html, texto } = correoCambios(c, cambios);
      const r = await enviarCorreo({ para: c.email, asunto, html, texto, contexto: { tipo: 'carrito' } });
      if (!r?.ok) continue;            // se vuelve a intentar mañana con los mismos cambios
      enviados++;
    } else if (cambios.length) continue; // tope de la corrida: queda para mañana
    await db.collection('clientes').updateOne({ id: c.id }, { $set: { carritoVisto: nuevo, ...(cambios.length ? { carritoAvisoEn: ahoraIso } : {}) } });
  }
  return { enviados, revisados };
}
