# Pruebas del carrito (v35) en Chrome real contra el servidor local
#   node pruebas/correr.mjs --servidor   (en otra terminal)
#   python3 pruebas/v35-carrito.py
# Revisa: el panel ya no se desborda, la wishlist es ahora un carrito en todas las
# páginas, lo guardado antes aparece en el carrito, la ficha agrega y abre el carrito,
# y los textos del giro y de los pagos por intermediarios.
import json, re, sys
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8766/'
PUBLICAS = ['inicio.html', 'tienda.html', 'prenda.html?id=6', 'pagar.html?bazar=1', 'cuenta.html', 'terminos.html']
LARGOS = {6: 'Playera Vintage Nascar Dale Earnhardt Intimidator 1998', 7: 'Playera Vintage Daytona Bike Week 2009 Harley Davidson'}
GUARDADO = [{'id': 6, 'bazarId': 1, 'nombre': 'Pantalón Dickies #6', 'talla': 'L', 'precio_venta': 500, 'imagenes': []},
            {'id': 7, 'bazarId': 1, 'nombre': 'Tenis Adidas #7', 'talla': 'S', 'precio_venta': 550, 'imagenes': []}]
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)

def contexto(b, ancho, alto, lista=None):
    movil = ancho < 600
    ctx = b.new_context(viewport={'width': ancho, 'height': alto}, is_mobile=movil, has_touch=movil)
    if lista is not None:
        # Solo la primera vez: así se puede probar quitar y agregar sin que se vuelva a llenar
        ctx.add_init_script(f"if(!sessionStorage.getItem('v35')){{localStorage.setItem('bazar_wishlist', {json.dumps(json.dumps(lista))});sessionStorage.setItem('v35','1')}}")
    return ctx

def vigilar(page):
    errs, malos = [], []
    page.on('pageerror', lambda e: errs.append(str(e)[:200]))
    page.on('response', lambda r: malos.append(f"{r.status} {r.url.replace(BASE, '/')}") if r.status == 404 and '127.0.0.1' in r.url else None)
    return errs, malos

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

    # 1 · El panel ya no se desborda con nombres largos (el error de la captura)
    for ancho, alto, nombre in [(1100, 1000, 'compu'), (390, 844, 'celular')]:
        ctx = contexto(b, ancho, alto, GUARDADO); page = ctx.new_page(); errs, malos = vigilar(page)
        page.goto(BASE + 'prenda.html?id=6', wait_until='networkidle'); page.wait_for_timeout(1200)
        page.evaluate("(l => { const d = getDB(); Object.entries(l).forEach(([id, n]) => { const x = d.find(p => p.id == id); if (x) x.nombre = n; }); })(%s)" % json.dumps(LARGOS))
        page.evaluate("abrirPanelLateral()"); page.wait_for_timeout(700)
        sw, cw = page.evaluate("(() => { const c = document.getElementById('wishlistPanelBody'); return [c.scrollWidth, c.clientWidth]; })()")
        ok(sw <= cw, f'[{nombre}] el carrito no se desborda a lo ancho ({sw} ≤ {cw})')
        dentro = page.evaluate("""(() => { const g = document.querySelector('.wl-grupo').getBoundingClientRect();
            return [...document.querySelectorAll('.wl-item')].every(i => i.getBoundingClientRect().right <= g.right + 0.5); })()""")
        ok(dentro, f'[{nombre}] cada prenda queda dentro de su grupo')
        ok(page.locator('.wl-btn-remove').first.is_visible(), f'[{nombre}] el botón de quitar se ve')
        corta = page.evaluate("(() => { const n = document.querySelector('.wl-item-name'); return n.scrollWidth > n.clientWidth && getComputedStyle(n).textOverflow === 'ellipsis'; })()")
        ok(corta, f'[{nombre}] el nombre largo se corta con "…"')
        ok(not errs, f'[{nombre}] sin errores {errs[:2]}')
        ctx.close()

    # 2 · Lo que ya tenían guardado aparece en su carrito (misma llave)
    ctx = contexto(b, 1100, 900, GUARDADO); page = ctx.new_page(); errs, malos = vigilar(page)
    page.goto(BASE + 'tienda.html', wait_until='networkidle'); page.wait_for_timeout(1200)
    ok(page.evaluate("document.getElementById('wishlistHeaderBtn').getAttribute('aria-label')") == 'Mi carrito', 'encabezado: botón "Mi carrito"')
    ok(page.evaluate("document.getElementById('wishlistCount').textContent") == '2', 'lo guardado antes cuenta en el carrito (2)')
    page.evaluate("abrirPanelLateral()"); page.wait_for_timeout(600)
    ok('Mi carrito' in page.locator('#wishlistPanel h3').inner_text(), 'el panel se llama "Mi carrito"')
    ok('2 prendas en tu carrito' in page.locator('#wishlistPanelBody').inner_text(), 'resumen "2 prendas en tu carrito"')
    ok(page.locator('#wishlistPanel .tp-pagar').count() == 1, 'el carrito tiene botón de pagar en línea')
    ok(page.locator('#wishlistPanel .wl-nota').is_visible() and 'intermediarios' in page.locator('#wishlistPanel .wl-nota').inner_text(), 'nota: el carrito no aparta y los pagos van por intermediarios')
    ok(page.locator('#wishlistPanel #wishlistPanelFooter').count() == 1 and page.locator('#shopSidebar .wl-vaciar').count() == 0, '"Vaciar carrito" está en el panel y ya no bajo los filtros')
    page.evaluate("closeWishlistPanel()"); page.wait_for_timeout(400)
    # Tarjetas: botón de carrito solo en prendas que se pueden comprar
    sin_boton = page.evaluate("""(() => [...document.querySelectorAll('.card')].filter(c => { const p = JSON.parse(c.dataset.product || '{}'); return p.vendido || p.apartada; })
        .every(c => !c.querySelector('.card-fav-btn')))()""")
    ok(sin_boton, 'vendidas y apartadas no tienen botón de carrito')
    btn = page.locator('.card-fav-btn:not(.active)').first
    nombre = json.loads(btn.get_attribute('data-product'))['nombre']
    btn.click(); page.wait_for_timeout(600)
    ok(page.evaluate("document.getElementById('wishlistCount').textContent") == '3', 'tarjeta: agrega al carrito (3)')
    # v37: en lugar del aviso sale la hoja "Agregaste a tu carrito" (como Amazon)
    hoja = page.locator('#caHoja')
    ok(hoja.is_visible() and 'Agregaste a tu carrito' in hoja.inner_text(), f'hoja "Agregaste a tu carrito" ({nombre})')
    ok(page.locator('#caHoja a', has_text='Ver carrito').get_attribute('href') == 'carrito.html', '"Ver carrito" lleva a la página del carrito')
    page.click('#caHoja .ca-seguir'); page.wait_for_timeout(500)
    ok(page.locator('#caHoja').count() == 0, '"Seguir comprando" cierra la hoja')
    ok(not errs and not malos, f'catálogo sin errores ni 404 {errs[:2]} {malos[:3]}')
    ctx.close()

    # 3 · Ficha: "Agregar al carrito" → "En tu carrito" → abre el carrito; quitar lo regresa
    for ancho, alto, nombre in [(1100, 900, 'compu'), (390, 844, 'celular')]:
        ctx = contexto(b, ancho, alto, []); page = ctx.new_page(); errs, malos = vigilar(page)
        page.goto(BASE + 'prenda.html?id=7', wait_until='networkidle'); page.wait_for_timeout(1200)
        btn = page.locator('#ppFav')
        ok(btn.inner_text().strip().lower() == 'agregar al carrito', f'[{nombre}] ficha: botón "Agregar al carrito"')
        btn.scroll_into_view_if_needed(); btn.click(); page.wait_for_timeout(500)
        ok('en tu carrito' in btn.inner_text().lower() and page.evaluate("JSON.parse(localStorage.getItem('bazar_wishlist')).length") == 1, f'[{nombre}] ficha: queda "En tu carrito"')
        page.click('#caHoja .ca-seguir'); page.wait_for_timeout(450)
        btn.click(); page.wait_for_load_state('networkidle'); page.wait_for_timeout(600)
        ok(page.url.endswith('carrito.html'), f'[{nombre}] ficha: segundo toque abre el carrito (no la quita)')
        page.go_back(); page.wait_for_load_state('networkidle'); page.wait_for_timeout(1200)
        page.evaluate("Carrito.quitar(7)"); page.wait_for_timeout(500)
        btn = page.locator('#ppFav')
        ok(btn.inner_text().strip().lower() == 'agregar al carrito', f'[{nombre}] quitar desde el carrito regresa el botón a "Agregar"')
        ok(not errs, f'[{nombre}] ficha sin errores {errs[:2]}')
        ctx.close()

    # 4 · Pagar: carrito vacío y la nota de intermediarios
    ctx = contexto(b, 1100, 900, []); page = ctx.new_page(); errs, malos = vigilar(page)
    page.goto(BASE + 'pagar.html?bazar=1', wait_until='networkidle'); page.wait_for_timeout(1000)
    ok('Tu carrito está vacío' in page.inner_text('body'), 'pagar.html sin prendas: "Tu carrito está vacío"')
    ctx.close()
    ctx = contexto(b, 1100, 900, GUARDADO); page = ctx.new_page(); errs, malos = vigilar(page)
    page.goto(BASE + 'pagar.html?bazar=1', wait_until='networkidle'); page.wait_for_timeout(1500)
    txt = page.inner_text('body')
    ok('intermediarios de pago' in txt and 'procesa este pago como intermediario' in txt, 'pagar.html explica que Clip/PayPal cobran como intermediarios')
    ok(page.locator('a[href="terminos.html#pagos"]').count() >= 1, 'pagar.html enlaza a "Pagos a través de intermediarios"')
    ok(not errs, f'pagar.html sin errores {errs[:2]}')
    ctx.close()

    # 5 · Giro y términos
    ctx = contexto(b, 1100, 900); page = ctx.new_page(); errs, malos = vigilar(page)
    page.goto(BASE + 'terminos.html', wait_until='networkidle'); page.wait_for_timeout(800)
    pagos = page.locator('#pagos').inner_text()
    # v39: Stiimpys vende directo; el cobro lo procesan los intermediarios por cuenta de Stiimpys
    ok(all(x in pagos for x in ['Clip', 'PayPal', 'intermediarios', 'por cuenta de Stiimpys', 'Stiimpys no ve ni guarda']), 'términos: sección 8 "Pagos a través de intermediarios"')
    t = page.inner_text('body')
    ok('tienda en línea' in t and 'solo un catálogo' not in t and 'No existe carrito' not in t, 'términos: el giro dice "tienda en línea" (ya no "solo un catálogo")')
    ok('Cuándo sí se devuelve tu dinero' in t, 'términos: casos en que sí se devuelve el dinero')
    ok(page.locator('.legal-indice a').count() == 15, 'términos: índice con 15 secciones')
    ok(not errs and not malos, f'términos sin errores ni 404 {errs[:2]} {malos[:3]}')
    ctx.close()

    # 6 · Todas las páginas públicas: sin errores, sin 404 y sin restos de "wishlist" / "solo un catálogo"
    for pg in PUBLICAS:
        ctx = contexto(b, 390, 844, GUARDADO); page = ctx.new_page(); errs, malos = vigilar(page)
        page.goto(BASE + pg, wait_until='load', timeout=45000); page.wait_for_timeout(1500)
        try: page.evaluate("window.abrirPanelLateral && abrirPanelLateral()"); page.wait_for_timeout(400)
        except Exception: pass
        texto = page.evaluate("document.body.innerText + ' ' + [...document.querySelectorAll('[aria-label],[title]')].map(e => (e.getAttribute('aria-label') || '') + ' ' + (e.getAttribute('title') || '')).join(' ')")
        restos = sorted(set(m.group(0).lower() for m in re.finditer(r'(?i)\b(wishlist|favoritos|tu bolsa|mi bolsa|solo un catálogo)\b', texto)))
        ok(not errs and not malos and not restos, f'{pg}: sin errores, sin 404 y sin textos viejos {errs[:1]} {malos[:2]} {restos}')
        ctx.close()
    b.close()

pas = sum(1 for r in res if r[0])
print(f'\nRESULTADO v35: {pas} de {len(res)}')
sys.exit(0 if pas == len(res) else 1)
