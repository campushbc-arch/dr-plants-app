const express = require('express');
const db = require('../db');
const { nuevoId, requiereAuth } = require('../auth');

const router = express.Router();
router.use(requiereAuth);

// --- Solicitudes de análisis de laboratorio ---

// POST /api/solicitudes/laboratorio
router.post('/laboratorio', (req, res) => {
  const { tipoAnalisis, loteId, notas } = req.body;
  if (!tipoAnalisis) return res.status(400).json({ error: 'tipoAnalisis es obligatorio.' });
  const id = nuevoId('sollab');
  db.prepare('INSERT INTO solicitudes_laboratorio (id, usuario_id, lote_id, tipo_analisis, notas) VALUES (?,?,?,?,?)')
    .run(id, req.usuario.id, loteId || null, tipoAnalisis, notas || null);
  res.status(201).json(db.prepare('SELECT * FROM solicitudes_laboratorio WHERE id = ?').get(id));
});

// GET /api/solicitudes/laboratorio — las del usuario autenticado
router.get('/laboratorio', (req, res) => {
  res.json(db.prepare('SELECT * FROM solicitudes_laboratorio WHERE usuario_id = ? ORDER BY fecha DESC').all(req.usuario.id));
});

// --- Solicitudes de teleconsulta con agrónomo ---

// POST /api/solicitudes/teleconsulta
router.post('/teleconsulta', (req, res) => {
  const { motivo, loteId, fechaPreferida } = req.body;
  if (!motivo) return res.status(400).json({ error: 'motivo es obligatorio.' });
  const id = nuevoId('soltele');
  db.prepare('INSERT INTO solicitudes_teleconsulta (id, usuario_id, lote_id, motivo, fecha_preferida) VALUES (?,?,?,?,?)')
    .run(id, req.usuario.id, loteId || null, motivo, fechaPreferida || null);
  res.status(201).json(db.prepare('SELECT * FROM solicitudes_teleconsulta WHERE id = ?').get(id));
});

// GET /api/solicitudes/teleconsulta — las del usuario autenticado
router.get('/teleconsulta', (req, res) => {
  res.json(db.prepare('SELECT * FROM solicitudes_teleconsulta WHERE usuario_id = ? ORDER BY fecha_solicitud DESC').all(req.usuario.id));
});

module.exports = router;
