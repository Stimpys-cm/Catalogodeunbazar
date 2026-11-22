// ─────────────────────────────────────────────────────────────
//  api/_lib/guias.js — Guías de Stiimpys (artículos para Google) · v43
//
//  Se ven en /guias y /guias/<slug> cuando el módulo "Guías" está prendido.
//  El HTML de cada guía está escrito aquí a mano (no viene de nadie de fuera).
//  "buscar" es una expresión para mostrar al final prendas relacionadas.
//  Para agregar una guía: copia una entrada, cambia el slug y el texto.
// ─────────────────────────────────────────────────────────────
export const GUIAS = [
  {
    slug: 'como-saber-si-unos-nike-son-originales',
    titulo: 'Cómo saber si una prenda Nike es original',
    resumen: 'Cinco cosas que revisamos en cada prenda Nike antes de subirla a la tienda: etiqueta, código, costuras, logo y materiales.',
    fecha: '2026-11-18', buscar: /nike/i,
    html: `
<p>En Stiimpys revisamos a mano cada prenda antes de publicarla. Estas son las cosas que miramos en una prenda Nike de segunda mano, y que tú también puedes revisar cuando compres en cualquier lugar.</p>
<h2>1. La etiqueta interior y su código</h2>
<p>Las prendas Nike de los últimos años traen una etiqueta interior con un código de estilo: seis letras o números, un guion y tres dígitos (por ejemplo, DD1391-100). Ese código se puede buscar en internet: lo normal es que aparezca la misma prenda, con el mismo color. Si el código no existe o aparece otra prenda, es mala señal.</p>
<h2>2. La calidad de las costuras</h2>
<p>Las costuras deben ser parejas, sin hilos sueltos ni puntadas torcidas, sobre todo en cuello, puños y dobladillo. Una costura chueca en un logo bordado es de las señales más comunes de una copia.</p>
<h2>3. El logo</h2>
<p>El "swoosh" tiene una curva limpia y una punta afilada. En logos bordados, el relleno es denso y sin huecos; en estampados, los bordes son nítidos. Compara con fotos de la tienda oficial.</p>
<h2>4. Materiales y peso</h2>
<p>Una sudadera Nike original suele sentirse pesada y suave por dentro. Telas muy delgadas, ásperas o con olor fuerte a químico son motivo para dudar.</p>
<h2>5. La etiqueta del cuello y la talla</h2>
<p>La tipografía de la etiqueta del cuello es clara y bien alineada. Las tallas vienen en varios sistemas (US, EUR, CN): si la etiqueta solo trae una talla rara o mal impresa, conviene revisar dos veces.</p>
<p><strong>En Stiimpys</strong> cada prenda trae fotos reales de la etiqueta y del estado, y si tienes duda de alguna, te mandamos más fotos por WhatsApp antes de que pagues.</p>`,
  },
  {
    slug: 'tallas-vintage-vs-actuales',
    titulo: 'Tallas vintage vs. tallas actuales: cómo no equivocarte',
    resumen: 'Una talla M de los 90 no mide lo mismo que una M de hoy. Te explicamos cómo medir tu prenda favorita y comparar en centímetros.',
    fecha: '2026-11-18', buscar: /vintage|90s|retro/i,
    html: `
<p>Las tallas han cambiado con los años. Muchas prendas de los 80 y 90 vienen más anchas y más cortas que las de ahora, y cada marca tiene su propia tabla. Por eso, en ropa de segunda mano, lo más seguro es comparar en centímetros.</p>
<h2>Mide una prenda que ya te quede bien</h2>
<p>Pon en una mesa una playera o sudadera que te guste cómo te queda y mide:</p>
<ul>
<li><b>Ancho:</b> de axila a axila, en línea recta.</li>
<li><b>Largo:</b> del punto más alto del hombro (junto al cuello) al dobladillo.</li>
<li><b>Manga:</b> de la costura del hombro al puño.</li>
</ul>
<p>Para pantalones: cintura (de lado a lado, por arriba), tiro (de la entrepierna a la cintura) y entrepierna (de la entrepierna al dobladillo).</p>
<h2>Compara con las medidas de la prenda</h2>
<p>Una diferencia de 2 a 3 cm casi no se nota. Si la prenda mide 5 cm más de ancho, te quedará holgada (que en streetwear muchas veces es justo lo que se busca).</p>
<h2>Señales de talla "vieja"</h2>
<ul>
<li>Playeras de los 90: más anchas y cortas; una L vintage puede quedar como una M actual de largo.</li>
<li>Jeans de los 90: tiro alto; fíjate en la medida de cintura, no solo en el número.</li>
<li>Sudaderas college: suelen encoger un poco con los años de lavado.</li>
</ul>
<p>En Stiimpys cada vez más prendas traen sus medidas en centímetros. Si una no las tiene, pídelas por WhatsApp y te las mandamos.</p>`,
  },
  {
    slug: 'como-cuidar-ropa-vintage',
    titulo: 'Cómo cuidar tu ropa vintage para que dure años',
    resumen: 'Lavado, secado y guardado: lo básico para que tus prendas de segunda mano se mantengan como el día que las compraste.',
    fecha: '2026-11-18', buscar: /vintage|sudadera|chamarra/i,
    html: `
<p>Una prenda de segunda mano ya pasó por muchos lavados. Con unos cuidados sencillos puede durar muchos años más.</p>
<h2>Lavado</h2>
<ul>
<li>Lávala al revés y con agua fría: cuida estampados y colores.</li>
<li>Usa detergente suave y evita el cloro.</li>
<li>Lava aparte los colores fuertes las primeras veces.</li>
</ul>
<h2>Secado</h2>
<p>Lo mejor es secar a la sombra y extendida. La secadora encoge y desgasta los estampados, sobre todo en sudaderas y playeras de algodón.</p>
<h2>Estampados y bordados</h2>
<p>Nunca planches directo sobre un estampado: plancha al revés o pon una tela encima. Los bordados se cuidan igual que el resto de la prenda.</p>
<h2>Guardado</h2>
<ul>
<li>Las sudaderas y suéteres se guardan doblados: colgados se estiran de los hombros.</li>
<li>Las chamarras sí van en gancho ancho.</li>
<li>Un lugar seco y sin sol directo evita que se decoloren.</li>
</ul>`,
  },
  {
    slug: 'como-comprar-en-stiimpys',
    titulo: 'Cómo comprar en Stiimpys: pagos, envíos y entregas en Reynosa',
    resumen: 'Todo lo que necesitas saber para comprar en línea o en nuestros bazares: formas de pago, apartados, envíos a todo México y entregas en persona.',
    fecha: '2026-11-18', buscar: null,
    html: `
<p>Stiimpys es un bazar de streetwear y vintage de Reynosa, Tamaulipas. Casi todas nuestras prendas son piezas únicas: cuando alguien la paga, desaparece de la tienda.</p>
<h2>Formas de pago</h2>
<ul>
<li><b>Tarjeta de crédito o débito</b> en la página segura de Clip.</li>
<li><b>PayPal</b>, útil si tu tarjeta es de Estados Unidos.</li>
<li><b>Transferencia SPEI</b> desde la app de tu banco, sin comisión: subes tu comprobante y te confirmamos.</li>
</ul>
<h2>Apartar</h2>
<p>En las prendas que lo permiten puedes apartar pagando una parte y liquidar después, antes de la fecha límite.</p>
<h2>Envíos y entregas</h2>
<ul>
<li>Envíos a todo México con guía rastreable: al pagar ves el precio de cada paquetería con tu código postal.</li>
<li>Entregas en persona en Reynosa en los puntos que ves al pagar.</li>
<li>También nos encuentras en bazares como expositores, con caja para pagar ahí mismo.</li>
</ul>
<h2>Después de comprar</h2>
<p>Tu recibo tiene el seguimiento de tu pedido. Cuando lo recibas, nos ayuda mucho tu reseña (con foto si quieres).</p>`,
  },
];
