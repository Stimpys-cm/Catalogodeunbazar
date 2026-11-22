// js/login.js — sesión única por cuenta + override admin con clave maestra

/* La sesión vive en dos sitios y pueden desincronizarse:
     · localStorage  → lo que ve el panel (isLoggedIn)
     · cookie firmada 'acceso' → lo que ve la puerta (middleware.js), 8 h
   Si la cookie vence y localStorage no, el panel manda al login y el login
   manda al panel: bucle infinito de recargas. Por eso aquí no basta con
   "hay sesión guardada".

   Dos frenos, y el segundo funciona aunque el primero falle:
     1. El middleware marca ?sesion=vencida cuando te rebota del panel.
     2. Un intento por pestaña: si ya mandamos al panel y volvimos aquí,
        la sesión local no sirve, se borra y se enseña el formulario. */
const LOGIN_INTENTO = 'stmp_login_intento';

(function puertaDeEntrada() {
  const q = new URLSearchParams(location.search);

  // Vienes por la dirección secreta y el servidor dice que NO tienes
  // sesión válida (si la tuvieras, la puerta te habría mandado directo
  // al panel sin pasar por aquí). Lo que el navegador tenga guardado
  // está viejo: se borra y se enseña el formulario. Punto.
  const entrada = q.get('entrada') === '1';

  // El panel te devolvió porque la cookie firmada ya no vale.
  const rebotado = q.get('sesion') === 'vencida';

  // Último freno, por si los dos avisos de arriba se pierden: un solo
  // intento por pestaña. Si ya mandamos al panel y estamos otra vez
  // aquí, es que rebotó, y no se vuelve a intentar.
  let yaIntente = false;
  try { yaIntente = sessionStorage.getItem(LOGIN_INTENTO) === '1'; } catch (_) {}

  if (entrada || rebotado || yaIntente) {
    let habia = false;
    try { habia = isLoggedIn(); } catch (_) {}
    try { sessionStorage.removeItem(LOGIN_INTENTO); } catch (_) {}
    try { clearSession(); } catch (_) {}

    document.addEventListener('DOMContentLoaded', () => {
      // Solo se avisa si de verdad había una sesión guardada que se
      // limpió. Entrar por primera vez no es un error que reportar.
      if (habia) {
        const err = document.getElementById('errorMsg');
        if (err) {
          err.textContent = 'Tu sesión venció. Vuelve a entrar.';
          err.classList.add('visible');
        }
      }
      // Que no quede en la barra: al recargar volvería a salir el aviso
      if (entrada || rebotado) history.replaceState(null, '', location.pathname);
    });
    return;
  }

  if (isLoggedIn()) {
    try { sessionStorage.setItem(LOGIN_INTENTO, '1'); } catch (_) {}
    window.location.href = 'admin.html';
  }
})();

async function doLogin() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const err      = document.getElementById('errorMsg');
  const btn      = document.querySelector('.btn');

  // Campo de clave maestra (puede no existir aún hasta que se necesite)
  const overrideWrap = document.getElementById('overrideWrap');
  const overrideInp  = document.getElementById('overrideKey');
  const override     = overrideInp ? overrideInp.value.trim() : '';

  err.classList.remove('visible');
  btn.textContent = 'Entrando...';
  btn.disabled    = true;

  try {
    const res = await fetch('/api/auth', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password, override: override || undefined })
    });

    if (res.ok) {
      const user = await res.json();
      setSession(user);
      try { sessionStorage.removeItem(LOGIN_INTENTO); } catch (_) {}

      // El servidor dice a dónde entrar (el panel puede vivir en una
      // dirección secreta). Si venías de un enlace concreto, te devuelve ahí.
      const pedido = new URLSearchParams(location.search).get('destino');
      const seguro = pedido && /^\/[A-Za-z0-9._~/-]*$/.test(pedido) ? pedido : null;
      window.location.href = seguro || user.panel || 'admin.html';
      return;
    }

    // Leer el detalle del error para decidir qué mostrar
    let data = {};
    try { data = await res.json(); } catch (_) {}

    if (res.status === 409 || res.status === 403) {
      // Cuenta ocupada (409) o clave maestra incorrecta (403)
      err.textContent = data.error || 'Esta cuenta ya tiene una sesión activa.';
      err.classList.add('visible');

      if (data.canUseOverride && overrideWrap) {
        // Desplegar el campo de clave maestra con animación
        overrideWrap.classList.add('open');
        if (overrideInp) setTimeout(() => overrideInp.focus(), 250);
      }
      document.getElementById('password').value = '';
    } else {
      // 401 u otros: credenciales incorrectas
      err.textContent = 'Usuario o contraseña incorrectos.';
      err.classList.add('visible');
      document.getElementById('password').value = '';
    }
  } catch (_) {
    err.textContent = 'Error de conexión. Intenta de nuevo.';
    err.classList.add('visible');
  } finally {
    btn.textContent = 'Entrar';
    btn.disabled    = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('password').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('username').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('password').focus();
  });
  const ov = document.getElementById('overrideKey');
  if (ov) ov.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
});
