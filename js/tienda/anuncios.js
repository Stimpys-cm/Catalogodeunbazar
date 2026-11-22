/* ═══════════════════════════════════════════════════════════
   Novedades / anuncios en la portada.
   Trae los anuncios publicados y los pinta como piezas editoriales.
   Al hacer clic se abre el artículo completo en un modal con
   título, foto y texto (soporta subtítulos ## y ###).
   No crea peticiones ni campos nuevos: usa /api/acciones?op=anuncios.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  let ANUNCIOS = [];
  let ultimoFoco = null;   // para restaurar el foco al cerrar

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

  // Tipo de anuncio para el badge editorial. Usa a.tipo si el backend
  // llega a mandarlo; si no, lo deduce del texto. Solo presentación.
  const TIPOS = {
    rebaja:   { cls: 'an-tag--rebaja',   txt: 'Rebaja',   re: /(rebaj|oferta|descuent|promo|sale|%)/i },
    apertura: { cls: 'an-tag--apertura', txt: 'Apertura', re: /(apertur|inaugura|nuevo bazar|abrimos|ya abr)/i },
    aviso:    { cls: 'an-tag--aviso',    txt: 'Aviso',    re: /(aviso|important|cierre|horario|mantenimiento|atenci[oó]n)/i },
    novedad:  { cls: 'an-tag--novedad',  txt: 'Novedad',  re: /.*/ },
  };
  function tipoDe(a) {
    const clave = String(a.tipo || '').toLowerCase();
    if (TIPOS[clave]) return TIPOS[clave];
    const base = (a.titulo || '') + ' ' + (a.resumen || '');
    for (const k of ['rebaja', 'apertura', 'aviso']) if (TIPOS[k].re.test(base)) return TIPOS[k];
    return TIPOS.novedad;
  }

  // Enlace opcional (solo si el backend lo provee algún día).
  function enlaceDe(a) {
    const u = a.enlace || a.url || a.link || '';
    return /^https?:\/\//i.test(u) ? u : '';
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
    const tipo = tipoDe(a);
    const badges =
      '<span class="an-tag ' + tipo.cls + '">' + tipo.txt + '</span>' +
      (a.bazarNombre ? '<span class="an-tag an-tag--bazar">' + esc(a.bazarNombre) + '</span>' : '') +
      (a.destacado ? '<span class="an-tag an-tag--dest">Destacado</span>' : '');
    return '<article class="an-card" tabindex="0" role="button" data-i="' + i + '" style="--i:' + i + '" aria-label="' + esc(a.titulo) + '">' +
      foto +
      '<div class="an-card-txt">' +
        '<div class="an-card-meta">' + badges + '</div>' +
        '<h3 class="an-card-tit">' + esc(a.titulo) + '</h3>' +
        (a.resumen ? '<p class="an-card-res">' + esc(a.resumen) + '</p>' : '') +
        '<div class="an-card-pie">' +
          '<span class="an-card-fecha">' + esc(fecha(a.creadoEn)) + '</span>' +
          '<span class="an-card-cta">Ver anuncio <span class="an-arrow" aria-hidden="true">→</span></span>' +
        '</div>' +
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
    const overlay = document.getElementById('anModalOverlay');
    const modal = document.getElementById('anModal');
    const body = document.getElementById('anModalBody');
    if (!overlay || !body) return;

    const tipo = tipoDe(a);
    const metaTxt = [a.bazarNombre && esc(a.bazarNombre), fecha(a.creadoEn) && esc(fecha(a.creadoEn))].filter(Boolean).join(' · ');
    const enlace = enlaceDe(a);
    body.innerHTML =
      (a.imagen ? '<div class="an-modal-img"><img src="' + esc(a.imagen) + '" alt=""></div>' : '') +
      '<div class="an-modal-cont">' +
        '<div class="an-modal-meta">' +
          '<span class="an-tag ' + tipo.cls + '">' + tipo.txt + '</span>' +
          (metaTxt ? '<span>' + metaTxt + '</span>' : '') +
        '</div>' +
        '<h1 class="an-modal-tit" id="anModalTit">' + esc(a.titulo) + '</h1>' +
        (a.resumen ? '<p class="an-modal-res">' + esc(a.resumen) + '</p>' : '') +
        '<div class="an-modal-cuerpo">' + cuerpoHTML(a.cuerpo) + '</div>' +
        (enlace ? '<a class="an-modal-cta" href="' + esc(enlace) + '" target="_blank" rel="noopener">Ver más <span aria-hidden="true">→</span></a>' : '') +
      '</div>';

    if (modal) modal.setAttribute('aria-labelledby', 'anModalTit');
    ultimoFoco = document.activeElement;
    overlay.classList.add('abierto');
    document.body.style.overflow = 'hidden';
    // El contenido vuelve arriba y el foco entra al diálogo.
    const cont = body.querySelector('.an-modal-cont');
    if (cont) cont.scrollTop = 0;
    const xBtn = overlay.querySelector('.an-modal-x');
    if (xBtn) xBtn.focus();
  }

  function estaAbierto() {
    const o = document.getElementById('anModalOverlay');
    return o && o.classList.contains('abierto');
  }

  // Expuesta para los onclick del HTML (X y clic en el fondo).
  window.cerrarAnuncio = function (e) {
    if (e && e.target && e.target.id !== 'anModalOverlay' && !e.target.classList.contains('an-modal-x')) return;
    const overlay = document.getElementById('anModalOverlay');
    if (!overlay) return;
    overlay.classList.remove('abierto');
    document.body.style.overflow = '';
    if (ultimoFoco && typeof ultimoFoco.focus === 'function') ultimoFoco.focus();
    ultimoFoco = null;
  };

  document.addEventListener('keydown', e => {
    if (!estaAbierto()) return;
    if (e.key === 'Escape') { window.cerrarAnuncio(); return; }
    // Trampa de foco: Tab no se escapa del diálogo.
    if (e.key === 'Tab') {
      const modal = document.getElementById('anModal');
      if (!modal) return;
      const focosSel = 'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])';
      const focos = Array.from(modal.querySelectorAll(focosSel)).filter(el => el.offsetParent !== null);
      if (!focos.length) return;
      const primero = focos[0], ultimo = focos[focos.length - 1];
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    }
  });

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
