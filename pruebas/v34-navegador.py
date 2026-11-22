# Pruebas del rediseño v34 en Chrome real (servidor local: node pruebas/correr.mjs --servidor)
#   python3 pruebas/v34-navegador.py
# Revisa: tema claro/oscuro/automático sin destello, acentos, selector del menú lateral,
# Mi cuenta → Apariencia, barra de pestañas y hoja "Más" en celular, cierre deslizando,
# todas las secciones en los dos temas sin errores, contraste mínimo y permisos de vendedor.
import json, sys
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8766/'
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
VENDE = json.dumps({'id': 2, 'username': 'vende', 'role': 'vendedor', 'sessionToken': 'TV', 'bazarId': 1})
TABS = ['inventario', 'registrar', 'drops', 'subastas', 'bazares', 'vendedores', 'catalogo', 'anuncios',
        'instagram', 'marketplace', 'ventas', 'ganancias', 'cuenta', 'sistema']
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)

def contexto(b, ancho, alto, tema=None, sesion=ADMIN, token='TA', esquema='light'):
    movil = ancho < 600
    ctx = b.new_context(viewport={'width': ancho, 'height': alto}, is_mobile=movil, has_touch=movil, color_scheme=esquema)
    ctx.add_cookies([{'name': 'sesion', 'value': token, 'url': BASE}])
    js = f"localStorage.setItem('stiimpys_session', {json.dumps(sesion)});"
    if tema: js += f"localStorage.setItem('stmp-tema', '{tema}');"
    ctx.add_init_script(js)
    return ctx

def vigilar(page):
    errs, malos = [], []
    page.on('pageerror', lambda e: errs.append(str(e)[:200]))
    page.on('response', lambda r: malos.append(f"{r.status} {r.url.replace(BASE, '/')}") if r.status == 404 and '127.0.0.1' in r.url else None)
    page.on('dialog', lambda d: (errs.append('DIALOG ' + d.message[:80]), d.dismiss()))
    return errs, malos

# Contraste de texto contra su fondo real (ignora degradados e imágenes)
CONTRASTE = r"""() => {
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}; };
  const lin = v => { v/=255; return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4); };
  const L = c => 0.2126*lin(c.r)+0.7152*lin(c.g)+0.0722*lin(c.b);
  const mez = (f, b) => ({r:f.r*f.a+b.r*(1-f.a), g:f.g*f.a+b.g*(1-f.a), b:f.b*f.a+b.b*(1-f.a), a:1});
  const fondo = el => { const capas = [];
    for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor); if (c && c.a > 0) { capas.push(c); if (c.a >= .99) break; } }
    let b = document.documentElement.dataset.tema === 'oscuro' ? {r:12,g:12,b:14,a:1} : {r:255,g:255,b:255,a:1};
    for (let i = capas.length-1; i >= 0; i--) b = mez(capas[i], b); return b; };
  const malos = [];
  for (const el of document.querySelectorAll('body *')) {
    const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
    if (!txt || /^\p{Extended_Pictographic}+$/u.test(txt)) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden') continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity; if (op < .5) continue;
    if (el.closest('[disabled],[aria-disabled="true"]')) continue;
    const c = parse(cs.color), b = fondo(el); if (!c || !b) continue;
    const f = c.a < 1 ? mez(c, b) : c, l1 = L(f), l2 = L(b), cr = (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
    if (cr < 3) malos.push(`${cr.toFixed(2)} ${(el.className||el.tagName).toString().slice(0,40)} «${txt.slice(0,24)}»`);
  }
  return malos;
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])

    # 1 · El tema se pone antes de pintar (sin destello) y se recuerda
    for tema in ['claro', 'oscuro']:
        ctx = contexto(b, 1366, 900, tema); page = ctx.new_page(); errs, malos = vigilar(page)
        page.goto(BASE + 'admin.html', wait_until='commit')
        page.wait_for_selector('body', state='attached')
        ok(page.evaluate("document.documentElement.dataset.tema") == tema, f'tema {tema}: aplicado antes de pintar el cuerpo')
        page.wait_for_load_state('networkidle'); page.wait_for_timeout(800)
        fondo = page.evaluate("getComputedStyle(document.body).backgroundColor")
        ok((fondo == 'rgb(12, 12, 14)') == (tema == 'oscuro'), f'tema {tema}: fondo del panel correcto ({fondo})')
        ctx.close()

    # 2 · Automático sigue al dispositivo (y cambia en vivo)
    ctx = contexto(b, 1366, 900, 'auto', esquema='dark'); page = ctx.new_page(); errs, malos = vigilar(page)
    page.goto(BASE + 'admin.html', wait_until='networkidle'); page.wait_for_timeout(600)
    ok(page.evaluate("document.documentElement.dataset.tema") == 'oscuro', 'automático: dispositivo oscuro → panel oscuro')
    page.emulate_media(color_scheme='light'); page.wait_for_timeout(300)
    ok(page.evaluate("document.documentElement.dataset.tema") == 'claro', 'automático: el dispositivo cambia a claro → el panel también, sin recargar')
    ok(page.evaluate("document.querySelector('meta[name=theme-color]').content") == '#f4f2ee', 'automático: la barra del navegador acompaña al tema')
    ctx.close()

    # 3 · Computadora: selector rápido del menú lateral + Mi cuenta → Apariencia
    ctx = contexto(b, 1366, 900, 'claro'); page = ctx.new_page(); errs, malos = vigilar(page)
    page.goto(BASE + 'admin.html', wait_until='networkidle'); page.wait_for_timeout(800)
    ok(page.locator('.sidebar-footer .pa-tema-rapido button').count() == 3, 'menú lateral: selector Automático / Claro / Oscuro')
    page.click('.pa-tema-rapido [data-modo="oscuro"]'); page.wait_for_timeout(400)
    ok(page.evaluate("[document.documentElement.dataset.tema, localStorage.getItem('stmp-tema')]") == ['oscuro', 'oscuro'], 'menú lateral: cambia a oscuro y se guarda')
    page.evaluate("showTab('cuenta')"); page.wait_for_timeout(400)
    ok(page.locator('#paApariencia').is_visible() and page.locator('#paApariencia .pa-op.on[data-modo="oscuro"]').count() == 1, 'Mi cuenta: tarjeta Apariencia marca el tema actual')
    page.click('#paApariencia .pa-acento[data-a="esmeralda"]'); page.wait_for_timeout(300)
    acento = page.evaluate("[document.documentElement.dataset.acento, localStorage.getItem('stmp-acento'), getComputedStyle(document.documentElement).getPropertyValue('--p-accent').trim()]")
    ok(acento[0] == 'esmeralda' and acento[1] == 'esmeralda' and acento[2] not in ('', '#3776ec', '#2d6be4'), f'acento esmeralda aplicado y guardado {acento}')
    page.click('#paApariencia .pa-op[data-modo="claro"]'); page.wait_for_timeout(300)
    ok(page.locator('.pa-tema-rapido [data-modo="claro"].on').count() == 1, 'los dos selectores quedan sincronizados')
    page.evaluate("showTab('inventario')"); page.wait_for_timeout(300)
    page.mouse.wheel(0, 600); page.wait_for_timeout(300)
    ok(page.evaluate("document.body.classList.contains('pp-desplazado')"), 'encabezado translúcido se marca al hacer scroll')
    ok(not errs and not malos, f'computadora: sin errores ni 404 {errs[:2]} {malos[:3]}')
    ctx.close()

    # 4 · Celular: barra de pestañas, títulos grandes, hoja "Más" y ventanas deslizables
    ctx = contexto(b, 390, 844, 'claro'); page = ctx.new_page(); errs, malos = vigilar(page)
    page.goto(BASE + 'admin.html', wait_until='networkidle'); page.wait_for_timeout(1000)
    ok(page.locator('.pa-tabbar').is_visible() and page.locator('.pa-tab').count() == 5, 'celular: barra de pestañas con 5 botones')
    ok(not page.locator('.sidebar').is_visible() and not page.locator('.sidebar-toggle').is_visible(), 'celular: sin menú hamburguesa (lo reemplazan las pestañas)')
    page.tap('.pa-tab[data-tab="registrar"]'); page.wait_for_timeout(500)
    ok(page.evaluate("!document.getElementById('view-registrar').classList.contains('hidden')") and page.locator('.pa-tab.on[data-tab="registrar"]').count() == 1, 'celular: la pestaña abre su sección y queda marcada')
    page.evaluate("window.scrollTo(0, 500)"); page.wait_for_timeout(300)
    ok(page.evaluate("document.body.classList.contains('pp-titulo-chico')") and page.evaluate("document.querySelector('.topbar-title').textContent.trim()") .lower() == 'registrar prenda', 'celular: el título grande pasa a la barra de arriba')
    caja = page.locator('.admin-main').bounding_box()
    ok(caja['x'] == 0 and caja['width'] <= 390, f'celular: contenido a todo el ancho ({caja["x"]}, {caja["width"]})')
    page.tap('.pa-tab[data-tab="__mas"]'); page.wait_for_timeout(600)
    ok(page.locator('.pa-hoja.abierta').is_visible(), 'celular: "Más" abre la hoja')
    filas = page.evaluate("[...document.querySelectorAll('.pa-hoja .pa-fila[data-ir]')].map(f => f.dataset.ir)")
    ok(all(t in filas for t in ['sistema', 'ganancias', 'vendedores', 'cuenta']), f'"Más": todas las secciones del menú ({len(filas)})')
    page.tap('.pa-hoja [data-modo="oscuro"]'); page.wait_for_timeout(300)
    ok(page.evaluate("document.documentElement.dataset.tema") == 'oscuro', '"Más": cambiar a oscuro desde la hoja')
    page.tap('.pa-hoja .pa-fila[data-ir="sistema"]'); page.wait_for_timeout(800)
    ok(not page.locator('.pa-hoja.abierta').count() and page.evaluate("!document.getElementById('view-sistema').classList.contains('hidden')"), '"Más": ir a Sistema cierra la hoja')
    ok(page.locator('.pa-tab.on[data-tab="__mas"]').count() == 1, 'sección fuera de la barra → se marca "Más"')
    # Diálogo como hoja y cierre deslizando hacia abajo
    page.evaluate("(()=>{ uiConfirm({titulo:'Prueba', mensaje:'¿Seguro?', ok:'Sí'}); })()"); page.wait_for_timeout(600)
    r = page.evaluate("(()=>{const r=document.querySelector('.dlg.open').getBoundingClientRect(); return [r.bottom, innerHeight, r.left, r.width]})()")
    ok(abs(r[0] - r[1]) < 2 and r[2] == 0, f'celular: el diálogo sale como hoja desde abajo {r}')
    cdp = ctx.new_cdp_session(page)
    x, y = 195, page.evaluate("document.querySelector('.dlg.open').getBoundingClientRect().top + 10")
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    for i in range(1, 11):
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y + i * 22}]}); page.wait_for_timeout(16)
    cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []}); page.wait_for_timeout(600)
    ok(not page.evaluate("document.querySelector('.dlg').classList.contains('open')"), 'celular: deslizar hacia abajo cierra el diálogo')
    ok(page.evaluate("getComputedStyle(document.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=hidden])')).fontSize") == '16px', 'celular: campos de 16 px (iOS no hace zoom)')
    ok(not errs and not malos, f'celular: sin errores ni 404 {errs[:2]} {malos[:3]}')
    ctx.close()

    # 5 · Todas las secciones, en los dos temas, computadora y celular: sin errores y con contraste
    for tema in ['claro', 'oscuro']:
        for ancho, alto, nombre in [(1366, 900, 'compu'), (390, 844, 'celular')]:
            ctx = contexto(b, ancho, alto, tema); page = ctx.new_page(); errs, malos = vigilar(page)
            page.goto(BASE + 'admin.html', wait_until='networkidle'); page.wait_for_timeout(900)
            bajos = []
            for t in TABS:
                page.evaluate(f"showTab('{t}')"); page.wait_for_timeout(450)
                bajos += [f'{t}: {m}' for m in page.evaluate(CONTRASTE)]
            ok(not errs and not malos, f'[{tema} · {nombre}] 14 secciones sin errores ni 404 {errs[:2]} {malos[:3]}')
            ok(not bajos, f'[{tema} · {nombre}] texto con contraste ≥ 3:1 en todas las secciones {bajos[:4]}')
            ctx.close()

    # 6 · Vendedor: las pestañas y "Más" respetan sus permisos
    ctx = contexto(b, 390, 844, 'claro', sesion=VENDE, token='TV'); page = ctx.new_page(); errs, malos = vigilar(page)
    page.goto(BASE + 'admin.html', wait_until='networkidle'); page.wait_for_timeout(1000)
    page.tap('.pa-tab[data-tab="__mas"]'); page.wait_for_timeout(500)
    filas = page.evaluate("[...document.querySelectorAll('.pa-hoja .pa-fila[data-ir], .pa-tab[data-tab]')].map(f => f.dataset.ir || f.dataset.tab)")
    ok('sistema' not in filas and 'vendedores' not in filas and 'catalogo' not in filas, f'vendedor: no ve secciones de admin en pestañas ni en "Más" {filas}')
    ok(not errs, f'vendedor: sin errores {errs[:2]}')
    ctx.close()
    b.close()

pas = sum(1 for r in res if r[0])
print(f'\nRESULTADO v34: {pas} de {len(res)}')
sys.exit(0 if pas == len(res) else 1)
