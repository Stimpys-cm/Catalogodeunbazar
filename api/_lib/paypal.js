// ─────────────────────────────────────────────────────────────
//  api/_lib/paypal.js — Cobro con PayPal (Orders API v2)
//
//  · Credenciales en Vercel: PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET
//    (developer.paypal.com → Apps & Credentials → Live). PAYPAL_SANDBOX=1
//    usa el ambiente de pruebas. Otro bazar: PAYPAL_CLIENT_ID_2, etc.
//  · Flujo: se crea la orden → el cliente aprueba en PayPal → regresa a
//    pagar.html → el servidor cobra (capture) y confirma el monto.
//    Nunca se confía en lo que diga el navegador: siempre se consulta a PayPal.
// ─────────────────────────────────────────────────────────────
const varBazar = (nombre, bazarId) => process.env[`${nombre}_${bazarId}`] || (Number(bazarId) === 1 ? process.env[nombre] : '') || '';
const cred = bazarId => ({ id: String(varBazar('PAYPAL_CLIENT_ID', bazarId) || '').trim(), secreto: String(varBazar('PAYPAL_CLIENT_SECRET', bazarId) || '').trim() });
export const paypalPrueba = bazarId => /^(1|true|si|sí)$/i.test(String(varBazar('PAYPAL_SANDBOX', bazarId) || process.env.PAYPAL_SANDBOX || ''));
export const paypalListo = bazarId => { const c = cred(bazarId); return !!(c.id && c.secreto); };
const BASE = bazarId => paypalPrueba(bazarId) ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';

// Token de acceso (dura ~9 h; se guarda en memoria mientras viva la función)
const tokens = {};
async function token(bazarId) {
  const t = tokens[bazarId];
  if (t && t.vence > Date.now() + 60000) return t.valor;
  const c = cred(bazarId);
  const r = await fetch(`${BASE(bazarId)}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${c.id}:${c.secreto}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: 'grant_type=client_credentials',
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) { const e = new Error('PayPal rechazó las credenciales (revisa PAYPAL_CLIENT_ID y PAYPAL_CLIENT_SECRET).'); e.status = 502; throw e; }
  tokens[bazarId] = { valor: j.access_token, vence: Date.now() + (Number(j.expires_in) || 3000) * 1000 };
  return j.access_token;
}

async function paypal(bazarId, ruta, opciones = {}) {
  const r = await fetch(`${BASE(bazarId)}${ruta}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${await token(bazarId)}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(opciones.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const det = j.details?.[0];
    const e = new Error(`PayPal: ${det?.description || j.message || 'HTTP ' + r.status}`);
    e.status = r.status; e.codigo = det?.issue || j.name || ''; throw e;
  }
  return j;
}

const dinero = n => (Math.round(Number(n) * 100) / 100).toFixed(2);

// Crea la orden y regresa el link donde el cliente aprueba el pago
export async function crearOrdenPaypal(bazarId, pedido, { regreso, cancelar, descripcion }) {
  const orden = await paypal(bazarId, '/v2/checkout/orders', {
    method: 'POST',
    headers: { 'PayPal-Request-Id': `stiimpys-${pedido.id}` },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: pedido.id, custom_id: pedido.id, invoice_id: pedido.id,
        description: String(descripcion || '').slice(0, 127),
        amount: { currency_code: 'MXN', value: dinero(pedido.total) },
      }],
      payment_source: { paypal: { experience_context: {
        brand_name: 'STIIMPYS', locale: 'es-MX', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW',
        return_url: regreso, cancel_url: cancelar,
      } } },
    }),
  });
  const link = (orden.links || []).find(l => l.rel === 'payer-action' || l.rel === 'approve');
  if (!orden.id || !link?.href) throw new Error('PayPal no regresó el link de pago');
  return { id: orden.id, url: link.href };
}

// Revisa la orden; si el cliente ya aprobó, la cobra. → { estado: 'pagado'|'en proceso'|'pendiente', capturaId }
// v33: { cobrar: false } solo lee (para pedidos cancelados: no se cobra una orden que ya no vale)
export async function revisarOrdenPaypal(bazarId, ordenId, total, { cobrar = true } = {}) {
  let o = await paypal(bazarId, `/v2/checkout/orders/${encodeURIComponent(ordenId)}`);
  if (o.status === 'APPROVED' && !cobrar) return { estado: 'aprobado' };
  if (o.status === 'APPROVED') {
    try { o = await paypal(bazarId, `/v2/checkout/orders/${encodeURIComponent(ordenId)}/capture`, { method: 'POST', headers: { 'PayPal-Request-Id': `stiimpys-cap-${ordenId}` }, body: '{}' }); }
    catch (e) {
      // Ya se había cobrado en otra llamada: se vuelve a leer
      if (e.codigo === 'ORDER_ALREADY_CAPTURED') o = await paypal(bazarId, `/v2/checkout/orders/${encodeURIComponent(ordenId)}`);
      else throw e;
    }
  }
  const captura = o.purchase_units?.[0]?.payments?.captures?.[0];
  if (o.status === 'COMPLETED' && captura) {
    const monto = Number(captura.amount?.value);
    if (captura.amount?.currency_code && captura.amount.currency_code !== 'MXN') return { estado: 'pendiente' };
    if (Number.isFinite(monto) && Math.abs(monto - Number(total)) >= 1) return { estado: 'pendiente', montoDistinto: true, monto };
    if (captura.status === 'COMPLETED') return { estado: 'pagado', capturaId: captura.id };
    if (captura.status === 'PENDING') return { estado: 'en proceso' };
  }
  return { estado: 'pendiente' };
}

// v33 · Monitor: ¿PayPal acepta las credenciales? (solo pide un token; no crea ni cobra nada)
export async function paypalPing(bazarId) {
  delete tokens[bazarId];
  await token(bazarId);
  return true;
}
