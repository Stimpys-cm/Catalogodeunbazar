// api/config.js
// GET /api/config?col=X       → lista items (público, para sembrar defaults)
// PUT /api/config             → reemplaza toda la colección (requiere sesión)
//
// Reglas (Fase 1):
//  - categorias / marcas / drops  → solo ADMIN.
//  - usuarios                     → ADMIN completo; un vendedor solo puede
//    cambiar SU PROPIO avatar (bloquea escalación de privilegios).

import { getDB, invalidarSyncCache } from './_db.js';
import { requireAuth } from './_auth.js';
import { esGlobal, puede, normalizarPermisos, PERMISOS_DEFAULT } from './_bazar.js';

const COLS = ['categorias', 'marcas', 'usuarios', 'drops', 'bazares'];

const DEFAULTS = {
  categorias: [
    { id:1, nombre:'Pantalones' }, { id:2, nombre:'Playeras' },
    { id:3, nombre:'Suéteres' }, { id:4, nombre:'Chamarras' }, { id:5, nombre:'Shorts' },
  ],
  marcas: [
    { id:1, nombre:'Nike' }, { id:2, nombre:'Adidas' }, { id:3, nombre:'Supreme' }, { id:4, nombre:'Dickies' },
  ],
  bazares: [
    { id:1, slug:'stiimpys', nombre:'Stiimpys', whatsapp:'528995284602',
      instagram:'stiimpys', descripcion:'Streetwear, vintage y prendas únicas seleccionadas a mano.',
      ubicacion:'Reynosa, Tamaulipas', color:'', portada:'', activo:true,
      permisos: { ...PERMISOS_DEFAULT, gestionarUsuarios:true } },
  ],
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db = await getDB();

    // ── GET ──────────────────────────────────────────────────
    if (req.method === 'GET') {
      const colName = String(req.query.col || '');
      if (!COLS.includes(colName)) {
        return res.status(400).json({ error: `col debe ser: ${COLS.join(', ')}` });
      }

      // 🔒 La lista de cuentas NUNCA es pública: expondría el token de sesión
      // de cada usuario y con eso cualquiera entraría como administrador.
      if (colName === 'usuarios') {
        const user = await requireAuth(req, res);
        if (!user) return;                                  // 401
        if (user.role !== 'admin') {
          return res.status(403).json({ error: 'Requiere permisos de administrador.' });
        }
      }

      const col   = db.collection(colName);
      const count = await col.countDocuments();
      if (count === 0 && DEFAULTS[colName]) await col.insertMany(DEFAULTS[colName]);
      const items = await col.find({}).sort({ id: 1 }).toArray();
      return res.status(200).json(items.map(sinSecretos));
    }

    // ── PUT — reemplaza toda la colección (requiere sesión) ──
    if (req.method === 'PUT') {
      const user = await requireAuth(req, res);
      if (!user) return;                                  // 401

      const { col: colName, list } = req.body;
      if (!COLS.includes(colName)) {
        return res.status(400).json({ error: `col debe ser: ${COLS.join(', ')}` });
      }
      if (!Array.isArray(list)) {
        return res.status(400).json({ error: 'body.list debe ser array' });
      }
      // El guardado va por id: sin él no se sabe qué documento reemplazar.
      if (list.some(x => x == null || x.id == null)) {
        return res.status(400).json({ error: 'Todos los elementos deben tener id' });
      }

      const col  = db.collection(colName);
      const prev = await col.find({}).toArray();

      // 🔒 Autorización por colección
      if (colName === 'bazares') {
        // El admin principal crea bazares y reparte permisos.
        // Un bazar con permiso "personalizar" solo edita la presentación
        // del suyo: nunca su slug, sus permisos ni los demás bazares.
        if (!esGlobal(user)) {
          if (!user.bazarId || !(await puede(user, 'personalizar'))) {
            return res.status(403).json({ error: 'Tu bazar no tiene permitido personalizar su apartado.' });
          }
          const mio = Number(user.bazarId);
          const antes = new Map(prev.map(b => [Number(b.id), b]));

          if (list.length !== prev.length) {
            return res.status(403).json({ error: 'No puedes crear ni eliminar bazares.' });
          }

          const EDITABLES = ['nombre', 'whatsapp', 'instagram', 'descripcion',
                             'ubicacion', 'color', 'logo', 'banner', 'portada'];

          for (const b of list) {
            const old = antes.get(Number(b.id));
            if (!old) return res.status(403).json({ error: 'No puedes crear bazares.' });

            if (Number(b.id) !== mio) {
              // Bazar ajeno: debe llegar tal cual
              if (JSON.stringify({ ...old, ...b }) !== JSON.stringify(old)) {
                return res.status(403).json({ error: `No puedes modificar "${old.nombre}".` });
              }
              continue;
            }

            // El propio: se toman solo los campos de presentación
            const limpio = { ...old };
            for (const k of EDITABLES) if (k in b) limpio[k] = b[k];
            limpio.slug     = old.slug;                       // el @ no se cambia solo
            limpio.permisos = old.permisos;                   // ni sus permisos
            limpio.activo   = old.activo !== false;           // ni su visibilidad
            Object.keys(b).forEach(k => delete b[k]);
            Object.assign(b, limpio);
          }
          // Validar el color que llegue (formato #rrggbb)
          for (const b of list) {
            if (b.color && !/^#[0-9a-fA-F]{6}$/.test(String(b.color))) {
              return res.status(400).json({ error: 'Color inválido. Usa formato #2d6be4.' });
            }
          }
          await guardarColeccion(col, list);
          invalidarSyncCache();
          return res.status(200).json({ ok: true, count: list.length });
        }
        // Normalizar permisos y no permitir slugs repetidos
        const vistos = new Set();
        for (const b of list) {
          if (!b.slug) return res.status(400).json({ error: 'Cada bazar necesita un slug (@usuario).' });
          const slug = String(b.slug).toLowerCase().replace(/^@/, '').trim();
          if (vistos.has(slug)) return res.status(400).json({ error: `Slug repetido: @${slug}` });
          vistos.add(slug);
          b.slug = slug;
          b.permisos = normalizarPermisos(b.permisos);
          b.activo = b.activo !== false;
          if (b.color && !/^#[0-9a-fA-F]{6}$/.test(String(b.color))) {
            return res.status(400).json({ error: `Color inválido en "${b.nombre}". Usa formato #2d6be4.` });
          }
        }
      } else if (colName === 'categorias' || colName === 'marcas') {
        // Generales (bazarId null) → solo admin.
        // Propias del bazar → el dueño, si tiene el permiso.
        if (!esGlobal(user)) {
          if (!user.bazarId || !(await puede(user, 'gestionarCatalogo'))) {
            return res.status(403).json({ error: 'Tu bazar no tiene permitido gestionar el catálogo.' });
          }
          const mio = Number(user.bazarId);
          const antes = new Map(prev.map(x => [x.id, x]));
          // No puede tocar nada que no sea suyo
          for (const item of list) {
            const old = antes.get(item.id);
            if (old && Number(old.bazarId || 0) !== mio) {
              if (JSON.stringify(old) !== JSON.stringify({ ...old, ...item })) {
                return res.status(403).json({ error: `"${old.nombre}" es general o de otro bazar.` });
              }
            }
            if (!old) item.bazarId = mio;          // lo nuevo nace suyo
          }
          // Ni borrar lo ajeno: reinyectar lo que quitó y no era suyo
          const idsEnviados = new Set(list.map(x => x.id));
          for (const old of prev) {
            if (!idsEnviados.has(old.id) && Number(old.bazarId || 0) !== mio) list.push(old);
          }
        }
      } else if (colName !== 'usuarios') {
        // drops → solo admin
        if (user.role !== 'admin') {
          return res.status(403).json({ error: 'Requiere permisos de administrador.' });
        }
      } else if (!esGlobal(user) && user.bazarId && (await puede(user, 'gestionarUsuarios'))) {
        // Dueño de bazar con permiso: administra SOLO las cuentas de su bazar
        const mio   = Number(user.bazarId);
        const antes = new Map(prev.map(u => [u.id, u]));

        for (const u of list) {
          const old = antes.get(u.id);
          if (!old) {
            // Cuenta nueva: nace en su bazar y nunca como admin
            u.bazarId = mio;
            if (u.role === 'admin') {
              return res.status(403).json({ error: 'No puedes crear administradores.' });
            }
            continue;
          }
          if (Number(old.bazarId || 0) !== mio) {
            // Cuenta ajena: debe llegar idéntica
            if (JSON.stringify({ ...old, ...u }) !== JSON.stringify(old)) {
              return res.status(403).json({ error: `No puedes modificar la cuenta "${old.username}".` });
            }
            continue;
          }
          if (u.role !== old.role && u.role === 'admin') {
            return res.status(403).json({ error: 'No puedes ascender cuentas a administrador.' });
          }
          u.bazarId = mio;
        }
        // No puede borrar cuentas de otros bazares
        const enviados = new Set(list.map(u => u.id));
        for (const old of prev) {
          if (!enviados.has(old.id) && Number(old.bazarId || 0) !== mio) list.push(old);
        }
      } else if (user.role !== 'admin') {
        // usuarios + no-admin → solo puede tocar SU propio avatar
        const prevById = new Map(prev.map(u => [u.id, u]));
        const soloSuAvatar = list.length === prev.length && list.every(u => {
          const old = prevById.get(u.id);
          if (!old) return false;                          // no puede agregar usuarios
          if (u.username !== old.username) return false;   // no renombra
          if (u.role !== old.role) return false;           // no cambia roles (escalación)
          if (u.id === user.id) return true;               // su propio doc: puede tocar avatar
          return (u.avatar ?? null) === (old.avatar ?? null); // ajenos: avatar intacto
        });
        if (!soloSuAvatar) {
          return res.status(403).json({ error: 'Solo un administrador puede gestionar usuarios.' });
        }
      }

      // Para 'usuarios': la contraseña y el token JAMÁS se toman del cliente.
      // Cambiar contraseñas va por /api/change-password y /api/acciones, que
      // las hashean. Así nadie puede escribir una contraseña en texto plano
      // ni fijar el token de sesión de otra cuenta desde el navegador.
      let toInsert = list;
      if (colName === 'usuarios') {
        const byId = new Map(prev.map(u => [u.id, u]));
        toInsert = list.map(u => {
          const old = byId.get(u.id);
          const { password: _ignorada, sessionToken: _ignorado,
                  tokenExpira: _ignorada2, ...limpio } = u;
          return {
            ...limpio,
            password:     old ? old.password : undefined,
            sessionToken: old ? old.sessionToken : null,
            // Igual que el token: la caducidad la fija el servidor al
            // iniciar sesión, nunca el navegador.
            tokenExpira:  old ? old.tokenExpira : null,
            avatar:       (u.avatar !== undefined) ? u.avatar : (old ? old.avatar : null),
          };
        });
        // El admin principal (id 1 o 'admin') NUNCA se elimina.
        const hayPrincipal = toInsert.some(u => u.id === 1 || (u.username && u.username.toLowerCase() === 'admin'));
        if (!hayPrincipal) {
          const principal = prev.find(u => u.id === 1 || (u.username && u.username.toLowerCase() === 'admin'));
          if (principal) toInsert.push(principal);
        }
      }

      await guardarColeccion(col, toInsert);
      invalidarSyncCache();
      return res.status(200).json({ ok: true, count: toInsert.length });
    }

    return res.status(405).json({ error: 'Método no permitido' });

  } catch (err) {
    console.error('[config]', err);
    return res.status(500).json({ error: 'No se pudo completar la operación.' });
  }
}

// Guardado diff-based, igual que api/inventario.js: cada documento se
// reemplaza por su id y solo se borran los que ya no están en la lista.
// Borrar la colección entera y reinsertar deja la base vacía si el insert
// falla a medias, y aquí viven las cuentas y los bazares.
async function guardarColeccion(col, lista) {
  const ids = lista.map(x => x.id);
  const ops = lista.map(x => ({
    replaceOne: { filter: { id: x.id }, replacement: sinMongoId(x), upsert: true }
  }));
  ops.push({ deleteMany: { filter: { id: { $nin: ids } } } });
  await col.bulkWrite(ops, { ordered: false });
}

function sinMongoId({ _id, ...rest }) { return rest; }

// Nada de contraseñas ni tokens sale de aquí, ni siquiera para un admin:
// el panel no los necesita y así no pueden filtrarse por accidente.
function sinSecretos({ _id, password, sessionToken, ...rest }) { return rest; }
