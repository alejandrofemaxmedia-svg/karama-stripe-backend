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
    // De qué taller es cada fecha / cada pedido.
    const NOMBRE = { velas: 'Taller de velas', recipientes: 'Taller de recipientes' };
    const tallerDe = (k) => (TALLERES[k] && TALLERES[k].taller) || 'velas';
    const tallerFila = (f) => (f.tipo === 'gift_voucher' ? (f.taller || 'velas') : (f.clave ? tallerDe(f.clave) : '—'));

    const cabecera = `<tr><th ${th}>Fecha</th><th ${th}>Personas web</th><th ${th}>Extra</th><th ${th}>Ocupadas</th><th ${th}>Quedan</th><th ${th}>Estado</th></tr>`;
    const resumenDe = (t) => Object.keys(TALLERES).filter((k) => tallerDe(k) === t).map((k) => {
      const d = disp[k];
      return `<tr><td ${td}><b>${k}</b></td><td ${td}>${d.vendidas}</td><td ${td}>${d.extra}</td><td ${td}><b>${d.ocupadas} / ${d.plazas}</b></td><td ${td}>${d.quedan}</td><td ${td}>${d.motivo || ''}</td></tr>`;
    }).join('') + (() => {
      const b = filas.filter((f) => f.venta && (f.taller || 'velas') === t);
      const n = b.reduce((a, f) => a + f.plazas, 0);
      const e = b.reduce((a, f) => a + f.importe, 0);
      return `<tr><td ${td}><b>Bonos regalo</b></td><td ${td}>${n} vendidos</td><td ${td}></td><td ${td}><b>${e.toFixed(2)} €</b></td><td ${td}></td><td ${td}>no ocupan plaza</td></tr>`;
    })();
    // Ventas que vienen de los correos de recuperación (solo pedidos que cuentan).
    const deCorreo = {};
    filas.filter((f) => (f.cuenta || f.venta) && f.origen && f.origen.startsWith('email-')).forEach((f) => {
      const k = f.origen.slice(6);
      deCorreo[k] = deCorreo[k] || { pedidos: 0, plazas: 0, euros: 0 };
      deCorreo[k].pedidos += 1; deCorreo[k].plazas += f.plazas; deCorreo[k].euros += f.importe;
    });
    const correos = Object.keys(deCorreo).sort().map((k) => `<tr><td ${td}><b>${k}</b></td><td ${td}>${deCorreo[k].pedidos}</td><td ${td}>${deCorreo[k].plazas}</td><td ${td}><b>${deCorreo[k].euros.toFixed(2)} €</b></td></tr>`).join('')
      || `<tr><td ${td} colspan="4">Todavía no hay ventas que vengan de los correos.</td></tr>`;
    const tablaCorreos = `<h3 style="margin:18px 0 8px;">Ventas desde los correos de recuperación</h3><table style="border-collapse:collapse;margin-bottom:22px;"><tr><th ${th}>Correo</th><th ${th}>Pedidos</th><th ${th}>Plazas / bonos</th><th ${th}>Importe</th></tr>${correos}</table>`;
    const resumen = Object.keys(NOMBRE).map((t) => `<h3 style="margin:18px 0 8px;">${NOMBRE[t]}</h3><table style="border-collapse:collapse;margin-bottom:22px;">${cabecera}${resumenDe(t)}</table>`).join('');

    const orden = Object.keys(TALLERES);
    filas.sort((a, b) => a.creado - b.creado); // por fecha de compra: los más nuevos, abajo
    const ok = (f) => f.cuenta || f.venta;
    const rows = filas.map((f) => `<tr style="${ok(f) ? '' : 'color:#aaa;'}">
      <td ${td}>${f.tipo === 'gift_voucher' ? 'Bono regalo' : (f.clave || '—')}</td><td ${td}>${tallerFila(f) === '—' ? '—' : NOMBRE[tallerFila(f)].replace('Taller de ', '')}</td><td ${td}>${ok(f) ? '✅ SÍ' : '❌ NO'}</td><td ${td}>${f.plazas}</td>
      <td ${td}>${f.motivo}</td><td ${td}>${fechaMadrid(f.creado)}</td><td ${td}>${f.importe.toFixed(2)} €</td>
      <td ${td}>${f.reembolsado ? f.reembolsado.toFixed(2) + ' €' : ''}</td><td ${td}>${f.codigo}</td><td ${td}>${f.tipo}</td><td ${td}>${f.origen ? (f.origen.startsWith('email-') ? '✉️ ' + f.origen.slice(6) : f.origen) : '—'}</td><td ${td}>${f.id}</td></tr>`).join('');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(`<!doctype html><meta charset="utf-8"><body style="font-family:Arial,sans-serif;font-size:13px;color:#2E2622;padding:20px;">
      <h2>Resumen por fecha</h2>
      ${resumen}
      ${tablaCorreos}
      <h2>Pedido por pedido</h2>
      <table style="border-collapse:collapse;"><tr><th ${th}>Fecha taller</th><th ${th}>Taller</th><th ${th}>¿Cuenta?</th><th ${th}>Personas</th><th ${th}>Motivo</th><th ${th}>Creado</th><th ${th}>Importe</th><th ${th}>Reembolsado</th><th ${th}>Código</th><th ${th}>Tipo</th><th ${th}>Origen</th><th ${th}>ID</th></tr>${rows}</table>
    </body>`);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Error: ' + err.message);
  }
};
