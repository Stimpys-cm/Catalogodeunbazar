/* ─────────────────────────────────────────────────────────────
   js/tema.js — Tema del panel (claro / oscuro / automático) y acento · v34
   Va en <head> SIN defer: pone el tema antes de pintar, así nunca
   se ve un destello blanco al abrir el panel en modo oscuro.
   Se guarda en este navegador (stmp-tema, stmp-acento) y, si hay
   sesión, también en tu cuenta (Tema.sincronizar, desde panel-app.js).
   ───────────────────────────────────────────────────────────── */
(function () {
  var MODOS = ['auto', 'claro', 'oscuro'];
  var ACENTOS = ['azul', 'grafito', 'esmeralda', 'violeta', 'coral'];
  var html = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function leer(k, def, lista) { try { var v = localStorage.getItem(k); return lista.indexOf(v) >= 0 ? v : def; } catch (e) { return def; } }
  var modo = leer('stmp-tema', 'auto', MODOS);
  var acento = leer('stmp-acento', 'azul', ACENTOS);
  var oyentes = [];

  function resuelto() { return modo === 'auto' ? (media && media.matches ? 'oscuro' : 'claro') : modo; }
  function metaColor(c) {
    var m = document.querySelector('meta[name="theme-color"]:not([media])');
    if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; (document.head || html).appendChild(m); }
    m.content = c;
  }
  function aplicar(animar) {
    var t = resuelto();
    if (animar) {
      html.classList.add('tema-cambiando');
      setTimeout(function () { html.classList.remove('tema-cambiando'); }, 320);
    }
    html.setAttribute('data-tema', t);
    html.setAttribute('data-acento', acento);
    html.setAttribute('data-tema-modo', modo);
    metaColor(t === 'oscuro' ? '#0c0c0e' : '#f4f2ee');
    for (var i = 0; i < oyentes.length; i++) { try { oyentes[i](t, modo, acento); } catch (e) {} }
  }
  aplicar(false);
  if (media) {
    var cambio = function () { if (modo === 'auto') aplicar(true); };
    if (media.addEventListener) media.addEventListener('change', cambio); else if (media.addListener) media.addListener(cambio);
  }

  window.Tema = {
    MODOS: MODOS, ACENTOS: ACENTOS,
    get modo() { return modo; }, get acento() { return acento; }, get actual() { return resuelto(); },
    poner: function (m, opciones) {
      if (MODOS.indexOf(m) < 0) return;
      modo = m; try { localStorage.setItem('stmp-tema', m); } catch (e) {}
      aplicar(true);
      if (!(opciones && opciones.silencio) && window.Tema.alGuardar) window.Tema.alGuardar();
    },
    ponerAcento: function (a, opciones) {
      if (ACENTOS.indexOf(a) < 0) return;
      acento = a; try { localStorage.setItem('stmp-acento', a); } catch (e) {}
      aplicar(true);
      if (!(opciones && opciones.silencio) && window.Tema.alGuardar) window.Tema.alGuardar();
    },
    alternar: function () { window.Tema.poner(resuelto() === 'oscuro' ? 'claro' : 'oscuro'); },
    alCambiar: function (fn) { oyentes.push(fn); },
    alGuardar: null,
  };
})();
