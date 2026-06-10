// api/auth.js
// POST /api/auth   body: { username, password }
// Devuelve { id, username, role } si las credenciales son correctas
// o 401 si no.

import { getDB } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username y password requeridos' });
  }

  try {
    const db   = await getDB();
    const col  = db.collection('usuarios');

    // Insertar admin por defecto si no existe
    const adminExists = await col.findOne({ username: 'admin' });
    if (!adminExists) {
      await col.insertOne({ id:1, username:'admin', password:'stiimpys2026', role:'admin' });
    }

    const user = await col.findOne({ username, password });
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

    return res.status(200).json({ id: user.id, username: user.username, role: user.role });

  } catch (err) {
    console.error('[auth]', err);
    return res.status(500).json({ error: err.message });
  }
}
