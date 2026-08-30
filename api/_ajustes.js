// api/_ajustes.js
// ─────────────────────────────────────────────────────────────
// Estado del sitio: qué está abierto y qué está en mantenimiento.
//
// Vive en un único documento de la colección 'ajustes'. Se sirve con el
// sync público para que las páginas sepan si deben mostrarse o no, así
// que aquí NO puede haber nada privado.
//
// El cierre es por partes para poder trabajar sin apagarlo todo:
//   sitio   → cierra las páginas públicas completas
//   tienda  → cierra el catálogo y las fichas; el inicio sigue en pie
//   cuentas → cierra registro y acceso de compradores
//   panel   → cierra el panel a los vendedores (el admin principal entra)
//
// Los archivos con "_" son helpers: no gastan Serverless Functions.
// ─────────────────────────────────────────────────────────────

import { getDB } from './_db.js';

export const SECCIONES = ['sitio', 'tienda', 'cuentas', 'panel'];

const MENSAJE_POR_DEFECTO = 'Estamos haciendo mejoras. Volvemos en un rato.';

export function ajustesPorDefecto() {
  const mantenimiento = {};
  for (const s of SECCIONES) {
    mantenimiento[s] = { cerrado: false, mensaje: '', hasta: null };
  }
  return { id: 1, mantenimiento, actualizadoEn: null, actualizadoPor: '' };
}

// Deja el objeto siempre con la misma forma, venga como venga de la BD
export function normalizarAjustes(a) {
  const base = ajustesPorDefecto();
  if (!a || typeof a !== 'object') return base;

  for (const s of SECCIONES) {
    const v = a.mantenimiento?.[s];
    if (!v) continue;
    base.mantenimiento[s] = {
      cerrado: v.cerrado === true,
      mensaje: typeof v.mensaje === 'string' ? v.mensaje.slice(0, 200) : '',
      // Un cierre puede tener fecha de fin; pasada esa hora deja de aplicar
      hasta: v.hasta ? new Date(v.hasta).toISOString() : null,
    };
  }
  base.actualizadoEn  = a.actualizadoEn ? new Date(a.actualizadoEn).toISOString() : null;
  base.actualizadoPor = typeof a.actualizadoPor === 'string' ? a.actualizadoPor.slice(0, 40) : '';
  return base;
}

// ¿Esta sección está cerrada ahora mismo? Un cierre con fecha pasada
// se considera terminado, así no hay que acordarse de reabrir.
export function cerrada(ajustes, seccion) {
  const m = ajustes?.mantenimiento?.[seccion];
  if (!m || !m.cerrado) return false;
  if (m.hasta && new Date(m.hasta).getTime() < Date.now()) return false;
  return true;
}

export const mensajeDe = (ajustes, seccion) =>
  ajustes?.mantenimiento?.[seccion]?.mensaje || MENSAJE_POR_DEFECTO;

export async function leerAjustes() {
  try {
    const db = await getDB();
    const doc = await db.collection('ajustes').findOne({ id: 1 });
    return normalizarAjustes(doc);
  } catch (_) {
    // Si la BD falla, el sitio se queda abierto: es preferible a
    // dejarlo cerrado por un problema de conexión.
    return ajustesPorDefecto();
  }
}

export async function guardarAjustes(mantenimiento, usuario) {
  const db = await getDB();
  const limpio = normalizarAjustes({ mantenimiento });
  const doc = {
    id: 1,
    mantenimiento: limpio.mantenimiento,
    actualizadoEn: new Date(),
    actualizadoPor: String(usuario || '').slice(0, 40),
  };
  await db.collection('ajustes').updateOne({ id: 1 }, { $set: doc }, { upsert: true });
  return normalizarAjustes(doc);
}
