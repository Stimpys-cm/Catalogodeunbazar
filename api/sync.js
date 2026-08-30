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
//
// Cada respuesta lleva ETag: si el catálogo no cambió, el navegador recibe
// un 304 vacío en vez del JSON entero. Con un visitante consultando cada
// 20 s, eso es la diferencia entre unos bytes y varios cientos de KB.

import crypto from 'crypto';
import { getDB } from './_db.js';
import { getUser } from './_auth.js';
import { bazarPublico, prendaPublica } from './_bazar.js';
import { resenaPublica } from './_ventas.js';
import { leerAjustes } from './_ajustes.js';
import { subastaPublica } from './_subastas.js';

// El panel necesita verse en vivo; la tienda no cambia cada dos segundos.
// El caché público es largo porque toda escritura lo invalida al instante
// (ver invalidarSyncCache en _db.js).
const TTL_PANEL   =  2000;
const TTL_PUBLICO = 30000;

// Caché en memoria compartido vía global — así los endpoints de escritura
// (inventario, config) pueden invalidarlo tras un PUT y evitar servir datos
// viejos que "revivan" algo recién borrado.
global._syncCache      = global._syncCache      || null;
global._syncCacheTime  = global._syncCacheTime  || 0;
global._syncCachePub   = global._syncCachePub   || null;
global._syncCachePubTime = global._syncCachePubTime || 0;

// Deja el cuerpo ya serializado y con su ETag calculado: se hace una vez
// por refresco, no una vez por visitante.
function empaquetar(datos) {
  const cuerpo = JSON.stringify(datos);
  const etag   = '"' + crypto.createHash('sha1').update(cuerpo).digest('base64') + '"';
  return { datos, cuerpo, etag };
}

function responder(req, res, paquete, cabeceraCache, estadoCache) {
  res.setHeader('Cache-Control', cabeceraCache);
  res.setHeader('ETag', paquete.etag);
  res.setHeader('X-Cache', estadoCache);
  if (req.headers['if-none-match'] === paquete.etag) return res.status(304).end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).send(paquete.cuerpo);
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

  const cache     = publico ? global._syncCachePub : global._syncCache;
  const cacheTime = publico ? global._syncCachePubTime : global._syncCacheTime;
  const ttl       = publico ? TTL_PUBLICO : TTL_PANEL;

  if (!forzarFresco && cache && (now - cacheTime) < ttl) {
    return responder(req, res, cache, cabeceraCache, 'HIT');
  }

  try {
    const db = await getDB();

    // Cada consulta cuesta, y el visitante no usa ni usuarios, ni el
    // registro de acciones, ni quién está conectado: en modo público
    // esas cuatro colecciones ni se tocan.
    const comunes = [
      db.collection('inventario').find({}).sort({ _id: -1 }).toArray(),
      db.collection('categorias').find({}).sort({ id: 1 }).toArray(),
      db.collection('marcas').find({}).sort({ id: 1 }).toArray(),
      db.collection('bazares').find({}).sort({ id: 1 }).toArray(),
      // Reseñas públicas de los bazares: alimentan la pestaña "Reseñas"
      // de cada tienda y la estrella promedio del perfil.
      db.collection('resenas').find({ tipo: 'bazar' }).sort({ creadoEn: -1 }).limit(500).toArray(),
      // Qué partes del sitio están abiertas: las páginas públicas lo
      // necesitan para saber si deben mostrarse o pedir disculpas.
      leerAjustes(),
      // Las subastas viven aparte de la prenda a propósito: así un
      // guardado del panel nunca puede borrar las ofertas de la gente.
      db.collection('subastas').find({}).sort({ fin: 1 }).toArray(),
    ];

    if (publico) {
      const [inv, cats, brands, bazares, resenas, ajustes, subastas] = await Promise.all(comunes);
      global._syncCachePub = empaquetar({
        inventario: inv.map(prendaPublica),
        categorias: cats.map(normalize),
        marcas:     brands.map(normalize),
        bazares:    bazares.map(bazarPublico),
        resenas:    resenas.map(resenaPublica),
        ajustes,
        subastas:   subastas.map(subastaPublica),
      });
      global._syncCachePubTime = now;
      return responder(req, res, global._syncCachePub, cabeceraCache, 'MISS');
    }

    const [inv, cats, brands, bazares, resenas, ajustes, subastas, users, activos, logs, drops] =
      await Promise.all([
        ...comunes,
        db.collection('usuarios').find({}).sort({ id: 1 }).toArray(),
        db.collection('activos').find({
          lastActive: { $gte: new Date(Date.now() - 45000) }
        }).toArray(),
        db.collection('logs').find({}).sort({ ts: -1 }).limit(200).toArray(),
        db.collection('drops').find({}).sort({ _id: -1 }).toArray(),
      ]);

    global._syncCache = empaquetar({
      inventario: inv.map(normalize),
      categorias: cats.map(normalize),
      marcas:     brands.map(normalize),
      // Nunca exponer password ni sessionToken: la verificación de
      // contraseñas vive en el backend (api/auth.js, api/change-password.js).
      usuarios:   users.map(publicUser),
      activos:    activos.map(u => ({ username: u.username, lastActive: u.lastActive })),
      logs:       logs.map(normalize),
      drops:      drops.map(normalize),
      // Solo datos públicos del bazar (los permisos no se exponen aquí)
      bazares:    bazares.map(bazarPublico),
      resenas:    resenas.map(resenaPublica),
      ajustes,
      subastas:   subastas.map(subastaPublica),
    });
    global._syncCacheTime = now;
    return responder(req, res, global._syncCache, cabeceraCache, 'MISS');

  } catch (err) {
    console.error('[sync]', err);
    // Si falla MongoDB pero hay caché, servir el caché aunque esté viejo
    if (cache) return responder(req, res, cache, 'no-store', 'STALE');
    return res.status(500).json({ error: 'No se pudo completar la operación.' });
  }
}

function normalize({ _id, ...rest }) { return rest; }

// Solo campos no sensibles del usuario (sin password ni sessionToken)
function publicUser(u) {
  return {
    id: u.id, username: u.username, role: u.role,
    avatar: u.avatar || null,
    bazarId: u.bazarId != null ? Number(u.bazarId) : null,
  };
}
