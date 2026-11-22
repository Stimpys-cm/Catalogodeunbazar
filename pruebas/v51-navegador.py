# Pruebas v51 en el navegador: fotos HEIC que se ven en cuanto suben, elegir o soltar una carpeta, y aviso con .rar.
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v51-navegador.py
import json, re, io, os, tempfile, zipfile, uuid
from playwright.sync_api import sync_playwright
from PIL import Image

BASE = 'http://127.0.0.1:8766/'
C = uuid.uuid4().hex[:6]
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)
def jpg(k):
    b = io.BytesIO(); Image.new('RGB', (200, 260), (k * 30 % 255, 90, 140)).save(b, 'JPEG'); return b.getvalue()

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}])
    ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)}); localStorage.removeItem('stmp-subidas-v1');")
    ctx.route(re.compile(r'https://res\.cloudinary\.com/.*'), lambda r: r.fulfill(status=200, content_type='image/jpeg', body=jpg(1)))
    n = [0]
    def subir(route):
        if route.request.method != 'POST': return route.continue_()
        n[0] += 1
        route.fulfill(status=200, content_type='application/json', body=json.dumps({'url': f'https://res.cloudinary.com/demo/image/upload/v1/bazar/{C}-{n[0]}.heic'}))
    ctx.route('**/api/upload', subir)
    page = ctx.new_page(); errores = []
    page.on('pageerror', lambda x: errores.append(str(x)[:160]) if 'ViewTransition' not in str(x) else None)
    page.goto(BASE + 'admin.html', wait_until='load'); page.wait_for_timeout(2500)
    page.evaluate("() => { ZI.ig = 'no'; ZI.separarIA = false; ziAbrir(); }"); page.wait_for_timeout(600)
    ok(page.locator('#ziCarpeta').count() == 1 and page.locator('#ziCarpeta').get_attribute('webkitdirectory') is not None and 'Elegir una carpeta' in page.locator('.zi-carpeta-btn').inner_text(), 'paso 1: botón "Elegir una carpeta"')
    ok('.rar' in (page.locator('#ziDrop input').get_attribute('accept') or ''), 'el .rar aparece en la ventana para elegir (para poder avisar qué hacer)')

    # .rar solo → aviso claro
    page.set_input_files('#ziDrop input', files=[{'name': 'DROP_19-11-FINAL.rar', 'mimeType': 'application/x-rar-compressed', 'buffer': b'Rar!\x1a\x07\x00' + b'0' * 50}])
    page.wait_for_timeout(600)
    t = page.locator('#ziLeyendo').inner_text()
    ok('.rar no se pueden abrir' in t and 'Elegir una carpeta' in t and page.evaluate("ZI.paso") == 'elegir', f'un .rar: dice que no se puede y cómo hacerlo (carpeta o ZIP)')

    # Carpeta con fotos HEIC (como la del iPhone) + basura de Mac
    d = tempfile.mkdtemp(); carpeta = os.path.join(d, 'DROP_19-11-FINAL'); os.makedirs(carpeta)
    for k in range(6): open(os.path.join(carpeta, f'IMG_{80 + k:04d}.HEIC'), 'wb').write(jpg(k))
    open(os.path.join(carpeta, '._IMG_0080.HEIC'), 'wb').write(b'x'); open(os.path.join(carpeta, 'notas.txt'), 'w').write('x')
    page.set_input_files('#ziCarpeta', carpeta)
    page.wait_for_function("() => ZI.paso === 'agrupar'", timeout=15000)
    ok(page.evaluate("ZI.fotos.length") == 6, f'elegir la carpeta toma sus 6 fotos (sin la basura de Mac ni otros archivos) ({page.evaluate("ZI.fotos.length")})')
    ok(set(page.evaluate("ZI.fotos.map(f => f.carpeta)")) == {'DROP_19-11-FINAL'}, 'todas cuentan como una sola carpeta (así la IA las separa en la v50)')
    page.wait_for_function("() => ZI.fotos.every(f => f.nube)", timeout=20000); page.wait_for_timeout(1300)
    ok(page.locator('#ziGrupos .zi-heic[data-zk]').count() == 0 and page.locator('#ziGrupos .zi-foto img').count() == 6, 'las fotos HEIC se ven en cuanto suben (ya no dice "HEIC")')
    src = page.locator('#ziGrupos .zi-foto img').first.get_attribute('src')
    ok('/upload/c_fill,w_240,h_300,q_auto,f_jpg/' in src, 'la miniatura viene de Cloudinary convertida a JPG')
    ok('este navegador no las muestra' not in page.locator('#ziModal').inner_text(), 'el aviso de HEIC se quita cuando ya subieron todas')
    page.locator('.zi-fila.fin .zi-btn').first.click(); page.wait_for_timeout(300)   # Atrás

    # Soltar una carpeta (arrastrar desde el explorador)
    r = page.evaluate("""async () => {
      const blob = (n) => new File([new Uint8Array([255,216,255,217]), n], n, { type: 'image/jpeg' });   // contenido distinto (las repetidas se quitan)
      const archivo = (n, ruta) => ({ isFile: true, isDirectory: false, fullPath: '/' + ruta, file: (ok) => ok(blob(n)) });
      const dir = (ruta, hijos) => ({ isFile: false, isDirectory: true, fullPath: '/' + ruta, createReader: () => { let dado = false; return { readEntries: (ok) => { ok(dado ? [] : hijos); dado = true; } }; } });
      const raiz = dir('Lote', [dir('Lote/Prenda 1', [archivo('a.jpg', 'Lote/Prenda 1/a.jpg'), archivo('b.jpg', 'Lote/Prenda 1/b.jpg')]), dir('Lote/Prenda 2', [archivo('c.jpg', 'Lote/Prenda 2/c.jpg')])]);
      await ziSoltar({ preventDefault() {}, dataTransfer: { items: [{ webkitGetAsEntry: () => raiz }], files: [] } });
      await new Promise(r => setTimeout(r, 1500));
      return { paso: ZI.paso, n: ZI.fotos?.length, grupos: ZI.grupos.map(g => g.fotos.map(f => f.base).join(',')) };
    }""")
    ok(r['paso'] == 'agrupar' and r['n'] == 3 and r['grupos'] == ['a.jpg,b.jpg', 'c.jpg'], f'soltar una carpeta con subcarpetas: una prenda por subcarpeta ({r["grupos"]})')
    ok(not errores, f'sin errores en la página ({errores[:2]})')
    ctx.close(); b.close()

f = [m for c, m in res if not c]
print(f'\n{len(res) - len(f)}/{len(res)} PASS')
