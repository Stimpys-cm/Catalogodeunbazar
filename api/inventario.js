// api/inventario.js
// GET /api/inventario        → lista todas las prendas
// PUT /api/inventario        → guarda el inventario (body: { list })
//
// El guardado es diff-based (bulkWrite): actualiza/inserta cada prenda por su
// id y borra solo las que ya no están. Esto es más seguro que borrar toda la
// colección y reinsertar (si algo falla a medias, no se pierde todo).

import { getDB } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db  = await getDB();
    const col = db.collection('inventario');

    // ── GET ──────────────────────────────────────────────────
    if (req.method === 'GET') {
      const items = await col.find({}).sort({ _id: -1 }).toArray();
      return res.status(200).json(items.map(normalize));
    }

    // ── PUT — guarda el inventario de forma segura ───────────
    if (req.method === 'PUT') {
      const { list } = req.body;
      if (!Array.isArray(list)) return res.status(400).json({ error: 'body.list debe ser array' });

      // Salvaguarda: nunca aceptar una lista vacía a menos que sea intencional.
      // (Evita borrar todo el inventario por un bug del cliente.)
      // Si de verdad se quiere vaciar, se envía { list: [], allowEmpty: true }.
      if (list.length === 0 && !req.body.allowEmpty) {
        return res.status(400).json({ error: 'Lista vacía bloqueada. Usa allowEmpty:true si es intencional.' });
      }

      // Todas las prendas deben tener id
      if (list.some(p => p.id == null)) {
        return res.status(400).json({ error: 'Todas las prendas deben tener id' });
      }

      // Construir operaciones: upsert por id + borrar los ausentes
      const ids = list.map(p => p.id);
      const ops = list.map(p => ({
        replaceOne: {
          filter: { id: p.id },
          replacement: stripId(p),
          upsert: true,
        }
      }));
      // Borrar las prendas que ya no están en la lista
      ops.push({ deleteMany: { filter: { id: { $nin: ids } } } });

      const result = await col.bulkWrite(ops, { ordered: false });

      // Invalidar el caché del sync para que nadie reciba datos viejos
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

// Invalida el caché en memoria de api/sync.js (compartido vía global)
function invalidarSyncCache() {
  try { global._syncCache = null; global._syncCacheTime = 0; } catch (_) {}
}
