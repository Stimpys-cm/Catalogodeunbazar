# Resultados v58 (20 nov 2026)

Publicaciones de Instagram atoradas ("Ya se está publicando…" para siempre) y sección "Con problemas".

| Prueba | Resultado |
|---|---|
| `node pruebas/correr.mjs` (servidor; incluye `v58-publicar.mjs`) | 908 de 908 |
| `pruebas/v58-publicar.mjs` | 25 de 25 (candado viejo/vencido se toma, uno reciente bloquea con mensaje, recupera post que sí salió sin duplicar, 706 ≠ 7060, error guardado e intentos, tienda sin campos internos, carrusel en paralelo, tope de tiempo sin publicar, Con problemas, destrabar/cancelar, reintentar programados sin duplicar, rescate automático) |
| `pruebas/v58-navegador.py` (compu y celular) | 24 de 24 |
| v33, v34, v38, v40-xss, v42–v45, v48–v50, v52–v57 | sin fallas |

API de Instagram simulada (registra contenedores, publicaciones y cuántas fotos suben a la vez).
