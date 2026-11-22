# Resultados de pruebas · v39 (solo Stiimpys, misma estética del inicio, sin transparencias)

Fecha: 2026-11-18. Chrome real (Playwright) y servidor local con base en memoria.

| Grupo | Resultado |
|---|---|
| v39 · estética, marca y "una sola tienda" en el navegador (pruebas/v39-estetica.py) | **80 de 80** |
| v39 · una sola tienda en el servidor (pruebas/v39-una-tienda.mjs, dentro de correr.mjs) | **28 de 28** |
| v38 · acomodo (pruebas/v38-acomodo.py, ahora también con la página de pago) | **117 de 117** |
| v37 · carrito y pago por pasos (pruebas/v37-checkout.py) | **42 de 42** |
| v36 · contadores (pruebas/v36-navegador.py) | **22 de 22** |
| v35 · carrito (pruebas/v35-carrito.py, términos actualizados) | **50 de 50** |
| v34 · panel (pruebas/v34-navegador.py) | **38 de 38** |
| v33 · navegador (pruebas/v33-navegador.py) | **56 de 56** |
| Servidor v32–v36 (node pruebas/correr.mjs, sin contar v39) | **152 de 152** |

Total: 585 de 585. Funciones de Vercel: 12.

Qué revisa v39
- Servidor: lo público solo trae prendas, reseñas y subastas de Stiimpys; no se puede cotizar, pagar, ofertar ni pedir aviso de una prenda de otro bazar; "Vende con nosotros" responde 410; la ficha para robots dice "Stiimpys"; el sitemap no trae "Los bazares", "Vende con nosotros" ni prendas de otros bazares; /redes, /vender e /index llevan al inicio; con MULTI_BAZAR=1 todo vuelve como antes; el panel sigue viendo todo.
- Navegador, en inicio, catálogo, ficha, cuenta, términos, carrito y pago: misma cinta, logo STIIMPYS. al inicio, mismo encabezado y botón negro, mismo pie oscuro, sin "STMP MARKET" ni textos de otros bazares, sin enlaces a "Los bazares"/"Vende con nosotros"; títulos con el fondo del inicio; al pasar el mouse nada baja su opacidad; sin etiqueta de bazar en las tarjetas; buscar desde Términos abre el catálogo filtrado; carrito viejo con prenda de otro bazar; 404; barra de abajo Inicio · Carrito · Cuenta; sin errores de JavaScript.

Nota: una corrida de v36 falló una vez por tiempo de espera de la red (las fotos de Cloudinary y Google Fonts están bloqueadas en este entorno); al repetirla pasó completa.
