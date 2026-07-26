const express = require('express');
const db = require('../db');
const { nuevoId, requiereAuth } = require('../auth');
const { crearNotificacionAdmin, crearNotificacionUsuario } = require('../notificaciones');

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
  crearNotificacionUsuario({ usuarioId:req.usuario.id, tipo:'confirmacion_laboratorio', titulo:'Solicitud de laboratorio recibida', mensaje:`Recibimos tu solicitud de ${tipoAnalisis}. Te notificaremos cada avance.`, entidadTipo:'solicitud_laboratorio', entidadId:id, urlDestino:'laboratorio' });
  crearNotificacionAdmin({ tipo:'solicitud_laboratorio', titulo:'Nueva solicitud de laboratorio', mensaje:`${req.usuario.nombre || req.usuario.email} solicitó: ${tipoAnalisis}.`, usuarioId:req.usuario.id, entidadTipo:'solicitud_laboratorio', entidadId:id, prioridad:'alta' });
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
  crearNotificacionUsuario({ usuarioId:req.usuario.id, tipo:'confirmacion_teleconsulta', titulo:'Consulta personalizada recibida', mensaje:'Recibimos tu solicitud de consulta. Te notificaremos cuando sea aceptada y agendada.', entidadTipo:'teleconsulta', entidadId:id, urlDestino:'teleconsulta' });
  crearNotificacionAdmin({ tipo:'teleconsulta', titulo:'Nueva consulta personalizada', mensaje:`${req.usuario.nombre || req.usuario.email} solicitó una consulta: ${motivo}.`, usuarioId:req.usuario.id, entidadTipo:'teleconsulta', entidadId:id, prioridad:'alta' });
  res.status(201).json(db.prepare('SELECT * FROM solicitudes_teleconsulta WHERE id = ?').get(id));
});

// GET /api/solicitudes/teleconsulta — las del usuario autenticado
router.get('/teleconsulta', (req, res) => {
  res.json(db.prepare('SELECT * FROM solicitudes_teleconsulta WHERE usuario_id = ? ORDER BY fecha_solicitud DESC').all(req.usuario.id));
});

// Centro de notificaciones del usuario autenticado
router.get('/notificaciones', (req, res) => {
  res.json(db.prepare(`SELECT * FROM notificaciones_usuario WHERE usuario_id=? ORDER BY creada_en DESC LIMIT 100`).all(req.usuario.id));
});
router.patch('/notificaciones/:id/leida', (req, res) => {
  db.prepare(`UPDATE notificaciones_usuario SET leida=1, leida_en=datetime('now') WHERE id=? AND usuario_id=?`).run(req.params.id, req.usuario.id);
  res.json({ ok:true });
});
router.patch('/notificaciones-leer-todas', (req, res) => {
  db.prepare(`UPDATE notificaciones_usuario SET leida=1, leida_en=datetime('now') WHERE usuario_id=? AND leida=0`).run(req.usuario.id);
  res.json({ ok:true });
});

module.exports = router;
