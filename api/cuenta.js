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
//   PUT  /api/cuenta?op=perfil     { nombre }       → cambia el nombre
//
// La cuenta de un comprador NO da acceso a nada del panel: son colecciones
// distintas y esta función nunca toca 'usuarios'.

import { getDB } from './_db.js';
import { verifyPassword, hashPassword } from './_password.js';
import { rateLimit, resetRateLimit } from './_rateLimit.js';
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
  creadoEn: c.creadoEn,
});

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
      const nuevo = {
        id: (ultimo[0]?.id || 0) + 1,
        nombre,
        email,
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
    if (op === 'perfil' && req.method === 'PUT') {
      const cliente = await clienteDeSesion(req);
      if (!cliente) return res.status(401).json({ error: 'Inicia sesión' });

      const nombre = texto(req.body?.nombre, 60);
      if (nombre.length < 2) return res.status(400).json({ error: 'Escribe tu nombre' });
      await col.updateOne({ id: cliente.id }, { $set: { nombre } });
      return res.status(200).json({ ok: true, perfil: { ...perfilPublico(cliente), nombre } });
    }

    return res.status(400).json({ error: 'Operación no reconocida' });

  } catch (err) {
    console.error('[cuenta:' + op + ']', err);
    return res.status(500).json({ error: 'No se pudo completar la operación' });
  }
}
