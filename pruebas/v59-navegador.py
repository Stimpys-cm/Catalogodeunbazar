# Pruebas v59 en navegador: Reels profesionales.
#  - Vista previa en vivo (canvas 9:16), 3 diseños, reproducir y adelantar.
#  - Zona segura: con nombres larguísimos, precios con descuento y los 3 tipos, ningún texto
#    cae bajo la interfaz de Instagram. La portada queda dentro del recorte 3:4 del perfil.
#  - Capas "Zonas de Instagram" y "Recorte del perfil" con las medidas correctas.
#  - El video sale en MP4 H.264 1080×1920 a 30 cuadros por segundo, se reproduce sin errores
#    (ffmpeg) y cada cuadro es igual a la vista previa en ese momento.
#  - Respaldo sin WebCodecs (grabación), cancelar, publicar con portada y celular.
# Requiere el servidor de pruebas: node pruebas/correr.mjs --servidor
import json, re, os, base64, subprocess, tempfile, io
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageChops, ImageStat

BASE = 'http://127.0.0.1:8766/'
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)

# Fotos de prueba: verticales, cuadradas y acostadas
FOTOS = tempfile.mkdtemp(prefix='fotos-v59-')
tam = [(1080, 1440), (1080, 1440), (1080, 1080), (1080, 1350), (1440, 1080), (1080, 1440)]
colores = [(120, 72, 48), (40, 62, 98), (30, 30, 30), (140, 40, 70), (60, 95, 60), (170, 110, 40)]
for i in range(6):
    for j in range(2):
        w, h = tam[i]; im = Image.new('RGB', (w, h), (225 - j * 20, 215, 200)); d = ImageDraw.Draw(im)
        d.rectangle([w * .3, h * .2, w * .7, h * .8], fill=colores[i]); d.ellipse([w * .44, h * .17, w * .56, h * .26], fill=(225, 215, 200))
        im.save(f'{FOTOS}/p{i + 1}-{j + 1}.jpg', quality=88)

EST = json.dumps({'bazarId': 1, 'conectado': True, 'config': {}, 'defaults': {}, 'perfil': {'username': 'stiimpys'}, 'token': {}, 'pagos': 'Aceptamos tarjeta, efectivo y transferencia'})

def abrir(b, movil=False, oscuro=False):
    ctx = b.new_context(viewport={'width': 390, 'height': 844} if movil else {'width': 1440, 'height': 1000}, device_scale_factor=2 if movil else 1, is_mobile=movil, has_touch=movil)
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});" + ("localStorage.setItem('stmp-tema','oscuro');" if oscuro else ''))
    page = ctx.new_page(); errs, llamadas = [], []
    page.on('pageerror', lambda x: errs.append(str(x)[:200]))
    page.on('console', lambda m: errs.append('console: ' + m.text[:160]) if m.type == 'error' else None)
    def foto(route):
        m = re.search(r'/(p\d+-\d+)\.jpg', route.request.url)
        route.fulfill(status=200, path=f"{FOTOS}/{m.group(1) if m else 'p1-1'}.jpg", headers={'Access-Control-Allow-Origin': '*', 'Content-Type': 'image/jpeg'})
    page.route(re.compile(r'https://res\.cloudinary\.com/.*'), foto)
    def cloud(route):
        es_video = '/video/upload' in route.request.url
        llamadas.append(('subir', 'video' if es_video else 'imagen'))
        url = 'https://res.cloudinary.com/minube/' + ('video/upload/v1/bazar/reels/r1.mp4' if es_video else 'image/upload/v1/bazar/reels/p1.jpg')
        route.fulfill(status=200, content_type='application/json', headers={'Access-Control-Allow-Origin': '*'}, body=json.dumps({'secure_url': url}))
    page.route(re.compile(r'https://api\.cloudinary\.com/.*'), cloud)
    def ig(route):
        o = re.search(r'op=([\w-]+)', route.request.url).group(1)
        cuerpo = route.request.post_data_json if route.request.method == 'POST' else None
        llamadas.append((o, cuerpo))
        r = {'ig-estado': json.loads(EST), 'ig-firma-video': {'cloud': 'minube', 'api_key': 'k', 'timestamp': 1, 'folder': 'bazar/reels', 'signature': 's'},
             'ig-reel-crear': {'ok': True, 'id': '17890001'}, 'ig-reel-estado': {'estado': 'FINISHED'}, 'ig-reel-publicar': {'ok': True}}.get(o, {'posts': []})
        route.fulfill(status=200, content_type='application/json', body=json.dumps(r))
    page.route(re.compile(r'.*/api/acciones\?op=ig-.*'), ig)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(2500)
    page.evaluate("""() => { getDB().filter(x => !x.vendido && !x.oculto).slice(0, 6).forEach((x, i) => {
        x.imagenes = [1, 2].map(j => `https://res.cloudinary.com/demo/image/upload/v1/bazar/p${i + 1}-${j}.jpg`); x.creadoEn = '2099-01-0' + (9 - i); });
      showTab('instagram'); }""")
    page.wait_for_timeout(700)
    page.evaluate("() => igVista('reels')"); page.wait_for_timeout(2200)
    return ctx, page, errs, llamadas

def png(page, js):
    return Image.open(io.BytesIO(base64.b64decode(page.evaluate(js).split(',')[1]))).convert('RGB')

with sync_playwright() as p:
    b = p.chromium.launch()

    # ── Escritorio ───────────────────────────────────────────
    ctx, page, e, llamadas = abrir(b)
    tag = 'escritorio'
    ok(page.locator('#rlCanvas').count() == 1 and page.evaluate("() => [rlCanvas.width, rlCanvas.height]") == [720, 1280], f'{tag}: vista previa en vivo 9:16 (720×1280)')
    ok(page.evaluate("() => RL.prep && RL.prep.items.length") == 6, f'{tag}: carga las 6 prendas elegidas')
    ok(page.locator('.rl-pl').count() == 3 and page.locator('.rl-pl.on[data-plantilla="galeria"]').count() == 1, f'{tag}: 3 diseños, Galería de inicio')
    lum = page.evaluate("() => { const d = rlCanvas.getContext('2d').getImageData(0, 0, 720, 1280).data; let s = 0; for (let i = 0; i < d.length; i += 4000) s += d[i] + d[i+1] + d[i+2]; return s; }")
    ok(lum > 0, f'{tag}: la vista previa ya está dibujada')
    page.wait_for_timeout(300)
    ok('zona segura' in page.locator('#rlZonaOk').inner_text(), f'{tag}: avisa que el texto está en la zona segura')
    # Reproducir y adelantar
    page.click('#rlPlay'); page.wait_for_timeout(900)
    t1 = page.evaluate('() => IG.reel.t')
    ok(page.evaluate('() => IG.reel.reproduciendo') and t1 > .4, f'{tag}: reproducir avanza el tiempo ({t1:.2f}s)')
    page.click('#rlPlay'); t2 = page.evaluate('() => IG.reel.t'); page.wait_for_timeout(400)
    ok(not page.evaluate('() => IG.reel.reproduciendo') and page.evaluate('() => IG.reel.t') == t2, f'{tag}: pausar lo detiene')
    page.fill('#rlTiempo', '9.5'); page.dispatch_event('#rlTiempo', 'input')
    ok(abs(page.evaluate('() => IG.reel.t') - 9.5) < .01 and '0:09' in page.inner_text('#rlReloj'), f'{tag}: la barra adelanta a cualquier momento')

    # Zona segura con casos difíciles, en los 3 diseños y los 3 tipos
    page.evaluate("""() => { const l = getDB().filter(x => !x.vendido && !x.oculto).slice(0, 6);
      l[0].nombre = 'Chamarra de mezclilla Levi’s Trucker Type III sherpa original de los noventa con parches bordados a mano';
      l[0].marca = 'Levi Strauss & Co. Vintage Collection Japan'; l[0].talla = 'XXL Hombre · Oversize'; l[0].estado = 'Excelente estado, sin manchas ni detalles';
      l[1].precio_venta = 12500; l[1].precioAnterior = 18900; l[2].nombre = 'Top'; l[3].nombre = 'W'.repeat(60);
      RL.prep = null; RL.revision = null; }""")
    page.evaluate("() => rlPreparar()"); page.wait_for_timeout(1500)
    malas = page.evaluate("""() => { const out = [];
      for (const pl of Object.keys(RL_PLANTILLAS)) for (const es of Object.keys(RL_ESTILOS)) for (const seg of [2, 3.5]) {
        IG.reel.plantilla = pl; IG.reel.estilo = es; IG.reel.seg = seg;
        const A = rlArmado(RL.prep), r = rlRevisarZonas(A), c = rlRevisarPortada(A);
        if (!r.ok || r.textos < 30) out.push([pl, es, seg, 'video', r.textos, r.fallas.slice(0, 2)]);
        if (!c.ok) out.push([pl, es, 'portada', c.fuera.slice(0, 2)]);
      }
      IG.reel.plantilla = 'galeria'; IG.reel.estilo = 'nuevos'; IG.reel.seg = 2.6; return out; }""")
    ok(not malas, f'{tag}: ningún texto bajo la interfaz de Instagram (3 diseños × 3 tipos × 2 velocidades, nombres larguísimos) {malas[:2]}')
    # Cada texto se revisa con su caja real
    cajas = page.evaluate("() => { const A = { ...rlArmado(RL.prep), medidas: [] }; const c = document.createElement('canvas').getContext('2d'); rlDibujar(c, A, RL.INTRO + 2.5); return A.medidas; }")
    i0 = next((k for k, c in enumerate(cajas) if c['s'].startswith('Chamarra')), -1)
    nombre = cajas[i0:i0 + 2] if i0 >= 0 else []
    ok(len(nombre) == 2 and all(c['x1'] - c['x0'] <= 704.5 for c in nombre) and nombre[1]['s'].endswith('…'), f'{tag}: un nombre larguísimo se parte en 2 líneas y se recorta con "…" ({[c["s"] for c in nombre]})')
    ok(any(c['s'] == '-34%' for c in page.evaluate("() => { const A = { ...rlArmado(RL.prep), medidas: [] }; rlDibujar(document.createElement('canvas').getContext('2d'), A, RL.INTRO + 2.6 + 2.5); return A.medidas; }")), f'{tag}: con rebaja muestra precio anterior y -34%')
    page.evaluate("() => { RL.prep = null; RL.revision = null; igRefrescar(); }"); page.wait_for_timeout(1500)

    # Capas de la vista previa
    page.click('text=Zonas de Instagram'); page.click('text=Recorte del perfil (3:4)')
    med = page.evaluate("""() => { const L = document.getElementById('rlLienzo').getBoundingClientRect(), r = s => document.querySelector(s).getBoundingClientRect();
      return { h: L.height, w: L.width, arriba: r('.rl-z-arriba').height, abajo: r('.rl-z-abajo').height, riel: r('.rl-z-riel').width, rielTop: r('.rl-z-riel').top - L.top,
               corte: getComputedStyle(document.querySelector('.rl-recorte'), '::before').height, zonas: getComputedStyle(document.querySelector('.rl-zonas')).display }; }""")
    cerca = lambda a, b: abs(a - b) < 1.2
    ok(med['zonas'] == 'block' and cerca(med['arriba'], med['h'] * 270 / 1920) and cerca(med['abajo'], med['h'] * 440 / 1920), f"{tag}: zonas de arriba (270 px) y abajo (440 px) a escala")
    ok(cerca(med['riel'], med['w'] * 150 / 1080) and cerca(med['rielTop'], med['h'] * 1000 / 1920), f'{tag}: columna de botones a la derecha a escala')
    ok(cerca(float(med['corte'].replace('px', '')), med['h'] * 240 / 1920), f'{tag}: recorte 3:4 del perfil (240 px arriba y abajo)')
    ok(page.evaluate("() => IG.reel.zonas && IG.reel.recorte"), f'{tag}: los interruptores recuerdan lo elegido')

    # Cambiar de diseño
    page.click('.rl-pl[data-plantilla="claro"]'); page.wait_for_timeout(600)
    claro = page.evaluate("() => { const d = rlCanvas.getContext('2d').getImageData(20, 20, 1, 1).data; return d[0] + d[1] + d[2]; }")
    ok(page.evaluate("() => IG.reel.plantilla") == 'claro' and claro > 600, f'{tag}: el diseño Claro cambia la vista previa al momento (fondo crema)')
    page.click('.rl-pl[data-plantilla="completa"]'); page.wait_for_timeout(400)

    # Crear el video
    page.click('button:has-text("Crear video")')
    page.wait_for_function("() => IG.reel.estado === 'armando'", timeout=5000)
    ok(page.locator('.rl-avance').count() == 1, f'{tag}: muestra el avance mientras se crea')
    page.wait_for_function("() => IG.reel.estado === '' && IG.reel.video", timeout=180000)
    info = page.evaluate("() => ({ motor: IG.reel.motor, ext: IG.reel.ext, tam: IG.reel.blob.size, portada: IG.reel.portadaBlob && IG.reel.portadaBlob.type, dur: rlDuracion(6, IG.reel.seg) })")
    ok(info['motor'] == 'webcodecs' and info['ext'] == 'mp4', f"{tag}: video MP4 cuadro por cuadro ({info['motor']}, {info['tam'] // 1024} KB)")
    datos = page.evaluate("async () => { const b = new Uint8Array(await IG.reel.blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }")
    ruta = os.path.join(tempfile.mkdtemp(), 'reel.mp4'); open(ruta, 'wb').write(base64.b64decode(datos))
    pr = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_frames:format=duration', '-of', 'json', ruta], capture_output=True, text=True)
    pj = json.loads(pr.stdout or '{}'); st = (pj.get('streams') or [{}])[0]
    cuadros = round(info['dur'] * 30)
    ok(st.get('codec_name') == 'h264' and st.get('width') == 1080 and st.get('height') == 1920 and st.get('r_frame_rate') == '30/1', f"{tag}: H.264 1080×1920 a 30 cuadros por segundo ({st})")
    ok(int(st.get('nb_frames', 0)) == cuadros and abs(float(pj['format']['duration']) - cuadros / 30) < .01, f"{tag}: {cuadros} cuadros, dura {pj['format']['duration']} s")
    dec = subprocess.run(['ffmpeg', '-v', 'error', '-i', ruta, '-f', 'null', '-'], capture_output=True, text=True)
    ok(dec.returncode == 0 and not dec.stderr.strip(), f'{tag}: se reproduce completo sin errores')
    with open(ruta, 'rb') as f: cab = f.read(64)
    ok(cab[4:8] == b'ftyp' and b'moov' in open(ruta, 'rb').read(4096), f'{tag}: el índice va al inicio (empieza a reproducirse al tiro)')
    # El cuadro del video = la vista previa en ese momento
    t = 1.8 + 2.6 * 2 + 1.5
    sal = os.path.join(os.path.dirname(ruta), 'c.png')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.3f}', '-i', ruta, '-frames:v', '1', sal], check=False)
    vid = Image.open(sal).convert('RGB').resize((270, 480))
    ref = png(page, f"() => {{ const c = document.createElement('canvas'); c.width = 1080; c.height = 1920; rlDibujar(c.getContext('2d'), rlArmado(RL.prep), {t}); return c.toDataURL('image/png'); }}").resize((270, 480))
    dif = sum(ImageStat.Stat(ImageChops.difference(vid, ref)).mean) / 3
    ok(dif < 6, f'{tag}: el cuadro {t:.1f}s del video es igual a la vista previa (diferencia {dif:.1f})')
    ok(info['portada'] == 'image/jpeg' and page.locator('.rl-portada').count() == 1, f'{tag}: portada JPG lista')
    dims = page.evaluate("() => new Promise(r => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = IG.reel.portada; })")
    ok(dims == [1080, 1920], f'{tag}: portada de 1080×1920 ({dims})')
    ok(page.locator('a[download^="reel-stiimpys.mp4"]').count() == 1 and page.locator('a[download="portada-reel-stiimpys.jpg"]').count() == 1, f'{tag}: botones para descargar video y portada')
    ok(page.locator('.rl-lienzo video').count() == 1 and page.locator('.rl-pestanas button').count() == 2, f'{tag}: muestra el video final con pestañas Diseño / Video final')
    cap = page.input_value('#rlCaption')
    ok('NUEVOS INGRESOS' in cap and 'stiimpys.store' in cap and 'Aceptamos tarjeta' in cap and len(re.findall(r'(?<!\S)#[a-z]\w*', cap)) <= 5 and 'wa.me' not in cap, f'{tag}: descripción limpia, con pagos, sin WhatsApp, máximo 5 hashtags')

    # Publicar con portada
    llamadas.clear()
    page.click('button:has-text("Publicar Reel en Instagram")'); page.wait_for_timeout(300)
    page.click('#dlgAceptar')
    page.wait_for_function("() => IG.reel.estado === ''", timeout=20000); page.wait_for_timeout(300)
    subidas = [x[1] for x in llamadas if x[0] == 'subir']
    crear = [x[1] for x in llamadas if x[0] == 'ig-reel-crear']
    ok(subidas == ['video', 'imagen'], f'{tag}: sube el video y la portada ({subidas})')
    ok(crear and crear[0].get('portada', '').endswith('/bazar/reels/p1.jpg') and crear[0].get('video', '').endswith('r1.mp4'), f'{tag}: pide el Reel con su portada')
    ok(any(x[0] == 'ig-reel-publicar' for x in llamadas), f'{tag}: lo publica cuando Instagram termina')

    # Cambiar algo descarta el video viejo (para no publicar uno que ya no corresponde)
    page.click('.rl-pl[data-plantilla="galeria"]'); page.wait_for_timeout(500)
    ok(page.evaluate("() => !IG.reel.video && !IG.reel.portada") and page.locator('#rlCanvas').count() == 1, f'{tag}: cambiar el diseño descarta el video anterior')

    # Cancelar
    page.click('button:has-text("Crear video")'); page.wait_for_function("() => IG.reel.estado === 'armando'", timeout=5000); page.wait_for_timeout(300)
    page.click('.rl-avance button'); page.wait_for_function("() => IG.reel.estado === ''", timeout=10000)
    ok(page.evaluate("() => !IG.reel.video"), f'{tag}: Cancelar detiene la creación')
    ok(not e, f'{tag}: sin errores ({e[:2]})')
    ctx.close()

    # ── Respaldo sin WebCodecs (navegadores viejos) ──────────
    ctx, page, e, _ = abrir(b)
    page.evaluate("""() => { delete window.VideoEncoder; window.VideoEncoder = undefined; const prim = [...IG.reel.sel][0]; IG.reel.sel = new Set([prim]); IG.reel.seg = 2; RL.prep = null; igRefrescar(); }""")
    page.wait_for_timeout(1200)
    page.click('button:has-text("Crear video")')
    page.wait_for_function("() => IG.reel.estado === '' && IG.reel.video", timeout=40000)
    r = page.evaluate("() => ({ motor: IG.reel.motor, tam: IG.reel.blob.size, ext: IG.reel.ext })")
    ok(r['motor'] == 'grabacion' and r['tam'] > 10000, f"respaldo: sin WebCodecs lo graba en tiempo real ({r['ext']}, {r['tam'] // 1024} KB)")
    ok(not e, f'respaldo: sin errores ({e[:2]})')
    ctx.close()

    # ── Celular y tema oscuro ────────────────────────────────
    for oscuro in (False, True):
        ctx, page, e, _ = abrir(b, movil=True, oscuro=oscuro)
        tag = 'celular' + (' oscuro' if oscuro else '')
        ok(page.evaluate("() => document.documentElement.scrollWidth") <= 390, f'{tag}: nada se sale de la pantalla')
        w = page.evaluate("() => document.getElementById('rlLienzo').getBoundingClientRect().width")
        ok(250 <= w <= 300.5, f'{tag}: la vista previa cabe ({w:.0f}px)')
        caja = page.evaluate("() => [...document.querySelectorAll('.rl-pl')].map(x => x.getBoundingClientRect()).map(r => [r.width, r.right])")
        ok(len(caja) == 3 and all(c[0] > 80 and c[1] <= 390 for c in caja), f'{tag}: los 3 diseños caben en una fila')
        if oscuro:
            fondo = page.evaluate("() => getComputedStyle(document.querySelector('.rl-pl')).backgroundColor")
            ok(fondo not in ('rgb(255, 255, 255)',), f'{tag}: las tarjetas de diseño siguen el tema ({fondo})')
        page.evaluate("() => document.querySelector('.rl-prev').scrollIntoView()")
        page.click('text=Zonas de Instagram'); page.wait_for_timeout(200)
        ok(page.evaluate("() => document.getElementById('rlLienzo').classList.contains('con-zonas')"), f'{tag}: el interruptor de zonas funciona con el dedo')
        ok(not e, f'{tag}: sin errores ({e[:2]})')
        ctx.close()
    b.close()

n = sum(1 for c, _ in res if c)
print(f'\nRESULTADO: {n} de {len(res)} pruebas pasaron')
