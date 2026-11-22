# Pruebas v54 en el navegador (panel → Instagram): texto profesional sin emojis.
# - Ajustes: "Estilo del texto" en "Limpio, sin emojis" y la vista previa sin emojis (aunque la firma guardada traiga uno).
# - Al guardar se manda el estilo.
# - Crear post, "Copiar texto corto" y el texto del Reel: sin emojis, con etiquetas y máximo 5 hashtags.
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v54-navegador.py
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
EMOJI = re.compile('[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F]')

DESC = 'Sudadera azul con estampado de Lionel Richie. Por atrás trae la lista de ciudades de la gira. Mándame WhatsApp al 899 528 4602.\n\n• Estampado en el pecho\n• Estampado en la manga\n\nA considerar: mancha chica en el puño.\n\n📐 Largo 70 cm · Ancho 58 cm'
CFG = {'plantilla': True, 'portadaSola': True, 'tonoPlantilla': 'crema', 'firma': '📦 Envíos a todo México', 'hashtags': '#bazar #reynosa #ropavintage #streetwear #vintage #thrift',
       'hashtagsInteligentes': True, 'estiloTexto': 'limpio', 'textoCorto': True, 'maxHashtags': 5, 'respuestasRapidas': [], 'automatico': {}}

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
        pid = page.evaluate(f"""() => {{ const p = getDB().find(x => !x.vendido); Object.assign(p, {{ nombre: 'Sudadera Lionel Richie All Night Long', marca: '', talla: 'L Hombre', estado: '9/10', precio_venta: 150,
            descripcion: {json.dumps(DESC)}, hashtags: '#lionelrichie #allnightlong #tourmerch #bandmerch #crewneck', categorias: ['Sudaderas'] }}); return p.id; }}""")
        page.evaluate("() => showTab('instagram')"); page.wait_for_function("() => IG.estado?.conectado", timeout=8000); page.wait_for_timeout(400)
        tag = 'celular' if movil else 'compu'

        # ── Ajustes
        page.evaluate("() => igVista('ajustes')"); page.wait_for_timeout(300)
        ok(page.locator('#igCfg_estiloTexto').input_value() == 'limpio' and 'sin emojis' in page.locator('#igCfg_estiloTexto option[value="limpio"]').inner_text(), f'{tag}: "Estilo del texto" en "Limpio, sin emojis"')
        prev = page.locator('.igx-cap-muestra'); txt = prev.inner_text() if prev.count() else ''
        ok(prev.count() == 1 and not EMOJI.search(txt) and 'Precio: $150 MXN' in txt and 'Talla: L Hombre' in txt and 'Estado: 9/10' in txt, f'{tag}: la vista previa sale sin emojis y con etiquetas')
        ok('Envíos a todo México' in txt and 'Disponible en stiimpys.store/p/' in txt, f'{tag}: la firma guardada pierde su emoji y el link dice "Disponible en"')
        if prev.count(): prev.scroll_into_view_if_needed(); page.screenshot(path=f'/tmp/v54_{tag}.png')
        page.select_option('#igCfg_estiloTexto', 'emojis')
        page.evaluate("() => igGuardarConfig()"); page.wait_for_timeout(600)
        ok(enviado.get('estiloTexto') == 'emojis', f'{tag}: al guardar se manda el estilo elegido')

        # ── Crear post (estilo limpio)
        page.evaluate(f"() => {{ IG.estado.config = {{ ...IG.estado.config, estiloTexto: 'limpio', textoCorto: true, maxHashtags: 5 }}; IG.tipo = 'post'; igVista('crear'); igUsarPrenda({pid}); }}"); page.wait_for_timeout(400)
        cap = page.evaluate("() => IG.caption")
        ok(not EMOJI.search(cap) and cap.startswith('Sudadera Lionel Richie All Night Long\n\nPrecio: $150 MXN\nTalla: L Hombre\nEstado: 9/10\nMedidas: Largo 70 cm · Ancho 58 cm'), f'{tag}: Crear → texto sin emojis con los datos en orden')
        ok('A considerar: mancha chica en el puño.' in cap and not re.search(r'wa\.me|whatsapp|899', cap, re.I) and nhash(cap) == 5, f'{tag}: con lo que hay que considerar, sin WhatsApp y 5 hashtags')
        # ── Copiar texto corto de un post publicado
        page.evaluate(f"""() => {{ navigator.clipboard.writeText = async t => {{ window.__copiado = t; }}; IG.posts = [{{ id: 'm1', media_type: 'IMAGE', media_url: 'https://res.cloudinary.com/demo/image/upload/v1/x.jpg',
            permalink: 'https://instagram.com/p/x', caption: 'viejo', timestamp: new Date().toISOString(), prenda: {{ id: {pid}, vendido: false }} }}]; igAbrirPost(0); }}""")
        page.wait_for_timeout(500)
        page.locator('#igModal button:has-text("Copiar texto corto")').click(); page.wait_for_timeout(400)
        ok(page.evaluate("() => window.__copiado || ''") == cap, f'{tag}: "Copiar texto corto" copia el mismo texto limpio')
        page.evaluate("() => igCerrarPost()")
        # ── Reel
        rl = page.evaluate("() => { IG.reel = { ...(IG.reel || {}), estilo: 'nuevos', sel: null }; return rlCaption(); }")
        ok(not EMOJI.search(rl) and rl.startswith('NUEVOS INGRESOS\n\n1. ') and 'Apártalas en stiimpys.store (link en bio)' in rl, f'{tag}: texto del Reel sin emojis')
        ok(rl.split('\n')[-1].startswith('#') and nhash(rl.split('\n')[-1]) <= 5, f'{tag}: el Reel también con máximo 5 hashtags ({nhash(rl.splitlines()[-1])})')
        ok(not e, f'{tag}: sin errores en la página ({e[:2]})')
        b.close()

caso(1440, 900, False)
caso(390, 844, True)
n = sum(1 for c, _ in res if c)
print(f'\nRESULTADO: {n} de {len(res)} pruebas pasaron')
