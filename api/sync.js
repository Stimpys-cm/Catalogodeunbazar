// api/sync.js
// Caché en memoria del servidor — se comparte entre todas las peticiones
// mientras la función serverless esté "caliente"

import { getDB } from './_db.js';

// Caché en memoria compartido vía global — así los endpoints de escritura
// (inventario, config) pueden invalidarlo tras un PUT y evitar servir datos
// viejos que "revivan" algo recién borrado.
const CACHE_TTL = 2000; // 2 segundos de caché
global._syncCache     = global._syncCache     || null;
global._syncCacheTime = global._syncCacheTime || 0;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  // Servir desde caché si está fresco (salvo que pidan datos frescos)
  const now = Date.now();
  const forzarFresco = req.query.fresh === '1';
  if (!forzarFresco && global._syncCache && (now - global._syncCacheTime) < CACHE_TTL) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Cache-Control', 'public, max-age=2');
    return res.status(200).json(global._syncCache);
  }

  try {
    const db = await getDB();

    const [inv, cats, brands, users, activos, logs, drops] = await Promise.all([
      db.collection('inventario').find({}).sort({ _id: -1 }).toArray(),
      db.collection('categorias').find({}).sort({ id: 1 }).toArray(),
      db.collection('marcas').find({}).sort({ id: 1 }).toArray(),
      db.collection('usuarios').find({}).sort({ id: 1 }).toArray(),
      db.collection('activos').find({
        lastActive: { $gte: new Date(Date.now() - 45000) }
      }).toArray(),
      db.collection('logs').find({}).sort({ ts: -1 }).limit(200).toArray(),
      db.collection('drops').find({}).sort({ _id: -1 }).toArray(),
    ]);

    global._syncCache = {
      inventario: inv.map(normalize),
      categorias: cats.map(normalize),
      marcas:     brands.map(normalize),
      // Nunca exponer password ni sessionToken al público: este endpoint no
      // tiene autenticación. La verificación de contraseñas vive en el backend
      // (api/auth.js, api/change-password.js, api/session-check.js).
      usuarios:   users.map(publicUser),
      activos:    activos.map(u => ({ username: u.username, lastActive: u.lastActive })),
      logs:       logs.map(normalize),
      drops:      drops.map(normalize),
    };
    global._syncCacheTime = now;

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=2');
    return res.status(200).json(global._syncCache);

  } catch (err) {
    console.error('[sync]', err);
    // Si falla MongoDB pero hay caché, servir el caché aunque esté viejo
    if (global._syncCache) return res.status(200).json(global._syncCache);
    return res.status(500).json({ error: err.message });
  }
}

function normalize({ _id, ...rest }) { return rest; }

// Solo campos no sensibles del usuario (sin password ni sessionToken)
function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, avatar: u.avatar || null };
}
