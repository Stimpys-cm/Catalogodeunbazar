# Resultados de pruebas · v43 (13 mejoras con interruptor)

Fecha: 2026-11-18. Chrome real (Playwright) y servidor local con base en memoria.

| Grupo | Resultado |
|---|---|
| Paquetes css/dist y js/dist al día | **OK** |
| v43 · servidor: interruptores apagados al instalar, comprobante con IA + Banxico (verde/rojo/ámbar, aprobar sola solo si todo cuadra), outfit, referidos y regalo personal, carritos por WhatsApp, resumen semanal, ticket de Caja, cancelar guía y recolección, Google Shopping, páginas por talla/precio, guías y drop, medidas y sello, Google Maps, origen apagado (v43-funciones.mjs) | **85 de 85** |
| v43 · navegador: Módulos (14 interruptores), Promociones y pagos (CLABE, %, Google), formulario de medidas, ficha con sello/medidas/outfit/talla en compu y celular, carrito con outfit, /guias, /talla/m, /drop, revisión del comprobante en el panel, resumen, recibo con "Invita a tus amigos" y reseña en Google, inicio con Google Maps (v43-navegador.py) | **42 de 42** |
| v42 · servidor | **85 de 85** |
| v42 · navegador | **57 de 57** |
| v41 · servidor | **51 de 51** |
| v41 · navegador | **21 de 21** |
| v40 · seguridad (servidor) | **54 de 54** |
| v40 · XSS guardado | **24 de 24** |
| v39 · estética (navegador) | **80 de 80** |
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

Total: 976 de 976. Funciones de Vercel: 12.

Notas
- Anthropic, Banxico (CEP), Cloudinary, envia.com (cancelar, recolección, rastreo) y Resend se probaron con
  respuestas simuladas. La consulta a Banxico imita lo que hace su página del CEP (no es una API oficial):
  falta probarla con una transferencia real.
- Se encontró y corrigió: cambiar un interruptor dos veces seguidas daba "operación repetida"; el tipo de
  prenda ahora se toma primero del nombre; la cuenta regresiva del drop no se sale de su cuadro.
- v36 a veces se queda esperando "networkidle" si arranca antes de que el servidor local termine de cargar;
  al repetirla pasa completa (22 de 22).
