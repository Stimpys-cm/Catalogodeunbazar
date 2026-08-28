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

function passwordDebil(pw) {
  if (typeof pw !== 'string' || pw.length < 8)  return 'La contraseña necesita al menos 8 caracteres';
  if (pw.length > 200)                          return 'La contraseña es demasiado larga';
  if (!/[a-z]/i.test(pw) || !/[0-9]/.test(pw))  return 'La contraseña necesita letras y números';
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
      global._idxClientes = true;
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
