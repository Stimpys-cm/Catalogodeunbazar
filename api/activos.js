// api/activos.js
// GET  /api/activos              → lista usuarios activos (últimos 45s)
// POST /api/activos              → reporta actividad  body: { username }
// DELETE /api/activos?username=X → elimina al usuario (logout)

import { getDB } from './_db.js';

const TIMEOUT_MS = 45000; // 45 segundos sin ping = inactivo

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db  = await getDB();
    const col = db.collection('activos');

    // ── GET — lista activos ──────────────────────────────────
    if (req.method === 'GET') {
      const cutoff = new Date(Date.now() - TIMEOUT_MS);
      const items  = await col.find({ lastActive: { $gte: cutoff } }).toArray();
      return res.status(200).json(items.map(u => ({ username: u.username, lastActive: u.lastActive })));
    }

    // ── POST — ping de actividad ─────────────────────────────
    if (req.method === 'POST') {
      const { username } = req.body;
      if (!username) return res.status(400).json({ error: 'username requerido' });

      await col.updateOne(
        { username },
        { $set: { username, lastActive: new Date() } },
        { upsert: true }
      );
      return res.status(200).json({ ok: true });
    }

    // ── DELETE — logout ──────────────────────────────────────
    if (req.method === 'DELETE') {
      const username = req.query.username;
      if (!username) return res.status(400).json({ error: 'username requerido' });
      await col.deleteOne({ username });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });

  } catch (err) {
    console.error('[activos]', err);
    return res.status(500).json({ error: err.message });
  }
}
