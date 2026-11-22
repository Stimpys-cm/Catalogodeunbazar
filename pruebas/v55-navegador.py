# Pruebas v55 en el navegador: formas de pago y Instagram conectados con la tienda y el panel.
# - Tienda: "Aceptamos tarjeta, efectivo y transferencia" en el inicio, la ficha, el carrito y el pie (compu y celular).
# - Si en Ventas → Promociones y pagos se quita una, desaparece de la tienda.
# - Ficha: link "Ver esta prenda en Instagram" cuando tiene post.
# - Panel: tarjeta "Formas de pago que aceptas"; Instagram → Ajustes con "Avisar cambios en el post" y la línea de pagos
#   en la vista previa; aviso al editar una prenda que ya está en Instagram, con "Copiar texto nuevo".
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v55-navegador.py
import json, re
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8766/'
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)
def errores(page):
    e = []; page.on('pageerror', lambda x: e.append(str(x)[:160]) if 'ViewTransition' not in str(x) else None); return e
def sin_desborde(page):
    return page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
def items(page, sel):
    return page.locator(sel + ' .fp-item b').all_inner_texts()

with sync_playwright() as p:
    b = p.chromium.launch()
    PID = None
    for ancho, alto, movil in [(1440, 900, False), (390, 844, True)]:
        tag = 'celular' if movil else 'compu'
        ctx = b.new_context(viewport={'width': ancho, 'height': alto}, is_mobile=movil, has_touch=movil)
        page = ctx.new_page(); e = errores(page)
        page.goto(BASE + 'inicio.html', wait_until='load'); page.wait_for_timeout(2200)
        ok(items(page, '[data-formas-pago="hero"]') == ['Tarjeta', 'Efectivo', 'Transferencia'], f'{tag}: inicio → "Aceptamos tarjeta, efectivo, transferencia" debajo de los botones')
        ok(page.locator('[data-formas-pago="hero"] .fp-ico svg').count() == 3 and not re.search('[\U0001F300-\U0001FAFF]', page.locator('[data-formas-pago="hero"]').inner_text()), f'{tag}: con íconos de línea, sin emojis')
        pie = page.locator('.site-footer [data-formas-pago="pie"]'); pie.scroll_into_view_if_needed(); page.wait_for_timeout(300)
        ok(items(page, '.site-footer [data-formas-pago="pie"]') == ['Tarjeta', 'Efectivo', 'Transferencia'] and 'Al entregar en persona' in pie.inner_text(), f'{tag}: pie de página con las tres y su detalle')
        ok(sin_desborde(page), f'{tag}: el inicio no se sale de la pantalla')
        caja = lambda sel: page.locator(sel).first.bounding_box()
        ok(caja('[data-formas-pago="hero"] .fp')['y'] > caja('.h-cta-row')['y'] and caja('[data-formas-pago="hero"] .fp')['y'] > caja('#heroTitulo')['y'], f'{tag}: va debajo del título y de los botones')
        if movil: page.locator('[data-formas-pago="hero"]').scroll_into_view_if_needed(); page.screenshot(path='/tmp/v55_hero_celular.png')
        if PID is None: PID = page.evaluate("() => (getDB().find(x => !x.vendido && !x.apartada && !x.oculto) || {}).id")
        # Ficha: la prenda con su post de Instagram (se agrega al sync que recibe esta página)
        def con_ig(route):
            r = route.fetch(); d = r.json()
            for x in d.get('inventario', []):
                if x.get('id') == PID: x['instagramUrl'] = 'https://www.instagram.com/p/ABC123/'
            route.fulfill(response=r, body=json.dumps(d), headers={**r.headers, 'content-type': 'application/json', 'etag': '"v55"'})
        page.route(re.compile(r'.*/api/sync\?.*'), con_ig)
        page.goto(BASE + f'prenda.html?id={PID}', wait_until='load'); page.wait_for_timeout(2500)
        ok(items(page, '.fp-ficha') == ['Tarjeta', 'Efectivo', 'Transferencia'], f'{tag}: ficha de la prenda con las formas de pago')
        lnk = page.locator('a.tp-ig')
        ok(lnk.count() == 1 and lnk.get_attribute('href') == 'https://www.instagram.com/p/ABC123/' and 'Ver esta prenda en Instagram' in lnk.inner_text(), f'{tag}: ficha con link a su post de Instagram')
        ok(sin_desborde(page), f'{tag}: la ficha no se sale de la pantalla')
        if movil: page.locator('.fp-ficha').scroll_into_view_if_needed(); page.screenshot(path='/tmp/v55_ficha_celular.png')
        page.unroute(re.compile(r'.*/api/sync\?.*'))
        # Carrito
        page2 = ctx.new_page()
        prenda_json = page.evaluate(f"() => JSON.stringify([getDB().find(x => x.id === {PID})])")
        page2.add_init_script(f"if(!sessionStorage.getItem('v55')){{localStorage.setItem('bazar_wishlist', {json.dumps(prenda_json)});sessionStorage.setItem('v55','1')}}")
        page.close(); page = page2; page.on('pageerror', lambda x: e.append(str(x)[:160]) if 'ViewTransition' not in str(x) else None)
        page.goto(BASE + 'carrito.html', wait_until='load'); page.wait_for_timeout(2500)
        ok(items(page, '.cr-resumen .fp-carrito') == ['Tarjeta', 'Efectivo', 'Transferencia'], f'{tag}: el resumen del carrito dice qué formas de pago aceptan')
        ok(sin_desborde(page), f'{tag}: el carrito no se sale de la pantalla')
        ok(not e, f'{tag}: sin errores en la tienda ({e[:2]})')
        ctx.close()

    # ── Panel: Promociones y pagos → la tienda cambia
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
    page = ctx.new_page(); e = errores(page)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(2500)
    page.evaluate("() => { showTab('ventas'); }"); page.wait_for_timeout(800)
    page.evaluate("() => vnIr('promos')"); page.wait_for_function("() => document.getElementById('vnFormasCard')", timeout=10000)
    card = page.locator('#vnFormasCard')
    ok(card.locator('input[type=checkbox]:checked').count() == 3 and 'formas de pago que aceptas' in card.inner_text().lower(), 'panel: "Formas de pago que aceptas" con las tres marcadas')
    ok('Instagram' in card.inner_text() and 'tienda' in card.inner_text(), 'panel: explica que es lo mismo para la tienda e Instagram')
    page.locator('#vnFP_transferencia').uncheck()
    page.evaluate("() => vnGuardarPromos()"); page.wait_for_timeout(6500)   # caché de la tienda: máx. 5 s (en este servidor de prueba no se limpia al guardar)
    tienda = b.new_context(viewport={'width': 1440, 'height': 900}).new_page()
    tienda.goto(BASE + 'inicio.html', wait_until='load'); tienda.wait_for_timeout(2500)
    tienda.locator('.site-footer [data-formas-pago="pie"]').scroll_into_view_if_needed(); tienda.wait_for_timeout(300)
    ok(items(tienda, '[data-formas-pago="hero"]') == ['Tarjeta', 'Efectivo'] and items(tienda, '.site-footer [data-formas-pago="pie"]') == ['Tarjeta', 'Efectivo'], 'al quitar "Transferencia" en el panel, la tienda deja de anunciarla')
    page.evaluate("() => vnIr('promos')"); page.wait_for_timeout(600)
    page.locator('#vnFP_transferencia').check(); page.evaluate("() => vnGuardarPromos()"); page.wait_for_timeout(6500)
    tienda.reload(wait_until='load'); tienda.wait_for_timeout(2500)
    ok(items(tienda, '[data-formas-pago="hero"]') == ['Tarjeta', 'Efectivo', 'Transferencia'], 'y al volver a marcarla, regresa')

    # ── Instagram → Ajustes (Instagram simulado)
    CFG = {'plantilla': True, 'firma': 'Envíos a todo México', 'hashtags': '#bazar #reynosa', 'hashtagsInteligentes': True, 'estiloTexto': 'limpio', 'textoCorto': True, 'maxHashtags': 5, 'avisarCambios': True, 'automatico': {}, 'respuestasRapidas': []}
    def ig_falso(route):
        o = re.search(r'op=([\w-]+)', route.request.url).group(1)
        if o == 'ig-estado': return route.fulfill(status=200, content_type='application/json', body=json.dumps({'bazarId': 1, 'conectado': True, 'config': CFG, 'defaults': CFG, 'pagos': 'Aceptamos tarjeta, efectivo y transferencia', 'perfil': {'username': 'stiimpys'}, 'token': {}}))
        return route.fulfill(status=200, content_type='application/json', body=json.dumps({'posts': []}))
    page.route(re.compile(r'.*/api/acciones\?op=ig-.*'), ig_falso)
    page.evaluate(f"() => {{ const x = getDB().find(p => p.id === {PID}); x.descripcion = 'Sudadera gris.'; }}")
    page.evaluate("() => showTab('instagram')"); page.wait_for_function("() => IG.estado?.conectado", timeout=8000)
    page.evaluate("() => igVista('ajustes')"); page.wait_for_timeout(400)
    ok(page.locator('#igCfg_avisarCambios').is_checked(), 'Instagram → Ajustes: "Avisar cambios en el post" prendido')
    nota = page.locator('.igx-nota:has-text("Formas de pago")').inner_text()
    ok('Aceptamos tarjeta, efectivo y transferencia' in nota and 'Promociones y pagos' in nota, 'dice qué formas de pago se publican y dónde se cambian')
    prev = page.locator('.igx-cap-muestra').inner_text()
    ok('Envíos a todo México\nAceptamos tarjeta, efectivo y transferencia\nDisponible en stiimpys.store/p/' in prev, 'la vista previa del post incluye la línea de formas de pago')
    page.evaluate(f"() => {{ IG.tipo = 'post'; igVista('crear'); igUsarPrenda({PID}); }}"); page.wait_for_timeout(300)
    ok('Aceptamos tarjeta, efectivo y transferencia' in page.evaluate("() => IG.caption"), 'Crear post: el texto también la trae')

    # ── Aviso al editar una prenda que ya está en Instagram
    page.evaluate("() => { navigator.clipboard.writeText = async t => { window.__copiado = t; }; }")
    page.evaluate(f"() => avisoInstagramDesactualizado(getDB().find(p => p.id === {PID}), {{ textoViejo: true, campos: ['precio'], precioComentado: true }})")
    page.wait_for_timeout(500)
    av = page.locator('.stmp-aviso:has-text("Instagram")').last
    ok(av.count() == 1 and 'se comentó el precio nuevo' in av.inner_text(), 'al cambiar el precio: "Instagram: se comentó el precio nuevo en su post"')
    btn = av.locator('button:has-text("Copiar texto nuevo")')
    ok(btn.count() == 1, 'el aviso trae "Copiar texto nuevo"')
    if btn.count():
        btn.click(); page.wait_for_timeout(500)
        cop = page.evaluate("() => window.__copiado || ''")
        ok('Precio:' in cop and 'Aceptamos tarjeta, efectivo y transferencia' in cop, 'copia el texto actual del post (con precio y formas de pago)')
    page.evaluate(f"() => avisoInstagramDesactualizado(getDB().find(p => p.id === {PID}), {{ textoViejo: true, campos: ['nombre', 'talla'] }})")
    page.wait_for_timeout(400)
    ok('Cambiaste el nombre y la talla' in page.locator('.stmp-aviso').last.inner_text(), 'al cambiar nombre y talla: avisa que el texto del post ya no coincide')
    ok(not e, f'panel sin errores ({e[:2]})')
    b.close()

n = sum(1 for c, _ in res if c)
print(f'\nRESULTADO: {n} de {len(res)} pruebas pasaron')
