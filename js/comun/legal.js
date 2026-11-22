// js/legal.js — piezas dinámicas del footer y de la página legal.
// Se carga en todas las páginas públicas; cada bloque es opcional.

(function () {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  // Año del footer, siempre al día
  function pintarAnio() {
    document.querySelectorAll('#anioActual').forEach(el => {
      el.textContent = new Date().getFullYear();
    });
  }

  // Lista de bazares en el footer, cada uno con su color
  function pintarFooterBazares() {
    const el = document.getElementById('footerBazares');
    if (!el || typeof getBazaresActivos !== 'function') return;

    const bazares = getBazaresActivos();
    if (!bazares.length) return;

    el.innerHTML = bazares.slice(0, 6).map(b => `
      <a href="tienda.html?bazar=${encodeURIComponent(b.slug)}" style="--bz-color:${esc(b.color || '#2d6be4')}">
        <span class="sf-bz-punto"></span>@${esc(b.slug)}
      </a>`).join('') +
      (bazares.length > 6 ? `<a href="inicio.html#bazares">Ver todos</a>` : '');
  }

  // Contactos de cada bazar al final de los términos
  function pintarContactosLegales() {
    const el = document.getElementById('legalContactos');
    if (!el || typeof getBazaresActivos !== 'function') return;

    const bazares = getBazaresActivos();
    if (!bazares.length) { el.innerHTML = ''; return; }

    el.innerHTML = bazares.map(b => {
      const wa = String(b.whatsapp || '').replace(/[^0-9]/g, '');
      return `<div class="legal-contacto" style="--bz-color:${esc(b.color || '#2d6be4')}">
        <div class="legal-contacto-nombre">${esc(b.nombre)} <span>@${esc(b.slug)}</span></div>
        <div class="legal-contacto-links">
          ${wa ? `<a href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
          ${b.instagram ? `<a href="https://www.instagram.com/${esc(String(b.instagram).replace(/^@/, ''))}" target="_blank" rel="noopener">Instagram</a>` : ''}
          <a href="tienda.html?bazar=${encodeURIComponent(b.slug)}">Su catálogo</a>
        </div>
      </div>`;
    }).join('');
  }

  function pintarTodo() {
    pintarFooterBazares();
    pintarContactosLegales();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    pintarAnio();
    if (typeof waitForDB === 'function') {
      await waitForDB();
      pintarTodo();
    }
  });

  window.addEventListener('db:bazares', pintarTodo);
})();
