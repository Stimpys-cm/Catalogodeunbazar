# Pruebas v39 en Chrome real: todas las páginas públicas con la estética del inicio,
# marca Stiimpys, sin "otros bazares" y sin transparencias al pasar el mouse.
#   node pruebas/correr.mjs --servidor   (en otra terminal)
#   python3 pruebas/v39-estetica.py
import re, sys
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:8766/'
res = []
def ok(c, m):
    res.append((bool(c), m)); print(('PASS ' if c else 'FAIL ') + m)

PAGINAS = ['inicio.html', 'tienda.html', 'prenda.html?id=7', 'cuenta.html', 'terminos.html', 'carrito.html', 'pagar.html?bazar=1']
PROHIBIDO = re.compile(r'STMP|bazares independientes|Forma parte de Stiimpys|Vende con nosotros|Los bazares|Súmate a Stiimpys', re.I)
CHROME = """() => {
  const cs = s => { const e = document.querySelector(s); return e ? getComputedStyle(e) : null; };
  const logo = document.querySelector('.header-row .logo');
  const cta = document.querySelector('.header-actions .h-nav-cta');
  return {
    home: document.documentElement.classList.contains('home'),
    ticker: document.querySelector('.ticker-track span')?.textContent.trim(),
    logo: logo ? logo.textContent.replace(/\\s+/g, '') : null,
    logoHref: logo?.getAttribute('href'),
    logoFont: cs('.header-row .logo')?.fontFamily.split(',')[0].replace(/"/g, ''),
    carrito: !!document.getElementById('wishlistHeaderBtn'), cuenta: !!document.getElementById('cuentaSlot'),
    ig: !!document.querySelector('.header-actions .h-nav-ig[href*="instagram.com/stiimpys"]'),
    cta: cta ? [cta.textContent.replace(/\\s+/g, ' ').trim().toLowerCase(), cta.getAttribute('href'), getComputedStyle(cta).backgroundColor] : null,
    headerBg: cs('body > header')?.backgroundColor,
    pieBg: cs('footer.site-footer')?.backgroundColor,
    pieLogo: document.querySelector('.sf-logo')?.textContent.trim() || (document.querySelector('.sf-logo img')?.getAttribute('src') || '').includes('logo-blanco') && 'LOGO',
    logoImg: !!document.querySelector('.header-row .logo img.logo-img'),
    pieCols: [...document.querySelectorAll('.sf-col :is(h2, h3)')].map(h => h.textContent.trim()),
    multi: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => /redes\\.html|vender\\.html|#unete/.test(h)),
    texto: document.body.innerText,
  };
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    errores = []

    # 1 · Mismo encabezado, pie y marca en todas las páginas públicas
    ctx = b.new_context(viewport={'width': 1280, 'height': 900})
    ctx.add_init_script("localStorage.setItem('bazar_wishlist', JSON.stringify([{id:7,bazarId:1},{id:8,bazarId:1}]))")
    ref = None
    for pag in PAGINAS:
        pg = ctx.new_page(); pg.on('pageerror', lambda e, pag=pag: errores.append(f'{pag}: {str(e)[:120]}'))
        pg.goto(BASE + pag, wait_until='load'); pg.wait_for_timeout(1800)
        d = pg.evaluate(CHROME); n = pag.split('?')[0]
        if ref is None: ref = d
        ok(d['home'] and d['ticker'] == 'Stiimpys · Página oficial', f'{n}: misma cinta de arriba que el inicio')
        # v42: el logo de Stiimpys (imagen) + el nombre; antes era solo el texto "STIIMPYS."
        ok(d['logoImg'] and d['logo'] in ('STIIMPYS', 'STIIMPYS.'), f'{n}: logo de Stiimpys con su nombre ({d["logo"]})')
        ok(d['logoHref'] == 'inicio.html', f'{n}: el logo lleva al inicio')
        ok(d['logoFont'] == 'Bebas Neue' and d['headerBg'] == ref['headerBg'], f'{n}: encabezado con la letra y el fondo del inicio')
        ok(d['carrito'] and d['cuenta'] and d['ig'], f'{n}: carrito, cuenta e Instagram en el encabezado')
        esperado = ['inicio', 'inicio.html'] if n == 'tienda.html' else ['ver catálogo', 'tienda.html']
        ok(d['cta'] and d['cta'][:2] == esperado and d['cta'][2] == ref['cta'][2], f'{n}: botón negro del encabezado ({d["cta"] and d["cta"][0]})')
        ok(d['pieBg'] == ref['pieBg'] and d['pieLogo'] in ('STIIMPYS.', 'LOGO') and d['pieCols'] == ['Comprar', 'Stiimpys', 'Legal'], f'{n}: el mismo pie oscuro del inicio')
        malas = PROHIBIDO.findall(d['texto'])
        ok(not malas, f'{n}: sin "STMP MARKET" ni textos de otros bazares {malas[:3]}')
        ok(not d['multi'], f'{n}: sin enlaces a "Los bazares" ni a "Vende con nosotros" {d["multi"][:2]}')
        pg.close()

    # 2 · Inicio sin "Forma parte de Stiimpys"
    pg = ctx.new_page(); pg.goto(BASE + 'inicio.html', wait_until='load'); pg.wait_for_timeout(1200)
    ok(pg.locator('#unete, .h-hero-unete, .h-vender').count() == 0, 'inicio: sin la sección ni el enlace "Forma parte de Stiimpys"')
    ok('¿Puedo vender mis prendas' not in pg.inner_text('body'), 'inicio: sin la pregunta "¿Puedo vender mis prendas?"')
    pg.close()

    # 3 · Los títulos de las demás páginas con el fondo del hero del inicio
    for pag in ['tienda.html', 'cuenta.html', 'terminos.html']:
        pg = ctx.new_page(); pg.goto(BASE + pag, wait_until='load'); pg.wait_for_timeout(1200)
        h = pg.evaluate("""(() => { const s = getComputedStyle(document.querySelector('main .hero.h-shop-hero'));
          const g = getComputedStyle(document.querySelector('main .hero.h-shop-hero'), '::before');
          const c = document.querySelector('.h-crumb'); const cs = getComputedStyle(c);
          return [s.backgroundImage.includes('radial-gradient'), g.backgroundImage.includes('linear-gradient'), cs.borderTopWidth, c.getAttribute('href')] })()""")
        ok(h[0] and h[1] and h[2] == '0px' and h[3] == 'inicio.html', f'{pag}: título con el fondo del inicio y "Volver al inicio" como la ceja azul {h}')
        pg.close()

    # 4 · Nada se transparenta al pasar el mouse
    candidatos = ['.header-actions .h-nav-cta', '.hb-btn-primary', '.h-btn-primary', '.pp-btn-wa', '.tp-comprar', '.empty-cta', '.hero-slugs a', '.cr-btn', '.h-card', '.card']
    for pag in ['inicio.html', 'tienda.html', 'prenda.html?id=7', 'carrito.html']:
        pg = ctx.new_page(); pg.goto(BASE + pag, wait_until='load'); pg.wait_for_timeout(1500)
        revisados, malos = 0, []
        for sel in candidatos:
            loc = pg.locator(sel)
            if not loc.count(): continue
            el = loc.first
            try:
                el.scroll_into_view_if_needed(timeout=2000)
                if not el.is_visible(): continue
                el.hover(timeout=2000); pg.wait_for_timeout(450)
            except Exception:
                continue
            op = el.evaluate("e => [getComputedStyle(e).opacity, getComputedStyle(e, '::before').opacity, getComputedStyle(e).filter]")
            revisados += 1
            if op[0] != '1' or (sel in ('.card', '.h-card') and float(op[1] or 0) > 0.01): malos.append(f'{sel}={op}')
        ok(revisados >= 2 and not malos, f'{pag.split("?")[0]}: al pasar el mouse nada baja su opacidad ({revisados} revisados) {malos[:3]}')
        pg.close()

    # 5 · Sin la etiqueta "@stiimpys" en cada tarjeta (una sola tienda)
    pg = ctx.new_page(); pg.goto(BASE + 'tienda.html', wait_until='load'); pg.wait_for_timeout(1500)
    vis = pg.evaluate("[...document.querySelectorAll('.card-bazar-row')].filter(e => getComputedStyle(e).display !== 'none').length")
    ok(vis == 0, f'catálogo: sin la etiqueta del bazar en cada tarjeta ({vis})')
    ok(pg.locator('.fchk[data-key="bazares"]').count() == 0, 'catálogo: sin el filtro "Bazar"')
    pg.close()

    # 6 · Buscar desde cualquier página lleva al catálogo
    pg = ctx.new_page(); pg.goto(BASE + 'terminos.html', wait_until='load'); pg.wait_for_timeout(1000)
    pg.fill('header input[name="q"]', 'Levi'); pg.press('header input[name="q"]', 'Enter'); pg.wait_for_load_state('load'); pg.wait_for_timeout(1500)
    ok('tienda.html?q=Levi' in pg.url and pg.input_value('#searchInput') == 'Levi', f'buscar desde Términos abre el catálogo filtrado ({pg.url.split("/")[-1]})')
    pg.close()

    # 7 · Carrito viejo con una prenda de otro bazar: queda dentro de Stiimpys como "ya no está"
    ctx2 = b.new_context(viewport={'width': 1280, 'height': 900})
    ctx2.add_init_script("localStorage.setItem('bazar_wishlist', JSON.stringify([{id:7,bazarId:1},{id:999,bazarId:2,nombre:'Gorra de otro bazar'}]))")
    pg = ctx2.new_page(); pg.on('pageerror', lambda e: errores.append(f'carrito viejo: {str(e)[:120]}'))
    pg.goto(BASE + 'carrito.html', wait_until='load'); pg.wait_for_timeout(2500)
    ok(pg.locator('.cr-card').count() == 1 and pg.locator('.cr-varios').count() == 0, 'carrito: un solo grupo (Stiimpys), sin "prendas de 2 bazares"')
    ok('Ya no está en la tienda' in pg.inner_text('.cr-lista') and 'Gorra de otro bazar' in pg.inner_text('.cr-lista'), 'la prenda de otro bazar sale como "Ya no está en la tienda"')
    ctx2.close()

    # 8 · 404 con la estética del inicio
    pg = ctx.new_page(); pg.goto(BASE + '404.html', wait_until='load'); pg.wait_for_timeout(600)
    t = pg.inner_text('body')
    ok('STIIMPYS' in t and 'STMP' not in t and pg.locator('a[href="/inicio.html"]').count() >= 2, '404: logo Stiimpys y botones al inicio')
    pg.close()
    ctx.close()

    # 9 · Celular: barra de abajo del catálogo con "Cuenta" en lugar de "Bazares"
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); pg.goto(BASE + 'tienda.html', wait_until='load'); pg.wait_for_timeout(1200)
    items = pg.evaluate("[...document.querySelectorAll('.bottom-nav .bn-item')].map(a => (a.getAttribute('href') || 'carrito') + ':' + a.textContent.trim())")
    ok(items == ['inicio.html:Inicio', 'carrito:Carrito0', 'cuenta.html:Cuenta'] or [i.split(':')[0] for i in items] == ['inicio.html', 'carrito', 'cuenta.html'], f'barra de abajo: Inicio · Carrito · Cuenta {items}')
    ctx.close()

    ok(not errores, f'sin errores de JavaScript {errores[:3]}')
    b.close()

pas = sum(1 for r in res if r[0])
print(f'\nRESULTADO v39: {pas} de {len(res)}')
sys.exit(0 if pas == len(res) else 1)
