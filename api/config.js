// api/config.js
// GET /api/config?col=X       → lista items (público, para sembrar defaults)
// PUT /api/config             → reemplaza toda la colección (requiere sesión)
//
// Reglas (Fase 1):
//  - categorias / marcas / drops  → solo ADMIN.
//  - usuarios                     → ADMIN completo; un vendedor solo puede
//    cambiar SU PROPIO avatar (bloquea escalación de privilegios).

import { getDB } from './_db.js';
import { requireAuth } from './_auth.js';

const COLS = ['categorias', 'marcas', 'usuarios', 'drops'];

const DEFAULTS = {
  categorias: [
    { id:1, nombre:'Pantalones' }, { id:2, nombre:'Playeras' },
    { id:3, nombre:'Suéteres' }, { id:4, nombre:'Chamarras' }, { id:5, nombre:'Shorts' },
  ],
  marcas: [
    { id:1, nombre:'Nike' }, { id:2, nombre:'Adidas' }, { id:3, nombre:'Supreme' }, { id:4, nombre:'Dickies' },
  ],
  usuarios: [ { id:1, username:'admin', password:'stiimpys2026', role:'admin' } ]
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
      if (count === 0 && DEFAULTS[colName]) await col.insertMany(DEFAULTS[colName]);
      const items = await col.find({}).sort({ id: 1 }).toArray();
      return res.status(200).json(items.map(normalize));
    }

    // ── PUT — reemplaza toda la colección (requiere sesión) ──
    if (req.method === 'PUT') {
      const user = await requireAuth(req, res);
      if (!user) return;                                  // 401

      const { col: colName, list } = req.body;
      if (!COLS.includes(colName)) {
        return res.status(400).json({ error: `col debe ser: ${COLS.join(', ')}` });
      }
      if (!Array.isArray(list)) {
        return res.status(400).json({ error: 'body.list debe ser array' });
      }

      const col  = db.collection(colName);
      const prev = await col.find({}).toArray();

      // 🔒 Autorización por colección
      if (colName !== 'usuarios') {
        // categorias / marcas / drops → solo admin
        if (user.role !== 'admin') {
          return res.status(403).json({ error: 'Requiere permisos de administrador.' });
        }
      } else if (user.role !== 'admin') {
        // usuarios + no-admin → solo puede tocar SU propio avatar
        const prevById = new Map(prev.map(u => [u.id, u]));
        const soloSuAvatar = list.length === prev.length && list.every(u => {
          const old = prevById.get(u.id);
          if (!old) return false;                          // no puede agregar usuarios
          if (u.username !== old.username) return false;   // no renombra
          if (u.role !== old.role) return false;           // no cambia roles (escalación)
          if (u.id === user.id) return true;               // su propio doc: puede tocar avatar
          return (u.avatar ?? null) === (old.avatar ?? null); // ajenos: avatar intacto
        });
        if (!soloSuAvatar) {
          return res.status(403).json({ error: 'Solo un administrador puede gestionar usuarios.' });
        }
      }

      // Para 'usuarios': preservar password/sessionToken/avatar que el cliente
      // ya no maneja (no los recibe por seguridad). Una password nueva sí se respeta.
      let toInsert = list;
      if (colName === 'usuarios') {
        const byId = new Map(prev.map(u => [u.id, u]));
        toInsert = list.map(u => {
          const old = byId.get(u.id);
          return {
            ...u,
            password:     (u.password != null && u.password !== '') ? u.password : (old ? old.password : u.password),
            sessionToken: old ? old.sessionToken : u.sessionToken,
            avatar:       (u.avatar !== undefined) ? u.avatar : (old ? old.avatar : null),
          };
        });
        // El admin principal (id 1 o 'admin') NUNCA se elimina.
        const hayPrincipal = toInsert.some(u => u.id === 1 || (u.username && u.username.toLowerCase() === 'admin'));
        if (!hayPrincipal) {
          const principal = prev.find(u => u.id === 1 || (u.username && u.username.toLowerCase() === 'admin'));
          if (principal) toInsert.push(principal);
        }
      }

      await col.deleteMany({});
      if (toInsert.length > 0) await col.insertMany(toInsert);
      try { global._syncCache = null; global._syncCacheTime = 0; } catch (_) {}
      return res.status(200).json({ ok: true, count: toInsert.length });
    }

    return res.status(405).json({ error: 'Método no permitido' });

  } catch (err) {
    console.error('[config]', err);
    return res.status(500).json({ error: err.message });
  }
}

function normalize({ _id, ...rest }) { return rest; }
