// api/recordatorio.js
// Correo recordatorio "¡Mañana nos vemos en Karama!" que llega ~24 h antes de
// cada taller a todas las personas con reserva confirmada.
//
// Cómo funciona:
//  - Vercel ejecuta esta función dos veces al día (lo marca vercel.json):
//      · 09:30 → talleres de MAÑANA por la mañana (10:30 / 11:00).
//      · 16:00 → talleres de MAÑANA por la tarde (17:00).
//    En cada pasada busca los talleres que empiezan dentro de 6–30 horas y
//    escribe a quien aún no lo ha recibido. Así llega ~24-25 h antes.
//  - Solo cuenta reservas que ocupan plaza de verdad (pagadas o con bono
//    regalo; nada de reembolsos, aplazadas ni pruebas).
//  - Un solo correo por persona y taller, aunque haya reservado varias plazas
//    o hecho varias reservas (se indica el número de plazas).
//  - Cambio de fecha: si el pago tiene el metadato "fecha_nueva" (ver
//    _plazas.js), el recordatorio sale para la fecha nueva. Si ya se había
//    mandado el de la fecha antigua, se manda otro para la nueva.
//  - Cada reserva queda marcada en Stripe (metadata "recordatorio_enviado"
//    = clave del taller), así nadie lo recibe dos veces.
//  - Mientras ACTIVO = false NO se envía nada a clientas (solo pruebas).
//
// Pruebas (todas piden ?clave=karama2026):
//  /api/recordatorio?clave=karama2026&ver=1              → quién lo recibiría ahora (no envía)
//  /api/recordatorio?clave=karama2026&ver=1&fecha=ene24  → quién lo recibiría de esa fecha (no envía)
//  /api/recordatorio?clave=karama2026&prueba=tu@email.com&fecha=ene24&nombre=Virginia&plazas=2
//        → te manda el correo de ejemplo solo a ti (no marca nada)

const { stripe, TALLERES, analizarSesion, DIAS_ATRAS } = require('./_plazas');

// ⬇⬇⬇ CAMBIAR A true CUANDO ROSARIO DÉ EL OK ⬇⬇⬇
const ACTIVO = true;
// ⬆⬆⬆ ---------------------------------------- ⬆⬆⬆

// Talleres FALSOS de prueba: el recordatorio llega solo a PRUEBA_EMAIL, a la hora
// real (cron), aunque ACTIVO sea false. No tocan plazas ni Stripe.
// Cuando termines de probar, deja TALLERES_PRUEBA = {}.
const PRUEBA_EMAIL = 'alejandro.femaxmedia@gmail.com';
const TALLERES_PRUEBA = {
  prueba_26nov: {
    inicio: '2026-11-26T11:00:00+01:00',
    descripcion: 'Jueves 26 de noviembre, 11:00 a 14:00 · PRUEBA',
    nombre: 'Alejandro', plazas: 2,
  },
};

const CLAVE = 'karama2026';
const HORAS_MIN = 6;   // no se manda si al taller le quedan menos de 6 h
const HORAS_MAX = 30;  // ni si le quedan más de 30 h
const ASUNTO = '¡Mañana nos vemos en Karama! 🕯️🤍';
const PREHEADER = 'Todo lo que necesitas saber para mañana';

const TELEFONO_VISIBLE = '685 45 17 94';
const TELEFONO_LINK = '+34685451794';
const WHATSAPP_LINK = 'https://wa.me/34685451794';
const MAPS_URL = 'https://www.google.com/maps/search/?api=1&query=Avenida+de+las+Universidades+8+Bilbao';
const DIRECCION = 'Avenida de las Universidades 8, Bilbao';
const REPLY_TO = 'karamacandle@gmail.com'; // si la clienta responde al correo, le llega a Rosario

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Karama Candle <onboarding@resend.dev>';
const LOGO_URL = 'https://assets.cdn.filesafe.space/cUbw00M3Wh3pEAW7hgrK/media/6aa9178e90b7ca67e9b4e4f0.png';

const INK = '#2E2622';
const INK_SOFT = '#4A3F39';
const CREAM = '#FDF8F3';
const WHITE = '#FFFFFF';
const BLUSH = '#F3D8CF';
const BLUSH_SOFT = '#FBEDE8';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// "virginia OCHOA" → "Virginia"
function primerNombre(nombre) {
  const n = String(nombre || '').trim().split(/\s+/)[0] || '';
  if (!n || /@/.test(n)) return '';
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

// Datos del taller listos para el correo.
function datosTaller(clave) {
  const t = TALLERES[clave] || TALLERES_PRUEBA[clave];
  const desc = t.descripcion || '';
  const dia = desc.split(',')[0].trim();                       // "Domingo 24 de enero"
  const h = desc.match(/(\d{1,2}:\d{2})\s*a\s*(\d{1,2}:\d{2})/); // 11:00 a 14:00
  const ini = h ? h[1] : new Date(t.inicio).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' });
  const fin = h ? h[2] : '';
  let duracion = '';
  if (h) {
    const mins = (s) => { const [a, b] = s.split(':').map(Number); return a * 60 + b; };
    const d = (mins(fin) - mins(ini)) / 60;
    duracion = `${String(d).replace('.', ',')} ${d === 1 ? 'hora' : 'horas'}`;
  }
  return {
    nombreTaller: t.taller === 'recipientes' ? 'Taller de recipientes' : 'Taller de velas',
    dia,
    horario: fin ? `De ${ini} a ${fin}` : `A las ${ini}`,
    duracion,
  };
}

function emailHtml({ nombre, clave, plazas }) {
  const d = datosTaller(clave);
  const saludo = nombre ? `¡Hola, ${esc(nombre)}! 🤍` : '¡Hola! 🤍';
  const p = `margin:0 0 16px; font-family:Arial,sans-serif; font-size:15.5px; line-height:1.65; color:${INK};`;
  const h2 = `margin:0 0 12px; font-family:Georgia,'Times New Roman',serif; font-size:19px; font-weight:normal; color:${INK};`;
  const fila = (icono, texto) => `
      <tr>
        <td width="30" valign="top" style="padding:5px 0; font-size:17px; line-height:1.4;">${icono}</td>
        <td valign="top" style="padding:5px 0; font-family:Arial,sans-serif; font-size:15px; line-height:1.5; color:${INK};">${texto}</td>
      </tr>`;
  const li = (texto) => `
      <tr>
        <td width="20" valign="top" style="padding:4px 0; font-family:Arial,sans-serif; font-size:15px; line-height:1.55; color:${INK};">•</td>
        <td valign="top" style="padding:4px 0; font-family:Arial,sans-serif; font-size:15px; line-height:1.55; color:${INK};">${texto}</td>
      </tr>`;

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light" /><meta name="supported-color-schemes" content="light" /><title>${ASUNTO}</title>
<style>
  :root { color-scheme: light only; supported-color-schemes: light only; }
  [data-ogsc] .bg-ink, [data-ogsb] .bg-ink { background-color:${INK} !important; }
  [data-ogsc] .bg-white, [data-ogsb] .bg-white { background-color:${WHITE} !important; }
  [data-ogsc] .bg-cream, [data-ogsb] .bg-cream { background-color:${CREAM} !important; }
  [data-ogsc] .bg-blush, [data-ogsb] .bg-blush { background-color:${BLUSH_SOFT} !important; }
  [data-ogsc] .text-ink, [data-ogsb] .text-ink { color:${INK} !important; }
  [data-ogsc] .text-blush, [data-ogsb] .text-blush { color:${BLUSH} !important; }
  @media (max-width:480px) { .pad { padding-left:22px !important; padding-right:22px !important; } }
</style></head>
<body class="bg-cream" style="margin:0; padding:0; background:${CREAM};">
<div style="display:none; max-height:0; overflow:hidden; opacity:0;">${PREHEADER}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg-cream" bgcolor="${CREAM}" style="background:${CREAM}; padding:28px 10px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg-white" bgcolor="${WHITE}" style="max-width:520px; background:${WHITE}; border-radius:16px; overflow:hidden;">

  <tr><td class="bg-ink" bgcolor="${INK}" style="background:${INK}; padding:28px 24px; text-align:center; border-radius:16px 16px 0 0;">
    <img src="${LOGO_URL}" alt="Karama Candle" width="72" height="72" style="display:inline-block; border-radius:50%;" />
  </td></tr>

  <tr><td class="bg-white pad" bgcolor="${WHITE}" style="background:${WHITE}; padding:32px 32px 4px;">
    <p class="text-ink" style="${p}">${saludo}</p>
    <p class="text-ink" style="${p}">¡Qué poquito queda! 🥹 Mañana nos vemos en nuestro taller de Karama, en el que vamos a disfrutar de unas horitas creando, desconectando y pasando un ratito juntas.</p>
    <p class="text-ink" style="${p}">Te dejo por aquí todo lo que necesitas para llegar tranquila:</p>
  </td></tr>

  <!-- Tu experiencia -->
  <tr><td class="pad" style="padding:4px 32px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg-blush" bgcolor="${BLUSH_SOFT}" style="background:${BLUSH_SOFT}; border-radius:14px;">
      <tr><td style="padding:20px 22px 18px;">
        <p class="text-ink" style="${h2}">Tu experiencia</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${fila('🕯️', `<strong>${esc(d.nombreTaller)}</strong>`)}
          ${fila('📅', esc(d.dia))}
          ${fila('🕚', `${esc(d.horario)}${d.duracion ? ` (${esc(d.duracion)})` : ''}`)}
          ${plazas > 1 ? fila('👥', `${plazas} plazas`) : ''}
          ${fila('📍', esc(DIRECCION))}
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0 2px;"><tr>
          <td class="bg-ink" bgcolor="${INK}" style="background:${INK}; border-radius:100px;">
            <a href="${MAPS_URL}" target="_blank" class="text-blush" style="display:inline-block; padding:12px 22px; font-family:Arial,sans-serif; font-size:13px; font-weight:bold; letter-spacing:0.3px; white-space:nowrap; color:${BLUSH}; text-decoration:none; border-radius:100px;">VER EN GOOGLE MAPS&nbsp;→</a>
          </td></tr></table>
      </td></tr>
    </table>
  </td></tr>

  <!-- Antes de venir -->
  <tr><td class="bg-white pad" bgcolor="${WHITE}" style="background:${WHITE}; padding:24px 32px 6px;">
    <p class="text-ink" style="${h2}">Antes de venir</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${li('Intenta llegar <strong>5–10 minutos antes</strong>, así empezamos todas a la vez y sin prisas.')}
      ${li('<strong>No tienes que traer nada:</strong> todos los materiales están incluidos.')}
      ${li('Ven con <strong>ropa cómoda</strong>, ¡que nos vamos a manchar un poquito las manos!')}
    </table>
  </td></tr>

  <!-- Cómo llegar -->
  <tr><td class="bg-white pad" bgcolor="${WHITE}" style="background:${WHITE}; padding:22px 32px 6px;">
    <p class="text-ink" style="${h2}">Cómo llegar 📍</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${fila('🚌', '<strong>Autobús:</strong> paradas de Hermanos Aguirre, a 2–5 min andando')}
      ${fila('🚊', '<strong>Tranvía:</strong> parada Guggenheim, a 8–12 min andando')}
      ${fila('🚇', '<strong>Metro:</strong> Deusto (12–16 min) o Moyúa (13–17 min) andando')}
      ${fila('🚗', '<strong>Coche:</strong> se puede aparcar en la misma Avenida de las Universidades, pero suele estar complicado, así que mejor ven con tiempo. Si no encuentras sitio, el Parking Plaza Euskadi está a 8–12 min andando.')}
    </table>
    <p style="margin:8px 0 0; font-family:Arial,sans-serif; font-size:12.5px; font-style:italic; color:${INK_SOFT}; opacity:0.8;">Los tiempos son orientativos.</p>
  </td></tr>

  <!-- Imprevistos -->
  <tr><td class="bg-white pad" bgcolor="${WHITE}" style="background:${WHITE}; padding:22px 32px 4px;">
    <p class="text-ink" style="${h2}">¿Te ha surgido algún imprevisto?</p>
    <p class="text-ink" style="${p}">Escríbeme o llámame al <a href="tel:${TELEFONO_LINK}" style="color:${INK}; font-weight:bold; text-decoration:underline;">${TELEFONO_VISIBLE}</a> (o por <a href="${WHATSAPP_LINK}" target="_blank" style="color:${INK}; font-weight:bold; text-decoration:underline;">WhatsApp</a>) y lo vemos juntas.</p>
  </td></tr>

  <tr><td class="bg-white pad" bgcolor="${WHITE}" style="background:${WHITE}; padding:8px 32px 6px;">
    <p class="text-ink" style="${p}">Nosotras ya estamos preparando todo con mucho cariño. ¡Qué ganas de verte mañana! 🕯️🤍</p>
    <p class="text-ink" style="margin:0 0 8px; font-family:Arial,sans-serif; font-size:15.5px; line-height:1.6; color:${INK};">Un abrazo,<br><span style="font-family:Georgia,'Times New Roman',serif; font-style:italic; font-size:19px;">Rosario</span><br><span style="font-size:13.5px; color:${INK_SOFT};">Karama Candle</span></p>
  </td></tr>

  <tr><td class="bg-white" bgcolor="${WHITE}" style="background:${WHITE}; padding:22px 32px 28px; text-align:center; border-radius:0 0 16px 16px;">
    <p style="margin:0; font-family:Arial,sans-serif; font-size:12.5px; color:${INK_SOFT}; opacity:0.75;">Karama Candle · Unibertsitate Etorbidea, 8, Bilbao</p>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

async function enviar(to, datos, asunto) {
  if (!RESEND_API_KEY) throw new Error('Falta RESEND_API_KEY en Vercel');
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to, reply_to: REPLY_TO, subject: asunto || ASUNTO, html: emailHtml(datos) }),
  });
  if (!resp.ok) throw new Error(`Resend ${resp.status}: ${await resp.text()}`);
}

// Talleres a los que toca mandar el recordatorio ahora (o la fecha pedida a mano).
function talleresATratar(fechaManual) {
  const todos = Object.assign({}, TALLERES, TALLERES_PRUEBA);
  if (fechaManual) return todos[fechaManual] ? [fechaManual] : [];
  const ahora = Date.now();
  return Object.keys(todos).filter((k) => {
    const falta = Date.parse(todos[k].inicio) - ahora;
    // Las pruebas no se marcan en Stripe: solo entran en la primera pasada (20–30 h antes).
    const min = TALLERES_PRUEBA[k] ? 20 : HORAS_MIN;
    return falta >= min * 3600 * 1000 && falta <= HORAS_MAX * 3600 * 1000;
  });
}

// Personas (agrupadas por email) con reserva confirmada en esas fechas.
async function destinatarios(clavesTodas) {
  const pruebas = clavesTodas.filter((k) => TALLERES_PRUEBA[k]).map((k) => ({
    clave: k, email: PRUEBA_EMAIL, nombre: TALLERES_PRUEBA[k].nombre || '', plazas: TALLERES_PRUEBA[k].plazas || 1,
    sesiones: [], yaEnviado: false, prueba: true,
  }));
  const claves = clavesTodas.filter((k) => !TALLERES_PRUEBA[k]);
  if (!claves.length) return pruebas;
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
    if (!porEmail[key]) porEmail[key] = { clave: f.clave, email: f.email, nombre: primerNombre(f.nombre), plazas: 0, sesiones: [], yaEnviado: false };
    const d = porEmail[key];
    d.plazas += f.plazas;
    d.sesiones.push(s.id);
    if (!d.nombre) d.nombre = primerNombre(f.nombre);
    if (m.recordatorio_enviado === f.clave) d.yaEnviado = true; // ya enviado para ESTA fecha
  }
  return pruebas.concat(Object.values(porEmail));
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
      const fecha = q.fecha && TALLERES[q.fecha] ? q.fecha : Object.keys(TALLERES).find((k) => Date.parse(TALLERES[k].inicio) > Date.now()) || Object.keys(TALLERES).pop();
      const datos = { nombre: primerNombre(q.nombre), clave: fecha, plazas: parseInt(q.plazas, 10) || 1 };
      await enviar(String(q.prueba), datos, `[PRUEBA] ${ASUNTO}`);
      return res.status(200).json({ ok: true, prueba: `Recordatorio de ejemplo enviado a ${q.prueba}`, datos, activo: ACTIVO });
    }

    const claves = talleresATratar(q.fecha);
    const lista = await destinatarios(claves);

    // 2) Solo ver quién lo recibiría.
    if (q.ver) {
      return res.status(200).json({
        activo: ACTIVO,
        talleres: claves.map((k) => { const t = TALLERES[k] || TALLERES_PRUEBA[k]; return { clave: k, empieza: t.inicio, descripcion: t.descripcion }; }),
        recibirian: lista.filter((d) => !d.yaEnviado).map((d) => ({ fecha: d.clave, nombre: d.nombre, email: d.email, plazas: d.plazas })),
        ya_enviados: lista.filter((d) => d.yaEnviado).map((d) => ({ fecha: d.clave, email: d.email })),
      });
    }

    // 3) Envío real (lo lanza el cron). A clientas solo si ACTIVO = true; las pruebas siempre.
    const aEnviar = lista.filter((x) => !x.yaEnviado && (x.prueba || ACTIVO));
    if (!ACTIVO) console.log('Recordatorio a clientas desactivado (ACTIVO = false). Talleres en ventana:', claves.join(', ') || 'ninguno');

    const enviados = [];
    const errores = [];
    for (const d of aEnviar) {
      try {
        await enviar(d.email, d, d.prueba ? `[PRUEBA] ${ASUNTO}` : ASUNTO);
        for (const id of d.sesiones) await stripe.checkout.sessions.update(id, { metadata: { recordatorio_enviado: d.clave } });
        enviados.push({ fecha: d.clave, email: d.email, plazas: d.plazas });
      } catch (err) {
        console.error('Recordatorio no enviado a', d.email, err.message);
        errores.push({ email: d.email, error: err.message });
      }
      await esperar(600); // Resend admite ~2 envíos por segundo
    }
    console.log('Recordatorios enviados:', enviados.length, 'errores:', errores.length);
    return res.status(200).json({ ok: true, activo: ACTIVO, talleres: claves, enviados, errores });
  } catch (err) {
    console.error('Error en recordatorio:', err);
    return res.status(500).json({ error: err.message });
  }
};
