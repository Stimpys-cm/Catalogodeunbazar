// ─────────────────────────────────────────────────────────────
//  api/_lib/clientes.js — Cupón de cumpleaños · v42
//
//  El cliente deja su fecha de cumpleaños (día y mes, nunca el año) en su
//  recibo pagado. Cada día, la tarea automática busca a quien cumple hoy y le
//  manda por correo un cupón personal de un solo uso que vence en 7 días.
//  Colecciones: cumpleanos { bazarId, tel10, cumple:'MM-DD', email, nombre, cumpleEnviado:'AAAA' }
//               (aparte de "clientes", que son las cuentas: así un cumpleaños nunca se confunde con una cuenta)
//               cuponesPersonales { codigo, bazarId, tel10, valor, vence, usado }
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';

const hoyMx = (t = Date.now()) => new Date(t - 6 * 3600e3).toISOString().slice(0, 10);
export const tel10 = t => String(t || '').replace(/\D/g, '').slice(-10);
export const cumpleValido = c => { const m = /^(\d{2})-(\d{2})$/.exec(String(c || '')); if (!m) return false;
  const mes = +m[1], dia = +m[2]; return mes >= 1 && mes <= 12 && dia >= 1 && dia <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1]; };

export async function guardarCumple(db, pedido, cumple) {
  const t = tel10(pedido.telefono);
  if (t.length !== 10 || !cumpleValido(cumple)) return false;
  await db.collection('cumpleanos').updateOne({ bazarId: pedido.bazarId, tel10: t },
    { $set: { cumple, ...(pedido.email ? { email: pedido.email } : {}), nombre: String(pedido.nombre || '').split(' ')[0], en: new Date().toISOString() } }, { upsert: true });
  return true;
}

// Cupón personal: CUMPLE-XXXXXX (6 caracteres al azar, sin 0/O/1/I para dictarlo por teléfono)
const LETRAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codigoNuevo = () => 'CUMPLE-' + [...crypto.randomBytes(6)].map(b => LETRAS[b % LETRAS.length]).join('');

export async function cuponPersonal(db, bazarId, codigo) {
  codigo = String(codigo || '').trim().toUpperCase();
  if (!/^(CUMPLE|REGALO)-[A-Z0-9]{6}$/.test(codigo)) return null;   // v43: también los regalos por invitar amigos
  const c = await db.collection('cuponesPersonales').findOne({ codigo, bazarId });
  if (!c) return null;
  if (c.usado) return { error: 'Ese cupón ya se usó.' };
  if (c.vence < hoyMx()) return { error: 'Ese cupón ya venció.' };
  return { cupon: { codigo: c.codigo, tipo: 'pct', valor: c.valor, minimo: 0, personal: true, tel10: c.tel10 || null } };
}
export const usarCuponPersonal = (db, pedido) => db.collection('cuponesPersonales').updateOne({ codigo: pedido.cupon, bazarId: pedido.bazarId, usado: { $ne: true } },
  { $set: { usado: true, pedido: pedido.id, usadoEn: new Date().toISOString() } });

// Tarea diaria: cupón a quien cumple hoy (una vez por año)
export async function cumpleanos(db, bazar, cfg) {
  if (!cfg?.frecuente?.cumple) return [];
  const { correoConfigurado, enviarCorreo, plantilla } = await import('./correo.js');
  if (!correoConfigurado()) return [];
  const hoy = hoyMx(), anio = hoy.slice(0, 4), mmdd = hoy.slice(5);
  const lista = await db.collection('cumpleanos').find({ bazarId: bazar.id, cumple: mmdd, email: { $exists: true, $ne: '' }, cumpleEnviado: { $ne: anio } }).limit(50).toArray();
  const hechos = [];
  const sitio = (process.env.SITE_URL || 'https://stiimpys.store').replace(/\/$/, '');
  for (const c of lista) {
    // Primero se marca (si dos tareas corren juntas, solo una manda el correo)
    const turno = await db.collection('cumpleanos').updateOne({ _id: c._id, cumpleEnviado: { $ne: anio } }, { $set: { cumpleEnviado: anio } });
    if (!turno.modifiedCount) continue;
    const codigo = codigoNuevo(), vence = hoyMx(Date.now() + 7 * 864e5);
    await db.collection('cuponesPersonales').insertOne({ codigo, bazarId: bazar.id, tel10: c.tel10, valor: cfg.frecuente.cumplePct, vence, usado: false, en: new Date().toISOString() });
    const r = await enviarCorreo({ para: c.email, asunto: `🎂 Feliz cumpleaños, ${c.nombre || ''}: ${cfg.frecuente.cumplePct}% de regalo`,
      html: plantilla({ titulo: `¡Feliz cumpleaños${c.nombre ? ', ' + c.nombre : ''}!`,
        cuerpo: `Para celebrarte, tienes <b>${cfg.frecuente.cumplePct}% de descuento</b> en tu próxima compra en Stiimpys.<br><br>Tu código: <b style="font-size:20px;letter-spacing:2px">${codigo}</b><br><br>Vale hasta el ${vence.split('-').reverse().join('/')} y es solo para ti.`,
        boton: 'Ir a la tienda', enlace: `${sitio}/tienda.html?utm_source=correo&utm_medium=cumple`, pie: 'Recibes este correo porque nos diste tu fecha de cumpleaños en tu recibo.' }),
      texto: `Feliz cumpleaños. Tu código de ${cfg.frecuente.cumplePct}%: ${codigo} (vale hasta ${vence}).`, contexto: { tipo: 'cumple', bazarId: bazar.id } });
    if (r.ok) hechos.push({ tipo: 'cumple', texto: `Cupón de cumpleaños enviado a ${c.nombre || 'un cliente'}.` });
  }
  return hechos;
}
