// api/_lib/instagramPanel.js
// ─────────────────────────────────────────────────────────────
// Operaciones del administrador de Instagram. Se llaman por
// /api/acciones?op=ig-* (sin archivo propio: el plan gratis de Vercel
// permite máximo 12 funciones). Cada bazar solo administra SU cuenta;
// el admin principal elige el bazar con ?bazarId= (o en el cuerpo).
//
//   GET  ig-estado               → perfil + modo + configuración
//   GET  ig-resumen              → estadísticas de la cuenta (30 días)
//   GET  ig-posts&after=         → publicaciones (24 por página) + prenda ligada
//   GET  ig-post-stats&media=    → alcance, guardados, compartidos de un post
//   GET  ig-comentarios&media=   → comentarios de un post
//   GET  ig-bandeja              → comentarios recientes de todos los posts
//   POST ig-responder            { comentario, mensaje }
//   POST ig-ocultar              { comentario, ocultar }
//   POST ig-borrar-comentario    { comentario }
//   POST ig-comentarios-onoff    { media, activar }
//   GET  ig-dms                  → conversaciones (modo facebook)
//   GET  ig-dm&conv=             → mensajes de una conversación
//   POST ig-dm-enviar            { usuarioId, texto }
//   POST ig-borrar-post          { media }                       (modo facebook)
//   POST ig-editar-post          { media, caption }              (modo facebook)
//   POST ig-rehacer              { media, vendido, prendaId? }   (modo facebook)
//   POST ig-vincular             { media, prendaId|null }        liga un post a una prenda
//   POST ig-publicar             { imagenes[], caption, tipo, exacta?, plantilla?, prendaId? }
//   POST ig-historia-prenda      { id, estilo }
//   GET  ig-historias&estilo=    → vista previa de la historia de cada prenda disponible
//   GET  ig-plantilla&id=&tono= → vista previa de la portada disponible/vendida
//   GET  ig-img&u=               → foto de Instagram pasada por el servidor (ver _instagram.js)
//   GET  ig-programados          → publicaciones programadas
//   POST ig-programar            { imagenes[], caption, tipo, publicarEn, prendaId?, plantilla? }
//   POST ig-programado-borrar    { id }
//   POST ig-procesar             → publica lo programado que ya toca (lo llama el panel)
//   GET  ig-cron&key=            → igual, para el cron (sin sesión, con CRON_SECRET)
//   POST ig-config               { ...automatización y plantilla }
//   GET  ig-automatico           → bitácora de lo que hizo el sistema solo + token
//   POST ig-correr-automatico    → corre ya las tareas diarias
//   GET  ig-reporte&dias=7       → reporte de ventas y posts
//   POST ig-drop                 { dropId, anunciar, recordatorio } → carrusel del drop a su hora
// ─────────────────────────────────────────────────────────────

import { getDB, invalidarSyncCache } from './db.js';
import { correrAutomatico } from './automatico.js';
import { requireAuth } from './auth.js';
import { esGlobal, puede } from './bazar.js';
import { rateLimit } from './rateLimit.js';
import {
  credencialesInstagram, configInstagram, CONFIG_DEFAULT, conPagos, buscarPostDePrenda, sinEmojis, estiloLimpio, MAX_HASHTAGS_IG,
  perfil, listarPublicaciones, comentarios, responderComentario, ocultarComentario,
  borrarComentario, activarComentarios, borrarPublicacion, republicar, rehacerPost,
  publicarImagenes, publicarHistoria, historiaDisponible, fotoParaInstagram, fotoParaHistoria, fotoTalCual,
  imagenPlantilla, carruselConPortada, estadisticasCuenta, estadisticasPost, bandejaComentarios,
  conversaciones, hiloConversacion, enviarMensaje,
  imagenHistoriaDisponible, imagenHistoriaVendido, descargarImagenInstagram, ESTILOS_HISTORIA, estiloValido, textoPublicacion, publicarPrendaEnInstagram,
  leerCaption, adivinarCategoria, fotosDePost, todasLasPublicaciones, subirACloudinary, cuotaPublicacion, limpiarDescripcion, puedeBorrarPosts, postVivo, limpiarNombre, separarTalla, infoToken, imagenDrop, todosLosComentarios, crearContenedorReel, estadoContenedor, publicarContenedor, comentarEnPost, comentarVendido,
} from './instagram.js';

const SOLO_ADMIN = new Set(['ig-borrar-post', 'ig-editar-post', 'ig-rehacer', 'ig-republicar', 'ig-importar', 'ig-comentar-vendido', 'ig-limpiar-descripciones', 'ig-verificar-posts', 'ig-correr-automatico', 'ig-drop', 'ig-config', 'ig-programado-borrar']);
const ID_IG = /^[0-9_]{5,40}$/;
const ID_CONV = /^[A-Za-z0-9_\-:=]{5,200}$/;
const URL_CLOUD = /^https:\/\/res\.cloudinary\.com\//;

const idValido = v => typeof v === 'string' && ID_IG.test(v);
// v59: una dirección de un archivo subido por el panel a TU Cloudinary (no a otra cuenta).
// Devuelve la dirección limpia o '' si no es de ahí (otra cuenta, transformaciones, parámetros raros).
// La carpeta (bazar/reels) es opcional porque en el modo de "carpetas dinámicas" no va en la dirección.
export function urlReelPropia(v, tipo) {
  const nube = String(process.env.CLOUDINARY_CLOUD_NAME || '');
  if (typeof v !== 'string' || v.length > 600 || !nube || !/^[\w-]+$/.test(nube)) return '';
  let u; try { u = new URL(v); } catch { return ''; }
  if (u.protocol !== 'https:' || u.hostname !== 'res.cloudinary.com' || u.username || u.password || u.port || u.search || u.hash) return '';
  const ruta = u.pathname;
  const re = new RegExp(`^/${nube}/${tipo}/upload/(?:v\\d+/)?(?:[\\w-]+/){0,4}[\\w-]+\\.(?:${tipo === 'video' ? 'mp4|webm|mov' : 'jpg|jpeg|png|webp'})$`, 'i');
  return re.test(ruta) ? `https://res.cloudinary.com${ruta}` : '';
}

async function bazarDelUsuario(req, user, db) {
  const pedido = Number(req.query.bazarId || req.body?.bazarId || 0);
  const id = esGlobal(user) ? (pedido || 1) : Number(user.bazarId);
  if (!id) return null;
  return db.collection('bazares').findOne({ id });
}

// ── Programados ──────────────────────────────────────────────
// Se guardan en Mongo y los publica quien llegue primero cuando ya toca:
// el cron de Vercel (1 vez al día en el plan gratis), un cron externo
// (cron-job.org cada 5 min) o el propio panel al abrirse.
async function publicarProgramado(db, doc) {
  const bazar = await db.collection('bazares').findOne({ id: doc.bazarId });
  if (!credencialesInstagram(bazar)) throw new Error('Instagram no está conectado.');
  if (doc.tipo === 'drop') return publicarDropAhora(db, bazar, doc.dropId);
  if (doc.tipo === 'historia' && doc.generada) return { id: await publicarHistoria(bazar, doc.imagenes[0]), permalink: '' };
  if (doc.tipo === 'historia') {
    return { id: await publicarHistoria(bazar, doc.exacta ? fotoTalCual(doc.imagenes[0]) : fotoParaHistoria(doc.imagenes[0])), permalink: '' };
  }
  // Programado desde una prenda: se arma al momento con sus datos de ese día
  // (precio actualizado) y se cancela si ya se vendió o ya tiene post.
  if (doc.desdePrenda) {
    const p = await db.collection('inventario').findOne({ id: doc.prendaId });
    if (!p) throw new Error('La prenda ya no existe.');
    if (p.vendido) throw new Error('La prenda ya se vendió: no se publicó.');
    if (p.instagramId) throw new Error('La prenda ya tenía post en Instagram.');
    if (p.oculto) throw new Error('La prenda está oculta (drop pendiente).');
    const r = await publicarPrendaEnInstagram(p, bazar);
    await db.collection('inventario').updateOne({ id: p.id }, { $set: { instagramId: r.id, instagramUrl: r.permalink, instagramEn: new Date().toISOString() } });
    invalidarSyncCache();
    return r;
  }
  let fotos = doc.imagenes.slice(0, 10).map(doc.exacta ? fotoTalCual : fotoParaInstagram);
  let prenda = null;
  if (doc.prendaId) prenda = await db.collection('inventario').findOne({ id: doc.prendaId });
  // v56 · Lo mismo que en "programar prendas": si ya se vendió, no se publica
  if (prenda?.vendido) throw new Error('La prenda ya se vendió: no se publicó.');
  if (doc.plantilla && prenda) fotos = carruselConPortada(imagenPlantilla(doc.imagenes[0], bazar, prenda), fotos, configInstagram(bazar));
  let caption = doc.caption || '';
  if (prenda && doc.tipo !== 'historia') {
    if (doc.captionAuto) caption = textoPublicacion(prenda, await conPagos(bazar));
    else if (doc.precioAlProgramar && Number(prenda.precio_venta) !== Number(doc.precioAlProgramar)) {
      const f = n => `$${Number(n).toLocaleString('es-MX')}`;
      caption = caption.split(f(doc.precioAlProgramar)).join(f(prenda.precio_venta));
    }
  }
  const r = await publicarImagenes(bazar, fotos, caption);
  if (prenda && !prenda.instagramId) {
    await db.collection('inventario').updateOne({ id: prenda.id },
      { $set: { instagramId: r.id, instagramUrl: r.permalink, instagramEn: new Date().toISOString() } });
  }
  return r;
}

// ── Drops ────────────────────────────────────────────────────
const fechaDrop = f => new Date(f).toLocaleString('es-MX', { timeZone: 'America/Matamoros', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });

export function textoDrop(drop, prendas, bazar) {
  const cfg = configInstagram(bazar), limpio = estiloLimpio(cfg);
  const sitio = (process.env.SITE_URL || 'https://stiimpys.store').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const lineas = prendas.map((p, i) => `${i + 1}. ${p.nombre}${p.talla ? ` · ${String(p.talla).split('·')[0].trim()}` : ''} · $${Number(p.precio_venta || 0).toLocaleString('es-MX')}`);
  // v54: también máximo 5 hashtags (límite de Instagram)
  const cuenta = String(bazar?.instagram || 'stiimpys').replace(/^@/, '').replace(/\W/g, '').toLowerCase();
  const tags = [...new Set(['drop', cuenta, ...String(cfg.hashtags || '').split(/[\s,]+/).map(h => h.replace(/^#+/, '').toLowerCase()).filter(Boolean)])]
    .slice(0, Math.max(0, Math.min(MAX_HASHTAGS_IG, Number(cfg.maxHashtags ?? MAX_HASHTAGS_IG)))).map(h => '#' + h).join(' ');
  const pagos = bazar?._pagos ? (limpio ? bazar._pagos : `💳 ${bazar._pagos}`) : null;   // v55
  const texto = limpio
    ? [`DROP · ${drop.nombre}`, '', ...lineas, '', 'Desliza para ver cada prenda.', `Apártalas en ${sitio} (link en bio). La primera persona en apartar se la lleva.`, cfg.firma || '', pagos, '', tags]
    : [`🔥 DROP · ${drop.nombre}`, '', ...lineas, '', 'Desliza para ver cada prenda 👉', `🛒 Apártalas en ${sitio} (link en bio) · primero en apartar, se la lleva`, cfg.firma || '', pagos, '', tags];
  const out = texto.filter(x => x !== null).join('\n');
  return (limpio ? sinEmojis(out) : out).replace(/\n{3,}/g, '\n\n').trim().slice(0, 2200);
}

async function datosDrop(db, bazar, dropId) {
  const drop = await db.collection('drops').findOne({ id: dropId });
  if (!drop) throw new Error('Ese drop ya no existe.');
  const prendas = (await db.collection('inventario').find({ id: { $in: (drop.prendas || []).map(Number) } }).toArray())
    .filter(p => !p.vendido && (p.imagenes || []).some(u => URL_CLOUD.test(u)));
  if (!prendas.length) throw new Error('El drop no tiene prendas disponibles con foto.');
  return { drop, prendas: prendas.slice(0, 9) };
}

async function publicarDropAhora(db, bazar, dropId) {
  const { drop, prendas } = await datosDrop(db, bazar, dropId);
  const foto = p => p.imagenes.find(u => URL_CLOUD.test(u));
  const portada = imagenDrop(foto(prendas[0]), bazar, { titulo: drop.nombre, linea: `${prendas.length} prendas · ya disponibles` });
  const fotos = [portada, ...prendas.map(p => imagenPlantilla(foto(p), bazar, p))].filter(Boolean).slice(0, 10);
  const r = await publicarImagenes(bazar, fotos, textoDrop(drop, prendas, await conPagos(bazar)));
  await db.collection('drops').updateOne({ id: dropId }, { $set: { igId: r.id, igUrl: r.permalink } });
  for (const p of prendas) await db.collection('inventario').updateOne({ id: p.id }, { $set: { dropIgId: r.id } });
  return r;
}

export async function procesarProgramados(db, limite = 3) {
  const col = db.collection('igProgramados');
  const ahora = new Date().toISOString();
  const hechos = [];
  for (let i = 0; i < limite; i++) {
    // Toma uno a la vez y lo marca "publicando" de forma atómica: si dos
    // procesos llegan juntos, nunca publican el mismo dos veces.
    const r = await col.findOneAndUpdate(
      { estado: 'pendiente', publicarEn: { $lte: ahora } },
      { $set: { estado: 'publicando', tomadoEn: ahora } },
      { sort: { publicarEn: 1 }, returnDocument: 'after' },
    );
    const doc = r && r.value !== undefined ? r.value : r;   // driver 5 vs 6
    if (!doc) break;
    try {
      const pub = await publicarProgramado(db, doc);
      await col.updateOne({ _id: doc._id }, { $set: { estado: 'publicado', igId: pub.id, permalink: pub.permalink, publicadoEn: new Date().toISOString() } });
      hechos.push({ id: doc.id, ok: true });
    } catch (e) {
      await col.updateOne({ _id: doc._id }, { $set: { estado: 'error', error: e.message } });
      hechos.push({ id: doc.id, ok: false, error: e.message });
    }
  }
  // Rescate: si algo quedó "publicando" más de 10 min (función cortada), vuelve a la fila.
  // v58: antes se revisa si sí salió (el corte pudo ser después de publicar) para no duplicarlo.
  const hace10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  for (const d of await col.find({ estado: 'publicando', tomadoEn: { $lt: hace10 } }).limit(10).toArray()) {
    let ya = null;
    if (d.tipo !== 'historia') {
      try {
        const bz = await db.collection('bazares').findOne({ id: d.bazarId });
        const pr = d.prendaId ? await db.collection('inventario').findOne({ id: d.prendaId }) : null;
        if (credencialesInstagram(bz)) ya = await buscarPostDePrenda(bz, pr || {}, { caption: d.desdePrenda ? '' : d.caption });
        if (ya && pr && !pr.instagramId) await db.collection('inventario').updateOne({ id: pr.id }, { $set: { instagramId: ya.id, instagramUrl: ya.permalink, instagramEn: ya.timestamp || ahora } });
      } catch {}
    }
    await col.updateOne({ _id: d._id, estado: 'publicando' }, ya
      ? { $set: { estado: 'publicado', igId: ya.id, permalink: ya.permalink, publicadoEn: ya.timestamp || ahora } }
      : { $set: { estado: 'pendiente' } });
  }
  return hechos;
}

function limpiarProgramado({ _id, ...d }) { return d; }

// ── Handler ──────────────────────────────────────────────────
export async function handleInstagram(req, res, op) {
  // Cron: sin sesión, con secreto (Vercel manda "Authorization: Bearer <CRON_SECRET>")
  if (op === 'ig-cron') {
    const secreto = process.env.CRON_SECRET;
    const dado = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.key;
    if (!secreto || dado !== secreto) return res.status(401).json({ error: 'No autorizado' });
    const db = await getDB();
    const publicados = await procesarProgramados(db, 4);
    const automatico = [];
    for (const bz of await db.collection('bazares').find({}).toArray()) {
      try { automatico.push(...(await correrAutomatico(db, bz)).map(h => h.texto)); }
      catch (e) { automatico.push(`${bz.nombre}: ${e.message}`); }
    }
    return res.status(200).json({ ok: true, publicados, automatico });
  }

  const user = await requireAuth(req, res);
  if (!user) return;
  const db = await getDB();

  const bazar = await bazarDelUsuario(req, user, db);
  if (!bazar) return res.status(403).json({ error: 'Tu cuenta no tiene bazar asignado.' });

  if (SOLO_ADMIN.has(op) && user.role !== 'admin') {
    return res.status(403).json({ error: 'Solo un administrador del bazar puede hacer esto.' });
  }
  if (req.method === 'POST' && !esGlobal(user) && !(await puede(user, 'crearPrendas'))) {
    return res.status(403).json({ error: 'Tu bazar no tiene permitido publicar.' });
  }

  const b = req.body || {};
  const inv = db.collection('inventario');
  const prog = db.collection('igProgramados');

  // ── Configuración: no necesita Instagram conectado ─────────
  if (op === 'ig-config') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
    const cfg = {};
    if (typeof b.hashtags === 'string') cfg.hashtags = b.hashtags.trim().slice(0, 600);
    if (typeof b.firma === 'string')    cfg.firma    = b.firma.trim().slice(0, 300);
    for (const k of ['autoPublicar', 'autoComentario', 'autoHistoria', 'autoPortada', 'plantilla', 'portadaSola', 'hashtagsInteligentes', 'mejorarFotos', 'textoCorto', 'avisarCambios']) {
      if (typeof b[k] === 'boolean') cfg[k] = b[k];
    }
    if (b.maxHashtags !== undefined && Number.isFinite(Number(b.maxHashtags))) cfg.maxHashtags = Number(b.maxHashtags);
    if (b.estiloTexto === 'limpio' || b.estiloTexto === 'emojis') cfg.estiloTexto = b.estiloTexto;   // configInstagram lo deja en 0–5
    if (estiloValido(b.estiloHistoria)) cfg.estiloHistoria = estiloValido(b.estiloHistoria);
    if (['crema', 'blanco', 'noir'].includes(b.tonoPlantilla)) cfg.tonoPlantilla = b.tonoPlantilla;
    if (typeof b.colorPlantilla === 'string' && /^#?[0-9a-f]{6}$/i.test(b.colorPlantilla)) cfg.colorPlantilla = b.colorPlantilla.replace('#', '').toLowerCase();
    if (Array.isArray(b.respuestasRapidas)) cfg.respuestasRapidas = b.respuestasRapidas;
    if (b.automatico && typeof b.automatico === 'object') cfg.automatico = { ...configInstagram(bazar).automatico, ...b.automatico };
    const nueva = configInstagram({ instagramConfig: { ...configInstagram(bazar), ...cfg } });
    await db.collection('bazares').updateOne({ id: bazar.id }, { $set: { instagramConfig: nueva } });
    invalidarSyncCache();
    return res.status(200).json({ ok: true, config: nueva });
  }

  const cred = credencialesInstagram(bazar);
  if (op === 'ig-estado') {
    const base = { bazarId: bazar.id, bazar: bazar.nombre, conectado: !!cred, config: configInstagram(bazar), defaults: CONFIG_DEFAULT,
      pagos: (await conPagos(bazar))?._pagos || '' };   // v55: la línea de formas de pago (Ventas → Promociones y pagos)
    if (!cred) return res.status(200).json(base);
    const pendientes = await prog.countDocuments({ bazarId: bazar.id, estado: 'pendiente' });
    try {
      const [pf, token] = await Promise.all([perfil(bazar), infoToken(bazar)]);
      return res.status(200).json({ ...base, pendientes, perfil: pf, token });
    } catch (e) {
      return res.status(200).json({ ...base, pendientes, error: e.message });
    }
  }
  if (!cred) return res.status(400).json({ error: `Instagram no está conectado para ${bazar.nombre}.` });

  if (req.method === 'POST' && !(await rateLimit(req, res, (op === 'ig-importar' || op === 'ig-republicar')
    ? { key: 'igimp-' + bazar.id, max: 500, windowSec: 3600 }
    : { key: 'ig-' + bazar.id, max: 120, windowSec: 3600 }))) return;

  try {
    switch (op) {
      // ── Lectura ──────────────────────────────────────────
      case 'ig-resumen':
        return res.status(200).json(await estadisticasCuenta(bazar, 28));

      case 'ig-posts': {
        const after = typeof req.query.after === 'string' ? req.query.after.slice(0, 200) : '';
        const r = await listarPublicaciones(bazar, after);
        const ids = r.posts.map(p => p.id);
        const prendas = await inv.find({ instagramId: { $in: ids } },
          { projection: { _id: 0, id: 1, nombre: 1, vendido: 1, precio_venta: 1, talla: 1, instagramId: 1 } }).toArray();
        const porPost = Object.fromEntries(prendas.map(p => [p.instagramId, p]));
        r.posts = r.posts.map(p => ({ ...p, prenda: porPost[p.id] || null }));
        return res.status(200).json(r);
      }

      case 'ig-post-stats': {
        const media = String(req.query.media || '');
        if (!idValido(media)) return res.status(400).json({ error: 'Falta el post.' });
        return res.status(200).json(await estadisticasPost(bazar, media, req.query.tipo));
      }

      case 'ig-comentarios': {
        const media = String(req.query.media || '');
        if (!idValido(media)) return res.status(400).json({ error: 'Falta el post.' });
        return res.status(200).json({ comentarios: await comentarios(bazar, media) });
      }

      case 'ig-bandeja':
        return res.status(200).json(await bandejaComentarios(bazar, 20));

      case 'ig-dms':
        return res.status(200).json({ conversaciones: await conversaciones(bazar) });

      case 'ig-dm': {
        const conv = String(req.query.conv || '');
        if (!ID_CONV.test(conv)) return res.status(400).json({ error: 'Falta la conversación.' });
        return res.status(200).json(await hiloConversacion(bazar, conv));
      }

      // ── Borradores (se comparten entre tus dispositivos) ──
      case 'ig-borradores': {
        const lista = await db.collection('igBorradores').find({ bazarId: bazar.id }).sort({ actualizado: -1 }).limit(100).toArray();
        return res.status(200).json({ borradores: lista.map(({ _id, ...d }) => d) });
      }
      case 'ig-borrador': {
        const col = db.collection('igBorradores');
        const fotos = (Array.isArray(b.fotos) ? b.fotos : []).filter(u => typeof u === 'string' && URL_CLOUD.test(u)).slice(0, 10);
        const caption = String(b.caption || '').slice(0, 2200);
        if (!fotos.length && !caption.trim()) return res.status(400).json({ error: 'El borrador está vacío.' });
        const datos = {
          tipo: b.tipo === 'historia' ? 'historia' : 'post', fotos, caption,
          prendaId: b.prendaId ? Number(b.prendaId) : null, usarPlantilla: b.usarPlantilla !== false,
          cuando: b.cuando === 'programar' ? 'programar' : 'ahora', fechaProg: String(b.fechaProg || '').slice(0, 20),
          titulo: String(b.titulo || '').slice(0, 80),
          actualizado: new Date().toISOString(), editadoPor: user.username,
        };
        const id = String(b.id || '');
        if (id && await col.findOne({ id, bazarId: bazar.id })) {
          await col.updateOne({ id, bazarId: bazar.id }, { $set: datos });
          return res.status(200).json({ ok: true, id, actualizado: datos.actualizado });
        }
        if ((await col.countDocuments({ bazarId: bazar.id })) >= 200) return res.status(400).json({ error: 'Tienes 200 borradores. Borra algunos para guardar más.' });
        const nuevo = { id: id || ('b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), bazarId: bazar.id, creadoPor: user.username, creadoEn: datos.actualizado, ...datos };
        await col.insertOne(nuevo);
        return res.status(200).json({ ok: true, id: nuevo.id, actualizado: datos.actualizado });
      }
      case 'ig-borrador-borrar': {
        await db.collection('igBorradores').deleteOne({ id: String(b.id || ''), bazarId: bazar.id });
        return res.status(200).json({ ok: true });
      }
      // Programado → borrador (lo saca de la cola para seguir editándolo)
      case 'ig-programado-a-borrador': {
        const doc = await prog.findOne({ id: Number(b.id), bazarId: bazar.id });
        if (!doc || !['pendiente', 'error'].includes(doc.estado)) return res.status(400).json({ error: 'Ese programado ya no se puede editar.' });
        if (['drop'].includes(doc.tipo) || doc.generada) return res.status(400).json({ error: 'Los programados automáticos (drops) no se pueden pasar a borrador.' });
        const ahora = new Date().toISOString();
        const nuevo = { id: 'b' + Date.now().toString(36), bazarId: bazar.id, tipo: doc.tipo, fotos: doc.imagenes || [], caption: doc.caption || '',
          prendaId: doc.prendaId || null, usarPlantilla: !!doc.plantilla, cuando: 'programar', fechaProg: '', titulo: '',
          creadoPor: user.username, creadoEn: ahora, actualizado: ahora, editadoPor: user.username };
        await db.collection('igBorradores').insertOne(nuevo);
        await prog.deleteOne({ id: doc.id });
        const { _id, ...limpio } = nuevo;
        return res.status(200).json({ ok: true, borrador: limpio });
      }

      case 'ig-programados': {
        const lista = await prog.find({ bazarId: bazar.id }).sort({ publicarEn: -1 }).limit(60).toArray();
        return res.status(200).json({ programados: lista.map(limpiarProgramado) });
      }

      // ── v58 · Publicaciones con problemas ──────────────────
      // Prendas cuyo post falló o se quedó "publicando", y programados con error o atorados.
      case 'ig-problemas': {
        const ahora = Date.now(), ATORADO = 150000;
        const prendas = (await inv.find({ bazarId: bazar.id, vendido: { $ne: true }, $or: [{ instagramError: { $exists: true } }, { instagramPublicando: { $exists: true } }] }).toArray())
          .filter(p => !p.instagramId && (p.instagramError || p.instagramPublicando))
          .map(p => {
            const desde = typeof p.instagramPublicando === 'string' ? p.instagramPublicando : null;
            const publicando = !!desde && ahora - new Date(desde).getTime() < ATORADO;
            return { id: p.id, nombre: p.nombre, foto: (p.imagenes || [])[0] || '', precio: p.precio_venta,
              estado: publicando ? 'publicando' : (p.instagramPublicando ? 'atorada' : 'error'),
              mensaje: publicando ? 'Publicándose ahora' : p.instagramPublicando ? 'Se quedó a medias (la publicación se cortó)' : p.instagramError?.mensaje || 'No se publicó',
              en: desde || p.instagramError?.en || null, intentos: p.instagramError?.intentos || 0 };
          }).sort((a, b) => String(b.en).localeCompare(String(a.en)));
        const hace10 = new Date(ahora - 10 * 60000).toISOString();
        const programados = (await prog.find({ bazarId: bazar.id, $or: [{ estado: 'error' }, { estado: 'publicando', tomadoEn: { $lt: hace10 } }] }).sort({ publicarEn: -1 }).limit(40).toArray())
          .map(limpiarProgramado);
        return res.status(200).json({ prendas, programados, total: prendas.filter(p => p.estado !== 'publicando').length + programados.length });
      }

      // Quita el "publicando" atorado de una prenda. Antes busca si el post sí salió (para
      // ligarlo y no duplicarlo). { id, forzar } — forzar: aunque haya empezado hace poco.
      case 'ig-destrabar': {
        const p = await inv.findOne({ id: Number(b.id), bazarId: bazar.id });
        if (!p) return res.status(404).json({ error: 'No encontré la prenda.' });
        if (p.instagramId) return res.status(200).json({ ok: true, yaPublicada: true, permalink: p.instagramUrl || '' });
        const desde = typeof p.instagramPublicando === 'string' ? new Date(p.instagramPublicando).getTime() : 0;
        if (desde && Date.now() - desde < 150000 && b.forzar !== true) {
          return res.status(409).json({ error: `Empezó hace ${Math.round((Date.now() - desde) / 1000)} s; espera un poco antes de cancelarla.`, publicandoDesde: p.instagramPublicando });
        }
        const ya = await buscarPostDePrenda(bazar, p).catch(() => null);
        if (ya) {
          const marca = { instagramId: ya.id, instagramUrl: ya.permalink, instagramEn: ya.timestamp || new Date().toISOString() };
          await inv.updateOne({ id: p.id }, { $set: marca, $unset: { instagramPublicando: '', instagramError: '' } });
          invalidarSyncCache();
          return res.status(200).json({ ok: true, vinculada: true, ...marca });
        }
        await inv.updateOne({ id: p.id }, { $unset: { instagramPublicando: '' } });
        invalidarSyncCache();
        return res.status(200).json({ ok: true, libre: true });
      }

      // "Cancelar": ya no se quiere reintentar; se quita el aviso de error.
      case 'ig-descartar-error': {
        const r = await inv.updateOne({ id: Number(b.id), bazarId: bazar.id, instagramId: { $exists: false } }, { $unset: { instagramError: '', instagramPublicando: '' } });
        invalidarSyncCache();
        return res.status(200).json({ ok: true, cambiados: r.modifiedCount || 0 });
      }

      // Programado con error o atorado → vuelve a la fila (si no salió ya).
      case 'ig-programado-reintentar': {
        const doc = await prog.findOne({ id: Number(b.id), bazarId: bazar.id });
        if (!doc) return res.status(404).json({ error: 'No encontré ese programado.' });
        const atorado = doc.estado === 'publicando' && Date.now() - new Date(doc.tomadoEn || 0).getTime() > 10 * 60000;
        if (doc.estado !== 'error' && !atorado) return res.status(400).json({ error: 'Ese programado no tiene problemas.' });
        if (doc.tipo !== 'historia') {
          const prenda = doc.prendaId ? await inv.findOne({ id: doc.prendaId }) : null;
          const ya = await buscarPostDePrenda(bazar, prenda || {}, { caption: doc.desdePrenda ? '' : doc.caption }).catch(() => null);
          if (ya) {
            await prog.updateOne({ _id: doc._id }, { $set: { estado: 'publicado', igId: ya.id, permalink: ya.permalink, publicadoEn: ya.timestamp || new Date().toISOString() }, $unset: { error: '' } });
            return res.status(200).json({ ok: true, yaSalio: true, permalink: ya.permalink });
          }
        }
        await prog.updateOne({ _id: doc._id }, { $set: { estado: 'pendiente', publicarEn: new Date().toISOString(), reintentos: (doc.reintentos || 0) + 1 }, $unset: { error: '', tomadoEn: '' } });
        const hechos = await procesarProgramados(db, 1);
        return res.status(200).json({ ok: true, hechos });
      }

      // ── Comentarios y mensajes ───────────────────────────
      case 'ig-responder':
        if (!idValido(b.comentario)) return res.status(400).json({ error: 'Falta el comentario.' });
        return res.status(200).json({ ok: true, id: await responderComentario(bazar, b.comentario, b.mensaje) });

      case 'ig-ocultar':
        if (!idValido(b.comentario)) return res.status(400).json({ error: 'Falta el comentario.' });
        await ocultarComentario(bazar, b.comentario, !!b.ocultar);
        return res.status(200).json({ ok: true });

      case 'ig-borrar-comentario':
        if (!idValido(b.comentario)) return res.status(400).json({ error: 'Falta el comentario.' });
        await borrarComentario(bazar, b.comentario);
        return res.status(200).json({ ok: true });

      case 'ig-comentarios-onoff':
        if (!idValido(b.media)) return res.status(400).json({ error: 'Falta el post.' });
        await activarComentarios(bazar, b.media, !!b.activar);
        return res.status(200).json({ ok: true });

      case 'ig-dm-enviar':
        if (!idValido(b.usuarioId)) return res.status(400).json({ error: 'Falta el destinatario.' });
        return res.status(200).json({ ok: true, id: await enviarMensaje(bazar, b.usuarioId, b.texto) });

      // ── Posts ────────────────────────────────────────────
      case 'ig-borrar-post':
        if (!idValido(b.media)) return res.status(400).json({ error: 'Falta el post.' });
        await borrarPublicacion(bazar, b.media);
        await inv.updateMany({ instagramId: b.media },
          { $unset: { instagramId: '', instagramUrl: '', instagramEn: '', instagramVendido: '' } });
        invalidarSyncCache();
        return res.status(200).json({ ok: true });

      case 'ig-editar-post': {
        if (!idValido(b.media)) return res.status(400).json({ error: 'Falta el post.' });
        const caption = String(b.caption || '').trim();
        if (!caption) return res.status(400).json({ error: 'El texto no puede ir vacío.' });
        const nuevo = await republicar(bazar, b.media, caption);
        await inv.updateMany({ instagramId: b.media },
          { $set: { instagramId: nuevo.id, instagramUrl: nuevo.permalink, instagramEn: new Date().toISOString() } });
        invalidarSyncCache();
        return res.status(200).json({ ok: true, ...nuevo });
      }

      case 'ig-rehacer': {
        if (!idValido(b.media)) return res.status(400).json({ error: 'Falta el post.' });
        let prenda = await inv.findOne({ instagramId: b.media });
        if (!prenda && b.prendaId) prenda = await inv.findOne({ id: Number(b.prendaId), bazarId: bazar.id });
        if (prenda?.vendido) return res.status(400).json({ error: 'Las prendas vendidas no se republican: solo llevan el comentario de VENDIDA.' });
        const nuevo = await rehacerPost(bazar, b.media, { prenda, caption: typeof b.caption === 'string' ? b.caption : null });
        // Las vendidas ya salieron arriba, así que aquí la prenda nunca está vendida.
        // (Antes se usaba una variable "vendido" que no existía y la ruta tronaba
        // con ReferenceError cada vez que el post tenía prenda.)
        if (prenda) {
          await inv.updateOne({ id: prenda.id }, { $set: {
            instagramId: nuevo.id, instagramUrl: nuevo.permalink, instagramEn: new Date().toISOString(),
          } });
          invalidarSyncCache();
        }
        return res.status(200).json({ ok: true, vendido: false, ...nuevo });
      }

      // Republicar: vuelve a subir el post (o la prenda) como publicación
      // nueva para que salga arriba del feed, con el diseño actual. Opciones:
      //   borrar     → quita el post anterior (default sí)
      //   textoNuevo → rehace el texto con los datos actuales de la prenda
      case 'ig-republicar': {
        let prenda = null;
        if (b.prendaId) prenda = await inv.findOne({ id: Number(b.prendaId), bazarId: bazar.id });
        if (!prenda && idValido(b.media)) prenda = await inv.findOne({ instagramId: b.media, bazarId: bazar.id });
        const media = idValido(b.media) ? b.media : (prenda?.instagramId || null);
        if (!media && !prenda) return res.status(400).json({ error: 'Falta el post o la prenda.' });
        if (prenda?.vendido) return res.status(400).json({ error: 'Las prendas vendidas no se republican: solo llevan el comentario de VENDIDA.' });
        const cfg = configInstagram(bazar);
        const borrar = b.borrar !== false;
        let nuevo;
        // Si el post ya no existe (lo borraron a mano), se publica la prenda desde cero
        if (media && prenda && await postVivo(bazar, media) === false) {
          nuevo = await publicarPrendaEnInstagram(prenda, bazar);
          nuevo.aviso = 'El post anterior ya no existía: se publicó la prenda de nuevo.';
        } else if (media) {
          const caption = b.textoNuevo !== false && prenda ? textoPublicacion(prenda, await conPagos(bazar)) : null;
          try {
            nuevo = await rehacerPost(bazar, media, { prenda, caption, borrar, plantilla: cfg.plantilla && !!prenda });
          } catch (e) {
            if (e.borradoSinPublicar && prenda) {
              await inv.updateOne({ id: prenda.id }, { $unset: { instagramId: '', instagramUrl: '', instagramEn: '' } });
              invalidarSyncCache();
            }
            throw e;
          }
        } else {
          nuevo = await publicarPrendaEnInstagram(prenda, bazar);
        }
        if (prenda) {
          await inv.updateOne({ id: prenda.id }, { $set: {
            instagramId: nuevo.id, instagramUrl: nuevo.permalink, instagramEn: new Date().toISOString(),
          } });
          invalidarSyncCache();
        }
        return res.status(200).json({ ok: true, ...nuevo });
      }

      // ── Importar prendas desde posts viejos ──────────────
      // Lista los posts que todavía no tienen prenda, con los datos que se
      // pudieron leer del texto, para revisarlos antes de importar.
      // Deja el comentario de VENDIDA en un post (sin volver a publicarlo)
      case 'ig-comentar-vendido': {
        if (!idValido(b.media)) return res.status(400).json({ error: 'Falta el post.' });
        const prenda = await inv.findOne({ instagramId: b.media, bazarId: bazar.id });
        if (prenda?.instagramVendido?.comentario) return res.status(200).json({ ok: true, ya: true });
        let id;
        try { id = await comentarVendido({ ...(prenda || {}), instagramId: b.media }, bazar); }
        catch (e) {
          if (e.postMuerto && prenda) { await inv.updateOne({ id: prenda.id }, { $unset: { instagramId: '', instagramUrl: '', instagramEn: '' } }); invalidarSyncCache(); }
          throw e;
        }
        if (prenda) await inv.updateOne({ id: prenda.id }, { $set: { 'instagramVendido.comentario': id, vendido: true } });
        invalidarSyncCache();
        return res.status(200).json({ ok: true, comentario: id });
      }

      // Limpia las descripciones de las prendas importadas de Instagram
      case 'ig-limpiar-descripciones': {
        const lista = await inv.find({ bazarId: bazar.id, importadoDeInstagram: true }, { projection: { id: 1, descripcion: 1, nombre: 1, marca: 1, talla: 1 } }).toArray();
        let cambiadas = 0;
        for (const p of lista) {
          const $set = {};
          const desc = limpiarDescripcion(p.descripcion);
          if (desc !== (p.descripcion || '')) $set.descripcion = desc;
          const nom = limpiarNombre(p.nombre, p.marca);
          if (nom && nom !== p.nombre) $set.nombre = nom;
          // Talla con notas → "L · queda como M" (la plantilla muestra solo "L")
          if (p.talla && !String(p.talla).includes('·')) {
            const { talla, nota } = separarTalla(p.talla);
            if (nota) $set.talla = `${talla} · ${nota.charAt(0).toUpperCase()}${nota.slice(1)}`;
          }
          if (Object.keys($set).length) { await inv.updateOne({ id: p.id }, { $set }); cambiadas++; }
        }
        if (cambiadas) invalidarSyncCache();
        return res.status(200).json({ ok: true, revisadas: lista.length, cambiadas });
      }

      // Revisa que los posts ligados a prendas sigan vivos en Instagram.
      // Los que ya no existen se desligan (la prenda queda sin post).
      case 'ig-verificar-posts': {
        const prendas = await inv.find({ bazarId: bazar.id, instagramId: { $exists: true, $ne: null } },
          { projection: { id: 1, nombre: 1, instagramId: 1, vendido: 1 } }).toArray();
        const enCuenta = new Set((await todasLasPublicaciones(bazar, 3000)).map(p => p.id));
        const muertos = [];
        for (const p of prendas) {
          if (enCuenta.has(p.instagramId)) continue;
          // Doble revisión, una por una, antes de desligar
          if (await postVivo(bazar, p.instagramId) !== false) continue;
          await inv.updateOne({ id: p.id }, { $unset: { instagramId: '', instagramUrl: '', instagramEn: '' } });
          muertos.push({ id: p.id, nombre: p.nombre, vendido: !!p.vendido });
        }
        if (muertos.length) invalidarSyncCache();
        return res.status(200).json({ ok: true, revisadas: prendas.length, muertos });
      }

      case 'ig-cuota':
        return res.status(200).json({ ...(await cuotaPublicacion(bazar)), borrar: await puedeBorrarPosts(bazar) });

      case 'ig-importar-lista': {
        const posts = await todasLasPublicaciones(bazar, 300);
        const ligados = new Set((await inv.find({ instagramId: { $in: posts.map(p => p.id) } }, { projection: { instagramId: 1 } }).toArray()).map(p => p.instagramId));
        const cats = (await db.collection('categorias').find({}).toArray()).map(c => c.nombre).filter(Boolean);
        const lista = posts.filter(p => !ligados.has(p.id)).map(p => {
          const d = leerCaption(p.caption);
          const fotos = p.media_type === 'CAROUSEL_ALBUM' ? (p.children?.data?.length || 1) : 1;
          return { media: p.id, permalink: p.permalink, timestamp: p.timestamp, tipo: p.media_type, fotos,
            miniatura: p.media_type === 'VIDEO' ? p.thumbnail_url : p.media_url,
            ...d, categoria: adivinarCategoria(d.nombre, cats) };
        });
        return res.status(200).json({ total: posts.length, ligados: ligados.size, lista, categorias: cats });
      }

      // Crea la prenda: sube las fotos del post a Cloudinary y la deja ligada
      // a ese post (así el panel sabe cuándo se vende).
      case 'ig-importar': {
        if (!idValido(b.media)) return res.status(400).json({ error: 'Falta el post.' });
        if (await inv.findOne({ instagramId: b.media })) return res.status(409).json({ error: 'Ese post ya tiene una prenda.' });
        const nombre = String(b.nombre || '').trim().slice(0, 120);
        if (!nombre) return res.status(400).json({ error: 'La prenda necesita nombre.' });
        const post = await fotosDePost(bazar, b.media);
        if (!post.urls.length) return res.status(400).json({ error: 'El post no tiene fotos.' });
        const imagenes = [];
        for (const u of post.urls) {           // en orden, para respetar la portada
          try { imagenes.push(await subirACloudinary(u, 'bazar')); } catch (e) { if (!imagenes.length) throw e; }
        }
        const txt = (v, n) => String(v || '').trim().slice(0, n);
        const precio = Math.max(0, Math.round(Number(b.precio) || 0));
        const vendido = !!b.vendido;
        const ultimo = await inv.find({}).sort({ id: -1 }).limit(1).toArray();
        const prenda = {
          id: (ultimo[0]?.id || 0) + 1, bazarId: bazar.id,
          creadoEn: post.timestamp || new Date().toISOString(),
          nombre, marca: txt(b.marca, 60), talla: txt(b.talla, 80), estado: txt(b.estado, 40),
          descripcion: txt(b.descripcion, 1000), precio_venta: precio,
          categorias: b.categoria ? [txt(b.categoria, 60)] : [],
          imagenes, vendido, oculto: !!b.oculto,
          ...(vendido ? { vendidoEn: post.timestamp || new Date().toISOString() } : {}),
          instagramId: b.media, instagramUrl: post.permalink || '', instagramEn: post.timestamp || new Date().toISOString(),
          importadoDeInstagram: true,
        };
        await inv.insertOne(prenda);
        invalidarSyncCache();
        const { _id, ...limpio } = prenda;
        return res.status(201).json({ ok: true, prenda: limpio });
      }

      case 'ig-vincular': {
        if (!idValido(b.media)) return res.status(400).json({ error: 'Falta el post.' });
        await inv.updateMany({ instagramId: b.media, bazarId: bazar.id }, { $unset: { instagramId: '', instagramUrl: '' } });
        if (b.prendaId) {
          const prenda = await inv.findOne({ id: Number(b.prendaId), bazarId: bazar.id });
          if (!prenda) return res.status(404).json({ error: 'Prenda no encontrada en tu bazar.' });
          await inv.updateOne({ id: prenda.id }, { $set: {
            instagramId: b.media, instagramUrl: String(b.permalink || '').slice(0, 300),
            instagramEn: prenda.instagramEn || new Date().toISOString(),
          } });
        }
        invalidarSyncCache();
        return res.status(200).json({ ok: true });
      }

      case 'ig-publicar': {
        const urls = (Array.isArray(b.imagenes) ? b.imagenes : []).filter(u => typeof u === 'string' && URL_CLOUD.test(u));
        if (!urls.length) return res.status(400).json({ error: 'Elige al menos una foto.' });
        const exacta = b.exacta === true;
        if (b.tipo === 'historia') {
          const id = await publicarHistoria(bazar, exacta ? fotoTalCual(urls[0]) : fotoParaHistoria(urls[0]));
          return res.status(200).json({ ok: true, id });
        }
        let fotos = urls.slice(0, 10).map(exacta ? fotoTalCual : fotoParaInstagram);
        let prenda = null;
        if (b.prendaId) prenda = await inv.findOne({ id: Number(b.prendaId), bazarId: bazar.id });
        if (b.plantilla && prenda) fotos = carruselConPortada(imagenPlantilla(urls[0], bazar, prenda), fotos, configInstagram(bazar));
        const r = await publicarImagenes(bazar, fotos, String(b.caption || '').trim());
        if (prenda && !prenda.instagramId) {
          await inv.updateOne({ id: prenda.id }, { $set: { instagramId: r.id, instagramUrl: r.permalink, instagramEn: new Date().toISOString() } });
          invalidarSyncCache();
        }
        return res.status(200).json({ ok: true, ...r });
      }

      case 'ig-img': {
        try {
          const { tipo, buf } = await descargarImagenInstagram(String(req.query.u || ''));
          res.setHeader('Content-Type', tipo);
          res.setHeader('Cache-Control', 'private, max-age=86400');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          return res.status(200).end(buf);
        } catch (e) {
          return res.status(404).json({ error: e.message });
        }
      }

      case 'ig-plantilla': {
        // Vista previa de la portada (y su versión vendida) para una prenda
        const prenda = await inv.findOne({ id: Number(req.query.id), bazarId: bazar.id });
        const url = prenda && (prenda.imagenes || []).find(u => typeof u === 'string' && URL_CLOUD.test(u));
        if (!url) return res.status(404).json({ error: 'La prenda no tiene fotos en Cloudinary.' });
        const chica = u => u.replace('/f_jpg,q_90/', '/c_scale,w_540/f_jpg,q_80/');
        const tono = ['crema', 'blanco', 'noir'].includes(req.query.tono) ? req.query.tono : undefined;
        const bz = tono ? { ...bazar, instagramConfig: { ...(bazar.instagramConfig || {}), tonoPlantilla: tono } } : bazar;
        return res.status(200).json({
          disponible: chica(imagenPlantilla(url, bz, prenda)),
          vendido: chica(imagenPlantilla(url, bz, prenda, { vendido: true })),
          historiaVendido: (u => u && chica(u))(imagenHistoriaVendido(prenda, bazar)),
        });
      }

      case 'ig-historias': {
        const estilo = estiloValido(req.query.estilo) || undefined;
        const prendas = await inv.find({ bazarId: bazar.id }).toArray();
        const lista = prendas
          .filter(p => !p.vendido && !p.oculto && Array.isArray(p.imagenes) && p.imagenes.length)
          .sort((a, b) => (b.id || 0) - (a.id || 0))
          .map(p => {
            const url = imagenHistoriaDisponible(p, bazar, estilo);
            return url && {
              id: p.id, nombre: p.nombre, precio: p.precio_venta, ultima: p.instagramHistoriaEn || null,
              preview: url.replace('/f_jpg,q_90/', '/c_scale,w_420/f_jpg,q_80/'),
            };
          }).filter(Boolean);
        return res.status(200).json({ estilo: estilo || configInstagram(bazar).estiloHistoria, historias: lista });
      }

      case 'ig-historia-prenda': {
        const id = parseInt(b.id);
        const prenda = id && await inv.findOne({ id });
        if (!prenda) return res.status(404).json({ error: 'Prenda no encontrada.' });
        if (Number(prenda.bazarId || 1) !== Number(bazar.id)) return res.status(403).json({ error: 'Esa prenda es de otro bazar.' });
        if (prenda.vendido) return res.status(400).json({ error: 'La prenda ya está vendida.' });
        const historia = await historiaDisponible(prenda, bazar, estiloValido(b.estilo) || undefined);
        await inv.updateOne({ id }, { $set: { instagramHistoriaEn: new Date().toISOString() } });
        return res.status(200).json({ ok: true, id: historia });
      }

      // ── Programar ────────────────────────────────────────
      case 'ig-programar': {
        const urls = (Array.isArray(b.imagenes) ? b.imagenes : []).filter(u => typeof u === 'string' && URL_CLOUD.test(u)).slice(0, 10);
        if (!urls.length) return res.status(400).json({ error: 'Elige al menos una foto.' });
        const fecha = new Date(b.publicarEn);
        if (isNaN(fecha)) return res.status(400).json({ error: 'Fecha inválida.' });
        if (fecha.getTime() < Date.now() + 60 * 1000) return res.status(400).json({ error: 'La fecha tiene que ser futura.' });
        if (fecha.getTime() > Date.now() + 75 * 86400 * 1000) return res.status(400).json({ error: 'Máximo 75 días hacia adelante.' });
        const ultimo = await prog.find({}).sort({ id: -1 }).limit(1).toArray();
        const doc = {
          id: (ultimo[0]?.id || 0) + 1, bazarId: bazar.id,
          tipo: b.tipo === 'historia' ? 'historia' : 'post',
          imagenes: b.tipo === 'historia' ? urls.slice(0, 1) : urls,
          caption: String(b.caption || '').slice(0, 2200),
          prendaId: b.prendaId ? Number(b.prendaId) : null,
          plantilla: !!b.plantilla, exacta: b.exacta === true,
          // v56: si el texto es el que armó el panel (no lo editaron), se vuelve a armar al publicar
          // con los datos de ese día; si lo editaron, al menos se cambia el precio si cambió.
          captionAuto: b.captionAuto === true,
          precioAlProgramar: null,
          publicarEn: fecha.toISOString(), estado: 'pendiente',
          creadoPor: user.username, creadoEn: new Date().toISOString(),
        };
        if (doc.prendaId) {
          const pr = await inv.findOne({ id: doc.prendaId });
          if (pr?.vendido) return res.status(400).json({ error: 'Esa prenda ya se vendió.' });
          doc.precioAlProgramar = Number(pr?.precio_venta) || null;
        }
        await prog.insertOne(doc);
        return res.status(200).json({ ok: true, programado: limpiarProgramado(doc) });
      }

      // Programa varias prendas, una cada N horas, sin publicar de noche
      //   { prendaIds:[...], inicio: ISO, cadaHoras: 1-24, desde: 9, hasta: 22 }
      case 'ig-programar-prendas': {
        const ids = (Array.isArray(b.prendaIds) ? b.prendaIds : []).map(Number).filter(Boolean).slice(0, 150);
        if (!ids.length) return res.status(400).json({ error: 'No hay prendas para programar.' });
        const cada = Math.min(24, Math.max(0.5, Number(b.cadaHoras) || 2));
        const desde = Math.min(23, Math.max(0, Number(b.desde ?? 9))), hasta = Math.min(24, Math.max(desde + 1, Number(b.hasta ?? 22)));
        let t = new Date(b.inicio); if (isNaN(t) || t < Date.now() + 2 * 60000) t = new Date(Date.now() + 5 * 60000);
        const horaMx = d => (d.getUTCHours() + 24 - 6) % 24 + d.getUTCMinutes() / 60;      // Reynosa (UTC-6)
        const acomodar = d => {
          const h = horaMx(d);
          if (h < desde) d = new Date(d.getTime() + (desde - h) * 3600000);
          else if (h >= hasta) d = new Date(d.getTime() + (24 - h + desde) * 3600000);
          return d;
        };
        const prendas = await inv.find({ id: { $in: ids }, bazarId: bazar.id }).toArray();
        const orden = ids.map(id => prendas.find(p => p.id === id)).filter(p => p && !p.vendido && !p.instagramId && (p.imagenes || []).length);
        const ultimo = await prog.find({}).sort({ id: -1 }).limit(1).toArray();
        let sig = (ultimo[0]?.id || 0) + 1;
        const hechos = [];
        let bazarPagos = null;   // v55: formas de pago para el texto
        for (const p of orden) {
          t = acomodar(t);
          if (t - Date.now() > 75 * 86400000) break;
          const doc = { id: sig++, bazarId: bazar.id, tipo: 'post', desdePrenda: true, prendaId: p.id,
            imagenes: p.imagenes.filter(u => URL_CLOUD.test(u)).slice(0, 10), caption: textoPublicacion(p, bazarPagos || (bazarPagos = await conPagos(bazar))), plantilla: true,
            publicarEn: t.toISOString(), estado: 'pendiente', creadoPor: user.username, creadoEn: new Date().toISOString() };
          await prog.insertOne(doc);
          hechos.push({ prendaId: p.id, nombre: p.nombre, publicarEn: doc.publicarEn });
          t = new Date(t.getTime() + cada * 3600000);
        }
        return res.status(200).json({ ok: true, programados: hechos, omitidas: ids.length - hechos.length });
      }

      // ── Sorteo entre quienes comentaron un post ──────────
      //   { media, ganadores: 1-5, menciones: 0-3, excluir: "user1,user2" }
      case 'ig-sorteo': {
        if (!idValido(b.media)) return res.status(400).json({ error: 'Elige el post del sorteo.' });
        const yo = (await perfil(bazar)).username;
        const excluir = new Set(String(b.excluir || '').toLowerCase().split(/[\s,@]+/).filter(Boolean).concat(yo ? [yo.toLowerCase()] : []));
        const menciones = Math.max(0, Math.min(5, Number(b.menciones) || 0));
        const lista = await todosLosComentarios(bazar, b.media);
        const validos = new Map();      // una participación por persona (su primer comentario válido)
        for (const c of lista) {
          const u = String(c.username || '').toLowerCase(); if (!u || excluir.has(u)) continue;
          const n = (String(c.text || '').match(/@[\w.]+/g) || []).filter(m => m.slice(1).toLowerCase() !== u).length;
          if (n < menciones) continue;
          if (!validos.has(u)) validos.set(u, { usuario: c.username, texto: c.text, en: c.timestamp });
        }
        const participantes = [...validos.values()];
        const crypto = await import('crypto');
        const n = Math.max(1, Math.min(5, Number(b.ganadores) || 1));
        const ganadores = [];
        const bolsa = [...participantes];
        while (ganadores.length < n && bolsa.length) ganadores.push(bolsa.splice(crypto.randomInt(bolsa.length), 1)[0]);
        const suplentes = [];
        while (suplentes.length < 2 && bolsa.length) suplentes.push(bolsa.splice(crypto.randomInt(bolsa.length), 1)[0]);
        await db.collection('igSorteos').insertOne({ bazarId: bazar.id, media: b.media, en: new Date().toISOString(), por: user.username, comentarios: lista.length, participantes: participantes.length, ganadores, suplentes, menciones });
        return res.status(200).json({ ok: true, comentarios: lista.length, participantes: participantes.length, ganadores, suplentes, muestra: participantes.slice(0, 60).map(p => p.usuario) });
      }

      case 'ig-comentar': {
        if (!idValido(b.media)) return res.status(400).json({ error: 'Falta el post.' });
        const texto = String(b.mensaje || '').trim();
        if (!texto) return res.status(400).json({ error: 'Escribe el comentario.' });
        return res.status(200).json({ ok: true, id: await comentarEnPost(bazar, b.media, texto) });
      }

      // ── Reels: firma para subir el video directo a Cloudinary ──
      case 'ig-firma-video': {
        const cloud = process.env.CLOUDINARY_CLOUD_NAME, key = process.env.CLOUDINARY_API_KEY, secret = process.env.CLOUDINARY_API_SECRET;
        if (!cloud || !key || !secret) return res.status(500).json({ error: 'Faltan las variables de Cloudinary.' });
        const crypto = await import('crypto');
        const timestamp = Math.floor(Date.now() / 1000), folder = 'bazar/reels';
        const signature = crypto.createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${secret}`).digest('hex');
        return res.status(200).json({ cloud, api_key: key, timestamp, folder, signature });
      }
      case 'ig-reel-crear': {
        // v59: solo archivos subidos a TU Cloudinary (así nadie puede hacer que Instagram
        // descargue cualquier otra dirección con tu cuenta). La portada es opcional.
        const video = urlReelPropia(b.video, 'video');
        if (!video) return res.status(400).json({ error: 'Video inválido.' });
        let portada = '';
        if (b.portada != null && b.portada !== '') {
          portada = urlReelPropia(b.portada, 'image');
          if (!portada) return res.status(400).json({ error: 'Portada inválida.' });
        }
        // H.264 + AAC en MP4: lo que Instagram acepta
        const mp4 = video.replace('/video/upload/', '/video/upload/vc_h264,ac_aac,f_mp4,q_auto:good/').replace(/\.(webm|mov|mkv)$/i, '.mp4');
        const id = await crearContenedorReel(bazar, mp4, b.caption, { portada });
        return res.status(200).json({ ok: true, id });
      }
      case 'ig-reel-estado':
        if (!idValido(b.id)) return res.status(400).json({ error: 'Falta el id.' });
        return res.status(200).json(await estadoContenedor(bazar, b.id));
      case 'ig-reel-publicar': {
        if (!idValido(b.id)) return res.status(400).json({ error: 'Falta el id.' });
        return res.status(200).json({ ok: true, ...(await publicarContenedor(bazar, b.id)) });
      }

      case 'ig-programado-borrar': {
        const r = await prog.deleteOne({ id: Number(b.id), bazarId: bazar.id, estado: { $in: ['pendiente', 'error'] } });
        if (!r.deletedCount) return res.status(404).json({ error: 'No se encontró o ya se publicó.' });
        return res.status(200).json({ ok: true });
      }

      case 'ig-procesar': {
        const publicados = await procesarProgramados(db, 2);
        let automatico = [];
        try { automatico = await correrAutomatico(db, bazar); } catch (e) { console.error('[automatico]', e); }
        return res.status(200).json({ ok: true, publicados, automatico });
      }

      case 'ig-correr-automatico':
        return res.status(200).json({ ok: true, hechos: await correrAutomatico(db, bazar, { forzarDiario: true }) });

      case 'ig-automatico': {
        const log = await db.collection('automaticoLog').find({ bazarId: bazar.id }).sort({ en: -1 }).limit(60).toArray();
        return res.status(200).json({ log: log.map(({ _id, ...d }) => d), token: await infoToken(bazar), diario: bazar.autoDiario || null });
      }

      case 'ig-reporte': {
        const dias = Math.min(90, Math.max(1, Number(req.query.dias) || 7));
        const desde = new Date(Date.now() - dias * 86400000).toISOString();
        const todas = await inv.find({ bazarId: bazar.id }).toArray();
        const vendidas = todas.filter(p => p.vendido && (p.vendidoEn || '') >= desde);
        const nuevas = todas.filter(p => (p.creadoEn || '') >= desde && !p.importadoDeInstagram);
        const diasVenta = p => (new Date(p.vendidoEn) - new Date(p.creadoEn)) / 86400000;
        const conTiempo = vendidas.filter(p => p.creadoEn && p.vendidoEn && !p.importadoDeInstagram && diasVenta(p) >= 0);
        const agrupar = (lista, campo) => {
          const m = new Map();
          for (const p of lista) {
            const k = String(campo === 'talla' ? String(p.talla || '').split('·')[0] : p[campo] || '').trim() || '—';
            const x = m.get(k) || { nombre: k, vendidas: 0, ingresos: 0, dias: 0, n: 0 };
            x.vendidas++; x.ingresos += Number(p.precio_venta) || 0;
            if (p.creadoEn && p.vendidoEn && !p.importadoDeInstagram) { x.dias += Math.max(0, diasVenta(p)); x.n++; }
            m.set(k, x);
          }
          return [...m.values()].map(x => ({ ...x, diasPromedio: x.n ? Math.round(x.dias / x.n) : null }))
            .sort((a, b) => b.vendidas - a.vendidas || b.ingresos - a.ingresos).slice(0, 6);
        };
        let posts = [];
        try {
          const lista = (await listarPublicaciones(bazar, '')).posts || [];
          posts = lista.slice(0, 24)
            .map(p => ({ id: p.id, permalink: p.permalink, miniatura: p.media_type === 'VIDEO' ? p.thumbnail_url : p.media_url,
              texto: String(p.caption || '').split('\n')[0].slice(0, 60), likes: p.like_count || 0, comentarios: p.comments_count || 0 }))
            .sort((a, b) => (b.likes + b.comentarios * 2) - (a.likes + a.comentarios * 2)).slice(0, 5);
        } catch {}
        const disponibles = todas.filter(p => !p.vendido && !p.oculto);
        const viejas = disponibles.filter(p => p.creadoEn && Date.now() - new Date(p.creadoEn) > 30 * 86400000);
        return res.status(200).json({
          dias, vendidas: vendidas.length, ingresos: vendidas.reduce((t, p) => t + (Number(p.precio_venta) || 0), 0),
          ganancia: vendidas.reduce((t, p) => t + ((Number(p.precio_venta) || 0) - (Number(p.costo) || 0)), 0),
          nuevas: nuevas.length, disponibles: disponibles.length, sinVender30: viejas.length,
          diasPromedio: conTiempo.length ? Math.round(conTiempo.reduce((t, p) => t + diasVenta(p), 0) / conTiempo.length) : null,
          marcas: agrupar(vendidas, 'marca'), tallas: agrupar(vendidas, 'talla'), posts,
        });
      }

      case 'ig-drop': {
        const drop = await db.collection('drops').findOne({ id: b.dropId });
        if (!drop) return res.status(404).json({ error: 'No se encontró el drop.' });
        const { prendas } = await datosDrop(db, bazar, drop.id);
        const cuando = new Date(Math.max(new Date(drop.fecha).getTime() || 0, Date.now() + 2 * 60 * 1000));
        const ultimo = await prog.find({}).sort({ id: -1 }).limit(1).toArray();
        let sig = (ultimo[0]?.id || 0) + 1;
        const base = { bazarId: bazar.id, estado: 'pendiente', creadoPor: user.username, creadoEn: new Date().toISOString(), caption: '' };
        const hechos = [];
        // Quita lo que ya estuviera programado para este drop (si lo vuelven a programar)
        for (const v of await prog.find({ bazarId: bazar.id, dropId: drop.id, estado: 'pendiente' }).toArray()) await prog.deleteOne({ id: v.id });
        await prog.insertOne({ ...base, id: sig++, tipo: 'drop', dropId: drop.id, imagenes: [], publicarEn: cuando.toISOString() });
        hechos.push(`Carrusel del drop: ${fechaDrop(cuando)}`);
        const foto = prendas[0].imagenes.find(u => URL_CLOUD.test(u));
        const historia = (linea, cierre) => imagenDrop(foto, bazar, { historia: true, titulo: drop.nombre, linea, cierre });
        if (b.anunciar) {
          const img = historia(`${prendas.length} prendas`, fechaDrop(cuando));
          await publicarHistoria(bazar, img);
          hechos.push('Historia de anuncio publicada');
        }
        if (b.recordatorio && cuando - Date.now() > 70 * 60 * 1000) {
          await prog.insertOne({ ...base, id: sig++, tipo: 'historia', generada: true, dropId: drop.id,
            imagenes: [historia('Falta 1 hora', 'Pon tu alarma')], publicarEn: new Date(cuando - 60 * 60 * 1000).toISOString() });
          hechos.push('Recordatorio 1 h antes programado');
        }
        return res.status(200).json({ ok: true, hechos });
      }

      default:
        return res.status(400).json({ error: 'op no reconocida' });
    }
  } catch (e) {
    console.error('[' + op + ']', e);
    return res.status(502).json({ error: e.message || 'Instagram no respondió.' });
  }
}
