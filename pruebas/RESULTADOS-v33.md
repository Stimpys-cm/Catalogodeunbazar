# STMP MARKET v33 · Resultados de las pruebas

Fecha: 17 de noviembre de 2026. Todas corridas sobre el código de la v33 tal como va en el zip.

| Grupo | Qué prueba | Resultado |
|---|---|---|
| v33 servidor | Actividad, logs sin datos sensibles, cancelar, apartados, operaciones simultáneas, permisos, filtros y paginación, historial, monitor, consistencia y reparaciones, sesiones, correos | **90 de 90** |
| v32 pagos | El flujo de pago de la v32 sigue igual (carrera, falla de Clip, reintento, webhook, cupones, anticipo, permisos) | **22 de 22** |
| v32 seguridad | Limpieza de campos, aislamiento de bazares, datos públicos, caché, previews, sitemap, salir | **11 de 11** |
| Middleware | Previews de WhatsApp/Google, panel oculto | **4 de 4** |
| Navegador (Chrome real) | 8 páginas públicas sin errores ni 404; panel en computadora y celular: Monitor, Actividad, Historial, Cancelar, Ventas, permisos de vendedor | **56 de 56** |
| **Total** | | **183 de 183** |

Otras revisiones:
- **12 funciones de Vercel**: `acciones, activos, auth, change-password, config, cuenta, inventario-item, inventario, prenda, session-check, sync, upload` (lo nuevo vive en archivos con `_`).
- **Sintaxis** de todos los `.js` y **ESLint** del servidor: 0 errores.
- **Referencias locales** (HTML, JS, CSS, manifest): ninguna apunta a un archivo que no exista.
- **Datos sensibles**: se revisó el registro completo y el CSV exportado buscando teléfonos, correos, claves de pedido, tokens y contraseñas: no aparecen.

## Cómo se probó
- Las pruebas del servidor llaman a las funciones reales de `/api` con una base de datos en memoria (`base-en-memoria.js`) que imita MongoDB y **cede el turno en cada operación**, como una base por red, para que las pruebas "al mismo tiempo" sí choquen.
- Clip, PayPal, Resend y Cloudinary están simulados: **no se hizo ningún cobro ni se mandó ningún correo real**. El estado inicial de un link de Clip se simula como `CHECKOUT_CREATED` (el real de Clip).
- Las pruebas del navegador usan Chrome real contra `pruebas/servidor.mjs` (las 12 funciones reales + datos de ejemplo creados a través de la propia API).

## Lo que falta probar con cuentas reales (no se puede simular)
- Que Clip acepte la consulta de estado con tus credenciales (el monitor lo mostrará en verde o rojo).
- Que la clave de Resend sea de "solo envío" o completa (el monitor lo indica) y que el dominio esté verificado.
- El ping de Cloudinary con tus credenciales.
- Una compra chica con Clip en la vista previa y revisar su historial y su evento en Actividad.

## Cómo repetirlas
```
npm install
npm i --no-save mingo@6
node pruebas/correr.mjs                 # servidor (127 pruebas)
node pruebas/correr.mjs --servidor      # deja el sitio en http://127.0.0.1:8766
python3 pruebas/v33-navegador.py        # (en otra terminal; requiere Playwright y Chrome)
```

## Detalle

### v33-servidor.mjs


**1 · Compatibilidad con v32: flujo de pago completo**

- ✅ pedido creado con cupón: $250
- ✅ la prenda queda apartada al pedido mientras paga
- ✅ aviso de Clip → se consulta a Clip → pagado y vendida
- ✅ se registra una venta
- ✅ aviso repetido: no duplica la venta ni el uso del cupón

**2 · Centro de actividad: eventos de pagos, pedidos, cupones y correos**

- ✅ evento "pedido creado"
- ✅ evento "pago confirmado" (una sola vez)
- ✅ cada aviso de Clip queda registrado
- ✅ cupón aplicado y uso contado
- ✅ correo de recibo registrado con destinatario enmascarado (an•••@gmail.com)
- ✅ el correo sí se mandó a la dirección real
- ✅ historial del pedido: pendiente → pagado

**3 · Sin datos sensibles en el registro**

- ✅ no aparece ningún teléfono completo
- ✅ no aparece ningún correo completo
- ✅ no aparece la clave privada del pedido
- ✅ no aparecen tokens de sesión

**4 · Cancelar pedidos con validaciones**

- ✅ pedido pendiente (Clip sin pago) → cancelado y prenda liberada
- ✅ el historial dice quién lo canceló
- ✅ cancelar dos veces → rechazado
- ✅ pago tras cancelar: NO se vende, se marca para devolver
- ✅ llega "Devolver dinero" a Pendientes
- ✅ si Clip confirma el pago al intentar cancelar → no se cancela y queda pagado
- ✅ un pedido pagado no se cancela

**5 · Apartados: no liberar con pagos confirmados**

- ✅ anticipo pagado → apartado
- ✅ no se puede borrar una prenda con anticipo pagado
- ✅ no se puede vender en persona una prenda con anticipo de otra persona
- ✅ editar la prenda no puede soltar el apartado
- ✅ "Quitar apartado" del inventario tampoco
- ✅ Liberar revisa antes: el resto ya estaba pagado → queda pagado, no se libera

**6 · Operaciones simultáneas**

- ✅ "Cobré el resto" y "Liberar" al mismo tiempo → solo uno (200/409, quedó pagado)
- ✅ nunca se duplica la venta
- ✅ doble clic en "Marcar enviado" → uno pasa, el otro se bloquea (200/409)
- ✅ el historial lo anota una sola vez
- ✅ dos clientes pagando la misma prenda → uno recibe link, el otro un aviso
- ✅ el choque queda registrado
- ✅ doble toque en "Pagar" → un solo pedido

**7 · Permisos y aislamiento entre bazares**

- ✅ un vendedor no ve el Centro de actividad
- ✅ un vendedor no ve el monitor
- ✅ un vendedor no repara
- ✅ sin sesión → 401
- ✅ el admin del bazar 2 solo ve eventos de su bazar
- ✅ el admin principal ve todos
- ✅ el bazar 2 no ve el historial de pedidos del bazar 1
- ✅ el bazar 2 no cambia pedidos del bazar 1
- ✅ el registro del panel (v32) ya no es público
- ✅ las solicitudes de bazar solo las ve el admin principal

**8 · Filtros, búsqueda y paginación del Centro de actividad**

- ✅ filtro por categoría + 5 por página (6 en total, 2 páginas)
- ✅ la página 2 trae otros eventos
- ✅ filtro por resultado
- ✅ filtro por usuario y lista de usuarios
- ✅ búsqueda por número de pedido
- ✅ filtro por fechas
- ✅ trae indicadores por resultado y categoría
- ✅ exportar CSV sin datos sensibles

**9 · Historial de un pedido**

- ✅ un vendedor del mismo bazar ve el historial
- ✅ incluye los eventos relacionados (pago tras cancelar)
- ✅ pedidos de antes de la v33: historial reconstruido con sus fechas

**10 · Monitor de sistema**

- ✅ MongoDB: operativo
- ✅ Clip: operativo (Credenciales aceptadas (0 ms).)
- ✅ Resend: operativo (Clave válida (solo de envío).)
- ✅ Cloudinary: operativo
- ✅ PayPal: sin configurar (opcional)
- ✅ muestra último aviso de Clip, último pago y última actividad
- ✅ operaciones pendientes: 1 para devolver dinero
- ✅ distingue estados: Clip no disponible, Resend degradado, Cloudinary no disponible → general no disponible
- ✅ si MongoDB no contesta → no disponible
- ✅ Resend sin variables → sin configurar

**11 · Consistencia pedidos ↔ inventario y reparaciones**

- ✅ detecta prenda apartada para un pedido cancelado
- ✅ detecta anticipo pagado sin la prenda apartada
- ✅ reparar: suelta el apartado huérfano
- ✅ no suelta prendas de pedidos activos o vendidas
- ✅ reparar: vuelve a apartar la prenda del anticipo
- ✅ cada reparación queda registrada
- ✅ nunca suelta una prenda con anticipo pagado (pedido activo)

**12 · Venta en línea: reactivar exige confirmar el reembolso**

- ✅ reactivar una prenda pagada en línea pide confirmar que se devolvió el dinero
- ✅ con confirmación: se reactiva y queda en el historial del pedido

**13 · Sesiones**

- ✅ usuario inexistente: se guarda solo el inicio de lo escrito
- ✅ contraseña incorrecta registrada
- ✅ entrada correcta registrada
- ✅ el token nuevo no se guarda en el registro

**14 · Errores: Resend que falla y aviso de Clip desconocido**

- ✅ pedido extra para probar correo
- ✅ correo fallido: error registrado sin mostrar el correo completo
- ✅ que falle el correo no detiene la venta
- ✅ aviso de Clip sin pedido → registrado como rechazado
- ✅ el monitor marca Resend degradado si el último correo falló

**15 · Auditoría de operaciones del panel**

- ✅ registrar prenda queda auditado
- ✅ doble clic en "Registrar" → una sola prenda
- ✅ crear un cupón queda registrado
- ✅ sync del panel sigue funcionando
- ✅ se anota la última sincronización

### v32-pagos.mjs

- ✅ carrera: una sola obtiene link (409, 200)
- ✅ la prenda queda apartada al pedido que ganó
- ✅ si Clip falla, se suelta el apartado temporal
- ✅ el mismo cliente puede reintentar con su pedido previo
- ✅ el pedido anterior queda reemplazado
- ✅ webhook confirma y marca vendida
- ✅ se registra 1 venta por $300
- ✅ llega "Pago recibido" a Pendientes
- ✅ cupón de 150 % no pasa del subtotal (desc 500 de 500)
- ✅ cupón 50% sobre $500 = $250 (250)
- ✅ el uso del cupón se suma una vez
- ✅ webhook repetido no vuelve a sumar
- ✅ anticipo 50% de $800 = $400 (400)
- ✅ queda apartado y faltan $400
- ✅ nadie más puede pagar una prenda apartada con anticipo
- ✅ link para pagar el resto por $400
- ✅ al pagar el resto queda pagado y vendida
- ✅ un vendedor de otro bazar no borra interesados ajenos
- ✅ un vendedor no descarga respaldos
- ✅ la administradora sí lo borra
- ✅ aceptar oferta no pisa un apartado de otra persona
- ✅ pedido en $0 se rechaza sin dejar la prenda apartada

### v32-seguridad.mjs

- ✅ nombre/marca sin etiquetas: ["Gorra img src=x onerror=alert(1)","\"script"]
- ✅ tipos correctos y fotos inválidas descartadas
- ✅ un bazar no puede reemplazar prendas de otro con PUT
- ✅ público: sin ocultas, sin costo y "Vendido a" con nombre corto (Ana L.)
- ✅ sync sin sesión y sin scope no se guarda en el CDN
- ✅ sync del panel es private: private, max-age=2
- ✅ sync público sin prendas ocultas
- ✅ vista de robot: sin redirección y con el dominio real
- ✅ prenda oculta no genera preview
- ✅ sitemap sin ocultas y con /inicio.html
- ✅ cerrar sesión invalida el token en el servidor

### v32-middleware.mjs

- ✅ WhatsApp recibe la ficha en la misma dirección
- ✅ prenda inexistente → tienda
- ✅ personas pasan directo a la ficha normal
- ✅ panel sigue oculto

### v33-navegador.py
- ✅ pública inicio.html: sin errores de JS ni 404 [] []
- ✅ pública tienda.html: sin errores de JS ni 404 [] []
- ✅ pública prenda.html?id=6: sin errores de JS ni 404 [] []
- ✅ pública pagar.html?ids=6&bazar=1: sin errores de JS ni 404 [] []
- ✅ pública cuenta.html: sin errores de JS ni 404 [] []
- ✅ pública terminos.html: sin errores de JS ni 404 [] []
- ✅ pública vender.html: sin errores de JS ni 404 [] []
- ✅ pública redes.html: sin errores de JS ni 404 [] []
- ✅ [compu] monitor muestra 5 servicios
- ✅ [compu] estados visibles: ['Operativo', 'Operativo', 'Operativo', 'Operativo', 'Sin configurar']
- ✅ [compu] operaciones pendientes y pedidos atorados
- ✅ [compu] últimos movimientos
- ✅ [compu] actividad: 25 filas en la primera página (55 eventos)
- ✅ [compu] paginación visible
- ✅ [compu] cambia a la página 2
- ✅ [compu] filtro por área: {'Pagos'}
- ✅ [compu] la búsqueda no pierde el foco al escribir
- ✅ [compu] se abre el detalle de un evento
- ✅ [compu] indicador "Errores" filtra
- ✅ [compu] Ventas → Apartados lista pedidos
- ✅ [compu] búsqueda de pedidos
- ✅ [compu] historial del pedido con prendas consistentes
- ✅ [compu] Esc cierra la ventana
- ✅ [compu] pedido atorado resaltado con "Cancelar pedido"
- ✅ [compu] pestaña Cancelados con motivo
- ✅ [compu] "Datos del panel" conserva lo de la v32
- ✅ [compu] mantenimiento visible para el admin principal
- ✅ [compu] panel sin errores de JS []
- ✅ [compu] panel sin archivos 404 []
- ✅ [celular] monitor muestra 5 servicios
- ✅ [celular] estados visibles: ['Operativo', 'Operativo', 'Operativo', 'Operativo', 'Sin configurar']
- ✅ [celular] operaciones pendientes y pedidos atorados
- ✅ [celular] últimos movimientos
- ✅ [celular] actividad: 25 filas en la primera página (56 eventos)
- ✅ [celular] paginación visible
- ✅ [celular] cambia a la página 2
- ✅ [celular] filtros plegados al inicio
- ✅ [celular] el botón Filtros los muestra
- ✅ [celular] filtro por área: {'Pagos'}
- ✅ [celular] la búsqueda no pierde el foco al escribir
- ✅ [celular] se abre el detalle de un evento
- ✅ [celular] indicador "Errores" filtra
- ✅ [celular] Ventas → Apartados lista pedidos
- ✅ [celular] búsqueda de pedidos
- ✅ [celular] historial del pedido con prendas consistentes
- ✅ [celular] Esc cierra la ventana
- ✅ [celular] pedido atorado resaltado con "Cancelar pedido"
- ✅ [celular] pestaña Cancelados con motivo
- ✅ [celular] "Datos del panel" conserva lo de la v32
- ✅ [celular] mantenimiento visible para el admin principal
- ✅ [celular] panel sin errores de JS []
- ✅ [celular] panel sin archivos 404 []
- ✅ cancelar desde el historial: ['cancelado', 'Prueba de cancelación']
- ✅ sin errores al cancelar []
- ✅ vendedor: la pestaña Sistema no aparece
- ✅ vendedor: el servidor niega la actividad (403)
