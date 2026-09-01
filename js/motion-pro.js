// STMP MARKET — premium motion layer
// Vanilla JS, no dependencies, no network requests.
// Motion is progressive: if the browser/device is not suited for it,
// the site remains exactly usable without the effects.
(function () {
  'use strict';

  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover:hover) and (pointer:fine)').matches;
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  root.classList.add('motion-pro');
  if (reduced) {
    root.classList.add('motion-loaded');
    return;
  }

  function afterPaint(fn) {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  function addProgress() {
    const bar = document.createElement('div');
    bar.className = 'motion-scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);

    let ticking = false;
    const update = () => {
      ticking = false;
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      root.style.setProperty('--scroll-progress', clamp(scrollY / max, 0, 1).toFixed(4));
    };
    const queue = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };
    addEventListener('scroll', queue, { passive: true });
    addEventListener('resize', queue, { passive: true });
    update();
  }

  function addAmbientPointer() {
    if (!finePointer) return;
    root.classList.add('motion-pointer');
    const glow = document.createElement('div');
    glow.className = 'motion-ambient';
    glow.setAttribute('aria-hidden', 'true');
    document.body.appendChild(glow);

    let tx = -999, ty = -999, x = -999, y = -999, raf = 0;
    const render = () => {
      x += (tx - x) * .16;
      y += (ty - y) * .16;
      glow.style.setProperty('--cursor-x', x + 'px');
      glow.style.setProperty('--cursor-y', y + 'px');
      if (Math.abs(tx - x) > .25 || Math.abs(ty - y) > .25) raf = requestAnimationFrame(render);
      else raf = 0;
    };
    addEventListener('pointermove', e => {
      tx = e.clientX; ty = e.clientY;
      if (!raf) raf = requestAnimationFrame(render);
    }, { passive: true });
  }

  function splitWords(el, startDelay = 80) {
    if (!el || el.dataset.motionSplit) return;
    el.dataset.motionSplit = '1';
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const tag = node.parentElement?.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    let index = 0;
    for (const node of textNodes) {
      const frag = document.createDocumentFragment();
      const parts = node.nodeValue.split(/(\s+)/);
      for (const part of parts) {
        if (!part) continue;
        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); continue; }
        const outer = document.createElement('span');
        const inner = document.createElement('span');
        outer.className = 'motion-word';
        inner.textContent = part;
        inner.style.setProperty('--word-delay', `${startDelay + Math.min(index, 12) * 55}ms`);
        outer.appendChild(inner);
        frag.appendChild(outer);
        index++;
      }
      node.replaceWith(frag);
    }
  }

  function prepareHero() {
    const hero = document.querySelector('.h-hero, .h-shop-hero, .rd-hero, .pp-hero');
    if (!hero) {
      const authCard = document.querySelector('.stmp-login .card, .stmp-gate .card');
      if (authCard) {
        const title = authCard.querySelector('h1, .brand-name, .logo');
        splitWords(title, 90);
        authCard.classList.add('motion-hero-item');
        authCard.style.setProperty('--hero-delay', '80ms');
      }
      return;
    }
    const title = hero.querySelector('h1, h2, .h-shop-title');
    splitWords(title, 100);

    const candidates = hero.querySelectorAll(
      '.h-tabs, .h-hero-sub, .hero-slugs, .h-cta-row, .h-stats, .h-hero-bazares, .h-shop-sub, .shop-toolbar, .rd-hero-sub'
    );
    candidates.forEach((el, i) => {
      el.classList.add('motion-hero-item');
      el.style.setProperty('--hero-delay', `${250 + Math.min(i, 7) * 85}ms`);
    });

    if (finePointer) {
      let rect = null;
      let raf = 0;
      let px = 0, py = 0, tx = 0, ty = 0;
      const render = () => {
        px += (tx - px) * .1;
        py += (ty - py) * .1;
        hero.style.setProperty('--hero-px', px.toFixed(2));
        hero.style.setProperty('--hero-py', py.toFixed(2));
        if (Math.abs(tx - px) > .1 || Math.abs(ty - py) > .1) raf = requestAnimationFrame(render);
        else raf = 0;
      };
      hero.addEventListener('pointerenter', () => { rect = hero.getBoundingClientRect(); });
      hero.addEventListener('pointermove', e => {
        rect ||= hero.getBoundingClientRect();
        tx = clamp((e.clientX - rect.left) / rect.width - .5, -.5, .5) * 34;
        ty = clamp((e.clientY - rect.top) / rect.height - .5, -.5, .5) * 28;
        if (!raf) raf = requestAnimationFrame(render);
      }, { passive: true });
      hero.addEventListener('pointerleave', () => {
        tx = 0; ty = 0; rect = null;
        if (!raf) raf = requestAnimationFrame(render);
      });
    }
  }

  function decorateReveals(scope = document) {
    const els = scope.querySelectorAll?.('[data-revelar]:not([data-motion-kind])') || [];
    let side = 0;
    els.forEach(el => {
      if (el.matches('.card,.h-card,.hb-card,.bz-card,.rd-card,.h-bazar,.h-brand,.h-cat')) {
        el.dataset.motionKind = 'scale';
      } else if (el.matches('.pp-galeria,.legal-sec:nth-child(odd)')) {
        el.dataset.motionKind = 'left';
      } else if (el.matches('.pp-info,.legal-sec:nth-child(even)')) {
        el.dataset.motionKind = 'right';
      } else if (el.matches('main > section,.h-section')) {
        el.dataset.motionKind = side++ % 2 ? 'right' : 'left';
      } else {
        el.dataset.motionKind = 'scale';
      }
    });
  }

  function setupTilt(scope = document) {
    if (!finePointer) return;
    const selector = '.card,.h-card,.hb-card,.bz-card,.rd-card,.h-bazar';
    const pendingSelector = selector.split(',').map(s => `${s}:not([data-motion-tilt])`).join(',');
    (scope.querySelectorAll?.(pendingSelector) || []).forEach(card => {
      if (card.closest('.h-hero-bazares') || card.closest('.stmp-login,.stmp-gate')) return;
      card.dataset.motionTilt = '1';
      let rect = null;
      let raf = 0;
      let tx = 0, ty = 0, sx = 50, sy = 50;
      const render = () => {
        raf = 0;
        card.style.setProperty('--tilt-x', `${ty.toFixed(2)}deg`);
        card.style.setProperty('--tilt-y', `${tx.toFixed(2)}deg`);
        card.style.setProperty('--shine-x', `${sx.toFixed(1)}%`);
        card.style.setProperty('--shine-y', `${sy.toFixed(1)}%`);
        card.style.setProperty('--img-x', `${(-tx * .7).toFixed(2)}px`);
        card.style.setProperty('--img-y', `${(ty * .7).toFixed(2)}px`);
      };
      card.addEventListener('pointerenter', () => { rect = card.getBoundingClientRect(); });
      card.addEventListener('pointermove', e => {
        rect ||= card.getBoundingClientRect();
        const nx = clamp((e.clientX - rect.left) / rect.width, 0, 1);
        const ny = clamp((e.clientY - rect.top) / rect.height, 0, 1);
        tx = (nx - .5) * 7;
        ty = (.5 - ny) * 7;
        sx = nx * 100; sy = ny * 100;
        if (!raf) raf = requestAnimationFrame(render);
      }, { passive: true });
      card.addEventListener('pointerleave', () => {
        rect = null; tx = 0; ty = 0; sx = 50; sy = 50;
        if (!raf) raf = requestAnimationFrame(render);
      });
    });
  }

  function setupMagnets(scope = document) {
    if (!finePointer) return;
    const selectors = [
      '.h-btn', '.h-nav-cta', '.btn-contact', '.pp-btn-wa', '.submit-btn',
      '.ct-btn-primary', '.fd-apply', '.h-see-more', '.sort-btn', '.filter-mobile-btn'
    ].join(',');
    (scope.querySelectorAll?.(`${selectors}`) || []).forEach(btn => {
      if (btn.dataset.motionMagnet) return;
      btn.dataset.motionMagnet = '1';
      btn.classList.add('motion-magnetic');
      btn.addEventListener('pointermove', e => {
        const r = btn.getBoundingClientRect();
        const x = clamp((e.clientX - (r.left + r.width / 2)) * .12, -8, 8);
        const y = clamp((e.clientY - (r.top + r.height / 2)) * .14, -6, 6);
        btn.classList.add('motion-magnet-active');
        btn.style.setProperty('--mag-x', `${x}px`);
        btn.style.setProperty('--mag-y', `${y}px`);
      }, { passive: true });
      btn.addEventListener('pointerleave', () => {
        btn.classList.remove('motion-magnet-active');
        btn.style.setProperty('--mag-x', '0px');
        btn.style.setProperty('--mag-y', '0px');
      });
    });
  }

  function setupStats() {
    const stats = document.querySelectorAll('.h-stat-num');
    stats.forEach(el => {
      let last = el.textContent;
      let animating = false;

      const run = () => {
        const source = el.textContent.trim();
        const raw = source.replace(/[^0-9.-]/g, '');
        const target = Number(raw);
        if (!Number.isFinite(target) || target <= 0 || target > 99999) return;
        const suffix = source.replace(/[0-9.,\s-]/g, '');
        const started = performance.now();
        const dur = 800;
        animating = true;
        const tick = now => {
          const t = clamp((now - started) / dur, 0, 1);
          const eased = 1 - Math.pow(1 - t, 4);
          el.textContent = Math.round(target * eased).toLocaleString('es-MX') + suffix;
          if (t < 1) requestAnimationFrame(tick);
          else {
            animating = false;
            last = el.textContent;
          }
        };
        requestAnimationFrame(tick);
      };

      new MutationObserver(() => {
        if (animating || el.textContent === last) return;
        last = el.textContent;
        run();
      }).observe(el, { childList: true, characterData: true, subtree: true });
    });
  }

  function setupDynamicEnhancements() {
    let queued = false;
    const refresh = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        decorateReveals();
        setupTilt();
        setupMagnets();
      });
    };
    new MutationObserver(refresh).observe(document.body, { childList: true, subtree: true });
    ['db:ready','db:inventario','db:bazares','db:resenas','db:subastas'].forEach(name => addEventListener(name, refresh));
  }

  function init() {
    addProgress();
    addAmbientPointer();
    prepareHero();
    decorateReveals();
    setupTilt();
    setupMagnets();
    setupStats();
    setupDynamicEnhancements();
    afterPaint(() => root.classList.add('motion-loaded'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
