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

// Bonos de otros talleres (la landing manda taller: 'recipientes').
const BONOS = {
  recipientes: {
    unit: 5500, // 55,00 €
    name: 'Bono regalo · Taller de recipientes Karama Candle',
    description: 'Vale para una plaza en cualquier fecha del taller de recipientes. Recibirás el código por email para regalarlo.',
  },
};

// Aviso de política de cambios/devoluciones. Sale justo antes del botón de
// pagar, en la propia pantalla de Stripe. Para cambiar el texto, solo hay
// que editar esta línea.
const NO_REFUNDS_TEXT = 'No se realizan reembolsos de bonos regalo. El bono es válido durante 3 meses desde la compra. Para cambiar la fecha de una reserva hecha con bono, avísanos con un mínimo de 7 días de antelación (sujeto a disponibilidad).';

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


// De dónde viene la compra, leído de la dirección de la página desde la que se paga.
// Los botones de los correos de recuperación llevan ?utm_source=email&utm_content=correo1 (2, 3).
function origenDe(url) {
  try {
    const p = new URL(url).searchParams;
    if (p.get('utm_source') === 'email') return 'email-' + (p.get('utm_content') || 'sin-numero');
    return p.get('utm_source') || 'web';
  } catch (e) {
    return 'web';
  }
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
    const { quantity, returnUrl, taller } = req.body || {};
    const bono = BONOS[taller];
    const qty = parseInt(quantity, 10);

    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return res.status(400).json({ error: 'Cantidad no válida' });
    }

    const isValidUrl = typeof returnUrl === 'string' && /^https?:\/\//.test(returnUrl);
    const baseUrl = isValidUrl ? returnUrl.split('?')[0] : 'https://karamacandle.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      phone_number_collection: { enabled: true }, // Stripe pide el teléfono al pagar
      custom_text: {
        submit: { message: NO_REFUNDS_TEXT },
      },
      line_items: [
        {
          price_data: {
            currency: CURRENCY,
            product_data: {
              name: bono ? bono.name : PRODUCT_NAME,
              description: bono ? bono.description : PRODUCT_DESCRIPTION,
            },
            unit_amount: bono ? bono.unit : UNIT_AMOUNT,
          },
          quantity: qty,
        },
      ],
      // Metadatos: así el webhook sabe que esta compra es un abono regalo
      // (y no una reserva normal) y cuántos códigos tiene que generar.
      metadata: {
        type: 'gift_voucher',
        quantity: String(qty),
        taller: bono ? taller : 'velas',
        origen: origenDe(returnUrl),
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
