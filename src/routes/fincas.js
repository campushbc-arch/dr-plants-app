const express = require('express');
const db = require('../db');
const { nuevoId, requiereAuth } = require('../auth');

const router = express.Router();
router.use(requiereAuth);

// Regla de acceso central (la misma que quedó documentada en modelo_datos.md):
// - agricultor: solo sus propias fincas (productor_id = usuario.id)
// - agronomo: fincas donde tenga una agronomo_asignacion activa
// - admin: todas
function fincasVisiblesPara(usuario) {
  if (usuario.rol === 'admin') {
    return db.prepare('SELECT * FROM fincas').all();
  }
  if (usuario.rol === 'agronomo') {
    return db.prepare(`
      SELECT f.* FROM fincas f
      JOIN agronomo_asignacion a ON a.finca_id = f.id
      WHERE a.agronomo_id = ?
    `).all(usuario.id);
  }
  return db.prepare('SELECT * FROM fincas WHERE productor_id = ?').all(usuario.id);
}

function puedeVerFinca(usuario, fincaId) {
  const finca = db.prepare('SELECT * FROM fincas WHERE id = ?').get(fincaId);
  if (!finca) return null;
  if (usuario.rol === 'admin') return finca;
  if (usuario.rol === 'agronomo') {
    const asignada = db.prepare(
      'SELECT 1 FROM agronomo_asignacion WHERE finca_id = ? AND agronomo_id = ?'
    ).get(fincaId, usuario.id);
    return asignada ? finca : null;
  }
  return finca.productor_id === usuario.id ? finca : null;
}

// GET /api/fincas — solo las que el usuario autenticado puede ver
router.get('/', (req, res) => {
  res.json(fincasVisiblesPara(req.usuario));
});

// POST /api/fincas — crear finca propia (solo agricultor/admin)
router.post('/', (req, res) => {
  const { nombre, ubicacionId } = req.body;
  if (!nombre || !ubicacionId) return res.status(400).json({ error: 'nombre y ubicacionId son obligatorios.' });
  const id = nuevoId('finca');
  db.prepare('INSERT INTO fincas (id, productor_id, nombre, ubicacion_id) VALUES (?, ?, ?, ?)')
    .run(id, req.usuario.id, nombre, ubicacionId);
  res.status(201).json(db.prepare('SELECT * FROM fincas WHERE id = ?').get(id));
});

// GET /api/fincas/:id/lotes
router.get('/:id/lotes', (req, res) => {
  const finca = puedeVerFinca(req.usuario, req.params.id);
  if (!finca) return res.status(403).json({ error: 'No tienes acceso a esta finca.' });
  res.json(db.prepare('SELECT * FROM lotes WHERE finca_id = ?').all(req.params.id));
});

// POST /api/fincas/:id/lotes
router.post('/:id/lotes', (req, res) => {
  const finca = puedeVerFinca(req.usuario, req.params.id);
  if (!finca) return res.status(403).json({ error: 'No tienes acceso a esta finca.' });
  if (req.usuario.rol === 'agronomo') return res.status(403).json({ error: 'Los agrónomos acompañan, no crean lotes por el productor.' });

  const { nombre, cultivoId, areaHa, fechaSiembra } = req.body;
  if (!nombre || !cultivoId || !areaHa || !fechaSiembra) {
    return res.status(400).json({ error: 'nombre, cultivoId, areaHa y fechaSiembra son obligatorios.' });
  }
  const id = nuevoId('lote');
  db.prepare(`
    INSERT INTO lotes (id, finca_id, nombre, cultivo_id, area_ha, fecha_siembra)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, req.params.id, nombre, cultivoId, areaHa, fechaSiembra);
  res.status(201).json(db.prepare('SELECT * FROM lotes WHERE id = ?').get(id));
});

// Helper reutilizado por lote detalle / aplicaciones / análisis / costos
function loteVisible(usuario, loteId) {
  const lote = db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId);
  if (!lote) return null;
  return puedeVerFinca(usuario, lote.finca_id) ? lote : null;
}

// GET /api/lotes/:id — detalle con aplicaciones, análisis y costos (todo en una sola llamada)
router.get('/lotes/:id', (req, res) => {
  const lote = loteVisible(req.usuario, req.params.id);
  if (!lote) return res.status(403).json({ error: 'No tienes acceso a este lote.' });
  res.json({
    ...lote,
    aplicaciones: db.prepare('SELECT * FROM aplicaciones WHERE lote_id = ? ORDER BY fecha').all(lote.id),
    analisis: db.prepare('SELECT * FROM analisis_laboratorio WHERE lote_id = ? ORDER BY fecha').all(lote.id),
    costosOperativos: db.prepare('SELECT * FROM costos_operativos WHERE lote_id = ? ORDER BY fecha').all(lote.id)
  });
});

// POST /api/lotes/:id/aplicaciones
router.post('/lotes/:id/aplicaciones', (req, res) => {
  const lote = loteVisible(req.usuario, req.params.id);
  if (!lote) return res.status(403).json({ error: 'No tienes acceso a este lote.' });
  const { tipo, producto, fecha, cantidad, costoCop } = req.body;
  if (!tipo || !producto || !fecha) return res.status(400).json({ error: 'tipo, producto y fecha son obligatorios.' });
  const id = nuevoId('app');
  db.prepare('INSERT INTO aplicaciones (id, lote_id, tipo, producto, fecha, cantidad, costo_cop) VALUES (?,?,?,?,?,?,?)')
    .run(id, lote.id, tipo, producto, fecha, cantidad || null, costoCop || 0);
  res.status(201).json(db.prepare('SELECT * FROM aplicaciones WHERE id = ?').get(id));
});

// POST /api/lotes/:id/analisis
router.post('/lotes/:id/analisis', (req, res) => {
  const lote = loteVisible(req.usuario, req.params.id);
  if (!lote) return res.status(403).json({ error: 'No tienes acceso a este lote.' });
  const { tipo, fecha, resultado } = req.body;
  if (!tipo || !fecha) return res.status(400).json({ error: 'tipo y fecha son obligatorios.' });
  const id = nuevoId('an');
  db.prepare('INSERT INTO analisis_laboratorio (id, lote_id, tipo, fecha, resultado) VALUES (?,?,?,?,?)')
    .run(id, lote.id, tipo, fecha, resultado || null);
  res.status(201).json(db.prepare('SELECT * FROM analisis_laboratorio WHERE id = ?').get(id));
});

// POST /api/lotes/:id/costos
router.post('/lotes/:id/costos', (req, res) => {
  const lote = loteVisible(req.usuario, req.params.id);
  if (!lote) return res.status(403).json({ error: 'No tienes acceso a este lote.' });
  const { categoria, descripcion, fecha, costoCop } = req.body;
  if (!categoria || !fecha || !costoCop) return res.status(400).json({ error: 'categoria, fecha y costoCop son obligatorios.' });
  const id = nuevoId('cost');
  db.prepare('INSERT INTO costos_operativos (id, lote_id, categoria, descripcion, fecha, costo_cop) VALUES (?,?,?,?,?,?)')
    .run(id, lote.id, categoria, descripcion || null, fecha, costoCop);
  res.status(201).json(db.prepare('SELECT * FROM costos_operativos WHERE id = ?').get(id));
});

module.exports = router;
