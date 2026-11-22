// ─────────────────────────────────────────────────────────────
//  js/tienda/origen.js — De dónde llegó el cliente · v42
//
//  Lee ?utm_source / ?utm_medium / ?utm_campaign (o ?o=qr de las etiquetas)
//  y la página de la que venía. Guarda la última fuente 30 días en este
//  navegador (stmp-origen) y la manda con el pago para saber qué red vende.
//  Cuenta una "llegada" por sesión. No guarda nada personal.
// ─────────────────────────────────────────────────────────────
(() => {
  const K = 'stmp-origen', DIAS = 30;
  const leer = () => { try { const o = JSON.parse(localStorage.getItem(K) || 'null'); return o && Date.now() - o.en < DIAS * 864e5 ? o : null; } catch { return null; } };
  const corto = (v, n) => String(v || '').slice(0, n);
  let actual = null;
  try {
    const q = new URLSearchParams(location.search);
    let ref = '';
    try { const r = document.referrer ? new URL(document.referrer) : null; if (r && r.host !== location.host) ref = r.hostname; } catch {}
    const fuente = q.get('utm_source') || (q.get('o') === 'qr' ? 'qr' : '');
    if (fuente || ref) {
      actual = { fuente: corto(fuente, 40), medio: corto(q.get('utm_medium'), 30), campana: corto(q.get('utm_campaign'), 60), ref: corto(ref, 80), en: Date.now() };
      try { localStorage.setItem(K, JSON.stringify(actual)); } catch {}
    }
    // Una llegada por sesión del navegador
    if (!sessionStorage.getItem('stmp-llegada')) {
      sessionStorage.setItem('stmp-llegada', '1');
      const o = actual || { fuente: '', ref: '' };
      fetch('/api/acciones?op=v-evento', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'llegada', origen: { fuente: o.fuente, medio: o.medio, campana: o.campana, ref: o.ref } }) })
        .then(r => r.text()).catch(() => {});   // leer la respuesta: si no, el navegador deja la petición abierta
    }
  } catch {}
  window.StmpOrigen = { get: () => { const o = leer(); return o ? { fuente: o.fuente, medio: o.medio, campana: o.campana, ref: o.ref } : null; } };
})();
