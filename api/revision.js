// api/revision.js
// Página de REVISIÓN: lista pedido por pedido lo que el contador de plazas
// está leyendo de Stripe y si lo cuenta o no (y por qué).
// No muestra nombres, emails ni teléfonos.
// Abrir: https://karama-stripe-backend.vercel.app/api/revision?clave=karama2026

const { analizarTodo, getDisponibilidad, TALLERES } = require('./_plazas');

const CLAVE = 'karama2026';

function fechaMadrid(ts) {
  return new Date(ts * 1000).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

module.exports = async (req, res) => {
  if ((req.query || {}).clave !== CLAVE) return res.status(403).send('Falta la clave');

  try {
    const filas = await analizarTodo();
    const disp = await getDisponibilidad();

    const td = 'style="padding:6px 10px;border-bottom:1px solid #ddd;"';
    const th = 'style="text-align:left;padding:6px 10px;border-bottom:2px solid #2E2622;"';
    const resumen = Object.keys(TALLERES).map((k) => {
      const d = disp[k];
      return `<tr><td ${td}><b>${k}</b></td><td ${td}>${d.vendidas}</td><td ${td}>${d.extra}</td><td ${td}><b>${d.ocupadas} / ${d.plazas}</b></td><td ${td}>${d.quedan}</td><td ${td}>${d.motivo || ''}</td></tr>`;
    }).join('');

    const orden = Object.keys(TALLERES);
    filas.sort((a, b) => (orden.indexOf(a.clave) - orden.indexOf(b.clave)) || (b.creado - a.creado));
    const rows = filas.map((f) => `<tr style="${f.cuenta ? '' : 'color:#aaa;'}">
      <td ${td}>${f.clave || '—'}</td><td ${td}>${f.cuenta ? '✅ SÍ' : '❌ NO'}</td><td ${td}>${f.plazas}</td>
      <td ${td}>${f.motivo}</td><td ${td}>${fechaMadrid(f.creado)}</td><td ${td}>${f.importe.toFixed(2)} €</td>
      <td ${td}>${f.reembolsado ? f.reembolsado.toFixed(2) + ' €' : ''}</td><td ${td}>${f.codigo}</td><td ${td}>${f.tipo}</td><td ${td}>${f.id}</td></tr>`).join('');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(`<!doctype html><meta charset="utf-8"><body style="font-family:Arial,sans-serif;font-size:13px;color:#2E2622;padding:20px;">
      <h2>Resumen por fecha</h2>
      <table style="border-collapse:collapse;margin-bottom:28px;"><tr><th ${th}>Fecha</th><th ${th}>Personas web</th><th ${th}>Extra</th><th ${th}>Ocupadas</th><th ${th}>Quedan</th><th ${th}>Estado</th></tr>${resumen}</table>
      <h2>Pedido por pedido</h2>
      <table style="border-collapse:collapse;"><tr><th ${th}>Fecha taller</th><th ${th}>¿Cuenta?</th><th ${th}>Personas</th><th ${th}>Motivo</th><th ${th}>Creado</th><th ${th}>Importe</th><th ${th}>Reembolsado</th><th ${th}>Código</th><th ${th}>Tipo</th><th ${th}>ID</th></tr>${rows}</table>
    </body>`);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Error: ' + err.message);
  }
};
