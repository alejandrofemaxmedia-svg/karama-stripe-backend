// api/plazas.js
// URL pública que leen las landings para saber cuántas plazas quedan:
// https://karama-stripe-backend.vercel.app/api/plazas
// Solo devuelve si cada fecha está agotada y cuántas quedan (no muestra
// datos de clientes ni importes).

const { getDisponibilidad } = require('./_plazas');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const disp = await getDisponibilidad();
    const fechas = {};
    for (const k of Object.keys(disp)) {
      fechas[k] = { quedan: disp[k].quedan, agotado: disp[k].agotado, ultimas: disp[k].ultimas };
    }
    // Vercel guarda la respuesta 15 segundos para no consultar Stripe en cada visita.
    res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=60');
    return res.status(200).json({ fechas, actualizado: new Date().toISOString() });
  } catch (err) {
    console.error('Error calculando plazas:', err);
    return res.status(500).json({ error: 'No se pudieron calcular las plazas' });
  }
};
