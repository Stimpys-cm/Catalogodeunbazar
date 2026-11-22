#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────
#  herramientas/generar-tema.py — genera css/panel/tema-auto.css · v34
#
#  Lee TODAS las hojas de estilo del panel (en el orden del paquete
#  css/dist/admin.css de herramientas/paquetes.json) y, para cada regla con colores fijos:
#    · los grises, blancos, negros y el azul de la marca los cambia por los
#      tokens de css/panel/tema.css (así sirven en claro, oscuro y con cualquier acento)
#    · los colores de estado (verdes, ámbar, rojos, tintes pastel) les calcula
#      su versión para modo oscuro conservando el tono.
#  Los selectores van dentro de :where(...), que no suma especificidad: la
#  regla generada gana a la original solo por venir después, y css/panel/panel-pro.css
#  (que va al final) gana a las dos. No se toca ningún archivo original.
#
#  Uso:  pip install tinycss2   →   python3 herramientas/generar-tema.py
#  Hay que volver a correrlo si cambian los .css del panel, y después: npm run construir.
# ─────────────────────────────────────────────────────────────────────
import re, os, sys, math, json
import tinycss2

RAIZ = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
SALIDA = os.path.join(RAIZ, 'css', 'panel', 'tema-auto.css')
NO_PROCESAR = {'css/panel/tema.css', 'css/panel/tema-auto.css', 'css/panel/panel-pro.css',
               'css/comun/fuentes.css', 'css/panel/fuentes-panel.css'}

# ── Color: parseo y OKLab ────────────────────────────────────────────
NOMBRES = {'white': (255, 255, 255), 'black': (0, 0, 0)}
def hex_a_rgba(h):
    h = h.lstrip('#')
    if len(h) in (3, 4): h = ''.join(c * 2 for c in h)
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
    return (r, g, b, a)
def a_lineal(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def de_lineal(c):
    c = max(0.0, min(1.0, c))
    return round(255 * (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055))
def oklab(r, g, b):
    r, g, b = a_lineal(r), a_lineal(g), a_lineal(b)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l, m, s = l ** (1 / 3), m ** (1 / 3), s ** (1 / 3)
    L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
    B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    return L, math.hypot(A, B), math.degrees(math.atan2(B, A)) % 360
def desde_oklch(L, C, H):
    A, B = C * math.cos(math.radians(H)), C * math.sin(math.radians(H))
    l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
    m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
    s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return de_lineal(r), de_lineal(g), de_lineal(b)
def hexa(r, g, b, a=1.0):
    return f'#{r:02x}{g:02x}{b:02x}' if a >= 0.999 else f'rgba({r},{g},{b},{round(a, 3)})'

RE_COLOR = re.compile(r'#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b|rgba?\(\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*(?:[,/]\s*[\d.]+%?\s*)?\)|(?<![\w-])(?:white|black)(?![\w-])', re.I)
def parsear(txt):
    t = txt.lower()
    if t in NOMBRES: return (*NOMBRES[t], 1.0)
    if t.startswith('#'): return hex_a_rgba(t)
    n = re.findall(r'[\d.]+%?', t)
    def v(x, i): return float(x[:-1]) * (2.55 if i < 3 else 0.01) if x.endswith('%') else float(x)
    vals = [v(x, i) for i, x in enumerate(n)]
    return (round(vals[0]), round(vals[1]), round(vals[2]), vals[3] if len(vals) > 3 else 1.0)

# ── Papel de cada propiedad ──────────────────────────────────────────
def papel_prop(p):
    p = p.lower()
    if p in ('background', 'background-color', 'background-image'): return 'fondo'
    if p in ('color', 'fill', 'stroke', 'caret-color', 'text-decoration-color', '-webkit-text-fill-color', 'column-rule-color', 'accent-color'): return 'texto'
    if p.startswith('border') or p.startswith('outline'): return 'borde'
    if p in ('box-shadow', 'text-shadow', 'filter', '-webkit-box-shadow'): return 'sombra'
    return None
def papel_var(nombre, L):
    n = nombre.lower()
    if re.search(r'borde|border|line|rejilla|sep', n): return 'borde'
    if re.search(r'fondo|bg|papel|paper|card|cream|white|surface|gray|mid|-f$|soft|claro|tint', n): return 'fondo'
    if re.search(r'txt|text|tinta|ink|black|dark|muted|suave|tenue|gris', n): return 'texto'
    return 'fondo' if L > 0.7 else 'texto'

VARS_TINTA = re.compile(r'var\(--(vn-tinta|igx-txt|igx-rosa|igx-grad|zi-txt|text-dark|black|p-ink)\b')
def es_marca(L, C, H):   # el azul de STMP y sus variaciones
    return C > 0.06 and 238 <= H <= 275
def es_neutro(L, C, H):
    return C < 0.025 or (L < 0.32 and C < 0.05)

def tono_oscuro(L, C, H, papel, a=1.0):
    """Versión para modo oscuro de un color con tono (estados, pasteles)."""
    if papel == 'fondo':
        if L > 0.82 and C < 0.09:          # pastel → tinte oscuro del mismo tono
            r, g, b = desde_oklch(0.30, min(max(C * 1.6, 0.03), 0.06), H)
            return hexa(r, g, b, a)
        return None                         # colores sólidos (verde WhatsApp, amarillo…) se quedan
    if papel == 'texto':
        if L < 0.66:
            r, g, b = desde_oklch(0.80, min(C, 0.13), H)
            return hexa(r, g, b, a)
        return None
    if papel == 'borde':
        if L > 0.78:
            r, g, b = desde_oklch(0.42, min(C, 0.07), H)
            return hexa(r, g, b, a)
        if L < 0.5:
            r, g, b = desde_oklch(0.70, min(C, 0.13), H)
            return hexa(r, g, b, a)
        return None
    return None

def mapear(color_txt, papel, regla):
    """→ (valor_ambos, valor_oscuro). valor_oscuro None = no hace falta cambio extra."""
    r, g, b, a = parsear(color_txt)
    L, C, H = oklab(r, g, b)
    if a <= 0.001: return color_txt, None
    # Regla con fondo de color claro sólido (botón amarillo, etiqueta verde…): ese
    # fondo no cambia entre temas, así que su texto y su borde tampoco deben cambiar.
    if regla.get('fondo_color_claro') and papel in ('texto', 'borde'): return color_txt, None
    # Azul de la marca → tokens de acento (cambian con el color de acento elegido)
    if es_marca(L, C, H):
        if a < 0.999: return f'rgb(var(--p-accent-rgb) / {round(a, 3)})', None
        if papel == 'fondo' and L > 0.85: return 'var(--p-accent-soft)', None
        if papel == 'texto' and L < 0.5: return 'var(--p-accent-text)', None
        # Texto azul medio: igual en claro; en oscuro, el tono claro del acento (se lee mejor)
        if papel == 'texto' and L <= 0.7: return 'var(--p-accent)', 'var(--p-accent-text)'
        if L > 0.7: return 'var(--p-accent-2)', None
        return 'var(--p-accent)', None
    if not es_neutro(L, C, H):
        # Texto oscuro sobre un fondo de color claro sólido (botón amarillo): se queda igual
        if papel == 'texto' and regla.get('fondo_color_claro'): return color_txt, None
        return color_txt, tono_oscuro(L, C, H, papel, a)
    # ── Neutros ──
    if a < 0.999:
        oscuro_base = L < 0.45
        if papel == 'fondo':
            if oscuro_base: return color_txt, (f'rgba(255,255,255,{round(min(.16, a * 1.4), 3)})' if a <= .25 else f'rgba(0,0,0,{round(min(.78, a + .15), 3)})')
            # Blanco muy transparente = brillo sobre algo oscuro (visores, modales): se queda
            if a <= .3: return color_txt, None
            return color_txt, f'rgba(22,22,25,{round(a, 3)})'          # vidrio claro → vidrio oscuro
        if papel == 'borde':
            if not oscuro_base and a <= .3: return color_txt, None
            return color_txt, (f'rgba(255,255,255,{round(min(.2, a * 1.1), 3)})' if oscuro_base else f'rgba(255,255,255,{round(a * .35, 3)})')
        if papel == 'sombra':
            return color_txt, (f'rgba(0,0,0,{round(min(.7, a * 2.2), 3)})' if oscuro_base else f'rgba(255,255,255,{round(min(.06, a * .3), 3)})')
        if papel == 'texto':
            return color_txt, (f'rgba(242,242,245,{round(a, 3)})' if oscuro_base else None)
        return color_txt, None
    if papel == 'fondo':
        if L >= 0.993: return 'var(--p-surface)', None
        if L >= 0.975: return 'var(--p-surface-2)', None
        if L >= 0.955: return 'var(--p-fill-solid)', None
        if L >= 0.86: return 'var(--p-fill-solid-2)', None
        if L >= 0.55: return color_txt, '#4a4a51'
        if L >= 0.35: return color_txt, '#8a8a93'
        return color_txt, 'var(--p-raised)'                 # fondos negros: gris elevado en oscuro
    if papel == 'texto':
        if L >= 0.9:                                         # texto blanco
            return ('var(--p-on-ink)', None) if regla.get('fondo_tinta') else (color_txt, None)
        if L < 0.32: return 'var(--p-text)', None
        if L < 0.45: return color_txt, '#d4d4da'
        if L < 0.58: return 'var(--p-text-2)', None
        if L < 0.72: return 'var(--p-text-3)', None
        return 'var(--p-text-4)', None
    if papel == 'borde':
        if L >= 0.86: return 'var(--p-border-solid)', None
        if L >= 0.7: return color_txt, '#3a3a40'
        if L < 0.4: return 'var(--p-ink)', None
        return color_txt, '#5a5a62'
    if papel == 'sombra':
        return color_txt, ('#000000' if L < 0.4 else None)
    return color_txt, None

def reemplazar(valor, papel, regla):
    """Cambia cada color de un valor. → (ambos, oscuro|None)"""
    hubo_oscuro = False
    partes_a, partes_o, pos = [], [], 0
    for m in RE_COLOR.finditer(valor):
        partes_a.append(valor[pos:m.start()]); partes_o.append(valor[pos:m.start()])
        ambos, osc = mapear(m.group(0), papel, regla)
        partes_a.append(ambos)
        partes_o.append(osc if osc is not None else ambos)
        if osc is not None: hubo_oscuro = True
        pos = m.end()
    partes_a.append(valor[pos:]); partes_o.append(valor[pos:])
    return ''.join(partes_a), (''.join(partes_o) if hubo_oscuro else None)

# ── Selectores ───────────────────────────────────────────────────────
def con_alcance(sel, alcance):
    out = []
    for s in sel.split(','):
        s = s.strip()
        if not s: continue
        if re.match(r'^html\b', s):
            out.append(re.sub(r'^html', f'html:where({alcance})', s, count=1))
        elif s.startswith(':root'):
            out.append(f':root:where({alcance})' + s[5:])
        else:
            out.append(f':where(html{alcance}) {s}')
    return ', '.join(out)

def separar_selectores(prelude):
    # comas de nivel superior (no dentro de paréntesis)
    s = tinycss2.serialize(prelude).strip()
    partes, prof, act = [], 0, ''
    for ch in s:
        if ch == '(': prof += 1
        elif ch == ')': prof -= 1
        if ch == ',' and prof == 0: partes.append(act); act = ''
        else: act += ch
    partes.append(act)
    return ','.join(p.strip() for p in partes if p.strip())

# ── Recorrido ────────────────────────────────────────────────────────
estad = {'reglas': 0, 'decl': 0, 'tokens': 0, 'oscuro': 0}
def procesar(reglas, salida, saltar_vars, origen):
    for r in reglas:
        if r.type == 'at-rule':
            kw = r.lower_at_keyword
            if kw in ('media', 'supports', 'layer', 'container') and r.content is not None:
                hijo = []
                procesar(tinycss2.parse_rule_list(r.content, skip_comments=True, skip_whitespace=True), hijo, saltar_vars, origen)
                if hijo: salida.append(f'@{kw} {tinycss2.serialize(r.prelude).strip()} {{\n' + '\n'.join(hijo) + '\n}')
            continue
        if r.type != 'qualified-rule': continue
        sel = separar_selectores(r.prelude)
        if not sel or re.search(r'::?-webkit-scrollbar|@', sel): pass
        decls = [d for d in tinycss2.parse_declaration_list(r.content, skip_comments=True, skip_whitespace=True) if d.type == 'declaration']
        # Contexto de la regla: ¿su fondo es "tinta" (se vuelve claro en oscuro) o un color claro sólido?
        regla = {}
        for d in decls:
            if papel_prop(d.lower_name) == 'fondo':
                v = tinycss2.serialize(d.value)
                if VARS_TINTA.search(v): regla['fondo_tinta'] = True
                m = RE_COLOR.search(v)
                if m:
                    rr, gg, bb, aa = parsear(m.group(0)); L, C, H = oklab(rr, gg, bb)
                    if aa > .9 and C >= 0.08 and L > 0.7 and not es_marca(L, C, H): regla['fondo_color_claro'] = True
        ambos, oscuro = [], []
        for d in decls:
            nombre = d.lower_name if not d.name.startswith('--') else d.name
            valor = tinycss2.serialize(d.value).strip()
            imp = ' !important' if d.important else ''
            if nombre.startswith('--'):
                if nombre in saltar_vars: continue
                m = RE_COLOR.search(valor)
                if not m or 'gradient' in valor and False: continue
                rr, gg, bb, aa = parsear(m.group(0)); L, _, _ = oklab(rr, gg, bb)
                papel = papel_var(nombre, L)
            else:
                papel = papel_prop(nombre)
                if not papel: continue
                if not RE_COLOR.search(valor) and 'var(' not in valor: continue
            estad['decl'] += 1
            a, o = reemplazar(valor, papel, regla)
            # Texto con el acento como variable (var(--accent)): en oscuro, el tono claro del acento
            if papel == 'texto' and o is None and re.fullmatch(r'var\(--(accent|p-accent)(\s*,[^)]*)?\)', valor):
                o = 'var(--p-accent-text)'
            # Texto blanco con fondo "tinta" se vuelve var(--p-on-ink) aunque el valor sea 'white'
            ambos.append(f'  {nombre}: {a}{imp};')
            if a != valor: estad['tokens'] += 1
            if o is not None: oscuro.append(f'  {nombre}: {o}{imp};'); estad['oscuro'] += 1
        if not ambos: continue
        estad['reglas'] += 1
        salida.append(f'{con_alcance(sel, "[data-tema]")} {{\n' + '\n'.join(ambos) + '\n}')
        if oscuro: salida.append(f'{con_alcance(sel, chr(91) + "data-tema=" + chr(34) + "oscuro" + chr(34) + chr(93))} {{\n' + '\n'.join(oscuro) + '\n}')

def hojas_del_panel():
    # El orden es el del paquete del panel (el mismo en que el navegador las lee)
    paquetes = json.load(open(os.path.join(RAIZ, 'herramientas', 'paquetes.json'), encoding='utf8'))
    return [(ruta, open(os.path.join(RAIZ, ruta), encoding='utf8').read())
            for ruta in paquetes['css/dist/admin.css'] if ruta not in NO_PROCESAR]

def main():
    tema = open(os.path.join(RAIZ, 'css', 'panel', 'tema.css'), encoding='utf8').read()
    saltar = set(re.findall(r'(--[\w-]+)\s*:', tema))
    salida = ['/* GENERADO por herramientas/generar-tema.py — no editar a mano. Ver css/panel/tema.css y css/panel/panel-pro.css. */']
    for ruta, texto in hojas_del_panel():
        bloque = []
        procesar(tinycss2.parse_stylesheet(texto, skip_comments=True, skip_whitespace=True), bloque, saltar, ruta)
        if bloque: salida.append(f'\n/* ── {ruta} ── */\n' + '\n'.join(bloque))
    open(SALIDA, 'w', encoding='utf8').write('\n'.join(salida) + '\n')
    print(json.dumps(estad), f'{os.path.getsize(SALIDA) // 1024} KB →', os.path.relpath(SALIDA, RAIZ))

if __name__ == '__main__': main()
