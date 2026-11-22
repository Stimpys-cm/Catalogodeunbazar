# Resultados v51 — HEIC visibles, elegir carpeta y aviso con .rar

Fecha: 20 nov 2026.

| Suite | Resultado |
|---|---|
| Servidor (`node pruebas/correr.mjs`) | 717 / 717 |
| v51-navegador (nueva) | 10 / 10 |
| v50-navegador | 37 / 37 |
| v49-navegador | 46 / 46 |
| v48-navegador | 35 / 35 |
| v46-navegador | 13 / 13 |
| v45-navegador | 36 / 36 |
| v44-navegador | 21 / 21 |
| v40-xss | 24 / 24 |

Las demás suites de navegador (v33–v39, v41–v43) no tocan lo que cambió (importador del panel); pasaron en la v50 (1426 de 1426).

## Qué revisa v51-navegador.py
Botón "Elegir una carpeta" (`webkitdirectory`); `.rar` en la ventana para elegir; un `.rar` solo da un aviso con qué hacer; elegir una carpeta real con 6 HEIC + `._IMG` + `notas.txt` toma solo las 6 fotos como una sola carpeta; las HEIC se ven al subir (miniatura de Cloudinary en JPG) y se quita el aviso; soltar una carpeta con subcarpetas da una prenda por subcarpeta; sin errores.
