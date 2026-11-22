# Pruebas v56 en el navegador:
# - Tarjeta del inventario: ya no repite "STIIMPYS" en cada prenda; "Marcar como vendido" a lo ancho y
#   los botones de íconos en una sola fila (compu y celular).
# - Editar: al bajar el precio sale "Mostrarla como rebaja"; si se desmarca, se manda precioAnterior 0.
# - Renombrar una categoría también cambia sus prendas en el panel.
# - Tienda: el WhatsApp del pie sale de los datos de la tienda en todas las páginas.
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v56-navegador.py
import json, re
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8766/'
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)
def errores(page):
    e = []; page.on('pageerror', lambda x: e.append(str(x)[:160]) if 'ViewTransition' not in str(x) else None); return e

with sync_playwright() as p:
    b = p.chromium.launch()
    for ancho, alto, movil in [(1440, 900, False), (390, 844, True)]:
        tag = 'celular' if movil else 'compu'
        ctx = b.new_context(viewport={'width': ancho, 'height': alto}, is_mobile=movil, has_touch=movil)
        ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
        ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
        page = ctx.new_page(); e = errores(page)
        page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(3000)
        page.evaluate("() => { if (typeof invBazarFiltro !== 'undefined') invBazarFiltro = 'todos'; showTab('inventario'); renderAll(); }"); page.wait_for_timeout(800)
        pid = page.evaluate("() => (getDB().find(x => !x.vendido && Number(x.bazarId || 1) === 1) || {}).id")
        card = page.locator(f'#card-{pid}')
        card.scroll_into_view_if_needed()
        ok(card.locator('.inv-card-bazar').count() == 0, f'{tag}: la tarjeta ya no dice "STIIMPYS" (una sola tienda)')
        acts = card.locator('.item-actions > *')
        cajas = [acts.nth(i).bounding_box() for i in range(acts.count())]
        sell = card.locator('.item-actions > .act-btn.sell').bounding_box()
        fila = card.locator('.item-actions').bounding_box()
        iconos = [c for c in cajas if c and abs(c['y'] - sell['y']) > 5]
        ok(sell and abs(sell['width'] - fila['width']) < 3, f'{tag}: "Marcar como vendido" a todo lo ancho')
        ok(len(iconos) >= 4 and len({round(c['y']) for c in iconos}) == 1, f'{tag}: los {len(iconos)} botones de íconos en una sola fila (antes "borrar" quedaba solo)')
        ok(max(c['width'] for c in iconos) - min(c['width'] for c in iconos) < 2, f'{tag}: del mismo ancho')
        ok(card.locator('.act-btn.ap svg').count() == 1, f'{tag}: el botón de apartar usa ícono de línea (sin emoji)')
        page.screenshot(path=f'/tmp/v56_card_{tag}.png', clip={**card.bounding_box()})

        if not movil:
            # ── Editar: rebaja o corrección
            enviado = {}
            def ver(route):
                if route.request.method == 'PATCH': enviado.update(json.loads(route.request.post_data or '{}'))
                route.continue_()
            page.route(re.compile(r'.*/api/inventario-item\?id=.*'), ver)
            precio = page.evaluate(f"() => getDB().find(x => x.id === {pid}).precio_venta")
            page.evaluate(f"() => re_editar_prenda({pid})"); page.wait_for_timeout(500)
            ok(page.locator('#re_rebajaWrap').is_hidden(), 'editar: sin bajar el precio no sale la opción de rebaja')
            page.fill('#re_precio', str(int(precio) - 50)); page.wait_for_timeout(100)
            ok(page.locator('#re_rebajaWrap').is_visible() and page.locator('#re_rebaja').is_checked(), 'al bajar el precio: "Mostrarla como rebaja" (marcada)')
            page.locator('#re_rebaja').uncheck()
            page.evaluate("() => guardarReEdicion()"); page.wait_for_timeout(1500)
            ok(enviado.get('precioAnterior') == 0 and enviado.get('precio_venta') == int(precio) - 50, f'si es corrección, se manda sin tachado ({enviado.get("precioAnterior")})')
            enviado.clear()
            page.evaluate(f"() => re_editar_prenda({pid})"); page.wait_for_timeout(500)
            page.fill('#re_precio', str(int(precio) - 80))
            page.evaluate("() => guardarReEdicion()"); page.wait_for_timeout(1500)
            ok('precioAnterior' not in enviado and page.evaluate(f"() => Number(getDB().find(x => x.id === {pid}).precioAnterior)") == int(precio) - 50, 'si es rebaja: el panel tacha el precio anterior al momento')
            page.unroute(re.compile(r'.*/api/inventario-item\?id=.*'))
            # ── Renombrar categoría
            cat = page.evaluate("() => { const usadas = getDB().flatMap(p => p.categorias || []); return getCats().find(c => usadas.includes(c.nombre)) || null; }")
            if cat:
                antes = page.evaluate(f"() => getDB().filter(p => (p.categorias || []).includes({json.dumps(cat['nombre'])})).length")
                page.evaluate("() => { window.uiPrompt = async () => 'Categoría renombrada v56'; }")
                page.evaluate(f"() => editCat({cat['id']}, {json.dumps(cat['nombre'])})"); page.wait_for_timeout(1500)
                despues = page.evaluate("() => getDB().filter(p => (p.categorias || []).includes('Categoría renombrada v56')).length")
                ok(antes > 0 and despues == antes, f'renombrar "{cat["nombre"]}": sus {antes} prendas cambian también')
                ok('También se cambió en' in ' '.join(page.locator('.stmp-aviso').all_inner_texts()), 'el aviso dice cuántas prendas se cambiaron')
                page.evaluate(f"() => {{ window.uiPrompt = async () => {json.dumps(cat['nombre'])}; return editCat({cat['id']}, 'Categoría renombrada v56'); }}"); page.wait_for_timeout(1200)
            else:
                ok(False, 'hay una categoría en uso para probar')
        ok(not e, f'{tag}: panel sin errores ({e[:2]})')
        ctx.close()

    # ── Tienda: WhatsApp del pie en todas las páginas
    page = b.new_page(); e = errores(page)
    for pag in ['tienda.html', 'carrito.html', 'terminos.html']:
        page.goto(BASE + pag, wait_until='load'); page.wait_for_timeout(2200)
        wa = page.evaluate("() => { const b = getBazares().find(x => Number(x.id) === Number(getModo()?.principal || 1)) || getBazares()[0]; return String(b?.whatsapp || '').replace(/\\D/g, ''); }")
        href = page.locator('#waFooter').get_attribute('href') or ''
        esperado = ('52' + wa) if len(wa) == 10 else wa
        ok(wa and href.startswith(f'https://wa.me/{esperado}?'), f'{pag}: el WhatsApp del pie es el de la tienda ({href[:40]})')
    ok(page.evaluate("() => FormasPago.alternativas()") == 'efectivo o transferencia', 'tienda: "¿Prefieres efectivo o transferencia?" sale de lo marcado')
    ok(not e, f'tienda sin errores ({e[:2]})')
    b.close()

n = sum(1 for c, _ in res if c)
print(f'\nRESULTADO: {n} de {len(res)} pruebas pasaron')
