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
import { rateLimit, resetRateLimit } from './_rateLimit.js';
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

  // Los datos siempre se tratan como texto: si llegara un objeto
  // ({"$ne": null}) Mongo lo interpretaría como una consulta y se podría
  // buscar usuarios sin conocer el nombre.
  const cuerpo   = req.body || {};
  const username = typeof cuerpo.username === 'string' ? cuerpo.username.trim() : '';
  const password = typeof cuerpo.password === 'string' ? cuerpo.password : '';
  const override = typeof cuerpo.override === 'string' ? cuerpo.override : '';

  if (!username || !password) {
    return res.status(400).json({ error: 'username y password requeridos' });
  }
  if (username.length > 60 || password.length > 200) {
    return res.status(400).json({ error: 'Datos demasiado largos' });
  }

  // Freno a la fuerza bruta: 8 intentos fallidos por IP cada 15 minutos.
  if (!(await rateLimit(req, res, { key: 'login', max: 8, windowSec: 900 }))) return;

  try {
    const db   = await getDB();
    const col  = db.collection('usuarios');
    const act  = db.collection('activos');

    // Insertar admin por defecto si no existe
    const adminExists = await col.findOne({ username: 'admin' });
    if (!adminExists) {
      await col.insertOne({ id: 1, username: 'admin', password: 'stiimpys2026', role: 'admin', bazarId: null });
    }

    // Buscar por username y verificar la contraseña (hash o texto plano)
    const user = await col.findOne({ username });
    if (!user) {
      // Mismo mensaje y mismo tiempo que una contraseña equivocada:
      // así no se puede averiguar qué usuarios existen.
      await verifyPassword(password, '$2a$10$invalidoinvalidoinvalidoinvalidoinvalidoinvalidoinvalido');
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

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

    // Quien acertó no arrastra el contador de intentos
    await resetRateLimit(req, 'login');

    return res.status(200).json({
      id: user.id, username: user.username, role: user.role, sessionToken,
      bazarId: user.bazarId != null ? Number(user.bazarId) : null,
    });

  } catch (err) {
    console.error('[auth]', err);
    return res.status(500).json({ error: err.message });
  }
}
