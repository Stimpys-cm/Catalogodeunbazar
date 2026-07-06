// api/change-password.js
// POST /api/change-password   body: { username, actual, nueva }
// Verifica la contraseña actual EN EL SERVIDOR y la cambia.
// El frontend ya no tiene acceso a las contraseñas (ver api/sync.js), por eso
// esta verificación no puede hacerse en el navegador.

import { getDB } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  const { username, actual, nueva } = req.body || {};
  if (!username || !actual || !nueva) {
    return res.status(400).json({ error: 'username, actual y nueva requeridos' });
  }
  if (String(nueva).length < 4) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' });
  }

  try {
    const db   = await getDB();
    const col  = db.collection('usuarios');
    const user = await col.findOne({ username });

    if (!user || user.password !== actual) {
      return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
    }

    await col.updateOne({ id: user.id }, { $set: { password: nueva } });
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[change-password]', err);
    return res.status(500).json({ error: err.message });
  }
}
