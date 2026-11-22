# Pruebas v40: nada de lo que escribe un cliente se ejecuta como código (XSS guardado)
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v40-xss.py
# Un cliente escribe código en su nombre, dirección, oferta, aviso y reseña; luego se abren
# la tienda, su recibo y TODAS las secciones del panel (donde la dueña tiene sesión).
# Si algo se ejecutara, el código pondría window.__xss.
import json, sys, urllib.request
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8766/'
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
MALO = '<img src=x onerror="window.__xss=(window.__xss||0)+1"><script>window.__xss=1</script>"\'><svg onload=window.__xss=1>'
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)

def api(op, cuerpo, metodo='POST'):
    req = urllib.request.Request(BASE + 'api/acciones?op=' + op, data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
                                 headers={'content-type': 'application/json', 'origin': BASE.rstrip('/'), 'x-real-ip': '10.77.0.1'}, method=metodo)
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'{}')

# Lo que manda un "cliente" con código en cada campo
s1, _ = api('v-oferta', {'prendaId': 9, 'monto': 600, 'nombre': MALO[:60], 'telefono': '8991112233'})
s2, _ = api('v-espera', {'tipo': 'busqueda', 'nombre': MALO[:60], 'telefono': '8991112234', 'talla': MALO[:30], 'marca': MALO[:40]})
s3, pago = api('v-pagar', {'ids': [6], 'nombre': MALO[:60], 'telefono': '8991112235', 'email': 'a@b.co', 'metodo': 'clip', 'entrega': 'persona', 'punto': 'zona-centro'})
ok(s1 == 200 and s2 == 200 and s3 == 200, f'el cliente pudo mandar oferta, aviso y pedido con código en el texto ({s1}, {s2}, {s3})')
recibo = (pago or {}).get('url', '')

with sync_playwright() as p:
    b = p.chromium.launch()
    # Tienda (sin sesión)
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}); page = ctx.new_page()
    rutas = ['inicio.html', 'tienda.html', 'prenda.html?id=9', 'carrito.html', 'cuenta.html']
    if pago and pago.get('pedido'): rutas.append(f"pagar.html?pedido={pago['pedido']}&k={pago['clave']}")
    for ruta in rutas:
        page.goto(BASE + ruta, wait_until='load'); page.wait_for_timeout(1200)
        ok(not page.evaluate('window.__xss'), f'tienda {ruta.split("&k=")[0]}: no se ejecutó nada')
    ctx.close()
    # Panel con la sesión de la dueña
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
    page = ctx.new_page(); errores = []
    page.on('dialog', lambda d: (errores.append('DIALOG ' + d.message[:60]), d.dismiss()))
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(2500)
    for tab in ['inventario', 'ventas', 'instagram', 'sistema', 'cuenta', 'drops', 'subastas', 'ganancias', 'marketplace']:
        page.evaluate(f"() => document.getElementById('tab-{tab}')?.click()"); page.wait_for_timeout(1500)
        if tab == 'ventas':
            for sec in ['pendientes', 'pedidos', 'ofertas', 'interesados', 'corte', 'metricas']:
                page.evaluate(f"() => typeof vnIr === 'function' && vnIr('{sec}')"); page.wait_for_timeout(900)
                ok(not page.evaluate('window.__xss'), f'panel → Ventas → {sec}: no se ejecutó nada')
                if sec == 'ofertas': visible = page.evaluate("() => document.body.innerText.includes('src=x onerror')")
        else:
            ok(not page.evaluate('window.__xss'), f'panel → {tab}: no se ejecutó nada')
    # Centro de avisos (campana) y la página de actividad
    page.evaluate("() => document.querySelector('.avc-campana, #avisosCampana, [data-avisos]')?.click()"); page.wait_for_timeout(600)
    ok(not page.evaluate('window.__xss'), 'campana de avisos: no se ejecutó nada')
    ok(not errores, f'sin diálogos inesperados {errores[:2]}')
    ok(visible, 'el texto del cliente se ve como texto en Ofertas (limpio y sin ejecutarse)')
    ctx.close(); b.close()

malas = [m for c, m in res if not c]
print(f'\nRESULTADO v40-xss: {len(res) - len(malas)} de {len(res)}')
sys.exit(1 if malas else 0)
