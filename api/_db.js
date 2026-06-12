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
