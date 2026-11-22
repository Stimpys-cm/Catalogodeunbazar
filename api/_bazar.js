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
import { credencialesInstagram, configInstagram } from './_instagram.js';

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
    tiktok: b.tiktok || '',
    facebook: b.facebook || '',
    descripcion: b.descripcion || '',
    color: b.color || '',
    portada: b.portada || '',
    // El panel guardaba logo y banner pero no salían de aquí, así que la
    // tienda nunca podía pintarlos aunque su código ya los pedía.
    logo: b.logo || '',
    banner: b.banner || '',
    ubicacion: b.ubicacion || '',
    activo: b.activo !== false,
    // Solo dice SI hay Instagram conectado; las credenciales nunca salen.
    instagramAuto: !!credencialesInstagram(b),
    instagramBorrar: !!credencialesInstagram(b)?.puedeBorrar,
    instagramConfig: configInstagram(b),
    // Los permisos no son secretos: describen qué puede hacer el bazar en su
    // panel. El servidor los vuelve a verificar en cada escritura.
    permisos: normalizarPermisos(b.permisos),
  };
}

// Campos que NUNCA salen al público: el costo es el margen del bazar y la
// reserva dice quién está a punto de comprar. Cualquier endpoint que
// devuelva prendas a quien no tiene sesión pasa por aquí.
export const CAMPOS_PRIVADOS = ['costo', 'reservedBy', 'reservedUntil'];

export function prendaPublica(p) {
  const out = {};
  for (const k of Object.keys(p)) {
    if (k === '_id' || CAMPOS_PRIVADOS.includes(k)) continue;
    out[k] = p[k];
  }
  // "Vendido a …": en la tienda pública solo nombre e inicial. Las ventas en
  // línea guardan aquí el nombre completo que el cliente escribió al pagar,
  // y eso no tiene por qué verlo cualquiera. Un @usuario (sin espacios) se queda igual.
  if (typeof out.vendidoA === 'string' && /\s/.test(out.vendidoA.trim())) {
    const [a, b] = out.vendidoA.trim().split(/\s+/);
    out.vendidoA = `${a} ${b[0].toUpperCase()}.`;
  }
  // v36 · Apartada mientras alguien la paga en línea (10 min): al público solo le
  // sale HASTA CUÁNDO, para el contador; nunca quién. Si ya venció, se ve libre
  // (el servidor también la deja comprar: ver libre() en _crecer.js).
  if (p.apartada && !p.vendido && p.reservedBy?.pedido && !p.reservedBy?.anticipo && p.reservedUntil) {
    const hasta = new Date(p.reservedUntil);
    if (hasta.getTime() > Date.now()) out.pagandoHasta = hasta.toISOString();
    else out.apartada = false;
  }
  return out;
}

// ── v39 · Una sola tienda: Stiimpys ─────────────────────────────────────
// Desde noviembre de 2026 la página es solo de Stiimpys: no recibe bazares
// nuevos y lo público (tienda, ficha, carrito, pago, sitemap, feed) muestra y
// cobra únicamente las prendas del bazar principal. Nada se borra: los demás
// bazares, sus prendas y sus pedidos siguen en la base y en el panel.
// Para volver a abrir la página a otros bazares: MULTI_BAZAR=1 en Vercel.
export const multiBazar = () => process.env.MULTI_BAZAR === '1';

// El bazar de Stiimpys: BAZAR_PRINCIPAL si está definida; si no, el que tiene
// el @stiimpys; si no, el 1 (el que cobra con las claves de Clip sin número).
export function idPrincipal(bazares = []) {
  const env = Number(process.env.BAZAR_PRINCIPAL);
  if (env) return env;
  const b = (bazares || []).find(x => String(x?.slug || '').toLowerCase() === 'stiimpys');
  return b ? Number(b.id) : 1;
}

let _principal = { id: 0, en: 0 };
export async function bazarPrincipal(db) {
  if (Number(process.env.BAZAR_PRINCIPAL)) return Number(process.env.BAZAR_PRINCIPAL);
  if (_principal.id && Date.now() - _principal.en < 5 * 60e3) return _principal.id;
  const lista = await db.collection('bazares').find({}, { projection: { id: 1, slug: 1, _id: 0 } }).toArray();
  _principal = { id: idPrincipal(lista), en: Date.now() };
  return _principal.id;
}

// ¿Este registro (prenda, reseña, subasta…) es de la tienda pública?
// Con MULTI_BAZAR=1 todo lo es, como antes.
export function deLaTienda(principal) {
  if (multiBazar()) return () => true;
  return x => Number(x?.bazarId || 1) === Number(principal);
}
export async function filtroTienda(db) {
  return multiBazar() ? () => true : deLaTienda(await bazarPrincipal(db));
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

// ── Limpieza de cada campo ───────────────────────────────────
// La tienda pública y el panel del admin principal muestran lo que escribe
// cualquier bazar. Sin esto, un nombre con "<img onerror=…>" o una "foto" con
// "javascript:" quedaba guardado tal cual (XSS guardado). Aquí cada campo se
// queda con su tipo, un largo razonable y sin etiquetas HTML.
const LARGO_TEXTO = { nombre: 140, marca: 60, talla: 40, estado: 40, descripcion: 3000, vendidoA: 80, hashtags: 600 };
const sinEtiquetas = v => String(v ?? '').replace(/[<>]/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
const fotoValida = u => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u.trim()) && u.length <= 600;
function numeroOpcional(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
function fechaOpcional(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : (typeof v === 'string' ? v.slice(0, 40) : t.toISOString());
}
export function limpiarCampoPrenda(k, v) {
  if (k in LARGO_TEXTO) return v == null ? '' : sinEtiquetas(v).slice(0, LARGO_TEXTO[k]);
  switch (k) {
    case 'precio_venta': return numeroOpcional(v) ?? 0;
    case 'precioAnterior': case 'costo': return numeroOpcional(v);
    case 'vendido': case 'oculto': case 'apartada': return v === true || v === 'true';
    case 'categorias': return (Array.isArray(v) ? v : v ? [v] : []).map(x => sinEtiquetas(x).slice(0, 40)).filter(Boolean).slice(0, 12);
    case 'imagenes': return (Array.isArray(v) ? v : []).filter(fotoValida).map(u => u.trim()).slice(0, 20);
    case 'vendidoEn': case 'creadoEn': case 'reservedUntil': return fechaOpcional(v);
    case 'dropId': return v == null || v === '' ? null : sinEtiquetas(v).slice(0, 60);
    case 'reservedBy': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      const o = {};
      for (const [kk, vv] of Object.entries(v).slice(0, 15)) {
        if (!/^[a-zA-Z]{1,20}$/.test(kk)) continue;
        o[kk] = typeof vv === 'number' || typeof vv === 'boolean' ? vv : sinEtiquetas(vv).slice(0, 120);
      }
      return o;
    }
    default: return v;
  }
}
