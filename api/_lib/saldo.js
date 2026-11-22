// ─────────────────────────────────────────────────────────────
//  api/_lib/saldo.js — Cuánto saldo de IA (Anthropic) te queda (v46)
//
//  Anthropic no tiene una API para leer el saldo de la cuenta. Así que:
//   1. La dueña escribe una vez el saldo que ve en platform.claude.com → Billing.
//   2. Cada llamada a la IA se descuenta con su costo real (tokens que reporta
//      Anthropic × precio + búsquedas). Eso es "conteo".
//   3. Si además pone ANTHROPIC_ADMIN_KEY (cuenta de organización), el gasto sale
//      del reporte de costos de Anthropic (incluye lo que se gaste fuera de la
//      página). Eso es "exacto". Tarda ~5 min en reflejarse.
//   4. Cuando queda menos del aviso (1 USD de inicio), avisa una vez por Telegram/correo.
//   5. Si Anthropic dice "sin saldo", queda marcado hasta que se actualice.
//
//   POST /api/acciones?op=ia-saldo  { usd, umbral? }   (solo administradores)
// ─────────────────────────────────────────────────────────────
import { rateLimit } from './rateLimit.js';

const ID = 'actual';
const col = db => db.collection('iaSaldo');
const r4 = n => Math.round((Number(n) || 0) * 10000) / 10000;
const inicioDiaUTC = iso => new Date(new Date(iso).toISOString().slice(0, 10) + 'T00:00:00Z');

// Suma (en dólares) del reporte de costos de Anthropic desde un día (UTC) hasta ahora
async function costoAnthropic(desde) {
  const key = process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) return null;
  let total = 0, pagina = null;
  for (let i = 0; i < 4; i++) {
    const q = new URLSearchParams({ starting_at: desde.toISOString(), ending_at: new Date(Date.now() + 864e5).toISOString().slice(0, 10) + 'T00:00:00Z', bucket_width: '1d', limit: '31' });
    if (pagina) q.set('page', pagina);
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch('https://api.anthropic.com/v1/organizations/cost_report?' + q, { signal: ctrl.signal,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'user-agent': 'Stiimpys/1.0 (https://stiimpys.store)' } });
      if (!r.ok) return null;
      const j = await r.json();
      // Los montos vienen en centavos de dólar (texto decimal)
      for (const b of j.data || []) for (const x of b.results || []) total += Number(x.amount) || 0;
      if (!j.has_more || !j.next_page) break;
      pagina = j.next_page;
    } catch { return null; } finally { clearTimeout(t); }
  }
  return total / 100;
}

export async function estadoSaldo(db, { fresco = false } = {}) {
  const doc = await col(db).findOne({ id: ID }).catch(() => null);
  if (!doc || (!(doc.usd > 0) && !doc.sinSaldoEn)) return null;
  let gastado = doc.gastado || 0, fuente = 'conteo';
  if (process.env.ANTHROPIC_ADMIN_KEY && doc.en) {
    // Se pregunta como mucho cada 5 minutos (Anthropic tarda ~5 min en reflejar el gasto)
    let real = doc.real && !fresco && Date.now() - new Date(doc.real.en) < 5 * 60e3 ? doc.real.usd : null;
    if (real == null) {
      const total = await costoAnthropic(inicioDiaUTC(doc.en));
      if (total != null) { real = Math.max(0, total - (doc.baseAnthropic || 0)); await col(db).updateOne({ id: ID }, { $set: { real: { usd: r4(real), en: new Date().toISOString() } } }).catch(() => {}); }
    }
    // El reporte va ~5 min atrasado: nunca se muestra menos de lo que ya contamos aquí
    if (real != null) { gastado = Math.max(real, gastado); fuente = 'anthropic'; }
  }
  const umbral = doc.umbral ?? 1;
  const queda = Math.max(0, (doc.usd || 0) - gastado);
  const sinSaldo = !!doc.sinSaldoEn && (!doc.en || new Date(doc.sinSaldoEn) > new Date(doc.en));
  return { inicial: r4(doc.usd), en: doc.en || null, gastado: r4(gastado), queda: sinSaldo ? 0 : r4(queda), fuente, umbral, bajo: sinSaldo || queda < umbral, sinSaldo };
}

// Cada llamada a la IA descuenta su costo (lo llama anotarUso)
export async function sumarGasto(db, usd) {
  if (!(usd > 0)) return;
  try {
    const r = await col(db).findOneAndUpdate({ id: ID, usd: { $gt: 0 } }, { $inc: { gastado: usd } }, { returnDocument: 'after' });
    const doc = r && r.value !== undefined && r.lastErrorObject ? r.value : r;
    if (!doc || doc.avisado) return;
    const queda = (doc.usd || 0) - (doc.gastado || 0);
    if (queda >= (doc.umbral ?? 1)) return;
    const marcado = await col(db).updateOne({ id: ID, avisado: { $ne: true } }, { $set: { avisado: true } });
    if (!marcado?.modifiedCount && marcado?.modifiedCount !== undefined) return;
    const { avisarDuena } = await import('./alertas.js');
    await avisarDuena(db, { clave: 'ia-saldo', forzar: true, icono: '🪫 ', titulo: 'Se está acabando el saldo de la IA',
      texto: `Te quedan como $${Math.max(0, queda).toFixed(2)} USD en Anthropic. Recarga en platform.claude.com → Billing y luego actualiza el saldo en el panel (Registro rápido con IA).` });
  } catch {}
}

// Anthropic dijo "sin saldo": queda marcado hasta que se ponga un saldo nuevo
export async function marcarSinSaldo(db) {
  try {
    const antes = await col(db).findOne({ id: ID });
    await col(db).updateOne({ id: ID }, { $set: { id: ID, sinSaldoEn: new Date().toISOString() } }, { upsert: true });
    if (antes?.sinSaldoEn && (!antes.en || new Date(antes.sinSaldoEn) > new Date(antes.en))) return;   // ya se había avisado
    const { avisarDuena } = await import('./alertas.js');
    await avisarDuena(db, { clave: 'ia-sin-saldo', icono: '🪫 ', titulo: 'La IA se quedó sin saldo',
      texto: 'Anthropic dice que tu cuenta no tiene saldo: el registro con IA no funcionará hasta que recargues en platform.claude.com → Billing.' });
  } catch {}
}

// POST ia-saldo: la dueña escribe el saldo que ve en Anthropic
export async function ponerSaldo(req, res, db, user) {
  if (user.role !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede cambiar el saldo de la IA.' });
  if (!(await rateLimit(req, res, { key: 'ia-saldo-' + user.username, max: 30, windowSec: 3600 }))) return;
  const b = req.body || {};
  const txt = String(b.usd ?? '').replace(/[$,\s]/g, '');
  const usd = txt === '' ? NaN : Number(txt);
  if (!Number.isFinite(usd) || usd < 0 || usd > 100000) return res.status(400).json({ error: 'Escribe tu saldo en dólares, como aparece en Anthropic (ej. 4.32).' });
  const umbral = b.umbral == null || b.umbral === '' ? null : Number(b.umbral);
  if (umbral != null && (!Number.isFinite(umbral) || umbral < 0 || umbral > 1000)) return res.status(400).json({ error: 'El aviso debe ser entre 0 y 1000 dólares.' });
  const en = new Date().toISOString();
  // Con la llave de administrador: lo que ya se gastó hoy antes de este momento no cuenta
  const baseAnthropic = process.env.ANTHROPIC_ADMIN_KEY ? await costoAnthropic(inicioDiaUTC(en)) : null;
  const previo = await col(db).findOne({ id: ID }).catch(() => null);
  await col(db).updateOne({ id: ID }, { $set: {
    id: ID, usd: Math.round(usd * 100) / 100, en, gastado: 0, avisado: false, sinSaldoEn: null, real: null,
    baseAnthropic: baseAnthropic ?? 0, umbral: umbral ?? previo?.umbral ?? 1, por: user.username,
  } }, { upsert: true });
  req._evento = { accion: `Actualizó el saldo de la IA a $${usd.toFixed(2)} USD` };
  return res.status(200).json({ ok: true, saldo: await estadoSaldo(db, { fresco: true }) });
}
