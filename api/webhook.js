// api/webhook.js
// Stripe llama a esta función automáticamente cada vez que se completa un
// pago (evento "checkout.session.completed"). Según el tipo de compra:
//  - Abono regalo: generamos un código nuevo y único por cada plaza
//    comprada, y lo mandamos por email a quien lo compró.
//  - Reserva normal del taller: mandamos un email bonito de agradecimiento
//    con los datos de la reserva.
//
// IMPORTANTE: hay que registrar esta URL en Stripe (Developers → Webhooks
// → Add endpoint) para que Stripe sepa que tiene que avisar aquí. Instru-
// cciones completas en INSTRUCCIONES.md.

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const GIFT_COUPON_ID = process.env.GIFT_COUPON_ID; // el ID del Cupón "100% descuento" creado en Stripe
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Karama Candle <onboarding@resend.dev>';

// Logo de Karama Candle, alojado en la Media Library de GHL. Si algún día
// cambias el logo, solo hay que cambiar esta URL.
const LOGO_URL = 'https://assets.cdn.filesafe.space/cUbw00M3Wh3pEAW7hgrK/media/6aa9178e90b7ca67e9b4e4f0.png';

// --- Colores de marca (los mismos que usa la landing) ---
const COLOR_INK = '#2E2622';
const COLOR_INK_SOFT = '#4A3F39';
const COLOR_CREAM = '#FDF8F3';
const COLOR_WHITE = '#FFFFFF';
const COLOR_BLUSH = '#F3D8CF';
const COLOR_BLUSH_DEEP = '#E7BCAC';

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

// Cabecera común de los dos emails: fondo oscuro + logo centrado.
function emailHeader() {
  return `
    <tr>
      <td style="background:${COLOR_INK}; padding:28px 24px; text-align:center; border-radius:16px 16px 0 0;">
        <img src="${LOGO_URL}" alt="Karama Candle" width="72" height="72" style="display:inline-block; border-radius:50%;" />
      </td>
    </tr>
  `;
}

// Pie común de los dos emails.
function emailFooter() {
  return `
    <tr>
      <td style="padding:22px 32px 30px; text-align:center; border-radius:0 0 16px 16px;">
        <p style="margin:0; font-family:Arial,sans-serif; font-size:12.5px; color:${COLOR_INK_SOFT}; opacity:0.75;">
          Karama Candle · Unibertsitate Etorbidea, 8, Bilbao
        </p>
      </td>
    </tr>
  `;
}

// Envoltorio general del email (fondo crema, tarjeta centrada).
function emailWrapper(bodyHtml, preheader) {
  return `
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR_CREAM}; padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background:${COLOR_WHITE}; border-radius:16px; overflow:hidden; font-family:Arial,sans-serif;">
            ${emailHeader()}
            <tr>
              <td style="padding:32px 32px 8px;">
                ${bodyHtml}
              </td>
            </tr>
            ${emailFooter()}
          </table>
        </td>
      </tr>
    </table>
  `;
}

async function sendEmail(toEmail, subject, html) {
  if (!RESEND_API_KEY) {
    console.error('Falta RESEND_API_KEY: no se puede enviar el email "' + subject + '"');
    return;
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: toEmail,
      subject,
      html,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error('Error mandando el email "' + subject + '":', resp.status, text);
  }
}

async function sendGiftEmail(toEmail, codes) {
  const isPlural = codes.length > 1;

  const codesHtml = codes
    .map(
      (c) => `
        <div style="background:${COLOR_BLUSH}; border:1px solid ${COLOR_BLUSH_DEEP}; border-radius:12px; padding:14px 18px; margin:0 0 10px; text-align:center;">
          <span style="font-family:'Courier New',monospace; font-size:21px; font-weight:700; letter-spacing:0.06em; color:${COLOR_INK};">${c}</span>
        </div>
      `
    )
    .join('');

  const body = `
    <h1 style="margin:0 0 14px; font-family:Georgia,serif; font-size:24px; color:${COLOR_INK};">¡Gracias por tu compra!</h1>
    <p style="margin:0 0 18px; font-size:15px; line-height:1.55; color:${COLOR_INK_SOFT};">
      Aquí tienes ${isPlural ? 'tus códigos de abono regalo' : 'tu código de abono regalo'} para el taller de velas de Karama Candle:
    </p>
    ${codesHtml}
    <p style="margin:22px 0 10px; font-size:14.5px; line-height:1.55; color:${COLOR_INK_SOFT};">
      Para regalarlo, comparte ${isPlural ? 'uno de estos códigos' : 'este código'} con la persona a la que se lo quieras regalar.
      Cuando reserve su plaza en la web, podrá introducirlo en el paso de pago y el importe se pondrá a 0€ automáticamente.
    </p>
    <p style="margin:0 0 22px; font-size:13px; color:${COLOR_INK_SOFT}; opacity:0.8;">
      Cada código solo se puede usar una vez.
    </p>
    <p style="margin:0; font-family:Georgia,serif; font-size:15px; color:${COLOR_INK};">
      ¡Gracias por elegir Karama Candle!
    </p>
  `;

  const html = emailWrapper(body, 'Tu abono regalo ya está listo');
  await sendEmail(toEmail, 'Tu abono regalo — Karama Candle', html);
}

async function sendBookingThanksEmail(toEmail, { dateDescription, quantity }) {
  const plazasText = quantity > 1 ? `${quantity} plazas` : '1 plaza';

  const body = `
    <h1 style="margin:0 0 14px; font-family:Georgia,serif; font-size:24px; color:${COLOR_INK};">¡Gracias por tu reserva!</h1>
    <p style="margin:0 0 18px; font-size:15px; line-height:1.55; color:${COLOR_INK_SOFT};">
      Ya tienes tu plaza confirmada para el taller de velas de Karama Candle. Aquí tienes el resumen de tu reserva:
    </p>
    <div style="background:${COLOR_BLUSH}; border-radius:12px; padding:18px 20px; margin:0 0 20px;">
      <p style="margin:0 0 6px; font-size:13px; text-transform:uppercase; letter-spacing:0.05em; color:${COLOR_INK}; opacity:0.7;">Fecha del taller</p>
      <p style="margin:0 0 14px; font-size:15.5px; font-weight:700; color:${COLOR_INK};">${dateDescription || 'Consulta tu fecha en la confirmación de Stripe'}</p>
      <p style="margin:0 0 6px; font-size:13px; text-transform:uppercase; letter-spacing:0.05em; color:${COLOR_INK}; opacity:0.7;">Plazas reservadas</p>
      <p style="margin:0; font-size:15.5px; font-weight:700; color:${COLOR_INK};">${plazasText}</p>
    </div>
    <p style="margin:0 0 22px; font-size:14.5px; line-height:1.55; color:${COLOR_INK_SOFT};">
      Te esperamos en Unibertsitate Etorbidea, 8, Bilbao. Si necesitas cambiar algo de tu reserva, escríbenos a
      <strong>karamacandle@gmail.com</strong> y te ayudamos encantadas.
    </p>
    <p style="margin:0; font-family:Georgia,serif; font-size:15px; color:${COLOR_INK};">
      ¡Nos vemos muy pronto!
    </p>
  `;

  const html = emailWrapper(body, 'Tu plaza en el taller ya está confirmada');
  await sendEmail(toEmail, 'Reserva confirmada — Karama Candle', html);
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
    const metadata = session.metadata || {};
    const buyerEmail = session.customer_details && session.customer_details.email;

    if (metadata.type === 'gift_voucher') {
      try {
        const qty = parseInt(metadata.quantity, 10) || 1;

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
        // No devolvemos error 500 a Stripe por esto: el pago ya se ha
        // cobrado bien. Si algo falla aquí, hay que mirarlo a mano
        // (los logs de Vercel dicen el motivo).
      }
    } else if (metadata.type === 'booking') {
      try {
        if (buyerEmail) {
          await sendBookingThanksEmail(buyerEmail, {
            dateDescription: metadata.date_description,
            quantity: parseInt(metadata.quantity, 10) || 1,
          });
        } else {
          console.error('No se encontró el email del comprador para mandar el email de agradecimiento.');
        }
      } catch (err) {
        console.error('Error enviando el email de agradecimiento de la reserva:', err);
      }
    }
  }

  return res.status(200).json({ received: true });
};
