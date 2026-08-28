// api/change-password.js
// POST /api/change-password   body: { actual, nueva }   [requiere sesión]
// Verifica la contraseña actual en el servidor y guarda la nueva HASHEADA.
// Solo puedes cambiar TU propia contraseña (el usuario sale del token).

import { getDB } from './_db.js';
import { requireAuth } from './_auth.js';
import { verifyPassword, hashPassword } from './_password.js';
import { rateLimit } from './_rateLimit.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  const user = await requireAuth(req, res);
  if (!user) return;

  // Freno a quien intente adivinar la contraseña actual desde una sesión robada
  if (!(await rateLimit(req, res, { key: 'cambio-pass', max: 10, windowSec: 900 }))) return;

  const cuerpo = req.body || {};
  const actual = typeof cuerpo.actual === 'string' ? cuerpo.actual : '';
  const nueva  = typeof cuerpo.nueva  === 'string' ? cuerpo.nueva  : '';

  if (!actual || !nueva) {
    return res.status(400).json({ error: 'actual y nueva requeridos' });
  }
  if (nueva.length < 8 || nueva.length > 200) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener entre 8 y 200 caracteres' });
  }
  if (!/[A-Z]/.test(nueva) || !/[a-z]/.test(nueva) || !/[0-9]/.test(nueva)) {
    return res.status(400).json({ error: 'La nueva contraseña necesita mayúscula, minúscula y número' });
  }
  if (nueva === actual) {
    return res.status(400).json({ error: 'La nueva contraseña debe ser distinta de la actual' });
  }

  try {
    const db   = await getDB();
    const col  = db.collection('usuarios');
    const dbUser = await col.findOne({ id: user.id });

    const ok = dbUser && await verifyPassword(actual, dbUser.password);
    if (!ok) return res.status(401).json({ error: 'La contraseña actual es incorrecta' });

    const hash = await hashPassword(nueva);
    // Al cambiar la contraseña se invalida cualquier sesión abierta en otro
    // dispositivo: si alguien te robó el acceso, con esto lo dejas fuera.
    await col.updateOne({ id: user.id }, { $set: { password: hash, sessionToken: null } });
    try { global._syncCache = null; global._syncCacheTime = 0; global._syncCachePub = null; } catch (_) {}
    return res.status(200).json({ ok: true, sesionesCerradas: true });

  } catch (err) {
    console.error('[change-password]', err);
    return res.status(500).json({ error: err.message });
  }
}
