// api/config.js
// GET /api/config?col=X       → lista items
// PUT /api/config             → reemplaza toda la colección (body: { col, list })

import { getDB } from './_db.js';

const COLS = ['categorias', 'marcas', 'usuarios'];

const DEFAULTS = {
  categorias: [
    { id:1, nombre:'Pantalones' },
    { id:2, nombre:'Playeras'   },
    { id:3, nombre:'Suéteres'   },
    { id:4, nombre:'Chamarras'  },
    { id:5, nombre:'Shorts'     },
  ],
  marcas: [
    { id:1, nombre:'Nike'    },
    { id:2, nombre:'Adidas'  },
    { id:3, nombre:'Supreme' },
    { id:4, nombre:'Dickies' },
  ],
  usuarios: [
    { id:1, username:'admin', password:'stiimpys2026', role:'admin' }
  ]
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db = await getDB();

    // ── GET ──────────────────────────────────────────────────
    if (req.method === 'GET') {
      const colName = req.query.col;
      if (!COLS.includes(colName)) {
        return res.status(400).json({ error: `col debe ser: ${COLS.join(', ')}` });
      }
      const col   = db.collection(colName);
      const count = await col.countDocuments();
      if (count === 0 && DEFAULTS[colName]) {
        await col.insertMany(DEFAULTS[colName]);
      }
      const items = await col.find({}).sort({ id: 1 }).toArray();
      return res.status(200).json(items.map(normalize));
    }

    // ── PUT — reemplaza toda la colección ────────────────────
    if (req.method === 'PUT') {
      const { col: colName, list } = req.body;
      if (!COLS.includes(colName)) {
        return res.status(400).json({ error: `col debe ser: ${COLS.join(', ')}` });
      }
      if (!Array.isArray(list)) {
        return res.status(400).json({ error: 'body.list debe ser array' });
      }
      const col = db.collection(colName);

      // Para 'usuarios': el frontend ya NO recibe password/sessionToken
      // (ver api/sync.js). Al reemplazar la colección, preservamos esos
      // campos sensibles desde la BD para no borrarlos. Si el cliente envía
      // una password nueva (alta de vendedor / reset), esa sí se respeta.
      let toInsert = list;
      if (colName === 'usuarios') {
        const prev  = await col.find({}).toArray();
        const byId  = new Map(prev.map(u => [u.id, u]));
        toInsert = list.map(u => {
          const old = byId.get(u.id);
          return {
            ...u,
            password:     (u.password != null && u.password !== '')
                            ? u.password
                            : (old ? old.password : u.password),
            sessionToken: old ? old.sessionToken : u.sessionToken,
          };
        });
      }

      await col.deleteMany({});
      if (toInsert.length > 0) await col.insertMany(toInsert);
      return res.status(200).json({ ok: true, count: toInsert.length });
    }

    return res.status(405).json({ error: 'Método no permitido' });

  } catch (err) {
    console.error('[config]', err);
    return res.status(500).json({ error: err.message });
  }
}

function normalize({ _id, ...rest }) { return rest; }
