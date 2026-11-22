// ─────────────────────────────────────────────────────────────
//  api/_lib/turnstile.js — Freno para robots (Cloudflare Turnstile) · v41
//
//  Se activa solo si en Vercel están TURNSTILE_SITE_KEY y TURNSTILE_SECRET_KEY
//  (dash.cloudflare.com → Turnstile → Add widget → dominio stiimpys.store,
//  modo "Managed"). Sin ellas todo funciona igual que antes.
//
//  Protege lo que un robot usaría para hacer daño o mandar spam:
//  crear cuentas, pedir correos de "olvidé mi contraseña", mandar ofertas y
//  apuntarse a "Avísame". Para la gente es invisible casi siempre.
//
//  Si Cloudflare no contesta (caído o lento), se deja pasar: los límites por
//  conexión siguen funcionando y la tienda no se cae por un tercero.
// ─────────────────────────────────────────────────────────────
import { clientIp } from './rateLimit.js';

export const turnstileActivo = () => !!process.env.TURNSTILE_SITE_KEY && !!process.env.TURNSTILE_SECRET_KEY;
export const turnstileSiteKey = () => turnstileActivo() ? process.env.TURNSTILE_SITE_KEY : null;

// true = pasa; si no, responde 403 y devuelve false
export async function exigirTurnstile(req, res) {
  if (!turnstileActivo()) return true;
  const token = String(req.body?.cfTurnstile || req.headers?.['cf-turnstile-response'] || '').slice(0, 2048);
  if (!token) { res.status(403).json({ error: 'Confirma que no eres un robot y vuelve a intentar.', turnstile: true }); return false; }
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const cuerpo = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token });
    const ip = clientIp(req); if (ip && ip !== 'desconocida') cuerpo.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: cuerpo, signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    if (j.success) return true;
    res.status(403).json({ error: 'No pudimos confirmar que no eres un robot. Recarga la página e intenta de nuevo.', turnstile: true });
    return false;
  } catch (e) {
    console.error('[turnstile] sin respuesta de Cloudflare, se deja pasar:', e?.message || e);
    return true;
  } finally { clearTimeout(t); }
}
