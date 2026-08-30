// api/_db.js
import { MongoClient } from 'mongodb';

const uri    = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'bazar';

if (!uri) throw new Error('Falta MONGODB_URI');

const options = {
  // Tiempo máximo para conectar — falla rápido en vez de colgar 30s
  connectTimeoutMS:       5000,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS:        10000,

  // Pool de conexiones — reutiliza conexiones entre requests
  maxPoolSize:  10,
  minPoolSize:  1,

  // Compresión — reduce datos entre Vercel y Atlas
  compressors: ['zlib'],
};

// Patrón singleton — una sola conexión por instancia serverless
let clientPromise;

if (!global._mongoClientPromise) {
  const client = new MongoClient(uri, options);
  global._mongoClientPromise = client.connect();
}
clientPromise = global._mongoClientPromise;

export async function getDB() {
  const client = await clientPromise;
  return client.db(dbName);
}

// Índices de las colecciones base (una sola vez por instancia serverless).
// Sin esto, validar una sesión (usuarios.sessionToken) o abrir una ficha
// (inventario.id) obliga a Mongo a recorrer la colección entera en cada
// petición, que es justo lo que agota la CPU del plan gratis.
export async function asegurarIndicesBase() {
  if (global._idxBase) return;
  const db = await getDB();
  const crear = async (col, llaves, opciones) => {
    try { await db.collection(col).createIndex(llaves, opciones); } catch (_) {}
  };
  await Promise.all([
    // Validar la sesión en cada petición: es la consulta más repetida del sitio
    crear('usuarios', { sessionToken: 1 }, { sparse: true }),
    crear('usuarios', { username: 1 }, { unique: true }),
    crear('usuarios', { bazarId: 1 }),
    crear('inventario', { id: 1 }, { unique: true }),
    crear('inventario', { bazarId: 1 }),
    crear('activos', { lastActive: 1 }),
    crear('activos', { username: 1 }, { unique: true }),
    crear('bazares', { id: 1 }, { unique: true }),
    crear('bazares', { slug: 1 }, { unique: true }),
    crear('logs', { ts: -1 }),
  ]);
  global._idxBase = true;
}

// Tira el caché de /api/sync. Lo llama todo endpoint que escribe, para que
// el siguiente sync no devuelva datos viejos que "revivan" lo recién
// borrado. Vive aquí porque lo usan casi todos los endpoints.
export function invalidarSyncCache() {
  try {
    global._syncCache        = null;
    global._syncCacheTime    = 0;
    global._syncCachePub     = null;
    global._syncCachePubTime = 0;
  } catch (_) {}
}
