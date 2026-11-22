# Resultados v52 — Borradores y agregar más fotos

Fecha: 20 nov 2026.

| Suite | Resultado |
|---|---|
| Servidor (`node pruebas/correr.mjs`, v32–v52) | 738 / 738 |
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
| v49-navegador | 46 / 46 (la prueba ahora desplaza la tira a la vista antes de arrastrar: la barra nueva de "Revisar" la empujó hacia abajo) |
| v50-navegador | 37 / 37 |
| v51-navegador | 10 / 10 |
| **v52-navegador (nueva)** | **31 / 31** |
| **Total** | **1488 / 1488** |

`v52-borradores.mjs` (21) va dentro de la suite del servidor.

## Qué revisan
- **v52-borradores.mjs:** guardar (válidos, id raro, fotos fuera de Cloudinary, textos limpios y con tope, precio), actualizar sin duplicar (conserva `en`), el mismo pedido dos veces no da 409, IA demasiado grande se recorta, máx. 50 por vez, cada bazar lo suyo (no puede cambiar ni borrar los de otro), admin global ve todos y filtra, borrar, sin sesión 401, solo POST, tope de 2,000 por bazar (y aun así se actualizan los existentes).
- **v52-navegador.py:** menú "Borradores"; "Agregar más fotos" en Agrupar (sin repetir); al subir, un borrador por prenda con IA y lote; globito; editar actualiza; "+ Fotos" en una tarjeta (borrador con 3 fotos) y "Volver a analizar"; "Agregar más prendas" en Revisar; guardar quita el borrador y la prenda queda con sus fotos; la sección lista todo; "Registrar" abre en Revisar ya analizado y al guardar sale; borrador sin IA se analiza al abrirlo; textos con código como texto; seleccionar y borrar con confirmación; celular (abre por `#borradores`, sin desbordes, dos por fila).


## v52.1
Arreglo de la tarjeta de Revisar ("＋ Fotos" rompía la cuadrícula). `v52-navegador.py` pasa de 31 a 34 pruebas (posición del formulario, de los botones y ancho de los campos); v48 y v49 de navegador se volvieron a correr: 35 y 46 sin fallas. Total 1491 de 1491.
