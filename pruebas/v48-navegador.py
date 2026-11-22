# Pruebas v48 en el navegador: cambiar el orden de las prendas y de sus fotos en "Agrupar".
# Con mouse (arrastrar el número o una foto), con ▲ ▼ y con el dedo en el celular
# (mantener presionado y mover). El orden nuevo es el que sigue en "Revisar".
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v48-navegador.py
import json, re, io, zipfile
from playwright.sync_api import sync_playwright
from PIL import Image

BASE = 'http://127.0.0.1:8766/'
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)
def jpg(c):
    b = io.BytesIO(); Image.new('RGB', (300, 380), c).save(b, 'JPEG'); return b.getvalue()
def errores(page):
    e = []; page.on('pageerror', lambda x: e.append(str(x)[:160]) if 'ViewTransition' not in str(x) else None); return e
def un_zip(n=12, fotos=3):
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w', zipfile.ZIP_STORED) as z:
        for i in range(1, n + 1):
            for k in range(fotos):
                z.writestr(f'{i:02d} Prenda/{"abc"[k]}.jpg', jpg((i * 19 % 255, k * 80, 120)))
    return b.getvalue()
ORDEN = "() => ZI.grupos.map(g => +g.fotos[0].nombre.slice(0, 2))"
FOTOS = "i => ZI.grupos[i].fotos.map(f => f.nombre.split('/')[0].slice(0, 2) + f.base[0])"

def preparar(ctx, page):
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(2500)
    page.evaluate("() => { ZI.ig = 'no'; }")
    page.evaluate("() => ziAbrir()"); page.wait_for_timeout(500)
    page.set_input_files('#ziModal .zi-drop input[type=file]', files=[{'name': 'drop.zip', 'mimeType': 'application/zip', 'buffer': un_zip()}])
    page.wait_for_function("() => ZI.paso === 'agrupar'", timeout=8000); page.wait_for_timeout(300)

def arrastrar(page, de, a, pasos=12, soltar=True, esc=False):
    page.mouse.move(*de); page.mouse.down()
    for i in range(1, pasos + 1):
        page.mouse.move(de[0] + (a[0] - de[0]) * i / pasos, de[1] + (a[1] - de[1]) * i / pasos); page.wait_for_timeout(16)
    if esc: page.keyboard.press('Escape')
    if soltar: page.mouse.up()
    page.wait_for_timeout(250)

def centro(page, sel):
    r = page.locator(sel).bounding_box(); return (r['x'] + r['width'] / 2, r['y'] + r['height'] / 2)

with sync_playwright() as p:
    b = p.chromium.launch()
    # ════════ Computadora ════════
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
    ctx.route(re.compile(r'https://res\.cloudinary\.com/.*'), lambda r: r.fulfill(status=200, content_type='image/jpeg', body=jpg((200, 200, 200))))
    page = ctx.new_page(); e = errores(page)
    preparar(ctx, page)
    ok(page.evaluate(ORDEN) == list(range(1, 13)), '12 prendas agrupadas por carpeta, en orden')
    ok(page.locator('#ziGrupos .zi-grupo').first.locator('.zi-flecha').first.is_disabled() and page.locator('#ziGrupos .zi-grupo').last.locator('.zi-flecha').last.is_disabled(), 'la primera no puede subir y la última no puede bajar')
    ok(page.locator('#ziGrupos .zi-grupo').first.locator('.zi-portada').count() == 1, 'la primera foto dice "Portada"')

    # ▲ ▼
    page.locator('#ziGrupos .zi-grupo[data-gi="2"] .zi-flecha').first.click(); page.wait_for_timeout(200)
    o = page.evaluate(ORDEN); ok(o[:4] == [1, 3, 2, 4], f'▲ sube la prenda 3 un lugar ({o[:4]})')
    page.locator('#ziGrupos .zi-grupo[data-gi="0"] .zi-flecha').last.click(); page.wait_for_timeout(200)
    o = page.evaluate(ORDEN); ok(o[:4] == [3, 1, 2, 4], f'▼ baja la primera un lugar ({o[:4]})')
    ok(page.locator('#ziGrupos .zi-grupo[data-gi="1"]').evaluate("e => e.classList.contains('zi-resalta')"), 'la prenda movida se ilumina para ver a dónde quedó')
    ok([t.strip() for t in page.locator('#ziGrupos .zi-grupo-n').all_inner_texts()[:3]] == ['1', '2', '3'], 'los números se vuelven a contar en orden')

    # Arrastrar el número: la prenda de la fila 1 (#3) hasta después de la fila 4
    page.evaluate("() => { ZI.grupos.sort((a, b) => +a.fotos[0].nombre.slice(0, 2) - +b.fotos[0].nombre.slice(0, 2)); ziPintar(); }")
    de = centro(page, '#ziGrupos .zi-grupo[data-gi="0"] .zi-mango')
    r4 = page.locator('#ziGrupos .zi-grupo[data-gi="3"]').bounding_box()
    arrastrar(page, de, (de[0], r4['y'] + r4['height'] * 0.75))
    o = page.evaluate(ORDEN); ok(o[:5] == [2, 3, 4, 1, 5], f'arrastrar el número mueve la prenda 1 al lugar 4 ({o[:5]})')
    ok(page.locator('.zi-fantasma, .zi-marca-fila, .zi-marca-foto').count() == 0 and not page.evaluate("document.body.classList.contains('zi-moviendo')"), 'al soltar no queda nada flotando')

    # Arrastrar hasta abajo: la lista se desplaza sola y se puede poner al final
    de = centro(page, '#ziGrupos .zi-grupo[data-gi="0"] .zi-mango')
    cuerpo = page.locator('#ziCuerpo').bounding_box()
    page.mouse.move(*de); page.mouse.down(); page.mouse.move(de[0], de[1] + 20)
    page.mouse.move(de[0], cuerpo['y'] + cuerpo['height'] - 8); page.wait_for_timeout(2500)
    bajo = page.evaluate("document.getElementById('ziCuerpo').scrollTop")
    ultima = page.locator('#ziGrupos .zi-grupo').last.bounding_box()
    page.mouse.move(de[0], ultima['y'] + ultima['height'] - 4); page.wait_for_timeout(120); page.mouse.up(); page.wait_for_timeout(300)
    o = page.evaluate(ORDEN); ok(bajo > 100 and o[-1] == 2, f'cerca de la orilla la lista baja sola y la prenda queda al final (bajó {bajo}px, {o})')
    ok(page.evaluate("document.getElementById('ziCuerpo').scrollTop") > 100, 'después de mover, la lista no regresa hasta arriba')

    # Escape cancela
    page.evaluate("() => { document.getElementById('ziCuerpo').scrollTop = 0; }")
    antes = page.evaluate(ORDEN)
    de = centro(page, '#ziGrupos .zi-grupo[data-gi="0"] .zi-mango'); r3 = page.locator('#ziGrupos .zi-grupo[data-gi="2"]').bounding_box()
    arrastrar(page, de, (de[0], r3['y'] + r3['height'] * 0.8), esc=True)
    ok(page.evaluate(ORDEN) == antes, 'con Escape se cancela y nada cambia')

    # Un clic normal en el número no mueve nada
    page.locator('#ziGrupos .zi-grupo[data-gi="1"] .zi-mango').click(); page.wait_for_timeout(200)
    ok(page.evaluate(ORDEN) == antes, 'un clic sin arrastrar no cambia el orden')

    # Fotos: la 3ª foto de la fila 1 pasa a ser la portada
    page.evaluate("() => { ZI.grupos.sort((a, b) => +a.fotos[0].nombre.slice(0, 2) - +b.fotos[0].nombre.slice(0, 2)); ziPintar(); }")
    f0 = page.locator('#ziGrupos .zi-foto[data-gi="0"][data-fi="0"]').bounding_box()
    arrastrar(page, centro(page, '#ziGrupos .zi-foto[data-gi="0"][data-fi="2"]'), (f0['x'] + 10, f0['y'] + f0['height'] / 2))
    fs = page.evaluate(FOTOS, 0); ok(fs == ['01c', '01a', '01b'], f'arrastrar una foto al inicio la vuelve portada ({fs})')
    ok(page.locator('#ziGrupos .zi-foto[data-gi="0"][data-fi="0"] .zi-portada').count() == 1, 'la etiqueta "Portada" sigue en la primera')

    # Foto a otra prenda
    f1 = page.locator('#ziGrupos .zi-foto[data-gi="1"][data-fi="2"]').bounding_box()
    arrastrar(page, centro(page, '#ziGrupos .zi-foto[data-gi="0"][data-fi="1"]'), (f1['x'] + f1['width'] - 6, f1['y'] + f1['height'] / 2))
    ok(page.evaluate(FOTOS, 0) == ['01c', '01b'] and page.evaluate(FOTOS, 1) == ['02a', '02b', '02c', '01a'], f'una foto se pasa a otra prenda ({page.evaluate(FOTOS, 0)} / {page.evaluate(FOTOS, 1)})')

    # Soltar en el espacio vacío de una fila la pone al final
    vacio = page.locator('#ziGrupos .zi-grupo[data-gi="2"] .zi-tiras').bounding_box()
    arrastrar(page, centro(page, '#ziGrupos .zi-foto[data-gi="0"][data-fi="1"]'), (vacio['x'] + vacio['width'] - 30, vacio['y'] + vacio['height'] / 2))
    ok(page.evaluate(FOTOS, 2)[-1] == '01b', f'soltar en el espacio vacío la pone al final ({page.evaluate(FOTOS, 2)})')

    # Sacar la última foto de una prenda: la prenda vacía desaparece
    n = page.evaluate("ZI.grupos.length")
    destino = page.locator('#ziGrupos .zi-foto[data-gi="1"][data-fi="0"]').bounding_box()
    arrastrar(page, centro(page, '#ziGrupos .zi-foto[data-gi="0"][data-fi="0"]'), (destino['x'] + 6, destino['y'] + destino['height'] / 2))
    ok(page.evaluate("ZI.grupos.length") == n - 1 and page.evaluate(FOTOS, 0)[0] == '01c', f'si una prenda se queda sin fotos se quita sola ({n} → {page.evaluate("ZI.grupos.length")})')

    # Soltar fuera de las prendas no cambia nada
    antes = [page.evaluate(FOTOS, i) for i in range(3)]
    cab = page.locator('#ziModal .zi-cab').bounding_box()
    arrastrar(page, centro(page, '#ziGrupos .zi-foto[data-gi="1"][data-fi="1"]'), (cab['x'] + 200, cab['y'] + 20))
    ok([page.evaluate(FOTOS, i) for i in range(3)] == antes, 'soltar fuera de las prendas no cambia nada')

    # Después de arrastrar, ✕ y ✂ siguen funcionando con clic normal
    segunda = page.evaluate(FOTOS, 1)[1]
    page.locator('#ziGrupos .zi-foto[data-gi="1"][data-fi="1"]').hover()
    page.locator('#ziGrupos .zi-foto[data-gi="1"][data-fi="1"] button[aria-label="Separar aquí"]').click(); page.wait_for_timeout(200)
    ok(page.evaluate(FOTOS, 2)[0] == segunda and len(page.evaluate(FOTOS, 1)) == 1, f'✂ sigue separando con un clic ({page.evaluate(FOTOS, 1)} | {page.evaluate(FOTOS, 2)})')
    nf = len(page.evaluate(FOTOS, 2))
    page.locator('#ziGrupos .zi-foto[data-gi="2"][data-fi="1"]').hover()
    page.locator('#ziGrupos .zi-foto[data-gi="2"][data-fi="1"] button[aria-label="Quitar foto"]').click(); page.wait_for_timeout(200)
    ok(len(page.evaluate(FOTOS, 2)) == nf - 1, '✕ sigue quitando la foto con un clic')
    # Arrastrar empezando sobre ✕ no arrastra (es un botón)
    antes = [page.evaluate(FOTOS, i) for i in range(4)]
    btn = page.locator('#ziGrupos .zi-foto[data-gi="3"][data-fi="0"] button[aria-label="Quitar foto"]')
    page.locator('#ziGrupos .zi-foto[data-gi="3"][data-fi="0"]').hover(); bb = btn.bounding_box()
    page.mouse.move(bb['x'] + 5, bb['y'] + 5); page.mouse.down(); page.mouse.move(bb['x'] + 5, bb['y'] - 150, steps=8); page.mouse.up(); page.wait_for_timeout(200)
    ok(page.locator('.zi-fantasma').count() == 0, 'empezar sobre un botón no arrastra la foto')

    # El orden de aquí es el de "Revisar" (y el de guardar)
    page.evaluate("() => { ZI.grupos.reverse(); ziPintar(); }")
    esperado = page.evaluate("() => ZI.grupos.map(g => g.id)")
    page.locator('button:has-text("Subir y analizar"), button:has-text("Subir ")').first.click()
    page.wait_for_function("() => ZI.paso === 'revisar'", timeout=10000); page.wait_for_timeout(500)
    tarjetas = page.evaluate("() => [...document.querySelectorAll('#ziLista .zi-tarjeta')].map(t => +t.id.slice(3))")
    ok(tarjetas == esperado, 'en "Revisar" las prendas salen en el orden que acomodaste')
    ok(page.evaluate("() => { ziMoverGrupo(0, 1); ziMoverFoto(0, 0, 1, 0); return true }") and page.evaluate("() => ZI.grupos.map(g => g.id)") == esperado, 'fuera de "Agrupar" no se puede mover nada (no rompe lo que ya se analiza)')
    page.wait_for_function("() => !ZI.corriendo", timeout=40000)
    ok(not e, f'sin errores en la página ({e[:2]})')
    ctx.close()

    # ════════ Celular ════════
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
    ctx.route(re.compile(r'https://res\.cloudinary\.com/.*'), lambda r: r.fulfill(status=200, content_type='image/jpeg', body=jpg((200, 200, 200))))
    page = ctx.new_page(); e = errores(page); cdp = ctx.new_cdp_session(page)
    preparar(ctx, page)
    def toque(de, a, espera=0, pasos=14):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': de[0], 'y': de[1]}]})
        if espera: page.wait_for_timeout(espera)
        for i in range(1, pasos + 1):
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': de[0] + (a[0] - de[0]) * i / pasos, 'y': de[1] + (a[1] - de[1]) * i / pasos}]}); page.wait_for_timeout(20)
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); page.wait_for_timeout(400)
    fl = page.locator('#ziGrupos .zi-grupo[data-gi="0"] .zi-flecha')
    ok(fl.count() == 2 and fl.last.is_visible() and page.locator('#ziGrupos .zi-grupo[data-gi="0"] .zi-mango').is_visible(), 'en el celular se ven ▲ ▼ y el número')
    bb = fl.last.bounding_box(); ok(bb['width'] >= 30 and bb['height'] >= 26, f'botones ▲ ▼ con tamaño cómodo para el dedo ({bb["width"]:.0f}×{bb["height"]:.0f})')
    ancho = page.evaluate("() => document.getElementById('ziCuerpo').scrollWidth <= document.getElementById('ziCuerpo').clientWidth + 1")
    ok(ancho, 'nada se sale de la pantalla a lo ancho')
    fl.last.tap(); page.wait_for_timeout(200)
    ok(page.evaluate(ORDEN)[:2] == [2, 1], '▼ funciona con el dedo')

    # Arrastrar el número con el dedo
    page.evaluate("() => { ZI.grupos.sort((a, b) => +a.fotos[0].nombre.slice(0, 2) - +b.fotos[0].nombre.slice(0, 2)); ziPintar(); }")
    de = centro(page, '#ziGrupos .zi-grupo[data-gi="0"] .zi-mango'); r2 = page.locator('#ziGrupos .zi-grupo[data-gi="1"]').bounding_box()
    toque(de, (de[0], r2['y'] + r2['height'] * 0.8))
    o = page.evaluate(ORDEN); ok(o[:3] == [2, 1, 3], f'arrastrar el número con el dedo mueve la prenda ({o[:3]})')

    # Deslizar rápido sobre una foto = desplazar la lista, no mover la foto
    page.evaluate("() => { ZI.grupos.sort((a, b) => +a.fotos[0].nombre.slice(0, 2) - +b.fotos[0].nombre.slice(0, 2)); ziPintar(); document.getElementById('ziCuerpo').scrollTop = 0; }")
    antes = [page.evaluate(FOTOS, i) for i in range(3)]
    de = centro(page, '#ziGrupos .zi-foto[data-gi="1"][data-fi="0"]')
    toque(de, (de[0], de[1] - 250))
    top = page.evaluate("document.getElementById('ziCuerpo').scrollTop")
    ok([page.evaluate(FOTOS, i) for i in range(3)] == antes and top > 50, f'deslizar rápido sobre una foto solo desplaza la lista ({top}px)')

    # Mantener presionado y mover: la foto se mueve y la página no se desplaza
    page.evaluate("() => { document.getElementById('ziCuerpo').scrollTop = 0; }"); page.wait_for_timeout(200)
    de = centro(page, '#ziGrupos .zi-foto[data-gi="0"][data-fi="2"]'); a = page.locator('#ziGrupos .zi-foto[data-gi="0"][data-fi="0"]').bounding_box()
    toque(de, (a['x'] + 8, a['y'] + a['height'] / 2), espera=450)
    fs = page.evaluate(FOTOS, 0)
    ok(fs == ['01c', '01a', '01b'], f'mantener presionado y mover cambia la portada ({fs})')
    ok(page.evaluate("document.getElementById('ziCuerpo').scrollTop") < 30, 'mientras arrastras, la lista no se va para otro lado')
    ok(page.locator('.zi-fantasma').count() == 0, 'al soltar no queda nada flotando')
    ok(not e, f'sin errores en la página ({e[:2]})')
    ctx.close(); b.close()

f = [m for c, m in res if not c]
print(f'\n{len(res) - len(f)}/{len(res)} PASS')
