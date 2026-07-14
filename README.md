# 🛍️ Bazar En Linea

> Catálogo digital de ropa streetwear & vintage con panel de administración, sincronización en tiempo real y gestión de inventario — desplegado en Vercel con MongoDB Atlas y Cloudinary.

**🌐 Demo en vivo:** https://stiimpys.store/
---

## ✨ Características

- 📦 **Inventario en tiempo real** — los cambios aparecen en todas las pantallas en menos de 3 segundos sin recargar
- 🖼️ **Fotos en la nube** — imágenes almacenadas en Cloudinary, sin límites de tamaño
- 🔍 **Búsqueda y filtros** — por nombre, marca, categoría, talla y estado
- 👥 **Multi-usuario** — admin y vendedores con permisos diferenciados
- 📱 **Responsive** — funciona en celular, tablet y escritorio
- 💬 **WhatsApp directo** — botón de contacto por prenda con mensaje pre-armado
- 🟢 **Usuarios en línea** — badge en tiempo real de quién está en el panel

---

## 🏗️ Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | HTML5 · CSS3 · JavaScript vanilla |
| Hosting | [Vercel](https://vercel.com) (gratuito) |
| Base de datos | [MongoDB Atlas](https://cloud.mongodb.com) (gratuito M0) |
| Imágenes | [Cloudinary](https://cloudinary.com) (gratuito) |
| API | Vercel Serverless Functions (Node.js) |

---

## 📁 Estructura del proyecto

```
bazar-en-linea/
├── api/                    # Serverless Functions (backend)
│   ├── _db.js              # Conexión compartida a MongoDB
│   ├── inventario.js       # GET/PUT prendas
│   ├── config.js           # GET/PUT categorías, marcas, usuarios
│   ├── auth.js             # POST login
│   ├── activos.js          # GET/POST/DELETE usuarios activos
│   ├── sync.js             # GET todo en una sola petición
│   └── upload.js           # POST subir imagen a Cloudinary
├── css/
│   ├── global.css          # Variables, toast, modal
│   ├── tienda.css          # Estilos catálogo público
│   ├── admin.css           # Estilos panel de admin
│   └── login.css           # Estilos login
├── js/
│   ├── db.js               # Capa de datos (caché + polling + API)
│   ├── tienda.js           # Lógica catálogo público
│   ├── admin.js            # Lógica panel de administración
│   └── login.js            # Lógica autenticación
├── tienda.html             # Catálogo público
├── admin.html              # Panel de administración
├── login.html              # Inicio de sesión
├── vercel.json             # Configuración de rutas Vercel
└── package.json            # Dependencia: mongodb
```

---

## 🚀 Instalación y despliegue

### Requisitos previos

- [Node.js](https://nodejs.org) v18+
- Cuenta en [Vercel](https://vercel.com)
- Cluster en [MongoDB Atlas](https://cloud.mongodb.com)
- Cuenta en [Cloudinary](https://cloudinary.com)

### Pasos

**1. Clonar el repositorio**
```bash
git clone https://github.com/tu-usuario/bazar-en-linea.git
cd bazar-en-linea
npm install
```

**2. Instalar Vercel CLI e iniciar sesión**
```bash
npm install -g vercel
vercel login
```

**3. Agregar variables de entorno**
```bash
vercel env add MONGODB_URI
# mongodb+srv://usuario:password@cluster.mongodb.net/bazar

vercel env add CLOUDINARY_CLOUD_NAME
vercel env add CLOUDINARY_API_KEY
vercel env add CLOUDINARY_API_SECRET
```

**4. Desplegar**
```bash
vercel --prod
```

---

## 🔐 Variables de entorno

| Variable | Descripción | Dónde obtenerla |
|---|---|---|
| `MONGODB_URI` | URI de conexión a MongoDB Atlas | Atlas → Connect → Drivers |
| `CLOUDINARY_CLOUD_NAME` | Nombre del cloud | Cloudinary Dashboard |
| `CLOUDINARY_API_KEY` | Llave pública de API | Cloudinary Dashboard |
| `CLOUDINARY_API_SECRET` | Secreto de API | Cloudinary Dashboard |

---

## 📖 Manual de uso

### Tienda pública (`/tienda.html`)

La tienda muestra todas las prendas disponibles (no vendidas). Los visitantes pueden:

- **Buscar** por nombre, marca, talla, estado o categoría usando la barra de búsqueda
- **Filtrar** por categoría o marca desde el menú de navegación
- **Ver fotos** en tamaño completo haciendo clic en la imagen
- **Contactar** al vendedor directamente por WhatsApp con un mensaje pre-armado

### Panel de administración (`/admin.html`)

Acceso en `/login.html`. Credenciales por defecto: `admin` / `stiimpys2026`

#### Pestaña Inventario

Muestra todas las prendas con filtros: Todos, Disponibles y Vendidos.

| Acción | Cómo |
|---|---|
| Buscar prenda | Escribe en el buscador superior |
| Marcar como vendido | Botón **Vendido ✓** en la tarjeta |
| Reactivar prenda | Botón **Reactivar** en prendas vendidas |
| Editar prenda | Botón ✏️ |
| Eliminar prenda | Botón 🗑 (solo admin) |
| Ver fotos | Clic en la imagen, navegar con ‹ › |

#### Pestaña + Registrar

Formulario para agregar o editar prendas:

| Campo | Descripción |
|---|---|
| Nombre | Nombre descriptivo de la prenda |
| Marca | Selección del catálogo de marcas |
| Categorías | Selección múltiple de categorías |
| Talla | Talla (M, L, 32, etc.) |
| Precio de Venta | Precio que ve el cliente |
| Costo Interno 🔒 | Solo visible para admin |
| Estado | Nuevo con etiquetas, Como nuevo, etc. |
| Fotos | Hasta 6 fotos, se suben a Cloudinary |

#### Pestaña 🏷 Catálogo *(solo admin)*

Gestión de **categorías** y **marcas** que se usan en el formulario de registro.

- Agregar nueva categoría o marca
- Editar nombre existente
- Eliminar (solo si no hay prendas usándola)

#### Pestaña 👥 Vendedores *(solo admin)*

Gestión de usuarios con rol vendedor.

| Acción | Descripción |
|---|---|
| Crear vendedor | Usuario y contraseña mínimo 4 caracteres |
| Cambiar contraseña | Botón 🔑 |
| Eliminar vendedor | Botón 🗑 |

**Permisos por rol:**

| Función | Admin | Vendedor |
|---|---|---|
| Ver inventario | ✅ | ✅ |
| Agregar prendas | ✅ | ✅ |
| Editar prendas | ✅ | ✅ |
| Marcar vendido | ✅ | ✅ |
| Ver costo interno | ✅ | ❌ |
| Ver ganancias | ✅ | ❌ |
| Gestionar catálogo | ✅ | ❌ |
| Gestionar vendedores | ✅ | ❌ |
| Eliminar prendas | ✅ | ❌ |

---

## 🔄 Sincronización en tiempo real

El sistema hace una petición a `/api/sync` cada **3 segundos** que devuelve todas las colecciones en una sola llamada. Si detecta cambios dispara eventos que actualizan la UI automáticamente:

```
db:inventario  → re-renderiza el grid
db:categorias  → actualiza filtros y selects
db:marcas      → actualiza filtros y selects
db:usuarios    → actualiza lista de vendedores
db:activos     → actualiza badge de usuarios en línea
```

---

## 📊 Estadísticas (solo admin)

El panel muestra en tiempo real:

- 💰 **Ganancia Neta** — total ventas menos total costos
- 💳 **Total Ventas** — suma de precios de venta de prendas vendidas
- ✅ **Prendas Vendidas** — cantidad total
- 📦 **Disponibles** — prendas activas en el catálogo

---

## 🛠️ Comandos útiles

```bash
# Redesplegar después de cambios
vercel --prod

# Ver logs en tiempo real
vercel logs https://tu-url.vercel.app --follow

# Ver variables de entorno
vercel env ls

# Subir cambios a GitHub
git add .
git commit -m "descripción del cambio"
git push origin main
```

---

## 📄 Licencia

MIT — libre para uso personal y comercial.

---

<div align="center">
  Hecho con ❤️ en Reynosa, Tamaulipas · 2026
</div>
