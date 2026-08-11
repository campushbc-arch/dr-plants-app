const db = require('./db');

function rolEmpresarial(usuarioId){
  return db.prepare(`SELECT rol FROM permisos_empresariales WHERE usuario_id=? AND activo=1`).get(usuarioId)?.rol || null;
}
function esSuperAdmin(usuario){
  if(!usuario) return false;
  if(usuario.rol!=='admin') return false;
  const r=rolEmpresarial(usuario.id);
  // Compatibilidad: toda cuenta admin existente conserva control total hasta que se asigne otro rol explícito.
  return !r || r==='super_admin';
}
function esAdminOperativo(usuario){
  return Boolean(usuario && usuario.rol==='admin' && ['super_admin','admin_operativo',null].includes(rolEmpresarial(usuario.id)));
}
function esEjecutivoComercial(usuario){
  return rolEmpresarial(usuario?.id)==='ejecutivo_comercial';
}
function puedeDemo(usuario){
  return esSuperAdmin(usuario) || esEjecutivoComercial(usuario);
}
function modoDemo(usuarioId){
  return Boolean(db.prepare(`SELECT activo FROM modo_demo_usuario WHERE usuario_id=?`).get(usuarioId)?.activo);
}
function setModoDemo(usuarioId, activo){
  db.prepare(`INSERT INTO modo_demo_usuario(usuario_id,activo,actualizado_en) VALUES(?,?,datetime('now'))
    ON CONFLICT(usuario_id) DO UPDATE SET activo=excluded.activo,actualizado_en=datetime('now')`).run(usuarioId,activo?1:0);
}
module.exports={rolEmpresarial,esSuperAdmin,esAdminOperativo,esEjecutivoComercial,puedeDemo,modoDemo,setModoDemo};
