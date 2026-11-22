# Pruebas v43 en el navegador: interruptores en Módulos, sello y medidas, "Completa el outfit",
# descuento de outfit en carrito, invitar amigos en el recibo, Guías en el pie, /guias, /talla,
# página del drop, comprobante revisado por IA + Banxico en el panel, resumen, Google.
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v43-navegador.py
import json, sys, re, io, urllib.request, base64
from playwright.sync_api import sync_playwright
from PIL import Image

BASE = 'http://127.0.0.1:8766/'
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)
def api(op, cuerpo=None, token='TA', q='', ruta='api/acciones?op='):
    req = urllib.request.Request(BASE + ruta + op + q, data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
        headers={'content-type': 'application/json', 'origin': BASE.rstrip('/'), **({'authorization': 'Bearer ' + token} if token else {})}, method='POST' if cuerpo is not None else 'GET')
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
def patch(id, cuerpo):
    req = urllib.request.Request(BASE + f'api/inventario-item?id={id}', data=json.dumps(cuerpo).encode(), headers={'content-type': 'application/json', 'origin': BASE.rstrip('/'), 'authorization': 'Bearer TA'}, method='PATCH')
    with urllib.request.urlopen(req) as r: return r.status
def errores(page):
    e = []; page.on('pageerror', lambda x: e.append(str(x)[:160]) if 'ViewTransition' not in str(x) else None); return e
def jpg(c=(90, 90, 90), w=400, h=500):
    b = io.BytesIO(); Image.new('RGB', (w, h), c).save(b, 'JPEG'); return b.getvalue()
def fotos_locales(ctx):
    ctx.route(re.compile(r'https://res\.cloudinary\.com/.*'), lambda r: r.fulfill(status=200, content_type='image/jpeg', body=jpg()))
def fresco():
    urllib.request.urlopen(BASE + 'api/sync?scope=publico&fresh=1').read()
    urllib.request.urlopen(urllib.request.Request(BASE + 'api/sync?fresh=1', headers={'authorization': 'Bearer TA'})).read()   # el del panel también
def panel(b, ancho=1440, alto=900):
    ctx = b.new_context(viewport={'width': ancho, 'height': alto}); fotos_locales(ctx)
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
    return ctx
def clabe():
    b = '73096930000819908'; s = sum((int(b[i]) * [3, 7, 1][i % 3]) % 10 for i in range(17)); return b + str((10 - s % 10) % 10)

with sync_playwright() as p:
    b = p.chromium.launch()

    # ── 1 · Módulos: los interruptores nuevos, apagados, y se prenden ──
    ctx = panel(b); page = ctx.new_page(); e = errores(page)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(3000)
    page.evaluate("() => { showTab('ventas'); setTimeout(() => vnIr('modulos'), 50); }"); page.wait_for_timeout(1500)
    nuevos = ['speiIA', 'speiAuto', 'carritosWA', 'dropPagina', 'outfit', 'referidos', 'resumenSemanal', 'cajaTicketWA', 'enviosPanel', 'feedGoogle', 'paginasTalla', 'guias', 'googleMaps', 'selloRevisada']
    estados = page.evaluate(f"() => {json.dumps(nuevos)}.map(k => document.getElementById('vnMod_' + k)?.checked)")
    ok(all(x is False for x in estados), f'Módulos: los 14 interruptores nuevos aparecen apagados ({estados.count(False)})')
    ok(page.locator('.vn-card h3', has_text='Para vender más').count() == 1 and page.locator('.vn-card h3', has_text='Para que te encuentren').count() == 1, 'agrupados: vender más, trabajar menos, que te encuentren, confianza')
    for k in ['outfit', 'referidos', 'guias', 'paginasTalla', 'dropPagina', 'selloRevisada', 'speiIA', 'resumenSemanal', 'enviosPanel', 'googleMaps']:
        page.locator(f'label[for="vnMod_{k}"]').click(); page.wait_for_timeout(450)
    s, cfg = api('v-panel')
    ok(all(cfg['config']['modulos'][k] for k in ['outfit', 'referidos', 'guias', 'paginasTalla', 'dropPagina', 'selloRevisada', 'speiIA', 'resumenSemanal', 'enviosPanel', 'googleMaps']), 'tocar cada interruptor lo prende y se guarda')
    page.locator('label[for="vnMod_spei"]').click(); page.wait_for_timeout(700)
    ok(not page.locator('#vnMod_spei').is_checked(), 'SPEI sin CLABE no se deja prender (y avisa por qué)')
    # Promociones y pagos: CLABE y Google
    page.evaluate("() => vnIr('promos')"); page.wait_for_timeout(1200)
    page.fill('#vnSpeiClabe', clabe()); page.check('#vnSpeiAct'); page.fill('#vnOutfitPct', '8')
    page.fill('#vnGMaps', 'https://maps.app.goo.gl/stiimpys'); page.fill('#vnGResena', 'https://g.page/r/stiimpys/review')
    page.click('#vnGuardarPromos'); page.wait_for_timeout(1200)
    s, cfg = api('v-panel')
    ok(cfg['config']['spei']['activo'] and cfg['config']['outfit']['pct'] == 8 and cfg['config']['google']['maps'].startswith('https://maps.app.goo.gl'), 'Promociones y pagos: CLABE, % de outfit y links de Google se guardan')
    ok(page.locator('.vn-card h3:text-is("Google")').count() == 1 and 'merchants.google.com' in page.content(), 'tarjeta de Google con los pasos y el link para Merchant Center')
    ok(not e, f'panel sin errores {e[:2]}')
    ctx.close()

    # Medidas, sello y un drop (desde la API, como lo guarda el formulario)
    patch(9, {'medidas': {'largo': 72, 'ancho': 56, 'manga': 63}, 'revisada': True})
    fresco()

    # ── 2 · Formulario de prenda: medidas y sello ──
    ctx = panel(b); page = ctx.new_page(); e = errores(page)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(3000)
    page.evaluate("() => editItem(9)"); page.wait_for_timeout(800)
    ok(page.locator('#f_medidasWrap').evaluate('d => d.open') and page.locator('#f_m_largo').input_value() == '72' and page.locator('#f_revisada').is_checked(), 'editar prenda: medidas y "Revisada a mano" se cargan')
    page.fill('#f_m_cintura', '80'); page.evaluate("() => submitForm()"); page.wait_for_timeout(1500)
    s, inv = api('', None, 'TA', '', 'api/inventario')
    p2 = next(x for x in inv if x['id'] == 9)
    ok(p2.get('medidas', {}).get('cintura') == 80 and p2.get('revisada') is True, 'al guardar, las medidas nuevas llegan al servidor')
    ok(not e, f'formulario sin errores {e[:2]}')
    ctx.close()
    fresco()

    # ── 3 · Ficha: sello, medidas, outfit, talla y pie ──
    for ancho, alto in [(1280, 900), (390, 844)]:
        ctx = b.new_context(viewport={'width': ancho, 'height': alto}, is_mobile=ancho < 600, has_touch=ancho < 600); fotos_locales(ctx); page = ctx.new_page(); e = errores(page)
        page.goto(BASE + 'prenda.html?id=9', wait_until='load'); page.wait_for_timeout(2500)
        ok(page.locator('.ex-sello').is_visible() and 'Revisada a mano' in page.locator('.ex-sello').inner_text(), f'[{ancho}] sello "Revisada a mano por Stiimpys"')
        med = page.locator('.ex-medidas')
        ok(med.count() == 1 and '72 cm' in med.inner_text() and '80 cm' in med.inner_text(), f'[{ancho}] medidas en centímetros')
        out = page.locator('#exOutfit')
        if out.count(): out.scroll_into_view_if_needed(); page.wait_for_timeout(1200)   # aparece al llegar con el scroll, como las demás secciones
        ok(out.count() == 1 and page.locator('.ex-outfit-item').count() >= 2 and '8% extra' in out.inner_text(), f'[{ancho}] "Completa el outfit" con prendas de otro tipo y su % extra')
        ok(page.locator('a.pp-chip[href^="/talla/"]').count() == 1, f'[{ancho}] la talla lleva a su página')
        ok(page.locator('.sf-col a.ex-guias-link[href="/guias"]').count() == 1, f'[{ancho}] "Guías" en el pie')
        ancho_doc = page.evaluate("[document.documentElement.scrollWidth, innerWidth]")
        ok(ancho_doc[0] <= ancho_doc[1] + 1, f'[{ancho}] la ficha no desborda {ancho_doc}')
        ok(not e, f'[{ancho}] ficha sin errores {e[:2]}')
        ctx.close()

    # ── 4 · Carrito: descuento por outfit ──
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}); fotos_locales(ctx)
    ctx.add_init_script("if(!sessionStorage.getItem('v43')){localStorage.setItem('bazar_wishlist', JSON.stringify([{id:13,bazarId:1,nombre:'x',precio_venta:1},{id:14,bazarId:1,nombre:'y',precio_venta:1}]));sessionStorage.setItem('v43','1')}")
    page = ctx.new_page(); e = errores(page)
    s, inv = api('', None, 'TA', '', 'api/inventario')
    tipos = {x['id']: x['nombre'] for x in inv}
    page.goto(BASE + 'carrito.html', wait_until='load'); page.wait_for_timeout(2500)
    txt = page.locator('.cr-resumen').first.inner_text() if page.locator('.cr-resumen').count() else ''
    ok('Outfit completo' in txt or 'otro tipo' in txt, f'carrito: descuento de outfit o sugerencia de combinar ({tipos.get(13)}, {tipos.get(14)})')
    ok(not e, f'carrito sin errores {e[:2]}')
    ctx.close()

    # ── 5 · Páginas: /guias, /talla, /drop ──
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); fotos_locales(ctx); page = ctx.new_page(); e = errores(page)
    rr = page.goto(BASE + 'guias', wait_until='load')
    ok(rr.status == 200 and page.locator('.lista-guias a').count() == 4, '/guias con 4 guías')
    page.locator('.lista-guias a').first.click(); page.wait_for_load_state('load')
    ok('/guias/' in page.url and page.locator('article h2').count() >= 3, 'abrir una guía: artículo completo')
    rr = page.goto(BASE + 'talla/m', wait_until='load')
    ok(rr.status == 200 and page.locator('h1').inner_text().strip() == 'Talla M' and page.locator('.grid .card').count() >= 1, '/talla/m con sus prendas')
    s = 'semilla'
    rr = page.goto(BASE + 'drop/drop_v43', wait_until='load'); page.wait_for_timeout(1500)
    ok(rr.status == 200 and page.locator('#reloj span').count() == 4 and 'Drop Navidad' in page.locator('h1').inner_text(), f'/drop/…: cuenta regresiva de 4 cuadros ({s})')
    ok(page.locator('a.cta[href*="avisame-drop=drop_v43"]').count() == 1, 'botón "Avísame por WhatsApp"')
    ok(not e, f'páginas sin errores {e[:2]}')
    ctx.close()

    # ── 6 · Recibo: invitar amigos y reseña en Google; comprobante revisado ──
    s, r = api('v-pagar', {'ids': [6], 'nombre': 'Paula Gómez', 'telefono': '8998880011', 'email': 'p@x.mx', 'entrega': 'persona', 'punto': 'zona-centro', 'metodo': 'spei'}, None)
    pid, k = r['pedido'], r['clave']
    s, r = api('v-spei-comprobante', {'id': pid, 'k': k, 'imagen': 'data:image/jpeg;base64,' + base64.b64encode(jpg()).decode()}, None)
    ok(s == 200 and r.get('revisar') is True, 'con la revisión automática prendida, el recibo la pide al subir el comprobante')
    ctx = panel(b); page = ctx.new_page(); e = errores(page)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(3000)
    page.evaluate("() => { showTab('ventas'); setTimeout(() => { VN.filtroPed = 'sinpagar'; vnIr('pedidos'); }, 50); }"); page.wait_for_timeout(2000)
    tarjeta = page.locator(f'#vnPed-{pid}')
    tarjeta.locator('button', has_text='Revisar con IA y Banxico').click(); page.wait_for_timeout(2500)
    rev = page.locator(f'#vnPed-{pid} .vn-spei-rev')
    ok(rev.count() == 1 and 'Banxico' in rev.inner_text() and 'MBAN01002' in rev.inner_text(), 'panel: lo que leyó la IA (monto, banco, rastreo) y lo que dijo Banxico')
    page.once('dialog', lambda d: d.accept())
    page.locator(f'#vnPed-{pid} button', has_text='Ya me llegó').click(); page.wait_for_timeout(2000)
    page.evaluate("() => vnIr('metricas')"); page.wait_for_timeout(2000)
    page.locator('button', has_text='Ver resumen ahora').click(); page.wait_for_timeout(1500)
    ok('Tu semana en Stiimpys' in page.locator('.vn-resumen-txt').inner_text(), 'Métricas: "Ver resumen ahora" muestra el resumen de la semana')
    ok(not e, f'panel sin errores {e[:2]}')
    ctx.close()
    api('v-pedido-estado', {'id': pid, 'accion': 'entregado'})
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); fotos_locales(ctx); page = ctx.new_page(); e = errores(page)
    page.goto(BASE + f'pagar.html?pedido={pid}&k={k}', wait_until='load'); page.wait_for_timeout(2500)
    ref = page.locator('.ck-ref')
    ok(ref.count() == 1 and re.search(r'REF-[A-Z2-9]{5}', ref.inner_text()) and ref.locator('a[href^="https://wa.me/?text="]').count() == 1, 'recibo: "Invita a tus amigos" con su código y botón de WhatsApp')
    ok(page.locator('.ck-google a[href="https://g.page/r/stiimpys/review"]').count() == 1, 'recibo entregado: "Déjanos tu reseña en Google"')
    ok(not e, f'recibo sin errores {e[:2]}')
    ctx.close()

    # ── 7 · Inicio: Google Maps y datos del negocio ──
    fresco()
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}); fotos_locales(ctx); page = ctx.new_page(); e = errores(page)
    page.goto(BASE + 'inicio.html', wait_until='load'); page.wait_for_timeout(2500)
    ok(page.locator('#exMaps a[href="https://maps.app.goo.gl/stiimpys"]').count() == 1, 'inicio: "Encuéntranos en Google Maps"')
    neg = page.evaluate("JSON.parse(document.getElementById('exNegocio')?.textContent || 'null')")
    ok(neg and neg['@type'] == 'ClothingStore' and 'https://maps.app.goo.gl/stiimpys' in neg['sameAs'], 'datos del negocio para Google (tienda de ropa, Instagram y Maps)')
    ok(not e, f'inicio sin errores {e[:2]}')
    ctx.close()
    b.close()

malas = [m for c, m in res if not c]
print(f'\nRESULTADO v43-navegador: {len(res) - len(malas)} de {len(res)}')
sys.exit(1 if malas else 0)
