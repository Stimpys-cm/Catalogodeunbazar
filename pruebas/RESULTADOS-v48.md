# Resultados v48 — orden de prendas y fotos en "Agrupar"

Fecha: 19 nov 2026.

| Suite | Resultado |
|---|---|
| Servidor (`node pruebas/correr.mjs`, v32–v47) | 649 / 649 |
| v33-navegador | 54 / 54 |
| v34-navegador | 38 / 38 |
| v35-carrito | 48 / 48 |
| v36-navegador | 22 / 22 |
| v37-checkout | 42 / 42 |
| v38-acomodo | 93 / 93 |
| v39-estetica | 80 / 80 |
| v40-xss | 24 / 24 |
| v41-navegador | 21 / 21 |
| v42-navegador | 57 / 57 |
| v43-navegador | 42 / 42 |
| v44-navegador | 21 / 21 |
| v45-navegador | 36 / 36 |
| v46-navegador | 13 / 13 |
| **v48-navegador (nueva)** | **35 / 35** |
| **Total** | **1275 / 1275** |

## Qué revisa v48-navegador.py
- Computadora: ▲ ▼ (con límites arriba/abajo), arrastrar el número, arrastrar hasta la orilla (la lista baja sola), la lista no regresa arriba, Escape cancela, clic sin arrastrar no mueve, foto a portada, foto a otra prenda, soltar en espacio vacío, prenda sin fotos se quita, soltar fuera no cambia, ✂ y ✕ siguen funcionando, empezar sobre un botón no arrastra, el orden se respeta en "Revisar", fuera de "Agrupar" no se puede mover, sin errores.
- Celular (390 px, táctil): se ven ▲ ▼ y el número con tamaño cómodo, nada se sale a lo ancho, ▼ con el dedo, arrastrar el número con el dedo, deslizar rápido solo desplaza, mantener presionado y mover cambia la portada sin desplazar la lista.
