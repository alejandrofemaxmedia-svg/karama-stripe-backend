// api/create-checkout.js
// Función serverless para Vercel. Crea una Stripe Checkout Session con la
// cantidad de plazas que mande la landing, y devuelve la URL de pago.
//
// Stripe calcula el total automáticamente (precio unitario x cantidad),
// así que el importe que ve el cliente en la landing y el que le cobra
// Stripe en el checkout SIEMPRE coinciden.

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// --- Configuración del taller ---
const UNIT_AMOUNT = 5000; // 50,00 € en céntimos. Cámbialo aquí si sube el precio.
const CURRENCY = 'eur';
const MAX_QTY = 10; // máximo de plazas que se pueden reservar de una vez
const PRODUCT_NAME = 'Taller de velas · Karama Candle';
const PRODUCT_DESCRIPTION = 'Próximo taller: 26 de septiembre · Unibertsitate Etorbidea, 8, Bilbao';

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
    const { quantity, returnUrl } = req.body || {};
    const qty = parseInt(quantity, 10);

    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return res.status(400).json({ error: 'Cantidad no válida' });
    }

    // Si la landing manda su propia URL, volvemos ahí tras el pago.
    // Si no, usamos un dominio de reserva (cámbialo si quieres).
    const isValidUrl = typeof returnUrl === 'string' && /^https?:\/\//.test(returnUrl);
    const baseUrl = isValidUrl ? returnUrl.split('?')[0] : 'https://karamacandle.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: CURRENCY,
            product_data: {
              name: PRODUCT_NAME,
              description: PRODUCT_DESCRIPTION,
            },
            unit_amount: UNIT_AMOUNT,
          },
          quantity: qty,
        },
      ],
      success_url: `${baseUrl}?reserva=confirmada`,
      cancel_url: `${baseUrl}?reserva=cancelada`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Error creando la sesión de Stripe:', err);
    return res.status(500).json({ error: 'No se pudo crear la sesión de pago' });
  }
};
