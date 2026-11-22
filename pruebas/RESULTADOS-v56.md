# Resultados v56 (20 nov 2026)

Incongruencias entre Instagram, tienda y panel + tarjeta del inventario.

| Prueba | Resultado |
|---|---|
| `node pruebas/correr.mjs` (servidor; incluye `v56-congruencia.mjs`) | 861 de 861 |
| `pruebas/v56-congruencia.mjs` | 34 de 34 (apartado vencido en tienda y sync, aviso único, apartar/liberar/vender en Instagram, rebaja vs. corrección, programados con precio del día y sin vendidas, cobro = formas de pago, renombrar en prendas, modo en el panel) |
| `pruebas/v56-navegador.py` (compu y celular) | 23 de 23 (tarjeta sin chip y con botones en una fila, opción de rebaja, renombrar, WhatsApp del pie) |
| v33, v34, v40-xss, v41, v42, v43, v55 | 54, 38, 24, 21, 57, 42, 35 sin fallas |
| v35, v36, v37, v38, v39 | 48, 22, 42, 93, 80 sin fallas |
| v44, v45, v46, v48, v49, v50, v51, v52, v53, v54 | 21, 36, 13, 35, 46, 37, 10, 34, 30, 20 sin fallas |

API de Instagram simulada.
