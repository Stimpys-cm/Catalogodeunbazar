/* ═══════════════════════════════════════════════════════════
   Novedades / anuncios en la portada.
   Trae los anuncios publicados y los pinta como tarjetas tipo
   noticia. Al hacer clic se abre el artículo completo en un modal
   con título, foto y texto (soporta subtítulos ## y ###).
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  let ANUNCIOS = [];

  // Escapa HTML: el contenido lo escriben los bazares, así que nunca
  // se inyecta como marcado.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fecha(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (_) { return ''; }
  }

  // Mini-formato del cuerpo: "## " → subtítulo, "### " → sub-subtítulo,
  // líneas en blanco separan párrafos. Todo escapado.
  function cuerpoHTML(txt) {
    const bloques = String(txt || '').replace(/\r/g, '').split(/\n{2,}/);
    let html = '';
    for (const b of bloques) {
      const lineas = b.split('\n');
      let parrafo = [];
      const cerrar = () => {
        if (parrafo.length) { html += '<p>' + parrafo.map(esc).join('<br>') + '</p>'; parrafo = []; }
      };
      for (const l of lineas) {
        const t = l.trim();
        if (/^###\s+/.test(t)) { cerrar(); html += '<h3>' + esc(t.replace(/^###\s+/, '')) + '</h3>'; }
        else if (/^##\s+/.test(t)) { cerrar(); html += '<h2>' + esc(t.replace(/^##\s+/, '')) + '</h2>'; }
        else if (t) parrafo.push(t);
      }
      cerrar();
    }
    return html;
  }

  function tarjeta(a, i) {
    const foto = a.imagen
      ? '<div class="an-card-img"><img src="' + esc(a.imagen) + '" alt="" loading="lazy"></div>'
      : '<div class="an-card-img an-card-noimg"></div>';
    const tag = a.bazarNombre ? '<span class="an-card-bazar">' + esc(a.bazarNombre) + '</span>' : '';
    const dest = a.destacado ? '<span class="an-card-dest">Destacado</span>' : '';
    return '<article class="an-card" tabindex="0" role="button" data-i="' + i + '" aria-label="' + esc(a.titulo) + '">' +
      foto +
      '<div class="an-card-txt">' +
        '<div class="an-card-meta">' + tag + dest + '</div>' +
        '<h3 class="an-card-tit">' + esc(a.titulo) + '</h3>' +
        (a.resumen ? '<p class="an-card-res">' + esc(a.resumen) + '</p>' : '') +
        '<span class="an-card-fecha">' + esc(fecha(a.creadoEn)) + '</span>' +
      '</div>' +
    '</article>';
  }

  function pintar() {
    const grid = document.getElementById('anunciosGrid');
    const sec = document.getElementById('anunciosSeccion');
    if (!grid || !sec) return;
    if (!ANUNCIOS.length) { sec.classList.add('hidden'); return; }
    grid.innerHTML = ANUNCIOS.map(tarjeta).join('');
    sec.classList.remove('hidden');
    grid.querySelectorAll('.an-card').forEach(el => {
      el.addEventListener('click', () => abrir(Number(el.dataset.i)));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(Number(el.dataset.i)); } });
    });
  }

  function abrir(i) {
    const a = ANUNCIOS[i];
    if (!a) return;
    const body = document.getElementById('anModalBody');
    const meta = [a.bazarNombre && esc(a.bazarNombre), fecha(a.creadoEn) && esc(fecha(a.creadoEn))].filter(Boolean).join(' · ');
    body.innerHTML =
      (a.imagen ? '<div class="an-modal-img"><img src="' + esc(a.imagen) + '" alt=""></div>' : '') +
      '<div class="an-modal-cont">' +
        (meta ? '<div class="an-modal-meta">' + meta + '</div>' : '') +
        '<h1 class="an-modal-tit">' + esc(a.titulo) + '</h1>' +
        (a.resumen ? '<p class="an-modal-res">' + esc(a.resumen) + '</p>' : '') +
        '<div class="an-modal-cuerpo">' + cuerpoHTML(a.cuerpo) + '</div>' +
      '</div>';
    document.getElementById('anModalOverlay').classList.add('abierto');
    document.body.style.overflow = 'hidden';
  }

  // Expuestas para los onclick del HTML.
  window.cerrarAnuncio = function (e) {
    if (e && e.target && e.target.id !== 'anModalOverlay' && !e.target.classList.contains('an-modal-x')) return;
    document.getElementById('anModalOverlay').classList.remove('abierto');
    document.body.style.overflow = '';
  };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') window.cerrarAnuncio(); });

  async function cargar() {
    try {
      const r = await fetch('/api/acciones?op=anuncios');
      if (!r.ok) return;
      ANUNCIOS = await r.json();
      pintar();
    } catch (_) { /* si falla, la sección queda oculta */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cargar);
  else cargar();
})();
