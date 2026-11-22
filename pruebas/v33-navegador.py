# Pruebas en Chrome real contra el servidor local (API real + base en memoria)
import json, sys
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8766/'
SESION = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)

def contexto(b, ancho, alto, sesion=True):
    ctx = b.new_context(viewport={'width': ancho, 'height': alto})
    if sesion:
        ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
        ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(SESION)})")
    return ctx

def vigilar(page):
    errs, malos = [], []
    page.on('pageerror', lambda e: errs.append(str(e)[:200]))
    page.on('response', lambda r: malos.append(f"{r.status} {r.url.replace(BASE, '/')}") if r.status == 404 and '127.0.0.1' in r.url else None)
    page.on('dialog', lambda d: (errs.append('DIALOG ' + d.message[:80]), d.dismiss()))
    return errs, malos

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

    # 1 · Las 8 páginas públicas
    for pg in ['inicio.html', 'tienda.html', 'prenda.html?id=6', 'pagar.html?ids=6&bazar=1', 'cuenta.html', 'terminos.html']:
        ctx = contexto(b, 390, 844, sesion=False); page = ctx.new_page(); errs, malos = vigilar(page)
        page.goto(BASE + pg, wait_until='networkidle', timeout=30000); page.wait_for_timeout(800)
        ok(not errs and not malos, f'pública {pg}: sin errores de JS ni 404 {errs[:2]} {malos[:3]}')
        ctx.close()

    # 2 · Panel: Sistema → Monitor
    for ancho, alto, nombre in [(1366, 900, 'compu'), (390, 844, 'celular')]:
        ctx = contexto(b, ancho, alto); page = ctx.new_page(); errs, malos = vigilar(page)
        page.goto(BASE + 'admin.html', wait_until='networkidle', timeout=30000); page.wait_for_timeout(1200)
        page.evaluate("showTab('sistema')"); page.wait_for_timeout(300)
        page.evaluate("spIr('monitor')")
        page.wait_for_selector('#spMonitor .sp-servicios', timeout=10000)
        servicios = page.locator('#spMonitor .sp-serv').count()
        ok(servicios == 5, f'[{nombre}] monitor muestra {servicios} servicios')
        estados = page.locator('#spMonitor .sp-serv .sp-chip').all_inner_texts()
        ok('Operativo' in estados and 'Sin configurar' in estados, f'[{nombre}] estados visibles: {estados}')
        txt = page.inner_text('#spMonitor')
        ok('Pagos que se quedaron abiertos' in txt and 'Pedidos que necesitan atención' in txt, f'[{nombre}] operaciones pendientes y pedidos atorados')
        ok('Últimos movimientos' in txt and 'Último aviso de Clip' in txt, f'[{nombre}] últimos movimientos')
        page.screenshot(path=f'/tmp/v33-monitor-{nombre}.png', full_page=True)

        # 3 · Actividad
        page.evaluate("spIr('actividad')")
        page.wait_for_selector('#spActividad .sp-act tbody tr', timeout=10000)
        filas = page.locator('#spActividad .sp-act tbody tr:not(.sp-fila-det)').count()
        total = page.inner_text('#spActividad .sp-total')
        ok(filas == 25, f'[{nombre}] actividad: {filas} filas en la primera página ({total})')
        ok(page.locator('#spActividad .sp-pag .pg-num').count() >= 2, f'[{nombre}] paginación visible')
        page.locator('#spActividad .sp-pag .pg-num', has_text='2').first.click(); page.wait_for_timeout(700)
        ok(page.locator('#spActividad .sp-pag .pg-num.active').inner_text() == '2', f'[{nombre}] cambia a la página 2')
        if nombre == 'celular':
            ok(not page.locator('#spCat').is_visible(), '[celular] filtros plegados al inicio')
            page.click('#spFiltrosBtn'); page.wait_for_timeout(150)
            ok(page.locator('#spCat').is_visible(), '[celular] el botón Filtros los muestra')
        page.select_option('#spCat', 'pago'); page.wait_for_timeout(700)
        areas = set(page.locator('#spActividad .sp-act tbody td[data-l="Área"]').all_inner_texts())
        ok(areas == {'Pagos'}, f'[{nombre}] filtro por área: {areas}')
        page.fill('#spQ', 'Clip'); page.wait_for_timeout(1000)
        ok(page.evaluate("document.activeElement.id") == 'spQ', f'[{nombre}] la búsqueda no pierde el foco al escribir')
        page.locator('#spActividad .sp-abrir').first.click(); page.wait_for_timeout(300)
        ok(page.locator('#spActividad .sp-det').count() == 1, f'[{nombre}] se abre el detalle de un evento')
        page.click('#spLimpiarBtn'); page.wait_for_timeout(700)
        page.locator('#spActividad .sp-filtro-chip.rojo').click(); page.wait_for_timeout(700)
        ok(set(page.locator('#spActividad .sp-act tbody td[data-l="Resultado"]').all_inner_texts()) <= {'Error'}, f'[{nombre}] indicador "Errores" filtra')
        page.screenshot(path=f'/tmp/v33-actividad-{nombre}.png', full_page=True)

        # 4 · Historial de un pedido desde Ventas → Pedidos
        page.evaluate("spIrVentas('pedidos', 'apartados')"); page.wait_for_timeout(1200)
        ok(page.locator('.vn-ped').count() >= 1, f'[{nombre}] Ventas → Apartados lista pedidos')
        page.fill('.vn-ped-busca input', 'zzzz'); page.wait_for_timeout(200)
        ok('Ningún pedido coincide' in page.inner_text('#vnPedLista'), f'[{nombre}] búsqueda de pedidos')
        page.fill('.vn-ped-busca input', 'Beto'); page.wait_for_timeout(200)
        page.locator('.vn-ped button', has_text='Historial').first.click()
        page.wait_for_selector('#spModal .sp-linea li', timeout=8000)
        ok(page.locator('#spModal .sp-linea li').count() >= 2 and 'Todo coincide' in page.inner_text('#spModal'), f'[{nombre}] historial del pedido con prendas consistentes')
        page.screenshot(path=f'/tmp/v33-historial-{nombre}.png')
        page.keyboard.press('Escape'); page.wait_for_timeout(200)
        ok(page.locator('#spModal').count() == 0, f'[{nombre}] Esc cierra la ventana')
        # Pedido atorado: botón Revisar pago
        page.evaluate("VN.filtroPed='sinpagar'; VN.buscaPed=''; vnPintar()"); page.wait_for_timeout(300)
        ok(page.locator('.vn-ped.alerta-ambar').count() >= 1 and page.locator('.vn-ped button', has_text='Cancelar pedido').count() >= 1, f'[{nombre}] pedido atorado resaltado con "Cancelar pedido"')
        page.evaluate("VN.filtroPed='cancelados'; vnPintar()"); page.wait_for_timeout(300)
        ok('Se equivocó de talla' in page.inner_text('#vnPedLista'), f'[{nombre}] pestaña Cancelados con motivo')
        # 5 · Datos del panel (v32) siguen ahí
        page.evaluate("showTab('sistema'); spIr('datos')"); page.wait_for_timeout(500)
        ok(page.locator('#sistemaMetrics .sis-metric').count() >= 4 and page.locator('#logsLista').is_visible(), f'[{nombre}] "Datos del panel" conserva lo de la v32')
        page.evaluate("spIr('mantenimiento')"); page.wait_for_timeout(500)
        ok(page.locator('#mntControles').is_visible(), f'[{nombre}] mantenimiento visible para el admin principal')
        ok(not errs, f'[{nombre}] panel sin errores de JS {errs[:3]}')
        ok(not malos, f'[{nombre}] panel sin archivos 404 {malos[:5]}')
        ctx.close()

    # 6 · Cancelar desde la ventana del historial (con diálogo de motivo)
    ctx = contexto(b, 1280, 900); page = ctx.new_page(); errs, malos = vigilar(page)
    page.goto(BASE + 'admin.html', wait_until='networkidle'); page.wait_for_timeout(1000)
    pid = page.evaluate("fetch('/api/acciones?op=v-pedidos').then(r=>r.json()).then(j=>j.pedidos.find(p=>p.estado==='pendiente').id)")
    page.evaluate(f"spHistorial('{pid}')"); page.wait_for_selector('#spModal .sp-modal-pie button', timeout=8000)
    page.locator('#spModal button', has_text='Cancelar pedido').click(); page.wait_for_timeout(300)
    page.fill('#spMotivo', 'Prueba de cancelación'); page.click('#dlgAceptar'); page.wait_for_timeout(1500)
    estado = page.evaluate(f"fetch('/api/acciones?op=v-pedido-historial&id={pid}').then(r=>r.json()).then(j=>[j.pedido.estado, j.pedido.motivoCancelacion])")
    ok(estado == ['cancelado', 'Prueba de cancelación'], f'cancelar desde el historial: {estado}')
    ok(not errs, f'sin errores al cancelar {errs[:2]}')
    ctx.close()

    # 7 · Vendedor: no ve Sistema ni puede pedir la actividad
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    ctx.add_cookies([{'name': 'sesion', 'value': 'TV', 'url': BASE}])
    ctx.add_init_script("localStorage.setItem('stiimpys_session', JSON.stringify({id:2,username:'vende',role:'vendedor',sessionToken:'TV',bazarId:1}))")
    page = ctx.new_page(); errs, malos = vigilar(page)
    page.goto(BASE + 'admin.html', wait_until='networkidle'); page.wait_for_timeout(1000)
    ok(not page.locator('#tab-sistema').is_visible(), 'vendedor: la pestaña Sistema no aparece')
    st = page.evaluate("fetch('/api/acciones?op=v-actividad').then(r=>r.status)")
    ok(st == 403, f'vendedor: el servidor niega la actividad ({st})')
    ctx.close()
    b.close()

pas = sum(1 for r in res if r[0])
print(f'\nRESULTADO NAVEGADOR: {pas} de {len(res)}')
sys.exit(0 if pas == len(res) else 1)
