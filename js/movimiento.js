// js/movimiento.js
// ─────────────────────────────────────────────────────────────
// El motor de movimiento del sitio. Vanilla, sin librerías y sin
// una sola petición extra: todo lo hace el navegador.
//
// Se encarga de cuatro cosas que antes no existían:
//   1. Aparición al entrar en pantalla, con escalonado en las rejillas.
//   2. Foto que viaja de la tarjeta a la ficha al abrir una prenda.
//   3. Encabezado que se compacta al bajar.
//   4. Imágenes que entran con un fundido en vez de un parpadeo.
//
// Regla de oro: si algo de esto falla, la página tiene que seguir
// siendo perfectamente usable. Por eso el estado oculto solo se
// activa cuando este archivo ya corrió (html.js-mov) y nunca cuando
// la persona pidió menos movimiento.
//
// Cárgalo con defer, después de utils.js:
//   <script src="js/movimiento.js" defer></script>
// ─────────────────────────────────────────────────────────────
(function () {
  'use strict';

  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const raiz   = document.documentElement;

  // Sin IntersectionObserver (navegadores viejos) no se oculta nada:
  // se ve todo desde el principio, que es el fallo correcto.
  if (quieto || !('IntersectionObserver' in window)) return;
  raiz.classList.add('js-mov');

  // ── 1. Aparición al entrar en pantalla ─────────────────────
  // Qué se revela: bloques de contenido y las tarjetas de las
  // rejillas. Nada de texto suelto volando: eso marea y retrasa
  // la lectura.
  const BLOQUES = [
    'main > section', '.h-section', '.shop-layout',
    '.pp-galeria', '.pp-info', '.legal-sec',
  ].join(',');

  // Las rejillas se escalonan: la segunda tarjeta entra un pelo
  // después que la primera. Rápido, o el catálogo se siente lento.
  const REJILLAS = ['#productGrid', '.h-rail', '.h-cats', '.h-bazares',
                    '.h-brands', '.bz-grid', '.pp-relacionadas-grid'].join(',');
  const PASO_MS  = 45;
  const TOPE_MS  = 260;   // a partir de aquí ya no se escalona más

  // Los que esperan turno. Se sale de aquí al revelarse, y con la
  // lista vacía el barrido de abajo no cuesta nada.
  const pendientes = new Set();

  function mostrar(el) {
    el.classList.add('visible');
    el.style.removeProperty('--retraso');
    observador.unobserve(el);
    pendientes.delete(el);
  }

  const observador = new IntersectionObserver(entradas => {
    for (const e of entradas) if (e.isIntersecting) mostrar(e.target);
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

  // Red de seguridad. El observador solo avisa cuando algo cruza el
  // borde de la pantalla: si el scroll salta de golpe (volver atrás y
  // recuperar la posición, un enlace con ancla, la tecla Fin), todo lo
  // que se saltó por el camino pasa de estar debajo a estar encima sin
  // cruzar nada, no genera aviso y se quedaba invisible para siempre.
  // Esto revela cualquier cosa que ya no esté por debajo del pliegue.
  let barriendo = false;
  function barrer() {
    if (barriendo || !pendientes.size) return;
    barriendo = true;
    requestAnimationFrame(() => {
      barriendo = false;
      for (const el of [...pendientes]) {
        if (el.getBoundingClientRect().top < window.innerHeight) mostrar(el);
      }
    });
  }
  addEventListener('scroll', barrer, { passive: true });
  addEventListener('resize', barrer, { passive: true });

  function revelar(el, retrasoMs) {
    if (el.hasAttribute('data-revelar')) return;       // ya estaba
    // Lo que la propia página tiene escondido no se toca: entraría en
    // la lista, nunca cruzaría la pantalla y al mostrarlo saldría en
    // blanco. La sección de bazares del inicio es justo ese caso.
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return;
    el.setAttribute('data-revelar', '');
    if (retrasoMs) el.style.setProperty('--retraso', retrasoMs + 'ms');
    pendientes.add(el);
    observador.observe(el);
  }

  // Lo que ya está en pantalla al cargar no se anima: animar algo que
  // la persona ya está mirando solo retrasa lo que vino a ver.
  const yaVisible = el => el.getBoundingClientRect().top < window.innerHeight * 0.9;

  function preparar(ambito = document) {
    ambito.querySelectorAll(BLOQUES).forEach(el => {
      if (!yaVisible(el)) revelar(el);
    });
    ambito.querySelectorAll(REJILLAS).forEach(rejilla => {
      [...rejilla.children].forEach((hijo, i) => {
        if (yaVisible(hijo)) return;
        revelar(hijo, Math.min(i * PASO_MS, TOPE_MS));
      });
    });
  }

  // ── 2. La foto viaja de la tarjeta a la ficha ──────────────
  // Al abrir una prenda, su foto es la misma pieza en las dos
  // páginas en lugar de desaparecer y volver a nacer. El navegador
  // lo hace solo si ambas comparten view-transition-name.
  const SOPORTA_VT = 'startViewTransition' in document ||
                     CSS.supports('view-transition-name', 'x');

  function marcarFoto(el) {
    if (!SOPORTA_VT || !el) return;
    el.style.viewTransitionName = 'prenda-foto';
  }

  if (SOPORTA_VT) {
    // En el catálogo: la foto de la tarjeta que se abre.
    document.addEventListener('click', e => {
      const enlace = e.target.closest('a[href*="prenda.html"]');
      const tarjeta = e.target.closest('.card, .h-card');
      const origen = enlace || tarjeta;
      if (!origen) return;
      marcarFoto(origen.querySelector('img'));
    }, true);

    // En la ficha: la foto principal recoge el testigo.
    marcarFoto(document.getElementById('ppFoto'));
    window.addEventListener('db:ready', () => {
      marcarFoto(document.getElementById('ppFoto'));
    });
  }

  // ── 3. Encabezado que se compacta al bajar ─────────────────
  const cabecera = document.querySelector('header');
  if (cabecera) {
    // Un centinela invisible arriba del todo: mientras se vea, estamos
    // en la cima. Sale mucho más barato que escuchar el scroll.
    const centinela = document.createElement('div');
    centinela.setAttribute('aria-hidden', 'true');
    centinela.style.cssText = 'position:absolute;top:0;height:1px;width:1px;pointer-events:none';
    document.body.prepend(centinela);
    new IntersectionObserver(([e]) => {
      cabecera.classList.toggle('compacto', !e.isIntersecting);
    }).observe(centinela);
  }

  // ── 4. Fundido de las imágenes al cargar ───────────────────
  function prepararImagenes(ambito = document) {
    ambito.querySelectorAll('img:not([data-fade])').forEach(img => {
      img.setAttribute('data-fade', '');
      // Las que ya están en caché entran sin esperar a nada.
      if (img.complete && img.naturalWidth) { img.classList.add('cargada'); return; }
      img.addEventListener('load',  () => img.classList.add('cargada'), { once: true });
      // Si la foto no carga, se muestra igual: mejor un hueco que un vacío.
      img.addEventListener('error', () => img.classList.add('cargada'), { once: true });
    });
  }

  // ── Arranque y recableado ──────────────────────────────────
  // El catálogo se repinta entero al filtrar, buscar o paginar, así
  // que hay que volver a preparar lo que acaba de nacer. Se agrupa
  // en un rAF para no hacerlo una vez por cada nodo insertado.
  let pendiente = false;
  function repasar() {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => {
      pendiente = false;
      preparar();
      prepararImagenes();
    });
  }

  function arrancar() {
    preparar();
    prepararImagenes();
    ['db:ready', 'db:inventario', 'db:bazares', 'db:resenas', 'db:subastas']
      .forEach(evento => window.addEventListener(evento, repasar));
    // Lo que pintan los filtros y la paginación no lanza ningún
    // evento: se vigila el propio contenedor.
    const rejilla = document.getElementById('productGrid');
    if (rejilla) new MutationObserver(repasar).observe(rejilla, { childList: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar, { once: true });
  } else {
    arrancar();
  }
})();
