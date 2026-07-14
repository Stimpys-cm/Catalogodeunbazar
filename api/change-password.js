// api/change-password.js
// POST /api/change-password   body: { actual, nueva }   [requiere sesión]
// Verifica la contraseña actual en el servidor y guarda la nueva HASHEADA.
// Solo puedes cambiar TU propia contraseña (el usuario sale del token).

import { getDB } from './_db.js';
import { requireAuth } from './_auth.js';
import { verifyPassword, hashPassword } from './_password.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const { actual, nueva } = req.body || {};
  if (!actual || !nueva) {
    return res.status(400).json({ error: 'actual y nueva requeridos' });
  }
  if (String(nueva).length < 4) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' });
  }

  try {
    const db   = await getDB();
    const col  = db.collection('usuarios');
    const dbUser = await col.findOne({ id: user.id });

    const ok = dbUser && await verifyPassword(actual, dbUser.password);
    if (!ok) return res.status(401).json({ error: 'La contraseña actual es incorrecta' });

    const hash = await hashPassword(nueva);
    await col.updateOne({ id: user.id }, { $set: { password: hash } });
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[change-password]', err);
    return res.status(500).json({ error: err.message });
  }
}
