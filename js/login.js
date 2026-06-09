// login.js

// Si ya hay sesión activa, redirigir al panel
if (isLoggedIn()) {
  window.location.href = 'admin.html';
}

function doLogin() {
  const u = document.getElementById('username').value.trim();
  const p = document.getElementById('password').value;
  const err = document.getElementById('errorMsg');

  const users = getUsers();
  const user = users.find(x => x.username === u && x.password === p);

  if (user) {
    setSession(user);
    window.location.href = 'admin.html';
  } else {
    err.classList.add('visible');
    document.getElementById('password').value = '';
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
