// api/auth.js
// POST /api/auth   body: { username, password, override? }
//
// Reglas de sesión única (sin cambios respecto a tu versión):
//  - Una sola sesión activa por cuenta; override admin con clave maestra.
//
// Seguridad (Fase 2):
//  - Verifica la contraseña con bcrypt, aceptando también las viejas en texto
//    plano y MIGRÁNDOLAS a hash automáticamente al primer login correcto.
//  - Deja una cookie httpOnly 'sesion' con el token (además del JSON de siempre),
//    para que el backend pueda validar permisos sin exponer el token al JS.
//
// Devuelve { id, username, role, sessionToken } si entra.

import { getDB } from './_db.js';
import { verifyPassword, hashPassword, looksHashed } from './_password.js';
import crypto from 'crypto';

const MASTER_KEY = process.env.MASTER_KEY;
const SESSION_TIMEOUT_MS = 45000;

function newToken() { return crypto.randomUUID(); }

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', [
    `sesion=${encodeURIComponent(token)}`,
    'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/',
    `Max-Age=${60 * 60 * 8}`,   // 8 horas
  ].join('; '));
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

    // Buscar por username y verificar la contraseña (hash o texto plano)
    const user = await col.findOne({ username });
    if (!user) return res.status(401).json({ error: 'Credenciales incorrectas' });

    const passOk = await verifyPassword(password, user.password);
    if (!passOk) return res.status(401).json({ error: 'Credenciales incorrectas' });

    // Migración gradual: si la guardada estaba en texto plano, hashearla ahora.
    if (!looksHashed(user.password)) {
      const nuevoHash = await hashPassword(password);
      if (looksHashed(nuevoHash)) {                 // solo si bcrypt está disponible
        await col.updateOne({ id: user.id }, { $set: { password: nuevoHash } });
      }
    }

    // ¿La cuenta ya tiene una sesión viva?
    const cutoff   = new Date(Date.now() - SESSION_TIMEOUT_MS);
    const activity = await act.findOne({ username });
    const isAlive  = !!user.sessionToken
                  && !!activity
                  && new Date(activity.lastActive) >= cutoff;

    if (isAlive) {
      const canOverride = user.role === 'admin' && override && override === MASTER_KEY;
      if (!canOverride) {
        if (override) {
          return res.status(403).json({
            error: user.role === 'admin' ? 'Clave maestra incorrecta.' : 'Esta cuenta no tiene permiso para forzar el acceso.',
            locked: true, canUseOverride: user.role === 'admin'
          });
        }
        return res.status(409).json({
          error: 'Esta cuenta ya tiene una sesión activa.',
          locked: true, canUseOverride: user.role === 'admin'
        });
      }
    }

    const sessionToken = newToken();
    await col.updateOne({ id: user.id }, { $set: { sessionToken } });
    await act.updateOne(
      { username },
      { $set: { username, lastActive: new Date() } },
      { upsert: true }
    );

    // Cookie httpOnly (defensa contra robo de token por XSS)
    setSessionCookie(res, sessionToken);

    return res.status(200).json({
      id: user.id, username: user.username, role: user.role, sessionToken
    });

  } catch (err) {
    console.error('[auth]', err);
    return res.status(500).json({ error: err.message });
  }
}
