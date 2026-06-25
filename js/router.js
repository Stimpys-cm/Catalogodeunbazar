/* ============================================================
   router.js — URLs bonitas + botón atrás para el panel admin
   Se conecta con tu showTab() existente SIN modificar admin.js.
   Rutas:
     /admin/inventario
     /admin/registrar
     /admin/catalogo
     /admin/vendedores
     /admin/drops
     /admin/cuenta
     /admin/inventario/{idDeMongo}   (prenda individual)
   ============================================================ */
(function () {
  "use strict";

  var BASE = "/admin";
  var TABS = ["inventario", "registrar", "catalogo", "vendedores", "drops", "cuenta"];

  // Evita bucles: cuando el router llama a showTab, no queremos
  // que showTab vuelva a empujar otra entrada al historial.
  var silent = false;

  // 1) Envolver showTab existente -------------------------------
  function wrapShowTab() {
    if (typeof window.showTab !== "function") return false;
    var original = window.showTab;

    window.showTab = function (tab) {
      var result = original.apply(this, arguments);
      if (!silent) {
        pushUrl(BASE + "/" + tab);
      }
      return result;
    };
    return true;
  }

  // 2) Empujar URL al historial ---------------------------------
  function pushUrl(path) {
    if (window.location.pathname === path) return;
    history.pushState({ path: path }, "", path);
  }

  function replaceUrl(path) {
    history.replaceState({ path: path }, "", path);
  }

  // 3) Llamar a showTab sin re-empujar al historial -------------
  function goSilently(tab) {
    silent = true;
    try {
      if (typeof window.showTab === "function") window.showTab(tab);
    } finally {
      silent = false;
    }
  }

  // 4) Abrir una prenda por ID (si tienes esa función) ----------
  //    Busca automáticamente una función para abrir prenda.
  //    Ajusta el nombre si la tuya se llama distinto.
  function openItem(id) {
    var fn = window.openItemDetail || window.openPrenda ||
             window.viewItem || window.editItem || window.openProduct;
    if (typeof fn === "function") {
      fn(id);
    } else {
      // Si no hay función de detalle, al menos muestra inventario.
      goSilently("inventario");
      console.warn("[router] No encontré función para abrir la prenda " + id +
                   ". Define window.openItemDetail(id) en admin.js.");
    }
  }

  // 5) Interpretar la URL actual y mostrar lo correcto ----------
  function applyRoute(fromPopstate) {
    var path = window.location.pathname;       // ej: /admin/inventario/123
    var parts = path.replace(/^\/+|\/+$/g, "").split("/"); // ["admin","inventario","123"]

    // Si no estamos bajo /admin, no hacemos nada.
    if (parts[0] !== "admin") return;

    var tab = parts[1] || "inventario";
    var id  = parts[2] || null;

    if (TABS.indexOf(tab) === -1) tab = "inventario";

    goSilently(tab);

    if (id) {
      // pequeña espera por si el inventario carga async desde Mongo
      setTimeout(function () { openItem(id); }, 60);
    }
  }

  // 6) Botón atrás / adelante del navegador ---------------------
  window.addEventListener("popstate", function () {
    applyRoute(true);
  });

  // 7) Helper para abrir prenda con URL bonita ------------------
  //    Llama esto desde tu código cuando alguien hace clic en una prenda:
  //    Router.openItemUrl(id)
  window.Router = {
    openItemUrl: function (id) {
      pushUrl(BASE + "/inventario/" + id);
    },
    goTab: function (tab) {
      if (typeof window.showTab === "function") window.showTab(tab);
    }
  };

  // 8) Arranque -------------------------------------------------
  function init() {
    var ok = wrapShowTab();
    if (!ok) {
      // admin.js aún no definió showTab; reintenta.
      return setTimeout(init, 80);
    }

    // Normaliza la URL de entrada:
    var path = window.location.pathname;
    if (path === "/admin.html" || path === "/admin" || path === "/admin/") {
      replaceUrl(BASE + "/inventario");
      goSilently("inventario");
    } else if (path.indexOf("/admin/") === 0) {
      applyRoute(false);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
