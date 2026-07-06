// api/sync.js
// Caché en memoria del servidor — se comparte entre todas las peticiones
// mientras la función serverless esté "caliente"

import { getDB } from './_db.js';

// Caché en memoria (se resetea solo si la función entra en cold start)
let _cache     = null;
let _cacheTime = 0;
const CACHE_TTL = 5000; // 5 segundos de caché

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  // Servir desde caché si está fresco
  const now = Date.now();
  if (_cache && (now - _cacheTime) < CACHE_TTL) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Cache-Control', 'public, max-age=5');
    return res.status(200).json(_cache);
  }

  try {
    const db = await getDB();

    const [inv, cats, brands, users, activos] = await Promise.all([
      db.collection('inventario').find({}).sort({ _id: -1 }).toArray(),
      db.collection('categorias').find({}).sort({ id: 1 }).toArray(),
      db.collection('marcas').find({}).sort({ id: 1 }).toArray(),
      db.collection('usuarios').find({}).sort({ id: 1 }).toArray(),
      db.collection('activos').find({
        lastActive: { $gte: new Date(Date.now() - 45000) }
      }).toArray(),
    ]);

    _cache = {
      inventario: inv.map(normalize),
      categorias: cats.map(normalize),
      marcas:     brands.map(normalize),
      // Nunca exponer password ni sessionToken al público: este endpoint no
      // tiene autenticación. La verificación de contraseñas vive en el backend
      // (api/auth.js, api/change-password.js, api/session-check.js).
      usuarios:   users.map(publicUser),
      activos:    activos.map(u => ({ username: u.username, lastActive: u.lastActive })),
    };
    _cacheTime = now;

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=5');
    return res.status(200).json(_cache);

  } catch (err) {
    console.error('[sync]', err);
    // Si falla MongoDB pero hay caché, servir el caché aunque esté viejo
    if (_cache) return res.status(200).json(_cache);
    return res.status(500).json({ error: err.message });
  }
}

function normalize({ _id, ...rest }) { return rest; }

// Solo campos no sensibles del usuario (sin password ni sessionToken)
function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role };
}
