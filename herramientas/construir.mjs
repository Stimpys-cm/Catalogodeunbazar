// ─────────────────────────────────────────────────────────────
//  herramientas/construir.mjs — junta y comprime el CSS y el JS de cada página
//
//  Cada página del sitio carga UN archivo de estilos (css/dist/<página>.css)
//  y uno o dos de código (js/dist/<página>.js). Esos archivos se arman aquí
//  a partir de los originales, en el orden exacto que dice
//  herramientas/paquetes.json.
//
//  Uso (desde la carpeta del proyecto):
//    npm install            (una vez: instala esbuild, solo para construir)
//    npm run construir      → vuelve a armar css/dist y js/dist y pone la
//                             versión nueva (?v=…) en las páginas .html
//    npm run revisar        → no cambia nada; avisa si algún paquete quedó
//                             viejo (si se editó un original y no se construyó)
//
//  Regla de oro: se editan los originales (css/comun, css/tienda, css/panel,
//  js/comun, js/tienda, js/panel), NUNCA lo que está en css/dist ni js/dist.
//  Después de editar: npm run construir. Las pruebas (node pruebas/correr.mjs)
//  fallan si alguien se olvidó de construir.
//
//  Para agregar un archivo a una página: escríbelo en paquetes.json, en el
//  lugar que le toca (el orden importa igual que importaba en el HTML).
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVISAR = process.argv.includes('--revisar');
const paquetes = JSON.parse(fs.readFileSync(path.join(RAIZ, 'herramientas/paquetes.json'), 'utf8'));

let esbuild;
try { esbuild = await import('esbuild'); }
catch { console.error('Falta esbuild. Corre primero: npm install'); process.exit(1); }

const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
const huella = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);

// Comprime cada archivo por separado (así una regla de un archivo nunca se
// mezcla con otra de otro y el orden de la cascada queda idéntico) y los pega
// en orden. El mapa (.map) apunta a cada original, para depurar en el navegador.
async function armar(salida, fuentes) {
  const tipo = salida.endsWith('.css') ? 'css' : 'js';
  const partes = [];
  const secciones = [];
  let linea = 0;
  const cab = `/* Generado por herramientas/construir.mjs: no editar. Originales en herramientas/paquetes.json */\n`;
  partes.push(cab); linea += 1;
  for (const f of fuentes) {
    let codigo = leer(f);
    const r = await esbuild.transform(codigo, {
      loader: tipo, minify: true, legalComments: 'none', charset: 'utf8',
      sourcemap: 'external', sourcefile: '/' + f, sourcesContent: false,
    });
    let out = r.code.replace(/\n+$/, '');
    // Un archivo de código puede terminar sin ";" y pegarse con el siguiente
    if (tipo === 'js') out += ';';
    out += '\n';
    const mapa = JSON.parse(r.map);
    secciones.push({ offset: { line: linea, column: 0 }, map: mapa });
    partes.push(out);
    linea += out.split('\n').length - 1;
  }
  const nombreMapa = path.basename(salida) + '.map';
  const cuerpo = partes.join('');
  const final = cuerpo + (tipo === 'css' ? `/*# sourceMappingURL=${nombreMapa} */\n` : `//# sourceMappingURL=${nombreMapa}\n`);
  const mapa = JSON.stringify({ version: 3, file: path.basename(salida), sections: secciones });
  return { final, mapa, v: huella(cuerpo) };
}

const resultados = {};
for (const [salida, fuentes] of Object.entries(paquetes)) {
  for (const f of fuentes) if (!fs.existsSync(path.join(RAIZ, f))) { console.error(`✖ ${salida}: no existe ${f}`); process.exit(1); }
  resultados[salida] = await armar(salida, fuentes);
}

// Páginas que usan cada paquete → se les pone la versión nueva (?v=…)
const paginas = fs.readdirSync(RAIZ).filter(f => f.endsWith('.html'));
const htmlNuevo = {};
for (const p of paginas) {
  let h = leer(p);
  for (const [salida, { v }] of Object.entries(resultados)) {
    h = h.replace(new RegExp(`(["'/])${salida.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\?v=[A-Za-z0-9]*`, 'g'), `$1${salida}?v=${v}`);
  }
  htmlNuevo[p] = h;
}

// Originales que no usa ninguna página (para no dejar archivos sueltos)
const usados = new Set(Object.values(paquetes).flat());
// v42: archivos que una página carga sola cuando hace falta (no van en un paquete)
for (const f of ['js/vendor/jsqr.js']) usados.add(f);
const sueltos = [];
for (const d of ['css/comun', 'css/tienda', 'css/panel', 'js/comun', 'js/tienda', 'js/panel', 'js/vendor'])
  for (const f of fs.readdirSync(path.join(RAIZ, d))) if (!usados.has(`${d}/${f}`)) sueltos.push(`${d}/${f}`);
// Paquetes que ninguna página carga
const sinPagina = Object.keys(resultados).filter(s => !paginas.some(p => htmlNuevo[p].includes(s + '?v=')));

if (REVISAR) {
  const viejos = [];
  for (const [salida, r] of Object.entries(resultados)) {
    const actual = fs.existsSync(path.join(RAIZ, salida)) ? leer(salida) : '';
    if (actual !== r.final) viejos.push(salida);
  }
  for (const p of paginas) if (leer(p) !== htmlNuevo[p]) viejos.push(p + ' (versión ?v=)');
  const malos = [...viejos, ...sueltos.map(s => s + ' (no lo usa ninguna página)'), ...sinPagina.map(s => s + ' (ninguna página lo carga)')];
  if (malos.length) {
    console.log('✖ Hay que correr "npm run construir":\n  ' + malos.join('\n  '));
    process.exit(1);
  }
  console.log(`✔ css/dist y js/dist están al día (${Object.keys(resultados).length} paquetes).`);
  process.exit(0);
}

// Escribir: se borra lo que haya en dist y se arma de nuevo
for (const d of ['css/dist', 'js/dist']) {
  fs.rmSync(path.join(RAIZ, d), { recursive: true, force: true });
  fs.mkdirSync(path.join(RAIZ, d), { recursive: true });
}
let antes = 0, despues = 0;
for (const [salida, r] of Object.entries(resultados)) {
  fs.writeFileSync(path.join(RAIZ, salida), r.final);
  fs.writeFileSync(path.join(RAIZ, salida + '.map'), r.mapa);
  antes += paquetes[salida].reduce((s, f) => s + fs.statSync(path.join(RAIZ, f)).size, 0);
  despues += Buffer.byteLength(r.final);
}
for (const p of paginas) if (leer(p) !== htmlNuevo[p]) fs.writeFileSync(path.join(RAIZ, p), htmlNuevo[p]);
console.log(`✔ ${Object.keys(resultados).length} paquetes armados: ${Math.round(antes / 1024)} KB de originales → ${Math.round(despues / 1024)} KB comprimidos.`);
if (sueltos.length) console.log('⚠ Archivos que no usa ninguna página:\n  ' + sueltos.join('\n  '));
if (sinPagina.length) console.log('⚠ Paquetes que ninguna página carga:\n  ' + sinPagina.join('\n  '));
