# Pruebas v50 en el navegador: "Separar con IA" (sin una carpeta por prenda).
# - Un ZIP como el DROP 19-11 (126 fotos en una sola carpeta, 31 prendas, tomadas seguidas):
#   por hora salen prendas mezcladas; con IA salen las 31, aunque una prenda quede entre dos tramos.
# - Casos: foto que no es ropa, prenda dudosa, foto que la IA no decidió, etiqueta tomada después,
#   cancelar, varias carpetas (no usa IA), opción apagada, sin saldo (agrupa por hora y avisa).
# El servidor de pruebas contesta como la IA leyendo "-pNN-" en el link de cada foto (servidor.mjs).
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v50-navegador.py
import json, re, io, zipfile, base64, time, uuid
from playwright.sync_api import sync_playwright
from PIL import Image

BASE = 'http://127.0.0.1:8766/'
CORRIDA = uuid.uuid4().hex[:6]
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)

# El color de cada foto dice su número (así el servidor de pruebas sabe cuál es aunque el panel la comprima)
def color(i): return ((i % 12) * 20 + 10, (i // 12) * 20 + 10, 77)
def numero(rgb): return round((rgb[1] - 10) / 20) * 12 + round((rgb[0] - 10) / 20)
def jpg(i):
    b = io.BytesIO(); Image.new('RGB', (240, 300), color(i)).save(b, 'JPEG', quality=95); return b.getvalue()

# El DROP 19-11 real: dónde empieza cada prenda (31 prendas, 126 fotos)
INICIOS = [80, 85, 89, 101, 106, 110, 114, 118, 122, 126, 130, 135, 139, 142, 146, 149, 152, 153, 156, 159, 163, 166, 168, 174, 179, 185, 193, 196, 198, 387, 393]
NUMS = list(range(80, 94)) + list(range(101, 204)) + [387, 388, 389, 390, 393, 394, 395, 396, 397]
def prenda_de(n): return max(k for k, ini in enumerate(INICIOS) if ini <= n)
VERDAD = [prenda_de(n) for n in NUMS]
assert len(NUMS) == 126 and len(set(VERDAD)) == 31

def zip_de(fotos, carpeta='DROP 19-11'):
    # fotos: [(nombre, i, marca, segundos)] → todas en una carpeta, con la hora de cada foto
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w', zipfile.ZIP_STORED) as z:
        for nombre, i, _m, seg in fotos:
            zi = zipfile.ZipInfo(f'{carpeta}/{nombre}' if carpeta else nombre, time.localtime(1763600000 + seg)[:6])
            z.writestr(zi, jpg(i))
    return b.getvalue()

def contexto(b, marcas, ancho=1440, alto=900, movil=False, retener=None, sin_saldo=False):
    ctx = b.new_context(viewport={'width': ancho, 'height': alto}, is_mobile=movil, has_touch=movil)
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)}); localStorage.removeItem('stmp-subidas-v1');")
    ctx.route(re.compile(r'https://res\.cloudinary\.com/.*'), lambda r: r.fulfill(status=200, content_type='image/jpeg', body=jpg(0)))
    def subir(route):
        req = route.request
        if req.method != 'POST': return route.continue_()
        f = json.loads(req.post_data or '{}').get('file', '')
        img = Image.open(io.BytesIO(base64.b64decode(f.split(',', 1)[1]))).convert('RGB')
        i = numero(img.getpixel((img.width // 2, img.height // 2)))
        cuerpo = json.dumps({'url': f'https://res.cloudinary.com/demo/image/upload/v1/bazar/{CORRIDA}-{i}{marcas.get(i, "")}-x.jpg'})
        if retener is not None: retener.append((route, cuerpo)); return      # la subida espera hasta que la soltemos
        route.fulfill(status=200, content_type='application/json', body=cuerpo)
    ctx.route('**/api/upload', subir)
    if sin_saldo:
        ctx.route('**/api/acciones?op=ia-agrupar*', lambda r: r.fulfill(status=402, content_type='application/json', body=json.dumps({'error': 'La IA se quedó sin saldo.', 'reintentable': False, 'tipo': 'saldo'})))
    return ctx

def abrir(page, zipb, prefs=None):
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(2500)
    page.evaluate("p => { ZI.ig = 'no'; ZI.investigarRaras = false; ZI.modo = 'auto'; ZI.calidad = 'auto'; ZI.separarIA = true; ZI.ia = null; Object.assign(ZI, p || {}); }", prefs or {})
    page.evaluate("() => ziAbrir()"); page.wait_for_timeout(600)
    page.set_input_files('#ziModal .zi-drop input[type=file]', files=[{'name': 'drop.zip', 'mimeType': 'application/zip', 'buffer': zipb}])
    page.wait_for_function("() => ZI.paso === 'agrupar'", timeout=15000)

def avisos(page):
    page.evaluate("() => { window.__avisos = []; const t0 = window.toast; window.toast = (m, o) => { window.__avisos.push(String(m)); return t0(m, o); }; }")

with sync_playwright() as p:
    b = p.chromium.launch()
    # ════════ El DROP 19-11: 126 fotos en una carpeta ════════
    # Hora de cada foto como en el real: seguidas, a veces 18 s entre prendas y 36 s dentro de una
    seg, horas = 0, []
    for k, n in enumerate(NUMS):
        seg += 18 if k and VERDAD[k] != VERDAD[k - 1] else 25 + (k % 3) * 5
        horas.append(seg)
    fotos = [(f'IMG_{n:04d}.jpg', k, '', horas[k]) for k, n in enumerate(NUMS)]
    marcas = {k: f'-p{VERDAD[k]:02d}' for k in range(126)}
    ctx = contexto(b, marcas); page = ctx.new_page(); errores = []
    page.on('pageerror', lambda x: errores.append(str(x)[:160]) if 'ViewTransition' not in str(x) else None)
    llamadas = []
    page.on('request', lambda r: llamadas.append(json.loads(r.post_data or '{}')) if 'op=ia-agrupar' in r.url else None)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(2500); avisos(page)
    page.evaluate("() => { ZI.ig = 'no'; ZI.investigarRaras = false; ZI.modo = 'auto'; ZI.separarIA = true; ziAbrir(); }"); page.wait_for_timeout(800)
    ok(page.locator('#ziOpSeparar').is_checked() and 'Separar las prendas con IA' in page.locator('label:has(#ziOpSeparar)').inner_text(), 'paso 1: "Separar las prendas con IA" viene prendido')
    ok('Lo más fácil' in page.locator('.zi-tips').inner_text(), 'paso 1: el consejo ya dice que basta con todas las fotos juntas')
    page.set_input_files('#ziModal .zi-drop input[type=file]', files=[{'name': 'DROP_19-11.zip', 'mimeType': 'application/zip', 'buffer': zip_de(fotos)}])
    page.wait_for_function("() => ZI.paso === 'agrupar'", timeout=15000)
    por_hora = page.evaluate("() => { const m = ZI.modo; ZI.modo = 'hora'; const g = ziAgrupar(ZI.fotos); ZI.modo = m; return g.map(x => x.fotos.map(f => f.base)); }")
    mezcladas = sum(1 for g in por_hora if len({prenda_de(int(f[4:8])) for f in g}) > 1)
    ok(mezcladas > 0, f'(referencia) por hora de la foto salen {len(por_hora)} grupos y {mezcladas} mezclan prendas')
    page.wait_for_selector('#ziSeparando', timeout=5000)
    ok('La IA está viendo cada foto' in page.locator('#ziSeparando').inner_text(), 'se ve que la IA está separando las prendas')
    ok(page.locator('.zi-fila.fin .zi-btn.negro').is_disabled(), 'mientras separa no se puede empezar a analizar')
    page.wait_for_function("() => !ZI.separando && ZI.modoReal === 'ia'", timeout=90000); page.wait_for_timeout(300)
    grupos = page.evaluate("() => ZI.grupos.map(g => ({ fotos: g.fotos.map(f => f.base), n: g.iaNombre, duda: !!g.iaDuda }))")
    ok(len(grupos) == 31, f'la IA separó las 126 fotos en {len(grupos)} prendas (son 31)')
    puras = all(len({prenda_de(int(f[4:8])) for f in g['fotos']}) == 1 for g in grupos)
    completas = sorted(len(g['fotos']) for g in grupos) == sorted(VERDAD.count(k) for k in range(31))
    ok(puras and completas, 'cada fila es exactamente una prenda, con todas sus fotos')
    ok(sum(len(g['fotos']) for g in grupos) == 126, 'no se perdió ninguna foto')
    ok(len(llamadas) == 4 and [len(c['imagenes']) for c in llamadas] == [40, 40, 40, 24], f'126 fotos van en 4 tramos que se enciman ({[len(c["imagenes"]) for c in llamadas]})')
    ok([c['desde'] for c in llamadas] == [1, 35, 69, 103], 'cada tramo se encima 6 fotos con el anterior')
    cruza = [k for k in range(1, 126) if VERDAD[k] == VERDAD[k - 1] and (k == 39 or k == 73 or k == 107)]
    ok(puras, f'una prenda que cae entre dos tramos no se corta')
    ok(grupos[0]['n'] == 'Prenda 00' and page.locator('#ziGrupos .zi-grupo-ia').first.inner_text().strip().startswith('Prenda 00'), 'cada fila muestra el nombre que le dio la IA')
    ok('por la IA' in page.locator('.zi-barra').inner_text(), 'arriba dice que se agruparon por la IA')
    ok(any('separó 126 fotos en 31 prendas' in a for a in page.evaluate("window.__avisos")), 'avisa cuántas prendas encontró y cuánto gastó')
    ok(not page.locator('.zi-fila.fin .zi-btn.negro').is_disabled() and '31 prendas' in page.locator('.zi-fila.fin .zi-btn.negro').inner_text(), 'listo para "Subir y analizar 31 prendas"')
    # Volver a separar: de memoria, gratis
    llamadas.clear(); page.evaluate("() => { window.__avisos = []; }")
    page.select_option('.zi-barra select', 'ia')
    page.wait_for_function("() => !ZI.separando && ZI.modoReal === 'ia'", timeout=30000); page.wait_for_timeout(200)
    ok(page.evaluate("ZI.grupos.length") == 31 and any('gratis' in a for a in page.evaluate("window.__avisos")), 'volver a separar las mismas fotos sale gratis (de memoria)')
    # Cambiar a otra forma y regresar
    page.select_option('.zi-barra select', 'cadaN:3'); page.wait_for_timeout(200)
    ok(page.evaluate("ZI.grupos.length") == 42 and page.locator('#ziSeparando').count() == 0, '"Agrupar de otra forma" sigue funcionando')
    ok(not errores, f'sin errores en la página ({errores[:2]})')
    ctx.close()

    # ════════ Casos raros ════════
    # P1: 3 fotos · no es ropa · P2: 2 fotos (una sin decidir) · etiqueta de P1 tomada después · P3 dudosa (2 fotos)
    fotos = [('a1.jpg', 0, '', 10), ('a2.jpg', 1, '', 20), ('a3.jpg', 2, '', 30), ('captura.jpg', 3, '', 40),
             ('b1.jpg', 4, '', 50), ('b2.jpg', 5, '', 60), ('a-etiqueta.jpg', 6, '', 70), ('c1.jpg', 7, '', 80), ('c2.jpg', 8, '', 90)]
    marcas = {0: '-p01', 1: '-p01', 2: '-p01', 3: '-noropa', 4: '-p02', 5: '-p02-sinver', 6: '-p01', 7: '-p03-duda', 8: '-p03'}
    ctx = contexto(b, marcas); page = ctx.new_page(); errores = []
    page.on('pageerror', lambda x: errores.append(str(x)[:160]) if 'ViewTransition' not in str(x) else None)
    abrir(page, zip_de(fotos))
    page.wait_for_function("() => !ZI.separando && ZI.modoReal === 'ia'", timeout=30000); page.wait_for_timeout(200)
    g = page.evaluate("() => ZI.grupos.map(g => ({ f: g.fotos.map(f => f.base), n: g.iaNombre, duda: !!g.iaDuda, x: !!g.iaX }))")
    by = {tuple(x['f']): x for x in g}
    ok(('a1.jpg', 'a2.jpg', 'a3.jpg', 'a-etiqueta.jpg') in by, f'la etiqueta que se tomó después se va con su prenda ({[x["f"] for x in g]})')
    ok(('b1.jpg', 'b2.jpg') in by, 'una foto que la IA no decidió se queda con la de antes')
    ok(('captura.jpg',) in by and by[('captura.jpg',)]['x'] and by[('captura.jpg',)]['duda'], 'una foto que no es ropa queda aparte, marcada "no parece ropa" (para quitarla)')
    ok(('c1.jpg', 'c2.jpg') in by and by[('c1.jpg', 'c2.jpg')]['duda'] and not by[('b1.jpg', 'b2.jpg')]['duda'], 'la prenda dudosa dice "revisar"; las seguras no')
    ok(page.locator('.zi-duda').count() == 2 and 'no parece ropa' in page.locator('#ziGrupos').inner_text(), 'en pantalla: "revisar" y "no parece ropa"')
    ok('2 filas con "revisar"' in page.locator('#ziModal').inner_text(), 'un aviso dice cuántas filas revisar')
    ok(not errores, f'sin errores en la página ({errores[:2]})')
    ctx.close()

    # ════════ Cancelar mientras sube ════════
    fotos = [(f'f{i}.jpg', i, '', i * 10) for i in range(8)]
    detenidas = []
    ctx = contexto(b, {i: f'-p{i // 2:02d}' for i in range(8)}, retener=detenidas); page = ctx.new_page()
    llamadas = []; page.on('request', lambda r: llamadas.append(1) if 'op=ia-agrupar' in r.url else None)
    abrir(page, zip_de(fotos))
    page.wait_for_selector('#ziSeparando', timeout=5000)
    ok('Subiendo fotos' in page.locator('#ziSepTxt').inner_text(), 'primero espera a que suban las fotos (y lo dice)')
    page.locator('#ziSeparando button').click(); page.wait_for_timeout(300)
    ok(page.locator('#ziSeparando').count() == 0 and page.evaluate("ZI.modoReal") == 'hora', '"Cancelar y agrupar por hora" agrupa por hora al momento')
    antes = page.evaluate("() => ZI.grupos.map(g => g.fotos.length)")
    while detenidas or page.evaluate("() => ZI.fotos.some(f => !f.nube)"):
        for r, c in detenidas[:]: r.fulfill(status=200, content_type='application/json', body=c); detenidas.remove((r, c))
        page.wait_for_timeout(200)
    page.wait_for_timeout(2500)
    ok(page.evaluate("() => ZI.grupos.map(g => g.fotos.length)") == antes and not llamadas, 'después de cancelar, la IA ya no cambia nada ni gasta')
    ctx.close()

    # ════════ Varias carpetas: no se usa la IA ════════
    b2 = io.BytesIO()
    with zipfile.ZipFile(b2, 'w') as z:
        for i in range(6): z.writestr(f'Prenda {i // 3 + 1}/{i}.jpg', jpg(i))
    ctx = contexto(b, {}); page = ctx.new_page()
    llamadas = []; page.on('request', lambda r: llamadas.append(1) if 'op=ia-agrupar' in r.url else None)
    abrir(page, b2.getvalue()); page.wait_for_timeout(2500)
    ok(page.evaluate("ZI.modoReal") == 'carpetas' and page.evaluate("ZI.grupos.length") == 2 and not llamadas and page.locator('#ziSeparando').count() == 0, 'con una carpeta por prenda no se usa la IA (ni se gasta)')
    ctx.close()

    # ════════ Opción apagada ════════
    ctx = contexto(b, {}); page = ctx.new_page()
    llamadas = []; page.on('request', lambda r: llamadas.append(1) if 'op=ia-agrupar' in r.url else None)
    abrir(page, zip_de([(f'f{i}.jpg', i, '', i * 200) for i in range(5)]), {'separarIA': False}); page.wait_for_timeout(2500)
    ok(not llamadas and page.evaluate("ZI.modoReal") != 'ia', 'si apagas "Separar con IA", se agrupa como antes')
    ctx.close()

    # ════════ Sin saldo ════════
    ctx = contexto(b, {}, sin_saldo=True); page = ctx.new_page()
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(2500); avisos(page)
    page.evaluate("() => { ZI.ig = 'no'; ZI.modo = 'auto'; ZI.separarIA = true; ziAbrir(); }"); page.wait_for_timeout(600)
    page.set_input_files('#ziModal .zi-drop input[type=file]', files=[{'name': 'd.zip', 'mimeType': 'application/zip', 'buffer': zip_de([(f'f{i}.jpg', i, '', i * 200) for i in range(5)])}])
    page.wait_for_function("() => ZI.paso === 'agrupar' && !ZI.separando && ZI.modoReal === 'hora'", timeout=30000)
    ok(any('No se pudo separar con IA' in a and 'sin saldo' in a for a in page.evaluate("window.__avisos")), 'sin saldo: avisa y agrupa por hora para que puedas seguir')
    ok(page.evaluate("ZI.grupos.length") >= 1 and not page.locator('.zi-fila.fin .zi-btn.negro').is_disabled(), 'se puede seguir (corregir a mano)')
    ctx.close()

    # ════════ Celular ════════
    fotos = [(f'f{i}.jpg', i, '', i * 10) for i in range(9)]
    detenidas = []
    ctx = contexto(b, {i: f'-p{i // 3:02d}' for i in range(9)}, 390, 844, True, retener=detenidas); page = ctx.new_page(); errores = []
    page.on('pageerror', lambda x: errores.append(str(x)[:160]) if 'ViewTransition' not in str(x) else None)
    abrir(page, zip_de(fotos))
    page.wait_for_selector('#ziSeparando', timeout=5000)
    sep = page.locator('#ziSeparando').bounding_box()
    ok(sep['width'] <= 390 and page.evaluate("() => document.getElementById('ziCuerpo').scrollWidth <= document.getElementById('ziCuerpo').clientWidth + 1"), 'celular: el aviso de "separando" cabe en la pantalla')
    ok('9 fotos' in page.locator('.zi-barra').inner_text() and 'separando' in page.locator('.zi-barra').inner_text(), 'arriba dice "9 fotos · la IA las está separando" (no un conteo de prendas provisional)')
    while detenidas or page.evaluate("() => ZI.fotos.some(f => !f.nube)"):
        for r, c in detenidas[:]: r.fulfill(status=200, content_type='application/json', body=c); detenidas.remove((r, c))
        page.wait_for_timeout(150)
    page.wait_for_function("() => !ZI.separando && ZI.modoReal === 'ia'", timeout=30000); page.wait_for_timeout(200)
    ok(page.evaluate("ZI.grupos.length") == 3 and page.locator('.zi-grupo-ia').first.is_visible(), 'celular: separó 3 prendas y se ve el nombre de cada una')
    ok(page.evaluate("() => document.getElementById('ziCuerpo').scrollWidth <= document.getElementById('ziCuerpo').clientWidth + 1"), 'celular: nada se sale a lo ancho')
    ok(not errores, f'sin errores en la página ({errores[:2]})')
    ctx.close(); b.close()

f = [m for c, m in res if not c]
print(f'\n{len(res) - len(f)}/{len(res)} PASS')
