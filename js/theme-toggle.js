/* =================================================================
   THEME TOGGLE - alterna tema claro/oscuro y recuerda la eleccion
   -----------------------------------------------------------------
   - Tema CLARO por defecto.
   - Guarda la preferencia en localStorage ('bazar-theme').
   - Inyecta el boton flotante automaticamente (no tocas el HTML).
   - Anti-flash: aplica el tema guardado lo antes posible.
   ================================================================= */
(function () {
  'use strict';

  var STORAGE_KEY = 'bazar-theme';
  var root = document.documentElement;

  /* 1. Aplicar tema guardado cuanto antes (evita parpadeo) */
  function applyStored() {
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) { saved = null; }
    if (saved === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
  }
  applyStored();

  /* 2. Iconos SVG (luna y sol) */
  var MOON = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
             '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  var SUN  = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
             '<circle cx="12" cy="12" r="4.2"/>' +
             '<path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8' +
             'M2 12h2.5M19.5 12H22M4.2 19.8L6 18M18 6l1.8-1.8"/></svg>';

  /* 3. Construir e insertar el boton */
  function buildButton() {
    if (document.querySelector('.theme-toggle')) return;

    var btn = document.createElement('button');
    btn.className = 'theme-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Alternar tema claro u oscuro');
    btn.setAttribute('title', 'Cambiar tema');
    btn.innerHTML =
      '<span class="tt-icon tt-moon">' + MOON + '</span>' +
      '<span class="tt-icon tt-sun">'  + SUN  + '</span>';

    btn.addEventListener('click', toggle);
    document.body.appendChild(btn);
    syncA11y();
  }

  /* 4. Alternar tema */
  function toggle() {
    var isDark = root.getAttribute('data-theme') === 'dark';
    if (isDark) {
      root.removeAttribute('data-theme');
      store('light');
    } else {
      root.setAttribute('data-theme', 'dark');
      store('dark');
    }
    syncA11y();
  }

  function store(val) {
    try { localStorage.setItem(STORAGE_KEY, val); } catch (e) {}
  }

  function syncA11y() {
    var btn = document.querySelector('.theme-toggle');
    if (!btn) return;
    var isDark = root.getAttribute('data-theme') === 'dark';
    btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
  }

  /* 5. Insertar cuando el DOM este listo */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildButton);
  } else {
    buildButton();
  }
})();
