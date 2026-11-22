# Resultados de pruebas — v44 (registro de prendas con IA a prueba de fallas)

19 nov 2026. Base en memoria; Anthropic, Cloudinary y Vercel simulados (incluyendo sus errores).

## Antes de los cambios (código de la v43)
`pruebas/v44-ia.mjs` con el código de la v43: 25 fallas, entre ellas IA saturada (529), error 500,
red caída, respuesta tardada, 429, página de error en vez de JSON, texto con llaves antes del JSON,
JSON cortado, comas de más, texto partido en bloques (búsqueda en internet), "$450 MXN",
hashtags en lista, fallas como texto, "Excelente"/"Large", precio absurdo, "Hoodie", prenda sin
nombre ni precio, .heif rechazado y tope de 120 subidas por hora.

## Después
| Suite | Correctas |
|---|---|
| paquetes al día | ✔ |
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
| **Servidor** | **541** |
| v33-navegador.py | 54 |
| v34-navegador.py | 38 |
| v35-carrito.py | 48 |
| v36-navegador.py | 22 |
| v37-checkout.py | 42 |
| v38-acomodo.py | 93 (1 medida del pie falló una vez y pasó al repetir; no se tocó la tienda) |
| v39-estetica.py | 80 |
| v40-xss.py | 24 |
| v41-navegador.py | 21 |
| v42-navegador.py | 57 |
| v43-navegador.py | 42 |
| v44-navegador.py | 20 |
| **Navegador** | **541** |
| **Total** | **1082 de 1082** |

## v44-navegador.py (ZIP real en Chrome)
Subidas que fallan con 503 y la IA saturada se reintentan solas; una prenda que falla siempre
termina con mensaje en español y botón "Reintentar la que falló"; "Large"/"Excelente"/"Hoodie"
se acomodan; los avisos no tapan "Guardar" (se encontró que sí lo tapaban); el mismo ZIP otra vez
avisa "ya registraste esta prenda" sin volver a subir fotos; HEIC sin tipo se sube como image/heic;
sin internet espera y sigue sola.
