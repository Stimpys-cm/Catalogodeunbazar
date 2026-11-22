// api/_instagram.js
// ─────────────────────────────────────────────────────────────
// Todo lo que el servidor hace con Instagram. Cada bazar publica en
// SU cuenta; las credenciales viven en variables de entorno de Vercel,
// nunca en la base de datos ni en el navegador:
//
//   IG_<SLUG>_USER_ID   → ID de la cuenta profesional de Instagram
//   IG_<SLUG>_TOKEN     → token de acceso
//   IG_<SLUG>_MODO      → "facebook" o "instagram" (por defecto "instagram")
//
//   <SLUG> = slug del bazar en MAYÚSCULAS, lo que no sea letra o número → "_"
//     stiimpys → IG_STIIMPYS_USER_ID / IG_STIIMPYS_TOKEN / IG_STIIMPYS_MODO
//     papu_bzr → IG_PAPU_BZR_USER_ID / ...
//
// Los dos modos:
//   instagram → "API de Instagram con inicio de sesión de Instagram"
//               (graph.instagram.com). Más fácil de conectar, pero
//               Instagram NO deja borrar publicaciones con ella.
//   facebook  → "API de Instagram con inicio de sesión de Facebook"
//               (graph.facebook.com). Pide una página de Facebook ligada,
//               pero permite BORRAR posts (y por lo tanto "editar" =
//               volver a publicar) y un token de usuario del sistema que
//               no vence.
//
// Opcionales: IG_API_VERSION (por defecto v23.0) y SITE_URL.
// ─────────────────────────────────────────────────────────────

const VERSION   = process.env.IG_API_VERSION || 'v23.0';
const SITIO     = (process.env.SITE_URL || 'https://stiimpys.store').replace(/\/$/, '');
const DOMINIO   = SITIO.replace(/^https?:\/\//, '');
const MAX_FOTOS = 10;

export const CONFIG_DEFAULT = {
  hashtags: '#bazar #reynosa #bazarreynosa #ropavintage #streetwear #segundamano #thrift #vintage',
  firma: '📦 Envíos a todo México · Entrega en persona en Reynosa',
  autoPublicar: true,      // casilla "Publicar en Instagram" marcada al subir prenda
  autoComentario: true,    // casilla "Comentar VENDIDA" marcada al vender
  autoHistoria: true,      // casilla "Historia VENDIDO" marcada al vender
  hashtagsInteligentes: true, // hashtags de cada prenda (marca, tipo, talla, ciudad)
  autoPortada: false,      // casilla "Cambiar portada a VENDIDO" (vuelve a publicar el post)
  plantilla: true,         // portada con la plantilla de marca (@, talla y precio)
  estiloHistoria: 'crema',  // crema | noir | portada
  tonoPlantilla: 'crema',   // crema | blanco | noir (franja de la portada)
  colorPlantilla: '2d6be4',
  // Automático (lo corre el cron diario y el panel al abrirse)
  mejorarFotos: false,          // e_improve + e_sharpen de Cloudinary (gratis)
  automatico: {
    verificarPosts: true,       // desliga prendas cuyo post ya no existe
    rebaja: false, rebajaDias: 15, rebajaPct: 10, rebajaMin: 100, rebajaVeces: 2,
    rebajaComentar: true, rebajaHistoria: false,
    respuestas: false,
    respuestaPalabras: 'precio, info, informes, disponible, costo, cuanto, cuánto, talla, medidas, dm',
    respuestaTexto: '¡Hola @{usuario}! 🙌 {nombre} · Talla {talla} · ${precio} MXN. Apártala en {link} o mándanos DM',
    respuestaVendida: '¡Hola @{usuario}! Esta ya se vendió 😔 pero hay más prendas en {sitio} 🛍️',
    historiaNuevas: false, historiaNuevasMax: 5,
    apartadoHoras: 48,
  },
  respuestasRapidas: [
    '¡Hola! Sigue disponible 🙌 Te mando info por DM',
    'Precio y medidas en stiimpys.store 🛒 (link en bio)',
    'Hacemos envíos a todo México 📦',
    'Ya se vendió 😔 pero tenemos más prendas en stiimpys.store',
  ],
};

export function configInstagram(bazar) {
  const c = bazar?.instagramConfig || {};
  const out = { ...CONFIG_DEFAULT };
  if (typeof c.hashtags === 'string') out.hashtags = c.hashtags.slice(0, 600);
  if (typeof c.firma === 'string')    out.firma    = c.firma.slice(0, 300);
  for (const k of ['autoPublicar', 'autoComentario', 'autoHistoria', 'autoPortada', 'plantilla', 'hashtagsInteligentes', 'mejorarFotos']) {
    if (typeof c[k] === 'boolean') out[k] = c[k];
  }
  const est = { claro: 'crema', oscuro: 'noir', color: 'portada' }[c.estiloHistoria] || c.estiloHistoria;
  if (['crema', 'noir', 'portada'].includes(est)) out.estiloHistoria = est;
  if (['crema', 'blanco', 'noir'].includes(c.tonoPlantilla)) out.tonoPlantilla = c.tonoPlantilla;
  if (typeof c.colorPlantilla === 'string' && /^[0-9a-f]{6}$/i.test(c.colorPlantilla)) out.colorPlantilla = c.colorPlantilla.toLowerCase();
  out.automatico = normalizarAutomatico(c.automatico);
  if (Array.isArray(c.respuestasRapidas)) {
    out.respuestasRapidas = c.respuestasRapidas.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim().slice(0, 300)).slice(0, 12);
  }
  return out;
}

// ── Credenciales ─────────────────────────────────────────────
function clave(slug) {
  return String(slug || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

export function credencialesInstagram(bazar) {
  const k = clave(bazar?.slug);
  const userId = k && process.env[`IG_${k}_USER_ID`];
  const token  = k && process.env[`IG_${k}_TOKEN`];
  if (!userId || !token) return null;
  const modo = String(process.env[`IG_${k}_MODO`] || 'instagram').toLowerCase() === 'facebook' ? 'facebook' : 'instagram';
  const host = modo === 'facebook' ? 'graph.facebook.com' : 'graph.instagram.com';
  return { userId, token, modo, api: `https://${host}/${VERSION}`, puedeBorrar: modo === 'facebook' };
}

function exigir(bazar) {
  const cred = credencialesInstagram(bazar);
  if (!cred) throw new Error(`Instagram no está conectado para ${bazar?.nombre || 'este bazar'}.`);
  return cred;
}

// ── HTTP con la Graph API ────────────────────────────────────
function mensajeError(data, status) {
  const e = data?.error || {};
  if (e.code === 190) return 'El token de Instagram venció o es inválido. Hay que renovarlo en Vercel.';
  if (e.code === 4 || e.code === 9 || e.code === 32 || e.code === 613) return 'Instagram limitó las acciones por ahora. Intenta más tarde.';
  if (e.code === 10 || e.code === 200) return `Falta un permiso en la app de Meta: ${e.message || ''}`.trim();
  return `Instagram: ${e.error_user_msg || e.message || `error ${status || ''}`}`.trim();
}

async function llamar(cred, metodo, ruta, params = {}) {
  const url = new URL(`${cred.api}/${ruta}`);
  const opts = { method: metodo };
  if (metodo === 'GET' || metodo === 'DELETE') {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('access_token', cred.token);
  } else {
    opts.body = new URLSearchParams({ ...params, access_token: cred.token });
  }
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    const err = new Error(mensajeError(data, r.status));
    err.codigo = data?.error?.code;
    throw err;
  }
  return data;
}
const igGet    = (c, ruta, p) => llamar(c, 'GET', ruta, p);
const igPost   = (c, ruta, p) => llamar(c, 'POST', ruta, p);
const igDelete = (c, ruta, p) => llamar(c, 'DELETE', ruta, p);

// Instagram descarga y procesa cada foto antes de dejar publicarla.
async function esperarListo(cred, id) {
  for (let i = 0; i < 25; i++) {
    const { status_code } = await igGet(cred, id, { fields: 'status_code' }).catch(() => ({}));
    if (status_code === 'FINISHED' || status_code === 'PUBLISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') {
      throw new Error('Instagram no pudo procesar una de las fotos.');
    }
    await new Promise(res => setTimeout(res, 1500));
  }
  throw new Error('Instagram tardó demasiado en procesar las fotos. Intenta de nuevo.');
}

// ── Imágenes (Cloudinary las ajusta al vuelo) ────────────────
const esCloudinary = u => typeof u === 'string' && u.includes('res.cloudinary.com') && u.includes('/upload/');

// Feed: JPEG 4:5 con relleno blanco (la prenda sale completa, sin recorte).
// Post: 1080×1350 (4:5) con la foto COMPLETA al centro. Los lados que
// sobran se rellenan con la misma foto difuminada (nada de franjas blancas).
export function fotoParaInstagram(url, mejorar = false) {
  if (!esCloudinary(url)) return url;
  const pid = idCloudinary(url);
  if (!pid) return url.replace('/upload/', '/upload/c_pad,ar_4:5,b_auto:predominant,w_1080,f_jpg,q_90/');
  const base = url.split('/upload/')[0] + '/upload/';
  return `${base}c_fill,w_1080,h_1350,g_auto/e_blur:1800/e_brightness:-12/l_${pid.replace(/\//g, ':')}/c_fit,w_1080,h_1350${mejorar ? '/e_improve:indoor:50/e_sharpen:60' : ''}/fl_layer_apply,g_center/f_jpg,q_90/${pid}.jpg`;
}
// Diseño que ya trae su medida (Estudio de posts): solo se asegura JPEG.
export function fotoTalCual(url) {
  if (!esCloudinary(url)) return url;
  return url.replace('/upload/', '/upload/f_jpg,q_92/');
}
// Historia: JPEG 1080×1920 llenando la pantalla.
export function fotoParaHistoria(url) {
  if (!esCloudinary(url)) return url;
  return url.replace('/upload/', '/upload/c_fill,w_1080,h_1920,g_auto,f_jpg,q_90/');
}

// Texto para capas de Cloudinary: comas y diagonales van doble-escapadas
// y se quitan emojis (las fuentes no los tienen).
function textoCapa(s, max = 60) {
  const limpio = String(s || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ').trim().slice(0, max);
  return encodeURIComponent(limpio)
    .replace(/%2C/g, '%252C').replace(/%2F/g, '%252F')
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function idCloudinary(url) {
  const m = String(url).match(/\/upload\/(?:[^/]*[_,:][^/]*\/)*(?:v\d+\/)?(.+?)\.[a-z0-9]+$/i);
  return m ? m[1] : null;
}

// ═════════════════════════════════════════════════════════════
//  DISEÑO EDITORIAL (historias y portadas)
//  Minimalista, tipo revista de moda: la foto se integra al diseño
//  (se funde con el fondo en lugar de verse "pegada"), tipografía serif
//  Playfair Display para lo importante y Montserrat espaciada para lo
//  secundario. Sin stickers ni cajas de color.
// ═════════════════════════════════════════════════════════════
const SERIF = 'Playfair%20Display';
const TONOS = {
  crema:  { fondo: 'f3efe7', tinta: '111111', suave: '8a8178' },
  blanco: { fondo: 'ffffff', tinta: '111111', suave: '8a8178' },
  noir:   { fondo: '0e0e0f', tinta: 'f5f2ec', suave: '9b948a' },
};
const ALERTA = 'b3261e';                     // rojo sobrio para "Vendido"

// Estilos de historia:
//   crema   → foto arriba que se funde con fondo crema, textos negros
//   noir    → igual sobre negro
//   portada → foto a pantalla completa, textos blancos sobre degradado
export const ESTILOS_HISTORIA = ['crema', 'noir', 'portada'];
const ESTILO_VIEJO = { claro: 'crema', oscuro: 'noir', color: 'portada' };
export function estiloValido(e) { e = ESTILO_VIEJO[e] || e; return ESTILOS_HISTORIA.includes(e) ? e : null; }

function regla(color, ancho = 90) {          // línea fina de 2 px
  return `l_text:Arial_4:%20,b_rgb:${color}/c_pad,w_${ancho},h_2,b_rgb:${color}`;
}
function tallaCorta(t) { return t ? String(t).split('·')[0].trim() : ''; }
function detallesPrenda(p) {
  return [tallaCorta(p.talla) && `Talla ${tallaCorta(p.talla)}`, p.estado && `Estado ${p.estado}`].filter(Boolean).join('   —   ');
}
function precioTexto(p, conMoneda = true) {
  return '$' + Number(p.precio_venta || 0).toLocaleString('es-MX') + (conMoneda ? ' MXN' : '');
}

// Historia 1080×1920 con diseño editorial.
//   opciones: { estilo, etiqueta, titulo, linea, cierre, pie, gris }
function historiaEditorial(urlFoto, bazar, o) {
  const pid = idCloudinary(urlFoto);
  if (!esCloudinary(urlFoto) || !pid) return null;
  const estilo = estiloValido(o.estilo) || 'crema';
  const base = urlFoto.split('/upload/')[0] + '/upload/';
  const capa = pid.replace(/\//g, ':');
  const marca = String(bazar?.instagram || bazar?.nombre || '').replace(/^@/, '').toUpperCase();
  const portada = estilo === 'portada';
  const T = portada ? { tinta: 'ffffff', suave: 'ffffffb3' } : TONOS[estilo === 'noir' ? 'noir' : 'crema'];
  const gris = o.gris ? '/e_grayscale' : '';

  // El título puede ocupar 1 o 2 líneas; la etiqueta se acomoda arriba de él.
  const titulo = String(o.titulo || '').slice(0, 40);
  const lineas = titulo.length > 18 ? 2 : 1;
  const yTitulo = 380, yEtiqueta = yTitulo + lineas * 96 + 40;

  const p = [];
  if (portada) {
    p.push(`c_fill,w_1080,h_1920,g_auto${gris}`,
      // degradado oscuro abajo (para leer) y uno sutil arriba (para la marca)
      `l_${capa}/c_fill,w_1080,h_1050/e_colorize:100,co_rgb:0b0b0c/e_gradient_fade,y_0.85/fl_layer_apply,g_south`,
      `l_${capa}/c_fill,w_1080,h_360/e_colorize:100,co_rgb:0b0b0c/o_55/e_gradient_fade,y_-0.95/fl_layer_apply,g_north`);
  } else {
    p.push(`c_fill,w_1080,h_1920,g_auto/e_colorize:100,co_rgb:${T.fondo}`,
      `l_${capa}/c_fill,w_1080,h_1440,g_auto${gris}/e_gradient_fade,y_-0.3/fl_layer_apply,g_north`);
  }
  if (portada && marca) p.push(`l_text:Montserrat_26_semibold_letter_spacing_16:${textoCapa(marca)},co_rgb:ffffff/fl_layer_apply,g_north,y_110`);
  if (o.etiqueta) p.push(`l_text:Montserrat_22_semibold_letter_spacing_12:${textoCapa(o.etiqueta.toUpperCase())},co_rgb:${o.etiquetaColor || T.suave}/fl_layer_apply,g_south,y_${yEtiqueta}`);
  p.push(`l_text:${SERIF}_${portada ? 84 : 78}_text_align_center:${textoCapa(titulo, 40)},co_rgb:${T.tinta},w_820,c_fit/fl_layer_apply,g_south,y_${yTitulo}`);
  if (o.linea) p.push(`l_text:Montserrat_26_letter_spacing_4:${textoCapa(o.linea, 60)},co_rgb:${T.suave}/fl_layer_apply,g_south,y_310`);
  if (o.cierre) p.push(`l_text:${SERIF}_60_italic:${textoCapa(o.cierre, 30)},co_rgb:${T.tinta}/fl_layer_apply,g_south,y_205`);
  p.push(`${regla(T.tinta)}/fl_layer_apply,g_south,y_165`);
  p.push(`l_text:Montserrat_20_semibold_letter_spacing_10:${textoCapa((o.pie || `${DOMINIO}  ·  link en bio`).toUpperCase(), 60)},co_rgb:${T.suave}/fl_layer_apply,g_south,y_98`);
  p.push('f_jpg,q_90');
  return `${base}${p.join('/')}/${pid}.jpg`;
}

const fotoPrincipal = prenda => (Array.isArray(prenda.imagenes) ? prenda.imagenes : []).find(esCloudinary);

export function imagenHistoriaDisponible(prenda, bazar, estilo) {
  const url = fotoPrincipal(prenda);
  if (!url) return null;
  return historiaEditorial(url, bazar, {
    estilo: estilo || configInstagram(bazar).estiloHistoria,
    etiqueta: 'Nuevo ingreso',
    titulo: prenda.nombre,
    linea: detallesPrenda(prenda),
    cierre: precioTexto(prenda),
  });
}

export function imagenHistoriaVendido(prenda, bazar, estilo) {
  const url = fotoPrincipal(prenda);
  if (!url) return null;
  return historiaEditorial(url, bazar, {
    estilo: estilo || configInstagram(bazar).estiloHistoria,
    gris: true,
    etiqueta: 'Vendido', etiquetaColor: ALERTA,
    titulo: prenda.nombre,
    linea: 'Gracias por tu compra',
    cierre: 'Hay más piezas esperándote',
    pie: `${DOMINIO}  ·  link en bio`,
  });
}

// ── Textos ───────────────────────────────────────────────────
export function textoPublicacion(prenda, bazar) {
  const cfg    = configInstagram(bazar);
  const precio = Number(prenda.precio_venta);
  const antes  = Number(prenda.precioAnterior);
  const lineas = [
    prenda.nombre,
    '',
    prenda.marca       ? `🏷️ Marca: ${prenda.marca}` : null,
    prenda.talla       ? `📏 Talla: ${prenda.talla}` : null,
    prenda.estado      ? `✨ Estado: ${prenda.estado}` : null,
    antes > precio     ? `💸 Precio: $${precio.toLocaleString('es-MX')} MXN (antes $${antes.toLocaleString('es-MX')})`
                       : `💸 Precio: $${precio.toLocaleString('es-MX')} MXN`,
    prenda.descripcion ? `\n${prenda.descripcion}` : null,
    '',
    cfg.firma || null,
    `🛒 Apártala en ${DOMINIO}/prenda.html?id=${prenda.id} (link en bio)`,
    bazar?.whatsapp ? `💬 WhatsApp: wa.me/${bazar.whatsapp}` : null,
    '',
    hashtagsPrenda(prenda, cfg, bazar) || null,
  ];
  return lineas.filter(l => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2200);
}

export function textoComentarioVendido() {
  return `❌ VENDIDA ❌\nGracias por tu compra 🙌\nHay más prendas en ${DOMINIO} 🛍️`;
}

// ── Publicar ─────────────────────────────────────────────────
// Publica 1 foto o un carrusel (2-10) en el feed. Devuelve { id, permalink }.
export async function publicarImagenes(bazar, urls, caption) {
  const cred  = exigir(bazar);
  const fotos = (urls || []).filter(u => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, MAX_FOTOS);
  if (!fotos.length) throw new Error('No hay fotos para publicar.');
  caption = String(caption || '').slice(0, 2200);

  let contenedor;
  if (fotos.length === 1) {
    contenedor = (await igPost(cred, `${cred.userId}/media`, { image_url: fotos[0], caption })).id;
  } else {
    const hijos = [];
    for (const image_url of fotos) {
      hijos.push((await igPost(cred, `${cred.userId}/media`, { image_url, is_carousel_item: 'true' })).id);
    }
    await Promise.all(hijos.map(id => esperarListo(cred, id)));
    contenedor = (await igPost(cred, `${cred.userId}/media`, { media_type: 'CAROUSEL', children: hijos.join(','), caption })).id;
  }
  await esperarListo(cred, contenedor);
  const { id } = await igPost(cred, `${cred.userId}/media_publish`, { creation_id: contenedor });
  const permalink = await igGet(cred, id, { fields: 'permalink' }).then(r => r.permalink || '').catch(() => '');
  return { id, permalink };
}

export async function publicarHistoria(bazar, image_url) {
  const cred = exigir(bazar);
  if (!image_url) throw new Error('No hay imagen para la historia.');
  const { id: contenedor } = await igPost(cred, `${cred.userId}/media`, { image_url, media_type: 'STORIES' });
  await esperarListo(cred, contenedor);
  const { id } = await igPost(cred, `${cred.userId}/media_publish`, { creation_id: contenedor });
  return id;
}

export async function publicarPrendaEnInstagram(prenda, bazar) {
  const originales = (Array.isArray(prenda.imagenes) ? prenda.imagenes : [])
    .filter(u => typeof u === 'string' && /^https:\/\//.test(u)).slice(0, MAX_FOTOS);
  const cfg = configInstagram(bazar);
  const fotos = originales.map(u => fotoParaInstagram(u, cfg.mejorarFotos));
  if (!fotos.length) throw new Error('La prenda no tiene fotos publicables.');
  if (cfg.plantilla && esCloudinary(originales[0])) {
    fotos[0] = imagenPlantilla(originales[0], bazar, prenda);
  }
  return publicarImagenes(bazar, fotos, textoPublicacion(prenda, bazar));
}

export async function comentarVendido(prenda, bazar) {
  const cred = exigir(bazar);
  if (!prenda.instagramId) throw new Error('La prenda no tiene publicación en Instagram.');
  if (await postVivo(bazar, prenda.instagramId) === false) {
    const e = new Error('El post ya no existe en Instagram (lo borraron), así que no se pudo comentar. Se desligó de la prenda.');
    e.postMuerto = true; throw e;
  }
  return (await igPost(cred, `${prenda.instagramId}/comments`, { message: textoComentarioVendido() })).id;
}

export async function historiaVendido(prenda, bazar) {
  const img = imagenHistoriaVendido(prenda, bazar);
  if (!img) throw new Error('La prenda no tiene una foto en Cloudinary para la historia.');
  return publicarHistoria(bazar, img);
}

export async function historiaDisponible(prenda, bazar, estilo) {
  const img = imagenHistoriaDisponible(prenda, bazar, estilo);
  if (!img) throw new Error('La prenda no tiene una foto en Cloudinary para la historia.');
  return publicarHistoria(bazar, img);
}

// ── Administrar la cuenta ────────────────────────────────────
export async function perfil(bazar) {
  const cred = exigir(bazar);
  const p = await igGet(cred, cred.userId, {
    fields: 'username,name,profile_picture_url,followers_count,follows_count,media_count,biography,website',
  });
  return { ...p, modo: cred.modo, puedeBorrar: cred.puedeBorrar };
}

const CAMPOS_MEDIA = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';

export async function listarPublicaciones(bazar, after) {
  const cred = exigir(bazar);
  const params = { fields: `${CAMPOS_MEDIA},is_comment_enabled`, limit: '24' };
  if (after) params.after = after;
  let r;
  try {
    r = await igGet(cred, `${cred.userId}/media`, params);
  } catch (e) {
    // Si esta versión de la API no conoce el campo de comentarios, se pide sin él.
    if (e.codigo !== 100) throw e;
    r = await igGet(cred, `${cred.userId}/media`, { ...params, fields: CAMPOS_MEDIA });
  }
  return { posts: r.data || [], siguiente: r.paging?.next ? (r.paging?.cursors?.after || null) : null };
}

export async function comentarios(bazar, mediaId) {
  const cred = exigir(bazar);
  const r = await igGet(cred, `${mediaId}/comments`, {
    fields: 'id,text,username,timestamp,like_count,hidden,replies{id,text,username,timestamp}',
    limit: '50',
  });
  return r.data || [];
}

export async function responderComentario(bazar, comentarioId, mensaje) {
  const cred = exigir(bazar);
  const texto = String(mensaje || '').trim().slice(0, 2200);
  if (!texto) throw new Error('Escribe la respuesta.');
  return (await igPost(cred, `${comentarioId}/replies`, { message: texto })).id;
}

export async function ocultarComentario(bazar, comentarioId, ocultar) {
  await igPost(exigir(bazar), comentarioId, { hide: ocultar ? 'true' : 'false' });
}

export async function borrarComentario(bazar, comentarioId) {
  await igDelete(exigir(bazar), comentarioId);
}

export async function activarComentarios(bazar, mediaId, activar) {
  await igPost(exigir(bazar), mediaId, { comment_enabled: activar ? 'true' : 'false' });
}

function exigirBorrado(cred) {
  if (!cred.puedeBorrar) {
    throw new Error('Para borrar o editar posts, Instagram exige conectar la cuenta con el inicio de sesión de Facebook (IG_..._MODO=facebook).');
  }
}

const SIN_PERMISO_BORRAR = 'Falta el permiso instagram_manage_contents en el token de Instagram (IG_STIIMPYS_TOKEN en Vercel): no se pueden borrar ni republicar posts. Se detiene.';

export async function borrarPublicacion(bazar, mediaId) {
  const cred = exigir(bazar);
  exigirBorrado(cred);
  if (await puedeBorrarPosts(bazar) === false) throw new Error(SIN_PERMISO_BORRAR);
  await igDelete(cred, mediaId);
}

// Instagram no deja cambiar el texto de un post. "Editar" = publicar de
// nuevo las mismas fotos con el texto nuevo y borrar el original.
// Se pierden los likes y comentarios del post original.
export async function republicar(bazar, mediaId, captionNuevo) {
  const cred = exigir(bazar);
  exigirBorrado(cred);
  const m = await igGet(cred, mediaId, { fields: 'id,media_type,media_url,children{media_type,media_url}' });
  const piezas = m.media_type === 'CAROUSEL_ALBUM' ? (m.children?.data || []) : [m];
  if (!piezas.length || piezas.some(p => p.media_type !== 'IMAGE')) {
    throw new Error('Solo se pueden editar publicaciones de fotos (no videos ni reels).');
  }
  const urls  = piezas.map(p => p.media_url).filter(Boolean);
  const nuevo = await publicarImagenes(bazar, urls, captionNuevo);
  try { await igDelete(cred, mediaId); }
  catch (e) { nuevo.avisoBorrado = `Se publicó la versión nueva, pero no se pudo borrar la anterior: ${e.message}`; }
  return nuevo;
}


// ═════════════════════════════════════════════════════════════
//  PLANTILLA DE MARCA (portada 4:5 de cada post)
//  La foto ocupa casi todo y se funde con una franja tipográfica limpia:
//  nombre en serif a la izquierda, talla/estado debajo y el precio en
//  serif cursiva a la derecha. Vendido: foto en gris, sello blanco
//  "VENDIDO" al centro y la palabra "Vendido" en lugar del precio.
// ═════════════════════════════════════════════════════════════
export function imagenPlantilla(url, bazar, prenda = {}, { vendido = false } = {}) {
  if (!esCloudinary(url)) return url;
  const pid = idCloudinary(url);
  if (!pid) return url;
  const cfg  = configInstagram(bazar);
  const T    = TONOS[cfg.tonoPlantilla] || TONOS.crema;
  const base = url.split('/upload/')[0] + '/upload/';
  const capa = pid.replace(/\//g, ':');
  let nombre = String(prenda.nombre || '').trim();
  if (nombre.length > 26) nombre = nombre.slice(0, 25).trim() + '…';
  const det = [tallaCorta(prenda.talla) && `TALLA ${tallaCorta(prenda.talla).toUpperCase()}`, prenda.estado && String(prenda.estado).toUpperCase()].filter(Boolean).join('  ·  ');

  const p = [
    `c_fill,w_1080,h_1350,g_auto/e_colorize:100,co_rgb:${T.fondo}`,
    // Fondo: la misma foto difuminada, que se funde con la franja de abajo
    `l_${capa}/c_fill,w_1080,h_1150,g_auto/e_blur:1800/e_brightness:-12${vendido ? '/e_grayscale' : ''}/e_gradient_fade,y_-0.35/fl_layer_apply,g_north`,
    // Encima: la foto completa, sin recortar la prenda
    `l_${capa}/c_fit,w_1000,h_1100${configInstagram(bazar).mejorarFotos && !vendido ? '/e_improve:indoor:50/e_sharpen:60' : ''}${vendido ? '/e_grayscale/e_brightness:-5' : ''}/r_10/fl_layer_apply,g_north,y_24`,
  ];
  if (vendido) p.push(`l_text:Montserrat_30_semibold_letter_spacing_16:VENDIDO,co_rgb:111111,b_white/bo_30px_solid_white/fl_layer_apply,g_center,y_-90`);
  if (nombre) p.push(`l_text:${SERIF}_52:${textoCapa(nombre, 30)},co_rgb:${T.tinta}/fl_layer_apply,g_south_west,x_64,y_118`);
  if (det)    p.push(`l_text:Montserrat_23_semibold_letter_spacing_6:${textoCapa(det, 40)},co_rgb:${T.suave}/fl_layer_apply,g_south_west,x_67,y_70`);
  if (vendido) p.push(`l_text:Montserrat_24_semibold_letter_spacing_8:VENDIDO,co_rgb:${ALERTA}/fl_layer_apply,g_south_east,x_64,y_104`);
  else if (prenda.precio_venta != null) p.push(`l_text:${SERIF}_68_italic:${textoCapa(precioTexto(prenda, false))},co_rgb:${T.tinta}/fl_layer_apply,g_south_east,x_64,y_80`);
  p.push('f_jpg,q_90');
  return `${base}${p.join('/')}/${pid}.jpg`;
}

// Sube a Cloudinary una imagen por URL (p. ej. la de un post viejo de
// Instagram) para poder aplicarle la plantilla. Firma del lado del servidor.
export async function subirACloudinary(urlRemota, carpeta = 'bazar/instagram') {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME, key = process.env.CLOUDINARY_API_KEY, secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !key || !secret) throw new Error('Faltan las variables de Cloudinary.');
  const crypto = await import('crypto');
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('sha1').update(`folder=${carpeta}&timestamp=${timestamp}${secret}`).digest('hex');
  const body = new URLSearchParams({ file: urlRemota, api_key: key, timestamp: String(timestamp), signature, folder: carpeta });
  const r = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) throw new Error(`Cloudinary: ${d.error?.message || r.status}`);
  return d.secure_url;
}

// "Rehacer" un post: lo vuelve a publicar con la portada en la plantilla
// (disponible o vendido) y borra el original. Solo modo facebook.
// Se pierden likes y comentarios del original.
export async function rehacerPost(bazar, mediaId, { vendido = false, prenda = null, caption = null, borrar = true, plantilla = true } = {}) {
  const cred = exigir(bazar);
  if (borrar) {
    exigirBorrado(cred);
    if (await puedeBorrarPosts(bazar) === false) throw new Error(SIN_PERMISO_BORRAR);
  }
  if (vendido || prenda?.vendido) throw new Error('Las prendas vendidas no se republican: solo llevan el comentario de VENDIDA.');
  const m = await igGet(cred, mediaId, { fields: 'id,caption,media_type,media_url,children{media_type,media_url}' });
  const piezas = m.media_type === 'CAROUSEL_ALBUM' ? (m.children?.data || []) : [m];
  if (!piezas.length || piezas.some(p => p.media_type !== 'IMAGE')) {
    throw new Error('Solo se pueden rehacer publicaciones de fotos (no videos ni reels).');
  }
  // Si la prenda tiene sus fotos en Cloudinary se usan TODAS (mejor calidad y
  // con el encuadre nuevo, sin franjas blancas). Si no, las del post.
  const fotosPrenda = (prenda?.imagenes || []).filter(esCloudinary).slice(0, MAX_FOTOS);
  let urls;
  if (fotosPrenda.length) {
    urls = fotosPrenda.map(fotoParaInstagram);
    if (plantilla) urls[0] = imagenPlantilla(fotosPrenda[0], bazar, prenda, {});
  } else {
    urls = piezas.map(p => p.media_url).filter(Boolean).slice(0, MAX_FOTOS);
    // Se copian a Cloudinary antes de borrar: los links de Instagram mueren con el post
    const copias = [];
    for (const u of urls) copias.push(await subirACloudinary(u));
    urls = copias.map((u, i) => i === 0 && plantilla ? imagenPlantilla(u, bazar, prenda || {}, {}) : fotoParaInstagram(u));
  }

  const texto = caption != null ? String(caption) : (m.caption || '');
  // Orden seguro: las fotos ya están en Cloudinary (las de Instagram dejan de
  // existir al borrar). Primero se borra el post viejo y SOLO si se confirmó
  // se publica el nuevo: así nunca quedan duplicados.
  if (borrar) {
    try { await igDelete(cred, mediaId); }
    catch (e) { throw new Error(`No se pudo borrar el post anterior, así que no se publicó el nuevo (sin duplicados). Se detiene. ${e.message}`); }
  }
  try { return await publicarImagenes(bazar, urls, texto); }
  catch (e) {
    if (!borrar) throw e;
    const err = new Error(`Se borró el post anterior pero Instagram no aceptó el nuevo: ${e.message}. La prenda sigue en la página; publícala de nuevo desde su ficha. Se detiene.`);
    err.borradoSinPublicar = true; throw err;
  }
}

// ═════════════════════════════════════════════════════════════
//  ESTADÍSTICAS (permiso instagram_manage_insights)
//  Cada métrica se pide por separado: si Meta retira una, las demás
//  siguen funcionando.
// ═════════════════════════════════════════════════════════════
const METRICAS_CUENTA = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'profile_views', 'website_clicks', 'follows_and_unfollows'];

export async function estadisticasCuenta(bazar, dias = 28) {
  const cred = exigir(bazar);
  const hasta = Math.floor(Date.now() / 1000);
  const desde = hasta - Math.min(30, dias) * 86400;
  const out = { metricas: {}, seguidores: [], errores: [] };
  await Promise.all(METRICAS_CUENTA.map(async metric => {
    try {
      const r = await igGet(cred, `${cred.userId}/insights`, { metric, period: 'day', metric_type: 'total_value', since: String(desde), until: String(hasta) });
      const d = r.data?.[0];
      const tv = d?.total_value;
      out.metricas[metric] = tv?.breakdowns?.[0]?.results
        ? Object.fromEntries(tv.breakdowns[0].results.map(x => [x.dimension_values?.join('/') || 'total', x.value]))
        : (tv?.value ?? null);
    } catch (e) { out.errores.push(`${metric}: ${e.message}`); }
  }));
  try {
    const r = await igGet(cred, `${cred.userId}/insights`, { metric: 'follower_count', period: 'day', since: String(hasta - 29 * 86400), until: String(hasta) });
    out.seguidores = (r.data?.[0]?.values || []).map(v => ({ fecha: v.end_time, valor: v.value }));
  } catch (e) { out.errores.push(`follower_count: ${e.message}`); }
  return out;
}

export async function estadisticasPost(bazar, mediaId, tipo) {
  const cred = exigir(bazar);
  const lista = tipo === 'VIDEO' ? ['reach', 'views', 'saved', 'shares', 'total_interactions']
                                 : ['reach', 'views', 'saved', 'shares', 'total_interactions'];
  const out = {};
  await Promise.all(lista.map(async metric => {
    try {
      const r = await igGet(cred, `${mediaId}/insights`, { metric });
      out[metric] = r.data?.[0]?.values?.[0]?.value ?? r.data?.[0]?.total_value?.value ?? null;
    } catch { out[metric] = null; }
  }));
  return out;
}

// ═════════════════════════════════════════════════════════════
//  BANDEJA DE COMENTARIOS — todos los comentarios recientes de los
//  últimos posts en un solo lugar, marcando cuáles ya respondiste.
// ═════════════════════════════════════════════════════════════
export async function bandejaComentarios(bazar, nPosts = 20) {
  const cred = exigir(bazar);
  const yo = (await igGet(cred, cred.userId, { fields: 'username' })).username;
  const posts = (await igGet(cred, `${cred.userId}/media`, {
    fields: 'id,permalink,media_type,media_url,thumbnail_url,timestamp,comments_count', limit: String(nPosts),
  })).data || [];
  const conComentarios = posts.filter(p => p.comments_count > 0);
  const out = [];
  await Promise.all(conComentarios.map(async p => {
    try {
      const r = await igGet(cred, `${p.id}/comments`, {
        fields: 'id,text,username,timestamp,hidden,replies{id,text,username,timestamp}', limit: '50',
      });
      for (const c of r.data || []) {
        if (c.username === yo) continue;
        const respuestas = c.replies?.data || [];
        out.push({
          ...c, respuestas,
          respondido: respuestas.some(x => x.username === yo),
          post: { id: p.id, permalink: p.permalink, miniatura: p.media_type === 'VIDEO' ? p.thumbnail_url : p.media_url },
        });
      }
    } catch { /* un post con error no tumba la bandeja */ }
  }));
  out.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return { yo, comentarios: out };
}

// ═════════════════════════════════════════════════════════════
//  MENSAJES DIRECTOS (modo facebook; permisos instagram_manage_messages
//  y pages_manage_metadata). Usan el token de la PÁGINA ligada.
// ═════════════════════════════════════════════════════════════
const _paginas = new Map();   // userId → { id, token } (caché por instancia)

async function paginaDe(bazar) {
  const cred = exigir(bazar);
  if (cred.modo !== 'facebook') throw new Error('Los mensajes directos requieren la conexión con inicio de sesión de Facebook (IG_..._MODO=facebook).');
  if (_paginas.has(cred.userId)) return _paginas.get(cred.userId);
  const r = await igGet(cred, 'me/accounts', { fields: 'id,access_token,instagram_business_account{id}', limit: '50' });
  const pag = (r.data || []).find(p => p.instagram_business_account?.id === cred.userId);
  if (!pag) throw new Error('No encontré la página de Facebook ligada a esta cuenta de Instagram.');
  const out = { id: pag.id, token: pag.access_token, api: cred.api };
  _paginas.set(cred.userId, out);
  return out;
}
function credPagina(pag) { return { api: pag.api, token: pag.token }; }

export async function conversaciones(bazar) {
  const pag = await paginaDe(bazar);
  const r = await igGet(credPagina(pag), `${pag.id}/conversations`, {
    platform: 'instagram', limit: '30',
    fields: 'id,updated_time,participants,messages.limit(1){message,from,created_time}',
  });
  const cred = exigir(bazar);
  return (r.data || []).map(c => {
    const otro = (c.participants?.data || []).find(p => p.id !== cred.userId) || {};
    const ultimo = c.messages?.data?.[0] || {};
    return {
      id: c.id, actualizado: c.updated_time,
      usuario: otro.username || otro.name || 'usuario', usuarioId: otro.id,
      ultimo: ultimo.message || (ultimo.id ? '📎 Adjunto' : ''), deMi: ultimo.from?.id === cred.userId,
    };
  });
}

export async function hiloConversacion(bazar, convId) {
  const pag = await paginaDe(bazar);
  const cred = exigir(bazar);
  const r = await igGet(credPagina(pag), convId, {
    fields: 'participants,messages.limit(40){id,message,from,created_time,attachments{image_data{url},file_url}}',
  });
  const otro = (r.participants?.data || []).find(p => p.id !== cred.userId) || {};
  const mensajes = (r.messages?.data || []).map(m => ({
    id: m.id, texto: m.message || '', fecha: m.created_time, deMi: m.from?.id === cred.userId,
    imagen: m.attachments?.data?.[0]?.image_data?.url || null,
  })).reverse();
  return { usuario: otro.username || otro.name || 'usuario', usuarioId: otro.id, mensajes };
}

export async function enviarMensaje(bazar, destinatarioId, texto) {
  const pag = await paginaDe(bazar);
  const msg = String(texto || '').trim().slice(0, 1000);
  if (!msg) throw new Error('Escribe el mensaje.');
  const r = await igPost(credPagina(pag), `${pag.id}/messages`, {
    recipient: JSON.stringify({ id: destinatarioId }),
    message: JSON.stringify({ text: msg }),
    messaging_type: 'RESPONSE',
  });
  return r.message_id || r.id;
}


// ═════════════════════════════════════════════════════════════
//  FOTOS DE INSTAGRAM EN EL PANEL
//  Las imágenes de Instagram (cdninstagram.com / fbcdn.net) traen la
//  cabecera Cross-Origin-Resource-Policy: same-origin, así que el navegador
//  se niega a mostrarlas dentro de otro sitio. El servidor las descarga y
//  se las entrega al panel como si fueran propias.
// ═════════════════════════════════════════════════════════════
export function esUrlDeInstagram(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i.test(u.hostname);
  } catch { return false; }
}

export async function descargarImagenInstagram(url) {
  if (!esUrlDeInstagram(url)) throw new Error('URL no permitida');
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (STMP Market panel)' } });
  if (!r.ok) throw new Error(`Instagram ${r.status}`);
  const tipo = r.headers.get('content-type') || '';
  if (!/^image\//i.test(tipo)) throw new Error('No es una imagen');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 4 * 1024 * 1024) throw new Error('Imagen demasiado grande');
  return { tipo, buf };
}

// ═════════════════════════════════════════════════════════════
//  IMPORTAR PRENDAS DESDE POSTS VIEJOS
//  Lee el texto de cada post y adivina nombre, marca, talla, estado,
//  precio y si ya se vendió. La persona revisa y corrige antes de importar.
// ═════════════════════════════════════════════════════════════
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu;
const limpiarLinea = t => String(t || '').replace(EMOJI, '').replace(/\s+/g, ' ').trim();
const RUIDO = /(env[ií]os?|ap[aá]rtal|whats ?app|wa\.me|link en (la )?bio|stiimpys\.store|https?:\/\/|ent?rega en persona|dm|mensaje directo|inbox)/i;

export function leerCaption(caption = '') {
  const texto = String(caption || '');
  const lineas = texto.split(/\r?\n/).map(limpiarLinea).filter(Boolean);
  const vendido = /vendid[oa]|sold/i.test(lineas.slice(0, 3).join(' ')) || /^❌/.test(texto.trim());
  const buscar = re => { const m = texto.match(re); return m ? limpiarLinea(m[1]) : ''; };

  const marca  = buscar(/marca\s*[:\-]\s*([^\n]+)/i);
  const talla  = buscar(/talla\s*[:\-]?\s*([^\n]+)/i).split(/\s+(?=(?:\d{1,2}\s*\/\s*10|\$|env[ií]o|estado|precio)\b|\$)/i)[0].trim();
  let estado   = buscar(/estado\s*[:\-]?\s*([^\n]+)/i);
  if (!estado) { const m = texto.match(/\b(10|[1-9])\s*\/\s*10\b/); if (m) estado = `${m[1]}/10`; }
  const m10 = estado.match(/\b(10|[1-9])\s*\/\s*10\b/); if (m10) estado = `${m10[1]}/10`;
  let precioTxt = buscar(/precio\s*[:\-]?\s*\$?\s*([\d.,]+)/i) || buscar(/\$\s*([\d][\d.,]*)/);
  const precio = precioTxt ? Number(precioTxt.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')) || null : null;

  const usadas = /^(marca|talla|estado|precio)\b/i;
  const sinVendido = lineas.filter(l => !/^vendid[oa]\b|^sold\b/i.test(l));
  let nombre = (sinVendido.find(l => !l.startsWith('#') && !usadas.test(l)) || '').replace(/\s*#\S+/g, '')
    .split(/\s+(?=\$\s*\d|talla\b|\d{1,2}\s*\/\s*10\b)/i)[0].trim();
  if (nombre.length > 80) nombre = nombre.slice(0, 77).trim() + '…';
  const descripcion = sinVendido
    .filter(l => l !== nombre && !l.startsWith(nombre + ' ') && !l.startsWith('#') && !usadas.test(l) && !RUIDO.test(l) && !/^\$?\s*[\d.,]+(\s*(mxn|pesos))?$/i.test(l))
    .join('\n').replace(/\s*#\S+/g, '').trim().slice(0, 600);
  return { nombre, marca, talla, estado, precio, vendido, descripcion: limpiarDescripcion(descripcion) };
}

// Categoría probable a partir del nombre (solo entre las que existen)
export function adivinarCategoria(nombre, categorias = []) {
  const n = String(nombre || '').toLowerCase();
  const reglas = [
    [/playera|tee\b|t-shirt|camiseta|jersey|polo/, /playera/],
    [/pantal[oó]n|jeans?|cargo|baggy/, /pantal/],
    [/sudadera|hoodie|su[eé]ter|sweater|crewneck/, /su[eé]ter|sudadera/],
    [/chamarra|jacket|chaqueta|rompevientos|chaleco/, /chamarra/],
    [/\bshorts?\b/, /short/],
    [/lentes|gafas|sunglasses/, /lentes/],
    [/bolsa|mochila|bag\b|cangurera/, /bolsa/],
    [/gorra|cap\b|beanie/, /gorra/],
    [/tenis|sneaker|zapato/, /tenis|calzado/],
  ];
  for (const [clave, cat] of reglas) {
    if (clave.test(n)) { const c = categorias.find(x => cat.test(String(x).toLowerCase())); if (c) return c; }
  }
  return null;
}

// Fotos de un post (portada de videos incluida) para subirlas a Cloudinary
export async function fotosDePost(bazar, mediaId) {
  const cred = exigir(bazar);
  const m = await igGet(cred, mediaId, { fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}' });
  const piezas = m.media_type === 'CAROUSEL_ALBUM' ? (m.children?.data || []) : [m];
  const urls = piezas.map(p => p.media_type === 'VIDEO' ? p.thumbnail_url : p.media_url).filter(Boolean).slice(0, MAX_FOTOS);
  return { ...m, urls };
}

export async function todasLasPublicaciones(bazar, max = 300) {
  const cred = exigir(bazar);
  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type}';
  const out = []; let after = '';
  while (out.length < max) {
    const r = await igGet(cred, `${cred.userId}/media`, { fields, limit: '50', ...(after ? { after } : {}) });
    out.push(...(r.data || []));
    after = r.paging?.next ? r.paging?.cursors?.after : '';
    if (!after) break;
  }
  return out.slice(0, max);
}

// Cuántos posts deja publicar Instagram en las últimas 24 h y cuántos van
export async function cuotaPublicacion(bazar) {
  const cred = exigir(bazar);
  const r = await igGet(cred, `${cred.userId}/content_publishing_limit`, { fields: 'quota_usage,config' });
  const d = r.data?.[0] || {};
  const limite = Number(d.config?.quota_total) || 100;
  const usados = Number(d.quota_usage) || 0;
  return { usados, limite, restantes: Math.max(0, limite - usados) };
}

// ── Hashtags por prenda ──────────────────────────────────────
// Además de los generales del bazar, cada post lleva hashtags de SU prenda
// (marca, tipo de prenda, talla, género, estilo y ciudad): así lo encuentra
// gente que busca exactamente eso. Primero los personalizados de la prenda,
// luego los automáticos y al final los generales. Máximo 30 (límite de IG).
function hashLimpio(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]/g, '');
}
const HASH_CATEGORIA = [
  [/playera|tee|camiseta|jersey|polo/, ['playeras', 'playeravintage', 'vintagetee']],
  [/pantal|jean|cargo/, ['pantalones', 'jeansvintage', 'baggyjeans']],
  [/su[eé]ter|sudadera|hoodie|crewneck/, ['sudaderas', 'hoodievintage', 'sudaderavintage']],
  [/chamarra|jacket|chaqueta|rompevientos/, ['chamarras', 'chamarravintage', 'vintagejacket']],
  [/short/, ['shorts', 'shortsvintage']],
  [/lentes|gafas/, ['lentes', 'lentesdesol']],
  [/bolsa|mochila|bag/, ['bolsas', 'bolsavintage']],
  [/gorra|cap|beanie/, ['gorras', 'gorravintage']],
  [/tenis|sneaker|zapato/, ['tenis', 'sneakers']],
];
const HASH_ESTILO = [
  [/y2k/, 'y2k'], [/90s|noventa/, '90s'], [/80s/, '80s'], [/oversize/, 'oversize'], [/baggy/, 'baggy'],
  [/tour|band|concierto|rap|hip ?hop/, 'bandtee'], [/anime/, 'anime'], [/futbol|soccer|jersey/, 'jerseyfutbol'],
  [/skate/, 'skatewear'], [/gorpcore|outdoor|north face/, 'gorpcore'], [/workwear|carhartt|dickies/, 'workwear'],
];
export function hashtagsPrenda(prenda = {}, cfg = {}, bazar = {}) {
  const lista = [];
  const add = t => { const h = hashLimpio(t); if (h && h.length > 1 && h.length <= 40) lista.push(h); };
  String(prenda.hashtags || '').split(/[\s,]+/).forEach(add);           // personalizados
  if (cfg.hashtagsInteligentes !== false) {
    const marca = hashLimpio(prenda.marca);
    if (marca && !/^(sinmarca|generica|na)$/.test(marca)) { add(marca); add(marca + 'vintage'); add(marca + 'mexico'); }
    const tipo = [prenda.nombre, ...(Array.isArray(prenda.categorias) ? prenda.categorias : [])].join(' ').toLowerCase();
    for (const [re, tags] of HASH_CATEGORIA) if (re.test(tipo)) { tags.forEach(add); break; }
    for (const [re, tag] of HASH_ESTILO) if (re.test(`${tipo} ${String(prenda.descripcion || '').toLowerCase()} ${String(prenda.talla || '').toLowerCase()}`)) add(tag);
    const talla = String(prenda.talla || '').split('·')[0].trim();
    const base = talla.split(/\s+/)[0];
    if (base) add('talla' + base);
    if (/hombre/i.test(talla)) { add('ropahombre'); add('streetwearhombre'); }
    if (/mujer/i.test(talla))  { add('ropamujer'); add('modamujer'); }
    const ciudad = hashLimpio(bazar?.ubicacion);
    if (ciudad) { add(ciudad); add('bazar' + ciudad); add('ropa' + ciudad); }
    ['streetwearmexico', 'vintagemexico', 'ropadesegundamano'].forEach(add);
  }
  String(cfg.hashtags || '').split(/[\s,]+/).forEach(add);              // generales
  return [...new Set(lista)].slice(0, 30).map(h => '#' + h).join(' ');
}

// Quita de una descripción lo que no es descripción: "10/10", "$VENDIDA",
// "NO DISPO", "Ofertas o trades", promos de follow, talla/precio repetidos…
const BASURA_DESC = [
  /^\$?\s*(vendid[oa]s?|no\s*dispo\w*|apartad[oa]|disponible|sold)\b/i,
  /^\(?\s*(10|[0-9])\s*(\/\s*10)?\s*\)?$/,
  /^\$/,
  /ofertas?|trades?|[uú]ltima oferta/i,
  /follow|s[ií]gueme|primera compra|regalo \$/i,
  /^(talla|estado|precio|marca|medidas?)\b/i,
];
export function limpiarDescripcion(texto = '') {
  return String(texto || '').split(/\r?\n/)
    .map(l => l.replace(EMOJI, '').trim())
    .filter(l => l && !BASURA_DESC.some(re => re.test(l)) && !RUIDO.test(l))
    .join('\n').trim().slice(0, 600);
}

// ¿El token tiene permiso para borrar posts (instagram_manage_contents)?
// Devuelve true / false, o null si Meta no deja consultarlo con este token.
export async function puedeBorrarPosts(bazar) {
  const cred = exigir(bazar);
  if (!cred.puedeBorrar) return false;
  try {
    const d = await igGet(cred, 'me/permissions', {});
    const ok = (d.data || []).filter(p => p.status === 'granted').map(p => p.permission);
    return ok.length ? ok.includes('instagram_manage_contents') : null;
  } catch { return null; }
}

// ¿El post sigue existiendo en Instagram?
// true = vivo · false = borrado · null = no se pudo saber (red, token…)
export async function postVivo(bazar, mediaId) {
  if (!mediaId) return false;
  try { return !!(await igGet(exigir(bazar), mediaId, { fields: 'id' })).id; }
  catch (e) {
    if (e.codigo === 100 || /does not exist|no existe|cannot be loaded|Unsupported get request/i.test(e.message)) return false;
    return null;
  }
}

// ═════════════════════════════════════════════════════════════
//  AUTOMÁTICO · utilidades
// ═════════════════════════════════════════════════════════════
export function normalizarAutomatico(a = {}) {
  const D = CONFIG_DEFAULT.automatico, o = { ...D };
  if (!a || typeof a !== 'object') return o;
  for (const k of ['verificarPosts', 'rebaja', 'rebajaComentar', 'rebajaHistoria', 'respuestas', 'historiaNuevas']) if (typeof a[k] === 'boolean') o[k] = a[k];
  const num = (k, min, max) => { const n = Math.round(Number(a[k])); if (Number.isFinite(n)) o[k] = Math.min(max, Math.max(min, n)); };
  num('rebajaDias', 3, 120); num('rebajaPct', 5, 50); num('rebajaMin', 0, 100000); num('rebajaVeces', 1, 5);
  num('historiaNuevasMax', 1, 10); num('apartadoHoras', 6, 240);
  for (const k of ['respuestaPalabras', 'respuestaTexto', 'respuestaVendida']) if (typeof a[k] === 'string' && a[k].trim()) o[k] = a[k].trim().slice(0, 400);
  return o;
}

// Cuándo vence el token (debug_token con el mismo token)
export async function infoToken(bazar) {
  const cred = exigir(bazar);
  try {
    const d = (await igGet(cred, 'debug_token', { input_token: cred.token })).data || {};
    const seg = Number(d.expires_at || 0);
    return { valido: d.is_valid !== false, vence: seg ? new Date(seg * 1000).toISOString() : null, permisos: d.scopes || [] };
  } catch (e) { return { valido: null, vence: null, error: e.message }; }
}

// Texto de respuesta automática con {usuario} {nombre} {talla} {precio} {link} {sitio}
export function textoRespuesta(plantilla, prenda = {}, usuario = '') {
  const datos = {
    usuario: usuario || '', nombre: prenda.nombre || 'Esta prenda', talla: tallaCorta(prenda.talla) || '—',
    precio: Number(prenda.precio_venta || 0).toLocaleString('es-MX'),
    link: `${DOMINIO}/prenda.html?id=${prenda.id}`, sitio: DOMINIO,
  };
  return String(plantilla || '').replace(/\{(usuario|nombre|talla|precio|link|sitio)\}/g, (_, k) => datos[k]).replace(/@\s/, '').slice(0, 900);
}

export function imagenHistoriaRebaja(prenda, bazar, antes) {
  const url = fotoPrincipal(prenda);
  if (!url) return null;
  return historiaEditorial(url, bazar, {
    estilo: configInstagram(bazar).estiloHistoria,
    etiqueta: 'Nuevo precio', etiquetaColor: ALERTA,
    titulo: prenda.nombre,
    linea: `Antes $${Number(antes).toLocaleString('es-MX')}  —  ${detallesPrenda(prenda)}`.slice(0, 60),
    cierre: precioTexto(prenda),
  });
}

// Portada de drop 1080×1350 (post) o historia de anuncio 1080×1920
export function imagenDrop(urlFoto, bazar, { titulo, linea, cierre, historia = false } = {}) {
  const pid = idCloudinary(urlFoto);
  if (!esCloudinary(urlFoto) || !pid) return null;
  if (historia) return historiaEditorial(urlFoto, bazar, { estilo: 'portada', etiqueta: 'Drop', titulo, linea, cierre });
  const base = urlFoto.split('/upload/')[0] + '/upload/';
  const marca = String(bazar?.instagram || bazar?.nombre || '').replace(/^@/, '').toUpperCase();
  const p = [
    'c_fill,w_1080,h_1350,g_auto/e_brightness:-38',
    `l_${pid.replace(/\//g, ':')}/c_fill,w_1080,h_700/e_colorize:100,co_rgb:0b0b0c/e_gradient_fade,y_0.8/fl_layer_apply,g_south`,
  ];
  if (marca) p.push(`l_text:Montserrat_24_semibold_letter_spacing_16:${textoCapa(marca)},co_rgb:ffffff/fl_layer_apply,g_north,y_90`);
  p.push(`l_text:Montserrat_26_semibold_letter_spacing_20:DROP,co_rgb:ffffffb3/fl_layer_apply,g_south,y_520`);
  p.push(`l_text:${SERIF}_96_text_align_center:${textoCapa(titulo, 36)},co_rgb:ffffff,w_900,c_fit/fl_layer_apply,g_south,y_300`);
  if (linea) p.push(`l_text:Montserrat_28_letter_spacing_4:${textoCapa(linea, 60)},co_rgb:ffffffcc/fl_layer_apply,g_south,y_210`);
  p.push(`${regla('ffffff')}/fl_layer_apply,g_south,y_165`);
  p.push(`l_text:Montserrat_20_semibold_letter_spacing_10:${textoCapa((cierre || `${DOMINIO}  ·  link en bio`).toUpperCase(), 60)},co_rgb:ffffffb3/fl_layer_apply,g_south,y_100`);
  p.push('f_jpg,q_90');
  return `${base}${p.join('/')}/${pid}.jpg`;
}

// ── Limpieza de nombre y talla importados ────────────────────
// "Pantalon @edhardy" → "Pantalon Ed Hardy" · "Shirt Polo @poloralphlauren" → "Shirt Polo"
export function limpiarNombre(nombre = '', marca = '') {
  let n = String(nombre || '');
  n = n.replace(/@([\w.]+)/g, (_, h) => {
    const plano = h.replace(/[._]/g, ' ').trim();
    const yaEsta = marca && n.toLowerCase().replace(/@[\w.]+/g, '').includes(String(marca).toLowerCase());
    if (yaEsta) return '';
    if (marca && plano.replace(/\s/g, '').toLowerCase().includes(String(marca).replace(/\s/g, '').toLowerCase())) return marca;
    return plano.replace(/\b\w/g, c => c.toUpperCase());
  });
  n = n.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  n = n.replace(/\b(\w+)(\s+\1\b)+/gi, '$1');          // "Carhartt Carhartt" → "Carhartt"
  return n.slice(0, 120);
}
// "L pero es mas como un M" → { talla: "L", nota: "pero es mas como un M" }
export function separarTalla(talla = '') {
  const t = String(talla || '').trim();
  const m = t.match(/^((?:\d{1,2}(?:\.\d)?(?:\s*(?:x|\/)\s*\d{1,2})?|XXS|XS|S|M|L|XL|XXL|XXXL|[2-5]XL|CH|MED|GDE|EG|US\s*\d{1,2}(?:\.5)?|MX\s*\d{1,2}(?:\.5)?|Unitalla)\b(?:\s*(?:hombre|mujer|unisex|niñ[oa]))?)[\s,.\-·:]+(.{3,})$/i);
  if (!m) return { talla: t, nota: '' };
  const nota = m[2].trim().replace(/^[(\-·,]+|[)]+$/g, '').trim();
  if (/^(hombre|mujer|unisex|niñ[oa])$/i.test(nota)) return { talla: t, nota: '' };
  return { talla: m[1].trim(), nota };
}

// Comentario nuevo en un post
export async function comentarEnPost(bazar, mediaId, texto) {
  const cred = exigir(bazar);
  return (await igPost(cred, `${mediaId}/comments`, { message: String(texto || '').slice(0, 2200) })).id;
}

// ── Sorteos: todos los comentarios de un post ────────────────
export async function todosLosComentarios(bazar, mediaId, max = 3000) {
  const cred = exigir(bazar);
  const out = []; let after = '';
  for (let i = 0; i < 80 && out.length < max; i++) {
    const p = { fields: 'id,text,username,timestamp', limit: '50' };
    if (after) p.after = after;
    const r = await igGet(cred, `${mediaId}/comments`, p);
    out.push(...(r.data || []));
    after = r.paging?.cursors?.after;
    if (!r.paging?.next || !after) break;
  }
  return out;
}

// ── Reels ────────────────────────────────────────────────────
export async function crearContenedorReel(bazar, videoUrl, caption) {
  const cred = exigir(bazar);
  const r = await igPost(cred, `${cred.userId}/media`, { media_type: 'REELS', video_url: videoUrl, caption: String(caption || '').slice(0, 2200), share_to_feed: 'true' });
  return r.id;
}
export async function estadoContenedor(bazar, id) {
  const cred = exigir(bazar);
  const r = await igGet(cred, id, { fields: 'status_code,status' });
  return { estado: r.status_code, detalle: r.status || '' };
}
export async function publicarContenedor(bazar, id) {
  const cred = exigir(bazar);
  const { id: media } = await igPost(cred, `${cred.userId}/media_publish`, { creation_id: id });
  const permalink = await igGet(cred, media, { fields: 'permalink' }).then(r => r.permalink || '').catch(() => '');
  return { id: media, permalink };
}
