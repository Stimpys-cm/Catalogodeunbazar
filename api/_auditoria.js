// ─────────────────────────────────────────────────────────────
//  api/_auditoria.js — Registro automático de operaciones · v33
//
//  conAuditoria(handler, reglas) envuelve una función de Vercel. Para cada
//  petición que las reglas marquen como "operación administrativa":
//    1. Bloquea la misma petición repetida (doble clic, reintento del
//       navegador) mientras la primera sigue en curso o acaba de terminar.
//    2. Ejecuta el handler tal cual, guardando la respuesta un instante.
//    3. Registra en el Centro de actividad quién, qué, sobre qué y cómo
//       terminó (correcto, rechazado o error) — sin datos sensibles.
//    4. Envía la respuesta.
//  Así ningún endpoint existente cambia su lógica para quedar auditado.
//
//  Un handler puede afinar el registro con req._evento = { categoria,
//  accion, bazarId, pedidoId, prendaId, detalle, omitir }. "omitir" se usa
//  cuando el handler ya dejó eventos más detallados por su cuenta.
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { getDB } from './_db.js';
import { getUser } from './_auth.js';
import { registrarEvento, registrarFalla, tomarBloqueo, soltarBloqueo, sanear } from './_actividad.js';

// JSON con llaves ordenadas: dos cuerpos iguales dan la misma huella
function estable(v) {
  if (Array.isArray(v)) return `[${v.map(estable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${estable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

function capturar(res) {
  const orig = { json: res.json?.bind(res), send: res.send?.bind(res), end: res.end.bind(res) };
  const cap = { tipo: null, cuerpo: undefined };
  res.json = b => { if (!cap.tipo) { cap.tipo = 'json'; cap.cuerpo = b; } return res; };
  res.send = b => { if (!cap.tipo) { cap.tipo = 'send'; cap.cuerpo = b; } return res; };
  res.end = b => { if (!cap.tipo) { cap.tipo = 'end'; cap.cuerpo = b; } return res; };
  cap.enviar = () => {
    res.json = orig.json; res.send = orig.send; res.end = orig.end;
    if (res.headersSent || res.writableEnded) return;
    if (cap.tipo === 'json') return orig.json(cap.cuerpo);
    if (cap.tipo === 'send') return orig.send(cap.cuerpo);
    return orig.end(cap.cuerpo);
  };
  return cap;
}

export function conAuditoria(handler, reglas) {
  return async function auditado(req, res) {
    let regla = null;
    try { regla = req.method === 'OPTIONS' ? null : reglas(req); } catch (_) { regla = null; }
    if (!regla) {
      try { return await handler(req, res); }
      catch (e) {
        await registrarFalla(e, { origen: regla?.origen || 'api', op: req.query?.op || null });
        if (!res.headersSent) return res.status(500).json({ error: 'No se pudo completar la operación.' });
        return;
      }
    }

    const t0 = Date.now();
    let db = null, user = null, candado = null, claveDup = null;
    try { db = await getDB(); user = await getUser(req); } catch (_) { /* sin base: el handler responderá su error */ }

    // 1 · La misma operación, del mismo usuario, con el mismo contenido, dos veces seguidas
    if (db && user && regla.duplicados !== false && !['GET', 'HEAD'].includes(req.method)) {
      claveDup = 'dup:' + crypto.createHash('sha1')
        .update(`${user.id}|${regla.op || ''}|${req.method}|${req.url?.split('?')[0]}|${estable(req.query)}|${estable(req.body ?? null)}`)
        .digest('hex').slice(0, 32);
      try { candado = await tomarBloqueo(db, claveDup, regla.ventana || 6); }
      catch (_) { candado = 'sin-candado'; }   // si el candado falla, se deja pasar (no bloquear la operación)
      if (!candado) {
        await registrarEvento({ categoria: regla.categoria, tipo: 'duplicado', resultado: 'rechazado', op: regla.op,
          accion: `Solicitud repetida bloqueada: ${regla.accion || regla.op}`, usuario: user.username, rol: user.role,
          bazarId: user.bazarId, unaVezCada: { clave: claveDup, ms: 10e3 } }, db);
        return res.status(409).json({ error: 'Esa misma operación se acaba de enviar y se está procesando. Espera unos segundos antes de repetirla.', duplicado: true });
      }
    }

    // 2 · Ejecutar
    const cap = capturar(res);
    let excepcion = null;
    try { await handler(req, res); }
    catch (e) {
      excepcion = e;
      if (!cap.tipo) { res.status(500); cap.tipo = 'json'; cap.cuerpo = { error: 'No se pudo completar la operación.' }; }
    }

    // 3 · Registrar
    try {
      const ev = req._evento || {};
      const estado = Number(res.statusCode) || 200;
      const resultado = excepcion || estado >= 500 ? 'error' : estado >= 400 ? 'rechazado' : 'ok';
      if (excepcion) await registrarFalla(excepcion, { origen: regla.origen || 'api', op: regla.op, usuario: user?.username, bazarId: user?.bazarId });
      const omitir = ev.omitir || (regla.soloErrores && resultado === 'ok');
      if (!omitir) {
        const errorTxt = cap.cuerpo && typeof cap.cuerpo === 'object' ? cap.cuerpo.error : null;
        await registrarEvento({
          categoria: ev.categoria || regla.categoria || 'admin',
          tipo: ev.tipo || regla.tipo || regla.op || 'operacion',
          accion: ev.accion || regla.accion || regla.op,
          resultado, op: regla.op,
          usuario: user?.username || ev.usuario || regla.usuario || 'sin sesión', rol: user?.role || null,
          bazarId: ev.bazarId ?? user?.bazarId ?? regla.bazarId ?? null,
          pedidoId: ev.pedidoId ?? regla.pedidoId ?? null,
          prendaId: ev.prendaId ?? regla.prendaId ?? null,
          detalle: { ...(regla.detalle || {}), ...(ev.detalle || {}) },
          error: resultado !== 'ok' ? { message: errorTxt || excepcion?.message || `HTTP ${estado}`, status: estado, name: excepcion?.name || 'Respuesta' } : null,
          ms: Date.now() - t0,
          // Sin sesión (robots probando rutas del panel): uno por minuto basta
          ...(!user ? { unaVezCada: { clave: `anon:${regla.op}:${estado}`, ms: 60e3 } } : {}),
        }, db || undefined);
      }
    } catch (e) { console.error('[auditoria]', e?.message || e); }

    // Si terminó en error se suelta el candado para poder reintentar enseguida
    if (candado && candado !== 'sin-candado' && (Number(res.statusCode) >= 400 || excepcion)) await soltarBloqueo(db, claveDup, candado);

    // 4 · Responder
    return cap.enviar();
  };
}

// Detalle seguro a partir del cuerpo de la petición (sin contraseñas, tokens, fotos ni direcciones)
export const detalleDe = (obj, llaves) => {
  if (!obj || typeof obj !== 'object') return {};
  const base = llaves ? Object.fromEntries(llaves.filter(k => obj[k] !== undefined).map(k => [k, obj[k]])) : obj;
  return sanear(base) || {};
};
