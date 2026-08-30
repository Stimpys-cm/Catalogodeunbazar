// js/mantenimiento.js — la cortina de "volvemos en un rato".
//
// Cada página declara qué sección le corresponde con un atributo en el
// <body>:  data-seccion="tienda"  |  "cuentas"  |  "" (solo el cierre
// general del sitio). Si esa sección está cerrada, o lo está el sitio
// entero, se tapa todo con una pantalla y se explica.
//
// Se comprueba al cargar y en cada actualización del estado, así que si
// el admin cierra el sitio, quien esté navegando lo ve en menos de un
// minuto sin tener que recargar. Y al reabrir, la cortina se va sola.
//
// El admin general no se topa con la cortina: si cierra algo es para
// arreglarlo, y necesita poder verlo. En su lugar aparece un aviso fijo
// que le recuerda que lo que está mirando el resto no lo ve.

(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  const ID      = 'pantallaMantenimiento';
  const ID_AVISO = 'avisoVistaPrevia';

  // ¿Quien mira es el admin general? La sesión del panel vive en el mismo
  // origen, así que se puede consultar desde aquí. Esto no es una barrera
  // de seguridad —detrás solo hay una página a medio terminar— sino la
  // diferencia entre poder probar el sitio cerrado y no poder.
  function esAdminMirando() {
    try {
      if (typeof getSession !== 'function') return false;
      const s = getSession();
      return !!(s && s.sessionToken && s.role === 'admin' && !s.bazarId);
    } catch (_) { return false; }
  }

  function seccionDeEstaPagina() {
    return document.body?.dataset?.seccion || '';
  }

  // Devuelve qué cierre aplica aquí: el del sitio manda sobre el de la
  // sección, porque es el más amplio.
  function cierreVigente() {
    if (typeof enMantenimiento !== 'function') return null;
    if (enMantenimiento('sitio')) return 'sitio';
    const propia = seccionDeEstaPagina();
    if (propia && enMantenimiento(propia)) return propia;
    return null;
  }

  function textoDe(seccion) {
    const titulos = {
      sitio:   'Volvemos en un rato',
      tienda:  'El catálogo está cerrado',
      cuentas: 'Las cuentas están en pausa',
    };
    return {
      titulo: titulos[seccion] || titulos.sitio,
      mensaje: typeof mensajeMantenimiento === 'function'
        ? mensajeMantenimiento(seccion)
        : 'Estamos haciendo mejoras.',
    };
  }

  function pintar(seccion) {
    if (document.getElementById(ID)) return;   // ya está puesta
    const { titulo, mensaje } = textoDe(seccion);
    const m = (typeof getAjustes === 'function' ? getAjustes() : null)
      ?.mantenimiento?.[seccion];

    let vuelve = '';
    if (m?.hasta) {
      const d = new Date(m.hasta);
      if (d.getTime() > Date.now()) {
        vuelve = `<p class="mnt-hora">Volvemos alrededor de las ${
          d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
        } del ${d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}.</p>`;
      }
    }

    // Si solo está cerrada una parte, se ofrece salida a lo que sí abre
    const salida = seccion === 'sitio' ? '' :
      `<a class="mnt-btn" href="inicio.html">Ir al inicio</a>`;

    const capa = document.createElement('div');
    capa.id = ID;
    capa.className = 'mnt-capa';
    capa.setAttribute('role', 'status');
    capa.innerHTML = `
      <div class="mnt-caja">
        <div class="mnt-marca">STMP MARKET<span>.</span></div>
        <div class="mnt-icono" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
          </svg>
        </div>
        <h1 class="mnt-titulo">${esc(titulo)}</h1>
        <p class="mnt-msg">${esc(mensaje)}</p>
        ${vuelve}
        ${salida}
      </div>`;
    document.body.appendChild(capa);
    document.body.classList.add('mnt-activo');
  }

  function quitar() {
    document.getElementById(ID)?.remove();
    document.body.classList.remove('mnt-activo');
  }

  // Barra de "esto está cerrado, lo estás viendo porque eres tú"
  function pintarAviso(seccion) {
    const nombres = { sitio: 'todo el sitio', tienda: 'el catálogo', cuentas: 'las cuentas' };
    let barra = document.getElementById(ID_AVISO);
    if (!barra) {
      barra = document.createElement('div');
      barra.id = ID_AVISO;
      barra.className = 'mnt-previa';
      document.body.appendChild(barra);
    }
    barra.innerHTML = `
      <span class="mnt-previa-punto" aria-hidden="true"></span>
      <span><b>Vista previa.</b> Ahora mismo ${esc(nombres[seccion] || 'esta parte')}
      está cerrado: los visitantes ven la pantalla de mantenimiento.</span>
      <a class="mnt-previa-link" href="admin.html#sistema">Abrir de nuevo</a>`;
    document.body.classList.add('mnt-con-previa');
  }

  function quitarAviso() {
    document.getElementById(ID_AVISO)?.remove();
    document.body.classList.remove('mnt-con-previa');
  }

  function revisar() {
    const seccion = cierreVigente();
    if (!seccion) { quitar(); quitarAviso(); return; }
    if (esAdminMirando()) { quitar(); pintarAviso(seccion); return; }
    quitarAviso();
    pintar(seccion);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (typeof waitForDB === 'function') await waitForDB();
    revisar();
  });
  // El estado llega con el sync: un cierre se nota sin recargar
  window.addEventListener('db:ajustes', revisar);
  // Y por si el cierre tenía hora de fin, se revisa de vez en cuando
  setInterval(revisar, 60000);
})();
