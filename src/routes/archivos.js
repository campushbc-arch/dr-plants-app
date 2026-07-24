const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { nuevoId, requiereAuth } = require('../auth');

const router = express.Router();
router.use(requiereAuth);

const HOME_DIR = process.env.HOME || path.join(__dirname, '..', '..');
const UPLOADS_PATH = process.env.UPLOADS_PATH || path.join(HOME_DIR, 'data', 'drplants', 'uploads');
fs.mkdirSync(UPLOADS_PATH, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_PATH),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${nuevoId('file')}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Solo se permiten PDF, JPG, PNG o WEBP.'), ok);
  }
});

router.post('/subir', upload.single('archivo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo.' });
  const tipo = String(req.body.tipo || 'otro_pdf');
  const permitidos = ['foto_perfil','documento_identidad','tarjeta_profesional','analisis_suelo','otro_pdf'];
  if (!permitidos.includes(tipo)) return res.status(400).json({ error: 'Tipo de archivo inválido.' });
  if (['analisis_suelo','otro_pdf'].includes(tipo) && req.file.mimetype !== 'application/pdf') {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Este documento debe estar en formato PDF.' });
  }
  if (tipo === 'foto_perfil' && !req.file.mimetype.startsWith('image/')) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'La foto de perfil debe ser una imagen.' });
  }
  const id = nuevoId('arc');
  db.prepare(`INSERT INTO archivos_usuario
    (id, usuario_id, tipo, nombre_original, nombre_guardado, mime_type, tamano_bytes, ruta)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, req.usuario.id, tipo, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.file.path);
  if (tipo === 'foto_perfil') db.prepare('UPDATE usuarios SET foto_perfil = ? WHERE id = ?').run(id, req.usuario.id);
  res.status(201).json({ id, tipo, nombre: req.file.originalname, mime_type: req.file.mimetype, tamano_bytes: req.file.size, url: `/api/archivos/${id}` });
});

router.get('/', (req, res) => {
  res.json(db.prepare(`SELECT id,tipo,nombre_original AS nombre,mime_type,tamano_bytes,creado_en
    FROM archivos_usuario WHERE usuario_id=? ORDER BY creado_en DESC`).all(req.usuario.id));
});

router.get('/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM archivos_usuario WHERE id=? AND usuario_id=?').get(req.params.id, req.usuario.id);
  if (!a || !fs.existsSync(a.ruta)) return res.status(404).json({ error: 'Archivo no encontrado.' });
  res.type(a.mime_type).sendFile(a.ruta);
});

module.exports = router;
