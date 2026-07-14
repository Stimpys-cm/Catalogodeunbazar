// api/acciones.js
// Endpoint unificado para reducir el número de Serverless Functions (límite
// de 12 en el plan gratis de Vercel). Enruta por ?op=
//
//   /api/acciones?op=logs               (GET lista / POST agrega)
//   /api/acciones?op=borrar-prenda      (POST)
//   /api/acciones?op=gestionar-usuario  (POST)

import { getDB } from './_db.js';
import { requireAuth } from './_auth.js';
import { hashPassword } from './_password.js';

function invalidarCache() {
  try { global._syncCache = null; global._syncCacheTime = 0; } catch (_) {}
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const op = req.query.op;

  try {
    if (op === 'logs')              return await handleLogs(req, res);
    if (op === 'borrar-prenda')     return await handleBorrarPrenda(req, res);
    if (op === 'gestionar-usuario') return await handleGestionarUsuario(req, res);
    return res.status(400).json({ error: 'op no reconocida' });
  } catch (err) {
    console.error('[acciones:' + op + ']', err);
    return res.status(500).json({ error: err.message });
  }
}

/* ═══════════════════════════════════════════════════════════
   LOGS
   ═══════════════════════════════════════════════════════════ */
const MAX_LOGS      = 5000;
const RETENTION_DAYS = 30;
const ARCHIVE_DAYS   = 15;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT     = 1000;
const LOG_ACCIONES = [
  'subir', 'editar', 'eliminar', 'vender', 'reactivar',
  'catalogo_crear', 'catalogo_editar', 'catalogo_eliminar',
  'vendedor_crear', 'vendedor_eliminar', 'vendedor_password',
  'drop_crear', 'drop_publicar', 'drop_editar', 'drop_eliminar', 'drop_quitar_prenda',
];

async function handleLogs(req, res) {
  const db  = await getDB();
  const col = db.collection('logs');
  const arch = db.collection('logs_archivados');

  // Listar tandas archivadas (GET, público: se usa con fetch crudo)
  if (req.method === 'GET' && req.query.modo === 'lotes') {
    const limiteArch = new Date(Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000);
    arch.deleteMany({ archivadoEn: { $lt: limiteArch } }).catch(() => {});
    const lotes = await arch.aggregate([
      { $group: { _id: '$loteId', fecha: { $first: '$loteFecha' }, cantidad: { $sum: 1 }, desde: { $min: '$ts' }, hasta: { $max: '$ts' } } },
      { $sort: { fecha: -1 } }
    ]).toArray();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(lotes.map(l => ({ loteId: l._id, fecha: l.fecha, cantidad: l.cantidad, desde: l.desde, hasta: l.hasta })));
  }

  // Descargar una tanda como texto (GET)
  if (req.method === 'GET' && req.query.modo === 'archivo') {
    const limiteArch = new Date(Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000);
    arch.deleteMany({ archivadoEn: { $lt: limiteArch } }).catch(() => {});
    const filtro = req.query.lote ? { loteId: req.query.lote } : {};
    const items = await arch.find(filtro).sort({ ts: -1 }).toArray();
    const lineas = items.map(l => {
      const d = new Date(l.ts);
      const fecha = isNaN(d) ? '' : d.toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return [ (l.usuario || '?').padEnd(14), fecha.padEnd(22), (l.accion || '').padEnd(20), (l.objeto || ''), l.detalle ? '| ' + l.detalle : '' ].join(' ').trimEnd();
    });
    const encabezado = [
      'REGISTRO DE ACTIVIDAD ARCHIVADO - BAZAR',
      `Generado: ${new Date().toLocaleString('es-MX')}`,
      `Total de registros: ${items.length}`,
      'Formato: USUARIO | FECHA Y HORA | ACCIÓN | OBJETO | DETALLE',
      '='.repeat(70), ''
    ].join('\n');
    const texto = encabezado + (lineas.length ? lineas.join('\n') : '(Sin registros)') + '\n';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(texto);
  }

  if (req.method === 'GET') {
    const limite = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    col.deleteMany({ ts: { $lt: limite } }).catch(() => {});
    let limit = parseInt(req.query.limit, 10) || DEFAULT_LIMIT;
    limit = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const items = await col.find({}).sort({ ts: -1 }).limit(limit).toArray();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(items.map(normalize));
  }

  // POST — registrar acción (requiere sesión; el usuario sale del token)
  if (req.method === 'POST') {
    const user = await requireAuth(req, res);
    if (!user) return;

    const { accion, objeto, detalle } = req.body || {};
    if (!LOG_ACCIONES.includes(accion)) {
      return res.status(400).json({ error: `accion inválida: ${accion}` });
    }
    const doc = {
      ts: new Date(),
      usuario: String(user.username).slice(0, 60),
      rol: user.role === 'admin' ? 'admin' : 'vendedor',
      accion,
      objeto:  objeto  != null ? String(objeto).slice(0, 200)  : '',
      detalle: detalle != null ? String(detalle).slice(0, 500) : '',
    };
    await col.insertOne(doc);

    const limite = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await archivarYborrar(col, arch, { ts: { $lt: limite } });

    const total = await col.countDocuments();
    if (total > MAX_LOGS) {
      const sobran = total - MAX_LOGS;
      const viejos = await col.find({}).sort({ ts: 1 }).limit(sobran).toArray();
      if (viejos.length) {
        const ids = viejos.map(v => v._id);
        const loteId = 'lote_' + Date.now();
        const loteFecha = new Date();
        await arch.insertMany(viejos.map(({ _id, ...r }) => ({ ...r, loteId, loteFecha, archivadoEn: loteFecha })));
        await col.deleteMany({ _id: { $in: ids } });
      }
    }

    const limiteArch = new Date(Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000);
    arch.deleteMany({ archivadoEn: { $lt: limiteArch } }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Método no permitido' });
}

async function archivarYborrar(col, arch, filtro) {
  const viejos = await col.find(filtro).toArray();
  if (!viejos.length) return;
  const loteId = 'lote_' + Date.now();
  const loteFecha = new Date();
  await arch.insertMany(viejos.map(({ _id, ...r }) => ({ ...r, loteId, loteFecha, archivadoEn: loteFecha })));
  await col.deleteMany(filtro);
}

/* ═══════════════════════════════════════════════════════════
   BORRAR PRENDA (requiere sesión; usa el ROL REAL del token)
   ═══════════════════════════════════════════════════════════ */
const LIMITE_BORRADO = 10;
const VENTANA_MIN    = 60;

async function handleBorrarPrenda(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  // 🔒 Verificar sesión y usar el rol/usuario reales (no los del body)
  const user = await requireAuth(req, res);
  if (!user) return;

  const { id } = req.body || {};
  if (id == null) return res.status(400).json({ error: 'Falta id' });

  const usuario = user.username;
  const rol     = user.role;

  const db  = await getDB();
  const inv = db.collection('inventario');
  const lim = db.collection('borrado_limite');

  if (rol !== 'admin') {
    const ahora = Date.now();
    const reg = await lim.findOne({ usuario });
    if (reg && (ahora - new Date(reg.inicio).getTime()) < VENTANA_MIN * 60 * 1000) {
      if (reg.count >= LIMITE_BORRADO) {
        const restanteMin = Math.ceil((VENTANA_MIN * 60 * 1000 - (ahora - new Date(reg.inicio).getTime())) / 60000);
        return res.status(429).json({
          error: `Límite alcanzado: máximo ${LIMITE_BORRADO} borrados por hora. Intenta de nuevo en ${restanteMin} min.`,
          limite: true, restanteMin,
        });
      }
      await lim.updateOne({ usuario }, { $inc: { count: 1 } });
    } else {
      await lim.updateOne({ usuario }, { $set: { usuario, inicio: new Date(ahora), count: 1 } }, { upsert: true });
    }
  }

  const r = await inv.deleteOne({ id });
  invalidarCache();
  return res.status(200).json({ ok: true, borrado: r.deletedCount });
}

/* ═══════════════════════════════════════════════════════════
   GESTIONAR USUARIO (crear / eliminar / password)
   Ya valida token + rol admin internamente (se deja igual).
   ═══════════════════════════════════════════════════════════ */
function esPrincipal(u) {
  return !!u && (u.id === 1 || (u.username && u.username.toLowerCase() === 'admin'));
}
function nombreValido(n) { return /^[A-Za-zÁÉÍÓÚáéíóúÑñ]{2,20}$/.test(n || ''); }
function passwordFuerte(pw) {
  return typeof pw === 'string' && pw.length >= 8
    && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}

async function handleGestionarUsuario(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });
  const { accion, token, actor } = req.body || {};
  if (!accion || !token || !actor) {
    return res.status(400).json({ error: 'Faltan datos (accion, token, actor)' });
  }

  const db  = await getDB();
  const col = db.collection('usuarios');

  const quien = await col.findOne({ username: actor });
  if (!quien || quien.sessionToken !== token) {
    return res.status(401).json({ error: 'Sesión inválida' });
  }
  if (quien.role !== 'admin') {
    return res.status(403).json({ error: 'Sin permisos de administrador' });
  }
  const actorEsPrincipal = esPrincipal(quien);

  if (accion === 'crear') {
    const { username, password, rol } = req.body;
    if (!nombreValido(username)) return res.status(400).json({ error: 'Nombre inválido' });
    if (!passwordFuerte(password)) return res.status(400).json({ error: 'Contraseña no cumple los requisitos' });
    const rolFinal = rol === 'admin' ? 'admin' : 'vendedor';
    if (rolFinal === 'admin' && !actorEsPrincipal) {
      return res.status(403).json({ error: 'Solo el admin principal puede crear administradores' });
    }
    const existe = await col.findOne({ username: { $regex: `^${username}$`, $options: 'i' } });
    if (existe) return res.status(409).json({ error: 'Ese nombre ya existe' });
    const todos = await col.find({}).toArray();
    const nuevoId = todos.length ? Math.max(...todos.map(u => u.id || 0)) + 1 : 1;
    const passHash = await hashPassword(password);
    await col.insertOne({ id: nuevoId, username, password: passHash, role: rolFinal, sessionToken: null, avatar: null });
    invalidarCache();
    return res.status(200).json({ ok: true, id: nuevoId, rol: rolFinal });
  }

  if (accion === 'eliminar') {
    const { id } = req.body;
    const objetivo = await col.findOne({ id });
    if (!objetivo) return res.status(404).json({ error: 'Perfil no encontrado' });
    if (esPrincipal(objetivo)) return res.status(403).json({ error: 'No se puede eliminar la cuenta principal' });
    if (objetivo.id === quien.id || objetivo.username === quien.username) {
      return res.status(403).json({ error: 'No puedes eliminar tu propio perfil' });
    }
    if (objetivo.role === 'admin' && !actorEsPrincipal) {
      return res.status(403).json({ error: 'Solo el admin principal puede eliminar administradores' });
    }
    await col.deleteOne({ id });
    invalidarCache();
    return res.status(200).json({ ok: true });
  }

  if (accion === 'password') {
    const { id, password } = req.body;
    const objetivo = await col.findOne({ id });
    if (!objetivo) return res.status(404).json({ error: 'Perfil no encontrado' });
    if (esPrincipal(objetivo)) {
      return res.status(403).json({ error: 'La contraseña del admin principal se cambia desde Mi Cuenta' });
    }
    if (objetivo.role === 'admin' && !actorEsPrincipal && objetivo.id !== quien.id) {
      return res.status(403).json({ error: 'Sin permiso para cambiar la contraseña de otro administrador' });
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ error: 'Contraseña inválida' });
    }
    const passHash = await hashPassword(password);
    await col.updateOne({ id }, { $set: { password: passHash } });
    invalidarCache();
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Acción no reconocida' });
}

function normalize({ _id, ...rest }) { return rest; }
