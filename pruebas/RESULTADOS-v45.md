# Resultados de pruebas — v45 (agente investigador y catálogo nuevo)

19 nov 2026. Base en memoria; Anthropic (con búsqueda web), tipo de cambio y Cloudinary simulados.

| Suite | Correctas |
|---|---|
| paquetes al día | ✔ |
| v45-agente.mjs | 53 |
| v44-ia.mjs | 86 |
| v43-funciones.mjs | 85 |
| v42-funciones.mjs | 85 |
| v41-funciones.mjs | 51 |
| v40-seguridad.mjs | 54 |
| v39-una-tienda.mjs | 28 |
| v36-apartado.mjs | 25 |
| v33-servidor.mjs | 90 |
| v32-pagos.mjs | 22 |
| v32-seguridad.mjs | 11 |
| v32-middleware.mjs | 4 |
| **Servidor** | **594** |
| v33 54 · v34 38 · v35 48 · v36 22 · v37 42 · v38 93 · v39 80 · v40-xss 24 · v41 21 · v42 57 · v43 42 · v44 20 · v45 36 | |
| **Navegador** | **577** |
| **Total** | **1171 de 1171** |

## Lo que encontraron las pruebas y se corrigió
- Una sola prenda de la marca en el historial subía el precio por encima del mercado (+15 %):
  ahora el historial solo cuenta con 2+ prendas, y para piezas raras el piso es lo que sueles cobrar.
- Si la IA decía "Jersey" y no existía esa categoría, se metía en "Playeras" por el nombre:
  ahora propone la categoría nueva.
- En celular el aviso "La estás dando barata" se partía en dos columnas.
