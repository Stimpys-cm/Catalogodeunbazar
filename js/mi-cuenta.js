// js/mi-cuenta.js — pantalla de cuenta.html en STMP MARKET
//
// Dos estados:
//   sin sesión → entrar / crear cuenta
//   con sesión → centro de control del comprador, en cuatro pestañas:
//     Mis Compras · Favoritos · Mis Reseñas · Ajustes de Perfil
//
// La pieza que une todo es el @username: es lo que el bazar escribe en su
// panel al marcar una prenda como vendida, y lo que hace que esa prenda
// aparezca aquí.

(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  const ETIQUETAS = [
    'Envío rápido',
    'Prenda en excelente estado',
    'Buena atención',
    'Tal como se describe',
    'Buen precio',
  ];

  let modo    = 'entrar';        // 'entrar' | 'registro'
  let pestana = 'compras';       // compras | favoritos | resenas | ajustes

  // Cachés de la sesión: se piden una vez y se refrescan al cambiar algo
  let _compras   = null;
  let _misReseñas = null;

  const dinero = v => '$' + Number(v || 0).toLocaleString('es-MX');
  const fechaCorta = v => v
    ? new Date(v).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';

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

  // Estrellas de solo lectura (db.js las expone, pero cuenta.html no
  // siempre lo tiene cargado antes que esto)
  function estrellas(valor, clase = 'st-estrellas') {
    const v = Math.max(0, Math.min(5, Number(valor) || 0));
    let html = '';
    for (let i = 1; i <= 5; i++) {
      const estado = v >= i ? 'llena' : (v >= i - .5 ? 'media' : 'vacia');
      html += `<span class="st-estrella ${estado}">★</span>`;
    }
    return `<span class="${clase}" role="img" aria-label="${v} de 5 estrellas">${html}</span>`;
  }

  /* ═════════════════════════════════════════════════════════
     SIN SESIÓN
     ═════════════════════════════════════════════════════════ */
  function pintarFormulario() {
    const esRegistro = modo === 'registro';
    document.getElementById('ctaTitulo').innerHTML = esRegistro
      ? 'Crear <em>cuenta</em>' : 'Entrar a <em>tu cuenta</em>';
    document.getElementById('ctaSub').textContent = esRegistro
      ? 'Con una cuenta tus compras, tus favoritos y tus reseñas viven en STMP MARKET.'
      : 'Entra para ver tus compras y tus prendas guardadas.';

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
          Tu cuenta guarda tu nombre, tu correo, tus compras y tus prendas
          favoritas. La compra se sigue cerrando por WhatsApp con cada bazar.
          <a href="terminos.html#privacidad">Aviso de privacidad</a>
        </p>
      </div>

      <aside class="ct-lado">
        <h3>¿Para qué sirve?</h3>
        <ul>
          <li>Tu <b>@username</b> es tu identidad en STMP MARKET: es lo que el bazar anota al venderte una prenda.</li>
          <li>Tus compras se registran solas y puedes calificar al bazar.</li>
          <li>Tus favoritos te siguen al celular, la tablet o la computadora.</li>
          <li>Construyes reputación como comprador dentro de la comunidad.</li>
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
      pestana = 'compras';
      pintarPanel();
    } catch (err) {
      error(err.message);
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  /* ═════════════════════════════════════════════════════════
     CON SESIÓN — el centro de control
     ═════════════════════════════════════════════════════════ */
  function pintarPanel() {
    const p = Cuenta.perfil();
    if (!p) return pintarFormulario();

    document.getElementById('ctaTitulo').innerHTML =
      `Hola, <em>${esc((p.nombre || '').split(' ')[0])}</em>`;
    document.getElementById('ctaSub').innerHTML =
      p.username
        ? `Tu identidad en STMP MARKET es <b>@${esc(p.username)}</b> — dásela al bazar cuando compres.`
        : 'Tus compras, tus favoritos y tus reseñas en un solo lugar.';

    const cont = document.getElementById('ctContenido');
    cont.classList.add('ct-wrap-panel');
    cont.innerHTML = `
      <div class="ct-panel">
        <nav class="ct-navtabs" role="tablist">
          ${botonTab('compras',   'Mis Compras',       IC_BOLSA)}
          ${botonTab('favoritos', 'Favoritos',         IC_CORAZON)}
          ${botonTab('resenas',   'Mis Reseñas',       IC_ESTRELLA)}
          ${botonTab('ajustes',   'Ajustes de Perfil', IC_ENGRANE)}
        </nav>
        <div class="ct-panel-body" id="ctPanelBody">
          <div class="ct-cargando">Cargando…</div>
        </div>
      </div>`;

    pintarPestana();
  }

  const IC_BOLSA    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>';
  const IC_CORAZON  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  const IC_ESTRELLA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
  const IC_ENGRANE  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  function botonTab(id, texto, icono) {
    return `<button class="ct-navtab ${pestana === id ? 'active' : ''}" role="tab"
                    aria-selected="${pestana === id}" onclick="MiCuenta.tab('${id}')">
      ${icono}<span>${texto}</span>
    </button>`;
  }

  function cambiarPestana(id) {
    pestana = id;
    document.querySelectorAll('.ct-navtab').forEach((b, i) => {
      const activo = ['compras', 'favoritos', 'resenas', 'ajustes'][i] === id;
      b.classList.toggle('active', activo);
      b.setAttribute('aria-selected', String(activo));
    });
    pintarPestana();
  }

  function cuerpo() { return document.getElementById('ctPanelBody'); }

  function pintarPestana() {
    if (pestana === 'compras')   return pintarCompras();
    if (pestana === 'favoritos') return pintarFavoritos();
    if (pestana === 'resenas')   return pintarMisResenas();
    if (pestana === 'ajustes')   return pintarAjustes();
  }

  function vacio(titulo, sub, cta = '') {
    return `<div class="ct-vacio-box">
      <div class="ct-vacio-titulo">${esc(titulo)}</div>
      <div class="ct-vacio-sub">${esc(sub)}</div>
      ${cta}
    </div>`;
  }

  /* ── MIS COMPRAS ─────────────────────────────────────────── */
  async function pintarCompras() {
    const cont = cuerpo();
    if (!cont) return;
    cont.innerHTML = `<div class="ct-cargando">Cargando tus compras…</div>`;

    try {
      if (!_compras) _compras = (await Cuenta.compras()).compras || [];
    } catch (err) {
      cont.innerHTML = vacio('No se pudieron cargar', err.message);
      return;
    }
    if (pestana !== 'compras') return;

    if (!_compras.length) {
      cont.innerHTML = vacio(
        'Todavía no tienes compras',
        'Cuando un bazar marque una prenda como vendida a tu @username, aparecerá aquí.',
        `<a class="ct-btn ct-btn-suave ct-vacio-cta" href="tienda.html">Ver el catálogo</a>`);
      return;
    }

    const gastado = _compras.reduce((s, c) => s + Number(c.prenda?.precio || 0), 0);

    cont.innerHTML = `
      <div class="ct-resumen">
        <div class="ct-resumen-dato"><b>${_compras.length}</b><span>prenda${_compras.length !== 1 ? 's' : ''}</span></div>
        <div class="ct-resumen-dato"><b>${dinero(gastado)}</b><span>en total</span></div>
        <div class="ct-resumen-dato"><b>${_compras.filter(c => c.miResena).length}</b><span>calificada${_compras.filter(c => c.miResena).length !== 1 ? 's' : ''}</span></div>
      </div>
      <div class="ct-compras">${_compras.map(tarjetaCompra).join('')}</div>`;
  }

  function tarjetaCompra(c) {
    const pr   = c.prenda || {};
    const img  = (Array.isArray(pr.imagenes) && pr.imagenes[0]) || '';
    const src  = (typeof imgOptimizada === 'function') ? imgOptimizada(img, 240) : img;
    const bz   = (typeof getBazarById === 'function') ? getBazarById(c.bazarId) : null;

    const boton = c.miResena
      ? `<div class="ct-resena-hecha">
           ✓ Reseña enviada ${estrellas(c.miResena.estrellas, 'st-estrellas ct-hecha-estrellas')}
         </div>`
      : `<button class="ct-btn ct-btn-calificar" onclick="MiCuenta.calificar(${c.id})">
           ★ Calificar Bazar
         </button>`;

    return `<article class="ct-compra">
      <div class="ct-compra-foto">
        ${src ? `<img src="${esc(src)}" alt="${esc(pr.nombre)}" loading="lazy">`
              : '<div class="ct-compra-sinfoto"></div>'}
      </div>
      <div class="ct-compra-datos">
        <div class="ct-compra-nombre">${esc(pr.nombre || 'Prenda')}</div>
        <div class="ct-compra-meta">
          Talla ${esc(pr.talla || '–')}${pr.marca ? ' · ' + esc(pr.marca) : ''}
        </div>
        <div class="ct-compra-precio">${dinero(pr.precio)}</div>
        <div class="ct-compra-pie">
          ${bz ? `<a class="ct-compra-bazar" href="tienda.html?bazar=${encodeURIComponent(bz.slug)}">@${esc(bz.slug)}</a>`
                : '<span class="ct-compra-bazar">Bazar</span>'}
          <span class="ct-compra-fecha">${esc(fechaCorta(c.fecha))}</span>
        </div>
      </div>
      <div class="ct-compra-accion">${boton}</div>
    </article>`;
  }

  /* ── MODAL: CALIFICAR BAZAR ──────────────────────────────── */
  let _ventaCalificando = null;
  let _estrellasElegidas = 0;
  let _etiquetasElegidas = new Set();

  function abrirCalificar(ventaId) {
    const compra = (_compras || []).find(c => c.id === ventaId);
    if (!compra) return;

    _ventaCalificando  = ventaId;
    _estrellasElegidas = 0;
    _etiquetasElegidas = new Set();

    const bz = (typeof getBazarById === 'function') ? getBazarById(compra.bazarId) : null;

    document.getElementById('ctModalBody').innerHTML = `
      <p class="cf-intro">
        ¿Cómo te fue con <b>${esc(bz?.nombre || 'este bazar')}</b> en tu compra de
        <b>${esc(compra.prenda?.nombre || 'la prenda')}</b>?
      </p>

      <div class="cf-estrellas" id="cfEstrellas" role="radiogroup" aria-label="Puntuación">
        ${[1, 2, 3, 4, 5].map(n => `
          <button type="button" class="cf-estrella" data-n="${n}"
                  role="radio" aria-checked="false" aria-label="${n} estrella${n !== 1 ? 's' : ''}"
                  onclick="MiCuenta.estrellas(${n})">★</button>`).join('')}
        <span class="cf-estrellas-txt" id="cfEstrellasTxt">Toca las estrellas</span>
      </div>

      <div class="cf-bloque">
        <span class="cf-label">¿Qué salió bien?</span>
        <div class="cf-etiquetas">
          ${ETIQUETAS.map(e => `
            <button type="button" class="cf-etiqueta" data-e="${esc(e)}"
                    onclick="MiCuenta.etiqueta(this)">${esc(e)}</button>`).join('')}
        </div>
      </div>

      <label class="cf-bloque">
        <span class="cf-label">Tu comentario</span>
        <textarea id="cfComentario" maxlength="500" rows="4"
                  placeholder="Cuéntale a los demás cómo fue la compra…"></textarea>
      </label>

      <div class="cf-error" id="cfError"></div>`;

    document.getElementById('ctModalOverlay').classList.add('active');
    document.getElementById('ctModal').classList.add('open');
  }

  function cerrarCalificar() {
    document.getElementById('ctModalOverlay')?.classList.remove('active');
    document.getElementById('ctModal')?.classList.remove('open');
    _ventaCalificando = null;
  }

  function elegirEstrellas(n) {
    _estrellasElegidas = n;
    document.querySelectorAll('.cf-estrella').forEach(b => {
      const activa = Number(b.dataset.n) <= n;
      b.classList.toggle('on', activa);
      b.setAttribute('aria-checked', String(Number(b.dataset.n) === n));
    });
    const txt = ['', 'Mala', 'Regular', 'Bien', 'Muy bien', 'Excelente'][n] || '';
    const el = document.getElementById('cfEstrellasTxt');
    if (el) el.textContent = txt;
  }

  function alternarEtiqueta(btn) {
    const e = btn.dataset.e;
    if (_etiquetasElegidas.has(e)) _etiquetasElegidas.delete(e);
    else _etiquetasElegidas.add(e);
    btn.classList.toggle('on', _etiquetasElegidas.has(e));
  }

  async function enviarResena() {
    if (_ventaCalificando == null) return;
    const err = document.getElementById('cfError');
    const mostrar = m => { if (err) { err.textContent = m || ''; err.classList.toggle('visible', !!m); } };

    if (!_estrellasElegidas) return mostrar('Elige de 1 a 5 estrellas');

    const btn = document.getElementById('cfEnviar');
    const txt = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
    mostrar('');

    try {
      const r = await Cuenta.calificar(
        _ventaCalificando,
        _estrellasElegidas,
        [..._etiquetasElegidas],
        document.getElementById('cfComentario')?.value || ''
      );

      // La compra ya tiene reseña: el botón pasa a "✓ Reseña enviada"
      const compra = (_compras || []).find(c => c.id === _ventaCalificando);
      if (compra) { compra.miResena = r.resena; compra.resenaBazar = true; }

      cerrarCalificar();
      pintarCompras();
      aviso('¡Gracias! Tu reseña ya está publicada');
    } catch (e) {
      mostrar(e.message || 'No se pudo enviar la reseña');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = txt; }
    }
  }

  /* ── FAVORITOS ───────────────────────────────────────────── */
  function listaFavoritos() {
    try { return JSON.parse(localStorage.getItem('bazar_wishlist')) || []; }
    catch { return []; }
  }

  function pintarFavoritos() {
    const cont = cuerpo();
    if (!cont) return;

    const lista = listaFavoritos();
    if (!lista.length) {
      cont.innerHTML = vacio(
        'Sin favoritos todavía',
        'Toca el corazón en cualquier prenda del catálogo y se guarda aquí.',
        `<a class="ct-btn ct-btn-suave ct-vacio-cta" href="tienda.html">Ver el catálogo</a>`);
      return;
    }

    cont.innerHTML = `
      <div class="ct-resumen">
        <div class="ct-resumen-dato"><b>${lista.length}</b><span>prenda${lista.length !== 1 ? 's' : ''} guardada${lista.length !== 1 ? 's' : ''}</span></div>
      </div>
      <div class="ct-favoritos">
        ${lista.map(favorito).join('')}
      </div>`;
  }

  function favorito(p) {
    const img = (Array.isArray(p.imagenes) && p.imagenes[0]) || '';
    const src = (typeof imgOptimizada === 'function') ? imgOptimizada(img, 240) : img;
    const id  = String(p.id);

    return `<article class="ct-fav">
      <div class="ct-fav-foto">
        ${src ? `<img src="${esc(src)}" alt="${esc(p.nombre)}" loading="lazy">`
              : '<div class="ct-compra-sinfoto"></div>'}
      </div>
      <div class="ct-fav-datos">
        <div class="ct-compra-nombre">${esc(p.nombre)}</div>
        <div class="ct-compra-meta">Talla ${esc(p.talla || '–')}${p.marca ? ' · ' + esc(p.marca) : ''}</div>
        <div class="ct-compra-precio">${dinero(p.precio_venta)}</div>
      </div>
      <div class="ct-fav-acciones">
        <a class="ct-mini-btn" href="prenda.html?id=${encodeURIComponent(id)}">Ver prenda</a>
        <button class="ct-mini-btn ct-mini-btn-quitar" onclick="MiCuenta.quitarFavorito('${esc(id)}')"
                aria-label="Quitar de favoritos">Quitar</button>
      </div>
    </article>`;
  }

  function quitarFavorito(id) {
    const lista = listaFavoritos().filter(p => String(p.id) !== String(id));
    try { localStorage.setItem('bazar_wishlist', JSON.stringify(lista)); } catch (_) {}
    // Avisar para que la cuenta guarde la lista nueva en el servidor
    window.dispatchEvent(new CustomEvent('wishlist:cambio'));
    pintarFavoritos();
    aviso('Quitado de favoritos');
  }

  /* ── MIS RESEÑAS (mi reputación como comprador) ──────────── */
  async function pintarMisResenas() {
    const cont = cuerpo();
    if (!cont) return;
    cont.innerHTML = `<div class="ct-cargando">Cargando tu reputación…</div>`;

    let datos;
    try {
      if (!_misReseñas) _misReseñas = await Cuenta.misResenas();
      datos = _misReseñas;
    } catch (err) {
      cont.innerHTML = vacio('No se pudo cargar', err.message);
      return;
    }
    if (pestana !== 'resenas') return;

    const lista = datos.resenas || [];
    if (!lista.length) {
      cont.innerHTML = vacio(
        'Todavía sin valoraciones',
        'Aquí aparece lo que los bazares dicen de ti como comprador después de cada venta.');
      return;
    }

    cont.innerHTML = `
      <div class="ct-reputacion">
        <div class="ct-rep-num">${Number(datos.promedio || 0).toFixed(1)}</div>
        <div>
          ${estrellas(datos.promedio, 'st-estrellas ct-rep-estrellas')}
          <div class="ct-rep-total">${datos.total} valoración${datos.total !== 1 ? 'es' : ''} como comprador</div>
        </div>
      </div>
      <div class="ct-resenas">
        ${lista.map(r => `
          <article class="rs-card">
            <div class="rs-card-head">
              <div class="rs-card-quien">
                <div class="rs-autor">${esc(nombreBazar(r.bazarId))}</div>
                ${r.prendaNombre ? `<div class="rs-prenda">por ${esc(r.prendaNombre)}</div>` : ''}
              </div>
              ${estrellas(r.estrellas, 'st-estrellas rs-card-estrellas')}
            </div>
            ${r.comentario ? `<p class="rs-comentario">${esc(r.comentario)}</p>` : ''}
            ${Array.isArray(r.etiquetas) && r.etiquetas.length
              ? `<div class="rs-etiquetas">${r.etiquetas.map(e => `<span class="rs-etiqueta">${esc(e)}</span>`).join('')}</div>`
              : ''}
            <div class="rs-fecha">${esc(fechaCorta(r.creadoEn))}</div>
          </article>`).join('')}
      </div>`;
  }

  function nombreBazar(id) {
    const b = (typeof getBazarById === 'function') ? getBazarById(id) : null;
    return b?.nombre || 'Un bazar';
  }

  /* ── AJUSTES DE PERFIL ───────────────────────────────────── */
  function pintarAjustes() {
    const cont = cuerpo();
    const p = Cuenta.perfil();
    if (!cont || !p) return;

    const inicial = (p.nombre || '?').charAt(0).toUpperCase();

    cont.innerHTML = `
      <div class="ct-ajustes">
        <div class="ct-foto-fila">
          <div class="ct-foto-wrap" onclick="document.getElementById('ctFotoInput').click()" title="Cambiar foto">
            ${p.avatar
              ? `<img class="ct-foto" id="ctFotoImg" src="${esc(p.avatar)}" alt="Tu foto de perfil">`
              : `<span class="ct-foto ct-foto-inicial" id="ctFotoImg">${esc(inicial)}</span>`}
            <span class="ct-foto-lapiz">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </span>
          </div>
          <div class="ct-foto-info">
            <div class="ct-foto-nombre">${esc(p.nombre)}</div>
            <div class="ct-foto-user">@${esc(p.username || '—')}</div>
            <div class="ct-foto-email">${esc(p.email)}</div>
          </div>
          <input type="file" id="ctFotoInput" accept="image/*" hidden
                 onchange="MiCuenta.subirFoto(this.files[0])">
        </div>

        <div class="ct-error" id="ctError"></div>

        <div class="ct-form-grid">
          <label class="ct-campo">
            <span>Nombre completo</span>
            <input type="text" id="ajNombre" maxlength="60" value="${esc(p.nombre)}" autocomplete="name">
          </label>

          <label class="ct-campo">
            <span>Tu @username</span>
            <div class="ct-input-arroba">
              <span>@</span>
              <input type="text" id="ajUsername" maxlength="30" value="${esc(p.username || '')}"
                     autocomplete="off" spellcheck="false">
            </div>
          </label>

          <label class="ct-campo">
            <span>Teléfono / WhatsApp</span>
            <input type="tel" id="ajTelefono" maxlength="25" value="${esc(p.telefono || '')}"
                   autocomplete="tel" placeholder="899 123 4567">
          </label>

          <label class="ct-campo ct-campo-ancho">
            <span>Dirección de envío habitual</span>
            <input type="text" id="ajDireccion" maxlength="200" value="${esc(p.direccion || '')}"
                   autocomplete="street-address" placeholder="Calle, número, colonia, ciudad y CP">
          </label>
        </div>

        <p class="ct-nota">
          El <b>@username</b> es lo que el bazar escribe en su panel al venderte una
          prenda. Si lo cambias, tus compras y tus reseñas se mueven contigo.
        </p>

        <div class="ct-acciones">
          <button class="ct-btn" id="ajGuardar" onclick="MiCuenta.guardarAjustes()">Guardar cambios</button>
          <button class="ct-btn ct-btn-salir" onclick="MiCuenta.salir()">Cerrar sesión</button>
        </div>
      </div>`;
  }

  async function guardarAjustes() {
    const btn = document.getElementById('ajGuardar');
    const txt = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    error('');

    try {
      await Cuenta.guardarPerfil({
        nombre:    document.getElementById('ajNombre').value.trim(),
        username:  document.getElementById('ajUsername').value.trim(),
        telefono:  document.getElementById('ajTelefono').value.trim(),
        direccion: document.getElementById('ajDireccion').value.trim(),
      });
      // El @username pudo cambiar: las compras se vuelven a pedir
      _compras = null; _misReseñas = null;
      aviso('Perfil actualizado');
      pintarPanel();
    } catch (err) {
      error(err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = txt; }
    }
  }

  async function subirFoto(file) {
    if (!file) return;
    aviso('Subiendo tu foto…');
    const lector = new FileReader();
    lector.onload = async e => {
      try {
        const url = await Cuenta.subirFoto(e.target.result);
        await Cuenta.guardarPerfil({ avatar: url });
        aviso('Foto actualizada');
        pintarAjustes();
      } catch (err) {
        error(err.message || 'No se pudo subir la foto');
      }
    };
    lector.readAsDataURL(file);
  }

  /* ── Acciones sueltas ────────────────────────────────────── */
  async function salir() {
    await Cuenta.salir();
    modo = 'entrar';
    _compras = null; _misReseñas = null;
    document.getElementById('ctContenido')?.classList.remove('ct-wrap-panel');
    pintarFormulario();
    aviso('Sesión cerrada');
  }

  function cambiarModo(nuevo) {
    modo = nuevo;
    pintarFormulario();
  }

  window.MiCuenta = {
    modo: cambiarModo,
    tab: cambiarPestana,
    salir, guardarAjustes, subirFoto, quitarFavorito,
    calificar: abrirCalificar,
    cerrarCalificar,
    estrellas: elegirEstrellas,
    etiqueta: alternarEtiqueta,
    enviarResena,
  };

  window.addEventListener('cuenta:lista', () => {
    // Solo repintar todo cuando cambia el estado de sesión, no en cada guardado
    const hay = Cuenta.haySesion();
    const yaEsPanel = !!document.getElementById('ctPanelBody');
    if (hay && !yaEsPanel) pintarPanel();
    if (!hay && yaEsPanel) pintarFormulario();
    if (!hay && !document.getElementById('ctForm')) pintarFormulario();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('ctModal')?.classList.contains('open')) {
      cerrarCalificar();
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (new URLSearchParams(location.search).get('registro') === '1') modo = 'registro';
  });
})();
