// api/change-password.js
// POST /api/change-password   body: { actual, nueva }   [requiere sesión]
// Verifica la contraseña actual en el servidor y guarda la nueva HASHEADA.
// Solo puedes cambiar TU propia contraseña (el usuario sale del token).

import { getDB, invalidarSyncCache } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { verifyPassword, hashPassword } from './_lib/password.js';
import { rateLimit } from './_lib/rateLimit.js';
import { cabecerasSesion, HORAS_SESION } from './_lib/firma.js';
import crypto from 'crypto';
import { conAuditoria } from './_lib/auditoria.js';
import { registrarFalla } from './_lib/actividad.js';

import { conEscudo } from './_lib/escudo.js';
// v33: queda registrado quién cambió su contraseña (nunca la contraseña)
const auditado = conAuditoria(handler, req => req.method === 'POST' || req.method === 'PUT'
  ? { op: 'cambiar-contrasena', categoria: 'auth', accion: 'Cambió su contraseña', duplicados: false } : null);

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  const user = await requireAuth(req, res);
  if (!user) return;

  // Freno a quien intente adivinar la contraseña actual desde una sesión robada
  if (!(await rateLimit(req, res, { key: 'cambio-pass', max: 10, windowSec: 900 }))) return;

  const cuerpo = req.body || {};
  const actual = typeof cuerpo.actual === 'string' ? cuerpo.actual : '';
  const nueva  = typeof cuerpo.nueva  === 'string' ? cuerpo.nueva  : '';

  if (!actual || !nueva) {
    return res.status(400).json({ error: 'actual y nueva requeridos' });
  }
  if (nueva.length < 8 || nueva.length > 200) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener entre 8 y 200 caracteres' });
  }
  if (!/[A-Z]/.test(nueva) || !/[a-z]/.test(nueva) || !/[0-9]/.test(nueva)) {
    return res.status(400).json({ error: 'La nueva contraseña necesita mayúscula, minúscula y número' });
  }
  if (nueva === actual) {
    return res.status(400).json({ error: 'La nueva contraseña debe ser distinta de la actual' });
  }

  try {
    const db   = await getDB();
    const col  = db.collection('usuarios');
    const dbUser = await col.findOne({ id: user.id });

    const ok = dbUser && await verifyPassword(actual, dbUser.password);
    if (!ok) return res.status(401).json({ error: 'La contraseña actual es incorrecta' });

    const hash = await hashPassword(nueva);
    // Al cambiar la contraseña se invalida cualquier sesión abierta en otro
    // dispositivo: si alguien te robó el acceso, con esto lo dejas fuera.
    // El token se rota en vez de borrarse, así que quien acaba de cambiarla
    // sigue dentro: los expulsados son los demás.
    const sessionToken = crypto.randomUUID();
    const tokenExpira  = new Date(Date.now() + HORAS_SESION * 60 * 60 * 1000);
    await col.updateOne({ id: user.id },
      { $set: { password: hash, sessionToken, tokenExpira } });
    invalidarSyncCache();
    res.setHeader('Set-Cookie', cabecerasSesion(sessionToken, dbUser.username, dbUser.role));
    return res.status(200).json({ ok: true, sesionesCerradas: true, sessionToken });

  } catch (err) {
    console.error('[change-password]', err);
    await registrarFalla(err, { origen: 'change-password' });
    return res.status(500).json({ error: 'No se pudo completar la operación.' });
  }
}

// v40 · Todas las funciones pasan primero por el escudo (ver api/_lib/escudo.js)
export default conEscudo(auditado);
