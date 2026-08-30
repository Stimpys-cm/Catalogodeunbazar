// api/cuenta.js
// Cuentas de los compradores de la tienda. Un solo endpoint con ?op= para
// no gastar funciones de Vercel.
//
//   POST /api/cuenta?op=registro   { nombre, email, password }
//   POST /api/cuenta?op=entrar     { email, password }
//   POST /api/cuenta?op=salir
//   GET  /api/cuenta?op=yo                          → perfil de la sesión
//   GET  /api/cuenta?op=wishlist                    → lista guardada
//   PUT  /api/cuenta?op=wishlist   { lista: [...] } → guarda la lista
//   PUT  /api/cuenta?op=perfil     { nombre, username, telefono,
//                                    direccion, avatar }
//   GET  /api/cuenta?op=compras                     → prendas que compré
//   GET  /api/cuenta?op=mis-resenas                 → lo que dicen de mí
//   POST /api/cuenta?op=resena     { ventaId, estrellas, etiquetas,
//                                    comentario }   → califica al bazar
//   GET  /api/cuenta?op=subasta&id=N                → estado en vivo
//   POST /api/cuenta?op=ofertar    { prendaId, monto, username?,
//                                    telefono? }    → puja en una subasta
//   POST /api/cuenta?op=recuperar    { email }      → manda enlace de rescate
//   POST /api/cuenta?op=restablecer  { token,
//                                      password }   → pone la nueva
//
// La cuenta de un comprador NO da acceso a nada del panel: son colecciones
// distintas y esta función nunca toca 'usuarios'.

import { getDB } from './_db.js';
import { verifyPassword, hashPassword } from './_password.js';
import { rateLimit, resetRateLimit } from './_rateLimit.js';
import {
  normalizarUsername, usernameValido, generarUsername, siguienteId,
  ventaPublica, resenaPublica, promedio, asegurarIndices,
  ETIQUETAS_BAZAR,
} from './_ventas.js';
import { leerAjustes, cerrada, mensajeDe } from './_ajustes.js';
import { getUser } from './_auth.js';
import { enviarCorreo, plantilla, correoConfigurado } from './_correo.js';
import {
  leerSubasta, historial, ofertar, subastaPublica, ofertaPublica,
  registrarInvitado, asegurarIndicesSubasta, subastasDe,
} from './_subastas.js';
import { esGlobal } from './_bazar.js';
import crypto from 'crypto';

const COOKIE = 'cliente';
const DIAS_SESION = 30;
const MAX_WISHLIST = 200;

function cookieSesion(token) {
  return [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/',
    `Max-Age=${DIAS_SESION * 24 * 60 * 60}`,
  ].join('; ');
}
const cookieBorrada = `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

function leerToken(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)cliente=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

const texto = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const emailValido = e => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) && e.length <= 120;

// Las mismas reglas que muestra la página mientras escribes. Se vuelven
// a comprobar aquí porque el navegador no es de fiar: cualquiera puede
// mandar el registro sin pasar por el formulario.
const PW_OBVIAS = [
  'password', 'contrasena', 'contraseña', '12345678', '123456789',
  'qwerty', 'iloveyou', 'admin', 'bienvenido', 'mexico', 'stmpmarket',
  'stiimpys', 'abc123', 'letmein', 'football', 'princess', 'monkey',
];

function passwordDebil(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'La contraseña necesita al menos 8 caracteres';
  if (pw.length > 200)                         return 'La contraseña es demasiado larga';
  if (!/[A-Z]/.test(pw))                       return 'La contraseña necesita al menos una mayúscula';
  if (!/[a-z]/.test(pw))                       return 'La contraseña necesita al menos una minúscula';
  if (!/[0-9]/.test(pw))                       return 'La contraseña necesita al menos un número';
  if (!/[^A-Za-z0-9]/.test(pw))                return 'La contraseña necesita al menos un símbolo (!@#$…)';

  const limpio = pw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (PW_OBVIAS.some(mala => limpio.includes(mala)) ||
      /^(.)\1+$/.test(pw) ||
      /^(0?123456789|abcdefgh)/.test(limpio)) {
    return 'Esa contraseña es de las primeras que alguien probaría. Elige otra.';
  }
  return null;
}

// Lo único que se le devuelve al navegador
const perfilPublico = c => ({
  id: c.id,
  nombre: c.nombre,
  email: c.email,
  // El @username es la llave que conecta al comprador con los bazares
  username: c.username || '',
  telefono: c.telefono || '',
  direccion: c.direccion || '',
  avatar: c.avatar || '',
  creadoEn: c.creadoEn,
});

// La tienda pública se sirve de un caché en memoria: al escribir una
// reseña hay que tirarlo para que la pestaña del bazar se actualice ya.
function invalidarCacheSync() {
  try { global._syncCache = null; global._syncCacheTime = 0; global._syncCachePub = null; } catch (_) {}
}

async function clienteDeSesion(req) {
  const token = leerToken(req);
  if (!token) return null;
  const db = await getDB();
  return db.collection('clientes').findOne({ sesionToken: token });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const op = String(req.query.op || '');

  try {
    const db  = await getDB();
    const col = db.collection('clientes');

    // Índice único por correo (se crea una sola vez)
    if (!global._idxClientes) {
      try { await col.createIndex({ email: 1 }, { unique: true }); } catch (_) {}
      try { await col.createIndex({ sesionToken: 1 }); } catch (_) {}
      try { await col.createIndex({ username: 1 }, { unique: true, sparse: true }); } catch (_) {}
      // Buscar por el token de rescate al restablecer la contraseña
      try { await col.createIndex({ rescateHash: 1 }, { sparse: true }); } catch (_) {}
      global._idxClientes = true;
    }

    // ── RECUPERAR CONTRASEÑA ─────────────────────────────────
    // Se responde lo mismo exista o no la cuenta: si dijéramos "ese correo
    // no está registrado" cualquiera podría averiguar quién tiene cuenta.
    if (op === 'recuperar' && req.method === 'POST') {
      if (!(await rateLimit(req, res, { key: 'recuperar', max: 5, windowSec: 3600 }))) return;

      const email = texto(req.body?.email, 120).toLowerCase();
      const respuestaNeutra = {
        ok: true,
        mensaje: 'Si ese correo tiene cuenta, en un momento te llega un enlace para cambiar la contraseña.',
      };
      if (!emailValido(email)) return res.status(200).json(respuestaNeutra);

      if (!correoConfigurado()) {
        return res.status(503).json({
          error: 'Todavía no está configurado el envío de correos. Escríbele al bazar por WhatsApp y te ayudamos a entrar.',
        });
      }

      const cliente = await col.findOne({ email });
      if (cliente) {
        // El token se guarda hasheado: si alguien lee la base de datos, no
        // puede usarlo para entrar en las cuentas.
        const token = crypto.randomBytes(32).toString('hex');
        const hash  = crypto.createHash('sha256').update(token).digest('hex');

        await col.updateOne({ id: cliente.id }, {
          $set: {
            rescateHash: hash,
            rescateExpira: new Date(Date.now() + 60 * 60 * 1000),  // una hora
            rescatePedidoEn: new Date(),
          },
        });

        const origen = (req.headers['x-forwarded-proto'] || 'https') + '://' +
                       (req.headers['x-forwarded-host'] || req.headers.host || 'stiimpys.store');
        const enlace = `${origen}/cuenta.html?rescate=${token}`;

        await enviarCorreo({
          para: email,
          asunto: 'Cambia tu contraseña de STMP MARKET',
          texto: `Para poner una contraseña nueva entra aquí: ${enlace}\n\n` +
                 `El enlace vence en una hora. Si no fuiste tú, ignora este correo: tu contraseña no cambia.`,
          html: plantilla({
            titulo: 'Cambia tu contraseña',
            cuerpo: `Alguien pidió cambiar la contraseña de la cuenta <b>${email}</b>. ` +
                    `Si fuiste tú, entra al enlace y pon una nueva.`,
            boton: 'Poner contraseña nueva',
            enlace,
            pie: 'El enlace vence en una hora y solo sirve una vez. ' +
                 'Si no fuiste tú, ignora este correo: tu contraseña sigue igual.',
          }),
        });
      }

      return res.status(200).json(respuestaNeutra);
    }

    // ── RESTABLECER CON EL TOKEN ─────────────────────────────
    if (op === 'restablecer' && req.method === 'POST') {
      if (!(await rateLimit(req, res, { key: 'restablecer', max: 10, windowSec: 3600 }))) return;

      const token = texto(req.body?.token, 200);
      const pass  = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!token) return res.status(400).json({ error: 'Falta el enlace de rescate' });

      const flojo = passwordDebil(pass);
      if (flojo) return res.status(400).json({ error: flojo });

      const hash = crypto.createHash('sha256').update(token).digest('hex');
      const cliente = await col.findOne({
        rescateHash: hash,
        rescateExpira: { $gt: new Date() },
      });
      if (!cliente) {
        return res.status(410).json({
          error: 'Ese enlace ya venció o se usó. Pide uno nuevo.',
        });
      }

      // Cambiar la contraseña cierra las demás sesiones: si alguien había
      // entrado, se queda fuera.
      const nuevoToken = crypto.randomUUID();
      await col.updateOne({ id: cliente.id }, {
        $set: { password: await hashPassword(pass), sesionToken: nuevoToken, ultimoAcceso: new Date() },
        $unset: { rescateHash: '', rescateExpira: '', rescatePedidoEn: '' },
      });

      await resetRateLimit(req, 'entrar-cliente');
      res.setHeader('Set-Cookie', cookieSesion(nuevoToken));
      return res.status(200).json({ ok: true, perfil: perfilPublico({ ...cliente }) });
    }

    // ── MIS SUBASTAS ─────────────────────────────────────────
    // En qué he ofertado, si voy ganando y qué pasó al final.
    if (op === 'mis-subastas' && req.method === 'GET') {
      const yo = await clienteDeSesion(req);
      if (!yo) return res.status(401).json({ error: 'Entra a tu cuenta' });
      if (!yo.username) return res.status(200).json({ subastas: [] });

      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ subastas: await subastasDe(yo.username) });
    }

    // ── SUBASTA: estado en vivo ──────────────────────────────
    // Público y sin caché: la gente necesita ver la oferta de verdad,
    // no una de hace quince segundos, para saber cuánto ofertar.
    if (op === 'subasta' && req.method === 'GET') {
      const prendaId = Number(req.query.id);
      if (!prendaId) return res.status(400).json({ error: 'Falta el id de la prenda' });

      const s = await leerSubasta(prendaId);
      if (!s) return res.status(404).json({ error: 'Esa prenda no está en subasta' });

      res.setHeader('Cache-Control', 'no-store');
      const yo = await clienteDeSesion(req).catch(() => null);
      return res.status(200).json({
        subasta:   subastaPublica(s),
        historial: (await historial(prendaId)).map(ofertaPublica),
        // Para que la página sepa si quien mira es el que va ganando
        yo: yo?.username || null,
      });
    }

    // ── SUBASTA: ofertar ─────────────────────────────────────
    if (op === 'ofertar' && req.method === 'POST') {
      if (!(await rateLimit(req, res, { key: 'ofertar', max: 30, windowSec: 900 }))) return;
      await asegurarIndicesSubasta();

      const ajustes = await leerAjustes();
      if (cerrada(ajustes, 'sitio') || cerrada(ajustes, 'tienda')) {
        const quien = await getUser(req).catch(() => null);
        if (!esGlobal(quien)) {
          const seccion = cerrada(ajustes, 'sitio') ? 'sitio' : 'tienda';
          return res.status(503).json({ error: mensajeDe(ajustes, seccion), mantenimiento: true });
        }
      }

      const prendaId = Number(req.body?.prendaId);
      const monto    = Number(req.body?.monto);
      if (!prendaId) return res.status(400).json({ error: 'Falta la prenda' });

      // Con cuenta se oferta con tu @username de siempre. Sin cuenta hay
      // que dejar un nombre temporal y un teléfono: si ganas, el bazar
      // necesita poder encontrarte.
      let postor;
      const yo = await clienteDeSesion(req).catch(() => null);
      if (yo) {
        if (!yo.username) return res.status(409).json({ error: 'Tu cuenta todavía no tiene @usuario. Ponle uno en Ajustes de perfil.' });
        postor = { username: yo.username, tipo: 'cuenta', clienteId: yo.id, telefono: yo.telefono || '' };
      } else {
        const alta = await registrarInvitado(req.body?.username, req.body?.telefono);
        if (!alta.ok) return res.status(409).json({ error: alta.error });
        postor = { username: alta.invitado.username, tipo: 'invitado', telefono: alta.invitado.telefono };
      }

      const r = await ofertar({ prendaId, monto, postor });
      if (!r.ok) return res.status(r.codigo || 400).json({ error: r.error });

      invalidarCacheSync();
      return res.status(200).json({
        ok: true,
        subasta:   subastaPublica(r.subasta),
        historial: (await historial(prendaId)).map(ofertaPublica),
        yo: postor.username,
        // Para poder decirle a quien ofertó que su puja empujó el cierre
        prorrogada: !!r.prorrogada,
      });
    }

    // Si el admin cerró las cuentas, nadie entra ni se registra.
    // Lo demás (ver la sesión que ya tenías, cerrarla) sigue funcionando.
    // El admin general es la excepción: necesita poder probar el flujo
    // completo de comprador mientras arregla lo que sea que esté cerrado.
    if (op === 'registro' || op === 'entrar') {
      const ajustes = await leerAjustes();
      if (cerrada(ajustes, 'cuentas') || cerrada(ajustes, 'sitio')) {
        const quien = await getUser(req).catch(() => null);
        if (!esGlobal(quien)) {
          const seccion = cerrada(ajustes, 'sitio') ? 'sitio' : 'cuentas';
          return res.status(503).json({
            error: mensajeDe(ajustes, seccion),
            mantenimiento: true,
          });
        }
      }
    }

    // ── REGISTRO ─────────────────────────────────────────────
    if (op === 'registro' && req.method === 'POST') {
      if (!(await rateLimit(req, res, { key: 'registro', max: 5, windowSec: 3600 }))) return;

      const nombre = texto(req.body?.nombre, 60);
      const email  = texto(req.body?.email, 120).toLowerCase();
      const pass   = typeof req.body?.password === 'string' ? req.body.password : '';

      if (nombre.length < 2)   return res.status(400).json({ error: 'Escribe tu nombre' });
      if (!emailValido(email)) return res.status(400).json({ error: 'Ese correo no es válido' });
      const flojo = passwordDebil(pass);
      if (flojo)               return res.status(400).json({ error: flojo });

      const existe = await col.findOne({ email });
      if (existe) return res.status(409).json({ error: 'Ya hay una cuenta con ese correo' });

      const ultimo = await col.find({}).sort({ id: -1 }).limit(1).toArray();
      // Todo comprador nace con un @username: es lo que el vendedor teclea
      // en su panel para asignarle la prenda.
      const username = await generarUsername(nombre || email.split('@')[0]);
      const nuevo = {
        id: (ultimo[0]?.id || 0) + 1,
        nombre,
        email,
        username,
        telefono: '',
        direccion: '',
        avatar: '',
        password: await hashPassword(pass),
        wishlist: [],
        creadoEn: new Date(),
        sesionToken: crypto.randomUUID(),
      };
      try {
        await col.insertOne(nuevo);
      } catch (e) {
        // El índice único evita cuentas duplicadas si llegan dos a la vez
        if (e?.code === 11000) return res.status(409).json({ error: 'Ya hay una cuenta con ese correo' });
        throw e;
      }

      res.setHeader('Set-Cookie', cookieSesion(nuevo.sesionToken));
      return res.status(200).json({ ok: true, perfil: perfilPublico(nuevo) });
    }

    // ── ENTRAR ───────────────────────────────────────────────
    if (op === 'entrar' && req.method === 'POST') {
      if (!(await rateLimit(req, res, { key: 'entrar-cliente', max: 10, windowSec: 900 }))) return;

      const email = texto(req.body?.email, 120).toLowerCase();
      const pass  = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!email || !pass) return res.status(400).json({ error: 'Correo y contraseña requeridos' });

      const cliente = await col.findOne({ email });
      // Misma respuesta exista o no la cuenta
      const ok = cliente && await verifyPassword(pass, cliente.password);
      if (!ok) return res.status(401).json({ error: 'Correo o contraseña incorrectos' });

      const token = crypto.randomUUID();
      await col.updateOne({ id: cliente.id }, { $set: { sesionToken: token, ultimoAcceso: new Date() } });
      await resetRateLimit(req, 'entrar-cliente');

      res.setHeader('Set-Cookie', cookieSesion(token));
      return res.status(200).json({ ok: true, perfil: perfilPublico(cliente) });
    }

    // ── SALIR ────────────────────────────────────────────────
    if (op === 'salir' && (req.method === 'POST' || req.method === 'DELETE')) {
      const cliente = await clienteDeSesion(req);
      if (cliente) await col.updateOne({ id: cliente.id }, { $set: { sesionToken: null } });
      res.setHeader('Set-Cookie', cookieBorrada);
      return res.status(200).json({ ok: true });
    }

    // ── QUIÉN SOY ────────────────────────────────────────────
    if (op === 'yo' && req.method === 'GET') {
      const cliente = await clienteDeSesion(req);
      if (!cliente) return res.status(200).json({ sesion: false });

      // Las cuentas creadas antes de STMP MARKET no tenían @username:
      // se les asigna uno la primera vez que entran.
      if (!cliente.username) {
        cliente.username = await generarUsername(cliente.nombre || cliente.email.split('@')[0]);
        try { await col.updateOne({ id: cliente.id }, { $set: { username: cliente.username } }); }
        catch (_) { cliente.username = ''; }
      }
      return res.status(200).json({ sesion: true, perfil: perfilPublico(cliente) });
    }

    // ── WISHLIST ─────────────────────────────────────────────
    if (op === 'wishlist') {
      const cliente = await clienteDeSesion(req);
      if (!cliente) return res.status(401).json({ error: 'Inicia sesión' });

      if (req.method === 'GET') {
        return res.status(200).json({ lista: Array.isArray(cliente.wishlist) ? cliente.wishlist : [] });
      }
      if (req.method === 'PUT') {
        const lista = Array.isArray(req.body?.lista) ? req.body.lista : null;
        if (!lista) return res.status(400).json({ error: 'lista debe ser un arreglo' });
        // Solo se guardan identificadores: las fotos y precios se leen del
        // catálogo al mostrarla, así la lista no envejece.
        const limpia = lista
          .map(x => String(x?.id ?? x).slice(0, 60))
          .filter(Boolean)
          .slice(0, MAX_WISHLIST);
        await col.updateOne({ id: cliente.id }, { $set: { wishlist: limpia } });
        return res.status(200).json({ ok: true, guardadas: limpia.length });
      }
    }

    // ── PERFIL ───────────────────────────────────────────────
    // Ajustes de perfil: nombre, @username, teléfono, dirección y foto.
    if (op === 'perfil' && req.method === 'PUT') {
      const cliente = await clienteDeSesion(req);
      if (!cliente) return res.status(401).json({ error: 'Inicia sesión' });

      const cambios = {};

      if ('nombre' in (req.body || {})) {
        const nombre = texto(req.body.nombre, 60);
        if (nombre.length < 2) return res.status(400).json({ error: 'Escribe tu nombre' });
        cambios.nombre = nombre;
      }

      if ('username' in (req.body || {})) {
        const username = normalizarUsername(req.body.username);
        if (!usernameValido(username)) {
          return res.status(400).json({ error: 'El @username lleva de 3 a 30 letras, números, punto, guion o guion bajo.' });
        }
        if (username !== cliente.username) {
          const ocupado = await col.findOne({ username });
          if (ocupado) return res.status(409).json({ error: `@${username} ya está tomado` });
          cambios.username = username;
        }
      }

      if ('telefono' in (req.body || {})) {
        cambios.telefono = texto(req.body.telefono, 25).replace(/[^0-9+()\s-]/g, '');
      }
      if ('direccion' in (req.body || {})) {
        cambios.direccion = texto(req.body.direccion, 200);
      }
      if ('avatar' in (req.body || {})) {
        const avatar = texto(req.body.avatar, 400);
        // Solo se acepta una URL de imagen ya subida (Cloudinary) o vaciarla
        if (avatar && !/^https:\/\/res\.cloudinary\.com\//.test(avatar)) {
          return res.status(400).json({ error: 'La foto no es válida' });
        }
        cambios.avatar = avatar;
      }

      if (!Object.keys(cambios).length) {
        return res.status(400).json({ error: 'No hay nada que guardar' });
      }

      try {
        await col.updateOne({ id: cliente.id }, { $set: cambios });
      } catch (e) {
        if (e?.code === 11000) return res.status(409).json({ error: 'Ese @username ya está tomado' });
        throw e;
      }

      // El @username viaja con cada venta: si cambia, las compras anteriores
      // tienen que seguirlo o el historial se rompería.
      if (cambios.username && cliente.username) {
        await db.collection('ventas').updateMany(
          { comprador: cliente.username }, { $set: { comprador: cambios.username } });
        await db.collection('inventario').updateMany(
          { vendidoA: cliente.username }, { $set: { vendidoA: cambios.username } });
        await db.collection('resenas').updateMany(
          { autor: cliente.username }, { $set: { autor: cambios.username } });
        await db.collection('resenas').updateMany(
          { destino: cliente.username }, { $set: { destino: cambios.username } });
        invalidarCacheSync();
      }

      return res.status(200).json({ ok: true, perfil: { ...perfilPublico(cliente), ...cambios } });
    }

    // ── MIS COMPRAS ──────────────────────────────────────────
    // Todo lo que algún bazar marcó como vendido a mi @username.
    if (op === 'compras' && req.method === 'GET') {
      const cliente = await clienteDeSesion(req);
      if (!cliente) return res.status(401).json({ error: 'Inicia sesión' });
      if (!cliente.username) return res.status(200).json({ compras: [] });

      await asegurarIndices();
      const compras = await db.collection('ventas')
        .find({ comprador: cliente.username })
        .sort({ fecha: -1 }).limit(200).toArray();

      // Se adjunta la reseña propia (si ya calificó) para pintar el botón
      // como "✓ Reseña enviada" sin una segunda petición.
      const ids = compras.map(v => v.id);
      const mias = ids.length
        ? await db.collection('resenas').find({ ventaId: { $in: ids }, tipo: 'bazar' }).toArray()
        : [];
      const porVenta = new Map(mias.map(r => [r.ventaId, resenaPublica(r)]));

      return res.status(200).json({
        compras: compras.map(v => ({ ...ventaPublica(v), miResena: porVenta.get(v.id) || null })),
        etiquetas: ETIQUETAS_BAZAR,
      });
    }

    // ── MIS RESEÑAS ──────────────────────────────────────────
    // Mi reputación como comprador: lo que los vendedores dejaron de mí.
    if (op === 'mis-resenas' && req.method === 'GET') {
      const cliente = await clienteDeSesion(req);
      if (!cliente) return res.status(401).json({ error: 'Inicia sesión' });
      if (!cliente.username) return res.status(200).json({ resenas: [], promedio: 0, total: 0 });

      await asegurarIndices();
      const lista = await db.collection('resenas')
        .find({ tipo: 'comprador', destino: cliente.username })
        .sort({ creadoEn: -1 }).limit(100).toArray();

      return res.status(200).json({ resenas: lista.map(resenaPublica), ...promedio(lista) });
    }

    // ── CALIFICAR AL BAZAR ───────────────────────────────────
    if (op === 'resena' && req.method === 'POST') {
      const cliente = await clienteDeSesion(req);
      if (!cliente) return res.status(401).json({ error: 'Inicia sesión' });

      await asegurarIndices();
      const ventaId   = Number(req.body?.ventaId);
      const estrellas = Math.round(Number(req.body?.estrellas));

      if (!Number.isFinite(ventaId)) return res.status(400).json({ error: 'Falta la compra' });
      if (!(estrellas >= 1 && estrellas <= 5)) {
        return res.status(400).json({ error: 'Elige de 1 a 5 estrellas' });
      }

      const venta = await db.collection('ventas').findOne({ id: ventaId });
      if (!venta) return res.status(404).json({ error: 'Esa compra no existe' });
      // Solo se califica lo que uno compró
      if (venta.comprador !== cliente.username) {
        return res.status(403).json({ error: 'Esa compra no es tuya' });
      }

      const yaHay = await db.collection('resenas').findOne({ ventaId, tipo: 'bazar' });
      if (yaHay) return res.status(409).json({ error: 'Ya calificaste esta compra' });

      // Solo se aceptan las etiquetas rápidas que ofrece la interfaz
      const etiquetas = (Array.isArray(req.body?.etiquetas) ? req.body.etiquetas : [])
        .map(e => texto(e, 40))
        .filter(e => ETIQUETAS_BAZAR.includes(e))
        .slice(0, ETIQUETAS_BAZAR.length);

      const resena = {
        id: await siguienteId('resenas'),
        ventaId,
        tipo: 'bazar',
        bazarId: Number(venta.bazarId || 1),
        prendaId: venta.prendaId,
        prendaNombre: venta.prenda?.nombre || '',
        autor: cliente.username,
        destino: '',
        estrellas,
        etiquetas,
        comentario: texto(req.body?.comentario, 500),
        creadoEn: new Date(),
      };

      try {
        await db.collection('resenas').insertOne(resena);
      } catch (e) {
        if (e?.code === 11000) return res.status(409).json({ error: 'Ya calificaste esta compra' });
        throw e;
      }
      await db.collection('ventas').updateOne({ id: ventaId }, { $set: { resenaBazar: true } });

      // La tienda del bazar tiene que mostrar la reseña de inmediato
      invalidarCacheSync();

      const todas = await db.collection('resenas')
        .find({ tipo: 'bazar', bazarId: resena.bazarId }).toArray();

      return res.status(200).json({
        ok: true,
        resena: resenaPublica(resena),
        bazar: promedio(todas),
      });
    }

    return res.status(400).json({ error: 'Operación no reconocida' });

  } catch (err) {
    console.error('[cuenta:' + op + ']', err);
    return res.status(500).json({ error: 'No se pudo completar la operación' });
  }
}
