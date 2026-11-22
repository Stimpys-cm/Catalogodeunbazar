# Resultados de pruebas · v40 (orden, velocidad y seguridad)

Fecha: 2026-11-18. Chrome real (Playwright) y servidor local con base en memoria.

| Grupo | Resultado |
|---|---|
| Paquetes css/dist y js/dist al día (`herramientas/construir.mjs --revisar`, dentro de correr.mjs) | **OK** |
| v40 · seguridad del servidor y del middleware (pruebas/v40-seguridad.mjs) | **54 de 54** |
| v40 · XSS guardado: código en nombre, oferta, aviso y pedido; tienda, recibo y todo el panel (pruebas/v40-xss.py) | **24 de 24** |
| v39 · estética y una sola tienda en el navegador | **80 de 80** |
| v39 · una sola tienda en el servidor | **28 de 28** |
| v38 · acomodo (ahora con las letras reales) | **117 de 117** |
| v37 · carrito y pago por pasos | **42 de 42** |
| v36 · contadores (navegador) | **22 de 22** |
| v36 · apartado de 10 minutos (servidor) | **25 de 25** |
| v35 · carrito | **50 de 50** |
| v34 · panel | **38 de 38** |
| v33 · navegador | **56 de 56** |
| v33 · servidor | **90 de 90** |
| v32 · pagos, seguridad y middleware | **37 de 37** |

Total: 663 de 663. Funciones de Vercel: 12.

Además, antes de entregar se comparó el estilo calculado de cada elemento (todas las propiedades
de CSS, más su caja) en 12 páginas de la tienda y 8 vistas del panel, a 1440 y 390 px, entre la
v39 y la v40. Fuera de diferencias de menos de un píxel por cómo se dibuja la letra y de dos
degradados escritos más corto (que se ven igual), no cambió nada: juntar y comprimir los archivos
no movió ni un estilo.

Notas
- Las pruebas de navegador ahora usan las letras propias (css/fuentes). Antes corrían sin Bebas
  Neue (Google Fonts está bloqueado aquí) y por eso no veían que, en tableta, el título del inicio
  quedaba centrado. Eso se arregló (ver LEEME.txt).
- v36 a veces se queda esperando "networkidle" en pagar.html (la tienda consulta el servidor cada
  pocos segundos); al repetirla pasa completa. Ya pasaba antes de la v40.
