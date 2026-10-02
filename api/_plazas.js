// api/_plazas.js
// AQUÍ SE CONFIGURAN LOS TALLERES Y SUS PLAZAS. Es el único sitio que hay que
// tocar para añadir fechas, cambiar el aforo o cerrar una fecha a mano.
//
// Este archivo empieza por "_" a propósito: así Vercel NO lo publica como
// una URL, solo lo usan por dentro create-checkout, plazas y webhook.
//
// Cómo se cuentan las plazas: se suman las plazas de todos los pagos
// COMPLETADOS en Stripe de cada fecha (vengan de la landing de compra
// directa, de la landing con formulario o de la página de pago, porque las
// tres pasan por create-checkout). También cuentan las reservas pagadas con
// un bono regalo (importe 0 €). Plazas libres = aforo - vendidas - extra.

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const ADDRESS = 'Unibertsitate Etorbidea, 8, Bilbao';

// A partir de cuántas plazas libres se muestra "ÚLTIMAS X PLAZAS".
const AVISO_ULTIMAS = 3;

// --- Talleres ---
// clave        → tiene que coincidir con el value del <option> en las landings.
// inicio       → día y hora del taller. Pasada esa hora, la fecha se cierra sola.
// descripcion  → lo que sale en Stripe y en el email. NO la cambies en fechas
//                que ya tienen ventas (se usa para reconocer reservas antiguas).
// plazas       → aforo total del taller.
// extra        → plazas ocupadas que NO han pasado por la web (Instagram,
//                pago en mano, cambios de fecha...). Pon un número negativo
//                para liberar plazas (por ejemplo, si alguien se cambia a
//                otra fecha: -2 en la vieja y +2 en la nueva).
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
    plazas: 18, extra: 0, cerrada: true, // ya marcada como agotada a mano
  },
  oct24: {
    inicio: '2026-10-24T17:00:00+02:00',
    descripcion: `Sábado 24 de octubre, 17:00 a 20:00 · ${ADDRESS}`,
    plazas: 18, extra: 0, cerrada: false,
  },
};

// Hasta cuántos días atrás se buscan pagos en Stripe.
const DIAS_ATRAS = 150;

// Saca la clave del taller (oct10, oct24...) de una sesión de Stripe.
// Las reservas nuevas llevan date_key; las antiguas solo la descripción.
function claveDeSesion(session) {
  const m = session.metadata || {};
  if (m.type !== 'booking') return null;
  if (m.date_key && TALLERES[m.date_key]) return m.date_key;
  for (const k of Object.keys(TALLERES)) {
    if (TALLERES[k].descripcion === m.date_description) return k;
  }
  return null;
}

function plazasDeSesion(session) {
  const n = parseInt((session.metadata || {}).quantity, 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

async function contarVendidas() {
  const vendidas = {};
  Object.keys(TALLERES).forEach((k) => { vendidas[k] = 0; });
  const desde = Math.floor(Date.now() / 1000) - DIAS_ATRAS * 86400;

  await stripe.checkout.sessions
    .list({ status: 'complete', created: { gte: desde }, limit: 100 })
    .autoPagingEach((session) => {
      const k = claveDeSesion(session);
      if (k) vendidas[k] += plazasDeSesion(session);
    });

  return vendidas;
}

// Devuelve, por cada fecha: { plazas, vendidas, extra, ocupadas, quedan,
// agotado, ultimas, motivo }
async function getDisponibilidad() {
  const vendidas = await contarVendidas();
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

module.exports = { stripe, ADDRESS, TALLERES, AVISO_ULTIMAS, claveDeSesion, getDisponibilidad };
