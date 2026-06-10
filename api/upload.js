// api/upload.js
// POST /api/upload  body: { file: "data:image/jpeg;base64,..." }
// Sube la imagen a Cloudinary y devuelve la URL pública

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { file } = req.body;
  if (!file) return res.status(400).json({ error: 'file requerido' });

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  try {
    // Firma para upload autenticado
    const timestamp = Math.floor(Date.now() / 1000);
    const folder    = 'bazar';

    // Generar firma SHA-1
    const crypto  = await import('crypto');
    const toSign  = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha1').update(toSign).digest('hex');

    // Construir form data
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

    return res.status(200).json({
      url:       data.secure_url,
      public_id: data.public_id
    });

  } catch (err) {
    console.error('[upload]', err);
    return res.status(500).json({ error: err.message });
  }
}
