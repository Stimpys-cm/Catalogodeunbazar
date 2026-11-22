# Resultados v55 (20 nov 2026)

Formas de pago desde una sola configuración e Instagram conectado con la tienda y el panel.

| Prueba | Resultado |
|---|---|
| `node pruebas/correr.mjs` (servidor; incluye `v55-conexiones.mjs`) | 827 de 827 |
| `pruebas/v55-conexiones.mjs` | 37 de 37 (Caja → VENDIDA en post y drop, anular/revertir → se borra, precio → un comentario vigente, texto viejo, borrar/restaurar, venta en línea y rebaja usan lo mismo, formas de pago en tienda/Instagram/panel, caché de 5 s) |
| `pruebas/v55-navegador.py` (compu y celular) | 35 de 35 |
| `v38-acomodo.py`, `v39-estetica.py`, `v37-checkout.py`, `v35-carrito.py`, `v36-navegador.py` | 93, 80, 42, 48, 22 sin fallas |
| `v40-xss.py`, `v41`, `v42`, `v43`, `v34`, `v33` | 24, 21, 57, 42, 38, 54 sin fallas |
| `v49`, `v53`, `v54` (Instagram) | 46, 30, 20 sin fallas |

API de Instagram simulada (registra cada comentario y borrado). La API de Instagram no permite editar el texto de un post publicado: por eso los cambios se avisan con comentarios.
