// api/inventario.js
// GET /api/inventario        → lista las prendas (sin datos internos si no
//                              hay sesión: el costo y la reserva son del bazar)
// PUT /api/inventario        → guarda el inventario (requiere sesión)
//
// El guardado es diff-based (bulkWrite): actualiza/inserta cada prenda por su
// id y borra solo las que ya no están. Esto es más seguro que borrar toda la
// colección y reinsertar (si algo falla a medias, no se pierde todo).

import { getDB, asegurarIndicesBase, invalidarSyncCache } from './_db.js';
import { getUser, requireAuth } from './_auth.js';
import { esGlobal, puede, prendaPublica } from './_bazar.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db  = await getDB();
    const col = db.collection('inventario');

    // ── GET ──────────────────────────────────────────────────
    // Sin sesión se responde la versión pública: el costo de cada prenda
    // es el margen del bazar y no tiene por qué salir a la calle.
    if (req.method === 'GET') {
      const user  = await getUser(req).catch(() => null);
      const items = await col.find({}).sort({ _id: -1 }).toArray();
      return res.status(200).json(items.map(user ? normalize : prendaPublica));
    }

    // ── PUT — guarda el inventario (solo con sesión válida) ──
    if (req.method === 'PUT') {
      const user = await requireAuth(req, res);
      if (!user) return;                    // 401 si no hay sesión
      await asegurarIndicesBase();

      const { list } = req.body;
      if (!Array.isArray(list)) return res.status(400).json({ error: 'body.list debe ser array' });

      if (list.length === 0 && !req.body.allowEmpty) {
        return res.status(400).json({ error: 'Lista vacía bloqueada. Usa allowEmpty:true si es intencional.' });
      }
      if (list.some(p => p.id == null)) {
        return res.status(400).json({ error: 'Todas las prendas deben tener id' });
      }

      // ── Multi-bazar ───────────────────────────────────────
      // Un bazar solo puede escribir y borrar SUS prendas. El admin
      // principal (sin bazarId) escribe sobre todas.
      const global_ = esGlobal(user);

      if (!global_) {
        if (!user.bazarId) {
          return res.status(403).json({ error: 'Tu cuenta no está asignada a ningún bazar.' });
        }
        if (!(await puede(user, 'crearPrendas')) && !(await puede(user, 'editarPrendas'))) {
          return res.status(403).json({ error: 'Tu bazar no tiene permitido modificar prendas.' });
        }
        const ajena = list.find(p => p.bazarId != null && Number(p.bazarId) !== Number(user.bazarId));
        if (ajena) {
          return res.status(403).json({ error: `La prenda ${ajena.id} pertenece a otro bazar.` });
        }
        list.forEach(p => { p.bazarId = Number(user.bazarId); });
      } else {
        // El admin principal: lo que llegue sin bazar queda en el principal
        list.forEach(p => { if (p.bazarId == null) p.bazarId = 1; });
      }

      const ids = list.map(p => p.id);
      const ops = list.map(p => ({
        replaceOne: { filter: { id: p.id }, replacement: stripId(p), upsert: true }
      }));
      // El borrado se acota al propio bazar: guardar tu inventario nunca
      // puede eliminar prendas de los demás.
      ops.push({ deleteMany: { filter: global_
        ? { id: { $nin: ids } }
        : { id: { $nin: ids }, bazarId: Number(user.bazarId) } } });

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
    return res.status(500).json({ error: 'No se pudo completar la operación.' });
  }
}

function normalize({ _id, ...rest }) { return rest; }
function stripId({ _id, ...rest }) { return rest; }
