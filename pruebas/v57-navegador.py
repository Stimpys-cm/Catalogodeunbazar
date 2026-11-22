# Pruebas v57 en el navegador: barrido de errores y SEO en todas las páginas.
# - Cada página pública: un solo H1 (catálogo, cuenta y términos no tenían) y encabezados sin saltos
#   (la portada y el pago saltaban de H1 a H3).
# - Todas las imágenes con alt; ningún id repetido; ningún error de JavaScript.
# - Ningún link interno roto (se revisan todos los de todas las páginas).
# - Pregunta frecuente "¿Qué formas de pago aceptan?" con lo marcado en el panel.
# - Panel: todas las secciones (y las de Ventas) abren sin errores ni ids repetidos.
# (servidor local: node pruebas/correr.mjs --servidor)   python3 pruebas/v57-navegador.py
import json, re
from urllib.parse import urljoin
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8766/'
ADMIN = json.dumps({'id': 1, 'username': 'admin', 'role': 'admin', 'sessionToken': 'TA', 'bazarId': None})
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)
def es_ruido(t):   # fotos de Cloudinary que aquí no se descargan
    return 'ERR_TUNNEL' in t or 'ERR_NAME_NOT_RESOLVED' in t or 'ViewTransition' in t
REVISAR = """() => {
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(h => ({ n: +h.tagName[1], t: h.textContent.trim().slice(0, 40) }));
  const saltos = []; let prev = 0;
  for (const h of hs) { if (prev && h.n > prev + 1) saltos.push(`h${prev}→h${h.n} "${h.t}"`); prev = h.n; }
  const sinAlt = [...document.images].filter(i => !i.hasAttribute('alt')).map(i => (i.className || '') + ' ' + (i.getAttribute('src') || '').slice(-40));
  const ids = {}; document.querySelectorAll('[id]').forEach(e => ids[e.id] = (ids[e.id] || 0) + 1);
  const links = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h && !/^(https?:|mailto:|tel:|#|javascript:|data:)/.test(h));
  return { h1: hs.filter(h => h.n === 1).length, primero: hs[0]?.n || 0, saltos, sinAlt, dup: Object.entries(ids).filter(([, v]) => v > 1).map(([k, v]) => k + '×' + v), links: [...new Set(links)] };
}"""

with sync_playwright() as p:
    b = p.chromium.launch()
    for ancho, movil in [(1366, False), (390, True)]:
        tag = 'celular' if movil else 'compu'
        ctx = b.new_context(viewport={'width': ancho, 'height': 900}, is_mobile=movil, has_touch=movil)
        page = ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append((page.url.split('/')[-1], str(e)[:140])) if not es_ruido(str(e)) else None)
        page.on('console', lambda m: errs.append((page.url.split('/')[-1], m.text[:140])) if m.type == 'error' and not es_ruido(m.text) else None)
        page.goto(BASE, wait_until='load'); page.wait_for_timeout(2200)
        ok('Streetwear' in page.title() and page.url.rstrip('/') + '/' == BASE, f'{tag}: "/" abre la portada sin cambiar de dirección')
        pid = page.evaluate("() => (getDB().find(x => !x.vendido) || {}).id")
        vid = page.evaluate("() => (getDB().find(x => x.vendido) || {}).id")
        page.evaluate(f"() => localStorage.setItem('bazar_wishlist', JSON.stringify([getDB().find(x => x.id === {pid})]))")
        todos = set()
        for pg in ['inicio.html', 'tienda.html', f'prenda.html?id={pid}', f'prenda.html?id={vid}', 'carrito.html', 'pagar.html', 'cuenta.html', 'terminos.html', '404.html']:
            page.goto(BASE + pg, wait_until='load'); page.wait_for_timeout(2000)
            r = page.evaluate(REVISAR)
            for l in r['links']: todos.add(urljoin(BASE + pg, l).split('#')[0])
            ok(r['h1'] == 1 and r['primero'] == 1, f'{tag} {pg}: un solo H1 y es el primer encabezado ({r["h1"]})')
            ok(not r['saltos'], f'{tag} {pg}: encabezados sin saltos {r["saltos"][:2]}')
            ok(not r['sinAlt'], f'{tag} {pg}: todas las imágenes con alt {r["sinAlt"][:2]}')
            ok(not r['dup'], f'{tag} {pg}: sin ids repetidos {r["dup"][:3]}')
        if not movil:
            rotos = []
            for u in sorted(todos):
                if u.startswith(BASE) and page.request.get(u).status >= 400: rotos.append(u)
            ok(not rotos, f'los {len(todos)} links internos funcionan {rotos[:3]}')
            page.goto(BASE + 'inicio.html', wait_until='load'); page.wait_for_timeout(2000)
            faq = page.locator('[data-formas-pago-faq]')
            ok(faq.text_content().startswith('Aceptamos tarjeta, efectivo y transferencia. Con tarjeta de crédito o débito pagas en línea'), 'FAQ: "¿Qué formas de pago aceptan?" con lo marcado')
            page.evaluate("() => { window.formasPago = () => ({ tarjeta: true, efectivo: true, transferencia: false }); FormasPago.pintar(); }")
            ok(faq.text_content() == 'Aceptamos tarjeta y efectivo. Con tarjeta de crédito o débito pagas en línea desde la página; y en efectivo, al recoger tu compra en persona en Reynosa.', 'si quitas transferencia, la respuesta cambia sola')
            ok(page.locator('.h-faq details').count() >= 11, f'preguntas frecuentes: {page.locator(".h-faq details").count()} (más texto útil en la portada)')
        ok(not errs, f'{tag}: sin errores de JavaScript en la tienda {errs[:2]}')
        ctx.close()

    # ── Panel: todas las secciones
    ctx = b.new_context(viewport={'width': 1366, 'height': 900})
    ctx.add_cookies([{'name': 'sesion', 'value': 'TA', 'url': BASE}]); ctx.add_init_script(f"localStorage.setItem('stiimpys_session', {json.dumps(ADMIN)});")
    pp = ctx.new_page(); perrs = []
    pp.on('pageerror', lambda e: perrs.append(str(e)[:140]) if not es_ruido(str(e)) else None)
    pp.on('console', lambda m: perrs.append(m.text[:140]) if m.type == 'error' and not es_ruido(m.text) else None)
    pp.on('response', lambda r: perrs.append(f'{r.status} {r.url[:90]}') if r.status >= 400 and 'cloudinary' not in r.url and 'instagram' not in r.url else None)
    pp.goto(BASE + 'admin.html', wait_until='load'); pp.wait_for_timeout(3000)
    tabs = pp.evaluate("() => [...TABS_VALIDAS]")
    dups = []
    for t in tabs:
        pp.evaluate(f"() => showTab('{t}')"); pp.wait_for_timeout(700)
        d = pp.evaluate("() => { const ids = {}; document.querySelectorAll('[id]').forEach(e => ids[e.id] = (ids[e.id] || 0) + 1); return Object.entries(ids).filter(([, v]) => v > 1).map(([k, v]) => k + '×' + v); }")
        if d: dups.append((t, d[:4]))
    pp.evaluate("() => showTab('ventas')"); pp.wait_for_timeout(800)
    secs = pp.evaluate("() => vnSeccionesOrden(true).map(x => x[0])")
    for s in secs:
        pp.evaluate(f"() => vnIr('{s}')"); pp.wait_for_timeout(600)
    ok(len(tabs) >= 14 and len(secs) >= 8, f'panel: se abrieron {len(tabs)} secciones y {len(secs)} de Ventas')
    ok(not dups, f'panel: sin ids repetidos {dups[:2]}')
    ok(not perrs, f'panel: sin errores {perrs[:3]}')
    b.close()

n = sum(1 for c, _ in res if c)
print(f'\nRESULTADO: {n} de {len(res)} pruebas pasaron')
