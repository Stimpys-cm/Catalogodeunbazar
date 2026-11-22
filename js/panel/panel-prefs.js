// ─────────────────────────────────────────────────────────────
//  js/panel-prefs.js — Personalizar los menús del panel
//
//  · Favoritos: se fijan arriba (estrella al pasar el mouse o en "Ordenar").
//  · Orden: arrastrando o con las flechas.
//  · Ocultar: secciones que no usas (siguen existiendo, solo no estorban).
//  Zonas: 'menu' (barra lateral), 'ventas' (pestaña Ventas), 'instagram'.
//  Se guarda por usuario en el servidor (v-prefs) y en este navegador.
// ─────────────────────────────────────────────────────────────
(function () {
  const LOCAL = 'stmp-panel-prefs';
  const vacia = () => ({ fav: [], orden: [], ocultos: [] });
  const PP = {
    datos: {},
    escuchas: [],
    zona(z) { return (this.datos[z] ||= vacia()); },
    esFav(z, id) { return this.zona(z).fav.includes(id); },
    oculto(z, id) { return this.zona(z).ocultos.includes(id); },
    // Favoritos primero (en su orden), luego el orden guardado, y lo nuevo al final
    ordenar(z, ids, { conOcultos = false } = {}) {
      const p = this.zona(z);
      const pos = id => { const i = p.orden.indexOf(id); return i < 0 ? 1000 + ids.indexOf(id) : i; };
      const favs = p.fav.filter(id => ids.includes(id));
      const resto = ids.filter(id => !favs.includes(id)).sort((a, b) => pos(a) - pos(b));
      return [...favs, ...resto].filter(id => conOcultos || !p.ocultos.includes(id));
    },
    alternarFav(z, id) {
      const p = this.zona(z);
      p.fav = p.fav.includes(id) ? p.fav.filter(x => x !== id) : [...p.fav, id];
      if (p.fav.includes(id)) p.ocultos = p.ocultos.filter(x => x !== id);
      this.cambio(z);
    },
    alternarOculto(z, id) {
      const p = this.zona(z);
      p.ocultos = p.ocultos.includes(id) ? p.ocultos.filter(x => x !== id) : [...p.ocultos, id];
      if (p.ocultos.includes(id)) p.fav = p.fav.filter(x => x !== id);
      this.cambio(z);
    },
    // Recibe el orden completo como se ve (favoritos arriba) y lo guarda
    fijarOrden(z, idsEnOrden) {
      const p = this.zona(z);
      p.fav = idsEnOrden.filter(id => p.fav.includes(id));
      p.orden = idsEnOrden.filter(id => !p.fav.includes(id));
      this.cambio(z);
    },
    restablecer(z) { this.datos[z] = vacia(); this.cambio(z); },
    alCambiar(fn) { this.escuchas.push(fn); },
    cambio(z) {
      try { localStorage.setItem(LOCAL, JSON.stringify(this.datos)); } catch {}
      this.escuchas.forEach(fn => { try { fn(z); } catch (e) { console.error(e); } });
      clearTimeout(this._t);
      this._t = setTimeout(() => {
        if (typeof api === 'function') api('/api/acciones?op=v-prefs', { method: 'POST', body: { prefs: this.datos } }).catch(() => {});
      }, 600);
    },
    async cargar() {
      try { this.datos = JSON.parse(localStorage.getItem(LOCAL) || '{}') || {}; } catch { this.datos = {}; }
      this.escuchas.forEach(fn => fn('*'));
      try {
        if (typeof api !== 'function') return;
        const r = await api('/api/acciones?op=v-prefs');
        if (r?.prefs && Object.keys(r.prefs).length) {
          this.datos = r.prefs;
          try { localStorage.setItem(LOCAL, JSON.stringify(this.datos)); } catch {}
          this.escuchas.forEach(fn => fn('*'));
        }
      } catch {}
    },

    // ── Ventana "Ordenar" (sirve para cualquier zona) ──────────
    // items: [{ id, nombre, icono (html) }]
    editor(z, titulo, items) {
      document.getElementById('ppEditor')?.remove();
      const caja = document.createElement('div');
      caja.id = 'ppEditor'; caja.className = 'pp-fondo';
      caja.setAttribute('role', 'dialog'); caja.setAttribute('aria-modal', 'true'); caja.setAttribute('aria-label', titulo);
      const porId = Object.fromEntries(items.map(x => [x.id, x]));
      const pintar = () => {
        const ids = this.ordenar(z, items.map(x => x.id), { conOcultos: true });
        const p = this.zona(z);
        const fila = (id, i) => {
          const x = porId[id], fav = p.fav.includes(id), oc = p.ocultos.includes(id);
          return `<li class="pp-fila ${fav ? 'fav' : ''} ${oc ? 'oculta' : ''}" draggable="true" data-id="${id}">
            <span class="pp-grip" aria-hidden="true">${ico('arrastrar', 16)}</span>
            <span class="pp-ic">${x.icono || ''}</span>
            <span class="pp-nom">${x.nombre}${oc ? '<small>Oculta</small>' : ''}</span>
            <button type="button" class="pp-b ${fav ? 'on' : ''}" data-acc="fav" aria-pressed="${fav}" title="${fav ? 'Quitar de favoritos' : 'Fijar arriba como favorito'}" aria-label="Favorito: ${x.nombre}">${ico('estrella', 17, fav ? 'lleno' : '')}</button>
            <button type="button" class="pp-b" data-acc="ver" aria-pressed="${!oc}" title="${oc ? 'Mostrar' : 'Ocultar'}" aria-label="${oc ? 'Mostrar' : 'Ocultar'}: ${x.nombre}">${ico(oc ? 'ojo-no' : 'ojo', 17)}</button>
            <button type="button" class="pp-b" data-acc="sube" ${i === 0 ? 'disabled' : ''} aria-label="Subir: ${x.nombre}">${ico('arriba', 17)}</button>
            <button type="button" class="pp-b" data-acc="baja" ${i === ids.length - 1 ? 'disabled' : ''} aria-label="Bajar: ${x.nombre}">${ico('abajo', 17)}</button>
          </li>`;
        };
        const favs = ids.filter(id => p.fav.includes(id)), otros = ids.filter(id => !p.fav.includes(id));
        caja.innerHTML = `<div class="pp-caja" role="dialog" aria-modal="true" aria-label="${titulo}" tabindex="-1">
          <header><div><h2>${titulo}</h2><p>Fija tus favoritos arriba, acomoda el orden arrastrando o con las flechas, y oculta lo que no uses.</p></div>
            <button type="button" class="pp-b cerrar" data-acc="cerrar" aria-label="Cerrar">${ico('equis', 20)}</button></header>
          ${favs.length ? `<h3>${ico('pin', 14)} Fijados arriba</h3><ul class="pp-lista">${favs.map((id) => fila(id, ids.indexOf(id))).join('')}</ul>` : ''}
          <h3>${favs.length ? 'El resto' : 'Secciones'}</h3><ul class="pp-lista">${otros.map((id) => fila(id, ids.indexOf(id))).join('')}</ul>
          <footer><button type="button" class="pp-link" data-acc="reset">Volver al orden original</button><button type="button" class="pp-listo" data-acc="cerrar">Listo</button></footer>
        </div>`;
      };
      const ordenVisible = () => [...caja.querySelectorAll('.pp-fila')].map(li => li.dataset.id);
      caja.addEventListener('click', e => {
        if (e.target === caja) return caja.remove();
        const b = e.target.closest('[data-acc]'); if (!b) return;
        const id = b.closest('.pp-fila')?.dataset.id, acc = b.dataset.acc;
        if (acc === 'cerrar') return caja.remove();
        if (acc === 'reset') { this.restablecer(z); return pintar(); }
        if (acc === 'fav') this.alternarFav(z, id);
        if (acc === 'ver') this.alternarOculto(z, id);
        if (acc === 'sube' || acc === 'baja') {
          const l = ordenVisible(), i = l.indexOf(id), j = acc === 'sube' ? i - 1 : i + 1;
          if (j < 0 || j >= l.length) return;
          // Cruzar la línea entre favoritos y el resto lo cambia de grupo
          const p = this.zona(z), fi = p.fav.includes(id), fj = p.fav.includes(l[j]);
          if (fi !== fj) { this.alternarFav(z, id); return pintar(); }
          [l[i], l[j]] = [l[j], l[i]]; this.fijarOrden(z, l);
        }
        pintar();
        caja.querySelector(`.pp-fila[data-id="${id}"] [data-acc="${acc}"]`)?.focus();
      });
      // Arrastrar y soltar (computadora)
      let arrastrando = null;
      caja.addEventListener('dragstart', e => { arrastrando = e.target.closest('.pp-fila'); arrastrando?.classList.add('moviendo'); });
      caja.addEventListener('dragend', () => { arrastrando?.classList.remove('moviendo'); arrastrando = null; });
      caja.addEventListener('dragover', e => {
        const sobre = e.target.closest('.pp-fila'); if (!arrastrando || !sobre || sobre === arrastrando) return;
        if (sobre.parentNode !== arrastrando.parentNode) return;   // favoritos y resto por separado
        e.preventDefault();
        const r = sobre.getBoundingClientRect();
        sobre.parentNode.insertBefore(arrastrando, e.clientY > r.top + r.height / 2 ? sobre.nextSibling : sobre);
      });
      caja.addEventListener('drop', e => { e.preventDefault(); this.fijarOrden(z, ordenVisible()); pintar(); });
      caja.addEventListener('keydown', e => { if (e.key === 'Escape') caja.remove(); });
      pintar();
      document.body.appendChild(caja);
      caja.querySelector('.pp-caja')?.focus();   // el foco entra a la ventana sin marcar el botón de cerrar
    },
  };
  window.PanelPrefs = PP;

  // ═════════════════════════════════════════════════════════
  //  Barra lateral del panel (admin.html)
  // ═════════════════════════════════════════════════════════
  function prepararMenu() {
    const nav = document.querySelector('.sidebar-nav'); if (!nav || nav.dataset.pp) return;
    nav.dataset.pp = '1';
    // Cada sección recuerda su grupo original
    nav.querySelectorAll('.sidebar-item[id^="tab-"]').forEach(b => { b._grupo = b.parentElement; b.dataset.pp = b.id.slice(4); });
    const fav = document.createElement('div');
    fav.className = 'sidebar-group pp-favs'; fav.id = 'ppFavoritos';
    fav.innerHTML = `<div class="sidebar-nav-label">${ico('estrella', 11, 'lleno')}Favoritos</div>`;
    nav.prepend(fav);
    const barra = document.createElement('div');
    barra.className = 'pp-barra';
    barra.innerHTML = `<button type="button" class="pp-ordenar" title="Favoritos, orden y secciones ocultas">${ico('ajustes', 15)}<span>Personalizar menú</span></button>`;
    nav.prepend(barra);
    barra.querySelector('button').onclick = () => PP.editor('menu', 'Personalizar menú', itemsMenu());
    // Estrella rápida al pasar el mouse
    nav.querySelectorAll('.sidebar-item[data-pp]').forEach(b => {
      const s = document.createElement('span');
      s.className = 'pp-estrella'; s.setAttribute('role', 'button'); s.tabIndex = -1;
      s.title = 'Fijar arriba';
      s.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); PP.alternarFav('menu', b.dataset.pp); });
      b.appendChild(s);
    });
  }
  const itemsMenu = () => [...document.querySelectorAll('.sidebar-nav .sidebar-item[data-pp]')]
    .filter(b => !b.classList.contains('hidden'))   // las que no le tocan a su rol no se muestran
    .map(b => ({ id: b.dataset.pp, nombre: b.childNodes ? [...b.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim() : b.textContent.trim(), icono: b.querySelector('svg')?.outerHTML || '' }));
  function aplicarMenu() {
    const nav = document.querySelector('.sidebar-nav'); if (!nav) return;
    prepararMenu();
    const items = [...nav.querySelectorAll('.sidebar-item[data-pp]')];
    const favCaja = document.getElementById('ppFavoritos');
    const ids = PP.ordenar('menu', items.map(b => b.dataset.pp), { conOcultos: true });
    const p = PP.zona('menu');
    ids.forEach(id => {
      const b = items.find(x => x.dataset.pp === id);
      const destino = p.fav.includes(id) ? favCaja : b._grupo;
      destino.appendChild(b);
      b.classList.toggle('pp-oculto', p.ocultos.includes(id));
      b.classList.toggle('pp-es-fav', p.fav.includes(id));
      const s = b.querySelector('.pp-estrella');
      if (s) { s.innerHTML = ico('estrella', 14, p.fav.includes(id) ? 'lleno' : ''); s.title = p.fav.includes(id) ? 'Quitar de favoritos' : 'Fijar arriba'; }
    });
    favCaja.hidden = !items.some(b => p.fav.includes(b.dataset.pp) && !b.classList.contains('hidden'));
    // Un grupo sin nada visible no muestra su título
    nav.querySelectorAll('.sidebar-group').forEach(g => {
      if (g === favCaja) return;
      const visibles = [...g.querySelectorAll('.sidebar-item')].some(b => !b.classList.contains('hidden') && !b.classList.contains('pp-oculto'));
      g.classList.toggle('pp-vacio', !visibles);
    });
  }
  PP.alCambiar(z => { if (z === 'menu' || z === '*') aplicarMenu(); });

  function iniciar() {
    if (!document.querySelector('.sidebar-nav')) return;
    aplicarMenu();
    PP.cargar();
    // El rol se aplica después de iniciar sesión: volver a acomodar
    const obs = new MutationObserver(() => { clearTimeout(PP._m); PP._m = setTimeout(aplicarMenu, 50); });
    document.querySelectorAll('.sidebar-nav .sidebar-item[data-pp]').forEach(b => obs.observe(b, { attributes: true, attributeFilter: ['class'] }));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
