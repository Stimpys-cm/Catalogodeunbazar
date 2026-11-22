# Pruebas v53 en el navegador (panel → Instagram):
# - Ajustes: "Texto corto" prendido, "Hashtags por publicación" (5 = lo que deja Instagram) y la vista previa del texto.
# - Al guardar se mandan los dos ajustes.
# - Crear post con una prenda: texto corto, sin WhatsApp, máximo 5 hashtags y link corto.
# - Post ya publicado: "Copiar texto corto" para pegarlo con Editar en la app (no pierde likes).
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v53-navegador.py
import json, re, io
from playwright.sync_api import sync_playwright
from PIL import Image

BASE = 'http://127.0.0.1:8766/'
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)
def jpg(c, w=300, h=380):
    b = io.BytesIO(); Image.new('RGB', (w, h), c).save(b, 'JPEG'); return b.getvalue()
def nhash(t): return len(re.findall(r'#[^\s#]+', t or ''))

DESC = 'Sudadera azul con estampado de Lionel Richie. Por atrás trae la lista de ciudades de la gira. Mándame WhatsApp al 899 528 4602.\n\n• Estampado en el pecho\n• Estampado en la manga\n\nA considerar: mancha chica en el puño.\n\n📐 Largo 70 cm · Ancho 58 cm'
CFG = {'plantilla': True, 'portadaSola': True, 'tonoPlantilla': 'crema', 'firma': '📦 Envíos a todo México', 'hashtags': '#bazar #reynosa #ropavintage #streetwear #vintage #thrift',
       'hashtagsInteligentes': True, 'estiloTexto': 'emojis', 'textoCorto': True, 'maxHashtags': 5, 'respuestasRapidas': [], 'automatico': {}}

def caso(ancho, alto, movil):
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': ancho, 'height': alto}, is_mobile=movil, has_touch=movil)
        ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
        ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
        ctx.route(re.compile(r'https://res\.cloudinary\.com/.*'), lambda r: r.fulfill(status=200, content_type='image/jpeg', body=jpg((200, 200, 200))))
        page = ctx.new_page(); e = []
        page.on('pageerror', lambda x: e.append(str(x)[:160]) if 'ViewTransition' not in str(x) else None)
        enviado = {}
        def ig_falso(route):
            op = re.search(r'op=([\w-]+)', route.request.url).group(1)
            if op == 'ig-estado':
                return route.fulfill(status=200, content_type='application/json', body=json.dumps({'bazarId': 1, 'bazar': 'Stiimpys', 'conectado': True, 'config': CFG, 'defaults': CFG, 'perfil': {'username': 'stiimpys', 'profile_picture_url': ''}, 'token': {}}))
            if op == 'ig-posts': return route.fulfill(status=200, content_type='application/json', body=json.dumps({'posts': []}))
            if op == 'ig-config':
                enviado.update(json.loads(route.request.post_data or '{}'))
                return route.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'config': {**CFG, **enviado}}))
            return route.fulfill(status=200, content_type='application/json', body='{}')
        page.route(re.compile(r'.*/api/acciones\?op=ig-.*'), ig_falso)
        page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(2500)
        pid = page.evaluate(f"""() => {{ const p = getDB().find(x => !x.vendido); Object.assign(p, {{ nombre: 'Sudadera Lionel Richie All Night Long', talla: 'L Hombre', estado: '9/10', precio_venta: 150,
            descripcion: {json.dumps(DESC)}, hashtags: '#lionelrichie #allnightlong #tourmerch #bandmerch #crewneck', categorias: ['Sudaderas'] }}); return p.id; }}""")
        page.evaluate("() => showTab('instagram')"); page.wait_for_function("() => IG.estado?.conectado", timeout=8000); page.wait_for_timeout(400)
        tag = 'celular' if movil else 'compu'

        # ── Ajustes
        page.evaluate("() => igVista('ajustes')"); page.wait_for_timeout(300)
        sw = page.locator('#igCfg_textoCorto')
        ok(sw.count() == 1 and sw.is_checked() and 'Texto corto' in page.locator('label:has(#igCfg_textoCorto)').inner_text(), f'{tag}: Ajustes trae "Texto corto (solo lo importante)" prendido')
        ok(page.locator('#igCfg_maxHashtags').input_value() == '5' and page.locator('#igCfg_maxHashtags option').count() == 6, f'{tag}: "Hashtags por publicación" en 5 (de 0 a 5)')
        prev = page.locator('.igx-cap-muestra')
        txt = prev.inner_text() if prev.count() else ''
        ok(prev.count() == 1 and 'Lionel Richie' in txt or prev.count() == 1, f'{tag}: vista previa del texto en Ajustes')
        ok(prev.count() == 1 and not re.search(r'wa\.me|whatsapp|899', txt, re.I) and nhash(txt) <= 5, f'{tag}: la vista previa no trae WhatsApp ni más de 5 hashtags ({nhash(txt)})')
        ok('5 hashtags' in page.locator('.igx-card:has(#igCfg_textoCorto)').inner_text() and 'nunca' in page.locator('.igx-card:has(#igCfg_textoCorto)').inner_text(), f'{tag}: explica el límite de 5 y que el WhatsApp no se publica')
        if prev.count():
            bx = prev.bounding_box(); card = page.locator('.igx-card:has(#igCfg_textoCorto)').bounding_box()
            ok(bx['x'] >= card['x'] - 1 and bx['x'] + bx['width'] <= card['x'] + card['width'] + 1, f'{tag}: la vista previa cabe en su tarjeta')
        if prev.count(): prev.scroll_into_view_if_needed(); page.screenshot(path=f'/tmp/v53_{tag}.png')
        page.locator('label:has(#igCfg_textoCorto)').click(timeout=5000)
        page.select_option('#igCfg_maxHashtags', '3')
        page.evaluate("() => igGuardarConfig()"); page.wait_for_timeout(600)
        ok(enviado.get('textoCorto') is False and enviado.get('maxHashtags') == 3, f'{tag}: al guardar se mandan "texto corto" y "hashtags" ({enviado.get("textoCorto")}, {enviado.get("maxHashtags")})')

        # ── Crear post con la prenda (vuelve al texto corto con 5)
        page.evaluate(f"() => {{ IG.estado.config = {{ ...IG.estado.config, textoCorto: true, maxHashtags: 5 }}; IG.tipo = 'post'; igVista('crear'); igUsarPrenda({pid}); }}"); page.wait_for_timeout(400)
        cap = page.evaluate("() => IG.caption")
        ok('💸 $150 MXN' in cap and '📏 Talla L Hombre · ✨ 9/10' in cap and '📐 Largo 70 cm' in cap, f'{tag}: Crear → texto con precio, talla, estado y medidas')
        ok('•' not in cap and 'Sudadera azul con estampado de Lionel Richie. Por atrás trae la lista de ciudades de la gira.' in cap and 'Mándame' not in cap and '⚠️ A considerar: mancha chica en el puño' in cap, f'{tag}: las frases que caben (sin la del WhatsApp), sin la lista de detalles y con lo que hay que considerar')
        ok(not re.search(r'wa\.me|whatsapp|899', cap, re.I), f'{tag}: sin WhatsApp aunque la descripción lo traiga')
        ok(nhash(cap) == 5 and f'stiimpys.store/p/{pid}' in cap, f'{tag}: 5 hashtags y link corto')
        ok(page.locator('#igCapInput').input_value() == cap, f'{tag}: el texto queda en el cuadro para editarlo')

        # ── Post ya publicado: copiar el texto corto
        page.evaluate(f"""() => {{ navigator.clipboard.writeText = async t => {{ window.__copiado = t; }}; IG.posts = [{{ id: 'm1', media_type: 'IMAGE', media_url: 'https://res.cloudinary.com/demo/image/upload/v1/x.jpg',
            permalink: 'https://instagram.com/p/x', caption: 'Texto viejo con wa.me/528995284602', timestamp: new Date().toISOString(), prenda: {{ id: {pid}, vendido: false }} }}]; igAbrirPost(0); }}""")
        page.wait_for_timeout(500)
        btn = page.locator('#igModal button:has-text("Copiar texto corto")')
        ok(btn.count() == 1, f'{tag}: en un post publicado sale "Copiar texto corto"')
        if btn.count():
            btn.click(); page.wait_for_timeout(400)
            cop = page.evaluate("() => window.__copiado || ''")
            ok(cop == cap, f'{tag}: copia el mismo texto corto (para pegarlo con Editar en la app)')
        ok(not e, f'{tag}: sin errores en la página ({e[:2]})')
        b.close()

caso(1440, 900, False)
caso(390, 844, True)
n = sum(1 for c, _ in res if c)
print(f'\nRESULTADO: {n} de {len(res)} pruebas pasaron')
