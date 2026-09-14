// api/create-gift-checkout.js
// Función serverless para Vercel. Crea la sesión de pago para comprar un
// ABONO REGALO (o varios de una vez). El código de regalo en sí no se crea
// aquí: se crea automáticamente en api/webhook.js en cuanto Stripe confirma
// que el pago se ha completado, y se manda por email a quien lo compró.

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const UNIT_AMOUNT = 5000; // 50,00 € en céntimos. Debe coincidir con el precio del taller.
const CURRENCY = 'eur';
const MAX_QTY = 10;
const PRODUCT_NAME = 'Abono regalo · Taller de velas Karama Candle';
const PRODUCT_DESCRIPTION = 'Vale para una plaza en cualquier fecha del taller de velas. Recibirás el código por email para regalarlo.';

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

    const isValidUrl = typeof returnUrl === 'string' && /^https?:\/\//.test(returnUrl);
    const baseUrl = isValidUrl ? returnUrl.split('?')[0] : 'https://karamacandle.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      allow_promotion_codes: true, // TEMPORAL: solo para poder probar el circuito completo sin gastar dinero real. Quitar esta línea después de probar.
      // Pedimos email siempre (aunque Checkout ya lo pide por defecto),
      // porque a esa dirección es donde se manda el código del regalo.
      customer_email: undefined,
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
      // Metadatos: así el webhook sabe que esta compra es un abono regalo
      // (y no una reserva normal) y cuántos códigos tiene que generar.
      metadata: {
        type: 'gift_voucher',
        quantity: String(qty),
      },
      success_url: `${baseUrl}?regalo=confirmado`,
      cancel_url: `${baseUrl}?regalo=cancelado`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Error creando la sesión de regalo:', err);
    return res.status(500).json({ error: 'No se pudo crear la sesión de pago' });
  }
};
