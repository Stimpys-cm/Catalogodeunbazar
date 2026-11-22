// ─────────────────────────────────────────────────────────────
//  api/_lib/sistema.js — Monitor, Centro de actividad e historial de pedidos · v33
//
//  Vive dentro de /api/acciones (no es una función nueva: siguen 12).
//    GET  v-actividad        ?categoria&resultado&usuario&desde&hasta&q&pedido&prenda&pagina&porPagina&formato=csv
//    GET  v-sistema          ?fresco=1   → servicios, últimos movimientos, pendientes, errores, inconsistencias
//    POST v-sistema-reparar  { tipo: soltar-apartado|reapartar|revisar-pedido, prendaId?, pedidoId? }
//    GET  v-pedido-historial ?id=        → historial, estado real de cada prenda y eventos relacionados
//
//  Permisos: actividad, monitor y reparar → solo administradores (cada admin de bazar ve
//  solo su bazar; el admin principal ve todo). Historial de un pedido → cualquier
//  usuario del mismo bazar (es lo mismo que ya ve en Pedidos en línea).
//  Nada aquí crea cobros ni da por pagado algo: los pagos solo se consultan.
// ─────────────────────────────────────────────────────────────
import { getDB, invalidarSyncCache } from './db.js';
import { requireAuth } from './auth.js';
import { esGlobal, mismoBazar } from './bazar.js';
import {
  CATEGORIAS, RESULTADOS, filtroActividad, consultarActividad, csvActividad, leerSistema, textoSeguro, registrarEvento, conBloqueo,
} from './actividad.js';
import {
  alertasPedido, revisarPagoDePedido, cerrarPedidoVencido, historialPedido, clipConfigurado, clipPing,
} from './crecer.js';
import { paypalListo, paypalPing } from './paypal.js';

export const OPS_SISTEMA = ['v-actividad', 'v-sistema', 'v-sistema-reparar', 'v-pedido-historial', 'v-avisos-prueba'];
const DIA = 864e5;
const ESTADO = { ok: 'operativo', deg: 'degradado', mal: 'no disponible', sin: 'sin configurar' };

export async function handleSistema(req, res, op) {
  const user = await requireAuth(req, res);
  if (!user) return;
  const db = await getDB();
  const global_ = esGlobal(user);
  const bazarId = global_ ? (Number(req.query.bazarId || req.body?.bazarId) || null) : Number(user.bazarId);
  const filtroBazar = bazarId ? { bazarId } : {};
  res.setHeader('Cache-Control', 'no-store');

  if (op === 'v-pedido-historial') return historialDePedido(req, res, db, user);

  if (user.role !== 'admin') return res.status(403).json({ error: 'Solo un administrador ve el monitor y el registro de actividad.' });

  if (op === 'v-actividad') {
    const filtro = filtroActividad(req.query, user, global_);
    if (req.query.formato === 'csv') {
      // hasta 2,000 renglones en el CSV
      const todos = await db.collection('actividad').find(filtro, { projection: { _id: 0, expira: 0 } }).sort({ en: -1 }).limit(2000).toArray();
      await registrarEvento({ categoria: 'admin', tipo: 'actividad.exportar', usuario: user.username, rol: user.role, bazarId: user.bazarId,
        accion: `Exportó ${todos.length} eventos del Centro de actividad`, detalle: { filtros: Object.keys(req.query).filter(k => !['op', 'formato'].includes(k)) } }, db);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="actividad-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.status(200).send('﻿' + csvActividad(todos));
    }
    const r = await consultarActividad(db, filtro, { pagina: req.query.pagina, porPagina: req.query.porPagina });
    // Lista de usuarios para el filtro (de los últimos 30 días, del mismo alcance)
    const base = global_ ? (bazarId ? { bazarId } : {}) : { bazarId: Number(user.bazarId) };
    const usuarios = (await db.collection('actividad').distinct('usuario', { ...base, en: { $gte: new Date(Date.now() - 30 * DIA).toISOString() } })).sort().slice(0, 100);
    return res.status(200).json({ ...r, usuarios, categorias: CATEGORIAS, resultados: RESULTADOS, global: global_ });
  }

  if (op === 'v-sistema') return monitor(req, res, db, user, global_, filtroBazar);

  // v41 · Probar los avisos al celular / correo
  if (op === 'v-avisos-prueba') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });
    const { probarAvisos, telegramListo, correoAvisosListo } = await import('./alertas.js');
    const r = await probarAvisos(db);
    return res.status(200).json({ ...r, telegramListo: telegramListo(), correoListo: correoAvisosListo() });
  }

  if (op === 'v-sistema-reparar') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });
    return reparar(req, res, db, user);
  }
  return res.status(400).json({ error: 'op no reconocida' });
}

// ═════════════════════════════════════════════════════════════
//  Monitor
// ═════════════════════════════════════════════════════════════
const _cacheMonitor = new Map();   // por bazar, 30 s
// Espera la promesa a lo más `ms`; si no contesta, falla con "No contestó en N segundos"
async function conLimite(promesa, ms) {
  let t; const tope = new Promise((_, no) => { t = setTimeout(() => no(Object.assign(new Error(`No contestó en ${Math.round(ms / 1000)} segundos`), { name: 'Tiempo' })), ms); });
  try { return await Promise.race([promesa, tope]); } finally { clearTimeout(t); }
}
async function pedirJSON(url, opciones = {}, ms = 4000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...opciones, signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j, ms: Date.now() - t0 };
  } finally { clearTimeout(t); }
}
const lento = (e) => e?.name === 'AbortError' ? 'No contestó en 4 segundos' : textoSeguro(e?.message || e, 160);

async function revisarMongo(db) {
  const t0 = Date.now();
  try {
    await conLimite(db.command({ ping: 1 }), 4000);
    const ms = Date.now() - t0;
    const fallas = (global._fallasRecientes || []).filter(f => f.mongo && Date.now() - new Date(f.en) < 15 * 60e3).length;
    return { id: 'mongo', nombre: 'MongoDB Atlas', estado: ms > 1500 || fallas ? ESTADO.deg : ESTADO.ok, ms,
      detalle: ms > 1500 ? `Responde lento (${ms} ms)` : fallas ? `${fallas} error(es) de MongoDB en los últimos 15 minutos` : `Responde en ${ms} ms` };
  } catch (e) {
    return { id: 'mongo', nombre: 'MongoDB Atlas', estado: ESTADO.mal, detalle: lento(e) };
  }
}

async function revisarClip(db, bazarId) {
  const s = { id: 'clip', nombre: 'Clip (cobro con tarjeta)' };
  if (!clipConfigurado(bazarId)) return { ...s, estado: ESTADO.sin, detalle: 'Faltan CLIP_API_KEY y CLIP_SECRET_KEY en Vercel.' };
  try {
    const ult = (await db.collection('pedidos').find({ bazarId, clipId: { $exists: true, $ne: null } }).sort({ en: -1 }).limit(1).toArray())[0];
    const r = await clipPing(bazarId, ult?.clipId);
    if (r.status === 401 || r.status === 403) return { ...s, estado: ESTADO.mal, ms: r.ms, detalle: 'Clip rechazó las credenciales (revisa CLIP_API_KEY y CLIP_SECRET_KEY).' };
    if (r.status >= 500 || r.status === 429) return { ...s, estado: ESTADO.deg, ms: r.ms, detalle: `Clip respondió ${r.status}: puede haber fallas al abrir pagos.` };
    const errores = await db.collection('actividad').countDocuments({ categoria: 'pago', resultado: 'error', bazarId, en: { $gte: new Date(Date.now() - DIA).toISOString() }, tipo: /^clip\./ });
    if (errores >= 3) return { ...s, estado: ESTADO.deg, ms: r.ms, detalle: `Credenciales aceptadas, pero hubo ${errores} errores de Clip en las últimas 24 horas.` };
    return { ...s, estado: ESTADO.ok, ms: r.ms, detalle: `Credenciales aceptadas (${r.ms} ms)${errores ? ` · ${errores} error(es) en 24 h` : ''}.` };
  } catch (e) {
    return { ...s, estado: ESTADO.deg, detalle: `No se pudo comprobar: ${lento(e)}` };
  }
}

async function revisarPaypal(bazarId) {
  const s = { id: 'paypal', nombre: 'PayPal (opcional)' };
  if (!paypalListo(bazarId)) return { ...s, estado: ESTADO.sin, detalle: 'No está conectado (es opcional).' };
  const t0 = Date.now();
  try { await conLimite(paypalPing(bazarId), 4000); return { ...s, estado: ESTADO.ok, ms: Date.now() - t0, detalle: 'Credenciales aceptadas.' }; }
  catch (e) { return { ...s, estado: /credenciales/i.test(e?.message || '') ? ESTADO.mal : ESTADO.deg, detalle: lento(e) }; }
}

async function revisarResend(db) {
  const s = { id: 'resend', nombre: 'Resend (correos)' };
  const clave = process.env.RESEND_API_KEY, desde = process.env.CORREO_DESDE;
  if (!clave || !desde) return { ...s, estado: ESTADO.sin, detalle: 'Faltan RESEND_API_KEY y CORREO_DESDE: los recibos no se mandan por correo (lo demás funciona igual).' };
  let base;
  try {
    const r = await pedirJSON('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${clave}` } });
    const dominio = (String(desde).match(/@([^>\s]+)/) || [])[1]?.toLowerCase();
    if (r.status === 200) {
      const d = (r.j?.data || []).find(x => String(x.name).toLowerCase() === dominio);
      base = !d ? { estado: ESTADO.deg, detalle: `El dominio ${dominio || 'de CORREO_DESDE'} no está agregado en Resend.` }
        : d.status === 'verified' ? { estado: ESTADO.ok, detalle: `Dominio ${dominio} verificado.` }
        : { estado: ESTADO.deg, detalle: `El dominio ${dominio} está "${d.status}" en Resend: verifica sus registros DNS.` };
    } else if (r.status === 401 && /restricted/i.test(`${r.j?.name} ${r.j?.message}`)) {
      base = { estado: ESTADO.ok, detalle: 'Clave válida (solo de envío).' };
    } else if (r.status === 401 || r.status === 403) {
      base = { estado: ESTADO.mal, detalle: 'Resend rechazó la clave (revisa RESEND_API_KEY).' };
    } else base = { estado: ESTADO.deg, detalle: `Resend respondió ${r.status}.` };
    base.ms = r.ms;
  } catch (e) { base = { estado: ESTADO.deg, detalle: `No se pudo comprobar: ${lento(e)}` }; }
  // El último envío real manda: si falló y no ha salido uno bien después, está degradado
  const ult = (await db.collection('actividad').find({ categoria: 'correo' }).sort({ en: -1 }).limit(1).toArray())[0];
  if (ult?.resultado === 'error' && base.estado === ESTADO.ok) return { ...s, ...base, estado: ESTADO.deg, detalle: `${base.detalle} Pero el último correo falló: ${ult.error?.mensaje || 'sin detalle'}.` };
  return { ...s, ...base };
}

async function revisarCloudinary() {
  const s = { id: 'cloudinary', nombre: 'Cloudinary (fotos)' };
  const nube = process.env.CLOUDINARY_CLOUD_NAME, key = process.env.CLOUDINARY_API_KEY, secreto = process.env.CLOUDINARY_API_SECRET;
  if (!nube || !key || !secreto) return { ...s, estado: ESTADO.sin, detalle: 'Faltan variables CLOUDINARY_* en Vercel: no se pueden subir fotos.' };
  try {
    const r = await pedirJSON(`https://api.cloudinary.com/v1_1/${encodeURIComponent(nube)}/ping`,
      { headers: { Authorization: 'Basic ' + Buffer.from(`${key}:${secreto}`).toString('base64') } });
    if (r.status === 200) return { ...s, estado: ESTADO.ok, ms: r.ms, detalle: `Responde en ${r.ms} ms.` };
    if (r.status === 401 || r.status === 403) return { ...s, estado: ESTADO.mal, ms: r.ms, detalle: 'Cloudinary rechazó las credenciales.' };
    if (r.status === 420 || r.status === 429) return { ...s, estado: ESTADO.deg, ms: r.ms, detalle: 'Se alcanzó el límite de consultas de Cloudinary por hora.' };
    return { ...s, estado: ESTADO.deg, ms: r.ms, detalle: `Cloudinary respondió ${r.status}.` };
  } catch (e) { return { ...s, estado: ESTADO.deg, detalle: `No se pudo comprobar: ${lento(e)}` }; }
}

async function monitor(req, res, db, user, global_, filtroBazar) {
  const clave = `${filtroBazar.bazarId || 'todo'}`;
  const guardado = _cacheMonitor.get(clave);
  if (guardado && req.query.fresco !== '1' && Date.now() - guardado.t < 30e3) return res.status(200).json({ ...guardado.datos, deCache: true });

  const bazarPagos = filtroBazar.bazarId || 1;
  const ahora = Date.now(), ahoraIso = new Date(ahora).toISOString();
  const hace24 = new Date(ahora - DIA).toISOString();

  const [mongo, clip, paypal, resend, cloudinary] = await Promise.all([
    revisarMongo(db), revisarClip(db, bazarPagos), revisarPaypal(bazarPagos), revisarResend(db), revisarCloudinary(),
  ]);
  const servicios = [mongo, clip, resend, cloudinary, paypal];

  // Si Mongo no contesta, no se puede leer nada más
  if (mongo.estado === ESTADO.mal) {
    return res.status(200).json({ generado: ahoraIso, general: 'no disponible', servicios, ultimas: {}, pendientes: {}, errores: { recientes: [], ultimas24h: null, memoria: global._fallasRecientes || [] }, inconsistencias: [] });
  }

  const ped = db.collection('pedidos'), inv = db.collection('inventario'), act = db.collection('actividad');
  const fAct = global_ && !filtroBazar.bazarId ? {} : { bazarId: filtroBazar.bazarId };
  const [marcas, ultimaActividad, errores24, erroresRecientes, erroresCliente, avisos, pedidosVivos] = await Promise.all([
    leerSistema(db),
    act.find(fAct).sort({ en: -1 }).limit(1).toArray(),
    act.countDocuments({ ...fAct, resultado: 'error', en: { $gte: hace24 } }),
    act.find({ ...fAct, resultado: 'error' }, { projection: { _id: 0, expira: 0 } }).sort({ en: -1 }).limit(8).toArray(),
    db.collection('erroresCliente').countDocuments({ ...(filtroBazar.bazarId ? { bazarId: filtroBazar.bazarId } : {}), en: { $gte: hace24 } }),
    db.collection('pendientes').countDocuments({ ...filtroBazar, hecho: false }),
    ped.find({ ...filtroBazar, estado: { $in: ['pendiente', 'apartado', 'pagado', 'expirado', 'cancelado', 'reemplazado'] }, en: { $gte: new Date(ahora - 60 * DIA).toISOString() } })
      .sort({ en: -1 }).limit(600).toArray(),
  ]);

  const conAlerta = pedidosVivos.map(p => ({ p, a: alertasPedido(p, ahora) })).filter(x => x.a.length);
  const cuantos = t => conAlerta.filter(x => x.a.some(a => a.tipo === t)).length;
  const resumenPed = p => ({ id: p.id, nombre: String(p.nombre || '').split(' ')[0], estado: p.estado, total: p.total, en: p.en, alertas: alertasPedido(p, ahora) });
  const pendientes = {
    avisos,
    pagandoAhora: pedidosVivos.filter(p => p.estado === 'pendiente' && p.expira && p.expira > ahoraIso).length,
    pagosSinCerrar: cuantos('pago-sin-cerrar'),
    apartados: pedidosVivos.filter(p => p.estado === 'apartado').length,
    apartadosVencidos: cuantos('apartado-vencido'),
    apartadosPorVencer: cuantos('apartado-por-vencer'),
    porEntregar: pedidosVivos.filter(p => p.estado === 'pagado' && (p.entregaEstado || 'pendiente') !== 'entregado').length,
    sinEntregar: cuantos('sin-entregar') + cuantos('envio-largo'),
    devolverDinero: cuantos('devolver') + cuantos('pago-tras-cancelar'),
    atorados: conAlerta.filter(x => x.a.some(a => a.nivel === 'rojo' || a.tipo === 'pago-sin-cerrar')).slice(0, 15).map(x => resumenPed(x.p)),
  };

  const inconsistencias = await buscarInconsistencias(db, inv, pedidosVivos, filtroBazar, ahoraIso);

  const ultimas = {
    syncPanel: marcas.syncPanel || null, syncPublico: marcas.syncPublico || null, cron: marcas.cron || null,
    webhookClip: marcas.webhookClip || null, ultimoPago: marcas.ultimoPago || null, ultimoCorreo: marcas.ultimoCorreo || null,
    actividad: ultimaActividad[0] ? { en: ultimaActividad[0].en, accion: ultimaActividad[0].accion, usuario: ultimaActividad[0].usuario, categoria: ultimaActividad[0].categoria } : null,
  };
  // La tarea diaria de Vercel corre una vez al día: más de 26 h sin correr es raro
  const avisosSistema = [];
  if (!ultimas.cron) avisosSistema.push({ nivel: 'gris', texto: 'Todavía no hay registro de la tarea automática diaria (se anota a partir de la v33).' });
  else if (ahora - new Date(ultimas.cron) > 26 * 3600e3) avisosSistema.push({ nivel: 'rojo', texto: `La tarea automática diaria no corre desde ${new Date(ultimas.cron).toLocaleString('es-MX', { timeZone: 'America/Matamoros' })}. Revisa CRON_SECRET y los Cron Jobs en Vercel.` });

  // v41 · Si algo está mal, avisar a la dueña (Telegram / correo; máximo cada 3 h por cosa)
  try {
    const { avisarServicios } = await import('./alertas.js');
    const extras = avisosSistema.filter(a => a.nivel === 'rojo').map(a => ({ clave: 'cron-26h', titulo: 'La tarea diaria no está corriendo', texto: a.texto }));
    await avisarServicios(db, servicios.filter(x => x.estado !== ESTADO.sin), extras);
  } catch (e) { console.error('[alertas]', e?.message || e); }

  const peor = servicios.filter(x => x.id !== 'paypal' || x.estado !== ESTADO.sin).map(x => x.estado);
  const general = peor.includes(ESTADO.mal) ? 'no disponible' : peor.includes(ESTADO.deg) || inconsistencias.length || errores24 >= 10 ? 'degradado' : 'operativo';
  const { telegramListo, correoAvisosListo } = await import('./alertas.js');
  const datos = {
    generado: ahoraIso, general, servicios, ultimas, pendientes, avisosSistema, inconsistencias,
    alertas: { telegram: telegramListo(), correo: correoAvisosListo(), botSinChat: !!process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_CHAT_ID },   // v41
    errores: { ultimas24h: errores24, cliente24h: erroresCliente, recientes: erroresRecientes, memoria: (global._fallasRecientes || []).slice(0, 5) },
  };
  _cacheMonitor.set(clave, { t: Date.now(), datos });
  return res.status(200).json(datos);
}

// ── Consistencia entre pedidos, pagos e inventario ───────────
async function buscarInconsistencias(db, inv, pedidos, filtroBazar, ahoraIso) {
  const lista = [];
  const porId = new Map(pedidos.map(p => [p.id, p]));
  const reservadas = await inv.find({ ...filtroBazar, apartada: true, vendido: { $ne: true }, 'reservedBy.pedido': { $exists: true } }).limit(500).toArray();
  for (const pr of reservadas) {
    const pid = String(pr.reservedBy?.pedido || '');
    let p = porId.get(pid);
    if (!p) p = await db.collection('pedidos').findOne({ id: pid });
    const ref = { prendaId: pr.id, prenda: pr.nombre, pedidoId: pid || null };
    const bloquea = pr.reservedUntil > ahoraIso || pr.reservedBy?.anticipo;
    if (!p) { if (bloquea) lista.push({ ...ref, tipo: 'apartado-sin-pedido', nivel: 'ambar', texto: `"${pr.nombre}" está apartada para un pedido que no existe.`, reparar: 'soltar-apartado' }); continue; }
    if (['cancelado', 'reemplazado'].includes(p.estado) || (p.estado === 'expirado' && bloquea))
      lista.push({ ...ref, tipo: 'apartado-de-pedido-cerrado', nivel: 'ambar', texto: `"${pr.nombre}" sigue apartada aunque el pedido ${pid} está ${p.estado}.`, reparar: 'soltar-apartado' });
    if (p.estado === 'pagado' && !(p.yaVendidas || []).map(String).includes(String(pr.id)))
      lista.push({ ...ref, tipo: 'pagado-sin-vender', nivel: 'rojo', texto: `El pedido ${pid} está pagado pero "${pr.nombre}" no quedó vendida.`, reparar: 'revisar-pedido' });
  }
  // Una sola consulta para todas las prendas de los pedidos activos (no una por pedido)
  const activos = pedidos.filter(x => x.estado === 'apartado' || x.estado === 'pagado');
  const itemsDe = p => (p.items || []).filter(x => x.id !== 'envio' && !(p.yaVendidas || []).map(String).includes(String(x.id)));
  const todas = [...new Set(activos.flatMap(p => itemsDe(p).map(x => Number(x.id))).filter(Boolean))];
  const prendas = todas.length ? await inv.find({ id: { $in: todas } }, { projection: { id: 1, nombre: 1, vendido: 1, reservedBy: 1 } }).toArray() : [];
  for (const p of activos) {
    const items = itemsDe(p);
    if (!items.length) continue;
    for (const it of items) {
      const pr = prendas.find(x => x.id === Number(it.id));
      if (!pr) continue;   // la prenda se borró del inventario: el pedido conserva su copia
      if (p.estado === 'apartado' && pr.vendido)
        lista.push({ prendaId: pr.id, prenda: pr.nombre, pedidoId: p.id, tipo: 'apartado-prenda-vendida', nivel: 'rojo', texto: `"${pr.nombre}" tiene anticipo pagado (pedido ${p.id}) pero se marcó vendida por otro lado.` });
      else if (p.estado === 'apartado' && pr.reservedBy?.pedido !== p.id)
        lista.push({ prendaId: pr.id, prenda: pr.nombre, pedidoId: p.id, tipo: 'apartado-sin-reserva', nivel: 'rojo', texto: `"${pr.nombre}" tiene anticipo pagado (pedido ${p.id}) pero ya no está apartada a su nombre.`, reparar: 'reapartar' });
      else if (p.estado === 'pagado' && !pr.vendido && !lista.some(x => x.prendaId === pr.id && x.tipo === 'pagado-sin-vender'))
        lista.push({ prendaId: pr.id, prenda: pr.nombre, pedidoId: p.id, tipo: 'pagado-sin-vender', nivel: 'rojo', texto: `El pedido ${p.id} está pagado pero "${pr.nombre}" sigue a la venta.` });
    }
  }
  return lista.slice(0, 50);
}

// ── Reparaciones seguras (siempre se vuelve a comprobar antes de tocar algo) ──
async function reparar(req, res, db, user) {
  const b = req.body || {};
  const inv = db.collection('inventario');
  if (b.tipo === 'revisar-pedido') {
    const p = await db.collection('pedidos').findOne({ id: String(b.pedidoId || '') });
    if (!p || !mismoBazar(user, p.bazarId)) return res.status(404).json({ error: 'Pedido no encontrado.' });
    req._evento = { pedidoId: p.id, bazarId: p.bazarId, omitir: true };
    return conBloqueo(db, res, `pedido:${p.id}`, 30, async () => {
      let estado;
      try { estado = p.estado === 'pendiente' && p.expira < new Date().toISOString() ? ((await cerrarPedidoVencido(db, p.id)) ? 'pagado' : 'expirado') : await revisarPagoDePedido(db, p); }
      catch (e) { return res.status(502).json({ error: 'El servicio de pago no contestó. Intenta en unos minutos.' }); }
      const final = await db.collection('pedidos').findOne({ id: p.id });
      await historialPedido(db, p, { accion: `Revisión desde el monitor: el pedido quedó ${final?.estado || estado}`, por: user.username, resultado: 'info', tipo: 'monitor.revisar' });
      _cacheMonitor.clear();
      return res.status(200).json({ ok: true, estado: final?.estado || estado });
    });
  }

  const prendaId = Number(b.prendaId);
  const pr = prendaId ? await inv.findOne({ id: prendaId }) : null;
  if (!pr || !mismoBazar(user, pr.bazarId)) return res.status(404).json({ error: 'Prenda no encontrada.' });
  req._evento = { prendaId, bazarId: pr.bazarId };

  return conBloqueo(db, res, `prenda:${prendaId}`, 20, async () => {
    const actual = await inv.findOne({ id: prendaId });
    const pid = String(actual?.reservedBy?.pedido || b.pedidoId || '');
    const p = pid ? await db.collection('pedidos').findOne({ id: pid }) : null;
    if (b.tipo === 'soltar-apartado') {
      if (!actual.apartada || actual.vendido) return res.status(409).json({ error: 'La prenda ya no está apartada.' });
      // Solo si el pedido está cerrado o no existe; nunca si tiene anticipo o alguien está pagando
      if (p && (p.estado === 'apartado' || p.estado === 'pagado' || (p.estado === 'pendiente' && actual.reservedUntil > new Date().toISOString())))
        return res.status(409).json({ error: `No se soltó: el pedido ${p.id} sigue activo (${p.estado}).` });
      const r = await inv.updateOne({ id: prendaId, vendido: { $ne: true }, 'reservedBy.pedido': actual.reservedBy?.pedido },
        { $set: { apartada: false }, $unset: { reservedUntil: '', reservedBy: '' } });
      if (!r.modifiedCount) return res.status(409).json({ error: 'La prenda cambió mientras se reparaba. Revisa de nuevo.' });
      invalidarSyncCache(); _cacheMonitor.clear();
      req._evento.accion = `Soltó "${actual.nombre}", que seguía apartada para el pedido ${pid || '(sin pedido)'} (${p?.estado || 'no existe'})`;
      req._evento.pedidoId = pid || null;
      if (p) await historialPedido(db, p, { accion: `Se soltó "${actual.nombre}" desde el monitor (seguía apartada con el pedido ${p.estado})`, por: user.username, tipo: 'monitor.soltar', registrar: false });
      return res.status(200).json({ ok: true });
    }
    if (b.tipo === 'reapartar') {
      if (!p || p.estado !== 'apartado') return res.status(409).json({ error: 'Ese pedido ya no es un apartado activo.' });
      if (!(p.items || []).some(x => Number(x.id) === prendaId)) return res.status(400).json({ error: 'Esa prenda no es de ese pedido.' });
      if (actual.vendido) return res.status(409).json({ error: 'La prenda ya se vendió: resuélvelo con el cliente (devolver anticipo u ofrecer otra).' });
      if (actual.apartada && actual.reservedBy?.pedido && actual.reservedBy.pedido !== p.id && actual.reservedUntil > new Date().toISOString())
        return res.status(409).json({ error: 'La prenda está apartada para otra persona en este momento.' });
      await inv.updateOne({ id: prendaId, vendido: { $ne: true } }, { $set: { apartada: true, reservedUntil: p.liquidarAntes,
        reservedBy: { nombre: p.nombre, telefono: p.telefono, canal: 'anticipo', pedido: p.id, anticipo: p.anticipo, en: new Date().toISOString() } } });
      invalidarSyncCache(); _cacheMonitor.clear();
      req._evento.accion = `Volvió a apartar "${actual.nombre}" para el pedido ${p.id} (anticipo pagado)`;
      req._evento.pedidoId = p.id;
      await historialPedido(db, p, { accion: `Se volvió a apartar "${actual.nombre}" a su nombre desde el monitor`, por: user.username, tipo: 'monitor.reapartar', registrar: false });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'Reparación no válida.' });
  });
}

// ═════════════════════════════════════════════════════════════
//  Historial de un pedido
// ═════════════════════════════════════════════════════════════
// Pedidos de antes de la v33 no tienen historial guardado: se arma con sus fechas
function reconstruir(p) {
  const h = [];
  const add = (en, a, accion) => en && h.push({ en, a, accion, por: 'sistema', reconstruido: true });
  add(p.en, 'pendiente', `Pedido creado (${p.modalidad === 'apartado' ? 'apartar con anticipo' : 'pago completo'})`);
  add(p.anticipoPagadoEn, 'apartado', `Anticipo pagado`);
  add(p.liquidadoEn, 'pagado', `Apartado liquidado${p.liquidadoCon === 'persona' ? ' en persona' : ''}`);
  if (!p.liquidadoEn) add(p.pagadoEn, 'pagado', 'Pago confirmado');
  add(p.enviadoEn, null, `Enviado${p.paqueteria ? ` por ${p.paqueteria}` : ''}`);
  add(p.entregadoEn, null, 'Entregado');
  add(p.canceladoEn, 'cancelado', `Cancelado${p.canceladoPor ? ` por ${p.canceladoPor}` : ''}`);
  if (p.estado === 'expirado') h.push({ en: p.expira || p.en, a: 'expirado', accion: 'El pago no se terminó y venció', por: 'sistema', reconstruido: true });
  return h.sort((a, b) => String(a.en).localeCompare(String(b.en)));
}

async function historialDePedido(req, res, db, user) {
  const p = await db.collection('pedidos').findOne({ id: String(req.query.id || '') });
  if (!p || !mismoBazar(user, p.bazarId)) return res.status(404).json({ error: 'Pedido no encontrado.' });
  const items = (p.items || []).filter(x => x.id !== 'envio');
  const prendas = await db.collection('inventario').find({ id: { $in: items.map(x => Number(x.id)) } }).toArray();
  const ventas = await db.collection('ventas').find({ prendaId: { $in: items.map(x => Number(x.id)) } }).toArray();
  const ahoraIso = new Date().toISOString();
  const yaVendidas = (p.yaVendidas || []).map(String);
  const estadoPrendas = items.map(it => {
    const pr = prendas.find(x => x.id === Number(it.id));
    const venta = ventas.find(v => v.prendaId === Number(it.id) && v.pedido === p.id);
    let estado, ok = true;
    if (!pr) estado = 'Ya no está en el inventario';
    else if (pr.vendido) estado = venta ? 'Vendida en este pedido' : 'Vendida por otro lado';
    else if (pr.reservedBy?.pedido === p.id && (pr.reservedBy?.anticipo || pr.reservedUntil > ahoraIso)) estado = 'Apartada para este pedido';
    else if (pr.apartada && pr.reservedUntil > ahoraIso) estado = `Apartada para ${pr.reservedBy?.nombre ? String(pr.reservedBy.nombre).split(' ')[0] : 'otra persona'}`;
    else estado = 'Disponible en la tienda';
    // ¿Es lo que corresponde al estado del pedido?
    if (yaVendidas.includes(String(it.id))) ok = true;
    else if (p.estado === 'pagado') ok = estado === 'Vendida en este pedido' || estado === 'Ya no está en el inventario';
    else if (p.estado === 'apartado') ok = estado === 'Apartada para este pedido';
    else if (['cancelado', 'reemplazado'].includes(p.estado)) ok = estado !== 'Apartada para este pedido';
    return { id: it.id, nombre: it.nombre, imagen: it.imagen || '', precio: it.lista ?? it.precio, estado, ok, yaVendida: yaVendidas.includes(String(it.id)) };
  });
  const eventos = await db.collection('actividad').find({ pedidoId: p.id }, { projection: { _id: 0, expira: 0 } }).sort({ en: -1 }).limit(60).toArray();
  const guardado = (p.historial || []).length > 0;
  return res.status(200).json({
    pedido: { id: p.id, estado: p.estado, modalidad: p.modalidad || 'completo', nombre: p.nombre, total: p.total, anticipo: p.anticipo || 0, resta: p.resta || 0,
      proveedor: p.proveedor || 'clip', entrega: p.entrega, entregaEstado: p.entregaEstado || 'pendiente', en: p.en, expira: p.expira || null,
      liquidarAntes: p.liquidarAntes || null, pagadoEn: p.pagadoEn || null, canceladoEn: p.canceladoEn || null, canceladoPor: p.canceladoPor || null,
      motivoCancelacion: p.motivoCancelacion || '', cupon: p.cupon || null, pagos: p.pagos || [], revisar: !!p.revisar, pagoTrasCancelar: !!p.pagoTrasCancelar },
    historial: guardado ? p.historial : reconstruir(p), reconstruido: !guardado,
    prendas: estadoPrendas, consistente: estadoPrendas.every(x => x.ok),
    alertas: alertasPedido(p), eventos,
    acciones: {
      cancelar: ['pendiente', 'expirado'].includes(p.estado),
      liberar: p.estado === 'apartado',
      revisar: ['pendiente', 'expirado', 'apartado'].includes(p.estado) || (p.estado === 'cancelado' && ['pendiente', 'expirado'].includes(p.canceladoDesde)),
    },
  });
}

// v41 · La tarea diaria revisa los servicios y avisa si alguno está mal
export async function revisarServiciosYAvisar(db) {
  const [mongo, clip, paypal, resend, cloudinary] = await Promise.all([
    revisarMongo(db), revisarClip(db, 1), revisarPaypal(1), revisarResend(db), revisarCloudinary(),
  ]);
  const { avisarServicios } = await import('./alertas.js');
  return avisarServicios(db, [mongo, clip, resend, cloudinary, paypal].filter(x => x.estado !== ESTADO.sin));
}
