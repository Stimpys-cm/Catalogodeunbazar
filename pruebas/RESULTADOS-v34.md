# Resultados de pruebas · v34 (rediseño del panel)

Fecha: 2026-11-18 · Chrome real contra el servidor local (API real + base en memoria).

| Grupo | Resultado |
|---|---|
| v34 · rediseño, temas y app de celular (pruebas/v34-navegador.py) | **38 de 38** |
| v33 · navegador: páginas públicas, Sistema, Actividad, pedidos (pruebas/v33-navegador.py) | **56 de 56** |
| Servidor: pagos, pedidos, seguridad, middleware (node pruebas/correr.mjs) | **127 de 127** (90 + 22 + 11 + 4) |

Funciones de Vercel: 12 (sin cambios).

## Detalle v34

```
PASS tema claro: aplicado antes de pintar el cuerpo
PASS tema claro: fondo del panel correcto (rgb(244, 242, 238))
PASS tema oscuro: aplicado antes de pintar el cuerpo
PASS tema oscuro: fondo del panel correcto (rgb(12, 12, 14))
PASS automático: dispositivo oscuro → panel oscuro
PASS automático: el dispositivo cambia a claro → el panel también, sin recargar
PASS automático: la barra del navegador acompaña al tema
PASS menú lateral: selector Automático / Claro / Oscuro
PASS menú lateral: cambia a oscuro y se guarda
PASS Mi cuenta: tarjeta Apariencia marca el tema actual
PASS acento esmeralda aplicado y guardado ['esmeralda', 'esmeralda', '#34c78a']
PASS los dos selectores quedan sincronizados
PASS encabezado translúcido se marca al hacer scroll
PASS computadora: sin errores ni 404 [] []
PASS celular: barra de pestañas con 5 botones
PASS celular: sin menú hamburguesa (lo reemplazan las pestañas)
PASS celular: la pestaña abre su sección y queda marcada
PASS celular: el título grande pasa a la barra de arriba
PASS celular: contenido a todo el ancho (0, 390)
PASS celular: "Más" abre la hoja
PASS "Más": todas las secciones del menú (17)
PASS "Más": cambiar a oscuro desde la hoja
PASS "Más": ir a Sistema cierra la hoja
PASS sección fuera de la barra → se marca "Más"
PASS celular: el diálogo sale como hoja desde abajo [844, 844, 0, 390]
PASS celular: deslizar hacia abajo cierra el diálogo
PASS celular: campos de 16 px (iOS no hace zoom)
PASS celular: sin errores ni 404 [] []
PASS [claro · compu] 14 secciones sin errores ni 404 [] []
PASS [claro · compu] texto con contraste ≥ 3:1 en todas las secciones []
PASS [claro · celular] 14 secciones sin errores ni 404 [] []
PASS [claro · celular] texto con contraste ≥ 3:1 en todas las secciones []
PASS [oscuro · compu] 14 secciones sin errores ni 404 [] []
PASS [oscuro · compu] texto con contraste ≥ 3:1 en todas las secciones []
PASS [oscuro · celular] 14 secciones sin errores ni 404 [] []
PASS [oscuro · celular] texto con contraste ≥ 3:1 en todas las secciones []
PASS vendedor: no ve secciones de admin en pestañas ni en "Más" ['inventario', 'registrar', 'ventas', 'instagram', '__mas', 'cuenta', 'inventario', 'registrar', 'drops', 'subastas', 'bazares', 'anuncios', 'instagram', 'marketplace', 'ventas', 'estudio', 'ganancias', 'cuenta']
PASS vendedor: sin errores []

RESULTADO v34: 38 de 38
```
