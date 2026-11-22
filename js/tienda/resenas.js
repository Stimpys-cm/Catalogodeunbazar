// ─────────────────────────────────────────────────────────────
//  js/tienda/resenas.js — "Lo que dicen nuestros clientes" · v42
//
//  Reseñas verificadas (de pedidos entregados), primero las que traen foto.
//  Va en Inicio y en la ficha de cada prenda. Las fotos solo llegan aquí
//  después de que la dueña las aprueba en el panel.
// ─────────────────────────────────────────────────────────────
(() => {
  const sec = document.getElementById('resenasSeccion');
  if (!sec) return;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const urlOk = u => /^https:\/\/res\.cloudinary\.com\//.test(String(u || ''));
  const mini = u => String(u).replace('/upload/', '/upload/f_auto,q_auto,c_fill,w_360,h_360/');
  const estrellas = n => '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n));

  function pintar() {
    const todas = (typeof getResenas === 'function' ? getResenas() : []).filter(r => Number(r.estrellas) > 0);
    if (todas.length < 1) { sec.classList.add('hidden'); return; }
    const conFoto = todas.filter(r => (r.fotos || []).some(urlOk));
    const lista = [...conFoto, ...todas.filter(r => !conFoto.includes(r) && (r.comentario || '').length > 8)]
      .sort((a, b) => ((b.fotos || []).length > 0) - ((a.fotos || []).length > 0) || new Date(b.creadoEn || 0) - new Date(a.creadoEn || 0)).slice(0, 8);
    const prom = todas.reduce((t, r) => t + Number(r.estrellas), 0) / todas.length;
    sec.querySelector('#resenasProm').innerHTML = `<b>${prom.toFixed(1)}</b> <span class="rv-est" aria-hidden="true">${estrellas(prom)}</span> <span>${todas.length} reseña${todas.length === 1 ? '' : 's'} verificada${todas.length === 1 ? '' : 's'}</span>`;
    sec.querySelector('#resenasLista').innerHTML = lista.map(r => {
      const fotos = (r.fotos || []).filter(urlOk);
      return `<article class="rv-card${fotos.length ? ' con-foto' : ''}">
        ${fotos.length ? `<div class="rv-fotos">${fotos.map((u, i) => `<button type="button" class="rv-foto" data-foto="${esc(u)}" aria-label="Ver foto ${i + 1} de ${esc(r.autor || 'cliente')}"><img src="${esc(mini(u))}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div>` : ''}
        <div class="rv-cuerpo">
          <div class="rv-arriba"><span class="rv-est" aria-label="${Number(r.estrellas)} de 5 estrellas">${estrellas(r.estrellas)}</span>${r.verificada ? '<span class="rv-ok">Compra verificada</span>' : ''}</div>
          ${r.comentario ? `<p>${esc(r.comentario)}</p>` : ''}
          <small>${esc(r.autor || 'Cliente')}${r.prendaNombre ? ` · ${esc(r.prendaNombre)}` : ''}</small>
        </div></article>`;
    }).join('');
    sec.classList.toggle('hidden', !lista.length);
    sec.querySelectorAll('[data-foto]').forEach(b => b.onclick = () => verFoto(b.dataset.foto));
  }

  function verFoto(u) {
    if (!urlOk(u)) return;
    const d = document.createElement('dialog'); d.className = 'rv-visor';
    d.innerHTML = `<img src="${esc(String(u).replace('/upload/', '/upload/f_auto,q_auto,w_1400/'))}" alt="Foto de un cliente"><button type="button" aria-label="Cerrar">×</button>`;
    document.body.appendChild(d);
    const cerrar = () => { d.close(); d.remove(); };
    d.querySelector('button').onclick = cerrar; d.onclick = e => { if (e.target === d) cerrar(); }; d.addEventListener('close', () => d.remove());
    d.showModal();
  }

  window.addEventListener('db:ready', pintar);
  window.addEventListener('db:resenas', pintar);
  if (typeof getResenas === 'function' && getResenas().length) pintar();
})();
