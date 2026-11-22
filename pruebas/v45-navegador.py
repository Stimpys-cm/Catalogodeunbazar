# Pruebas v45 en el navegador: el agente investigador (tipo tasador) y crear marcas/categorías.
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v45-navegador.py
import json, re, io, zipfile, urllib.request, hashlib, uuid
from playwright.sync_api import sync_playwright
from PIL import Image

BASE = 'http://127.0.0.1:8766/'
CORRIDA = uuid.uuid4().hex[:8]
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
        for i, c in enumerate(colores): z.writestr(f'Prenda {i + 1}/frente.jpg', jpg(c))
    return b.getvalue()
def sync():
    req = urllib.request.Request(BASE + 'api/sync?fresh=1', headers={'authorization': 'Bearer TA'})
    with urllib.request.urlopen(req) as r: return json.loads(r.read())

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
    ctx.route(re.compile(r'https://res\.cloudinary\.com/.*'), lambda r: r.fulfill(status=200, content_type='image/jpeg', body=jpg((200, 200, 200))))
    # Subidas: "rara" en el link cuando así se pide (el servidor de pruebas contesta pieza rara de Stüssy)
    modo = {'rara': True}
    def subir(route):
        if route.request.method != 'POST': return route.continue_()
        f = json.loads(route.request.post_data or '{}').get('file', '')
        h = hashlib.sha1(f.encode()).hexdigest()[:10]
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'url': f'https://res.cloudinary.com/demo/image/upload/v1/bazar/{CORRIDA}-{"rara" if modo["rara"] else "comun"}-{h}.jpg'}))
    ctx.route('**/api/upload', subir)
    ag = {'n': 0, 'fallar': 0, 'malicioso': False}
    def agente(route):
        ag['n'] += 1
        if ag['fallar'] > 0:
            ag['fallar'] -= 1
            return route.fulfill(status=503, content_type='application/json', body=json.dumps({'error': 'La IA está muy ocupada en este momento.', 'reintentable': True}))
        if ag['malicioso']:
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({
                'nombre': '<img src=x onerror="window.__xss=1">', 'marca': 'Nike', 'categoria': 'Playeras', 'rareza': {'nivel': 3, 'etiqueta': 'Rara', 'senales': ['<script>window.__xss=2</script>']},
                'epoca': {'rango': '<b onmouseover=x>90s</b>', 'pistas': []}, 'autenticidad': {'nivel': 'alta', 'notas': []},
                'comparables': [{'titulo': '<img src=x onerror="window.__xss=3">', 'sitio': 'eBay', 'precio': 10, 'moneda': 'USD', 'usd': 10, 'mxn': 200, 'vendido': True, 'url': 'javascript:window.__xss=4', 'verificado': True}],
                'precios': {'rapido': 100, 'justo': 120, 'maximo': 150, 'tc': 18}, 'evidencia': ['<img src=x onerror="window.__xss=5">'], 'confianza': 0.5}))
        route.continue_()
    ctx.route('**/api/acciones?op=ia-agente*', agente)

    page = ctx.new_page(); e = errores(page)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(3000)
    page.evaluate("() => { ZI.esperasReintento = [300, 400, 500]; ZI.ig = 'no'; ZI.investigarRaras = true; ZI.crearCatalogo = true; }")
    ok(not any(m['nombre'] == 'Stüssy' for m in sync().get('marcas', [])), 'antes: no existe la marca Stüssy')

    # ── 1 · Pieza rara: el agente la investiga solo ──
    page.evaluate("() => ziAbrir()"); page.wait_for_timeout(500)
    ok(page.locator('#ziOpInvestigar').count() == 0, '(las opciones salen en el paso de agrupar)')
    page.set_input_files('#ziModal .zi-drop input[type=file]', files=[{'name': 'rara.zip', 'mimeType': 'application/zip', 'buffer': un_zip([(10, 10, 10)])}])
    page.wait_for_function("() => ZI.paso === 'agrupar'", timeout=8000)
    ok(page.locator('#ziOpInvestigar').is_checked() and page.locator('#ziOpCatalogo').is_checked(), 'opciones "Investigar a fondo las piezas raras" y "Crear marcas y categorías nuevas", prendidas')
    page.locator('button:has-text("Subir y analizar")').click()
    page.wait_for_function("() => ZI.grupos[0]?.agente?.estado === 'hecho'", timeout=40000)
    g = page.evaluate("() => ({ f: ZI.grupos[0].f, r: ZI.grupos[0].agente.r, ia: ZI.grupos[0].ia })")
    ok(g['ia']['rareza'] == 4, f'el análisis rápido la marca como rara ({g["ia"]["rareza"]}) y la manda al agente solo')
    r = g['r']
    ok(r['rareza']['nivel'] == 4 and r['epoca']['rango'] == '1989–1992', f'informe: {r["rareza"]["etiqueta"]}, {r["epoca"]["rango"]}')
    ok(r['precios']['justo'] == 2600 and r['precios']['rapido'] == 2200 and r['precios']['maximo'] == 3400, f'precio para México con ventas reales: rápido ${r["precios"]["rapido"]}, justo ${r["precios"]["justo"]}, máximo ${r["precios"]["maximo"]}')
    ok(g['f']['nombre'] == 'Playera Stüssy World Tour 1990' and int(g['f']['precio']) == 2600, f'como no lo habías tocado, usa el nombre y el precio justo del agente ({g["f"]["nombre"]} · ${g["f"]["precio"]})')
    t = page.locator('#ziT' + str(page.evaluate("() => ZI.grupos[0].id")))
    ok(t.locator('.zi-rz.n4').count() >= 1 and 'Muy rara' in t.inner_text(), 'la tarjeta muestra ★★★★☆ Muy rara')
    ok(t.locator('.zi-ag-p').count() == 3 and t.locator('.zi-ag-p.on b').inner_text() == '$2,600', 'botones Rápido / Justo / Máximo, con el justo marcado')
    ok(t.locator('.zi-ag-comps li').count() == 3 and t.locator('.zi-ag-comps li a[href^="https://www.ebay.com/itm/9001"]').count() == 1, 'comparables con link a la venta real')
    ok(t.locator('.zi-ag-comps li:has-text("Link inventado")').count() == 0, 'el comparable con link inventado ni siquiera se muestra')
    ok('Época' in t.inner_text() and 'Single stitch' in t.inner_text() and 'Se ve auténtica' in t.inner_text(), 'época con sus pistas, señales de rareza y autenticidad')
    ok('En EE.UU.' in t.inner_text() and '70 %' in t.inner_text(), 'explica cuánto se paga en EE.UU. y qué porcentaje se sugiere para México')
    ok(t.locator('.zi-nuevas').count() == 1 and 'Stüssy' in t.locator('.zi-nuevas').inner_text() and 'Jerseys' in t.locator('.zi-nuevas').inner_text(), 'avisa: marca nueva Stüssy y categoría nueva Jerseys, se agregan al guardar')
    ok('＋ Jerseys (nueva)' in t.locator('select').nth(0).inner_text(), 'la categoría nueva aparece en la lista como "＋ Jerseys (nueva)"')
    # Precio bajo → "la estás dando barata"
    t.locator('.zi-c.precio input').fill('500'); page.wait_for_timeout(700)
    ok(t.locator('.zi-ag-barata').count() == 1 and 'barata' in t.locator('.zi-ag-barata').inner_text(), 'si le pones $500: "La estás dando barata" con el rango real')
    t.locator('.zi-ag-p:has-text("Máximo")').click(); page.wait_for_timeout(300)
    ok(page.evaluate("() => Number(ZI.grupos[0].f.precio)") == 3400 and t.locator('.zi-ag-barata').count() == 0, 'un clic en "Máximo" pone $3,400 y se quita el aviso')

    # ── 2 · No deja guardar mientras investiga ──
    page.evaluate("() => { ZI.grupos[0].agente.estado = 'investigando'; ziGuardarTodas(); }"); page.wait_for_timeout(400)
    ok(not page.evaluate("() => ZI.grupos[0].guardada"), 'mientras el agente investiga no se guarda (avisa que esperes)')
    page.evaluate("() => { ZI.grupos[0].agente.estado = 'hecho'; ziPintarTarjeta(ZI.grupos[0], true); ziPintarPie(); }")

    # ── 3 · Guardar crea la marca y la categoría ──
    page.locator('#ziPie button:has-text("Guardar 1 prenda")').click()
    page.wait_for_function("() => ZI.grupos[0].guardada", timeout=15000)
    d = sync()
    marca = [m for m in d.get('marcas', []) if m['nombre'] == 'Stüssy']; cat = [c for c in d.get('categorias', []) if c['nombre'] == 'Jerseys']
    ok(len(marca) == 1 and len(cat) == 1, 'al guardar se crearon la marca Stüssy y la categoría Jerseys')
    pid = page.evaluate("() => ZI.grupos[0].prendaId"); pr = next(x for x in d['inventario'] if x['id'] == pid)
    ok(pr['marca'] == 'Stüssy' and pr['categorias'] == ['Jerseys'] and pr['precio_venta'] == 3400, f'la prenda quedó con esa marca, categoría y precio ({pr["marca"]} · {pr["categorias"]} · ${pr["precio_venta"]})')
    ok(page.evaluate("() => getBrands().some(b => b.nombre === 'Stüssy') && getCats().some(c => c.nombre === 'Jerseys')"), 'y aparecen al instante en el panel')

    # ── 4 · Pieza común: no se investiga sola; botón "Investigar a fondo" (con un fallo pasajero) ──
    modo['rara'] = False
    page.evaluate("() => { ZI.grupos = []; ZI.paso = 'elegir'; ziPintar(); }"); page.wait_for_timeout(300)
    page.set_input_files('#ziModal .zi-drop input[type=file]', files=[{'name': 'comun.zip', 'mimeType': 'application/zip', 'buffer': un_zip([(240, 20, 120)])}])
    page.wait_for_function("() => ZI.paso === 'agrupar'", timeout=8000)
    n0 = ag['n']
    page.locator('button:has-text("Subir y analizar")').click()
    page.wait_for_function("() => ZI.grupos[0]?.estado === 'hecho' && !ZI.corriendo", timeout=30000); page.wait_for_timeout(800)
    ok(ag['n'] == n0 and not page.evaluate("() => ZI.grupos[0].agente"), 'una pieza común no gasta en investigación sola')
    t = page.locator('#ziT' + str(page.evaluate("() => ZI.grupos[0].id")))
    ok(t.locator('.zi-ag-ofrece button:has-text("Investigar a fondo")').count() == 1, 'pero tiene su botón "Investigar a fondo"')
    ag['fallar'] = 1
    t.locator('.zi-ag-ofrece button').click()
    page.wait_for_function("() => ZI.grupos[0].agente?.estado === 'hecho'", timeout=30000)
    ok(ag['n'] - n0 >= 2, 'la IA ocupada la primera vez: se reintenta sola y termina')
    ok(page.evaluate("() => ZI.grupos[0].f.nombre") == 'Sudadera Nike Vintage' or page.evaluate("() => ZI.grupos[0].f.nombre") == 'Playera Stüssy World Tour 1990', '(el informe se aplica)')
    ok(page.locator('.zi-ag-pie button:has-text("Volver a investigar")').count() == 1, 'y "Volver a investigar"')

    # ── 5 · Lo que manda la IA no puede meter código en el panel ──
    ag['malicioso'] = True
    page.evaluate("() => ziInvestigar(ZI.grupos[0].id, true)")
    page.wait_for_function("() => ZI.grupos[0].agente?.estado === 'hecho' && ZI.grupos[0].agente.r.precios.justo === 120", timeout=20000); page.wait_for_timeout(500)
    ok(not page.evaluate("() => window.__xss") and page.locator('.zi-ag img').count() == 0 and page.locator('.zi-ag a[href^="javascript"]').count() == 0, 'un informe con código (<img onerror>, <script>, javascript:) se muestra como texto y no se ejecuta')
    ag['malicioso'] = False
    page.evaluate("() => ziCerrar()")

    # ── 6 · Formulario de una prenda: "Investigar a fondo" ──
    page.evaluate("() => { showTab('registrar'); }"); page.wait_for_timeout(800)
    ok(page.locator('#iaInvestigarBtn').count() == 1, 'el formulario "Registrar prenda" tiene "Investigar a fondo"')
    page.evaluate(f"() => {{ newImages.length = 0; newImages.push('https://res.cloudinary.com/demo/image/upload/v1/bazar/{CORRIDA}-form.jpg'); }}")
    page.locator('#iaInvestigarBtn').click()
    page.wait_for_function("() => document.querySelector('#iaAgenteForm .zi-ag-precios')", timeout=30000)
    ok(page.input_value('#f_precio') == '2600' and page.input_value('#f_nombre') == 'Playera Stüssy World Tour 1990', f'llena nombre y precio justo; una sola prenda de Stüssy en tu historial no sube el precio (${page.input_value("#f_precio")})')
    ok(page.input_value('#f_marca') == 'Stüssy', 'elige la marca Stüssy (que ya existe; no la duplica)')
    ok(page.locator('#f_cats_wrap input[value="Jerseys"]').is_checked(), 'marca la categoría Jerseys')
    page.locator('#iaAgenteForm .zi-ag-p:has-text("Rápido")').click(); page.wait_for_timeout(200)
    ok(page.input_value('#f_precio') == '2200', 'un clic en "Rápido" pone $2,200 en el formulario')
    ok(sum(1 for m in sync().get('marcas', []) if m['nombre'] == 'Stüssy') == 1, 'sigue habiendo una sola marca Stüssy')

    # ── 7 · Celular ──
    m = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    m.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    m.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
    m.route(re.compile(r'https://res\.cloudinary\.com/.*'), lambda r: r.fulfill(status=200, content_type='image/jpeg', body=jpg((60, 70, 90))))
    pm = m.new_page(); em = errores(pm)
    pm.goto(BASE + 'admin.html', wait_until='load'); pm.wait_for_timeout(2500)
    pm.evaluate("""() => { ziAbrir(); ZI.paso = 'revisar'; ZI.ia = { activa: true };
      ZI.grupos = [{ id: 1, fotos: [], subidas: ['https://res.cloudinary.com/demo/image/upload/v1/bazar/c1.jpg'], estado: 'hecho', ia: { rareza: 4, confianza: { marca: .9, talla: .8, precio: .7 }, modelo: 'claude-haiku-5-5' },
        f: { incluir: true, nombre: 'Playera Stüssy World Tour 1990', marca: 'Stüssy', categoria: 'Jerseys', talla: 'L Hombre', estado: '9/10', precio: 900 }, agente: { estado: 'hecho', r: { rareza: { nivel: 4, senales: ['Single stitch', 'Made in USA'] }, epoca: { rango: '1989–1992', decada: '90s', pistas: ['Etiqueta negra con corona'] },
        autenticidad: { nivel: 'alta', notas: [] }, precios: { rapido: 2200, justo: 2600, maximo: 3400, usdMediana: 210, mxnEEUU: 3800, tc: 18.2, pctMexico: 70 }, confianza: .8, busquedas: 3, costoUSD: .05,
        comparables: [{ titulo: 'Vintage Stussy World Tour 90s tee', sitio: 'eBay', precio: 210, moneda: 'USD', mxn: 3820, vendido: true, url: 'https://www.ebay.com/itm/9001', verificado: true }], evidencia: ['Tres vendidas entre $190 y $250 USD'] } } }]; ziPintar(); }""")
    pm.wait_for_timeout(800)
    caja = pm.locator('.zi-ag').bounding_box()
    ok(caja and caja['width'] <= 390 and pm.evaluate("() => document.documentElement.scrollWidth") <= 392, 'en celular el informe cabe sin salirse de la pantalla')
    pm.locator('.zi-ag').scroll_into_view_if_needed(); pm.wait_for_timeout(300)
    pm.screenshot(path='/mnt/user-data/outputs/v45-agente-celular.png')
    ok(not em, f'celular sin errores {em[:2]}')
    m.close()

    # Captura en compu
    page.evaluate("() => { showTab('inventario'); ziAbrir(); }"); page.wait_for_timeout(300)
    page.evaluate("""() => { ZI.paso = 'revisar'; ZI.ia = { activa: true }; ZI.grupos = [{ id: 1, fotos: [], subidas: ['https://res.cloudinary.com/demo/image/upload/v1/bazar/c1.jpg', 'https://res.cloudinary.com/demo/image/upload/v1/bazar/c2.jpg'], estado: 'hecho', ia: { rareza: 4, confianza: { marca: .9, talla: .8, precio: .7 }, modelo: 'claude-sonnet-5-5', costoUSD: .004 },
        f: { incluir: true, nombre: 'Playera Stüssy World Tour 1990', marca: 'Supreme', categoria: 'Camisas vintage', talla: 'L Hombre', estado: '9/10', precio: 900, descripcion: 'Playera Stüssy World Tour original de principios de los 90.', hashtags: '#stussy #worldtour #vintage' }, agente: { estado: 'hecho', r: { modelo: 'World Tour', rareza: { nivel: 4, senales: ['Diseño World Tour original', 'Single stitch', 'Made in USA'] }, epoca: { rango: '1989–1992', decada: '90s', pistas: ['Etiqueta negra Stüssy con corona', 'Single stitch', 'Made in USA'] }, origen: 'Made in USA', material: '100% algodón',
        autenticidad: { nivel: 'alta', notas: ['Etiqueta y costuras de la época'] }, precios: { rapido: 2200, justo: 2600, maximo: 3400, usdMediana: 210, mxnEEUU: 3820, tc: 18.2, pctMexico: 70 }, confianza: .8, busquedas: 4, costoUSD: .052,
        comparables: [{ titulo: 'Vintage Stussy World Tour 90s tee', sitio: 'ebay.com', precio: 210, moneda: 'USD', mxn: 3820, vendido: true, fecha: 'oct 2026', url: 'https://www.ebay.com/itm/9001', verificado: true }, { titulo: 'Stussy World Tour single stitch', sitio: 'grailed.com', precio: 250, moneda: 'USD', mxn: 4550, vendido: true, url: 'https://www.grailed.com/listings/9002', verificado: true }, { titulo: 'Playera Stussy world tour vintage', sitio: 'mercadolibre.com.mx', precio: 2800, moneda: 'MXN', mxn: 2800, vendido: false, url: 'https://articulo.mercadolibre.com.mx/MLM-1', verificado: true }],
        evidencia: ['Tres vendidas en EE.UU. entre $190 y $250 USD', 'En Mercado Libre hay una a la venta en $2,800'] } } }]; ziPintar(); }""")
    page.wait_for_timeout(800)
    page.locator('#ziModal .zi-ag').scroll_into_view_if_needed(); page.wait_for_timeout(300)
    page.screenshot(path='/mnt/user-data/outputs/v45-agente-compu.png')

    ok(not e, f'sin errores de JavaScript {e[:2]}')
    b.close()

malas = [m for c, m in res if not c]
print(f'\n{len(res) - len(malas)} de {len(res)} correctas')
if malas: raise SystemExit(1)
