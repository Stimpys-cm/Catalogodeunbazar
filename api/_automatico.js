// ─────────────────────────────────────────────────────────────
//  Tareas automáticas de Instagram y del inventario
//
//  Las corre quien llegue primero:
//   · el cron de Vercel (1 vez al día, 9:00 a.m. Reynosa),
//   · un cron externo (cron-job.org) si lo configuras,
//   · el panel de Instagram al abrirse (ig-procesar).
//
//  Diarias (una sola vez por día por bazar, aunque las llamen varias veces):
//   1. Verificar que los posts sigan vivos.
//   2. Bajar precio a lo que lleva X días sin venderse.
//   3. Historias de "Nuevo ingreso" con lo que se subió en las últimas 24 h.
//  Siempre:
//   4. Liberar apartados vencidos.
//   5. Responder comentarios con palabras clave (cada 4 min como máximo).
// ─────────────────────────────────────────────────────────────
import { invalidarSyncCache } from './_db.js';
import { avisarListaEspera, respaldoSemanal, pendiente, cerrarPedidoVencido, avisarApartadoVencido } from './_crecer.js';
import {
  configInstagram, credencialesInstagram, todasLasPublicaciones, postVivo, perfil, comentarios,
  responderComentario, textoRespuesta, publicarHistoria, imagenHistoriaDisponible, imagenHistoriaRebaja, comentarEnPost,
} from './_instagram.js';

const HORA = 3600 * 1000, DIA = 24 * HORA;
const hoyReynosa = () => new Date(Date.now() - 6 * HORA).toISOString().slice(0, 10);
const SITIO = (process.env.SITE_URL || 'https://stiimpys.store').replace(/\/$/, '');
const sinAcentos = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const redondear = n => Math.max(10, Math.round(n / 10) * 10);

async function anotar(db, bazar, tipo, texto, extra = {}) {
  const doc = { bazarId: bazar.id, tipo, texto, en: new Date().toISOString(), ...extra };
  try { await db.collection('automaticoLog').insertOne(doc); } catch {}
  return doc;
}

export async function correrAutomatico(db, bazar, { forzarDiario = false } = {}) {
  const cfg  = configInstagram(bazar).automatico;
  const cred = credencialesInstagram(bazar);
  const hechos = [];

  hechos.push(...await liberarApartados(db, bazar));
  try { hechos.push(...(await avisarListaEspera(db, bazar)).map(p => ({ tipo: 'aviso', texto: p.texto }))); }
  catch (e) { hechos.push(await anotar(db, bazar, 'error', `Lista de espera: ${e.message}`)); }

  if (cred && cfg.respuestas) {
    const hace4 = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    // Toma el turno de forma atómica: si dos llamadas llegan juntas, solo una responde
    const turno = await db.collection('bazares').updateOne(
      { id: bazar.id, autoRespEn: { $lt: hace4 } }, { $set: { autoRespEn: new Date().toISOString() } });
    const primera = !bazar.autoRespEn && (await db.collection('bazares').updateOne(
      { id: bazar.id, autoRespEn: { $exists: false } }, { $set: { autoRespEn: new Date().toISOString() } })).modifiedCount;
    if (turno.modifiedCount || primera) {
      try { hechos.push(...await responderComentarios(db, bazar, cfg)); }
      catch (e) { hechos.push(await anotar(db, bazar, 'error', `Respuestas: ${e.message}`)); }
    }
  }

  const hoy = hoyReynosa();
  let toca = forzarDiario;
  if (!toca) {
    const r = await db.collection('bazares').updateOne({ id: bazar.id, autoDiario: { $ne: hoy } }, { $set: { autoDiario: hoy } });
    toca = !!r.modifiedCount;
  }
  if (toca) {
    const pasos = [
      ['Verificar posts', () => cred && cfg.verificarPosts ? verificarPosts(db, bazar) : []],
      ['Rebajas',         () => cfg.rebaja ? aplicarRebajas(db, bazar, cfg, !!cred) : []],
      ['Historias',       () => cred && cfg.historiaNuevas ? historiasNuevas(db, bazar, cfg) : []],
      ['Respaldo',        async () => (await respaldoSemanal(db, bazar.id)) ? [await anotar(db, bazar, 'respaldo', 'Se guardó la copia semanal de tu inventario y ventas.')] : []],
    ];
    for (const [nombre, fn] of pasos) {
      try { hechos.push(...await fn()); }
      catch (e) { hechos.push(await anotar(db, bazar, 'error', `${nombre}: ${e.message}`)); }
    }
  }
  if (hechos.length) invalidarSyncCache();
  return hechos;
}

// 1 · Posts que ya no existen → se desligan de la prenda
export async function verificarPosts(db, bazar) {
  const inv = db.collection('inventario');
  const prendas = await inv.find({ bazarId: bazar.id, instagramId: { $exists: true } }).toArray();
  const ligadas = prendas.filter(p => p.instagramId);
  if (!ligadas.length) return [];
  const enCuenta = new Set((await todasLasPublicaciones(bazar, 3000)).map(p => p.id));
  const out = [];
  for (const p of ligadas) {
    if (enCuenta.has(p.instagramId)) continue;
    if (await postVivo(bazar, p.instagramId) !== false) continue;   // doble revisión
    await inv.updateOne({ id: p.id }, { $unset: { instagramId: '', instagramUrl: '', instagramEn: '' } });
    out.push(await anotar(db, bazar, 'post-borrado', `El post de "${p.nombre}" ya no existe en Instagram: se desligó${p.vendido ? '' : '. Puedes volver a publicarla'}.`, { prendaId: p.id }));
  }
  return out;
}

// 2 · Rebajas automáticas
export async function aplicarRebajas(db, bazar, cfg, conInstagram) {
  const inv = db.collection('inventario');
  const lista = await inv.find({ bazarId: bazar.id, vendido: false }).toArray();
  const limite = Date.now() - cfg.rebajaDias * DIA;
  const out = [];
  for (const p of lista) {
    if (out.length >= 10) break;                                    // máx. 10 al día
    if (p.oculto || p.apartada || p.subasta || p.enSubasta) continue;
    if ((p.rebajasAuto || 0) >= cfg.rebajaVeces) continue;
    const desde = new Date(p.ultimaRebaja || p.creadoEn || 0).getTime();
    if (!desde || desde > limite) continue;
    const antes = Number(p.precio_venta) || 0;
    const nuevo = Math.max(cfg.rebajaMin, redondear(antes * (1 - cfg.rebajaPct / 100)));
    if (!(nuevo < antes)) continue;
    await inv.updateOne({ id: p.id }, { $set: {
      precio_venta: nuevo, precioAnterior: p.precioAnterior && p.precioAnterior > antes ? p.precioAnterior : antes,
      rebajasAuto: (p.rebajasAuto || 0) + 1, ultimaRebaja: new Date().toISOString(),
    } });
    const prenda = { ...p, precio_venta: nuevo };
    let extra = '';
    if (conInstagram && cfg.rebajaComentar && p.instagramId && await postVivo(bazar, p.instagramId)) {
      try {
        await responderAlPost(bazar, p.instagramId,
          `🔥 NUEVO PRECIO: $${nuevo.toLocaleString('es-MX')} MXN (antes $${antes.toLocaleString('es-MX')})\nApártala en ${SITIO.replace(/^https?:\/\//, '')}/prenda.html?id=${p.id} 🛒`);
        extra += ' · comentado en el post';
      } catch (e) { extra += ` · no se pudo comentar (${e.message})`; }
    }
    if (conInstagram && cfg.rebajaHistoria) {
      const img = imagenHistoriaRebaja(prenda, bazar, antes);
      if (img) { try { await publicarHistoria(bazar, img); extra += ' · historia publicada'; } catch {} }
    }
    out.push(await anotar(db, bazar, 'rebaja', `"${p.nombre}" bajó de $${antes} a $${nuevo}${extra}.`, { prendaId: p.id }));
  }
  return out;
}

const responderAlPost = (bazar, mediaId, texto) => comentarEnPost(bazar, mediaId, texto);

// 3 · Historias de lo nuevo (últimas 24 h)
export async function historiasNuevas(db, bazar, cfg) {
  const inv = db.collection('inventario');
  const desde = new Date(Date.now() - DIA).toISOString();
  const lista = (await inv.find({ bazarId: bazar.id, vendido: false }).toArray())
    .filter(p => !p.oculto && !p.historiaNuevaEn && (p.creadoEn || '') >= desde)
    .sort((a, b) => (a.creadoEn > b.creadoEn ? 1 : -1))
    .slice(0, cfg.historiaNuevasMax);
  const out = [];
  for (const p of lista) {
    const img = imagenHistoriaDisponible(p, bazar);
    if (!img) continue;
    try {
      await publicarHistoria(bazar, img);
      await inv.updateOne({ id: p.id }, { $set: { historiaNuevaEn: new Date().toISOString() } });
      out.push(await anotar(db, bazar, 'historia', `Historia de "Nuevo ingreso": ${p.nombre}.`, { prendaId: p.id }));
    } catch (e) { out.push(await anotar(db, bazar, 'error', `Historia de ${p.nombre}: ${e.message}`)); }
  }
  return out;
}

// 4 · Apartados vencidos
export async function liberarApartados(db, bazar) {
  const inv = db.collection('inventario');
  const ahora = new Date().toISOString();
  const vencidos = (await inv.find({ bazarId: bazar.id, apartada: true }).toArray())
    .filter(p => !p.vendido && p.reservedUntil && p.reservedUntil < ahora);
  const out = [];
  for (const p of vencidos) {
    const c = { ...(p.reservedBy || {}) };
    // Apartado con anticipo: ya pagó una parte, así que no se suelta solo; se avisa para decidir
    if (c.anticipo && c.pedido) { try { await avisarApartadoVencido(db, c.pedido); } catch (e) { console.error('[apartado vencido]', e); } continue; }
    // Pago en línea sin terminar: si sí pagó (aviso perdido) ya quedó vendida
    if (['clip', 'paypal', 'mercadopago'].includes(c.canal) && c.pedido) {
      if (await cerrarPedidoVencido(db, c.pedido)) continue;
      await inv.updateOne({ id: p.id }, { $set: { apartada: false }, $unset: { reservedUntil: '', reservedBy: '' } });
      continue;
    }
    await inv.updateOne({ id: p.id }, { $set: { apartada: false }, $unset: { reservedUntil: '', reservedBy: '' } });
    const tel = String(c.telefono || '').replace(/\D/g, '');
    const msg = `Hola${c.nombre ? ' ' + c.nombre : ''} 👋 Tu apartado de "${p.nombre}" en Stiimpys venció y la prenda volvió a estar disponible. Si todavía la quieres, avísanos y te la apartamos de nuevo 🙌`;
    const wa = tel ? `https://wa.me/${tel.length === 10 ? '52' + tel : tel}?text=${encodeURIComponent(msg)}` : null;
    out.push(await anotar(db, bazar, 'apartado', `Se liberó "${p.nombre}" (apartado de ${c.nombre || 'cliente'} venció).`, { prendaId: p.id, whatsapp: wa }));
    try { await pendiente(db, bazar.id, 'apartado', `Venció el apartado de ${c.nombre || 'un cliente'}: "${p.nombre}" volvió a estar disponible.`,
      { whatsapp: wa, prendaId: p.id, titulo: 'Apartado vencido', cliente: c.nombre || '', monto: Number(p.precio_venta) || null, detalle: `"${p.nombre}" volvió a estar disponible.` }); } catch {}
  }
  return out;
}

// 5 · Respuestas automáticas a comentarios con palabras clave
export function coincidePalabra(texto, palabras) {
  const t = ' ' + sinAcentos(texto).replace(/[^a-z0-9ñ]+/g, ' ') + ' ';
  return palabras.some(p => p && t.includes(' ' + p + ' '));
}

export async function responderComentarios(db, bazar, cfg) {
  const inv = db.collection('inventario');
  const hechos = db.collection('igRespondidos');
  const palabras = cfg.respuestaPalabras.split(',').map(x => sinAcentos(x).trim()).filter(Boolean);
  const yo = (await perfil(bazar)).username;
  const prendas = (await inv.find({ bazarId: bazar.id, instagramId: { $exists: true } }).toArray())
    .filter(p => p.instagramId)
    .sort((a, b) => ((b.instagramEn || b.creadoEn || '') > (a.instagramEn || a.creadoEn || '') ? 1 : -1))
    .slice(0, 30);
  const hace7 = Date.now() - 7 * DIA;
  const out = [];
  for (const p of prendas) {
    if (out.length >= 10) break;
    let coms;
    try { coms = await comentarios(bazar, p.instagramId); } catch { continue; }
    for (const c of coms) {
      if (out.length >= 10) break;
      if (!c.id || c.username === yo || c.hidden) continue;
      if (new Date(c.timestamp || 0).getTime() < hace7) continue;
      if ((c.replies?.data || []).some(r => r.username === yo)) continue;
      if (!coincidePalabra(c.text, palabras)) continue;
      if (await hechos.findOne({ comentarioId: c.id })) continue;
      await hechos.insertOne({ comentarioId: c.id, bazarId: bazar.id, en: new Date().toISOString() });
      const texto = textoRespuesta(p.vendido ? cfg.respuestaVendida : cfg.respuestaTexto, p, c.username);
      try {
        await responderComentario(bazar, c.id, texto);
        out.push(await anotar(db, bazar, 'respuesta', `Respondí a @${c.username} en "${p.nombre}": "${String(c.text).slice(0, 60)}"`, { prendaId: p.id }));
      } catch (e) { out.push(await anotar(db, bazar, 'error', `No pude responder a @${c.username}: ${e.message}`)); }
    }
  }
  return out;
}
