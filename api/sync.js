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
import { getDB } from './_lib/db.js';
import { getUser } from './_lib/auth.js';
import { bazarPublico, bazarTienda, prendaPublica, multiBazar, idPrincipal, deLaTienda } from './_lib/bazar.js';
import { resenaPublica } from './_lib/ventas.js';
import { leerAjustes } from './_lib/ajustes.js';
import { subastaPublica } from './_lib/subastas.js';
import { datosTiendaPublica } from './_lib/crecer.js';
import { esGlobal } from './_lib/bazar.js';
import { marcarSistema } from './_lib/actividad.js';
import { registrarFalla } from './_lib/actividad.js';

import { conEscudo } from './_lib/escudo.js';
import { sinCosto } from './_lib/bazar.js';
// El panel necesita verse en vivo; la tienda no cambia cada dos segundos.
// El caché público es largo porque toda escritura lo invalida al instante
// (ver invalidarSyncCache en _db.js).
const TTL_PANEL   =  2000;
const TTL_PUBLICO = 5000;    // v55: antes 30 s; la tienda ve los cambios del panel en segundos

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

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  // La respuesta completa (usuarios, actividad, registro de acciones) es solo
  // para quien tiene sesión. Sin sesión se sirve la pública, aunque no la pidan:
  // así nadie puede leer el movimiento interno del bazar desde la calle.
  let publico = req.query.scope === 'publico';
  // Pidió la versión del panel pero no trae sesión: se le da la pública, pero
  // sin dejarla en el CDN. Si se guardara, el CDN se la serviría también al
  // panel (misma URL) y el panel se quedaría sin datos unos segundos.
  let degradado = false, user = null;
  if (!publico) {
    user = await getUser(req).catch(() => null);
    if (!user) { publico = true; degradado = true; }
  }
  // v33: el registro del panel (logs) es de toda la plataforma. Un bazar solo ve lo de su
  // propia gente; el admin principal, todo. Se filtra al responder (el caché es compartido).
  const paraUsuario = paquete => {
    if (publico || !user || (esGlobal(user) && user.role === 'admin')) return paquete;
    let datos = paquete.datos;
    // v41 · Costos y ganancias solo para administradores (un vendedor no los recibe)
    if (user.role !== 'admin') datos = { ...datos, inventario: (datos.inventario || []).map(sinCosto) };
    if (esGlobal(user)) return empaquetar(datos);
    const suyos = new Set((datos.usuarios || []).filter(u => Number(u.bazarId) === Number(user.bazarId)).map(u => u.username));
    return empaquetar({ ...datos, logs: (datos.logs || []).filter(l => suyos.has(l.usuario)) });
  };

  const now = Date.now();
  const forzarFresco = req.query.fresh === '1';

  // Cabeceras de caché: en modo público el CDN de Vercel sirve la mayoría
  // de las visitas sin invocar la función ni tocar la base de datos.
  // El panel va "private": trae costos, usuarios y registro de acciones, y con
  // "public" un proxy intermedio podría guardarlo y dárselo a otra persona.
  const cabeceraCache = degradado
    ? 'private, no-store'
    : publico
      ? 'public, max-age=3, s-maxage=5, stale-while-revalidate=15'   // v55: antes s-maxage=15 y hasta 2 min de copia vieja
      : 'private, max-age=2';

  const cache     = publico ? global._syncCachePub : global._syncCache;
  const cacheTime = publico ? global._syncCachePubTime : global._syncCacheTime;
  const ttl       = publico ? TTL_PUBLICO : TTL_PANEL;

  if (!forzarFresco && cache && (now - cacheTime) < ttl) {
    return responder(req, res, paraUsuario(cache), cabeceraCache, 'HIT');
  }

  try {
    const db = await getDB();

    // v56 · Apartados del panel/WhatsApp que ya vencieron: se sueltan aquí (máximo una vez
    // por minuto en cada instancia), sin esperar a la tarea diaria de las 9:00. Así la
    // tienda, el panel e Instagram dejan de decir "Apartada" en cuanto vence.
    if (Date.now() - (global._liberarApartadosEn || 0) > 60000) {
      global._liberarApartadosEn = Date.now();
      try {
        const hayVencidos = await db.collection('inventario').findOne({ apartada: true, vendido: { $ne: true }, reservedUntil: { $lt: new Date().toISOString() } });
        if (hayVencidos) {
          const { liberarApartados } = await import('./_lib/automatico.js');
          for (const b of await db.collection('bazares').find({}).toArray()) await liberarApartados(db, b, { soloManuales: true });
        }
      } catch (e) { console.error('[sync liberar apartados]', e); }
    }

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
      const [[inv, cats, brands, bazares, resenas, ajustes, subastas], tienda] = await Promise.all([Promise.all(comunes), datosTiendaPublica(db).catch(() => null)]);
      // v39 · Una sola tienda: al público solo sale lo de Stiimpys (MULTI_BAZAR=1 lo abre).
      const principal = idPrincipal(bazares);
      const deAqui = deLaTienda(principal);
      global._syncCachePub = empaquetar({
        // Las prendas ocultas (borradores, drops que no salen) no se publican
        inventario: inv.filter(p => !p.oculto && deAqui(p)).map(prendaPublica),
        categorias: cats.map(normalize),
        marcas:     brands.map(normalize),
        bazares:    bazares.filter(b => multiBazar() || Number(b.id) === principal).map(bazarTienda),
        resenas:    resenas.filter(r => deAqui(r) && !r.oculta).map(resenaPublica),   // v42: las ocultas no salen
        ajustes,
        subastas:   subastas.filter(deAqui).map(subastaPublica),
        tienda,
        modo:       { multiBazar: multiBazar(), principal },
      });
      global._syncCachePubTime = now;
      await marcarSistema('syncPublico', db, 60e3);
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
      // v56: el panel también sabe si es una sola tienda (para no repetir "STIIMPYS" en cada tarjeta)
      modo:       { multiBazar: multiBazar(), principal: idPrincipal(bazares) },
    });
    global._syncCacheTime = now;
    await marcarSistema('syncPanel', db, 60e3);
    return responder(req, res, paraUsuario(global._syncCache), cabeceraCache, 'MISS');

  } catch (err) {
    console.error('[sync]', err);
    await registrarFalla(err, { origen: 'sync' });
    // Si falla MongoDB pero hay caché, servir el caché aunque esté viejo
    if (cache) return responder(req, res, paraUsuario(cache), 'no-store', 'STALE');
    return res.status(500).json({ error: 'No se pudo completar la operación.' });
  }
}

function normalize({ _id, ...rest }) { return rest; }

// Solo campos no sensibles del usuario (sin password ni sessionToken)
function publicUser(u) {
  return {
    id: u.id, username: u.username, role: u.role,
    avatar: u.avatar || null, permisos: u.permisos || null,
    bazarId: u.bazarId != null ? Number(u.bazarId) : null,
  };
}

// v40 · Todas las funciones pasan primero por el escudo (ver api/_lib/escudo.js)
export default conEscudo(handler);
