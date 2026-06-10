// api/sync.js
// GET /api/sync → devuelve TODO en una sola petición
// Reduce 4 llamadas a MongoDB a 1 sola por poll

import { getDB } from './_db.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const db = await getDB();

    // 4 colecciones en paralelo dentro del mismo servidor — latencia mínima
    const [inv, cats, brands, users, activos] = await Promise.all([
      db.collection('inventario').find({}).sort({ _id: -1 }).toArray(),
      db.collection('categorias').find({}).sort({ id: 1 }).toArray(),
      db.collection('marcas').find({}).sort({ id: 1 }).toArray(),
      db.collection('usuarios').find({}).sort({ id: 1 }).toArray(),
      db.collection('activos').find({
        lastActive: { $gte: new Date(Date.now() - 45000) }
      }).toArray(),
    ]);

    return res.status(200).json({
      inventario:  inv.map(normalize),
      categorias:  cats.map(normalize),
      marcas:      brands.map(normalize),
      usuarios:    users.map(normalize),
      activos:     activos.map(u => ({ username: u.username, lastActive: u.lastActive })),
    });

  } catch (err) {
    console.error('[sync]', err);
    return res.status(500).json({ error: err.message });
  }
}

function normalize({ _id, ...rest }) { return rest; }
