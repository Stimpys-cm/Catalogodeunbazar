// api/_rateLimit.js
// ─────────────────────────────────────────────────────────────
// RATE LIMITER con MongoDB.
//
// ¿Por qué Mongo y no un Map en memoria?  En Vercel cada request puede caer
// en una instancia distinta y las instancias "frías" pierden la memoria. Un
// Map NO limita de verdad. Como ya usas Mongo, guardamos ahí el contador por
// IP con un índice TTL que borra los registros vencidos solos.
//
// (Para producción seria, la opción estándar es Upstash Redis + @upstash/ratelimit,
//  gratis y pensado para serverless. Con Mongo alcanza de sobra para este proyecto.)
//
// USO:
//   import { rateLimit } from './_rateLimit.js';
//   const ok = await rateLimit(req, res, { key: 'login', max: 5, windowSec: 900 });
//   if (!ok) return;   // rateLimit ya respondió 429
// ─────────────────────────────────────────────────────────────

import { getDB } from './_db.js';

let _indexReady = false;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'desconocida';
}

export async function rateLimit(req, res, { key = 'global', max = 5, windowSec = 900 } = {}) {
  const db  = await getDB();
  const col = db.collection('rate_limits');

  // Índice TTL: Mongo borra el documento cuando pasa 'expireAt'. Se crea 1 vez.
  if (!_indexReady) {
    try { await col.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }); } catch (_) {}
    _indexReady = true;
  }

  const id       = `${key}:${clientIp(req)}`;
  const expireAt = new Date(Date.now() + windowSec * 1000);

  // Incrementa el contador; en el primer intento fija cuándo expira la ventana.
  const doc = await col.findOneAndUpdate(
    { _id: id },
    { $inc: { count: 1 }, $setOnInsert: { expireAt } },
    { upsert: true, returnDocument: 'after' }
  );

  // El driver v6 devuelve el doc directo; versiones viejas lo ponen en .value
  const count = doc?.count ?? doc?.value?.count ?? 1;

  if (count > max) {
    res.setHeader('Retry-After', String(windowSec));
    res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' });
    return false;
  }
  return true;
}

// Llama a esto tras un login EXITOSO para no penalizar a quien sí acertó.
export async function resetRateLimit(req, key = 'login') {
  try {
    const db = await getDB();
    await db.collection('rate_limits').deleteOne({ _id: `${key}:${clientIp(req)}` });
  } catch (_) {}
}
