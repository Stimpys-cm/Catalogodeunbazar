// ─────────────────────────────────────────────────────────────
//  js/ig-crecer.js — Instagram para crecer y vender
//   · Reels: desde v59 viven en js/panel/ig-reels.js (+ ig-mp4.js).
//   · Sorteos: elige un post, reglas, ganador al azar entre quienes comentaron.
//   · 💸 Ofrecer por DM: precio especial + apartado en un toque.
// ─────────────────────────────────────────────────────────────
Object.assign(IG, { sorteo: { media: null, ganadores: 1, menciones: 0, excluir: '', res: null, corriendo: false } });

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
