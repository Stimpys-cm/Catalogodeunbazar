# Resultados de pruebas · v42 (Caja, SKU, SPEI, cliente frecuente, reseñas con foto, rastreo, páginas por marca, origen de ventas)

Fecha: 2026-11-18. Chrome real (Playwright) y servidor local con base en memoria.

| Grupo | Resultado |
|---|---|
| Paquetes css/dist y js/dist al día | **OK** |
| v42 · servidor: CLABE, pago SPEI, comprobante (tipos y tamaño), aprobar/rechazar (solo admin, sin doble venta), cliente frecuente, cupón de cumpleaños, reseñas con foto y moderación, rastreo envia.com, páginas por marca/categoría (escape, sitemap), origen de ventas y métricas (v42-funciones.mjs) | **85 de 85** |
| v42 · navegador: logo, /marca/nike en celular, checkout SPEI + comprobante, revisión en el panel, CLABE mal copiada, métricas por fuente, cliente frecuente, cumpleaños, reseña con 3 fotos, moderación → Inicio, Caja (SKU, QR, cambio, cobro), etiquetas térmicas (v42-navegador.py) | **57 de 57** |
| v41 · servidor | **51 de 51** |
| v41 · navegador (marca del panel ahora es el logo) | **21 de 21** |
| v40 · seguridad (servidor) | **54 de 54** |
| v40 · XSS guardado | **24 de 24** |
| v39 · estética (logo con imagen en encabezado y pie) | **80 de 80** |
| v39 · una sola tienda (servidor) | **28 de 28** |
| v38 · acomodo | **93 de 93** |
| v37 · carrito y pago | **42 de 42** |
| v36 · contadores (navegador) | **22 de 22** |
| v36 · apartado (servidor) | **25 de 25** |
| v35 · carrito | **48 de 48** |
| v34 · panel | **38 de 38** |
| v33 · navegador | **54 de 54** |
| v33 · servidor | **90 de 90** |
| v32 · pagos, seguridad y middleware | **37 de 37** |

Total: 849 de 849. Funciones de Vercel: 12 (las páginas por marca viven en api/prenda.js).

Notas
- Cloudinary, envia.com (rastreo /ship/generaltrack/) y Resend se probaron con respuestas simuladas
  con el formato de sus APIs. Falta probar con las cuentas reales: un comprobante SPEI y una guía real.
- Se encontró y corrigió en las pruebas: el aviso de "llegada" no leía la respuesta y el navegador
  dejaba la petición abierta; el link del recibo SPEI saltaba al dominio de producción desde la vista
  previa (ahora es relativo).
- v38 "mismas esquinas" falló una vez por tiempo de carga; al repetirla pasa completa.
