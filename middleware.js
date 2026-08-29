// middleware.js
// ─────────────────────────────────────────────────────────────
// La puerta del sitio. Corre en el borde de Vercel, ANTES de servir
// cualquier archivo, así que puede negar el acceso al panel sin que el
// navegador llegue a descargar una sola línea de su HTML.
//
// Lo público: inicio, tienda, ficha de prenda, términos y cuenta. El
// panel y su formulario de acceso viven detrás de una puerta.
//
// Con RUTA_PANEL definida, /admin.html y /login.html devuelven 404 a
// todo el mundo. La única entrada es /<RUTA_PANEL>, que deja una cookie
// de paso corta y lleva al formulario. Sin esa cookie (o sin sesión ya
// abierta), el formulario tampoco existe.
//
// La dirección va escrita abajo en RUTA_POR_DEFECTO para que funcione
// sin depender de nada más. La variable de entorno RUTA_PANEL la
// sustituye si se define, que es lo recomendable si el repositorio es
// público: así la dirección no queda escrita en el código.
//
// Variables de entorno:
//   RUTA_PANEL      sustituye a la dirección de abajo.
//   SESSION_SECRET  secreto para validar la cookie firmada del login.
// ─────────────────────────────────────────────────────────────

export const config = {
  // No interceptar el API, los archivos estáticos ni las imágenes
  matcher: ['/((?!api/|css/|js/|_next/|favicon|robots.txt|sitemap).*)'],
};

// La puerta del panel. Si cambias esto, cambia también RUTA_PANEL_DEFECTO
// en api/auth.js, que es de donde sale el destino tras iniciar sesión.
const RUTA_POR_DEFECTO = 'manage-x9k2p7q-control';

const PUBLICAS = new Set([
  '/', '/index.html',
  '/inicio.html', '/tienda.html', '/prenda.html', '/terminos.html',
  '/cuenta.html',
]);

// Cookie de paso: la deja la dirección secreta y es lo único que hace
// existir /login.html. Dura poco: es un pase para entrar, no una sesión.
const PUERTA = 'puerta';
const PUERTA_MIN = 10;

function cookiePuerta() {
  return `${PUERTA}=1; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${PUERTA_MIN * 60}`;
}

// La página 404 del sitio, incrustada aquí letra por letra igual que en
// 404.html. Es lo que hace que el panel no deje rastro: pedir /admin.html
// devuelve EXACTAMENTE lo mismo que pedir /cualquier-cosa-inventada, con
// el mismo cuerpo y las mismas cabeceras. Si esta respuesta fuera distinta
// (un texto propio, otra cabecera), esa diferencia bastaría para deducir
// que ahí hay algo escondido.
// Si editas 404.html, copia el cambio aquí también.
const PAGINA_404 = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Página no encontrada</title>
<meta name="robots" content="noindex">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:2rem;
background:linear-gradient(135deg,#f7f4ef 0%,#eef2fb 50%,#e8e2d8 100%);
font-family:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;color:#1a1f2e;text-align:center}
.n{font-size:clamp(4rem,18vw,9rem);font-weight:800;line-height:.9;letter-spacing:-.04em;color:#2d6be4;opacity:.16}
h1{font-size:1.4rem;font-weight:700;letter-spacing:.02em;margin:-.4rem 0 .6rem}
p{font-size:.95rem;line-height:1.6;color:#5c5750;max-width:34ch;margin:0 auto 1.8rem}
a{display:inline-block;text-decoration:none;font-size:.75rem;font-weight:700;letter-spacing:.14em;
text-transform:uppercase;color:#fff;background:linear-gradient(135deg,#2d6be4,#4a90d9);
padding:14px 26px;border-radius:40px;box-shadow:0 6px 20px rgba(45,107,228,.26)}
.m{margin-top:2.4rem;font-size:.65rem;letter-spacing:.22em;text-transform:uppercase;color:#8a8178}
</style>
</head>
<body>
<div>
<div class="n">404</div>
<h1>Esta página no existe</h1>
<p>El enlace puede estar mal escrito o la página ya no está disponible.</p>
<a href="/inicio.html">Ir al inicio</a>
<div class="m">STMP MARKET</div>
</div>
</body>
</html>
`;

function noEncontrado() {
  return new Response(PAGINA_404, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // La misma que vercel.json aplica a cualquier .html
      'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    },
  });
}

function irA(origen, ruta, cookie) {
  const h = { Location: new URL(ruta, origen).toString(), 'Cache-Control': 'no-store' };
  if (cookie) h['Set-Cookie'] = cookie;
  return new Response(null, { status: 302, headers: h });
}

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

  const rutaPanel = (process.env.RUTA_PANEL || RUTA_POR_DEFECTO).replace(/^\/+|\/+$/g, '');
  const secreto   = process.env.SESSION_SECRET || process.env.MASTER_KEY || '';

  const esPuerta = !!rutaPanel && (ruta === `/${rutaPanel}` || ruta === `/${rutaPanel}/`);
  const esAdmin  = ruta === '/admin.html' || ruta === '/admin' || ruta.startsWith('/admin/');
  const esLogin  = ruta === '/login.html';

  // El resto del sitio pasa sin tocarse
  if (!esPuerta && !esAdmin && !esLogin) return;

  const entra = secreto
    ? await firmaValida(leerCookie(req, 'acceso'), secreto)
    : !!leerCookie(req, 'sesion');

  // ── Sin dirección secreta: como siempre ────────────────────
  // El acceso es público y el panel exige sesión. Sirve para no dejar
  // el sitio inaccesible si aún no se ha definido RUTA_PANEL.
  if (!rutaPanel) {
    if (esLogin || entra) return;
    const destino = new URL('/login.html', url.origin);
    destino.searchParams.set('destino', ruta);
    return irA(url.origin, destino.toString());
  }

  // ── Con dirección secreta ──────────────────────────────────
  // Solo quien la conozca puede llegar al formulario de acceso.
  const conPase = leerCookie(req, PUERTA) === '1';

  if (esPuerta) {
    // Con la sesión ya abierta se entra directo al panel
    if (entra) return irA(url.origin, '/admin.html');
    // Si no, se entrega el pase y se manda al formulario
    return irA(url.origin, '/login.html', cookiePuerta());
  }

  if (esAdmin) {
    if (entra) return;                                    // panel servido
    if (conPase) return irA(url.origin, '/login.html');   // pase pero sin sesión
    return noEncontrado();                                // para el mundo, no existe
  }

  // esLogin: sin pase ni sesión, tampoco existe
  if (!conPase && !entra) return noEncontrado();
  return;
}
