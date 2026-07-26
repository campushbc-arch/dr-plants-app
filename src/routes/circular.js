const express = require('express');
const { requiereAuth } = require('../auth');
const { cleanString } = require('../validation');

const router = express.Router();
const PAISES = new Set(['Colombia', 'Peru', 'Chile']);

function queryPorResiduo(tipo) {
  const mapa = {
    vegetales: 'compostaje residuos orgánicos agrícolas centro de aprovechamiento',
    agroquimicos: 'centro de acopio envases agroquímicos reciclaje CampoLimpio',
    empaques: 'centro de reciclaje plástico papel sacos agrícolas',
    organicos: 'planta de compostaje biodigestor residuos orgánicos',
    general: 'centro de reciclaje punto limpio asociación de recicladores'
  };
  return mapa[tipo] || mapa.general;
}

async function googlePlaces({ pais, region, ciudad, tipo }) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const textQuery = `${queryPorResiduo(tipo)} en ${ciudad}, ${region}, ${pais}`;
  const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.nationalPhoneNumber,places.regularOpeningHours,places.primaryTypeDisplayName'
    },
    body: JSON.stringify({ textQuery, languageCode: 'es', maxResultCount: 15 })
  });
  if (!resp.ok) throw new Error(`Google Places respondió ${resp.status}`);
  const data = await resp.json();
  return (data.places || []).map(p => ({
    id: p.id,
    nombre: p.displayName?.text || 'Punto de aprovechamiento',
    direccion: p.formattedAddress || `${ciudad}, ${region}`,
    lat: p.location?.latitude ?? null,
    lon: p.location?.longitude ?? null,
    tipo: p.primaryTypeDisplayName?.text || 'Reciclaje y economía circular',
    telefono: p.nationalPhoneNumber || null,
    horario: p.regularOpeningHours?.weekdayDescriptions || [],
    mapsUrl: p.googleMapsUri || null,
    fuente: 'Google Places'
  }));
}

async function osmFallback({ pais, region, ciudad, tipo }) {
  const terminos = queryPorResiduo(tipo).split(' ').slice(0, 3).join(' ');
  const q = encodeURIComponent(`${terminos}, ${ciudad}, ${region}, ${pais}`);
  const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=15&addressdetails=1&q=${q}`, {
    headers: { 'User-Agent': 'DrPlants/4.0 contacto@campushbc.com', 'Accept-Language': 'es' }
  });
  if (!resp.ok) throw new Error(`OpenStreetMap respondió ${resp.status}`);
  const data = await resp.json();
  return data.map(p => ({
    id: `osm_${p.osm_type}_${p.osm_id}`,
    nombre: p.name || p.display_name.split(',')[0] || 'Punto de reciclaje',
    direccion: p.display_name,
    lat: Number(p.lat), lon: Number(p.lon),
    tipo: 'Punto potencial de reciclaje', telefono: null, horario: [],
    mapsUrl: `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=16/${p.lat}/${p.lon}`,
    fuente: 'OpenStreetMap'
  }));
}

router.get('/puntos', requiereAuth, async (req, res) => {
  try {
    const pais = cleanString(req.query.pais, 40);
    const region = cleanString(req.query.region, 100);
    const ciudad = cleanString(req.query.ciudad, 100);
    const tipo = cleanString(req.query.tipo || 'general', 30);
    if (!PAISES.has(pais)) return res.status(400).json({ error: 'Selecciona Colombia, Perú o Chile.' });
    if (!region || !ciudad) return res.status(400).json({ error: 'Selecciona departamento/región y ciudad.' });
    let puntos = await googlePlaces({ pais, region, ciudad, tipo });
    let proveedor = 'Google Places';
    if (puntos === null) { puntos = await osmFallback({ pais, region, ciudad, tipo }); proveedor = 'OpenStreetMap'; }
    res.json({ pais, region, ciudad, tipo, proveedor, puntos });
  } catch (error) {
    console.error('Error buscando puntos circulares:', error);
    res.status(502).json({ error: 'No fue posible consultar los puntos en este momento. Intenta nuevamente.' });
  }
});

module.exports = router;
