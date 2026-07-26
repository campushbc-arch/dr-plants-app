const express = require('express');
const db = require('../db');
const { nuevoId, requiereAuth } = require('../auth');
const { cleanString } = require('../validation');
const { crearNotificacionAdmin, crearNotificacionUsuario } = require('../notificaciones');

const router = express.Router();
const PAISES = new Set(['Colombia', 'Peru', 'Chile']);
const TIPOS = new Set(['vegetales', 'agroquimicos', 'empaques', 'organicos', 'general']);
const cache = new Map();

function normalizarTexto(v) {
  return String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function nombrePaisOSM(pais) { return pais === 'Peru' ? 'Perú' : pais; }
function etiquetasTipo(tipo) {
  const mapa = {
    agroquimicos: ['envases agroquímicos', 'envases de plaguicidas', 'residuos peligrosos agrícolas'],
    empaques: ['plástico', 'papel', 'cartón', 'sacos', 'empaques agrícolas'],
    vegetales: ['residuos vegetales', 'poda', 'rastrojos', 'biomasa'],
    organicos: ['residuos orgánicos', 'compostaje', 'biodigestión', 'pulpa'],
    general: ['reciclables', 'plástico', 'papel', 'vidrio', 'metal']
  };
  return mapa[tipo] || mapa.general;
}
function mapsUrl(lat, lon) {
  return lat != null && lon != null
    ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`
    : null;
}

function buscarDirectorio({ pais, region, ciudad, tipo }) {
  const np = normalizarTexto(pais), nr = normalizarTexto(region), nc = normalizarTexto(ciudad);
  const filas = db.prepare(`
    SELECT * FROM puntos_circulares
    WHERE activo=1
      AND lower(pais)=?
      AND (lower(region)=? OR region IS NULL OR trim(region)='')
      AND (lower(ciudad)=? OR ciudad IS NULL OR trim(ciudad)='')
    ORDER BY verificado DESC, nombre ASC
  `).all(np, nr, nc);
  return filas.filter(f => f.tipos_residuo === 'general' || String(f.tipos_residuo || '').split(',').includes(tipo)).map(f => ({
    id: f.id,
    nombre: f.nombre,
    direccion: f.direccion || [f.ciudad, f.region, f.pais].filter(Boolean).join(', '),
    lat: f.lat, lon: f.lon,
    tipo: f.tipo_entidad || 'Gestor de economía circular',
    telefono: f.telefono || null,
    email: f.email || null,
    sitioWeb: f.sitio_web || null,
    horario: f.horario ? [f.horario] : [],
    materiales: f.materiales || etiquetasTipo(tipo).join(', '),
    mapsUrl: f.maps_url || mapsUrl(f.lat, f.lon),
    fuente: 'Directorio Dr. Plants',
    verificado: Boolean(f.verificado)
  }));
}

async function geocodificar({ pais, region, ciudad }) {
  const q = encodeURIComponent(`${ciudad}, ${region}, ${nombrePaisOSM(pais)}`);
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${q}`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'DrPlants/5.0 contacto@campushbc.com', 'Accept-Language': 'es' },
    signal: AbortSignal.timeout(9000)
  });
  if (!resp.ok) throw new Error(`Nominatim respondió ${resp.status}`);
  const data = await resp.json();
  if (!data.length) return null;
  return { lat: Number(data[0].lat), lon: Number(data[0].lon) };
}

async function overpass({ lat, lon, tipo }) {
  const radio = Number(process.env.CIRCULAR_SEARCH_RADIUS_METERS || 30000);
  const filtros = tipo === 'organicos' || tipo === 'vegetales'
    ? '["amenity"~"recycling|waste_transfer_station|waste_disposal|composting"]'
    : '["amenity"~"recycling|waste_transfer_station|waste_disposal"]';
  const consulta = `[out:json][timeout:22];(node${filtros}(around:${radio},${lat},${lon});way${filtros}(around:${radio},${lat},${lon});relation${filtros}(around:${radio},${lat},${lon});node["recycling_type"](around:${radio},${lat},${lon});way["recycling_type"](around:${radio},${lat},${lon}););out center tags 40;`;
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];
  let ultimoError;
  for (const endpoint of endpoints) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': 'DrPlants/5.0 contacto@campushbc.com' },
        body: new URLSearchParams({ data: consulta }),
        signal: AbortSignal.timeout(26000)
      });
      if (!resp.ok) throw new Error(`Overpass respondió ${resp.status}`);
      const data = await resp.json();
      return (data.elements || []).map(e => {
        const t = e.tags || {};
        const plat = e.lat ?? e.center?.lat ?? null;
        const plon = e.lon ?? e.center?.lon ?? null;
        const materiales = Object.entries(t).filter(([k,v]) => k.startsWith('recycling:') && v === 'yes').map(([k]) => k.replace('recycling:', '').replaceAll('_', ' '));
        return {
          id: `osm_${e.type}_${e.id}`,
          nombre: t.name || t.operator || 'Punto de reciclaje',
          direccion: [t['addr:street'], t['addr:housenumber'], t['addr:city']].filter(Boolean).join(' ') || t.description || 'Ubicación registrada en OpenStreetMap',
          lat: plat, lon: plon,
          tipo: t.recycling_type === 'centre' ? 'Centro de reciclaje' : (t.amenity === 'waste_transfer_station' ? 'Estación de transferencia' : 'Punto de reciclaje'),
          telefono: t.phone || t['contact:phone'] || null,
          email: t.email || t['contact:email'] || null,
          sitioWeb: t.website || t['contact:website'] || null,
          horario: t.opening_hours ? [t.opening_hours] : [],
          materiales: materiales.length ? materiales.join(', ') : etiquetasTipo(tipo).join(', '),
          mapsUrl: mapsUrl(plat, plon),
          fuente: 'OpenStreetMap / Overpass',
          verificado: false
        };
      });
    } catch (e) { ultimoError = e; }
  }
  throw ultimoError || new Error('No fue posible consultar Overpass.');
}

function deduplicar(puntos) {
  const vistos = new Set();
  return puntos.filter(p => {
    const clave = `${normalizarTexto(p.nombre)}|${normalizarTexto(p.direccion)}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

router.get('/puntos', requiereAuth, async (req, res) => {
  try {
    const pais = cleanString(req.query.pais, 40);
    const region = cleanString(req.query.region, 100);
    const ciudad = cleanString(req.query.ciudad, 100);
    const tipo = cleanString(req.query.tipo || 'general', 30);
    if (!PAISES.has(pais)) return res.status(400).json({ error: 'Selecciona Colombia, Perú o Chile.' });
    if (!region || !ciudad) return res.status(400).json({ error: 'Selecciona departamento/región y ciudad.' });
    if (!TIPOS.has(tipo)) return res.status(400).json({ error: 'Tipo de residuo inválido.' });

    const clave = `${pais}|${region}|${ciudad}|${tipo}`;
    const guardado = cache.get(clave);
    if (guardado && Date.now() - guardado.en < 30 * 60 * 1000) return res.json({ ...guardado.data, cache: true });

    const propios = buscarDirectorio({ pais, region, ciudad, tipo });
    let abiertos = [];
    let aviso = null;
    try {
      const geo = await geocodificar({ pais, region, ciudad });
      if (geo) abiertos = await overpass({ ...geo, tipo });
      else aviso = 'No se pudo ubicar la ciudad en OpenStreetMap.';
    } catch (e) {
      console.warn('Fuente abierta temporalmente no disponible:', e.message);
      aviso = 'La fuente cartográfica abierta está temporalmente ocupada. Se muestran los registros del directorio propio.';
    }
    const puntos = deduplicar([...propios, ...abiertos]).slice(0, 40);
    const data = { pais, region, ciudad, tipo, proveedor: propios.length && abiertos.length ? 'Directorio Dr. Plants + OpenStreetMap' : (propios.length ? 'Directorio Dr. Plants' : 'OpenStreetMap'), puntos, aviso };
    cache.set(clave, { en: Date.now(), data });
    res.json(data);
  } catch (error) {
    console.error('Error buscando puntos circulares:', error);
    res.status(502).json({ error: 'No fue posible consultar los puntos en este momento. Intenta nuevamente.' });
  }
});

router.post('/solicitudes-recoleccion', requiereAuth, (req, res) => {
  const pais = cleanString(req.body.pais, 40);
  const region = cleanString(req.body.region, 100);
  const ciudad = cleanString(req.body.ciudad, 100);
  const tipo = cleanString(req.body.tipo || 'general', 30);
  const cantidad = cleanString(req.body.cantidad, 80);
  const direccion = cleanString(req.body.direccion, 240);
  const observaciones = cleanString(req.body.observaciones, 800);
  if (!PAISES.has(pais) || !region || !ciudad || !TIPOS.has(tipo) || !cantidad || !direccion) {
    return res.status(400).json({ error: 'País, región, ciudad, tipo, cantidad y dirección son obligatorios.' });
  }
  const id = nuevoId('recol');
  db.prepare(`INSERT INTO solicitudes_recoleccion_circular
    (id,usuario_id,pais,region,ciudad,tipo_residuo,cantidad,direccion,observaciones)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id, req.usuario.id, pais, region, ciudad, tipo, cantidad, direccion, observaciones || null);
  crearNotificacionAdmin({ tipo:'solicitud_recoleccion', titulo:'Nueva solicitud de recolección circular', mensaje:`${req.usuario.nombre || 'Un usuario'} solicita recolección de ${tipo} en ${ciudad}, ${region}. Cantidad: ${cantidad}.`, usuarioId:req.usuario.id, entidadTipo:'solicitud_recoleccion', entidadId:id, prioridad:'alta' });
  crearNotificacionUsuario({ usuarioId:req.usuario.id, tipo:'solicitud_recoleccion', titulo:'Solicitud de recolección recibida', mensaje:`Registramos tu solicitud para ${cantidad} de ${tipo} en ${ciudad}. Te notificaremos cuando haya un gestor disponible.`, entidadTipo:'solicitud_recoleccion', entidadId:id, urlDestino:'rec-puntos' });
  res.status(201).json(db.prepare('SELECT * FROM solicitudes_recoleccion_circular WHERE id=?').get(id));
});

router.get('/mis-solicitudes', requiereAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM solicitudes_recoleccion_circular WHERE usuario_id=? ORDER BY creada_en DESC').all(req.usuario.id));
});

module.exports = router;
