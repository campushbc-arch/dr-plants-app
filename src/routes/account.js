const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('../db');
const { requiereAuth, nuevoId } = require('../auth');
const { cleanString, email: validarEmail, phone: validarTelefono, strongPassword } = require('../validation');
const { audit } = require('../audit');

const router = express.Router();

db.exec(`
CREATE TABLE IF NOT EXISTS recuperaciones_cuenta (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('password','usuario')),
  token_hash TEXT DEFAULT NULL,
  expira_en TEXT NOT NULL,
  usado_en TEXT DEFAULT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recuperaciones_usuario
  ON recuperaciones_cuenta(usuario_id, tipo, creado_en);
`);

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function identificadorValido(value, rol) {
  const raw = cleanString(value, 254);
  const asEmail = validarEmail(raw);
  if (asEmail) return asEmail;
  if (rol === 'admin' && /^[A-Za-z0-9._-]{3,80}$/.test(raw)) return raw.toLowerCase();
  return null;
}

function correoDestino(usuario) {
  if (validarEmail(usuario.email)) return usuario.email;
  if (usuario.rol === 'admin' && validarEmail(process.env.ADMIN_RECOVERY_EMAIL)) {
    return process.env.ADMIN_RECOVERY_EMAIL.trim().toLowerCase();
  }
  const fallback = validarEmail(process.env.RECOVERY_EMAIL);
  return fallback || null;
}

function transportadorCorreo() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || (port === 465 ? 'true' : 'false')).toLowerCase() === 'true';
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}

async function enviarCorreo({ to, subject, text, html }) {
  const transporter = transportadorCorreo();
  if (!transporter || !to) {
    console.warn('Recuperación de cuenta: SMTP o correo destino no configurado.');
    return false;
  }
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html
  });
  return true;
}

function usuarioSeguro(u) {
  if (!u) return null;
  const { password_hash, ...resto } = u;
  return resto;
}

router.get('/profile', requiereAuth, (req, res) => {
  const usuario = db.prepare(`
    SELECT id,nombre,email,telefono,rol,tipo_productor,pais,region,
           tarjeta_profesional,especialidad,estado_agronomo,activo,creado_en,foto_perfil
    FROM usuarios WHERE id=?
  `).get(req.usuario.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });
  res.json(usuario);
});

router.patch('/profile', requiereAuth, (req, res) => {
  const actual = db.prepare('SELECT * FROM usuarios WHERE id=?').get(req.usuario.id);
  if (!actual) return res.status(404).json({ error: 'Usuario no encontrado.' });

  const nombre = cleanString(req.body.nombre ?? actual.nombre, 120);
  const telefono = validarTelefono(req.body.telefono ?? actual.telefono);
  const identificador = identificadorValido(req.body.usuario ?? req.body.email ?? actual.email, actual.rol);
  const tipoProductor = cleanString(req.body.tipoProductor ?? actual.tipo_productor ?? '', 80) || null;
  const pais = cleanString(req.body.pais ?? actual.pais ?? '', 80) || null;
  const region = cleanString(req.body.region ?? actual.region ?? '', 120) || null;
  const tarjetaProfesional = cleanString(req.body.tarjetaProfesional ?? actual.tarjeta_profesional ?? '', 120) || null;
  const especialidad = cleanString(req.body.especialidad ?? actual.especialidad ?? '', 160) || null;

  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio.' });
  if (!telefono) return res.status(400).json({ error: 'El teléfono no es válido.' });
  if (!identificador) {
    return res.status(400).json({
      error: actual.rol === 'admin'
        ? 'El usuario debe tener 3 a 80 caracteres válidos o ser un correo electrónico.'
        : 'Debes usar un correo electrónico válido como usuario.'
    });
  }

  const repetido = db.prepare('SELECT id FROM usuarios WHERE lower(email)=lower(?) AND id<>?').get(identificador, actual.id);
  if (repetido) return res.status(409).json({ error: 'Ese usuario/correo ya está registrado.' });

  db.prepare(`
    UPDATE usuarios
       SET nombre=?, email=?, telefono=?, tipo_productor=?, pais=?, region=?,
           tarjeta_profesional=?, especialidad=?
     WHERE id=?
  `).run(nombre, identificador, telefono, tipoProductor, pais, region, tarjetaProfesional, especialidad, actual.id);

  audit({ req, action: 'editar_perfil', entityType: 'usuario', entityId: actual.id });
  const actualizado = db.prepare(`
    SELECT id,nombre,email,telefono,rol,tipo_productor,pais,region,
           tarjeta_profesional,especialidad,estado_agronomo,activo,creado_en,foto_perfil
    FROM usuarios WHERE id=?
  `).get(actual.id);
  res.json(actualizado);
});

router.patch('/password', requiereAuth, (req, res) => {
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  const usuario = db.prepare('SELECT * FROM usuarios WHERE id=?').get(req.usuario.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (!bcrypt.compareSync(currentPassword, usuario.password_hash)) {
    return res.status(401).json({ error: 'La contraseña actual no es correcta.' });
  }
  if (!strongPassword(newPassword)) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener entre 10 y 128 caracteres e incluir letras y números.' });
  }
  if (bcrypt.compareSync(newPassword, usuario.password_hash)) {
    return res.status(400).json({ error: 'La nueva contraseña debe ser diferente de la actual.' });
  }

  const hash = bcrypt.hashSync(newPassword, Number(process.env.BCRYPT_ROUNDS || 12));
  const tx = db.transaction(() => {
    db.prepare('UPDATE usuarios SET password_hash=? WHERE id=?').run(hash, usuario.id);
    db.prepare("UPDATE sesiones_refresh SET revocado_en=datetime('now') WHERE usuario_id=? AND revocado_en IS NULL").run(usuario.id);
  });
  tx();
  audit({ req, action: 'cambiar_password', entityType: 'usuario', entityId: usuario.id });
  res.json({ ok: true, mensaje: 'Contraseña actualizada. Vuelve a iniciar sesión en los demás dispositivos.' });
});

router.post('/recover-username', async (req, res) => {
  const telefono = validarTelefono(req.body.telefono);
  const respuesta = { ok: true, mensaje: 'Si encontramos una cuenta asociada, enviaremos el usuario al correo registrado.' };
  if (!telefono) return res.json(respuesta);

  const usuario = db.prepare('SELECT * FROM usuarios WHERE telefono=? AND activo=1').get(telefono);
  if (!usuario) return res.json(respuesta);

  const destino = correoDestino(usuario);
  try {
    await enviarCorreo({
      to: destino,
      subject: 'Dr Plants · Recuperación de usuario',
      text: `Tu usuario de Dr Plants es: ${usuario.email}`,
      html: `<p>Hola ${cleanString(usuario.nombre,120)},</p><p>Tu usuario de acceso a <b>Dr Plants</b> es:</p><p style="font-size:18px"><b>${cleanString(usuario.email,254)}</b></p><p>Si no solicitaste este mensaje, puedes ignorarlo.</p>`
    });
  } catch (error) {
    console.error('No se pudo enviar recuperación de usuario:', error.message);
  }
  res.json(respuesta);
});

router.post('/forgot-password', async (req, res) => {
  const identificador = cleanString(req.body.identificador, 254).toLowerCase();
  const respuesta = { ok: true, mensaje: 'Si la cuenta existe, enviaremos instrucciones para restablecer la contraseña.' };
  if (!identificador) return res.json(respuesta);

  const usuario = db.prepare('SELECT * FROM usuarios WHERE lower(email)=? AND activo=1').get(identificador);
  if (!usuario) return res.json(respuesta);

  const raw = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(raw);
  const id = nuevoId('recovery');
  const minutos = Math.max(10, Math.min(60, Number(process.env.PASSWORD_RESET_MINUTES || 30)));
  db.prepare("UPDATE recuperaciones_cuenta SET usado_en=datetime('now') WHERE usuario_id=? AND tipo='password' AND usado_en IS NULL")
    .run(usuario.id);
  db.prepare(`
    INSERT INTO recuperaciones_cuenta(id,usuario_id,tipo,token_hash,expira_en)
    VALUES(?,?, 'password', ?, datetime('now', ?))
  `).run(id, usuario.id, tokenHash, `+${minutos} minutes`);

  const base = String(process.env.APP_URL || 'https://app.drplants.app').replace(/\/$/, '');
  const enlace = `${base}/?reset_token=${encodeURIComponent(raw)}`;
  const destino = correoDestino(usuario);
  try {
    await enviarCorreo({
      to: destino,
      subject: 'Dr Plants · Restablecer contraseña',
      text: `Abre este enlace para crear una nueva contraseña. Vence en ${minutos} minutos: ${enlace}`,
      html: `<p>Hola ${cleanString(usuario.nombre,120)},</p><p>Recibimos una solicitud para cambiar tu contraseña de <b>Dr Plants</b>.</p><p><a href="${enlace}" style="display:inline-block;padding:12px 18px;background:#1b5e20;color:white;text-decoration:none;border-radius:10px">Crear nueva contraseña</a></p><p>El enlace vence en ${minutos} minutos. Si no hiciste esta solicitud, ignora este mensaje.</p>`
    });
  } catch (error) {
    console.error('No se pudo enviar recuperación de contraseña:', error.message);
  }
  res.json(respuesta);
});

router.post('/reset-password', (req, res) => {
  const token = String(req.body.token || '');
  const newPassword = String(req.body.newPassword || '');
  if (!token) return res.status(400).json({ error: 'El enlace de recuperación no es válido.' });
  if (!strongPassword(newPassword)) {
    return res.status(400).json({ error: 'La contraseña debe tener entre 10 y 128 caracteres e incluir letras y números.' });
  }

  const fila = db.prepare(`
    SELECT r.*,u.id AS uid
      FROM recuperaciones_cuenta r
      JOIN usuarios u ON u.id=r.usuario_id
     WHERE r.tipo='password'
       AND r.token_hash=?
       AND r.usado_en IS NULL
       AND datetime(r.expira_en)>datetime('now')
       AND u.activo=1
     ORDER BY r.creado_en DESC LIMIT 1
  `).get(hashToken(token));
  if (!fila) return res.status(400).json({ error: 'El enlace venció o ya fue utilizado. Solicita uno nuevo.' });

  const hash = bcrypt.hashSync(newPassword, Number(process.env.BCRYPT_ROUNDS || 12));
  const tx = db.transaction(() => {
    db.prepare('UPDATE usuarios SET password_hash=? WHERE id=?').run(hash, fila.uid);
    db.prepare("UPDATE recuperaciones_cuenta SET usado_en=datetime('now') WHERE id=?").run(fila.id);
    db.prepare("UPDATE sesiones_refresh SET revocado_en=datetime('now') WHERE usuario_id=? AND revocado_en IS NULL").run(fila.uid);
  });
  tx();
  res.json({ ok: true, mensaje: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
});

module.exports = router;
