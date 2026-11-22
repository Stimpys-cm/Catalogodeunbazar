// ─────────────────────────────────────────────────────────────
//  api/_lib/nube.js — Subir una imagen del cliente a Cloudinary · v42
//
//  Para comprobantes de transferencia y fotos de reseñas. La imagen llega
//  como data URL (el navegador ya la achicó), se revisa tipo y tamaño y se
//  sube firmada desde el servidor (el navegador nunca ve la clave).
//  El nombre del archivo es al azar (24 caracteres): nadie puede adivinar la
//  dirección de un comprobante.
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';

export const MAX_BYTES = 3 * 1024 * 1024;   // en base64 ≈ 4 MB (Vercel acepta hasta 4.5 MB por petición)

export function imagenValida(dataUrl) {
  const s = String(dataUrl || '');
  if (!/^data:image\/(jpeg|jpg|png|webp|heic|heif);base64,/.test(s)) return 'Sube una foto (JPG, PNG, WEBP o HEIC).';
  if (/[^A-Za-z0-9+/=]/.test(s.slice(s.indexOf(',') + 1))) return 'La imagen llegó dañada. Intenta de nuevo.';
  const bytes = Math.floor((s.length - s.indexOf(',') - 1) * 3 / 4);
  if (bytes > MAX_BYTES) return 'La foto pesa más de 3 MB. Toma una captura de pantalla o una foto más chica.';
  if (bytes < 2000) return 'La imagen está vacía o muy chica.';
  return null;
}

export async function subirImagen(dataUrl, carpeta) {
  const nube = process.env.CLOUDINARY_CLOUD_NAME, key = process.env.CLOUDINARY_API_KEY, secreto = process.env.CLOUDINARY_API_SECRET;
  if (!nube || !key || !secreto) throw Object.assign(new Error('Las fotos no están configuradas (CLOUDINARY_*).'), { status: 503 });
  const timestamp = Math.floor(Date.now() / 1000);
  const public_id = crypto.randomBytes(18).toString('base64url');
  const firma = crypto.createHash('sha1').update(`folder=${carpeta}&public_id=${public_id}&timestamp=${timestamp}${secreto}`).digest('hex');
  const form = new URLSearchParams({ file: dataUrl, api_key: key, timestamp: String(timestamp), signature: firma, folder: carpeta, public_id });
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`https://api.cloudinary.com/v1_1/${nube}/image/upload`, { method: 'POST', body: form, signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.secure_url) throw Object.assign(new Error('No se pudo guardar la foto. Intenta de nuevo.'), { status: 502, detalle: j?.error?.message });
    return j.secure_url;
  } finally { clearTimeout(t); }
}
