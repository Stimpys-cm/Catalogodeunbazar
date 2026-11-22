/* ═════════════════════════════════════════════════════════════
   Ordenar fotos arrastrando (v49)
   Para tiras de fotos de una sola lista: "Revisar" del registro rápido,
   Registrar prenda y Editar prenda. La primera foto es la portada.
   - Mouse: arrastra la foto.
   - Celular: mantén el dedo sobre la foto un momento y luego muévela
     (si solo deslizas, la página se desplaza normal).
   - Teclado: con la foto enfocada, ← → la mueven un lugar.
   Uso: en cada foto  onpointerdown="OrdenarFotos.iniciar(event, {...})"
        onkeydown="OrdenarFotos.teclado(event, i, total, mover)"
   mover(de, a): mueve la foto de la posición `de` a la posición final `a`.
   ═════════════════════════════════════════════════════════════ */
(function () {
  let actual = null;          // arrastre en curso
  let ignorarClicHasta = 0;

  // Mientras se arrastra con el dedo, la página no se desplaza. El navegador
  // solo respeta esto si el listener existe desde antes de tocar, por eso se
  // registra una vez por contenedor (y el modal del importador ya tiene el suyo).
  function sinScroll(el) {
    if (!el || el.dataset.ofSinScroll) return;
    el.dataset.ofSinScroll = '1';
    el.addEventListener('touchmove', ev => { if (actual?.activo) ev.preventDefault(); }, { passive: false });
  }

  // Contenedor con desplazamiento vertical más cercano (para bajar/subir solo cerca de la orilla)
  function desplazable(el) {
    for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 4) return p;
    }
    return null;
  }

  function iniciar(e, op) {
    // op: { lista: Element, selector: string, indice: number, mover(de, a), puede?: () => bool }
    if (actual || (e.button !== undefined && e.button > 0)) return;
    if (e.target.closest('button:not([data-of-arrastrable]), a, input, select, textarea')) return;
    if (op.puede && !op.puede()) return;
    const el = e.currentTarget, lista = op.lista || el.parentElement;
    const dedo = e.pointerType === 'touch' || e.pointerType === 'pen';
    const x0 = e.clientX, y0 = e.clientY;
    const A = actual = { activo: false, x: x0, y: y0, pos: null };
    let fantasma = null, marca = null, timer = null, raf = 0;
    sinScroll(lista);

    const empezar = () => {
      if (A.activo || actual !== A) return;
      A.activo = true;
      const r = el.getBoundingClientRect();
      A.dx = A.x - r.left; A.dy = A.y - r.top;
      // El fantasma es solo la foto (con estilos propios: no depende de dónde esté la tira)
      fantasma = document.createElement('div');
      fantasma.className = 'of-fantasma';
      Object.assign(fantasma.style, { width: r.width + 'px', height: r.height + 'px' });
      const img = el.querySelector('img');
      if (img) { const c = document.createElement('img'); c.src = img.currentSrc || img.src; c.alt = ''; fantasma.appendChild(c); }
      else fantasma.textContent = el.textContent.trim().slice(0, 12);
      document.body.appendChild(fantasma);
      marca = document.createElement('div'); marca.className = 'of-marca';
      el.classList.add('of-origen');
      document.body.classList.add('of-moviendo');
      try { navigator.vibrate?.(12); } catch {}
      colocar(); bucle();
    };
    const items = () => [...lista.querySelectorAll(op.selector)];
    const colocar = () => {
      if (!fantasma) return;
      fantasma.style.transform = `translate(${A.x - A.dx}px, ${A.y - A.dy}px)`;
      A.pos = null; marca.remove();
      const bajo = document.elementFromPoint(A.x, A.y);
      const it = bajo?.closest?.(op.selector);
      const todos = items();
      if (it && lista.contains(it)) {
        const i = todos.indexOf(it), r = it.getBoundingClientRect(), despues = A.x > r.left + r.width / 2;
        A.pos = i + (despues ? 1 : 0);
        Object.assign(marca.style, { left: (despues ? r.right + 1 : r.left - 5) + 'px', top: r.top + 'px', height: r.height + 'px' });
        document.body.appendChild(marca);
      } else if (bajo && lista.contains(bajo) && todos.length) {
        A.pos = todos.length;
        const r = todos[todos.length - 1].getBoundingClientRect();
        Object.assign(marca.style, { left: r.right + 1 + 'px', top: r.top + 'px', height: r.height + 'px' });
        document.body.appendChild(marca);
      }
    };
    const bucle = () => {
      if (!A.activo) return;
      // orilla de la tira (si se desplaza a lo ancho)
      const lr = lista.getBoundingClientRect();
      if (lista.scrollWidth > lista.clientWidth) {
        const h = A.x < lr.left + 36 ? -10 : A.x > lr.right - 36 ? 10 : 0;
        if (h) { lista.scrollLeft += h; colocar(); }
      }
      // orilla de la ventana o del contenedor que se desplaza
      const cont = desplazable(lista);
      const top = cont ? cont.getBoundingClientRect().top : 0, bottom = cont ? cont.getBoundingClientRect().bottom : innerHeight;
      const v = A.y < top + 60 ? -(top + 60 - A.y) : A.y > bottom - 60 ? A.y - (bottom - 60) : 0;
      if (v) { const d = Math.max(-20, Math.min(20, v / 3)); cont ? (cont.scrollTop += d) : scrollBy(0, d); colocar(); }
      raf = requestAnimationFrame(bucle);
    };
    const mover = ev => {
      A.x = ev.clientX; A.y = ev.clientY;
      if (!A.activo) {
        if (Math.hypot(A.x - x0, A.y - y0) > 8) { if (dedo) return terminar(false); empezar(); }
        return;
      }
      ev.preventDefault(); colocar();
    };
    const terminar = soltar => {
      clearTimeout(timer); cancelAnimationFrame(raf);
      removeEventListener('pointermove', mover); removeEventListener('pointerup', alSoltar);
      removeEventListener('pointercancel', alCancelar); removeEventListener('keydown', alTecla, true);
      fantasma?.remove(); marca?.remove();
      el.classList.remove('of-origen'); document.body.classList.remove('of-moviendo');
      const fue = A.activo, pos = A.pos;
      actual = null;
      if (fue) ignorarClicHasta = Date.now() + 350;
      if (!soltar || !fue || pos == null) return;
      const de = op.indice, a = pos > de ? pos - 1 : pos;
      if (a !== de) op.mover(de, a);
    };
    const alSoltar = () => terminar(true);
    const alCancelar = () => terminar(false);
    const alTecla = ev => { if (ev.key === 'Escape' && A.activo) { ev.stopPropagation(); ev.preventDefault(); terminar(false); } };
    addEventListener('pointermove', mover, { passive: false });
    addEventListener('pointerup', alSoltar);
    addEventListener('pointercancel', alCancelar);
    addEventListener('keydown', alTecla, true);
    if (dedo) timer = setTimeout(empezar, 300);
  }

  // ← → con la foto enfocada (y Inicio = hacerla portada)
  function teclado(e, i, total, mover) {
    let a = null;
    if (e.key === 'ArrowLeft' && i > 0) a = i - 1;
    else if (e.key === 'ArrowRight' && i < total - 1) a = i + 1;
    else if (e.key === 'Home' && i > 0) a = 0;
    if (a == null) return;
    e.preventDefault();
    mover(i, a);
    // que el foco siga a la foto movida
    const lista = e.currentTarget?.parentElement;
    requestAnimationFrame(() => { const id = lista?.id; const l = id ? document.getElementById(id) : lista; l?.querySelectorAll('[data-of-i]')[a]?.focus(); });
  }

  // Después de arrastrar, soltar no cuenta como clic (no abre ni cambia la portada)
  addEventListener('click', e => { if (Date.now() < ignorarClicHasta && e.target.closest?.('[data-of-i]')) { e.stopPropagation(); e.preventDefault(); } }, true);

  // Mueve un elemento dentro de un arreglo (de → a)
  function moverEn(arr, de, a) { if (!Array.isArray(arr) || !(de in arr)) return arr; const [x] = arr.splice(de, 1); arr.splice(Math.max(0, Math.min(a, arr.length)), 0, x); return arr; }

  // Las tiras de Registrar y Editar están en la página desde el inicio
  const prep = () => ['previewStrip', 'rePreviewStrip'].forEach(id => sinScroll(document.getElementById(id)));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', prep); else prep();

  window.OrdenarFotos = { iniciar, teclado, sinScroll, moverEn, get arrastrando() { return !!actual?.activo; } };
})();
