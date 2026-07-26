const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { nuevoId, firmarToken, requiereAuth } = require('../auth');
const { flattenFiles, multerFileFilter, safeDeleteMany, uploadLimits, validateStoredFile } = require('../upload-security');
const { cleanString, email: validarEmail, phone: validarTelefono, strongPassword } = require('../validation');
const { audit } = require('../audit');

const router = express.Router();
const HOME_DIR = process.env.HOME || path.join(__dirname, '..', '..');
const UPLOADS_PATH = process.env.UPLOADS_PATH || path.join(HOME_DIR, 'data', 'drplants', 'uploads');
fs.mkdirSync(UPLOADS_PATH, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_PATH),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${nuevoId('registro')}${path.extname(file.originalname).toLowerCase()}`)
});
const uploadRegistro = multer({
  storage,
  limits: uploadLimits({ files: 2, fields: 16, parts: 18 }),
  fileFilter: multerFileFilter
}).fields([
  { name: 'documentoIdentidad', maxCount: 1 },
  { name: 'tarjetaArchivo', maxCount: 1 }
]);

router.post('/register', (req, res) => {
  uploadRegistro(req, res, (uploadError) => {
    if (uploadError) return res.status(400).json({ error: uploadError.message });
    const archivosSubidos = flattenFiles(req.files);
    const limpiar = () => safeDeleteMany(archivosSubidos);
    try {
      const { nombre, email, telefono, password, rol, tipoProductor, pais, region, tarjetaProfesional, especialidad } = req.body;
      const emailNormalizado = validarEmail(email);
      const telefonoNormalizado = validarTelefono(telefono);
      if (!nombre || !emailNormalizado || !telefonoNormalizado || !password || !rol || !tipoProductor || !pais || !region) {
        limpiar();
        return res.status(400).json({ error: 'Debes completar todos los datos obligatorios del formulario.' });
      }
      if (!emailNormalizado) { limpiar(); return res.status(400).json({ error: 'El correo electrónico no es válido.' }); }
      if (!strongPassword(password)) { limpiar(); return res.status(400).json({ error: 'La contraseña debe tener entre 10 y 128 caracteres e incluir letras y números.' }); }
      if (db.prepare('SELECT 1 FROM usuarios WHERE lower(email) = ?').get(emailNormalizado)) { limpiar(); return res.status(409).json({ error: 'Ya existe una cuenta registrada con ese correo.' }); }
      const rolSolicitado = ['agricultor', 'agronomo'].includes(rol) ? rol : null;
      if (!rolSolicitado) { limpiar(); return res.status(400).json({ error: 'Tipo de cuenta inválido.' }); }

      const documentoIdentidad = req.files?.documentoIdentidad?.[0];
      const tarjetaArchivo = req.files?.tarjetaArchivo?.[0];
      for (const file of archivosSubidos) validateStoredFile(file);
      if (rolSolicitado === 'agronomo' && (!tarjetaProfesional || !especialidad || !documentoIdentidad || !tarjetaArchivo)) {
        limpiar();
        return res.status(400).json({ error: 'Para registrarte como agrónomo son obligatorios la especialidad, el número de tarjeta profesional, el documento de identidad y el archivo de la tarjeta profesional.' });
      }
      if (rolSolicitado !== 'agronomo' && archivosSubidos.length) limpiar();

      const id = nuevoId('usr');
      const passwordHash = bcrypt.hashSync(password, Number(process.env.BCRYPT_ROUNDS || 12));
      const rolFinal = rolSolicitado === 'agronomo' ? 'agronomo_pendiente' : rolSolicitado;
      const transaction = db.transaction(() => {
        db.prepare(`INSERT INTO usuarios
          (id,nombre,email,telefono,password_hash,rol,tipo_productor,pais,region,tarjeta_profesional,especialidad,estado_agronomo)
          VALUES (@id,@nombre,@email,@telefono,@passwordHash,@rolFinal,@tipoProductor,@pais,@region,@tarjetaProfesional,@especialidad,@estadoAgronomo)`)
          .run({ id, nombre: cleanString(nombre, 120), email: emailNormalizado, telefono: telefonoNormalizado, passwordHash, rolFinal,
            tipoProductor: cleanString(tipoProductor, 80), pais: cleanString(pais, 80), region: cleanString(region, 120), tarjetaProfesional: tarjetaProfesional || null,
            especialidad: especialidad || null, estadoAgronomo: rolSolicitado === 'agronomo' ? 'pendiente' : null });
        if (rolSolicitado === 'agronomo') {
          for (const [tipo, file] of [['documento_identidad', documentoIdentidad], ['tarjeta_profesional', tarjetaArchivo]]) {
            db.prepare(`INSERT INTO archivos_usuario
              (id,usuario_id,tipo,nombre_original,nombre_guardado,mime_type,tamano_bytes,ruta)
              VALUES (?,?,?,?,?,?,?,?)`)
              .run(nuevoId('arc'), id, tipo, file.originalname, file.filename, file.mimetype, file.size, file.path);
          }
        }
      });
      transaction();
      const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
      if (rolFinal === 'agronomo_pendiente') {
        return res.status(201).json({ pendienteAprobacion: true, usuario: sinPassword(usuario), mensaje: 'Registro recibido. El administrador debe verificar tu identidad y tarjeta profesional antes de aprobar el acceso.' });
      }
      const token = firmarToken(usuario);
      audit({ req, action: 'registro_usuario', entityType: 'usuario', entityId: id });
      return res.status(201).json({ token, usuario: sinPassword(usuario) });
    } catch (error) {
      limpiar();
      console.error('Error registrando usuario:', error);
      return res.status(500).json({ error: 'No se pudo completar el registro.' });
    }
  });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const identificador = String(email || '').trim().toLowerCase();
  if (!identificador || !password) return res.status(400).json({ error: 'email y password son obligatorios.' });
  const usuario = db.prepare('SELECT * FROM usuarios WHERE lower(email) = ?').get(identificador);
  if (!usuario || !bcrypt.compareSync(password, usuario.password_hash)) { audit({ req, action: 'login', result: 'fallido', metadata: { identificador } }); return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' }); }
  if (usuario.rol === 'agronomo_pendiente' || usuario.estado_agronomo === 'pendiente') return res.status(403).json({ code: 'PENDING_APPROVAL', error: 'Tu registro como agrónomo está pendiente de aprobación.' });
  if (usuario.estado_agronomo === 'rechazado') return res.status(403).json({ code: 'REJECTED', error: 'Tu solicitud como agrónomo fue rechazada. Comunícate con el administrador.' });
  if (usuario.activo === 0) return res.status(403).json({ error: 'Tu cuenta está bloqueada. Comunícate con el administrador.' });
  audit({ req, action: 'login', entityType: 'usuario', entityId: usuario.id });
  res.json({ token: firmarToken(usuario), usuario: sinPassword(usuario) });
});

router.get('/me', requiereAuth, (req, res) => {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });
  res.json(sinPassword(usuario));
});

function sinPassword(usuario) { const { password_hash, ...resto } = usuario; return resto; }
module.exports = router;
