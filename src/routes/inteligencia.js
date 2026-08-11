const express = require('express');
const { requiereSuscripcionCultivos } = require('../subscription');
const db = require('../db');
const { nuevoId, requiereAuth } = require('../auth');

const router = express.Router();
router.use(requiereAuth);
router.use(requiereSuscripcionCultivos);

const WEATHER_BASE = (process.env.WEATHER_API_BASE || 'https://api.open-meteo.com').replace(/\/$/, '');
const WEATHER_GEOCODING_BASE = (process.env.WEATHER_GEOCODING_BASE || 'https://geocoding-api.open-meteo.com').replace(/\/$/, '');
const WEATHER_API_KEY = process.env.WEATHER_API_KEY || '';
const CLIMA_CACHE_MIN = Math.max(5, Number(process.env.CLIMA_CACHE_MINUTES || 30));
const ODEPA_RESOURCE_ID = process.env.ODEPA_RESOURCE_ID || '580beca0-e87e-4dd4-9e8a-0bd92773f4a6';

function texto(v, max = 250) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function n(v, fallback = null) { const x = Number(v); return Number.isFinite(x) ? x : fallback; }
function sqlLike(s) { return String(s || '').replace(/'/g, "''"); }

function loteVisible(usuario, loteId) {
  const lote = db.prepare(`SELECT l.*, f.productor_id, f.gestor_id, f.cliente_id, f.nombre finca_nombre,
    f.pais, f.region, f.ciudad, f.ubicacion_id, f.latitud, f.longitud, f.altitud,
    COALESCE(c.nombre, f.cliente_nombre_cache) cliente_nombre
    FROM lotes l JOIN fincas f ON f.id=l.finca_id
    LEFT JOIN clientes_agronomicos c ON c.id=f.cliente_id
    WHERE l.id=? AND l.eliminado_en IS NULL AND f.eliminado_en IS NULL`).get(loteId);
  if (!lote) return null;
  if (usuario.rol === 'admin' || lote.productor_id === usuario.id || lote.gestor_id === usuario.id) return lote;
  if (usuario.rol === 'agronomo') {
    const asignado = db.prepare('SELECT 1 FROM agronomo_asignacion WHERE finca_id=? AND agronomo_id=?').get(lote.finca_id, usuario.id);
    if (asignado) return lote;
  }
  return null;
}

async function fetchJson(url, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'DrPlants/8B' } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body?.reason || body?.error || `HTTP ${r.status}`);
    return body;
  } finally { clearTimeout(timer); }
}

function weatherUrl(path, params) {
  const u = new URL(`${WEATHER_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== '') u.searchParams.set(k, String(v)); });
  if (WEATHER_API_KEY) u.searchParams.set('apikey', WEATHER_API_KEY);
  return u.toString();
}

async function asegurarCoordenadas(lote) {
  if (Number.isFinite(Number(lote.latitud)) && Number.isFinite(Number(lote.longitud)) && Number(lote.latitud) !== 0 && Number(lote.longitud) !== 0) {
    return { lat: Number(lote.latitud), lon: Number(lote.longitud), altitud: n(lote.altitud, null) };
  }
  const consulta = [lote.ciudad, lote.region, lote.pais].filter(Boolean).join(', ');
  if (!consulta) throw new Error('La finca no tiene ciudad/región suficientes para ubicarla.');
  const u = new URL(`${WEATHER_GEOCODING_BASE}/v1/search`);
  u.searchParams.set('name', consulta);
  u.searchParams.set('count', '1');
  u.searchParams.set('language', 'es');
  u.searchParams.set('format', 'json');
  if (WEATHER_API_KEY) u.searchParams.set('apikey', WEATHER_API_KEY);
  const data = await fetchJson(u.toString());
  const x = data?.results?.[0];
  if (!x) throw new Error('No se pudieron resolver las coordenadas de la finca.');
  db.prepare(`UPDATE fincas SET latitud=?, longitud=?, altitud=COALESCE(?,altitud), actualizado_en=datetime('now') WHERE id=?`)
    .run(x.latitude, x.longitude, x.elevation ?? null, lote.finca_id);
  return { lat: x.latitude, lon: x.longitude, altitud: x.elevation ?? null };
}

function cropParams(nombre) {
  const s = String(nombre || '').toLowerCase();
  const defs = [
    [/caf[eé]/, { base: 10, calor: 30, kc: 0.95 }],
    [/arroz/, { base: 10, calor: 34, kc: 1.15 }],
    [/ma[ií]z/, { base: 10, calor: 35, kc: 1.10 }],
    [/aguacate/, { base: 8, calor: 32, kc: 0.85 }],
    [/cacao/, { base: 10, calor: 32, kc: 1.00 }],
    [/papa/, { base: 5, calor: 28, kc: 0.95 }],
    [/banano|pl[aá]tano/, { base: 12, calor: 35, kc: 1.10 }],
    [/tomate/, { base: 10, calor: 32, kc: 1.05 }]
  ];
  return defs.find(([re]) => re.test(s))?.[1] || { base: 10, calor: 34, kc: 1.0 };
}

function construirResumenClima(data, lote) {
  const d = data.daily || {};
  const fechas = d.time || [];
  const p = cropParams(lote.cultivo_nombre || lote.cultivo_id);
  const dias = fechas.map((fecha, i) => {
    const tmax = n(d.temperature_2m_max?.[i], 0);
    const tmin = n(d.temperature_2m_min?.[i], 0);
    const tmean = (tmax + tmin) / 2;
    const precip = n(d.precipitation_sum?.[i], 0);
    const et0 = n(d.et0_fao_evapotranspiration?.[i], 0);
    return {
      fecha, tmax, tmin, tmean, precip, et0,
      radiacion: n(d.shortwave_radiation_sum?.[i], 0),
      vientoMax: n(d.wind_speed_10m_max?.[i], 0),
      gradosDia: Math.max(0, tmean - p.base),
      estresCalor: tmax >= p.calor
    };
  });
  const primeros7 = dias.slice(0, 7);
  const sum = (arr, key) => arr.reduce((a, x) => a + n(x[key], 0), 0);
  const precip7 = sum(primeros7, 'precip');
  const et07 = sum(primeros7, 'et0');
  const demandaCultivo7 = et07 * p.kc;
  const balance7 = precip7 - demandaCultivo7;
  const calor7 = primeros7.filter(x => x.estresCalor).length;
  const gd7 = sum(primeros7, 'gradosDia');
  let riesgoHidrico = 'bajo';
  if (balance7 < -35) riesgoHidrico = 'alto'; else if (balance7 < -15) riesgoHidrico = 'medio';
  let riesgoTermico = calor7 >= 3 ? 'alto' : calor7 >= 1 ? 'medio' : 'bajo';
  const factorClima = Math.max(0.70, Math.min(1.02, 1 - Math.max(0, -balance7) / 250 - calor7 * 0.025));
  return {
    actual: {
      temperatura: n(data.current?.temperature_2m),
      humedad: n(data.current?.relative_humidity_2m),
      precipitacion: n(data.current?.precipitation),
      codigoClima: data.current?.weather_code ?? null
    },
    resumen7d: {
      precipitacionMm: Number(precip7.toFixed(1)),
      et0Mm: Number(et07.toFixed(1)),
      demandaCultivoMm: Number(demandaCultivo7.toFixed(1)),
      balanceHidricoMm: Number(balance7.toFixed(1)),
      necesidadRiegoIndicativaMm: Number(Math.max(0, -balance7).toFixed(1)),
      gradosDia: Number(gd7.toFixed(1)),
      diasEstresCalor: calor7,
      riesgoHidrico, riesgoTermico,
      factorClimaIndicativo: Number(factorClima.toFixed(3))
    },
    parametros: p,
    dias
  };
}

async function consultarClima(lote, force = false) {
  const reciente = db.prepare(`SELECT * FROM clima_lote_snapshots WHERE lote_id=? AND creado_en >= datetime('now', ?) ORDER BY creado_en DESC LIMIT 1`)
    .get(lote.id, `-${CLIMA_CACHE_MIN} minutes`);
  if (reciente && !force) return JSON.parse(reciente.payload_json);
  const coords = await asegurarCoordenadas(lote);
  const url = weatherUrl('/v1/forecast', {
    latitude: coords.lat, longitude: coords.lon, timezone: 'auto', forecast_days: 14,
    current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,et0_fao_evapotranspiration,shortwave_radiation_sum,wind_speed_10m_max'
  });
  const raw = await fetchJson(url);
  const resumen = construirResumenClima(raw, lote);
  const payload = {
    fuente: 'Open-Meteo',
    fuenteUrl: 'https://open-meteo.com/',
    comercial: Boolean(WEATHER_API_KEY || WEATHER_BASE.includes('customer-api') || !WEATHER_BASE.includes('open-meteo.com')),
    generadoEn: new Date().toISOString(),
    coordenadas: { lat: coords.lat, lon: coords.lon, altitud: coords.altitud },
    ...resumen
  };
  db.prepare(`INSERT INTO clima_lote_snapshots(id,lote_id,fuente,latitud,longitud,payload_json,creado_en) VALUES(?,?,?,?,?,?,datetime('now'))`)
    .run(nuevoId('clm'), lote.id, 'open-meteo', coords.lat, coords.lon, JSON.stringify(payload));
  return payload;
}

function fuenteMercado(pais) {
  const p = String(pais || '').toLowerCase();
  if (p.includes('colom')) return { codigo: 'DANE_SIPSA', nombre: 'DANE · SIPSA', url: 'https://www.dane.gov.co/index.php/servicios-al-ciudadano-2/servicios-de-informacion/sipsa', automatico: false };
  if (p.includes('per')) return { codigo: 'MIDAGRI', nombre: 'MIDAGRI · Datos Agrarios', url: 'https://www.datosabiertos.gob.pe/group/ministerio-de-desarrollo-agrario-y-riego-midagri', automatico: false };
  if (p.includes('chil')) return { codigo: 'ODEPA', nombre: 'ODEPA · Precios mayoristas', url: 'https://datos.odepa.gob.cl/dataset/precios-mayoristas-de-frutas-y-hortalizas', automatico: true };
  return { codigo: 'SIN_FUENTE', nombre: 'Sin fuente configurada', url: null, automatico: false };
}

async function consultarOdepa(producto, region) {
  const q = sqlLike(producto.toLowerCase());
  const reg = sqlLike(String(region || '').toLowerCase());
  let where = `lower(\"Producto\") LIKE '%${q}%'`;
  if (reg) where += ` AND lower(\"Region\") LIKE '%${reg}%'`;
  const sql = `SELECT \"Fecha\",\"Region\",\"Mercado\",\"Producto\",\"Variedad / Tipo\",\"Unidad de comercializacion\",\"Precio minimo\",\"Precio maximo\",\"Precio promedio\" FROM \"${ODEPA_RESOURCE_ID}\" WHERE ${where} ORDER BY \"Fecha\" DESC LIMIT 20`;
  const u = new URL('https://datos.odepa.gob.cl/api/3/action/datastore_search_sql');
  u.searchParams.set('sql', sql);
  const data = await fetchJson(u.toString(), 15000);
  const records = data?.result?.records || [];
  return records.map(r => ({
    fecha: r.Fecha, region: r.Region, mercado: r.Mercado, producto: r.Producto, variedad: r['Variedad / Tipo'],
    unidad: r['Unidad de comercializacion'], minimo: n(r['Precio minimo']), maximo: n(r['Precio maximo']), promedio: n(r['Precio promedio']), moneda: 'CLP', fuente: 'ODEPA'
  }));
}

async function obtenerMercado(lote, force = false) {
  const pais = lote.pais || 'Colombia';
  const producto = lote.cultivo_nombre || lote.cultivo_id;
  const fuente = fuenteMercado(pais);
  let registros = db.prepare(`SELECT * FROM precios_mercado WHERE pais=? AND lower(producto) LIKE ? ORDER BY fecha DESC, creado_en DESC LIMIT 30`)
    .all(pais, `%${String(producto || '').toLowerCase()}%`);
  let sincronizado = false;
  let aviso = null;
  if (fuente.codigo === 'ODEPA' && (force || !registros.length)) {
    try {
      const rows = await consultarOdepa(producto, lote.region);
      const ins = db.prepare(`INSERT OR IGNORE INTO precios_mercado(id,pais,region,mercado,producto,variedad,unidad,precio_min,precio_max,precio_promedio,moneda,fuente,fuente_url,fecha,creado_en)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`);
      const tx = db.transaction(() => {
        for (const r of rows) ins.run(nuevoId('pm'), pais, r.region || null, r.mercado || null, r.producto, r.variedad || null, r.unidad || null, r.minimo, r.maximo, r.promedio, r.moneda, 'ODEPA', fuente.url, r.fecha || new Date().toISOString().slice(0,10));
      }); tx();
      registros = db.prepare(`SELECT * FROM precios_mercado WHERE pais=? AND lower(producto) LIKE ? ORDER BY fecha DESC, creado_en DESC LIMIT 30`).all(pais, `%${String(producto || '').toLowerCase()}%`);
      sincronizado = true;
    } catch (e) { aviso = `No se pudo sincronizar ODEPA: ${e.message}`; }
  }
  if (!fuente.automatico && !registros.length) aviso = 'La fuente oficial está identificada, pero no ofrece en este proyecto un endpoint diario estable ya normalizado. Se mostrará el precio manual/objetivo del lote hasta completar el conector específico.';
  return { fuente, registros, sincronizado, aviso };
}

function ultimaMedicionLluvia(loteId) {
  return db.prepare(`SELECT * FROM mediciones_campo WHERE lote_id=? AND tipo='precipitacion' ORDER BY fecha DESC, creado_en DESC LIMIT 1`).get(loteId) || null;
}

function costoAcumulado(loteId) {
  const a = db.prepare(`SELECT COALESCE(SUM(costo_cop),0) n FROM aplicaciones WHERE lote_id=? AND eliminado_en IS NULL`).get(loteId).n;
  const c = db.prepare(`SELECT COALESCE(SUM(costo_cop),0) n FROM costos_operativos WHERE lote_id=? AND eliminado_en IS NULL`).get(loteId).n;
  return Number(a) + Number(c);
}

function calcularProyeccion(lote, clima, mercado) {
  const rendimientoHa = n(lote.rendimiento_objetivo_ha, 0);
  const produccion = rendimientoHa * Number(lote.area_ha || 0);
  const precioManual = n(lote.precio_objetivo, 0);
  const market = mercado?.registros?.find(x => n(x.precio_promedio, null) !== null);
  const precio = precioManual || n(market?.precio_promedio, 0);
  const moneda = lote.moneda_proyeccion || market?.moneda || (String(lote.pais).toLowerCase().includes('chil') ? 'CLP' : String(lote.pais).toLowerCase().includes('per') ? 'PEN' : 'COP');
  const ingresoBase = produccion * precio;
  const factor = n(clima?.resumen7d?.factorClimaIndicativo, 1);
  const produccionAjustada = produccion * factor;
  const ingresoAjustado = produccionAjustada * precio;
  const costos = costoAcumulado(lote.id);
  const utilidad = ingresoAjustado - costos;
  const margen = ingresoAjustado > 0 ? utilidad / ingresoAjustado * 100 : null;
  return {
    rendimientoObjetivoHa: rendimientoHa,
    unidadRendimiento: lote.unidad_rendimiento || 'kg/ha',
    produccionBase: Number(produccion.toFixed(2)),
    factorClimaIndicativo: factor,
    produccionAjustadaClima: Number(produccionAjustada.toFixed(2)),
    precioReferencia: precio,
    precioFuente: precioManual ? 'Configurado por el usuario' : (market?.fuente || mercado?.fuente?.nombre || 'Sin precio'),
    unidadPrecio: market?.unidad || lote.unidad_precio || null,
    moneda,
    ingresoBase: Math.round(ingresoBase),
    ingresoAjustadoClima: Math.round(ingresoAjustado),
    costosAcumulados: Math.round(costos),
    utilidadIndicativa: Math.round(utilidad),
    margenIndicativoPct: margen === null ? null : Number(margen.toFixed(1)),
    advertencia: 'Proyección indicativa. El factor climático es un indicador de riesgo, no una predicción garantizada de rendimiento. Ajusta rendimiento y precio con información real del cultivo y del mercado.'
  };
}


router.get('/geocodificar', async (req,res) => {
  const pais=texto(req.query.pais,80),region=texto(req.query.region,120),ciudad=texto(req.query.ciudad,120);
  const consulta=[ciudad,region,pais].filter(Boolean).join(', ');
  if(!consulta) return res.status(400).json({error:'Falta la ubicación.'});
  try{
    const u=new URL(`${WEATHER_GEOCODING_BASE}/v1/search`);u.searchParams.set('name',consulta);u.searchParams.set('count','1');u.searchParams.set('language','es');u.searchParams.set('format','json');if(WEATHER_API_KEY)u.searchParams.set('apikey',WEATHER_API_KEY);
    const d=await fetchJson(u.toString());const x=d?.results?.[0];if(!x)return res.status(404).json({error:'No se encontró la ubicación.'});
    res.json({label:[x.name,x.admin1].filter(Boolean).join(', '),lat:x.latitude,lon:x.longitude,altitud:x.elevation??null,pais:x.country||pais});
  }catch(e){res.status(502).json({error:e.message||'No se pudo geocodificar.'});}
});

router.get('/lotes/:id', async (req, res) => {
  const lote = loteVisible(req.usuario, req.params.id);
  if (!lote) return res.status(404).json({ error: 'Lote no encontrado o sin acceso.' });
  try {
    const clima = await consultarClima(lote, req.query.refresh === '1');
    const mercado = await obtenerMercado(lote, req.query.refresh === '1');
    const medicionCampo = ultimaMedicionLluvia(lote.id);
    const proyeccion = calcularProyeccion(lote, clima, mercado);
    const conocimiento = db.prepare(`SELECT id,titulo,cultivo,categoria,resumen,fuente FROM conocimiento_agronomico WHERE activo=1 AND (cultivo IS NULL OR cultivo='' OR lower(cultivo) LIKE ?) ORDER BY prioridad DESC, actualizado_en DESC LIMIT 5`)
      .all(`%${String(lote.cultivo_nombre || lote.cultivo_id || '').toLowerCase()}%`);
    res.json({ ok: true, lote, clima, medicionCampo, mercado, proyeccion, conocimiento });
  } catch (e) {
    console.error('Inteligencia V8B:', e);
    res.status(502).json({ error: e.message || 'No se pudo actualizar la inteligencia del cultivo.', requestId: req.id });
  }
});

router.post('/lotes/:id/configuracion', (req, res) => {
  const lote = loteVisible(req.usuario, req.params.id);
  if (!lote) return res.status(404).json({ error: 'Lote no encontrado.' });
  const rendimiento = Math.max(0, n(req.body.rendimientoObjetivoHa, 0));
  const precio = Math.max(0, n(req.body.precioObjetivo, 0));
  const etapa = texto(req.body.etapaFenologica, 100) || null;
  const unidad = texto(req.body.unidadRendimiento, 40) || 'kg/ha';
  const unidadPrecio = texto(req.body.unidadPrecio, 80) || null;
  const moneda = ['COP','PEN','CLP','USD'].includes(String(req.body.moneda || '').toUpperCase()) ? String(req.body.moneda).toUpperCase() : null;
  db.prepare(`UPDATE lotes SET rendimiento_objetivo_ha=?, unidad_rendimiento=?, precio_objetivo=?, unidad_precio=?, moneda_proyeccion=?, etapa_fenologica=?, actualizado_en=datetime('now') WHERE id=?`)
    .run(rendimiento, unidad, precio, unidadPrecio, moneda, etapa, lote.id);
  res.json({ ok: true });
});

router.post('/lotes/:id/mediciones', (req, res) => {
  const lote = loteVisible(req.usuario, req.params.id);
  if (!lote) return res.status(404).json({ error: 'Lote no encontrado.' });
  const tipo = ['precipitacion','temperatura','humedad_suelo','caudal_riego'].includes(req.body.tipo) ? req.body.tipo : 'precipitacion';
  const valor = n(req.body.valor, null);
  if (valor === null || valor < 0) return res.status(400).json({ error: 'Valor de medición inválido.' });
  const unidad = texto(req.body.unidad, 20) || (tipo === 'precipitacion' ? 'mm' : '');
  const fecha = texto(req.body.fecha, 30) || new Date().toISOString().slice(0,10);
  const id = nuevoId('med');
  db.prepare(`INSERT INTO mediciones_campo(id,lote_id,usuario_id,tipo,valor,unidad,fecha,notas,creado_en) VALUES(?,?,?,?,?,?,?,?,datetime('now'))`)
    .run(id, lote.id, req.usuario.id, tipo, valor, unidad, fecha, texto(req.body.notas, 500) || null);
  res.status(201).json(db.prepare('SELECT * FROM mediciones_campo WHERE id=?').get(id));
});

router.get('/resumen', async (req, res) => {
  const rows = db.prepare(`SELECT l.id,l.nombre,l.cultivo_id,l.cultivo_nombre,l.area_ha,f.nombre finca_nombre,f.productor_id,f.gestor_id,f.pais,f.region,f.ciudad
    FROM lotes l JOIN fincas f ON f.id=l.finca_id WHERE l.eliminado_en IS NULL AND f.eliminado_en IS NULL
    AND (?='admin' OR f.productor_id=? OR f.gestor_id=? OR EXISTS(SELECT 1 FROM agronomo_asignacion a WHERE a.finca_id=f.id AND a.agronomo_id=?))
    ORDER BY l.actualizado_en DESC,l.creado_en DESC LIMIT 80`).all(req.usuario.rol, req.usuario.id, req.usuario.id, req.usuario.id);
  const out = [];
  for (const x of rows) {
    const snap = db.prepare('SELECT payload_json,creado_en FROM clima_lote_snapshots WHERE lote_id=? ORDER BY creado_en DESC LIMIT 1').get(x.id);
    const clima = snap ? JSON.parse(snap.payload_json) : null;
    out.push({ ...x, climaResumen: clima?.resumen7d || null, climaActualizado: snap?.creado_en || null });
  }
  res.json(out);
});

router.get('/conocimiento', (req,res) => {
  const cultivo = texto(req.query.cultivo, 120).toLowerCase();
  const rows = cultivo ? db.prepare(`SELECT * FROM conocimiento_agronomico WHERE activo=1 AND (cultivo IS NULL OR cultivo='' OR lower(cultivo) LIKE ?) ORDER BY prioridad DESC, actualizado_en DESC LIMIT 30`).all(`%${cultivo}%`)
    : db.prepare(`SELECT * FROM conocimiento_agronomico WHERE activo=1 ORDER BY prioridad DESC, actualizado_en DESC LIMIT 30`).all();
  res.json(rows);
});
router.post('/conocimiento', (req,res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede publicar conocimiento.' });
  const titulo = texto(req.body.titulo, 220), contenido = texto(req.body.contenido, 20000);
  if (!titulo || !contenido) return res.status(400).json({ error: 'Título y contenido son obligatorios.' });
  const id = nuevoId('kno');
  db.prepare(`INSERT INTO conocimiento_agronomico(id,titulo,cultivo,categoria,resumen,contenido,fuente,fuente_url,prioridad,activo,creado_por,creado_en,actualizado_en)
    VALUES(?,?,?,?,?,?,?,?,?,1,?,datetime('now'),datetime('now'))`).run(id,titulo,texto(req.body.cultivo,120)||null,texto(req.body.categoria,120)||null,texto(req.body.resumen,600)||null,contenido,texto(req.body.fuente,220)||null,texto(req.body.fuenteUrl,500)||null,Math.max(0,Math.min(100,n(req.body.prioridad,50))),req.usuario.id);
  res.status(201).json(db.prepare('SELECT * FROM conocimiento_agronomico WHERE id=?').get(id));
});

router.post('/precios', (req,res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede registrar precios.' });
  const producto=texto(req.body.producto,180),pais=texto(req.body.pais,80),prom=n(req.body.precioPromedio,null);
  if(!producto||!pais||prom===null) return res.status(400).json({error:'País, producto y precio promedio son obligatorios.'});
  const id=nuevoId('pm');
  db.prepare(`INSERT INTO precios_mercado(id,pais,region,mercado,producto,variedad,unidad,precio_min,precio_max,precio_promedio,moneda,fuente,fuente_url,fecha,creado_en) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`)
    .run(id,pais,texto(req.body.region,120)||null,texto(req.body.mercado,180)||null,producto,texto(req.body.variedad,120)||null,texto(req.body.unidad,120)||null,n(req.body.precioMin,null),n(req.body.precioMax,null),prom,texto(req.body.moneda,10)||'COP',texto(req.body.fuente,180)||'Registro administrativo',texto(req.body.fuenteUrl,500)||null,texto(req.body.fecha,30)||new Date().toISOString().slice(0,10));
  res.status(201).json(db.prepare('SELECT * FROM precios_mercado WHERE id=?').get(id));
});

module.exports = router;
