// api/_bazar.js
// ─────────────────────────────────────────────────────────────
// Helpers de multi-bazar. Los archivos con "_" son helpers, no
// cuentan como Serverless Functions en Vercel.
//
// Modelo:
//   bazares  { id, slug, nombre, whatsapp, instagram, descripcion,
//              color, portada, activo, permisos:{...} }
//   usuarios { ..., bazarId }   → null/0 = staff global (admin principal)
//   inventario { ..., bazarId } → a qué bazar pertenece la prenda
//   categorias/marcas { ..., bazarId } → null/0 = general (compartida)
// ─────────────────────────────────────────────────────────────

import { getDB } from './_db.js';

// Permisos que el admin principal puede activar o quitar por bazar.
export const PERMISOS = [
  'crearPrendas',      // puede publicar prendas nuevas
  'editarPrendas',     // puede editar las suyas
  'borrarPrendas',     // puede eliminar las suyas
  'gestionarUsuarios', // puede crear vendedores dentro de su bazar
  'gestionarCatalogo', // puede crear sus propias categorías y marcas
  'personalizar',      // puede editar el perfil/portada de su bazar
];

export const PERMISOS_DEFAULT = {
  crearPrendas: true,
  editarPrendas: true,
  borrarPrendas: true,
  gestionarUsuarios: false,
  gestionarCatalogo: true,
  personalizar: true,
};

export function normalizarPermisos(p) {
  const out = {};
  for (const k of PERMISOS) out[k] = p && typeof p[k] === 'boolean' ? p[k] : PERMISOS_DEFAULT[k];
  return out;
}

// Datos públicos de un bazar (nunca exponer nada sensible).
export function bazarPublico(b) {
  return {
    id: b.id,
    slug: b.slug,
    nombre: b.nombre,
    whatsapp: b.whatsapp || '',
    instagram: b.instagram || '',
    descripcion: b.descripcion || '',
    color: b.color || '',
    portada: b.portada || '',
    ubicacion: b.ubicacion || '',
    activo: b.activo !== false,
    // Los permisos no son secretos: describen qué puede hacer el bazar en su
    // panel. El servidor los vuelve a verificar en cada escritura.
    permisos: normalizarPermisos(b.permisos),
  };
}

// El admin principal no pertenece a ningún bazar: manda sobre todos.
export function esGlobal(user) {
  return user?.role === 'admin' && !user?.bazarId;
}

// ¿Este usuario puede tocar contenido de este bazar?
export function mismoBazar(user, bazarId) {
  if (esGlobal(user)) return true;
  if (!user?.bazarId) return false;
  return Number(user.bazarId) === Number(bazarId);
}

// ¿El bazar del usuario tiene activado este permiso?
// El admin principal siempre puede.
export async function puede(user, permiso) {
  if (esGlobal(user)) return true;
  if (!user?.bazarId) return false;
  const db = await getDB();
  const bazar = await db.collection('bazares').findOne({ id: Number(user.bazarId) });
  if (!bazar || bazar.activo === false) return false;
  return normalizarPermisos(bazar.permisos)[permiso] === true;
}

// Responde 403 y devuelve false si no tiene el permiso.
export async function requirePermiso(req, res, user, permiso) {
  if (await puede(user, permiso)) return true;
  res.status(403).json({ error: `Tu bazar no tiene permitido: ${permiso}` });
  return false;
}
