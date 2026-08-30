// js/subasta.js — el panel de subastas, compartido.
//
// Lo usan dos sitios y por eso vive aparte:
//   · la ficha de la prenda, incrustado bajo el precio
//   · el catálogo, en un modal, para poder ofertar sin salir de la lista
//
// Gana quien ofrezca más antes de que se acabe el tiempo. Se puede
// participar con cuenta o dejando un @usuario temporal y un teléfono
// (si ganas, el bazar necesita poder encontrarte).

(function () {
  const INC = 50;                                  // salto mínimo entre ofertas
  const CLAVE_INVITADO = 'stmp_subasta_invitado';

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const money = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');

  const decir = m => {
    if (typeof aviso === 'function') aviso(m);
    else if (typeof toast === 'function') toast(m);
  };

  // Una instancia por sitio donde se pinta el panel. Así el de la ficha y
  // el del modal del catálogo no se pisan los relojes.
  function crearPanel({ contenedor, prenda, enModal = false }) {
    let estado = null;      // { subasta, historial, yo }
    let reloj = null, sondeo = null, enviando = false, vivo = true;

    // ── Quién soy ─────────────────────────────────────────────
    function invitadoGuardado() {
      try { return JSON.parse(localStorage.getItem(CLAVE_INVITADO)) || null; }
      catch { return null; }
    }
    function guardarInvitado(username, telefono) {
      try { localStorage.setItem(CLAVE_INVITADO, JSON.stringify({ username, telefono })); }
      catch (_) {}
    }
    const miCuenta = () => (typeof Cuenta !== 'undefined' && Cuenta.perfil?.()) || null;
    function yo() {
      const c = miCuenta();
      if (c?.username) return { username: c.username, tipo: 'cuenta' };
      const inv = invitadoGuardado();
      return inv?.username ? { username: inv.username, tipo: 'invitado' } : null;
    }

    // ── Carga y refresco ──────────────────────────────────────
    async function cargar() {
      try { estado = await Cuenta.subasta(prenda.id); }
      catch (_) { estado = null; }
      if (!vivo) return;
      pintar();
      arrancarRelojes();
    }

    function arrancarRelojes() {
      clearInterval(reloj); clearInterval(sondeo);
      if (!estado || estado.subasta.cerrada) return;

      // El contador baja cada segundo; el servidor se consulta cada 8.
      reloj = setInterval(pintarReloj, 1000);
      sondeo = setInterval(async () => {
        if (!vivo) return;
        try {
          const antes = estado?.subasta?.totalOfertas ?? 0;
          const nuevo = await Cuenta.subasta(prenda.id);
          if (!vivo) return;
          estado = nuevo;
          pintar();
          if (estado.subasta.totalOfertas > antes && antes > 0) {
            const lider = estado.subasta.lider?.username;
            const mio = yo();
            if (mio && lider && lider !== mio.username) {
              decir(`Te superaron: van ${money(estado.subasta.ofertaActual)}`);
            }
          }
          if (estado.subasta.cerrada) { clearInterval(sondeo); clearInterval(reloj); }
        } catch (_) {}
      }, 8000);
    }

    // Solo el contador, cada segundo, sin repintar todo el panel
    function pintarReloj() {
      const el = contenedor.querySelector('.sb-reloj');
      if (!el || !estado) return;
      const ms = new Date(estado.subasta.fin).getTime() - Date.now();
      if (ms <= 0) {
        clearInterval(reloj);
        el.textContent = 'Terminó';
        el.classList.add('fin');
        cargar();               // el servidor cierra la subasta y devuelve al ganador
        return;
      }
      el.textContent = typeof tiempoRestante === 'function' ? tiempoRestante(estado.subasta.fin) : '';
      el.classList.toggle('urge', ms < 3600000);   // menos de una hora
    }

    // ── El panel ──────────────────────────────────────────────
    function pintar() {
      if (!contenedor) return;
      if (!estado) { contenedor.innerHTML = ''; contenedor.hidden = true; return; }
      contenedor.hidden = false;
      const s = estado.subasta;
      const terminada = s.cerrada || new Date(s.fin).getTime() <= Date.now();
      contenedor.innerHTML = terminada ? panelCerrado(s) : panelAbierto(s);
      cablear();
      if (!terminada) pintarReloj();
    }

    function encabezadoPrenda() {
      if (!enModal) return '';
      const img = (Array.isArray(prenda.imagenes) ? prenda.imagenes : []).filter(Boolean)[0];
      return `
        <div class="sb-prenda">
          ${img ? `<img class="sb-prenda-foto" src="${esc(img)}" alt="">` : ''}
          <div class="sb-prenda-datos">
            ${prenda.marca ? `<div class="sb-prenda-marca">${esc(prenda.marca)}</div>` : ''}
            <div class="sb-prenda-nombre">${esc(prenda.nombre)}</div>
            <a class="sb-prenda-link" href="prenda.html?id=${encodeURIComponent(prenda.id)}">Ver la ficha completa</a>
          </div>
        </div>`;
    }

    function panelAbierto(s) {
      const mio = yo();
      const voyGanando = mio && s.lider && s.lider.username === mio.username;
      const cuenta = miCuenta();
      const inv = invitadoGuardado();

      return `
        <div class="sb-caja">
          ${encabezadoPrenda()}
          <div class="sb-cabecera">
            <span class="sb-etiqueta"><span class="sb-latido"></span>Subasta en curso</span>
            <span class="sb-reloj"></span>
          </div>

          <div class="sb-cifra">
            <div class="sb-cifra-label">${s.totalOfertas ? 'Última oferta' : 'Precio de salida'}</div>
            <div class="sb-cifra-monto">${money(s.totalOfertas ? s.ofertaActual : s.precioInicial)}
              <span class="sb-cur">MXN</span></div>
            <div class="sb-cifra-pie">
              ${s.totalOfertas
                ? `${s.totalOfertas} oferta${s.totalOfertas === 1 ? '' : 's'} · va ganando <b>@${esc(s.lider?.username || '')}</b>`
                : 'Todavía nadie oferta. Puedes ser el primero.'}
            </div>
          </div>

          ${voyGanando ? `<div class="sb-vas-ganando">Vas ganando con ${money(s.ofertaActual)}</div>` : ''}

          <form class="sb-form">
            <label class="sb-campo-monto">
              <span>Tu oferta (mínimo ${money(s.minimo)})</span>
              <div class="sb-monto-fila">
                <span class="sb-monto-signo">$</span>
                <input type="number" class="sb-monto" inputmode="numeric"
                       min="${s.minimo}" step="${INC}" value="${s.minimo}">
              </div>
            </label>
            <div class="sb-saltos">
              <button type="button" data-extra="0">${money(s.minimo)}</button>
              <button type="button" data-extra="${INC}">+${INC}</button>
              <button type="button" data-extra="${INC * 2}">+${INC * 2}</button>
              <button type="button" data-extra="${INC * 5}">+${INC * 5}</button>
            </div>

            ${cuenta ? `
              <div class="sb-identidad con-cuenta">
                Ofertas como <b>@${esc(cuenta.username || '')}</b>
              </div>`
            : `
              <div class="sb-identidad">
                <p class="sb-identidad-nota">
                  Para ofertar sin cuenta deja un usuario y un teléfono: si ganas,
                  es como el bazar te encuentra. Tu teléfono no se muestra a nadie más.
                </p>
                <div class="sb-identidad-campos">
                  <label>
                    <span>Tu usuario</span>
                    <div class="sb-arroba"><i>@</i>
                      <input type="text" class="sb-user" maxlength="30" placeholder="comoteconocen"
                             value="${esc(inv?.username || '')}" autocomplete="nickname">
                    </div>
                  </label>
                  <label>
                    <span>Tu WhatsApp</span>
                    <input type="tel" class="sb-tel" maxlength="15" placeholder="10 dígitos"
                           value="${esc(inv?.telefono || '')}" autocomplete="tel">
                  </label>
                </div>
                <a class="sb-identidad-link" href="cuenta.html?registro=1">¿Mejor con cuenta? Créala en un minuto</a>
              </div>`}

            <div class="sb-error"></div>
            <button type="submit" class="sb-btn">Ofertar ${money(s.minimo)}</button>
          </form>

          ${historialHTML()}

          <p class="sb-reglas">
            Cada oferta sube al menos ${money(INC)}. Al terminar el tiempo,
            gana la más alta y el bazar contacta al ganador. Ofertar es un
            compromiso de compra.
          </p>
        </div>`;
    }

    function panelCerrado(s) {
      const mio = yo();
      const gane = mio && s.ganador && s.ganador.username === mio.username;
      const bz = typeof bazarDe === 'function' ? bazarDe(prenda) : null;
      const wa = bz && bz.whatsapp
        ? String(bz.whatsapp).replace(/[^0-9]/g, '')
        : (typeof WA_POR_DEFECTO !== 'undefined' ? WA_POR_DEFECTO : '');
      const ficha = `${location.origin}/prenda.html?id=${encodeURIComponent(prenda.id)}`;
      const msg = encodeURIComponent(
        `¡Hola! Soy @${mio?.username || ''} y gané la subasta de "${prenda.nombre}" ` +
        `con ${money(s.ofertaActual)} MXN. ¿Cómo la recojo?\n${ficha}`);

      if (!s.ganador) {
        return `
          <div class="sb-caja cerrada">
            ${encabezadoPrenda()}
            <div class="sb-cabecera"><span class="sb-etiqueta gris">Subasta terminada</span></div>
            <div class="sb-cifra">
              <div class="sb-cifra-label">Nadie ofertó</div>
              <div class="sb-cifra-pie">Se quedó sin ofertas. Pregúntale al bazar si la vuelve a subastar.</div>
            </div>
          </div>`;
      }

      return `
        <div class="sb-caja cerrada${gane ? ' gane' : ''}">
          ${encabezadoPrenda()}
          <div class="sb-cabecera">
            <span class="sb-etiqueta ${gane ? 'verde' : 'gris'}">
              ${gane ? '¡Ganaste la subasta!' : 'Subasta terminada'}
            </span>
          </div>

          <div class="sb-cifra">
            <div class="sb-cifra-label">Oferta ganadora</div>
            <div class="sb-cifra-monto">${money(s.ofertaActual)} <span class="sb-cur">MXN</span></div>
            <div class="sb-cifra-pie">
              ${gane ? 'Es tuya. Escríbele al bazar para cerrar la entrega.'
                     : `Se la llevó <b>@${esc(s.ganador.username)}</b>`}
            </div>
          </div>

          ${gane && wa ? `
            <a class="sb-btn-wa" href="https://wa.me/${wa}?text=${msg}" target="_blank" rel="noopener">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 2.138.558 4.147 1.535 5.886L0 24l6.274-1.507A11.944 11.944 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.853 0-3.587-.5-5.084-1.367l-.361-.214-3.733.897.931-3.618-.235-.374A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
              Contactar al bazar
            </a>` : ''}

          ${historialHTML()}
        </div>`;
    }

    function historialHTML() {
      const h = estado?.historial || [];
      if (!h.length) return '';
      const mio = yo();
      return `
        <details class="sb-historial">
          <summary>Ver las ${h.length} oferta${h.length === 1 ? '' : 's'}</summary>
          <div class="sb-historial-lista">
            ${h.map((o, i) => `
              <div class="sb-fila${i === 0 ? ' top' : ''}${mio && o.username === mio.username ? ' mia' : ''}">
                <span class="sb-fila-user">@${esc(o.username)}${
                  mio && o.username === mio.username ? '<i>tú</i>' : ''}</span>
                <span class="sb-fila-monto">${money(o.monto)}</span>
              </div>`).join('')}
          </div>
        </details>`;
    }

    // ── Interacción ───────────────────────────────────────────
    // Sin onclick en el HTML: el panel puede existir dos veces en la
    // misma página y los manejadores globales se estorbarían.
    function cablear() {
      const form = contenedor.querySelector('.sb-form');
      if (!form) return;

      contenedor.querySelectorAll('.sb-saltos button').forEach(b => {
        b.addEventListener('click', () => {
          const campo = contenedor.querySelector('.sb-monto');
          const btn = contenedor.querySelector('.sb-btn');
          if (!campo || !estado) return;
          campo.value = estado.subasta.minimo + Number(b.dataset.extra || 0);
          if (btn) btn.textContent = `Ofertar ${money(campo.value)}`;
        });
      });

      const campo = contenedor.querySelector('.sb-monto');
      if (campo) campo.addEventListener('input', () => {
        const btn = contenedor.querySelector('.sb-btn');
        if (btn && campo.value) btn.textContent = `Ofertar ${money(campo.value)}`;
      });

      form.addEventListener('submit', enviar);
    }

    async function enviar(e) {
      e.preventDefault();
      if (enviando) return;

      const err = contenedor.querySelector('.sb-error');
      const btn = contenedor.querySelector('.sb-btn');
      const fallo = m => { if (err) { err.textContent = m; err.classList.add('visible'); } };
      if (err) { err.textContent = ''; err.classList.remove('visible'); }

      const monto = Number(contenedor.querySelector('.sb-monto')?.value);
      if (!monto || monto < estado.subasta.minimo) {
        return fallo(`La oferta mínima es de ${money(estado.subasta.minimo)}`);
      }

      const cuenta = miCuenta();
      const cuerpo = { prendaId: prenda.id, monto };

      if (!cuenta) {
        const username = (contenedor.querySelector('.sb-user')?.value || '').trim().replace(/^@+/, '');
        const telefono = (contenedor.querySelector('.sb-tel')?.value || '').replace(/[^0-9]/g, '');
        if (username.length < 3)  return fallo('Tu usuario necesita al menos 3 caracteres');
        if (telefono.length < 10) return fallo('Escribe tu teléfono a 10 dígitos');
        cuerpo.username = username;
        cuerpo.telefono = telefono;
      }

      enviando = true;
      if (btn) { btn.disabled = true; btn.textContent = 'Ofertando…'; }

      try {
        const r = await Cuenta.ofertar(cuerpo);
        if (cuerpo.username) guardarInvitado(cuerpo.username, cuerpo.telefono);
        estado = { subasta: r.subasta, historial: r.historial, yo: r.yo };
        pintar();
        decir(`¡Vas ganando con ${money(r.subasta.ofertaActual)}!`);
        // El catálogo de atrás también tiene que enterarse
        window.dispatchEvent(new CustomEvent('subasta:oferta', {
          detail: { prendaId: prenda.id, subasta: r.subasta },
        }));
      } catch (e2) {
        const mensaje = e2.message || 'No se pudo registrar tu oferta';
        // Si alguien se adelantó, hay que enseñar el precio nuevo
        try {
          estado = await Cuenta.subasta(prenda.id);
          pintar();
        } catch (_) {}
        fallo(mensaje);
        const c = contenedor.querySelector('.sb-monto');
        if (c && estado) c.value = estado.subasta.minimo;
      } finally {
        enviando = false;
        const b2 = contenedor.querySelector('.sb-btn');
        if (b2) { b2.disabled = false; b2.textContent = `Ofertar ${money(estado?.subasta?.minimo || 0)}`; }
      }
    }

    function destruir() {
      vivo = false;
      clearInterval(reloj); clearInterval(sondeo);
      reloj = sondeo = null;
    }

    cargar();
    return { destruir, recargar: cargar };
  }

  // ── API pública ─────────────────────────────────────────────
  let panelFicha = null;   // el incrustado en prenda.html
  let panelModal = null;   // el del modal del catálogo

  // Panel incrustado (la ficha de la prenda)
  function montar(contenedor, prenda) {
    if (panelFicha) panelFicha.destruir();
    if (!contenedor) return null;
    panelFicha = crearPanel({ contenedor, prenda });
    return panelFicha;
  }

  function desmontar() {
    if (panelFicha) { panelFicha.destruir(); panelFicha = null; }
  }

  // Modal (el catálogo, para ofertar sin salir de la lista)
  function cajaModal() {
    let caja = document.getElementById('sbModalPublico');
    if (caja) return caja;

    const fondo = document.createElement('div');
    fondo.className = 'sb-mp-fondo';
    fondo.id = 'sbModalPublicoFondo';
    fondo.addEventListener('click', cerrarModal);

    caja = document.createElement('div');
    caja.className = 'sb-mp';
    caja.id = 'sbModalPublico';
    caja.setAttribute('role', 'dialog');
    caja.setAttribute('aria-modal', 'true');
    caja.setAttribute('aria-label', 'Subasta');
    caja.innerHTML = `
      <button class="sb-mp-x" aria-label="Cerrar">&times;</button>
      <div class="sb-mp-body" id="sbModalPublicoBody"></div>`;
    caja.querySelector('.sb-mp-x').addEventListener('click', cerrarModal);

    document.body.appendChild(fondo);
    document.body.appendChild(caja);
    return caja;
  }

  function abrirModal(prenda) {
    if (!prenda) return;
    const caja = cajaModal();
    const cuerpo = caja.querySelector('.sb-mp-body');

    if (panelModal) panelModal.destruir();
    cuerpo.innerHTML = '<div class="sb-mp-cargando">Cargando la subasta…</div>';
    panelModal = crearPanel({ contenedor: cuerpo, prenda, enModal: true });

    caja.classList.add('open');
    document.getElementById('sbModalPublicoFondo')?.classList.add('open');
    document.body.classList.add('sb-mp-abierto');
  }

  function cerrarModal() {
    if (panelModal) { panelModal.destruir(); panelModal = null; }
    document.getElementById('sbModalPublico')?.classList.remove('open');
    document.getElementById('sbModalPublicoFondo')?.classList.remove('open');
    document.body.classList.remove('sb-mp-abierto');
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('sbModalPublico')?.classList.contains('open')) {
      cerrarModal();
    }
  });

  window.Subasta = { montar, desmontar, abrirModal, cerrarModal, INC };
})();
