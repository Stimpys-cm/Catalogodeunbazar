# Resultados v50 — Separar con IA

Fecha: 20 nov 2026.

| Suite | Resultado |
|---|---|
| Servidor (`node pruebas/correr.mjs`, v32–v50) | 717 / 717 |
| v33-navegador | 54 / 54 |
| v34-navegador | 38 / 38 |
| v35-carrito | 48 / 48 |
| v36-navegador | 22 / 22 (sola con servidor recién iniciado; en tanda a veces se queda esperando `networkidle` en pagar.html, como ya pasaba) |
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
| v49-navegador | 46 / 46 |
| **v50-navegador (nueva)** | **37 / 37** |
| **Total** | **1426 / 1426** |

`v50-agrupar.mjs` (30) va dentro de la suite del servidor.

## Qué revisan
- **v50-agrupar.mjs:** fotos numeradas en orden y en miniatura de 320 px; instrucciones; modelo preciso con caché de instrucciones (rápido en "Ahorro"); tramos que empiezan en otra foto; limpieza (rangos, "Foto 7", repetidas, fuera de rango, sin decidir, "x", nombre sin código, seguridad); reintento si dejó más de la mitad sin decidir; error claro; saturada → modelo rápido; sin saldo → 402 y marcado; memoria gratis; dos pedidos iguales pagan uno; uso y saldo; sesión, solo Cloudinary, 2–48 fotos, sin llave.
- **v50-navegador.py:** ZIP como el DROP 19-11 (126 fotos, 31 prendas, horas reales de ejemplo): por hora 13 grupos mezclados, con IA 31 exactas en 4 tramos encimados; nombre por fila; aviso con gasto; repetir gratis; otra forma de agrupar. Casos raros: etiqueta tomada después, foto sin decidir, "no parece ropa", dudosa. Cancelar mientras sube (no gasta). Varias carpetas y opción apagada (no usa IA). Sin saldo (agrupa por hora). Celular.
