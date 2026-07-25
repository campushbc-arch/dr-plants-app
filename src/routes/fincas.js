const express = require('express');
const db = require('../db');
const { nuevoId, requiereAuth } = require('../auth');

const router = express.Router();
router.use(requiereAuth);

function fincaPorId(id) {
  return db.prepare('SELECT * FROM fincas WHERE id = ? AND eliminado_en IS NULL').get(id);
}
function fincasVisiblesPara(usuario) {
  if (usuario.rol === 'admin') return db.prepare('SELECT * FROM fincas WHERE eliminado_en IS NULL ORDER BY creado_en DESC').all();
  if (usuario.rol === 'agronomo') return db.prepare(`
    SELECT DISTINCT f.* FROM fincas f JOIN agronomo_asignacion a ON a.finca_id=f.id
    WHERE a.agronomo_id=? AND f.eliminado_en IS NULL ORDER BY f.creado_en DESC`).all(usuario.id);
  return db.prepare('SELECT * FROM fincas WHERE productor_id=? AND eliminado_en IS NULL ORDER BY creado_en DESC').all(usuario.id);
}
function puedeVerFinca(usuario, fincaId) {
  const finca=fincaPorId(fincaId); if(!finca) return null;
  if(usuario.rol==='admin' || finca.productor_id===usuario.id) return finca;
  if(usuario.rol==='agronomo') {
    const x=db.prepare('SELECT 1 FROM agronomo_asignacion WHERE finca_id=? AND agronomo_id=?').get(fincaId,usuario.id);
    return x?finca:null;
  }
  return null;
}
function puedeModificarFinca(usuario,finca){ return usuario.rol==='admin' || finca.productor_id===usuario.id; }
function loteVisible(usuario,loteId){
  const lote=db.prepare('SELECT * FROM lotes WHERE id=? AND eliminado_en IS NULL').get(loteId);
  return lote && puedeVerFinca(usuario,lote.finca_id) ? lote : null;
}
function puedeModificarLote(usuario,lote){ const finca=fincaPorId(lote.finca_id); return finca && puedeModificarFinca(usuario,finca); }
function limpiarTexto(v,max=300){ return typeof v==='string'?v.trim().slice(0,max):v; }

router.get('/',(req,res)=>res.json(fincasVisiblesPara(req.usuario)));
router.post('/',(req,res)=>{
  if(req.usuario.rol==='agronomo') return res.status(403).json({error:'El agrónomo no puede crear fincas del productor.'});
  const {nombre,ubicacionId,pais,region,ciudad}=req.body;
  if(!limpiarTexto(nombre,120) || !limpiarTexto(ubicacionId,180)) return res.status(400).json({error:'nombre y ubicación son obligatorios.'});
  const id=nuevoId('finca');
  db.prepare(`INSERT INTO fincas(id,productor_id,nombre,ubicacion_id,pais,region,ciudad) VALUES(?,?,?,?,?,?,?)`)
    .run(id,req.usuario.id,limpiarTexto(nombre,120),limpiarTexto(ubicacionId,180),limpiarTexto(pais,80)||null,limpiarTexto(region,120)||null,limpiarTexto(ciudad,120)||null);
  res.status(201).json(fincaPorId(id));
});
router.patch('/:id',(req,res)=>{
  const finca=puedeVerFinca(req.usuario,req.params.id);
  if(!finca) return res.status(404).json({error:'Finca no encontrada.'});
  if(!puedeModificarFinca(req.usuario,finca)) return res.status(403).json({error:'Solo el productor propietario o un administrador puede editarla.'});
  const nombre=limpiarTexto(req.body.nombre??finca.nombre,120);
  const pais=limpiarTexto(req.body.pais??finca.pais,80), region=limpiarTexto(req.body.region??finca.region,120), ciudad=limpiarTexto(req.body.ciudad??finca.ciudad,120);
  const ubicacionId=limpiarTexto(req.body.ubicacionId??finca.ubicacion_id,180);
  if(!nombre||!ubicacionId) return res.status(400).json({error:'Nombre y ubicación son obligatorios.'});
  db.prepare(`UPDATE fincas SET nombre=?,ubicacion_id=?,pais=?,region=?,ciudad=?,actualizado_en=datetime('now') WHERE id=?`)
    .run(nombre,ubicacionId,pais||null,region||null,ciudad||null,finca.id);
  res.json(fincaPorId(finca.id));
});
router.delete('/:id',(req,res)=>{
  const finca=puedeVerFinca(req.usuario,req.params.id);
  if(!finca) return res.status(404).json({error:'Finca no encontrada.'});
  if(!puedeModificarFinca(req.usuario,finca)) return res.status(403).json({error:'No puedes eliminar esta finca.'});
  db.prepare("UPDATE fincas SET eliminado_en=datetime('now'),actualizado_en=datetime('now') WHERE id=?").run(finca.id);
  db.prepare("UPDATE lotes SET eliminado_en=datetime('now'),actualizado_en=datetime('now') WHERE finca_id=?").run(finca.id);
  res.json({ok:true});
});

router.get('/:id/lotes',(req,res)=>{
  const finca=puedeVerFinca(req.usuario,req.params.id); if(!finca) return res.status(403).json({error:'No tienes acceso.'});
  res.json(db.prepare('SELECT * FROM lotes WHERE finca_id=? AND eliminado_en IS NULL ORDER BY creado_en DESC').all(finca.id));
});
router.post('/:id/lotes',(req,res)=>{
  const finca=puedeVerFinca(req.usuario,req.params.id); if(!finca) return res.status(403).json({error:'No tienes acceso.'});
  if(!puedeModificarFinca(req.usuario,finca)) return res.status(403).json({error:'El agrónomo acompaña mediante observaciones; no crea lotes por el productor.'});
  const {nombre,cultivoId,cultivoNombre,variedad,areaHa,fechaSiembra}=req.body;
  if(!limpiarTexto(nombre,120)||!limpiarTexto(cultivoId,120)||!Number(areaHa)||!fechaSiembra) return res.status(400).json({error:'nombre, cultivo, área y fecha son obligatorios.'});
  const id=nuevoId('lote');
  db.prepare(`INSERT INTO lotes(id,finca_id,nombre,cultivo_id,cultivo_nombre,variedad,area_ha,fecha_siembra) VALUES(?,?,?,?,?,?,?,?)`)
   .run(id,finca.id,limpiarTexto(nombre,120),limpiarTexto(cultivoId,120),limpiarTexto(cultivoNombre,160)||null,limpiarTexto(variedad,160)||null,Number(areaHa),fechaSiembra);
  res.status(201).json(db.prepare('SELECT * FROM lotes WHERE id=?').get(id));
});
router.patch('/lotes/:id',(req,res)=>{
  const lote=loteVisible(req.usuario,req.params.id); if(!lote) return res.status(404).json({error:'Lote no encontrado.'});
  if(!puedeModificarLote(req.usuario,lote)) return res.status(403).json({error:'Solo el productor propietario o un administrador puede editarlo.'});
  const values={nombre:limpiarTexto(req.body.nombre??lote.nombre,120),cultivoId:limpiarTexto(req.body.cultivoId??lote.cultivo_id,120),cultivoNombre:limpiarTexto(req.body.cultivoNombre??lote.cultivo_nombre,160),variedad:limpiarTexto(req.body.variedad??lote.variedad,160),areaHa:Number(req.body.areaHa??lote.area_ha),fechaSiembra:req.body.fechaSiembra??lote.fecha_siembra};
  if(!values.nombre||!values.cultivoId||!values.areaHa||!values.fechaSiembra) return res.status(400).json({error:'Faltan datos obligatorios.'});
  db.prepare(`UPDATE lotes SET nombre=?,cultivo_id=?,cultivo_nombre=?,variedad=?,area_ha=?,fecha_siembra=?,actualizado_en=datetime('now') WHERE id=?`)
   .run(values.nombre,values.cultivoId,values.cultivoNombre||null,values.variedad||null,values.areaHa,values.fechaSiembra,lote.id);
  res.json(db.prepare('SELECT * FROM lotes WHERE id=?').get(lote.id));
});
router.delete('/lotes/:id',(req,res)=>{
  const lote=loteVisible(req.usuario,req.params.id); if(!lote) return res.status(404).json({error:'Lote no encontrado.'});
  if(!puedeModificarLote(req.usuario,lote)) return res.status(403).json({error:'No puedes eliminar este lote.'});
  db.prepare("UPDATE lotes SET eliminado_en=datetime('now'),actualizado_en=datetime('now') WHERE id=?").run(lote.id); res.json({ok:true});
});
router.get('/lotes/:id',(req,res)=>{
  const lote=loteVisible(req.usuario,req.params.id); if(!lote) return res.status(403).json({error:'No tienes acceso.'});
  res.json({...lote,
    aplicaciones:db.prepare('SELECT * FROM aplicaciones WHERE lote_id=? AND eliminado_en IS NULL ORDER BY fecha').all(lote.id),
    analisis:db.prepare('SELECT * FROM analisis_laboratorio WHERE lote_id=? AND eliminado_en IS NULL ORDER BY fecha').all(lote.id),
    costosOperativos:db.prepare('SELECT * FROM costos_operativos WHERE lote_id=? AND eliminado_en IS NULL ORDER BY fecha').all(lote.id),
    observaciones:db.prepare(`SELECT o.*,u.nombre autor_nombre,u.rol autor_rol FROM observaciones_agronomicas o JOIN usuarios u ON u.id=o.autor_id WHERE o.lote_id=? AND o.eliminado_en IS NULL ORDER BY o.creado_en DESC`).all(lote.id)
  });
});

const defs={
  aplicaciones:{table:'aplicaciones',required:['tipo','producto','fecha'],fields:['tipo','producto','fecha','cantidad','costo_cop'],map:b=>[limpiarTexto(b.tipo,80),limpiarTexto(b.producto,180),b.fecha,limpiarTexto(b.cantidad,80)||null,Number(b.costoCop)||0]},
  analisis:{table:'analisis_laboratorio',required:['tipo','fecha'],fields:['tipo','fecha','resultado'],map:b=>[limpiarTexto(b.tipo,160),b.fecha,limpiarTexto(b.resultado,1000)||null]},
  costos:{table:'costos_operativos',required:['categoria','fecha','costoCop'],fields:['categoria','descripcion','fecha','costo_cop'],map:b=>[limpiarTexto(b.categoria,100),limpiarTexto(b.descripcion,300)||null,b.fecha,Number(b.costoCop)||0]}
};
for(const [pathName,d] of Object.entries(defs)){
 router.post(`/lotes/:id/${pathName}`,(req,res)=>{
   const lote=loteVisible(req.usuario,req.params.id); if(!lote) return res.status(403).json({error:'No tienes acceso.'});
   if(!puedeModificarLote(req.usuario,lote)) return res.status(403).json({error:'El agrónomo debe registrar una observación profesional, no modificar el historial del productor.'});
   if(d.required.some(k=>!req.body[k])) return res.status(400).json({error:'Faltan campos obligatorios.'});
   const id=nuevoId(pathName.slice(0,4)); const vals=d.map(req.body);
   db.prepare(`INSERT INTO ${d.table}(id,lote_id,${d.fields.join(',')},creado_por) VALUES(${Array(3+d.fields.length).fill('?').join(',')})`).run(id,lote.id,...vals,req.usuario.id);
   res.status(201).json(db.prepare(`SELECT * FROM ${d.table} WHERE id=?`).get(id));
 });
 router.patch(`/${pathName}/:registroId`,(req,res)=>{
   const row=db.prepare(`SELECT * FROM ${d.table} WHERE id=? AND eliminado_en IS NULL`).get(req.params.registroId); if(!row) return res.status(404).json({error:'Registro no encontrado.'});
   const lote=loteVisible(req.usuario,row.lote_id); if(!lote||!puedeModificarLote(req.usuario,lote)) return res.status(403).json({error:'No puedes editar este registro.'});
   const current={...row,...req.body}; const vals=d.map(current);
   db.prepare(`UPDATE ${d.table} SET ${d.fields.map(f=>`${f}=?`).join(',')},actualizado_en=datetime('now') WHERE id=?`).run(...vals,row.id);
   res.json(db.prepare(`SELECT * FROM ${d.table} WHERE id=?`).get(row.id));
 });
 router.delete(`/${pathName}/:registroId`,(req,res)=>{
   const row=db.prepare(`SELECT * FROM ${d.table} WHERE id=? AND eliminado_en IS NULL`).get(req.params.registroId); if(!row) return res.status(404).json({error:'Registro no encontrado.'});
   const lote=loteVisible(req.usuario,row.lote_id); if(!lote||!puedeModificarLote(req.usuario,lote)) return res.status(403).json({error:'No puedes eliminar este registro.'});
   db.prepare(`UPDATE ${d.table} SET eliminado_en=datetime('now'),actualizado_en=datetime('now') WHERE id=?`).run(row.id); res.json({ok:true});
 });
}

router.post('/lotes/:id/observaciones',(req,res)=>{
 const lote=loteVisible(req.usuario,req.params.id); if(!lote) return res.status(403).json({error:'No tienes acceso.'});
 if(!['agronomo','admin'].includes(req.usuario.rol)) return res.status(403).json({error:'Solo agrónomos asignados o administradores pueden emitir observaciones profesionales.'});
 const texto=limpiarTexto(req.body.texto,3000); if(!texto) return res.status(400).json({error:'La observación es obligatoria.'});
 const tipo=['observacion','correccion','recomendacion','alerta'].includes(req.body.tipo)?req.body.tipo:'observacion';
 const id=nuevoId('obs'); db.prepare(`INSERT INTO observaciones_agronomicas(id,lote_id,autor_id,tipo,texto,referencia_tipo,referencia_id) VALUES(?,?,?,?,?,?,?)`)
 .run(id,lote.id,req.usuario.id,tipo,texto,limpiarTexto(req.body.referenciaTipo,50)||null,limpiarTexto(req.body.referenciaId,100)||null);
 res.status(201).json(db.prepare(`SELECT o.*,u.nombre autor_nombre,u.rol autor_rol FROM observaciones_agronomicas o JOIN usuarios u ON u.id=o.autor_id WHERE o.id=?`).get(id));
});
router.patch('/observaciones/:id',(req,res)=>{
 const o=db.prepare('SELECT * FROM observaciones_agronomicas WHERE id=? AND eliminado_en IS NULL').get(req.params.id); if(!o) return res.status(404).json({error:'Observación no encontrada.'});
 if(req.usuario.rol!=='admin'&&o.autor_id!==req.usuario.id) return res.status(403).json({error:'Solo su autor puede editarla.'});
 const texto=limpiarTexto(req.body.texto??o.texto,3000); const tipo=['observacion','correccion','recomendacion','alerta'].includes(req.body.tipo)?req.body.tipo:o.tipo;
 if(!texto) return res.status(400).json({error:'La observación es obligatoria.'});
 db.prepare("UPDATE observaciones_agronomicas SET texto=?,tipo=?,actualizado_en=datetime('now') WHERE id=?").run(texto,tipo,o.id); res.json({ok:true});
});
router.delete('/observaciones/:id',(req,res)=>{
 const o=db.prepare('SELECT * FROM observaciones_agronomicas WHERE id=? AND eliminado_en IS NULL').get(req.params.id); if(!o) return res.status(404).json({error:'Observación no encontrada.'});
 if(req.usuario.rol!=='admin'&&o.autor_id!==req.usuario.id) return res.status(403).json({error:'Solo su autor puede eliminarla.'});
 db.prepare("UPDATE observaciones_agronomicas SET eliminado_en=datetime('now') WHERE id=?").run(o.id); res.json({ok:true});
});

module.exports = router;
