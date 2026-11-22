// api/activos.js
// GET    /api/activos   → lista usuarios activos (últimos 45s)  [requiere sesión]
// POST   /api/activos   → reporta MI actividad          [requiere sesión]
// DELETE /api/activos   → me saca de activos (logout)    [requiere sesión]
//
// El usuario se toma del token de sesión, no del body/query (evita que
// alguien reporte o borre la actividad de otra persona).

import { getDB } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { registrarFalla } from './_lib/actividad.js';

import { conEscudo } from './_lib/escudo.js';
const TIMEOUT_MS = 45000;

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db  = await getDB();
    const col = db.collection('activos');

    // ── GET — quién está conectado (solo para el equipo) ────
    // Los nombres de las cuentas del bazar no son asunto del público.
    if (req.method === 'GET') {
      const user = await requireAuth(req, res);
      if (!user) return;
      const cutoff = new Date(Date.now() - TIMEOUT_MS);
      const items  = await col.find({ lastActive: { $gte: cutoff } }).toArray();
      return res.status(200).json(items.map(u => ({ username: u.username, lastActive: u.lastActive })));
    }

    // ── POST — ping de MI actividad ──────────────────────────
    if (req.method === 'POST') {
      const user = await requireAuth(req, res);
      if (!user) return;
      await col.updateOne(
        { username: user.username },
        { $set: { username: user.username, lastActive: new Date() } },
        { upsert: true }
      );
      return res.status(200).json({ ok: true });
    }

    // ── DELETE — salir de activos (logout) ───────────────────
    if (req.method === 'DELETE') {
      const user = await requireAuth(req, res);
      if (!user) return;
      await col.deleteOne({ username: user.username });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });

  } catch (err) {
    console.error('[activos]', err);
    await registrarFalla(err, { origen: 'activos' });
    return res.status(500).json({ error: 'No se pudo completar la operación.' });
  }
}

// v40 · Todas las funciones pasan primero por el escudo (ver api/_lib/escudo.js)
export default conEscudo(handler);
