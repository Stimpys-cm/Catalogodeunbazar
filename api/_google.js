// api/_google.js
// ─────────────────────────────────────────────────────────────
// Verificación del "Continuar con Google".
//
// Se usa Google Identity Services: el botón vive en el navegador y
// Google le entrega ahí mismo un token firmado (un JWT). El navegador
// nos lo manda y aquí se comprueba que de verdad lo firmó Google y que
// es para nuestro sitio.
//
// No hay redirecciones ni "callback", así que no hace falta una
// Serverless Function nueva: entra por api/cuenta.js con ?op=google.
// Las 12 del plan gratis de Vercel ya estaban ocupadas.
//
// La firma se comprueba aquí, contra las claves públicas de Google, en
// lugar de preguntárselo a Google en cada login: es más rápido, no gasta
// una petición de salida por persona que entra y no depende de que su
// endpoint de comprobación esté disponible.
//
// Variable de entorno:
//   GOOGLE_CLIENT_ID   el mismo identificador que usa el botón en el
//                      navegador. Sin él, entrar con Google queda
//                      desactivado y el resto del sitio sigue igual.
// ─────────────────────────────────────────────────────────────

import crypto from 'crypto';

const CLAVES_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const EMISORES = new Set(['accounts.google.com', 'https://accounts.google.com']);

export const googleActivo = () => !!process.env.GOOGLE_CLIENT_ID;

// Las claves de Google cambian cada pocas horas y vienen con su propia
// fecha de caducidad. Se guardan mientras sigan vigentes: así una tanda
// de logins seguidos no las pide una y otra vez.
async function claves() {
  const ahora = Date.now();
  if (global._googleClaves && global._googleClavesHasta > ahora) {
    return global._googleClaves;
  }
  const r = await fetch(CLAVES_URL);
  if (!r.ok) throw new Error('No se pudieron leer las claves de Google');
  const { keys } = await r.json();

  // Google dice en la cabecera cuánto duran; por si acaso, mínimo 5 min.
  const cache = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  const segundos = Math.max(300, cache ? Number(cache[1]) : 3600);

  global._googleClaves = keys;
  global._googleClavesHasta = ahora + segundos * 1000;
  return keys;
}

function base64url(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// Devuelve los datos de la persona si el token es legítimo; si no, null.
// Nunca lanza por un token malo: un token invento es un 401, no un 500.
export async function verificarTokenGoogle(idToken) {
  const clienteId = process.env.GOOGLE_CLIENT_ID;
  if (!clienteId || typeof idToken !== 'string') return null;

  const partes = idToken.split('.');
  if (partes.length !== 3) return null;

  try {
    const cabecera = JSON.parse(base64url(partes[0]).toString('utf8'));
    const datos    = JSON.parse(base64url(partes[1]).toString('utf8'));
    if (cabecera.alg !== 'RS256') return null;

    const jwk = (await claves()).find(k => k.kid === cabecera.kid);
    if (!jwk) return null;

    const firmaOk = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${partes[0]}.${partes[1]}`),
      crypto.createPublicKey({ key: jwk, format: 'jwk' }),
      base64url(partes[2]),
    );
    if (!firmaOk) return null;

    // Que la firma sea de Google no basta: hay que comprobar que el token
    // se emitió para NUESTRO sitio. Sin esto valdría uno emitido para
    // cualquier otra aplicación de Google.
    if (!EMISORES.has(datos.iss)) return null;
    if (datos.aud !== clienteId) return null;
    if (!datos.exp || datos.exp * 1000 <= Date.now()) return null;

    // Un correo sin verificar no identifica a nadie: si se aceptara, alguien
    // podría crear una cuenta de Google con el correo de otra persona y
    // entrar en la suya.
    if (datos.email_verified !== true && datos.email_verified !== 'true') return null;
    const email = String(datos.email || '').toLowerCase().trim();
    if (!email) return null;

    return {
      email,
      nombre: String(datos.name || datos.given_name || '').slice(0, 60),
      avatar: /^https:\/\/lh\d+\.googleusercontent\.com\//.test(datos.picture || '')
        ? datos.picture : '',
      sub: String(datos.sub || ''),
    };
  } catch (err) {
    console.error('[google]', err.message);
    return null;
  }
}
