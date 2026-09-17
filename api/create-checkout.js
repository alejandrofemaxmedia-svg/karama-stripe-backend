// api/create-checkout.js
// Función serverless para Vercel. Crea una Stripe Checkout Session con la
// cantidad de plazas y la FECHA que mande la landing, y devuelve la URL de
// pago. Stripe calcula el total automáticamente (precio unitario x
// cantidad), así que el importe que ve el cliente en la landing y el que le
// cobra Stripe en el checkout SIEMPRE coinciden.
//
// No hace falta crear ningún Producto ni Precio en el Dashboard de Stripe:
// el precio y la descripción de cada fecha se definen aquí mismo, abajo,
// en DATE_INFO. Para añadir, quitar o cambiar una fecha, solo hay que
// editar ese objeto y volver a subir este archivo a GitHub (Vercel
// redespliega solo).

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// --- Configuración del taller ---
const UNIT_AMOUNT = 5000; // 50,00 € en céntimos. Cámbialo aquí si sube el precio.
const CURRENCY = 'eur';
const MAX_QTY = 10; // máximo de plazas que se pueden reservar de una vez
const PRODUCT_NAME = 'Taller de velas · Karama Candle';
const ADDRESS = 'Unibertsitate Etorbidea, 8, Bilbao';

// Aviso de política de cambios/devoluciones. Sale justo antes del botón de
// pagar, en la propia pantalla de Stripe. Para cambiar el texto, solo hay
// que editar esta línea.
const NO_REFUNDS_TEXT = 'No se admiten cambios ni devoluciones, salvo causa de fuerza mayor debidamente justificada.';

// --- Fechas disponibles ---
// La clave (sep26, oct10, ...) tiene que coincidir exactamente con el
// value de cada <option> del desplegable en karama_priced_stripe.html.
// sep26 se ha quitado de aquí a propósito: esa fecha ya está agotada y no
// se puede reservar (aunque en la landing esté marcada como "AGOTADO" y
// deshabilitada, esto es una segunda barrera para que nadie pueda comprarla
// saltándose el desplegable). Para reabrirla, vuelve a añadir esta línea:
// sep26: { description: `Sábado 26 de septiembre, 17:00 a 20:00 · ${ADDRESS}` },
const DATE_INFO = {
  oct10: { description: `Sábado 10 de octubre, 10:30 a 13:30 · ${ADDRESS}` },
  oct18: { description: `Domingo 18 de octubre, 10:30 a 13:30 · ${ADDRESS}` },
  oct24: { description: `Sábado 24 de octubre, 17:00 a 20:00 · ${ADDRESS}` },
};

// Dominio(s) desde los que se puede llamar a esta función (tu landing).
// Pon aquí el dominio real donde vive la landing (ej: "https://www.karamacandle.com").
// Puedes poner varios separados por coma en la variable de entorno ALLOWED_ORIGIN.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN || '*')
  .split(',')
  .map((s) => s.trim());

function setCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { quantity, dateKey, returnUrl } = req.body || {};
    const qty = parseInt(quantity, 10);

    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return res.status(400).json({ error: 'Cantidad no válida' });
    }

    const dateInfo = DATE_INFO[dateKey];
    if (!dateInfo) {
      return res.status(400).json({ error: 'Fecha no válida' });
    }

    // Si la landing manda su propia URL, volvemos ahí tras el pago.
    // Si no, usamos un dominio de reserva (cámbialo si quieres).
    const isValidUrl = typeof returnUrl === 'string' && /^https?:\/\//.test(returnUrl);
    const baseUrl = isValidUrl ? returnUrl.split('?')[0] : 'https://karamacandle.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      allow_promotion_codes: true, // permite meter un código de abono regalo en la propia página de Stripe
      custom_text: {
        submit: { message: NO_REFUNDS_TEXT },
      },
      line_items: [
        {
          price_data: {
            currency: CURRENCY,
            product_data: {
              name: PRODUCT_NAME,
              description: dateInfo.description,
            },
            unit_amount: UNIT_AMOUNT,
          },
          quantity: qty,
        },
      ],
      // Metadatos: así el webhook sabe la fecha y cantidad para poder
      // mandar el email bonito de agradecimiento por la reserva.
      metadata: {
        type: 'booking',
        date_description: dateInfo.description,
        quantity: String(qty),
      },
      success_url: `${baseUrl}?reserva=confirmada`,
      cancel_url: `${baseUrl}?reserva=cancelada`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Error creando la sesión de Stripe:', err);
    return res.status(500).json({ error: 'No se pudo crear la sesión de pago' });
  }
};
