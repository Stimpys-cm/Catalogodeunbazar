// ─────────────────────────────────────────────────────────────
//  v55 · Formas de pago que acepta la tienda
// ─────────────────────────────────────────────────────────────
// Una sola fuente: Ventas → Promociones y pagos (config.formasPago, llega en
// el sync público). Se pinta en:
//   [data-formas-pago="hero"]  inicio, debajo de los botones
//   [data-formas-pago="pie"]   pie de página de todas las páginas
//   FormasPago.html('ficha')   ficha de la prenda (tienda-plus.js)
//   FormasPago.html('carrito') resumen del carrito (carrito-pagina.js)
// Íconos de línea (sin emojis). El HTML trae las tres de inicio para que no
// brinque nada mientras carga; si en el panel se quita alguna, se repinta.
(function () {
  const ICO = {
    tarjeta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.2"/><path d="M2.5 9.6h19M6.5 15h4"/></svg>',
    efectivo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/></svg>',
    transferencia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5h14.5M15 5l3.5 3.5L15 12"/><path d="M20 15.5H5.5M9 12l-3.5 3.5L9 19"/></svg>',
  };
  const DATOS = {
    tarjeta: ['Tarjeta', 'Crédito o débito'],
    efectivo: ['Efectivo', 'Al entregar en persona'],
    transferencia: ['Transferencia', 'SPEI desde tu banco'],
  };
  const ORDEN = ['tarjeta', 'efectivo', 'transferencia'];
  function lista() {
    const fp = (typeof window.formasPago === 'function' && window.formasPago()) || { tarjeta: true, efectivo: true, transferencia: true };
    return ORDEN.filter(k => fp[k]);
  }
  function texto() {
    const l = lista().map(k => DATOS[k][0].toLowerCase());
    return l.length ? 'Aceptamos ' + (l.length === 1 ? l[0] : l.slice(0, -1).join(', ') + ' y ' + l.at(-1)) : '';
  }
  function html(variante) {
    const l = lista();
    if (!l.length) return '';
    const conDetalle = variante === 'pie' || variante === 'ficha';
    const items = l.map(k => `<li class="fp-item" data-fp="${k}"><span class="fp-ico" aria-hidden="true">${ICO[k]}</span><span class="fp-txt"><b>${DATOS[k][0]}</b>${conDetalle ? `<small>${DATOS[k][1]}</small>` : ''}</span></li>`).join('');
    return `<div class="fp fp-${variante}"><span class="fp-tit">${variante === 'hero' || variante === 'carrito' ? 'Aceptamos' : 'Formas de pago'}</span><ul class="fp-lista">${items}</ul></div>`;
  }
  // v57 · Respuesta de la pregunta frecuente "¿Qué formas de pago aceptan?"
  function faq() {
    const l = lista();
    if (!l.length) return 'Escríbenos por WhatsApp o Instagram y te decimos cómo pagar.';
    const como = { tarjeta: 'con tarjeta de crédito o débito pagas en línea desde la página', efectivo: 'en efectivo, al recoger tu compra en persona en Reynosa', transferencia: 'por transferencia, desde la app de tu banco' };
    const partes = l.map(k => como[k]);
    const frase = partes.length === 1 ? partes[0] : partes.slice(0, -1).join('; ') + '; y ' + partes.at(-1);
    return `${texto()}. ${frase.charAt(0).toUpperCase() + frase.slice(1)}.`;
  }
  function pintar() {
    document.querySelectorAll('[data-formas-pago]').forEach(el => {
      const h = html(el.dataset.formasPago);
      if (el.innerHTML !== h) el.innerHTML = h;
      el.hidden = !h;
    });
    document.querySelectorAll('[data-formas-pago-faq]').forEach(el => { const t = faq(); if (el.textContent !== t) el.textContent = t; });
  }
  // v56 · "efectivo o transferencia" (lo que se paga fuera de la página), según lo marcado en el panel
  function alternativas() {
    const l = lista().filter(k => k !== 'tarjeta');
    return l.join(' o ');
  }
  window.FormasPago = { html, pintar, texto, lista, alternativas, faq };
  // v56 · WhatsApp e Instagram del pie salen de los datos de la tienda (panel) en TODAS las
  // páginas; antes solo el inicio los actualizaba y las demás se quedaban con el número fijo.
  function pintarContacto() {
    const bz = typeof window.getBazares === 'function' ? window.getBazares() : [];
    const pr = Number(typeof window.getModo === 'function' && window.getModo()?.principal) || 1;
    const b = (bz || []).find(x => Number(x.id) === pr) || (bz || [])[0];
    if (!b) return;
    const wa = String(b.whatsapp || '').replace(/\D/g, '');
    const a = document.getElementById('waFooter');
    if (a && wa.length >= 10) a.href = `https://wa.me/${wa.length === 10 ? '52' + wa : wa}?text=${encodeURIComponent('Hola Stiimpys!')}`;
    const ig = String(b.instagram || '').replace(/^@/, '').replace(/[^\w.]/g, '');
    if (ig) document.querySelectorAll('.site-footer a[href^="https://www.instagram.com/"]').forEach(x => { x.href = `https://www.instagram.com/${ig}`; if (/^Instagram @/.test(x.textContent)) x.textContent = `Instagram @${ig}`; });
  }
  window.addEventListener('db:ready', pintarContacto);
  window.addEventListener('db:bazares', pintarContacto);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pintar); else pintar();
  window.addEventListener('db:ready', pintar);
})();
