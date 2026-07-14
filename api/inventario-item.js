// api/inventario-item.js
// PATCH  /api/inventario-item?id=X   → actualiza campos de un ítem (requiere sesión)
// DELETE /api/inventario-item?id=X   → elimina un ítem (requiere admin)

import { getDB } from './_db.js';
import { requireAuth, requireAdmin } from './_auth.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const id = parseInt(req.query.id);
  if (!id) return res.status(400).json({ error: 'Falta ?id=N' });

  try {
    const db  = await getDB();
    const col = db.collection('inventario');

    // ── PATCH — actualiza solo los campos enviados (con sesión) ──
    if (req.method === 'PATCH') {
      const user = await requireAuth(req, res);
      if (!user) return;

      const updates = req.body || {};
      const ALLOWED = [
        'nombre','marca','categorias','talla','precio_venta',
        'costo','estado','imagenes','vendido','vendidoEn',
        'reservedUntil','reservedBy'
      ];
      const $set = {};
      for (const key of ALLOWED) if (key in updates) $set[key] = updates[key];
      if (!Object.keys($set).length) {
        return res.status(400).json({ error: 'No hay campos válidos para actualizar' });
      }
      const result = await col.updateOne({ id }, { $set });
      if (result.matchedCount === 0) return res.status(404).json({ error: `Ítem ${id} no encontrado` });
      invalidarSyncCache();
      return res.status(200).json({ ok: true, updated: $set });
    }

    // ── DELETE — elimina el ítem (solo admin) ─────────────────
    if (req.method === 'DELETE') {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const result = await col.deleteOne({ id });
      if (result.deletedCount === 0) return res.status(404).json({ error: `Ítem ${id} no encontrado` });
      invalidarSyncCache();
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });

  } catch (err) {
    console.error('[inventario-item]', err);
    return res.status(500).json({ error: err.message });
  }
}

function invalidarSyncCache() {
  try { global._syncCache = null; global._syncCacheTime = 0; } catch (_) {}
}
