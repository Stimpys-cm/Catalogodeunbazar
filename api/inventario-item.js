// api/inventario-item.js
// PATCH  /api/inventario-item?id=X   → actualiza campos de un ítem (requiere sesión)
// DELETE /api/inventario-item?id=X   → elimina un ítem (requiere admin)

import { getDB } from './_db.js';
import { requireAuth } from './_auth.js';
import { esGlobal, mismoBazar, puede } from './_bazar.js';

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

      // Multi-bazar: solo el dueño de la prenda (o el admin principal) la edita
      const actual = await col.findOne({ id });
      if (!actual) return res.status(404).json({ error: `Ítem ${id} no encontrado` });
      if (!mismoBazar(user, actual.bazarId)) {
        return res.status(403).json({ error: 'Esa prenda pertenece a otro bazar.' });
      }
      if (!esGlobal(user) && !(await puede(user, 'editarPrendas'))) {
        return res.status(403).json({ error: 'Tu bazar no tiene permitido editar prendas.' });
      }

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

    // ── DELETE — el admin principal, o el bazar dueño con permiso ──
    if (req.method === 'DELETE') {
      const user = await requireAuth(req, res);
      if (!user) return;

      const actual = await col.findOne({ id });
      if (!actual) return res.status(404).json({ error: `Ítem ${id} no encontrado` });

      if (!esGlobal(user)) {
        if (!mismoBazar(user, actual.bazarId)) {
          return res.status(403).json({ error: 'Esa prenda pertenece a otro bazar.' });
        }
        if (!(await puede(user, 'borrarPrendas'))) {
          return res.status(403).json({ error: 'Tu bazar no tiene permitido borrar prendas.' });
        }
      }

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
  try { global._syncCache = null; global._syncCacheTime = 0; global._syncCachePub = null; } catch (_) {}
}
