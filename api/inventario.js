// api/inventario.js
// GET /api/inventario        → lista todas las prendas
// PUT /api/inventario        → reemplaza TODO el inventario (body: { list })

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

    // ── PUT — reemplaza todo el inventario ───────────────────
    if (req.method === 'PUT') {
      const { list } = req.body;
      if (!Array.isArray(list)) return res.status(400).json({ error: 'body.list debe ser array' });

      // Borra todo y reinserta — operación atómica simple
      await col.deleteMany({});
      if (list.length > 0) await col.insertMany(list);

      return res.status(200).json({ ok: true, count: list.length });
    }

    return res.status(405).json({ error: 'Método no permitido' });

  } catch (err) {
    console.error('[inventario]', err);
    return res.status(500).json({ error: err.message });
  }
}

function normalize({ _id, ...rest }) { return rest; }
