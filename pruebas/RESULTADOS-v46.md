# Resultados de pruebas — v46 (contador del saldo de la IA)

19 nov 2026. Base en memoria; Anthropic (mensajes y reporte de costos), Telegram y tipo de cambio simulados.

| | Correctas |
|---|---|
| v46-saldo.mjs | 30 |
| Resto de suites del servidor (v32–v45) | 594 |
| **Servidor** | **624** |
| v46-navegador.py | 13 |
| Resto de suites de navegador (v33–v45) | 577 |
| **Navegador** | **590** |
| **Total** | **1214 de 1214** |

Lo que se prueba: poner saldo (solo admin, validación), descuento exacto por cada uso (IA rápida, agente con búsquedas,
textos de Instagram, comprobantes SPEI; la memoria no descuenta), promedio real por investigación, aviso único al bajar
del umbral, "sin saldo" de Anthropic (marca agotado, avisa una vez, se quita al actualizar), modo exacto con
`ANTHROPIC_ADMIN_KEY` (centavos del reporte, sin contar lo de antes de poner el saldo, máx. 1 consulta cada 5 min,
nunca menos que el conteo propio, respaldo si falla) y que ninguna llave salga al panel. En el navegador: poner el
saldo, que baje al analizar, naranja con saldo bajo, recargar, "sin saldo", formulario y celular.
