# Resultados de pruebas · v38 (todo alineado)

Fecha: 2026-11-18. Chrome real (Playwright), con DM Sans y Bebas Neue locales para medir igual que en el sitio.

| Grupo | Resultado |
|---|---|
| v38 · acomodo (pruebas/v38-acomodo.py) | **105 de 105** |
| v37 · carrito y pago por pasos (pruebas/v37-checkout.py) | **42 de 42** |
| v36 · navegador: contadores (pruebas/v36-navegador.py) | **22 de 22** |
| v35 · carrito (pruebas/v35-carrito.py) | **50 de 50** |
| v34 · panel (pruebas/v34-navegador.py) | **38 de 38** |
| v33 · navegador (pruebas/v33-navegador.py) | **56 de 56** |
| Servidor (node pruebas/correr.mjs) | **152 de 152** |

Total: 465 de 465. Funciones de Vercel: 12.

Qué revisa v38-acomodo.py
- En 1440, 1280, 1024, 768, 390 y 360 px, en inicio, tienda, prenda, redes, cuenta, vender y carrito: el logo, el contenido de cada sección, los banners y el pie empiezan (y donde aplica terminan) exactamente en el mismo margen, y no hay scroll de lado.
- Inicio en compu: hero en dos columnas iguales y centradas, sin "Explorar / Catálogo", mismo espacio entre las secciones, esquinas de 16 px en tarjetas y 24 px en bloques, punto del logo pegado, año del pie al día.
- Inicio en 390, 360 y 320 px: texto de arriba del título a la izquierda, botones del hero del mismo ancho, logo en una línea y nada del encabezado fuera de la pantalla.
- Estadísticas: si el inventario cambia mientras cuentan, terminan con el mismo número que la tarjeta del hero (antes fallaba: 12 contra 9).

Medición antes / después (borde izquierdo del contenido)
| Ancho | Encabezado | Hero | Secciones | Banners | Pie |
|---|---|---|---|---|---|
| 1280 antes | 40 | 40 | 20 | 60 | 40 |
| 1280 después | 40 | 40 | 40 | 40 | 40 |
| 1440 antes | 40 | 60 | 100 | 140 | 60 |
| 1440 después | 120 | 120 | 120 | 120 | 120 |
| 390 antes | 14 | 16 | 16 | 16 | 16 |
| 390 después | 16 | 16 | 16 | 16 | 16 |
