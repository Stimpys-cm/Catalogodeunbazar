// ═════════════════════════════════════════════════════════════
//  v55 · Instagram al día con la tienda y el panel
// ═════════════════════════════════════════════════════════════
// Instagram no deja cambiar el texto de un post ya publicado (la API solo
// prende o apaga los comentarios), así que lo que cambia después de publicar
// se avisa con un comentario en el mismo post. Todo pasa por aquí, venga de
// donde venga el cambio (panel, tienda en línea, Caja o el modo automático):
//
//   igAvisarVenta   vendida (en línea, Caja o panel) → "VENDIDA" en su post y en el carrusel del drop
//   igQuitarVenta   venta revertida o ticket anulado → se borran esos comentarios
//   igAvisarPrecio  cambió el precio → un solo comentario con el precio vigente (borra el anterior)
//   igAvisarBaja    se borró la prenda (papelera) → "ya no está disponible"
//   igQuitarBaja    se restauró de la papelera → se borra ese comentario
//
// Nada de esto frena la acción principal: si Instagram falla, la venta, el
// precio o el borrado quedan hechos igual y el error va al Centro de actividad.
import {
  credencialesInstagram, configInstagram, comentarVendido, comentarEnPost,
  borrarComentario, historiaVendido, estiloLimpio,
} from './instagram.js';
import { registrarEvento } from './actividad.js';

const SITIO = (process.env.SITE_URL || 'https://stiimpys.store').replace(/\/$/, '');
const DOM = SITIO.replace(/^https?:\/\//, '');
const pesos = n => `$${Math.round(Number(n) || 0).toLocaleString('es-MX')}`;
const conIG = bazar => !!(bazar && credencialesInstagram(bazar));

export function textoVendidaDrop(prenda, bazar) {
  return estiloLimpio(configInstagram(bazar)) ? `${prenda.nombre}: VENDIDA` : `❌ ${prenda.nombre} — VENDIDA ❌`;
}
export function textoPrecio(prenda, nuevo, antes, bazar) {
  const limpio = estiloLimpio(configInstagram(bazar)), link = `${DOM}/p/${prenda.id}`;
  if (Number(antes) > Number(nuevo)) {
    return limpio
      ? `Nuevo precio: ${pesos(nuevo)} MXN (antes ${pesos(antes)}). Disponible en ${link}`
      : `🔥 NUEVO PRECIO: ${pesos(nuevo)} MXN (antes ${pesos(antes)})\nApártala en ${link} 🛒`;
  }
  return limpio ? `Precio actualizado: ${pesos(nuevo)} MXN. Disponible en ${link}` : `💸 Precio actualizado: ${pesos(nuevo)} MXN\nApártala en ${link} 🛒`;
}
export function textoApartado(prenda, bazar) {
  return estiloLimpio(configInstagram(bazar))
    ? `Apartada por ahora. Si se libera, la verás disponible en ${DOM}/p/${prenda.id}`
    : `⏳ APARTADA por ahora. Si se libera, la verás disponible en ${DOM}/p/${prenda.id}`;
}
export function textoBaja(bazar) {
  return estiloLimpio(configInstagram(bazar))
    ? `Esta prenda ya no está disponible. Hay más en ${DOM}`
    : `🚫 Esta prenda ya no está disponible. Hay más en ${DOM} 🛍️`;
}

async function anotarError(db, prenda, tipo, accion, e) {
  try {
    await registrarEvento({ categoria: 'instagram', tipo, resultado: 'error', bazarId: Number(prenda?.bazarId || 1),
      prendaId: prenda?.id ?? null, accion, error: e }, db);
  } catch {}
}
async function borrarSinMiedo(bazar, id) {
  if (!id) return true;
  try { await borrarComentario(bazar, id); return true; }
  catch (e) { return /does not exist|no existe|cannot be loaded|Unsupported|100/i.test(String(e?.message || e?.codigo || '')); }
}

// ── Vendida ────────────────────────────────────────────────────
// Una sola vez por prenda (prenda.instagramVendido guarda lo que ya se hizo).
// `forzar` = la dueña lo pidió en el panel aunque "Comentar VENDIDA" esté apagado.
export async function igAvisarVenta(db, prenda, bazar, { historia = false, comentario = true, forzar = false, origen = '' } = {}) {
  const out = { comentario: null, drop: null, historia: null, errores: [] };
  if (!prenda || !conIG(bazar)) return out;
  if (!forzar && configInstagram(bazar).autoComentario === false) return out;
  const hecho = prenda.instagramVendido || {}, $set = {}, inv = db.collection('inventario');
  const de = origen ? ` (${origen})` : '';
  if (comentario && prenda.instagramId && !hecho.comentario) {
    try { $set['instagramVendido.comentario'] = out.comentario = await comentarVendido(prenda, bazar); }
    catch (e) {
      out.errores.push(`Comentario: ${e.message}`);
      if (e.postMuerto) await inv.updateOne({ id: prenda.id }, { $unset: { instagramId: '', instagramUrl: '', instagramEn: '' } });
      await anotarError(db, prenda, 'ig.comentario-vendida', `No se pudo comentar VENDIDA en Instagram para "${prenda.nombre}"${de}`, e);
    }
  }
  if (comentario && prenda.dropIgId && !hecho.drop) {
    try { $set['instagramVendido.drop'] = out.drop = await comentarEnPost(bazar, prenda.dropIgId, textoVendidaDrop(prenda, bazar)); }
    catch (e) { out.errores.push(`Drop: ${e.message}`); await anotarError(db, prenda, 'ig.comentario-vendida', `No se pudo avisar en el carrusel del drop que se vendió "${prenda.nombre}"${de}`, e); }
  }
  if (historia && !hecho.historia) {
    try { $set['instagramVendido.historia'] = out.historia = await historiaVendido(prenda, bazar); }
    catch (e) { out.errores.push(`Historia: ${e.message}`); await anotarError(db, prenda, 'ig.historia-vendida', `No se pudo subir la historia de VENDIDA de "${prenda.nombre}"${de}`, e); }
  }
  if (Object.keys($set).length) {
    $set['instagramVendido.en'] = new Date().toISOString();
    await inv.updateOne({ id: prenda.id }, { $set });
  }
  // v56: ya se vendió, el aviso de "apartada" sobra
  if (prenda.instagramApartado?.comentario) await igQuitarApartado(db, prenda, bazar);
  return out;
}

// ── v56 · Apartada a mano (panel / WhatsApp) → "Apartada por ahora"; al liberarse o venderse se borra ──
export async function igAvisarApartado(db, prenda, bazar) {
  if (!prenda?.instagramId || prenda.vendido || !conIG(bazar) || configInstagram(bazar).avisarCambios === false) return null;
  if (prenda.instagramApartado?.comentario) return prenda.instagramApartado.comentario;
  try {
    const id = await comentarEnPost(bazar, prenda.instagramId, textoApartado(prenda, bazar));
    await db.collection('inventario').updateOne({ id: prenda.id }, { $set: { instagramApartado: { comentario: id, en: new Date().toISOString() } } });
    return id;
  } catch (e) { await anotarError(db, prenda, 'ig.comentario-apartada', `No se pudo avisar en Instagram que "${prenda.nombre}" está apartada`, e); return null; }
}
export async function igQuitarApartado(db, prenda, bazar) {
  const id = prenda?.instagramApartado?.comentario;
  if (!id) return false;
  const ok = !conIG(bazar) ? false : await borrarSinMiedo(bazar, id);
  if (conIG(bazar) && !ok) await anotarError(db, prenda, 'ig.quitar-apartada', `No se pudo borrar el aviso de "apartada" de "${prenda.nombre}" en Instagram; bórralo a mano`, new Error('comentario ' + id));
  await db.collection('inventario').updateOne({ id: prenda.id }, { $unset: { instagramApartado: '' } });
  return ok;
}

// ── Venta revertida / ticket anulado: la prenda vuelve a la tienda ──
export async function igQuitarVenta(db, prenda, bazar) {
  const v = prenda?.instagramVendido;
  if (!v || !(v.comentario || v.drop) || !conIG(bazar)) return { quitados: 0 };
  let quitados = 0, fallo = null;
  for (const id of [v.comentario, v.drop].filter(Boolean)) {
    if (await borrarSinMiedo(bazar, id)) quitados++; else fallo = id;
  }
  if (fallo) await anotarError(db, prenda, 'ig.quitar-vendida', `No se pudo borrar el comentario de VENDIDA de "${prenda.nombre}" en Instagram; bórralo a mano`, new Error('comentario ' + fallo));
  await db.collection('inventario').updateOne({ id: prenda.id }, { $unset: { instagramVendido: '' } });
  return { quitados, fallo: !!fallo };
}

// ── Precio nuevo: un solo comentario con el precio vigente ─────
// `siempre` = lo pide el modo automático (su propio interruptor "Avisar en su post").
export async function igAvisarPrecio(db, prenda, nuevo, antes, bazar, { siempre = false } = {}) {
  nuevo = Math.round(Number(nuevo) || 0); antes = Math.round(Number(antes) || 0);
  if (!prenda?.instagramId || prenda.vendido || !nuevo || nuevo === antes || nuevo === Math.round(Number(prenda.instagramPrecio?.precio) || 0) || !conIG(bazar)) return null;
  if (!siempre && configInstagram(bazar).avisarCambios === false) return null;
  await borrarSinMiedo(bazar, prenda.instagramPrecio?.comentario);
  try {
    const id = await comentarEnPost(bazar, prenda.instagramId, textoPrecio(prenda, nuevo, antes, bazar));
    await db.collection('inventario').updateOne({ id: prenda.id }, { $set: { instagramPrecio: { comentario: id, precio: nuevo, en: new Date().toISOString() } } });
    return id;
  } catch (e) {
    await anotarError(db, prenda, 'ig.comentario-precio', `No se pudo comentar el precio nuevo de "${prenda.nombre}" en Instagram`, e);
    return null;
  }
}

// ── Borrada (a la papelera) / restaurada ───────────────────────
export async function igAvisarBaja(db, prenda, bazar) {
  if (!prenda?.instagramId || prenda.vendido || !conIG(bazar) || configInstagram(bazar).avisarCambios === false) return null;
  try { return await comentarEnPost(bazar, prenda.instagramId, textoBaja(bazar)); }
  catch (e) { await anotarError(db, prenda, 'ig.comentario-baja', `No se pudo avisar en Instagram que "${prenda.nombre}" ya no está disponible`, e); return null; }
}
export async function igQuitarBaja(db, prenda, bazar) {
  const id = prenda?.instagramBaja?.comentario;
  if (!id || !conIG(bazar)) return false;
  const ok = await borrarSinMiedo(bazar, id);
  if (!ok) await anotarError(db, prenda, 'ig.quitar-baja', `No se pudo borrar el aviso "ya no está disponible" de "${prenda.nombre}" en Instagram; bórralo a mano`, new Error('comentario ' + id));
  return ok;
}
