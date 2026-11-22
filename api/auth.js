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

import { getDB, asegurarIndicesBase } from './_lib/db.js';
import { verifyPassword, hashPassword, looksHashed } from './_lib/password.js';
import { rateLimit, resetRateLimit } from './_lib/rateLimit.js';
import { cabecerasSesion, cabeceraCookieBorrada, HORAS_SESION } from './_lib/firma.js';
import { leerAjustes, cerrada, mensajeDe } from './_lib/ajustes.js';
import { esGlobal } from './_lib/bazar.js';
import crypto from 'crypto';
import { registrarEvento, registrarFalla } from './_lib/actividad.js';

import { conEscudo } from './_lib/escudo.js';
const MASTER_KEY = process.env.MASTER_KEY;
const SESSION_TIMEOUT_MS = 45000;

function newToken() { return crypto.randomUUID(); }

// La puerta del panel: tiene que coincidir con RUTA_POR_DEFECTO de
// middleware.js. Es a donde se manda al usuario tras iniciar sesión.
const RUTA_PANEL_DEFECTO = 'manage-x9k2p7q-control';

// Crea la cuenta 'admin' la primera vez, con la contraseña de
// ADMIN_INICIAL_PASS ya hasheada. Devuelve null si la base ya tiene
// cuentas o si la variable no está configurada.
async function sembrarAdmin(col) {
  const inicial = process.env.ADMIN_INICIAL_PASS;
  if (!inicial) return null;
  if (await col.countDocuments({}, { limit: 1 })) return null;
  const doc = {
    id: 1, username: 'admin', role: 'admin', bazarId: null,
    password: await hashPassword(inicial),
  };
  try { await col.insertOne(doc); } catch (_) { return null; }
  return doc;
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Cerrar sesión: borra las cookies del navegador
  if (req.method === 'DELETE') {
    // Además de borrar las cookies, el token deja de valer en el servidor:
    // si alguien lo hubiera copiado, ya no abre el panel después de "Salir".
    try {
      const auth = req.headers.authorization || '';
      const m = (req.headers.cookie || '').match(/(?:^|;\s*)sesion=([^;]+)/);
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : (m ? decodeURIComponent(m[1]) : '');
      if (token) {
        const db = await getDB();
        const u = await db.collection('usuarios').findOne({ sessionToken: token }, { projection: { username: 1, role: 1, bazarId: 1 } });
        await db.collection('usuarios').updateOne({ sessionToken: token }, { $unset: { sessionToken: '', tokenExpira: '' } });
        if (u) await registrarEvento({ categoria: 'auth', tipo: 'auth.salir', usuario: u.username, rol: u.role, bazarId: u.bazarId, accion: 'Salió del panel' }, db);
      }
    } catch (e) { console.error('[auth salir]', e); }
    res.setHeader('Set-Cookie', [
      'sesion=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0',
      cabeceraCookieBorrada(),
    ]);
    return res.status(200).json({ ok: true });
  }

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
  // v40: además, máximo 20 intentos por CUENTA cada 15 minutos aunque vengan de
  // muchas conexiones distintas (ataque repartido para adivinar la contraseña).
  const claveCuenta = 'login-cuenta:' + crypto.createHash('sha256').update(username.toLowerCase()).digest('hex').slice(0, 16);
  if (!(await rateLimit({ headers: {}, socket: { remoteAddress: 'cuenta' } }, res, { key: claveCuenta, max: 20, windowSec: 900 }))) {
    await registrarEvento({ categoria: 'auth', tipo: 'auth.limite', resultado: 'rechazado', usuario: 'desconocido',
      accion: 'Demasiados intentos de entrada a una misma cuenta (bloqueo de 15 min)', unaVezCada: { clave: 'login-cuenta-429', ms: 300e3 } });
    return;
  }
  if (!(await rateLimit(req, res, { key: 'login', max: 8, windowSec: 900 }))) {
    await registrarEvento({ categoria: 'auth', tipo: 'auth.limite', resultado: 'rechazado', usuario: 'desconocido',
      accion: 'Demasiados intentos de entrada desde una misma conexión (bloqueo de 15 min)', unaVezCada: { clave: 'login-429', ms: 300e3 } });
    return;
  }
  // v33: los intentos quedan en el Centro de actividad. Si el usuario no existe se guarda
  // solo el inicio de lo que escribieron (por si alguien tecleó su contraseña en ese campo).
  const anotar = (resultado, accion, u, extra = {}) => registrarEvento({ categoria: 'auth', tipo: 'auth.entrar', resultado, accion,
    usuario: u ? u.username : 'desconocido', rol: u?.role || null, bazarId: u?.bazarId ?? null,
    detalle: u ? null : { intento: `${username.slice(0, 2)}•••` }, ...extra });

  try {
    const db   = await getDB();
    await asegurarIndicesBase();
    const col  = db.collection('usuarios');
    const act  = db.collection('activos');

    // Buscar por username y verificar la contraseña (hash o texto plano)
    let user = await col.findOne({ username });

    // Siembra de la primera cuenta: solo con la base vacía y solo si
    // ADMIN_INICIAL_PASS está definida. La contraseña nunca vive en el
    // código, y en cuanto existe una cuenta esto no vuelve a ejecutarse.
    if (!user && username === 'admin') user = await sembrarAdmin(col);

    if (!user) {
      // Mismo mensaje y mismo tiempo que una contraseña equivocada:
      // así no se puede averiguar qué usuarios existen.
      await verifyPassword(password, '$2a$10$invalidoinvalidoinvalidoinvalidoinvalidoinvalidoinvalido');
      await anotar('rechazado', 'Intento de entrada con un usuario que no existe');
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    const passOk = await verifyPassword(password, user.password);
    if (!passOk) { await anotar('rechazado', 'Intento de entrada con contraseña incorrecta', user); return res.status(401).json({ error: 'Credenciales incorrectas' }); }

    // Panel en mantenimiento: los bazares no entran, el admin general sí
    // (es quien lo abre de nuevo). Un admin de bazar tampoco pasa: manda
    // en lo suyo, no en la plataforma. La contraseña ya se verificó, así
    // que este aviso solo lo ve alguien con credenciales buenas.
    if (!esGlobal(user)) {
      const ajustes = await leerAjustes();
      if (cerrada(ajustes, 'panel')) {
        await anotar('rechazado', 'Intento de entrada con el panel en mantenimiento', user);
        return res.status(503).json({
          error: mensajeDe(ajustes, 'panel'),
          mantenimiento: true,
        });
      }
    }

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
      const bOver = Buffer.from(override || ''), bMaster = Buffer.from(MASTER_KEY || '');
      const canOverride = user.role === 'admin' && bOver.length > 0 && bMaster.length > 0
        && bOver.length === bMaster.length && crypto.timingSafeEqual(bOver, bMaster);
      if (!canOverride) {
        await anotar('rechazado', override ? 'Intento de forzar la sesión con clave maestra incorrecta' : 'Intento de entrada con una sesión abierta en otro dispositivo', user);
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
    // Misma vida que la cookie: pasadas las 8 horas el token deja de valer
    // aunque alguien lo haya copiado del navegador.
    const tokenExpira  = new Date(Date.now() + HORAS_SESION * 60 * 60 * 1000);
    await col.updateOne({ id: user.id }, { $set: { sessionToken, tokenExpira } });
    await act.updateOne(
      { username },
      { $set: { username, lastActive: new Date() } },
      { upsert: true }
    );

    await anotar('ok', isAlive ? 'Entró al panel forzando la sesión con la clave maestra' : 'Entró al panel', user, { resultado: 'ok' });

    // Cookie httpOnly (defensa contra robo de token por XSS)
    res.setHeader('Set-Cookie', cabecerasSesion(sessionToken, user.username, user.role));

    // Quien acertó no arrastra el contador de intentos
    await resetRateLimit(req, 'login');
    await resetRateLimit({ headers: {}, socket: { remoteAddress: 'cuenta' } }, claveCuenta);

    return res.status(200).json({
      id: user.id, username: user.username, role: user.role, sessionToken,
      bazarId: user.bazarId != null ? Number(user.bazarId) : null,
      // A dónde ir tras entrar: la dirección secreta del panel si está
      // configurada. El navegador no la conoce de otra forma.
      panel: '/' + String(process.env.RUTA_PANEL || RUTA_PANEL_DEFECTO)
        .replace(/^\/+|\/+$/g, ''),
    });

  } catch (err) {
    console.error('[auth]', err);
    await registrarFalla(err, { origen: 'auth' });
    return res.status(500).json({ error: 'No se pudo completar la operación.' });
  }
}

// v40 · Todas las funciones pasan primero por el escudo (ver api/_lib/escudo.js)
export default conEscudo(handler);
