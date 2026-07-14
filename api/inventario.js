// api/inventario.js
// GET /api/inventario        → lista todas las prendas (público)
// PUT /api/inventario        → guarda el inventario (requiere sesión)
//
// El guardado es diff-based (bulkWrite): actualiza/inserta cada prenda por su
// id y borra solo las que ya no están. Esto es más seguro que borrar toda la
// colección y reinsertar (si algo falla a medias, no se pierde todo).

import { getDB } from './_db.js';
import { requireAuth } from './_auth.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db  = await getDB();
    const col = db.collection('inventario');

    // ── GET (público) ────────────────────────────────────────
    if (req.method === 'GET') {
      const items = await col.find({}).sort({ _id: -1 }).toArray();
      return res.status(200).json(items.map(normalize));
    }

    // ── PUT — guarda el inventario (solo con sesión válida) ──
    if (req.method === 'PUT') {
      const user = await requireAuth(req, res);
      if (!user) return;                    // 401 si no hay sesión

      const { list } = req.body;
      if (!Array.isArray(list)) return res.status(400).json({ error: 'body.list debe ser array' });

      if (list.length === 0 && !req.body.allowEmpty) {
        return res.status(400).json({ error: 'Lista vacía bloqueada. Usa allowEmpty:true si es intencional.' });
      }
      if (list.some(p => p.id == null)) {
        return res.status(400).json({ error: 'Todas las prendas deben tener id' });
      }

      const ids = list.map(p => p.id);
      const ops = list.map(p => ({
        replaceOne: { filter: { id: p.id }, replacement: stripId(p), upsert: true }
      }));
      ops.push({ deleteMany: { filter: { id: { $nin: ids } } } });

      const result = await col.bulkWrite(ops, { ordered: false });
      invalidarSyncCache();

      return res.status(200).json({
        ok: true,
        count: list.length,
        modificados: result.modifiedCount,
        insertados: result.upsertedCount,
        borrados: result.deletedCount,
      });
    }

    return res.status(405).json({ error: 'Método no permitido' });

  } catch (err) {
    console.error('[inventario]', err);
    return res.status(500).json({ error: err.message });
  }
}

function normalize({ _id, ...rest }) { return rest; }
function stripId({ _id, ...rest }) { return rest; }
function invalidarSyncCache() {
  try { global._syncCache = null; global._syncCacheTime = 0; } catch (_) {}
}
