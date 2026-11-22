// ─────────────────────────────────────────────────────────────
//  js/tienda/avisos-carrito.js — "Algo de tu carrito cambió" · v41
//
//  En cualquier página de la tienda: cuando llegan los datos del catálogo,
//  compara cada prenda del carrito con cómo estaba la última vez que este
//  navegador la vio (localStorage "stmp-carrito-visto") y avisa una sola vez:
//    · bajó de precio,
//    · volvió a estar libre (alguien más la estaba pagando o la tenía apartada),
//    · se vendió.
//  La primera vez que ve una prenda solo la anota. A los clientes con cuenta
//  también les llega por correo (api/_lib/carrito-avisos.js, tarea diaria).
// ─────────────────────────────────────────────────────────────
(function () {
  const LLAVE = 'stmp-carrito-visto';
  const pesos = n => '$' + Number(n || 0).toLocaleString('es-MX');
  const leer = k => { try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; } };
  const escribir = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  function estado(p) {
    const ahora = new Date().toISOString();
    return {
      precio: Number(p.precio_venta) || 0,
      vendido: !!p.vendido,
      apartada: !p.vendido && !!p.apartada && (!p.reservedUntil || p.reservedUntil > ahora),
      oculto: !!p.oculto,
    };
  }
  function cambio(antes, ahora) {
    if (!antes || ahora.oculto) return null;
    if (!antes.vendido && ahora.vendido) return 'vendida';
    if (ahora.vendido) return null;
    if (ahora.precio > 0 && ahora.precio < antes.precio) return 'bajo';
    if (antes.apartada && !ahora.apartada) return 'libre';
    return null;
  }

  function revisar() {
    const carrito = leer('bazar_wishlist') || [];
    const catalogo = typeof getDB === 'function' ? getDB() : [];
    if (!carrito.length || !catalogo.length) return;
    const vivo = new Map(catalogo.map(p => [String(p.id), p]));
    const visto = leer(LLAVE) || {};
    const nuevo = {}, cambios = [];
    for (const item of carrito) {
      const id = String(item?.id ?? item);
      const p = vivo.get(id);
      if (!p) { if (visto[id]) nuevo[id] = visto[id]; continue; }
      const ahora = estado(p);
      const tipo = cambio(visto[id], ahora);
      if (tipo) cambios.push({ tipo, p, antes: visto[id], ahora });
      nuevo[id] = ahora;
    }
    escribir(LLAVE, nuevo);
    if (!cambios.length || typeof toast !== 'function') return;

    const enCarrito = /carrito\.html$/.test(location.pathname);
    const ir = enCarrito ? null : () => { location.href = 'carrito.html'; };
    const texto = c => c.tipo === 'bajo' ? `"${c.p.nombre}" bajó de ${pesos(c.antes.precio)} a ${pesos(c.ahora.precio)}`
      : c.tipo === 'libre' ? `"${c.p.nombre}" volvió a estar disponible`
      : `"${c.p.nombre}" ya se vendió`;
    if (cambios.length === 1) {
      const c = cambios[0];
      toast(texto(c), { tipo: c.tipo === 'vendida' ? 'info' : 'ok', titulo: c.tipo === 'bajo' ? 'Bajó de precio algo de tu carrito' : c.tipo === 'libre' ? 'Se liberó algo de tu carrito' : 'Se vendió algo de tu carrito',
        dur: 9000, clave: 'carrito-cambio', ...(ir ? { acciones: [{ texto: 'Ver carrito', al: ir, principal: true }] } : {}) });
    } else {
      toast(`${cambios.length} cambios en tu carrito`, { tipo: 'info', titulo: 'Algo de tu carrito cambió', detalles: cambios.map(texto),
        dur: 11000, clave: 'carrito-cambio', ...(ir ? { acciones: [{ texto: 'Ver carrito', al: ir, principal: true }] } : {}) });
    }
  }

  // Cuando llegan los datos (y cada vez que el catálogo cambia mientras navega)
  let t = 0;
  const pronto = () => { clearTimeout(t); t = setTimeout(revisar, 400); };
  window.addEventListener('db:ready', pronto);
  window.addEventListener('db:inventario', pronto);
  // Al agregar una prenda se anota cómo está (sin avisar)
  window.addEventListener('wishlist:cambio', pronto);
  window.AvisosCarrito = { revisar, estado, cambio };
})();
