// js/opciones.js
// Listas predefinidas de condición y talla. Se usan en el panel (al registrar
// y al editar) y en los filtros de la tienda, para que todo el catálogo hable
// el mismo idioma.

// ─── CONDICIÓN ───────────────────────────────────────────────
// De mejor a peor. El orden se respeta en los filtros de la tienda.
const ESTADOS = [
  'Nueva',
  'Nueva con etiqueta',
  '10/10',
  '9/10',
  '8/10',
  '7/10',
  '6/10',
  '5/10',
  'Con mucho desgaste',
];

// Posición de un estado para ordenarlo (los que no están en la lista van al final)
function ordenEstado(estado) {
  const i = ESTADOS.indexOf(String(estado || '').trim());
  return i === -1 ? 999 : i;
}

// ─── TALLAS ──────────────────────────────────────────────────
// Agrupadas por tipo. La etiqueta que se guarda es el texto tal cual.
const TALLAS = [
  {
    grupo: 'Hombre',
    opciones: ['XS Hombre', 'S Hombre', 'M Hombre', 'L Hombre', 'XL Hombre', 'XXL Hombre', 'XXXL Hombre'],
  },
  {
    grupo: 'Mujer',
    opciones: ['XS Mujer', 'S Mujer', 'M Mujer', 'L Mujer', 'XL Mujer', 'XXL Mujer'],
  },
  {
    grupo: 'Mujer (numérica)',
    opciones: ['1', '3', '5', '7', '9', '11', '13', '15'],
  },
  {
    grupo: 'Pantalón (cintura)',
    opciones: ['26', '28', '29', '30', '31', '32', '33', '34', '36', '38', '40', '42'],
  },
  {
    grupo: 'Calzado (MX)',
    opciones: ['22', '23', '24', '25', '25.5', '26', '26.5', '27', '27.5', '28', '29', '30'],
  },
  {
    grupo: 'Sin talla definida',
    opciones: ['Unitalla', 'Talla única', 'Ajustable'],
  },
];

// Todas las tallas en una sola lista
const TALLAS_PLANAS = TALLAS.flatMap(g => g.opciones);

// ─── AJUSTE / CORTE ──────────────────────────────────────────
// Se agrega después de la talla para describir cómo queda de verdad.
// Ej. "XL Hombre · Queda como M" o "M Hombre · Oversize".
const AJUSTES = [
  'Oversize',
  'Slim / entallado',
  'Baggy / holgado',
  'Crop / corta',
  'Larga',
  'Encoge al lavar',
];

// Tallas a las que se puede decir "queda como"
const QUEDA_COMO = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

// Une talla + ajuste en el texto que se guarda en la prenda
function componerTalla(base, ajuste, quedaComo) {
  const partes = [String(base || '').trim()];
  if (quedaComo) partes.push(`Queda como ${quedaComo}`);
  if (ajuste)    partes.push(ajuste);
  return partes.filter(Boolean).join(' · ');
}

// Separa un texto guardado en sus partes, para volver a llenar el formulario
function descomponerTalla(texto) {
  const partes = String(texto || '').split('·').map(t => t.trim()).filter(Boolean);
  const out = { base: partes[0] || '', quedaComo: '', ajuste: '' };
  partes.slice(1).forEach(p => {
    const m = p.match(/^Queda como\s+(.+)$/i);
    if (m) out.quedaComo = m[1].trim();
    else   out.ajuste = p;
  });
  return out;
}

// A qué grupo pertenece una talla (para agrupar los filtros de la tienda)
function grupoDeTalla(talla) {
  const t = String(talla || '').trim();
  const base = t.split('·')[0].trim();
  const g = TALLAS.find(x => x.opciones.includes(base));
  if (g) return g.grupo;
  // Las tallas viejas (M, L, 32) se acomodan por su forma
  if (/^\d+(\.\d+)?$/.test(base)) return 'Numérica';
  if (/^(x*s|m|l|x*l)$/i.test(base)) return 'General';
  return 'Otras';
}

// Orden dentro de un grupo: primero por la escala de letras, luego numérico
const ESCALA_LETRAS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
function ordenTalla(talla) {
  const base = String(talla || '').split('·')[0].trim();
  const num = parseFloat(base);
  if (!isNaN(num) && /^\d/.test(base)) return 1000 + num;
  const letras = base.replace(/\s*(hombre|mujer)\s*/i, '').toUpperCase();
  const i = ESCALA_LETRAS.indexOf(letras);
  return i === -1 ? 2000 : i;
}

// ─── LECTURA DE LA TALLA ─────────────────────────────────────
// Una talla se guarda como "XL Hombre · Oversize": la base, y detrás los
// matices. En una tarjeta solo cabe la base; el resto va en el título o
// en la ficha. Vive aquí, junto al resto del vocabulario, porque lo usan
// por igual la tienda, la portada y la ficha de la prenda.

// "XL Hombre · Oversize"  →  "XL"
function etiquetaTalla(t) {
  const base = String(t || '').split('·')[0].trim();
  return base.replace(/\s*(Hombre|Mujer)\s*/i, '').trim() || base;
}

// "XL Hombre · Oversize"  →  ["Oversize"]
function detallesTalla(t) {
  return String(t || '').split('·').slice(1).map(x => x.trim()).filter(Boolean);
}
