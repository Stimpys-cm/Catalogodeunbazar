// api/_subastas.js
// ─────────────────────────────────────────────────────────────
// Subastas: una prenda con precio de salida y hora de cierre. Gana
// quien haya ofertado más cuando se acabe el tiempo.
//
// Por qué el estado vive en su propia colección y no dentro de la
// prenda: el panel guarda el inventario mandando la lista COMPLETA
// (PUT /api/inventario). Si las ofertas vivieran en la prenda, que el
// vendedor guardara con datos viejos borraría las pujas de la gente.
// Aquí el servidor es el único que escribe, y una oferta no se puede
// perder por un guardado del panel.
//
//   subastas  { prendaId, bazarId, precioInicial, incrementoMin, fin,
//               ofertaActual, lider, totalOfertas, cerrada, ganador }
//   ofertas   { id, prendaId, monto, username, tipo, telefono, fecha }
//   invitados { username, telefono, creadoEn }  ← participantes sin cuenta
// ─────────────────────────────────────────────────────────────

import { getDB } from './_db.js';
import { normalizarUsername, usernameValido, siguienteId } from './_ventas.js';

// El salto mínimo entre una oferta y la siguiente.
export const INCREMENTO_MIN = 50;

// Ni una subasta de dos minutos ni una de un año.
export const DURACION_MIN_MIN =  10;          // 10 minutos
export const DURACION_MAX_MIN =  60 * 24 * 30; // 30 días

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export async function asegurarIndicesSubasta() {
  if (global._idxSubastas) return;
  try {
    const db = await getDB();
    await db.collection('subastas').createIndex({ prendaId: 1 }, { unique: true });
    await db.collection('ofertas').createIndex({ prendaId: 1, monto: -1 });
    await db.collection('invitados').createIndex({ username: 1 }, { unique: true });
    global._idxSubastas = true;
  } catch (_) { /* si falla, se sigue: los índices son una optimización */ }
}

// ── Estado ───────────────────────────────────────────────────
export const yaTermino = s => !!s && new Date(s.fin).getTime() <= Date.now();

// Lo mínimo que hay que ofertar para participar.
export function minimoSiguiente(s) {
  if (!s) return 0;
  const inc = num(s.incrementoMin) || INCREMENTO_MIN;
  return s.totalOfertas > 0 ? num(s.ofertaActual) + inc : num(s.precioInicial);
}

// Lo que puede ver cualquiera. El teléfono de los invitados NUNCA sale
// de aquí: es un dato de contacto, no parte de la subasta.
export function subastaPublica(s) {
  if (!s) return null;
  const cerrada = s.cerrada === true || yaTermino(s);
  return {
    prendaId:      Number(s.prendaId),
    bazarId:       Number(s.bazarId || 1),
    precioInicial: num(s.precioInicial),
    incrementoMin: num(s.incrementoMin) || INCREMENTO_MIN,
    fin:           s.fin,
    ofertaActual:  num(s.ofertaActual),
    totalOfertas:  Number(s.totalOfertas || 0),
    lider:         s.lider ? { username: s.lider.username } : null,
    minimo:        minimoSiguiente(s),
    cerrada,
    ganador:       cerrada && s.lider ? { username: s.lider.username, monto: num(s.ofertaActual) } : null,
    ultimaOferta:  s.ultimaOferta || null,
  };
}

export const ofertaPublica = o => ({
  monto:    num(o.monto),
  username: o.username,
  tipo:     o.tipo,
  fecha:    o.fecha,
});

// ── Participantes sin cuenta ─────────────────────────────────
// Un invitado se identifica con un @usuario temporal y su teléfono. El
// usuario no puede chocar con el de nadie: ni con otra cuenta ni con
// otro invitado. Si vuelve con el mismo teléfono, es él y sigue usando
// el suyo; si el teléfono no coincide, ese nombre está ocupado.
export function telefonoValido(t) {
  const solo = String(t ?? '').replace(/[^0-9]/g, '');
  return solo.length >= 10 && solo.length <= 15 ? solo : null;
}

export async function usernameLibre(username) {
  const db = await getDB();
  const enCuentas = await db.collection('clientes').findOne({ username });
  if (enCuentas) return false;
  const enInvitados = await db.collection('invitados').findOne({ username });
  return !enInvitados;
}

// Devuelve { ok, invitado } o { ok:false, error }
export async function registrarInvitado(usernameCrudo, telefonoCrudo) {
  const db  = await getDB();
  const col = db.collection('invitados');

  const username = normalizarUsername(usernameCrudo);
  const telefono = telefonoValido(telefonoCrudo);

  if (!usernameValido(username)) {
    return { ok: false, error: 'El usuario necesita entre 3 y 30 caracteres (letras, números, . _ -)' };
  }
  if (!telefono) {
    return { ok: false, error: 'Escribe un teléfono de 10 dígitos para poder avisarte si ganas' };
  }

  // ¿Ese nombre ya es de una cuenta registrada? Entonces no se presta.
  const deCuenta = await db.collection('clientes').findOne({ username });
  if (deCuenta) {
    return { ok: false, error: `@${username} ya es de una cuenta registrada. Elige otro.` };
  }

  const existente = await col.findOne({ username });
  if (existente) {
    if (existente.telefono !== telefono) {
      return { ok: false, error: `@${username} ya está ocupado. Elige otro.` };
    }
    await col.updateOne({ username }, { $set: { ultimaVez: new Date().toISOString() } });
    return { ok: true, invitado: existente };
  }

  const invitado = {
    username, telefono,
    creadoEn: new Date().toISOString(),
    ultimaVez: new Date().toISOString(),
  };
  try {
    await col.insertOne(invitado);
  } catch (err) {
    // Carrera: alguien lo tomó entre la consulta y el insert
    if (err?.code === 11000) return { ok: false, error: `@${username} acaba de ser tomado. Elige otro.` };
    throw err;
  }
  return { ok: true, invitado };
}

// ── Configurar (la crea o la actualiza el vendedor) ──────────
export async function guardarSubasta({ prendaId, bazarId, precioInicial, fin }) {
  const db  = await getDB();
  const col = db.collection('subastas');
  await asegurarIndicesSubasta();

  const inicial = Math.round(num(precioInicial));
  const cierre  = new Date(fin);

  if (!(inicial > 0))         return { ok: false, error: 'El precio de salida tiene que ser mayor que cero' };
  if (isNaN(cierre.getTime())) return { ok: false, error: 'La fecha de cierre no es válida' };

  const minutos = (cierre.getTime() - Date.now()) / 60000;
  if (minutos < DURACION_MIN_MIN) {
    return { ok: false, error: `La subasta tiene que durar al menos ${DURACION_MIN_MIN} minutos` };
  }
  if (minutos > DURACION_MAX_MIN) {
    return { ok: false, error: 'La subasta no puede durar más de 30 días' };
  }

  const actual = await col.findOne({ prendaId: Number(prendaId) });

  // Con ofertas encima no se puede mover el precio de salida ni acortar
  // el tiempo: sería cambiarle las reglas a quien ya puso su dinero.
  if (actual && actual.totalOfertas > 0) {
    if (Math.round(num(actual.precioInicial)) !== inicial) {
      return { ok: false, error: 'Ya hay ofertas: el precio de salida no se puede cambiar' };
    }
    if (cierre.getTime() < new Date(actual.fin).getTime()) {
      return { ok: false, error: 'Ya hay ofertas: la subasta solo se puede alargar, no acortar' };
    }
  }

  await col.updateOne(
    { prendaId: Number(prendaId) },
    {
      $set: {
        bazarId: Number(bazarId || 1),
        precioInicial: inicial,
        incrementoMin: INCREMENTO_MIN,
        fin: cierre.toISOString(),
        cerrada: false,
        actualizadoEn: new Date().toISOString(),
      },
      $setOnInsert: {
        prendaId: Number(prendaId),
        ofertaActual: 0,
        totalOfertas: 0,
        lider: null,
        ultimaOferta: null,
        creadoEn: new Date().toISOString(),
      },
    },
    { upsert: true }
  );

  return { ok: true, subasta: await col.findOne({ prendaId: Number(prendaId) }) };
}

export async function quitarSubasta(prendaId) {
  const db = await getDB();
  await db.collection('subastas').deleteOne({ prendaId: Number(prendaId) });
  await db.collection('ofertas').deleteMany({ prendaId: Number(prendaId) });
}

// ── Ofertar ──────────────────────────────────────────────────
// Quien oferta ya viene identificado: { username, tipo, clienteId?, telefono? }
export async function ofertar({ prendaId, monto, postor }) {
  const db  = await getDB();
  const col = db.collection('subastas');
  const id  = Number(prendaId);

  const s = await col.findOne({ prendaId: id });
  if (!s)               return { ok: false, codigo: 404, error: 'Esa prenda no está en subasta' };
  if (s.cerrada)        return { ok: false, codigo: 409, error: 'La subasta ya se cerró' };
  if (yaTermino(s))     return { ok: false, codigo: 409, error: 'La subasta ya terminó' };

  const cantidad = Math.round(num(monto));
  const minimo   = minimoSiguiente(s);
  if (!(cantidad > 0)) return { ok: false, codigo: 400, error: 'Escribe cuánto quieres ofertar' };
  if (cantidad < minimo) {
    return {
      ok: false, codigo: 400,
      error: `La siguiente oferta tiene que ser de al menos $${minimo.toLocaleString('es-MX')} MXN`,
    };
  }

  // Ya vas ganando: no tiene sentido pujar contra ti mismo.
  if (s.lider && s.lider.username === postor.username && s.totalOfertas > 0) {
    return { ok: false, codigo: 409, error: 'Ya vas ganando esta subasta' };
  }

  // La condición del update es la que decide quién gana si dos personas
  // ofertan a la vez: solo pasa si el precio sigue siendo el que leímos.
  const r = await col.updateOne(
    { prendaId: id, ofertaActual: num(s.ofertaActual), totalOfertas: Number(s.totalOfertas || 0) },
    {
      $set: {
        ofertaActual: cantidad,
        lider: { username: postor.username, tipo: postor.tipo },
        ultimaOferta: new Date().toISOString(),
      },
      $inc: { totalOfertas: 1 },
    }
  );
  if (r.modifiedCount !== 1) {
    return { ok: false, codigo: 409, error: 'Alguien ofertó justo antes que tú. Vuelve a intentar.' };
  }

  await db.collection('ofertas').insertOne({
    id: await siguienteId('ofertas'),
    prendaId: id,
    bazarId: Number(s.bazarId || 1),
    monto: cantidad,
    username: postor.username,
    tipo: postor.tipo,
    clienteId: postor.clienteId ?? null,
    telefono: postor.telefono || null,   // solo lo ve el vendedor
    fecha: new Date().toISOString(),
  });

  return { ok: true, subasta: await col.findOne({ prendaId: id }) };
}

// ── Cierre ───────────────────────────────────────────────────
// Nadie corre tareas programadas aquí, así que la subasta se cierra
// sola la primera vez que alguien la mira después de la hora.
export async function cerrarSiToca(s) {
  if (!s || s.cerrada || !yaTermino(s)) return s;
  const db = await getDB();
  await db.collection('subastas').updateOne(
    { prendaId: Number(s.prendaId) },
    { $set: { cerrada: true, cerradaEn: new Date().toISOString() } }
  );
  return { ...s, cerrada: true };
}

export async function leerSubasta(prendaId) {
  const db = await getDB();
  const s  = await db.collection('subastas').findOne({ prendaId: Number(prendaId) });
  return s ? await cerrarSiToca(s) : null;
}

export async function historial(prendaId, limite = 12) {
  const db = await getDB();
  return db.collection('ofertas')
    .find({ prendaId: Number(prendaId) })
    .sort({ monto: -1 }).limit(limite).toArray();
}

// Datos de contacto del ganador. Solo para el vendedor de esa prenda.
export async function contactoGanador(prendaId) {
  const db = await getDB();
  const s  = await db.collection('subastas').findOne({ prendaId: Number(prendaId) });
  if (!s || !s.lider) return null;

  if (s.lider.tipo === 'invitado') {
    const inv = await db.collection('invitados').findOne({ username: s.lider.username });
    return { username: s.lider.username, tipo: 'invitado', telefono: inv?.telefono || '' };
  }
  const c = await db.collection('clientes').findOne({ username: s.lider.username });
  return {
    username: s.lider.username, tipo: 'cuenta',
    telefono: c?.telefono || '', nombre: c?.nombre || '', email: c?.email || '',
  };
}

// Contacto de varias personas de un jalón (invitados y cuentas).
// Se usa solo para subastas ya cerradas: mientras corre, el vendedor no
// tiene por qué tener el teléfono de nadie.
export async function contactosDe(usernames) {
  const mapa = new Map();
  const lista = [...new Set(usernames)].filter(Boolean);
  if (!lista.length) return mapa;

  const db = await getDB();
  const [invitados, clientes] = await Promise.all([
    db.collection('invitados').find({ username: { $in: lista } }).toArray(),
    db.collection('clientes').find({ username: { $in: lista } },
      { projection: { username: 1, nombre: 1, telefono: 1, email: 1 } }).toArray(),
  ]);

  invitados.forEach(i => mapa.set(i.username,
    { username: i.username, tipo: 'invitado', telefono: i.telefono || '' }));
  clientes.forEach(c => mapa.set(c.username,
    { username: c.username, tipo: 'cuenta', nombre: c.nombre || '',
      telefono: c.telefono || '', email: c.email || '' }));
  return mapa;
}

// Cuántos puestos del podio llevan contacto visible para el vendedor.
// Tres, para que si el ganador no responde se pueda ir al siguiente.
export const PUESTOS_CON_CONTACTO = 3;

// ── Todas las subastas de un bazar, con sus participantes ────
// Una sola consulta por colección en vez de una por subasta: el panel
// pinta la lista completa de un tirón.
export async function subastasDeBazares(bazarIds) {
  const db  = await getDB();
  const ids = bazarIds.map(Number);

  const subastas = await db.collection('subastas')
    .find({ bazarId: { $in: ids } })
    .sort({ fin: -1 })
    .limit(300)
    .toArray();
  if (!subastas.length) return [];

  const prendaIds = subastas.map(s => Number(s.prendaId));

  const [prendas, ofertas] = await Promise.all([
    db.collection('inventario')
      .find({ id: { $in: prendaIds } },
            { projection: { id: 1, nombre: 1, marca: 1, imagenes: 1, precio_venta: 1,
                            costo: 1, vendido: 1, vendidoA: 1, bazarId: 1, talla: 1 } })
      .toArray(),
    db.collection('ofertas')
      .find({ prendaId: { $in: prendaIds } })
      .sort({ monto: -1 })
      .toArray(),
  ]);

  const porPrenda = new Map(prendas.map(p => [Number(p.id), p]));

  // Participantes: una fila por persona, no por oferta. Lo que interesa
  // del que quedó en tercer lugar es cuánto llegó a ofrecer, no cada
  // paso que dio para llegar ahí.
  const porSubasta = new Map();
  for (const o of ofertas) {
    const id = Number(o.prendaId);
    if (!porSubasta.has(id)) porSubasta.set(id, new Map());
    const gente = porSubasta.get(id);
    const previo = gente.get(o.username);
    if (!previo) {
      gente.set(o.username, {
        username: o.username,
        tipo: o.tipo,
        maxOferta: num(o.monto),
        ofertas: 1,
        primera: o.fecha,
        ultima: o.fecha,
      });
    } else {
      previo.ofertas += 1;
      previo.maxOferta = Math.max(previo.maxOferta, num(o.monto));
      if (new Date(o.fecha) < new Date(previo.primera)) previo.primera = o.fecha;
      if (new Date(o.fecha) > new Date(previo.ultima))  previo.ultima  = o.fecha;
    }
  }

  // Cerrar las que ya pasaron de hora, aprovechando que estamos aquí
  const vencidas = subastas.filter(s => !s.cerrada && yaTermino(s)).map(s => Number(s.prendaId));
  if (vencidas.length) {
    await db.collection('subastas').updateMany(
      { prendaId: { $in: vencidas } },
      { $set: { cerrada: true, cerradaEn: new Date().toISOString() } }
    );
    subastas.forEach(s => { if (vencidas.includes(Number(s.prendaId))) s.cerrada = true; });
  }

  // Los tres primeros de cada subasta CERRADA llevan contacto: si el que
  // ganó no responde, el vendedor puede ofrecérsela al siguiente sin
  // tener que perseguirlo por fuera. En las que siguen corriendo no se
  // resuelve el teléfono de nadie.
  const podios = new Map();     // prendaId → [username, ...] con contacto
  const aBuscar = [];
  for (const s of subastas) {
    if (!s.cerrada) continue;
    const gente = [...(porSubasta.get(Number(s.prendaId))?.values() || [])]
      .sort((a, b) => b.maxOferta - a.maxOferta)
      .slice(0, PUESTOS_CON_CONTACTO)
      .map(u => u.username);
    podios.set(Number(s.prendaId), gente);
    aBuscar.push(...gente);
  }
  const contactos = await contactosDe(aBuscar);

  return subastas.map(s => {
    const id = Number(s.prendaId);
    const p  = porPrenda.get(id) || null;
    const podio = podios.get(id) || [];
    const gente = [...(porSubasta.get(id)?.values() || [])]
      .sort((a, b) => b.maxOferta - a.maxOferta)
      .map(u => {
        const c = podio.includes(u.username) ? contactos.get(u.username) : null;
        return c
          ? { ...u, telefono: c.telefono || '', nombre: c.nombre || '', email: c.email || '' }
          : u;
      });

    return {
      ...subastaPublica(s),
      prenda: p ? {
        id: p.id, nombre: p.nombre, marca: p.marca || '', talla: p.talla || '',
        imagen: (Array.isArray(p.imagenes) ? p.imagenes : []).filter(Boolean)[0] || '',
        precio_venta: num(p.precio_venta), costo: num(p.costo),
        vendido: !!p.vendido, vendidoA: p.vendidoA || '', bazarId: Number(p.bazarId || 1),
      } : null,
      participantes: gente,
      ganador: s.cerrada && s.lider ? (contactos.get(s.lider.username) || null) : null,
      puestosConContacto: s.cerrada ? PUESTOS_CON_CONTACTO : 0,
    };
  });
}
