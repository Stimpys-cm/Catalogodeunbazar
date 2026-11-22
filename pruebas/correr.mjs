// ─────────────────────────────────────────────────────────────
//  pruebas/correr.mjs — corre todas las pruebas automáticas del servidor (v32 a v47)
//
//  Uso (desde la carpeta del proyecto):
//    npm install                 (instala lo del proyecto: mongodb, bcryptjs)
//    npm i --no-save mingo@6     (solo para pruebas: imita MongoDB en memoria)
//    node pruebas/correr.mjs                → pruebas del servidor (v33 + v32 + middleware)
//    node pruebas/correr.mjs --servidor     → deja el sitio corriendo en http://127.0.0.1:8766
//                                             (API real + datos de ejemplo) para probar a mano
//                                             o con pruebas/v33-navegador.py (Playwright + Chrome)
//
//  No usa MongoDB Atlas, Clip, Resend ni Cloudinary reales: todo es simulado.
//  Copia api/ a pruebas/.tmp/api y cambia api/_lib/db.js por base-en-memoria.js.
// ─────────────────────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { spawnSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(AQUI, '.tmp');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
fs.cpSync(path.join(AQUI, '..', 'api'), path.join(TMP, 'api'), { recursive: true });
fs.copyFileSync(path.join(AQUI, 'base-en-memoria.js'), path.join(TMP, 'api', '_lib', 'db.js'));
fs.writeFileSync(path.join(TMP, 'package.json'), '{"type":"module"}');
if (process.argv.includes('--servidor')) {
  spawn(process.execPath, [path.join(AQUI, 'servidor.mjs')], { stdio: 'inherit', cwd: AQUI });
} else {
  let fallas = 0;
  // Los paquetes css/dist y js/dist tienen que estar al día con los originales
  console.log('\n════════ paquetes (herramientas/construir.mjs --revisar) ════════');
  const rev = spawnSync(process.execPath, [path.join(AQUI, '..', 'herramientas', 'construir.mjs'), '--revisar'], { encoding: 'utf8' });
  console.log((rev.stdout + rev.stderr).trim());
  console.log(rev.status === 0 ? 'PASS paquetes al día' : 'FAIL paquetes viejos: corre npm run construir');
  if (rev.status !== 0) fallas++;
  for (const s of ['v59-reels.mjs', 'v58-publicar.mjs', 'v57-seo.mjs', 'v56-congruencia.mjs', 'v55-conexiones.mjs', 'v54-texto.mjs', 'v53-instagram.mjs', 'v52-borradores.mjs', 'v50-agrupar.mjs', 'v49-detalles.mjs', 'v47-ahorro.mjs', 'v46-saldo.mjs', 'v45-agente.mjs', 'v44-ia.mjs', 'v43-funciones.mjs', 'v42-funciones.mjs', 'v41-funciones.mjs', 'v40-seguridad.mjs', 'v39-una-tienda.mjs', 'v36-apartado.mjs', 'v33-servidor.mjs', 'v32-pagos.mjs', 'v32-seguridad.mjs', 'v32-middleware.mjs']) {
    console.log(`\n════════ ${s} ════════`);
    const r = spawnSync(process.execPath, ['--no-warnings', path.join(AQUI, s)], { cwd: AQUI, encoding: 'utf8' });
    const lineas = (r.stdout || '').split('\n').filter(l => /^(PASS|FAIL|──|RESULTADO)/.test(l));
    console.log(lineas.join('\n'));
    const f = lineas.filter(l => l.startsWith('FAIL')).length;
    console.log(`→ ${lineas.filter(l => l.startsWith('PASS')).length} correctas, ${f} con falla`);
    if (r.status !== 0 || f) fallas += f || 1;
  }
  console.log(fallas ? `\n✖ Hubo fallas.` : '\n✔ Todas las pruebas pasaron.');
  process.exit(fallas ? 1 : 0);
}
