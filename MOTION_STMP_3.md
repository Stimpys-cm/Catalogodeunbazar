# STMP MARKET 3.0 — Motion Experience

Esta actualización agrega una capa de motion design inspirada en sitios premium de MotionSites, sin cambiar la arquitectura del proyecto, el backend ni las variables de entorno.

## Qué se añadió

- Hero cinematográfico con entrada escalonada y reveal por palabras.
- Parallax suave en el hero controlado por el puntero en escritorio.
- Cards con profundidad 3D/tilt y reflejo de luz interactivo.
- Botones magnéticos con desplazamiento sutil hacia el cursor.
- Barra superior de progreso de scroll.
- Luz ambiental que sigue el cursor en dispositivos de precisión.
- Reveals de secciones más profundos: blur + desplazamiento + escala.
- Transiciones de página con View Transitions cuando el navegador las soporta.
- Transición compartida de la fotografía de producto conservada.
- Entrada de imágenes con blur-to-sharp.
- Animación de contadores en la portada.
- Línea animada en la sección “Cómo comprar”.
- Subrayados cinéticos en encabezados destacados.
- Hero con profundidad ligada al scroll en navegadores compatibles.
- Experiencia reducida automáticamente en móviles y dispositivos táctiles.
- Respeto completo a `prefers-reduced-motion`.

## Archivos nuevos

- `css/motionsites.css`
- `js/motion-pro.js`
- `MOTION_STMP_3.md`

## HTML actualizados

- `index.html`
- `inicio.html`
- `tienda.html`
- `prenda.html`
- `redes.html`
- `vender.html`
- `cuenta.html`
- `terminos.html`
- `login.html`
- `404.html`

## Rendimiento

La capa de movimiento no usa GSAP, Three.js ni dependencias externas. No hace peticiones HTTP, no consulta MongoDB, no consume Cloudinary y no ejecuta funciones de Vercel.

Las interacciones de cursor solo se activan con `hover:hover` + `pointer:fine`. En móviles se desactivan tilt, cursor glow y magnetismo para ahorrar CPU/GPU y batería.

## Variables de entorno

No se añadió, eliminó ni renombró ninguna variable de entorno. Se conservan exactamente las mismas variables que en STMP MARKET 2.0.

## Compatibilidad

Las funciones modernas son progressive enhancement: si `View Transitions`, scroll-driven animations o alguna API visual no está disponible, la navegación y el catálogo siguen funcionando normalmente.
