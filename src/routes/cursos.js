const express = require('express');
const db = require('../db');
const { nuevoId, requiereAuth } = require('../auth');
const { crearNotificacionAdmin, crearNotificacionUsuario } = require('../notificaciones');

const router = express.Router();

router.get('/', requiereAuth, (req, res) => {
  const cursos = db.prepare(`SELECT c.id,c.nombre,c.descripcion,c.precio_cop,c.portada,c.publicado,
    m.id AS matricula_id,m.estado AS matricula_estado,m.pago_id,m.creado_en AS matriculado_en
    FROM cursos c LEFT JOIN matriculas_curso m ON m.curso_id=c.id AND m.usuario_id=?
    WHERE c.publicado=1 ORDER BY c.creado_en DESC`).all(req.usuario.id);
  res.json(cursos);
});

router.get('/:id', requiereAuth, (req, res) => {
  const curso = db.prepare('SELECT id,nombre,descripcion,precio_cop,portada,publicado FROM cursos WHERE id=? AND publicado=1').get(req.params.id);
  if (!curso) return res.status(404).json({ error:'Curso no encontrado.' });
  curso.modulos = db.prepare(`SELECT id,titulo,descripcion,orden FROM curso_modulos WHERE curso_id=? ORDER BY orden`).all(curso.id)
    .map(m => ({...m, lecciones: db.prepare(`SELECT id,titulo,descripcion,duracion_min,orden FROM curso_lecciones WHERE modulo_id=? ORDER BY orden`).all(m.id)}));
  curso.matricula = db.prepare('SELECT id,estado,pago_id,creado_en,activado_en FROM matriculas_curso WHERE curso_id=? AND usuario_id=?').get(curso.id, req.usuario.id) || null;
  res.json(curso);
});

router.post('/:id/matricula', requiereAuth, (req, res) => {
  const curso = db.prepare('SELECT * FROM cursos WHERE id=? AND publicado=1').get(req.params.id);
  if (!curso) return res.status(404).json({ error:'Curso no encontrado.' });
  let matricula = db.prepare('SELECT * FROM matriculas_curso WHERE curso_id=? AND usuario_id=?').get(curso.id, req.usuario.id);
  if (!matricula) {
    const id = nuevoId('mat');
    db.prepare(`INSERT INTO matriculas_curso (id,curso_id,usuario_id,estado) VALUES (?,?,?,'pendiente_pago')`).run(id, curso.id, req.usuario.id);
    matricula = db.prepare('SELECT * FROM matriculas_curso WHERE id=?').get(id);
    const u = db.prepare('SELECT nombre,email,telefono FROM usuarios WHERE id=?').get(req.usuario.id);
    crearNotificacionAdmin({tipo:'nueva_matricula_curso',titulo:'Nueva solicitud de matrícula',mensaje:`${u?.nombre||'Un usuario'} solicitó matrícula en ${curso.nombre}. Pago pendiente por $${Number(curso.precio_cop).toLocaleString('es-CO')} COP.`,usuarioId:req.usuario.id,entidadTipo:'matricula_curso',entidadId:id,prioridad:'alta'});
  }
  res.status(201).json(matricula);
});

router.get('/:id/contenido', requiereAuth, (req, res) => {
  const matricula = db.prepare(`SELECT m.* FROM matriculas_curso m WHERE m.curso_id=? AND m.usuario_id=? AND m.estado='activa'`).get(req.params.id, req.usuario.id);
  if (!matricula) return res.status(403).json({ code:'COURSE_NOT_ACTIVE', error:'El administrador todavía no ha activado tu acceso al curso.' });
  const curso = db.prepare('SELECT id,nombre,descripcion FROM cursos WHERE id=?').get(req.params.id);
  const modulos = db.prepare('SELECT id,titulo,descripcion,orden FROM curso_modulos WHERE curso_id=? ORDER BY orden').all(req.params.id)
    .map(m => ({...m, lecciones:db.prepare('SELECT id,titulo,descripcion,duracion_min,contenido,orden FROM curso_lecciones WHERE modulo_id=? ORDER BY orden').all(m.id)}));
  res.json({...curso,modulos});
});

module.exports = router;
