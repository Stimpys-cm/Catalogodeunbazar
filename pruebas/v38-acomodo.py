# Pruebas del acomodo de la tienda (v38) en Chrome real
#   node pruebas/correr.mjs --servidor   (en otra terminal)
#   python3 pruebas/v38-acomodo.py
# Revisa que encabezado, hero, secciones, banners y pie empiecen y terminen en la
# misma línea en varios anchos, sin scroll de lado, y los arreglos del celular.
import datetime, sys
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8766/'
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)

def esperado(w):
    m = 14 if w <= 380 else 16 if w <= 600 else 24 if w <= 1024 else 40
    return max(m, (w - 1200) / 2)

# Qué tiene que quedar en la línea de cada página: [selector, revisar también el borde derecho]
LINEA = {
    'inicio.html': [('.header-row .logo', False), ('#heroTitulo', False), ('.h-section:not(.hidden) .h-section-head', True),
                    ('.h-about', True), ('.h-faq details', True), ('.h-cta', True), ('.sf-inner > :first-child', False)],
    'tienda.html': [('.header-row .logo', False), ('.shop-toolbar > :first-child', False), ('.sf-inner > :first-child', False)],
    'prenda.html?id=7': [('.header-row .logo', False), ('.pp-crumbs > :first-child', False), ('#ppSeccionSimilares .h-section-head', True), ('.sf-inner > :first-child', False)],
    'cuenta.html': [('.header-row .logo', False), ('.ct-wrap > :first-child', False), ('.sf-inner > :first-child', False)],
    'carrito.html': [('.header-row .logo', False), ('.cr .ck-pasos', False), ('.cr-card', False), ('.sf-inner > :first-child', False)],
    'pagar.html?bazar=1': [('.header-row .logo', False), ('main.ck h1', False), ('.sf-inner > :first-child', False)],
}
JS_BORDE = """([s, der]) => { const e = document.querySelector(s); if (!e) return null;
  const r = e.getBoundingClientRect(); if (!r.width) return null;
  return [r.left, innerWidth - r.right, der]; }"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    errores = []

    # 1 · Todo en la misma línea, en seis anchos
    for w in (1440, 1280, 1024, 768, 390, 360):
        movil = w < 600
        ctx = b.new_context(viewport={'width': w, 'height': 900}, is_mobile=movil, has_touch=movil, reduced_motion='reduce')
        ctx.add_init_script("localStorage.setItem('bazar_wishlist', JSON.stringify([{id:7,bazarId:1},{id:8,bazarId:1}]))")
        for pag, sels in LINEA.items():
            pg = ctx.new_page(); pg.on('pageerror', lambda e, pag=pag: errores.append(f'{pag}: {str(e)[:120]}'))
            pg.goto(BASE + pag, wait_until='load'); pg.wait_for_timeout(1600)
            e = esperado(w); malos = []
            for s, der in sels:
                r = pg.evaluate(JS_BORDE, [s, der])
                if r is None: malos.append(f'{s}: no está'); continue
                if abs(r[0] - e) > 1.5: malos.append(f'{s} izq {r[0]:.0f}')
                if der and abs(r[1] - e) > 1.5: malos.append(f'{s} der {r[1]:.0f}')
            ok(not malos, f'[{w}px] {pag.split("?")[0]}: todo empieza en {e:.0f} px {malos[:3]}')
            sw = pg.evaluate("document.documentElement.scrollWidth - innerWidth")
            ok(sw <= 0, f'[{w}px] {pag.split("?")[0]}: sin scroll de lado ({sw})')
            pg.close()
        ctx.close()

    # 2 · Inicio en compu: hero equilibrado, sin botones repetidos, mismo espacio y esquinas
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}, reduced_motion='reduce'); pg = ctx.new_page()
    pg.goto(BASE + 'inicio.html', wait_until='load'); pg.wait_for_timeout(1600)
    cols = pg.evaluate("getComputedStyle(document.querySelector('.h-hero-inner')).gridTemplateColumns.split(' ').map(parseFloat)")
    ok(len(cols) == 2 and abs(cols[0] - cols[1]) < 2, f'hero: dos columnas iguales {cols}')
    ok(pg.evaluate("getComputedStyle(document.querySelector('.h-hero-inner')).alignItems") == 'center', 'hero: columnas centradas a la misma altura')
    ok(pg.locator('.h-tabs').count() == 0, 'hero: sin los botones repetidos "Explorar / Catálogo"')
    seps = pg.evaluate("[...document.querySelectorAll('main > section.h-section:not(.hidden)')].map(s => getComputedStyle(s).paddingTop)")
    ok(len(set(seps)) == 1 and len(seps) >= 8, f'mismo espacio entre las {len(seps)} secciones {sorted(set(seps))}')
    radios = pg.evaluate("""[['.h-card','.h-cat','.h-stat','.h-step','.h-fact','.h-faq details','.hb-card'], ['.h-about','.h-cta','.h-vender']]
      .map(g => [...new Set(g.flatMap(s => [...document.querySelectorAll(s)].map(e => getComputedStyle(e).borderTopLeftRadius)))])""")
    ok(radios[0] == ['16px'] and radios[1] == ['24px'], f'mismas esquinas: tarjetas {radios[0]} · bloques {radios[1]}')
    logo = pg.evaluate("(() => { const l = document.querySelector('.header-row .logo'); const sp = [...l.children].filter(c => c.getBoundingClientRect().width); return [l.textContent.replace(/\\s+/g,''), Math.round(sp[sp.length-1].getBoundingClientRect().left - sp[0].getBoundingClientRect().right)] })()")
    ok(logo[1] <= 1, f'logo: el punto va pegado al nombre {logo}')
    anio = pg.evaluate("document.getElementById('anioActual')?.textContent")
    ok(anio == str(datetime.date.today().year), f'año del pie al día ({anio})')
    ctx.close()

    # 3 · Inicio en celular
    for w in (390, 360, 320):
        ctx = b.new_context(viewport={'width': w, 'height': 800}, is_mobile=True, has_touch=True, reduced_motion='reduce'); pg = ctx.new_page()
        pg.goto(BASE + 'inicio.html', wait_until='load'); pg.wait_for_timeout(1600)
        ceja = pg.evaluate("(() => { const s = getComputedStyle(document.querySelector('.h-hero-top'), '::before'); return [s.textAlign, s.alignSelf] })()")
        ok(ceja[0] in ('left', 'start') and ceja[1] == 'flex-start', f'[{w}px] "Página oficial · Reynosa" alineado a la izquierda {ceja}')
        bt = pg.evaluate("[...document.querySelectorAll('.h-cta-row .h-btn')].map(b => Math.round(b.getBoundingClientRect().width))")
        ok(len(bt) == 2 and bt[0] == bt[1], f'[{w}px] los dos botones del hero del mismo ancho {bt}')
        lg = pg.evaluate("(() => { const l = document.querySelector('.header-row .logo'); const r = l.getBoundingClientRect(); return [Math.round(r.height), parseFloat(getComputedStyle(l).lineHeight) || parseFloat(getComputedStyle(l).fontSize) * 1.3] })()")
        ok(lg[0] <= lg[1] * 1.35, f'[{w}px] "STIIMPYS." en una sola línea {lg}')
        fuera = pg.evaluate("[...document.querySelectorAll('.header-row > *, .header-actions > *')].filter(e => e.getBoundingClientRect().width && e.getBoundingClientRect().right > innerWidth - 1).map(e => e.className)")
        ok(not fuera, f'[{w}px] nada del encabezado se sale de la pantalla {fuera}')
        ctx.close()

    # 4 · Estadísticas: si llega el inventario nuevo mientras cuentan, se quedan con el número real
    ctx = b.new_context(viewport={'width': 1280, 'height': 1500}); pg = ctx.new_page()
    pg.on('pageerror', lambda e: errores.append(f'inicio (conteo): {str(e)[:120]}'))
    pg.goto(BASE + 'inicio.html', wait_until='load')
    pg.wait_for_function("/\\d/.test(document.getElementById('statPrendas').textContent) && document.getElementById('statPrendas').dataset.contado")
    pg.evaluate("""(() => { const db = getDB(); const quitar = db.filter(p => !p.vendido && !p.oculto).slice(0, 3);
      quitar.forEach(p => p.vendido = true);
      window.dispatchEvent(new CustomEvent('db:inventario', { detail: db })); })()""")
    pg.wait_for_timeout(1600)
    st = pg.evaluate("[document.getElementById('statPrendas').textContent.trim(), document.querySelector('.hb-meta b')?.textContent.trim(), getDB().filter(p => !p.vendido && !p.oculto).length]")
    ok(st[0] == st[1] == str(st[2]), f'tarjeta del hero y estadística con el mismo número {st}')
    ctx.close()

    ok(not errores, f'sin errores de JavaScript {errores[:3]}')
    b.close()

pas = sum(1 for r in res if r[0])
print(f'\nRESULTADO v38: {pas} de {len(res)}')
sys.exit(0 if pas == len(res) else 1)
