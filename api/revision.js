// api/revision.js
// Página de REVISIÓN: lista pedido por pedido lo que el contador de plazas
// está leyendo de Stripe, para comprobar que cuadra con la realidad.
// No muestra nombres, emails ni teléfonos.
// Abrir: https://karama-stripe-backend.vercel.app/api/revision?clave=karama2026

const { stripe, claveDeSesion } = require('./_plazas');

const CLAVE = 'karama2026';
const DIAS_ATRAS = 150;

function fechaMadrid(ts) {
  return new Date(ts * 1000).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

module.exports = async (req, res) => {
  if ((req.query || {}).clave !== CLAVE) return res.status(403).send('Falta la clave');

  try {
    const desde = Math.floor(Date.now() / 1000) - DIAS_ATRAS * 86400;
    const filas = [];
    await stripe.checkout.sessions
      .list({ status: 'complete', created: { gte: desde }, limit: 100, expand: ['data.payment_intent.latest_charge'] })
      .autoPagingEach((s) => {
        const m = s.metadata || {};
        const charge = s.payment_intent && s.payment_intent.latest_charge;
        filas.push({
          creado: fechaMadrid(s.created),
          tipo: m.type || '(sin tipo)',
          fecha_contada: claveDeSesion(s) || '—',
          descripcion: m.date_description || '',
          plazas: m.quantity || '',
          importe: ((s.amount_total || 0) / 100).toFixed(2) + ' €',
          reembolsado: charge && charge.amount_refunded ? ((charge.amount_refunded / 100).toFixed(2) + ' €') : '',
          id: s.id.slice(-8),
        });
      });

    const totales = {};
    filas.forEach((f) => {
      if (f.tipo === 'booking') totales[f.fecha_contada] = (totales[f.fecha_contada] || 0) + (parseInt(f.plazas, 10) || 0);
    });

    const th = 'style="text-align:left;padding:6px 10px;border-bottom:2px solid #2E2622;"';
    const td = 'style="padding:6px 10px;border-bottom:1px solid #ddd;"';
    const rows = filas.map((f) => `<tr>${['creado', 'tipo', 'fecha_contada', 'plazas', 'importe', 'reembolsado', 'descripcion', 'id'].map((k) => `<td ${td}>${f[k]}</td>`).join('')}</tr>`).join('');
    const tot = Object.keys(totales).map((k) => `<li><b>${k}</b>: ${totales[k]} plazas</li>`).join('');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(`<!doctype html><meta charset="utf-8"><body style="font-family:Arial,sans-serif;font-size:13px;color:#2E2622;padding:20px;">
      <h2>Revisión de plazas · pagos completados en Stripe</h2>
      <ul>${tot}</ul>
      <table style="border-collapse:collapse;"><tr>${['Creado', 'Tipo', 'Fecha contada', 'Plazas', 'Importe', 'Reembolsado', 'Descripción', 'ID'].map((h) => `<th ${th}>${h}</th>`).join('')}</tr>${rows}</table>
    </body>`);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Error: ' + err.message);
  }
};
