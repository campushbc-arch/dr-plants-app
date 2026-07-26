const db = require('./db');
const { nuevoId } = require('./auth');

let transporter = null;
function smtpDisponible() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD && process.env.ADMIN_NOTIFICATION_EMAIL);
}
function getTransporter() {
  if (!smtpDisponible()) return null;
  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
    });
  }
  return transporter;
}

function crearNotificacionAdmin({ tipo, titulo, mensaje, usuarioId = null, entidadTipo = null, entidadId = null, prioridad = 'normal' }) {
  const id = nuevoId('not');
  db.prepare(`INSERT INTO notificaciones_admin
    (id,tipo,titulo,mensaje,usuario_id,entidad_tipo,entidad_id,prioridad)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, tipo, titulo, mensaje, usuarioId, entidadTipo, entidadId, prioridad);

  const tx = getTransporter();
  if (tx) {
    Promise.resolve(tx.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: process.env.ADMIN_NOTIFICATION_EMAIL,
      subject: `[Dr. Plants] ${titulo}`,
      text: `${mensaje}\n\nTipo: ${tipo}\nReferencia: ${entidadId || 'N/A'}`
    })).then(() => {
      db.prepare("UPDATE notificaciones_admin SET email_estado='enviado', email_enviado_en=datetime('now') WHERE id=?").run(id);
    }).catch((error) => {
      console.error('No se pudo enviar notificación por correo:', error.message);
      db.prepare("UPDATE notificaciones_admin SET email_estado='error', email_error=? WHERE id=?").run(String(error.message).slice(0,500), id);
    });
  }
  return id;
}

module.exports = { crearNotificacionAdmin, smtpDisponible };
