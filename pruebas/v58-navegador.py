# Pruebas v58 en el navegador: publicaciones de Instagram que fallaron o se quedaron a medias.
# - Tarjeta: el botón de Instagram se marca con "!" si falló y dice por qué; al tocarlo reintenta.
# - El aviso de error trae "Ver publicaciones con problemas", que abre Instagram → Con problemas.
# - Con problemas: prendas (error, a medias, publicándose) y programados, con número rojo en el menú;
#   Reintentar (destraba y publica), Cancelar y Reintentar programado. Compu y celular.
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v58-navegador.py
import json, re
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8766/'
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)

with sync_playwright() as p:
    b = p.chromium.launch()
    for ancho, alto, movil in [(1440, 900, False), (390, 844, True)]:
        tag = 'celular' if movil else 'compu'
        ctx = b.new_context(viewport={'width': ancho, 'height': alto}, is_mobile=movil, has_touch=movil)
        ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
        ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
        page = ctx.new_page(); e = []
        page.on('pageerror', lambda x: e.append(str(x)[:160]) if 'ViewTransition' not in str(x) else None)
        llamadas = []
        page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(2500)
        pid, pid2 = page.evaluate("() => { const l = getDB().filter(x => !x.vendido && !x.instagramId); return [l[0].id, l[1].id]; }")
        PRENDAS = [{'id': pid, 'nombre': 'Playera con error', 'foto': '', 'estado': 'error', 'mensaje': 'Instagram no pudo procesar una de las fotos.', 'en': '2026-11-20T18:00:00Z', 'intentos': 2},
                   {'id': pid2, 'nombre': 'Sudadera a medias', 'foto': '', 'estado': 'atorada', 'mensaje': 'Se quedó a medias (la publicación se cortó)', 'en': '2026-11-20T17:00:00Z', 'intentos': 0}]
        PROG = [{'id': 9, 'tipo': 'post', 'imagenes': ['https://res.cloudinary.com/demo/image/upload/v1/x.jpg'], 'caption': 'Programado', 'estado': 'error', 'error': 'Falló', 'publicarEn': '2026-11-20T15:00:00Z'}]
        estado = {'prendas': PRENDAS, 'programados': PROG}
        def ig(route):
            o = re.search(r'op=([\w-]+)', route.request.url).group(1); llamadas.append(o)
            cuerpo = json.loads(route.request.post_data or '{}') if route.request.method == 'POST' else {}
            if o == 'ig-estado': return route.fulfill(status=200, content_type='application/json', body=json.dumps({'bazarId': 1, 'conectado': True, 'config': {}, 'defaults': {}, 'perfil': {'username': 'stiimpys', 'followers_count': 10}, 'token': {}}))
            if o == 'ig-problemas':
                pr = estado['prendas']; pg = estado['programados']
                return route.fulfill(status=200, content_type='application/json', body=json.dumps({'prendas': pr, 'programados': pg, 'total': len([x for x in pr if x['estado'] != 'publicando']) + len(pg)}))
            if o == 'ig-destrabar': return route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'libre': True}))
            if o == 'ig-descartar-error':
                estado['prendas'] = [x for x in estado['prendas'] if x['id'] != cuerpo.get('id')]
                return route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True}))
            if o == 'ig-programado-reintentar':
                estado['programados'] = []
                return route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'hechos': [{'id': 9, 'ok': True}]}))
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'posts': []}))
        page.route(re.compile(r'.*/api/acciones\?op=ig-.*'), ig)
        publicar = {'n': 0}
        def pub(route):
            publicar['n'] += 1
            if publicar['n'] == 1:
                return route.fulfill(status=502, content_type='application/json', body=json.dumps({'error': 'Instagram no pudo procesar una de las fotos.', 'instagramError': {'mensaje': 'Instagram no pudo procesar una de las fotos.', 'intentos': 3}}))
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'instagramId': 'post1', 'instagramUrl': 'https://www.instagram.com/p/post1/', 'instagramEn': '2026-11-20T19:00:00Z'}))
        page.route(re.compile(r'.*/api/inventario-item\?op=instagram&.*'), pub)

        # ── Tarjeta con error
        page.evaluate(f"() => {{ getBazares().forEach(b => b.instagramAuto = true); const x = getDB().find(p => p.id === {pid}); x.instagramError = {{ mensaje: 'Instagram no pudo procesar una de las fotos.', intentos: 2 }}; showTab('inventario'); renderAll(); }}")
        page.wait_for_timeout(500)
        btn = page.locator(f'#card-{pid} .act-btn.ig')
        btn.scroll_into_view_if_needed()
        ok('con-error' in (btn.get_attribute('class') or '') and 'No se publicó' in (btn.get_attribute('title') or ''), f'{tag}: el botón de Instagram se marca si falló y dice por qué')
        if not movil: page.screenshot(path='/tmp/v58_card.png', clip=page.locator(f'#card-{pid}').bounding_box())
        btn.click(); page.wait_for_timeout(900)
        av = page.locator('.stmp-aviso:has-text("No se pudo publicar en Instagram")').last
        ok(av.count() == 1 and av.locator('button:has-text("Ver publicaciones con problemas")').count() == 1, f'{tag}: el aviso de error trae "Ver publicaciones con problemas"')
        av.locator('button:has-text("Ver publicaciones con problemas")').click(); page.wait_for_timeout(1500)
        ok(page.evaluate("() => IG.vista") == 'problemas' and page.locator('.igx-cabecera, .igx-cab').count() >= 0 and 'Con problemas' in page.locator('#igRaiz').inner_text(), f'{tag}: abre Instagram → Con problemas')
        raiz = page.locator('#igRaiz')
        ok(page.locator(f'[data-prob="{pid}"]').count() == 1 and page.locator(f'[data-prob="{pid2}"]').count() == 1 and page.locator('[data-prob-prog="9"]').count() == 1, f'{tag}: lista prendas con error, a medias y el programado con error')
        ok('2 intentos' in page.locator(f'[data-prob="{pid}"]').inner_text() and 'a medias' in page.locator(f'[data-prob="{pid2}"]').inner_text().lower(), f'{tag}: dice cuántos intentos y cuál se quedó a medias')
        ok(page.locator('.igx-item:has-text("Con problemas") em.rojo').inner_text().strip() == '3', f'{tag}: número rojo en el menú (3)')
        ok(page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), f'{tag}: no se sale de la pantalla')
        if movil: page.screenshot(path='/tmp/v58_problemas_celular.png')
        else: page.screenshot(path='/tmp/v58_problemas.png')
        # Reintentar prenda a medias: destraba y publica
        n0 = publicar['n']
        page.locator(f'[data-prob="{pid2}"] button:has-text("Reintentar")').click(); page.wait_for_timeout(1500)
        ok('ig-destrabar' in llamadas and publicar['n'] == n0 + 1, f'{tag}: "Reintentar" destraba y vuelve a publicar')
        ok(page.evaluate(f"() => getDB().find(p => p.id === {pid2}).instagramId") == 'post1', f'{tag}: queda ligada con su post')
        # Cancelar
        page.locator(f'[data-prob="{pid}"] button:has-text("Cancelar")').click(); page.wait_for_timeout(1200)
        ok('ig-descartar-error' in llamadas and page.evaluate(f"() => !getDB().find(p => p.id === {pid}).instagramError"), f'{tag}: "Cancelar" quita el error')
        # Programado
        page.locator('[data-prob-prog="9"] button:has-text("Reintentar")').click(); page.wait_for_timeout(1200)
        ok('ig-programado-reintentar' in llamadas and page.locator('[data-prob-prog="9"]').count() == 0, f'{tag}: reintentar el programado')
        ok(not e, f'{tag}: sin errores ({e[:2]})')
        ctx.close()
    b.close()

n = sum(1 for c, _ in res if c)
print(f'\nRESULTADO: {n} de {len(res)} pruebas pasaron')
