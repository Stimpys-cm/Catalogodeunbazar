// ─────────────────────────────────────────────────────────────
//  js/panel/ig-reels.js — v59: Reels profesionales
//   · Video vertical 1080×1920 (9:16), 30 cuadros por segundo, MP4 H.264.
//   · Se codifica cuadro por cuadro con WebCodecs (no depende de que la
//     pestaña vaya fluida: no se saltan cuadros) y se empaqueta con
//     RlMp4 (js/panel/ig-mp4.js). Si el navegador no tiene WebCodecs,
//     se graba en tiempo real con MediaRecorder como antes.
//   · Todo el texto se acomoda dentro de la zona que Instagram no tapa:
//     arriba (título "Reels" y cámara), abajo (usuario, descripción y
//     audio) y la columna de botones de la derecha. Se revisa solo.
//   · 3 diseños: Galería, Pantalla completa y Claro. Varias fotos por
//     prenda, transiciones suaves, inicio con logo y cierre con la tienda
//     y las formas de pago. Portada propia pensada para el recorte 3:4
//     del perfil.
//   · Vista previa en vivo con "Zonas de Instagram" y "Recorte del perfil".
// ─────────────────────────────────────────────────────────────
Object.assign(IG, {
  reel: {
    sel: null, estilo: 'nuevos', plantilla: 'galeria', seg: 2.6, fotos: 2,
    t: 0, reproduciendo: false, zonas: false, recorte: false, verVideo: true,
    video: null, blob: null, ext: 'mp4', portada: null, portadaBlob: null, motor: '',
    estado: '', progreso: 0, cancelar: false, caption: '',
  },
});

const RL = {
  W: 1080, H: 1920, FPS: 30, INTRO: 1.8, OUTRO: 2.6, TR: 0.42, PREVIEW: 720,
  SITIO: 'stiimpys.store',
  // Zona segura de Instagram Reels sobre 1080×1920. Fuera de esto Instagram pone su interfaz:
  //  arriba 270 px (título "Reels" y cámara), abajo 440 px (usuario, descripción, audio),
  //  orillas 72 px y, de la mitad para abajo, la columna de botones (me gusta, comentar, enviar).
  ZONA: { arriba: 270, abajo: 1480, izq: 72, der: 1008, derRiel: 930, rielDesde: 1000 },
  PERFIL: { arriba: 240, abajo: 1680 },        // recorte 3:4 (1080×1440) de la cuadrícula del perfil
  CARD: { x: 188, y: 330, w: 704, h: 880 },    // tarjeta 4:5 de la foto (Galería y Claro)
  imgs: new Map(), prep: null, enCurso: null, sombras: {}, revision: null, bucle: null, medidor: null,
};
const RL_SERIF = '"Playfair Display", Georgia, serif';
const RL_SANS = '"DM Sans", system-ui, -apple-system, sans-serif';

const RL_ESTILOS = {
  nuevos: { titulo: 'Nuevos ingresos', sub: 'Piezas únicas, ya disponibles', etiqueta: 'NUEVO', cierre: 'Apártala antes que alguien más' },
  rebajas: { titulo: 'Bajaron de precio', sub: 'Antes de que se vayan', etiqueta: 'REBAJA', cierre: 'Precios así no duran' },
  drop: { titulo: 'Drop', sub: 'Solo una de cada una', etiqueta: 'DROP', cierre: 'Solo hay una de cada una' },
};
const RL_PLANTILLAS = {
  galeria: {
    nombre: 'Galería', desc: 'La prenda completa sobre fondo difuminado', tipo: 'tarjeta',
    fondo: '#0d0d0e', velo: 'rgba(10,10,12,.68)', tinta: '#ffffff', suave: 'rgba(255,255,255,.72)', acento: '#f6c86b',
    logo: 'blanco', sombra: 'rgba(0,0,0,.65)', borde: 'rgba(255,255,255,.12)', pastilla: '#f6c86b', pastillaTxt: '#141414',
  },
  completa: {
    nombre: 'Pantalla completa', desc: 'Foto de orilla a orilla, texto abajo', tipo: 'completa',
    fondo: '#0d0d0e', velo: 'rgba(10,10,12,.66)', tinta: '#ffffff', suave: 'rgba(255,255,255,.8)', acento: '#f6c86b',
    logo: 'blanco', sombra: 'rgba(0,0,0,.6)', borde: 'rgba(255,255,255,.12)', pastilla: '#f6c86b', pastillaTxt: '#141414',
  },
  claro: {
    nombre: 'Claro', desc: 'Fondo crema, estilo catálogo', tipo: 'tarjeta',
    fondo: '#f3eee6', velo: 'rgba(243,238,230,.88)', tinta: '#151515', suave: 'rgba(21,21,21,.62)', acento: '#8c6a2c',
    logo: 'negro', sombra: 'rgba(70,50,20,.26)', borde: 'rgba(0,0,0,.07)', pastilla: '#151515', pastillaTxt: '#f3eee6',
  },
};

// ── Prendas ──────────────────────────────────────────────────
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
const rlElegidas = () => [...rlSeleccion()].map(id => getDB().find(p => p.id === id)).filter(p => p && p.imagenes?.[0]);
const rlClave = () => rlElegidas().map(p => p.id + '=' + (p.imagenes || []).slice(0, IG.reel.fotos).join('|')).join(',');
const rlDuracion = (n, seg) => RL.INTRO + n * seg + RL.OUTRO;
const rlDuracionActual = () => rlDuracion(RL.prep && RL.prep.clave === rlClave() ? RL.prep.items.length : rlSeleccion().size, IG.reel.seg);
const rlOcupado = () => ['armando', 'subiendo', 'procesando', 'publicando'].includes(IG.reel.estado);
const rlReloj = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ── Pantalla ─────────────────────────────────────────────────
function igVistaReels() {
  const R = IG.reel, sel = rlSeleccion();
  const lista = rlPrendas().slice(0, 60);
  const dur = rlDuracionActual();
  const ocupado = rlOcupado();
  const conVideo = !!R.video && R.verVideo;
  queueMicrotask(rlMontar);   // se dibuja la vista previa en cuanto el HTML está en la página
  return `
    ${igCabecera('Reels', 'Video vertical listo para Instagram. El texto se acomoda solo dentro de la zona que Instagram no tapa.')}
    <div class="igx-col2 arriba rl-col">
      <div class="igx-card">
        <div class="igx-card-tit">1 · Qué tipo de Reel</div>
        <div class="igx-tonos">${Object.entries(RL_ESTILOS).map(([k, v]) => `<button class="igx-tono ${R.estilo === k ? 'on' : ''}" onclick="rlCambiar('estilo','${k}')" ${ocupado ? 'disabled' : ''}>${v.titulo}</button>`).join('')}</div>
        <div class="igx-card-tit rl-sep">2 · Diseño</div>
        <div class="rl-plantillas">${Object.entries(RL_PLANTILLAS).map(([k, v]) => `<button class="rl-pl ${R.plantilla === k ? 'on' : ''}" data-plantilla="${k}" onclick="rlCambiar('plantilla','${k}')" ${ocupado ? 'disabled' : ''}>
            <i class="rl-pl-mini ${k}" aria-hidden="true"><b></b><u></u><s></s></i><span><b>${v.nombre}</b><small>${v.desc}</small></span></button>`).join('')}</div>
        <div class="igx-card-tit rl-sep">3 · Prendas (${sel.size}/10) <small class="rl-orden">salen en el orden en que las eliges</small></div>
        <div class="rl-grid">${lista.map(p => `<button class="rl-p ${sel.has(p.id) ? 'on' : ''}" onclick="rlAlternar(${p.id})" ${ocupado ? 'disabled' : ''}>
            <img src="${igEsc(igMini(p.imagenes[0], 200))}" alt="" loading="lazy"><span>${igEsc(p.nombre)}</span><b>$${igNum(p.precio_venta)}</b>
            ${sel.has(p.id) ? `<em>${[...sel].indexOf(p.id) + 1}</em>` : ''}${(p.imagenes || []).length > 1 ? `<small class="rl-nfotos">${p.imagenes.length} fotos</small>` : ''}</button>`).join('')}</div>
        <div class="rl-ajustes">
          <div class="igx-fila izq"><span class="igx-nota mini">Segundos por prenda</span>
            ${[2, 2.6, 3.5].map(x => `<button class="igx-chip-btn ${R.seg === x ? 'on' : ''}" onclick="rlCambiar('seg',${x})" ${ocupado ? 'disabled' : ''}>${x}s</button>`).join('')}</div>
          <div class="igx-fila izq"><span class="igx-nota mini">Fotos por prenda</span>
            ${[1, 2].map(x => `<button class="igx-chip-btn ${R.fotos === x ? 'on' : ''}" onclick="rlCambiar('fotos',${x})" ${ocupado ? 'disabled' : ''}>${x}</button>`).join('')}</div>
          <p class="igx-nota mini">Dura ${rlReloj(Math.round(dur))} · 1080 × 1920 (9:16) · 30 cuadros por segundo · MP4</p>
        </div>
      </div>
      <div class="igx-card rl-prev">
        <div class="igx-card-tit">4 · Vista previa${R.video ? `<span class="rl-pestanas"><button class="${!conVideo ? 'on' : ''}" onclick="IG.reel.verVideo=false;igRefrescar()">Diseño</button><button class="${conVideo ? 'on' : ''}" onclick="IG.reel.verVideo=true;IG.reel.reproduciendo=false;igRefrescar()">Video final</button></span>` : ''}</div>
        <div class="rl-lienzo ${R.zonas ? 'con-zonas' : ''} ${R.recorte ? 'con-recorte' : ''}" id="rlLienzo">
          ${conVideo ? `<video src="${R.video}" controls playsinline loop muted autoplay></video>` : `<canvas id="rlCanvas" width="${RL.PREVIEW}" height="${Math.round(RL.PREVIEW * 16 / 9)}" onclick="rlReproducir()" aria-label="Vista previa del Reel"></canvas>`}
          ${rlCapas()}
          ${R.estado === 'armando' ? `<div class="rl-avance"><b id="rlAvanceTxt">Creando video… ${Math.round(R.progreso * 100)}%</b><span class="rl-barra"><i style="width:${Math.round(R.progreso * 100)}%"></i></span><button class="igx-btn ghost mini" onclick="rlCancelar()">Cancelar</button></div>` : ''}
        </div>
        ${conVideo ? '' : `<div class="rl-controles">
          <button class="rl-play" id="rlPlay" onclick="rlReproducir()" aria-label="Reproducir">${rlIcoPlay(R.reproduciendo)}</button>
          <input type="range" id="rlTiempo" min="0" max="${dur.toFixed(2)}" step="0.01" value="${Math.min(R.t, dur).toFixed(2)}" oninput="rlIr(this.value)" aria-label="Tiempo">
          <span class="rl-reloj" id="rlReloj">${rlReloj(R.t)} / ${rlReloj(dur)}</span>
        </div>`}
        <div class="rl-vistas">
          <label class="igx-switch"><input type="checkbox" ${R.zonas ? 'checked' : ''} onchange="rlVerCapa('zonas',this.checked)"><span class="igx-switch-ui"></span><span>Zonas de Instagram</span></label>
          <label class="igx-switch"><input type="checkbox" ${R.recorte ? 'checked' : ''} onchange="rlVerCapa('recorte',this.checked)"><span class="igx-switch-ui"></span><span>Recorte del perfil (3:4)</span></label>
        </div>
        <p class="rl-zona-ok" id="rlZonaOk">${rlZonaTexto()}</p>
        <div class="igx-fila">
          <button class="igx-btn grad" onclick="rlCrear()" ${sel.size && !ocupado ? '' : 'disabled'}>${R.estado === 'armando' ? 'Creando video…' : R.video ? 'Volver a crear el video' : 'Crear video'}</button>
          ${R.video ? `<a class="igx-btn ghost" href="${R.video}" download="reel-stiimpys.${R.ext || 'mp4'}">Descargar video</a>` : ''}
          ${R.portada ? `<a class="igx-btn ghost" href="${R.portada}" download="portada-reel-stiimpys.jpg">Descargar portada</a>` : ''}
        </div>
        ${R.video ? `
          <div class="rl-final">
            ${R.portada ? `<img class="rl-portada" src="${R.portada}" alt="Portada del Reel">` : ''}
            <div><b>Listo: ${R.ext === 'mp4' ? 'MP4' : 'WebM'} 1080 × 1920</b><span>${R.motor === 'webcodecs' ? 'Cuadro por cuadro, sin saltos.' : 'Grabado en tiempo real.'} La portada viene aparte, pensada para el recorte 3:4 de tu perfil.</span></div>
          </div>
          <textarea id="rlCaption" class="igx-textarea" rows="4" maxlength="2200">${igEsc(R.caption || rlCaption())}</textarea>
          <button class="igx-btn grad grande" onclick="rlPublicar()" ${['subiendo', 'procesando', 'publicando'].includes(R.estado) ? 'disabled' : ''}>${{ subiendo: 'Subiendo video…', procesando: 'Instagram lo está procesando…', publicando: 'Publicando…' }[R.estado] || 'Publicar Reel en Instagram'}</button>
          <p class="igx-nota mini">Para usar música en tendencia, descárgalo y súbelo desde la app de Instagram eligiendo el audio ahí (la API no permite música). Publicado desde aquí sale sin sonido y con la portada de arriba.</p>` : ''}
      </div>
    </div>`;
}
const rlIcoPlay = on => on
  ? '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>'
  : '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>';

// Capas que solo se ven en la vista previa (no salen en el video)
function rlCapas() {
  const ico = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `
    <div class="rl-zonas" aria-hidden="true">
      <div class="rl-z-arriba"><span>Reels</span>${ico('M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z')}</div>
      <div class="rl-z-riel">${ico('M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z')}${ico('M20 12a8 8 0 1 1-3.3-6.5L20 4v4.5')}${ico('M21 3 10 14M21 3l-7 18-4-7-7-4z')}${ico('M5 12h.01M12 12h.01M19 12h.01')}</div>
      <div class="rl-z-abajo"><span class="rl-z-user"><i></i>@${igEsc(IG.estado?.perfil?.username || 'stiimpys')}</span><span class="rl-z-linea"></span><span class="rl-z-linea corta"></span><span class="rl-z-audio">Audio original</span></div>
      <div class="rl-z-segura"><span>Zona segura</span></div>
    </div>
    <div class="rl-recorte" aria-hidden="true"><span>Así se ve en tu perfil (3:4)</span></div>`;
}
function rlVerCapa(cual, on) {
  IG.reel[cual] = !!on;
  document.getElementById('rlLienzo')?.classList.toggle(cual === 'zonas' ? 'con-zonas' : 'con-recorte', !!on);
}

function rlCambiar(k, v) {
  const R = IG.reel;
  if (rlOcupado() || R[k] === v) return;
  R[k] = v;
  if (k === 'estilo') R.sel = null;
  rlDescartarVideo();
  igRefrescar();
}
function rlAlternar(id) {
  if (rlOcupado()) return;
  const s = rlSeleccion();
  if (s.has(id)) s.delete(id); else if (s.size < 10) s.add(id); else return toast('Máximo 10 prendas por Reel');
  rlDescartarVideo();
  const g = document.querySelector('.rl-grid'), y = g?.scrollTop || 0;
  igRefrescar();
  const g2 = document.querySelector('.rl-grid'); if (g2) g2.scrollTop = y;
}
function rlDescartarVideo() {
  const R = IG.reel;
  if (R.video) URL.revokeObjectURL(R.video);
  if (R.portada) URL.revokeObjectURL(R.portada);
  Object.assign(R, { video: null, blob: null, portada: null, portadaBlob: null, caption: '', verVideo: true });
}

// ── Vista previa en vivo ─────────────────────────────────────
function rlMontar() {
  if (IG.vista !== 'reels' || !document.getElementById('rlCanvas')) return;
  const clave = rlClave();
  rlPintar();
  if (!clave) return;
  if (RL.prep?.clave !== clave) {
    rlPreparar().then(() => { rlPintar(); rlControles(); rlZonaUI(); })
      .catch(e => toast(e.message || 'No se pudieron cargar las fotos'));
  } else rlZonaUI();
}
function rlCtxPrevia() {
  const cv = document.getElementById('rlCanvas'); if (!cv) return null;
  const ctx = cv.getContext('2d');
  const s = cv.width / RL.W;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  return ctx;
}
function rlPintar() {
  const ctx = rlCtxPrevia(); if (!ctx) return;
  const R = IG.reel, clave = rlClave();
  if (!clave || RL.prep?.clave !== clave || !RL.prep.items.length) {
    const P = RL_PLANTILLAS[R.plantilla] || RL_PLANTILLAS.galeria;
    ctx.globalAlpha = 1; ctx.fillStyle = P.fondo; ctx.fillRect(0, 0, RL.W, RL.H);
    ctx.font = `500 40px ${RL_SANS}`; ctx.fillStyle = P.suave; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(clave ? 'Preparando la vista previa…' : 'Elige prendas para armar el Reel', RL.W / 2, RL.H / 2);
    return;
  }
  const A = rlArmado(RL.prep);
  R.t = Math.min(R.t, rlDuracion(A.items.length, A.seg) - 0.01);
  rlDibujar(ctx, A, Math.max(0, R.t));
}
function rlControles() {
  const R = IG.reel, dur = rlDuracionActual();
  const rango = document.getElementById('rlTiempo');
  if (rango) { rango.max = dur.toFixed(2); rango.value = Math.min(R.t, dur).toFixed(2); }
  const reloj = document.getElementById('rlReloj'); if (reloj) reloj.textContent = `${rlReloj(R.t)} / ${rlReloj(dur)}`;
  const bt = document.getElementById('rlPlay');
  if (bt && bt.dataset.on !== String(R.reproduciendo)) { bt.dataset.on = String(R.reproduciendo); bt.innerHTML = rlIcoPlay(R.reproduciendo); bt.setAttribute('aria-label', R.reproduciendo ? 'Pausar' : 'Reproducir'); }
}
function rlReproducir(forzar) {
  const R = IG.reel;
  if (rlOcupado() && forzar !== false) return;
  R.reproduciendo = typeof forzar === 'boolean' ? forzar : !R.reproduciendo;
  rlControles();
  if (!R.reproduciendo) return;
  const yo = RL.bucle = {};
  let antes = performance.now();
  const paso = ahora => {
    if (RL.bucle !== yo || !R.reproduciendo) return;
    if (IG.vista !== 'reels' || !document.getElementById('rlCanvas')) { R.reproduciendo = false; return; }
    R.t += Math.min(0.1, Math.max(0, (ahora - antes) / 1000)); antes = ahora;
    if (R.t >= rlDuracionActual()) R.t = 0;
    rlPintar(); rlControles();
    requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}
function rlIr(v) { IG.reel.t = Math.max(0, Number(v) || 0); rlPintar(); rlControles(); }

// ── Fotos, logo y fuentes ────────────────────────────────────
function rlImg(src) {
  if (!RL.imgs.has(src)) {
    RL.imgs.set(src, new Promise((ok, mal) => {
      const i = new Image(); i.crossOrigin = 'anonymous'; i.decoding = 'async';
      i.onload = () => Promise.resolve(i.decode ? i.decode().catch(() => {}) : null).then(() => ok(i));
      i.onerror = () => { RL.imgs.delete(src); mal(new Error('No se pudo cargar una foto')); };
      i.src = src;
    }));
  }
  return RL.imgs.get(src);
}
// Cloudinary entrega la foto ya al tamaño que se usa (no más grande): rápido y sin gastar memoria
const rlUrlFoto = u => /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(u) ? u.replace('/image/upload/', '/image/upload/c_limit,w_1080,h_1440,q_auto:good,f_jpg/') : u;
async function rlFuentes() {
  if (!document.fonts?.load) return;
  await Promise.all([`500 80px ${RL_SERIF}`, `italic 500 80px ${RL_SERIF}`, `700 30px ${RL_SANS}`, `500 30px ${RL_SANS}`]
    .map(f => document.fonts.load(f).catch(() => {})));
}
function rlLienzo(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// Fondo difuminado de una foto (chiquito: se estira al dibujarlo, así casi no gasta memoria)
function rlDesenfocar(img) {
  const c = rlLienzo(180, 320), x = c.getContext('2d');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  if (typeof x.filter === 'string') {
    x.filter = 'blur(9px) saturate(1.15)';
    rlCubrir(x, img, -20, -20, 220, 360, 1);
    x.filter = 'none';
  } else {
    // Navegadores sin filtros de canvas: se achica mucho y se vuelve a agrandar en pasos
    const a = rlLienzo(18, 32); rlCubrir(a.getContext('2d'), img, 0, 0, 18, 32, 1.1);
    const b = rlLienzo(45, 80), bx = b.getContext('2d'); bx.imageSmoothingQuality = 'high'; bx.drawImage(a, 0, 0, 45, 80);
    x.drawImage(b, 0, 0, 180, 320);
  }
  return c;
}
function rlPreparar() {
  const clave = rlClave();
  if (RL.prep?.clave === clave) return Promise.resolve(RL.prep);
  if (RL.enCurso?.clave === clave) return RL.enCurso.promesa;
  const fotosPor = IG.reel.fotos, ps = rlElegidas();
  const promesa = (async () => {
    await rlFuentes();
    const [blanco, negro] = await Promise.all(['/img/logo-blanco.png', '/img/logo-negro.png'].map(u => rlImg(u).catch(() => null)));
    const items = (await Promise.all(ps.map(async p => {
      const urls = (p.imagenes || []).filter(Boolean).slice(0, fotosPor);
      const fotos = (await Promise.allSettled(urls.map(u => rlImg(rlUrlFoto(u))))).filter(x => x.status === 'fulfilled').map(x => x.value);
      return fotos.length ? { p, fotos, fondo: rlDesenfocar(fotos[0]) } : null;
    }))).filter(Boolean);
    if (ps.length && !items.length) throw new Error('No se pudieron cargar las fotos de las prendas.');
    const prep = { clave, items, logo: { blanco, negro }, faltan: ps.length - items.length };
    if (rlClave() === clave) RL.prep = prep;
    return prep;
  })();
  RL.enCurso = { clave, promesa };
  promesa.finally(() => { if (RL.enCurso?.promesa === promesa) RL.enCurso = null; }).catch(() => {});
  return promesa;
}
function rlArmado(prep) {
  const R = IG.reel;
  return {
    ...prep, plantilla: RL_PLANTILLAS[R.plantilla] ? R.plantilla : 'galeria', estilo: RL_ESTILOS[R.estilo] ? R.estilo : 'nuevos', seg: R.seg,
    usuario: '@' + (IG.estado?.perfil?.username || 'stiimpys'), pagos: IG.estado?.pagos || '', sitio: RL.SITIO,
  };
}

// ── Dibujo ───────────────────────────────────────────────────
const rlLim = x => Math.max(0, Math.min(1, x));
const rlSuave = x => { x = rlLim(x); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const rlSale = x => 1 - Math.pow(1 - rlLim(x), 3);
const rlEntra = (t, desde, dura = .4) => rlSale((t - desde) / dura);   // 0 → 1 con frenado suave
const rlDos = n => String(n).padStart(2, '0');
const rlTalla = p => String(p.talla || '').split('·')[0].trim();

function rlRedondo(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
// Cubre el rectángulo con la foto (como object-fit: cover), con zoom y desplazamiento
function rlCubrir(ctx, img, x, y, w, h, zoom = 1, dx = 0, dy = 0) {
  const s = Math.max(w / img.width, h / img.height) * zoom;
  const iw = img.width * s, ih = img.height * s;
  ctx.drawImage(img, x + (w - iw) / 2 + dx, y + (h - ih) / 2 + dy, iw, ih);
}
function rlContener(ctx, img, x, y, w, h, zoom = 1) {
  const s = Math.min(w / img.width, h / img.height) * zoom;
  const iw = img.width * s, ih = img.height * s;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}
function rlEspaciado(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = px ? px + 'px' : '0px'; }
// Una línea de texto. Si A.medidas existe, guarda su caja para revisar la zona segura.
function rlLinea(ctx, A, s, x, y, { f, c, al = 'left', esp = 0 }) {
  ctx.font = f; ctx.fillStyle = c; ctx.textAlign = al; ctx.textBaseline = 'alphabetic';
  rlEspaciado(ctx, esp);
  const m = ctx.measureText(s), w = m.width, tam = parseFloat(f.match(/(\d+(?:\.\d+)?)px/)?.[1] || 30);
  ctx.fillText(s, x, y);
  rlEspaciado(ctx, 0);
  if (A.medidas) {
    const x0 = al === 'center' ? x - w / 2 : al === 'right' ? x - w : x;
    A.medidas.push({ s, x0, x1: x0 + w, y0: y - (m.actualBoundingBoxAscent || tam * .8), y1: y + (m.actualBoundingBoxDescent || tam * .2) });
  }
  return w;
}
function rlAncho(ctx, s, f, esp = 0) { ctx.font = f; rlEspaciado(ctx, esp); const w = ctx.measureText(s).width; rlEspaciado(ctx, 0); return w; }
function rlRecortar(ctx, s, maxW, f, esp = 0) {
  s = String(s || '');
  if (rlAncho(ctx, s, f, esp) <= maxW) return s;
  while (s.length > 1 && rlAncho(ctx, s + '…', f, esp) > maxW) s = s.slice(0, -1);
  return s.trimEnd() + '…';
}
// Acomoda un texto: primero en una línea bajando el tamaño; si no cabe, en dos líneas.
function rlAjustar(ctx, s, maxW, fuente, { max, min, max2, min2 }) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  for (let t = max; t >= min; t -= 2) if (rlAncho(ctx, s, fuente(t)) <= maxW) return { tam: t, lineas: [s] };
  for (let t = max2; t >= min2; t -= 2) {
    const l = rlPartir(ctx, s, maxW, fuente(t));
    if (l.length <= 2) return { tam: t, lineas: l };
  }
  const l = rlPartir(ctx, s, maxW, fuente(min2));
  return { tam: min2, lineas: [l[0], rlRecortar(ctx, l.slice(1).join(' '), maxW, fuente(min2))] };
}
function rlPartir(ctx, s, maxW, f) {
  const out = []; let linea = '';
  for (const p of s.split(' ')) {
    const prueba = linea ? linea + ' ' + p : p;
    if (linea && rlAncho(ctx, prueba, f) > maxW) { out.push(linea); linea = p; } else linea = prueba;
  }
  if (linea) out.push(linea);
  return out.map(l => rlRecortar(ctx, l, maxW, f));
}
// Fondo difuminado con el velo del diseño ya integrado: una sola capa, así el fundido
// entre una prenda y otra queda limpio (dos capas a medias se ven grises).
function rlFondo(ctx, it, P, zoom = 1.08) {
  if (!it?.fondo) { ctx.fillStyle = P.fondo; ctx.fillRect(0, 0, RL.W, RL.H); return; }
  it.fondos ||= {};
  if (!it.fondos[P.velo]) {
    const c = rlLienzo(it.fondo.width, it.fondo.height), x = c.getContext('2d');
    x.fillStyle = P.fondo; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(it.fondo, 0, 0);
    x.fillStyle = P.velo; x.fillRect(0, 0, c.width, c.height);
    it.fondos[P.velo] = c;
  }
  rlCubrir(ctx, it.fondos[P.velo], 0, 0, RL.W, RL.H, zoom);
}
// Sombra de la tarjeta, hecha una sola vez (dibujar sombras en cada cuadro es lento)
function rlSombra(P) {
  if (RL.sombras[P.sombra]) return RL.sombras[P.sombra];
  const C = RL.CARD, m = 90, c = rlLienzo(C.w + m * 2, C.h + m * 2), x = c.getContext('2d');
  x.shadowColor = P.sombra; x.shadowBlur = 64; x.shadowOffsetX = 5000; x.shadowOffsetY = 26;
  x.fillStyle = '#000'; rlRedondo(x, m - 5000, m, C.w, C.h, 30); x.fill();
  return (RL.sombras[P.sombra] = c);
}
// Fotos de una prenda: si tiene varias, pasan con un fundido suave dentro de su tiempo
function rlFotos(ctx, it, tl, S, pintar) {
  const k = it.fotos.length, tramo = S / k, base = ctx.globalAlpha;
  const j = Math.max(0, Math.min(k - 1, Math.floor(tl / tramo)));
  const avance = j2 => rlLim((tl - j2 * tramo) / (tramo + RL.TR));
  if (j > 0) { ctx.globalAlpha = base; pintar(it.fotos[j - 1], avance(j - 1)); }
  ctx.globalAlpha = base * (j > 0 ? rlSale((tl - j * tramo) / .45) : 1);
  pintar(it.fotos[j], avance(j));
  ctx.globalAlpha = base;
}

function rlDibujar(ctx, A, t) {
  const P = RL_PLANTILLAS[A.plantilla] || RL_PLANTILLAS.galeria, n = A.items.length, S = A.seg, TR = RL.TR;
  const fin = RL.INTRO + n * S;
  ctx.globalAlpha = 1; ctx.fillStyle = P.fondo; ctx.fillRect(0, 0, RL.W, RL.H);
  if (!n) return;
  if (t < RL.INTRO) rlIntro(ctx, A, P, t, 1, 1, 0);
  else if (t < fin) {
    const i = Math.min(n - 1, Math.floor((t - RL.INTRO) / S)), tl = t - RL.INTRO - i * S;
    if (tl < TR) {
      const [k, sale, entra] = rlCruce(tl / TR);
      if (i === 0) rlIntro(ctx, A, P, RL.INTRO + tl, 1, 1 - sale, -sale);
      else rlItem(ctx, A, P, i - 1, S + tl, 1, 1 - sale, -sale);
      rlItem(ctx, A, P, i, tl, k, entra, 1 - entra);
    } else rlItem(ctx, A, P, i, tl, 1, 1, 0);
  } else {
    const to = t - fin;
    if (to < TR) {
      const [k, sale, entra] = rlCruce(to / TR);
      rlItem(ctx, A, P, n - 1, S + to, 1, 1 - sale, -sale);
      rlOutro(ctx, A, P, to, k, entra, 1 - entra);
    } else rlOutro(ctx, A, P, to, 1, 1, 0);
  }
  ctx.globalAlpha = 1;
}
// Transición: el fondo se funde parejo; lo que sale se va rápido y lo que entra llega después,
// así nunca se ven dos tarjetas encimadas a medias.
const rlCruce = u => [rlSuave(u), rlSuave(u * 1.6), rlSuave((u - .25) / .75)];
// fA = opacidad del fondo, cA = opacidad del contenido, desliz = -1…1 (sale a la izquierda / entra desde la derecha)
function rlItem(ctx, A, P, i, tl, fA, cA, desliz) {
  return P.tipo === 'completa' ? rlItemCompleta(ctx, A, P, i, tl, fA, cA, desliz) : rlItemTarjeta(ctx, A, P, i, tl, fA, cA, desliz);
}

function rlItemTarjeta(ctx, A, P, i, tl, fA, cA, desliz) {
  const it = A.items[i], p = it.p, S = A.seg, C = RL.CARD, n = A.items.length;
  if (fA > 0) { ctx.globalAlpha = fA; rlFondo(ctx, it, P, 1.1 + .04 * rlLim(tl / S)); }
  if (cA <= .002) return;
  const dx = desliz * 150, x = C.x + dx;
  ctx.globalAlpha = cA;
  ctx.drawImage(rlSombra(P), x - 90, C.y - 90);
  ctx.save(); rlRedondo(ctx, x, C.y, C.w, C.h, 30); ctx.clip();
  ctx.fillStyle = P.fondo; ctx.fillRect(x, C.y, C.w, C.h);
  rlFotos(ctx, it, tl, S, (img, u) => {
    const ancha = img.width / img.height > 1.05;
    if (ancha) { rlCubrir(ctx, it.fondo, x, C.y, C.w, C.h, 1.2); rlContener(ctx, img, x, C.y, C.w, C.h, 1 + .03 * u); }
    else rlCubrir(ctx, img, x, C.y, C.w, C.h, 1.01 + .05 * u, 0, -10 * u);
  });
  ctx.restore();
  ctx.strokeStyle = P.borde; ctx.lineWidth = 2; rlRedondo(ctx, x + 1, C.y + 1, C.w - 2, C.h - 2, 29); ctx.stroke();

  // Encabezado: número y marca (o tipo de Reel)
  const e = RL_ESTILOS[A.estilo];
  let a = rlEntra(tl, .1); ctx.globalAlpha = cA * a;
  const fCab = `700 25px ${RL_SANS}`;
  const num = `${rlDos(i + 1)} / ${rlDos(n)}`;
  const wNum = rlLinea(ctx, A, num, x, 300, { f: fCab, c: P.acento, esp: 4 });
  const etiqueta = rlRecortar(ctx, String(p.marca || e.etiqueta).toUpperCase(), C.w - wNum - 40, fCab, 4);
  rlLinea(ctx, A, etiqueta, x + C.w, 300, { f: fCab, c: P.suave, al: 'right', esp: 4 });

  // Nombre (una o dos líneas, se ajusta solo), detalles y precio
  const cx = 540 + dx, sube = d => (1 - d) * 26;
  const fNom = t => `500 ${t}px ${RL_SERIF}`;
  const nom = rlAjustar(ctx, p.nombre, C.w, fNom, { max: 60, min: 46, max2: 50, min2: 40 });
  const alto = Math.round(nom.tam * 1.1);
  a = rlEntra(tl, .18); ctx.globalAlpha = cA * a;
  nom.lineas.forEach((l, k) => rlLinea(ctx, A, l, cx, 1316 - (nom.lineas.length - 1 - k) * alto + sube(a), { f: fNom(nom.tam), c: P.tinta, al: 'center' }));
  const det = [rlTalla(p) && 'Talla ' + rlTalla(p), p.estado].filter(Boolean).join('  ·  ');
  a = rlEntra(tl, .26); ctx.globalAlpha = cA * a;
  if (det) rlLinea(ctx, A, rlRecortar(ctx, det, C.w, `500 30px ${RL_SANS}`, 1), cx, 1374 + sube(a), { f: `500 30px ${RL_SANS}`, c: P.suave, al: 'center', esp: 1 });
  a = rlEntra(tl, .34); ctx.globalAlpha = cA * a;
  rlPrecio(ctx, A, P, p, cx, 1458 + sube(a), 'center', 76, C.w);
  ctx.globalAlpha = 1;
}

function rlItemCompleta(ctx, A, P, i, tl, fA, cA, desliz) {
  const it = A.items[i], p = it.p, S = A.seg, n = A.items.length, W = RL.W, H = RL.H;
  if (fA > 0) {
    ctx.globalAlpha = fA;
    rlFotos(ctx, it, tl, S, (img, u) => {
      if (img.width / img.height > .92) {   // foto cuadrada o acostada: fondo difuminado y la foto entera arriba
        rlFondo(ctx, it, P, 1.12);
        rlContener(ctx, img, 0, 290, W, 860, 1 + .03 * u);   // termina antes del texto
      } else rlCubrir(ctx, img, 0, 0, W, H, 1.06 + .07 * u, 0, -28 * u);
    });
    // Degradado oscuro bajo el texto: se lee aunque la foto sea clara
    const g = ctx.createLinearGradient(0, 760, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(.35, 'rgba(0,0,0,.6)'); g.addColorStop(.6, 'rgba(0,0,0,.82)'); g.addColorStop(1, 'rgba(0,0,0,.9)');
    ctx.fillStyle = g; ctx.fillRect(0, 760, W, H - 760);
    const g2 = ctx.createLinearGradient(0, 0, 0, 470);
    g2.addColorStop(0, 'rgba(0,0,0,.5)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g2; ctx.fillRect(0, 0, W, 470);
  }
  if (cA <= .002) return;
  const dx = desliz * 150, x = 84 + dx, maxW = RL.ZONA.derRiel - 84, sube = d => (1 - d) * 30;
  const e = RL_ESTILOS[A.estilo];
  let a = rlEntra(tl, .1); ctx.globalAlpha = cA * a;
  const fCab = `700 25px ${RL_SANS}`;
  const num = `${rlDos(i + 1)} / ${rlDos(n)}`;
  const wNum = rlAncho(ctx, num, fCab, 4);
  ctx.fillStyle = 'rgba(0,0,0,.38)'; rlRedondo(ctx, x - 20, 262, wNum + 40, 54, 27); ctx.fill();
  rlLinea(ctx, A, num, x, 300, { f: fCab, c: '#fff', esp: 4 });
  rlLinea(ctx, A, rlRecortar(ctx, String(p.marca || e.etiqueta).toUpperCase(), 440, fCab, 4), 1000 + dx, 300, { f: fCab, c: P.acento, al: 'right', esp: 4 });

  const fNom = t => `500 ${t}px ${RL_SERIF}`;
  const nom = rlAjustar(ctx, p.nombre, maxW, fNom, { max: 80, min: 56, max2: 62, min2: 48 });
  const alto = Math.round(nom.tam * 1.08);
  a = rlEntra(tl, .18); ctx.globalAlpha = cA * a;
  nom.lineas.forEach((l, k) => rlLinea(ctx, A, l, x, 1300 - (nom.lineas.length - 1 - k) * alto + sube(a), { f: fNom(nom.tam), c: '#fff' }));
  const det = [rlTalla(p) && 'Talla ' + rlTalla(p), p.estado].filter(Boolean).join('  ·  ');
  a = rlEntra(tl, .26); ctx.globalAlpha = cA * a;
  if (det) rlLinea(ctx, A, rlRecortar(ctx, det, maxW, `500 32px ${RL_SANS}`, 1), x, 1362 + sube(a), { f: `500 32px ${RL_SANS}`, c: 'rgba(255,255,255,.82)', esp: 1 });
  a = rlEntra(tl, .34); ctx.globalAlpha = cA * a;
  rlPrecio(ctx, A, { ...P, tinta: '#fff', suave: 'rgba(255,255,255,.6)' }, p, x, 1452 + sube(a), 'left', 88, maxW);
  ctx.globalAlpha = 1;
}

// Precio, precio anterior tachado y % de descuento, alineados como grupo
function rlPrecio(ctx, A, P, p, x, y, al, tam, maxW) {
  const precio = '$' + igNum(p.precio_venta);
  const ant = Number(p.precioAnterior) > Number(p.precio_venta) ? Number(p.precioAnterior) : 0;
  const antes = ant ? '$' + igNum(ant) : '';
  const pct = ant ? Math.round((1 - Number(p.precio_venta) / ant) * 100) : 0;
  const fP = `italic 500 ${tam}px ${RL_SERIF}`, fA = `500 ${Math.round(tam * .44)}px ${RL_SANS}`, fD = `700 ${Math.round(tam * .34)}px ${RL_SANS}`;
  const wP = rlAncho(ctx, precio, fP), wA = antes ? rlAncho(ctx, antes, fA) : 0;
  const wD = pct >= 5 ? rlAncho(ctx, `-${pct}%`, fD, 1) + 32 : 0;
  let total = wP + (wA ? 24 + wA : 0) + (wD ? 20 + wD : 0);
  const conPct = wD && total <= maxW, conAntes = wA && (wP + 24 + wA) <= maxW;
  total = wP + (conAntes ? 24 + wA : 0) + (conPct ? 20 + wD : 0);
  let cx = al === 'center' ? x - total / 2 : x;
  rlLinea(ctx, A, precio, cx, y, { f: fP, c: P.tinta }); cx += wP;
  if (conAntes) {
    cx += 24; rlLinea(ctx, A, antes, cx, y - 6, { f: fA, c: P.suave });
    ctx.fillStyle = P.suave; ctx.fillRect(cx - 2, y - 6 - Math.round(tam * .15), wA + 4, 3); cx += wA;
  }
  if (conPct) {
    cx += 20; const h = Math.round(tam * .56), top = y - Math.round(tam * .5);
    ctx.fillStyle = P.pastilla; rlRedondo(ctx, cx, top, wD, h, h / 2); ctx.fill();
    rlLinea(ctx, A, `-${pct}%`, cx + wD / 2, top + h / 2 + Math.round(tam * .12), { f: fD, c: P.pastillaTxt, al: 'center', esp: 1 });
  }
}

function rlIntro(ctx, A, P, t, fA, cA, desliz) {
  const e = RL_ESTILOS[A.estilo], n = A.items.length;
  if (fA > 0) { ctx.globalAlpha = fA; rlFondo(ctx, A.items[0], P, 1.16 - .05 * rlLim(t / RL.INTRO)); }
  if (cA <= .002) return;
  const dx = desliz * 150, cx = 540 + dx, sube = d => (1 - d) * 30;
  const logo = A.logo?.[P.logo];
  let a = rlEntra(t, 0, .5);
  if (logo) {
    const w = 360 * (.94 + .06 * a), h = w * logo.height / logo.width;
    ctx.globalAlpha = cA * a; ctx.drawImage(logo, cx - w / 2, 372 + (251 - h) / 2, w, h);
  }
  const fT = s => `500 ${s}px ${RL_SERIF}`;
  const tit = rlAjustar(ctx, e.titulo, 780, fT, { max: 116, min: 88, max2: 92, min2: 72 });
  const altoT = Math.round(tit.tam * 1.05);
  a = rlEntra(t, .15, .5); ctx.globalAlpha = cA * a;
  tit.lineas.forEach((l, k) => rlLinea(ctx, A, l, cx, 800 + k * altoT + sube(a), { f: fT(tit.tam), c: P.tinta, al: 'center' }));
  const L = 800 + (tit.lineas.length - 1) * altoT;
  a = rlEntra(t, .4, .45); ctx.globalAlpha = cA;
  ctx.fillStyle = P.acento; ctx.fillRect(cx - 60 * a, L + 50, 120 * a, 3);
  a = rlEntra(t, .5); ctx.globalAlpha = cA * a;
  rlLinea(ctx, A, rlRecortar(ctx, e.sub, 780, `500 36px ${RL_SANS}`), cx, L + 124 + sube(a), { f: `500 36px ${RL_SANS}`, c: P.suave, al: 'center' });
  const desde = Math.min(...A.items.map(x => Number(x.p.precio_venta) || 0).filter(Boolean));
  const cuenta = `${n} ${n === 1 ? 'PIEZA' : 'PIEZAS'}${isFinite(desde) && desde > 0 ? `  ·  DESDE $${igNum(desde)}` : ''}`;
  a = rlEntra(t, .58); ctx.globalAlpha = cA * a;
  rlLinea(ctx, A, rlRecortar(ctx, cuenta, 780, `700 25px ${RL_SANS}`, 4), cx, L + 178 + sube(a), { f: `700 25px ${RL_SANS}`, c: P.acento, al: 'center', esp: 4 });
  // Tira con las primeras prendas
  const muestras = A.items.slice(0, 3), tw = 196, th = 245, gap = 22;
  const x0 = cx - (muestras.length * tw + (muestras.length - 1) * gap) / 2, y0 = L + 236;
  muestras.forEach((it, k) => {
    const b = rlEntra(t, .66 + k * .1, .45); ctx.globalAlpha = cA * b;
    const xx = x0 + k * (tw + gap), yy = y0 + (1 - b) * 40;
    ctx.save(); rlRedondo(ctx, xx, yy, tw, th, 18); ctx.clip(); rlCubrir(ctx, it.fotos[0], xx, yy, tw, th, 1.02); ctx.restore();
    ctx.strokeStyle = P.borde; ctx.lineWidth = 2; rlRedondo(ctx, xx + 1, yy + 1, tw - 2, th - 2, 17); ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function rlOutro(ctx, A, P, t, fA, cA, desliz) {
  const e = RL_ESTILOS[A.estilo];
  if (fA > 0) { ctx.globalAlpha = fA; rlFondo(ctx, A.items[A.items.length - 1], P, 1.1 + .03 * rlLim(t / RL.OUTRO)); }
  // Últimas décimas: el contenido se desvanece para que al repetirse empiece limpio
  cA *= 1 - rlLim((t - (RL.OUTRO - .32)) / .32);
  if (cA <= .002) return;
  const dx = desliz * 150, cx = 540 + dx, sube = d => (1 - d) * 30;
  const logo = A.logo?.[P.logo];
  let a = rlEntra(t, .05, .5);
  if (logo) { const w = 300, h = w * logo.height / logo.width; ctx.globalAlpha = cA * a; ctx.drawImage(logo, cx - w / 2, 330, w, h); }
  const fT = s => `500 ${s}px ${RL_SERIF}`;
  const tit = rlAjustar(ctx, e.cierre, 780, fT, { max: 84, min: 66, max2: 76, min2: 58 });
  const altoT = Math.round(tit.tam * 1.12);
  a = rlEntra(t, .15, .5); ctx.globalAlpha = cA * a;
  tit.lineas.forEach((l, k) => rlLinea(ctx, A, l, cx, 700 + k * altoT + sube(a), { f: fT(tit.tam), c: P.tinta, al: 'center' }));
  const L = 700 + (tit.lineas.length - 1) * altoT;
  // Botón con la tienda
  a = rlEntra(t, .35, .45); ctx.globalAlpha = cA * a;
  const fS = `700 46px ${RL_SANS}`, wS = Math.min(rlAncho(ctx, A.sitio, fS, 1), 700), bw = wS + 92, bh = 104, by = L + 70 + sube(a);
  ctx.fillStyle = P.pastilla; rlRedondo(ctx, cx - bw / 2, by, bw, bh, bh / 2); ctx.fill();
  rlLinea(ctx, A, A.sitio, cx, by + 68, { f: fS, c: P.pastillaTxt, al: 'center', esp: 1 });
  a = rlEntra(t, .5); ctx.globalAlpha = cA * a;
  rlLinea(ctx, A, rlRecortar(ctx, `Link en bio  ·  ${A.usuario}`, 780, `500 32px ${RL_SANS}`), cx, by + bh + 74 + sube(a), { f: `500 32px ${RL_SANS}`, c: P.suave, al: 'center' });
  if (A.pagos) {
    a = rlEntra(t, .6); ctx.globalAlpha = cA * a;
    const linea = String(A.pagos).replace(/\s+/g, ' ').trim();
    const fP = rlAncho(ctx, linea, `500 29px ${RL_SANS}`) <= 780 ? `500 29px ${RL_SANS}` : `500 24px ${RL_SANS}`;
    ctx.fillStyle = P.acento; ctx.fillRect(cx - 30, by + bh + 120 + sube(a), 60, 2);
    rlLinea(ctx, A, rlRecortar(ctx, linea, 780, fP), cx, by + bh + 176 + sube(a), { f: fP, c: P.tinta, al: 'center' });
  }
  ctx.globalAlpha = 1;
}

// Portada: título y collage dentro del recorte 3:4 del perfil (1080×1440 al centro)
function rlPortada(A) {
  const P = RL_PLANTILLAS[A.plantilla] || RL_PLANTILLAS.galeria, e = RL_ESTILOS[A.estilo];
  const cv = rlLienzo(RL.W, RL.H), ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = P.fondo; ctx.fillRect(0, 0, RL.W, RL.H);
  rlFondo(ctx, A.items[0], P, 1.12);
  rlLinea(ctx, A, rlRecortar(ctx, A.usuario.toUpperCase(), 800, `700 26px ${RL_SANS}`, 6), 540, 330, { f: `700 26px ${RL_SANS}`, c: P.acento, al: 'center', esp: 6 });
  const fT = s => `500 ${s}px ${RL_SERIF}`;
  const tit = rlAjustar(ctx, e.titulo, 860, fT, { max: 124, min: 92, max2: 96, min2: 76 });
  const altoT = Math.round(tit.tam * 1.04);
  tit.lineas.forEach((l, k) => rlLinea(ctx, A, l, 540, 462 + k * altoT, { f: fT(tit.tam), c: P.tinta, al: 'center' }));
  const y0 = 462 + (tit.lineas.length - 1) * altoT + 64, y1 = 1540, gap = 24;
  const lista = A.items.slice(0, 4), n = lista.length;
  const celdas = [];
  if (n === 1) { const h = y1 - y0, w = Math.min(860, h * .8); celdas.push([540 - w / 2, y0, w, h]); }
  else if (n === 2) { const w = (860 - gap) / 2, h = Math.min(w * 1.25, y1 - y0); celdas.push([110, y0 + (y1 - y0 - h) / 2, w, h], [110 + w + gap, y0 + (y1 - y0 - h) / 2, w, h]); }
  else {
    const h = Math.min(((860 - gap) / 2) * 1.25, (y1 - y0 - gap) / 2), w = h * .8, x0 = 540 - w - gap / 2;
    for (let k = 0; k < 4; k++) celdas.push([x0 + (k % 2) * (w + gap), y0 + Math.floor(k / 2) * (h + gap), w, h]);
  }
  celdas.forEach(([x, y, w, h], k) => {
    const it = lista[k];
    ctx.save(); rlRedondo(ctx, x, y, w, h, 22); ctx.clip();
    if (it) rlCubrir(ctx, it.fotos[0], x, y, w, h, 1.02);
    else { ctx.fillStyle = P.fondo; ctx.fillRect(x, y, w, h); const lg = A.logo?.[P.logo]; if (lg) rlContener(ctx, lg, x + w * .15, y + h * .2, w * .7, h * .6); }
    ctx.restore();
    ctx.strokeStyle = P.borde; ctx.lineWidth = 2; rlRedondo(ctx, x + 1, y + 1, w - 2, h - 2, 21); ctx.stroke();
    if (it) {
      const pr = '$' + igNum(it.p.precio_venta), f = `700 30px ${RL_SANS}`, pw = rlAncho(ctx, pr, f) + 36;
      ctx.fillStyle = 'rgba(12,12,14,.78)'; rlRedondo(ctx, x + 16, y + h - 66, pw, 50, 25); ctx.fill();
      rlLinea(ctx, A, pr, x + 16 + pw / 2, y + h - 30, { f, c: '#fff', al: 'center' });
    }
  });
  rlLinea(ctx, A, A.sitio, 540, 1626, { f: `700 34px ${RL_SANS}`, c: P.tinta, al: 'center', esp: 2 });
  return cv;
}

// ── Zona segura: se revisa cada texto en el momento en que ya quedó quieto ──
function rlFueraDeZona(r) {
  const Z = RL.ZONA, der = r.y1 > Z.rielDesde ? Z.derRiel : Z.der;
  return r.y0 < Z.arriba - .5 || r.y1 > Z.abajo + .5 || r.x0 < Z.izq - .5 || r.x1 > der + .5;
}
function rlMedidor() {
  if (!RL.medidor) { const c = rlLienzo(RL.W, RL.H); RL.medidor = c.getContext('2d'); }
  return RL.medidor;
}
function rlRevisarZonas(A) {
  const ctx = rlMedidor(), n = A.items.length, S = A.seg, fallas = [];
  const momentos = [['Inicio', RL.INTRO - .02], ...A.items.map((it, i) => [it.p.nombre, RL.INTRO + i * S + S - .02]), ['Cierre', RL.INTRO + n * S + RL.OUTRO - .4]];
  let textos = 0;
  for (const [donde, t] of momentos) {
    const B = { ...A, medidas: [] };
    rlDibujar(ctx, B, t);
    textos += B.medidas.length;
    B.medidas.filter(rlFueraDeZona).forEach(r => fallas.push({ donde, texto: r.s, caja: r }));
  }
  return { ok: !fallas.length, textos, fallas };
}
function rlRevisarPortada(A) {
  const B = { ...A, medidas: [] }; rlPortada(B);
  const fuera = B.medidas.filter(r => r.y0 < RL.PERFIL.arriba || r.y1 > RL.PERFIL.abajo || r.x0 < RL.ZONA.izq || r.x1 > RL.W - RL.ZONA.izq);
  return { ok: !fuera.length, textos: B.medidas.length, fuera };
}
function rlZonaTexto() {
  const r = RL.revision;
  if (!r || r.clave !== rlClaveRevision()) return '<span class="rl-z-pend">Revisando que el texto quede fuera de los botones de Instagram…</span>';
  return r.ok
    ? '<span class="rl-z-bien">Todo el texto queda dentro de la zona segura: no lo tapan los botones, el usuario ni la descripción de Instagram.</span>'
    : `<span class="rl-z-mal">Hay texto en la zona de Instagram (${igEsc(r.fallas[0].donde)}). Prueba con un nombre más corto.</span>`;
}
const rlClaveRevision = () => `${rlClave()}|${IG.reel.plantilla}|${IG.reel.estilo}|${IG.reel.seg}`;
function rlZonaUI() {
  if (!RL.prep || RL.prep.clave !== rlClave() || !RL.prep.items.length) return;
  const clave = rlClaveRevision();
  const pintar = () => { const el = document.getElementById('rlZonaOk'); if (el) el.innerHTML = rlZonaTexto(); };
  if (RL.revision?.clave === clave) return pintar();
  // Se revisa un instante después para no frenar el primer dibujo de la vista previa
  clearTimeout(RL.tRevision);
  RL.tRevision = setTimeout(() => {
    if (!RL.prep || rlClaveRevision() !== clave) return;
    RL.revision = { clave, ...rlRevisarZonas(rlArmado(RL.prep)) };
    pintar();
  }, 80);
}

// ── Crear el video ───────────────────────────────────────────
const rlCeder = () => new Promise(ok => { const c = new MessageChannel(); c.port1.onmessage = () => ok(); c.port2.postMessage(0); });
function rlAvance(x) {
  const R = IG.reel; R.progreso = rlLim(x);
  const pc = Math.round(R.progreso * 100);
  const b = document.querySelector('.rl-avance .rl-barra i'); if (b) b.style.width = pc + '%';
  const tx = document.getElementById('rlAvanceTxt'); if (tx) tx.textContent = `Creando video… ${pc}%`;
}
function rlCancelar() { IG.reel.cancelar = true; }
async function rlCrear() {
  const R = IG.reel;
  if (rlOcupado() || !rlSeleccion().size) return;
  R.reproduciendo = false;
  let A;
  try { A = rlArmado(await rlPreparar()); } catch (e) { return toast(e.message); }
  if (!A.items.length) return toast('Elige al menos una prenda con foto');
  rlDescartarVideo();
  R.estado = 'armando'; R.progreso = 0; R.cancelar = false; igRefrescar();
  try {
    let res = null;
    if (typeof VideoEncoder === 'function' && typeof VideoFrame === 'function') res = await rlCodificar(A);
    if (!res) res = await rlGrabarTiempoReal(A);
    const portada = await new Promise(ok => rlPortada(A).toBlob(ok, 'image/jpeg', .92));
    Object.assign(R, { blob: res.blob, ext: res.ext, motor: res.motor, video: URL.createObjectURL(res.blob), verVideo: true });
    if (portada) Object.assign(R, { portadaBlob: portada, portada: URL.createObjectURL(portada) });
    R.estado = ''; R.progreso = 1;
    toast(A.faltan ? `Video listo. ${A.faltan} prenda(s) no se incluyeron porque su foto no cargó.` : 'Video listo');
  } catch (e) {
    R.estado = '';
    if (e?.message !== 'cancelado') toast('No se pudo crear el video: ' + (e?.message || e));
  }
  igRefrescar();
}
// WebCodecs: cada cuadro se dibuja y se codifica en orden, sin depender del reloj
async function rlCodificar(A) {
  const W = RL.W, H = RL.H, FPS = RL.FPS;
  const base = { width: W, height: H, bitrate: 10_000_000, framerate: FPS, avc: { format: 'avc' } };
  let cfg = null;
  // Primero Baseline (sin cuadros reordenados: lo más compatible), luego Main y High
  for (const codec of ['avc1.42e028', 'avc1.42e02a', 'avc1.4d0028', 'avc1.640028', 'avc1.640032']) {
    try { if ((await VideoEncoder.isConfigSupported({ ...base, codec })).supported) { cfg = { ...base, codec }; break; } } catch {}
  }
  if (!cfg) return null;
  const mp4 = RlMp4.nuevo({ ancho: W, alto: H, fps: FPS });
  let fallo = null;
  const enc = new VideoEncoder({ output: (ch, meta) => { try { mp4.agregar(ch, meta); } catch (e) { fallo = e; } }, error: e => { fallo = e; } });
  enc.configure(cfg);
  const cv = rlLienzo(W, H), ctx = cv.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const total = Math.round(rlDuracion(A.items.length, A.seg) * FPS);
  const previa = rlCtxPrevia();
  try {
    for (let f = 0; f < total; f++) {
      if (fallo) throw fallo;
      if (IG.reel.cancelar) throw new Error('cancelado');
      rlDibujar(ctx, A, f / FPS);
      const vf = new VideoFrame(cv, { timestamp: Math.round(f * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
      enc.encode(vf, { keyFrame: f % (FPS * 2) === 0 });
      vf.close();
      // Espera a que el codificador libere cola (el evento "dequeue" no se frena si cambias de pestaña)
      while (enc.encodeQueueSize > 6 && !fallo) await new Promise(ok => { enc.addEventListener?.('dequeue', ok, { once: true }); setTimeout(ok, 40); });
      if (f % 6 === 0) {
        rlAvance(f / total);
        const pv = rlCtxPrevia() || previa; if (pv) pv.drawImage(cv, 0, 0, W, H);
        await rlCeder();
      }
    }
    await enc.flush();
    if (fallo) throw fallo;
  } finally { try { enc.close(); } catch {} }
  rlAvance(1);
  return { blob: mp4.terminar(), ext: 'mp4', motor: 'webcodecs' };
}
// Respaldo: grabar el lienzo en tiempo real (navegadores sin WebCodecs)
async function rlGrabarTiempoReal(A) {
  if (typeof MediaRecorder === 'undefined') throw new Error('Tu navegador no puede crear video. Usa Chrome, Edge o Safari actualizado.');
  const cv = rlLienzo(RL.W, RL.H);
  cv.style.cssText = 'position:fixed;left:-99999px;top:0;width:10px;height:18px;pointer-events:none';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  const tipos = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const tipo = tipos.find(t => MediaRecorder.isTypeSupported?.(t)) || '';
  const total = rlDuracion(A.items.length, A.seg);
  rlDibujar(ctx, A, 0);
  const rec = new MediaRecorder(cv.captureStream(RL.FPS), { mimeType: tipo || undefined, videoBitsPerSecond: 10_000_000 });
  const trozos = []; rec.ondataavailable = ev => ev.data.size && trozos.push(ev.data);
  const fin = new Promise(ok => rec.onstop = ok);
  rec.start(250);
  const t0 = performance.now();
  try {
    await new Promise((ok, mal) => {
      const paso = () => {
        if (IG.reel.cancelar) return mal(new Error('cancelado'));
        const t = (performance.now() - t0) / 1000;
        rlDibujar(ctx, A, Math.min(t, total));
        rlAvance(t / total);
        const pv = rlCtxPrevia(); if (pv) pv.drawImage(cv, 0, 0, RL.W, RL.H);
        if (t < total) requestAnimationFrame(paso); else ok();
      };
      requestAnimationFrame(paso);
    });
  } finally { if (rec.state !== 'inactive') rec.stop(); await fin; cv.remove(); }
  const blob = new Blob(trozos, { type: tipo || 'video/webm' });
  return { blob, ext: /mp4/.test(tipo) ? 'mp4' : 'webm', motor: 'grabacion' };
}

// ── Descripción y publicación ────────────────────────────────
function rlCaption() {
  const R = IG.reel, e = RL_ESTILOS[R.estilo] || RL_ESTILOS.nuevos;
  const ps = (RL.prep?.clave === rlClave() ? RL.prep.items.map(x => x.p) : rlElegidas());
  const cfg = IG.estado?.config || {};
  const lista = ps.map((p, i) => `${i + 1}. ${p.nombre}${rlTalla(p) ? ' · ' + rlTalla(p) : ''} · $${igNum(p.precio_venta)}`).join('\n');
  // v54: máximo 5 hashtags (límite de Instagram) y sin emojis en el estilo limpio
  const tope = Math.max(0, Math.min(5, Number(cfg.maxHashtags ?? 5)));
  const tags = [...new Set(['ropavintage', 'thrift', ...String(cfg.hashtags || '').split(/[\s,]+/).map(h => h.replace(/^#+/, '').toLowerCase()).filter(Boolean), 'reels'])].slice(0, tope).map(h => '#' + h).join(' ');
  const pagos = IG.estado?.pagos || '';   // v55: formas de pago (Ventas → Promociones y pagos)
  if (cfg.estiloTexto !== 'emojis') return igSinEmojis(`${e.titulo.toUpperCase()}\n\n${lista}\n\nApártalas en ${RL.SITIO} (link en bio)\n${cfg.firma || ''}${pagos ? '\n' + pagos : ''}\n\n${tags}`).replace(/\n{3,}/g, '\n\n').trim().slice(0, 2200);
  return `${e.titulo.toUpperCase()} 🔥\n\n${lista}\n\n🛒 Apártalas en ${RL.SITIO} (link en bio)\n${cfg.firma || ''}${pagos ? '\n💳 ' + pagos : ''}\n\n${tags}`.slice(0, 2200);
}
async function rlSubir(f, blob, nombre, tipo) {
  const fd = new FormData();
  fd.append('file', blob, nombre); fd.append('api_key', f.api_key); fd.append('timestamp', f.timestamp); fd.append('signature', f.signature); fd.append('folder', f.folder);
  const up = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(f.cloud)}/${tipo}/upload`, { method: 'POST', body: fd }).then(r => r.json());
  if (!up.secure_url) throw new Error(up.error?.message || (tipo === 'video' ? 'No se pudo subir el video' : 'No se pudo subir la portada'));
  return up.secure_url;
}
async function rlPublicar() {
  const R = IG.reel; if (!R.blob || rlOcupado()) return;
  R.caption = document.getElementById('rlCaption')?.value || rlCaption();
  if (!(await uiConfirm({ titulo: 'Publicar Reel', mensaje: 'Se publica en tu perfil y en Reels, con la portada que se armó (sin música). ¿Continuar?', ok: 'Publicar' }))) return;
  try {
    R.estado = 'subiendo'; igRefrescar();
    const f = await igApi('ig-firma-video', {});
    const video = await rlSubir(f, R.blob, 'reel.' + R.ext, 'video');
    // La portada es opcional: si no sube, Instagram usa el primer cuadro
    const portada = R.portadaBlob ? await rlSubir(f, R.portadaBlob, 'portada.jpg', 'image').catch(() => '') : '';
    R.estado = 'procesando'; igRefrescar();
    const { id } = await igApi('ig-reel-crear', { video, caption: R.caption, ...(portada ? { portada } : {}) });
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
