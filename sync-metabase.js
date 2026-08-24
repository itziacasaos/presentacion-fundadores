// ================================================================
// Sincroniza la tabla en vivo de Metabase (resultados mensuales por
// aviso) hacia Supabase, una vez al día (ver vercel.json → crons).
//
// Qué hace:
//   1. Descarga el CSV público de Metabase (no requiere login).
//   2. Lo agrupa por cliente y por mes -> arma "hist" (para el
//      histórico de leads / gráfica / tabla antes-después).
//   3. Lo agrupa por aviso (property_id) -> arma "ranking" (top
//      avisos por leads, con su Score y estatus real).
//   4. Sube ambos bloques a la tabla `dashboard_data` de Supabase
//      usando la service_role key (nunca se expone al navegador).
//
// Esta función NO toca los bloques "meta" (inversión/CPL de Meta
// Ads) ni "promos" (propuesta de renovación) — esos se siguen
// editando a mano desde Supabase o desde el modal de la propia
// presentación.
// ================================================================

const METABASE_CSV_URL =
  process.env.METABASE_CSV_URL ||
  'https://metabase.propiedades.com/public/question/de7b8657-4116-4bf1-8cd7-ff0a34e04a77.csv';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET; // opcional

const MONTH_LABELS = {
  '01': 'Ene', '02': 'Feb', '03': 'Mar', '04': 'Abr',
  '05': 'May', '06': 'Jun', '07': 'Jul', '08': 'Ago',
  '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dic',
};

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] !== undefined ? cols[i].trim() : ''; });
    return row;
  });
}

// Los nombres de cuenta vienen "sucios" (espacios extra, palabras repetidas).
// Los normalizamos a los mismos ids que ya usa la presentación.
function normalizeClientId(nombreCuenta) {
  const n = (nombreCuenta || '').toLowerCase();
  if (n.includes('cataño') || n.includes('catano')) return 'catano';
  if (n.includes('cattori')) return 'cattori';
  if (n.includes('mint')) return 'mint';
  // Cliente nuevo que no reconocemos todavía: generamos un id simple
  // a partir de la primera palabra, para no perder sus datos.
  const first = n.trim().split(/\s+/)[0] || 'cliente';
  return first.replace(/[^a-z0-9]/g, '') || 'cliente';
}

async function upsert(id, payload) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/dashboard_data`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify([{ id, payload, updated_at: new Date().toISOString() }]),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase rechazó "${id}": ${resp.status} ${text}`);
  }
}

module.exports = async (req, res) => {
  // Protección opcional: si configuras CRON_SECRET en Vercel, solo Vercel
  // Cron (que envía este header automáticamente) o quien tenga el secreto
  // puede disparar la sincronización manualmente.
  if (CRON_SECRET) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${CRON_SECRET}`) {
      res.status(401).json({ ok: false, error: 'No autorizado' });
      return;
    }
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({
      ok: false,
      error: 'Faltan las variables de entorno SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en Vercel.',
    });
    return;
  }

  try {
    const csvResp = await fetch(METABASE_CSV_URL);
    if (!csvResp.ok) throw new Error('No se pudo descargar el CSV de Metabase: ' + csvResp.status);
    const csvText = await csvResp.text();
    const rows = parseCSV(csvText);

    const clientNames = {};
    const seriesByClient = {};
    const propsByClient = {};

    rows.forEach((r) => {
      if (!r.nombre_cuenta) return;
      const cid = normalizeClientId(r.nombre_cuenta);
      clientNames[cid] = r.nombre_cuenta.trim();

      seriesByClient[cid] = seriesByClient[cid] || {};
      const mes = r.mes; // 'YYYY-MM'
      seriesByClient[cid][mes] = seriesByClient[cid][mes] || { leads: 0, visitas: 0, impresiones: 0 };
      seriesByClient[cid][mes].leads += Number(r.leads || 0);
      seriesByClient[cid][mes].visitas += Number(r.visitas || 0);
      seriesByClient[cid][mes].impresiones += Number(r.impresiones || 0);

      propsByClient[cid] = propsByClient[cid] || {};
      const pid = r.property_id;
      if (!propsByClient[cid][pid]) {
        propsByClient[cid][pid] = {
          property_id: pid,
          codigo_aviso: r.codigo_aviso,
          tipo_operacion: r.tipo_operacion,
          estatus_aviso: r.estatus_aviso,
          score: Number(r.score || 0),
          leads: 0, visitas: 0, impresiones: 0,
          _lastMes: mes,
        };
      }
      const p = propsByClient[cid][pid];
      p.leads += Number(r.leads || 0);
      p.visitas += Number(r.visitas || 0);
      p.impresiones += Number(r.impresiones || 0);
      // Nos quedamos con el estatus/score del mes más reciente de cada aviso
      if (mes >= p._lastMes) {
        p._lastMes = mes;
        p.estatus_aviso = r.estatus_aviso;
        p.score = Number(r.score || 0);
      }
    });

    // ---- HIST: histórico mensual por cliente ----
    const hist = { clients: {} };
    Object.keys(seriesByClient).forEach((cid) => {
      const months = Object.keys(seriesByClient[cid]).sort();
      const series = months.map((m) => {
        const mm = m.split('-')[1];
        return {
          mes: MONTH_LABELS[mm] || mm,
          leads: seriesByClient[cid][m].leads,
          contactos: 0,
          eventos: 0,
          impresiones: seriesByClient[cid][m].impresiones,
          vistas: seriesByClient[cid][m].visitas,
        };
      });
      const activos = Object.values(propsByClient[cid] || {}).filter((p) => p.estatus_aviso === 'Aprobada').length;
      hist.clients[cid] = {
        id: cid,
        nombre: clientNames[cid],
        propiedades_activas: activos,
        propiedades_total: Object.keys(propsByClient[cid] || {}).length,
        series,
      };
    });

    // ---- RANKING: top 8 avisos por leads acumulados, por cliente ----
    const ranking = {};
    Object.keys(propsByClient).forEach((cid) => {
      const list = Object.values(propsByClient[cid]).map((p) => ({
        codigo: p.codigo_aviso,
        property_id: Number(p.property_id),
        tipo_operacion: p.tipo_operacion,
        estatus: p.estatus_aviso,
        leads: p.leads,
        impresiones: p.impresiones,
        vistas: p.visitas,
        score: p.score,
      }));
      list.sort((a, b) => b.leads - a.leads);
      ranking[cid] = list.slice(0, 8);
    });

    await upsert('hist', hist);
    await upsert('ranking', ranking);

    res.status(200).json({
      ok: true,
      clientes: Object.keys(hist.clients),
      filas_leidas: rows.length,
      actualizado: new Date().toISOString(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
};
