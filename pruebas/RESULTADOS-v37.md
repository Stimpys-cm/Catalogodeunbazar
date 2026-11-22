# Resultados de pruebas · v37 (carrito y pago estilo Mercado Libre / Amazon)

Fecha: 2026-11-18. Chrome real (Playwright) y servidor local con base en memoria.

| Grupo | Resultado |
|---|---|
| v37 · carrito, hoja "Agregaste a tu carrito" y pago por pasos (pruebas/v37-checkout.py) | **42 de 42** |
| v36 · navegador: contadores (pruebas/v36-navegador.py) | **22 de 22** |
| v35 · carrito y panel lateral (pruebas/v35-carrito.py, actualizada a la página nueva) | **50 de 50** |
| v34 · rediseño del panel (pruebas/v34-navegador.py) | **38 de 38** |
| v33 · navegador (pruebas/v33-navegador.py) | **56 de 56** |
| Servidor v32–v37 (node pruebas/correr.mjs, incluye v36-apartado con la prueba nueva de v-cotizar) | **152 de 152** |

Total: 360 de 360. Funciones de Vercel: 12.

Qué revisa v37-checkout.py
- Ficha (compu y celular): "Agregar al carrito" abre la hoja con subtotal de 2 prendas, "Ir a pagar" y "Ver carrito"; en celular la hoja sube desde abajo y la barra fija trae carrito + "Comprar ahora".
- Carrito: paso actual, prendas disponibles, vendida en "No disponibles ahora", total igual al del servidor, descuento por volumen, barra de avance, recomendaciones, cupón inválido, "Quitarlas", "Eliminar", "Agregar" desde recomendaciones y "Continuar compra" → pagar.html.
- Pago (compu y celular): pasos Carrito ✓ / Entrega y pago / Confirmación, secciones 1·2·3, botón de pagar en el resumen y "Modificar carrito"; en celular la barra fija se esconde al ver el botón principal y su botón valida igual que el principal.
- Encabezado → carrito.html y carrito vacío con "Descubrir prendas". Sin errores de JavaScript en ninguna página.

Pendiente de probar en producción (no se puede aquí): cobro real con Clip y PayPal desde la página nueva, y fotos reales de Cloudinary (en este entorno no cargan).
