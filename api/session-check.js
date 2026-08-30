// api/session-check.js
// POST /api/session-check   body: { username, token }
// Devuelve { valid: true }  si el token coincide con el guardado para esa cuenta.
// Devuelve { valid: false } si no coincide (la sesión fue reemplazada).
//
// No expone NINGÚN dato del usuario ni tokens de otras cuentas: solo un booleano.

import { getDB } from './_db.js';
import { rateLimit } from './_rateLimit.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  const cuerpo   = req.body || {};
  const username = typeof cuerpo.username === 'string' ? cuerpo.username : '';
  const token    = typeof cuerpo.token    === 'string' ? cuerpo.token    : '';

  if (!username || !token) {
    return res.status(400).json({ error: 'username y token requeridos' });
  }
  // Evita que alguien use este endpoint para probar tokens en masa
  if (!(await rateLimit(req, res, { key: 'sesion', max: 240, windowSec: 900 }))) return;

  try {
    const db   = await getDB();
    const col  = db.collection('usuarios');
    const user = await col.findOne({ username });

    // Si el usuario no existe, el token no coincide o ya caducó → inválida.
    const vigente = !user?.tokenExpira || new Date(user.tokenExpira) >= new Date();
    const valid = !!user && user.sessionToken === token && vigente;
    return res.status(200).json({ valid });

  } catch (err) {
    console.error('[session-check]', err);
    // Ante error de servidor NO cerramos la sesión (evita falsos positivos).
    return res.status(500).json({ error: 'No se pudo completar la operación.', valid: true });
  }
}
