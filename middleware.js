// middleware.js
// ─────────────────────────────────────────────────────────────
// La puerta del sitio. Corre en el borde de Vercel, ANTES de servir
// cualquier archivo, así que puede negar el acceso al panel sin que el
// navegador llegue a descargar una sola línea de su HTML.
//
// Lo público: inicio, tienda, ficha de prenda, términos, cuenta y la
// verificación de entrada. Todo lo demás (el panel) exige sesión.
//
// Variables de entorno:
//   RUTA_PANEL      dirección secreta del panel (ej. "panel-x7k2").
//                   Si no se define, se usa /admin.html como siempre.
//   SESSION_SECRET  secreto para validar la cookie firmada del login.
// ─────────────────────────────────────────────────────────────

export const config = {
  // No interceptar el API, los archivos estáticos ni las imágenes
  matcher: ['/((?!api/|css/|js/|_next/|favicon|robots.txt|sitemap).*)'],
};

const PUBLICAS = new Set([
  '/', '/index.html',
  '/inicio.html', '/tienda.html', '/prenda.html', '/terminos.html',
  '/cuenta.html', '/login.html',
]);

// ── Verificación de la cookie firmada ────────────────────────
function base64urlABytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const relleno = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(relleno);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function firmaValida(valor, secreto) {
  if (!valor || !secreto) return false;
  const partes = valor.split('.');
  if (partes.length !== 4) return false;

  const [usuario, vence, rol, firma] = partes;
  if (!/^\d+$/.test(vence) || Number(vence) < Date.now()) return false;   // caducada

  const cuerpo = `${usuario}.${vence}.${rol}`;
  const clave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  try {
    return await crypto.subtle.verify('HMAC', clave, base64urlABytes(firma),
      new TextEncoder().encode(cuerpo));
  } catch (_) {
    return false;
  }
}

function leerCookie(req, nombre) {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + nombre + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

export default async function middleware(req) {
  const url  = new URL(req.url);
  const ruta = url.pathname;

  const rutaPanel = (process.env.RUTA_PANEL || '').replace(/^\/+|\/+$/g, '');
  const secreto   = process.env.SESSION_SECRET || process.env.MASTER_KEY || '';

  const esPanel =
    ruta === '/admin.html' ||
    ruta === '/admin' || ruta.startsWith('/admin/') ||
    (rutaPanel && (ruta === `/${rutaPanel}` || ruta === `/${rutaPanel}/`));

  if (!esPanel) {
    // Todo lo público pasa sin tocarse
    return;
  }

  // Con dirección secreta configurada, /admin.html deja de existir para el
  // mundo: quien no conozca la ruta ni siquiera sabe que hay un panel.
  if (rutaPanel && ruta !== `/${rutaPanel}` && ruta !== `/${rutaPanel}/`) {
    return new Response('No encontrado', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Con barra final las rutas relativas del panel (css/, js/) apuntarían mal
  if (rutaPanel && ruta === `/${rutaPanel}/`) {
    return Response.redirect(new URL(`/${rutaPanel}`, url.origin).toString(), 308);
  }

  // ¿Trae una sesión válida?
  const acceso  = leerCookie(req, 'acceso');
  const sesion  = leerCookie(req, 'sesion');
  const entra   = secreto ? await firmaValida(acceso, secreto) : !!sesion;

  if (!entra) {
    // Sin sesión se manda al login, sin revelar qué hay del otro lado
    const destino = new URL('/login.html', url.origin);
    destino.searchParams.set('destino', ruta);
    return Response.redirect(destino.toString(), 302);
  }

  // Sesión válida: se sirve el panel desde la dirección secreta
  if (rutaPanel) {
    return fetch(new URL('/admin.html', url.origin), {
      headers: req.headers,
    }).then(r => new Response(r.body, {
      status: r.status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    }));
  }
}
