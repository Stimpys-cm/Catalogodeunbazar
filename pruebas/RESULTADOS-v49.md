# Resultados v49 — orden de fotos, portada repetida en Instagram y detalles de la IA

Fecha: 19 nov 2026.

| Suite | Resultado |
|---|---|
| Servidor (`node pruebas/correr.mjs`, v32–v49) | 687 / 687 |
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
| v48-navegador | 35 / 35 |
| **v49-navegador (nueva)** | **46 / 46** |
| **Total** | **1359 / 1359** |

`v49-detalles.mjs` (38) va dentro de la suite del servidor.

## Qué revisan
- **v49-detalles.mjs:** instrucciones de detalles y fallas con foto; detalles, fallas y `fallasFoto` (URL) en la respuesta; descripción con lista de detalles y "A considerar"; formatos desordenados (texto con ; • ·, objetos {t,f}, "ninguna", foto inexistente, repetidos, más de 8, textos largos, basura); memoria gratis con detalles; `carruselConPortada`; publicar prenda (4 fotos de 3, la 2ª es la misma sin textos, apagado, sin plantilla, 10 máx.); `ig-publicar` desde el panel; `ig-config` guarda `portadaSola`.
- **v49-navegador.py:** la IA respeta la portada acomodada en Agrupar y elige en las demás; detalles y fallas en la tarjeta (texto escapado, "foto 3" resalta); arrastrar, ← →, tocar = portada y guardar en "Revisar"; Registrar (arrastrar, ★, teclado, ✕, foto que termina de subir tras quitar/mover); Editar (arrastrar y guardar); Instagram Ajustes y vista previa de Crear; celular (mantener presionado en Revisar y Registrar, deslizar solo desplaza).

## Ajuste a pruebas viejas
- `v44-ia.mjs`: las fallas ahora llegan con mayúscula inicial ("Mancha en la manga").
