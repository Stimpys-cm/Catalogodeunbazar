// js/mi-cuenta.js — pantalla de cuenta.html
// Dos estados: sin sesión (entrar / crear cuenta) y con sesión (perfil).

(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  let modo = 'entrar';   // 'entrar' | 'registro'

  function aviso(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2600);
  }

  function error(msg) {
    const el = document.getElementById('ctError');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('visible', !!msg);
  }

  // ── Sin sesión ─────────────────────────────────────────────
  function pintarFormulario() {
    const esRegistro = modo === 'registro';
    document.getElementById('ctaTitulo').innerHTML = esRegistro
      ? 'Crear <em>cuenta</em>' : 'Entrar a <em>tu cuenta</em>';
    document.getElementById('ctaSub').textContent = esRegistro
      ? 'Con una cuenta tus prendas guardadas te siguen a cualquier dispositivo.'
      : 'Entra para recuperar tus prendas guardadas.';

    document.getElementById('ctContenido').innerHTML = `
      <div class="ct-card">
        <div class="ct-tabs">
          <button class="ct-tab ${!esRegistro ? 'active' : ''}" onclick="MiCuenta.modo('entrar')">Entrar</button>
          <button class="ct-tab ${esRegistro ? 'active' : ''}" onclick="MiCuenta.modo('registro')">Crear cuenta</button>
        </div>

        <div class="ct-error" id="ctError"></div>

        <form id="ctForm" autocomplete="on">
          ${esRegistro ? `
            <label class="ct-campo">
              <span>Tu nombre</span>
              <input type="text" id="ctNombre" autocomplete="name" maxlength="60" placeholder="Cómo te llamas">
            </label>` : ''}

          <label class="ct-campo">
            <span>Correo</span>
            <input type="email" id="ctEmail" autocomplete="email" maxlength="120" placeholder="tucorreo@ejemplo.com">
          </label>

          <label class="ct-campo">
            <span>Contraseña</span>
            <input type="password" id="ctPass" maxlength="200"
              autocomplete="${esRegistro ? 'new-password' : 'current-password'}"
              placeholder="${esRegistro ? 'Mínimo 8 caracteres, con letras y números' : 'Tu contraseña'}">
          </label>

          <button type="submit" class="ct-btn" id="ctEnviar">
            ${esRegistro ? 'Crear mi cuenta' : 'Entrar'}
          </button>
        </form>

        <p class="ct-nota">
          Tu cuenta solo guarda tu nombre, tu correo y tus prendas favoritas.
          La compra se sigue cerrando por WhatsApp con cada bazar.
          <a href="terminos.html#privacidad">Aviso de privacidad</a>
        </p>
      </div>

      <aside class="ct-lado">
        <h3>¿Para qué sirve?</h3>
        <ul>
          <li>Tus prendas guardadas dejan de vivir solo en este navegador.</li>
          <li>Las recuperas desde el celular, la tablet o la computadora.</li>
          <li>No se pierden si borras el historial o cambias de teléfono.</li>
        </ul>
        <p class="ct-lado-nota">
          No hace falta cuenta para comprar: el catálogo y el contacto por
          WhatsApp funcionan igual sin registrarte.
        </p>
      </aside>`;

    document.getElementById('ctForm').addEventListener('submit', enviar);
  }

  async function enviar(e) {
    e.preventDefault();
    error('');

    const btn    = document.getElementById('ctEnviar');
    const email  = document.getElementById('ctEmail').value.trim();
    const pass   = document.getElementById('ctPass').value;
    const nombre = document.getElementById('ctNombre')?.value.trim() || '';

    if (!email || !pass) return error('Faltan datos');

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Un momento…';

    try {
      if (modo === 'registro') await Cuenta.registro(nombre, email, pass);
      else                     await Cuenta.entrar(email, pass);
      aviso('¡Listo!');
      pintarPerfil();
    } catch (err) {
      error(err.message);
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  // ── Con sesión ─────────────────────────────────────────────
  function pintarPerfil() {
    const p = Cuenta.perfil();
    if (!p) return pintarFormulario();

    const inicial = (p.nombre || '?').charAt(0).toUpperCase();
    const desde = p.creadoEn
      ? new Date(p.creadoEn).toLocaleDateString('es-MX', { year: 'numeric', month: 'long' })
      : '';

    document.getElementById('ctaTitulo').innerHTML = `Hola, <em>${esc(p.nombre.split(' ')[0])}</em>`;
    document.getElementById('ctaSub').textContent = 'Tus prendas guardadas te siguen a donde entres con esta cuenta.';

    document.getElementById('ctContenido').innerHTML = `
      <div class="ct-card">
        <div class="ct-perfil">
          <span class="ct-avatar">${esc(inicial)}</span>
          <div>
            <div class="ct-perfil-nombre">${esc(p.nombre)}</div>
            <div class="ct-perfil-email">${esc(p.email)}</div>
            ${desde ? `<div class="ct-perfil-desde">Cuenta creada en ${esc(desde)}</div>` : ''}
          </div>
        </div>

        <div class="ct-error" id="ctError"></div>

        <label class="ct-campo">
          <span>Tu nombre</span>
          <input type="text" id="ctNuevoNombre" maxlength="60" value="${esc(p.nombre)}">
        </label>
        <button class="ct-btn ct-btn-suave" onclick="MiCuenta.guardarNombre()">Guardar nombre</button>

        <div class="ct-acciones">
          <a class="ct-btn ct-btn-suave" href="tienda.html">Ver el catálogo</a>
          <button class="ct-btn ct-btn-salir" onclick="MiCuenta.salir()">Cerrar sesión</button>
        </div>
      </div>

      <aside class="ct-lado">
        <h3>Prendas guardadas</h3>
        <div id="ctWishlist" class="ct-wishlist">Cargando…</div>
      </aside>`;

    pintarWishlist();
  }

  function pintarWishlist() {
    const cont = document.getElementById('ctWishlist');
    if (!cont) return;

    let lista = [];
    try { lista = JSON.parse(localStorage.getItem('bazar_wishlist')) || []; } catch (_) {}

    if (!lista.length) {
      cont.innerHTML = `<p class="ct-vacio">Todavía no guardas nada. Toca el corazón en cualquier prenda del catálogo.</p>`;
      return;
    }

    cont.innerHTML = lista.slice(0, 8).map(p => {
      const img = (Array.isArray(p.imagenes) && p.imagenes[0]) || '';
      const src = (typeof imgOptimizada === 'function') ? imgOptimizada(img, 120) : img;
      return `<a class="ct-wl" href="prenda.html?id=${encodeURIComponent(p.id)}">
        ${src ? `<img src="${esc(src)}" alt="${esc(p.nombre)}" loading="lazy">` : '<span class="ct-wl-sinfoto"></span>'}
        <span class="ct-wl-datos">
          <span class="ct-wl-nombre">${esc(p.nombre)}</span>
          <span class="ct-wl-precio">$${Number(p.precio_venta || 0).toLocaleString('es-MX')}</span>
        </span>
      </a>`;
    }).join('') +
    (lista.length > 8 ? `<p class="ct-vacio">y ${lista.length - 8} más</p>` : '');
  }

  // ── Acciones ───────────────────────────────────────────────
  async function guardarNombre() {
    const nombre = document.getElementById('ctNuevoNombre').value.trim();
    try {
      await Cuenta.cambiarNombre(nombre);
      aviso('Nombre actualizado');
      pintarPerfil();
    } catch (err) { error(err.message); }
  }

  async function salir() {
    await Cuenta.salir();
    modo = 'entrar';
    pintarFormulario();
    aviso('Sesión cerrada');
  }

  function cambiarModo(nuevo) {
    modo = nuevo;
    pintarFormulario();
  }

  window.MiCuenta = { modo: cambiarModo, guardarNombre, salir };

  window.addEventListener('cuenta:lista', () => {
    if (Cuenta.haySesion()) pintarPerfil();
    else pintarFormulario();
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (new URLSearchParams(location.search).get('registro') === '1') modo = 'registro';
  });
})();
