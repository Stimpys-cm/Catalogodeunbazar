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

  async function registro(nombre, email, password) {
    const r = await pedir('registro', { method: 'POST', body: { nombre, email, password } });
    _perfil = r.perfil; _listo = true;
    await subirWishlist();
    return r.perfil;
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
    const r = await pedir('perfil', { method: 'PUT', body: { nombre } });
    _perfil = r.perfil;
    return r.perfil;
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
      slot.innerHTML = `
        <a class="cuenta-chip" href="cuenta.html" title="${esc(_perfil.nombre)}">
          <span class="cuenta-inicial">${esc(inicial)}</span>
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
    registro, entrar, salir, cambiarNombre,
    subirWishlist, unirWishlists,
  };
})();
