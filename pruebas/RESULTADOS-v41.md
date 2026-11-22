# Resultados de pruebas · v41 (avisos, guías, "Hoy", buscador, freno para robots)

Fecha: 2026-11-18. Chrome real (Playwright) y servidor local con base en memoria.

| Grupo | Resultado |
|---|---|
| Paquetes css/dist y js/dist al día | **OK** |
| v41 · servidor: costos solo admin, minutos, datos legales, avisos del carrito, avisos a la dueña, guías envia.com, Hoy, buscador, Turnstile, tarea diaria (v41-funciones.mjs) | **51 de 51** |
| v41 · navegador: pie y términos con datos legales y minutos, aviso del carrito, Hoy, Ctrl+K, marca, celular (v41-navegador.py) | **21 de 21** |
| v40 · seguridad (servidor) | **54 de 54** |
| v40 · XSS guardado | **24 de 24** |
| v39 · estética (navegador) | **80 de 80** |
| v39 · una sola tienda (servidor; redes.html ahora siempre al inicio) | **28 de 28** |
| v38 · acomodo (sin redes.html ni vender.html, archivadas) | **93 de 93** |
| v37 · carrito y pago | **42 de 42** |
| v36 · contadores (navegador) | **22 de 22** |
| v36 · apartado (servidor) | **25 de 25** |
| v35 · carrito (sin vender.html) | **48 de 48** |
| v34 · panel | **38 de 38** |
| v33 · navegador (sin redes.html ni vender.html) | **54 de 54** |
| v33 · servidor | **90 de 90** |
| v32 · pagos, seguridad y middleware | **37 de 37** |

Total: 707 de 707. Funciones de Vercel: 12.

Notas
- Las guías de envia.com, Telegram, Resend y Turnstile se probaron con respuestas simuladas
  (con el formato de sus APIs). Falta probarlas con las cuentas reales: ver LEEME.txt.
- v36 a veces se queda esperando "networkidle" en pagar.html; al repetirla pasa completa (ya pasaba antes).
