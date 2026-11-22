// ─────────────────────────────────────────────────────────────
//  api/_lib/comprobante.js — Revisar un comprobante SPEI · v43
//
//  1) La IA lee la foto del comprobante: monto, clave de rastreo, fecha,
//     banco que envía y la CLABE a la que se mandó.
//  2) Con esos datos se pregunta a Banxico (CEP: www.banxico.org.mx/cep).
//     Si Banxico entrega el comprobante electrónico (XML) con el mismo monto
//     y la misma cuenta, la transferencia SÍ llegó.
//  Nada de esto aprueba por sí solo a menos que la dueña prenda
//  "Aprobar sola si Banxico confirma" (módulo speiAuto).
//  El CEP de Banxico no es una API oficial: si cambia o no contesta, el
//  resultado queda "no se pudo verificar" y se revisa a mano como antes.
// ─────────────────────────────────────────────────────────────

// Nombre del banco (como sale en un comprobante) → 3 primeros dígitos de su CLABE
const BANCOS = [
  [/bbva|bancomer/i, '012'], [/banamex|citibanamex/i, '002'], [/santander/i, '014'], [/banorte/i, '072'],
  [/hsbc/i, '021'], [/scotia/i, '044'], [/inbursa/i, '036'], [/azteca/i, '127'], [/bancoppel|coppel/i, '137'],
  [/baj[ií]o/i, '030'], [/banregio|hey ?banco/i, '058'], [/afirme/i, '062'], [/mercado ?pago/i, '722'],
  [/\bnu\b|nu m[eé]xico|nubank/i, '638'], [/\bstp\b/i, '646'], [/klar/i, '661'], [/spin|oxxo/i, '728'],
  [/albo/i, '721'], [/clip/i, '730'], [/banbaj|bansefi|bienestar/i, '166'], [/multiva/i, '132'],
  [/compartamos/i, '130'], [/banjercito/i, '019'], [/invex/i, '059'], [/monex/i, '112'], [/fondeadora/i, '699'],
  [/cuenca/i, '723'], [/ual[aá]/i, '732'], [/openbank/i, '659'], [/mifel/i, '042'],
];
export const prefijoBanco = nombre => (BANCOS.find(([re]) => re.test(String(nombre || ''))) || [])[1] || null;
// Clave de participante en el SPEI: bancos 40xxx, otras instituciones 90xxx (se prueban las dos)
const participantes = p => p ? [`40${p}`, `90${p}`] : [];

const PROMPT = `Eres un lector de comprobantes de transferencia SPEI de México. Lee la imagen y responde SOLO un JSON:
{"esComprobante": true|false, "monto": número en pesos o null, "claveRastreo": "texto" o null, "fecha": "AAAA-MM-DD" o null,
 "bancoEmisor": "nombre del banco que envía" o null, "cuentaDestino": "CLABE o últimos dígitos de la cuenta destino" o null,
 "concepto": "texto" o null, "estado": "exitosa"|"pendiente"|"rechazada"|"desconocido"}
Si algo no se ve, pon null. No inventes datos.`;

export async function leerComprobante(url) {
  if (!process.env.ANTHROPIC_API_KEY) return { error: 'Falta ANTHROPIC_API_KEY' };
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.IA_MODELO_RAPIDO || 'claude-haiku-5-5', max_tokens: 400, system: PROMPT,
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url } }, { type: 'text', text: 'Lee este comprobante.' }] }] }),
    });
    const j = await r.json().catch(() => ({}));
    // v46: también cuenta en el gasto y el saldo de la IA
    try {
      const [{ getDB }, ia] = await Promise.all([import('./db.js'), import('./ia.js')]);
      const db = await getDB();
      if (r.ok) await ia.anotarUso(db, 1, [{ uso: j.usage || {}, modelo: process.env.IA_MODELO_RAPIDO || 'claude-haiku-5-5' }], { prendas: 0, comprobantes: 1 });
      else if (/credit|billing|balance/i.test(j?.error?.message || '')) await ia.marcarSinSaldo(db);
    } catch {}
    if (!r.ok) return { error: `IA respondió ${r.status}` };
    const txt = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const m = txt.match(/\{[\s\S]*\}/); if (!m) return { error: 'La IA no pudo leerlo' };
    const d = JSON.parse(m[0]);
    const limpio = (v, n) => v == null ? null : String(v).replace(/[<>]/g, '').trim().slice(0, n) || null;
    return {
      esComprobante: d.esComprobante !== false, monto: Number.isFinite(Number(d.monto)) ? Math.round(Number(d.monto) * 100) / 100 : null,
      claveRastreo: limpio(d.claveRastreo, 40)?.replace(/\s+/g, '') || null, fecha: /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') ? d.fecha : null,
      bancoEmisor: limpio(d.bancoEmisor, 40), cuentaDestino: limpio(d.cuentaDestino, 24)?.replace(/\D/g, '') || null,
      concepto: limpio(d.concepto, 60), estado: ['exitosa', 'pendiente', 'rechazada'].includes(d.estado) ? d.estado : 'desconocido',
    };
  } catch (e) { return { error: e.name === 'AbortError' ? 'La IA tardó demasiado' : 'No se pudo leer' }; }
  finally { clearTimeout(t); }
}

// Una consulta al CEP: valida.do (guarda la sesión) → descarga.do?formato=XML
async function consultaCEP({ fecha, rastreo, emisor, receptor, cuenta, monto }) {
  const base = 'https://www.banxico.org.mx/cep';
  const [a, m, d] = fecha.split('-');
  const form = new URLSearchParams({ tipoCriterio: 'T', captcha: 'c', tipoConsulta: '1', fecha: `${d}-${m}-${a}`, criterio: rastreo,
    emisor, receptor, cuenta, monto: String(monto), receptorParticipante: '0' });
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r1 = await fetch(`${base}/valida.do`, { method: 'POST', body: form, signal: ctrl.signal,
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Mozilla/5.0 (Stiimpys)' } });
    const galletas = (r1.headers.getSetCookie?.() || [r1.headers.get('set-cookie')].filter(Boolean)).map(c => String(c).split(';')[0]).join('; ');
    const t1 = await r1.text();
    if (!r1.ok) return { estado: 'no disponible' };
    if (/no se encontr|no existe|no ha sido|no fue posible|operaci[oó]n no/i.test(t1) && !/descarga/i.test(t1)) return { estado: 'no encontrado' };
    const r2 = await fetch(`${base}/descarga.do?formato=XML`, { signal: ctrl.signal, headers: { cookie: galletas, 'user-agent': 'Mozilla/5.0 (Stiimpys)' } });
    const xml = await r2.text();
    if (!r2.ok || !/cadenaCDA|<SPEI_Tercero|Beneficiario/i.test(xml)) return { estado: 'no encontrado' };
    const attr = (tag, name) => (new RegExp(`<${tag}[^>]*\\s${name}="([^"]*)"`, 'i').exec(xml) || [])[1] || '';
    return { estado: 'confirmado', cuenta: attr('Beneficiario', 'Cuenta'), monto: Number(attr('Beneficiario', 'MontoPago') || attr('SPEI_Tercero', 'Monto') || 0),
      nombre: attr('Beneficiario', 'Nombre').slice(0, 80), fechaOperacion: attr('SPEI_Tercero', 'FechaOperacion') };
  } catch (_) { return { estado: 'no disponible' }; }
  finally { clearTimeout(t); }
}

// Verifica con Banxico usando lo que leyó la IA y la CLABE de la tienda
export async function verificarCEP(lectura, { clabe, monto }) {
  if (!lectura?.claveRastreo || !lectura.fecha) return { estado: 'faltan datos', motivo: 'No se ve la clave de rastreo o la fecha.' };
  const emisores = participantes(prefijoBanco(lectura.bancoEmisor));
  if (!emisores.length) return { estado: 'faltan datos', motivo: 'No se reconoce el banco que envió.' };
  const receptores = participantes(String(clabe).slice(0, 3));
  let ultimo = { estado: 'no encontrado' };
  for (const emisor of emisores) for (const receptor of receptores) {
    const r = await consultaCEP({ fecha: lectura.fecha, rastreo: lectura.claveRastreo, emisor, receptor, cuenta: clabe, monto: lectura.monto ?? monto });
    if (r.estado === 'confirmado') {
      const okCuenta = !r.cuenta || r.cuenta.replace(/\D/g, '') === String(clabe);
      const okMonto = !r.monto || Math.abs(r.monto - monto) < 0.5 || r.monto >= monto;
      return { ...r, estado: okCuenta && okMonto ? 'confirmado' : 'no coincide', motivo: !okCuenta ? 'La cuenta destino no es la tuya.' : !okMonto ? `Banxico dice ${r.monto} y el pedido es ${monto}.` : '' };
    }
    if (r.estado === 'no disponible') ultimo = r;
  }
  return ultimo;
}

// Revisión completa: IA + Banxico → dictamen corto para el panel
export function dictamen(lectura, cep, { clabe, monto }) {
  const avisos = [];
  if (lectura?.error) avisos.push(`IA: ${lectura.error}`);
  if (lectura && !lectura.error) {
    if (!lectura.esComprobante) avisos.push('La imagen no parece un comprobante.');
    if (lectura.monto != null && lectura.monto + 0.5 < monto) avisos.push(`El comprobante dice $${lectura.monto} y el pedido es $${monto}.`);
    if (lectura.cuentaDestino && !String(clabe).endsWith(lectura.cuentaDestino.slice(-4))) avisos.push('La cuenta destino no termina como tu CLABE.');
    if (lectura.estado === 'rechazada') avisos.push('El comprobante dice "rechazada".');
  }
  const nivel = cep?.estado === 'confirmado' && !avisos.length ? 'verde' : avisos.length || cep?.estado === 'no coincide' ? 'rojo' : 'ambar';
  const texto = cep?.estado === 'confirmado' ? (avisos.length ? 'Banxico confirma el depósito, pero revisa los avisos.' : 'Banxico confirma que el dinero llegó a tu cuenta.')
    : cep?.estado === 'no coincide' ? `Banxico encontró la transferencia pero no coincide: ${cep.motivo}`
    : cep?.estado === 'no encontrado' ? 'Banxico todavía no la encuentra (puede tardar unos minutos). Revisa tu app.'
    : cep?.estado === 'faltan datos' ? `No se pudo preguntar a Banxico: ${cep.motivo}`
    : 'No se pudo verificar con Banxico. Revisa tu app.';
  return { nivel, texto, avisos };
}
