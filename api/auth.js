// api/auth.js
// POST /api/auth   body: { username, password, override? }
//
// Reglas de sesión única:
//  - Cada cuenta solo puede tener UNA sesión activa a la vez.
//  - El que ya está adentro se queda: si la cuenta está ocupada, se rechaza
//    el nuevo login con 409 { error, locked: true }.
//  - Excepción (override): si la cuenta es de rol 'admin' Y se envía la
//    clave maestra correcta en `override`, se le permite entrar y se expulsa
//    a la sesión anterior (se le asigna un sessionToken nuevo).
//  - Una sesión se considera "viva" si su último ping de actividad fue hace
//    menos de SESSION_TIMEOUT_MS. Pasado ese tiempo, la cuenta queda libre.
//
// Devuelve { id, username, role, sessionToken } si entra.

import { getDB } from './_db.js';
import crypto from 'crypto';

// Clave maestra: configúrala en Vercel → Settings → Environment Variables
// como MASTER_KEY. Si no existe, usa el fallback (cámbialo).
const MASTER_KEY = process.env.MASTER_KEY;

// Ventana de inactividad: si el último ping fue hace más de esto, la sesión
// se considera muerta y la cuenta queda libre. 45s para alinear con activos.js.
const SESSION_TIMEOUT_MS = 45000;

function newToken() {
  return crypto.randomUUID();
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  const { username, password, override } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username y password requeridos' });
  }

  try {
    const db   = await getDB();
    const col  = db.collection('usuarios');
    const act  = db.collection('activos');

    // Insertar admin por defecto si no existe
    const adminExists = await col.findOne({ username: 'admin' });
    if (!adminExists) {
      await col.insertOne({ id: 1, username: 'admin', password: 'stiimpys2026', role: 'admin' });
    }

    const user = await col.findOne({ username, password });
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

    // ¿La cuenta ya tiene una sesión viva?
    // Viva = tiene sessionToken guardado Y hay actividad reciente en /activos.
    const cutoff   = new Date(Date.now() - SESSION_TIMEOUT_MS);
    const activity = await act.findOne({ username });
    const isAlive  = !!user.sessionToken
                  && !!activity
                  && new Date(activity.lastActive) >= cutoff;

    if (isAlive) {
      // La cuenta está ocupada. Solo un admin con la clave maestra puede forzar.
      const canOverride = user.role === 'admin' && override && override === MASTER_KEY;

      if (!canOverride) {
        // Si mandó override pero está mal (o no es admin), avisamos distinto.
        if (override) {
          return res.status(403).json({
            error: user.role === 'admin'
              ? 'Clave maestra incorrecta.'
              : 'Esta cuenta no tiene permiso para forzar el acceso.',
            locked: true,
            canUseOverride: user.role === 'admin'
          });
        }
        return res.status(409).json({
          error: 'Esta cuenta ya tiene una sesión activa.',
          locked: true,
          canUseOverride: user.role === 'admin'
        });
      }
      // Override válido → continúa y reemplaza el token abajo.
    }

    // Generar y guardar token de sesión nuevo (pisa el anterior si lo había).
    const sessionToken = newToken();
    await col.updateOne({ id: user.id }, { $set: { sessionToken } });

    // Refrescamos su actividad para que cuente como "adentro" de inmediato.
    await act.updateOne(
      { username },
      { $set: { username, lastActive: new Date() } },
      { upsert: true }
    );

    return res.status(200).json({
      id: user.id,
      username: user.username,
      role: user.role,
      sessionToken
    });

  } catch (err) {
    console.error('[auth]', err);
    return res.status(500).json({ error: err.message });
  }
}
