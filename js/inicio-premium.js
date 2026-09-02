/* ═══════════════════════════════════════════════════════════════════════
   STMP MARKET · INICIO — microinteracciones premium
   Vanilla, cero dependencias, cero requests. Complementa a movimiento.js
   (que ya hace el reveal-on-scroll). Todo lo cosmético degrada con gracia:
   si algo falla, la página sigue perfecta. Respeta prefers-reduced-motion.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (!document.documentElement.classList.contains('home')) return;

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ── 1. Punto indicador de scroll en el hero ─────────────────────────── */
  try {
    const hero = document.querySelector('.h-hero');
    if (hero && !reduce && !hero.querySelector('.h-scroll-dot')) {
      const dot = document.createElement('span');
      dot.className = 'h-scroll-dot';
      dot.setAttribute('aria-hidden', 'true');
      hero.appendChild(dot);
    }
  } catch (_) {}

  /* ── 2. Conteo animado de las estadísticas ───────────────────────────── */
  // inicio.js pone el número real (o "—"). Cuando ya es un número, contamos
  // de 0 hasta él una sola vez. Si reduce-motion, se deja el número tal cual.
  function contar(el) {
    if (reduce || !el || el.dataset.contado) return;
    const objetivo = parseInt(String(el.textContent).replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(objetivo) || objetivo <= 0) return;
    el.dataset.contado = '1';
    const dur = Math.min(1100, 380 + objetivo * 12);
    const t0 = performance.now();
    const ease = t => 1 - Math.pow(1 - t, 3);
    (function paso(now) {
      const t = Math.min(1, (now - t0) / dur);
      el.textContent = Math.round(ease(t) * objetivo).toLocaleString('es-MX');
      if (t < 1) requestAnimationFrame(paso);
    })(t0);
  }

  function vigilarStats() {
    const ids = ['statPrendas', 'statBazares', 'statNuevas'];
    const els = ids.map(id => document.getElementById(id)).filter(Boolean);
    if (!els.length) return;
    // Solo contamos cuando el bloque de stats es visible.
    const io = ('IntersectionObserver' in window)
      ? new IntersectionObserver(ents => {
          ents.forEach(e => { if (e.isIntersecting) { contar(e.target); io.unobserve(e.target); } });
        }, { threshold: 0.4 })
      : null;
    els.forEach(el => {
      // Si ya trae número al entrar en pantalla, contamos; si aún dice "—",
      // esperamos a que inicio.js lo rellene (observando su texto).
      const mo = new MutationObserver(() => {
        if (/\d/.test(el.textContent)) { mo.disconnect(); io ? io.observe(el) : contar(el); }
      });
      if (/\d/.test(el.textContent)) { io ? io.observe(el) : contar(el); }
      else mo.observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  /* ── 3. Botones magnéticos (muy sutil, solo puntero fino) ─────────────── */
  function magnetico(btn) {
    const FUERZA = 0.22, MAX = 7;
    let raf = 0;
    function mover(e) {
      const r = btn.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) * FUERZA;
      const dy = (e.clientY - (r.top + r.height / 2)) * FUERZA;
      const cx = Math.max(-MAX, Math.min(MAX, dx));
      const cy = Math.max(-MAX, Math.min(MAX, dy));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { btn.style.transform = `translate(${cx}px, ${cy}px)`; });
    }
    function salir() { cancelAnimationFrame(raf); btn.style.transform = ''; }
    btn.addEventListener('pointermove', mover);
    btn.addEventListener('pointerleave', salir);
  }

  function vigilarBotones() {
    if (reduce || !finePointer) return;
    document.querySelectorAll('.h-hero .h-btn').forEach(magnetico);
  }

  /* ── 4. Scroll suave para las anclas internas del home ───────────────── */
  function anclasSuaves() {
    if (reduce) return;
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => {
        const id = a.getAttribute('href');
        if (!id || id === '#') return;
        const destino = document.querySelector(id);
        if (!destino) return;
        e.preventDefault();
        destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.replaceState(null, '', id);
      });
    });
  }

  /* ── Arranque ────────────────────────────────────────────────────────── */
  function iniciar() {
    vigilarStats();
    vigilarBotones();
    anclasSuaves();
    // Los stats también se rellenan al llegar los datos.
    window.addEventListener('db:ready', vigilarStats);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  } else {
    iniciar();
  }
})();
