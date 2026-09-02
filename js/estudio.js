/* ═══════════════════════════════════════════════════════════
   Estudio de posts — editor de imágenes para Instagram.
   Todo pasa en el navegador: dibuja sobre un <canvas> a 1080px
   y lo descarga como PNG listo para subir. Sin librerías.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const canvas = document.getElementById('esCanvas');
  const ctx = canvas.getContext('2d');
  const wrap = document.getElementById('esCanvasWrap');

  // Paleta de colores (el primero es el de la marca).
  const COLORES = ['#2d6be4', '#111111', '#e0483c', '#0f9d58', '#8b5cf6', '#f5a623', '#ff5c8a', '#0ea5a5'];

  // Textos por defecto según el tipo de post.
  const PLANTILLAS = {
    prenda:    { titulo: 'Nombre de la prenda', subtitulo: 'Talla · Estado · Marca', destacado: '$0', pie: '@tubazar · Pídela por WhatsApp', dlbl: 'Precio' },
    descuento: { titulo: '¡Rebajas!',            subtitulo: 'Aprovecha antes de que se acaben', destacado: '30% OFF', pie: '@tubazar · Solo por hoy', dlbl: 'Descuento' },
    apertura:  { titulo: '¡Ya abrimos!',         subtitulo: 'Nuevo bazar en STMP MARKET',       destacado: 'Nuevas prendas', pie: '@tubazar · Entra ya', dlbl: 'Etiqueta' },
    aviso:     { titulo: 'Aviso importante',     subtitulo: 'Escribe aquí tu mensaje para tus clientes', destacado: '', pie: '@tubazar', dlbl: 'Etiqueta' },
  };

  const state = {
    tipo: 'prenda',
    fmt: 'post',            // post 1080x1080 | story 1080x1920
    estilo: 'claro',
    color: COLORES[0],
    titulo: '', subtitulo: '', destacado: '', pie: '',
    img: null,              // Image ya cargada
    imgSrc: '',
    prendas: [],
  };

  // ── Utilidades de dibujo ──────────────────────────────────
  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Dibuja una imagen tipo "cover" dentro de una caja, con esquinas redondas.
  function cover(img, x, y, w, h, r) {
    ctx.save();
    rr(x, y, w, h, r || 0); ctx.clip();
    const ir = img.width / img.height, br = w / h;
    let dw, dh, dx, dy;
    if (ir > br) { dh = h; dw = h * ir; dx = x - (dw - w) / 2; dy = y; }
    else { dw = w; dh = w / ir; dx = x; dy = y - (dh - h) / 2; }
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  }

  // Ajusta el tamaño de fuente hasta que el texto quepa en maxW.
  function fit(txt, family, size, weight, maxW) {
    let s = size;
    do {
      ctx.font = (weight || '') + ' ' + s + 'px ' + family;
      if (ctx.measureText(txt).width <= maxW) break;
      s -= 2;
    } while (s > 14);
    return s;
  }

  // Parte un texto en varias líneas que quepan en maxW.
  function wrap_(txt, maxW) {
    const words = String(txt).split(/\s+/);
    const lines = []; let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; }
      else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  function shadow(blur, y, a) {
    ctx.shadowColor = 'rgba(0,0,0,' + (a || .18) + ')';
    ctx.shadowBlur = blur; ctx.shadowOffsetY = y || 0; ctx.shadowOffsetX = 0;
  }
  function noShadow() { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; }

  // Colores del tema según el estilo elegido.
  function tema() {
    if (state.estilo === 'oscuro') return { bg: '#111214', card: '#1c1e22', txt: '#ffffff', sub: 'rgba(255,255,255,.72)', acc: state.color, onAcc: '#ffffff' };
    if (state.estilo === 'color')  return { bg: state.color, card: 'rgba(255,255,255,.14)', txt: '#ffffff', sub: 'rgba(255,255,255,.9)', acc: '#ffffff', onAcc: state.color };
    return { bg: '#f5f2ec', card: '#ffffff', txt: '#111111', sub: '#6b6b6b', acc: state.color, onAcc: '#ffffff' };
  }

  // ── Render principal ──────────────────────────────────────
  function render() {
    const W = canvas.width, H = canvas.height;
    const t = tema();
    const story = state.fmt === 'story';

    // Fondo
    if (state.estilo === 'color') {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, state.color);
      g.addColorStop(1, sombra(state.color, -28));
      ctx.fillStyle = g;
    } else ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, H);

    // Logo arriba
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = t.txt;
    ctx.font = "42px 'Bebas Neue'";
    const pad = 72;
    ctx.fillText('STMP MARKET', pad, story ? 118 : 108);
    ctx.fillStyle = t.acc;
    const lw = ctx.measureText('STMP MARKET').width;
    ctx.fillText('.', pad + lw + 4, story ? 118 : 108);

    if (state.tipo === 'descuento') drawDescuento(W, H, t, story);
    else if (state.tipo === 'apertura') drawApertura(W, H, t, story);
    else if (state.tipo === 'aviso') drawAviso(W, H, t, story);
    else drawPrenda(W, H, t, story);
  }

  // Aclara u oscurece un color hex.
  function sombra(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
    r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // Píldora destacada (precio / badge).
  function pill(txt, cx, cy, t, big) {
    if (!txt) return;
    ctx.font = (big ? "700 54px" : "700 40px") + " 'Poppins'";
    const w = ctx.measureText(txt).width, ph = big ? 92 : 72, pw = w + (big ? 68 : 52);
    shadow(22, 10, .22);
    ctx.fillStyle = t.acc;
    rr(cx - pw / 2, cy - ph / 2, pw, ph, ph / 2); ctx.fill();
    noShadow();
    ctx.fillStyle = t.onAcc; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, cx, cy + 2);
    ctx.textBaseline = 'alphabetic';
  }

  // ── Plantilla: PRENDA ─────────────────────────────────────
  function drawPrenda(W, H, t, story) {
    const pad = 72;
    if (story) {
      // Foto a sangre completa arriba + degradado
      if (state.img) cover(state.img, 0, 0, W, H * 0.72, 0);
      else placeholder(0, 0, W, H * 0.72, t);
      const g = ctx.createLinearGradient(0, H * 0.4, 0, H * 0.78);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, t.bg);
      ctx.fillStyle = g; ctx.fillRect(0, H * 0.4, W, H * 0.4);
      // Textos abajo
      let y = H * 0.76;
      ctx.textAlign = 'left'; ctx.fillStyle = t.txt;
      const fs = fit(state.titulo, "'Bebas Neue'", 92, '', W - pad * 2);
      ctx.font = fs + "px 'Bebas Neue'"; ctx.fillText(state.titulo, pad, y); y += 56;
      ctx.font = "400 30px 'Poppins'"; ctx.fillStyle = t.sub;
      wrap_(state.subtitulo, W - pad * 2).slice(0, 2).forEach(l => { ctx.fillText(l, pad, y); y += 42; });
      pill(state.destacado, pad + medirPill(state.destacado, true) / 2, y + 40, t, true);
      footer(W, H, t, story);
    } else {
      // Foto en tarjeta grande
      const fx = pad, fy = 168, fw = W - pad * 2, fh = 668;
      shadow(38, 20, .2);
      ctx.fillStyle = t.card; rr(fx, fy, fw, fh, 40); ctx.fill();
      noShadow();
      if (state.img) cover(state.img, fx, fy, fw, fh, 40);
      else placeholder(fx, fy, fw, fh, t);
      // Precio flotante
      pill(state.destacado, W - pad - medirPill(state.destacado, false) / 2 - 12, fy + fh - 8, t, false);
      // Título + subtítulo
      let y = fy + fh + 78;
      ctx.textAlign = 'left'; ctx.fillStyle = t.txt;
      const fs = fit(state.titulo, "'Bebas Neue'", 84, '', fw);
      ctx.font = fs + "px 'Bebas Neue'"; ctx.fillText(state.titulo, pad, y); y += 46;
      ctx.font = "400 28px 'Poppins'"; ctx.fillStyle = t.sub;
      wrap_(state.subtitulo, fw).slice(0, 1).forEach(l => ctx.fillText(l, pad, y));
      footer(W, H, t, story);
    }
  }

  // ── Plantilla: DESCUENTO ──────────────────────────────────
  function drawDescuento(W, H, t, story) {
    const pad = 72, cx = W / 2;
    const hasImg = !!state.img;
    const imgH = hasImg ? (story ? 680 : 340) : 0;
    const imgY = H - imgH - (story ? 150 : 130);
    const areaTop = story ? 260 : 220;
    const areaBot = hasImg ? imgY - 34 : H - 170;

    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const dfs = fit(state.destacado || 'OFF', "'Bebas Neue'", story ? 300 : 250, '', W - pad * 2);
    const tfs = fit(state.titulo, "'Bebas Neue'", story ? 150 : 120, '', W - pad * 2);
    ctx.font = "400 34px 'Poppins'";
    const subLines = wrap_(state.subtitulo, W - pad * 3).slice(0, 3);
    const hD = state.destacado ? dfs * 0.9 : 0;
    const hT = state.titulo ? tfs * 0.92 : 0;
    const hS = subLines.length * 46;
    const gap = 18;
    const total = hD + (hD ? gap : 0) + hT + (hT ? gap : 0) + hS;
    let y = areaTop + Math.max(0, (areaBot - areaTop - total) / 2);

    if (state.destacado) { ctx.fillStyle = t.acc; ctx.font = dfs + "px 'Bebas Neue'"; ctx.fillText(state.destacado, cx, y); y += hD + gap; }
    if (state.titulo) { ctx.fillStyle = t.txt; ctx.font = tfs + "px 'Bebas Neue'"; ctx.fillText(state.titulo, cx, y); y += hT + gap; }
    ctx.fillStyle = t.sub; ctx.font = "400 34px 'Poppins'";
    subLines.forEach(l => { ctx.fillText(l, cx, y); y += 46; });

    if (hasImg) cover(state.img, pad, imgY, W - pad * 2, imgH, 32);
    ctx.textBaseline = 'alphabetic';
    footer(W, H, t, story);
  }

  // ── Plantilla: APERTURA ───────────────────────────────────
  function drawApertura(W, H, t, story) {
    const pad = 72, cx = W / 2;
    const hasImg = !!state.img;
    const imgY = story ? 210 : 190, imgH = story ? 820 : 430;
    if (hasImg) {
      shadow(38, 20, .2); ctx.fillStyle = t.card; rr(pad, imgY, W - pad * 2, imgH, 40); ctx.fill(); noShadow();
      cover(state.img, pad, imgY, W - pad * 2, imgH, 40);
      pill('¡NUEVO!', cx, imgY + 56, t, false);
    }
    const areaTop = hasImg ? imgY + imgH + 40 : H * 0.30;
    const areaBot = H - 150;

    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const tfs = fit(state.titulo, "'Bebas Neue'", hasImg ? 120 : 150, '', W - pad * 2);
    ctx.font = "600 34px 'Poppins'";
    const subLines = wrap_(state.subtitulo, W - pad * 2).slice(0, 2);
    const hT = state.titulo ? tfs * 0.92 : 0, hS = subLines.length * 46, hP = state.destacado ? 92 : 0, gap = 16;
    const total = hT + gap + hS + (hP ? gap + hP : 0);
    let y = areaTop + Math.max(0, (areaBot - areaTop - total) / 2);

    ctx.fillStyle = t.txt; ctx.font = tfs + "px 'Bebas Neue'"; ctx.fillText(state.titulo, cx, y); y += hT + gap;
    ctx.fillStyle = t.sub; ctx.font = "600 34px 'Poppins'"; subLines.forEach(l => { ctx.fillText(l, cx, y); y += 46; });
    if (state.destacado) { y += gap; ctx.textBaseline = 'middle'; pill(state.destacado, cx, y + 46, t, false); }
    ctx.textBaseline = 'alphabetic';
    footer(W, H, t, story);
  }

  // ── Plantilla: AVISO ──────────────────────────────────────
  function drawAviso(W, H, t, story) {
    const pad = 90, cx = W / 2;
    const fx = pad - 28, fy = story ? 210 : 190, fw = W - (pad - 28) * 2, fh = H - (story ? 420 : 380);
    ctx.strokeStyle = t.acc; ctx.lineWidth = 6; rr(fx, fy, fw, fh, 36); ctx.stroke();

    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const tfs = fit(state.titulo, "'Bebas Neue'", 120, '', fw - 60);
    ctx.font = "400 36px 'Poppins'";
    const subLines = wrap_(state.subtitulo, fw - 80).slice(0, 6);
    const hL = 38, hT = tfs * 0.92, hS = subLines.length * 50, gap = 22;
    const total = hL + gap + hT + gap + hS;
    let y = fy + Math.max(36, (fh - total) / 2);

    ctx.fillStyle = t.acc; ctx.font = "700 30px 'Poppins'"; ctx.fillText((state.destacado || 'AVISO').toUpperCase(), cx, y); y += hL + gap;
    ctx.fillStyle = t.txt; ctx.font = tfs + "px 'Bebas Neue'"; ctx.fillText(state.titulo, cx, y); y += hT + gap;
    ctx.fillStyle = t.sub; ctx.font = "400 36px 'Poppins'"; subLines.forEach(l => { ctx.fillText(l, cx, y); y += 50; });
    ctx.textBaseline = 'alphabetic';
    footer(W, H, t, story);
  }

  // Pie de página común.
  function footer(W, H, t, story) {
    if (!state.pie) return;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = t.sub; ctx.font = "600 26px 'Poppins'";
    ctx.fillText(state.pie, W / 2, H - (story ? 90 : 72));
  }

  function medirPill(txt, big) {
    if (!txt) return 0;
    ctx.font = (big ? "700 54px" : "700 40px") + " 'Poppins'";
    return ctx.measureText(txt).width + (big ? 68 : 52);
  }

  function placeholder(x, y, w, h, t) {
    ctx.save(); rr(x, y, w, h, 40); ctx.clip();
    ctx.fillStyle = state.estilo === 'oscuro' ? '#2a2d32' : '#e6e1d8';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = state.estilo === 'oscuro' ? '#4a4d52' : '#b9b2a5';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = "600 30px 'Poppins'";
    ctx.fillText('Elige o sube una foto', x + w / 2, y + h / 2);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  // ── Formato del lienzo ────────────────────────────────────
  function aplicarFormato() {
    if (state.fmt === 'story') { canvas.width = 1080; canvas.height = 1920; wrap.classList.add('fmt-story'); }
    else { canvas.width = 1080; canvas.height = 1080; wrap.classList.remove('fmt-story'); }
  }

  // ── Carga de imágenes ─────────────────────────────────────
  function cargarImg(src) {
    if (!src) { state.img = null; state.imgSrc = ''; render(); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { state.img = img; state.imgSrc = src; render(); };
    img.onerror = () => { state.img = null; render(); };
    img.src = src;
  }

  // ── Cargar prendas del catálogo ───────────────────────────
  async function cargarPrendas() {
    const sel = document.getElementById('esPrenda');
    try {
      const r = await fetch('/api/sync?scope=publico');
      const data = await r.json();
      const inv = (data.inventario || []).filter(p => p && (p.disponible !== false) && Array.isArray(p.imagenes) && p.imagenes[0]);
      const bazares = {};
      (data.bazares || []).forEach(b => { bazares[b.id] = b.nombre; });
      state.prendas = inv;
      state.bazares = bazares;
      if (!inv.length) { sel.innerHTML = '<option value="">No hay prendas con foto</option>'; return; }
      sel.innerHTML = '<option value="">— Elige una prenda —</option>' +
        inv.map((p, i) => '<option value="' + i + '">' + escaparHTML(p.nombre || 'Prenda') + '</option>').join('');
    } catch (e) {
      sel.innerHTML = '<option value="">No se pudo cargar el catálogo</option>';
    }
  }

  function escaparHTML(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function usarPrenda(i) {
    const p = state.prendas[i];
    if (!p) return;
    const bz = (state.bazares && state.bazares[p.bazarId]) || 'tubazar';
    set('esTitulo', p.nombre || 'Prenda');
    const detalle = [p.talla && 'Talla ' + p.talla, p.estado, p.marca].filter(Boolean).join(' · ');
    set('esSubtitulo', detalle);
    set('esDestacado', p.precio_venta != null ? '$' + Number(p.precio_venta).toLocaleString('es-MX') : '');
    set('esPie', '@' + slug(bz) + ' · Pídela por WhatsApp');
    document.getElementById('esFotoInfo').textContent = 'Usando la foto de: ' + (p.nombre || 'la prenda');
    sincronizarState();
    cargarImg(p.imagenes[0]);
  }

  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function set(id, v) { document.getElementById(id).value = v; }

  function sincronizarState() {
    state.titulo = document.getElementById('esTitulo').value;
    state.subtitulo = document.getElementById('esSubtitulo').value;
    state.destacado = document.getElementById('esDestacado').value;
    state.pie = document.getElementById('esPie').value;
  }

  // Aplica los textos por defecto de una plantilla.
  function aplicarPlantilla(tipo) {
    const pl = PLANTILLAS[tipo];
    set('esTitulo', pl.titulo); set('esSubtitulo', pl.subtitulo);
    set('esDestacado', pl.destacado); set('esPie', pl.pie);
    document.getElementById('esDestacadoLbl').textContent = pl.dlbl;
    document.querySelector('.es-solo-prenda').style.display = tipo === 'prenda' ? '' : 'none';
    sincronizarState();
  }

  // ── Interfaz ──────────────────────────────────────────────
  function initUI() {
    // Colores
    const cWrap = document.getElementById('esColores');
    COLORES.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'es-color' + (i === 0 ? ' active' : '');
      b.style.background = c; b.type = 'button'; b.title = c;
      b.addEventListener('click', () => {
        state.color = c;
        cWrap.querySelectorAll('.es-color').forEach(x => x.classList.remove('active'));
        b.classList.add('active'); render();
      });
      cWrap.appendChild(b);
    });

    // Chips de tipo
    grupoChips('esTipos', 'tipo', v => { state.tipo = v; aplicarPlantilla(v); render(); });
    grupoChips('esFormatos', 'fmt', v => { state.fmt = v; aplicarFormato(); render(); });
    grupoChips('esEstilos', 'estilo', v => { state.estilo = v; render(); });

    // Inputs de texto
    ['esTitulo', 'esSubtitulo', 'esDestacado', 'esPie'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => { sincronizarState(); render(); });
    });

    // Prenda
    document.getElementById('esPrenda').addEventListener('change', e => {
      if (e.target.value !== '') usarPrenda(Number(e.target.value));
    });

    // Subir foto propia
    document.getElementById('esSubirFoto').addEventListener('click', () => document.getElementById('esFile').click());
    document.getElementById('esFile').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = ev => { document.getElementById('esFotoInfo').textContent = 'Usando tu foto subida.'; cargarImg(ev.target.result); };
      rd.readAsDataURL(f);
    });

    // Descargar
    document.getElementById('esDescargar').addEventListener('click', descargar);
  }

  function grupoChips(contId, key, cb) {
    const cont = document.getElementById(contId);
    cont.addEventListener('click', e => {
      const b = e.target.closest('.es-chip'); if (!b) return;
      cont.querySelectorAll('.es-chip').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      cb(b.dataset[key === 'tipo' ? 'tipo' : key === 'fmt' ? 'fmt' : 'estilo']);
    });
  }

  function descargar() {
    render();
    try {
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.download = 'stmp-post-' + state.tipo + '-' + Date.now() + '.png';
      a.href = url; document.body.appendChild(a); a.click(); a.remove();
    } catch (e) {
      alert('No se pudo exportar la imagen. Si usaste una foto del catálogo, intenta subir la foto manualmente.');
    }
  }

  // ── Arranque ──────────────────────────────────────────────
  function start() {
    initUI();
    aplicarPlantilla('prenda');
    aplicarFormato();
    render();
    cargarPrendas();
  }

  // Espera a que las fuentes estén listas para que el canvas no salga con fuente genérica.
  if (document.fonts && document.fonts.ready) {
    Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]).then(() => { start(); render(); });
  } else start();

})();
