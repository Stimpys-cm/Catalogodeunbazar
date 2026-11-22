// ─────────────────────────────────────────────────────────────
//  js/ig-crecer.js — Instagram para crecer y vender
//   · Reels automáticos: video vertical con tus prendas (se arma en el
//     navegador), descargar o publicar directo.
//   · Sorteos: elige un post, reglas, ganador al azar entre quienes comentaron.
//   · 💸 Ofrecer por DM: precio especial + apartado en un toque.
// ─────────────────────────────────────────────────────────────
Object.assign(IG, { reel: { sel: null, estilo: 'nuevos', seg: 2.6, video: null, url: '', estado: '', progreso: 0 }, sorteo: { media: null, ganadores: 1, menciones: 0, excluir: '', res: null, corriendo: false } });

// ═════════════════════════════════════════════════════════════
//  REELS
// ═════════════════════════════════════════════════════════════
const RL_ESTILOS = {
  nuevos: { titulo: 'Nuevos ingresos', sub: 'Piezas únicas · ya disponibles' },
  rebajas: { titulo: 'Bajaron de precio', sub: 'Antes de que se vayan' },
  drop: { titulo: 'Drop', sub: 'Solo una de cada una' },
};
function rlPrendas() {
  return getDB().filter(p => !p.vendido && !p.oculto && p.imagenes?.[0])
    .sort((a, b) => String(b.creadoEn || '').localeCompare(String(a.creadoEn || '')));
}
function rlSeleccion() {
  const R = IG.reel;
  if (!R.sel) {
    const base = rlPrendas();
    const lista = R.estilo === 'rebajas' ? base.filter(p => Number(p.precioAnterior) > Number(p.precio_venta)) : base;
    R.sel = new Set(lista.slice(0, 6).map(p => p.id));
  }
  return R.sel;
}
function igVistaReels() {
  const R = IG.reel, sel = rlSeleccion();
  const lista = rlPrendas().slice(0, 60);
  const dur = Math.round((1.8 + sel.size * R.seg + 2.2) * 10) / 10;
  return `
    ${igCabecera('Reels', 'Un video vertical con tus prendas, listo para Instagram. Los Reels llegan a gente que todavía no te sigue.')}
    <div class="igx-col2 arriba">
      <div class="igx-card">
        <div class="igx-card-tit">1 · Qué tipo de Reel</div>
        <div class="igx-tonos">${Object.entries(RL_ESTILOS).map(([k, v]) => `<button class="igx-tono ${R.estilo === k ? 'on' : ''}" onclick="IG.reel.estilo='${k}';IG.reel.sel=null;igRefrescar()">${v.titulo}</button>`).join('')}</div>
        <div class="igx-card-tit" style="margin-top:16px">2 · Prendas (${sel.size}/10)</div>
        <div class="rl-grid">${lista.map(p => `<button class="rl-p ${sel.has(p.id) ? 'on' : ''}" onclick="rlAlternar(${p.id})">
            <img src="${igEsc(igMini(p.imagenes[0], 200))}" alt="" loading="lazy"><span>${igEsc(p.nombre)}</span><b>$${igNum(p.precio_venta)}</b>
            ${sel.has(p.id) ? `<em>${[...sel].indexOf(p.id) + 1}</em>` : ''}</button>`).join('')}</div>
        <div class="igx-fila izq" style="margin-top:12px"><span class="igx-nota mini">Segundos por prenda</span>
          ${[2, 2.6, 3.5].map(x => `<button class="igx-chip-btn ${R.seg === x ? 'on' : ''}" onclick="IG.reel.seg=${x};igRefrescar()">${x}s</button>`).join('')}
          <span class="igx-nota mini">· dura ~${dur}s</span></div>
      </div>
      <div class="igx-card rl-prev">
        <div class="igx-card-tit">3 · Video</div>
        <div class="rl-lienzo">${R.video ? `<video src="${R.video}" controls playsinline loop></video>` : `<canvas id="rlCanvas" width="1080" height="1920"></canvas>`}
          ${R.estado === 'armando' ? `<div class="rl-barra"><i style="width:${Math.round(R.progreso * 100)}%"></i></div>` : ''}</div>
        <div class="igx-fila">
          <button class="igx-btn grad" onclick="rlArmar()" ${sel.size && R.estado !== 'armando' ? '' : 'disabled'}>${R.estado === 'armando' ? 'Armando… ' + Math.round(R.progreso * 100) + '%' : R.video ? '↻ Volver a armar' : '▶ Armar video'}</button>
          ${R.video ? `<a class="igx-btn ghost" href="${R.video}" download="reel-stiimpys.${R.ext || 'webm'}">Descargar</a>` : ''}
        </div>
        ${R.video ? `
          <textarea id="rlCaption" class="igx-textarea" rows="4" maxlength="2200">${igEsc(R.caption || rlCaption())}</textarea>
          <button class="igx-btn grad grande" onclick="rlPublicar()" ${['subiendo', 'procesando', 'publicando'].includes(R.estado) ? 'disabled' : ''}>${{ subiendo: 'Subiendo video…', procesando: 'Instagram lo está procesando…', publicando: 'Publicando…' }[R.estado] || 'Publicar Reel en Instagram'}</button>
          <p class="igx-nota mini">Tip: para usar música en tendencia, descárgalo y súbelo desde la app de Instagram eligiendo el audio ahí (la API no permite música). Publicado desde aquí sale sin sonido.</p>` : ''}
      </div>
    </div>`;
}
function rlAlternar(id) {
  const s = rlSeleccion();
  if (s.has(id)) s.delete(id); else if (s.size < 10) s.add(id); else return toast('Máximo 10 prendas por Reel');
  IG.reel.video = null; igRefrescar();
}
function rlCaption() {
  const R = IG.reel, e = RL_ESTILOS[R.estilo];
  const ps = [...rlSeleccion()].map(id => getDB().find(p => p.id === id)).filter(Boolean);
  const cfg = IG.estado?.config || {};
  return `${e.titulo.toUpperCase()} 🔥\n\n${ps.map((p, i) => `${i + 1}. ${p.nombre} · ${String(p.talla || '').split('·')[0].trim()} · $${igNum(p.precio_venta)}`).join('\n')}\n\n🛒 Apártalas en stiimpys.store (link en bio)\n${cfg.firma || ''}\n\n${cfg.hashtags || ''} #reels #thrift #ropavintage`.slice(0, 2200);
}

const rlCargarImg = src => new Promise((ok, mal) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => ok(i); i.onerror = () => mal(new Error('No se pudo cargar una foto')); i.src = src; });
function rlCubrir(ctx, img, W, H, zoom, dx = 0, dy = 0) {
  const s = Math.max(W / img.width, H / img.height) * zoom;
  const w = img.width * s, h = img.height * s;
  ctx.drawImage(img, (W - w) / 2 + dx, (H - h) / 2 + dy, w, h);
}
function rlTexto(ctx, txt, x, y, maxW, fuente, color, alinear = 'left') {
  ctx.font = fuente; ctx.fillStyle = color; ctx.textAlign = alinear; ctx.textBaseline = 'alphabetic';
  const palabras = String(txt).split(/\s+/); let linea = '', lineas = [];
  for (const p of palabras) { const prueba = linea ? linea + ' ' + p : p; if (ctx.measureText(prueba).width > maxW && linea) { lineas.push(linea); linea = p; } else linea = prueba; }
  if (linea) lineas.push(linea);
  lineas = lineas.slice(0, 3);
  const alto = parseInt(fuente.match(/(\d+)px/)?.[1] || 40) * 1.12;
  lineas.forEach((l, i) => ctx.fillText(l, x, y + i * alto));
  return lineas.length * alto;
}
async function rlArmar() {
  const R = IG.reel;
  const ps = [...rlSeleccion()].map(id => getDB().find(p => p.id === id)).filter(Boolean);
  if (!ps.length) return;
  if (typeof MediaRecorder === 'undefined') return toast('Tu navegador no puede grabar video. Usa Chrome o Safari actualizado.');
  R.estado = 'armando'; R.progreso = 0; R.video = null; R.caption = ''; igRefrescar();
  let imgs;
  try {
    await document.fonts?.load('500 90px "Playfair Display"').catch(() => {});
    imgs = await Promise.all(ps.map(p => rlCargarImg(p.imagenes[0].replace('/upload/', '/upload/c_limit,w_1400,q_auto,f_jpg/'))));
  } catch (e) { R.estado = ''; igRefrescar(); return toast(e.message); }
  const cv = document.getElementById('rlCanvas') || Object.assign(document.createElement('canvas'), { width: 1080, height: 1920 });
  const ctx = cv.getContext('2d'); const W = 1080, H = 1920;
  const e = RL_ESTILOS[R.estilo], marca = '@' + (IG.estado?.perfil?.username || 'stiimpys');
  const INTRO = 1.8, OUTRO = 2.2, SEG = R.seg, total = INTRO + ps.length * SEG + OUTRO;
  const tipos = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const tipo = tipos.find(t => MediaRecorder.isTypeSupported?.(t)) || '';
  const stream = cv.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: tipo || undefined, videoBitsPerSecond: 8_000_000 });
  const trozos = []; rec.ondataavailable = ev => ev.data.size && trozos.push(ev.data);
  const fin = new Promise(ok => rec.onstop = ok);
  const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const dibujar = t => {
    ctx.fillStyle = '#0e0e0f'; ctx.fillRect(0, 0, W, H);
    if (t < INTRO) {
      const k = Math.min(1, t / .6);
      rlCubrir(ctx, imgs[0], W, H, 1.15 + t * .03); ctx.fillStyle = `rgba(14,14,15,${.78})`; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = k;
      ctx.font = '700 30px "DM Sans", sans-serif'; ctx.fillStyle = '#f6c86b'; ctx.textAlign = 'center'; ctx.fillText(marca.toUpperCase().split('').join(' '), W / 2, H / 2 - 170);
      rlTexto(ctx, e.titulo, W / 2, H / 2 - 40 + (1 - ease(k)) * 40, 900, '500 118px "Playfair Display", Georgia, serif', '#fff', 'center');
      ctx.font = '500 38px "DM Sans", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText(e.sub, W / 2, H / 2 + 190);
      ctx.globalAlpha = 1; return;
    }
    if (t < INTRO + ps.length * SEG) {
      const i = Math.floor((t - INTRO) / SEG), u = (t - INTRO - i * SEG) / SEG, p = ps[i];
      rlCubrir(ctx, imgs[i], W, H, 1.05 + u * .08, 0, -u * 30);
      // transición
      if (u < .12 && i > 0) { ctx.fillStyle = `rgba(14,14,15,${1 - u / .12})`; ctx.fillRect(0, 0, W, H); }
      const g = ctx.createLinearGradient(0, H * .52, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.88)');
      ctx.fillStyle = g; ctx.fillRect(0, H * .5, W, H * .5);
      const k = ease(Math.min(1, u / .25)), y0 = H - 470 + (1 - k) * 60;
      ctx.globalAlpha = k;
      ctx.font = '700 28px "DM Sans", sans-serif'; ctx.fillStyle = '#f6c86b'; ctx.textAlign = 'left';
      ctx.fillText(`${String(i + 1).padStart(2, '0')} / ${String(ps.length).padStart(2, '0')}${p.marca ? '  ·  ' + String(p.marca).toUpperCase() : ''}`, 80, y0);
      const alto = rlTexto(ctx, p.nombre, 80, y0 + 90, 920, '500 74px "Playfair Display", Georgia, serif', '#fff');
      ctx.font = '500 36px "DM Sans", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.fillText([String(p.talla || '').split('·')[0].trim() && 'Talla ' + String(p.talla).split('·')[0].trim(), p.estado].filter(Boolean).join('  ·  '), 80, y0 + 90 + alto + 10);
      ctx.font = 'italic 500 96px "Playfair Display", Georgia, serif'; ctx.fillStyle = '#fff';
      ctx.fillText(`$${igNum(p.precio_venta)}`, 80, y0 + 90 + alto + 130);
      if (Number(p.precioAnterior) > Number(p.precio_venta)) {
        const wPrecio = ctx.measureText(`$${igNum(p.precio_venta)}`).width;
        ctx.font = '500 44px "DM Sans", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.55)';
        const tx = `$${igNum(p.precioAnterior)}`, x = 80 + wPrecio + 30, y = y0 + 90 + alto + 120;
        ctx.fillText(tx, x, y); ctx.fillRect(x, y - 15, ctx.measureText(tx).width, 4);
      }
      ctx.globalAlpha = 1;
      // barrita de progreso arriba
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(80, 110, W - 160, 6);
      ctx.fillStyle = '#fff'; ctx.fillRect(80, 110, (W - 160) * ((i + u) / ps.length), 6);
      return;
    }
    const u = (t - INTRO - ps.length * SEG) / OUTRO;
    ctx.fillStyle = '#0e0e0f'; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = Math.min(1, u / .3);
    rlTexto(ctx, 'Apártala antes que alguien más', W / 2, H / 2 - 120, 900, '500 86px "Playfair Display", Georgia, serif', '#fff', 'center');
    ctx.font = '700 44px "DM Sans", sans-serif'; ctx.fillStyle = '#f6c86b'; ctx.textAlign = 'center';
    ctx.fillText('stiimpys.store', W / 2, H / 2 + 170);
    ctx.font = '500 34px "DM Sans", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillText(`link en bio · ${marca}`, W / 2, H / 2 + 235);
    ctx.globalAlpha = 1;
  };
  rec.start(250);
  const t0 = performance.now();
  await new Promise(ok => {
    const paso = () => {
      const t = (performance.now() - t0) / 1000;
      dibujar(Math.min(t, total));
      R.progreso = Math.min(1, t / total);
      const b = document.querySelector('.rl-barra i'); if (b) b.style.width = Math.round(R.progreso * 100) + '%';
      const bt = document.querySelector('.rl-prev .igx-btn.grad'); if (bt) bt.textContent = 'Armando… ' + Math.round(R.progreso * 100) + '%';
      if (t < total) requestAnimationFrame(paso); else ok();
    };
    requestAnimationFrame(paso);
  });
  rec.stop(); await fin;
  const blob = new Blob(trozos, { type: tipo || 'video/webm' });
  R.blob = blob; R.ext = /mp4/.test(tipo) ? 'mp4' : 'webm';
  if (R.video) URL.revokeObjectURL(R.video);
  R.video = URL.createObjectURL(blob); R.estado = ''; R.progreso = 1;
  igRefrescar();
}
async function rlPublicar() {
  const R = IG.reel; if (!R.blob) return;
  R.caption = document.getElementById('rlCaption')?.value || rlCaption();
  if (!(await uiConfirm({ titulo: 'Publicar Reel', mensaje: 'Se publica en tu perfil y en Reels (sin música). ¿Continuar?', ok: 'Publicar' }))) return;
  try {
    R.estado = 'subiendo'; igRefrescar();
    const f = await igApi('ig-firma-video', {});
    const fd = new FormData();
    fd.append('file', R.blob, 'reel.' + R.ext); fd.append('api_key', f.api_key); fd.append('timestamp', f.timestamp); fd.append('signature', f.signature); fd.append('folder', f.folder);
    const up = await fetch(`https://api.cloudinary.com/v1_1/${f.cloud}/video/upload`, { method: 'POST', body: fd }).then(r => r.json());
    if (!up.secure_url) throw new Error(up.error?.message || 'No se pudo subir el video');
    R.estado = 'procesando'; igRefrescar();
    const { id } = await igApi('ig-reel-crear', { video: up.secure_url, caption: R.caption });
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 4000));
      const s = await igApi('ig-reel-estado', { id });
      if (s.estado === 'FINISHED') break;
      if (s.estado === 'ERROR' || s.estado === 'EXPIRED') throw new Error('Instagram no pudo procesar el video. ' + (s.detalle || ''));
      if (i === 59) throw new Error('Instagram está tardando mucho. Intenta de nuevo en unos minutos.');
    }
    R.estado = 'publicando'; igRefrescar();
    const r = await igApi('ig-reel-publicar', { id });
    toast('¡Reel publicado!'); R.estado = '';
    if (r.permalink) window.open(r.permalink, '_blank', 'noopener');
  } catch (e) { toast(e.message); R.estado = ''; }
  igRefrescar();
}

// ═════════════════════════════════════════════════════════════
//  SORTEOS
// ═════════════════════════════════════════════════════════════
function igVistaSorteo() {
  const S = IG.sorteo;
  if (!IG.posts?.length && !IG.cargandoPosts) igCargarPosts?.();
  const posts = (IG.posts || []).slice(0, 24);
  const post = posts.find(p => p.id === S.media);
  return `
    ${igCabecera('Sorteos', 'Los sorteos traen seguidores nuevos. Elige el post, pon las reglas y el sistema escoge al ganador al azar.')}
    <div class="igx-col2 arriba">
      <div class="igx-card">
        <div class="igx-card-tit">1 · Post del sorteo</div>
        <div class="so-grid">${posts.length ? posts.map(p => `<button class="so-p ${S.media === p.id ? 'on' : ''}" onclick="IG.sorteo.media='${p.id}';IG.sorteo.res=null;igRefrescar()">
          <img src="${igEsc(igMiniPost(p))}" alt="" loading="lazy"><span>${ico('chat', 13)} ${igNum(p.comments_count || 0)}</span></button>`).join('') : '<div class="igx-cargando"><span class="igx-spin"></span>Cargando posts…</div>'}</div>
      </div>
      <div class="igx-card">
        <div class="igx-card-tit">2 · Reglas</div>
        <div class="fg"><label>Ganadores</label><div class="igx-fila izq">${[1, 2, 3].map(n => `<button class="igx-chip-btn ${S.ganadores === n ? 'on' : ''}" onclick="IG.sorteo.ganadores=${n};igRefrescar()">${n}</button>`).join('')}</div></div>
        <div class="fg"><label>Debe etiquetar amigos</label><div class="igx-fila izq">${[0, 1, 2, 3].map(n => `<button class="igx-chip-btn ${S.menciones === n ? 'on' : ''}" onclick="IG.sorteo.menciones=${n};igRefrescar()">${n ? n + '+' : 'No'}</button>`).join('')}</div></div>
        <div class="fg"><label>No pueden ganar (usuarios separados por coma)</label><input class="igx-input" id="soExcluir" value="${igEsc(S.excluir)}" oninput="IG.sorteo.excluir=this.value" placeholder="tu_novia, tu_primo"></div>
        <p class="igx-nota mini">Cada persona cuenta una sola vez aunque comente varias. Tu propia cuenta nunca participa. Instagram no deja revisar si alguien te sigue: revísalo tú antes de anunciar.</p>
        <button class="igx-btn grad grande" onclick="soCorrer()" ${S.media && !S.corriendo ? '' : 'disabled'}>${S.corriendo ? 'Leyendo comentarios…' : `${ico('regalo', 16)} Elegir ganador`}</button>
      </div>
    </div>
    ${S.res ? `<div class="igx-card so-res">
      <div class="so-cifras"><span><b>${igNum(S.res.comentarios)}</b> comentarios</span><span><b>${igNum(S.res.participantes)}</b> participantes válidos</span></div>
      ${S.res.ganadores.length ? `<div class="so-ganadores">${S.res.ganadores.map((g, i) => `<div class="so-g" style="animation-delay:${i * .25}s"><small>Ganador${S.res.ganadores.length > 1 ? ' ' + (i + 1) : ''}</small><b>@${igEsc(g.usuario)}</b><p>"${igEsc(String(g.texto || '').slice(0, 120))}"</p>
        <a class="igx-btn ghost mini" href="https://instagram.com/${igEsc(g.usuario)}" target="_blank" rel="noopener">Ver perfil</a></div>`).join('')}</div>
        ${S.res.suplentes?.length ? `<p class="igx-nota mini">Suplentes (si el ganador no cumple): ${S.res.suplentes.map(x => '@' + igEsc(x.usuario)).join(', ')}</p>` : ''}
        <div class="igx-fila"><button class="igx-btn grad" onclick="soAnunciar()">Anunciar en el post</button><button class="igx-btn ghost" onclick="soCorrer()">↻ Volver a sortear</button></div>`
      : '<div class="igx-vacio mini">Nadie cumple las reglas todavía.</div>'}
    </div>` : ''}`;
}
async function soCorrer() {
  const S = IG.sorteo; S.corriendo = true; igRefrescar();
  try { S.res = await igApi('ig-sorteo', { media: S.media, ganadores: S.ganadores, menciones: S.menciones, excluir: S.excluir }); }
  catch (e) { toast(e.message); }
  S.corriendo = false; igRefrescar();
}
async function soAnunciar() {
  const S = IG.sorteo; if (!S.res?.ganadores?.length) return;
  const texto = `🎉 ¡Tenemos ganador${S.res.ganadores.length > 1 ? 'es' : ''}! ${S.res.ganadores.map(g => '@' + g.usuario).join(' ')} 🙌 Escríbenos por DM para reclamar tu premio. ¡Gracias a todos por participar! (${S.res.participantes} participantes)`;
  if (!(await uiConfirm({ titulo: 'Anunciar ganador', mensaje: texto, ok: 'Comentar en el post' }))) return;
  try { await igApi('ig-comentar', { media: S.media, mensaje: texto }); toast('Ganador anunciado ✓'); }
  catch (e) { toast(e.message); }
}

// ═════════════════════════════════════════════════════════════
//  💸 OFRECER POR DM
// ═════════════════════════════════════════════════════════════
async function igOfrecerDM() {
  if (!IG.hilo?.usuarioId) return toast('Abre una conversación primero');
  const lista = getDB().filter(p => !p.vendido && !p.oculto && !p.apartada).sort((a, b) => String(b.creadoEn || '').localeCompare(String(a.creadoEn || '')));
  const opciones = lista.slice(0, 200).map(p => `<option value="${p.id}">${igEsc(p.nombre)} · $${igNum(p.precio_venta)}</option>`).join('');
  setTimeout(ofSugerir, 60);
  const datos = await _dlgAbrir({
    titulo: 'Ofrecer por DM', sub: '@' + (IG.hilo.usuario || ''), ok: 'Enviar y apartar',
    cuerpo: `
      <label class="dlg-campo"><span>Prenda</span><select id="ofPrenda" onchange="ofSugerir()">${opciones}</select></label>
      <label class="dlg-campo"><span>Precio especial</span><input type="number" id="ofPrecio" min="1" step="10"></label>
      <label class="dlg-campo"><span>Apartarla por</span><select id="ofHoras"><option value="24">24 horas</option><option value="48">48 horas</option><option value="0">No apartar</option></select></label>
      <p class="dlg-msg" id="ofVista"></p>`,
    leer: () => ({ id: Number(document.getElementById('ofPrenda').value), precio: Number(document.getElementById('ofPrecio').value), horas: Number(document.getElementById('ofHoras').value) }),
  });
  if (!datos) return;
  const p = getDB().find(x => x.id === datos.id); if (!p || !(datos.precio > 0)) return;
  const link = `stiimpys.store/prenda.html?id=${p.id}`;
  const texto = datos.precio < Number(p.precio_venta)
    ? `¡Hola! 🙌 Te dejo "${p.nombre}" en $${igNum(datos.precio)} (antes $${igNum(p.precio_venta)}).${datos.horas ? ` Te la aparto ${datos.horas} horas.` : ''} ¿Te la llevas? ${link}`
    : `¡Hola! 🙌 "${p.nombre}" está en $${igNum(datos.precio)}.${datos.horas ? ` Te la aparto ${datos.horas} horas.` : ''} ${link}`;
  try {
    await igApi('ig-dm-enviar', { usuarioId: IG.hilo.usuarioId, texto });
    IG.hilo.mensajes.push({ texto, deMi: true, fecha: new Date().toISOString() });
    if (datos.horas) {
      await api(`/api/inventario-item?op=apartar&id=${p.id}`, { method: 'POST', body: { accion: 'apartar', nombre: '@' + (IG.hilo.usuario || 'instagram'), horas: datos.horas } });
      p.apartada = true;
    }
    toast(datos.horas ? 'Oferta enviada y prenda apartada ✓' : 'Oferta enviada ✓');
    igRefrescar();
  } catch (e) { toast(e.message); }
}
function ofSugerir() {
  const p = getDB().find(x => x.id === Number(document.getElementById('ofPrenda')?.value));
  const inp = document.getElementById('ofPrecio'); if (!p || !inp) return;
  inp.value = Math.max(10, Math.round(Number(p.precio_venta) * 0.9 / 10) * 10);
  const v = document.getElementById('ofVista'); if (v) v.textContent = `Precio normal $${igNum(p.precio_venta)} · sugerido −10%`;
}
