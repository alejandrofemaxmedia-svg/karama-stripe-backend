// api/resenas.js
// Correo para pedir reseña en Google a quien ha hecho un taller.
//
// Cómo funciona:
//  - Vercel ejecuta esta función sola una vez al día por la tarde (lo marca
//    vercel.json). Busca los talleres que han TERMINADO en los últimos 3 días
//    y manda el correo a cada persona que reservó esa fecha y aún no lo ha
//    recibido. Así:
//      · taller de mañana (10:30–13:30) → el correo llega esa misma tarde.
//      · taller de tarde (17:00–20:00)  → el correo llega la tarde siguiente.
//  - Solo cuenta las reservas que ocupan plaza de verdad (pagadas o con bono
//    regalo; nada de reembolsos ni pruebas). Las plazas "extra" por fuera de
//    la web no reciben nada porque no tenemos su email.
//  - Cada reserva queda marcada en Stripe (metadata "resena_enviada"), así
//    nadie lo recibe dos veces.
//  - Mientras GOOGLE_REVIEW_URL no tenga el enlace real, NO se envía nada
//    automáticamente (solo funcionan las pruebas).
//
// Pruebas (todas piden ?clave=karama2026):
//  /api/resenas?clave=karama2026&ver=1              → quién lo recibiría hoy (no envía nada)
//  /api/resenas?clave=karama2026&ver=1&fecha=nov07  → quién lo recibiría de esa fecha (no envía nada)
//  /api/resenas?clave=karama2026&prueba=tu@email.com → te manda el correo solo a ti (no marca nada)

const { stripe, TALLERES, analizarSesion, DIAS_ATRAS } = require('./_plazas');

// ⬇⬇⬇ PEGA AQUÍ EL ENLACE DE RESEÑAS DE GOOGLE (el g.page/r/... de Rosario) ⬇⬇⬇
const GOOGLE_REVIEW_URL = 'PEGA_AQUI_EL_ENLACE_DE_RESENAS';
// ⬆⬆⬆ ------------------------------------------------------------------- ⬆⬆⬆

const CLAVE = 'karama2026';
const DURACION_HORAS = 3;      // lo que dura un taller (para saber cuándo termina)
const VENTANA_DIAS = 3;        // talleres terminados hace como mucho estos días
const ASUNTO = '¿Qué tal tu taller en Karama Candle? 🤍';
const PREHEADER = 'Tu opinión vale oro.';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Karama Candle <onboarding@resend.dev>';
const LOGO_URL = 'https://assets.cdn.filesafe.space/cUbw00M3Wh3pEAW7hgrK/media/6aa9178e90b7ca67e9b4e4f0.png';

const INK = '#2E2622';
const INK_SOFT = '#4A3F39';
const CREAM = '#FDF8F3';
const WHITE = '#FFFFFF';
const BLUSH = '#F3D8CF';

const enlaceListo = () => /^https?:\/\//.test(GOOGLE_REVIEW_URL);
const finDe = (t) => Date.parse(t.fin || t.inicio) + (t.fin ? 0 : DURACION_HORAS * 3600 * 1000);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function emailHtml() {
  const url = enlaceListo() ? GOOGLE_REVIEW_URL : '#';
  const p = `margin:0 0 16px; font-family:Arial,sans-serif; font-size:15.5px; line-height:1.65; color:${INK};`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light" /><meta name="supported-color-schemes" content="light" /><title></title>
<style>
  :root { color-scheme: light only; supported-color-schemes: light only; }
  [data-ogsc] .bg-ink, [data-ogsb] .bg-ink { background-color:${INK} !important; }
  [data-ogsc] .bg-white, [data-ogsb] .bg-white { background-color:${WHITE} !important; }
  [data-ogsc] .bg-cream, [data-ogsb] .bg-cream { background-color:${CREAM} !important; }
  [data-ogsc] .text-ink, [data-ogsb] .text-ink { color:${INK} !important; }
  [data-ogsc] .text-blush, [data-ogsb] .text-blush { color:${BLUSH} !important; }
</style></head>
<body class="bg-cream" style="margin:0; padding:0; background:${CREAM};">
<div style="display:none; max-height:0; overflow:hidden; opacity:0;">${PREHEADER}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg-cream" bgcolor="${CREAM}" style="background:${CREAM}; padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg-white" bgcolor="${WHITE}" style="max-width:480px; background:${WHITE}; border-radius:16px; overflow:hidden;">
  <tr><td class="bg-ink" bgcolor="${INK}" style="background:${INK}; padding:28px 24px; text-align:center; border-radius:16px 16px 0 0;">
    <img src="${LOGO_URL}" alt="Karama Candle" width="72" height="72" style="display:inline-block; border-radius:50%;" />
  </td></tr>
  <tr><td class="bg-white" bgcolor="${WHITE}" style="background:${WHITE}; padding:32px 32px 8px;">
    <p class="text-ink" style="${p}">¡Hola!</p>
    <p class="text-ink" style="${p}">Gracias por venir a nuestro taller de Karama. Nos encantaría saber cómo fue tu experiencia con nosotros.</p>
    <p class="text-ink" style="${p}">Tu opinión vale oro, así que nos ayudaría muchísimo que nos dejaras una breve reseña aquí abajo:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 26px;"><tr>
      <td class="bg-ink" bgcolor="${INK}" style="background:${INK}; border-radius:100px;">
        <a href="${url}" target="_blank" class="text-blush" style="display:inline-block; padding:14px 30px; font-family:Arial,sans-serif; font-size:14px; font-weight:bold; letter-spacing:1px; color:${BLUSH}; text-decoration:none; border-radius:100px;">DEJAR MI RESEÑA →</a>
      </td></tr></table>
    <p class="text-ink" style="margin:0 0 8px; font-family:Arial,sans-serif; font-size:15.5px; line-height:1.6; color:${INK};">Un abrazo enorme,<br><span style="font-family:Georgia,'Times New Roman',serif; font-style:italic; font-size:19px;">Rosario</span></p>
  </td></tr>
  <tr><td class="bg-white" bgcolor="${WHITE}" style="background:${WHITE}; padding:22px 32px 30px; text-align:center; border-radius:0 0 16px 16px;">
    <p style="margin:0; font-family:Arial,sans-serif; font-size:12.5px; color:${INK_SOFT}; opacity:0.75;">Karama Candle · Unibertsitate Etorbidea, 8, Bilbao</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

async function enviar(to) {
  if (!RESEND_API_KEY) throw new Error('Falta RESEND_API_KEY en Vercel');
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to, subject: ASUNTO, html: emailHtml() }),
  });
  if (!resp.ok) throw new Error(`Resend ${resp.status}: ${await resp.text()}`);
}

// Talleres a los que toca mandar el correo ahora (o la fecha pedida a mano).
function talleresATratar(fechaManual) {
  if (fechaManual) return TALLERES[fechaManual] ? [fechaManual] : [];
  const ahora = Date.now();
  return Object.keys(TALLERES).filter((k) => {
    const fin = finDe(TALLERES[k]);
    return fin <= ahora && fin >= ahora - VENTANA_DIAS * 86400 * 1000;
  });
}

// Personas (agrupadas por email) que reservaron esas fechas y cuentan como plaza.
async function destinatarios(claves) {
  if (!claves.length) return [];
  const desde = Math.floor(Date.now() / 1000) - DIAS_ATRAS * 86400;
  const sesiones = [];
  await stripe.checkout.sessions
    .list({ status: 'complete', created: { gte: desde }, limit: 100, expand: ['data.payment_intent.latest_charge'] })
    .autoPagingEach((s) => { sesiones.push(s); });

  const porEmail = {};
  for (const s of sesiones) {
    const m = s.metadata || {};
    if (m.type === 'gift_voucher') continue;
    const f = await analizarSesion(s);
    if (!f.cuenta || !claves.includes(f.clave) || !f.email) continue;
    const key = f.clave + '|' + f.email.toLowerCase();
    if (!porEmail[key]) porEmail[key] = { clave: f.clave, email: f.email, nombre: f.nombre, sesiones: [], yaEnviado: false };
    porEmail[key].sesiones.push(s.id);
    if (m.resena_enviada) porEmail[key].yaEnviado = true;
  }
  return Object.values(porEmail);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {};
  const esCron = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const esCronSinSecreto = !process.env.CRON_SECRET && /vercel-cron/i.test(req.headers['user-agent'] || '');
  if (!esCron && !esCronSinSecreto && q.clave !== CLAVE) return res.status(401).json({ error: 'No autorizado' });

  try {
    // 1) Prueba de diseño: solo a un email, no toca Stripe.
    if (q.prueba) {
      await enviar(String(q.prueba));
      return res.status(200).json({ ok: true, prueba: `Correo de reseña enviado a ${q.prueba}`, enlace_listo: enlaceListo() });
    }

    const claves = talleresATratar(q.fecha);
    const lista = await destinatarios(claves);

    // 2) Solo ver quién lo recibiría.
    if (q.ver) {
      return res.status(200).json({
        enlace_listo: enlaceListo(),
        talleres: claves.map((k) => ({ clave: k, termina: new Date(finDe(TALLERES[k])).toISOString(), descripcion: TALLERES[k].descripcion })),
        recibirian: lista.filter((d) => !d.yaEnviado).map((d) => ({ fecha: d.clave, nombre: d.nombre, email: d.email })),
        ya_enviados: lista.filter((d) => d.yaEnviado).map((d) => ({ fecha: d.clave, email: d.email })),
      });
    }

    // 3) Envío real (lo lanza el cron, o a mano con la clave).
    if (!enlaceListo()) {
      console.log('Reseñas: falta pegar GOOGLE_REVIEW_URL, no se envía nada.');
      return res.status(200).json({ ok: true, enviados: 0, aviso: 'Falta el enlace de reseñas de Google' });
    }
    const enviados = [];
    const errores = [];
    for (const d of lista) {
      if (d.yaEnviado) continue;
      try {
        await enviar(d.email);
        const hoy = new Date().toISOString().slice(0, 10);
        for (const id of d.sesiones) await stripe.checkout.sessions.update(id, { metadata: { resena_enviada: hoy } });
        enviados.push({ fecha: d.clave, email: d.email });
      } catch (err) {
        console.error('Reseña no enviada a', d.email, err.message);
        errores.push({ email: d.email, error: err.message });
      }
      await esperar(600); // Resend admite ~2 envíos por segundo
    }
    console.log('Reseñas enviadas:', enviados.length, 'errores:', errores.length);
    return res.status(200).json({ ok: true, talleres: claves, enviados, errores });
  } catch (err) {
    console.error('Error en reseñas:', err);
    return res.status(500).json({ error: err.message });
  }
};
