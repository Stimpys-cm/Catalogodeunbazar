// api/inventario-item.js
// POST   /api/inventario-item        → crea una prenda (requiere sesión)
// PATCH  /api/inventario-item?id=X   → actualiza campos de un ítem (requiere sesión)
// DELETE /api/inventario-item?id=X   → elimina un ítem (requiere admin)
//
// Existe para no mandar el inventario entero por cada cambio. El PUT de
// /api/inventario manda la lista COMPLETA: con muchas prendas se topa con
// el límite de tamaño de Vercel, y si dos personas del mismo bazar guardan
// a la vez, la última pisa lo que hizo la otra. Aquí cada prenda viaja
// sola, así que ninguna de las dos cosas pasa.

import { getDB } from './_db.js';
import { requireAuth } from './_auth.js';
import { esGlobal, mismoBazar, puede } from './_bazar.js';

// Lo que puede traer una prenda. Cualquier otra cosa que mande el
// navegador se descarta: nadie va a inventar campos desde fuera.
const CAMPOS = [
  'nombre', 'marca', 'categorias', 'talla', 'precio_venta', 'costo',
  'estado', 'descripcion', 'imagenes', 'vendido', 'vendidoEn', 'vendidoA',
  'oculto', 'dropId', 'creadoEn', 'reservedUntil', 'reservedBy',
];

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db  = await getDB();
    const col = db.collection('inventario');

    // ── POST — crea una prenda ──────────────────────────────
    if (req.method === 'POST') {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!esGlobal(user) && !(await puede(user, 'crearPrendas'))) {
        return res.status(403).json({ error: 'Tu bazar no tiene permitido publicar prendas.' });
      }

      const cuerpo = req.body || {};

      // El bazar lo decide el servidor: un vendedor no puede publicar en
      // el bazar de otro aunque lo mande en el cuerpo.
      const bazarId = esGlobal(user)
        ? Number(cuerpo.bazarId || 1)
        : Number(user.bazarId);

      if (!esGlobal(user) && !bazarId) {
        return res.status(403).json({ error: 'Tu cuenta no tiene bazar asignado.' });
      }

      const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : '';
      if (!nombre) return res.status(400).json({ error: 'La prenda necesita nombre' });

      // El id lo asigna el servidor. Si lo eligiera el navegador, dos
      // vendedores publicando a la vez se pisarían el número.
      const ultimo = await col.find({}).sort({ id: -1 }).limit(1).toArray();
      const nuevoId = (ultimo[0]?.id || 0) + 1;

      const prenda = { id: nuevoId, bazarId, creadoEn: new Date().toISOString(), vendido: false };
      for (const k of CAMPOS) if (k in cuerpo) prenda[k] = cuerpo[k];
      prenda.id = nuevoId;            // por si venía en el cuerpo
      prenda.bazarId = bazarId;
      prenda.nombre = nombre;

      await col.insertOne(prenda);
      invalidarSyncCache();
      const { _id, ...limpio } = prenda;
      return res.status(201).json({ ok: true, prenda: limpio });
    }

    const id = parseInt(req.query.id);
    if (!id) return res.status(400).json({ error: 'Falta ?id=N' });

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
      const $set = {};
      for (const key of CAMPOS) if (key in updates) $set[key] = updates[key];
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
