# Pruebas v49 en el navegador:
# - Ordenar fotos en "Revisar" (arrastrar, ← →, tocar = portada), en Registrar y en Editar prenda,
#   con mouse y con el dedo. El orden se guarda tal cual.
# - Si acomodaste la portada, la IA ya no la cambia.
# - Detalles y fallas que vio la IA en la tarjeta (la falla dice en qué foto está, aunque muevas el orden).
# - Instagram: el ajuste "Repetir la foto de la portada sin textos" y la vista previa del carrusel.
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v49-navegador.py
import json, re, io, zipfile, hashlib, uuid
from playwright.sync_api import sync_playwright
from PIL import Image

BASE = 'http://127.0.0.1:8766/'
CORRIDA = uuid.uuid4().hex[:8]
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)
def jpg(c, w=300, h=380):
    b = io.BytesIO(); Image.new('RGB', (w, h), c).save(b, 'JPEG'); return b.getvalue()
def errores(page):
    e = []; page.on('pageerror', lambda x: e.append(str(x)[:160]) if 'ViewTransition' not in str(x) else None); return e
def un_zip():
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w', zipfile.ZIP_STORED) as z:
        for i in (1, 2):
            for k in range(3): z.writestr(f'Prenda {i}/{"abc"[k]}.jpg', jpg((40 + i * 60, 30 + k * 70, 90 + k * 40)))
    return b.getvalue()
def centro(page, sel):
    r = page.locator(sel).bounding_box(); return (r['x'] + r['width'] / 2, r['y'] + r['height'] / 2)
def arrastrar(page, de, a, pasos=12):
    page.mouse.move(*de); page.mouse.down()
    for i in range(1, pasos + 1):
        page.mouse.move(de[0] + (a[0] - de[0]) * i / pasos, de[1] + (a[1] - de[1]) * i / pasos); page.wait_for_timeout(16)
    page.mouse.up(); page.wait_for_timeout(300)

def contexto(b, ancho=1440, alto=900, movil=False):
    ctx = b.new_context(viewport={'width': ancho, 'height': alto}, is_mobile=movil, has_touch=movil)
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
    ctx.route(re.compile(r'https://res\.cloudinary\.com/.*'), lambda r: r.fulfill(status=200, content_type='image/jpeg', body=jpg((200, 200, 200))))
    urls = {}
    def subir(route):
        req = route.request
        if req.method != 'POST': return route.continue_()
        f = json.loads(req.post_data or '{}').get('file', '')
        u = urls.setdefault(hashlib.sha1(f.encode()).hexdigest(), f'https://res.cloudinary.com/demo/image/upload/v1/bazar/{CORRIDA}-detalles-{len(urls) + 1}.jpg')
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'url': u}))
    ctx.route('**/api/upload', subir)
    return ctx

with sync_playwright() as p:
    b = p.chromium.launch()
    # ════════ Registro rápido: Agrupar → Revisar ════════
    ctx = contexto(b); page = ctx.new_page(); e = errores(page)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(2500)
    page.evaluate("() => { ZI.ig = 'no'; ZI.investigarRaras = false; }")
    page.evaluate("() => ziAbrir()"); page.wait_for_timeout(500)
    page.set_input_files('#ziModal .zi-drop input[type=file]', files=[{'name': 'lote.zip', 'mimeType': 'application/zip', 'buffer': un_zip()}])
    page.wait_for_function("() => ZI.paso === 'agrupar'", timeout=8000); page.wait_for_timeout(300)
    # Prenda 1: la foto "c" pasa a ser la portada (acomodo a mano)
    f0 = page.locator('#ziGrupos .zi-foto[data-gi="0"][data-fi="0"]').bounding_box()
    arrastrar(page, centro(page, '#ziGrupos .zi-foto[data-gi="0"][data-fi="2"]'), (f0['x'] + 8, f0['y'] + f0['height'] / 2))
    ok(page.evaluate("() => ZI.grupos[0].fotos.map(f => f.base).join('')") == 'c.jpga.jpgb.jpg', 'en Agrupar la foto "c" queda de portada')
    page.locator('button:has-text("Subir y analizar")').click()
    page.wait_for_function("() => ZI.paso === 'revisar' && ZI.grupos.every(g => g.estado === 'hecho') && !ZI.corriendo", timeout=40000)
    page.wait_for_timeout(400)
    ok(page.evaluate("() => ZI.grupos[0].fotos.map(f => f.base).join('')") == 'c.jpga.jpgb.jpg', 'la IA ya no cambia la portada que acomodaste tú')
    ok(page.evaluate("() => ZI.grupos[1].fotos.map(f => f.base).join('')") == 'b.jpga.jpgc.jpg', 'en la prenda que no tocaste, la IA sí elige la mejor portada (la 2ª)')
    g0 = page.evaluate("() => ZI.grupos[0].id"); g1 = page.evaluate("() => ZI.grupos[1].id")

    # Detalles y fallas en la tarjeta
    t1 = f'#ziT{g1}'
    ok(page.locator(f'{t1} .zi-detalles li').count() == 3 and 'Logo bordado en el pecho' in page.locator(f'{t1} .zi-detalles').inner_text(), 'la tarjeta muestra los detalles que vio la IA')
    ok(not page.evaluate("() => window.__xss") and page.locator(f'{t1} .zi-detalles img').count() == 0, 'un detalle con código se muestra como texto (no se ejecuta)')
    fallas = page.locator(f'{t1} .zi-fallas').inner_text()
    ok('Mancha chica en la manga' in fallas and 'foto 3' in fallas, f'la falla dice en qué foto está ("{fallas[:70]}…")')
    desc = page.evaluate(f"() => ZI.grupos.find(g => g.id === {g1}).f.descripcion")
    ok('• Logo bordado en el pecho' in desc and 'A considerar: mancha chica en la manga.' in desc, 'detalles y fallas ya van en la descripción')
    ok(page.locator(f'{t1} textarea').input_value() == desc, 'la descripción completa cabe en el cuadro (antes se cortaba a 600 caracteres)')
    page.locator(f'{t1} .zi-falla-foto').click(); page.wait_for_timeout(200)
    ok(page.locator(f'#ziTF{g1} [data-of-i="2"]').evaluate("e => e.classList.contains('zi-mirar')"), 'tocar "foto 3" resalta esa foto')

    # Arrastrar en Revisar: la 3ª foto (la de la mancha) al inicio
    page.wait_for_timeout(500); page.locator(f'#ziTF{g1}').scroll_into_view_if_needed(); page.wait_for_timeout(400)
    a0 = page.locator(f'#ziTF{g1} [data-of-i="0"]').bounding_box()
    antes = page.evaluate(f"() => ZI.grupos.find(g => g.id === {g1}).subidas.slice()")
    arrastrar(page, centro(page, f'#ziTF{g1} [data-of-i="2"]'), (a0['x'] + 10, a0['y'] + 30))
    despues = page.evaluate(f"() => ZI.grupos.find(g => g.id === {g1}).subidas.slice()")
    ok(despues == [antes[2], antes[0], antes[1]], 'en Revisar se arrastra una foto para cambiar el orden')
    ok(page.evaluate(f"() => ZI.grupos.find(g => g.id === {g1}).fotos.map(f => f.base).join('')") == 'c.jpgb.jpga.jpg', 'las fotos y sus subidas se mueven juntas')
    ok('foto 1' in page.locator(f'{t1} .zi-fallas').inner_text(), 'la falla sigue apuntando a su foto aunque cambie de lugar (ahora "foto 1")')
    ok(page.locator(f'#ziTF{g1} [data-of-i="0"] .of-etq').inner_text().strip() == 'Portada', 'la primera dice "Portada"')
    ok([x.strip() for x in page.locator(f'#ziTF{g1} .zi-t-n').all_inner_texts()] == ['1', '2', '3'], 'cada foto lleva su número')
    ok(page.locator('.of-fantasma, .of-marca').count() == 0 and not page.evaluate("document.body.classList.contains('of-moviendo')"), 'al soltar no queda nada flotando')
    # Soltar no cuenta como clic (no cambia la portada otra vez)
    ok(page.evaluate(f"() => ZI.grupos.find(g => g.id === {g1}).subidas[0]") == antes[2], 'soltar no cuenta como un toque extra')
    # Teclado
    page.locator(f'#ziTF{g1} [data-of-i="1"]').focus(); page.keyboard.press('ArrowLeft'); page.wait_for_timeout(200)
    ok(page.evaluate(f"() => ZI.grupos.find(g => g.id === {g1}).subidas.slice()") == [antes[0], antes[2], antes[1]], '← mueve la foto enfocada un lugar')
    ok(page.evaluate("() => document.activeElement?.dataset?.ofI") == '0', 'el foco sigue a la foto que moviste')
    page.keyboard.press('End'); page.keyboard.press('ArrowRight'); page.wait_for_timeout(200)
    ok(page.evaluate(f"() => ZI.grupos.find(g => g.id === {g1}).subidas.slice()") == [antes[2], antes[0], antes[1]], '→ la regresa')
    # Tocar = portada (como antes)
    page.locator(f'#ziTF{g1} [data-of-i="2"]').click(); page.wait_for_timeout(200)
    ok(page.evaluate(f"() => ZI.grupos.find(g => g.id === {g1}).subidas[0]") == antes[1], 'tocar una foto la sigue haciendo portada')
    orden_final = page.evaluate(f"() => ZI.grupos.find(g => g.id === {g1}).subidas.slice()")
    # Guardar: el orden llega tal cual al inventario
    page.locator('#ziPie button:has-text("Guardar")').first.click(timeout=5000)
    page.wait_for_function("() => ZI.grupos.every(g => g.guardada)", timeout=15000)
    guardada = page.evaluate(f"() => getDB().find(p => p.id === ZI.grupos.find(g => g.id === {g1}).prendaId)?.imagenes")
    ok(guardada == orden_final, 'al guardar, la prenda queda con las fotos en el orden que acomodaste')
    ok(page.locator(f'#ziTF{g1} [onpointerdown]').count() == 0, 'una prenda ya guardada ya no se reordena aquí (se edita desde el inventario)')
    ok(not e, f'sin errores en la página ({e[:2]})')

    # ════════ Registrar prenda (formulario) ════════
    page.evaluate("() => ziCerrar()"); page.wait_for_timeout(300)
    page.evaluate("() => showTab('registrar')"); page.wait_for_timeout(600)
    U = [f'https://res.cloudinary.com/demo/image/upload/v1/bazar/{CORRIDA}-form-{i}.jpg' for i in range(4)]
    page.evaluate("u => { clearForm?.(); editImages = []; newImages = u.slice(); renderPreviews(); }", U)
    ok(page.locator('#previewStrip .of-item').count() == 4 and page.locator('#previewStrip .of-item').first.locator('.of-etq').count() == 1, 'Registrar: las fotos se ven con "Portada" en la primera')
    page.locator('#previewStrip').scroll_into_view_if_needed(); page.wait_for_timeout(200)
    p0 = page.locator('#previewStrip [data-of-i="0"]').bounding_box()
    arrastrar(page, centro(page, '#previewStrip [data-of-i="3"]'), (p0['x'] + 6, p0['y'] + p0['height'] / 2))
    ok(page.evaluate("() => [...editImages, ...newImages]") == [U[3], U[0], U[1], U[2]], 'Registrar: arrastrar cambia el orden')
    page.locator('#previewStrip [data-of-i="1"]').hover()
    page.locator('#previewStrip [data-of-i="1"] .of-portada-btn').click(); page.wait_for_timeout(150)
    ok(page.evaluate("() => [...editImages, ...newImages]")[0] == U[0], 'Registrar: ★ la hace portada')
    page.locator('#previewStrip [data-of-i="0"]').focus(); page.keyboard.press('ArrowRight'); page.wait_for_timeout(150)
    ok(page.evaluate("() => [...editImages, ...newImages]")[:2] == [U[3], U[0]], 'Registrar: → con el teclado')
    page.locator('#previewStrip [data-of-i="1"]').hover(); page.locator('#previewStrip [data-of-i="1"] .of-quitar').click(); page.wait_for_timeout(150)
    ok(len(page.evaluate("() => [...editImages, ...newImages]")) == 3, 'Registrar: ✕ sigue quitando la foto')
    # Una foto que termina de subir después de mover/quitar otras no se pierde (antes se quedaba en base64)
    r = page.evaluate("""() => { editImages = ['A']; newImages = ['data:image/jpeg;base64,BBBB']; removePreview(0);
      moverPreview(0, 0); const ok1 = reemplazarFotoSubida('data:image/jpeg;base64,BBBB', 'https://res.cloudinary.com/demo/image/upload/b.jpg');
      return { ok1, todas: [...editImages, ...newImages] }; }""")
    ok(r['ok1'] and r['todas'] == ['https://res.cloudinary.com/demo/image/upload/b.jpg'], 'Registrar: si quitas o mueves fotos mientras otra sube, la que sube queda bien guardada')

    # ════════ Editar prenda (ventana) ════════
    pid = page.evaluate("() => { const p = getDB().find(x => x.costo > 0 && !x.vendido); p.imagenes = ['https://res.cloudinary.com/demo/image/upload/e1.jpg','https://res.cloudinary.com/demo/image/upload/e2.jpg','https://res.cloudinary.com/demo/image/upload/e3.jpg']; return p.id; }")
    page.evaluate(f"() => re_editar_prenda({pid})"); page.wait_for_timeout(500)
    orig = page.evaluate("() => reEditImgs.slice()")
    page.locator('#rePreviewStrip').scroll_into_view_if_needed(); page.wait_for_timeout(200)
    q0 = page.locator('#rePreviewStrip [data-of-i="0"]').bounding_box()
    arrastrar(page, centro(page, f'#rePreviewStrip [data-of-i="{len(orig) - 1}"]'), (q0['x'] + 6, q0['y'] + q0['height'] / 2))
    nuevo = page.evaluate("() => reEditImgs.slice()")
    ok(nuevo[0] == orig[-1] and sorted(nuevo) == sorted(orig), 'Editar: arrastrar la última foto la vuelve portada')
    avisos = page.evaluate("async () => { const avisos = []; const t0 = window.toast; window.toast = (m, o) => { avisos.push(String(m)); return t0?.(m, o); }; await guardarReEdicion(); window.toast = t0; return avisos; }")
    page.wait_for_timeout(800)
    guard = page.evaluate(f"() => getDB().find(p => p.id === {pid}).imagenes")
    ok(guard[0] == orig[-1], f'Editar: al guardar, la prenda queda con el orden nuevo ({avisos})')
    ok(not e, f'sin errores en la página ({e[:2]})')

    # ════════ Instagram: ajuste y vista previa ════════
    def ig_falso(route):
        op = re.search(r'op=([\w-]+)', route.request.url).group(1)
        if op == 'ig-estado':
            cfg = {'plantilla': True, 'portadaSola': True, 'tonoPlantilla': 'crema', 'firma': '', 'hashtags': '', 'respuestasRapidas': [], 'automatico': {}}
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'bazarId': 1, 'bazar': 'Stiimpys', 'conectado': True, 'config': cfg, 'defaults': cfg, 'perfil': {'username': 'stiimpys', 'profile_picture_url': ''}, 'token': {}}))
        if op == 'ig-posts': return route.fulfill(status=200, content_type='application/json', body=json.dumps({'posts': []}))
        return route.fulfill(status=200, content_type='application/json', body='{}')
    page.route(re.compile(r'.*/api/acciones\?op=ig-.*'), ig_falso)
    page.evaluate("() => showTab('instagram')"); page.wait_for_function("() => IG.estado?.conectado", timeout=8000); page.wait_for_timeout(400)
    page.evaluate("() => igVista('ajustes')"); page.wait_for_timeout(300)
    sw = page.locator('#igCfg_portadaSola')
    ok(sw.count() == 1 and sw.is_checked() and 'Repetir la foto de la portada' in page.locator('label:has(#igCfg_portadaSola)').inner_text(), 'Ajustes: "Repetir la foto de la portada sin textos" viene prendido')
    enviado = {}
    page.route(re.compile(r'.*/api/acciones\?op=ig-config.*'), lambda r: (enviado.update(json.loads(r.request.post_data or '{}')), r.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'config': {}})))[1])
    page.locator('label:has(#igCfg_portadaSola)').click(timeout=5000)
    page.evaluate("() => igGuardarConfig?.()") if page.evaluate("() => typeof igGuardarConfig === 'function'") else page.locator('#igGuardarCfg').click()
    page.wait_for_timeout(500)
    ok(enviado.get('portadaSola') is False, 'Ajustes: apagarlo se manda al guardar')
    # Vista previa del carrusel en Crear
    prenda = page.evaluate("() => { const p = getDB().find(x => !x.vendido && (x.imagenes || []).length); p.imagenes = ['https://res.cloudinary.com/demo/image/upload/v1/x1.jpg','https://res.cloudinary.com/demo/image/upload/v1/x2.jpg']; return p.id; }")
    page.evaluate(f"() => {{ IG.estado.config = {{ ...IG.estado.config, plantilla: true, portadaSola: true }}; IG.tipo = 'post'; igVista('crear'); igUsarPrenda({prenda}); IG.usarPlantilla = true; igRefrescar(); }}"); page.wait_for_timeout(400)
    dbg = page.evaluate("() => ({ fotos: IG.fotos, prenda: IG.prendaId, usar: IG.usarPlantilla, img: getDB().find(x => x.id === IG.prendaId)?.imagenes, puntos: document.querySelectorAll('.igx-tel-puntos i').length, btn: [...document.querySelectorAll('.igx-btn.grad.grande')].map(b => b.innerText) })")
    ok(dbg['puntos'] == 3 and any('publicar carrusel (3)' in t.lower() for t in dbg['btn']), 'Crear: con plantilla, 2 fotos se publican como 3 (portada + la misma foto limpia + la otra)')
    ok('2ª foto' in page.locator('.igx-switch.fila').inner_text(), 'Crear: lo explica junto a "Portada con plantilla editorial"')
    page.evaluate("() => { IG.estado.config.portadaSola = false; igRefrescar(); }"); page.wait_for_timeout(200)
    ok(page.locator('.igx-tel-puntos i').count() == 2, 'Crear: con el ajuste apagado son 2')
    ok(not e, f'sin errores en la página ({e[:2]})')
    ctx.close()

    # ════════ Celular ════════
    ctx = contexto(b, 390, 844, True); page = ctx.new_page(); e = errores(page); cdp = ctx.new_cdp_session(page)
    def toque(de, a, espera=0, pasos=14):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': de[0], 'y': de[1]}]})
        if espera: page.wait_for_timeout(espera)
        for i in range(1, pasos + 1):
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': de[0] + (a[0] - de[0]) * i / pasos, 'y': de[1] + (a[1] - de[1]) * i / pasos}]}); page.wait_for_timeout(20)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); page.wait_for_timeout(400)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(2500)
    page.evaluate("() => { ZI.ig = 'no'; ZI.investigarRaras = false; ziAbrir(); }"); page.wait_for_timeout(500)
    page.set_input_files('#ziModal .zi-drop input[type=file]', files=[{'name': 'lote.zip', 'mimeType': 'application/zip', 'buffer': un_zip()}])
    page.wait_for_function("() => ZI.paso === 'agrupar'", timeout=8000)
    page.locator('button:has-text("Subir y analizar")').click()
    page.wait_for_function("() => ZI.paso === 'revisar' && ZI.grupos.every(g => g.estado === 'hecho') && !ZI.corriendo", timeout=40000); page.wait_for_timeout(400)
    g = page.evaluate("() => ZI.grupos[0].id")
    page.locator(f'#ziTF{g}').scroll_into_view_if_needed(); page.wait_for_timeout(200)
    antes = page.evaluate(f"() => ZI.grupos.find(x => x.id === {g}).subidas.slice()")
    de = centro(page, f'#ziTF{g} [data-of-i="2"]'); a0 = page.locator(f'#ziTF{g} [data-of-i="0"]').bounding_box()
    top0 = page.evaluate("document.getElementById('ziCuerpo').scrollTop")
    toque(de, (a0['x'] + 10, a0['y'] + 30), espera=450)
    ok(page.evaluate(f"() => ZI.grupos.find(x => x.id === {g}).subidas[0]") == antes[2], 'celular: mantener presionado y mover cambia el orden en Revisar')
    ok(abs(page.evaluate("document.getElementById('ziCuerpo').scrollTop") - top0) < 30, 'celular: mientras arrastras, la lista no se desplaza')
    antes = page.evaluate(f"() => ZI.grupos.find(x => x.id === {g}).subidas.slice()")
    de = centro(page, f'#ziTF{g} [data-of-i="1"]')
    toque(de, (de[0], de[1] - 260))
    ok(page.evaluate(f"() => ZI.grupos.find(x => x.id === {g}).subidas.slice()") == antes, 'celular: deslizar rápido sobre una foto solo desplaza (no la mueve)')
    ok(page.evaluate("() => document.getElementById('ziCuerpo').scrollWidth <= document.getElementById('ziCuerpo').clientWidth + 1"), 'celular: nada se sale a lo ancho')
    page.evaluate("() => ziCerrar()"); page.wait_for_timeout(300)
    # Registrar en el celular
    page.evaluate("() => showTab('registrar')"); page.wait_for_timeout(600)
    U = [f'https://res.cloudinary.com/demo/image/upload/v1/bazar/{CORRIDA}-cel-{i}.jpg' for i in range(3)]
    page.evaluate("u => { editImages = []; newImages = u.slice(); renderPreviews(); }", U)
    page.locator('#previewStrip').scroll_into_view_if_needed(); page.wait_for_timeout(200)
    ok(page.locator('#previewStrip [data-of-i="1"] .of-portada-btn').is_visible() and page.locator('#previewStrip [data-of-i="1"] .of-quitar').is_visible(), 'celular: ★ y ✕ se ven sin pasar el mouse')
    p0 = page.locator('#previewStrip [data-of-i="0"]').bounding_box()
    toque(centro(page, '#previewStrip [data-of-i="2"]'), (p0['x'] + 6, p0['y'] + p0['height'] / 2), espera=450)
    ok(page.evaluate("() => [...editImages, ...newImages]") == [U[2], U[0], U[1]], 'celular: en Registrar también se reordena con el dedo')
    ok(page.locator('.of-fantasma').count() == 0, 'celular: al soltar no queda nada flotando')
    ok(not e, f'sin errores en la página ({e[:2]})')
    ctx.close(); b.close()

f = [m for c, m in res if not c]
print(f'\n{len(res) - len(f)}/{len(res)} PASS')
