// api/inventario-item.js
// POST   /api/inventario-item        → crea una prenda (requiere sesión)
// PATCH  /api/inventario-item?id=X   → actualiza campos de un ítem (requiere sesión)
// DELETE /api/inventario-item?id=X   → elimina un ítem (requiere admin)
//
// Existe para no mandar el inventario entero por cada cambio. El PUT de
// /api/inventario manda la lista COMPLETA: con muchas prendas se topa con
// el límite de tamaño de Vercel, y si dos personas del mismo bazar guardan
// a la vez, la última pisa lo que hizo la otra. Aquí cada prenda viaja
// sola, así que ninguna de las dos cosas pasa.

import { getDB, invalidarSyncCache } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { esGlobal, mismoBazar, puede, limpiarCampoPrenda as limpiarCampo } from './_lib/bazar.js';
import { permisosDe, reservaActiva } from './_lib/crecer.js';
import { conAuditoria, detalleDe } from './_lib/auditoria.js';
import { registrarFalla } from './_lib/actividad.js';
import { credencialesInstagram, publicarPrendaEnInstagram, buscarPostDePrenda, comentarVendido, historiaVendido, rehacerPost, comentarEnPost, configInstagram } from './_lib/instagram.js';
import { igAvisarPrecio, textoVendidaDrop, igAvisarApartado, igQuitarApartado } from './_lib/igSync.js';

import { conEscudo } from './_lib/escudo.js';
// Lo que puede traer una prenda. Cualquier otra cosa que mande el
// navegador se descarta: nadie va a inventar campos desde fuera.
const CAMPOS = [
  'nombre', 'marca', 'categorias', 'talla', 'precio_venta', 'precioAnterior', 'costo',
  'estado', 'descripcion', 'imagenes', 'vendido', 'vendidoEn', 'vendidoA',
  'oculto', 'dropId', 'creadoEn', 'reservedUntil', 'reservedBy', 'hashtags', 'apartada',
  'medidas', 'revisada',   // v43: medidas en cm y sello "Revisada a mano"
];

// ── v33 · Qué se registra en el Centro de actividad ──────────
const OPS_ITEM = { instagram: ['instagram', 'Publicó una prenda en Instagram'], 'instagram-vendido': ['instagram', 'Avisó VENDIDA en Instagram'],
  apartar: ['inventario', 'Apartó o liberó una prenda a mano'], marketplace: ['inventario', 'Actualizó Marketplace de una prenda'] };
function reglasItem(req) {
  const m = req.method, op = req.query?.op;
  if (m === 'GET' || m === 'HEAD') return null;
  const prendaId = Number(req.query?.id) || null;
  if (op && OPS_ITEM[op]) return { op: `item-${op}`, categoria: OPS_ITEM[op][0], accion: OPS_ITEM[op][1], prendaId,
    detalle: detalleDe(req.body, ['accion', 'horas', 'comentario', 'historia', 'portada']) };
  if (m === 'POST') return { op: 'prenda-crear', categoria: 'inventario', accion: 'Registró una prenda', detalle: { precio: Number(req.body?.precio_venta) || null } };
  if (m === 'PATCH') return { op: 'prenda-editar', categoria: 'inventario', accion: 'Editó una prenda', prendaId,
    detalle: { campos: Object.keys(req.body || {}).slice(0, 20) } };
  if (m === 'DELETE') return { op: 'prenda-eliminar', categoria: 'inventario', accion: 'Eliminó una prenda (definitivo)', prendaId };
  return null;
}

const auditado = conAuditoria(handler, reglasItem);

async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db  = await getDB();
    const col = db.collection('inventario');

    // ── POST ?op=instagram&id=X — publica la prenda en Instagram ──
    // Va aquí y no en un archivo nuevo porque el plan gratis de Vercel
    // permite máximo 12 funciones y ya están todas ocupadas.
    if (req.method === 'POST' && req.query.op === 'instagram') {
      const user = await requireAuth(req, res);
      if (!user) return;
      const id = parseInt(req.query.id);
      if (!id) return res.status(400).json({ error: 'Falta ?id=N' });

      const prenda = await col.findOne({ id });
      if (!prenda) return res.status(404).json({ error: `Ítem ${id} no encontrado` });
      if (!mismoBazar(user, prenda.bazarId)) {
        return res.status(403).json({ error: 'Esa prenda pertenece a otro bazar.' });
      }
      if (!esGlobal(user) && !(await puede(user, 'crearPrendas'))) {
        return res.status(403).json({ error: 'Tu bazar no tiene permitido publicar prendas.' });
      }
      if (prenda.vendido) return res.status(400).json({ error: 'La prenda ya está vendida.' });
      if (prenda.oculto)  return res.status(400).json({ error: 'La prenda está oculta (drop pendiente).' });
      if (prenda.instagramId && !req.body?.repetir) {
        return res.status(409).json({ error: 'Esta prenda ya se publicó en Instagram.', permalink: prenda.instagramUrl || '' });
      }

      const bazar = await db.collection('bazares').findOne({ id: Number(prenda.bazarId || 1) });
      if (!credencialesInstagram(bazar)) {
        return res.status(400).json({ error: `Instagram no está configurado para ${bazar?.nombre || 'este bazar'}.` });
      }

      // Candado: si dos clics llegan a la vez, solo uno publica. v58: lleva la hora en que
      // empezó y se considera atorado a los 2.5 min (el servidor corta a los 60 s): antes era
      // `true` sin hora y, si la función se cortaba, la prenda quedaba "publicando" para siempre.
      const ATORADO_MS = 150000;
      const ahora = new Date(), ahoraIso = ahora.toISOString();
      const vence = new Date(ahora.getTime() - ATORADO_MS).toISOString();
      const previo = prenda.instagramPublicando;
      const lock = await col.updateOne(
        { id, $or: [
          { instagramPublicando: { $exists: false } }, { instagramPublicando: null }, { instagramPublicando: false },
          { instagramPublicando: true },                      // candado viejo (sin hora): se toma
          { instagramPublicando: { $lt: vence } },            // empezó hace más de 2.5 min: se cortó
        ] },
        { $set: { instagramPublicando: ahoraIso } },
      );
      if (!lock.modifiedCount) {
        const seg = Math.max(1, Math.round((ahora - new Date(previo)) / 1000)) || 0;
        return res.status(409).json({
          error: `Se está publicando desde hace ${seg} s. Si en 2 minutos no aparece, podrás reintentarla (o ve a Instagram → Con problemas).`,
          publicandoDesde: previo, atorada: false,
        });
      }

      try {
        // Si un intento anterior se cortó o falló, puede que el post sí haya salido: se busca
        // antes de volver a publicar (para ligarlo y no duplicarlo).
        if (previo || prenda.instagramError) {
          const ya = await buscarPostDePrenda(bazar, prenda).catch(() => null);
          if (ya) {
            const marca = { instagramId: ya.id, instagramUrl: ya.permalink, instagramEn: ya.timestamp || ahoraIso };
            await col.updateOne({ id }, { $set: marca, $unset: { instagramPublicando: '', instagramError: '' } });
            invalidarSyncCache();
            return res.status(200).json({ ok: true, recuperada: true, ...marca });
          }
        }
        const { id: igId, permalink } = await publicarPrendaEnInstagram(prenda, bazar);
        const marca = { instagramId: igId, instagramUrl: permalink, instagramEn: new Date().toISOString() };
        await col.updateOne({ id }, { $set: marca, $unset: { instagramPublicando: '', instagramError: '' } });
        invalidarSyncCache();
        return res.status(200).json({ ok: true, ...marca });
      } catch (e) {
        // v58: el error queda guardado en la prenda (Instagram → Con problemas lo lista)
        const instagramError = { mensaje: String(e.message || 'No se pudo publicar en Instagram.').slice(0, 300), en: new Date().toISOString(),
          intentos: (Number(prenda.instagramError?.intentos) || 0) + 1, por: user.username };
        await col.updateOne({ id }, { $set: { instagramError }, $unset: { instagramPublicando: '' } });
        invalidarSyncCache();
        console.error('[instagram]', e);
        return res.status(502).json({ error: e.message || 'No se pudo publicar en Instagram.', instagramError });
      }
    }

    // ── POST ?op=instagram-vendido&id=X — avisa en Instagram que se vendió ──
    // body: { comentario: bool, historia: bool }. Cada aviso sale una sola
    // vez por prenda; si uno falla, el otro igual se intenta.
    if (req.method === 'POST' && req.query.op === 'instagram-vendido') {
      const user = await requireAuth(req, res);
      if (!user) return;
      const id = parseInt(req.query.id);
      if (!id) return res.status(400).json({ error: 'Falta ?id=N' });

      const prenda = await col.findOne({ id });
      if (!prenda) return res.status(404).json({ error: `Ítem ${id} no encontrado` });
      if (!mismoBazar(user, prenda.bazarId)) {
        return res.status(403).json({ error: 'Esa prenda pertenece a otro bazar.' });
      }
      if (!prenda.vendido) return res.status(400).json({ error: 'La prenda no está marcada como vendida.' });

      const bazar = await db.collection('bazares').findOne({ id: Number(prenda.bazarId || 1) });
      if (!credencialesInstagram(bazar)) {
        return res.status(400).json({ error: `Instagram no está configurado para ${bazar?.nombre || 'este bazar'}.` });
      }

      const pide  = req.body || {};
      const hecho = prenda.instagramVendido || {};
      const out = { comentario: null, historia: null, portada: null, errores: [] };
      const $set = {};

      // Portada a VENDIDO: vuelve a publicar el post con la foto en gris y la
      // franja roja (modo facebook). Va antes que el comentario para no
      // comentar en un post que se va a borrar.
      if (false && pide.portada && prenda.instagramId && !hecho.portada) {   // desactivado: al vender solo se comenta
        try {
          const nuevo = await rehacerPost(bazar, prenda.instagramId, { vendido: true, prenda });
          out.portada = nuevo.id;
          $set['instagramVendido.portada'] = nuevo.id;
          $set.instagramId = nuevo.id; $set.instagramUrl = nuevo.permalink;
          prenda.instagramId = nuevo.id;
        } catch (e) { out.errores.push(`Portada: ${e.message}`); }
      }
      if (pide.comentario && prenda.instagramId && !hecho.comentario) {
        try { $set['instagramVendido.comentario'] = out.comentario = await comentarVendido(prenda, bazar); }
        catch (e) {
          out.errores.push(`Comentario: ${e.message}`);
          if (e.postMuerto) { await col.updateOne({ id }, { $unset: { instagramId: '', instagramUrl: '', instagramEn: '' } }); invalidarSyncCache(); }
        }
      }
      // Si la prenda salió en un drop, también se avisa en el carrusel del drop
      if (pide.comentario && prenda.dropIgId && !hecho.drop) {
        try { $set['instagramVendido.drop'] = await comentarEnPost(bazar, prenda.dropIgId, textoVendidaDrop(prenda, bazar)); }
        catch (e) { out.errores.push(`Drop: ${e.message}`); }
      }
      if (pide.historia && !hecho.historia) {
        try { $set['instagramVendido.historia'] = out.historia = await historiaVendido(prenda, bazar); }
        catch (e) { out.errores.push(`Historia: ${e.message}`); }
      }
      if (Object.keys($set).length) {
        $set['instagramVendido.en'] = new Date().toISOString();
        await col.updateOne({ id }, { $set });
        invalidarSyncCache();
      }
      if (out.errores.length) console.error('[instagram-vendido]', out.errores);
      const algo = out.comentario || out.historia || out.portada;
      return res.status(algo || !out.errores.length ? 200 : 502).json({
        ok: !!algo, ...out, error: out.errores.join(' · ') || undefined,
      });
    }

    // ── POST ?op=marketplace&id=X — control de Facebook Marketplace ──
    // Meta no deja publicar en Marketplace desde otra app, así que la
    // publicación la hace la persona (con el kit del panel) y aquí solo se
    // anota en qué estado quedó, para saber qué falta publicar, renovar o
    // marcar como vendido allá.
    //   body: { accion: 'publicada' | 'renovada' | 'precio' | 'vendida' | 'link' | 'quitar', url? }
    // ── POST ?op=apartar&id=X — apartar con fecha límite ─────────
    //   { accion: 'apartar', nombre, telefono, horas } | { accion: 'liberar' }
    if (req.method === 'POST' && req.query.op === 'apartar') {
      const user = await requireAuth(req, res);
      if (!user) return;
      const id = parseInt(req.query.id);
      const prenda = id && await col.findOne({ id });
      if (!prenda) return res.status(404).json({ error: 'Prenda no encontrada' });
      if (!mismoBazar(user, prenda.bazarId)) return res.status(403).json({ error: 'Esa prenda pertenece a otro bazar.' });
      const b = req.body || {};
      // v33: no tocar un apartado ligado a un pedido en línea (anticipo pagado o alguien pagando)
      const activa = await reservaActiva(db, prenda);
      if (activa) return res.status(409).json({ error: activa.mensaje, pedido: activa.pedido.id });
      if (b.accion === 'liberar') {
        await col.updateOne({ id }, { $set: { apartada: false }, $unset: { reservedUntil: '', reservedBy: '' } });
        invalidarSyncCache();
        // v56 · se quita el "Apartada" de Instagram
        if (prenda.instagramApartado) { try { await igQuitarApartado(db, prenda, await db.collection('bazares').findOne({ id: Number(prenda.bazarId || 1) })); } catch {} }
        return res.status(200).json({ ok: true });
      }
      if (prenda.vendido) return res.status(400).json({ error: 'La prenda ya está vendida.' });
      const bazar = await db.collection('bazares').findOne({ id: Number(prenda.bazarId || 1) });
      const defecto = configInstagram(bazar).automatico.apartadoHoras;
      const horas = Math.min(240, Math.max(1, Number(b.horas) || defecto));
      const hasta = new Date(Date.now() + horas * 3600 * 1000).toISOString();
      const reservedBy = {
        nombre: String(b.nombre || '').trim().slice(0, 80),
        telefono: String(b.telefono || '').replace(/[^\d+]/g, '').slice(0, 16),
        por: user.username, en: new Date().toISOString(),
      };
      await col.updateOne({ id }, { $set: { apartada: true, reservedUntil: hasta, reservedBy } });
      invalidarSyncCache();
      // v56 · Instagram dice lo mismo que la tienda: "Apartada por ahora"
      let instagram = null;
      try { instagram = await igAvisarApartado(db, { ...prenda, apartada: true }, bazar); } catch {}
      return res.status(200).json({ ok: true, hasta, instagram: !!instagram });
    }

    if (req.method === 'POST' && req.query.op === 'marketplace') {
      const user = await requireAuth(req, res);
      if (!user) return;
      const id = parseInt(req.query.id);
      if (!id) return res.status(400).json({ error: 'Falta ?id=N' });

      const prenda = await col.findOne({ id });
      if (!prenda) return res.status(404).json({ error: `Ítem ${id} no encontrado` });
      if (!mismoBazar(user, prenda.bazarId)) {
        return res.status(403).json({ error: 'Esa prenda pertenece a otro bazar.' });
      }
      if (!esGlobal(user) && !(await puede(user, 'crearPrendas'))) {
        return res.status(403).json({ error: 'Tu bazar no tiene permitido publicar prendas.' });
      }

      const { accion } = req.body || {};
      const ahora = new Date().toISOString();
      const mp = { ...(prenda.marketplace || {}) };
      const url = linkMarketplace(req.body?.url);
      if (req.body?.url && !url) {
        return res.status(400).json({ error: 'Ese link no es de Facebook. Cópialo desde tu publicación de Marketplace.' });
      }

      if (accion === 'publicada') {
        if (prenda.vendido) return res.status(400).json({ error: 'La prenda ya está vendida.' });
        Object.assign(mp, { publicadoEn: ahora, renovadoEn: null, vendidoMarcadoEn: null, precio: Number(prenda.precio_venta) || 0 });
        if (url) mp.url = url;
      } else if (accion === 'renovada' || accion === 'precio') {
        if (!mp.publicadoEn) return res.status(400).json({ error: 'Primero márcala como publicada en Marketplace.' });
        if (accion === 'renovada') mp.renovadoEn = ahora;
        mp.precio = Number(prenda.precio_venta) || 0;
      } else if (accion === 'vendida') {
        if (!mp.publicadoEn) return res.status(400).json({ error: 'Esa prenda no está en Marketplace.' });
        mp.vendidoMarcadoEn = ahora;
      } else if (accion === 'link') {
        if (!mp.publicadoEn) return res.status(400).json({ error: 'Primero márcala como publicada en Marketplace.' });
        if (!url) return res.status(400).json({ error: 'Pega el link de tu publicación.' });
        mp.url = url;
      } else if (accion === 'quitar') {
        await col.updateOne({ id }, { $unset: { marketplace: '' } });
        invalidarSyncCache();
        return res.status(200).json({ ok: true, marketplace: null });
      } else {
        return res.status(400).json({ error: 'Acción no válida.' });
      }

      await col.updateOne({ id }, { $set: { marketplace: mp } });
      invalidarSyncCache();
      return res.status(200).json({ ok: true, marketplace: mp });
    }

    // ── POST — crea una prenda ──────────────────────────────
    if (req.method === 'POST') {
      const user = await requireAuth(req, res);
      if (!user) return;
      if (!esGlobal(user) && !(await puede(user, 'crearPrendas'))) {
        return res.status(403).json({ error: 'Tu bazar no tiene permitido publicar prendas.' });
      }

      const cuerpo = req.body || {};

      // El bazar lo decide el servidor: un vendedor no puede publicar en
      // el bazar de otro aunque lo mande en el cuerpo.
      const bazarId = esGlobal(user)
        ? Number(cuerpo.bazarId || 1)
        : Number(user.bazarId);

      if (!esGlobal(user) && !bazarId) {
        return res.status(403).json({ error: 'Tu cuenta no tiene bazar asignado.' });
      }

      const nombre = typeof cuerpo.nombre === 'string' ? cuerpo.nombre.trim() : '';
      if (!nombre) return res.status(400).json({ error: 'La prenda necesita nombre' });

      // El id lo asigna el servidor. Si lo eligiera el navegador, dos
      // vendedores publicando a la vez se pisarían el número.
      const ultimo = await col.find({}).sort({ id: -1 }).limit(1).toArray();
      const nuevoId = (ultimo[0]?.id || 0) + 1;

      const prenda = { id: nuevoId, bazarId, creadoEn: new Date().toISOString(), vendido: false };
      for (const k of CAMPOS) if (k in cuerpo) prenda[k] = limpiarCampo(k, cuerpo[k]);
      prenda.id = nuevoId;            // por si venía en el cuerpo
      prenda.bazarId = bazarId;
      prenda.nombre = limpiarCampo('nombre', nombre);
      if (!prenda.nombre) return res.status(400).json({ error: 'La prenda necesita nombre' });

      await col.insertOne(prenda);
      invalidarSyncCache();
      const { _id, ...limpio } = prenda;
      return res.status(201).json({ ok: true, prenda: limpio });
    }

    const id = parseInt(req.query.id);
    if (!id) return res.status(400).json({ error: 'Falta ?id=N' });

    // ── PATCH — actualiza solo los campos enviados (con sesión) ──
    if (req.method === 'PATCH') {
      const user = await requireAuth(req, res);
      if (!user) return;

      // Multi-bazar: solo el dueño de la prenda (o el admin principal) la edita
      const actual = await col.findOne({ id });
      if (!actual) return res.status(404).json({ error: `Ítem ${id} no encontrado` });
      if (!mismoBazar(user, actual.bazarId)) {
        return res.status(403).json({ error: 'Esa prenda pertenece a otro bazar.' });
      }
      if (!esGlobal(user) && !(await puede(user, 'editarPrendas'))) {
        return res.status(403).json({ error: 'Tu bazar no tiene permitido editar prendas.' });
      }
      // Permisos por usuario: un vendedor puede tener bloqueado cambiar precios
      const u = req.body || {};
      if (('precio_venta' in u && Number(u.precio_venta) !== Number(actual.precio_venta)) || ('precioAnterior' in u && Number(u.precioAnterior || 0) !== Number(actual.precioAnterior || 0))) {
        if (!(await permisosDe(db, user)).precios) return res.status(403).json({ error: 'Tu usuario no tiene permiso para cambiar precios. Pídeselo al administrador.' });
      }

      const updates = req.body || {};
      // v33: cambios que soltarían o venderían una prenda comprometida con un pedido en línea
      const tocaReserva = ('apartada' in updates && !updates.apartada) || ('reservedBy' in updates) || ('reservedUntil' in updates) || ('vendido' in updates && updates.vendido);
      if (tocaReserva) {
        const activa = await reservaActiva(db, actual);
        if (activa) return res.status(409).json({ error: activa.mensaje, pedido: activa.pedido.id });
      }
      const $set = {};
      for (const key of CAMPOS) if (key in updates) $set[key] = limpiarCampo(key, updates[key]);
      // v41: el costo de una prenda ya registrada solo lo cambia un administrador
      if (user.role !== 'admin') delete $set.costo;
      if ('nombre' in $set && !$set.nombre) return res.status(400).json({ error: 'La prenda necesita nombre' });
      if (!Object.keys($set).length) {
        return res.status(400).json({ error: 'No hay campos válidos para actualizar' });
      }
      // v56 · Rebaja hecha a mano: la tienda muestra el precio anterior tachado, igual que el
      // comentario de Instagram ("antes $Y"). Si el panel manda precioAnterior (p. ej. 0 =
      // "es una corrección, no una rebaja"), manda eso. Si sube por encima del anterior, se quita.
      const $unset = {};
      if ('precio_venta' in $set && !('precioAnterior' in updates)) {
        const nuevo = Number($set.precio_venta), viejo = Number(actual.precio_venta) || 0, ant = Number(actual.precioAnterior) || 0;
        if (nuevo > 0 && nuevo < viejo) $set.precioAnterior = Math.max(ant, viejo);
        else if (ant && nuevo >= ant) $unset.precioAnterior = '';
      }
      const result = await col.updateOne({ id }, Object.keys($unset).length ? { $set, $unset } : { $set });
      if (result.matchedCount === 0) return res.status(404).json({ error: `Ítem ${id} no encontrado` });
      invalidarSyncCache();
      // v55 · Instagram al día: si la prenda tiene post y sigue a la venta,
      //  - precio nuevo → comentario con el precio vigente (reemplaza el anterior);
      //  - nombre/talla/estado/marca/descripción → el panel ofrece copiar el texto nuevo
      //    (Instagram no deja editar el texto de un post desde fuera).
      let instagram = null;
      if (actual.instagramId && !actual.vendido && !$set.vendido) {
        const precioNuevo = 'precio_venta' in $set && Number($set.precio_venta) !== Number(actual.precio_venta);
        const textoCambio = ['nombre', 'talla', 'estado', 'marca', 'descripcion'].filter(k => k in $set && String($set[k] ?? '') !== String(actual[k] ?? ''));
        if (precioNuevo || textoCambio.length) {
          instagram = { textoViejo: precioNuevo || textoCambio.length > 0, campos: [...(precioNuevo ? ['precio'] : []), ...textoCambio] };
          if (precioNuevo) {
            try {
              const bazar = await db.collection('bazares').findOne({ id: Number(actual.bazarId || 1) });
              // "antes $Y" solo si la tienda también lo muestra tachado
              const tachado = $unset.precioAnterior !== undefined ? 0 : Number($set.precioAnterior ?? actual.precioAnterior) || 0;
              instagram.precioComentado = !!(await igAvisarPrecio(db, actual, $set.precio_venta, tachado > Number($set.precio_venta) ? actual.precio_venta : 0, bazar));
            } catch { instagram.precioComentado = false; }
          }
        }
      }
      return res.status(200).json({ ok: true, updated: $set, instagram });
    }

    // ── DELETE — el admin principal, o el bazar dueño con permiso ──
    if (req.method === 'DELETE') {
      const user = await requireAuth(req, res);
      if (!user) return;

      const actual = await col.findOne({ id });
      if (!actual) return res.status(404).json({ error: `Ítem ${id} no encontrado` });

      if (!esGlobal(user)) {
        if (!mismoBazar(user, actual.bazarId)) {
          return res.status(403).json({ error: 'Esa prenda pertenece a otro bazar.' });
        }
        if (!(await puede(user, 'borrarPrendas'))) {
          return res.status(403).json({ error: 'Tu bazar no tiene permitido borrar prendas.' });
        }
      }

      const result = await col.deleteOne({ id });
      if (result.deletedCount === 0) return res.status(404).json({ error: `Ítem ${id} no encontrado` });
      invalidarSyncCache();
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Método no permitido' });

  } catch (err) {
    console.error('[inventario-item]', err);
    await registrarFalla(err, { origen: 'inventario-item', op: req.query?.op || req.method });
    return res.status(500).json({ error: 'No se pudo completar la operación.' });
  }
}


// Link de una publicación de Marketplace. Solo se aceptan links de Facebook;
// si trae el número de la publicación se guarda en su forma corta y limpia
// (sin los parámetros de rastreo que agrega la app).
function linkMarketplace(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  let u;
  try { u = new URL(v.trim().slice(0, 500)); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (!/(^|\.)facebook\.com$/.test(host) && host !== 'fb.me' && host !== 'fb.com') return null;
  const item = u.pathname.match(/\/marketplace\/item\/(\d{5,25})/);
  if (item) return `https://www.facebook.com/marketplace/item/${item[1]}/`;
  return `https://${host}${u.pathname}`.slice(0, 300);
}

// v40 · Todas las funciones pasan primero por el escudo (ver api/_lib/escudo.js)
export default conEscudo(auditado);
