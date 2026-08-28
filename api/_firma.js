// api/_firma.js
// ─────────────────────────────────────────────────────────────
// Firma de acceso al panel.
//
// El middleware (que corre en el borde, sin acceso a Mongo) necesita saber
// si quien pide el panel tiene una sesión legítima. Para eso, al iniciar
// sesión se deja una cookie firmada: "usuario.vence.firma".
//
// La firma es un HMAC con SESSION_SECRET. Sin ese secreto nadie puede
// fabricar una cookie válida, aunque conozca la dirección del panel.
// ─────────────────────────────────────────────────────────────

import crypto from 'crypto';

export const COOKIE_ACCESO = 'acceso';
const HORAS_VALIDA = 8;

export function secreto() {
  return process.env.SESSION_SECRET || process.env.MASTER_KEY || '';
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Crea el valor de la cookie para un usuario
export function firmarAcceso(username, rol) {
  const s = secreto();
  if (!s) return '';                       // sin secreto no se firma nada
  const vence  = Date.now() + HORAS_VALIDA * 60 * 60 * 1000;
  const cuerpo = `${base64url(String(username))}.${vence}.${rol === 'admin' ? 'a' : 'v'}`;
  const firma  = base64url(crypto.createHmac('sha256', s).update(cuerpo).digest());
  return `${cuerpo}.${firma}`;
}

export function cabeceraCookieAcceso(valor) {
  const partes = [
    `${COOKIE_ACCESO}=${valor}`,
    'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/',
    `Max-Age=${HORAS_VALIDA * 60 * 60}`,
  ];
  return partes.join('; ');
}

export function cabeceraCookieBorrada() {
  return `${COOKIE_ACCESO}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
