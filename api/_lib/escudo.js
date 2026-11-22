// ─────────────────────────────────────────────────────────────
//  api/_lib/escudo.js — La primera puerta de TODAS las funciones /api · v40
//
//  conEscudo(handler) envuelve cada una de las 12 funciones. Antes de que
//  el código de la función vea la petición:
//
//   1. Solo deja pasar los métodos que usa el sitio (GET, POST, PUT, PATCH,
//      DELETE, OPTIONS, HEAD). Lo demás → 405.
//   2. Limpia lo que manda el navegador (cuerpo y ?parámetros):
//        · quita llaves que empiezan con "$" ({"$ne": null}, {"$where": …}):
//          son operadores de MongoDB y con ellos se intenta "preguntar"
//          a la base sin saber la contraseña o el código (inyección NoSQL);
//        · quita __proto__, constructor y prototype (contaminación de
//          prototipos: intentar volverse "admin" desde un JSON);
//        · rechaza JSON anidado más de 12 niveles (bombas de JSON).
//   3. Bloquea escrituras que vienen de OTRO sitio web (CSRF): si una página
//      ajena intenta usar la sesión abierta del navegador para mandar un
//      POST a /api, el navegador lo marca (Origin / Sec-Fetch-Site) y aquí
//      se rechaza. Los avisos de Clip y la tarea diaria de Vercel no vienen
//      de un navegador, así que pasan.
//   4. Pone cabeceras seguras en toda respuesta del API: nada se guarda en
//      cachés compartidas salvo que la función lo pida, el navegador no
//      "adivina" tipos de archivo y ningún otro sitio puede incrustarla.
//   5. Si la función truena, el visitante solo ve un mensaje genérico: nunca
//      el detalle técnico (rutas, consultas, nombres de colecciones).
// ─────────────────────────────────────────────────────────────

const METODOS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const PROHIBIDAS = new Set(['__proto__', 'constructor', 'prototype']);
const PROFUNDIDAD_MAX = 12;

class Demasiado extends Error {}

// Copia limpia: sin operadores de Mongo ni llaves de prototipo
export function limpiar(valor, nivel = 0) {
  if (nivel > PROFUNDIDAD_MAX) throw new Demasiado('JSON demasiado anidado');
  if (Array.isArray(valor)) return valor.map(v => limpiar(v, nivel + 1));
  if (valor && typeof valor === 'object') {
    // Buffer / fechas / etc. se dejan como vienen (no son JSON del visitante)
    if (Object.getPrototypeOf(valor) !== Object.prototype && Object.getPrototypeOf(valor) !== null) return valor;
    const out = {};
    for (const k of Object.keys(valor)) {
      if (PROHIBIDAS.has(k) || k.startsWith('$')) continue;
      out[k] = limpiar(valor[k], nivel + 1);
    }
    return out;
  }
  return valor;
}

// Dominios desde los que se puede escribir (además del propio)
function origenesPermitidos(req) {
  const propios = new Set();
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim().toLowerCase();
  if (host) { propios.add(`https://${host}`); propios.add(`http://${host}`); }
  const sitio = String(process.env.SITE_URL || 'https://stiimpys.store').replace(/\/+$/, '').toLowerCase();
  propios.add(sitio);
  propios.add(sitio.replace('://', '://www.'));
  return propios;
}

// ¿La escritura viene de una página de otro sitio?
export function esDeOtroSitio(req) {
  const h = req.headers || {};
  const origen = String(h.origin || '').toLowerCase();
  if (origen && origen !== 'null') return !origenesPermitidos(req).has(origen);
  if (origen === 'null') return true;                 // iframes con sandbox, data:, archivos locales
  // Sin Origin: los navegadores modernos igual mandan Sec-Fetch-Site
  const sitio = String(h['sec-fetch-site'] || '').toLowerCase();
  return sitio === 'cross-site';
}

const ESCRITURA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Llamadas de servidor a servidor que sí pueden venir de fuera
const DE_FUERA_OK = (req) => {
  const op = String(req.query?.op || '');
  return op === 'v-clip-webhook' || op === 'ig-cron';
};

export function conEscudo(handler) {
  return async function escudado(req, res) {
    // 4 · Cabeceras de toda respuesta del API (la función puede cambiar Cache-Control después)
    try {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'private, no-store');
    } catch (_) { /* respuesta simulada en pruebas */ }

    const metodo = String(req.method || 'GET').toUpperCase();
    if (!METODOS.has(metodo)) return res.status(405).json({ error: 'Método no permitido' });

    // 2 · Limpiar cuerpo y parámetros
    try {
      for (const campo of ['body', 'query']) {
        const v = req[campo];
        if (!v || typeof v !== 'object' || Buffer.isBuffer(v)) continue;
        const limpio = limpiar(v);
        // En Vercel req.body/req.query pueden ser propiedades "perezosas" (solo getter)
        try { req[campo] = limpio; } catch (_) { /* sin setter */ }
        if (req[campo] !== limpio) Object.defineProperty(req, campo, { value: limpio, writable: true, configurable: true, enumerable: true });
      }
    } catch (e) {
      if (e instanceof Demasiado) return res.status(400).json({ error: 'Datos inválidos' });
      throw e;
    }

    // 3 · Escrituras desde otro sitio web
    if (ESCRITURA.has(metodo) && !DE_FUERA_OK(req) && esDeOtroSitio(req)) {
      return res.status(403).json({ error: 'Solicitud bloqueada: viene de otro sitio.' });
    }

    // 5 · Errores sin detalles técnicos
    try {
      return await handler(req, res);
    } catch (e) {
      console.error('[api]', req.url, e);
      if (!res.headersSent && !res.writableEnded) return res.status(500).json({ error: 'No se pudo completar la operación.' });
    }
  };
}
