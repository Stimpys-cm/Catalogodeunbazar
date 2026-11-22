# Pruebas v46 en el navegador: contador del saldo de la IA.
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v46-navegador.py
import json, re, io, zipfile, uuid, hashlib
from playwright.sync_api import sync_playwright
from PIL import Image

BASE = 'http://127.0.0.1:8766/'
CORRIDA = uuid.uuid4().hex[:8]
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)
def jpg(c=(90, 90, 90)):
    b = io.BytesIO(); Image.new('RGB', (400, 500), c).save(b, 'JPEG'); return b.getvalue()
def errores(page):
    e = []; page.on('pageerror', lambda x: e.append(str(x)[:160]) if 'ViewTransition' not in str(x) else None); return e
def un_zip(c):
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w', zipfile.ZIP_DEFLATED) as z: z.writestr('Prenda 1/frente.jpg', jpg(c))
    return b.getvalue()
def contexto(b, ancho=1440, alto=900):
    ctx = b.new_context(viewport={'width': ancho, 'height': alto}, device_scale_factor=2 if ancho < 500 else 1)
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
    ctx.route(re.compile(r'https://res\.cloudinary\.com/.*'), lambda r: r.fulfill(status=200, content_type='image/jpeg', body=jpg((200, 200, 200))))
    def subir(route):
        if route.request.method != 'POST': return route.continue_()
        h = hashlib.sha1((route.request.post_data or '').encode()).hexdigest()[:10]
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'url': f'https://res.cloudinary.com/demo/image/upload/v1/bazar/{CORRIDA}-{h}.jpg'}))
    ctx.route('**/api/upload', subir)
    return ctx

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = contexto(b)
    sin = {'on': False}
    def prenda(route):
        if sin['on']: return route.fulfill(status=402, content_type='application/json', body=json.dumps({'error': 'Tu cuenta de Anthropic no tiene saldo. Recarga en console.anthropic.com → Billing.', 'reintentable': False, 'tipo': 'saldo'}))
        route.continue_()
    ctx.route('**/api/acciones?op=ia-prenda*', prenda)
    page = ctx.new_page(); e = errores(page)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(2500)
    page.evaluate("() => { ZI.ig = 'no'; ZI.esperasReintento = [300, 300, 300]; }")

    # ── 1 · Poner el saldo ──
    page.evaluate("() => ziAbrir()"); page.wait_for_timeout(1200)
    ok(page.locator('#ziSaldo #ziSaldoUsd').count() == 1 and 'platform.claude.com' in page.locator('#ziSaldo a').first.get_attribute('href'), 'sin saldo: pide escribirlo, con link a Billing de Anthropic')
    page.screenshot(path='/mnt/user-data/outputs/v46-saldo-poner.png', clip={'x': 0, 'y': 0, 'width': 1440, 'height': 520})
    page.fill('#ziSaldoUsd', '4.32'); page.fill('#ziSaldoUmbral', '1')
    page.locator('#ziSaldo button:has-text("Guardar saldo")').click(); page.wait_for_timeout(800)
    t = page.locator('#ziSaldo').inner_text()
    ok('$4.32' in t and 'USD' in t and '≈ $' in t, f'muestra $4.32 USD y su equivalente en pesos')
    ok('Alcanza para ~' in t and 'investigaciones' in t, 'dice para cuántas investigaciones o prendas alcanza')
    ok(page.locator('#ziSaldo .zi-saldo-barra span').get_attribute('style').startswith('width:100'), 'barra llena al principio')

    # ── 2 · Analizar una prenda baja el saldo al momento ──
    page.set_input_files('#ziModal .zi-drop input[type=file]', files=[{'name': 'z.zip', 'mimeType': 'application/zip', 'buffer': un_zip((40, 90, 160))}])
    page.wait_for_function("() => ZI.paso === 'agrupar'", timeout=8000)
    page.locator('button:has-text("Subir y analizar")').click()
    page.wait_for_function("() => ZI.grupos[0]?.estado === 'hecho' && !ZI.corriendo", timeout=30000); page.wait_for_timeout(1200)
    q = page.evaluate("() => ZI.ia.saldo")
    ok(q['gastado'] > 0 and q['queda'] < 4.32, f'después de analizar, el saldo bajó (gastado ${q["gastado"]:.4f}, queda ${q["queda"]:.4f})')
    ok('saldo IA $' in page.locator('#ziPie').inner_text(), 'abajo, junto a "gastado", se ve el saldo que queda')

    # ── 3 · Saldo bajo ──
    page.evaluate("() => { ZI.paso = 'elegir'; ZI.grupos = []; ziPintar(); }"); page.wait_for_timeout(900)
    page.locator('#ziSaldo button:has-text("Actualizar")').click(); page.wait_for_timeout(300)
    page.fill('#ziSaldoUsd', '0.80'); page.fill('#ziSaldoUmbral', '1')
    page.locator('#ziSaldo button:has-text("Guardar saldo")').click(); page.wait_for_timeout(800)
    ok(page.locator('#ziSaldo.bajo').count() == 1 and 'Te queda poco saldo' in page.locator('#ziSaldo').inner_text(), 'con menos de $1: se pone en naranja y dice que recargues')
    page.screenshot(path='/mnt/user-data/outputs/v46-saldo-bajo.png', clip={'x': 0, 'y': 0, 'width': 1440, 'height': 520})

    # ── 4 · Sin saldo (Anthropic lo dice) ──
    page.locator('#ziSaldo button:has-text("Actualizar")').click(); page.wait_for_timeout(300)
    page.fill('#ziSaldoUsd', '12.50'); page.locator('#ziSaldo button:has-text("Guardar saldo")').click(); page.wait_for_timeout(800)
    ok(page.locator('#ziSaldo.bajo').count() == 0 and '$12.50' in page.locator('#ziSaldo').inner_text(), 'al recargar y actualizar vuelve a verde ($12.50)')
    page.screenshot(path='/mnt/user-data/outputs/v46-saldo.png', clip={'x': 0, 'y': 0, 'width': 1440, 'height': 520})
    sin['on'] = True
    page.set_input_files('#ziModal .zi-drop input[type=file]', files=[{'name': 'z.zip', 'mimeType': 'application/zip', 'buffer': un_zip((160, 40, 90))}])
    page.wait_for_function("() => ZI.paso === 'agrupar'", timeout=8000)
    page.locator('button:has-text("Subir y analizar")').click()
    page.wait_for_function("() => ZI.grupos[0]?.estado === 'error' && !ZI.corriendo", timeout=30000)
    ok('saldo' in page.evaluate("() => ZI.grupos[0].error"), 'si Anthropic dice "sin saldo", la prenda lo dice y se pausa')
    sin['on'] = False

    # ── 5 · Formulario ──
    page.evaluate("() => { ziCerrar(); showTab('registrar'); }"); page.wait_for_timeout(1500)
    ok('saldo IA $' in page.locator('#iaSaldoLinea').inner_text(), f'el formulario "Registrar prenda" muestra el saldo ({page.locator("#iaSaldoLinea").inner_text()})')

    # ── 6 · Celular ──
    m = contexto(b, 390, 844); pm = m.new_page(); em = errores(pm)
    pm.goto(BASE + 'admin.html', wait_until='load'); pm.wait_for_timeout(2500)
    pm.evaluate("() => ziAbrir()"); pm.wait_for_timeout(1500)
    caja = pm.locator('#ziSaldo').bounding_box()
    ok(caja and caja['width'] <= 390 and pm.evaluate("() => document.documentElement.scrollWidth") <= 392, 'en celular el saldo cabe')
    pm.screenshot(path='/mnt/user-data/outputs/v46-saldo-celular.png')
    ok(not em, f'celular sin errores {em[:2]}')
    m.close()

    ok(not e, f'sin errores de JavaScript {e[:2]}')
    b.close()

malas = [m for c, m in res if not c]
print(f'\n{len(res) - len(malas)} de {len(res)} correctas')
if malas: raise SystemExit(1)
