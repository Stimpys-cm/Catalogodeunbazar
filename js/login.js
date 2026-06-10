// js/login.js — actualizado para MongoDB
if (isLoggedIn()) window.location.href = 'admin.html';

async function doLogin() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const err      = document.getElementById('errorMsg');
  const btn      = document.querySelector('.btn');

  err.classList.remove('visible');
  btn.textContent = 'Entrando...';
  btn.disabled    = true;

  try {
    const res = await fetch('/api/auth', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password })
    });

    if (res.ok) {
      const user = await res.json();
      setSession(user);
      window.location.href = 'admin.html';
    } else {
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
});
