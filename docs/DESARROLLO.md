# Stiimpys

<div align="center">
  <img src="https://res.cloudinary.com/dendyzqsn/image/upload/v1784126788/banner_bazar_en_linea_kf5bcl.png" alt="Stiimpys" width="100%" style="border-radius: 8px;" />
</div>

> Tienda en línea de streetwear y vintage de Reynosa, Tamaulipas, con panel de administración, pagos en línea (Clip y PayPal), envíos (envia.com), Instagram automático e IA para registrar prendas. Desplegada en Vercel con MongoDB Atlas y Cloudinary.

**En vivo:** https://stiimpys.store/

---

## Cómo está acomodado el proyecto

```
/                      Páginas del sitio (cada .html es una dirección: /tienda.html, /pagar.html…)
│                      y la configuración de Vercel. Aquí no va nada más.
├── api/               Las 12 funciones del servidor (el límite del plan gratis de Vercel)
│   └── _lib/          Ayudantes del servidor (no cuentan como funciones): base de datos,
│                      sesión, pagos, envíos, Instagram, IA, seguridad (escudo.js)…
├── css/
│   ├── comun/         Estilos que usan la tienda y el panel (letras, base, estética)
│   ├── tienda/        Estilos de la tienda pública (limpio.css va al final y manda)
│   ├── panel/         Estilos del panel, del login y del Estudio
│   ├── fuentes/       Letras propias (DM Sans, Bebas Neue, Playfair, Poppins) en .woff2
│   └── dist/          GENERADO: un archivo comprimido por página. No se edita.
├── js/
│   ├── comun/         Código que comparten tienda y panel (db.js, avisos, íconos…)
│   ├── tienda/        Código de la tienda pública
│   ├── panel/         Código del panel, del login y del Estudio
│   ├── vendor/        Librerías de terceros (QR)
│   └── dist/          GENERADO: un archivo comprimido por página. No se edita.
├── img/               Logo de Stiimpys (blanco y negro) e imagen para compartir links
├── icons/             Íconos de la app (celular)
├── herramientas/      construir.mjs (arma css/dist y js/dist), paquetes.json (qué archivos
│                      lleva cada página y en qué orden), generar-tema.py (tema del panel)
├── pruebas/           Pruebas automáticas (servidor y navegador). No se suben a Vercel.
└── docs/              Historial de versiones, guía de Instagram y archivos viejos que ya
                       no usa ninguna página (docs/archivo). No se sube a Vercel.
```

### Qué carga cada página

Cada página pide **un** archivo de estilos y **uno** de código (antes eran hasta 25 archivos sueltos).
La lista de qué lleva cada uno está en `herramientas/paquetes.json`.

| Página | Estilos | Código |
|---|---|---|
| inicio.html | css/dist/inicio.css | js/dist/inicio.js |
| tienda.html | css/dist/tienda.css | js/dist/tienda.js |
| prenda.html | css/dist/prenda.css | js/dist/prenda.js |
| carrito.html | css/dist/carrito.css | js/dist/carrito.js |
| pagar.html | css/dist/pagar.css | js/dist/pagar.js |
| cuenta.html | css/dist/cuenta.css | js/dist/cuenta.js |
| terminos.html | css/dist/sencilla.css | js/dist/sencilla.js |
| admin.html | css/dist/admin.css | js/dist/tema.js + js/dist/admin.js |
| login.html | css/dist/login.css | js/dist/tema.js + js/dist/login-movimiento.js + js/dist/login.js |
| estudio.html | css/dist/estudio.css | js/dist/estudio.js |
| caja.html (v42) | css/dist/caja.css | js/dist/caja.js (+ js/vendor/jsqr.js si no hay lector de QR del navegador) |
| /marca, /categoria (v42) · /talla, /precio, /guias, /drop (v43) | HTML del servidor (api/_lib/paginas.js, por api/prenda.js) | js/tienda/origen.js |

---

## Cómo hacer un cambio

1. Edita el archivo **original** (`css/tienda/…`, `js/panel/…`, etc.). Nunca lo que está en `dist/`.
2. Arma los paquetes:
   ```bash
   npm install          # la primera vez
   npm run construir
   ```
   Esto comprime todo y le pone a cada página la versión nueva (`?v=…`), así los navegadores
   bajan el cambio en cuanto se publica y el resto del tiempo lo guardan un año.
3. Corre las pruebas:
   ```bash
   npm i --no-save mingo@6
   npm run pruebas      # servidor, seguridad y "¿se te olvidó construir?"
   ```
4. Sube a una rama → vista previa de Vercel → si todo bien, a producción.

- ¿Un archivo nuevo de estilos o código? Agrégalo en `herramientas/paquetes.json` en el lugar que le toca (el orden importa) y corre `npm run construir`.
- ¿Cambiaste colores en una hoja del panel? `python3 herramientas/generar-tema.py` y luego `npm run construir`.
- ¿Editaste `404.html`? Copia el mismo cambio en `middleware.js` (`PAGINA_404`): tienen que ser idénticos.

---

## Seguridad

- **Escudo de las 12 funciones** (`api/_lib/escudo.js`): quita operadores de MongoDB (`$ne`, `$where`…) y llaves de prototipo de todo lo que llega, rechaza JSON anidado de más, bloquea escrituras que vienen de otros sitios (CSRF), solo acepta los métodos que usa el sitio, pone cabeceras seguras y nunca muestra errores técnicos.
- **Sesiones**: cookies `HttpOnly`, `Secure`, `SameSite=Lax`; el token del panel vence a las 8 horas y se borra al salir.
- **Contraseñas**: bcrypt. Límite de intentos por conexión y por cuenta (aunque el ataque venga de muchas conexiones).
- **Panel escondido**: sin sesión, `/admin.html`, `/login.html`, `/estudio.html` y el código del panel (`js/panel`, `css/panel`, `js/dist/admin.js`…) responden la misma página 404 que cualquier dirección inventada.
- **Archivos internos**: `middleware.js`, `package.json`, `vercel.json`, `.md`, `.env`, `.git`, `pruebas/`, `docs/` y `herramientas/` responden 404.
- **Pagos**: el precio, los descuentos y el envío los calcula siempre el servidor; una prenda se aparta de forma atómica antes de abrir el pago; el pago solo cuenta cuando Clip o PayPal lo confirman; máximo 3 pagos abiertos a la vez por WhatsApp y por conexión (nadie puede "apartar" la tienda entera sin pagar).
- **v43**: aprobar transferencias (a mano o por Banxico), cancelar guías, recolecciones y resumen solo para administradores; cupones REGALO/CUMPLE personales por WhatsApp; código de amigo solo en la primera compra; medidas y links de Google validados; páginas nuevas con todo escapado.
- **v44**: la firma para subir directo a Cloudinary solo se da con sesión del panel, solo para la carpeta `bazar` y solo para formatos de imagen; el secreto nunca sale del servidor. `ia-aprender` limpia lo que recibe y tiene tope por hora.
- **v45**: `ia-catalogo` (crear marca/categoría) solo con sesión del panel y permiso `gestionarCatalogo` para vendedores, nombres limpios, sin duplicar (candado); el informe del agente se pinta escapado y solo con links `https` que salieron en la búsqueda.
- **v46**: el saldo de la IA solo lo ven y cambian administradores (`ia-saldo`, 30/h); `ANTHROPIC_ADMIN_KEY` solo se usa en el servidor para leer el reporte de costos y nunca sale al panel.
- **v42**: comprobantes SPEI y fotos de reseñas solo como imagen (sin SVG/HTML), máx. 3 MB, subida firmada con nombre al azar; confirmar transferencias y moderar reseñas solo administradores; la CLABE solo sale en el recibo con su clave.
- **Lo público** (catálogo, ficha del bazar, recibos sin su clave) no lleva costos, teléfonos, direcciones, correos, tokens ni configuración interna.

---

## Variables de entorno (en Vercel)

| Variable | Para qué |
|---|---|
| `MONGODB_URI`, `MONGODB_DB` | Base de datos |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Fotos |
| `SESSION_SECRET` | Firma de la cookie del panel (obligatoria en producción) |
| `RUTA_PANEL` | Dirección secreta del panel. **Ponla siempre**: la de respaldo está escrita en el código |
| `MASTER_KEY` | Clave maestra para forzar sesión de admin (opcional) |
| `CLIP_API_KEY`, `CLIP_SECRET_KEY` | Cobro con Clip |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Cobro con PayPal (opcional) |
| `ENVIA_TOKEN` | Cotizar envíos con envia.com |
| `ANTHROPIC_API_KEY` | IA para registrar prendas y el agente investigador (v45: necesita la búsqueda web permitida en la cuenta de Anthropic para los comparables) |
| `ANTHROPIC_ADMIN_KEY` | Opcional (v46): llave de administrador de Anthropic (`sk-ant-admin…`, solo cuentas de organización) para que el saldo de la IA salga exacto del reporte de costos |
| `IG_STIIMPYS_USER_ID`, `IG_STIIMPYS_TOKEN` | Instagram |
| `CRON_SECRET` | Tarea diaria |
| `RESEND_API_KEY`, `CORREO_DESDE` | Recibos por correo (opcional) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Avisos al celular cuando algo falla (opcional, v41) |
| `AVISOS_CORREO` | Correo a donde llegan esos avisos (opcional, v41; usa Resend) |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Freno para robots de Cloudflare (opcional, v41) |
| `SITE_URL`, `ACTIVIDAD_DIAS`, `BAZAR_PRINCIPAL` | Opcionales |

v42 y v43 no piden variables nuevas (todo lo nuevo se prende en Ventas → Módulos): SPEI (CLABE) y cliente frecuente se configuran en el panel; el rastreo usa `ENVIA_TOKEN`, el cupón de cumpleaños usa Resend y los comprobantes y fotos de reseñas usan Cloudinary.

Las claves nunca van en el código ni en el chat: solo en Vercel → Settings → Environment Variables.

---

## Historial

Las notas de cada versión están en `HISTORIAL-VERSIONES.txt` (y las de esta, v46, en `LEEME.txt`).
