// api/_plazas.js
// AQUÍ SE CONFIGURAN LOS TALLERES Y SUS PLAZAS. Es el único sitio que hay que
// tocar para añadir fechas, cambiar el aforo o cerrar una fecha a mano.
//
// Este archivo empieza por "_" a propósito: así Vercel NO lo publica como
// una URL, solo lo usan por dentro create-checkout, plazas, revision y webhook.
//
// Qué cuenta como plaza ocupada (pedido completado en Stripe):
//   ✔ Reservas pagadas con dinero.
//   ✔ Reservas a 0 € pagadas con un bono regalo real (código KARAMA-XXXXXX).
//   ✘ Reservas a 0 € con cualquier otro código (pruebas).
//   ✘ Reservas reembolsadas (si el reembolso es parcial, se restan las plazas devueltas).
//   ✘ Compras de bonos regalo (no tienen fecha).
//   ✘ Pedidos cuyo ID esté en EXCLUIR.
// Comprobar pedido a pedido: /api/revision?clave=karama2026

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const ADDRESS = 'Unibertsitate Etorbidea, 8, Bilbao';
const UNIT_AMOUNT = 5000; // precio de una plaza en céntimos (para calcular reembolsos parciales)

// A partir de cuántas plazas libres se muestra "ÚLTIMAS X PLAZAS".
const AVISO_ULTIMAS = 3;

// Pedidos que NO deben contar aunque parezcan válidos (pruebas, etc.).
// Pon los 8 últimos caracteres del ID que sale en la página de revisión,
// por ejemplo: const EXCLUIR = ['xncdrnF5', 'CY4nYGEj'];
const EXCLUIR = [];

// --- Talleres ---
// clave        → tiene que coincidir con el value del <option> en las landings.
// inicio       → día y hora del taller. Pasada esa hora, la fecha se cierra sola.
// descripcion  → lo que sale en Stripe y en el email.
// plazas       → aforo total del taller.
// extra        → plazas ocupadas que NO han pasado por la web. Puede ser negativo.
// cerrada      → true = AGOTADO siempre, cuente lo que cuente.
const TALLERES = {
  sep26: {
    inicio: '2026-09-26T17:00:00+02:00',
    descripcion: `Sábado 26 de septiembre, 17:00 a 20:00 · ${ADDRESS}`,
    plazas: 18, extra: 0, cerrada: true,
  },
  oct10: {
    inicio: '2026-10-10T10:30:00+02:00',
    descripcion: `Sábado 10 de octubre, 10:30 a 13:30 · ${ADDRESS}`,
    plazas: 18, extra: 0, cerrada: false,
  },
  oct18: {
    inicio: '2026-10-18T10:30:00+02:00',
    descripcion: `Domingo 18 de octubre, 10:30 a 13:30 · ${ADDRESS}`,
    // 15 pagadas en la web + 1 por fuera = 16 ocupadas → quedan 2 (hubo un cambio de fecha)
    plazas: 18, extra: 1, cerrada: false,
  },
  oct24: {
    inicio: '2026-10-24T17:00:00+02:00',
    descripcion: `Sábado 24 de octubre, 17:00 a 20:00 · ${ADDRESS}`,
    plazas: 18, extra: 0, cerrada: false,
  },
  // --- Noviembre (horario de invierno: +01:00) ---
  nov07: {
    inicio: '2026-11-07T17:00:00+01:00',
    descripcion: `Sábado 7 de noviembre, 17:00 a 20:00 · ${ADDRESS}`,
    plazas: 18, extra: 0, cerrada: false,
  },
  nov15: {
    inicio: '2026-11-15T10:30:00+01:00',
    descripcion: `Domingo 15 de noviembre, 10:30 a 13:30 · ${ADDRESS}`,
    plazas: 18, extra: 0, cerrada: false,
  },
  nov21: {
    inicio: '2026-11-21T17:00:00+01:00',
    descripcion: `Sábado 21 de noviembre, 17:00 a 20:00 · ${ADDRESS}`,
    plazas: 18, extra: 0, cerrada: false,
  },
  nov22: {
    inicio: '2026-11-22T10:30:00+01:00',
    descripcion: `Domingo 22 de noviembre, 10:30 a 13:30 · ${ADDRESS}`,
    plazas: 18, extra: 0, cerrada: false,
  },
  nov29: {
    inicio: '2026-11-29T10:30:00+01:00',
    descripcion: `Domingo 29 de noviembre, 10:30 a 13:30 · ${ADDRESS}`,
    plazas: 18, extra: 0, cerrada: false,
  },
};

// Hasta cuántos días atrás se buscan pedidos en Stripe.
const DIAS_ATRAS = 150;

// Reconoce la fecha en cualquier texto ("... 24 de octubre ...").
function claveDeTexto(txt) {
  if (!txt) return null;
  for (const k of Object.keys(TALLERES)) {
    const m = TALLERES[k].descripcion.match(/(\d+) de (\p{L}+)/u);
    if (m && new RegExp(`(^|\\D)${m[1]} de ${m[2]}`, 'iu').test(txt)) return k;
  }
  return null;
}

// Clave del taller a partir de los datos guardados en el pedido.
function claveDeSesion(session) {
  const m = session.metadata || {};
  if (m.type && m.type !== 'booking') return null;
  if (m.date_key && TALLERES[m.date_key]) return m.date_key;
  return claveDeTexto(m.date_description);
}

async function codigoDescuento(session) {
  try {
    const s = await stripe.checkout.sessions.retrieve(session.id, { expand: ['total_details.breakdown'] });
    const discounts = (s.total_details && s.total_details.breakdown && s.total_details.breakdown.discounts) || [];
    for (const d of discounts) {
      let pc = d.discount && d.discount.promotion_code;
      if (typeof pc === 'string') pc = await stripe.promotionCodes.retrieve(pc);
      if (pc && pc.code) return pc.code;
    }
  } catch (err) {
    console.error('No se pudo leer el código de descuento de', session.id, err.message);
  }
  return '';
}

// Analiza un pedido y dice si ocupa plazas, en qué fecha, cuántas y por qué.
async function analizarSesion(s) {
  const m = s.metadata || {};
  const out = {
    id: s.id.slice(-8), creado: s.created, tipo: m.type || '(sin tipo)',
    clave: null, plazas: 0, importe: (s.amount_total || 0) / 100, reembolsado: 0,
    codigo: '', cuenta: false, motivo: '',
  };
  if (m.type === 'gift_voucher') { out.motivo = 'compra de bono (no ocupa plaza)'; return out; }

  out.clave = claveDeSesion(s);
  out.plazas = parseInt(m.quantity, 10) || 0;

  // Pedidos antiguos sin datos: miramos el producto que se vendió.
  if (!out.clave || !out.plazas) {
    try {
      const items = await stripe.checkout.sessions.listLineItems(s.id, { limit: 10, expand: ['data.price.product'] });
      let qty = 0;
      for (const li of items.data) {
        const p = li.price && li.price.product;
        const txt = [li.description, p && p.name, p && p.description].filter(Boolean).join(' · ');
        const k = claveDeTexto(txt);
        if (k) { out.clave = out.clave || k; qty += li.quantity || 0; }
      }
      if (!out.plazas) out.plazas = qty;
    } catch (err) {
      console.error('No se pudieron leer los productos de', s.id, err.message);
    }
  }

  if (!out.clave) { out.motivo = 'sin fecha reconocida'; return out; }
  if (EXCLUIR.includes(out.id)) { out.motivo = 'excluido a mano'; return out; }

  const charge = s.payment_intent && s.payment_intent.latest_charge;
  out.reembolsado = ((charge && charge.amount_refunded) || 0) / 100;
  if (s.amount_total > 0 && out.reembolsado * 100 >= s.amount_total) { out.motivo = 'reembolsado'; return out; }
  if (out.reembolsado > 0) out.plazas = Math.max(0, out.plazas - Math.round((out.reembolsado * 100) / UNIT_AMOUNT));

  if (!s.amount_total) {
    out.codigo = await codigoDescuento(s);
    if (!/^KARAMA-/i.test(out.codigo)) { out.motivo = '0 € sin bono regalo (prueba)'; return out; }
  }

  out.cuenta = out.plazas > 0;
  out.motivo = out.cuenta ? (s.amount_total ? 'pagado' : 'pagado con bono regalo') : 'sin plazas';
  return out;
}

async function analizarTodo() {
  const desde = Math.floor(Date.now() / 1000) - DIAS_ATRAS * 86400;
  const sesiones = [];
  await stripe.checkout.sessions
    .list({ status: 'complete', created: { gte: desde }, limit: 100, expand: ['data.payment_intent.latest_charge'] })
    .autoPagingEach((s) => { sesiones.push(s); });
  const filas = [];
  for (const s of sesiones) filas.push(await analizarSesion(s));
  return filas;
}

// Devuelve, por cada fecha: { plazas, vendidas, extra, ocupadas, quedan,
// agotado, ultimas, motivo }
async function getDisponibilidad() {
  const filas = await analizarTodo();
  const vendidas = {};
  Object.keys(TALLERES).forEach((k) => { vendidas[k] = 0; });
  filas.forEach((f) => { if (f.cuenta && vendidas[f.clave] !== undefined) vendidas[f.clave] += f.plazas; });

  const ahora = Date.now();
  const out = {};
  for (const k of Object.keys(TALLERES)) {
    const t = TALLERES[k];
    const ocupadas = vendidas[k] + (t.extra || 0);
    const pasada = ahora >= Date.parse(t.inicio);
    let quedan = Math.max(0, t.plazas - ocupadas);
    let motivo = quedan <= 0 ? 'completa' : null;
    if (pasada) { quedan = 0; motivo = 'pasada'; }
    if (t.cerrada) { quedan = 0; motivo = 'cerrada'; }

    out[k] = {
      plazas: t.plazas,
      vendidas: vendidas[k],
      extra: t.extra || 0,
      ocupadas,
      quedan,
      agotado: quedan <= 0,
      ultimas: quedan > 0 && quedan <= AVISO_ULTIMAS,
      motivo,
    };
  }
  return out;
}

module.exports = { stripe, ADDRESS, TALLERES, AVISO_ULTIMAS, claveDeSesion, analizarTodo, getDisponibilidad };
