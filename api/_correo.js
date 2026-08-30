// api/_correo.js
// ─────────────────────────────────────────────────────────────
// Mandar correo sin meter dependencias: Resend es una petición HTTPS.
//
// Se configura con dos variables de entorno en Vercel:
//   RESEND_API_KEY   la llave de resend.com (su plan gratis da 3,000/mes)
//   CORREO_DESDE     p.ej. "STMP MARKET <hola@stiimpys.store>"
//
// Si no están puestas, enviar() devuelve { ok:false, sinConfigurar:true }
// y quien llama decide qué decirle a la persona. El sitio funciona igual;
// lo único que no funciona es lo que necesite correo.
// ─────────────────────────────────────────────────────────────

export const correoConfigurado = () =>
  !!(process.env.RESEND_API_KEY && process.env.CORREO_DESDE);

export async function enviarCorreo({ para, asunto, html, texto }) {
  if (!correoConfigurado()) return { ok: false, sinConfigurar: true };

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.CORREO_DESDE,
        to: [para],
        subject: asunto,
        html,
        text: texto,
      }),
    });
    if (!r.ok) {
      const detalle = await r.text().catch(() => '');
      console.error('[correo]', r.status, detalle.slice(0, 300));
      return { ok: false, error: 'El correo no salió' };
    }
    return { ok: true };
  } catch (err) {
    console.error('[correo]', err);
    return { ok: false, error: 'El correo no salió' };
  }
}

// Plantilla sobria, en el tono del sitio. Sin imágenes ni CSS raro:
// los clientes de correo se comen la mitad de lo que les mandes.
export function plantilla({ titulo, cuerpo, boton, enlace, pie }) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  return `<!doctype html>
<html lang="es"><body style="margin:0;padding:0;background:#f7f4ef;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px;
                    font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
        <tr><td style="font-size:13px;letter-spacing:3px;color:#8b8578;font-weight:700;padding-bottom:24px;">
          STMP MARKET<span style="color:#2d6be4;">.</span>
        </td></tr>
        <tr><td style="font-size:22px;font-weight:700;color:#1a1f2e;padding-bottom:14px;line-height:1.3;">
          ${esc(titulo)}
        </td></tr>
        <tr><td style="font-size:15px;color:#4a4640;line-height:1.6;padding-bottom:26px;">
          ${cuerpo}
        </td></tr>
        ${boton && enlace ? `
        <tr><td style="padding-bottom:26px;">
          <a href="${esc(enlace)}"
             style="display:inline-block;background:#2d6be4;color:#ffffff;text-decoration:none;
                    padding:14px 28px;border-radius:10px;font-size:14px;font-weight:700;">
            ${esc(boton)}
          </a>
        </td></tr>
        <tr><td style="font-size:12px;color:#8b8578;line-height:1.6;padding-bottom:20px;word-break:break-all;">
          Si el botón no funciona, copia esta dirección en tu navegador:<br>${esc(enlace)}
        </td></tr>` : ''}
        ${pie ? `<tr><td style="font-size:12px;color:#8b8578;line-height:1.6;
                                border-top:1px solid #ece8e0;padding-top:18px;">${pie}</td></tr>` : ''}
      </table>
    </td></tr>
  </table>
</body></html>`;
}
