# Bazar En Linea

> Catalogo digital de ropa streetwear & vintage con panel de administracion, sincronizacion en tiempo real, gestion de inventario, drops programados y auditoria -- desplegado en Vercel con MongoDB Atlas y Cloudinary.

**Demo en vivo:** https://stiimpys.store/

---

## Caracteristicas

- **Inventario en tiempo real** -- los cambios aparecen en todas las pantallas en menos de 3 segundos sin recargar (polling adaptativo: 3s / 6s / 15s segun actividad)
- **Fotos en la nube** -- imagenes almacenadas en Cloudinary, sin limites de tamano
- **Busqueda y filtros** -- por nombre, marca, categoria, talla y estado
- **Multi-usuario** -- admin y vendedores con permisos diferenciados
- **Drops programados** -- crea colecciones y programalas para publicacion automatica
- **Sesion unica por cuenta** -- evita accesos compartidos; override con clave maestra para admin
- **Verificacion Cloudflare Turnstile** -- protege la entrada al bazar
- **Wishlist** -- los visitantes guardan prendas favoritas en el navegador
- **Compra directa por WhatsApp** -- boton de contacto por prenda con mensaje pre-armado
- **Open Graph / Previews** -- cada prenda tiene meta tags para compartir en WhatsApp, Discord, Twitter
- **Zoom con lupa** -- vista detalle de producto con zoom hover en desktop
- **Usuarios en linea** -- badge en tiempo real de quien esta en el panel
- **Auditoria completa** -- registro de actividad con archivado automatico y descarga de respaldos
- **Avatar de perfil** -- foto de perfil para cada usuario, almacenada en servidor
- **Sonidos de accion** -- feedback auditivo opcional (estilo iOS)
- **Preferencias de usuario** -- vista compacta, confirmacion de borrado, sonido
- **Responsive** -- funciona en celular, tablet y escritorio

---

## Stack tecnologico

| Capa | Tecnologia |
|---|---|
| Frontend | HTML5 · CSS3 · JavaScript vanilla |
| Hosting | [Vercel](https://vercel.com) (gratuito) |
| Base de datos | [MongoDB Atlas](https://cloud.mongodb.com) (gratuito M0) |
| Imagenes | [Cloudinary](https://cloudinary.com) (gratuito) |
| API | Vercel Serverless Functions (Node.js) |
| Verificacion | [Cloudflare Turnstile](https://www.cloudflare.com/products/turnstile/) |
| Seguridad | bcryptjs · sesion por token · rate limiting en MongoDB |

---

## Estructura del proyecto

```
bazar-en-linea/
├── api/                        # Serverless Functions (backend)
│   ├── _db.js                  # Conexion compartida a MongoDB (singleton)
│   ├── _auth.js                # Middleware de autenticacion (token bearer + cookie)
│   ├── _password.js            # Verificacion y hasheo de contrasenas (bcrypt)
│   ├── _rateLimit.js           # Rate limiter con MongoDB + TTL
│   ├── auth.js                 # POST login (sesion unica + override)
│   ├── inventario.js           # GET/PUT lista completa de prendas
│   ├── inventario-item.js      # PATCH/DELETE prenda individual
│   ├── config.js               # GET/PUT categorias, marcas, usuarios, drops
│   ├── activos.js              # GET/POST/DELETE usuarios activos (keep-alive)
│   ├── sync.js                 # GET todas las colecciones en una llamada (con cache)
│   ├── upload.js               # POST subir imagen a Cloudinary
│   ├── acciones.js             # GET/POST logs, borrar prenda, gestionar usuarios
│   ├── change-password.js      # POST cambiar contrasena (verifica actual)
│   ├── prenda.js               # GET HTML con Open Graph tags por prenda
│   └── session-check.js        # POST verifica vigencia de sesion
├── css/
│   ├── global.css              # Variables, toast, modal
│   ├── tienda.css              # Estilos catalogo publico
│   ├── admin.css               # Estilos panel de admin
│   ├── login.css               # Estilos login
│   ├── lightbox.css            # Estilos visor de imagenes
│   └── utils.css               # Estilos de utilerias
├── js/
│   ├── db.js                   # Capa de datos (cache + polling adaptativo + API)
│   ├── tienda.js               # Logica catalogo publico + wishlist + detalle
│   ├── admin.js                # Logica panel de administracion (6 pestanas)
│   ├── login.js                # Logica autenticacion con override
│   ├── lightbox.js             # Visor de imagenes con swipe tactil
│   └── utils.js                # Utilidades compartidas (money, toast, confirm, etc.)
├── index.html                  # Pagina de verificacion Cloudflare Turnstile
├── tienda.html                 # Catalogo publico
├── admin.html                  # Panel de administracion
├── login.html                  # Inicio de sesion
├── vercel.json                 # Configuracion de rutas Vercel + CORS
└── package.json                # Dependencias: mongodb, bcryptjs
```

---

## Variables de entorno

| Variable | Descripcion | Donde obtenerla |
|---|---|---|
| `MONGODB_URI` | URI de conexion a MongoDB Atlas | Atlas -> Connect -> Drivers |
| `MONGODB_DB` | Nombre de la base de datos (default: `bazar`) | Opcional |
| `CLOUDINARY_CLOUD_NAME` | Nombre del cloud | Cloudinary Dashboard |
| `CLOUDINARY_API_KEY` | Llave publica de API | Cloudinary Dashboard |
| `CLOUDINARY_API_SECRET` | Secreto de API | Cloudinary Dashboard |
| `MASTER_KEY` | Clave maestra para forzar sesion admin (opcional) | La que tu definas |

---

## Instalacion y despliegue

### Requisitos previos

- [Node.js](https://nodejs.org) v18+
- Cuenta en [Vercel](https://vercel.com)
- Cluster en [MongoDB Atlas](https://cloud.mongodb.com)
- Cuenta en [Cloudinary](https://cloudinary.com)
- Site Key de [Cloudflare Turnstile](https://dash.cloudflare.com/sign-up) (opcional)

### Pasos

**1. Clonar el repositorio**
```bash
git clone https://github.com/Stimpys-cm/Catalogodeunbazar.git
cd Catalogodeunbazar
npm install
```

**2. Instalar Vercel CLI e iniciar sesion**
```bash
npm install -g vercel
vercel login
```

**3. Agregar variables de entorno**
```bash
vercel env add MONGODB_URI
vercel env add MONGODB_DB
vercel env add CLOUDINARY_CLOUD_NAME
vercel env add CLOUDINARY_API_KEY
vercel env add CLOUDINARY_API_SECRET
vercel env add MASTER_KEY
```

**4. Configurar Turnstile (opcional)**
Edita `index.html` y reemplaza `SITE_KEY` con tu Site Key de Cloudflare Turnstile.

**5. Desplegar**
```bash
vercel --prod
```

---

## Colecciones en MongoDB

| Coleccion | Descripcion |
|---|---|
| `inventario` | Prendas con nombre, marca, categorias, talla, precio, costo, imagenes, estado, vendido |
| `categorias` | Catalogo de categorias |
| `marcas` | Catalogo de marcas |
| `usuarios` | Usuarios con username, password (hashed), role, sessionToken, avatar |
| `activos` | Sesiones activas con timestamp |
| `drops` | Colecciones programadas con fecha de publicacion |
| `logs` | Registro de actividad (rotacion automatica cada 5000 registros) |
| `logs_archivados` | Logs viejos archivados (disponibles para descarga) |
| `rate_limits` | Control de intentos por IP (TTL automatico) |
| `borrado_limite` | Limite de borrados por hora por vendedor |

---

## Sincronizacion en tiempo real

El sistema usa polling adaptativo a `/api/sync`:

- **3 segundos** -- cuando hay actividad reciente (< 15s)
- **6 segundos** -- visible pero tranquilo
- **15 segundos** -- pestana oculta o sin cambios

El endpoint `/api/sync` devuelve todas las colecciones en una sola llamada con cache de servidor de 2s. Los cambios disparan eventos:

```
db:inventario  -> re-renderiza el grid
db:categorias  -> actualiza filtros y selects
db:marcas      -> actualiza filtros y selects
db:usuarios    -> actualiza lista de vendedores
db:activos     -> actualiza badge de usuarios en linea
db:logs        -> actualiza registro de actividad
db:drops       -> actualiza vista de drops
```

---

## Panel de administracion

Acceso en `/login.html`. Credenciales por defecto: `admin` / `stiimpys2026`

### Pestanas

| Pestana | Acceso | Descripcion |
|---|---|---|
| Inventario | Todos | Grid con filtros Todos/Disponibles/Vendidos, busqueda, paginacion (50x) |
| Registrar | Todos | Formulario para agregar/editar prendas con preview en vivo |
| Catalogo | Solo admin | Gestion de categorias y marcas |
| Vendedores | Solo admin | CRUD de usuarios, cambios de contrasena |
| Drops | Todos | Gestion de colecciones programadas con publicacion automatica |
| Mi Cuenta | Todos | Avatar, preferencias, cambio de contrasena |
| Sistema | Solo admin | Metricas, verificacion de modulos, deteccion de errores, logs, respaldos |

### Permisos por rol

| Funcion | Admin | Vendedor |
|---|---|---|
| Ver inventario | Si | Si |
| Agregar/Editar prendas | Si | Si |
| Marcar vendido / Reactivar | Si | Si |
| Gestionar drops | Si | Si |
| Ver costo interno | Si | No |
| Ver ganancias | Si | No |
| Gestionar catalogo | Si | No |
| Gestionar vendedores | Si | No |
| Eliminar prendas | Si | No (limite de 10/hora) |
| Acceso a pestana Sistema | Si | No |

---

## API endpoints

| Endpoint | Metodos | Auth | Descripcion |
|---|---|---|---|
| `/api/auth` | POST | No | Login con sesion unica |
| `/api/sync` | GET | No | Todas las colecciones (con cache) |
| `/api/inventario` | GET, PUT | Solo PUT | Lista completa de prendas |
| `/api/inventario-item?id=N` | PATCH, DELETE | Si | Prenda individual |
| `/api/config?col=X` | GET, PUT | Solo PUT | Categorias, marcas, usuarios, drops |
| `/api/activos` | GET, POST, DELETE | POST/DELETE | Usuarios activos |
| `/api/upload` | POST | Si | Subir imagen a Cloudinary |
| `/api/acciones?op=X` | GET, POST | Segun op | Logs, borrar prenda, gestionar usuarios |
| `/api/change-password` | POST | Si | Cambiar contrasena propia |
| `/api/prenda?id=N` | GET | No | Open Graph HTML para compartir |
| `/api/session-check` | POST | No | Validar vigencia de token |

---

## Comandos utiles

```bash
# Redesplegar despues de cambios
vercel --prod

# Ver logs en tiempo real
vercel logs https://stiimpys.store --follow

# Ver variables de entorno
vercel env ls

# Subir cambios a GitHub
git add .
git commit -m "descripcion del cambio"
git push origin main
```

---

## Licencia

MIT -- libre para uso personal y comercial.

---

<div align="center">
  Hecho con ❤️ en Reynosa, Tamaulipas · 2026
</div>
