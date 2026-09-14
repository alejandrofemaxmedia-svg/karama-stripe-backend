// api/webhook.js
// Stripe llama a esta función automáticamente cada vez que se completa un
// pago (evento "checkout.session.completed"). Si esa compra era un abono
// regalo, generamos un código nuevo y único por cada plaza comprada, y lo
// mandamos por email a quien compró para que pueda regalarlo.
//
// IMPORTANTE: hay que registrar esta URL en Stripe (Developers → Webhooks
// → Add endpoint) para que Stripe sepa que tiene que avisar aquí. Instru-
// cciones completas en INSTRUCCIONES.md.

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const GIFT_COUPON_ID = process.env.GIFT_COUPON_ID; // el ID del Cupón "100% descuento" creado en Stripe
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Karama Candle <onboarding@resend.dev>';

// Vercel necesita el cuerpo de la petición "en crudo" (sin parsear como
// JSON) para poder comprobar la firma de Stripe. Por eso desactivamos el
// bodyParser por defecto solo en esta función.
module.exports.config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function generateCode() {
  // Código legible, ej: KARAMA-7F3K9Q
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I para evitar confusiones
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `KARAMA-${code}`;
}

async function sendGiftEmail(toEmail, codes) {
  if (!RESEND_API_KEY) {
    console.error('Falta RESEND_API_KEY: no se puede enviar el email con el/los código/s', codes);
    return;
  }

  const codesHtml = codes.map((c) => `<li style="font-size:20px; font-weight:700; letter-spacing:0.05em; margin:6px 0;">${c}</li>`).join('');

  const html = `
    <div style="font-family:Arial,sans-serif; max-width:480px; margin:0 auto;">
      <h2>¡Gracias por tu compra!</h2>
      <p>Aquí tienes ${codes.length > 1 ? 'tus códigos de abono regalo' : 'tu código de abono regalo'} para el taller de velas de Karama Candle:</p>
      <ul style="list-style:none; padding:0;">${codesHtml}</ul>
      <p>Para regalarlo, comparte ${codes.length > 1 ? 'uno de estos códigos' : 'este código'} con la persona a la que se lo quieras regalar. Cuando reserve su plaza en la web, podrá introducirlo en el paso de pago y el importe se pondrá a 0€ automáticamente.</p>
      <p>Cada código solo se puede usar una vez.</p>
      <p>¡Gracias por elegir Karama Candle!</p>
    </div>
  `;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: toEmail,
      subject: 'Tu abono regalo — Karama Candle',
      html,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error('Error mandando el email del abono regalo:', resp.status, text);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Método no permitido');
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Firma de webhook no válida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    if (session.metadata && session.metadata.type === 'gift_voucher') {
      try {
        const qty = parseInt(session.metadata.quantity, 10) || 1;
        const buyerEmail = session.customer_details && session.customer_details.email;

        if (!GIFT_COUPON_ID) {
          console.error('Falta configurar GIFT_COUPON_ID en las variables de entorno.');
        } else {
          const codes = [];
          for (let i = 0; i < qty; i++) {
            const code = generateCode();
            await stripe.promotionCodes.create({
              coupon: GIFT_COUPON_ID,
              code,
              max_redemptions: 1,
            });
            codes.push(code);
          }

          if (buyerEmail) {
            await sendGiftEmail(buyerEmail, codes);
          } else {
            console.error('No se encontró el email del comprador para mandar los códigos:', codes);
          }
        }
      } catch (err) {
        console.error('Error generando/enviando el abono regalo:', err);
      }
    }
  }

  return res.status(200).json({ received: true });
};
