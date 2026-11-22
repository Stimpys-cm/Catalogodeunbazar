// ─────────────────────────────────────────────────────────────
//  api/_lib/borradores.js — Borradores de prendas (v52)
//
//  Cada prenda que se sube en el Registro rápido queda como borrador en el
//  servidor (fotos ya en Cloudinary + lo que llenó la IA + lo que escribiste)
//  hasta que se guarda como prenda. Así no se pierde nada si cierras la
//  ventana, y se ve desde cualquier dispositivo en Panel → Borradores.
//
//   GET  /api/acciones?op=b-lista[&bazarId=]   → { borradores: [...], total }
//   POST /api/acciones?op=b-guardar  { borradores: [{ id, fotos, f, ia?, agente?, lote?, ordenManual? }], bazarId? }  (máx. 50)
//   POST /api/acciones?op=b-borrar   { ids: [...] }  (máx. 500)
//
//  Seguridad: solo con sesión del panel; cada quien ve y cambia solo los de su
//  bazar (el admin global, todos); solo fotos de Cloudinary; textos limpios y
//  con tope; lo de la IA se guarda con tope de tamaño; máx. 2,000 por bazar.
// ─────────────────────────────────────────────────────────────
import { requireAuth } from './auth.js';
import { rateLimit } from './rateLimit.js';
import { getDB } from './db.js';
import { esGlobal, limpiarCampoPrenda } from './bazar.js';

export const OPS_BORRADORES = ['b-lista', 'b-guardar', 'b-borrar'];
const MAX_POR_BAZAR = 2000;
const ID = /^[a-z0-9-]{8,48}$/i;
const URL_CLOUD = /^https:\/\/res\.cloudinary\.com\/[\w-]+\/image\/upload\/[^\s"'<>]+$/;
const corto = (v, n) => String(v ?? '').replace(/[<>]/g, '').replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, n);

// Lo que se escribe en la tarjeta (mismos topes que una prenda)
function limpiarF(f) {
  const o = {};
  if (!f || typeof f !== 'object' || Array.isArray(f)) return o;
  for (const k of ['nombre', 'marca', 'talla', 'estado', 'descripcion', 'hashtags']) if (f[k] != null) o[k] = limpiarCampoPrenda(k, String(f[k]));
  if (f.categoria != null) o.categoria = corto(f.categoria, 60);
  for (const k of ['precio', 'costo']) {
    if (f[k] === '' || f[k] == null) { if (k in f) o[k] = ''; continue; }
    const n = Number(f[k]); if (Number.isFinite(n) && n >= 0 && n <= 1e6) o[k] = Math.round(n * 100) / 100;
  }
  if (typeof f.incluir === 'boolean') o.incluir = f.incluir;
  return o;
}
// Lo de la IA: tal cual (el panel lo muestra escapado), pero con tope de tamaño
function conTope(v, max) {
  if (v == null || typeof v !== 'object') return null;
  try { const s = JSON.stringify(v); return s.length <= max ? JSON.parse(s) : null; } catch { return null; }
}
function compactoIA(ia) {
  const todo = conTope(ia, 30000);
  if (todo) return todo;
  if (!ia || typeof ia !== 'object') return null;
  const o = {};
  for (const k of ['nombre', 'marca', 'categoria', 'talla', 'estado', 'precioSugerido', 'detalles', 'fallas', 'fallasFoto', 'rareza', 'marcaNueva', 'categoriaNueva', 'sinConfirmar', 'confianza', 'modelo']) if (k in ia) o[k] = ia[k];
  return conTope(o, 30000);
}

export async function handleBorradores(req, res, op) {
  const user = await requireAuth(req, res); if (!user) return;
  const db = await getDB();
  const col = db.collection('borradores');
  const global = esGlobal(user);
  const suyo = global ? {} : { bazarId: Number(user.bazarId) || null };

  if (op === 'b-lista') {
    if (!(await rateLimit(req, res, { key: 'b-lista-' + user.username, max: 900, windowSec: 3600 }))) return;
    const q = { ...suyo };
    if (global && req.query?.bazarId) q.bazarId = Number(req.query.bazarId) || null;
    const lista = (await col.find(q).toArray()).sort((a, b) => String(b.actualizado).localeCompare(String(a.actualizado))).slice(0, MAX_POR_BAZAR);
    return res.status(200).json({ borradores: lista.map(({ _id, ...d }) => d), total: lista.length });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Usa POST' });

  if (op === 'b-guardar') {
    if (!(await rateLimit(req, res, { key: 'b-guardar-' + user.username, max: 3000, windowSec: 3600 }))) return;
    const entrada = Array.isArray(req.body?.borradores) ? req.body.borradores : [];
    if (!entrada.length) return res.status(400).json({ error: 'No hay borradores que guardar.' });
    if (entrada.length > 50) return res.status(400).json({ error: 'Máximo 50 borradores por vez.' });
    const bazarId = global ? (Number(req.body?.bazarId) || null) : (Number(user.bazarId) || null);
    let cuantos = await col.countDocuments({ bazarId }).catch(() => 0);
    const ahora = new Date().toISOString();
    const guardados = [], rechazados = [];
    for (const d of entrada) {
      const id = String(d?.id || '');
      const fotos = (Array.isArray(d?.fotos) ? d.fotos : []).filter(u => typeof u === 'string' && URL_CLOUD.test(u) && u.length <= 600).slice(0, 20);
      if (!ID.test(id) || !fotos.length) { rechazados.push(id || null); continue; }
      const previo = await col.findOne({ id });
      if (previo && !global && previo.bazarId !== bazarId) { rechazados.push(id); continue; }   // de otro bazar
      if (!previo && cuantos >= MAX_POR_BAZAR) return res.status(409).json({ error: `Tienes ${MAX_POR_BAZAR} borradores. Registra o borra algunos antes de subir más.`, guardados });
      const doc = {
        id, bazarId: previo ? previo.bazarId : bazarId, fotos, f: limpiarF(d.f),
        ia: compactoIA(d.ia), agente: conTope(d.agente, 40000), iaOriginal: conTope(d.iaOriginal, 8000),
        lote: corto(d.lote, 80), ordenManual: d.ordenManual === true,
        actualizado: ahora, por: corto(user.username, 60),
      };
      if (!previo) { doc.en = ahora; cuantos++; }
      await col.updateOne({ id }, { $set: doc }, { upsert: true });
      guardados.push(id);
    }
    return res.status(200).json({ ok: true, guardados, rechazados });
  }

  if (op === 'b-borrar') {
    if (!(await rateLimit(req, res, { key: 'b-borrar-' + user.username, max: 900, windowSec: 3600 }))) return;
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).filter(x => ID.test(x)).slice(0, 500);
    if (!ids.length) return res.status(400).json({ error: 'No hay borradores que borrar.' });
    let borrados = 0;
    for (const id of ids) { const r = await col.deleteOne({ id, ...suyo }); borrados += r?.deletedCount || 0; }
    return res.status(200).json({ ok: true, borrados });
  }
  return res.status(400).json({ error: 'op no reconocida' });
}
