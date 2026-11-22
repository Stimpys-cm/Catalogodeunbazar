# Pruebas v41 en el navegador: "Hoy", buscador (Ctrl+K), marca Stiimpys en el panel,
# datos legales y minutos en la tienda, avisos del carrito y guía en el panel.
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v41-navegador.py
import json, sys, urllib.request
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8766/'
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)

def api(op, cuerpo=None, token='TA'):
    req = urllib.request.Request(BASE + 'api/acciones?op=' + op, data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
        headers={'content-type': 'application/json', 'origin': BASE.rstrip('/'), 'authorization': 'Bearer ' + token}, method='POST' if cuerpo is not None else 'GET')
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')

# Datos legales y minutos desde el "panel"
s, r = api('v-config', {'minutosPago': 12, 'legal': {'nombre': 'Ana López', 'domicilio': 'Calle Hidalgo 123, Centro, Reynosa, Tamps. 88500', 'telefono': '899 555 0000', 'correo': 'hola@stiimpys.store', 'horario': ''}})
ok(s == 200, f'se guardan minutos y datos legales ({s})')
# El servidor local guarda el catálogo público 30 s: se pide uno fresco para no esperar
urllib.request.urlopen(BASE + 'api/sync?scope=publico&fresh=1').read()

with sync_playwright() as p:
    b = p.chromium.launch()
    def errores(page):
        e = []; page.on('pageerror', lambda x: e.append(str(x)[:160])); return e

    # ── Tienda: pie con datos legales y términos ──
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}); page = ctx.new_page(); e1 = errores(page)
    page.goto(BASE + 'inicio.html', wait_until='load'); page.wait_for_timeout(2500)
    pie = page.locator('.sf-legal')
    pie.scroll_into_view_if_needed(); page.wait_for_timeout(600)   # el pie usa content-visibility: se dibuja al acercarse
    ok(pie.count() == 1 and pie.is_visible() and 'Calle Hidalgo 123' in pie.inner_text() and '899 555 0000' in pie.inner_text(), 'inicio: el pie muestra domicilio y teléfono')
    ok('Horario' not in pie.text_content(), 'inicio: los datos vacíos no se muestran')
    page.goto(BASE + 'terminos.html', wait_until='load'); page.wait_for_timeout(2500)
    ok(page.locator('#vendedor .legal-datos').is_visible() and 'Ana López' in page.locator('#vendedor .legal-datos').inner_text(), 'términos: "Quién vende" con los datos del vendedor')
    mins = page.locator('[data-minutos-pago]').all_inner_texts()
    ok(mins and all(m == '12' for m in mins), f'términos: el apartado dice {mins} minutos (lo configurado)')
    ok(not e1, f'tienda sin errores {e1[:2]}')
    ctx.close()

    # ── Avisos del carrito en la tienda ──
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    ctx.add_init_script("""localStorage.setItem('bazar_wishlist', JSON.stringify([{ id: 6 }, { id: 8 }]));
      if (!localStorage.getItem('stmp-carrito-visto')) localStorage.setItem('stmp-carrito-visto', JSON.stringify({ '6': { precio: 99999, vendido: false, apartada: false }, '8': { precio: 1, vendido: false, apartada: true } }));""")
    page = ctx.new_page(); e2 = errores(page)
    page.goto(BASE + 'tienda.html', wait_until='load'); page.wait_for_timeout(3000)
    txt = page.evaluate("() => (Avisos?.historial?.() || []).map(x => [x.titulo, x.cuerpo, x.msg, (x.detalles||[]).join(' ')].join(' ')).join(' | ') + ' ' + document.body.innerText")
    ok('cambios en tu carrito' in txt or 'Bajó de precio' in txt or 'bajó de' in txt, 'catálogo: avisa que algo del carrito bajó de precio / se liberó')
    visto = page.evaluate("JSON.parse(localStorage.getItem('stmp-carrito-visto'))")
    ok(visto.get('6', {}).get('precio', 0) < 99999, 'después de avisar, anota el estado nuevo (no vuelve a avisar)')
    page.reload(wait_until='load'); page.wait_for_timeout(2500)
    n = page.evaluate("() => document.querySelectorAll('.av-toast, .aviso, [data-aviso]').length")
    ok(not e2, f'sin errores {e2[:2]}')
    ctx.close()

    # ── Panel: Hoy, buscador, marca ──
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)}); localStorage.removeItem('stmp-hoy-plegado');")
    page = ctx.new_page(); e3 = errores(page)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(3500)
    hoy = page.locator('#hoyPanel')
    ok(hoy.count() == 1 and hoy.is_visible() and page.locator('#hoyPanel .hoy-cuadro').count() == 8, 'panel: "Hoy" aparece al entrar con 8 cuadros')
    ok('Tienes' in hoy.inner_text() or 'Todo al día' in hoy.inner_text(), 'panel: "Hoy" dice cuántas cosas hay por atender')
    # v42: la barra lateral lleva el logo de Stiimpys (imagen) en vez del texto
    marca_ok = page.locator('.sidebar-logo-text img.marca-logo').count() >= 1 or 'STIIMPYS' in (page.locator('.sidebar-logo-text').inner_text() if page.locator('.sidebar-logo-text').count() else '')
    ok(marca_ok and 'STMP' not in page.title(), f'panel: marca Stiimpys ("{page.title()}")')
    page.keyboard.press('Control+k'); page.wait_for_timeout(400)
    ok(page.locator('#buscadorPanel').is_visible(), 'Ctrl+K abre el buscador')
    page.fill('#bpQ', 'Chamarra'); page.wait_for_timeout(1200)
    ok(page.locator('#bpRes .bp-item').count() >= 1, 'el buscador encuentra prendas')
    page.keyboard.press('Escape'); page.wait_for_timeout(300)
    ok(not page.locator('#buscadorPanel').is_visible(), 'Esc lo cierra')
    page.locator('#hoyPanel .hoy-cuadro').first.click(); page.wait_for_timeout(1500)
    ok(page.locator('#view-ventas').is_visible(), 'un cuadro de "Hoy" lleva a su sección')
    page.evaluate("() => showTab('inventario')"); page.wait_for_timeout(800)
    page.locator('.hoy-plegar').click(); page.wait_for_timeout(300)
    ok(page.locator('#hoyPanel').evaluate("e => e.classList.contains('plegado')"), '"Ocultar" pliega el resumen')
    page.locator('.hoy-plegar').click()
    # Promociones y pagos: campos nuevos
    page.evaluate("() => { showTab('ventas'); setTimeout(() => vnIr('promos'), 50); }"); page.wait_for_timeout(2000)
    ok(page.locator('#vnMinPago').input_value() == '12' and 'Calle Hidalgo' in page.locator('#vnLegal_domicilio').input_value(), 'Promociones y pagos: minutos y datos legales')
    ok(not e3, f'panel sin errores {e3[:2]}')
    ctx.close()

    # ── Panel en celular ──
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
    page = ctx.new_page(); e4 = errores(page)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(3500)
    ancho = page.evaluate("() => [document.documentElement.scrollWidth, innerWidth]")
    ok(page.locator('#hoyPanel').is_visible() and ancho[0] <= ancho[1] + 1, f'celular: "Hoy" se ve y no desborda {ancho}')
    ok(not e4, f'celular sin errores {e4[:2]}')
    ctx.close()
    b.close()

malas = [m for c, m in res if not c]
print(f'\nRESULTADO v41-navegador: {len(res) - len(malas)} de {len(res)}')
sys.exit(1 if malas else 0)
