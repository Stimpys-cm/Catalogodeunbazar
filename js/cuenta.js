// js/cuenta.js — cuentas de comprador en la parte pública.
// Se carga en inicio, tienda, ficha y en la página de cuenta.
//
// Sin cuenta la tienda funciona igual que siempre (la wishlist vive en el
// navegador). Con cuenta, la wishlist se guarda en el servidor y aparece en
// cualquier dispositivo donde inicies sesión.

(function () {
  const WL_KEY = 'bazar_wishlist';

  let _perfil = null;      // null = sin sesión
  let _listo  = false;

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  async function pedir(op, opciones = {}) {
    const res = await fetch(`/api/cuenta?op=${op}`, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      ...opciones,
      body: opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
    });
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(datos.error || 'Algo salió mal');
    return datos;
  }

  // ── Sesión ─────────────────────────────────────────────────
  async function cargarSesion() {
    if (_listo) return _perfil;
    try {
      const r = await pedir('yo', { method: 'GET' });
      _perfil = r.sesion ? r.perfil : null;
    } catch (_) {
      _perfil = null;
    }
    _listo = true;
    window.dispatchEvent(new CustomEvent('cuenta:lista', { detail: _perfil }));
    return _perfil;
  }

  const perfil    = () => _perfil;
  const haySesion = () => !!_perfil;

  async function registro(nombre, email, password, username) {
    const cuerpo = { nombre, email, password };
    // Solo se manda si la persona escribió uno: en blanco, el servidor
    // se lo genera a partir del nombre.
    if (username) cuerpo.username = username;
    const r = await pedir('registro', { method: 'POST', body: cuerpo });
    _perfil = r.perfil; _listo = true;
    await subirWishlist();
    return r.perfil;
  }

  // ── Entrar con Google ──────────────────────────────────────
  // El navegador ya tiene el token firmado por Google; aquí solo se
  // manda al servidor, que es quien comprueba que sea legítimo.
  async function conGoogle(credential) {
    const r = await pedir('google', { method: 'POST', body: { credential } });
    _perfil = r.perfil; _listo = true;
    await unirWishlists();
    return r.perfil;
  }

  // Qué está configurado en el servidor (por ahora, si hay Google).
  let _config = null;
  async function config() {
    if (_config) return _config;
    try { _config = await pedir('config', { method: 'GET' }); }
    catch (_) { _config = { googleClientId: '' }; }
    return _config;
  }

  async function entrar(email, password) {
    const r = await pedir('entrar', { method: 'POST', body: { email, password } });
    _perfil = r.perfil; _listo = true;
    await unirWishlists();
    return r.perfil;
  }

  async function salir() {
    try { await pedir('salir', { method: 'POST' }); } catch (_) {}
    _perfil = null;
    window.dispatchEvent(new CustomEvent('cuenta:lista', { detail: null }));
  }

  async function cambiarNombre(nombre) {
    return guardarPerfil({ nombre });
  }

  // Ajustes de perfil: nombre, @username, teléfono, dirección y foto.
  async function guardarPerfil(campos) {
    const r = await pedir('perfil', { method: 'PUT', body: campos });
    _perfil = r.perfil;
    window.dispatchEvent(new CustomEvent('cuenta:lista', { detail: _perfil }));
    return r.perfil;
  }

  // ── Compras y reputación ───────────────────────────────────
  // Lo que los bazares marcaron como vendido a mi @username.
  const compras     = () => pedir('compras',     { method: 'GET' });
  const misResenas  = () => pedir('mis-resenas', { method: 'GET' });

  // Calificar al bazar de una compra: estrellas + etiquetas + comentario.
  const calificar = (ventaId, estrellas, etiquetas, comentario) =>
    pedir('resena', { method: 'POST', body: { ventaId, estrellas, etiquetas, comentario } });

  // Sube una foto de perfil (misma ruta que el panel; la cookie de
  // comprador basta y Cloudinary devuelve la URL definitiva).
  async function subirFoto(dataUrl) {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ file: dataUrl }),
    });
    const datos = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(datos.error || 'No se pudo subir la foto');
    return datos.url;
  }

  // ── Wishlist ───────────────────────────────────────────────
  const listaLocal = () => {
    try { return JSON.parse(localStorage.getItem(WL_KEY)) || []; }
    catch { return []; }
  };
  const guardarLocal = lista => {
    try { localStorage.setItem(WL_KEY, JSON.stringify(lista)); } catch (_) {}
  };

  // Sube al servidor lo que haya en este navegador
  async function subirWishlist() {
    if (!_perfil) return;
    try { await pedir('wishlist', { method: 'PUT', body: { lista: listaLocal() } }); }
    catch (_) {}
  }

  // Al entrar: junta lo del navegador con lo guardado en la cuenta
  async function unirWishlists() {
    if (!_perfil) return;
    let idsServidor = [];
    try { idsServidor = (await pedir('wishlist', { method: 'GET' })).lista || []; }
    catch (_) { return; }

    const local = listaLocal();
    const idsLocales = local.map(p => String(p.id));
    const faltantes = idsServidor.filter(id => !idsLocales.includes(String(id)));

    // Las prendas que solo estaban en la cuenta se reconstruyen del catálogo
    const catalogo = (typeof getDB === 'function') ? getDB() : [];
    const recuperadas = faltantes.map(id => {
      const p = catalogo.find(x => String(x.id) === String(id) || String(x._id) === String(id));
      if (!p) return null;
      return {
        id: p._id || p.id, nombre: p.nombre, talla: p.talla, estado: p.estado,
        precio_venta: p.precio_venta, marca: p.marca,
        imagenes: Array.isArray(p.imagenes) ? p.imagenes : [], bazarId: p.bazarId || 1,
      };
    }).filter(Boolean);

    const unida = [...local, ...recuperadas];
    guardarLocal(unida);
    await subirWishlist();

    if (typeof updateWishlistBadge === 'function') updateWishlistBadge();
    if (typeof renderWishlistPanel === 'function') renderWishlistPanel();
  }

  // La tienda avisa cuando cambia la wishlist para guardarla en la cuenta
  window.addEventListener('wishlist:cambio', () => { subirWishlist(); });

  // ── Botón de cuenta en el encabezado ───────────────────────
  function pintarBoton() {
    const slot = document.getElementById('cuentaSlot');
    if (!slot) return;

    if (_perfil) {
      const inicial = (_perfil.nombre || '?').charAt(0).toUpperCase();
      const foto = _perfil.avatar
        ? `<img class="cuenta-foto" src="${esc(_perfil.avatar)}" alt="">`
        : `<span class="cuenta-inicial">${esc(inicial)}</span>`;
      slot.innerHTML = `
        <a class="cuenta-chip" href="cuenta.html" title="${esc(_perfil.nombre)}">
          ${foto}
          <span class="cuenta-nombre">${esc(_perfil.nombre.split(' ')[0])}</span>
        </a>`;
    } else {
      slot.innerHTML = `<a class="cuenta-entrar" href="cuenta.html">Entrar</a>`;
    }
  }

  window.addEventListener('cuenta:lista', pintarBoton);

  document.addEventListener('DOMContentLoaded', () => {
    pintarBoton();
    cargarSesion();
  });

  // API pública
  window.Cuenta = {
    perfil, haySesion, cargarSesion,
    // Subastas: leer el estado en vivo y ofertar. Se expone aquí porque
    // esta es la puerta al backend de comprador (la cookie de sesión va
    // sola con credentials: 'same-origin').
    // Recuperar la contraseña: pedir el enlace y usarlo
    recuperar:    email => pedir('recuperar',    { method: 'POST', body: { email } }),
    restablecer:  body  => pedir('restablecer',  { method: 'POST', body }),
    subasta:  id   => pedir(`subasta&id=${encodeURIComponent(id)}`, { method: 'GET' }),
    misSubastas:   () => pedir('mis-subastas', { method: 'GET' }),
    ofertar:  body => pedir('ofertar', { method: 'POST', body }),
    registro, entrar, salir, cambiarNombre, guardarPerfil,
    subirWishlist, unirWishlists, conGoogle, config,
    compras, misResenas, calificar, subirFoto,
  };
})();
