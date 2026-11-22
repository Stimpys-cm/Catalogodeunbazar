/* ============================================================
   lightbox.js — Abre las fotos del inventario en grande.
   Usa el modal que YA existe en admin.html:
     #modalOv (overlay), #modImg (imagen), #mPrev / #mNext (flechas)
   Detector de clic robusto: funciona aunque encima de la
   imagen haya contador (1/4), flechas o badges.
   ============================================================ */
(function () {
  "use strict";

  var imgs = [];   // array de URLs de la prenda actual
  var idx  = 0;    // índice de la foto mostrada
  var justOpened = false;
  var swiped = false;

  function el(id) { return document.getElementById(id); }

  window.openMod = function (images, startIndex) {
    imgs = Array.isArray(images) ? images : [];
    idx  = startIndex || 0;
    if (!imgs.length) return;
    var ov = el("modalOv");
    if (!ov) return;
    render();
    ov.classList.add("open");
    document.body.style.overflow = "hidden";
    justOpened = true;
    setTimeout(function(){ justOpened = false; }, 0);
  };

  window.closeMod = function () {
    var ov = el("modalOv");
    if (ov) ov.classList.remove("open");
    document.body.style.overflow = "";
  };

  window.mChg = function (dir) {
    if (!imgs.length) return;
    idx = (idx + dir + imgs.length) % imgs.length;
    render();
  };

  function render() {
    var img  = el("modImg");
    var prev = el("mPrev");
    var next = el("mNext");
    if (img) img.src = imgs[idx] || "";
    var multi = imgs.length > 1;
    if (prev) prev.style.display = multi ? "" : "none";
    if (next) next.style.display = multi ? "" : "none";
  }

  // ── Detector de clic robusto ───────────────────────────────
  document.addEventListener("click", function (e) {
    // No interferir con las flechas del mini-carrusel de la tarjeta
    if (e.target.closest && e.target.closest(".img-nav")) return;

    var zone = e.target.closest ? e.target.closest(".item-img") : null;
    if (!zone) return;

    var collected = [];
    var startIdx = 0;

    if (zone.dataset && zone.dataset.imgs) {
      try { collected = JSON.parse(zone.dataset.imgs); } catch (err) { collected = []; }
    }

    if (!collected.length) {
      var imgEl = zone.querySelector("img");
      if (imgEl && imgEl.src) collected = [imgEl.src];
    }

    if (!collected.length) return;

    var visible = zone.querySelector("img");
    if (visible && collected.length > 1) {
      var pos = collected.indexOf(visible.getAttribute("src"));
      if (pos === -1) pos = collected.indexOf(visible.src);
      if (pos >= 0) startIdx = pos;
    }

    e.preventDefault();
    e.stopPropagation();
    window.openMod(collected, startIdx);
  }, true);

  // Cerrar con clic en cualquier parte excepto la imagen o las flechas
  document.addEventListener("click", function (e) {
    var ov = el("modalOv");
    if (!ov || !ov.classList.contains("open")) return;
    if (justOpened) return; // ignorar el mismo clic que abrió
    if (swiped) { swiped = false; return; } // ignorar clic generado por swipe
    // Si el modal está abierto y el clic NO fue en la imagen ni en una flecha, cerrar
    var onImg  = e.target.id === "modImg";
    var onNav  = e.target.closest && (e.target.closest("#mPrev") || e.target.closest("#mNext"));
    if (!onImg && !onNav) window.closeMod();
  });

  document.addEventListener("keydown", function (e) {
    var ov = el("modalOv");
    if (!ov || !ov.classList.contains("open")) return;
    if (e.key === "Escape")     window.closeMod();
    if (e.key === "ArrowLeft")  window.mChg(-1);
    if (e.key === "ArrowRight") window.mChg(1);
  });

  // ── Swipe táctil para móvil (deslizar para cambiar de foto) ──
  (function () {
    var startX = 0, startY = 0, tracking = false;
    var MIN_DIST = 45; // píxeles mínimos para contar como swipe

    function onStart(e) {
      var ov = el("modalOv");
      if (!ov || !ov.classList.contains("open")) return;
      var t = e.touches ? e.touches[0] : e;
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
    }

    function onEnd(e) {
      if (!tracking) return;
      tracking = false;
      var t = e.changedTouches ? e.changedTouches[0] : e;
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      // Solo si el movimiento es más horizontal que vertical
      if (Math.abs(dx) > MIN_DIST && Math.abs(dx) > Math.abs(dy)) {
        swiped = true; // evita que el clic posterior cierre el modal
        if (dx < 0) window.mChg(1);   // desliza izquierda → siguiente
        else        window.mChg(-1);  // desliza derecha → anterior
      }
    }

    var ov = document.getElementById("modalOv");
    if (ov) {
      ov.addEventListener("touchstart", onStart, { passive: true });
      ov.addEventListener("touchend", onEnd, { passive: true });
    }
  })();

})();
