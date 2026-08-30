// api/acciones.js
// Endpoint unificado para reducir el número de Serverless Functions (límite
// de 12 en el plan gratis de Vercel). Enruta por ?op=
//
//   /api/acciones?op=logs               (GET lista / POST agrega)
//   /api/acciones?op=borrar-prenda      (POST)
//   /api/acciones?op=gestionar-usuario  (POST)
//   /api/acciones?op=marcar-vendido     (POST)  → registra la venta
//   /api/acciones?op=revertir-venta     (POST)  → deshace la venta
//   /api/acciones?op=resena-comprador   (POST)  → califica al comprador
//   /api/acciones?op=estadisticas       (GET)   → ganancias por bazar
//   /api/acciones?op=mantenimiento      (GET/POST) → qué está cerrado
//   /api/acciones?op=configurar-subasta (POST)  → pone o ajusta una subasta
//   /api/acciones?op=quitar-subasta     (POST)  → la cancela
//   /api/acciones?op=subasta-vendedor   (GET)   → ofertas y contacto del ganador
//   /api/acciones?op=mis-subastas       (GET)   → todas las del bazar, con
//                                                  sus participantes

import { getDB } from './_db.js';
import { requireAuth } from './_auth.js';
import { hashPassword } from './_password.js';
import { puede, esGlobal, mismoBazar } from './_bazar.js';
import {
  normalizarUsername, usernameValido, siguienteId,
  instantaneaPrenda, asegurarIndices, ETIQUETAS_COMPRADOR,
} from './_ventas.js';
import { calcularEstadisticas } from './_estadisticas.js';
import { leerAjustes, guardarAjustes, SECCIONES } from './_ajustes.js';
import {
  guardarSubasta, quitarSubasta, leerSubasta, historial,
  subastaPublica, ofertaPublica, contactoGanador, asegurarIndicesSubasta,
  subastasDeBazares, contactosDe, PUESTOS_CON_CONTACTO,
} from './_subastas.js';

function invalidarCache() {
  try { global._syncCache = null; global._syncCacheTime = 0; global._syncCachePub = null; } catch (_) {}
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  const op = req.query.op;

  try {
    if (op === 'logs')              return await handleLogs(req, res);
    if (op === 'borrar-prenda')     return await handleBorrarPrenda(req, res);
    if (op === 'gestionar-usuario') return await handleGestionarUsuario(req, res);
    if (op === 'marcar-vendido')    return await handleMarcarVendido(req, res);
    if (op === 'revertir-venta')    return await handleRevertirVenta(req, res);
    if (op === 'resena-comprador')  return await handleResenaComprador(req, res);
    if (op === 'estadisticas')      return await handleEstadisticas(req, res);
    if (op === 'mantenimiento')     return await handleMantenimiento(req, res);
    if (op === 'configurar-subasta') return await handleConfigurarSubasta(req, res);
    if (op === 'quitar-subasta')     return await handleQuitarSubasta(req, res);
    if (op === 'subasta-vendedor')   return await handleSubastaVendedor(req, res);
    if (op === 'mis-subastas')       return await handleMisSubastas(req, res);
    return res.status(400).json({ error: 'op no reconocida' });
  } catch (err) {
    console.error('[acciones:' + op + ']', err);
    return res.status(500).json({ error: err.message });
  }
}

/* ═══════════════════════════════════════════════════════════
   SUBASTAS — lado del vendedor
   Poner una prenda en subasta, cancelarla, y ver quién ofertó y
   cómo contactar al que ganó.
   ═══════════════════════════════════════════════════════════ */

// Comprueba que esta prenda es de quien dice y que puede tocarla.
async function prendaDelVendedor(req, res, id) {
  const user = await requireAuth(req, res);
  if (!user) return null;

  const db = await getDB();
  const prenda = await db.collection('inventario').findOne({ id: Number(id) });
  if (!prenda) { res.status(404).json({ error: 'Prenda no encontrada' }); return null; }

  if (!mismoBazar(user, prenda.bazarId)) {
    res.status(403).json({ error: 'Esa prenda pertenece a otro bazar.' });
    return null;
  }
  if (!esGlobal(user) && !(await puede(user, 'editarPrendas'))) {
    res.status(403).json({ error: 'Tu bazar no tiene permitido cambiar prendas.' });
    return null;
  }
  return { user, prenda };
}

async function handleConfigurarSubasta(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  const { prendaId, precioInicial, fin } = req.body || {};
  if (prendaId == null) return res.status(400).json({ error: 'Falta la prenda' });

  const ctx = await prendaDelVendedor(req, res, prendaId);
  if (!ctx) return;
  if (ctx.prenda.vendido) {
    return res.status(409).json({ error: 'Esa prenda ya está vendida.' });
  }

  await asegurarIndicesSubasta();
  const r = await guardarSubasta({
    prendaId: Number(prendaId),
    bazarId:  Number(ctx.prenda.bazarId || 1),
    precioInicial, fin,
  });
  if (!r.ok) return res.status(400).json({ error: r.error });

  invalidarCache();
  return res.status(200).json({ ok: true, subasta: subastaPublica(r.subasta) });
}

async function handleQuitarSubasta(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  const prendaId = Number(req.body?.prendaId);
  if (!prendaId) return res.status(400).json({ error: 'Falta la prenda' });

  const ctx = await prendaDelVendedor(req, res, prendaId);
  if (!ctx) return;

  // Cancelar una subasta con gente dentro deja mal al bazar, así que
  // hay que decirlo a propósito.
  const s = await leerSubasta(prendaId);
  if (s && s.totalOfertas > 0 && req.body?.confirmar !== true) {
    return res.status(409).json({
      error: `Esta subasta ya tiene ${s.totalOfertas} oferta${s.totalOfertas === 1 ? '' : 's'}.`,
      requiereConfirmar: true,
    });
  }

  await quitarSubasta(prendaId);
  invalidarCache();
  return res.status(200).json({ ok: true });
}

async function handleMisSubastas(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Solo GET' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const db = await getDB();
  const todos = await db.collection('bazares').find({}).sort({ id: 1 }).toArray();

  // Un bazar solo ve sus subastas. El admin general las ve todas.
  const visibles = esGlobal(user)
    ? todos
    : todos.filter(b => Number(b.id) === Number(user.bazarId));

  if (!visibles.length) {
    return res.status(200).json({ subastas: [], bazares: [], generado: new Date().toISOString() });
  }

  const subastas = await subastasDeBazares(visibles.map(b => b.id));

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    subastas,
    bazares: visibles.map(b => ({ id: b.id, nombre: b.nombre, slug: b.slug })),
    esGlobal: esGlobal(user),
    generado: new Date().toISOString(),
  });
}

async function handleSubastaVendedor(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Solo GET' });

  const prendaId = Number(req.query.id);
  if (!prendaId) return res.status(400).json({ error: 'Falta la prenda' });

  const ctx = await prendaDelVendedor(req, res, prendaId);
  if (!ctx) return;

  const s = await leerSubasta(prendaId);
  if (!s) return res.status(404).json({ error: 'Esa prenda no está en subasta' });

  // Los teléfonos solo se entregan cuando la subasta terminó: antes de eso
  // el vendedor no tiene por qué tener el contacto de nadie. Al cerrar se
  // dan los del podio, para que si el ganador no responde se pueda ir al
  // siguiente sin perseguirlo por fuera.
  const cerrada = s.cerrada === true;
  const ofertas = (await historial(prendaId, 30)).map(ofertaPublica);

  let contactos = {};
  if (cerrada) {
    // El podio se calcula por persona, no por oferta: tres pujas del
    // mismo no son tres puestos.
    const vistos = [];
    for (const o of ofertas) {
      if (!vistos.includes(o.username)) vistos.push(o.username);
      if (vistos.length >= PUESTOS_CON_CONTACTO) break;
    }
    const mapa = await contactosDe(vistos);
    contactos = Object.fromEntries(mapa);
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    subasta:   subastaPublica(s),
    historial: ofertas,
    ganador:   cerrada ? await contactoGanador(prendaId) : null,
    contactos,
    puestosConContacto: cerrada ? PUESTOS_CON_CONTACTO : 0,
  });
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
  'bazar_crear', 'bazar_editar', 'bazar_eliminar',
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

  // Multi-bazar: solo el dueño de la prenda (o el admin principal) la borra
  const prenda = await inv.findOne({ id });
  if (!prenda) return res.status(404).json({ error: 'Prenda no encontrada' });
  if (!mismoBazar(user, prenda.bazarId)) {
    return res.status(403).json({ error: 'Esa prenda pertenece a otro bazar.' });
  }
  if (!esGlobal(user) && !(await puede(user, 'borrarPrendas'))) {
    return res.status(403).json({ error: 'Tu bazar no tiene permitido borrar prendas.' });
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
  const actorBazar = quien.bazarId != null ? Number(quien.bazarId) : null;
  const actorGlobal = quien.role === 'admin' && !actorBazar;

  // Admin principal, o dueño de un bazar con el permiso activado
  const puedeGestionar = actorGlobal
    || (quien.role === 'admin' && await puede({ role: quien.role, bazarId: actorBazar }, 'gestionarUsuarios'));
  if (!puedeGestionar) {
    return res.status(403).json({ error: 'Sin permisos para gestionar cuentas' });
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
    // El admin principal elige el bazar; un dueño solo crea dentro del suyo
    let bazarNuevo = actorBazar;
    if (actorGlobal) {
      bazarNuevo = req.body.bazarId != null && req.body.bazarId !== ''
        ? Number(req.body.bazarId) : null;
      if (bazarNuevo != null) {
        const existeBazar = await db.collection('bazares').findOne({ id: bazarNuevo });
        if (!existeBazar) return res.status(400).json({ error: 'Ese bazar no existe' });
      }
    }
    const existe = await col.findOne({ username: { $regex: `^${username}$`, $options: 'i' } });
    if (existe) return res.status(409).json({ error: 'Ese nombre ya existe' });
    const todos = await col.find({}).toArray();
    const nuevoId = todos.length ? Math.max(...todos.map(u => u.id || 0)) + 1 : 1;
    const passHash = await hashPassword(password);
    await col.insertOne({ id: nuevoId, username, password: passHash, role: rolFinal, sessionToken: null, avatar: null, bazarId: bazarNuevo });
    invalidarCache();
    return res.status(200).json({ ok: true, id: nuevoId, rol: rolFinal, bazarId: bazarNuevo });
  }

  if (accion === 'eliminar') {
    const { id } = req.body;
    const objetivo = await col.findOne({ id });
    if (!objetivo) return res.status(404).json({ error: 'Perfil no encontrado' });
    if (esPrincipal(objetivo)) return res.status(403).json({ error: 'No se puede eliminar la cuenta principal' });
    if (!actorGlobal && Number(objetivo.bazarId || 0) !== Number(actorBazar)) {
      return res.status(403).json({ error: 'Esa cuenta pertenece a otro bazar' });
    }
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
    if (!actorGlobal && Number(objetivo.bazarId || 0) !== Number(actorBazar)) {
      return res.status(403).json({ error: 'Esa cuenta pertenece a otro bazar' });
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


/* ═══════════════════════════════════════════════════════════
   VENTAS — el vendedor marca una prenda como vendida y le pone
   el @username del comprador. Ese dato es el que hace aparecer
   la prenda en "Mis Compras" y en la pestaña "Vendidos" del bazar.
   ═══════════════════════════════════════════════════════════ */
async function handleMarcarVendido(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const { id } = req.body || {};
  const comprador = normalizarUsername(req.body?.comprador);

  if (id == null) return res.status(400).json({ error: 'Falta id' });
  if (!usernameValido(comprador)) {
    return res.status(400).json({ error: 'Escribe el @username del comprador (3 a 30 caracteres).' });
  }

  await asegurarIndices();
  const db     = await getDB();
  const inv    = db.collection('inventario');
  const ventas = db.collection('ventas');

  const prenda = await inv.findOne({ id: Number(id) });
  if (!prenda) return res.status(404).json({ error: 'Prenda no encontrada' });

  // Multi-bazar: cada bazar solo vende lo suyo
  if (!mismoBazar(user, prenda.bazarId)) {
    return res.status(403).json({ error: 'Esa prenda pertenece a otro bazar.' });
  }
  if (!esGlobal(user) && !(await puede(user, 'editarPrendas'))) {
    return res.status(403).json({ error: 'Tu bazar no tiene permitido marcar ventas.' });
  }

  // El @username tiene que existir: si no, la compra no le llegaría a nadie
  const cliente = await db.collection('clientes').findOne({ username: comprador });
  if (!cliente) {
    return res.status(404).json({ error: `No hay ninguna cuenta con @${comprador} en STMP MARKET.` });
  }

  // Si la prenda ya estaba vendida se reutiliza el registro: cambiar de
  // comprador no debe duplicar la venta ni dejar reseñas huérfanas.
  const previa = await ventas.findOne({ prendaId: Number(id) });
  const bazarId = Number(prenda.bazarId || 1);
  const fecha   = new Date();

  let ventaId;
  if (previa) {
    ventaId = previa.id;
    await ventas.updateOne({ id: ventaId }, { $set: {
      comprador, bazarId, fecha,
      prenda: instantaneaPrenda(prenda),
      // El costo se congela aquí: editar la prenda después no debe
      // reescribir la ganancia de una venta ya cerrada. Nunca sale al
      // comprador (ventaPublica no lo incluye).
      costo: Number(prenda.costo) || 0,
      precio: Number(prenda.precio_venta) || 0,
      vendedor: user.username,
    } });
    // Cambió el comprador → la reseña anterior ya no corresponde
    if (previa.comprador !== comprador) {
      await db.collection('resenas').deleteMany({ ventaId });
      await ventas.updateOne({ id: ventaId }, { $set: { resenaBazar: false, resenaComprador: false } });
    }
  } else {
    ventaId = await siguienteId('ventas');
    await ventas.insertOne({
      id: ventaId,
      prendaId: Number(id),
      bazarId,
      comprador,
      vendedor: user.username,
      prenda: instantaneaPrenda(prenda),
      costo: Number(prenda.costo) || 0,
      precio: Number(prenda.precio_venta) || 0,
      fecha,
      resenaBazar: false,
      resenaComprador: false,
    });
  }

  await inv.updateOne({ id: Number(id) }, { $set: {
    vendido: true, vendidoA: comprador, vendidoEn: fecha, ventaId,
  } });

  invalidarCache();
  return res.status(200).json({ ok: true, ventaId, comprador });
}

async function handleRevertirVenta(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const { id } = req.body || {};
  if (id == null) return res.status(400).json({ error: 'Falta id' });

  const db  = await getDB();
  const inv = db.collection('inventario');

  const prenda = await inv.findOne({ id: Number(id) });
  if (!prenda) return res.status(404).json({ error: 'Prenda no encontrada' });
  if (!mismoBazar(user, prenda.bazarId)) {
    return res.status(403).json({ error: 'Esa prenda pertenece a otro bazar.' });
  }
  if (!esGlobal(user) && !(await puede(user, 'editarPrendas'))) {
    return res.status(403).json({ error: 'Tu bazar no tiene permitido modificar ventas.' });
  }

  const venta = await db.collection('ventas').findOne({ prendaId: Number(id) });
  if (venta) {
    await db.collection('resenas').deleteMany({ ventaId: venta.id });
    await db.collection('ventas').deleteOne({ id: venta.id });
  }

  await inv.updateOne({ id: Number(id) }, {
    $set: { vendido: false },
    $unset: { vendidoA: '', vendidoEn: '', ventaId: '', resenadoComprador: '' },
  });

  invalidarCache();
  return res.status(200).json({ ok: true });
}


// El otro lado de la reputación: el bazar califica a quien le compró.
// Eso es lo que llena la pestaña "Mis Reseñas" de la cuenta del comprador.
async function handleResenaComprador(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });

  const user = await requireAuth(req, res);
  if (!user) return;

  await asegurarIndices();
  const ventaId   = Number(req.body?.ventaId);
  const estrellas = Math.round(Number(req.body?.estrellas));

  if (!Number.isFinite(ventaId)) return res.status(400).json({ error: 'Falta la venta' });
  if (!(estrellas >= 1 && estrellas <= 5)) {
    return res.status(400).json({ error: 'Elige de 1 a 5 estrellas' });
  }

  const db    = await getDB();
  const venta = await db.collection('ventas').findOne({ id: ventaId });
  if (!venta) return res.status(404).json({ error: 'Esa venta no existe' });

  // Solo el bazar que hizo la venta puede calificar a ese comprador
  if (!mismoBazar(user, venta.bazarId)) {
    return res.status(403).json({ error: 'Esa venta es de otro bazar.' });
  }

  const yaHay = await db.collection('resenas').findOne({ ventaId, tipo: 'comprador' });
  if (yaHay) return res.status(409).json({ error: 'Ya calificaste a este comprador' });

  const texto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const etiquetas = (Array.isArray(req.body?.etiquetas) ? req.body.etiquetas : [])
    .map(e => texto(e, 40))
    .filter(e => ETIQUETAS_COMPRADOR.includes(e))
    .slice(0, ETIQUETAS_COMPRADOR.length);

  const resena = {
    id: await siguienteId('resenas'),
    ventaId,
    tipo: 'comprador',
    bazarId: Number(venta.bazarId || 1),
    prendaId: venta.prendaId,
    prendaNombre: venta.prenda?.nombre || '',
    autor: user.username,
    destino: venta.comprador,
    estrellas,
    etiquetas,
    comentario: texto(req.body?.comentario, 500),
    creadoEn: new Date(),
  };

  try {
    await db.collection('resenas').insertOne(resena);
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ error: 'Ya calificaste a este comprador' });
    throw e;
  }

  await db.collection('ventas').updateOne({ id: ventaId }, { $set: { resenaComprador: true } });
  // El panel lee el inventario, no las ventas: la marca viaja con la prenda
  await db.collection('inventario').updateOne(
    { id: venta.prendaId }, { $set: { resenadoComprador: true } });

  invalidarCache();
  return res.status(200).json({ ok: true, resena: { ...resena, creadoEn: resena.creadoEn.toISOString() } });
}


/* ═══════════════════════════════════════════════════════════
   ESTADÍSTICAS DE GANANCIAS
   Cada bazar ve las suyas; el admin principal las ve de todos.
   ═══════════════════════════════════════════════════════════ */
async function handleEstadisticas(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Solo GET' });

  const user = await requireAuth(req, res);
  if (!user) return;

  const db = await getDB();
  const todos = await db.collection('bazares').find({}).sort({ id: 1 }).toArray();

  // Un bazar solo puede pedir sus propios números
  const visibles = esGlobal(user)
    ? todos
    : todos.filter(b => Number(b.id) === Number(user.bazarId));

  if (!visibles.length) {
    return res.status(200).json({ bazares: [], generado: new Date().toISOString(), ventasConsideradas: 0 });
  }

  const meses   = Math.min(Math.max(parseInt(req.query.meses)   || 12, 1), 24);
  const semanas = Math.min(Math.max(parseInt(req.query.semanas) || 12, 1), 52);

  const datos = await calcularEstadisticas({
    bazares: visibles.map(b => ({ id: b.id, nombre: b.nombre, slug: b.slug, color: b.color })),
    meses, semanas,
  });
  return res.status(200).json({ ...datos, global: esGlobal(user) });
}

/* ═══════════════════════════════════════════════════════════
   MANTENIMIENTO
   Solo el admin principal decide qué se cierra. Lo lee cualquiera,
   porque las páginas públicas necesitan saber si deben mostrarse.
   ═══════════════════════════════════════════════════════════ */
async function handleMantenimiento(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json(await leerAjustes());
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const user = await requireAuth(req, res);
  if (!user) return;
  if (!esGlobal(user)) {
    return res.status(403).json({ error: 'Solo el administrador principal puede cerrar el sitio.' });
  }

  const entrada = req.body?.mantenimiento;
  if (!entrada || typeof entrada !== 'object') {
    return res.status(400).json({ error: 'Falta el estado de mantenimiento' });
  }
  for (const clave of Object.keys(entrada)) {
    if (!SECCIONES.includes(clave)) {
      return res.status(400).json({ error: `Sección desconocida: ${clave}` });
    }
  }

  const guardado = await guardarAjustes(entrada, user.username);
  invalidarCache();
  return res.status(200).json(guardado);
}
