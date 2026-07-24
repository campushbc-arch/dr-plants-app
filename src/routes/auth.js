const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { nuevoId, firmarToken, requiereAuth, requiereRol } = require('../auth');

const router = express.Router();

// POST /api/auth/register
// El nombre de usuario para iniciar sesión es el correo electrónico (columna `email`),
// no el nombre — el nombre queda solo como dato de despliegue ("nombre completo").
// El administrador se crea con las variables ADMIN_USERNAME y ADMIN_PASSWORD.
// así que el mismo campo sirve como identificador de login para todos los roles.
router.post('/register', (req, res) => {
  const { nombre, email, telefono, password, rol, tipoProductor, pais, region, tarjetaProfesional, especialidad } = req.body;
  const emailNormalizado = String(email || '').trim().toLowerCase();

  if (!nombre || !emailNormalizado || !telefono || !password || !rol || !tipoProductor || !pais || !region) {
    return res.status(400).json({
      error: 'Debes completar todos los datos del formulario: nombre, correo, teléfono, contraseña, tipo de productor, país, región y tipo de cuenta.'
    });
  }
  if (!/^\S+@\S+\.\S+$/.test(emailNormalizado)) {
    return res.status(400).json({ error: 'El correo electrónico no es válido.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }
  if (db.prepare('SELECT 1 FROM usuarios WHERE lower(email) = ?').get(emailNormalizado)) {
    return res.status(409).json({ error: 'Ya existe una cuenta registrada con ese correo.' });
  }
  const rolSolicitado = ['agricultor', 'agronomo'].includes(rol) ? rol : null;
  if (!rolSolicitado) return res.status(400).json({ error: 'Tipo de cuenta inválido.' });
  if (rolSolicitado === 'agronomo' && (!tarjetaProfesional || !especialidad)) {
    return res.status(400).json({ error: 'Como agrónomo, la tarjeta profesional y la especialidad son obligatorias.' });
  }

  const id = nuevoId('usr');
  const passwordHash = bcrypt.hashSync(password, 10);
  const rolFinal = rolSolicitado === 'agronomo' ? 'agronomo_pendiente' : rolSolicitado;

  db.prepare(`
    INSERT INTO usuarios (id, nombre, email, telefono, password_hash, rol, tipo_productor, pais, region, tarjeta_profesional, especialidad, estado_agronomo)
    VALUES (@id, @nombre, @email, @telefono, @passwordHash, @rolFinal, @tipoProductor, @pais, @region, @tarjetaProfesional, @especialidad, @estadoAgronomo)
  `).run({
    id, nombre: nombre.trim(), email: emailNormalizado, telefono: telefono.trim(), passwordHash, rolFinal,
    tipoProductor: tipoProductor.trim(), pais: pais.trim(), region: region.trim(),
    tarjetaProfesional: tarjetaProfesional || null, especialidad: especialidad || null,
    estadoAgronomo: rolSolicitado === 'agronomo' ? 'pendiente' : null
  });

  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (rolFinal === 'agronomo_pendiente') {
    return res.status(201).json({ pendienteAprobacion: true, usuario: sinPassword(usuario), mensaje: 'Registro recibido. Tu cuenta requiere aprobación administrativa antes de iniciar sesión.' });
  }
  const token = firmarToken(usuario);
  res.status(201).json({ token, usuario: sinPassword(usuario) });
});

// POST /api/auth/login  { email, password }
// `email` acepta correo o nombre de usuario, según la cuenta creada.
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const identificador = String(email || '').trim().toLowerCase();
  if (!identificador || !password) return res.status(400).json({ error: 'email y password son obligatorios.' });

  const usuario = db.prepare('SELECT * FROM usuarios WHERE lower(email) = ?').get(identificador);
  if (!usuario || !bcrypt.compareSync(password, usuario.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  if (usuario.rol === 'agronomo_pendiente' || usuario.estado_agronomo === 'pendiente') {
    return res.status(403).json({ code: 'PENDING_APPROVAL', error: 'Tu registro como agrónomo está pendiente de aprobación.' });
  }
  if (usuario.estado_agronomo === 'rechazado') {
    return res.status(403).json({ code: 'REJECTED', error: 'Tu solicitud como agrónomo fue rechazada. Comunícate con el administrador.' });
  }
  if (usuario.activo === 0) {
    return res.status(403).json({ error: 'Tu cuenta está bloqueada. Comunícate con el administrador.' });
  }
  const token = firmarToken(usuario);
  res.json({ token, usuario: sinPassword(usuario) });
});

// GET /api/auth/me — usuario actual a partir del token
router.get('/me', requiereAuth, (req, res) => {
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });
  res.json(sinPassword(usuario));
});

function sinPassword(usuario) {
  const { password_hash, ...resto } = usuario;
  return resto;
}

module.exports = router;
