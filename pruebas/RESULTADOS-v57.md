# Resultados v57 (20 nov 2026)

SEO (auditoría de SEOptimer: B-, título 65, descripción 198, H1→H3, 1 imagen sin alt, redirección extra, sin llms.txt) y barrido de errores.

| Prueba | Resultado |
|---|---|
| `node pruebas/correr.mjs` (servidor; incluye `v57-seo.mjs`) | 883 de 883 |
| `pruebas/v57-seo.mjs` | 22 de 22 (sin redirección de "/", canónica en la raíz, títulos ≤ 60, descripciones 120–160, sitemap, llms.txt) |
| `pruebas/v57-navegador.py` (compu y celular) | 83 de 83 (1 H1 por página, sin saltos, alt, ids, 0 links rotos, FAQ de pagos, 15 secciones del panel + Ventas sin errores) |
| v33–v56 de navegador | sin fallas (v36 ahora espera `load` en lugar de `networkidle`; también fallaba con el paquete v56) |

Antes de cambiar etiquetas de encabezados se comparó el estilo calculado (tamaño, letra, márgenes, color) de cada uno: idéntico en compu y celular.
v32-seguridad: el sitemap ahora pone la portada en la raíz. v39-estetica: el pie usa `h2`.
