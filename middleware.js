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
  matcher: ['/((?!api/|css/|js/|icons/|img/|_next/|favicon|manifest.webmanifest|robots.txt|sitemap).*)',
    // v40 · El código del panel tampoco se descarga sin sesión (ver CODIGO_PANEL abajo)
    '/js/panel/:path*', '/css/panel/:path*',
    '/js/dist/admin.js', '/js/dist/admin.js.map', '/css/dist/admin.css', '/css/dist/admin.css.map',
    '/js/dist/estudio.js', '/js/dist/estudio.js.map', '/css/dist/estudio.css', '/css/dist/estudio.css.map',
    '/js/dist/caja.js', '/js/dist/caja.js.map', '/css/dist/caja.css', '/css/dist/caja.css.map'],
};

// La puerta del panel. Si cambias esto, cambia también RUTA_PANEL_DEFECTO
// en api/auth.js, que es de donde sale el destino tras iniciar sesión.
const RUTA_POR_DEFECTO = 'manage-x9k2p7q-control';

const PUBLICAS = new Set([
  '/', '/index.html',
  '/inicio.html', '/tienda.html', '/prenda.html', '/terminos.html',
  '/cuenta.html',
]);

// v40 · Archivos internos y carpetas que no son del sitio público
const ARCHIVOS_PRIVADOS = /^\/(middleware\.js|leeme\.txt|package(-lock)?\.json|vercel\.json|readme\.md|[^/]*\.md|\.[^/]*|(herramientas|pruebas|docs|node_modules|\.git|\.vercel)(\/.*)?)$/i;

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
<title>Página no encontrada | Stiimpys</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#f5f2ec">
<link rel="stylesheet" href="/css/comun/fuentes.css">
<style>
/* Misma estética del inicio (v39): papel, rejilla tenue, brillo azul y Bebas */
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100dvh;display:flex;flex-direction:column;font-family:'DM Sans',system-ui,-apple-system,'Segoe UI',sans-serif;color:#15171d;
background:radial-gradient(120% 90% at 88% 0%,rgba(45,107,228,.10) 0%,transparent 55%),radial-gradient(90% 70% at 0% 100%,rgba(21,23,29,.05) 0%,transparent 60%),#f5f2ec}
body::before{content:'';position:fixed;inset:0;pointer-events:none;opacity:.5;
background-image:linear-gradient(rgba(21,23,29,.10) 1px,transparent 1px),linear-gradient(90deg,rgba(21,23,29,.10) 1px,transparent 1px);background-size:64px 64px;
-webkit-mask-image:radial-gradient(120% 80% at 70% 10%,#000 0%,transparent 70%);mask-image:radial-gradient(120% 80% at 70% 10%,#000 0%,transparent 70%)}
.cinta{background:#15171d;color:rgba(255,255,255,.72);font-size:11px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;text-align:center;padding:9px 16px}
.barra{position:relative;max-width:1280px;width:100%;margin:0 auto;padding:16px max(16px,min(40px,4vw));display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(21,23,29,.10)}
.logo{font:400 27px/1 'Bebas Neue',sans-serif;letter-spacing:.01em;color:#1a1f2e;text-decoration:none}
.logo span{color:#2d6be4}
.cta{font-size:11px;font-weight:700;letter-spacing:.01em;text-transform:uppercase;text-decoration:none;color:#fff;background:#15171d;border-radius:40px;padding:10px 16px}
main{position:relative;flex:1;display:grid;place-items:center;padding:3rem 1rem;text-align:center}
.ceja{font-size:11px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:#2d6be4;margin-bottom:.8rem}
.n{font:400 clamp(6rem,22vw,11rem)/.85 'Bebas Neue',sans-serif;color:#15171d}
.n em{font-style:normal;color:#2d6be4}
h1{font:400 clamp(1.8rem,5vw,2.6rem)/1 'Bebas Neue',sans-serif;letter-spacing:.01em;margin:.6rem 0 .7rem}
p{font-size:15px;line-height:1.6;color:#3a3d47;max-width:36ch;margin:0 auto 1.8rem}
.btns{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.btn{display:inline-block;text-decoration:none;font-size:12px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;border-radius:40px;padding:15px 28px}
.btn-1{color:#fff;background:#2d6be4}
.btn-2{color:#15171d;background:#fff;border:1px solid rgba(21,23,29,.16)}
.btn-1:hover{background:#1c48a0}.btn-2:hover{border-color:#15171d}
</style>
</head>
<body>
<div class="cinta">Stiimpys · Página oficial</div>
<div class="barra"><a class="logo" href="/inicio.html" aria-label="Stiimpys, ir al inicio"><img src="/img/logo-negro-chico.webp" alt="" width="69" height="48" style="display:block;height:48px;width:auto"></a><a class="cta" href="/tienda.html">Ver catálogo</a></div>
<main>
<div>
<div class="ceja">Página no encontrada</div>
<div class="n">4<em>0</em>4</div>
<h1>Esta página no existe</h1>
<p>El enlace puede estar mal escrito o la página ya no está disponible.</p>
<div class="btns"><a class="btn btn-1" href="/inicio.html">Ir al inicio</a><a class="btn btn-2" href="/tienda.html">Ver catálogo</a></div>
</div>
</main>
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

// Quién pide la página para previsualizarla, no para leerla. La lista son
// los que de verdad importan aquí: WhatsApp, Facebook, Twitter, Discord,
// Telegram y los buscadores.
const ROBOTS = /bot|crawl|spider|slurp|whatsapp|facebookexternalhit|facebot|twitterbot|discordbot|telegrambot|linkedinbot|pinterest|embedly|skypeuripreview|vkshare|redditbot|googlebot|bingbot|applebot|yandex|duckduckbot|baiduspider/i;

function esRobot(req) {
  return ROBOTS.test(req.headers.get('user-agent') || '');
}

export default async function middleware(req) {
  const url  = new URL(req.url);
  const ruta = url.pathname;

  const rutaPanel = (process.env.RUTA_PANEL || RUTA_POR_DEFECTO).replace(/^\/+|\/+$/g, '');
  const secreto   = process.env.SESSION_SECRET || process.env.MASTER_KEY || '';

  // Vercel sirve /login exactamente igual que /login.html, así que hay que
  // reconocer las dos formas. Comparar solo contra "/login.html" dejaba la
  // puerta abierta por detrás: el formulario del panel quedaba público y
  // Google llegó a indexarlo. Se normaliza la ruta una vez —sin barra final
  // y sin extensión— y a partir de ahí se compara con un solo nombre.
  const sinBarra  = ruta.replace(/\/+$/, '') || '/';
  const pagina    = sinBarra.replace(/\.html$/i, '');
  // En minúsculas para comparar: /LOGIN.HTML no puede ser una rendija.
  const nombre    = pagina.toLowerCase();

  // La dirección secreta sí distingue mayúsculas: es una contraseña, y
  // cuantas más formas de escribirla valgan, más fácil es acertarla.
  const esPuerta = !!rutaPanel && (pagina === `/${rutaPanel}`);
  // v40 · El Estudio de posts es una herramienta del panel: mismas reglas que el panel
  const esAdmin  = nombre === '/admin' || sinBarra.toLowerCase().startsWith('/admin/') || nombre === '/estudio' || nombre === '/caja';
  // v40 · Código del panel (archivos originales y paquetes del panel y del Estudio):
  // sin sesión responde 404, para no regalarle a nadie el mapa del panel.
  const esCodigoPanel = /^\/(js|css)\/panel\//i.test(sinBarra) || /^\/(js|css)\/dist\/(admin|estudio|caja)\./i.test(sinBarra);
  const esLogin  = nombre === '/login';

  // v40 · Archivos del proyecto que no son páginas: nunca se sirven (aunque Vercel los
  // tenga a mano). middleware.js lleva la dirección secreta por defecto del panel y
  // package.json dice qué versiones de librerías usa el sitio.
  if (ARCHIVOS_PRIVADOS.test(sinBarra)) return noEncontrado();

  // v39 · La página es solo de Stiimpys: "Los bazares" y "Vende con nosotros"
  // llevan al inicio (MULTI_BAZAR=1 en Vercel las vuelve a abrir), y la vieja
  // puerta de verificación (/index.html) también: toda pantalla pública acaba
  // en el inicio.
  // v41: las páginas de varios bazares se archivaron (docs/archivo/multi-bazar): siempre al inicio
  if (nombre === '/redes' || nombre === '/vender') return irA(url.origin, '/inicio.html');
  if (nombre === '/index') return irA(url.origin, '/inicio.html');
  // v53 · Link corto de los posts de Instagram: /p/160 → la ficha de la prenda 160
  const corto = /^\/p\/(\d{1,9})$/i.exec(sinBarra);
  if (corto) return irA(url.origin, `/prenda.html?id=${corto[1]}`);

  // Las apps de mensajería y los buscadores piden la ficha para armar el
  // preview, pero /prenda.html es una página vacía hasta que corre el JS:
  // el enlace saldría sin foto ni precio. A ellos se les manda al endpoint
  // que sí escribe las etiquetas (api/prenda.js). A las personas, no.
  if (nombre === '/prenda' && esRobot(req)) {
    const id = url.searchParams.get('id');
    if (id) {
      // Se sirve el contenido en esta misma dirección (sin redirigir): así
      // Google indexa /prenda.html?id=… y WhatsApp arma el preview a la primera.
      // Si por algo falla, se usa la redirección de antes.
      try {
        const r = await fetch(new URL(`/api/prenda?id=${encodeURIComponent(id)}&vista=bot`, url.origin), {
          headers: { 'user-agent': req.headers.get('user-agent') || '' }, redirect: 'manual',
        });
        if (r.status === 200) {
          return new Response(await r.text(), { status: 200, headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // Sin s-maxage: el CDN no debe guardar esta versión, porque a las
            // personas, en la misma dirección, se les sirve la ficha normal.
            'Cache-Control': 'max-age=300', 'Vary': 'User-Agent',
          } });
        }
        if (r.status === 302) return irA(url.origin, '/tienda.html');   // no existe u oculta
      } catch (_) {}
      return irA(url.origin, `/api/prenda?id=${encodeURIComponent(id)}`);
    }
  }

  // El resto del sitio pasa sin tocarse
  if (!esPuerta && !esAdmin && !esLogin && !esCodigoPanel) return;

  const entra = secreto
    ? await firmaValida(leerCookie(req, 'acceso'), secreto)
    : !!leerCookie(req, 'sesion');

  // ── Sin dirección secreta: como siempre ────────────────────
  // El acceso es público y el panel exige sesión. Sirve para no dejar
  // el sitio inaccesible si aún no se ha definido RUTA_PANEL.
  if (esCodigoPanel) return entra ? undefined : noEncontrado();

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
    // Si no, se entrega el pase y se manda al formulario. El ?entrada=1
    // le dice al login que venimos por la dirección secreta SIN sesión
    // válida en el servidor: lo que el navegador tenga guardado ya no
    // sirve, hay que borrarlo y enseñar el formulario. Esta dirección es
    // la única forma de entrar al panel, así que tiene que terminar
    // siempre en un formulario usable, nunca en un rebote.
    return irA(url.origin, '/login.html?entrada=1', cookiePuerta());
  }

  if (esAdmin) {
    if (entra) return;                                    // panel servido
    // Pase pero sin sesión: normalmente es que la cookie firmada venció.
    // Se avisa en la URL para que el login no vuelva a mandarnos aquí y
    // se arme un bucle de recargas (ver js/login.js).
    if (conPase) return irA(url.origin, '/login.html?sesion=vencida');
    return noEncontrado();                                // para el mundo, no existe
  }

  // esLogin: sin pase ni sesión, tampoco existe
  if (!conPase && !entra) return noEncontrado();
  return;
}
