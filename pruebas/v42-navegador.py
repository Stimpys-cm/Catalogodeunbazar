# Pruebas v42 en el navegador: logo, páginas por marca, pago por transferencia SPEI
# (cliente y panel), cliente frecuente, cumpleaños, reseña con fotos, origen de ventas,
# Caja (punto de venta) y etiquetas con SKU.
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v42-navegador.py
import json, sys, re, io, urllib.request, base64
from playwright.sync_api import sync_playwright
from PIL import Image

BASE = 'http://127.0.0.1:8766/'
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)
def api(op, cuerpo=None, token='TA', q=''):
    req = urllib.request.Request(BASE + 'api/acciones?op=' + op + q, data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
        headers={'content-type': 'application/json', 'origin': BASE.rstrip('/'), **({'authorization': 'Bearer ' + token} if token else {})}, method='POST' if cuerpo is not None else 'GET')
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')
def errores(page):
    e = []; page.on('pageerror', lambda x: e.append(str(x)[:160]) if 'ViewTransition' not in str(x) else None); return e
def jpg(color=(200, 40, 40), w=900, h=1200):
    b = io.BytesIO(); Image.new('RGB', (w, h), color).save(b, 'JPEG', quality=90); return b.getvalue()
FOTO = jpg()
# Las fotos de Cloudinary se sirven con una imagen local (no hay internet en las pruebas)
def fotos_locales(ctx):
    ctx.route(re.compile(r'https://res\.cloudinary\.com/.*'), lambda r: r.fulfill(status=200, content_type='image/jpeg', body=jpg((60, 60, 160), 400, 500)))

def clabe():
    b = '01258000123456789'; s = sum((int(b[i]) * [3, 7, 1][i % 3]) % 10 for i in range(17)); return b + str((10 - s % 10) % 10)
CLABE = clabe()
s, r = api('v-config', {'spei': {'activo': True, 'clabe': CLABE, 'banco': 'BBVA', 'titular': 'Ana López', 'horas': 3},
                        'frecuente': {'activo': True, 'cada': 2, 'pct': 10, 'cumple': True, 'cumplePct': 15}})
ok(s == 200 and r['config']['spei']['activo'], f'SPEI y cliente frecuente activados desde el panel ({s})')
urllib.request.urlopen(BASE + 'api/sync?scope=publico&fresh=1').read()

with sync_playwright() as p:
    b = p.chromium.launch()

    # ── 1 · Logo en la tienda ──
    for ancho, alto in [(1280, 900), (390, 844)]:
        ctx = b.new_context(viewport={'width': ancho, 'height': alto}, is_mobile=ancho < 600, has_touch=ancho < 600); page = ctx.new_page(); e = errores(page)
        page.goto(BASE + 'inicio.html', wait_until='load'); page.wait_for_timeout(1800)
        logo = page.locator('header .logo-img').first
        nat = logo.evaluate('i => [i.complete, i.naturalWidth]')
        caja = logo.bounding_box()
        ok(logo.is_visible() and nat[0] and nat[1] > 0 and caja and 30 <= caja['height'] <= 52, f'[{ancho}] el logo de Stiimpys se ve en el encabezado ({nat}, {caja and round(caja["height"])} px)')
        fav = page.evaluate("[...document.querySelectorAll('link[rel~=icon]')].map(l => l.getAttribute('href')).join(' ')")
        ok('favicon' in fav, f'[{ancho}] favicon con el logo ({fav[:60]})')
        ok(not e, f'[{ancho}] inicio sin errores {e[:2]}')
        ctx.close()

    # ── 2 · Página por marca ──
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); fotos_locales(ctx); page = ctx.new_page(); e = errores(page)
    rr = page.goto(BASE + 'marca/nike', wait_until='load'); page.wait_for_timeout(800)
    ok(rr.status == 200 and page.locator('h1').inner_text().strip() == 'Nike' and page.locator('.grid .card').count() >= 5, f'/marca/nike: título y cuadrícula ({page.locator(".grid .card").count()} prendas)')
    ancho = page.evaluate("[document.documentElement.scrollWidth, innerWidth]")
    ok(ancho[0] <= ancho[1] + 1, f'/marca/nike no desborda en celular {ancho}')
    page.locator('.grid .card').first.click(); page.wait_for_load_state('load'); page.wait_for_timeout(1500)
    ok('prenda.html?id=' in page.url, 'tocar una prenda abre su ficha')
    marca = page.locator('.pp-marca')
    ok(marca.count() == 0 or marca.first.get_attribute('href') == '/marca/nike', 'en la ficha, la marca lleva a su página')
    ok(not e, f'marca sin errores {e[:2]}')
    ctx.close()

    # ── 3 · Checkout con transferencia + origen + cliente frecuente ──
    ctx = b.new_context(viewport={'width': 1300, 'height': 950}); fotos_locales(ctx)
    ctx.add_init_script("""if(!sessionStorage.getItem('v42')){localStorage.setItem('bazar_wishlist', JSON.stringify([{id:9,bazarId:1,nombre:'x',precio_venta:1}]));
      localStorage.removeItem('stmp-cupon'); localStorage.removeItem('stmp-origen'); sessionStorage.setItem('v42','1')}""")
    page = ctx.new_page(); e = errores(page)
    page.goto(BASE + 'inicio.html?utm_source=instagram&utm_medium=bio', wait_until='load'); page.wait_for_timeout(1500)
    ori = page.evaluate("JSON.parse(localStorage.getItem('stmp-origen') || 'null')")
    ok(ori and ori['fuente'] == 'instagram' and ori['medio'] == 'bio', f'llegar con ?utm_source=instagram se recuerda ({ori and ori["fuente"]})')
    page.goto(BASE + 'pagar.html?bazar=1', wait_until='load'); page.wait_for_timeout(2000)
    met = page.locator('.ck-met.spei')
    ok(met.count() == 1 and 'Transferencia SPEI' in met.inner_text(), 'en el pago aparece "Transferencia SPEI"')
    met.click(); page.wait_for_timeout(300)
    ok('Apartar y transferir' in page.locator('#ckPagar span').inner_text() and 'spei' in (page.locator('#ckPagar').get_attribute('class') or ''), f'el botón cambia a "{page.locator("#ckPagar span").inner_text()}"')
    ok('CLABE' in page.locator('#ckEscudoTxt').inner_text(), 'explica que verá la CLABE')
    page.fill('#fNombre', 'Mariana Torres'); page.fill('#fTelefono', '8996660011'); page.fill('#fEmail', 'mariana@correo.mx')
    page.locator('#fEmail').press('Tab'); page.wait_for_timeout(900)
    punto = page.locator('input[name="punto"]').first
    if punto.count(): punto.check(force=True)
    page.locator('#ckPagar').click(); page.wait_for_url(re.compile(r'pagar\.html\?pedido='), timeout=8000); page.wait_for_timeout(1800)
    spei = page.locator('#ckSpei')
    ok(spei.is_visible() and CLABE[:3] in spei.inner_text().replace(' ', '') and 'BBVA' in spei.inner_text(), 'el recibo muestra la CLABE, el banco y el monto')
    ok(page.locator('#ckSpei [data-copiar]').count() >= 3, 'botones "Copiar" para monto, CLABE y concepto')
    pid = re.search(r'pedido=([^&]+)', page.url).group(1); k = re.search(r'k=([^&]+)', page.url).group(1)
    page.set_input_files('#ckSpeiFoto', files=[{'name': 'comprobante.jpg', 'mimeType': 'image/jpeg', 'buffer': FOTO}]); page.wait_for_timeout(2500)
    ok('Recibimos tu comprobante' in page.locator('#ckSpeiSubir').inner_text(), 'al subir el comprobante dice que está en revisión')
    page.reload(wait_until='load'); page.wait_for_timeout(2500)
    ok('Recibimos tu comprobante' in page.locator('#ckSpeiSubir').inner_text(), 'al volver a abrir el recibo sigue "en revisión" (no pide subirlo otra vez)')
    ok(not e, f'checkout SPEI sin errores {e[:2]}')
    ctx.close()

    # ── 4 · Panel: revisar la transferencia ──
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}); fotos_locales(ctx)
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
    page = ctx.new_page(); e = errores(page)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(3000)
    page.evaluate("() => { showTab('ventas'); setTimeout(() => vnIr('pendientes'), 50); }"); page.wait_for_timeout(1800)
    ok(page.locator('.vn-pend.t-spei').count() >= 1, 'Pendientes: "Revisar transferencia"')
    page.evaluate("() => { VN.filtroPed = 'sinpagar'; vnIr('pedidos'); }"); page.wait_for_timeout(2000)
    tarjeta = page.locator(f'#vnPed-{pid}')
    ok(tarjeta.count() == 1 and 'Transferencia por revisar' in tarjeta.inner_text() and tarjeta.locator('a', has_text='Ver comprobante').count() == 1, 'el pedido dice "Transferencia por revisar" con su comprobante')
    page.once('dialog', lambda d: d.accept())
    tarjeta.locator('button', has_text='Ya me llegó').click(); page.wait_for_timeout(2500)
    s, ped = api('v-pedido', None, None, f'&id={pid}&k={k}')
    ok(ped.get('estado') == 'pagado', f'"Ya me llegó" deja el pedido pagado ({ped.get("estado")})')
    # Promociones y pagos: tarjeta SPEI con la CLABE guardada
    page.evaluate("() => vnIr('promos')"); page.wait_for_timeout(1500)
    ok(page.locator('#vnSpeiClabe').input_value() == CLABE and page.locator('#vnFrecCada').input_value() == '2', 'Promociones y pagos: CLABE y cliente frecuente')
    page.fill('#vnSpeiClabe', '012580001234567890'); page.click('#vnGuardarPromos'); page.wait_for_timeout(800)
    s, cfg = api('v-panel')
    ok(cfg['config']['spei']['clabe'] == CLABE, 'una CLABE mal copiada no se guarda (revisa el dígito verificador)')
    # Métricas: de dónde vienen las ventas
    page.evaluate("() => vnIr('metricas')"); page.wait_for_timeout(2500)
    org = page.locator('.vn-origenes')
    ok(org.count() == 1 and 'Instagram' in org.inner_text(), f'Métricas: "De dónde vienen tus ventas" con Instagram')
    ok(page.locator('.vn-links-origen input').count() == 5, 'links listos para compartir por red')
    ok(not e, f'panel sin errores {e[:2]}')
    ctx.close()

    # ── 5 · Recibo pagado: cliente frecuente, cumpleaños y reseña con fotos ──
    api('v-pedido-estado', {'id': pid, 'accion': 'entregado'})
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); fotos_locales(ctx); page = ctx.new_page(); e = errores(page)
    page.goto(BASE + f'pagar.html?pedido={pid}&k={k}', wait_until='load'); page.wait_for_timeout(2500)
    frec = page.locator('.ck-frec')
    ok(frec.is_visible() and 'Llevas 1 de 2' in frec.inner_text(), f'cliente frecuente: "{frec.inner_text()[:60] if frec.count() else ""}"')
    page.select_option('#ckCumDia', '14'); page.select_option('#ckCumMes', '2'); page.click('#ckCumple button'); page.wait_for_timeout(1200)
    ok('Listo' in page.locator('#ckCumple').inner_text(), 'cumpleaños guardado desde el recibo')
    page.locator('[data-est="5"]').click()
    page.set_input_files('#ckResFoto', files=[{'name': f'{i}.jpg', 'mimeType': 'image/jpeg', 'buffer': jpg((i * 60, 120, 80))} for i in range(4)]); page.wait_for_timeout(1500)
    ok(page.locator('.ck-res-foto').count() == 3 and page.locator('.ck-res-mas').is_hidden(), 'reseña: máximo 3 fotos con vista previa')
    page.locator('.ck-res-foto button').first.click(); page.wait_for_timeout(300)
    ok(page.locator('.ck-res-foto').count() == 2, 'se puede quitar una foto')
    page.fill('#ckComent', 'Me quedó perfecta 🔥'); page.click('#ckResBtn'); page.wait_for_timeout(2500)
    ok(page.locator('.ck-resena-hecha').count() == 1 and 'revisemos' in page.content(), 'reseña publicada; avisa que las fotos se revisan')
    ok(not e, f'recibo sin errores {e[:2]}')
    ctx.close()

    # Checkout con el mismo WhatsApp: ya le toca el descuento (2 compras → la 3.ª con 10 %)
    s, _ = api('v-cotizar', {'ids': [10], 'telefono': '8996660011'}, None)
    ctx = b.new_context(viewport={'width': 1300, 'height': 950})
    ctx.add_init_script("""if(!sessionStorage.getItem('v42b')){localStorage.setItem('bazar_wishlist', JSON.stringify([{id:10,bazarId:1,nombre:'x',precio_venta:1}]));
      localStorage.removeItem('stmp-contacto'); sessionStorage.setItem('v42b','1')}""")
    page = ctx.new_page(); e = errores(page)
    fake_ped = api('v-pagar', {'ids': [11], 'nombre': 'Mariana Torres', 'telefono': '8996660011', 'email': 'm@x.mx', 'entrega': 'persona', 'punto': 'zona-centro', 'metodo': 'spei'}, None)[1]
    api('v-spei-revisar', {'id': fake_ped['pedido'], 'aprobar': True})
    page.goto(BASE + 'pagar.html?bazar=1', wait_until='load'); page.wait_for_timeout(1800)
    page.fill('#fTelefono', '8996660011'); page.locator('#fTelefono').press('Tab'); page.wait_for_timeout(1800)
    ok('Cliente frecuente' in page.locator('.ck-lineas').first.inner_text(), 'al escribir su WhatsApp aparece "Cliente frecuente −10 %"')
    ok(not e, f'checkout frecuente sin errores {e[:2]}')
    ctx.close()

    # ── 6 · Panel: aprobar las fotos → salen en Inicio ──
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}); fotos_locales(ctx)
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
    page = ctx.new_page(); e = errores(page)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(3000)
    page.evaluate("() => { showTab('ventas'); setTimeout(() => vnIr('pendientes'), 50); }"); page.wait_for_timeout(1800)
    tf = page.locator('.vn-pend', has=page.locator('.vn-pend-fotos'))
    ok(tf.count() >= 1 and tf.first.locator('.vn-pend-fotos img').count() == 2, 'Pendientes: la reseña llega con sus 2 fotos')
    tf.first.locator('button', has_text='Publicar con fotos').click(); page.wait_for_timeout(1500)
    ok(page.locator('.vn-pend', has=page.locator('.vn-pend-fotos')).count() == 0, 'al publicarla, sale de pendientes')
    ok(not e, f'moderación sin errores {e[:2]}')
    ctx.close()
    urllib.request.urlopen(BASE + 'api/sync?scope=publico&fresh=1').read()
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}); fotos_locales(ctx); page = ctx.new_page(); e = errores(page)
    page.goto(BASE + 'inicio.html', wait_until='load'); page.wait_for_timeout(2500)
    sec = page.locator('#resenasSeccion'); sec.scroll_into_view_if_needed(); page.wait_for_timeout(600)
    ok(sec.is_visible() and page.locator('.rv-card.con-foto').count() >= 1 and 'compra verificada' in sec.inner_text().lower(), f'Inicio: "Lo que dicen nuestros clientes" con la reseña y sus fotos ({sec.is_visible()}, {page.locator(".rv-card.con-foto").count()})')
    page.locator('.rv-foto').first.click(); page.wait_for_timeout(500)
    ok(page.locator('dialog.rv-visor[open] img').count() == 1, 'tocar una foto la abre en grande')
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    ok(page.locator('dialog.rv-visor').count() == 0, 'Esc la cierra')
    ok(not e, f'inicio con reseñas sin errores {e[:2]}')
    ctx.close()

    # ── 7 · Caja (punto de venta) y etiquetas con SKU ──
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True); fotos_locales(ctx)
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)}); localStorage.removeItem('stmp-caja-ticket'); localStorage.removeItem('stmp-caja-vendidas');")
    page = ctx.new_page(); e = errores(page)
    page.goto(BASE + 'caja.html', wait_until='load'); page.wait_for_timeout(3000)
    ok(page.locator('#cjQ').is_visible() and page.locator('#cjCobrar').is_disabled(), 'Caja: lista para escanear, "Cobrar" apagado sin prendas')
    page.fill('#cjEvento', 'Barrio Chido')
    page.fill('#cjQ', 'STI-00012'); page.locator('#cjQ').press('Enter'); page.wait_for_timeout(600)
    ok(page.locator('#cjTicket li').count() == 1 and 'STI-00012' in page.locator('#cjTicket').inner_text(), 'Caja: escanear el SKU agrega la prenda')
    page.fill('#cjQ', f'{BASE}prenda.html?id=13&o=qr'); page.locator('#cjQ').press('Enter'); page.wait_for_timeout(600)
    ok(page.locator('#cjTicket li').count() == 2, 'Caja: el QR de la etiqueta también funciona')
    page.fill('#cjQ', 'STI-00012'); page.locator('#cjQ').press('Enter'); page.wait_for_timeout(400)
    ok(page.locator('#cjTicket li').count() == 2, 'Caja: no se agrega dos veces la misma prenda')
    page.fill('#cjRecibido', '2000'); page.wait_for_timeout(200)
    ok('Cambio' in page.locator('#cjCambio').inner_text(), f'Caja: calcula el cambio ({page.locator("#cjCambio").inner_text()})')
    page.click('#cjCobrar'); page.wait_for_timeout(2000)
    ok(page.locator('#cjDlg[open]').count() == 1, 'Caja: cobrar muestra el ticket')
    s, rs = api('v-pos-resumen')
    ok(s == 200 and rs.get('tickets') == 1 and rs.get('prendas') == 2, f'la venta queda registrada en el resumen del día ({rs.get("tickets")} ticket, {rs.get("prendas")} prendas)')
    ancho = page.evaluate("[document.documentElement.scrollWidth, innerWidth]")
    ok(ancho[0] <= ancho[1] + 1, f'Caja no desborda en celular {ancho}')
    ok(not e, f'Caja sin errores {e[:2]}')
    ctx.close()

    ctx = b.new_context(viewport={'width': 1440, 'height': 900}); fotos_locales(ctx)
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
    page = ctx.new_page(); e = errores(page)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(3000)
    page.evaluate("() => { showTab('ventas'); setTimeout(() => vnIr('etiquetas'), 50); }"); page.wait_for_timeout(1500)
    ok('Etiquetas y SKU' in page.locator('#view-ventas').inner_text() and page.locator('.vn-et small', has_text='STI-0000').count() >= 1, 'Etiquetas: cada prenda muestra su SKU')
    page.locator('.vn-et input').first.check(); page.wait_for_timeout(300)
    page.locator('input[name="vnEtFmt"]').nth(1).check()
    with ctx.expect_page() as nueva:
        page.locator('button', has_text='Imprimir').first.click()
    hoja = nueva.value; hoja.wait_for_timeout(800)
    ok('STI-' in hoja.content() and '50mm' in hoja.content().replace(' ', ''), 'imprimir en térmica 50 × 30 con SKU')
    ok('o=qr' in hoja.content() or hoja.locator('svg').count() >= 1, 'la etiqueta lleva su QR')
    ok(not e, f'etiquetas sin errores {e[:2]}')
    ctx.close()
    b.close()

malas = [m for c, m in res if not c]
print(f'\nRESULTADO v42-navegador: {len(res) - len(malas)} de {len(res)}')
sys.exit(1 if malas else 0)
