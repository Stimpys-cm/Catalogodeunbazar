// ─────────────────────────────────────────────────────────────
//  api/_lib/crecer.js — Todo lo que ayuda a vender más
//
//  PÚBLICO (tienda)
//   POST v-oferta     { prendaId, monto, nombre, telefono }      → "hacer oferta"
//   POST v-espera     { tipo: prenda|drop|busqueda, prendaId?, dropId?, talla?, marca?, categoria?, nombre, telefono }
//   POST v-evento     { prendaId, tipo: vista|wa|bolsa|oferta|compartir } → métricas (sin datos personales)
//   POST v-cupon      { bazarId, codigo, subtotal }               → valida un cupón
//   POST v-pagar      { ids, metodo: clip|paypal, nombre, telefono, … } → link de pago (Clip o PayPal)
//   POST v-cotizar    { ids, cupon? }                             → resumen exacto para la página de pago (+ sugerencias de su talla)
//   POST v-resena     { id, k, estrellas, etiquetas, comentario } → reseña verificada desde la página del pedido
//   POST v-mis-pedidos { pedidos: [{ id, k }] }                   → resumen de los pedidos guardados en el celular
//   POST v-recuperar-pedido { telefono, codigo? , email? }        → links de sus pedidos (perdió el recibo)
//   GET  v-envio-cp   ?cp=                                        → ciudad, estado y colonias de un código postal
//   POST v-envio-cotizar { ids, cp }                              → opciones de paquetería (envia.com) para esas prendas
//   GET  v-pedido     ?id=&k=                                     → estado del pago (página de regreso)
//   POST v-clip-webhook                                          → Clip avisa del pago
//   GET  v-feed       ?bazar=slug                                 → catálogo CSV (Meta / Google)
//
//  PANEL
//   GET  v-panel                       → pendientes, ofertas, interesados, config, métricas
//   POST v-config     { ... }          → promociones, cupones, info del negocio
//   GET  v-pedidos                                               → pedidos en línea (por entregar, entregados, sin pagar)
//   POST v-pedido-estado { id, accion: enviado|entregado|deshacer, paqueteria?, guia? }
//   POST v-oferta-responder { id, accion: aceptar|contra|rechazar, monto? }
//   POST v-pendiente-hecho  { id }     → marca un aviso como hecho
//   POST v-espera-borrar    { id }
//   GET  v-corte      ?dia=AAAA-MM-DD  → corte de caja
//   GET  v-metricas                    → vistas, clics y ventas por prenda (30 días)
//   GET  v-respaldo   ?que=inventario|ventas|todo&formato=csv|json
//   GET  v-respaldos                   → copias automáticas semanales
//   POST v-permisos-usuario { id, permisos:{ borrar, precios } }
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { getDB, invalidarSyncCache } from './db.js';
import { getUser, requireAuth } from './auth.js';
import { rateLimit, huellaIp } from './rateLimit.js';
import { exigirTurnstile, turnstileSiteKey } from './turnstile.js';
import { esGlobal, mismoBazar, filtroTienda, multiBazar, bazarPrincipal } from './bazar.js';
import { siguienteId, instantaneaPrenda, ETIQUETAS_BAZAR } from './ventas.js';
import { paypalListo, paypalPrueba, crearOrdenPaypal, revisarOrdenPaypal } from './paypal.js';
import { normalizarEnvia, enviaListo, consultarCP, cotizarEnvio, opcionCotizada, tokenEnvia, esPrueba, paqueteDe, generarGuia } from './envios.js';
import { enviarCorreo, plantilla, correoConfigurado } from './correo.js';
import { registrarEvento, marcarSistema, conBloqueo, tomarBloqueo, soltarBloqueo } from './actividad.js';

const SITIO = () => (process.env.SITE_URL || 'https://stiimpys.store').replace(/\/$/, '');
const HORA = 3600e3, DIA = 24 * HORA;
const hoyMx = (t = Date.now()) => new Date(t - 6 * HORA).toISOString().slice(0, 10);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const tallaBase = t => norm(String(t || '').split('·')[0]).replace(/\s*(hombre|mujer|unisex)$/, '');
const tel = t => String(t || '').replace(/\D/g, '').slice(-12);
const waDe = t => { const d = tel(t); return d.length === 10 ? '52' + d : d; };
// v42: CLABE de 18 dígitos con dígito verificador (pesos 3, 7, 1)
export const clabeValida = c => { c = String(c || ''); if (!/^\d{18}$/.test(c)) return false;
  let suma = 0; for (let i = 0; i < 17; i++) suma += (Number(c[i]) * [3, 7, 1][i % 3]) % 10; return (10 - (suma % 10)) % 10 === Number(c[17]); };
const pesos = n => '$' + Math.round(Number(n) || 0).toLocaleString('es-MX');
const texto = (v, n = 120) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);

// ── Configuración de promociones por bazar ───────────────────
export const CONFIG_TIENDA = {
  volumen: [{ n: 2, pct: 10 }, { n: 3, pct: 15 }],
  cupones: [],                                   // [{ codigo, tipo: pct|monto, valor, minimo, activo, maxUsos, usos }]
  ofertas: { activas: true, minimoPct: 60 },
  info: { envios: '', entrega: '', pagos: '', horario: '', apartado: '' },
  envioCosto: 0,
  pagoEnLinea: true,
  paypal: true,                                  // ofrecer PayPal además de Clip (si está conectado)
  moneda: { usd: true, modo: 'auto', fijo: 0 },  // selector MXN / USD en la tienda
  apartado: { pct: 50, dias: 7, minimo: 0 },     // apartar pagando una parte en línea (anticipo)
  // v42: transferencia SPEI (el cliente sube su comprobante y la dueña lo aprueba)
  spei: { activo: false, banco: '', clabe: '', titular: '', horas: 3 },
  // v42: cliente frecuente (cada N compras pagadas, la siguiente con descuento) y cupón de cumpleaños
  frecuente: { activo: false, cada: 3, pct: 10, cumple: false, cumplePct: 15 },
  // v43
  outfit: { pct: 5 },                            // % extra al combinar prendas de 2 tipos (arriba + abajo, etc.)
  referidos: { pctAmigo: 10, pctPremio: 10 },    // descuento del amigo en su 1.ª compra · cupón para quien invitó
  google: { maps: '', resena: '' },              // link del perfil de Google Maps y de "escribir reseña"
  minutosPago: 10,                               // v41: minutos que se aparta una prenda mientras la pagan (5–30)
  // v41: datos del vendedor que pide la ley (LFPC art. 76 Bis): salen en el pie y en los términos
  legal: { nombre: '', domicilio: '', telefono: '', correo: '', horario: '' },
  // v55 · Formas de pago que se anuncian en la tienda, en Instagram y en el panel (una sola fuente)
  formasPago: { tarjeta: true, efectivo: true, transferencia: true },
};

// Interruptores de cada función (todo prendido de inicio; se apagan en Ventas → Módulos)
export const MODULOS = {
  comprarAhora: true,      // botón "Comprar ahora" en la ficha
  avisame: true,           // "Avísame si se libera", alertas de drops y de "mi talla"
  vistasHoy: true,         // "N personas la vieron hoy"
  miTalla: true,           // barra "Mi talla" del catálogo
  dropBanner: true,        // aviso del próximo drop con cuenta regresiva
  promoBarra: true,        // barra de promoción (descuento por volumen)
  masTalla: true,          // "Más en tu talla" en la ficha
  calculadoraEnvio: true,  // "¿Cuánto cuesta el envío a tu casa?" en la ficha
  misPedidos: true,        // botón "Mis pedidos" en la tienda
  cupones: true,           // campo de cupón en el carrito y al pagar
  sugerencias: true,       // sugerencias de su talla al pagar
  puntosEntrega: true,     // elegir punto de entrega en persona
  recuperarPagos: true,    // aviso para recuperar pagos sin terminar
  resenas: true,           // pedir reseña después de entregar
  apartado: true,          // "Apartar con anticipo": paga la mitad y el resto después
  // v42 (ya existían: prendidos)
  paginasMarca: true,      // páginas /marca/… y /categoria/…
  origenVentas: true,      // medir de dónde llega cada visita y venta
  // v43 (nuevos: APAGADOS hasta que la dueña los prenda en Ventas → Módulos)
  speiIA: false,           // la IA lee el comprobante SPEI y se verifica con Banxico
  speiAuto: false,         // aprobar sola la transferencia si Banxico la confirma
  carritosWA: false,       // carritos olvidados → WhatsApp listo en Pendientes
  dropPagina: false,       // página del drop con cuenta regresiva y "Avísame"
  outfit: false,           // "Completa el outfit" + descuento por combinar
  referidos: false,        // código para invitar amigos
  resumenSemanal: false,   // resumen de cada lunes al celular (Telegram/correo)
  cajaTicketWA: false,     // la Caja manda el ticket por WhatsApp
  enviosPanel: false,      // cancelar guías y pedir recolección desde el panel
  feedGoogle: false,       // catálogo para Google (Merchant Center / Shopping gratis)
  paginasTalla: false,     // páginas /talla/… y /precio/…
  guias: false,            // guías (artículos) para que te encuentren en Google
  googleMaps: false,       // perfil de Google Maps: datos del negocio y "déjanos tu reseña en Google"
  selloRevisada: false,    // sello "Revisada a mano" y medidas en cm en cada prenda
};
const modulo = (cfg, k) => cfg?.modulos?.[k] !== false;
const puntosActivos = cfg => modulo(cfg, 'puntosEntrega') ? cfg.puntosEntrega : [];

// Puntos de entrega en persona de Stiimpys (bazar 1) mientras no se cambien en el panel
const PUNTOS_STIIMPYS = [
  { id: 'zona-centro', nombre: 'Zona Centro', costo: 0 },
  { id: 'zona-morelos', nombre: 'Zona Morelos', costo: 0 },
  { id: 'uttn', nombre: 'UTTN', costo: 0 },
  { id: 'plaza-real', nombre: 'Plaza Real', costo: 50 },
  { id: 'periferico', nombre: 'Periférico', costo: 50 },
];
const idPunto = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
// Costo de entregar en un punto: gratis si la compra pasa del monto del bazar ("más de $550")
export const costoPunto = (cfg, punto, totalCompra) => !punto ? 0 : (cfg.entregaGratisDesde > 0 && totalCompra > cfg.entregaGratisDesde ? 0 : punto.costo);

function normalizarConfig(c = {}, bazarId = 1) {
  const o = JSON.parse(JSON.stringify(CONFIG_TIENDA));
  if (Array.isArray(c.volumen)) o.volumen = c.volumen
    .map(x => ({ n: Math.max(2, Math.min(10, Math.round(Number(x.n) || 0))), pct: Math.max(1, Math.min(60, Math.round(Number(x.pct) || 0))) }))
    .filter(x => x.n && x.pct).sort((a, b) => a.n - b.n).slice(0, 5);
  if (Array.isArray(c.cupones)) o.cupones = c.cupones.map(x => ({
    codigo: texto(x.codigo, 24).toUpperCase().replace(/[^A-Z0-9_-]/g, ''),
    tipo: x.tipo === 'monto' ? 'monto' : 'pct',
    // Un cupón de porcentaje no puede pasar de 100 % (antes un 150 dejaba el pedido en $0)
    valor: x.tipo === 'monto' ? Math.max(0, Math.min(100000, Number(x.valor) || 0)) : Math.max(0, Math.min(100, Number(x.valor) || 0)),
    minimo: Math.max(0, Number(x.minimo) || 0),
    activo: x.activo !== false, maxUsos: x.maxUsos ? Math.max(1, Number(x.maxUsos)) : null, usos: Math.max(0, Number(x.usos) || 0),
    vence: x.vence ? String(x.vence).slice(0, 10) : null,
  })).filter(x => x.codigo && x.valor).slice(0, 30);
  if (c.ofertas) o.ofertas = { activas: c.ofertas.activas !== false, minimoPct: Math.max(30, Math.min(95, Number(c.ofertas.minimoPct) || 60)) };
  if (c.info) for (const k of Object.keys(o.info)) o.info[k] = texto(c.info[k], 300);
  o.envioCosto = Math.max(0, Math.min(1000, Number(c.envioCosto) || 0));
  if (typeof c.pagoEnLinea === 'boolean') o.pagoEnLinea = c.pagoEnLinea;
  if (typeof c.paypal === 'boolean') o.paypal = c.paypal;
  if (c.moneda) o.moneda = { usd: c.moneda.usd !== false, modo: c.moneda.modo === 'fijo' ? 'fijo' : 'auto', fijo: Math.max(0, Math.min(100, Number(c.moneda.fijo) || 0)) };
  o.envia = normalizarEnvia(c.envia || {});
  const base = Number(bazarId) === 1;
  o.puntosEntrega = (Array.isArray(c.puntosEntrega) ? c.puntosEntrega : base ? PUNTOS_STIIMPYS : [])
    .map(p => ({ nombre: texto(p.nombre, 50), costo: Math.max(0, Math.min(1000, Math.round(Number(p.costo) || 0))), nota: texto(p.nota, 120) }))
    .filter(p => p.nombre).slice(0, 12)
    .map(p => ({ id: idPunto(p.nombre), ...p }));
  o.modulos = { ...MODULOS };
  if (c.modulos) for (const k of Object.keys(MODULOS)) if (typeof c.modulos[k] === 'boolean') o.modulos[k] = c.modulos[k];
  o.entregaGratisDesde = c.entregaGratisDesde != null ? Math.max(0, Math.min(100000, Number(c.entregaGratisDesde) || 0)) : base ? 550 : 0;
  if (c.spei && typeof c.spei === 'object') {
    const clabe = String(c.spei.clabe ?? o.spei.clabe).replace(/\D/g, '');
    o.spei = { activo: !!c.spei.activo && clabeValida(clabe), banco: texto(c.spei.banco ?? o.spei.banco, 40), clabe: clabeValida(clabe) ? clabe : '',
      titular: texto(c.spei.titular ?? o.spei.titular, 80), horas: Math.max(1, Math.min(48, Math.round(Number(c.spei.horas) || 3))) };
  }
  if (c.frecuente && typeof c.frecuente === 'object') o.frecuente = {
    activo: !!c.frecuente.activo, cada: Math.max(2, Math.min(20, Math.round(Number(c.frecuente.cada) || 3))),
    pct: Math.max(1, Math.min(50, Math.round(Number(c.frecuente.pct) || 10))), cumple: !!c.frecuente.cumple,
    cumplePct: Math.max(1, Math.min(50, Math.round(Number(c.frecuente.cumplePct) || 15))) };
  if (c.outfit && typeof c.outfit === 'object') o.outfit = { pct: Math.max(1, Math.min(30, Math.round(Number(c.outfit.pct) || 5))) };
  if (c.referidos && typeof c.referidos === 'object') o.referidos = {
    pctAmigo: Math.max(1, Math.min(50, Math.round(Number(c.referidos.pctAmigo) || 10))), pctPremio: Math.max(1, Math.min(50, Math.round(Number(c.referidos.pctPremio) || 10))) };
  if (c.google && typeof c.google === 'object') {
    const g = v => /^https:\/\/(www\.)?(google\.[a-z.]+|maps\.app\.goo\.gl|g\.page|goo\.gl)\//i.test(String(v || '').trim()) ? String(v).trim().slice(0, 300) : '';
    o.google = { maps: g(c.google.maps), resena: g(c.google.resena) };
  }
  if (c.minutosPago != null) o.minutosPago = Math.max(5, Math.min(30, Math.round(Number(c.minutosPago) || 10)));
  if (c.legal && typeof c.legal === 'object') for (const k of Object.keys(o.legal)) o.legal[k] = texto(c.legal[k], k === 'domicilio' ? 300 : 120);
  if (c.formasPago && typeof c.formasPago === 'object') for (const k of Object.keys(o.formasPago)) if (typeof c.formasPago[k] === 'boolean') o.formasPago[k] = c.formasPago[k];
  if (c.apartado) o.apartado = {
    pct: Math.max(10, Math.min(90, Math.round(Number(c.apartado.pct) || 50))),
    dias: Math.max(1, Math.min(30, Math.round(Number(c.apartado.dias) || 7))),
    minimo: Math.max(0, Math.min(100000, Math.round(Number(c.apartado.minimo) || 0))),
  };
  return o;
}

// ── Apartar con anticipo ───────────────────────────────────
// El cliente paga una parte (50 % de inicio) en línea, la prenda queda apartada a su nombre
// y el resto lo paga antes de la fecha límite: en línea desde su recibo o en persona.
// v36: minutos que una prenda queda apartada mientras alguien la paga en línea
export const MINUTOS_PAGO = 10;
// v40 · Pagos abiertos (sin terminar) que puede tener a la vez un mismo WhatsApp o una misma conexión
export const MAX_PAGOS_ABIERTOS = 3;
const apartadoActivo = (cfg, total) => modulo(cfg, 'apartado') && total > 0 && total >= (cfg.apartado?.minimo || 0);
export const montoAnticipo = (cfg, total) => Math.min(total, Math.max(1, Math.ceil(total * (cfg.apartado?.pct || 50) / 100)));
const fechaCorta = iso => new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', timeZone: 'America/Matamoros' });

// v55 · "Aceptamos tarjeta, efectivo y transferencia" (lo mismo en la tienda, Instagram y el panel)
export function textoFormasPago(fp = {}) {
  const l = [fp.tarjeta && 'tarjeta', fp.efectivo && 'efectivo', fp.transferencia && 'transferencia'].filter(Boolean);
  if (!l.length) return '';
  return 'Aceptamos ' + (l.length === 1 ? l[0] : l.slice(0, -1).join(', ') + ' y ' + l.at(-1));
}

export async function leerConfigTienda(db, bazarId) {
  const doc = await db.collection('tiendaConfig').findOne({ bazarId: Number(bazarId) || 1 });
  return normalizarConfig(doc || {}, bazarId);
}

const varBazar = (nombre, bazarId) => process.env[`${nombre}_${bazarId}`] || (Number(bazarId) === 1 ? process.env[nombre] : '') || '';
// Clip: token "Basic base64(ClaveAPI:ClaveSecreta)". Se arma con CLIP_API_KEY + CLIP_SECRET_KEY
// (o se pone ya hecho en CLIP_AUTH_TOKEN). Para otros bazares: CLIP_API_KEY_2, etc.
function authClip(bazarId) {
  const listo = varBazar('CLIP_AUTH_TOKEN', bazarId).trim();
  if (listo) return /^Basic /i.test(listo) ? listo : 'Basic ' + listo;
  const key = varBazar('CLIP_API_KEY', bazarId).trim(), secret = varBazar('CLIP_SECRET_KEY', bazarId).trim();
  return key && secret ? 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64') : '';
}
// v33 · Monitor: ¿Clip acepta las credenciales? Solo CONSULTA un link existente (GET);
// nunca crea ni cobra nada. 401/403 = credenciales rechazadas.
export const clipConfigurado = bazarId => !!authClip(bazarId);
export async function clipPing(bazarId, checkoutId, ms = 4000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  const t0 = Date.now();
  try {
    const r = await fetch(`https://api.payclip.com/v2/checkout/${encodeURIComponent(checkoutId || 'stmp-monitor')}`,
      { headers: { Authorization: authClip(bazarId), Accept: 'application/json' }, signal: ctrl.signal });
    return { status: r.status, ms: Date.now() - t0 };
  } finally { clearTimeout(t); }
}
// Con qué se puede pagar en línea: Clip (tarjeta) y, si está conectado y activo, PayPal
export function metodosPago(cfg, bazarId) {
  const m = [];
  // v56: lo que se cobra en línea coincide con lo que se anuncia (Formas de pago que aceptas)
  const tarjeta = cfg?.formasPago?.tarjeta !== false, transferencia = cfg?.formasPago?.transferencia !== false;
  if (tarjeta && authClip(bazarId)) m.push('clip');
  if (tarjeta && paypalListo(bazarId) && cfg?.paypal !== false) m.push('paypal');
  if (transferencia && cfg?.spei?.activo && clabeValida(cfg.spei.clabe)) m.push('spei');   // v42
  return m;
}
const nombreMetodo = m => m === 'paypal' ? 'PayPal' : m === 'spei' ? 'transferencia SPEI' : m === 'mercadopago' ? 'Mercado Pago' : 'Clip';

// ── Tipo de cambio MXN → USD (se guarda 12 h) ────────────────
// Fuente: Frankfurter (bancos centrales, gratis y sin clave); respaldo: open.er-api.com
export async function tipoDeCambio(db) {
  const col = db.collection('tipoCambio');
  const doc = await col.findOne({ id: 'MXN-USD' });
  if (doc?.mxnPorUsd && Date.now() - new Date(doc.en) < 12 * HORA) return doc;
  // Si la última vez no contestó ninguna fuente, no volver a intentar en 30 min
  // (la tienda no debe tardar en cargar por esto).
  if (doc?.falloEn && Date.now() - new Date(doc.falloEn) < 30 * 60 * 1000) return doc.mxnPorUsd ? doc : null;
  const fuentes = [
    ['Frankfurter', 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=MXN', j => j?.rates?.MXN, j => j?.date],
    ['ExchangeRate-API', 'https://open.er-api.com/v6/latest/USD', j => j?.rates?.MXN, j => j?.time_last_update_utc],
  ];
  for (const [fuente, url, leer, fecha] of fuentes) {
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 2500);
      const j = await fetch(url, { signal: ctrl.signal }).then(r => r.json()).finally(() => clearTimeout(t));
      const mxn = Number(leer(j));
      if (mxn > 5 && mxn < 60) {
        const nuevo = { id: 'MXN-USD', mxnPorUsd: Math.round(mxn * 10000) / 10000, fecha: String(fecha(j) || '').slice(0, 30), fuente, en: new Date().toISOString(), falloEn: null };
        await col.updateOne({ id: 'MXN-USD' }, { $set: nuevo }, { upsert: true });
        return nuevo;
      }
    } catch {}
  }
  await col.updateOne({ id: 'MXN-USD' }, { $set: { id: 'MXN-USD', falloEn: new Date().toISOString() } }, { upsert: true }).catch(() => {});
  return doc?.mxnPorUsd ? doc : null;     // si no contesta nadie, el último que se guardó
}

// Moneda: la configuración del bazar principal manda para toda la tienda
async function monedaTienda(db, configs) {
  configs = configs || await db.collection('tiendaConfig').find({ bazarId: 1 }).toArray();
  const cfg = normalizarConfig(configs.find(x => Number(x.bazarId) === 1) || {});
  if (!cfg.moneda.usd) return null;
  if (cfg.moneda.modo === 'fijo' && cfg.moneda.fijo > 0) return { mxnPorUsd: cfg.moneda.fijo, fuente: 'fijo', fecha: '' };
  const tc = await tipoDeCambio(db).catch(() => null);
  return tc ? { mxnPorUsd: tc.mxnPorUsd, fuente: tc.fuente, fecha: tc.fecha } : null;
}

// Lo que la tienda necesita saber (va dentro de /api/sync?scope=publico)
export async function datosTiendaPublica(db) {
  const [configs, drops] = await Promise.all([
    db.collection('tiendaConfig').find({}).toArray(),
    db.collection('drops').find({}).toArray(),
  ]);
  const porBazar = {};
  const bazares = new Set([1, ...configs.map(c => Number(c.bazarId))]);
  for (const id of bazares) {
    const c = normalizarConfig(configs.find(x => Number(x.bazarId) === id) || {}, id);
    porBazar[id] = {
      volumen: c.volumen, ofertas: c.ofertas, info: c.info, envioCosto: c.envioCosto,
      hayCupones: (modulo(c, 'cupones') && c.cupones.some(x => x.activo)) || !!c.frecuente?.cumple || modulo(c, 'referidos'), pagoEnLinea: c.pagoEnLinea && metodosPago(c, id).length > 0, metodos: metodosPago(c, id), pagoCon: metodosPago(c, id)[0] || null,
      envia: enviaListo(c, id) ? { gratisDesde: c.envia.gratisDesde } : null,
      puntosEntrega: puntosActivos(c), entregaGratisDesde: c.entregaGratisDesde, modulos: c.modulos,
      apartado: modulo(c, 'apartado') ? { pct: c.apartado.pct, dias: c.apartado.dias, minimo: c.apartado.minimo } : null,
      minutosPago: c.minutosPago,
      formasPago: c.formasPago,   // v55
      // v42: transferencia (los datos de la cuenta solo salen en el recibo del pedido) y cliente frecuente
      spei: c.spei?.activo && c.spei.clabe ? { horas: c.spei.horas } : null,
      frecuente: c.frecuente?.activo ? { cada: c.frecuente.cada, pct: c.frecuente.pct } : null,
      // v43
      outfit: modulo(c, 'outfit') ? { pct: c.outfit.pct } : null,
      referidos: modulo(c, 'referidos') ? { pctAmigo: c.referidos.pctAmigo } : null,
      google: modulo(c, 'googleMaps') ? c.google : null,
      // v41: solo los datos que sí escribió la dueña
      legal: Object.fromEntries(Object.entries(c.legal).filter(([, v]) => v)),
    };
  }
  const ahora = Date.now();
  const moneda = await monedaTienda(db, configs);
  return {
    porBazar, moneda, turnstile: turnstileSiteKey(),   // v41: clave pública del freno para robots (o null)
    drops: drops.filter(d => !d.publicado && new Date(d.fecha) > ahora && new Date(d.fecha) - ahora < 30 * DIA)
      .map(d => ({ id: d.id, nombre: d.nombre, fecha: d.fecha, n: (d.prendas || []).length, bazarId: d.bazarId || 1 }))
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha)).slice(0, 3),
  };
}

// ── Cuentas: misma fórmula en tienda y servidor ──────────────
export function calcularTotal(cfg, precios, cupon) {
  const subtotal = precios.reduce((t, p) => t + p, 0);
  const tramo = [...(cfg.volumen || [])].reverse().find(v => precios.length >= v.n);
  const descVolumen = tramo ? Math.round(subtotal * tramo.pct / 100) : 0;
  let descCupon = 0;
  if (cupon) descCupon = cupon.tipo === 'monto' ? Math.min(cupon.valor, subtotal - descVolumen) : Math.round((subtotal - descVolumen) * cupon.valor / 100);
  return { subtotal, descVolumen, tramo, descCupon, total: Math.max(0, subtotal - descVolumen - descCupon) };
}
// v42 · De dónde vino la venta. El navegador manda lo que vio al llegar (utm_* o la
// página de la que venía); aquí se reduce a una fuente conocida y textos cortos.
export const FUENTES = ['instagram', 'facebook', 'tiktok', 'whatsapp', 'google', 'marketplace', 'qr', 'correo', 'otra web', 'directo'];
export function origenDe(o) {
  if (!o || typeof o !== 'object') return { fuente: 'directo' };
  const limpio = (v, n) => String(v ?? '').toLowerCase().replace(/[^a-z0-9 ._\-áéíóúñ]/g, '').trim().slice(0, n);
  const src = limpio(o.fuente, 40), medio = limpio(o.medio, 30), campana = limpio(o.campana, 60);
  const ref = limpio(o.ref, 80).replace(/^www\./, '');
  const de = t => /instagram|^ig$|^ig[._-]/.test(t) ? 'instagram' : /marketplace/.test(t) ? 'marketplace' : /facebook|^fb$|^fb[._-]|^m\.facebook|^l\.facebook/.test(t) ? 'facebook'
    : /tiktok/.test(t) ? 'tiktok' : /whatsapp|^wa$|wa\.me/.test(t) ? 'whatsapp' : /google|bing|duckduckgo|yahoo/.test(t) ? 'google'
    : /^qr|etiqueta|caja|bazar/.test(t) ? 'qr' : /correo|email|mail|resend/.test(t) ? 'correo' : '';
  let fuente = (src && de(src)) || (ref && de(ref)) || (src || ref ? 'otra web' : 'directo');
  if (ref && /stiimpys/.test(ref) && !src) fuente = 'directo';
  return { fuente, ...(medio ? { medio } : {}), ...(campana ? { campana } : {}), ...(ref && fuente === 'otra web' ? { ref } : {}) };
}

// v42 · Cliente frecuente: compras pagadas por teléfono (en línea + en bazar). Cada N
// compras, la siguiente lleva descuento. No se junta con cupones.
export async function frecuenteDe(db, cfg, bazarId, telefono) {
  if (!cfg.frecuente?.activo) return null;
  const t10 = String(telefono || '').replace(/\D/g, '').slice(-10);
  if (t10.length !== 10) return null;
  const re = new RegExp(t10 + '$');   // solo dígitos: seguro dentro de la expresión
  const [enLinea, tickets] = await Promise.all([
    db.collection('pedidos').countDocuments({ bazarId, estado: 'pagado', telefono: re }),
    db.collection('ventas').distinct('ticket', { canal: 'bazar', 'cliente.telefono': t10, anulada: { $ne: true } }).catch(() => []),
  ]);
  const compras = enLinea + tickets.length, cada = cfg.frecuente.cada;
  return { compras, cada, pct: cfg.frecuente.pct, aplica: compras > 0 && compras % cada === 0, faltan: cada - (compras % cada) };
}
function aplicarFrecuente(cuenta, frec) {
  if (!frec?.aplica || !(cuenta.total > 0)) return cuenta;
  const d = Math.round(cuenta.total * frec.pct / 100);
  return { ...cuenta, descFrecuente: d, total: cuenta.total - d };
}

// v42: además de los cupones de la tienda, los personales de cumpleaños (CUMPLE-XXXXXX)
// v43: y los de amigos (REF-XXXXX) y los regalos por invitar (REGALO-XXXXXX)
async function cuponDe(db, cfg, bazarId, codigo, subtotal, telefono) {
  const c = String(codigo || '').trim();
  if (/^(CUMPLE|REGALO)-/i.test(c)) {
    const { cuponPersonal } = await import('./clientes.js');
    const r = await cuponPersonal(db, bazarId, c);
    if (!r) return { error: 'Ese cupón no existe o ya no está activo.' };
    // Es personal: solo lo usa el WhatsApp al que se le dio
    if (r.cupon?.tel10 && tel(telefono).length >= 10 && tel(telefono).slice(-10) !== r.cupon.tel10) return { error: 'Ese cupón es personal y es de otra persona.' };
    return r;
  }
  if (/^REF-/i.test(c)) {
    const { cuponReferido } = await import('./extras.js');
    return (await cuponReferido(db, cfg, bazarId, c, telefono)) || { error: 'Ese código no existe.' };
  }
  return cuponValido(cfg, codigo, subtotal);
}
function cuponValido(cfg, codigo, subtotal) {
  const c = cfg.cupones.find(x => x.codigo === String(codigo || '').trim().toUpperCase());
  if (!modulo(cfg, 'cupones')) return { error: 'Por ahora no se están usando cupones.' };
  if (!c || !c.activo) return { error: 'Ese cupón no existe o ya no está activo.' };
  if (c.vence && c.vence < hoyMx()) return { error: 'Ese cupón ya venció.' };
  if (c.maxUsos && c.usos >= c.maxUsos) return { error: 'Ese cupón ya se agotó.' };
  if (subtotal < c.minimo) return { error: `Ese cupón aplica en compras desde ${pesos(c.minimo)}.` };
  return { cupon: c };
}

// ── Pendientes del panel (avisos por WhatsApp listos para mandar) ──
export async function pendiente(db, bazarId, tipo, textoAviso, extra = {}) {
  const doc = { id: crypto.randomBytes(6).toString('hex'), bazarId: Number(bazarId) || 1, tipo, texto: textoAviso, hecho: false, en: new Date().toISOString(), ...extra };
  await db.collection('pendientes').insertOne(doc);
  return doc;
}
// ── v33 · Historial de cada pedido ───────────────────────────
// Cada cambio queda en pedido.historial (los últimos 100) y, a la vez, en el
// Centro de actividad. "de"/"a" son estados del pedido; si la entrada no
// cambia el estado (p. ej. "abrió el pago del resto") van vacíos.
export async function historialPedido(db, pedido, { de = null, a = null, accion, por = 'sistema', detalle = null,
  categoria = 'pedido', tipo = 'pedido', resultado = 'ok', error = null, registrar = true } = {}) {
  if (!pedido?.id) return;
  const entrada = { en: new Date().toISOString(), de, a, accion: String(accion || '').slice(0, 200), por: String(por || 'sistema').slice(0, 60),
    ...(detalle ? { detalle } : {}), ...(resultado !== 'ok' ? { resultado } : {}) };
  try { await db.collection('pedidos').updateOne({ id: pedido.id }, { $push: { historial: { $each: [entrada], $slice: -100 } } }); }
  catch (e) { console.error('[historial]', e?.message || e); }
  if (registrar) await registrarEvento({ categoria, tipo, accion: `${accion}${a && de !== a ? ` (${de || '—'} → ${a})` : ''}`, resultado,
    usuario: por, bazarId: pedido.bazarId, pedidoId: pedido.id, detalle: { ...(detalle || {}), ...(de || a ? { de, a } : {}) }, error }, db);
}

// ¿La prenda está comprometida con un pedido en línea? (alguien pagando ahora mismo,
// o un anticipo ya pagado). Lo usan borrar, vender en persona y editar desde el panel.
export async function reservaActiva(db, prenda) {
  const pid = prenda?.reservedBy?.pedido;
  if (!pid || prenda.vendido) return null;
  const pedido = await db.collection('pedidos').findOne({ id: String(pid) });
  if (!pedido) return null;
  const quien = String(pedido.nombre || prenda.reservedBy?.nombre || 'un cliente').split(' ')[0];
  if (pedido.estado === 'apartado') return { pedido, mensaje: `Esta prenda está apartada con anticipo pagado por ${quien} (pedido ${pedido.id}). Para soltarla usa Ventas → Pedidos en línea → Apartados → Liberar.` };
  if (pedido.estado === 'pendiente' && prenda.reservedUntil && prenda.reservedUntil > new Date().toISOString())
    return { pedido, mensaje: `${quien} está pagando esta prenda en línea en este momento (pedido ${pedido.id}). Espera a que termine o venza su pago (a más tardar ${new Date(prenda.reservedUntil).toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Matamoros' })}).` };
  return null;
}

const textoDireccion = d => [d.calle, d.colonia && `Col. ${d.colonia}`, [d.cp, d.ciudad, d.estado].filter(Boolean).join(', '), d.referencias && `Ref: ${d.referencias}`].filter(Boolean).join('\n');
const linkWA = (telefono, mensaje) => telefono ? `https://wa.me/${waDe(telefono)}?text=${encodeURIComponent(mensaje)}` : null;

// ── Disponible para vender ───────────────────────────────────
const libre = p => p && !p.vendido && !p.oculto && !(p.apartada && (p.reservedBy?.anticipo || p.reservedUntil > new Date().toISOString()));
// Si el pago anterior del mismo cliente falló, sus prendas siguen apartadas a su nombre:
// para él cuentan como libres (si no, "Intentar de nuevo" le diría que ya no están).
async function pedidoPropio(db, previo) {
  const id = String(previo?.id || '').slice(0, 40), clave = String(previo?.clave || '');
  if (!id || !clave) return null;
  const p = await db.collection('pedidos').findOne({ id, estado: 'pendiente' });
  if (!p?.clave || p.clave.length !== clave.length || !crypto.timingSafeEqual(Buffer.from(p.clave), Buffer.from(clave))) return null;
  return p;
}
const esDueno = (pedido, k) => { k = String(k || ''); return !!pedido?.clave && k.length === pedido.clave.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(pedido.clave)); };
const librePara = propio => p => libre(p) || (!!propio && !p.vendido && p.reservedBy?.pedido === propio.id);

// ═════════════════════════════════════════════════════════════
export async function handleCrecer(req, res, op) {
  const db = await getDB();
  const b = req.body || {};
  const inv = db.collection('inventario');

  // ─────────── PÚBLICO ───────────
  if (op === 'v-evento') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!(await rateLimit(req, res, { key: 'v-evento', max: 600, windowSec: 3600 }))) return;
    // v42: una visita nueva a la tienda y de dónde llegó (una vez por sesión del navegador)
    if (b.tipo === 'llegada') {
      if (!modulo(await leerConfigTienda(db, 1), 'origenVentas')) return res.status(200).json({ ok: true, apagado: true });
      const o = origenDe(b.origen);
      await db.collection('origenStats').updateOne({ dia: hoyMx(), fuente: o.fuente }, { $inc: { visitas: 1 } }, { upsert: true });
      return res.status(200).json({ ok: true });
    }
    const tipo = ['vista', 'wa', 'bolsa', 'oferta', 'compartir', 'compra'].includes(b.tipo) ? b.tipo : null;
    const prendaId = Number(b.prendaId);
    if (!tipo || !prendaId) return res.status(400).json({ error: 'Datos inválidos' });
    const dia = hoyMx();
    await db.collection('prendaStats').updateOne({ prendaId, dia }, { $inc: { [tipo]: 1 } }, { upsert: true });
    if (tipo !== 'vista') return res.status(200).json({ ok: true });
    const fila = await db.collection('prendaStats').findOne({ prendaId, dia });
    return res.status(200).json({ ok: true, hoy: fila?.vista || 1 });
  }

  // v43 · Revisar el comprobante con IA + Banxico. Lo pide el recibo del cliente justo después de subirlo
  // (con su clave) o la dueña desde el panel (con sesión de administrador).
  if (op === 'v-spei-verificar') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!(await rateLimit(req, res, { key: 'v-spei-ver', max: 12, windowSec: 3600 }))) return;
    const p = await db.collection('pedidos').findOne({ id: String(b.id || '') });
    let admin = false;
    if (!p || !esDueno(p, b.k)) {
      const u = await getUser(req).catch(() => null);
      if (!p || !u || u.role !== 'admin' || !mismoBazar(u, p.bazarId)) return res.status(404).json({ error: 'Pedido no encontrado' });
      admin = true;
    }
    const cfg = await leerConfigTienda(db, p.bazarId);
    if (!modulo(cfg, 'speiIA')) return res.status(400).json({ error: 'La revisión automática está apagada (Ventas → Módulos).' });
    if (p.proveedor !== 'spei' || !p.speiComprobante?.url) return res.status(400).json({ error: 'Ese pedido no tiene comprobante.' });
    const previa = p.speiComprobante.revision;
    if (!admin && previa && Date.now() - new Date(previa.en) < 3 * 60e3) return res.status(200).json({ ok: true, pagado: p.estado !== 'pendiente' && p.estado !== 'expirado' });
    const { revision, aprobado } = await revisarComprobante(db, p, cfg);
    invalidarSyncCache();
    if (admin) return res.status(200).json({ ok: true, revision, aprobado });
    return res.status(200).json({ ok: true, pagado: aprobado, verificado: revision.nivel === 'verde' });
  }

  // v42 · El cliente deja su cumpleaños (día y mes) en su recibo para recibir su cupón
  if (op === 'v-cumple') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!(await rateLimit(req, res, { key: 'v-cumple', max: 10, windowSec: 3600 }))) return;
    const pedido = await db.collection('pedidos').findOne({ id: String(b.id || '') });
    if (!pedido || !esDueno(pedido, b.k) || !['pagado', 'apartado'].includes(pedido.estado)) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (!pedido.email) return res.status(400).json({ error: 'Para mandarte tu cupón necesitamos tu correo. Escríbenos por WhatsApp.' });
    const { guardarCumple } = await import('./clientes.js');
    if (!(await guardarCumple(db, pedido, String(b.cumple || '')))) return res.status(400).json({ error: 'Revisa el día y el mes.' });
    return res.status(200).json({ ok: true });
  }

  // v42 · Transferencia SPEI: el cliente sube la foto de su comprobante
  if (op === 'v-spei-comprobante') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Solo POST' });
    if (!(await rateLimit(req, res, { key: 'v-spei', max: 10, windowSec: 3600 }))) return;
    const pedido = await db.collection('pedidos').findOne({ id: String(b.id || '') });
    if (!pedido || !esDueno(pedido, b.k)) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (pedido.proveedor !== 'spei') return res.status(400).json({ error: 'Ese pedido no es por transferencia.' });
    if (pedido.estado !== 'pendiente') return res.status(409).json({ error: pedido.estado === 'expirado' ? 'El apartado de este pedido ya venció. Escríbenos por WhatsApp.' : 'Este pedido ya no está esperando pago.' });
    const { imagenValida, subirImagen } = await import('./nube.js');
    const malo = imagenValida(b.imagen); if (malo) return res.status(400).json({ error: malo });
    let url;
    try { url = await subirImagen(b.imagen, 'stiimpys/comprobantes'); }
    catch (e) { return res.status(e.status || 502).json({ error: e.message }); }
    // Mientras la dueña lo revisa, el apartado se alarga 48 h (que no se suelte la prenda)
    const hasta = new Date(Date.now() + 48 * 3600e3).toISOString();
    await db.collection('pedidos').updateOne({ id: pedido.id, estado: 'pendiente' }, { $set: { speiComprobante: { url, en: new Date().toISOString() }, expira: hasta } });
    await db.collection('inventario').updateMany({ 'reservedBy.pedido': pedido.id }, { $set: { reservedUntil: hasta } });
    await historialPedido(db, pedido, { accion: 'El cliente subió su comprobante de transferencia', por: 'cliente', categoria: 'pago', tipo: 'spei.comprobante' });
    await pendiente(db, pedido.bazarId, 'spei', `Revisar transferencia del pedido ${pedido.id}`, { pedido: pedido.id, titulo: 'Revisar transferencia',
      cliente: String(pedido.nombre || '').split(' ')[0], monto: pedido.spei?.monto || pedido.total, metodo: 'SPEI', detalle: 'Abre tu banco, confirma que llegó y toca "Ya me llegó" en el pedido.' }).catch(() => {});
    try { const { avisarDuena } = await import('./alertas.js');
      await avisarDuena(db, { clave: `spei:${pedido.id}`, titulo: 'Llegó un comprobante de transferencia', texto: `Pedido ${pedido.id} · ${pesos(pedido.spei?.monto || pedido.total)}. Revísalo en Ventas → Pedidos en línea → Sin pagar.` }); } catch (_) {}
    invalidarSyncCache();
    const cfgS = await leerConfigTienda(db, pedido.bazarId);
    return res.status(200).json({ ok: true, enRevision: true, revisar: modulo(cfgS, 'speiIA') && !!process.env.ANTHROPIC_API_KEY });
  }

  if (op === 'v-oferta') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!(await rateLimit(req, res, { key: 'v-oferta', max: 8, windowSec: 3600 }))) return;
    if (!(await exigirTurnstile(req, res))) return;   // v41
    const p = await inv.findOne({ id: Number(b.prendaId) });
    if (!libre(p) || !(await filtroTienda(db))(p)) return res.status(400).json({ error: 'Esta prenda ya no está disponible.' });
    const cfg = await leerConfigTienda(db, p.bazarId);
    if (!cfg.ofertas.activas) return res.status(400).json({ error: 'Este bazar no está recibiendo ofertas por ahora.' });
    const monto = Math.round(Number(b.monto) || 0), precio = Number(p.precio_venta) || 0;
    const nombre = texto(b.nombre, 60), telefono = tel(b.telefono);
    if (!nombre || telefono.length < 10) return res.status(400).json({ error: 'Escribe tu nombre y tu WhatsApp a 10 dígitos.' });
    if (!(monto > 0) || monto >= precio) return res.status(400).json({ error: `Tu oferta debe ser menor a ${pesos(precio)}.` });
    if (monto < precio * cfg.ofertas.minimoPct / 100) return res.status(400).json({ error: 'Esa oferta es muy baja para esta prenda. Intenta con un poco más 🙏', baja: true });
    const col = db.collection('ofertas');
    const previa = await col.findOne({ prendaId: p.id, telefono, estado: 'nueva' });
    if (previa) await col.updateOne({ id: previa.id }, { $set: { monto, nombre, en: new Date().toISOString() } });
    else await col.insertOne({ id: await siguienteId('ofertas'), prendaId: p.id, bazarId: Number(p.bazarId || 1), prendaNombre: p.nombre, foto: (p.imagenes || [])[0] || '',
      precio, monto, nombre, telefono, estado: 'nueva', en: new Date().toISOString() });
    await db.collection('prendaStats').updateOne({ prendaId: p.id, dia: hoyMx() }, { $inc: { oferta: 1 } }, { upsert: true });
    return res.status(200).json({ ok: true });
  }

  if (op === 'v-espera') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!(await rateLimit(req, res, { key: 'v-espera', max: 10, windowSec: 3600 }))) return;
    if (!(await exigirTurnstile(req, res))) return;   // v41
    const tipo = ['prenda', 'drop', 'busqueda'].includes(b.tipo) ? b.tipo : null;
    const nombre = texto(b.nombre, 60), telefono = tel(b.telefono);
    if (!tipo || !nombre || telefono.length < 10) return res.status(400).json({ error: 'Escribe tu nombre y tu WhatsApp a 10 dígitos.' });
    const cfgEspera = await leerConfigTienda(db, Number(b.bazarId) || 1);
    if (!modulo(cfgEspera, 'avisame')) return res.status(400).json({ error: 'Por ahora no estamos tomando avisos.' });
    const doc = { tipo, nombre, telefono, en: new Date().toISOString(), avisado: false };
    if (tipo === 'prenda') {
      const p = await inv.findOne({ id: Number(b.prendaId) });
      if (!p || !(await filtroTienda(db))(p)) return res.status(404).json({ error: 'Prenda no encontrada' });
      Object.assign(doc, { prendaId: p.id, prendaNombre: p.nombre, bazarId: Number(p.bazarId || 1), talla: p.talla || '', marca: p.marca || '', categoria: (p.categorias || [])[0] || '' });
    } else if (tipo === 'drop') {
      const d = await db.collection('drops').findOne({ id: String(b.dropId) });
      if (!d) return res.status(404).json({ error: 'Drop no encontrado' });
      Object.assign(doc, { dropId: d.id, dropNombre: d.nombre, bazarId: Number(d.bazarId || 1), fecha: d.fecha });
    } else {
      Object.assign(doc, { bazarId: Number(b.bazarId) || 1, talla: texto(b.talla, 30), marca: texto(b.marca, 40), categoria: texto(b.categoria, 40) });
      if (!doc.talla && !doc.marca && !doc.categoria) return res.status(400).json({ error: 'Dinos qué buscas: talla, marca o tipo de prenda.' });
    }
    const clave = { telefono, tipo, prendaId: doc.prendaId, dropId: doc.dropId, talla: doc.talla, marca: doc.marca };
    Object.keys(clave).forEach(k => clave[k] === undefined && delete clave[k]);
    if (await db.collection('listaEspera').findOne({ ...clave, avisado: false })) return res.status(200).json({ ok: true, ya: true });
    await db.collection('listaEspera').insertOne({ id: crypto.randomBytes(6).toString('hex'), ...doc });
    return res.status(200).json({ ok: true });
  }

  if (op === 'v-cupon') {
    if (!(await rateLimit(req, res, { key: 'v-cupon', max: 30, windowSec: 3600 }))) return;
    const cfg = await leerConfigTienda(db, b.bazarId);
    const r = await cuponDe(db, cfg, Number(b.bazarId) || 1, b.codigo, Number(b.subtotal) || 0);
    if (r.error) return res.status(400).json({ error: r.error });
    return res.status(200).json({ ok: true, cupon: { codigo: r.cupon.codigo, tipo: r.cupon.tipo, valor: r.cupon.valor, minimo: r.cupon.minimo } });
  }

  if (op === 'v-cotizar') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!(await rateLimit(req, res, { key: 'v-cotizar', max: 240, windowSec: 3600 }))) return;
    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean))].slice(0, 20);
    if (!ids.length) return res.status(400).json({ error: 'Tu carrito está vacío.' });
    const todas = (await inv.find({ id: { $in: ids } }).toArray()).filter(await filtroTienda(db));
    // v39 · Una sola tienda: siempre se cotiza con Stiimpys aunque el carrito guardado diga otro bazar
    const bazarId = !multiBazar() ? await bazarPrincipal(db) : (Number(b.bazarId) || Number(todas[0]?.bazarId || 1));
    const delBazar = todas.filter(p => Number(p.bazarId || 1) === bazarId);
    const esLibre = librePara(await pedidoPropio(db, b.previo));
    const libres = delBazar.filter(esLibre);
    const cfg = await leerConfigTienda(db, bazarId);
    const metodos = metodosPago(cfg, bazarId);
    const precios = libres.map(p => Number(p.precio_venta) || 0);
    const subtotal = precios.reduce((t, x) => t + x, 0);
    let cupon = null, cuponError = null;
    if (b.cupon) { const r = await cuponDe(db, cfg, bazarId, b.cupon, subtotal, b.telefono); if (r.error) cuponError = r.error; else cupon = r.cupon; }
    // v42: cliente frecuente (si ya escribió su WhatsApp). Solo se dice si aplica, no cuántas compras lleva.
    let frec = null;
    if (!cupon && cfg.frecuente?.activo && tel(b.telefono).length >= 10 && (await rateLimit(req, null, { key: 'v-frecuente', max: 40, windowSec: 3600 })))
      frec = await frecuenteDe(db, cfg, bazarId, b.telefono);
    const { aplicarOutfit, grupoPrenda } = await import('./extras.js');
    const c = aplicarFrecuente(aplicarOutfit(calcularTotal(cfg, precios, cupon), libres, cfg, modulo(cfg, 'outfit')), frec);
    const bazar = await db.collection('bazares').findOne({ id: bazarId });
    // Si le falta poco para el siguiente descuento: prendas de su talla y precio parecido
    const siguiente = cfg.volumen.find(v => libres.length < v.n) || null;
    let sugerencias = [];
    if (modulo(cfg, 'sugerencias') && siguiente && libres.length && siguiente.n - libres.length <= 2) {
      const tallas = new Set(libres.map(p => tallaBase(p.talla)).filter(Boolean));
      const tope = Math.max(...precios) * 1.25;
      const cand = (await inv.find({ vendido: { $ne: true } }).sort({ id: -1 }).limit(400).toArray())
        .filter(p => Number(p.bazarId || 1) === bazarId && !ids.includes(p.id) && libre(p) && (p.imagenes || []).length
          && Number(p.precio_venta) > 0 && Number(p.precio_venta) <= Math.max(...precios) * 2);
      const puntos = p => (tallas.has(tallaBase(p.talla)) ? 4 : 0) + (Number(p.precio_venta) <= tope ? 2 : 0) + (Number(p.precioAnterior) > Number(p.precio_venta) ? 1 : 0);
      sugerencias = cand.map(p => [puntos(p), p]).filter(([n]) => n >= 4).sort((a, b) => b[0] - a[0]).slice(0, 4)
        .map(([, p]) => ({ id: p.id, nombre: p.nombre, talla: p.talla || '', precio: Number(p.precio_venta) || 0, antes: Number(p.precioAnterior) || 0, imagen: p.imagenes[0] }));
    }
    return res.status(200).json({
      sugerencias,
      bazar: { id: bazarId, nombre: bazar?.nombre || 'Stiimpys', whatsapp: String(bazar?.whatsapp || '').replace(/\D/g, '') },
      prendas: libres.map(p => ({ id: p.id, nombre: p.nombre, marca: p.marca || '', talla: p.talla || '', estado: p.estado || '', precio: Number(p.precio_venta) || 0, antes: Number(p.precioAnterior) || 0, imagen: (p.imagenes || [])[0] || '' })),
      // v37: si la tiene alguien que está pagando (10 min), sale la hora en que se libera (nunca quién)
      noDisponibles: delBazar.filter(p => !esLibre(p)).map(p => ({ id: p.id, nombre: p.nombre, motivo: p.vendido ? 'vendida' : 'apartada',
        ...(!p.vendido && p.reservedBy?.pedido && !p.reservedBy?.anticipo && p.reservedUntil ? { hasta: new Date(p.reservedUntil).toISOString() } : {}) })),
      subtotal: c.subtotal, descVolumen: c.descVolumen, tramo: c.tramo || null, descCupon: c.descCupon, total: c.total,
      descOutfit: c.descOutfit || 0, outfit: modulo(cfg, 'outfit') ? { pct: cfg.outfit.pct, grupos: [...new Set(libres.map(grupoPrenda).filter(Boolean))] } : null,
      descFrecuente: c.descFrecuente || 0, frecuente: cfg.frecuente?.activo ? { cada: cfg.frecuente.cada, pct: cfg.frecuente.pct, aplica: !!frec?.aplica } : null,
      spei: cfg.spei?.activo ? { horas: cfg.spei.horas } : null,
      siguiente,
      cupon: cupon ? { codigo: cupon.codigo, tipo: cupon.tipo, valor: cupon.valor } : null, cuponError,
      hayCupones: (modulo(cfg, 'cupones') && cfg.cupones.some(x => x.activo)) || !!cfg.frecuente?.cumple || modulo(cfg, 'referidos'), envioCosto: cfg.envioCosto, info: cfg.info,
      envia: enviaListo(cfg, bazarId) ? { gratisDesde: cfg.envia.gratisDesde } : null,
      puntosEntrega: puntosActivos(cfg), entregaGratisDesde: cfg.entregaGratisDesde, modulos: cfg.modulos,
      pagoEnLinea: cfg.pagoEnLinea && metodos.length > 0, metodos, pagoCon: metodos[0] || null,
      apartado: modulo(cfg, 'apartado') && cfg.pagoEnLinea && metodos.length ? { pct: cfg.apartado.pct, dias: cfg.apartado.dias, minimo: cfg.apartado.minimo } : null,
      moneda: await monedaTienda(db).catch(() => null),
    });
  }

  if (op === 'v-envio-cp') {
    if (!(await rateLimit(req, res, { key: 'v-envio-cp', max: 120, windowSec: 3600 }))) return;
    const info = await consultarCP(db, req.query.cp).catch(() => null);
    if (!info) return res.status(404).json({ error: 'No encontramos ese código postal.' });
    return res.status(200).json(info);
  }

  if (op === 'v-envio-cotizar') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!(await rateLimit(req, res, { key: 'v-envio-cotizar', max: 60, windowSec: 3600 }))) return;
    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean))].slice(0, 20);
    const cp = String(b.cp || '').replace(/\D/g, '');
    if (!ids.length || cp.length !== 5) return res.status(400).json({ error: 'Escribe tu código postal de 5 números.' });
    const deAqui = await filtroTienda(db);
    const prendas = (await inv.find({ id: { $in: ids } }).toArray()).filter(p => !p.vendido && deAqui(p));
    if (!prendas.length) return res.status(400).json({ error: 'Esas prendas ya no están disponibles.' });
    const bazarId = Number(prendas[0].bazarId || 1);
    const mias = prendas.filter(p => Number(p.bazarId || 1) === bazarId);
    const cfg = await leerConfigTienda(db, bazarId);
    if (!enviaListo(cfg, bazarId)) return res.status(400).json({ error: 'Este bazar no cotiza envíos en línea.', fijo: cfg.envioCosto || 0 });
    const precios = mias.map(p => Number(p.precio_venta) || 0);
    const cuenta = calcularTotal(cfg, precios, null);
    try {
      return res.status(200).json(await cotizarEnvio(db, { bazarId, cfg, prendas: mias, cp, subtotal: cuenta.total, valor: cuenta.subtotal }));
    } catch (e) {
      console.error('[envio-cotizar]', e.message);
      return res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.status ? e.message : 'No pudimos cotizar el envío en este momento.', fijo: cfg.envioCosto || 0 });
    }
  }

  if (op === 'v-mis-pedidos') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!(await rateLimit(req, res, { key: 'v-mis-pedidos', max: 120, windowSec: 3600 }))) return;
    const lista = (Array.isArray(b.pedidos) ? b.pedidos : []).slice(0, 30);
    const docs = await db.collection('pedidos').find({ id: { $in: lista.map(x => String(x?.id || '').slice(0, 40)) } }).toArray();
    const out = [];
    for (const x of lista) {
      const p = docs.find(d => d.id === String(x?.id || ''));
      if (p && esDueno(p, x.k)) out.push(resumenPedido(p));
    }
    return res.status(200).json({ pedidos: out });
  }

  if (op === 'v-recuperar-pedido') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!(await rateLimit(req, res, { key: 'v-recuperar-pedido', max: 8, windowSec: 3600 }))) return;
    const t = tel(b.telefono).slice(-10), codigo = String(b.codigo || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), email = texto(b.email, 120).toLowerCase();
    if (t.length !== 10 || (codigo.length < 5 && !email)) return res.status(400).json({ error: 'Escribe tu WhatsApp a 10 dígitos y el número de pedido (o el correo que usaste).' });
    const suyos = (await db.collection('pedidos').find({ estado: { $in: ['pagado', 'apartado', 'pendiente', 'expirado'] } }).sort({ en: -1 }).limit(2000).toArray())
      .filter(p => tel(p.telefono).slice(-10) === t && p.clave
        && ((codigo.length >= 5 && p.id.toUpperCase().endsWith(codigo)) || (email && String(p.email || '').toLowerCase() === email)));
    if (!suyos.length) return res.status(404).json({ error: 'No encontramos pedidos con esos datos. Revisa el número o escríbenos por WhatsApp.' });
    return res.status(200).json({ pedidos: suyos.slice(0, 20).map(p => ({ ...resumenPedido(p), k: p.clave, link: urlPedido(p) })) });
  }

  if (op === 'v-pagar-resto') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!(await rateLimit(req, res, { key: 'v-pagar-resto', max: 12, windowSec: 3600 }))) return;
    const pedido = await db.collection('pedidos').findOne({ id: String(b.id || '').slice(0, 40) });
    if (!pedido || !esDueno(pedido, b.k)) return res.status(404).json({ error: 'Pedido no encontrado.' });
    let estado = pedido.estado;
    try { estado = await revisarPagoDePedido(db, pedido); } catch {}
    if (estado === 'pagado') return res.status(200).json({ ok: true, pagado: true });
    if (pedido.estado !== 'apartado') return res.status(400).json({ error: 'Este pedido no tiene saldo pendiente.' });
    const cfg = await leerConfigTienda(db, pedido.bazarId);
    const metodos = metodosPago(cfg, pedido.bazarId).filter(m => m !== 'spei');   // v42: el resto se liquida con tarjeta/PayPal o en persona
    if (!metodos.length) return res.status(400).json({ error: 'Por ahora no se puede pagar en línea; liquídalo en persona.' });
    const proveedor = metodos.includes(b.metodo) ? b.metodo : metodos[0];
    const previas = pedido.liquidaciones || [];
    const ref = `${pedido.id}-R${previas.length + 1}`;
    const regreso = `${urlPedido(pedido)}&resto=1`;
    const descripcion = `Stiimpys · resto del apartado · pedido ${pedido.id}`;
    let l;
    try {
      if (proveedor === 'clip') {
        const link = await crearLinkClip(pedido.bazarId, pedido, 0, { monto: pedido.resta, referencia: ref, regreso, descripcion });
        l = { ref, proveedor, clipId: link.id, url: link.url };
      } else {
        const o = await crearOrdenPaypal(pedido.bazarId, { ...pedido, id: ref, total: pedido.resta }, { regreso, cancelar: `${regreso}&fallo=1`, descripcion });
        l = { ref, proveedor, paypalId: o.id, url: o.url };
      }
    } catch (e) {
      console.error('[v-pagar-resto]', e);
      await historialPedido(db, pedido, { accion: `No se pudo abrir el pago del resto con ${nombreMetodo(proveedor)}`, por: 'cliente', categoria: 'pago',
        tipo: `${proveedor}.link`, resultado: 'error', error: e, detalle: { monto: pedido.resta } });
      return res.status(502).json({ error: `No se pudo abrir el pago con ${nombreMetodo(proveedor)}. Intenta de nuevo en un momento o liquídalo en persona.` });
    }
    const { url, ...guardar } = l;
    await db.collection('pedidos').updateOne({ id: pedido.id }, { $set: {
      liquidaciones: [...previas, { ...guardar, monto: pedido.resta, en: new Date().toISOString() }].slice(-8),
      ...(l.clipId ? { clipIds: [...(pedido.clipIds || []), l.clipId].slice(-10) } : {}) } });
    await historialPedido(db, pedido, { accion: `El cliente abrió el pago del resto (${pesos(pedido.resta)}) con ${nombreMetodo(proveedor)}`, por: 'cliente',
      categoria: 'apartado', tipo: 'apartado.link-resto', resultado: 'info', detalle: { ref, monto: pedido.resta } });
    return res.status(200).json({ ok: true, url, monto: pedido.resta, proveedor });
  }

  if (op === 'v-resena') return resenaPedido(req, res, db);
  if (op === 'v-pagar') return pagar(req, res, db);
  if (op === 'v-pedido') return verPedido(req, res, db);
  if (op === 'v-clip-webhook') return webhookClip(req, res, db);
  if (op === 'v-feed') return feed(req, res, db);

  // ─────────── PANEL ───────────
  const user = await requireAuth(req, res); if (!user) return;
  const bazarId = esGlobal(user) ? (Number(b.bazarId || req.query.bazarId) || 1) : Number(user.bazarId);
  const esAdmin = user.role === 'admin';

  switch (op) {
    case 'v-panel': {
      // De paso corre lo automático (apartados vencidos, avisos de lista de espera)
      try {
        const { correrAutomatico } = await import('./automatico.js');
        const bz = await db.collection('bazares').findOne({ id: bazarId });
        if (bz) await correrAutomatico(db, bz);
      } catch (e) { console.error('[v-panel automatico]', e); }
      const filtro = esGlobal(user) && !req.query.bazarId ? {} : { bazarId };
      const [pend, ofertas, espera, cfg, porEntregar] = await Promise.all([
        db.collection('pendientes').find({ ...filtro, hecho: false }).sort({ en: -1 }).limit(100).toArray(),
        db.collection('ofertas').find(filtro).sort({ en: -1 }).limit(100).toArray(),
        db.collection('listaEspera').find({ ...filtro, avisado: false }).sort({ en: -1 }).limit(200).toArray(),
        leerConfigTienda(db, bazarId),
        db.collection('pedidos').countDocuments({ ...filtro, estado: 'pagado', entregaEstado: { $ne: 'entregado' } }),
      ]);
      const apartados = await db.collection('pedidos').countDocuments({ ...filtro, estado: 'apartado' });
      const sin = ({ _id, ...x }) => x;
      return res.status(200).json({
        pendientes: pend.map(sin), ofertas: ofertas.map(sin), espera: espera.map(sin), config: cfg, porEntregar, apartados,
        paypal: { configurado: paypalListo(bazarId), prueba: paypalPrueba(bazarId) },
        clip: { configurado: !!authClip(bazarId), webhook: `${SITIO()}/api/acciones?op=v-clip-webhook` },
        metodos: metodosPago(cfg, bazarId),
        envia: { token: !!tokenEnvia(bazarId), prueba: esPrueba(bazarId), listo: enviaListo(cfg, bazarId) },
        tipoCambio: await tipoDeCambio(db).catch(() => null),
        feed: `${SITIO()}/api/acciones?op=v-feed&bazar=${encodeURIComponent((await db.collection('bazares').findOne({ id: bazarId }))?.slug || '')}`,
        feedGoogle: `${SITIO()}/api/acciones?op=v-feed&formato=google`,
      });
    }

    // v41 · Pantalla "Hoy": lo que hay que atender, en un vistazo (sin costos)
    case 'v-hoy': {
      const filtro = esGlobal(user) && !req.query.bazarId ? {} : { bazarId };
      const ahoraIso = new Date().toISOString(), en48 = new Date(Date.now() + 2 * DIA).toISOString();
      const dia = hoyMx(), ini = new Date(`${dia}T06:00:00.000Z`).toISOString();
      const ped = db.collection('pedidos');
      const [porEnviar, porEntregar, pagando, apartadosVencen, apartadosVencidos, ofertas, espera, pendientes, ventasHoy, nuevasHoy, disponibles] = await Promise.all([
        ped.countDocuments({ ...filtro, estado: 'pagado', entrega: 'envio', entregaEstado: { $nin: ['enviado', 'entregado'] } }),
        ped.countDocuments({ ...filtro, estado: 'pagado', entrega: { $ne: 'envio' }, entregaEstado: { $ne: 'entregado' } }),
        ped.countDocuments({ ...filtro, estado: 'pendiente', expira: { $gt: ahoraIso } }),
        ped.countDocuments({ ...filtro, estado: 'apartado', liquidarAntes: { $gt: ahoraIso, $lte: en48 } }),
        ped.countDocuments({ ...filtro, estado: 'apartado', liquidarAntes: { $lte: ahoraIso } }),
        db.collection('ofertas').countDocuments({ ...filtro, estado: 'nueva' }),
        db.collection('listaEspera').countDocuments({ ...filtro, avisado: false }),
        db.collection('pendientes').countDocuments({ ...filtro, hecho: false }),
        db.collection('ventas').find({ ...filtro, $or: [{ fecha: { $gte: new Date(ini) } }, { fecha: { $gte: ini } }] }, { projection: { precio: 1 } }).toArray(),   // la fecha puede ser Date o texto
        db.collection('inventario').countDocuments({ ...filtro, creadoEn: { $gte: ini } }),
        db.collection('inventario').countDocuments({ ...filtro, vendido: { $ne: true }, oculto: { $ne: true } }),
      ]);
      const ultimos = await ped.find({ ...filtro, estado: { $in: ['pagado', 'apartado'] } }, { projection: { _id: 0, id: 1, nombre: 1, total: 1, estado: 1, pagadoEn: 1, en: 1, entrega: 1, entregaEstado: 1 } })
        .sort({ en: -1 }).limit(5).toArray();
      return res.status(200).json({
        dia, porEnviar, porEntregar, pagando, apartadosVencen, apartadosVencidos, ofertas, espera, pendientes,
        ventasHoy: { n: ventasHoy.length, total: ventasHoy.reduce((t, v) => t + (Number(v.precio) || 0), 0) },
        nuevasHoy, disponibles, ultimos: ultimos.map(p => ({ ...p, nombre: String(p.nombre || '').split(' ')[0] })),
      });
    }

    // v41 · Buscador del panel (⌘K / Ctrl+K): pedidos, clientes y prendas en una sola búsqueda
    case 'v-buscar': {
      const q = texto(req.query.q || b.q, 60).trim();
      if (q.length < 2) return res.status(200).json({ pedidos: [], prendas: [], clientes: [] });
      const filtro = esGlobal(user) && !req.query.bazarId ? {} : { bazarId };
      const er = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const digitos = q.replace(/\D/g, '');
      const porTel = digitos.length >= 4 ? [{ telefono: new RegExp(digitos.slice(-10)) }] : [];
      const skuQ = q.match(/^STI-?0*(\d+)$/i);   // v42: SKU de la etiqueta (STI-00012)
      const idNum = skuQ ? Number(skuQ[1]) : /^\d+$/.test(q) ? Number(q) : null;
      const [pedidos, prendas, clientes] = await Promise.all([
        db.collection('pedidos').find({ ...filtro, $or: [{ id: er }, { nombre: er }, { email: er }, ...porTel] },
          { projection: { _id: 0, id: 1, nombre: 1, telefono: 1, total: 1, estado: 1, en: 1, entregaEstado: 1 } }).sort({ en: -1 }).limit(8).toArray(),
        db.collection('inventario').find({ ...filtro, $or: [{ nombre: er }, { marca: er }, ...(idNum != null ? [{ id: idNum }] : [])] },
          { projection: { _id: 0, id: 1, nombre: 1, marca: 1, talla: 1, precio_venta: 1, vendido: 1, apartada: 1, imagenes: { $slice: 1 } } }).limit(10).toArray(),
        user.role === 'admin' && esGlobal(user)
          ? db.collection('clientes').find({ $or: [{ nombre: er }, { email: er }, { username: er }, ...porTel] },
            { projection: { _id: 0, id: 1, nombre: 1, email: 1, username: 1, telefono: 1 } }).limit(6).toArray()
          : [],
      ]);
      return res.status(200).json({ pedidos, prendas: prendas.map(p => ({ ...p, imagen: (p.imagenes || [])[0] || '', imagenes: undefined })), clientes });
    }

    case 'v-pedidos': {
      const filtro = esGlobal(user) && !req.query.bazarId ? {} : { bazarId };
      const lista = [
        ...await db.collection('pedidos').find({ ...filtro, estado: { $in: ['pagado', 'apartado', 'pendiente', 'expirado'] } }).sort({ en: -1 }).limit(150).toArray(),
        // v33: los cancelados recientes también se ven (filtro "Cancelados")
        ...await db.collection('pedidos').find({ ...filtro, estado: 'cancelado' }).sort({ en: -1 }).limit(40).toArray(),
      ];
      return res.status(200).json({ pedidos: lista.map(p => ({
        alertas: alertasPedido(p), historialN: (p.historial || []).length, canceladoEn: p.canceladoEn || null, canceladoPor: p.canceladoPor || null,
        canceladoDesde: p.canceladoDesde || null, motivoCancelacion: p.motivoCancelacion || '', pagoTrasCancelar: !!p.pagoTrasCancelar, expira: p.expira || null,
        speiComprobante: p.proveedor === 'spei' ? p.speiComprobante || null : null, origen: p.origen || null, recoleccion: p.recoleccion || null,
        rastreoAuto: p.rastreoAuto ? { estado: p.rastreoAuto.estado, texto: p.rastreoAuto.texto } : null, descOutfit: p.descOutfit || 0, descFrecuente: p.descFrecuente || 0,
        guiaEnvia: p.guiaEnvia ? { paqueteria: p.guiaEnvia.paqueteria, guia: p.guiaEnvia.guia, etiqueta: p.guiaEnvia.etiqueta, rastreo: p.guiaEnvia.rastreo, prueba: !!p.guiaEnvia.prueba } : null,
        id: p.id, en: p.en, estado: p.estado, nombre: p.nombre, telefono: p.telefono, email: p.email || '', total: p.total, envio: p.envio || 0,
        proveedor: p.proveedor || 'clip', entrega: p.entrega || (p.envio ? 'envio' : 'persona'), direccion: p.direccion ? textoDireccion(p.direccion) : '',
        items: (p.items || []).filter(x => x.id !== 'envio').map(x => ({ id: x.id, nombre: x.nombre, precio: x.lista ?? x.precio, imagen: x.imagen || '' })),
        entregaEstado: p.entregaEstado || 'pendiente', paqueteria: p.paqueteria || '', guia: p.guia || '', enviadoEn: p.enviadoEn || null, entregadoEn: p.entregadoEn || null,
        pagadoEn: p.pagadoEn || null, revisar: !!p.revisar, resena: p.resena || null, recuperar: !!p.recuperar, envioDetalle: p.envioDetalle || null, punto: p.punto || null,
        modalidad: p.modalidad || 'completo', anticipo: p.anticipo || 0, resta: p.resta || 0, liquidarAntes: p.liquidarAntes || null, anticipoPagadoEn: p.anticipoPagadoEn || null,
        liquidadoEn: p.liquidadoEn || null, liquidadoCon: p.liquidadoCon || null, pagos: p.pagos || [], restoEnLinea: (p.liquidaciones || []).length > 0,
        recordar: p.estado === 'apartado' ? linkWA(p.telefono, `¡Hola ${String(p.nombre || '').split(' ')[0]}! 👋 Te recordamos tu apartado ${p.id}: te faltan ${pesos(p.resta)}${p.liquidarAntes ? ` y la fecha para liquidar es el ${fechaCorta(p.liquidarAntes)}` : ''}. Puedes pagarlo aquí:\n${urlPedido(p)}\n\no en persona cuando te entreguemos 🙌`) : null,
        link: p.clave ? urlPedido(p) : '', whatsapp: linkWA(p.telefono, `¡Hola ${String(p.nombre || '').split(' ')[0]}! Te escribimos de Stiimpys por tu pedido ${p.id}.${p.clave ? `\n\nAquí está tu recibo y el seguimiento:\n${urlPedido(p)}` : ''}`),
      })) });
    }

    case 'v-pedido-estado': {
      const p0 = await db.collection('pedidos').findOne({ id: String(b.id || '') });
      if (!p0 || !mismoBazar(user, p0.bazarId)) return res.status(404).json({ error: 'Pedido no encontrado' });
      req._evento = { pedidoId: p0.id, bazarId: p0.bazarId, categoria: p0.estado === 'apartado' ? 'apartado' : 'pedido' };
      // v33: una sola operación a la vez por pedido (p. ej. "Cobré el resto" y "Liberar" al mismo tiempo
      // desde dos celulares). Dentro del candado se vuelve a leer el pedido, ya con su estado real.
      return conBloqueo(db, res, `pedido:${p0.id}`, 30, async () => {
        const p = await db.collection('pedidos').findOne({ id: p0.id });
        return cambiarEstadoPedido(req, res, db, user, b, p);
      }, 'Alguien más está actualizando este pedido en este momento. Espera unos segundos y revisa de nuevo.');
    }

    // v41 · Generar la guía con envia.com (cobra la guía del saldo de envia.com: solo administradores)
    case 'v-envio-guia': {
      if (!esAdmin) return res.status(403).json({ error: 'Solo un administrador genera guías (se cobran de tu saldo de envia.com).' });
      const p0 = await db.collection('pedidos').findOne({ id: String(b.id || '') });
      if (!p0 || !mismoBazar(user, p0.bazarId)) return res.status(404).json({ error: 'Pedido no encontrado' });
      req._evento = { pedidoId: p0.id, bazarId: p0.bazarId, categoria: 'pedido' };
      return conBloqueo(db, res, `pedido:${p0.id}`, 60, async () => {
        const p = await db.collection('pedidos').findOne({ id: p0.id });
        if (p.estado !== 'pagado') return res.status(400).json({ error: 'Solo se generan guías de pedidos pagados completos.' });
        if ((p.entrega || (p.envio ? 'envio' : 'persona')) !== 'envio' || !p.direccion) return res.status(400).json({ error: 'Ese pedido es de entrega en persona.' });
        if (p.guiaEnvia?.guia && !b.otra) return res.status(409).json({ error: `Ese pedido ya tiene guía (${p.guiaEnvia.paqueteria} ${p.guiaEnvia.guia}). Si de verdad quieres otra, confírmalo.`, guiaEnvia: p.guiaEnvia });
        if (p.entregaEstado === 'entregado') return res.status(409).json({ error: 'Ese pedido ya se entregó.' });
        const cfg = await leerConfigTienda(db, p.bazarId);
        const prendas = await db.collection('inventario').find({ id: { $in: (p.ids || []).map(Number) } }).toArray();
        let g;
        try { g = await generarGuia(db, { bazarId: p.bazarId, cfg, pedido: p, prendas }); }
        catch (e) {
          await historialPedido(db, p, { accion: `No se pudo generar la guía con envia.com`, por: user.username, categoria: 'pedido', tipo: 'envia.guia', resultado: 'error', error: e });
          return res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message });
        }
        const ahora = new Date().toISOString(), yo = user.username;
        await db.collection('pedidos').updateOne({ id: p.id }, { $set: { guiaEnvia: g, entregaEstado: 'enviado', paqueteria: g.paqueteria, guia: g.guia, enviadoEn: ahora, estadoPor: yo },
          ...(p.guiaEnvia?.guia ? { $push: { guiasAnteriores: p.guiaEnvia } } : {}) });
        await historialPedido(db, p, { accion: `Guía generada con envia.com: ${g.paqueteria} ${g.guia}${g.costo ? ` (${pesos(g.costo)})` : ''}${g.prueba ? ' · MODO PRUEBA' : ''}`,
          por: yo, tipo: 'envia.guia', detalle: { paqueteria: g.paqueteria, costo: g.costo, prueba: g.prueba } });
        await correoPedido(db, { ...p, guia: g.guia, paqueteria: g.paqueteria }, 'enviado', { paqueteria: g.paqueteria, guia: g.guia });
        const primero = String(p.nombre || '').split(' ')[0];
        const msj = `¡Hola ${primero}! 📦 Tu pedido ${p.id} ya va en camino por ${g.paqueteria}.\nNúmero de guía: ${g.guia}${g.rastreo ? `\nRastréalo aquí: ${g.rastreo}` : ''}\n\nTu pedido: ${urlPedido(p)}`;
        return res.status(200).json({ ok: true, guiaEnvia: g, entregaEstado: 'enviado', paqueteria: g.paqueteria, guia: g.guia, whatsapp: linkWA(p.telefono, msj) });
      });
    }

    // v43 · Resumen semanal: verlo ahora (y mandarlo al celular si se pide)
    case 'v-resumen': {
      if (!esAdmin) return res.status(403).json({ error: 'Solo un administrador ve el resumen.' });
      const { armarResumen, resumenSemanal } = await import('./extras.js');
      if (b.mandar) { const h = await resumenSemanal(db, { id: bazarId }, await leerConfigTienda(db, bazarId), { forzar: true }); return res.status(200).json({ ok: true, ...h[0] }); }
      return res.status(200).json({ ok: true, resumen: await armarResumen(db, bazarId) });
    }

    // v43 · Cancelar una guía de envia.com (te regresan el saldo si la paquetería no la usó)
    case 'v-envio-cancelar': {
      if (!esAdmin) return res.status(403).json({ error: 'Solo un administrador cancela guías.' });
      const cfg = await leerConfigTienda(db, bazarId);
      if (!modulo(cfg, 'enviosPanel')) return res.status(400).json({ error: 'Prende "Envíos desde el panel" en Ventas → Módulos.' });
      const p0 = await db.collection('pedidos').findOne({ id: String(b.id || '') });
      if (!p0 || !mismoBazar(user, p0.bazarId)) return res.status(404).json({ error: 'Pedido no encontrado' });
      req._evento = { pedidoId: p0.id, bazarId: p0.bazarId, categoria: 'pedido' };
      return conBloqueo(db, res, `pedido:${p0.id}`, 30, async () => {
        const p = await db.collection('pedidos').findOne({ id: p0.id });
        const g = p.guiaEnvia;
        if (!g?.guia) return res.status(400).json({ error: 'Ese pedido no tiene guía de envia.com.' });
        if (p.entregaEstado === 'entregado') return res.status(409).json({ error: 'Ese pedido ya se entregó: la guía no se puede cancelar.' });
        const { cancelarGuia } = await import('./envios.js');
        let r; try { r = await cancelarGuia(p.bazarId, { carrier: g.carrier || g.paqueteria, guia: g.guia }); }
        catch (e) { return res.status(e.status || 502).json({ error: e.message }); }
        const vieja = { ...g, cancelada: new Date().toISOString(), saldoDevuelto: r.saldoDevuelto };
        const set = { guiasAnteriores: [...(p.guiasAnteriores || []), vieja].slice(-10) };
        if (p.guia === g.guia) Object.assign(set, { entregaEstado: 'pendiente', guia: '', paqueteria: '', enviadoEn: null });
        await db.collection('pedidos').updateOne({ id: p.id }, { $set: set, $unset: { guiaEnvia: '', recoleccion: '' } });
        await historialPedido(db, p, { accion: `Guía ${g.guia} cancelada en envia.com${r.saldoDevuelto ? ' (saldo devuelto)' : ''}`, por: user.username, tipo: 'envio.cancelada' });
        invalidarSyncCache();
        return res.status(200).json({ ok: true, saldoDevuelto: r.saldoDevuelto });
      }, 'Alguien más está moviendo este pedido.');
    }

    // v43 · Pedir que la paquetería pase a recoger los paquetes con guía
    case 'v-envio-recoleccion': {
      if (!esAdmin) return res.status(403).json({ error: 'Solo un administrador pide recolecciones.' });
      const cfg = await leerConfigTienda(db, bazarId);
      if (!modulo(cfg, 'enviosPanel')) return res.status(400).json({ error: 'Prende "Envíos desde el panel" en Ventas → Módulos.' });
      const fecha = String(b.fecha || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha < hoyMx()) return res.status(400).json({ error: 'Elige un día de hoy en adelante.' });
      const desde = Math.round(Number(b.desde)), hasta = Math.round(Number(b.hasta));
      if (!(desde >= 7 && hasta <= 21 && hasta - desde >= 2)) return res.status(400).json({ error: 'El horario debe ser de al menos 2 horas, entre 7 y 21.' });
      const carrier = String(b.carrier || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
      const pedidos = await db.collection('pedidos').find({ bazarId, estado: 'pagado', entregaEstado: { $ne: 'entregado' }, 'guiaEnvia.guia': { $exists: true } }).toArray();
      const delCarrier = pedidos.filter(p => String(p.guiaEnvia.carrier || p.guiaEnvia.paqueteria || '').toLowerCase() === carrier && !p.recoleccion);
      if (!delCarrier.length) return res.status(400).json({ error: 'No hay paquetes con guía de esa paquetería esperando recolección.' });
      const { pedirRecoleccion } = await import('./envios.js');
      let r; try { r = await pedirRecoleccion(db, { bazarId, cfg, carrier, guias: delCarrier.map(p => p.guiaEnvia.guia), fecha, desde, hasta }); }
      catch (e) { return res.status(e.status || 502).json({ error: e.message }); }
      const rec = { numero: r.numero, carrier, fecha, desde, hasta, en: new Date().toISOString(), por: user.username };
      await db.collection('pedidos').updateMany({ id: { $in: delCarrier.map(p => p.id) } }, { $set: { recoleccion: rec } });
      await registrarEvento({ categoria: 'pedido', tipo: 'envio.recoleccion', usuario: user.username, bazarId, accion: `Recolección ${r.numero || ''} de ${carrier} para ${delCarrier.length} paquete(s) el ${fecha}` }, db);
      invalidarSyncCache();
      return res.status(200).json({ ok: true, numero: r.numero, paquetes: delCarrier.length });
    }

    // v42 · Rastreo automático a mano: pregunta ya a envia.com por las guías en camino
    case 'v-rastreo-revisar': {
      if (!esAdmin) return res.status(403).json({ error: 'Solo un administrador revisa el rastreo.' });
      if (!tokenEnvia(bazarId)) return res.status(400).json({ error: 'Falta ENVIA_TOKEN en Vercel.' });
      const { revisarRastreos } = await import('./rastreo.js');
      const hechos = await revisarRastreos(db, { id: bazarId }, { forzar: true });
      const error = hechos.find(h => h.tipo === 'error');
      if (error && hechos.length === 1) return res.status(502).json({ error: error.texto });
      return res.status(200).json({ ok: true, hechos: hechos.filter(h => h.tipo === 'rastreo').map(h => h.texto) });
    }

    // v42 · Reseñas con foto: publicar las fotos u ocultar la reseña completa
    case 'v-resena-moderar': {
      if (!esAdmin) return res.status(403).json({ error: 'Solo un administrador modera reseñas.' });
      const r = await db.collection('resenas').findOne({ id: Number(b.id), tipo: 'bazar' });
      if (!r || !mismoBazar(user, r.bazarId)) return res.status(404).json({ error: 'Reseña no encontrada' });
      const accion = ['aprobar', 'ocultar', 'mostrar', 'sinfotos'].includes(b.accion) ? b.accion : null;
      if (!accion) return res.status(400).json({ error: 'Acción no válida' });
      const set = accion === 'aprobar' ? { fotosOk: true } : accion === 'ocultar' ? { oculta: true } : accion === 'mostrar' ? { oculta: false } : { fotosOk: false, fotos: [] };
      await db.collection('resenas').updateOne({ id: r.id }, { $set: { ...set, moderadaPor: user.username, moderadaEn: new Date().toISOString() } });
      await db.collection('pendientes').updateMany({ resenaId: r.id }, { $set: { hecho: true } });
      invalidarSyncCache();
      return res.status(200).json({ ok: true, ...set });
    }

    // v42 · La dueña revisa el comprobante de transferencia
    case 'v-spei-revisar': {
      // Confirmar dinero recibido solo lo hace un administrador (un vendedor no puede dar por pagado nada)
      if (!esAdmin) return res.status(403).json({ error: 'Solo un administrador confirma transferencias.' });
      const p0 = await db.collection('pedidos').findOne({ id: String(b.id || '') });
      if (!p0 || !mismoBazar(user, p0.bazarId)) return res.status(404).json({ error: 'Pedido no encontrado' });
      return conBloqueo(db, res, `pedido:${p0.id}`, 30, async () => {
      const p = await db.collection('pedidos').findOne({ id: p0.id });
      if (p.proveedor !== 'spei') return res.status(400).json({ error: 'Ese pedido no es por transferencia.' });
      req._evento = { pedidoId: p.id, bazarId: p.bazarId, categoria: 'pago' };
      if (b.aprobar) {
        const r = await aprobarSpei(db, p, user.username);
        return res.status(r.status || 200).json(r.status ? { error: r.error } : { ok: true, estado: r.estado, whatsapp: r.whatsapp });
      }
      const motivo = texto(b.motivo, 160) || 'No encontramos la transferencia';
      if (p.estado !== 'pendiente') return res.status(409).json({ error: 'Ese pedido ya no está esperando pago.' });
      await db.collection('pedidos').updateOne({ id: p.id }, { $set: { estado: 'cancelado', canceladoDesde: 'pendiente', motivoCancelacion: motivo, canceladoPor: user.username } });
      await db.collection('inventario').updateMany({ 'reservedBy.pedido': p.id }, { $set: { apartada: false }, $unset: { reservedUntil: '', reservedBy: '' } });
      await db.collection('pendientes').updateMany({ tipo: 'spei', pedido: p.id }, { $set: { hecho: true } });
      await historialPedido(db, p, { de: 'pendiente', a: 'cancelado', accion: `Transferencia rechazada: ${motivo}`, por: user.username, tipo: 'spei.rechazada' });
      invalidarSyncCache();
      return res.status(200).json({ ok: true, estado: 'cancelado', whatsapp: linkWA(p.telefono, `Hola ${String(p.nombre || '').split(' ')[0]}, sobre tu pedido ${p.id}: ${motivo}. Si ya transferiste, mándanos tu comprobante por aquí y lo revisamos.`) });
      }, 'Alguien más está moviendo este pedido. Espera unos segundos.');
    }

    case 'v-envio-prueba': {
      // Prueba desde el panel: una playera (o lo que se indique) al CP que se escriba
      const cfg = await leerConfigTienda(db, bazarId);
      if (!tokenEnvia(bazarId)) return res.status(400).json({ error: 'Falta ENVIA_TOKEN en Vercel.' });
      if (!enviaListo(cfg, bazarId)) return res.status(400).json({ error: 'Guarda primero la dirección de salida (calle y código postal).' });
      const cp = String(b.cp || '').replace(/\D/g, '');
      if (cp.length !== 5) return res.status(400).json({ error: 'Escribe un código postal de 5 números.' });
      const prendas = [{ id: 0, nombre: texto(b.tipo, 40) || 'Playera' }];
      try {
        const r = await cotizarEnvio(db, { bazarId, cfg, prendas, cp, subtotal: Number(b.subtotal) || 300, valor: Number(b.subtotal) || 300 });
        const cot = await db.collection('enviosCotizaciones').findOne({ id: r.cotizacion });
        return res.status(200).json({ ...r, paquete: paqueteDe(prendas, 300), opciones: cot.opciones });
      } catch (e) { return res.status(e.status && e.status < 500 ? e.status : 502).json({ error: e.message }); }
    }

    case 'v-error-log': {
      // Errores que el panel reporta (para revisar qué falló sin pedir capturas)
      const col = db.collection('erroresCliente');
      if (req.method === 'GET') {
        if (!esAdmin) return res.status(403).json({ error: 'Solo el administrador ve el registro de errores.' });
        const lista = await col.find(esGlobal(user) && !req.query.bazarId ? {} : { bazarId }).sort({ en: -1 }).limit(100).toArray();
        return res.status(200).json({ errores: lista.map(({ _id, ...e }) => e) });
      }
      const ahora = new Date(), desde = new Date(ahora - 10 * 60 * 1000).toISOString();
      const recientes = await col.countDocuments({ usuario: user.username, en: { $gte: desde } });
      const lista = (Array.isArray(b.errores) ? b.errores : []).slice(0, Math.max(0, 40 - recientes));
      for (const e of lista) {
        await col.insertOne({ en: ahora.toISOString(), cuando: texto(e?.en, 40), usuario: user.username, bazarId,
          origen: texto(e?.origen, 40), mensaje: texto(e?.mensaje, 400), pagina: texto(e?.pagina, 200),
          pila: texto(e?.pila, 900), archivo: texto(e?.archivo, 120), estado: Number(e?.estado) || null, ruta: texto(e?.ruta, 60) });
      }
      if (lista.length && Math.random() < 0.05) await col.deleteMany({ en: { $lt: new Date(ahora - 30 * 864e5).toISOString() } }).catch(() => {});
      return res.status(200).json({ ok: true, guardados: lista.length });
    }

    case 'v-prefs': {
      // Favoritos, orden y secciones ocultas del menú del panel (por usuario)
      if (req.method === 'POST') {
        const limpia = {};
        const ids = l => (Array.isArray(l) ? l : []).map(x => String(x).replace(/[^a-z0-9_-]/gi, '').slice(0, 40)).filter(Boolean).slice(0, 80);
        for (const [zona, v] of Object.entries(b.prefs || {}).slice(0, 8)) {
          if (!/^[a-z]{1,20}$/.test(zona) || !v || typeof v !== 'object') continue;
          limpia[zona] = { fav: ids(v.fav), orden: ids(v.orden), ocultos: ids(v.ocultos) };
        }
        await db.collection('usuarios').updateOne({ id: user.id }, { $set: { panelPrefs: limpia } });
        return res.status(200).json({ ok: true, prefs: limpia });
      }
      const u = await db.collection('usuarios').findOne({ id: user.id });
      return res.status(200).json({ prefs: u?.panelPrefs || null });
    }

    case 'v-config': {
      if (!esAdmin) return res.status(403).json({ error: 'Solo un administrador cambia las promociones.' });
      const actual = await leerConfigTienda(db, bazarId);
      // Los usos de los cupones no se pisan desde el panel
      const nueva = normalizarConfig({ ...actual, ...b }, bazarId);
      nueva.cupones.forEach(c => { const v = actual.cupones.find(x => x.codigo === c.codigo); if (v) c.usos = v.usos; });
      await db.collection('tiendaConfig').updateOne({ bazarId }, { $set: { bazarId, ...nueva } }, { upsert: true });
      invalidarSyncCache();
      // v33: qué se cambió (sin valores sensibles) y cada cupón creado, cambiado o quitado
      const cambiadas = Object.keys(nueva).filter(k => JSON.stringify(nueva[k]) !== JSON.stringify(actual[k]));
      req._evento = { bazarId, detalle: { cambios: cambiadas.slice(0, 20) } };
      const desc = c => `${c.tipo === 'monto' ? pesos(c.valor) : c.valor + ' %'}${c.minimo ? ` desde ${pesos(c.minimo)}` : ''}${c.maxUsos ? `, máx. ${c.maxUsos} usos` : ''}${c.vence ? `, vence ${c.vence}` : ''}${c.activo ? '' : ' (apagado)'}`;
      for (const c of nueva.cupones) {
        const v = actual.cupones.find(x => x.codigo === c.codigo);
        const cambio = !v ? 'Creó' : JSON.stringify({ ...v, usos: 0 }) !== JSON.stringify({ ...c, usos: 0 }) ? 'Cambió' : null;
        if (cambio) await registrarEvento({ categoria: 'cupon', tipo: `cupon.${cambio === 'Creó' ? 'creado' : 'cambiado'}`, usuario: user.username, rol: user.role, bazarId,
          accion: `${cambio} el cupón ${c.codigo}: ${desc(c)}`, detalle: { codigo: c.codigo, tipo: c.tipo, valor: c.valor, activo: c.activo } }, db);
      }
      for (const v of actual.cupones.filter(x => !nueva.cupones.some(c => c.codigo === x.codigo)))
        await registrarEvento({ categoria: 'cupon', tipo: 'cupon.quitado', usuario: user.username, rol: user.role, bazarId, accion: `Quitó el cupón ${v.codigo} (llevaba ${v.usos || 0} usos)`, detalle: { codigo: v.codigo } }, db);
      return res.status(200).json({ ok: true, config: nueva });
    }

    case 'v-oferta-responder': {
      const of = await db.collection('ofertas').findOne({ id: Number(b.id) });
      if (!of || !mismoBazar(user, of.bazarId)) return res.status(404).json({ error: 'Oferta no encontrada' });
      const p = await inv.findOne({ id: of.prendaId });
      const cfg = await leerConfigTienda(db, of.bazarId);
      const fpTxt = textoFormasPago(cfg.formasPago);   // v56: la misma línea que la tienda e Instagram, más la nota si hay
      const pago = fpTxt || cfg.info.pagos ? `\n${[fpTxt ? fpTxt + '.' : '', cfg.info.pagos ? `Pagos: ${cfg.info.pagos}` : ''].filter(Boolean).join(' ')}` : '';
      const link = `${SITIO()}/prenda.html?id=${of.prendaId}`;
      let mensaje, estado, extra = {};
      if (b.accion === 'aceptar') {
        if (!p || p.vendido) return res.status(400).json({ error: 'La prenda ya se vendió.' });
        // No pisar un apartado de otra persona (anticipo pagado o alguien pagando en este momento)
        if (!libre(p) && !(p.reservedBy?.canal === 'oferta' && tel(p.reservedBy?.telefono) === tel(of.telefono)))
          return res.status(409).json({ error: `La prenda está apartada${p.reservedBy?.nombre ? ` para ${p.reservedBy.nombre}` : ''}. Libérala primero si quieres aceptar esta oferta.` });
        const horas = 24, hasta = new Date(Date.now() + horas * HORA).toISOString();
        await inv.updateOne({ id: p.id }, { $set: { apartada: true, reservedUntil: hasta,
          reservedBy: { nombre: of.nombre, telefono: of.telefono, canal: 'oferta', precio: of.monto, por: user.username, en: new Date().toISOString() } } });
        mensaje = `¡Hola ${of.nombre}! 🙌 Aceptamos tu oferta de ${pesos(of.monto)} por "${of.prendaNombre}". Te la apartamos 24 horas.${pago}\n${link}`;
        estado = 'aceptada'; invalidarSyncCache();
      } else if (b.accion === 'contra') {
        const monto = Math.round(Number(b.monto) || 0);
        if (!(monto > of.monto)) return res.status(400).json({ error: 'La contraoferta debe ser mayor a lo que ofrecieron.' });
        mensaje = `¡Hola ${of.nombre}! Gracias por tu oferta por "${of.prendaNombre}". Te la puedo dejar en ${pesos(monto)} 🤝 ¿Te late?\n${link}`;
        estado = 'contraoferta'; extra = { contra: monto };
      } else {
        mensaje = `¡Hola ${of.nombre}! Gracias por tu oferta por "${of.prendaNombre}" 🙏 Por ahora no la podemos dejar en ${pesos(of.monto)}, pero checa lo nuevo en ${SITIO().replace(/^https?:\/\//, '')} 🛍️`;
        estado = 'rechazada';
      }
      await db.collection('ofertas').updateOne({ id: of.id }, { $set: { estado, respondida: new Date().toISOString(), por: user.username, ...extra } });
      return res.status(200).json({ ok: true, estado, whatsapp: linkWA(of.telefono, mensaje) });
    }

    case 'v-pendiente-hecho': {
      // deshacer: true lo regresa a la lista (botón "Deshacer" del aviso)
      const donde = { id: String(b.id), ...(esGlobal(user) ? {} : { bazarId }) };
      const cambio = b.deshacer ? { $set: { hecho: false }, $unset: { hechoPor: '', hechoEn: '' } }
        : { $set: { hecho: true, hechoPor: user.username, hechoEn: new Date().toISOString() } };
      const r = await db.collection('pendientes').updateOne(donde, cambio);
      if (!r.matchedCount) return res.status(404).json({ error: 'Ese aviso ya no existe.' });
      return res.status(200).json({ ok: true });
    }

    case 'v-espera-borrar': {
      // Cada bazar borra solo a SUS interesados (antes cualquier sesión podía borrar los de otro bazar)
      const r = await db.collection('listaEspera').deleteOne({ id: String(b.id), ...(esGlobal(user) ? {} : { bazarId }) });
      if (!r.deletedCount) return res.status(404).json({ error: 'Ese interesado ya no está en la lista.' });
      return res.status(200).json({ ok: true });
    }

    case 'v-corte': return corte(req, res, db, user, bazarId);
    case 'v-metricas': return metricas(req, res, db, user, bazarId);
    case 'v-respaldo': return respaldo(req, res, db, user, bazarId);
    case 'v-respaldos': {
      // Los respaldos traen costos y teléfonos de clientes: solo administradores
      if (!esAdmin) return res.status(403).json({ error: 'Solo un administrador descarga respaldos.' });
      const lista = await db.collection('respaldos').find({ bazarId }).sort({ en: -1 }).limit(10).toArray();
      if (req.query.id) {
        const r = lista.find(x => String(x.id) === String(req.query.id));
        if (!r) return res.status(404).json({ error: 'No existe' });
        res.setHeader('Content-Disposition', `attachment; filename="respaldo-${r.en.slice(0, 10)}.json"`);
        return res.status(200).json({ en: r.en, inventario: r.inventario, ventas: r.ventas });
      }
      return res.status(200).json({ respaldos: lista.map(r => ({ id: r.id, en: r.en, prendas: r.inventario?.length || 0, ventas: r.ventas?.length || 0 })) });
    }

    case 'v-permisos-usuario': {
      if (!esAdmin) return res.status(403).json({ error: 'Solo un administrador cambia permisos.' });
      const u = await db.collection('usuarios').findOne({ id: Number(b.id) });
      if (!u || u.role !== 'vendedor') return res.status(400).json({ error: 'Solo se ajustan permisos de vendedores.' });
      if (!esGlobal(user) && Number(u.bazarId) !== Number(user.bazarId)) return res.status(403).json({ error: 'Ese vendedor es de otro bazar.' });
      const permisos = { borrar: b.permisos?.borrar !== false, precios: b.permisos?.precios !== false };
      await db.collection('usuarios').updateOne({ id: u.id }, { $set: { permisos } });
      invalidarSyncCache();
      return res.status(200).json({ ok: true, permisos });
    }
  }
  return res.status(400).json({ error: 'op no reconocida' });
}

// v33: el mismo cliente pidiendo el mismo pago dos veces (doble toque, red lenta) → una sola operación
async function pagar(req, res, db) {
  if (req.method !== 'POST') return res.status(405).end();
  const b = req.body || {};
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean))].sort((x, y) => x - y).slice(0, 20);
  const t = tel(b.telefono);
  if (!ids.length || t.length < 10) return pagarSinCandado(req, res, db);
  return conBloqueo(db, res, `pagar:${t}:${ids.join(',')}`, 25, () => pagarSinCandado(req, res, db),
    'Ya estamos abriendo tu pago. Espera unos segundos; si no se abre, vuelve a intentarlo.');
}

async function pagarSinCandado(req, res, db) {
  if (!(await rateLimit(req, res, { key: 'v-pagar', max: 30, windowSec: 3600 }))) return;
  const b = req.body || {};
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean))].slice(0, 20);
  const nombre = texto(b.nombre, 60), telefono = tel(b.telefono), email = texto(b.email, 120);
  if (!ids.length) return res.status(400).json({ error: 'No hay prendas en tu carrito.' });
  if (!nombre || telefono.length < 10) return res.status(400).json({ error: 'Escribe tu nombre y tu WhatsApp a 10 dígitos.' });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Revisa tu correo.' });
  const quiereEnvio = b.entrega === 'envio' || (b.entrega == null && !!b.envio);
  let direccion = null;
  if (quiereEnvio) {
    const d = b.direccion || {};
    direccion = { calle: texto(d.calle, 120), colonia: texto(d.colonia, 80), cp: String(d.cp || '').replace(/\D/g, '').slice(0, 5),
      ciudad: texto(d.ciudad, 60), estado: texto(d.estado, 40), referencias: texto(d.referencias, 200) };
    if (direccion.calle.length < 4 || !direccion.colonia || direccion.cp.length !== 5 || !direccion.ciudad || !direccion.estado)
      return res.status(400).json({ error: 'Completa tu dirección de envío (calle y número, colonia, código postal, ciudad y estado).' });
  }
  const prendas = (await db.collection('inventario').find({ id: { $in: ids } }).toArray()).filter(await filtroTienda(db));
  if (prendas.length !== ids.length) return res.status(400).json({ error: 'Alguna prenda ya no existe. Actualiza la página.' });
  const bazarId = Number(prendas[0].bazarId || 1);
  if (prendas.some(p => Number(p.bazarId || 1) !== bazarId)) return res.status(400).json({ error: 'Paga las prendas de cada bazar por separado.' });
  const propio = await pedidoPropio(db, b.previo);
  const ocupada = prendas.find(p => !librePara(propio)(p));
  if (ocupada) return res.status(409).json({ error: `"${ocupada.nombre}" ya no está disponible.` });
  const cfg = await leerConfigTienda(db, bazarId);
  const metodos = metodosPago(cfg, bazarId);
  if (!cfg.pagoEnLinea || !metodos.length) return res.status(400).json({ error: 'Este bazar todavía no recibe pagos en línea.' });
  const proveedor = metodos.includes(b.metodo) ? b.metodo : metodos[0];

  // v40 · Antiacaparamiento: cada pago abierto aparta las prendas 10 minutos. Sin este
  // tope, un robot podría abrir pagos sin pagar y dejar la tienda "apartada" todo el día.
  // Máximo 3 pagos abiertos a la vez por WhatsApp y por conexión (el reintento del mismo
  // cliente no cuenta: reemplaza al anterior).
  const ipHash = huellaIp(req);
  const abiertos = await db.collection('pedidos').countDocuments({ estado: 'pendiente', expira: { $gt: new Date().toISOString() },
    ...(propio ? { id: { $ne: propio.id } } : {}), $or: [{ telefono }, ...(ipHash ? [{ ipHash }] : [])] });
  if (abiertos >= MAX_PAGOS_ABIERTOS) {
    await registrarEvento({ categoria: 'pedido', tipo: 'pedido.acaparar', resultado: 'rechazado', usuario: 'cliente', bazarId,
      accion: `Se frenó a alguien con ${abiertos} pagos abiertos sin terminar`, unaVezCada: { clave: `acaparar:${ipHash || telefono}`, ms: 600e3 } }, db);
    return res.status(429).json({ error: `Ya tienes ${abiertos} pagos abiertos sin terminar. Termina uno o espera ${cfg.minutosPago || MINUTOS_PAGO} minutos para intentar de nuevo.` });
  }

  const precios = prendas.map(p => Number(p.precio_venta) || 0);
  let cupon = null;
  if (b.cupon) { const r = await cuponDe(db, cfg, bazarId, b.cupon, precios.reduce((t, x) => t + x, 0), telefono); if (r.error) return res.status(400).json({ error: r.error }); cupon = r.cupon; }
  const { aplicarOutfit } = await import('./extras.js');
  const cuenta = aplicarFrecuente(aplicarOutfit(calcularTotal(cfg, precios, cupon), prendas, cfg, modulo(cfg, 'outfit')), cupon ? null : await frecuenteDe(db, cfg, bazarId, telefono));
  // Envío: lo que cotizó envia.com para esta dirección y estas prendas, o el costo fijo del bazar
  let envio = 0, envioDetalle = null;
  if (quiereEnvio) {
    if (enviaListo(cfg, bazarId)) {
      const op = await opcionCotizada(db, { cotizacion: b.envioCotizacion, opcion: b.envioOpcion, bazarId, cp: direccion.cp, ids });
      if (!op) return res.status(400).json({ error: 'Vuelve a elegir la paquetería: la cotización venció o cambió tu pedido.', recotizar: true });
      envio = op.precio;
      envioDetalle = { paqueteria: op.paqueteria, carrier: op.carrier, servicio: op.servicio, dias: op.dias, costo: op.costo, cobrado: op.precio, gratis: !!op.gratis, cotizacion: String(b.envioCotizacion) };
    } else if (cfg.envioCosto > 0) envio = cfg.envioCosto;
    else return res.status(400).json({ error: 'Este bazar no tiene envío a domicilio en línea; elige entrega en persona.' });
  }
  // Entrega en persona: el punto que eligió (Zona Morelos, UTTN, Plaza Real…) y su costo
  let punto = null;
  if (!quiereEnvio && puntosActivos(cfg).length) {
    const p = puntosActivos(cfg).find(x => x.id === String(b.punto || ''));
    if (!p) return res.status(400).json({ error: 'Elige dónde te entregamos tu pedido.' });
    punto = { id: p.id, nombre: p.nombre, costo: costoPunto(cfg, p, cuenta.total) };
    envio = punto.costo;
  }
  const total = cuenta.total + envio;
  // Apartar con anticipo: hoy se cobra una parte y el resto antes de la fecha límite
  const apartar = b.modo === 'apartado';
  if (apartar && !apartadoActivo(cfg, total)) return res.status(400).json({ error: cfg.apartado?.minimo && total < cfg.apartado.minimo
    ? `Para apartar, la compra debe ser de al menos ${pesos(cfg.apartado.minimo)}.` : 'Por ahora no estamos apartando en línea; paga el total.' });
  const anticipo = apartar ? montoAnticipo(cfg, total) : total;
  // Clip y PayPal no cobran $0 (pasa con un cupón del 100 %): se atiende por WhatsApp
  if (!(anticipo >= 1)) return res.status(400).json({ error: 'Con tu cupón este pedido queda en $0. Escríbenos por WhatsApp y te lo apartamos sin pagar en línea.' });

  // Reparte el descuento entre las prendas (para que el recibo muestre el detalle)
  const factor = cuenta.subtotal ? cuenta.total / cuenta.subtotal : 1;
  let resto = cuenta.total;
  const items = prendas.map((p, i) => {
    const precio = i === prendas.length - 1 ? resto : Math.round(precios[i] * factor);
    resto -= precio;
    return { id: String(p.id), title: texto(p.nombre, 120), quantity: 1, currency_id: 'MXN', unit_price: precio,
      picture_url: (p.imagenes || [])[0] || undefined, description: texto(`${p.talla || ''} ${p.estado || ''}`, 200) };
  });
  if (envio) items.push({ id: 'envio', title: punto ? `Entrega en ${punto.nombre}` : 'Envío', quantity: 1, currency_id: 'MXN', unit_price: envio });

  const id = 'P' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
  // v36: mientras paga, la prenda queda apartada MINUTOS_PAGO (10 min). La tienda
  // muestra el contador (ver prendaPublica en _bazar.js) y el link de Clip vence igual.
  // v42: con transferencia el apartado dura las horas configuradas (el banco tarda más que una tarjeta)
  let expira = new Date(Date.now() + (proveedor === 'spei' ? cfg.spei.horas * 3600e3 : (cfg.minutosPago || MINUTOS_PAGO) * 60 * 1000)).toISOString();

  // Apartado atómico ANTES de abrir el pago. Antes se revisaba "¿está libre?" y se
  // apartaba hasta después de crear el link: si dos personas pagaban la misma prenda
  // al mismo tiempo, las dos recibían link y a una había que devolverle el dinero.
  // Ahora cada prenda se aparta con una sola operación que solo funciona si sigue libre.
  const invCol = db.collection('inventario');
  const ahoraIso = new Date().toISOString();
  const libreEnMongo = pid => ({ id: pid, vendido: { $ne: true }, oculto: { $ne: true }, $or: [
    { apartada: { $ne: true } },
    { 'reservedBy.anticipo': { $in: [null, 0] }, reservedUntil: { $not: { $gt: ahoraIso } } },
    ...(propio ? [{ 'reservedBy.pedido': propio.id }] : []),
  ] });
  const reserva = { apartada: true, reservedUntil: expira,
    reservedBy: { nombre, telefono, canal: proveedor, pedido: id, en: ahoraIso } };
  const tomadas = [];   // [{ id, antes }] para regresarlas como estaban si algo falla
  const soltar = async () => {
    for (const t of tomadas) {
      const antes = t.antes || {};
      const set = { apartada: !!antes.apartada };
      const unset = {};
      if (antes.reservedUntil != null) set.reservedUntil = antes.reservedUntil; else unset.reservedUntil = '';
      if (antes.reservedBy != null) set.reservedBy = antes.reservedBy; else unset.reservedBy = '';
      await invCol.updateOne({ id: t.id, 'reservedBy.pedido': id },
        { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) }).catch(() => {});
    }
  };
  for (const pid of ids) {
    const antes = await invCol.findOneAndUpdate(libreEnMongo(pid), { $set: reserva },
      { returnDocument: 'before', projection: { apartada: 1, reservedUntil: 1, reservedBy: 1, nombre: 1 } });
    const doc = antes && antes.lastErrorObject ? antes.value : antes;   // driver v6 da el doc; versiones viejas, { value }
    if (!doc) {
      await soltar();
      const p = prendas.find(x => x.id === pid);
      await registrarEvento({ categoria: 'pedido', tipo: 'pedido.conflicto', resultado: 'rechazado', usuario: 'cliente', bazarId, prendaId: pid,
        accion: `Dos clientes quisieron pagar "${p?.nombre || pid}" al mismo tiempo: se le avisó al segundo`, detalle: { prendas: ids.length } }, db);
      return res.status(409).json({ error: `"${p?.nombre || 'Una prenda'}" la acaba de apartar alguien más. Actualiza tu carrito.` });
    }
    tomadas.push({ id: pid, antes: doc });
  }
  // Clave privada del pedido: solo quien tiene el link ve sus datos (dirección, teléfono)
  const clave = crypto.randomBytes(9).toString('base64url');
  const pedido = { id, bazarId, ids, items: items.map(x => { const p = prendas.find(y => String(y.id) === String(x.id)); return { id: x.id, nombre: x.title, precio: x.unit_price, lista: p ? Number(p.precio_venta) || 0 : x.unit_price, talla: p?.talla || '', imagen: x.picture_url || '' }; }), subtotal: cuenta.subtotal,
    descVolumen: cuenta.descVolumen, descCupon: cuenta.descCupon, cupon: cupon?.codigo || null, envio, total,
    ...(cuenta.descFrecuente ? { descFrecuente: cuenta.descFrecuente } : {}), ...(cuenta.descOutfit ? { descOutfit: cuenta.descOutfit } : {}),
    origen: modulo(cfg, 'origenVentas') ? origenDe(b.origen) : { fuente: 'directo' },
    entrega: quiereEnvio ? 'envio' : 'persona', direccion, envioDetalle, punto,
    nombre, telefono, email, estado: 'pendiente', en: new Date().toISOString(), expira, proveedor, clave, ...(ipHash ? { ipHash } : {}),
    ...(apartar ? { modalidad: 'apartado', anticipo, resta: total - anticipo, pctAnticipo: cfg.apartado.pct, diasApartado: cfg.apartado.dias } : { modalidad: 'completo' }) };

  let url;
  try {
    const nP = `${prendas.length} prenda${prendas.length === 1 ? '' : 's'}`;
    const descripcion = apartar ? `Stiimpys · anticipo para apartar ${nP} · pedido ${pedido.id}` : `Stiimpys · ${nP} · pedido ${pedido.id}`;
    if (proveedor === 'spei') {
      // v42: no hay link externo: el recibo muestra la cuenta y pide el comprobante
      pedido.spei = { banco: cfg.spei.banco, clabe: cfg.spei.clabe, titular: cfg.spei.titular, monto: anticipo, referencia: pedido.id };
      // Dirección relativa: así también funciona en las vistas previas de Vercel (no salta al dominio de producción)
      url = `/pagar.html?pedido=${encodeURIComponent(pedido.id)}&k=${encodeURIComponent(pedido.clave || '')}`;
    } else if (proveedor === 'clip') {
      const link = await crearLinkClip(bazarId, pedido, prendas.length, { monto: anticipo, descripcion });
      pedido.clipId = link.id; pedido.clipIds = [link.id]; url = link.url;
      if (link.vence) expira = pedido.expira = link.vence;
    } else {
      const orden = await crearOrdenPaypal(bazarId, { ...pedido, total: anticipo }, {
        regreso: urlPedido(pedido), cancelar: `${urlPedido(pedido)}&fallo=1`, descripcion,
      });
      pedido.paypalId = orden.id; url = orden.url;
    }
  } catch (e) {
    console.error('[v-pagar]', e);
    await soltar();
    await registrarEvento({ categoria: 'pago', tipo: `${proveedor}.link`, resultado: 'error', usuario: 'cliente', bazarId,
      accion: `No se pudo abrir el pago con ${nombreMetodo(proveedor)} (${pesos(anticipo)})`, error: e,
      detalle: { prendas: ids.length, modalidad: pedido.modalidad, monto: anticipo } }, db);
    // v41 · Aviso a la dueña (celular/correo, máximo cada 3 h): un cliente quiso pagar y no pudo
    try { const { avisarDuena } = await import('./alertas.js');
      await avisarDuena(db, { clave: `pago:${proveedor}`, titulo: `Un cliente no pudo pagar con ${nombreMetodo(proveedor)}`,
        texto: `Quiso pagar ${pesos(anticipo)} y ${nombreMetodo(proveedor)} no abrió el pago: ${String(e?.message || '').slice(0, 160)}` }); } catch (_) {}
    return res.status(502).json({ error: `No se pudo abrir el pago con ${nombreMetodo(proveedor)}. Intenta de nuevo en un momento o apártala por WhatsApp.` });
  }
  // Ya se abrió el pago: el intento anterior queda reemplazado por este (las prendas que ya no lleve se sueltan)
  if (propio) {
    const rr = await db.collection('pedidos').updateOne({ id: propio.id, estado: 'pendiente' }, { $set: { estado: 'reemplazado' } });
    if (rr.modifiedCount) await historialPedido(db, propio, { de: 'pendiente', a: 'reemplazado', accion: `El cliente volvió a intentar el pago (nuevo pedido ${id})`, por: 'cliente', detalle: { nuevo: id } });
    const sueltas = (propio.ids || []).filter(x => !ids.includes(Number(x)));
    if (sueltas.length) await invCol.updateMany({ id: { $in: sueltas.map(Number) }, 'reservedBy.pedido': propio.id }, { $set: { apartada: false }, $unset: { reservedUntil: '', reservedBy: '' } });
  }
  await db.collection('pedidos').insertOne(pedido);
  // Ya estaban apartadas a nombre de este pedido; aquí solo se ajusta cuánto dura
  // (MINUTOS_PAGO, o lo que dure el link de Clip si es menos)
  await invCol.updateMany({ id: { $in: ids }, 'reservedBy.pedido': id }, { $set: { reservedUntil: expira } });
  invalidarSyncCache();
  await historialPedido(db, pedido, { a: 'pendiente', accion: `Pedido creado: ${apartar ? `apartar con ${pesos(anticipo)} de ${pesos(total)}` : `pagar ${pesos(total)}`} con ${nombreMetodo(proveedor)}`, por: 'cliente',
    tipo: 'pedido.creado', detalle: { modalidad: pedido.modalidad, total, cobrar: anticipo, proveedor, prendas: ids.length, entrega: pedido.entrega, cupon: pedido.cupon } });
  if (cupon) await registrarEvento({ categoria: 'cupon', tipo: 'cupon.aplicado', resultado: 'info', usuario: 'cliente', bazarId, pedidoId: id,
    accion: `Cupón ${cupon.codigo} aplicado (−${pesos(cuenta.descCupon)})`, detalle: { codigo: cupon.codigo, descuento: cuenta.descCupon } }, db);
  return res.status(200).json({ ok: true, pedido: id, clave, url, total, cobrar: anticipo, modalidad: pedido.modalidad, proveedor });
}
const urlPedido = p => `${SITIO()}/pagar.html?pedido=${encodeURIComponent(p.id)}&k=${encodeURIComponent(p.clave || '')}`;

// ═════════════════════════════════════════════════════════════
//  Clip (Checkout Redireccionado) — api.payclip.com
//  POST /v2/checkout crea el link; GET /v2/checkout/{id} da el estado.
//  Nunca se confía en el aviso (webhook): siempre se consulta a Clip.
// ═════════════════════════════════════════════════════════════
async function clip(bazarId, ruta, opciones = {}) {
  const r = await fetch(`https://api.payclip.com${ruta}`, {
    ...opciones,
    headers: { Authorization: authClip(bazarId), 'Content-Type': 'application/json', Accept: 'application/json', ...(opciones.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const codigo = String(j.error_code || j.code || j.code_message || '');
    const msg = codigo === '004' ? 'la cuenta Clip llegó a su límite de cobro' : (j.detail || j.message || j.error_message || j.error || 'HTTP ' + r.status);
    const err = new Error(`Clip: ${msg}`); err.status = r.status; throw err;
  }
  return j;
}

// Clip pide que el link venza el mismo día de creación (antes de 23:59:59).
// La documentación lo dice en hora de CDMX y en UTC según la página, así que se
// cumplen las dos. El link vence junto con el apartado (MINUTOS_PAGO). Si quedan
// menos de 3 min del día, el link usa la vigencia normal de Clip y el apartado se
// cuida aparte (ver confirmarPedido).
export function vigenciaClip(ahora = Date.now(), minutos = MINUTOS_PAGO) {
  const u = new Date(ahora);
  const finUTC = Date.UTC(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), 23, 58, 0);
  const c = new Date(ahora - 6 * HORA);   // CDMX = UTC-6 todo el año
  const finCDMX = Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate(), 23, 58, 0) + 6 * HORA;
  const limite = Math.min(ahora + minutos * 60 * 1000, finUTC, finCDMX);
  if (limite - ahora < 3 * 60 * 1000) return null;
  const t = new Date(Math.floor(limite / 1000) * 1000);
  return { texto: t.toISOString().replace(/\.\d{3}Z$/, 'Z'), iso: t.toISOString() };
}

async function crearLinkClip(bazarId, pedido, nPrendas, extra = {}) {
  const regreso = extra.regreso || urlPedido(pedido);
  const cuerpo = {
    amount: Math.round((extra.monto ?? pedido.total) * 100) / 100,
    currency: 'MXN',
    purchase_description: texto(extra.descripcion || `Stiimpys · ${nPrendas} prenda${nPrendas === 1 ? '' : 's'} · pedido ${pedido.id}`, 100),
    redirection_url: { success: regreso, error: `${regreso}&fallo=1`, default: regreso },
    metadata: { me_reference_id: extra.referencia || pedido.id, customer_info: { name: pedido.nombre, phone: pedido.telefono, ...(pedido.email ? { email: pedido.email } : {}) } },
    webhook_url: `${SITIO()}/api/acciones?op=v-clip-webhook`,
  };
  // v41: el link vence cuando vence el apartado de este pedido (minutos configurables)
  // (el pago del resto de un apartado no aparta nada nuevo: usa los minutos normales)
  const quedan = pedido.estado === 'pendiente' && pedido.expira ? (new Date(pedido.expira).getTime() - Date.now()) / 60000 : 0;
  const minutosApartado = quedan >= 1 ? quedan : MINUTOS_PAGO;
  const vig = vigenciaClip(Date.now(), minutosApartado);
  if (vig) cuerpo.expires_at = vig.texto;
  let r;
  try { r = await clip(bazarId, '/v2/checkout', { method: 'POST', body: JSON.stringify(cuerpo) }); }
  catch (e) {
    // Si Clip no acepta la hora de vencimiento, se reintenta con su vigencia normal
    if (!cuerpo.expires_at || e.status !== 400) throw e;
    delete cuerpo.expires_at;
    r = await clip(bazarId, '/v2/checkout', { method: 'POST', body: JSON.stringify(cuerpo) });
  }
  if (!r.payment_request_url || !r.payment_request_id) throw new Error('Clip no regresó el link de pago');
  return { id: String(r.payment_request_id), url: r.payment_request_url, vence: cuerpo.expires_at ? vig.iso : null };
}

async function webhookClip(req, res, db) {
  const b = req.body || {};
  const t0 = Date.now();
  let pedido = null, estadoAntes = null, estadoDespues = null, error = null;
  try {
    const prId = String(b.payment_request_id || '').slice(0, 64);
    pedido = prId ? (await db.collection('pedidos').findOne({ clipId: prId }) || await db.collection('pedidos').findOne({ clipIds: prId })) : null;
    if (!pedido && b.me_reference_id) pedido = await db.collection('pedidos').findOne({ id: String(b.me_reference_id).slice(0, 40).replace(/-R\d+$/, '') });
    if (pedido) { estadoAntes = pedido.estado; estadoDespues = await revisarPagoDePedido(db, pedido); }
  } catch (e) { console.error('[clip-webhook]', e); error = e; }
  // v33: cada aviso de Clip queda registrado (el aviso solo "despierta" la revisión; el
  // estado real siempre se le pregunta a Clip, nunca se cree lo que diga el aviso)
  await marcarSistema('webhookClip', db, 0);
  await registrarEvento({ categoria: 'pago', tipo: 'clip.webhook', usuario: 'clip', bazarId: pedido?.bazarId, pedidoId: pedido?.id,
    resultado: error ? 'error' : pedido ? 'info' : 'rechazado', error,
    accion: !pedido ? 'Aviso de Clip sin pedido conocido' : `Aviso de Clip: se revisó el pedido (${estadoAntes} → ${estadoDespues || estadoAntes})`,
    detalle: { estadoClip: String(b.status || b.payment_status || '').slice(0, 40) || null }, ms: Date.now() - t0 }, db);
  return res.status(200).json({ ok: true });
}

// Pago que llegó a un pedido ya cancelado: un solo aviso urgente para devolverlo
async function pagoTrasCancelar(db, pedido, r, monto) {
  const u = await db.collection('pedidos').updateOne({ id: pedido.id, pagoTrasCancelar: { $ne: true } },
    { $set: { pagoTrasCancelar: true, pagoTrasCancelarEn: new Date().toISOString(), pagoTrasCancelarId: String(r.id || '') } });
  if (!u.modifiedCount) return;
  await historialPedido(db, pedido, { accion: `Llegó un pago de ${pesos(monto)} después de cancelar el pedido: hay que devolverlo`, por: pedido.proveedor || 'clip',
    categoria: 'pago', tipo: 'pago.tras-cancelar', resultado: 'error', detalle: { monto, pagoId: String(r.id || '') } });
  await pendiente(db, pedido.bazarId, 'venta', `⚠️ ${pedido.nombre} pagó ${pesos(monto)} del pedido ${pedido.id}, que ya estaba cancelado. Devuélvele el dinero desde ${nombreMetodo(pedido.proveedor)}.`, {
    whatsapp: linkWA(pedido.telefono, `¡Hola ${String(pedido.nombre || '').split(' ')[0]}! Recibimos tu pago de ${pesos(monto)} del pedido ${pedido.id}, pero ese pedido ya se había cancelado. Te devolvemos el dinero; si todavía quieres las prendas, dinos y vemos si siguen disponibles 🙏`),
    pedido: pedido.id, titulo: 'Devolver dinero', urgente: true, cliente: pedido.nombre, monto, metodo: nombreMetodo(pedido.proveedor),
    detalle: 'El pago llegó después de cancelar el pedido. No se vendió nada: devuelve el dinero.' });
}

async function confirmarPedido(db, pedido, pago) {
  // Solo una vez (si llegan el webhook y la página de regreso a la vez)
  // También si el apartado ya había vencido: el pago llegó tarde pero sí llegó.
  // pago.tipo === 'resto': liquida un apartado con anticipo (en línea o en persona)
  const resto = pago.tipo === 'resto', enPersona = pago.payment_type_id === 'persona';
  const canal = resto ? (enPersona ? 'apartado' : pago.payment_type_id) : (pedido.proveedor || 'clip');
  const ahoraIso = new Date().toISOString();
  const extra = resto ? { liquidadoEn: ahoraIso, liquidadoCon: pago.payment_type_id, ...(pago.por ? { liquidadoPor: pago.por } : {}),
    pagos: [...(pedido.pagos || []), { tipo: 'resto', monto: pedido.resta, proveedor: pago.payment_type_id, en: ahoraIso }] } : {};
  const r = await db.collection('pedidos').updateOne({ id: pedido.id, estado: { $in: resto ? ['apartado'] : ['pendiente', 'expirado'] } },
    { $set: { estado: 'pagado', pagadoEn: ahoraIso, pagoId: String(pago.id || ''), metodo: pago.payment_type_id || '', ...extra } });
  if (!r.modifiedCount) return false;
  // v33: historial y registro (solo cuando de verdad cambió: el webhook y la página de regreso pueden llegar juntos)
  await marcarSistema('ultimoPago', db, 0);
  await historialPedido(db, pedido, { de: pedido.estado, a: 'pagado', por: pago.por || nombreMetodo(pago.payment_type_id || canal),
    accion: resto ? (enPersona ? `Apartado liquidado en persona (${pesos(pedido.resta)})` : `Apartado liquidado en línea con ${nombreMetodo(canal)} (${pesos(pedido.resta)})`)
      : `Pago confirmado por ${nombreMetodo(canal)} (${pesos(pedido.total)})`,
    categoria: resto ? 'apartado' : 'pago', tipo: resto ? 'apartado.liquidado' : 'pago.confirmado',
    detalle: { monto: resto ? pedido.resta : pedido.total, metodo: pago.payment_type_id || canal, pagoId: String(pago.id || '').slice(0, 40) } });
  const inv = db.collection('inventario'), ventas = db.collection('ventas');
  const fecha = new Date();
  const yaVendidas = [], apartadasParaOtro = [];
  for (const it of pedido.items.filter(x => x.id !== 'envio')) {
    const p = await inv.findOne({ id: Number(it.id) }); if (!p) continue;
    if (p.vendido) { yaVendidas.push(it); continue; }                  // la vendieron mientras tanto
    if (p.apartada && p.reservedBy?.pedido !== pedido.id && p.reservedBy?.nombre) apartadasParaOtro.push(`${p.nombre} (apartada para ${p.reservedBy.nombre})`);
    const ventaId = await siguienteId('ventas');
    await ventas.insertOne({ id: ventaId, prendaId: p.id, bazarId: Number(p.bazarId || 1), comprador: '', clienteNombre: pedido.nombre, clienteTelefono: pedido.telefono,
      vendedor: 'tienda en línea', canal, origen: pedido.origen?.fuente || 'directo', pedido: pedido.id, prenda: instantaneaPrenda(p), costo: Number(p.costo) || 0, precio: it.precio,
      fecha, resenaBazar: false, resenaComprador: false });
    await inv.updateOne({ id: p.id }, { $set: { vendido: true, vendidoA: pedido.nombre, vendidoEn: fecha, ventaId, apartada: false, canalVenta: canal }, $unset: { reservedUntil: '', reservedBy: '' } });
  }
  if (yaVendidas.length) {
    const devolver = yaVendidas.reduce((t, x) => t + (Number(x.precio) || 0), 0);
    await historialPedido(db, pedido, { accion: `Pagó, pero ${yaVendidas.length === 1 ? 'una prenda ya estaba vendida' : `${yaVendidas.length} prendas ya estaban vendidas`}: devolver ${pesos(devolver)}`,
      por: 'sistema', categoria: 'pedido', tipo: 'pedido.conflicto', resultado: 'error', detalle: { prendas: yaVendidas.map(x => x.id), devolver } });
    await db.collection('pedidos').updateOne({ id: pedido.id }, { $set: { estado: 'pagado', revisar: true, yaVendidas: yaVendidas.map(x => x.id) } });
    await pendiente(db, pedido.bazarId, 'venta', `⚠️ ${pedido.nombre} pagó ${pesos(pedido.total)}, pero ${yaVendidas.map(x => `"${x.nombre}"`).join(', ')} ya se había vendido. Devuélvele ${pesos(devolver)} desde ${nombreMetodo(canal)} o ofrécele otra prenda.`, {
      whatsapp: linkWA(pedido.telefono, `¡Hola ${pedido.nombre}! Gracias por tu pago 🙏 Una disculpa: ${yaVendidas.map(x => `"${x.nombre}"`).join(', ')} se vendió justo antes de que se confirmara tu pago. Te devolvemos ${pesos(devolver)}, o si prefieres te mostramos otras prendas de tu talla por el mismo valor. ¿Qué prefieres?`),
      pedido: pedido.id, titulo: 'Devolver dinero', urgente: true, cliente: pedido.nombre, monto: devolver, metodo: nombreMetodo(canal),
      prendas: yaVendidas.map(x => x.nombre).slice(0, 6),
      detalle: `Pagó ${pesos(pedido.total)}, pero ${yaVendidas.length === 1 ? 'esta prenda ya se había vendido' : 'estas prendas ya se habían vendido'}. Devuélvele ${pesos(devolver)} desde ${nombreMetodo(canal)} u ofrécele otra prenda.`,
    });
  }
  if (pedido.cupon && pedido.modalidad !== 'apartado') await sumarUsoCupon(db, pedido);   // en apartados se cuenta al pagar el anticipo
  const vendidasAqui = pedido.items.filter(x => x.id !== 'envio' && !yaVendidas.includes(x));
  const lista = vendidasAqui.map(x => `• ${x.nombre} (${pesos(x.precio)})`).join('\n');
  const primero = String(pedido.nombre || '').split(' ')[0];
  if (resto && vendidasAqui.length && !enPersona) await pendiente(db, pedido.bazarId, 'venta', `💳 ${pedido.nombre} liquidó su apartado: pagó el resto, ${pesos(pedido.resta)}, con ${nombreMetodo(canal)}.`, {
    whatsapp: linkWA(pedido.telefono, `¡Hola ${primero}! 🙌 Recibimos el resto de tu pago (${pesos(pedido.resta)}). Tu pedido ${pedido.id} ya está pagado completo:\n${lista}\n\n${pedido.direccion ? `Lo enviamos a:\n${textoDireccion(pedido.direccion)}\n\nTe compartimos la guía en cuanto salga 📦` : `¿Qué día y hora te queda bien para la entrega${pedido.punto ? ` en ${pedido.punto.nombre}` : ''}?`}\n\nTu recibo:\n${urlPedido(pedido)}`),
    direccion: pedido.direccion ? textoDireccion(pedido.direccion) : null,
    pedido: pedido.id, titulo: 'Apartado liquidado', cliente: pedido.nombre, monto: pedido.resta, metodo: nombreMetodo(canal),
    prendas: vendidasAqui.map(x => x.nombre).slice(0, 6),
    entrega: pedido.direccion ? `Envío a ${pedido.direccion.ciudad}, ${pedido.direccion.estado} · CP ${pedido.direccion.cp}${pedido.envioDetalle ? ` · ${pedido.envioDetalle.paqueteria} ${pedido.envioDetalle.servicio}` : ''}`
      : pedido.punto ? `Entrega en ${pedido.punto.nombre}: coordina día y hora` : 'Coordina la entrega',
    detalle: `Total ${pesos(pedido.total)}: anticipo ${pesos(pedido.anticipo)} + resto ${pesos(pedido.resta)}.`,
  });
  if (!resto && vendidasAqui.length) await pendiente(db, pedido.bazarId, 'venta', `💳 Pagaron en línea con ${nombreMetodo(canal)} ${pesos(pedido.total)}: ${pedido.nombre}. ${pedido.direccion ? `Enviar a ${pedido.direccion.ciudad}, ${pedido.direccion.estado} (CP ${pedido.direccion.cp}).` : pedido.punto ? `Entrega en ${pedido.punto.nombre}${pedido.punto.costo ? ` (cobró ${pesos(pedido.punto.costo)})` : ''}: coordina día y hora.` : 'Coordina la entrega.'}${pedido.envioDetalle ? ` Paquetería que eligió: ${pedido.envioDetalle.paqueteria} ${pedido.envioDetalle.servicio} (cotizado ${pesos(pedido.envioDetalle.costo)}).` : ''}${apartadasParaOtro.length ? ` Ojo: ${apartadasParaOtro.join(', ')}; avísale que ya se vendió.` : ''}`, {
    whatsapp: linkWA(pedido.telefono, `¡Hola ${pedido.nombre}! 🙌 Recibimos tu pago de ${pesos(pedido.total)} por:\n${lista}\n\n${pedido.direccion ? `Lo enviamos a:\n${textoDireccion(pedido.direccion)}\n\nTe compartimos la guía en cuanto salga 📦` : pedido.envio && !pedido.punto ? 'Pediste envío: mándanos tu dirección completa 📦' : `¿Qué día y hora te queda bien para la entrega${pedido.punto ? ` en ${pedido.punto.nombre}` : ''}?`}${pedido.clave ? `\n\nTu recibo y el seguimiento de tu pedido ${pedido.id}:\n${urlPedido(pedido)}` : ''}`),
    direccion: pedido.direccion ? textoDireccion(pedido.direccion) : null,
    pedido: pedido.id, titulo: 'Pago recibido', cliente: pedido.nombre, monto: pedido.total, metodo: nombreMetodo(canal),
    prendas: vendidasAqui.map(x => x.nombre).slice(0, 6),
    entrega: pedido.direccion ? `Envío a ${pedido.direccion.ciudad}, ${pedido.direccion.estado} · CP ${pedido.direccion.cp}${pedido.envioDetalle ? ` · ${pedido.envioDetalle.paqueteria} ${pedido.envioDetalle.servicio}` : ''}`
      : pedido.punto ? `Entrega en ${pedido.punto.nombre}: coordina día y hora` : 'Coordina la entrega',
    detalle: apartadasParaOtro.length ? `Ojo: ${apartadasParaOtro.join(', ')}; avísale que ya se vendió.` : '',
  });
  if (vendidasAqui.length && !(resto && enPersona)) await correoPedido(db, pedido, resto ? 'liquidado' : 'pagado');
  // Comentario de VENDIDA en Instagram (si está activado). v55: también en el carrusel del drop.
  try {
    const { igAvisarVenta } = await import('./igSync.js');
    const bazar = await db.collection('bazares').findOne({ id: pedido.bazarId });
    for (const it of vendidasAqui) {
      const p = await inv.findOne({ id: Number(it.id) });
      if (p?.instagramId || p?.dropIgId) await igAvisarVenta(db, p, bazar, { origen: `pedido ${pedido.id}` });
    }
  } catch {}
  invalidarSyncCache();
  return true;
}

// ── Recibo por correo (si el cliente dejó correo y RESEND_API_KEY + CORREO_DESDE están en Vercel) ──
// Nunca detiene una venta: si el correo falla, solo queda en el registro.
export async function correoPedido(db, pedido, tipo, extra = {}) {
  try {
    if (!pedido?.email || !correoConfigurado()) return;
    const bazar = await db.collection('bazares').findOne({ id: Number(pedido.bazarId) || 1 }).catch(() => null);
    const tienda = bazar?.nombre || 'Stiimpys';
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const primero = String(pedido.nombre || '').split(' ')[0];
    const prendas = (pedido.items || []).filter(x => x.id !== 'envio');
    const lista = `<ul style="padding-left:18px;margin:10px 0">${prendas.map(x => `<li>${esc(x.nombre)} · ${esc(pesos(x.precio))}</li>`).join('')}</ul>`;
    const entrega = pedido.direccion ? `Envío a ${esc(pedido.direccion.ciudad)}, ${esc(pedido.direccion.estado)}${pedido.envioDetalle ? ` por ${esc(pedido.envioDetalle.paqueteria)}` : ''}.`
      : pedido.punto ? `Entrega en persona en ${esc(pedido.punto.nombre)}: te escribimos por WhatsApp para coordinar día y hora.` : 'Te escribimos por WhatsApp para coordinar la entrega.';
    const T = {
      pagado: { asunto: `Recibimos tu pago · pedido ${pedido.id}`, titulo: `¡Gracias, ${primero}! Tu pago está confirmado`,
        cuerpo: `Pagaste <b>${esc(pesos(pedido.total))}</b> por:${lista}${entrega}` },
      anticipo: { asunto: `Apartado confirmado · pedido ${pedido.id}`, titulo: `¡Listo, ${primero}! Tus prendas están apartadas`,
        cuerpo: `Recibimos tu anticipo de <b>${esc(pesos(pedido.anticipo))}</b> por:${lista}Te faltan <b>${esc(pesos(pedido.resta))}</b>${extra.hasta ? `, que puedes pagar antes del <b>${esc(fechaCorta(extra.hasta))}</b>` : ''} desde tu recibo o en persona.` },
      liquidado: { asunto: `Apartado liquidado · pedido ${pedido.id}`, titulo: `¡Gracias, ${primero}! Tu pedido quedó pagado`,
        cuerpo: `Recibimos el resto de tu pago (<b>${esc(pesos(pedido.resta))}</b>). Total pagado: <b>${esc(pesos(pedido.total))}</b>.${lista}${entrega}` },
      enviado: { asunto: `Tu pedido ${pedido.id} va en camino`, titulo: `¡${primero}, tu pedido ya salió!`,
        cuerpo: `Lo enviamos por <b>${esc(extra.paqueteria)}</b>. Número de guía: <b>${esc(extra.guia)}</b>.${lista}` },
      // v42: lo marca solo el rastreo automático cuando la paquetería confirma la entrega
      entregado: { asunto: `Tu pedido ${pedido.id} ya llegó`, titulo: `¡${primero}, tu pedido ya está contigo!`,
        cuerpo: `${esc(extra.paqueteria || 'La paquetería')} confirmó la entrega.${lista}¿Cómo te quedó? Si nos dejas tu reseña con una foto, ayudas a que más gente compre con confianza.` },
      oficina: { asunto: `Tu pedido ${pedido.id} te espera en la paquetería`, titulo: `${primero}, tu paquete está listo para recoger`,
        cuerpo: `${esc(extra.paqueteria || 'La paquetería')} dejó tu pedido en su oficina. Lleva una identificación y tu número de guía: <b>${esc(extra.guia || '')}</b>.${lista}` },
    }[tipo];
    if (!T) return;
    const enlace = urlPedido(pedido);
    await enviarCorreo({
      contexto: { tipo, pedidoId: pedido.id, bazarId: pedido.bazarId },
      para: pedido.email, asunto: `${T.asunto} · ${tienda}`,
      html: plantilla({ titulo: T.titulo, cuerpo: T.cuerpo, boton: 'Ver mi recibo y seguimiento', enlace,
        pie: `Guarda este correo: el botón abre tu recibo en cualquier momento. ¿Dudas? Responde por WhatsApp a ${esc(tienda)}.` }),
      texto: `${T.titulo}\n\nPedido ${pedido.id}\n${prendas.map(x => `- ${x.nombre} ${pesos(x.precio)}`).join('\n')}\n\nTu recibo: ${enlace}`,
    });
  } catch (e) { console.error('[correo pedido]', e); }
}

async function sumarUsoCupon(db, pedido) {
  if (/^(CUMPLE|REGALO)-/.test(pedido.cupon || '')) { const { usarCuponPersonal } = await import('./clientes.js'); await usarCuponPersonal(db, pedido).catch(() => {}); return; }
  // v43: el amigo pagó con un código REF-: premio para quien lo invitó
  if (/^REF-/.test(pedido.cupon || '')) {
    try {
      const { premiarReferido } = await import('./extras.js');
      const cfg = await leerConfigTienda(db, pedido.bazarId);
      const pr = await premiarReferido(db, cfg, pedido);
      if (pr) await pendiente(db, pedido.bazarId, 'interesado', `${pr.nombre || 'Un cliente'} invitó a ${String(pedido.nombre || '').split(' ')[0]} y se ganó ${pr.pct}%: mándale su código.`,
        { titulo: 'Premio por invitar', cliente: pr.nombre, detalle: `Código ${pr.codigo}, vale hasta ${pr.vence}.`, whatsapp: pr.whatsapp, pedido: pedido.id });
    } catch (e) { console.error('[referido]', e); }
    return;
  }
  // Suma atómica en el cupón de ese código: dos pagos al mismo tiempo ya no se pisan
  // y tampoco se reescribe la lista completa de cupones (que podía borrar un cambio
  // que se estuviera guardando en el panel en ese momento).
  const r = await db.collection('tiendaConfig').updateOne(
    { bazarId: Number(pedido.bazarId) || 1, 'cupones.codigo': pedido.cupon },
    { $inc: { 'cupones.$.usos': 1 } });
  await registrarEvento({ categoria: 'cupon', tipo: 'cupon.uso', resultado: r.matchedCount ? 'ok' : 'info', usuario: 'sistema', bazarId: pedido.bazarId, pedidoId: pedido.id,
    accion: `Se contó un uso del cupón ${pedido.cupon}`, detalle: { codigo: pedido.cupon, descuento: pedido.descCupon || 0 } }, db);
  if (r.matchedCount) return;
  // Respaldo: bazar sin documento de configuración guardado todavía
  const cfg = await leerConfigTienda(db, pedido.bazarId);
  const c = cfg.cupones.find(x => x.codigo === pedido.cupon);
  if (c) { c.usos++; await db.collection('tiendaConfig').updateOne({ bazarId: Number(pedido.bazarId) || 1 }, { $set: { cupones: cfg.cupones } }, { upsert: true }); }
}

// Anticipo pagado: las prendas quedan apartadas a su nombre hasta la fecha límite (no se venden ni se sueltan solas)
async function confirmarAnticipo(db, pedido, pago) {
  const ahora = new Date(), ahoraIso = ahora.toISOString();
  const hasta = new Date(ahora.getTime() + (pedido.diasApartado || 7) * DIA).toISOString();
  const proveedor = pago.payment_type_id || pedido.proveedor || 'clip';
  const r = await db.collection('pedidos').updateOne({ id: pedido.id, estado: { $in: ['pendiente', 'expirado'] } }, { $set: {
    estado: 'apartado', anticipoPagadoEn: ahoraIso, anticipoPagoId: String(pago.id || ''), liquidarAntes: hasta,
    pagos: [{ tipo: 'anticipo', monto: pedido.anticipo, proveedor, en: ahoraIso }] } });
  if (!r.modifiedCount) return false;
  await marcarSistema('ultimoPago', db, 0);
  await historialPedido(db, pedido, { de: pedido.estado, a: 'apartado', por: nombreMetodo(proveedor), categoria: 'apartado', tipo: 'apartado.anticipo',
    accion: `Anticipo confirmado por ${nombreMetodo(proveedor)} (${pesos(pedido.anticipo)} de ${pesos(pedido.total)}); liquidar antes del ${fechaCorta(hasta)}`,
    detalle: { anticipo: pedido.anticipo, resta: pedido.resta, liquidarAntes: hasta, pagoId: String(pago.id || '').slice(0, 40) } });
  const inv = db.collection('inventario');
  const perdidas = [];
  for (const it of pedido.items.filter(x => x.id !== 'envio')) {
    const p = await inv.findOne({ id: Number(it.id) }); if (!p) continue;
    // Se vendió o la apartó otra persona con anticipo mientras pagaba
    if (p.vendido || (p.apartada && p.reservedBy?.anticipo && p.reservedBy.pedido !== pedido.id)) { perdidas.push(it); continue; }
    await inv.updateOne({ id: p.id }, { $set: { apartada: true, reservedUntil: hasta,
      reservedBy: { nombre: pedido.nombre, telefono: pedido.telefono, canal: 'anticipo', pedido: pedido.id, anticipo: pedido.anticipo, en: ahoraIso } } });
  }
  if (pedido.cupon) await sumarUsoCupon(db, pedido);
  const primero = String(pedido.nombre || '').split(' ')[0], fecha = fechaCorta(hasta);
  const quedan = pedido.items.filter(x => x.id !== 'envio' && !perdidas.includes(x));
  const lista = quedan.map(x => `• ${x.nombre} (${pesos(x.precio)})`).join('\n');
  if (perdidas.length) {
    await db.collection('pedidos').updateOne({ id: pedido.id }, { $set: { revisar: true, yaVendidas: perdidas.map(x => x.id) } });
    await historialPedido(db, pedido, { accion: `Pagó el anticipo, pero ${perdidas.length === 1 ? 'una prenda ya no estaba disponible' : `${perdidas.length} prendas ya no estaban disponibles`}`,
      categoria: 'apartado', tipo: 'apartado.conflicto', resultado: 'error', detalle: { prendas: perdidas.map(x => x.id) } });
    await pendiente(db, pedido.bazarId, 'venta', `⚠️ ${pedido.nombre} pagó ${pesos(pedido.anticipo)} de anticipo, pero ${perdidas.map(x => `"${x.nombre}"`).join(', ')} ya no estaba disponible.`, {
      whatsapp: linkWA(pedido.telefono, `¡Hola ${primero}! Gracias por tu anticipo 🙏 Una disculpa: ${perdidas.map(x => `"${x.nombre}"`).join(', ')} se vendió justo antes de que se confirmara tu pago. ¿Te devolvemos esa parte o te mostramos otras prendas de tu talla?`),
      pedido: pedido.id, titulo: 'Revisar apartado', urgente: true, cliente: pedido.nombre, monto: pedido.anticipo, metodo: nombreMetodo(proveedor),
      prendas: perdidas.map(x => x.nombre).slice(0, 6),
      detalle: `Pagó ${pesos(pedido.anticipo)} de anticipo, pero ${perdidas.length === 1 ? 'esta prenda ya no estaba disponible' : 'estas prendas ya no estaban disponibles'}. Ajusta el apartado o devuélvele esa parte.`,
    });
  }
  if (quedan.length) await pendiente(db, pedido.bazarId, 'venta', `🔖 ${pedido.nombre} apartó con ${pesos(pedido.anticipo)} (${nombreMetodo(proveedor)}). Falta ${pesos(pedido.resta)} antes del ${fecha}.`, {
    whatsapp: linkWA(pedido.telefono, `¡Hola ${primero}! 🙌 Recibimos tu anticipo de ${pesos(pedido.anticipo)}. Te apartamos:\n${lista}\n\nTe falta ${pesos(pedido.resta)}. Puedes pagarlo antes del ${fecha} aquí:\n${urlPedido(pedido)}\n\n${pedido.direccion ? 'En cuanto liquides te mandamos tu pedido 📦' : `o en persona cuando te entreguemos${pedido.punto ? ` en ${pedido.punto.nombre}` : ''}.`}`),
    pedido: pedido.id, titulo: 'Apartado con anticipo', cliente: pedido.nombre, monto: pedido.anticipo, metodo: nombreMetodo(proveedor),
    prendas: quedan.map(x => x.nombre).slice(0, 6),
    entrega: pedido.direccion ? `Envío a ${pedido.direccion.ciudad}, ${pedido.direccion.estado} · se envía al liquidar` : pedido.punto ? `Entrega en ${pedido.punto.nombre}` : 'Coordina la entrega',
    detalle: `Falta ${pesos(pedido.resta)} de ${pesos(pedido.total)} · liquida antes del ${fecha}.`,
  });
  if (quedan.length) await correoPedido(db, pedido, 'anticipo', { hasta });
  invalidarSyncCache();
  return true;
}

// Revisa un cobro (Clip o PayPal) contra el monto que se esperaba
async function revisarCobro(bazarId, l, esperado, { cobrar = true, pedidoId = null } = {}) {
  try {
    if (l.proveedor === 'clip') {
      if (!l.clipId) return { estado: 'pendiente' };
      const r = await clip(bazarId, `/v2/checkout/${encodeURIComponent(l.clipId)}`);
      const monto = Number(r.amount);
      if (r.status === 'CHECKOUT_COMPLETED' && (!Number.isFinite(monto) || Math.abs(monto - esperado) < 1)) return { estado: 'pagado', id: r.receipt_no || l.clipId };
      if (r.status === 'CHECKOUT_COMPLETED') {
        // Clip dice "pagado" pero no por lo que se esperaba: NO se da por pagado, se avisa
        await registrarEvento({ categoria: 'pago', tipo: 'clip.monto', resultado: 'error', bazarId, pedidoId,
          accion: `Clip reporta un pago de ${pesos(monto)} pero se esperaban ${pesos(esperado)}: no se dio por pagado`,
          detalle: { esperado, recibido: monto }, unaVezCada: { clave: `monto:${l.clipId}`, ms: 3600e3 } });
        return { estado: 'pendiente', montoDistinto: true };
      }
      if (r.status === 'CHECKOUT_PENDING') return { estado: 'en proceso' };
      return { estado: 'pendiente' };
    }
    if (l.proveedor === 'paypal' && l.paypalId) {
      const r = await revisarOrdenPaypal(bazarId, l.paypalId, esperado, { cobrar });
      if (r.estado === 'pagado') return { estado: 'pagado', id: r.capturaId || l.paypalId };
      if (r.estado === 'en proceso') return { estado: 'en proceso' };
      if (r.estado === 'aprobado') return { estado: 'aprobado' };
      if (r.montoDistinto) await registrarEvento({ categoria: 'pago', tipo: 'paypal.monto', resultado: 'error', bazarId, pedidoId,
        accion: `PayPal reporta un cobro de ${pesos(r.monto)} pero se esperaban ${pesos(esperado)}: no se dio por pagado`,
        unaVezCada: { clave: `monto:${l.paypalId}`, ms: 3600e3 } });
    }
    return { estado: 'pendiente' };
  } catch (e) {
    // Clip o PayPal no contestaron: se registra (una vez cada 5 min por pedido) y se sigue como estaba
    await registrarEvento({ categoria: 'pago', tipo: `${l.proveedor}.consulta`, resultado: 'error', bazarId, pedidoId,
      accion: `No se pudo consultar el pago en ${nombreMetodo(l.proveedor)}`, error: e,
      unaVezCada: { clave: `consulta:${l.proveedor}:${pedidoId}`, ms: 300e3 } });
    throw e;
  }
}

export async function revisarPagoDePedido(db, pedido) {
  // Resto de un apartado: los links que abrió para liquidar (el más nuevo primero)
  if (pedido.estado === 'apartado') {
    let enProceso = false;
    for (const l of [...(pedido.liquidaciones || [])].reverse().slice(0, 5)) {
      const r = await revisarCobro(pedido.bazarId, l, pedido.resta, { pedidoId: pedido.id });
      if (r.estado === 'pagado') { await confirmarPedido(db, pedido, { tipo: 'resto', id: r.id, payment_type_id: l.proveedor }); return 'pagado'; }
      if (r.estado === 'en proceso') enProceso = true;
    }
    return enProceso ? 'en proceso' : 'apartado';
  }
  // v33: pedido cancelado desde el panel antes de pagar. Si de todos modos llega el pago
  // (el link de Clip seguía abierto), NO se vende nada: se avisa para devolver el dinero.
  if (pedido.estado === 'cancelado' && ['pendiente', 'expirado'].includes(pedido.canceladoDesde) && !pedido.pagoTrasCancelar) {
    const esperadoC = pedido.modalidad === 'apartado' ? pedido.anticipo : pedido.total;
    if (pedido.proveedor === 'spei') return pedido.estado;
    const lc = pedido.proveedor === 'paypal' ? { proveedor: 'paypal', paypalId: pedido.paypalId } : { proveedor: 'clip', clipId: pedido.clipId };
    const rc = await revisarCobro(pedido.bazarId, lc, esperadoC, { cobrar: false, pedidoId: pedido.id });   // solo leer: PayPal no se cobra
    if (rc.estado === 'pagado') await pagoTrasCancelar(db, pedido, rc, esperadoC);
    return pedido.estado;
  }
  if (!['pendiente', 'expirado'].includes(pedido.estado)) return pedido.estado;
  if (pedido.proveedor === 'spei') return pedido.estado;   // v42: la transferencia la confirma la dueña a mano
  const esperado = pedido.modalidad === 'apartado' ? pedido.anticipo : pedido.total;
  const l = pedido.proveedor === 'paypal' ? { proveedor: 'paypal', paypalId: pedido.paypalId } : { proveedor: 'clip', clipId: pedido.clipId };
  // v36: PayPal no vence solo como el link de Clip. Si ya pasaron los minutos del
  // apartado y mientras tanto otra persona apartó o compró la prenda, la orden
  // aprobada NO se cobra (mejor que cobrar y luego devolver).
  if (pedido.proveedor === 'paypal' && pedido.expira && pedido.expira < new Date().toISOString()) {
    const ocupadas = await prendasTomadasPorOtro(db, pedido);
    if (ocupadas.length) {
      const rr = await revisarCobro(pedido.bazarId, l, esperado, { cobrar: false, pedidoId: pedido.id });
      if (rr.estado === 'aprobado') { await noCobradoPorTiempo(db, pedido, ocupadas); return 'expirado'; }
      if (rr.estado === 'pagado') { const pago = { id: rr.id, payment_type_id: 'paypal' };
        if (pedido.modalidad === 'apartado') { await confirmarAnticipo(db, pedido, pago); return 'apartado'; }
        await confirmarPedido(db, pedido, pago); return 'pagado'; }
      return rr.estado === 'en proceso' ? 'en proceso' : pedido.estado;
    }
  }
  const r = await revisarCobro(pedido.bazarId, l, esperado, { pedidoId: pedido.id });
  if (r.estado === 'pagado') {
    const pago = { id: r.id, payment_type_id: l.proveedor };
    if (pedido.modalidad === 'apartado') { await confirmarAnticipo(db, pedido, pago); return 'apartado'; }
    await confirmarPedido(db, pedido, pago); return 'pagado';
  }
  if (r.estado === 'en proceso') return 'en proceso';
  return pedido.estado;
}

// v36 · Prendas de un pedido que, pasado su apartado, ya tiene alguien más
// (vendidas, con anticipo de otro, o apartadas para otra persona todavía vigentes)
async function prendasTomadasPorOtro(db, pedido) {
  const ahoraIso = new Date().toISOString(), tomadas = [];
  for (const it of (pedido.items || []).filter(x => x.id !== 'envio')) {
    const p = await db.collection('inventario').findOne({ id: Number(it.id) }, { projection: { nombre: 1, vendido: 1, apartada: 1, reservedBy: 1, reservedUntil: 1 } });
    if (!p) continue;
    const deOtro = p.apartada && p.reservedBy?.pedido !== pedido.id && (p.reservedBy?.anticipo || !p.reservedUntil || p.reservedUntil > ahoraIso);
    if (p.vendido || deOtro) tomadas.push(p.nombre || it.nombre);
  }
  return tomadas;
}
async function noCobradoPorTiempo(db, pedido, ocupadas) {
  const r = await db.collection('pedidos').updateOne({ id: pedido.id, estado: { $in: ['pendiente', 'expirado'] } },
    { $set: { estado: 'expirado', noCobrado: true } });
  if (!r.modifiedCount && pedido.noCobrado) return;
  await historialPedido(db, pedido, { de: pedido.estado, a: 'expirado', por: 'sistema', categoria: 'pago', tipo: 'paypal.no-cobrado', resultado: 'info',
    accion: `PayPal aprobó el pago después de que venció su apartado, pero ${ocupadas.map(x => `"${x}"`).join(', ')} ya la tiene alguien más: no se cobró`,
    detalle: { prendas: ocupadas.length } });
}

// La fecha para liquidar pasó: la prenda NO se suelta sola (ya pagó una parte); se avisa una vez
export async function avisarApartadoVencido(db, pedidoId) {
  const p = await db.collection('pedidos').findOne({ id: pedidoId });
  if (!p || p.estado !== 'apartado' || p.avisoVencido) return;
  try { if (await revisarPagoDePedido(db, p) === 'pagado') return; } catch {}
  await db.collection('pedidos').updateOne({ id: p.id }, { $set: { avisoVencido: true } });
  await historialPedido(db, p, { accion: `Venció la fecha para liquidar: faltan ${pesos(p.resta)} (se avisó en Pendientes)`, categoria: 'apartado', tipo: 'apartado.vencido', resultado: 'info' });
  const primero = String(p.nombre || '').split(' ')[0];
  await pendiente(db, p.bazarId, 'apartado', `⏰ Venció el apartado de ${p.nombre}: pagó ${pesos(p.anticipo)} y faltan ${pesos(p.resta)}.`, {
    whatsapp: linkWA(p.telefono, `¡Hola ${primero}! 👋 La fecha para liquidar tu apartado ${p.id} fue el ${fechaCorta(p.liquidarAntes)}. Te faltan ${pesos(p.resta)}. Aquí puedes pagarlo:\n${urlPedido(p)}\n\nSi necesitas unos días más, avísanos 🙏`),
    pedido: p.id, titulo: 'Apartado vencido', cliente: p.nombre, monto: p.resta,
    prendas: (p.items || []).filter(x => x.id !== 'envio').map(x => x.nombre).slice(0, 6),
    detalle: `Pagó ${pesos(p.anticipo)} de anticipo y faltan ${pesos(p.resta)}. En Pedidos en línea → Apartados puedes darle más días o liberar la prenda.`,
  });
}

// ── v33 · Pedidos que se quedaron atorados ──────────────────────
// Para resaltarlos en el panel y en el monitor. Solo lectura: no cambia nada.
export function alertasPedido(p, ahora = Date.now()) {
  const a = [];
  const hace = iso => iso ? (ahora - new Date(iso).getTime()) / DIA : 0;
  if (p.estado === 'pendiente' && ((p.expira && new Date(p.expira).getTime() < ahora - 10 * 60e3) || hace(p.en) > 2 / 24))
    a.push({ tipo: 'pago-sin-cerrar', texto: 'El pago quedó abierto más de lo normal: revisa con ' + nombreMetodo(p.proveedor), nivel: 'ambar' });
  if (p.estado === 'apartado' && p.liquidarAntes && new Date(p.liquidarAntes).getTime() < ahora)
    a.push({ tipo: 'apartado-vencido', texto: 'Venció la fecha para liquidar', nivel: 'rojo' });
  else if (p.estado === 'apartado' && p.liquidarAntes && new Date(p.liquidarAntes).getTime() - ahora < 2 * DIA)
    a.push({ tipo: 'apartado-por-vencer', texto: 'Vence en menos de 2 días', nivel: 'ambar' });
  const pagado = p.liquidadoEn || p.pagadoEn;
  if (p.estado === 'pagado' && (p.entregaEstado || 'pendiente') === 'pendiente' && hace(pagado) > 5)
    a.push({ tipo: 'sin-entregar', texto: `Pagado hace ${Math.floor(hace(pagado))} días y sin ${p.entrega === 'envio' ? 'enviar' : 'entregar'}`, nivel: 'ambar' });
  if (p.estado === 'pagado' && p.entregaEstado === 'enviado' && hace(p.enviadoEn) > 12)
    a.push({ tipo: 'envio-largo', texto: `Enviado hace ${Math.floor(hace(p.enviadoEn))} días sin marcar entregado`, nivel: 'ambar' });
  if (p.revisar) a.push({ tipo: 'devolver', texto: 'Una prenda ya estaba vendida: hay que devolver ese monto', nivel: 'rojo' });
  if (p.pagoTrasCancelar) a.push({ tipo: 'pago-tras-cancelar', texto: 'Pagó después de cancelado: devuelve el dinero', nivel: 'rojo' });
  return a;
}

// ═════════════════════════════════════════════════════════════
//  v33 · Cambios de estado de un pedido desde el panel (dentro del candado del pedido)
//  liquidar · extender · liberar · cancelar · revisar · enviado · entregado · deshacer
// ═════════════════════════════════════════════════════════════
const ESTADOS_FINALES = ['cancelado', 'reemplazado'];
async function cambiarEstadoPedido(req, res, db, user, b, p) {
  const primero = String(p.nombre || '').split(' ')[0];
  const inv = db.collection('inventario');
  const yo = user.username;
  const listo = () => { req._evento = { ...(req._evento || {}), omitir: true }; };   // el historial ya dejó el evento detallado
  const motivo = texto(b.motivo, 200);

  // ── Revisar el pago con Clip/PayPal (para pedidos que se quedaron "pagando") ──
  if (b.accion === 'revisar') {
    const antes = p.estado;
    let estado = antes;
    try {
      if (antes === 'pendiente' && p.expira && p.expira < new Date().toISOString()) estado = (await cerrarPedidoVencido(db, p.id)) ? (await db.collection('pedidos').findOne({ id: p.id }))?.estado : 'expirado';
      else estado = await revisarPagoDePedido(db, p);
    } catch (e) {
      await historialPedido(db, p, { accion: `Revisión manual del pago: ${nombreMetodo(p.proveedor)} no contestó`, por: yo, resultado: 'error', error: e, categoria: 'pago', tipo: 'pago.revision' });
      listo();
      return res.status(502).json({ error: `${nombreMetodo(p.proveedor)} no contestó. Intenta en unos minutos.` });
    }
    const final = await db.collection('pedidos').findOne({ id: p.id });
    if (final?.estado === antes) await historialPedido(db, p, { accion: `Revisión manual del pago con ${nombreMetodo(p.proveedor)}: sin cambios${estado === 'en proceso' ? ' (pago en proceso)' : ''}`, por: yo, resultado: 'info', tipo: 'pago.revision', categoria: 'pago' });
    listo();
    return res.status(200).json({ ok: true, estado: final?.estado || estado, enProceso: estado === 'en proceso', cambio: final?.estado !== antes });
  }

  // ── Cancelar (pedidos sin pago confirmado) ──
  if (b.accion === 'cancelar' && p.estado === 'apartado') b = { ...b, accion: 'liberar' };
  if (b.accion === 'cancelar') {
    if (p.estado === 'pagado') return res.status(409).json({ error: 'Este pedido ya tiene el pago confirmado, así que no se cancela desde aquí. Si hay que devolver el dinero, hazlo en Clip/PayPal y luego reactiva la prenda en Inventario.' });
    if (ESTADOS_FINALES.includes(p.estado)) return res.status(409).json({ error: 'Ese pedido ya estaba cancelado.' });
    if (!['pendiente', 'expirado'].includes(p.estado)) return res.status(400).json({ error: 'Ese pedido no se puede cancelar.' });
    // Antes de cancelar se le pregunta a Clip/PayPal: si ya pagó, no se cancela
    let st;
    try { st = await revisarPagoDePedido(db, p); }
    catch (e) { return res.status(502).json({ error: `No se pudo confirmar con ${nombreMetodo(p.proveedor)} que no haya pagado. Intenta en unos minutos.` }); }
    if (['pagado', 'apartado'].includes(st)) return res.status(409).json({ error: `${primero} ya pagó este pedido (se acaba de confirmar con ${nombreMetodo(p.proveedor)}). No se canceló.`, yaPagado: true, estado: st });
    if (st === 'en proceso') return res.status(409).json({ error: `${nombreMetodo(p.proveedor)} está procesando un pago de este pedido. Espera unos minutos y revisa de nuevo.`, enProceso: true });
    const ahora = new Date().toISOString();
    const r = await db.collection('pedidos').updateOne({ id: p.id, estado: { $in: ['pendiente', 'expirado'] } },
      { $set: { estado: 'cancelado', canceladoEn: ahora, canceladoPor: yo, canceladoDesde: p.estado, ...(motivo ? { motivoCancelacion: motivo } : {}) } });
    if (!r.modifiedCount) return res.status(409).json({ error: 'El pedido cambió mientras se cancelaba. Revisa de nuevo.' });
    const sueltas = await inv.updateMany({ 'reservedBy.pedido': p.id, vendido: { $ne: true } }, { $set: { apartada: false }, $unset: { reservedUntil: '', reservedBy: '' } });
    invalidarSyncCache();
    await historialPedido(db, p, { de: p.estado, a: 'cancelado', accion: `Pedido cancelado desde el panel${motivo ? `: ${motivo}` : ''}`, por: yo, tipo: 'pedido.cancelado',
      detalle: { prendasLiberadas: sueltas.modifiedCount || 0 } });
    listo();
    return res.status(200).json({ ok: true, estado: 'cancelado', liberadas: sueltas.modifiedCount || 0 });
  }

  if (['liquidar', 'extender', 'liberar'].includes(b.accion)) {
    if (p.estado !== 'apartado') return res.status(400).json({ error: p.estado === 'pagado' ? 'Ese apartado ya está liquidado.' : 'Ese pedido no es un apartado activo.' });
    if (b.accion === 'liquidar' || b.accion === 'liberar') {
      // Antes se revisa si no pagó ya el resto en línea (para no cobrarle dos veces ni soltar algo pagado)
      const st = await revisarPagoDePedido(db, p).catch(() => 'apartado');
      if (st === 'pagado') { listo(); return res.status(409).json({ error: `${primero} ya pagó el resto en línea. ${b.accion === 'liquidar' ? 'No le cobres de nuevo.' : 'El pedido quedó pagado: no se liberó.'}`, yaPagado: true }); }
      if (st === 'en proceso' && b.accion === 'liberar') return res.status(409).json({ error: `Hay un pago del resto en proceso. Espera unos minutos antes de liberar.`, enProceso: true });
    }
    if (b.accion === 'liquidar') {
      const hecho = await confirmarPedido(db, p, { tipo: 'resto', id: 'persona', payment_type_id: 'persona', por: yo });
      if (!hecho) return res.status(409).json({ error: 'Ese apartado ya no estaba activo. Revisa de nuevo.' });
      listo();
      return res.status(200).json({ ok: true, estado: 'pagado', liquidadoCon: 'persona',
        whatsapp: linkWA(p.telefono, `¡Gracias, ${primero}! 🙌 Recibimos el resto de tu pago (${pesos(p.resta)}). Tu pedido ${p.id} quedó pagado completo.\n\nTu recibo:\n${urlPedido(p)}`) });
    }
    if (b.accion === 'extender') {
      const dias = Math.max(1, Math.min(30, Math.round(Number(b.dias) || 3)));
      const desde = Math.max(Date.now(), new Date(p.liquidarAntes || Date.now()).getTime());
      const hasta = new Date(desde + dias * DIA).toISOString();
      await db.collection('pedidos').updateOne({ id: p.id, estado: 'apartado' }, { $set: { liquidarAntes: hasta, avisoVencido: false } });
      await inv.updateMany({ 'reservedBy.pedido': p.id, vendido: { $ne: true } }, { $set: { reservedUntil: hasta } });
      invalidarSyncCache();
      await historialPedido(db, p, { accion: `Se dieron ${dias} día${dias === 1 ? '' : 's'} más para liquidar (ahora antes del ${fechaCorta(hasta)})`, por: yo, categoria: 'apartado', tipo: 'apartado.extendido',
        detalle: { dias, antes: p.liquidarAntes, ahora: hasta } });
      listo();
      return res.status(200).json({ ok: true, liquidarAntes: hasta,
        whatsapp: linkWA(p.telefono, `¡Hola ${primero}! Te dimos más tiempo para tu apartado ${p.id} 🙌 Ahora puedes liquidar los ${pesos(p.resta)} hasta el ${fechaCorta(hasta)}:\n${urlPedido(p)}`) });
    }
    // liberar: se cancela el apartado y las prendas regresan a la tienda (el anticipo se resuelve con el cliente)
    const r = await db.collection('pedidos').updateOne({ id: p.id, estado: 'apartado' },
      { $set: { estado: 'cancelado', canceladoEn: new Date().toISOString(), canceladoPor: yo, canceladoDesde: 'apartado', ...(motivo ? { motivoCancelacion: motivo } : {}) } });
    if (!r.modifiedCount) return res.status(409).json({ error: 'Ese apartado ya no estaba activo. Revisa de nuevo.' });
    const sueltas = await inv.updateMany({ 'reservedBy.pedido': p.id, vendido: { $ne: true } }, { $set: { apartada: false }, $unset: { reservedUntil: '', reservedBy: '' } });
    invalidarSyncCache();
    await historialPedido(db, p, { de: 'apartado', a: 'cancelado', accion: `Apartado liberado: las prendas volvieron a la tienda; queda pendiente resolver el anticipo de ${pesos(p.anticipo)}${motivo ? ` (${motivo})` : ''}`,
      por: yo, categoria: 'apartado', tipo: 'apartado.liberado', detalle: { anticipo: p.anticipo, prendasLiberadas: sueltas.modifiedCount || 0 } });
    listo();
    return res.status(200).json({ ok: true, estado: 'cancelado',
      whatsapp: linkWA(p.telefono, `Hola ${primero}. Tu apartado ${p.id} se canceló y las prendas volvieron a la tienda. Sobre tu anticipo de ${pesos(p.anticipo)}, te escribimos para resolverlo.`) });
  }

  if (p.estado !== 'pagado') return res.status(400).json({ error: p.estado === 'apartado' ? `Primero liquida el apartado: faltan ${pesos(p.resta)}.` : 'Ese pedido no está pagado.' });
  const ahora = new Date().toISOString();
  const eeAntes = p.entregaEstado || 'pendiente';
  let set, mensaje, accionTxt;
  if (b.accion === 'enviado') {
    const paqueteria = texto(b.paqueteria, 40), guia = texto(b.guia, 60).replace(/\s+/g, '');
    if (!paqueteria || guia.length < 4) return res.status(400).json({ error: 'Escribe la paquetería y el número de guía.' });
    if (eeAntes === 'enviado' && p.guia === guia) return res.status(409).json({ error: 'Ese pedido ya estaba marcado como enviado con esa guía.' });
    if (eeAntes === 'entregado') return res.status(409).json({ error: 'Ese pedido ya se entregó.' });
    set = { entregaEstado: 'enviado', paqueteria, guia, enviadoEn: ahora };
    accionTxt = `Marcado como enviado por ${paqueteria} (guía ${guia})`;
    mensaje = `¡Hola ${primero}! 📦 Tu pedido ${p.id} ya va en camino por ${paqueteria}.\nNúmero de guía: ${guia}\n\nAquí puedes ver tu pedido: ${urlPedido(p)}`;
  } else if (b.accion === 'entregado') {
    if (eeAntes === 'entregado') return res.status(409).json({ error: 'Ese pedido ya estaba marcado como entregado.' });
    set = { entregaEstado: 'entregado', entregadoEn: ahora };
    accionTxt = 'Marcado como entregado';
    mensaje = `¡Gracias por tu compra, ${primero}! 🙌 Esperamos que te encante.\n\n¿Nos regalas una reseña? Toma 20 segundos y nos ayuda muchísimo:\n${urlPedido(p)}`;
  } else if (b.accion === 'deshacer') {
    if (eeAntes === 'pendiente') return res.status(409).json({ error: 'No hay nada que deshacer en la entrega de ese pedido.' });
    set = eeAntes === 'entregado' && p.guia ? { entregaEstado: 'enviado', entregadoEn: null } : { entregaEstado: 'pendiente', enviadoEn: null, entregadoEn: null, paqueteria: '', guia: '' };
    accionTxt = `Se deshizo "${eeAntes === 'entregado' ? 'entregado' : 'enviado'}"`;
  } else return res.status(400).json({ error: 'Acción no válida' });
  await db.collection('pedidos').updateOne({ id: p.id, estado: 'pagado' }, { $set: { ...set, estadoPor: yo } });
  await historialPedido(db, p, { accion: accionTxt, por: yo, tipo: `entrega.${b.accion}`, detalle: { entrega: `${eeAntes} → ${set.entregaEstado}` } });
  listo();
  if (b.accion === 'enviado') await correoPedido(db, p, 'enviado', { paqueteria: set.paqueteria, guia: set.guia });
  return res.status(200).json({ ok: true, ...set, whatsapp: mensaje ? linkWA(p.telefono, mensaje) : null });
}

async function verPedido(req, res, db) {
  if (!(await rateLimit(req, res, { key: 'v-pedido', max: 300, windowSec: 3600 }))) return;
  const pedido = await db.collection('pedidos').findOne({ id: String(req.query.id || '') });
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
  let estado = pedido.estado;
  try { estado = await revisarPagoDePedido(db, pedido); } catch {}
  // Un apartado cuyo resto se está procesando sigue siendo apartado (con aviso de "confirmando")
  const restoEnProceso = pedido.estado === 'apartado' && estado === 'en proceso';
  if (restoEnProceso) estado = 'apartado';
  const bazar = await db.collection('bazares').findOne({ id: pedido.bazarId });
  const k = String(req.query.k || '');
  const dueno = esDueno(pedido, k);
  const final = await db.collection('pedidos').findOne({ id: pedido.id }) || pedido;
  const apartado = pedido.modalidad === 'apartado';
  const base = { id: pedido.id, estado, total: pedido.total, items: pedido.items, nombre: esDueno(pedido, req.query.k) ? String(pedido.nombre || '').split(' ')[0] : '',
    whatsapp: String(bazar?.whatsapp || '').replace(/\D/g, ''), bazar: bazar?.nombre || 'Stiimpys', revisar: !!final.revisar,
    modalidad: pedido.modalidad || 'completo', cobrar: apartado ? pedido.anticipo : pedido.total };
  if (!dueno) return res.status(200).json(base);
  const cfg = await leerConfigTienda(db, pedido.bazarId);
  if (apartado) base.apartado = { anticipo: pedido.anticipo, resta: pedido.resta, pct: pedido.pctAnticipo, liquidarAntes: final.liquidarAntes || null,
    anticipoPagadoEn: final.anticipoPagadoEn || null, liquidadoEn: final.liquidadoEn || null, liquidadoCon: final.liquidadoCon || null,
    pagos: final.pagos || [], restoEnProceso, vencido: final.estado === 'apartado' && !!final.liquidarAntes && final.liquidarAntes < new Date().toISOString(),
    metodos: final.estado === 'apartado' && cfg.pagoEnLinea ? metodosPago(cfg, pedido.bazarId).filter(m => m !== 'spei') : [] };
  return res.status(200).json({ ...base, completo: true, nombre: pedido.nombre, telefono: pedido.telefono, email: pedido.email || '',
    subtotal: pedido.subtotal, descVolumen: pedido.descVolumen, descCupon: pedido.descCupon, descFrecuente: pedido.descFrecuente || 0, descOutfit: pedido.descOutfit || 0, cupon: pedido.cupon, envio: pedido.envio,
    entrega: pedido.entrega || (pedido.envio ? 'envio' : 'persona'), direccion: pedido.direccion || null, entregaInfo: cfg.info.entrega || '',
    // v42: datos para transferir (solo al dueño del recibo y mientras se espera el pago)
    spei: pedido.proveedor === 'spei' && ['pendiente', 'expirado'].includes(final.estado) ? { ...pedido.spei, enRevision: !!final.speiComprobante, horas: cfg.spei?.horas || 3 } : null,
    proveedor: pedido.proveedor || 'clip', en: pedido.en, expira: pedido.expira, pagadoEn: final.pagadoEn || null, ids: pedido.ids,
    envioDetalle: pedido.envioDetalle ? { paqueteria: pedido.envioDetalle.paqueteria, servicio: pedido.envioDetalle.servicio, dias: pedido.envioDetalle.dias } : null,
    punto: pedido.punto || null,
    entregaEstado: final.entregaEstado || 'pendiente', paqueteria: final.paqueteria || '', guia: final.guia || '', enviadoEn: final.enviadoEn || null, entregadoEn: final.entregadoEn || null,
    // v41: enlace para rastrear (solo si la guía se generó con envia.com y es https)
    rastreo: /^https:\/\//.test(final.guiaEnvia?.rastreo || '') && final.guiaEnvia?.guia === final.guia ? final.guiaEnvia.rastreo : null,
    resena: final.resena || null, puedeResenar: modulo(cfg, 'resenas') && puedeResenar(final), etiquetas: ETIQUETAS_BAZAR,
    // v42: cliente frecuente (cuántas lleva, solo a su dueño) y si se le puede pedir el cumpleaños
    ...(await extrasCliente(db, cfg, final)) });
}

async function extrasCliente(db, cfg, p) {
  const o = {};
  if (!['pagado', 'apartado'].includes(p.estado)) return o;
  try {
    // v43: su código para invitar amigos y, ya entregado, "déjanos tu reseña en Google"
    if (modulo(cfg, 'referidos') && p.estado === 'pagado') {
      const { codigoReferido } = await import('./extras.js');
      const r = await codigoReferido(db, p.bazarId, p.telefono, p.nombre);
      if (r) o.referido = { codigo: r.codigo, pctAmigo: cfg.referidos.pctAmigo, pctPremio: cfg.referidos.pctPremio, invitados: r.invitados || 0 };
    }
    if (modulo(cfg, 'googleMaps') && cfg.google?.resena && p.entregaEstado === 'entregado') o.googleResena = cfg.google.resena;
    if (cfg.frecuente?.activo) { const f = await frecuenteDe(db, cfg, p.bazarId, p.telefono); if (f) o.frecuente = { compras: f.compras, cada: f.cada, pct: f.pct, faltan: f.aplica ? 0 : f.faltan }; }
    if (cfg.frecuente?.cumple && p.email) {
      const c = await db.collection('cumpleanos').findOne({ bazarId: p.bazarId, tel10: String(p.telefono || '').replace(/\D/g, '').slice(-10) }, { projection: { cumple: 1 } });
      o.cumple = { pct: cfg.frecuente.cumplePct, dado: !!c?.cumple };
    }
  } catch (_) {}
  return o;
}

// v42/v43 · Aprobar una transferencia (a mano desde el panel o sola si Banxico la confirmó)
async function aprobarSpei(db, p, por) {
  if (!['pendiente', 'expirado'].includes(p.estado)) return { status: 409, error: 'Ese pedido ya no está esperando pago.' };
  if (p.estado === 'expirado') {
    const ocupadas = await prendasTomadasPorOtro(db, p);
    if (ocupadas.length) return { status: 409, error: `El apartado venció y ya se vendió o apartó: ${ocupadas.map(x => x.nombre).join(', ')}. Devuélvele el dinero o cámbiale la prenda.` };
  }
  const pago = { id: 'spei-' + p.id, payment_type_id: 'spei', por };
  if (p.modalidad === 'apartado') await confirmarAnticipo(db, p, pago); else await confirmarPedido(db, p, pago);
  await db.collection('pendientes').updateMany({ tipo: 'spei', pedido: p.id }, { $set: { hecho: true } });
  const nuevo = await db.collection('pedidos').findOne({ id: p.id });
  return { estado: nuevo.estado, whatsapp: linkWA(p.telefono, `¡Hola ${String(p.nombre || '').split(' ')[0]}! ✅ Recibimos tu transferencia. Tu pedido ${p.id} ya está pagado.\n${urlPedido(p)}`) };
}

// v43 · Revisar el comprobante con IA + Banxico (y aprobar solo si así lo quiere la dueña)
async function revisarComprobante(db, p, cfg) {
  const { leerComprobante, verificarCEP, dictamen } = await import('./comprobante.js');
  const datos = { clabe: p.spei?.clabe, monto: p.spei?.monto || p.total };
  const lectura = await leerComprobante(p.speiComprobante.url);
  const cep = lectura && !lectura.error ? await verificarCEP(lectura, datos) : { estado: 'faltan datos', motivo: 'La IA no pudo leer el comprobante.' };
  const d = dictamen(lectura, cep, datos);
  const revision = { lectura, cep: { estado: cep.estado, monto: cep.monto || null, motivo: cep.motivo || '' }, ...d, en: new Date().toISOString() };
  await db.collection('pedidos').updateOne({ id: p.id }, { $set: { 'speiComprobante.revision': revision } });
  let aprobado = false;
  if (d.nivel === 'verde' && modulo(cfg, 'speiAuto') && p.estado === 'pendiente') {
    const r = await conBloqueoInterno(db, `pedido:${p.id}`, async () => aprobarSpei(db, await db.collection('pedidos').findOne({ id: p.id }), 'Banxico (automático)'));
    aprobado = !!r && !r.status;
    if (aprobado) await historialPedido(db, p, { accion: 'Transferencia confirmada por Banxico y aprobada sola', por: 'sistema', categoria: 'pago', tipo: 'spei.auto' });
  }
  await historialPedido(db, p, { accion: `Comprobante revisado: ${d.texto}`, por: 'sistema', categoria: 'pago', tipo: 'spei.revision' }).catch(() => {});
  return { revision, aprobado };
}
async function conBloqueoInterno(db, clave, fn) {
  const { tomarBloqueo, soltarBloqueo } = await import('./actividad.js');
  const t = await tomarBloqueo(db, clave, 60).catch(() => null);
  if (!t) return null;
  try { return await fn(); } finally { await soltarBloqueo(db, clave, t).catch(() => {}); }
}

// Lo que se muestra en "Mis pedidos" (sin datos personales)
const resumenPedido = p => ({
  id: p.id, en: p.en, estado: p.estado, total: p.total, pagadoEn: p.pagadoEn || null,
  modalidad: p.modalidad || 'completo', resta: p.estado === 'apartado' ? p.resta : 0, liquidarAntes: p.estado === 'apartado' ? p.liquidarAntes || null : null,
  entrega: p.entrega || (p.envio ? 'envio' : 'persona'), entregaEstado: p.entregaEstado || 'pendiente',
  punto: p.punto?.nombre || '', paqueteria: p.envioDetalle?.paqueteria || p.paqueteria || '', guia: p.guia || '',
  items: (p.items || []).filter(x => x.id !== 'envio').map(x => ({ nombre: x.nombre, imagen: x.imagen || '' })),
});

// Se califica cuando ya se entregó (o 5 días después de pagar, por si no se marcó)
const puedeResenar = p => p.estado === 'pagado' && !p.resena && (p.entregaEstado === 'entregado' || (p.pagadoEn && Date.now() - new Date(p.pagadoEn) > 5 * 24 * HORA));

async function resenaPedido(req, res, db) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!(await rateLimit(req, res, { key: 'v-resena', max: 20, windowSec: 3600 }))) return;
  const b = req.body || {};
  const pedido = await db.collection('pedidos').findOne({ id: String(b.id || '').slice(0, 40) });
  if (!pedido || !esDueno(pedido, b.k)) return res.status(404).json({ error: 'Pedido no encontrado.' });
  if (pedido.resena) return res.status(409).json({ error: 'Ya calificaste este pedido. ¡Gracias!' });
  if (!puedeResenar(pedido) || !modulo(await leerConfigTienda(db, pedido.bazarId), 'resenas')) return res.status(400).json({ error: 'Podrás calificar cuando recibas tu pedido.' });
  const estrellas = Math.round(Number(b.estrellas));
  if (!(estrellas >= 1 && estrellas <= 5)) return res.status(400).json({ error: 'Elige de 1 a 5 estrellas.' });
  const etiquetas = (Array.isArray(b.etiquetas) ? b.etiquetas : []).map(e => texto(e, 40)).filter(e => ETIQUETAS_BAZAR.includes(e));
  const ventas = await db.collection('ventas').find({ pedido: pedido.id }).toArray();
  const v = ventas[0];
  if (!v) return res.status(400).json({ error: 'Este pedido no tiene prendas entregadas.' });
  // v42: hasta 3 fotos (el navegador ya las achicó). Se publican cuando la dueña las aprueba.
  const fotosIn = (Array.isArray(b.fotos) ? b.fotos : []).slice(0, 3);
  let fotos = [];
  if (fotosIn.length) {
    const { imagenValida, subirImagen } = await import('./nube.js');
    for (const f of fotosIn) { const malo = imagenValida(f); if (malo) return res.status(400).json({ error: malo }); }
    try { fotos = await Promise.all(fotosIn.map(f => subirImagen(f, 'stiimpys/resenas'))); }
    catch (e) { return res.status(e.status || 502).json({ error: e.message }); }
  }
  const partes = String(pedido.nombre || '').trim().split(/\s+/);
  const autor = partes.length > 1 ? `${partes[0]} ${partes[1][0].toUpperCase()}.` : partes[0] || 'Cliente';
  const resena = { id: await siguienteId('resenas'), ventaId: v.id, tipo: 'bazar', bazarId: Number(pedido.bazarId || 1), prendaId: v.prendaId,
    prendaNombre: v.prenda?.nombre || pedido.items?.[0]?.nombre || '', autor, destino: '', estrellas, etiquetas,
    comentario: texto(b.comentario, 500), creadoEn: new Date(), verificada: true, pedido: pedido.id, ...(fotos.length ? { fotos, fotosOk: false } : {}) };
  try { await db.collection('resenas').insertOne(resena); }
  catch (e) { if (e?.code === 11000) return res.status(409).json({ error: 'Ya calificaste este pedido. ¡Gracias!' }); throw e; }
  await db.collection('pedidos').updateOne({ id: pedido.id }, { $set: { resena: { estrellas, en: new Date().toISOString() } } });
  await db.collection('ventas').updateMany({ pedido: pedido.id }, { $set: { resenaBazar: true } });
  await pendiente(db, pedido.bazarId, 'resena', `${'⭐'.repeat(estrellas)} ${autor} calificó su compra${resena.comentario ? `: "${resena.comentario.slice(0, 140)}"` : '.'}`,
    { pedido: pedido.id, titulo: fotos.length ? `Reseña con ${fotos.length} foto${fotos.length > 1 ? 's' : ''}` : 'Reseña nueva', cliente: autor, estrellas,
      detalle: resena.comentario ? resena.comentario.slice(0, 280) : '', ...(fotos.length ? { resenaId: resena.id, fotos } : {}) }).catch(() => {});
  invalidarSyncCache();
  return res.status(200).json({ ok: true, estrellas, fotos: fotos.length, revision: fotos.length > 0 });
}

// ── Pagos sin terminar: avisar para recuperar la venta ─────────
async function avisarRecuperar(db, pedido) {
  const prendas = await db.collection('inventario').find({ id: { $in: (pedido.ids || []).map(Number) } }).toArray();
  const siguen = prendas.filter(p => !p.vendido && !p.oculto && (!p.apartada || p.reservedBy?.pedido === pedido.id));
  if (!siguen.length) return;
  // Si ya compró esas prendas en otro pedido (o lo está pagando), no se le escribe
  const otro = await db.collection('pedidos').findOne({ telefono: pedido.telefono, estado: { $in: ['pendiente', 'pagado'] }, id: { $ne: pedido.id } });
  if (otro && new Date(otro.en) > new Date(pedido.en)) return;
  const n = siguen.length, primero = String(pedido.nombre || '').split(' ')[0];
  const link = `${SITIO()}/pagar.html?bazar=${pedido.bazarId}&ids=${siguen.map(p => p.id).join(',')}`;
  const lista = siguen.slice(0, 3).map(p => `"${p.nombre}"`).join(', ') + (n > 3 ? ` y ${n - 3} más` : '');
  const msg = `¡Hola ${primero}! 👋 Vimos que tu pago en Stiimpys no se terminó. ${lista} ${n === 1 ? 'sigue disponible' : 'siguen disponibles'}, pero ${n === 1 ? 'es pieza única' : 'son piezas únicas'}.\n\nSi todavía ${n === 1 ? 'la' : 'las'} quieres, aquí terminas tu compra:\n${link}\n\n¿Te ayudo con algo? 🙌`;
  await db.collection('pedidos').updateOne({ id: pedido.id }, { $set: { recuperar: true } });
  await pendiente(db, pedido.bazarId, 'recuperar', `🛒 ${pedido.nombre} no terminó de pagar ${pesos(pedido.total)} (${n} ${n === 1 ? 'prenda' : 'prendas'}). Escríbele antes de que alguien más ${n === 1 ? 'la' : 'las'} compre.`, { whatsapp: linkWA(pedido.telefono, msg), pedido: pedido.id,
    titulo: 'Pago sin terminar', cliente: pedido.nombre, monto: pedido.total, prendas: siguen.map(p => p.nombre).slice(0, 6),
    detalle: `Escríbele antes de que alguien más ${n === 1 ? 'la' : 'las'} compre.` });
}

// ═════════════════════════════════════════════════════════════
//  Catálogo para Meta (Instagram Shopping / anuncios) y Google
// ═════════════════════════════════════════════════════════════
async function feed(req, res, db) {
  const bazar = req.query.bazar ? await db.collection('bazares').findOne({ slug: String(req.query.bazar) }) : null;
  const filtro = bazar ? { bazarId: bazar.id } : {};
  const deAqui = await filtroTienda(db);
  const lista = (await db.collection('inventario').find(filtro).toArray())
    .filter(p => deAqui(p) && !p.oculto && (p.imagenes || []).length && (!p.vendido || (p.vendidoEn && Date.now() - new Date(p.vendidoEn) < 15 * DIA)));
  const csv = v => `"${String(v ?? '').replace(/"/g, '""').replace(/\s+/g, ' ').trim()}"`;
  // v43: versión para Google Merchant Center (?formato=google), con su interruptor
  const google = req.query.formato === 'google';
  if (google && !modulo(await leerConfigTienda(db, bazar?.id || 1), 'feedGoogle')) return res.status(404).send('Catálogo para Google apagado (Ventas → Módulos).');
  const filas = [['id', 'title', 'description', 'availability', 'condition', 'price', 'sale_price', 'link', 'image_link', 'additional_image_link', 'brand', 'size', 'product_type',
    ...(google ? ['google_product_category', 'identifier_exists', 'age_group'] : [])].join(',')];
  for (const p of lista) {
    const antes = Number(p.precioAnterior) > Number(p.precio_venta) ? Number(p.precioAnterior) : null;
    filas.push([
      p.id, texto(p.nombre, 150), texto(p.descripcion || `${p.nombre}${p.marca ? ' de ' + p.marca : ''}. Talla ${p.talla || 'única'}. Estado ${p.estado || 'bueno'}. Pieza única.`, 5000),
      p.vendido ? 'out of stock' : 'in stock', /nueva/i.test(p.estado || '') ? 'new' : 'used',
      `${(antes || Number(p.precio_venta) || 0).toFixed(2)} MXN`, antes ? `${Number(p.precio_venta).toFixed(2)} MXN` : '',
      `${SITIO()}/prenda.html?id=${p.id}`, (p.imagenes || [])[0], (p.imagenes || []).slice(1, 10).join(','),
      p.marca || 'Stiimpys', String(p.talla || '').split('·')[0].trim(), (p.categorias || []).join(' > '),
      ...(google ? [/tenis|zapat|bota/i.test((p.categorias || []).join(' ') + ' ' + p.nombre) ? '187' : /gorra|bolsa|mochila|cintur|lentes|accesorio/i.test((p.categorias || []).join(' ') + ' ' + p.nombre) ? '167' : '1604', 'no', 'adult'] : []),
    ].map(csv).join(','));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, max-age=600');
  return res.status(200).send(filas.join('\n'));
}

// ═════════════════════════════════════════════════════════════
//  Corte de caja, métricas y respaldo
// ═════════════════════════════════════════════════════════════
async function corte(req, res, db, user, bazarId) {
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(req.query.dia || '') ? req.query.dia : hoyMx();
  const ini = new Date(`${dia}T06:00:00.000Z`), fin = new Date(ini.getTime() + DIA);
  const filtro = esGlobal(user) && !req.query.bazarId ? {} : { bazarId };
  const ventas = (await db.collection('ventas').find(filtro).toArray()).filter(v => new Date(v.fecha) >= ini && new Date(v.fecha) < fin);
  const inv = await db.collection('inventario').find(filtro).toArray();
  const ofertas = (await db.collection('ofertas').find(filtro).toArray()).filter(o => o.en >= ini.toISOString() && o.en < fin.toISOString());
  const total = ventas.reduce((t, v) => t + (Number(v.precio) || 0), 0);
  const costo = ventas.reduce((t, v) => t + (Number(v.costo) || 0), 0);
  const porCanal = {};
  ventas.forEach(v => { const k = ['clip', 'paypal', 'mercadopago'].includes(v.canal) ? `Pago en línea (${nombreMetodo(v.canal)})` : v.canal === 'apartado' ? 'Apartado liquidado en persona' : 'En persona / transferencia'; porCanal[k] = (porCanal[k] || 0) + (Number(v.precio) || 0); });
  const ahora = new Date().toISOString();
  // v41: costo y ganancia solo para administradores
  const verCosto = user.role === 'admin';
  return res.status(200).json({
    dia, ventas: ventas.map(v => ({ id: v.id, nombre: v.prenda?.nombre, precio: v.precio, ...(verCosto ? { costo: v.costo } : {}), canal: v.canal || 'panel', comprador: v.comprador || v.clienteNombre || '', vendedor: v.vendedor })),
    total, ...(verCosto ? { costo, ganancia: total - costo } : {}), porCanal,
    nuevas: inv.filter(p => p.creadoEn >= ini.toISOString() && p.creadoEn < fin.toISOString()).length,
    apartadas: inv.filter(p => p.apartada && !p.vendido && p.reservedUntil > ahora).map(p => ({ id: p.id, nombre: p.nombre, hasta: p.reservedUntil, quien: p.reservedBy?.nombre || '' })),
    ofertas: ofertas.length, disponibles: inv.filter(p => !p.vendido && !p.oculto).length,
    // Dinero de apartados que entró ese día (anticipos); la venta cuenta completa el día que se liquida
    anticipos: (await db.collection('pedidos').find({ ...filtro, modalidad: 'apartado' }).toArray())
      .filter(p => p.anticipoPagadoEn >= ini.toISOString() && p.anticipoPagadoEn < fin.toISOString())
      .map(p => ({ id: p.id, nombre: p.nombre, monto: p.anticipo, resta: p.estado === 'apartado' ? p.resta : 0, proveedor: (p.pagos || [])[0]?.proveedor || p.proveedor || 'clip' })),
  });
}

async function metricas(req, res, db, user, bazarId) {
  const desde = hoyMx(Date.now() - 30 * DIA);
  const inv = await db.collection('inventario').find(esGlobal(user) && !req.query.bazarId ? {} : { bazarId }).toArray();
  const ids = new Set(inv.map(p => p.id));
  // Solo los últimos 30 días desde la base (antes se leía la colección entera, que crece cada día)
  const stats = (await db.collection('prendaStats').find({ dia: { $gte: desde } }).toArray()).filter(s => ids.has(s.prendaId));
  const suma = new Map();
  for (const s of stats) {
    const x = suma.get(s.prendaId) || { vista: 0, wa: 0, bolsa: 0, oferta: 0, compartir: 0 };
    for (const k of Object.keys(x)) x[k] += s[k] || 0;
    suma.set(s.prendaId, x);
  }
  const filas = inv.map(p => {
    const s = suma.get(p.id) || { vista: 0, wa: 0, bolsa: 0, oferta: 0, compartir: 0 };
    const dias = p.creadoEn ? Math.round(((p.vendido ? new Date(p.vendidoEn) : Date.now()) - new Date(p.creadoEn)) / DIA) : null;
    return { id: p.id, nombre: p.nombre, foto: (p.imagenes || [])[0] || '', precio: p.precio_venta, vendido: !!p.vendido, dias, ig: !!p.instagramId, ...s,
      interes: s.wa + s.bolsa * 0.5 + s.oferta * 2 };
  }).filter(f => f.vista || f.wa || f.bolsa || f.oferta || !f.vendido);
  const disponibles = filas.filter(f => !f.vendido);
  const ideas = [];
  const vistasSinInteres = disponibles.filter(f => f.vista >= 25 && f.interes === 0).sort((a, b) => b.vista - a.vista).slice(0, 5);
  if (vistasSinInteres.length) ideas.push({ tipo: 'precio', texto: 'Muchas visitas pero nadie pregunta: prueba bajarles un poco el precio o mejorar la foto de portada.', ids: vistasSinInteres.map(f => f.id) });
  const calientes = disponibles.filter(f => f.interes >= 3).sort((a, b) => b.interes - a.interes).slice(0, 5);
  if (calientes.length) ideas.push({ tipo: 'calientes', texto: 'Prendas con mucho interés: súbelas a historias hoy, se pueden ir rápido.', ids: calientes.map(f => f.id) });
  const sinIG = disponibles.filter(f => !f.ig).length;
  if (sinIG) ideas.push({ tipo: 'ig', texto: `${sinIG} prenda(s) disponibles no tienen post en Instagram. Prográmalas para que más gente las vea.` });
  const vendidas = filas.filter(f => f.vendido && f.dias != null);
  // v42 · De dónde vienen las ventas (30 días): visitas por fuente, ventas y dinero
  const filtroB = esGlobal(user) && !req.query.bazarId ? {} : { bazarId };
  const hace30 = new Date(Date.now() - 30 * DIA);
  const [visitasO, ventas30] = await Promise.all([
    db.collection('origenStats').find({ dia: { $gte: desde } }).toArray(),
    db.collection('ventas').find({ ...filtroB, anulada: { $ne: true } }, { projection: { fecha: 1, precio: 1, canal: 1, origen: 1, pedido: 1, ticket: 1 } }).toArray(),
  ]);
  const porFuente = new Map();
  const fila = f => { if (!porFuente.has(f)) porFuente.set(f, { fuente: f, visitas: 0, ventas: 0, prendas: 0, dinero: 0, _p: new Set() }); return porFuente.get(f); };
  for (const v of visitasO) fila(v.fuente).visitas += v.visitas || 0;
  for (const v of ventas30) {
    if (!(new Date(v.fecha) >= hace30)) continue;
    const f = v.canal === 'bazar' ? 'bazar en persona' : v.pedido ? (v.origen || 'directo') : 'panel (WhatsApp/DM)';
    const x = fila(f); x.prendas++; x.dinero += Number(v.precio) || 0; x._p.add(v.pedido || v.ticket || v.id);
  }
  const origenes = [...porFuente.values()].map(({ _p, ...x }) => ({ ...x, ventas: _p.size, conversion: x.visitas ? Math.round(_p.size / x.visitas * 1000) / 10 : null }))
    .sort((a, b) => b.dinero - a.dinero || b.visitas - a.visitas);
  return res.status(200).json({ origenes,
    filas: filas.sort((a, b) => b.vista - a.vista).slice(0, 200), ideas,
    totales: { vista: filas.reduce((t, f) => t + f.vista, 0), wa: filas.reduce((t, f) => t + f.wa, 0), bolsa: filas.reduce((t, f) => t + f.bolsa, 0), oferta: filas.reduce((t, f) => t + f.oferta, 0) },
    diasPromedio: vendidas.length ? Math.round(vendidas.reduce((t, f) => t + f.dias, 0) / vendidas.length) : null,
  });
}

const CSV = (filas, cols) => [cols.join(','), ...filas.map(f => cols.map(c => `"${String(Array.isArray(f[c]) ? f[c].join(' | ') : f[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');

async function respaldo(req, res, db, user, bazarId) {
  if (user.role !== 'admin') return res.status(403).json({ error: 'Solo un administrador descarga respaldos.' });
  const filtro = esGlobal(user) && !req.query.bazarId ? {} : { bazarId };
  const sin = ({ _id, ...x }) => x;
  const inventario = (await db.collection('inventario').find(filtro).toArray()).map(sin);
  const ventas = (await db.collection('ventas').find(filtro).toArray()).map(v => ({ ...sin(v), prendaNombre: v.prenda?.nombre, prenda: undefined }));
  const que = req.query.que || 'todo', formato = req.query.formato === 'csv' ? 'csv' : 'json';
  const fecha = hoyMx();
  if (formato === 'csv') {
    const datos = que === 'ventas'
      ? CSV(ventas, ['id', 'fecha', 'prendaId', 'prendaNombre', 'precio', 'costo', 'comprador', 'clienteNombre', 'vendedor', 'canal'])
      : CSV(inventario, ['id', 'nombre', 'marca', 'categorias', 'talla', 'estado', 'precio_venta', 'precioAnterior', 'costo', 'vendido', 'vendidoEn', 'creadoEn', 'descripcion', 'imagenes']);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="stiimpys-${que === 'ventas' ? 'ventas' : 'inventario'}-${fecha}.csv"`);
    return res.status(200).send('﻿' + datos);       // BOM: Excel abre bien los acentos
  }
  res.setHeader('Content-Disposition', `attachment; filename="stiimpys-respaldo-${fecha}.json"`);
  return res.status(200).json({ fecha, inventario, ventas });
}

// Copia semanal automática (la llama el cron diario)
export async function respaldoSemanal(db, bazarId) {
  const col = db.collection('respaldos');
  const ult = (await col.find({ bazarId }).sort({ en: -1 }).limit(1).toArray())[0];
  if (ult && Date.now() - new Date(ult.en) < 6.5 * DIA) return null;
  const sin = ({ _id, ...x }) => x;
  const doc = { id: crypto.randomBytes(5).toString('hex'), bazarId, en: new Date().toISOString(),
    inventario: (await db.collection('inventario').find({ bazarId }).toArray()).map(sin),
    ventas: (await db.collection('ventas').find({ bazarId }).toArray()).map(v => { const { _id, prenda, ...x } = v; return { ...x, prendaNombre: prenda?.nombre }; }) };
  await col.insertOne(doc);
  const viejos = await col.find({ bazarId }).sort({ en: -1 }).toArray();
  for (const v of viejos.slice(8)) await col.deleteOne({ id: v.id });
  return doc;
}

// ═════════════════════════════════════════════════════════════
//  Avisos de lista de espera (los corre el automático)
// ═════════════════════════════════════════════════════════════
export async function avisarListaEspera(db, bazar) {
  const espera = db.collection('listaEspera'), inv = db.collection('inventario');
  const lista = await espera.find({ bazarId: bazar.id, avisado: false }).toArray();
  if (!lista.length) return [];
  const prendas = await inv.find({ bazarId: bazar.id }).toArray();
  const sitio = SITIO();
  const hechos = [];
  for (const e of lista) {
    if (Date.now() - new Date(e.en) > 60 * DIA) { await espera.updateOne({ id: e.id }, { $set: { avisado: true, vencido: true } }); continue; }
    if (e.tipo === 'prenda') {
      const p = prendas.find(x => x.id === e.prendaId);
      if (!p) continue;
      if (p.vendido) {
        // Se vendió: ofrecer algo parecido en su talla
        const parecidas = prendas.filter(x => libre(x) && x.id !== p.id && tallaBase(x.talla) === tallaBase(p.talla)).slice(0, 3);
        if (!parecidas.length) continue;
        hechos.push(await pendiente(db, bazar.id, 'interesado', `${e.nombre} quería "${p.nombre}" (ya se vendió). Hay ${parecidas.length} parecida(s) en su talla.`, {
          whatsapp: linkWA(e.telefono, `¡Hola ${e.nombre}! "${p.nombre}" ya se vendió 😔 pero tenemos esto en tu talla:\n${parecidas.map(x => `• ${x.nombre} ${pesos(x.precio_venta)} ${sitio}/prenda.html?id=${x.id}`).join('\n')}`),
          titulo: 'Hay parecidas en su talla', cliente: e.nombre, detalle: `Quería "${p.nombre}", que ya se vendió. Tienes ${parecidas.length} parecida${parecidas.length === 1 ? '' : 's'} en su talla.` }));
        await espera.updateOne({ id: e.id }, { $set: { avisado: true, avisadoEn: new Date().toISOString() } });
      } else if (libre(p)) {
        hechos.push(await pendiente(db, bazar.id, 'interesado', `"${p.nombre}" se liberó y ${e.nombre} la estaba esperando.`, {
          whatsapp: linkWA(e.telefono, `¡Hola ${e.nombre}! 🙌 "${p.nombre}" volvió a estar disponible (${pesos(p.precio_venta)}). ¿Te la apartamos?\n${sitio}/prenda.html?id=${p.id}`),
          titulo: 'Se liberó una prenda', cliente: e.nombre, monto: Number(p.precio_venta) || null, detalle: `"${p.nombre}" volvió a estar disponible y la estaba esperando.` }));
        await espera.updateOne({ id: e.id }, { $set: { avisado: true, avisadoEn: new Date().toISOString() } });
      }
    } else if (e.tipo === 'drop') {
      if (new Date(e.fecha) > Date.now()) continue;
      hechos.push(await pendiente(db, bazar.id, 'interesado', `Ya salió el drop "${e.dropNombre}": avísale a ${e.nombre}.`, {
        whatsapp: linkWA(e.telefono, `¡Hola ${e.nombre}! 🔥 Ya salió el drop "${e.dropNombre}". Corre que son piezas únicas: ${sitio}/tienda.html`),
        titulo: 'Ya salió el drop', cliente: e.nombre, detalle: `Pidió aviso del drop "${e.dropNombre}".` }));
      await espera.updateOne({ id: e.id }, { $set: { avisado: true, avisadoEn: new Date().toISOString() } });
    } else {
      const desde = e.ultimoAviso || e.en;
      const coinciden = prendas.filter(p => libre(p) && (p.creadoEn || '') > desde
        && (!e.talla || tallaBase(p.talla) === tallaBase(e.talla))
        && (!e.marca || norm(p.marca) === norm(e.marca))
        && (!e.categoria || (p.categorias || []).map(norm).includes(norm(e.categoria)))).slice(0, 5);
      if (!coinciden.length) continue;
      const que = [e.categoria, e.marca, e.talla && `talla ${e.talla}`].filter(Boolean).join(' ');
      hechos.push(await pendiente(db, bazar.id, 'interesado', `Llegó lo que buscaba ${e.nombre} (${que}): ${coinciden.length} prenda(s).`, {
        whatsapp: linkWA(e.telefono, `¡Hola ${e.nombre}! Llegó lo que buscabas (${que}) 🙌\n${coinciden.map(x => `• ${x.nombre} ${pesos(x.precio_venta)} ${sitio}/prenda.html?id=${x.id}`).join('\n')}`),
        titulo: 'Llegó lo que buscaba', cliente: e.nombre, detalle: `Buscaba ${que}: ${coinciden.length} prenda${coinciden.length === 1 ? '' : 's'} nueva${coinciden.length === 1 ? '' : 's'}.` }));
      await espera.updateOne({ id: e.id }, { $set: { ultimoAviso: new Date().toISOString() } });
    }
  }
  return hechos;
}

// Apartado vencido de un pedido en línea: antes de liberar se revisa si sí
// pagó (por si el aviso de Clip no llegó o el cliente de PayPal no regresó). Devuelve true si se pagó.
// Si paga después de vencido, confirmarPedido lo registra igual (y avisa si la
// prenda ya se había vendido para devolverle el dinero).
export async function cerrarPedidoVencido(db, pedidoId) {
  const pedido = await db.collection('pedidos').findOne({ id: pedidoId });
  if (!pedido) return false;
  if (['pagado', 'apartado'].includes(pedido.estado)) return true;
  try { if (['pagado', 'apartado'].includes(await revisarPagoDePedido(db, pedido))) return true; } catch {}
  const r = await db.collection('pedidos').updateOne({ id: pedidoId, estado: 'pendiente' }, { $set: { estado: 'expirado' } });
  if (r?.modifiedCount) await historialPedido(db, pedido, { de: 'pendiente', a: 'expirado', accion: `El pago no se terminó y venció (se revisó con ${nombreMetodo(pedido.proveedor)})`, tipo: 'pedido.expirado', resultado: 'info' });
  if (r?.modifiedCount && !pedido.recuperar) {
    try { if (modulo(await leerConfigTienda(db, pedido.bazarId), 'recuperarPagos')) await avisarRecuperar(db, pedido); } catch (e) { console.error('[recuperar]', e); }
  }
  return false;
}

// Al quedar un usuario con permisos restringidos (lo usa inventario-item y acciones)
export async function permisosDe(db, user) {
  if (!user || user.role !== 'vendedor') return { borrar: true, precios: true };
  const u = await db.collection('usuarios').findOne({ id: user.id });
  return { borrar: u?.permisos?.borrar !== false, precios: u?.permisos?.precios !== false };
}
export { getUser };
