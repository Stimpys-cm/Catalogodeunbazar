// js/login.js — sesión única por cuenta + override admin con clave maestra
if (isLoggedIn()) window.location.href = 'admin.html';

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
