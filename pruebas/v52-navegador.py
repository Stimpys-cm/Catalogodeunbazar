# Pruebas v52 en el navegador: borradores y agregar más fotos.
# - Al subir en el Registro rápido, cada prenda queda como borrador en el servidor (y se actualiza al editar).
# - "+ Fotos" en una tarjeta de Revisar; "Agregar más prendas" en Revisar; "Agregar más fotos" en Agrupar.
# - Panel → Borradores: lista, globito, seleccionar, Registrar (se abre en Revisar), guardar (sale de Borradores), Borrar.
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v52-navegador.py
import json, re, io, zipfile, hashlib, uuid
from playwright.sync_api import sync_playwright
from PIL import Image

BASE = 'http://127.0.0.1:8766/'
C = uuid.uuid4().hex[:6]
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)
def jpg(k):
    b = io.BytesIO(); Image.new('RGB', (220, 280), ((k * 37) % 255, (k * 71) % 255, (k * 13) % 255)).save(b, 'JPEG', quality=95); return b.getvalue()
def un_zip(ini, n_prendas, fotos=2):
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w', zipfile.ZIP_STORED) as z:
        for i in range(n_prendas):
            for k in range(fotos): z.writestr(f'Prenda {i + 1}/{k}.jpg', jpg(ini + i * 10 + k))
    return b.getvalue()
def borradores(page):
    return page.evaluate("() => api('/api/acciones?op=b-lista').then(r => r.borradores)")
def mios(page):
    return [d for d in borradores(page) if C in json.dumps(d.get('fotos', []))]

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)}); localStorage.removeItem('stmp-subidas-v1'); localStorage.removeItem('stmp-importar-zip-v1');")
    ctx.route(re.compile(r'https://res\.cloudinary\.com/.*'), lambda r: r.fulfill(status=200, content_type='image/jpeg', body=jpg(3)))
    urls = {}
    def subir(route):
        if route.request.method != 'POST': return route.continue_()
        f = json.loads(route.request.post_data or '{}').get('file', '')
        u = urls.setdefault(hashlib.sha1(f.encode()).hexdigest(), f'https://res.cloudinary.com/demo/image/upload/v1/bazar/{C}-{len(urls) + 1}.jpg')
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'url': u}))
    ctx.route('**/api/upload', subir)
    page = ctx.new_page(); errores = []
    page.on('pageerror', lambda x: errores.append(str(x)[:160]) if 'ViewTransition' not in str(x) else None)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(2500)
    ok(page.locator('#tab-borradores').is_visible() and 'Borradores' in page.locator('#tab-borradores').inner_text(), 'el menú tiene "Borradores"')

    # ── Subir: cada prenda queda como borrador ──
    page.evaluate("() => { ZI.ig = 'no'; ZI.investigarRaras = false; ZI.separarIA = false; ziAbrir(); }"); page.wait_for_timeout(600)
    page.set_input_files('#ziDrop input', files=[{'name': 'Lote prueba.zip', 'mimeType': 'application/zip', 'buffer': un_zip(1, 2)}])
    page.wait_for_function("() => ZI.paso === 'agrupar'", timeout=10000)
    # Agregar más fotos en "Agrupar"
    ok(page.locator('.zi-barra .zi-agregar').count() == 1, 'en "Agrupar" hay "Agregar más fotos"')
    page.set_input_files('.zi-barra .zi-agregar input', files=[{'name': 'extra.zip', 'mimeType': 'application/zip', 'buffer': un_zip(200, 1)}])
    page.wait_for_function("() => ZI.grupos.length === 3", timeout=10000)
    ok(page.evaluate("ZI.fotos.length") == 6 and page.evaluate("ZI.grupos[2].fotos.length") == 2, 'agregar más fotos en "Agrupar" suma una prenda al final (sin tocar las otras)')
    page.set_input_files('.zi-barra .zi-agregar input', files=[{'name': 'extra.zip', 'mimeType': 'application/zip', 'buffer': un_zip(200, 1)}])
    page.wait_for_timeout(800)
    ok(page.evaluate("ZI.grupos.length") == 3, 'si agregas las mismas fotos otra vez, no se repiten')
    page.locator('button:has-text("Subir y analizar")').click()
    page.wait_for_function("() => ZI.paso === 'revisar' && ZI.grupos.every(g => g.estado === 'hecho') && !ZI.corriendo", timeout=40000)
    page.wait_for_timeout(2500)
    d = mios(page)
    ok(len(d) == 3 and all(len(x['fotos']) == 2 for x in d), f'al subir, cada prenda quedó como borrador en el servidor ({len(d)})')
    ok(all(x.get('ia') and x['f'].get('nombre') for x in d), 'el borrador trae lo que llenó la IA')
    ok(all('Lote prueba' in x.get('lote', '') or 'extra' in x.get('lote', '') for x in d), f'cada borrador dice de qué lote es ({[x.get("lote") for x in d]})')
    ok(page.locator('#brGlobo').inner_text().strip() not in ('', '0') and not page.locator('#brGlobo').evaluate("e => e.classList.contains('hidden')"), 'el globito del menú cuenta los borradores')

    # Editar → se actualiza el borrador
    g0 = page.evaluate("ZI.grupos[0].id"); bid0 = page.evaluate("ZI.grupos[0].bid")
    page.locator(f'#ziT{g0} input[oninput*="nombre"]').fill(f'Chamarra prueba {C}')
    page.wait_for_timeout(2600)
    ok(any(x['id'] == bid0 and x['f']['nombre'] == f'Chamarra prueba {C}' for x in mios(page)), 'al editar, el borrador se actualiza solo')

    # "+ Fotos" en una tarjeta
    ok(page.locator(f'#ziT{g0} .zi-mas-fotos input[type=file]').count() == 1, 'cada tarjeta tiene "+ Fotos"')
    page.set_input_files(f'#ziT{g0} .zi-mas-fotos input[type=file]', files=[{'name': 'etiqueta.jpg', 'mimeType': 'image/jpeg', 'buffer': jpg(555)}])
    page.wait_for_function(f"() => ZI.grupos.find(g => g.id === {g0}).subidas.length === 3 && !ZI.grupos.find(g => g.id === {g0}).subiendoMas", timeout=10000)
    page.wait_for_timeout(2600)
    ok(page.locator(f'#ziTF{g0} .zi-t-foto').count() == 3, '"+ Fotos" agrega la foto a esa prenda')
    ok(any(x['id'] == bid0 and len(x['fotos']) == 3 for x in mios(page)), 'y el borrador ya tiene las 3 fotos')
    ok(page.locator(f'#ziT{g0} .zi-mas-fotos button:has-text("Volver a analizar")').count() == 1, 'se puede pedir que la IA vuelva a ver las fotos')
    # v52.1: los botones van debajo de las fotos y el formulario sigue a la derecha (no se rompe la tarjeta)
    caja = lambda sel: page.locator(sel).bounding_box()
    cf, cd, cm = caja(f'#ziTF{g0}'), caja(f'#ziT{g0} .zi-t-datos'), caja(f'#ziT{g0} .zi-mas-fotos')
    ok(cd['x'] > cf['x'] + cf['width'] - 2 and abs(cd['y'] - cf['y']) < 30, f'el formulario queda a la derecha de las fotos ({cf}, {cd})')
    ok(cm['y'] >= cf['y'] + cf['height'] - 2 and cm['x'] + cm['width'] <= cf['x'] + cf['width'] + 2, '"+ Fotos" queda debajo de las fotos, en su columna')
    ok(page.locator(f'#ziT{g0} input[oninput*="nombre"]').bounding_box()['width'] > 200, 'los campos tienen su ancho normal')
    page.screenshot(path='/tmp/v52_1_tarjeta.png')

    # "Agregar más prendas" en Revisar
    page.set_input_files('.zi-rev-barra input[type=file]', files=[{'name': f'suelta{i}.jpg', 'mimeType': 'image/jpeg', 'buffer': jpg(700 + i)} for i in range(2)])
    page.wait_for_function("() => ZI.grupos.length >= 4 && ZI.grupos.every(g => g.estado === 'hecho') && !ZI.corriendo", timeout=40000)
    page.wait_for_timeout(2600)
    ok(page.evaluate("ZI.grupos.length") >= 4 and len(mios(page)) == page.evaluate("ZI.grupos.length"), f'"Agregar más prendas" en Revisar: se suben, se analizan y quedan como borrador ({page.evaluate("ZI.grupos.length")})')

    # Guardar una: sale de Borradores
    page.evaluate("() => { ZI.grupos.forEach((g, i) => { g.f.incluir = i === 0; g.f.precio = g.f.precio || 300; }); ziPintar(); }")
    page.locator('#ziPie button:has-text("Guardar")').first.click(timeout=5000)
    page.wait_for_function("() => ZI.grupos[0].guardada", timeout=15000); page.wait_for_timeout(2600)
    ok(not any(x['id'] == bid0 for x in mios(page)), 'al guardar la prenda, su borrador se quita')
    ok(page.evaluate(f"() => getDB().some(p => p.nombre === 'Chamarra prueba {C}' && p.imagenes.length === 3)"), 'la prenda quedó en el inventario con sus 3 fotos')
    restan = len(mios(page))
    page.evaluate("() => { ZI.corriendo = false; ziCerrar(); }"); page.wait_for_timeout(300)

    # ── Panel → Borradores ──
    page.evaluate("() => showTab('borradores')"); page.wait_for_function("() => BR.lista && document.querySelectorAll('#brCaja .br-card').length", timeout=10000)
    tarjetas = page.locator('#brCaja .br-card')
    ok(tarjetas.count() == len(borradores(page)), f'la sección muestra todos los borradores ({tarjetas.count()})')
    ok(page.evaluate("document.title").startswith('Borradores'), 'título de la pestaña')
    mi = page.locator(f'#brCaja .br-card[data-id="{mios(page)[0]["id"]}"]')
    ok(mi.locator('img').count() == 1 and 'foto' in mi.locator('.br-nfotos').inner_text() and mi.locator('.br-lote-txt').inner_text().strip() != '', 'cada tarjeta: foto, cuántas fotos, lote y fecha')
    # Registrar una → se abre en Revisar con sus datos
    elegido = mios(page)[0]
    mi.locator('button:has-text("Registrar")').click()
    page.wait_for_function("() => ZI.paso === 'revisar' && !document.getElementById('ziModal').hidden", timeout=8000); page.wait_for_timeout(500)
    ok(page.evaluate("ZI.grupos.length") == 1 and page.evaluate("ZI.grupos[0].bid") == elegido['id'] and page.evaluate("ZI.grupos[0].estado") == 'hecho', '"Registrar" abre el borrador en Revisar, ya analizado (no se paga otra vez)')
    ok(page.evaluate("ZI.grupos[0].f.nombre") == elegido['f']['nombre'] and page.evaluate("ZI.grupos[0].subidas.length") == len(elegido['fotos']), 'con sus datos y fotos')
    page.evaluate("() => { ZI.grupos[0].f.precio = 350; ZI.grupos[0].f.nombre = ZI.grupos[0].f.nombre || 'X'; ziPintar(); }")
    page.locator('#ziPie button:has-text("Guardar")').first.click(timeout=5000)
    page.wait_for_function("() => ZI.grupos[0].guardada", timeout=15000); page.wait_for_timeout(2600)
    ok(not any(x['id'] == elegido['id'] for x in borradores(page)), 'al registrarlo desde Borradores, sale de la lista')
    page.evaluate("() => ziCerrar()"); page.wait_for_timeout(300)

    # Borrador sin analizar → al abrirlo se analiza
    sin_ia = 'c0000000-0000-4000-8000-' + C.rjust(12, '0')
    page.evaluate("(id, c) => api('/api/acciones?op=b-guardar', { method: 'POST', body: { borradores: [{ id, fotos: [`https://res.cloudinary.com/demo/image/upload/v1/bazar/${c}-sinia.jpg`], f: { nombre: '<img src=x onerror=window.__x=1>Sin analizar' }, lote: '\"><b>lote</b>' }] } }).catch(e => 'ERR ' + e.message)".replace('(id, c)', '([id, c])'), [sin_ia, C])
    page.evaluate("() => showTab('inventario')"); page.evaluate("() => showTab('borradores')")
    page.wait_for_function(f"() => document.querySelector('#brCaja .br-card[data-id=\"{sin_ia}\"]')", timeout=8000)
    t = page.locator(f'#brCaja .br-card[data-id="{sin_ia}"]')
    ok('Falta analizar' in t.inner_text() and not page.evaluate("() => window.__x") and t.locator('b img, .br-lote-txt b').count() == 0, 'un borrador sin analizar lo dice; textos con código se muestran como texto')
    t.locator('button:has-text("Registrar")').click()
    page.wait_for_function("() => ZI.paso === 'revisar' && ZI.grupos.length === 1 && ZI.grupos[0].estado === 'hecho' && !ZI.corriendo", timeout=40000)
    ok(page.evaluate("!!ZI.grupos[0].ia"), 'al abrirlo, la IA lo analiza')
    page.evaluate("() => ziCerrar()"); page.wait_for_timeout(300)

    # Seleccionar y borrar
    page.evaluate("() => showTab('inventario')"); page.evaluate("() => showTab('borradores')"); page.wait_for_timeout(800)
    antes = len(borradores(page))
    page.locator(f'#brCaja .br-card[data-id="{sin_ia}"] .br-foto input').check()
    ok('Borrar (1)' in page.locator('.br-barra-der').inner_text() and 'Registrar 1' in page.locator('.br-barra-der').inner_text(), 'al seleccionar, los botones dicen cuántas')
    page.locator('.br-barra-der button:has-text("Borrar")').click()
    page.wait_for_selector('#dlg.open', timeout=3000); page.locator('#dlgAceptar').click(); page.wait_for_timeout(800)
    ok(len(borradores(page)) == antes - 1 and page.locator(f'#brCaja .br-card[data-id="{sin_ia}"]').count() == 0, 'borrar pide confirmar y lo quita')
    ok(not errores, f'sin errores en la página ({errores[:2]})')
    ctx.close()

    # ── Celular ──
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
    ctx.route(re.compile(r'https://res\.cloudinary\.com/.*'), lambda r: r.fulfill(status=200, content_type='image/jpeg', body=jpg(3)))
    page = ctx.new_page(); errores = []
    page.on('pageerror', lambda x: errores.append(str(x)[:160]) if 'ViewTransition' not in str(x) else None)
    page.goto(BASE + 'admin.html#borradores', wait_until='load'); page.wait_for_timeout(3000)
    ok(page.locator('#view-borradores').is_visible() and page.locator('#brCaja .br-card').count() >= 1, 'celular: se abre Borradores directo (admin.html#borradores)')
    ok(page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1"), 'celular: nada se sale a lo ancho')
    caja = page.locator('#brCaja .br-card').first.bounding_box()
    ok(caja['width'] < 200, f'celular: dos tarjetas por fila ({caja["width"]:.0f}px)')
    ok(not errores, f'sin errores en la página ({errores[:2]})')
    ctx.close(); b.close()

f = [m for c, m in res if not c]
print(f'\n{len(res) - len(f)}/{len(res)} PASS')
