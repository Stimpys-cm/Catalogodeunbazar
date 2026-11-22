// ─────────────────────────────────────────────────────────────
//  api/_lib/alertas.js — Avisos a la dueña cuando algo falla · v41
//
//  Canales (se usan los que estén configurados en Vercel):
//    · Telegram (llega como notificación al celular):
//        TELEGRAM_BOT_TOKEN  → el token que da @BotFather al crear el bot
//        TELEGRAM_CHAT_ID    → el número del chat (Panel → Sistema → "Probar aviso"
//                              lo encuentra solo después de mandarle "hola" al bot)
//    · Correo con Resend: AVISOS_CORREO (a dónde llegan) + RESEND_API_KEY y CORREO_DESDE.
//
//  Cada aviso tiene una "clave" (p. ej. servicio:clip) y no se repite antes de
//  3 horas, para no llenar el celular. Cuando el servicio vuelve a estar bien
//  llega un "ya se arregló". Nada de esto guarda datos de clientes: solo el
//  nombre del servicio y qué pasó.
// ─────────────────────────────────────────────────────────────
import { enviarCorreo, correoConfigurado, plantilla } from './correo.js';

const SITIO = () => (process.env.SITE_URL || 'https://stiimpys.store').replace(/\/$/, '');
const CADA_MS = 3 * 60 * 60 * 1000;

export const telegramListo = () => !!process.env.TELEGRAM_BOT_TOKEN && !!process.env.TELEGRAM_CHAT_ID;
export const correoAvisosListo = () => !!process.env.AVISOS_CORREO && correoConfigurado();
export const alertasConfiguradas = () => telegramListo() || correoAvisosListo();

async function telegram(texto, chat = process.env.TELEGRAM_CHAT_ID) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chat) return { ok: false, sinConfigurar: true };
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ chat_id: chat, text: texto.slice(0, 3900), disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: !!j.ok, error: j.ok ? null : (j.description || `Telegram respondió ${r.status}`) };
  } catch (e) { return { ok: false, error: e?.name === 'AbortError' ? 'Telegram no respondió' : (e?.message || 'error') }; }
  finally { clearTimeout(t); }
}

// Manda el aviso por todos los canales configurados (sin repetir la misma clave en 3 h)
export async function avisarDuena(db, { clave, titulo, texto, forzar = false, icono = '⚠️ ' }) {
  if (!alertasConfiguradas()) return { ok: false, sinConfigurar: true };
  const col = db.collection('sistema');
  const ahora = Date.now();
  if (!forzar && clave) {
    const doc = await col.findOne({ id: 'alertas' });
    const ultima = doc?.ultimas?.[clave];
    if (ultima && ahora - new Date(ultima).getTime() < CADA_MS) return { ok: true, repetido: true };
  }
  const cuerpo = `${titulo}\n${texto}\n\nPanel → Sistema: ${SITIO()}`;
  const salidas = [];
  if (telegramListo()) salidas.push(['telegram', await telegram(icono + 'Stiimpys · ' + cuerpo)]);
  if (correoAvisosListo()) salidas.push(['correo', await enviarCorreo({
    para: process.env.AVISOS_CORREO, asunto: `Stiimpys · ${titulo}`, texto: cuerpo,
    html: plantilla({ titulo, cuerpo: `<p>${String(texto).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>')}</p>`,
      boton: 'Abrir el monitor', enlace: SITIO(), pie: 'Aviso automático del monitor de tu tienda.' }),
    contexto: { tipo: 'alerta' } })]);
  const ok = salidas.some(([, r]) => r?.ok);
  if (ok && clave) await col.updateOne({ id: 'alertas' }, { $set: { [`ultimas.${clave}`]: new Date(ahora).toISOString() } }, { upsert: true });
  return { ok, canales: Object.fromEntries(salidas.map(([c, r]) => [c, r?.ok ? 'ok' : (r?.error || 'falló')])) };
}

// Compara el estado de cada servicio con el anterior y avisa los cambios importantes.
// servicios: [{ id, nombre, estado, detalle }] (los mismos del monitor)
export async function avisarServicios(db, servicios, extras = []) {
  if (!alertasConfiguradas()) return [];
  const col = db.collection('sistema');
  const antes = (await col.findOne({ id: 'alertas' }))?.servicios || {};
  const ahora = {}, mandados = [];
  for (const s of servicios) {
    ahora[s.id] = s.estado;
    const malo = s.estado === 'no disponible' || s.estado === 'degradado';
    const eraMalo = antes[s.id] === 'no disponible' || antes[s.id] === 'degradado';
    if (malo) {
      const r = await avisarDuena(db, { clave: `servicio:${s.id}:${s.estado}`, titulo: `${s.nombre}: ${s.estado}`, texto: s.detalle || '' });
      if (r.ok && !r.repetido) mandados.push(s.id);
    } else if (eraMalo && s.estado === 'operativo') {
      const r = await avisarDuena(db, { clave: `servicio:${s.id}:ok`, titulo: `${s.nombre} ya funciona otra vez`, texto: s.detalle || '', forzar: true });
      if (r.ok) mandados.push(s.id + ':ok');
    }
  }
  for (const x of extras) {
    const r = await avisarDuena(db, x);
    if (r.ok && !r.repetido) mandados.push(x.clave);
  }
  await col.updateOne({ id: 'alertas' }, { $set: { servicios: ahora } }, { upsert: true });
  return mandados;
}

// Panel → Sistema → "Probar aviso". Si falta TELEGRAM_CHAT_ID, busca el chat de
// quien le escribió al bot (getUpdates) y lo devuelve para pegarlo en Vercel.
export async function probarAvisos(db) {
  const out = { telegram: null, correo: null, chatId: null };
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (token && !process.env.TELEGRAM_CHAT_ID) {
    try {
      const j = await fetch(`https://api.telegram.org/bot${token}/getUpdates`).then(r => r.json());
      const ult = (j.result || []).reverse().find(u => u.message?.chat?.id);
      out.chatId = ult ? String(ult.message.chat.id) : null;
      out.telegram = ult ? 'Encontré tu chat: pon este número en TELEGRAM_CHAT_ID y vuelve a desplegar.' : 'Mándale "hola" a tu bot en Telegram y vuelve a tocar Probar.';
      if (ult) await telegram('✅ Stiimpys: encontré este chat. Pon ' + out.chatId + ' en TELEGRAM_CHAT_ID en Vercel.', ult.message.chat.id);
    } catch (e) { out.telegram = 'No se pudo hablar con Telegram: ' + (e?.message || 'error'); }
  } else if (telegramListo()) {
    const r = await telegram('✅ Stiimpys: los avisos del monitor llegan aquí.');
    out.telegram = r.ok ? 'Mensaje de prueba enviado.' : 'No salió: ' + r.error;
  } else out.telegram = 'Sin configurar (faltan TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID).';
  if (correoAvisosListo()) {
    const r = await enviarCorreo({ para: process.env.AVISOS_CORREO, asunto: 'Stiimpys · prueba de avisos', texto: 'Los avisos del monitor llegan a este correo.',
      html: plantilla({ titulo: 'Prueba de avisos', cuerpo: '<p>Los avisos del monitor llegan a este correo.</p>', boton: 'Abrir la tienda', enlace: SITIO(), pie: '' }), contexto: { tipo: 'alerta' } });
    out.correo = r.ok ? `Correo de prueba enviado a ${process.env.AVISOS_CORREO.replace(/^(.).*(@.*)$/, '$1***$2')}.` : 'No salió el correo.';
  } else out.correo = 'Sin configurar (faltan AVISOS_CORREO y Resend).';
  return out;
}
