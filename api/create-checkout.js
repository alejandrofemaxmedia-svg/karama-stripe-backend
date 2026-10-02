// api/create-checkout.js
// Función serverless para Vercel. Crea una Stripe Checkout Session con la
// cantidad de plazas y la FECHA que mande la landing, y devuelve la URL de
// pago. Stripe calcula el total automáticamente (precio unitario x
// cantidad), así que el importe que ve el cliente en la landing y el que le
// cobra Stripe en el checkout SIEMPRE coinciden.
//
// No hace falta crear ningún Producto ni Precio en el Dashboard de Stripe.
// Las fechas y el aforo se configuran en api/_plazas.js.

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
const NO_REFUNDS_TEXT = 'No se realizan devoluciones. No se admiten cambios con menos de 48h, salvo fuerza mayor con justificante.';

// --- Fechas y plazas ---
// Las fechas, el aforo y los cierres manuales ya NO se tocan aquí: están en
// api/_plazas.js (TALLERES). Este archivo comprueba allí cuántas plazas
// quedan antes de mandar a nadie a pagar, así nunca se vende de más.
const { TALLERES, getDisponibilidad } = require('./_plazas');

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

    const taller = TALLERES[dateKey];
    if (!taller) {
      return res.status(400).json({ error: 'Fecha no válida' });
    }

    // Comprobamos en Stripe cuántas plazas quedan para esa fecha.
    // Si Stripe no responde, dejamos pasar la reserva para no perder ventas
    // (queda apuntado en los logs de Vercel).
    try {
      const disp = await getDisponibilidad();
      const quedan = disp[dateKey].quedan;
      if (quedan <= 0) {
        return res.status(409).json({ error: 'Esta fecha se ha agotado. Elige otra fecha.', quedan: 0 });
      }
      if (qty > quedan) {
        return res.status(409).json({
          error: quedan === 1 ? 'Solo queda 1 plaza para esta fecha.' : `Solo quedan ${quedan} plazas para esta fecha.`,
          quedan,
        });
      }
    } catch (err) {
      console.error('No se pudo comprobar el aforo, se deja pasar la reserva:', err);
    }

    // Si la landing manda su propia URL, volvemos ahí tras el pago.
    // Si no, usamos un dominio de reserva (cámbialo si quieres).
    const isValidUrl = typeof returnUrl === 'string' && /^https?:\/\//.test(returnUrl);
    const baseUrl = isValidUrl ? returnUrl.split('?')[0] : 'https://karamacandle.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      phone_number_collection: { enabled: true }, // Stripe pide el teléfono al pagar
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
              description: taller.descripcion,
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
        date_key: dateKey,
        date_description: taller.descripcion,
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
