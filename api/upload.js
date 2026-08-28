// api/upload.js
// POST /api/upload  body: { file: "data:image/jpeg;base64,..." }   [requiere sesión]
// Sube la imagen a Cloudinary y devuelve la URL pública.
// Protegido: solo usuarios con sesión pueden subir (evita abuso anónimo).

import { getUser } from './_auth.js';
import { rateLimit } from './_rateLimit.js';
import { getDB } from './_db.js';

// Un comprador con sesión también sube foto: la necesita para su perfil
// en STMP MARKET. Es la misma cookie httpOnly que usa /api/cuenta.
async function clienteConSesion(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)cliente=([^;]+)/);
  if (!m) return null;
  const db = await getDB();
  return db.collection('clientes').findOne({ sesionToken: decodeURIComponent(m[1]) });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // 🔒 La cookie httpOnly de sesión se envía sola (mismo dominio), así que
  // esto funciona sin cambiar la llamada fetch de admin.js.
  // Vale la sesión del panel (vendedor) o la del comprador.
  const user    = await getUser(req).catch(() => null);
  const cliente = user ? null : await clienteConSesion(req).catch(() => null);
  if (!user && !cliente) {
    return res.status(401).json({ error: 'No autenticado. Inicia sesión.' });
  }

  // Tope de subidas por IP: evita que alguien con una sesión llene tu
  // cuenta de Cloudinary (y tu factura) a base de peticiones. El comprador
  // solo cambia su foto de perfil, así que su cupo es mucho más chico.
  const cupo = user
    ? { key: 'upload', max: 120, windowSec: 3600 }
    : { key: 'upload-cliente', max: 10, windowSec: 3600 };
  if (!(await rateLimit(req, res, cupo))) return;

  const file = req.body?.file;
  if (typeof file !== 'string' || !file) {
    return res.status(400).json({ error: 'file requerido' });
  }

  // Solo imágenes, y solo como data URI: nada de PDFs, scripts ni URLs
  // remotas que Cloudinary iría a descargar por nosotros.
  const cabecera = /^data:image\/(jpeg|jpg|png|webp|gif|avif|heic);base64,/i;
  if (!cabecera.test(file)) {
    return res.status(400).json({ error: 'Solo se aceptan imágenes' });
  }

  // ~10 MB ya en base64 (el base64 pesa ~33% más que el archivo)
  const LIMITE = 10 * 1024 * 1024 * 1.37;
  if (file.length > LIMITE) {
    return res.status(413).json({ error: 'La imagen pesa más de 10 MB' });
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder    = user ? 'bazar' : 'bazar/perfiles';

    const crypto  = await import('crypto');
    const toSign  = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha1').update(toSign).digest('hex');

    const formData = new URLSearchParams();
    formData.append('file',      file);
    formData.append('api_key',   apiKey);
    formData.append('timestamp', timestamp);
    formData.append('signature', signature);
    formData.append('folder',    folder);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      { method: 'POST', body: formData }
    );
    const data = await response.json();
    if (data.error) return res.status(400).json({ error: data.error.message });

    return res.status(200).json({ url: data.secure_url, public_id: data.public_id });

  } catch (err) {
    console.error('[upload]', err);
    return res.status(500).json({ error: err.message });
  }
}
