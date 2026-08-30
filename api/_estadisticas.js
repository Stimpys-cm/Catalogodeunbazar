// api/_estadisticas.js
// ─────────────────────────────────────────────────────────────
// Ganancias por bazar, agrupadas por mes y por semana.
//
// Se calculan sobre la colección 'ventas', que guarda el precio y el
// costo congelados en el momento de la venta. Por eso editar una prenda
// hoy no cambia la ganancia de una venta de hace tres meses.
//
// Las ventas anteriores a ese cambio no traen costo: para ésas se busca
// el costo actual de la prenda como aproximación, y se avisa de cuántas
// fueron para que el número no se lea como exacto.
// ─────────────────────────────────────────────────────────────

import { getDB } from './_db.js';

const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Lunes de la semana a la que pertenece una fecha
function lunesDe(fecha) {
  const d = new Date(fecha);
  d.setHours(0, 0, 0, 0);
  const dia = (d.getDay() + 6) % 7;   // 0 = lunes
  d.setDate(d.getDate() - dia);
  return d;
}

const claveMes    = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const etiquetaMes = d => `${MESES[d.getMonth()]} ${d.getFullYear()}`;

function etiquetaSemana(lunes) {
  const domingo = new Date(lunes);
  domingo.setDate(domingo.getDate() + 6);
  const mismoMes = lunes.getMonth() === domingo.getMonth();
  return mismoMes
    ? `${lunes.getDate()}–${domingo.getDate()} ${MESES[lunes.getMonth()]}`
    : `${lunes.getDate()} ${MESES[lunes.getMonth()]} – ${domingo.getDate()} ${MESES[domingo.getMonth()]}`;
}

const vacio = () => ({ ingresos: 0, costo: 0, ganancia: 0, unidades: 0 });

function sumar(acc, ingreso, costo) {
  acc.ingresos += ingreso;
  acc.costo    += costo;
  acc.ganancia += ingreso - costo;
  acc.unidades += 1;
}

// Genera los últimos N periodos aunque no tengan ventas: una gráfica con
// huecos miente sobre el ritmo del negocio.
function periodosRecientes(n, tipo) {
  const salida = [];
  const hoy = new Date();
  for (let i = n - 1; i >= 0; i--) {
    if (tipo === 'mes') {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      salida.push({ clave: claveMes(d), etiqueta: etiquetaMes(d), ...vacio() });
    } else {
      const d = lunesDe(hoy);
      d.setDate(d.getDate() - i * 7);
      salida.push({ clave: d.toISOString().slice(0, 10), etiqueta: etiquetaSemana(d), ...vacio() });
    }
  }
  return salida;
}

export async function calcularEstadisticas({ bazares, meses = 12, semanas = 12 }) {
  const db = await getDB();
  const ids = bazares.map(b => Number(b.id));

  const ventas = await db.collection('ventas')
    .find({ bazarId: { $in: ids } })
    .sort({ fecha: -1 })
    .limit(20000)
    .toArray();

  // Costo de respaldo para las ventas viejas que no lo guardaron
  const sinCosto = ventas.filter(v => v.costo == null).map(v => v.prendaId);
  const costoActual = new Map();
  if (sinCosto.length) {
    const prendas = await db.collection('inventario')
      .find({ id: { $in: sinCosto } }, { projection: { id: 1, costo: 1 } })
      .toArray();
    prendas.forEach(p => costoActual.set(p.id, num(p.costo)));
  }

  const porBazar = new Map();
  for (const b of bazares) {
    porBazar.set(Number(b.id), {
      id: Number(b.id), nombre: b.nombre, slug: b.slug, color: b.color || '',
      total: vacio(),
      meses:   periodosRecientes(meses, 'mes'),
      semanas: periodosRecientes(semanas, 'semana'),
      ventasSinCosto: 0,
      ultimaVenta: null,
    });
  }

  for (const v of ventas) {
    const bz = porBazar.get(Number(v.bazarId));
    if (!bz) continue;

    const fecha   = new Date(v.fecha || Date.now());
    const ingreso = num(v.precio ?? v.prenda?.precio);
    let costo     = v.costo;
    if (costo == null) { costo = costoActual.get(v.prendaId) ?? 0; bz.ventasSinCosto++; }
    costo = num(costo);

    sumar(bz.total, ingreso, costo);
    if (!bz.ultimaVenta || fecha > new Date(bz.ultimaVenta)) bz.ultimaVenta = fecha.toISOString();

    const mes = bz.meses.find(m => m.clave === claveMes(fecha));
    if (mes) sumar(mes, ingreso, costo);

    const sem = bz.semanas.find(s => s.clave === lunesDe(fecha).toISOString().slice(0, 10));
    if (sem) sumar(sem, ingreso, costo);
  }

  return {
    bazares: [...porBazar.values()].sort((a, b) => b.total.ingresos - a.total.ingresos),
    generado: new Date().toISOString(),
    ventasConsideradas: ventas.length,
  };
}
