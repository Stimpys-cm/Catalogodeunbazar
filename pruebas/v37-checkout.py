# Pruebas del carrito y checkout estilo Mercado Libre / Amazon (v37) en Chrome real
#   node pruebas/correr.mjs --servidor   (en otra terminal)
#   python3 pruebas/v37-checkout.py
import json, re, sys
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8766/'
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)
def vigilar(page):
    errs = []
    page.on('pageerror', lambda e: errs.append(str(e)[:200]) if 'ViewTransition' not in str(e) else None)
    return errs
def contexto(b, ancho, alto, lista=None):
    movil = ancho < 600
    ctx = b.new_context(viewport={'width': ancho, 'height': alto}, is_mobile=movil, has_touch=movil)
    if lista is not None:
        ctx.add_init_script(f"if(!sessionStorage.getItem('v37')){{localStorage.setItem('bazar_wishlist', {json.dumps(json.dumps(lista))});localStorage.removeItem('stmp-cupon');sessionStorage.setItem('v37','1')}}")
    return ctx
num = lambda t: int(re.sub(r'[^\d]', '', t or '0') or 0)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    # Prendas disponibles en la base de prueba
    ctx = contexto(b, 1300, 900); page = ctx.new_page()
    page.goto(BASE + 'tienda.html', wait_until='networkidle'); page.wait_for_timeout(800)
    libres = page.evaluate("getDB().filter(x => !x.vendido && !x.apartada && !x.oculto && (x.bazarId||1) == 1).map(x => x.id)")
    vendida = page.evaluate("getDB().find(x => x.vendido)?.id")
    ctx.close()
    a, c, extra = libres[0], libres[1], libres[2]

    # 1 · Ficha: "Agregar al carrito" → hoja "Agregaste a tu carrito"
    for ancho, alto, nombre in [(1300, 900, 'compu'), (390, 844, 'celular')]:
        ctx = contexto(b, ancho, alto, [{'id': a, 'bazarId': 1, 'nombre': 'x', 'precio_venta': 1}]); page = ctx.new_page(); errs = vigilar(page)
        page.goto(BASE + f'prenda.html?id={c}', wait_until='networkidle'); page.wait_for_timeout(1300)
        btn = page.locator('#ppFav'); btn.scroll_into_view_if_needed(); btn.click(); page.wait_for_timeout(700)
        hoja = page.locator('#caHoja')
        ok(hoja.is_visible() and 'Agregaste a tu carrito' in hoja.inner_text(), f'[{nombre}] hoja "Agregaste a tu carrito"')
        t = hoja.inner_text()
        ok('Subtotal del carrito' in t and '(2 prendas)' in t, f'[{nombre}] la hoja muestra el subtotal del carrito con 2 prendas')
        ok(page.locator('#caHoja a', has_text='Ir a pagar').get_attribute('href') == 'pagar.html?bazar=1', f'[{nombre}] "Ir a pagar" lleva a pagar.html')
        if nombre == 'celular':
            caja = page.evaluate("(() => { const r = document.getElementById('caHoja').getBoundingClientRect(); return [Math.round(r.bottom), innerHeight, Math.round(r.left)] })()")
            ok(abs(caja[0] - caja[1]) <= 1 and caja[2] == 0, f'[celular] la hoja sube desde abajo {caja}')
            bar = page.evaluate("[!!document.getElementById('ppBarraCarrito'), document.getElementById('ppBarraWa')?.textContent.trim()]")
            ok(bar[0] and bar[1] == 'Comprar ahora', f'[celular] barra fija de la ficha: carrito + "Comprar ahora" {bar}')
        page.locator('#caHoja a', has_text='Ver carrito').click(); page.wait_for_load_state('networkidle'); page.wait_for_timeout(1500)
        ok(page.url.endswith('carrito.html'), f'[{nombre}] "Ver carrito" abre la página del carrito')
        ok(not errs, f'[{nombre}] sin errores {errs[:2]}')
        ctx.close()

    # 2 · Página del carrito: lista, resumen, avance, quitar, cupón, continuar
    ctx = contexto(b, 1300, 950, [{'id': a, 'bazarId': 1, 'nombre': 'x', 'precio_venta': 1}, {'id': c, 'bazarId': 1, 'nombre': 'y', 'precio_venta': 1},
                                   {'id': vendida, 'bazarId': 1, 'nombre': 'Ya vendida', 'precio_venta': 1}])
    page = ctx.new_page(); errs = vigilar(page)
    page.goto(BASE + 'carrito.html', wait_until='networkidle'); page.wait_for_timeout(1800)
    ok(page.locator('.ck-pasos li.on').inner_text().strip().endswith('Carrito'), 'pasos: "Carrito" es el paso actual')
    ok(page.locator('.cr-item:not(.cr-item-fuera)').count() == 2, 'dos prendas disponibles en la lista')
    ok(page.locator('.cr-item-fuera').count() == 1 and 'Se vendió' in page.locator('.cr-fuera').inner_text(), 'la vendida sale en "No disponibles ahora"')
    resumen = page.locator('.cr-resumen').inner_text()
    ok('Productos (2)' in resumen and 'Total' in resumen, '"Resumen de compra": Productos (2) y Total')
    # Los montos son los del servidor (v-cotizar)
    srv = page.evaluate(f"fetch('/api/acciones?op=v-cotizar',{{method:'POST',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{ids:[{a},{c}],bazarId:1}})}}).then(r=>r.json())")
    total_txt = page.locator('.cr-resumen .total dd').inner_text()
    ok(num(total_txt) == round(srv['total']), f'el total coincide con el servidor ({total_txt} = {srv["total"]})')
    if srv.get('descVolumen'):
        ok('Descuento por llevar 2' in resumen, 'muestra el descuento por volumen')
    ok(page.locator('.cr-prog').count() >= 1, 'barra de avance (descuento o entrega gratis)')
    ok(page.locator('.cr-recos li').count() >= 1, '"También te puede gustar" con prendas del mismo bazar')
    # Cupón inválido
    if page.locator('.cr-cupon input').count():
        page.fill('.cr-cupon input', 'NOEXISTE'); page.click('.cr-cupon button'); page.wait_for_timeout(900)
        ok(page.locator('.cr-cupon-msg').count() == 1, 'cupón inválido: avisa sin romper el resumen')
    # Quitar la vendida y una disponible
    page.click('.cr-fuera [data-accion="quitar-fuera"]'); page.wait_for_timeout(1200)
    ok(page.locator('.cr-item-fuera').count() == 0, '"Quitarlas" limpia las no disponibles')
    page.locator('.cr-item [data-accion="quitar"]').first.click(); page.wait_for_timeout(1300)
    ok(page.locator('.cr-item').count() == 1 and 'Productos (1)' in page.locator('.cr-resumen').inner_text(), 'Eliminar quita la prenda y recalcula')
    # Agregar desde recomendaciones
    page.locator('.cr-recos [data-accion="agregar"]').first.click(); page.wait_for_timeout(1500)
    ok(page.locator('.cr-item').count() == 2, 'Agregar desde "También te puede gustar"')
    page.locator('a[data-continuar]').first.click(); page.wait_for_load_state('networkidle'); page.wait_for_timeout(1500)
    ok('pagar.html?bazar=1' in page.url, '"Continuar compra" va a pagar.html')
    ok(not errs, f'carrito sin errores {errs[:2]}')
    ctx.close()

    # 3 · Checkout por pasos
    for ancho, alto, nombre in [(1300, 950, 'compu'), (390, 844, 'celular')]:
        ctx = contexto(b, ancho, alto, [{'id': a, 'bazarId': 1, 'nombre': 'x', 'precio_venta': 1}, {'id': c, 'bazarId': 1, 'nombre': 'y', 'precio_venta': 1}])
        page = ctx.new_page(); errs = vigilar(page)
        page.goto(BASE + 'pagar.html?bazar=1', wait_until='networkidle'); page.wait_for_timeout(1500)
        pasos = page.evaluate("[...document.querySelectorAll('.ck-pasos li')].map(l => l.className)")
        ok(pasos == ['ok', 'on', ''], f'[{nombre}] pasos: Carrito ✓ · Entrega y pago (actual) · Confirmación {pasos}')
        ok(page.locator('.ck-pasos a[href="carrito.html"]').count() == 1, f'[{nombre}] el paso "Carrito" regresa al carrito')
        nums = page.evaluate("[...document.querySelectorAll('.ck-sec .ck-num')].map(x => x.textContent)")
        ok(nums == ['1', '2', '3'], f'[{nombre}] secciones numeradas 1 · 2 · 3')
        principal = page.locator('#ckPagar span').inner_text()
        if nombre == 'compu':
            ok(page.locator('#ckPagarLado').is_visible() and page.locator('#ckPagarLado span').inner_text() == principal, f'[compu] botón de pagar también en el resumen ({principal})')
            ok(page.locator('.ck-modificar').get_attribute('href') == 'carrito.html', '[compu] "Modificar carrito" en el resumen')
        else:
            fija = page.locator('#ckFija')
            ok(fija.is_visible() and num(page.locator('#ckFijaTotal').inner_text()) > 0, '[celular] barra fija con total y "Pagar"')
            page.locator('#ckPagar').scroll_into_view_if_needed(); page.wait_for_timeout(600)
            ok('oculta' in (fija.get_attribute('class') or ''), '[celular] la barra se esconde cuando el botón de pagar ya se ve')
            # El botón de la barra hace lo mismo que el principal (sin datos: valida y avisa)
            page.evaluate("window.scrollTo(0,0)"); page.wait_for_timeout(400)
            page.click('#ckFijaPagar'); page.wait_for_timeout(600)
            ok(page.locator('.ck-campo.mal, .ck-aviso.mal, [aria-invalid="true"]').count() >= 1, '[celular] "Pagar" de la barra valida el formulario igual que el principal')
        ok(not errs, f'[{nombre}] checkout sin errores {errs[:2]}')
        ctx.close()

    # 4 · Encabezado y barra de abajo llevan al carrito; carrito vacío
    ctx = contexto(b, 1300, 900, []); page = ctx.new_page(); errs = vigilar(page)
    page.goto(BASE + 'tienda.html', wait_until='networkidle'); page.wait_for_timeout(1000)
    page.click('#wishlistHeaderBtn'); page.wait_for_load_state('networkidle'); page.wait_for_timeout(1300)
    ok(page.url.endswith('carrito.html'), 'el ícono del carrito del encabezado abre carrito.html')
    ok('Tu carrito está vacío' in page.inner_text('body') and page.locator('.cr-vacio a[href="tienda.html"]').count() == 1, 'carrito vacío con "Descubrir prendas"')
    ok(not errs, f'sin errores {errs[:2]}')
    ctx.close()
    b.close()

pas = sum(1 for r in res if r[0])
print(f'\nRESULTADO v37: {pas} de {len(res)}')
sys.exit(0 if pas == len(res) else 1)
