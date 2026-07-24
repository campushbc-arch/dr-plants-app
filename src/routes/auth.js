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

  if (!nombre || !email || !password) {
    return res.status(400).json({ error: 'nombre, email y password son obligatorios.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'Ya existe una cuenta registrada con ese correo.' });
  }
  const rolSolicitado = ['agricultor', 'agronomo', 'admin'].includes(rol) ? rol : 'agricultor';
  if (rolSolicitado === 'agronomo' && !tarjetaProfesional) {
    return res.status(400).json({ error: 'Como agrónomo, tarjetaProfesional es obligatoria.' });
  }

  const id = nuevoId('usr');
  const passwordHash = bcrypt.hashSync(password, 10);
  const rolFinal = rolSolicitado === 'agronomo' ? 'agronomo_pendiente' : rolSolicitado;

  db.prepare(`
    INSERT INTO usuarios (id, nombre, email, telefono, password_hash, rol, tipo_productor, pais, region, tarjeta_profesional, especialidad, estado_agronomo)
    VALUES (@id, @nombre, @email, @telefono, @passwordHash, @rolFinal, @tipoProductor, @pais, @region, @tarjetaProfesional, @especialidad, @estadoAgronomo)
  `).run({
    id, nombre, email, telefono: telefono || null, passwordHash, rolFinal,
    tipoProductor: tipoProductor || null, pais: pais || null, region: region || null,
    tarjetaProfesional: tarjetaProfesional || null, especialidad: especialidad || null,
    estadoAgronomo: rolSolicitado === 'agronomo' ? 'pendiente' : null
  });

  const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  const token = firmarToken(usuario);
  res.status(201).json({ token, usuario: sinPassword(usuario) });
});

// POST /api/auth/login  { email, password }
// `email` acepta correo o nombre de usuario, según la cuenta creada.
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email y password son obligatorios.' });

  const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  if (!usuario || !bcrypt.compareSync(password, usuario.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
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
