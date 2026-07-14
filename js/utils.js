// js/utils.js
// ─────────────────────────────────────────────────────────────
// Utilidades reutilizables para todo el frontend (vanilla, sin módulos).
// Cárgalo ANTES de db.js/tienda.js/admin.js:
//   <script src="js/utils.js"></script>
//
// Expone en window:  money(), toast(), confirmar(), esc(), debounce(), apiFetch()
// ─────────────────────────────────────────────────────────────
(function () {
  'use strict';

  // ── MONEDA: money(1200) => "$1,200 MXN" ────────────────────
  function money(n, { conMoneda = true } = {}) {
    const num = Number(n);
    const val = Number.isFinite(num) ? num : 0;
    const txt = '$' + val.toLocaleString('es-MX', { maximumFractionDigits: 0 });
    return conMoneda ? txt + ' MXN' : txt;
  }

  // ── ESCAPE HTML (evita romper el markup con comillas/<>) ───
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── DEBOUNCE (para búsquedas, inputs, etc.) ────────────────
  function debounce(fn, ms = 250) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ── TOASTS: toast('Guardado', 'ok') ────────────────────────
  // tipos: 'ok' | 'error' | 'info'
  function toast(msg, tipo = 'info', ms = 2800) {
    let box = document.getElementById('toastBox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toastBox';
      box.className = 'toast-box';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'toast-item toast-' + tipo;
    el.textContent = msg;
    box.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
    }, ms);
  }

  // ── CONFIRMACIÓN (promesa): await confirmar('¿Eliminar?') ──
  function confirmar(mensaje, opciones = {}) {
    const { ok = 'Confirmar', cancel = 'Cancelar', peligro = false, titulo = '' } = opciones;
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'confirm-overlay';
      ov.innerHTML =
        '<div class="confirm-box" role="dialog" aria-modal="true">' +
          (titulo ? '<h3 class="confirm-title"></h3>' : '') +
          '<p class="confirm-msg"></p>' +
          '<div class="confirm-actions">' +
            '<button class="confirm-cancel"></button>' +
            '<button class="confirm-ok"></button>' +
          '</div>' +
        '</div>';
      if (titulo) ov.querySelector('.confirm-title').textContent = titulo;
      ov.querySelector('.confirm-msg').textContent = mensaje;
      ov.querySelector('.confirm-ok').textContent = ok;
      ov.querySelector('.confirm-cancel').textContent = cancel;
      if (peligro) ov.querySelector('.confirm-ok').classList.add('danger');

      const cerrar = (val) => {
        ov.classList.remove('show');
        document.removeEventListener('keydown', onKey);
        ov.addEventListener('transitionend', () => ov.remove(), { once: true });
        resolve(val);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') cerrar(false);
        if (e.key === 'Enter')  cerrar(true);
      };
      ov.querySelector('.confirm-ok').onclick     = () => cerrar(true);
      ov.querySelector('.confirm-cancel').onclick = () => cerrar(false);
      ov.addEventListener('click', (e) => { if (e.target === ov) cerrar(false); });
      document.addEventListener('keydown', onKey);

      document.body.appendChild(ov);
      requestAnimationFrame(() => ov.classList.add('show'));
      ov.querySelector('.confirm-ok').focus();
    });
  }

  // ── FETCH con manejo de errores + envío de cookie de sesión ─
  async function apiFetch(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'include',                 // envía la cookie httpOnly 'sesion'
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    if (res.status === 401) {                 // sesión caduca → al login
      window.location.href = 'login.html';
      throw new Error('Sesión expirada');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.status === 204 ? null : res.json();
  }

  // Exponer en window
  Object.assign(window, { money, esc, debounce, toast, confirmar, apiFetch });
})();
