// ─────────────────────────────────────────────────────────────
//  js/panel/ig-mp4.js — v59: empaqueta video H.264 en un MP4
//   El navegador codifica cada cuadro con WebCodecs (VideoEncoder) y aquí
//   se arma el archivo .mp4 a mano: ftyp + moov + mdat ("fast start", el
//   índice va antes de los datos para que empiece a reproducirse al tiro).
//   Sin librerías externas. Una sola pista de video, sin audio.
//
//   const m = RlMp4.nuevo({ ancho: 1080, alto: 1920, fps: 30 });
//   encoder.output = (chunk, meta) => m.agregar(chunk, meta);
//   … await encoder.flush(); const blob = m.terminar();
// ─────────────────────────────────────────────────────────────
const RlMp4 = (() => {
  const enc = new TextEncoder();
  const u16 = n => [(n >>> 8) & 255, n & 255];
  const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const i32 = n => u32(n >>> 0);
  const txt = s => [...enc.encode(s)];
  const ceros = n => new Array(n).fill(0);
  const MATRIZ = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];

  // Caja MP4: tamaño (4) + tipo (4) + contenido. Las partes pueden ser arrays o Uint8Array.
  function caja(tipo, ...partes) {
    const largo = 8 + partes.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(largo);
    out.set(u32(largo), 0); out.set(txt(tipo), 4);
    let o = 8;
    for (const p of partes) { out.set(p, o); o += p.length; }
    return out;
  }
  const cajaCompleta = (tipo, version, flags, ...partes) => caja(tipo, [version, (flags >>> 16) & 255, (flags >>> 8) & 255, flags & 255], ...partes);

  function nuevo({ ancho, alto, fps = 30 }) {
    const ESCALA = fps * 1000;                // escala de tiempo de la pista (30 fps → 30000)
    const DUR = 1000;                         // cada cuadro dura 1000 unidades
    const muestras = [];                      // { datos, clave, pts }
    let avcC = null;

    function agregar(chunk, meta) {
      if (!avcC && meta?.decoderConfig?.description) {
        const d = meta.decoderConfig.description;
        avcC = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
      }
      const datos = new Uint8Array(chunk.byteLength);
      chunk.copyTo(datos);
      muestras.push({ datos, clave: chunk.type === 'key', pts: Math.round((chunk.timestamp || 0) * ESCALA / 1e6) });
    }

    function terminar() {
      if (!avcC) throw new Error('El codificador no entregó la configuración del video.');
      if (!muestras.length) throw new Error('El video quedó vacío.');
      const n = muestras.length;
      const pts0 = Math.min(...muestras.map(m => m.pts));
      // Si el codificador reordena cuadros (B-frames), hace falta ctts con desfases
      const desfases = muestras.map((m, i) => (m.pts - pts0) - i * DUR);
      const reordena = desfases.some(d => d !== 0);
      const durPista = n * DUR, durPeli = Math.round(n * 1000 / fps);

      const ftyp = caja('ftyp', txt('isom'), u32(512), txt('isom'), txt('iso2'), txt('avc1'), txt('mp41'));
      const mvhd = cajaCompleta('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(durPeli), u32(0x00010000), u16(0x0100), ceros(10), MATRIZ, ceros(24), u32(2));
      const tkhd = cajaCompleta('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(durPeli), ceros(8), u16(0), u16(0), u16(0), u16(0), MATRIZ, u32(ancho * 65536), u32(alto * 65536));
      const mdhd = cajaCompleta('mdhd', 0, 0, u32(0), u32(0), u32(ESCALA), u32(durPista), u16(0x55c4), u16(0));
      const hdlr = cajaCompleta('hdlr', 0, 0, u32(0), txt('vide'), ceros(12), txt('VideoHandler'), [0]);
      const vmhd = cajaCompleta('vmhd', 0, 1, u16(0), ceros(6));
      const dinf = caja('dinf', cajaCompleta('dref', 0, 0, u32(1), cajaCompleta('url ', 0, 1)));
      const avc1 = caja('avc1', ceros(6), u16(1), u16(0), u16(0), ceros(12), u16(ancho), u16(alto),
        u32(0x00480000), u32(0x00480000), u32(0), u16(1), ceros(32), u16(0x0018), u16(0xffff),
        caja('avcC', avcC), caja('pasp', u32(1), u32(1)));
      const stsd = cajaCompleta('stsd', 0, 0, u32(1), avc1);
      const stts = cajaCompleta('stts', 0, 0, u32(1), u32(n), u32(DUR));
      const claves = muestras.map((m, i) => m.clave ? i + 1 : 0).filter(Boolean);
      const stss = cajaCompleta('stss', 0, 0, u32(claves.length), ...claves.map(u32));
      const ctts = reordena ? cajaCompleta('ctts', 1, 0, u32(n), ...muestras.map((m, i) => [...u32(1), ...i32(desfases[i])])) : null;
      const stsc = cajaCompleta('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1));
      const stsz = cajaCompleta('stsz', 0, 0, u32(0), u32(n), ...muestras.map(m => u32(m.datos.length)));
      const totalDatos = muestras.reduce((a, m) => a + m.datos.length, 0);

      const armarMoov = desplazamiento => {
        const stco = cajaCompleta('stco', 0, 0, u32(1), u32(desplazamiento));
        const stbl = caja('stbl', stsd, stts, ...(ctts ? [ctts] : []), stss, stsc, stsz, stco);
        const minf = caja('minf', vmhd, dinf, stbl);
        const mdia = caja('mdia', mdhd, hdlr, minf);
        return caja('moov', mvhd, caja('trak', tkhd, mdia));
      };
      // El tamaño del moov no depende del número que va en stco: se arma, se mide y se rehace
      const tamMoov = armarMoov(0).length;
      const moov = armarMoov(ftyp.length + tamMoov + 8);
      const mdatCab = new Uint8Array([...u32(8 + totalDatos), ...txt('mdat')]);
      return new Blob([ftyp, moov, mdatCab, ...muestras.map(m => m.datos)], { type: 'video/mp4' });
    }

    return { agregar, terminar, get cuadros() { return muestras.length; } };
  }
  return { nuevo };
})();
