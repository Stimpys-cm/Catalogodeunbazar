# Resultados v53 (20 nov 2026)

Texto de Instagram corto, sin WhatsApp, máximo 5 hashtags y link corto `/p/<id>`.

| Prueba | Resultado |
|---|---|
| `node pruebas/correr.mjs` (servidor, base en memoria; incluye `v53-instagram.mjs`) | 769 de 769 |
| `pruebas/v53-instagram.mjs` | 30 de 30 (texto corto, sin teléfonos, 5 hashtags, ajustes, publicar, panel = servidor en 12 combinaciones, link corto) |
| `pruebas/v53-navegador.py` (compu y celular) | 30 de 30 |
| `pruebas/v49-navegador.py` | 46 de 46 |
| `pruebas/v40-xss.py` | 24 de 24 |
| `pruebas/v34-navegador.py` | 38 de 38 |
| `pruebas/v52-navegador.py`, `v48-navegador.py` (v52.1) | 34 y 35, sin fallas |

Instagram (Graph API) simulado. Límite de 5 hashtags: anunciado por Instagram en dic 2025.
