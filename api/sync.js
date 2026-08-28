// api/sync.js
// Caché en memoria del servidor — se comparte entre todas las peticiones
// mientras la función serverless esté "caliente"
//
// Hay dos respuestas:
//   ?scope=publico  → lo que necesita la tienda: inventario (sin datos
//                     internos), categorías, marcas y bazares. Es la que
//                     piden todos los visitantes, así que se cachea en el
//                     CDN y casi nunca llega a Mongo.
//   sin scope       → todo, para el panel de administración.

import { getDB } from './_db.js';
import { getUser } from './_auth.js';
import { bazarPublico } from './_bazar.js';

// Caché en memoria compartido vía global — así los endpoints de escritura
// (inventario, config) pueden invalidarlo tras un PUT y evitar servir datos
// viejos que "revivan" algo recién borrado.
const CACHE_TTL = 2000; // 2 segundos de caché
global._syncCache      = global._syncCache      || null;
global._syncCacheTime  = global._syncCacheTime  || 0;
global._syncCachePub   = global._syncCachePub   || null;

// Campos que NUNCA salen al público (costo interno, notas privadas...)
const CAMPOS_PRIVADOS = ['costo', 'reservedBy', 'reservedUntil'];

function prendaPublica(p) {
  const out = {};
  for (const k of Object.keys(p)) {
    if (k === '_id' || CAMPOS_PRIVADOS.includes(k)) continue;
    out[k] = p[k];
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  // La respuesta completa (usuarios, actividad, registro de acciones) es solo
  // para quien tiene sesión. Sin sesión se sirve la pública, aunque no la pidan:
  // así nadie puede leer el movimiento interno del bazar desde la calle.
  let publico = req.query.scope === 'publico';
  if (!publico) {
    const user = await getUser(req).catch(() => null);
    if (!user) publico = true;
  }

  const now = Date.now();
  const forzarFresco = req.query.fresh === '1';

  // Cabeceras de caché: en modo público el CDN de Vercel sirve la mayoría
  // de las visitas sin invocar la función ni tocar la base de datos.
  const cabeceraCache = publico
    ? 'public, max-age=5, s-maxage=15, stale-while-revalidate=120'
    : 'public, max-age=2';

  // Servir desde caché si está fresco (salvo que pidan datos frescos)
  if (!forzarFresco && global._syncCache && (now - global._syncCacheTime) < CACHE_TTL) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Cache-Control', cabeceraCache);
    if (publico) {
      global._syncCachePub = global._syncCachePub || recortarPublico(global._syncCache);
      return res.status(200).json(global._syncCachePub);
    }
    return res.status(200).json(global._syncCache);
  }

  try {
    const db = await getDB();

    const [inv, cats, brands, users, activos, logs, drops, bazares] = await Promise.all([
      db.collection('inventario').find({}).sort({ _id: -1 }).toArray(),
      db.collection('categorias').find({}).sort({ id: 1 }).toArray(),
      db.collection('marcas').find({}).sort({ id: 1 }).toArray(),
      db.collection('usuarios').find({}).sort({ id: 1 }).toArray(),
      db.collection('activos').find({
        lastActive: { $gte: new Date(Date.now() - 45000) }
      }).toArray(),
      db.collection('logs').find({}).sort({ ts: -1 }).limit(200).toArray(),
      db.collection('drops').find({}).sort({ _id: -1 }).toArray(),
      db.collection('bazares').find({}).sort({ id: 1 }).toArray(),
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
      // Solo datos públicos del bazar (los permisos no se exponen aquí)
      bazares:    bazares.map(bazarPublico),
    };
    global._syncCacheTime = now;
    global._syncCachePub  = recortarPublico(global._syncCache);

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', cabeceraCache);
    return res.status(200).json(publico ? global._syncCachePub : global._syncCache);

  } catch (err) {
    console.error('[sync]', err);
    // Si falla MongoDB pero hay caché, servir el caché aunque esté viejo
    if (global._syncCache) {
      if (publico) {
        global._syncCachePub = global._syncCachePub || recortarPublico(global._syncCache);
        return res.status(200).json(global._syncCachePub);
      }
      return res.status(200).json(global._syncCache);
    }
    return res.status(500).json({ error: err.message });
  }
}

function normalize({ _id, ...rest }) { return rest; }

// Versión ligera para la tienda: sin usuarios, sin logs, sin actividad y
// sin los campos internos de cada prenda.
function recortarPublico(todo) {
  return {
    inventario: (todo.inventario || []).map(prendaPublica),
    categorias: todo.categorias || [],
    marcas:     todo.marcas     || [],
    bazares:    todo.bazares    || [],
  };
}

// Solo campos no sensibles del usuario (sin password ni sessionToken)
function publicUser(u) {
  return {
    id: u.id, username: u.username, role: u.role,
    avatar: u.avatar || null,
    bazarId: u.bazarId != null ? Number(u.bazarId) : null,
  };
}
