// api/_db.js
// Conexión compartida a MongoDB Atlas.
// Vercel reutiliza instancias "calientes", así que el cliente
// se crea una sola vez por instancia (no por request).

import { MongoClient } from 'mongodb';

const uri    = process.env.MONGODB_URI;   // variable de entorno en Vercel
const dbName = process.env.MONGODB_DB || 'bazar';

let client;
let clientPromise;

if (!uri) {
  throw new Error('Falta la variable de entorno MONGODB_URI');
}

if (!client) {
  client = new MongoClient(uri);
  clientPromise = client.connect();
}

export async function getDB() {
  await clientPromise;
  return client.db(dbName);
}
