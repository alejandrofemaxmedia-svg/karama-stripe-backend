// api/asistentes.js
// PANEL DE ASISTENTES para Rosario: elige una fecha y ve quién viene, con
// cuántas entradas, para pasar lista el día del taller. Se actualiza solo.
// Es privado: solo se abre con la clave guardada en Vercel (PANEL_CLAVE).
// Abrir: https://karama-stripe-backend.vercel.app/api/asistentes?clave=LA_CLAVE

const { analizarTodo, TALLERES } = require('./_plazas');

const LOGO_URL = 'https://assets.cdn.filesafe.space/cUbw00M3Wh3pEAW7hgrK/media/6aa9178e90b7ca67e9b4e4f0.png';

function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function nombreBonito(nombre, email) {
  let n = (nombre || '').trim();
  if (!n && email) n = email.split('@')[0];
  if (!n) return 'Sin nombre';
  return n.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (x) => x.toUpperCase());
}

function etiquetaFecha(k) {
  return TALLERES[k].descripcion.split(' · ')[0];
}

function etiquetaCorta(k) {
  const m = TALLERES[k].descripcion.match(/^(\S+)\s+(\d+) de (\p{L}+)/u);
  return m ? `${m[1].slice(0, 3)} ${m[2]} ${m[3].slice(0, 3)}` : k;
}

module.exports = async (req, res) => {
  const CLAVE = process.env.PANEL_CLAVE;
  const q = req.query || {};
  res.setHeader('Cache-Control', 'no-store');
  if (!CLAVE || q.clave !== CLAVE) return res.status(403).send('Acceso no autorizado');

  try {
    const filas = await analizarTodo();
    const ahora = Date.now();

    // Próximas fechas (se siguen viendo hasta 4 horas después de empezar el taller).
    const fechas = Object.keys(TALLERES)
      .filter((k) => Date.parse(TALLERES[k].inicio) + 4 * 3600 * 1000 > ahora)
      .sort((a, b) => Date.parse(TALLERES[a].inicio) - Date.parse(TALLERES[b].inicio));

    const porFecha = {};
    fechas.forEach((k) => {
      const reservas = filas
        .filter((f) => f.cuenta && f.clave === k)
        .sort((a, b) => a.creado - b.creado)
        .map((f) => ({ id: f.id, nombre: nombreBonito(f.nombre, f.email), telefono: f.telefono, entradas: f.plazas, bono: !f.importe }));
      const web = reservas.reduce((a, r) => a + r.entradas, 0);
      const extra = TALLERES[k].extra || 0;
      porFecha[k] = { reservas, web, extra, total: web + extra };
    });

    const sel = fechas.includes(q.fecha) ? q.fecha : fechas[0];
    const clave = encodeURIComponent(q.clave);
    const hora = new Date().toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });

    const chips = fechas.map((k) => `
      <a class="chip${k === sel ? ' on' : ''}" href="?clave=${clave}&fecha=${k}">
        <span class="chip-d">${esc(etiquetaCorta(k))}</span>
        <span class="chip-n">${porFecha[k].total} pers.</span>
      </a>`).join('');

    let cuerpo = '<p class="vacio">No hay talleres próximos.</p>';
    if (sel) {
      const d = porFecha[sel];
      const lista = d.reservas.map((r) => {
        const acomp = r.entradas - 1;
        const detalle = acomp > 0 ? `${esc(r.nombre.split(' ')[0])} + ${acomp} acompañante${acomp > 1 ? 's' : ''}` : 'Viene sola/o';
        return `
        <label class="fila" data-id="${esc(r.id)}" data-n="${r.entradas}">
          <input type="checkbox" class="check">
          <span class="caja" aria-hidden="true"></span>
          <span class="info">
            <span class="nombre">${esc(r.nombre)}</span>
            <span class="detalle">${detalle}${r.bono ? ' · bono regalo' : ''}${r.telefono ? ` · <a href="tel:${esc(r.telefono)}">${esc(r.telefono)}</a>` : ''}</span>
          </span>
          <span class="entradas"><b>${r.entradas}</b><small>entrada${r.entradas > 1 ? 's' : ''}</small></span>
        </label>`;
      }).join('') || '<p class="vacio">Todavía no hay reservas para esta fecha.</p>';

      cuerpo = `
      <section class="resumen">
        <div class="res-fecha">${esc(etiquetaFecha(sel))}</div>
        <div class="res-nums">
          <div><b>${d.total}</b><span>personas</span></div>
          <div><b>${d.reservas.length}</b><span>reservas</span></div>
          <div><b id="llegados">0</b><span>han llegado</span></div>
        </div>
        ${d.extra ? `<div class="res-extra">Incluye ${d.extra} plaza${d.extra > 1 ? 's' : ''} reservada${d.extra > 1 ? 's' : ''} por fuera de la web.</div>` : ''}
      </section>
      <section class="lista">${lista}</section>
      <p class="ayuda">Toca a cada persona cuando llegue para marcarla. Las marcas se guardan solo en este dispositivo.</p>`;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Asistentes · Karama Candle</title>
<link rel="icon" href="${LOGO_URL}">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Fraunces:ital,wght@1,400;1,500&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{--ink:#2E2622;--ink-soft:#4A3F39;--stone:#8C7C77;--blush:#F3D8CF;--blush-deep:#E7BCAC;--paper:#FDF8F3;--line:rgba(46,38,34,.12);}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:'Inter',sans-serif;background:var(--paper);color:var(--ink);-webkit-font-smoothing:antialiased;min-height:100vh;}
  header{background:var(--blush);padding:22px 16px 26px;text-align:center;}
  header img{width:64px;height:64px;border-radius:50%;box-shadow:0 8px 22px rgba(46,38,34,.14);}
  header h1{font-family:'Archivo Black',sans-serif;text-transform:uppercase;font-size:22px;letter-spacing:-.01em;margin-top:12px;}
  header p{font-family:'Fraunces',serif;font-style:italic;font-size:15px;color:var(--ink-soft);margin-top:2px;}
  .wrap{max-width:720px;margin:0 auto;padding:0 16px 40px;}
  .chips{display:flex;gap:8px;overflow-x:auto;padding:16px 2px 6px;margin-top:-22px;scrollbar-width:none;}
  .chips::-webkit-scrollbar{display:none;}
  .chip{flex:none;display:flex;flex-direction:column;align-items:center;gap:2px;text-decoration:none;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:14px;padding:10px 14px;min-width:92px;box-shadow:0 6px 16px rgba(46,38,34,.06);}
  .chip-d{font-weight:800;font-size:13px;text-transform:capitalize;}
  .chip-n{font-size:11.5px;color:var(--stone);}
  .chip.on{background:var(--ink);border-color:var(--ink);}
  .chip.on .chip-d{color:var(--blush);} .chip.on .chip-n{color:#d9c3b8;}
  .resumen{background:#fff;border:1px solid var(--line);border-radius:18px;padding:18px 18px 16px;margin-top:14px;}
  .res-fecha{font-family:'Archivo Black',sans-serif;text-transform:uppercase;font-size:15px;line-height:1.25;}
  .res-nums{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px;}
  .res-nums div{background:var(--paper);border-radius:12px;padding:10px 6px;text-align:center;}
  .res-nums b{display:block;font-family:'Archivo Black',sans-serif;font-size:24px;line-height:1;}
  .res-nums span{display:block;font-size:11.5px;color:var(--stone);margin-top:4px;}
  .res-extra{font-size:12px;color:var(--ink-soft);margin-top:10px;}
  .lista{margin-top:12px;background:#fff;border:1px solid var(--line);border-radius:18px;overflow:hidden;}
  .fila{display:flex;align-items:center;gap:12px;padding:14px 16px;border-top:1px solid var(--line);cursor:pointer;-webkit-tap-highlight-color:transparent;}
  .fila:first-child{border-top:none;}
  .check{position:absolute;opacity:0;pointer-events:none;}
  .caja{flex:none;width:26px;height:26px;border-radius:50%;border:2px solid var(--blush-deep);display:flex;align-items:center;justify-content:center;transition:.15s;}
  .check:checked + .caja{background:var(--ink);border-color:var(--ink);}
  .check:checked + .caja::after{content:'';width:10px;height:6px;border-left:2.5px solid var(--blush);border-bottom:2.5px solid var(--blush);transform:rotate(-45deg) translate(1px,-1px);}
  .info{flex:1;min-width:0;display:flex;flex-direction:column;}
  .nombre{font-weight:700;font-size:15.5px;}
  .detalle{font-size:12.5px;color:var(--stone);margin-top:2px;}
  .detalle a{color:var(--ink-soft);}
  .entradas{flex:none;text-align:center;background:var(--blush);border-radius:12px;padding:6px 10px;min-width:58px;}
  .entradas b{display:block;font-family:'Archivo Black',sans-serif;font-size:20px;line-height:1;}
  .entradas small{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;}
  .fila.ok .nombre{text-decoration:line-through;color:var(--stone);}
  .fila.ok .entradas{background:var(--paper);}
  .vacio{padding:22px 16px;text-align:center;color:var(--stone);font-size:14px;}
  .ayuda,.act{font-size:12px;color:var(--stone);text-align:center;margin-top:14px;line-height:1.5;}
  @media (min-width:720px){header{padding:30px 16px 34px;} header h1{font-size:26px;} .chips{justify-content:center;flex-wrap:wrap;}}
</style></head>
<body>
<header>
  <img src="${LOGO_URL}" alt="Karama Candle">
  <h1>Lista de asistentes</h1>
  <p>Talleres de velas · Bilbao</p>
</header>
<main class="wrap">
  <nav class="chips">${chips}</nav>
  ${cuerpo}
  <p class="act">Actualizado a las ${hora} · se actualiza solo cada minuto</p>
</main>
<script>
(function(){
  var fecha = ${JSON.stringify(sel || '')};
  function key(id){ return 'karama-llegada-' + fecha + '-' + id; }
  function get(k){ try { return localStorage.getItem(k) === '1'; } catch(e){ return false; } }
  function set(k,v){ try { v ? localStorage.setItem(k,'1') : localStorage.removeItem(k); } catch(e){} }
  var filas = document.querySelectorAll('.fila');
  function contar(){
    var n = 0;
    filas.forEach(function(f){ if (f.querySelector('.check').checked) n += parseInt(f.getAttribute('data-n'),10) || 0; });
    var el = document.getElementById('llegados'); if (el) el.textContent = n;
  }
  filas.forEach(function(f){
    var c = f.querySelector('.check'), id = f.getAttribute('data-id');
    c.checked = get(key(id)); f.classList.toggle('ok', c.checked);
    c.addEventListener('change', function(){ set(key(id), c.checked); f.classList.toggle('ok', c.checked); contar(); });
  });
  contar();
  setInterval(function(){ if (document.visibilityState === 'visible') location.reload(); }, 60000);
})();
</script>
</body></html>`);
  } catch (err) {
    console.error('Error en el panel de asistentes:', err);
    return res.status(500).send('Error cargando el panel. Inténtalo de nuevo en unos segundos.');
  }
};
