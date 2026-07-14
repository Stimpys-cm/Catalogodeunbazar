// api/_password.js
// ─────────────────────────────────────────────────────────────
// Manejo de contraseñas con bcrypt, tolerante a la migración gradual:
//  - verifyPassword() acepta contraseñas viejas EN TEXTO PLANO y también
//    hasheadas. Así nada se rompe mientras migras.
//  - hashPassword() genera el hash bcrypt.
//  - Import DEFENSIVO de bcryptjs: si el paquete no está instalado, NO se
//    rompe el login (las contraseñas en texto plano siguen funcionando).
//
// (helper con "_" → no cuenta como Serverless Function en Vercel)
// ─────────────────────────────────────────────────────────────

let _bcrypt = undefined;   // undefined = no intentado, null = no disponible

async function getBcrypt() {
  if (_bcrypt !== undefined) return _bcrypt;
  try {
    const mod = await import('bcryptjs');
    _bcrypt = mod.default || mod;
  } catch (_) {
    _bcrypt = null;         // no instalado → seguimos con texto plano
  }
  return _bcrypt;
}

// ¿La cadena guardada parece un hash bcrypt? ($2a$ / $2b$ / $2y$)
export function looksHashed(stored) {
  return typeof stored === 'string' && /^\$2[aby]\$/.test(stored);
}

// Verifica una contraseña contra lo guardado (hash o texto plano).
export async function verifyPassword(plain, stored) {
  if (stored == null) return false;
  if (looksHashed(stored)) {
    const b = await getBcrypt();
    if (!b) return false;                 // sin bcrypt no podemos verificar hash
    return b.compare(String(plain), stored);
  }
  // Contraseña vieja en texto plano
  return String(plain) === String(stored);
}

// Genera hash. Si bcrypt no está disponible, devuelve el texto plano
// (no rompe nada; simplemente no se hashea hasta instalar bcryptjs).
export async function hashPassword(plain) {
  const b = await getBcrypt();
  if (!b) return String(plain);
  return b.hash(String(plain), 10);
}
