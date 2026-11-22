# Pruebas del contador del apartado de 10 minutos (v36) en Chrome real
#   node pruebas/correr.mjs --servidor   (en otra terminal)
#   python3 pruebas/v36-navegador.py
import json, sys
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8766/'
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)
def vigilar(page):
    errs = []; page.on('pageerror', lambda e: errs.append(str(e)[:200])); return errs

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1100, 'height': 900}); page = ctx.new_page(); errs = vigilar(page)
    page.goto(BASE + 'tienda.html', wait_until='load'); page.wait_for_timeout(2500)
    # Un cliente empieza a pagar una prenda (se aparta 10 minutos)
    libres = page.evaluate("getDB().filter(x => !x.vendido && !x.apartada && !x.oculto).map(x => x.id)")
    pid = libres[-1]
    r = page.evaluate(f"""fetch('/api/acciones?op=v-pagar', {{ method: 'POST', headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify({{ bazarId: 1, ids: [{pid}], nombre: 'Ana Prueba', telefono: '8991112277', punto: 'zona-centro', metodo: 'clip' }}) }}).then(r => r.json())""")
    ok(r.get('pedido'), f'se abre un pago para la prenda #{pid}')
    # La tienda puede tardar unos segundos en verlo (caché); se toma una prenda que ya esté en pago
    page.wait_for_timeout(500)
    page.goto(BASE + 'tienda.html', wait_until='load'); page.wait_for_timeout(3000)
    enpago = page.evaluate("getDB().filter(x => x.pagandoHasta).map(x => [x.id, x.pagandoHasta])")
    ok(len(enpago) >= 1, f'la tienda recibe prendas en pago con su hora límite ({len(enpago)})')
    hid, hasta = enpago[0]
    mins = page.evaluate(f"(Date.parse('{hasta}') - Date.now()) / 60000")
    ok(0 < mins <= 10.05, f'el apartado dura a lo mucho 10 minutos ({mins:.2f})')
    ok(page.evaluate(f"!JSON.stringify(getDB().find(x => x.id == {hid})).includes('reservedBy')"), 'la tienda no recibe quién está pagando')
    esquina = page.locator(f'.card:has(.apartada-corner.en-pago) .cuenta').first
    t1 = esquina.text_content(); page.wait_for_timeout(2200); t2 = esquina.text_content()
    ok(t1 != t2 and ':' in t2, f'la tarjeta muestra el contador y avanza ({t1} → {t2})')
    ok(page.locator(f'.card:has(.apartada-corner.en-pago) .card-fav-btn').count() == 0, 'mientras está en pago no se puede agregar al carrito')
    # Carrito
    page.evaluate(f"localStorage.setItem('bazar_wishlist', JSON.stringify([{{ id: {hid}, bazarId: 1, nombre: 'x', precio_venta: 1 }}]))")
    page.evaluate("abrirPanelLateral()"); page.wait_for_timeout(600)
    sello = page.evaluate("document.querySelector('.wl-item-sello.en-pago')?.innerText || ''")
    ok('APARTADA' in sello.upper() and ':' in sello, f'en el carrito sale "Apartada" con contador ({sello!r})')
    ok(page.locator('#wishlistPanel .wl-aviso').count() == 0, 'no la cuenta como "ya no disponible" (puede liberarse)')
    ctx.close()

    # Ficha: aviso con contador y al llegar a cero vuelve a estar disponible
    for ancho, alto, nombre in [(1100, 900, 'compu'), (390, 844, 'celular')]:
        ctx = b.new_context(viewport={'width': ancho, 'height': alto}, is_mobile=ancho < 600, has_touch=ancho < 600)
        page = ctx.new_page(); errs2 = vigilar(page)
        page.goto(BASE + f'prenda.html?id={hid}', wait_until='networkidle'); page.wait_for_timeout(1300)
        aviso = page.evaluate("document.querySelector('.pp-aviso-pago')?.innerText || ''")
        ok('pagando' in aviso and ':' in aviso, f'[{nombre}] ficha: "Alguien la está pagando… en m:ss"')
        ok(page.locator('#ppFav').count() == 0 and page.locator('#tpComprar').count() == 0, f'[{nombre}] ficha: sin "Comprar ahora" ni carrito mientras corre')
        page.evaluate(f"(() => {{ const x = getDB().find(p => p.id == {hid}); x.pagandoHasta = new Date(Date.now() + 2500).toISOString(); _agendarPagos(); window.dispatchEvent(new CustomEvent('db:inventario')); }})()")
        page.wait_for_timeout(4200)
        ok(page.locator('.pp-aviso-pago').count() == 0 and page.locator('#ppFav').count() == 1 and page.locator('#tpComprar').count() == 1,
           f'[{nombre}] al llegar a cero se libera sola: vuelven "Comprar ahora" y "Agregar al carrito"')
        ok(not errs2, f'[{nombre}] sin errores {errs2[:2]}')
        ctx.close()

    # Quien está pagando: contador en su página de pago
    ctx = b.new_context(viewport={'width': 430, 'height': 900}, is_mobile=True, has_touch=True); page = ctx.new_page(); errs3 = vigilar(page)
    page.goto(BASE + f"pagar.html?pedido={r['pedido']}&k={r['clave']}&fallo=1", wait_until='networkidle'); page.wait_for_timeout(1500)
    caja = page.evaluate("document.querySelector('.ck-cuenta')?.innerText || ''")
    ok('apartadas para ti' in caja, f'pago no completado: "Tus prendas siguen apartadas para ti: m:ss" ({caja!r})')
    n1 = page.locator('.ck-cuenta-num').text_content(); page.wait_for_timeout(2100); n2 = page.locator('.ck-cuenta-num').text_content()
    ok(n1 != n2, f'el contador del comprador avanza ({n1} → {n2})')
    page.goto(BASE + 'pagar.html?bazar=1', wait_until='load'); page.wait_for_timeout(2500)
    page.evaluate(f"localStorage.setItem('bazar_wishlist', JSON.stringify([{{ id: {libres[0]}, bazarId: 1, nombre: 'x', precio_venta: 1 }}]))")
    page.goto(BASE + 'pagar.html?bazar=1', wait_until='load'); page.wait_for_timeout(3000)
    ok('10 minutos' in (page.evaluate("document.querySelector('.ck-lead')?.innerText") or ''), 'la página de pago avisa que se aparta 10 minutos')
    ok(not errs3, f'pago sin errores {errs3[:2]}')
    ctx.close()

    # Panel: chip "Pagando en línea" con contador
    ctx = b.new_context(viewport={'width': 1366, 'height': 900})
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script("localStorage.setItem('stiimpys_session', JSON.stringify({id:1,username:'admin',role:'admin',sessionToken:'TA',bazarId:null}))")
    page = ctx.new_page(); errs4 = vigilar(page)
    page.goto(BASE + 'admin.html', wait_until='networkidle'); page.wait_for_timeout(1500)
    chip = page.locator('.ap-chip-pago').first
    ok(chip.count() and 'Pagando en línea' in chip.inner_text() and ':' in chip.inner_text(), f'panel: "Pagando en línea: nombre · m:ss" ({chip.inner_text() if chip.count() else ""})')
    ok(not errs4, f'panel sin errores {errs4[:2]}')
    b.close()

pas = sum(1 for r in res if r[0])
print(f'\nRESULTADO v36: {pas} de {len(res)}')
sys.exit(0 if pas == len(res) else 1)
