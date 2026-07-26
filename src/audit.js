const db = require('./db');
const { nuevoId } = require('./auth');

function audit({ req, action, result = 'ok', entityType = null, entityId = null, metadata = null }) {
  try {
    db.prepare(`INSERT INTO auditoria_seguridad
      (id,usuario_id,accion,resultado,entidad_tipo,entidad_id,ip,user_agent,request_id,metadata_json)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      nuevoId('aud'), req?.usuario?.id || null, action, result, entityType, entityId,
      String(req?.ip || '').slice(0,100) || null,
      String(req?.get?.('user-agent') || '').slice(0,500) || null,
      String(req?.id || '').slice(0,100) || null,
      metadata ? JSON.stringify(metadata).slice(0,10000) : null
    );
  } catch (error) {
    console.error('No se pudo registrar auditoría:', error.message);
  }
}
module.exports = { audit };
