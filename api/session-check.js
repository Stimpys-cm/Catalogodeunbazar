// api/session-check.js
// POST /api/session-check   body: { username, token }
// Devuelve { valid: true }  si el token coincide con el guardado para esa cuenta.
// Devuelve { valid: false } si no coincide (la sesión fue reemplazada).
//
// No expone NINGÚN dato del usuario ni tokens de otras cuentas: solo un booleano.

import { getDB } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  const { username, token } = req.body || {};
  if (!username || !token) {
    return res.status(400).json({ error: 'username y token requeridos' });
  }

  try {
    const db   = await getDB();
    const col  = db.collection('usuarios');
    const user = await col.findOne({ username });

    // Si el usuario no existe o el token no coincide → sesión inválida.
    const valid = !!user && user.sessionToken === token;
    return res.status(200).json({ valid });

  } catch (err) {
    console.error('[session-check]', err);
    // Ante error de servidor NO cerramos la sesión (evita falsos positivos).
    return res.status(500).json({ error: err.message, valid: true });
  }
}
