# Pruebas v44 en el navegador: registro rápido con IA a prueba de fallas.
# Un ZIP real con 3 prendas; las primeras subidas fallan (503), la IA está saturada
# la primera vez, una foto HEIC llega sin tipo, una prenda falla siempre y luego se
# reintenta con un botón, se guarda, y el mismo ZIP otra vez avisa que ya están.
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v44-navegador.py
import json, re, io, zipfile, urllib.request, hashlib, uuid
from playwright.sync_api import sync_playwright
from PIL import Image

BASE = 'http://127.0.0.1:8766/'
CORRIDA = uuid.uuid4().hex[:8]   # URLs distintas en cada corrida (el servidor de pruebas recuerda las anteriores)
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)
def jpg(c=(90, 90, 90), w=400, h=500):
    b = io.BytesIO(); Image.new('RGB', (w, h), c).save(b, 'JPEG'); return b.getvalue()
def errores(page):
    e = []; page.on('pageerror', lambda x: e.append(str(x)[:160]) if 'ViewTransition' not in str(x) else None); return e
def un_zip(colores):
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w', zipfile.ZIP_DEFLATED) as z:
        for i, (c1, c2) in enumerate(colores):
            z.writestr(f'Prenda {i + 1}/frente.jpg', jpg(c1)); z.writestr(f'Prenda {i + 1}/etiqueta.jpg', jpg(c2))
        z.writestr('Prenda 9/rota.jpg', b'esto no es una foto')            # se sube igual; el servidor la rechazaría
        z.writestr('__MACOSX/._frente.jpg', b'basura')                     # se ignora
        z.writestr('notas.txt', b'hola')                                   # se ignora
    return b.getvalue()

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
    ctx.route(re.compile(r'https://res\.cloudinary\.com/.*'), lambda r: r.fulfill(status=200, content_type='image/jpeg', body=jpg((200, 200, 200))))
    # Subidas: las 2 primeras fallan con 503; cada foto recibe su propia URL; se guarda el tipo que llegó
    sub = {'n': 0, 'tipos': [], 'urls': {}}
    def subir(route):
        req = route.request
        if req.method != 'POST': return route.continue_()
        sub['n'] += 1
        cuerpo = json.loads(req.post_data or '{}'); f = cuerpo.get('file', '')
        sub['tipos'].append(f[:30])
        if sub['n'] <= 2: return route.fulfill(status=503, content_type='application/json', body=json.dumps({'error': 'Servicio no disponible'}))
        if not re.match(r'^data:image/(jpeg|jpg|png|webp|gif|avif|heic|heif);base64,', f, re.I): return route.fulfill(status=400, content_type='application/json', body=json.dumps({'error': 'Solo se aceptan imágenes'}))
        clave = hashlib.sha1(f.encode()).hexdigest(); u = sub['urls'].setdefault(clave, f'https://res.cloudinary.com/demo/image/upload/v1/bazar/{CORRIDA}-{len(sub["urls"]) + 1}.jpg')
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'url': u}))
    ctx.route('**/api/upload', subir)
    # IA: la primera llamada, saturada; la prenda con "falla" en la pista, siempre 503 hasta que se quite
    ia = {'n': 0, 'romper': set()}
    def analizar(route):
        ia['n'] += 1
        cuerpo = json.loads(route.request.post_data or '{}')
        if ia['n'] == 1: return route.fulfill(status=503, content_type='application/json', body=json.dumps({'error': 'La IA está muy ocupada en este momento.', 'reintentable': True}))
        if any(u in ia['romper'] for u in cuerpo.get('imagenes', [])): return route.fulfill(status=502, content_type='text/html', body='<html>Bad gateway</html>')
        route.continue_()
    ctx.route('**/api/acciones?op=ia-prenda*', analizar)

    page = ctx.new_page(); e = errores(page)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(3000)
    page.evaluate("""() => { const c = getCats(); for (const n of ['Sudaderas', 'Pantalones', 'Tenis']) if (!c.some(x => x.nombre === n)) c.push({ id: c.length + 1, nombre: n });
                     ZI.esperasReintento = [400, 600, 800]; ZI.ig = 'no'; }""")

    # ── 1 · ZIP con 3 prendas + una foto rota + basura ──
    page.evaluate("() => ziAbrir()"); page.wait_for_timeout(600)
    page.set_input_files('#ziModal .zi-drop input[type=file]', files=[{'name': 'lote.zip', 'mimeType': 'application/zip', 'buffer': un_zip([((200, 30, 30), (250, 250, 250)), ((30, 200, 30), (180, 180, 180)), ((30, 30, 200), (120, 120, 120))])}])
    page.wait_for_function("() => ZI.paso === 'agrupar'", timeout=8000)
    g = page.evaluate("() => ZI.grupos.map(g => g.fotos.length)")
    ok(g == [2, 2, 2, 1], f'el ZIP se agrupa por carpeta y se ignora lo que no es foto ({g})')
    page.evaluate("() => ZI.grupos.splice(3, 1)")    # la "rota" se quita a mano, como lo haría la dueña
    page.evaluate("() => ziPintar()")
    page.locator('button:has-text("Subir y analizar")').click()
    page.wait_for_function("() => ZI.grupos.every(g => g.estado === 'hecho' || g.estado === 'error') && !ZI.corriendo", timeout=40000)
    est = page.evaluate("() => ZI.grupos.map(g => g.estado)")
    ok(est == ['hecho'] * 3, f'subidas que fallan (503) y la IA saturada se reintentan solas: las 3 quedan listas ({est})')
    ok(sub['n'] >= 8 and ia['n'] >= 4, f'sí hubo reintentos ({sub["n"]} subidas para 6 fotos, {ia["n"]} análisis para 3 prendas)')
    f = page.evaluate("() => ZI.grupos[0].f")
    ok(f['nombre'] == 'Sudadera Nike Vintage' and f['precio'] and int(f['precio']) > 0, f'nombre y precio llenos ({f["nombre"]} · ${f["precio"]})')
    ok(f['talla'] == 'L Hombre' and f['estado'] == '9/10' and f['categoria'] == 'Sudaderas', f'"Large", "Excelente" y "Hoodie" se acomodan a tus listas ({f["talla"]} · {f["estado"]} · {f["categoria"]})')
    ok(f['hashtags'] == '#nike #vintage', f'hashtags arreglados ({f["hashtags"]})')

    # ── 2 · Una prenda que falla siempre → error claro y botón para reintentar ──
    page.evaluate("() => { const g = ZI.grupos[1]; g.estado = 'reintentar'; g.reanalizar = true; g.forzarCalidad = 'maxima'; }")
    ia['romper'].update(page.evaluate("() => ZI.grupos[1].subidas"))
    page.evaluate("() => ziCorrer()")
    page.wait_for_function("() => ZI.grupos[1].estado === 'error' && !ZI.corriendo", timeout=20000)
    err = page.evaluate("() => ZI.grupos[1].error")
    ok(err and not re.search(r'unexpected|json|token|syntax|bad gateway', err, re.I), f'después de 3 intentos: mensaje en español, sin cosas técnicas ("{err}")')
    ok(page.locator('#ziPie button:has-text("Reintentar la que falló")').count() == 1, 'aparece "Reintentar la que falló" abajo')
    ia['romper'].clear()
    page.locator('#ziPie button:has-text("Reintentar la que falló")').click()
    page.wait_for_function("() => ZI.grupos[1].estado === 'hecho' && !ZI.corriendo", timeout=20000)
    ok(True, 'al volver la IA, el botón la termina')

    # ── 3 · Guardar ──
    page.evaluate("() => toast('Un aviso cualquiera')")
    caja = page.locator('.stmp-avisos').bounding_box(); boton = page.locator('#ziPie button:has-text("Guardar 3 prendas")').bounding_box()
    ok(caja and boton and (caja['y'] + caja['height'] < boton['y']), 'con el importador abierto los avisos salen arriba y no tapan "Guardar"')
    page.locator('#ziPie button:has-text("Guardar 3 prendas")').click(timeout=5000)
    page.wait_for_function("() => ZI.grupos.every(g => g.guardada)", timeout=15000)
    ids = page.evaluate("() => ZI.grupos.map(g => g.prendaId)")
    ok(len(set(ids)) == 3 and all(ids), f'las 3 se guardan en el inventario ({ids})')
    ok(not page.evaluate("() => localStorage.getItem('stmp-importar-zip-v1')"), 'no queda importación pendiente')

    # ── 4 · El mismo ZIP otra vez → avisa que ya están ──
    n_antes = sub['n']; ia_antes = ia['n']
    page.evaluate("() => { ZI.grupos = []; ZI.paso = 'elegir'; ziPintar(); }"); page.wait_for_timeout(300)
    page.set_input_files('#ziModal .zi-drop input[type=file]', files=[{'name': 'lote.zip', 'mimeType': 'application/zip', 'buffer': un_zip([((200, 30, 30), (250, 250, 250)), ((30, 200, 30), (180, 180, 180)), ((30, 30, 200), (120, 120, 120))])}])
    page.wait_for_function("() => ZI.paso === 'agrupar'", timeout=8000)
    page.evaluate("() => { ZI.grupos.splice(3, 1); ziPintar(); }")
    page.locator('button:has-text("Subir y analizar")').click()
    page.wait_for_function("() => ZI.grupos.every(g => g.estado === 'hecho') && !ZI.corriendo", timeout=30000)
    rep = page.evaluate("() => ZI.grupos.map(g => [!!g.repetida, g.f.incluir])")
    ok(all(r == [True, False] for r in rep), f'el mismo ZIP otra vez: las 3 dicen "ya registraste esta prenda" y no se marcan para guardar ({rep})')
    ok(sub['n'] == n_antes, 'y no se vuelven a subir las fotos')
    ok(ia['n'] == ia_antes, 'ni se vuelven a mandar a la IA (no se paga dos veces)')
    ok(page.locator('.zi-tarjeta:has-text("ya registraste esta prenda")').count() == 3, 'el aviso se ve en cada tarjeta')

    # ── 5 · Foto HEIC sin tipo (pasa en Windows) ──
    page.evaluate("() => { ZI.grupos = []; ZI.paso = 'elegir'; ziPintar(); }"); page.wait_for_timeout(300)
    page.set_input_files('#ziModal .zi-drop input[type=file]', files=[{'name': 'IMG_0001.HEIC', 'mimeType': 'application/octet-stream', 'buffer': jpg((10, 120, 220))}])
    page.wait_for_function("() => ZI.paso === 'agrupar'", timeout=8000)
    page.wait_for_function("() => ZI.fotos.every(f => f.nube)", timeout=15000)
    ok(any(t.startswith('data:image/heic') for t in sub['tipos'][-3:]), f'una HEIC sin tipo se sube como image/heic, no como "archivo" ({sub["tipos"][-1]})')

    # ── 6 · Sin internet: espera y sigue sola ──
    page.evaluate("() => { ZI.grupos = []; ZI.paso = 'elegir'; ziPintar(); }"); page.wait_for_timeout(300)
    page.set_input_files('#ziModal .zi-drop input[type=file]', files=[{'name': 'gorra.jpg', 'mimeType': 'image/jpeg', 'buffer': jpg((5, 5, 5))}])
    page.wait_for_function("() => ZI.paso === 'agrupar' && ZI.fotos.every(f => f.nube)", timeout=15000)
    ctx.set_offline(True)
    page.locator('button:has-text("Subir y analizar")').click(); page.wait_for_timeout(1500)
    ok(page.evaluate("() => ZI.sinInternet === true && ZI.grupos[0].estado !== 'error'"), 'sin internet: no marca error, espera')
    ok('sin internet' in page.locator('#ziPie').inner_text(), 'y lo dice abajo ("sin internet: sigue sola cuando vuelva")')
    ctx.set_offline(False)
    page.wait_for_function("() => ZI.grupos[0].estado === 'hecho' && !ZI.corriendo", timeout=20000)
    ok(True, 'al volver el internet, termina sola')

    ok(not e, f'sin errores de JavaScript {e[:2]}')
    b.close()

malas = [m for c, m in res if not c]
print(f'\n{len(res) - len(malas)} de {len(res)} correctas')
if malas: raise SystemExit(1)
