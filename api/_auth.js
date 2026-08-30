// api/_auth.js
// ─────────────────────────────────────────────────────────────
// MIDDLEWARE DE AUTENTICACIÓN reutilizable para las Serverless Functions.
//
// Valida el token de sesión que llega en:
//   1) el header  Authorization: Bearer <token>   (lo que usa el frontend), o
//   2) la cookie httpOnly  "sesion"                (opcional, para Fase 2)
// contra la colección 'usuarios' de Mongo (campo sessionToken).
//
// Los archivos que empiezan con "_" NO cuentan como Serverless Functions en
// Vercel (son helpers), así que esto no gasta tu cupo de 12.
//
// USO dentro de cualquier endpoint:
//   import { requireAuth, requireAdmin } from './_auth.js';
//   const user = await requireAuth(req, res);  if (!user) return;   // 401
//   const admin = await requireAdmin(req, res); if (!admin) return;  // 401/403
// ─────────────────────────────────────────────────────────────

import { getDB } from './_db.js';

function getToken(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)sesion=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// Devuelve { id, username, role, bazarId } si el token es válido; si no, null.
// bazarId null = staff global (admin principal, manda sobre todos los bazares).
export async function getUser(req) {
  const token = getToken(req);
  if (!token) return null;
  const db   = await getDB();
  const user = await db.collection('usuarios').findOne({ sessionToken: token });
  if (!user) return null;
  // La cookie caduca sola, pero el token guardado no: sin esto, uno copiado
  // del navegador seguiría abriendo el panel para siempre.
  if (user.tokenExpira && new Date(user.tokenExpira) < new Date()) return null;
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    bazarId: user.bazarId != null ? Number(user.bazarId) : null,
  };
}

// Exige sesión válida. Si no la hay, responde 401 y devuelve null.
export async function requireAuth(req, res) {
  const user = await getUser(req);
  if (!user) {
    res.status(401).json({ error: 'No autenticado. Inicia sesión.' });
    return null;
  }
  return user;
}

// Exige rol admin. Responde 401 (sin sesión) o 403 (sin permisos).
export async function requireAdmin(req, res) {
  const user = await requireAuth(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Requiere permisos de administrador.' });
    return null;
  }
  return user;
}
