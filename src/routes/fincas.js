const express = require('express');
const { requiereSuscripcionCultivos } = require('../subscription');
const db = require('../db');
const { nuevoId, requiereAuth } = require('../auth');

const router = express.Router();
router.use(requiereAuth);
router.use(requiereSuscripcionCultivos);

function fincaPorId(id) {
  return db.prepare('SELECT * FROM fincas WHERE id = ? AND eliminado_en IS NULL').get(id);
}
function fincasVisiblesPara(usuario) {
  const base=`SELECT f.*, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, c.email AS cliente_email
              FROM fincas f LEFT JOIN clientes_agronomicos c ON c.id=f.cliente_id`;
  if (usuario.rol === 'admin') return db.prepare(`${base} WHERE f.eliminado_en IS NULL ORDER BY f.creado_en DESC`).all();
  if (usuario.rol === 'agronomo') return db.prepare(`${base}
    WHERE f.eliminado_en IS NULL AND (f.gestor_id=? OR f.productor_id=? OR EXISTS(SELECT 1 FROM agronomo_asignacion a WHERE a.finca_id=f.id AND a.agronomo_id=?))
    ORDER BY f.creado_en DESC`).all(usuario.id,usuario.id,usuario.id);
  return db.prepare(`${base} WHERE f.productor_id=? AND f.eliminado_en IS NULL ORDER BY f.creado_en DESC`).all(usuario.id);
}
function puedeVerFinca(usuario, fincaId) {
  const finca=fincaPorId(fincaId); if(!finca) return null;
  if(usuario.rol==='admin' || finca.productor_id===usuario.id || finca.gestor_id===usuario.id) return finca;
  if(usuario.rol==='agronomo') {
    const x=db.prepare('SELECT 1 FROM agronomo_asignacion WHERE finca_id=? AND agronomo_id=?').get(fincaId,usuario.id);
    return x?finca:null;
  }
  return null;
}
function puedeModificarFinca(usuario,finca){
  return usuario.rol==='admin' || finca.productor_id===usuario.id || (usuario.rol==='agronomo' && finca.gestor_id===usuario.id);
}
function loteVisible(usuario,loteId){
  const lote=db.prepare('SELECT * FROM lotes WHERE id=? AND eliminado_en IS NULL').get(loteId);
  return lote && puedeVerFinca(usuario,lote.finca_id) ? lote : null;
}
function puedeModificarLote(usuario,lote){ const finca=fincaPorId(lote.finca_id); return finca && puedeModificarFinca(usuario,finca); }
function limpiarTexto(v,max=300){ return typeof v==='string'?v.trim().slice(0,max):v; }

router.get('/',(req,res)=>res.json(fincasVisiblesPara(req.usuario)));

// V8A · clientes propios del agrónomo. No mezcla datos entre profesionales.
router.get('/clientes', (req,res)=>{
  if(req.usuario.rol==='admin') return res.json(db.prepare('SELECT * FROM clientes_agronomicos WHERE activo=1 ORDER BY creado_en DESC').all());
  if(req.usuario.rol!=='agronomo') return res.json([]);
  res.json(db.prepare('SELECT * FROM clientes_agronomicos WHERE agronomo_id=? AND activo=1 ORDER BY nombre').all(req.usuario.id));
});
router.post('/clientes', (req,res)=>{
  if(!['agronomo','admin'].includes(req.usuario.rol)) return res.status(403).json({error:'Esta función es para gestión profesional agronómica.'});
  const nombre=limpiarTexto(req.body.nombre,140); if(!nombre) return res.status(400).json({error:'El nombre del cliente es obligatorio.'});
  const id=nuevoId('cli'); const agronomoId=req.usuario.rol==='agronomo'?req.usuario.id:(limpiarTexto(req.body.agronomoId,100)||req.usuario.id);
  db.prepare(`INSERT INTO clientes_agronomicos(id,agronomo_id,nombre,documento,telefono,email,pais,region,ciudad,notas) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    id,agronomoId,nombre,limpiarTexto(req.body.documento,80)||null,limpiarTexto(req.body.telefono,50)||null,limpiarTexto(req.body.email,160)||null,
    limpiarTexto(req.body.pais,80)||null,limpiarTexto(req.body.region,120)||null,limpiarTexto(req.body.ciudad,120)||null,limpiarTexto(req.body.notas,600)||null);
  res.status(201).json(db.prepare('SELECT * FROM clientes_agronomicos WHERE id=?').get(id));
});
router.patch('/clientes/:id', (req,res)=>{
  const c=db.prepare('SELECT * FROM clientes_agronomicos WHERE id=? AND activo=1').get(req.params.id); if(!c) return res.status(404).json({error:'Cliente no encontrado.'});
  if(req.usuario.rol!=='admin'&&c.agronomo_id!==req.usuario.id) return res.status(403).json({error:'No puedes editar este cliente.'});
  const nombre=limpiarTexto(req.body.nombre??c.nombre,140); if(!nombre) return res.status(400).json({error:'Nombre obligatorio.'});
  db.prepare(`UPDATE clientes_agronomicos SET nombre=?,documento=?,telefono=?,email=?,pais=?,region=?,ciudad=?,notas=?,actualizado_en=datetime('now') WHERE id=?`).run(
    nombre,limpiarTexto(req.body.documento??c.documento,80)||null,limpiarTexto(req.body.telefono??c.telefono,50)||null,limpiarTexto(req.body.email??c.email,160)||null,
    limpiarTexto(req.body.pais??c.pais,80)||null,limpiarTexto(req.body.region??c.region,120)||null,limpiarTexto(req.body.ciudad??c.ciudad,120)||null,limpiarTexto(req.body.notas??c.notas,600)||null,c.id);
  res.json(db.prepare('SELECT * FROM clientes_agronomicos WHERE id=?').get(c.id));
});
router.delete('/clientes/:id', (req,res)=>{
  const c=db.prepare('SELECT * FROM clientes_agronomicos WHERE id=? AND activo=1').get(req.params.id); if(!c) return res.status(404).json({error:'Cliente no encontrado.'});
  if(req.usuario.rol!=='admin'&&c.agronomo_id!==req.usuario.id) return res.status(403).json({error:'No puedes archivar este cliente.'});
  db.prepare("UPDATE clientes_agronomicos SET activo=0,actualizado_en=datetime('now') WHERE id=?").run(c.id); res.json({ok:true});
});
router.get('/resumen-profesional',(req,res)=>{
  const fincas=fincasVisiblesPara(req.usuario); const ids=fincas.map(f=>f.id);
  let hectareas=0,lotes=0; for(const id of ids){const r=db.prepare('SELECT COUNT(*) n,COALESCE(SUM(area_ha),0) ha FROM lotes WHERE finca_id=? AND eliminado_en IS NULL').get(id);lotes+=r.n;hectareas+=r.ha;}
  const clientes=req.usuario.rol==='agronomo'?db.prepare('SELECT COUNT(*) n FROM clientes_agronomicos WHERE agronomo_id=? AND activo=1').get(req.usuario.id).n:0;
  res.json({clientes,fincas:fincas.length,lotes,hectareas:Number(hectareas.toFixed(2))});
});

router.post('/',(req,res)=>{
  const {nombre,ubicacionId,pais,region,ciudad,clienteId,clienteNombre,latitud,longitud,altitud}=req.body;
  if(!limpiarTexto(nombre,120) || !limpiarTexto(ubicacionId,180)) return res.status(400).json({error:'nombre y ubicación son obligatorios.'});
  let cid=null, relacion='propia', gestor=null, clienteCache=null;
  if(req.usuario.rol==='agronomo'){
    cid=limpiarTexto(clienteId,100)||null;
    if(cid){const c=db.prepare('SELECT * FROM clientes_agronomicos WHERE id=? AND agronomo_id=? AND activo=1').get(cid,req.usuario.id);if(!c)return res.status(400).json({error:'Selecciona un cliente válido.'});clienteCache=c.nombre;}
    else {clienteCache=limpiarTexto(clienteNombre,140)||null; if(!clienteCache)return res.status(400).json({error:'Selecciona o registra el cliente atendido.'});}
    relacion='asistida'; gestor=req.usuario.id;
  }
  const id=nuevoId('finca');
  db.prepare(`INSERT INTO fincas(id,productor_id,nombre,ubicacion_id,pais,region,ciudad,cliente_id,gestor_id,relacion_tipo,cliente_nombre_cache,latitud,longitud,altitud) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,req.usuario.id,limpiarTexto(nombre,120),limpiarTexto(ubicacionId,180),limpiarTexto(pais,80)||null,limpiarTexto(region,120)||null,limpiarTexto(ciudad,120)||null,cid,gestor,relacion,clienteCache,Number.isFinite(Number(latitud))?Number(latitud):null,Number.isFinite(Number(longitud))?Number(longitud):null,Number.isFinite(Number(altitud))?Number(altitud):null);
  res.status(201).json(fincasVisiblesPara(req.usuario).find(f=>f.id===id)||fincaPorId(id));
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
  if(!puedeModificarFinca(req.usuario,finca)) return res.status(403).json({error:'No puedes crear lotes en esta finca.'});
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
    observaciones:db.prepare(`SELECT o.*,u.nombre autor_nombre,u.rol autor_rol FROM observaciones_agronomicas o JOIN usuarios u ON u.id=o.autor_id WHERE o.lote_id=? AND o.eliminado_en IS NULL ORDER BY o.creado_en DESC`).all(lote.id),
    visitas:db.prepare(`SELECT v.*,u.nombre profesional_nombre FROM visitas_tecnicas v JOIN usuarios u ON u.id=v.profesional_id WHERE v.lote_id=? AND v.eliminado_en IS NULL ORDER BY v.fecha DESC`).all(lote.id)
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
   if(!puedeModificarLote(req.usuario,lote)) return res.status(403).json({error:'No puedes modificar el historial de este lote.'});
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

router.post('/lotes/:id/visitas',(req,res)=>{
 const lote=loteVisible(req.usuario,req.params.id); if(!lote) return res.status(403).json({error:'No tienes acceso.'});
 if(!['agronomo','admin'].includes(req.usuario.rol)) return res.status(403).json({error:'Solo profesionales pueden registrar visitas técnicas.'});
 const fecha=limpiarTexto(req.body.fecha,30); if(!fecha) return res.status(400).json({error:'La fecha es obligatoria.'});
 const id=nuevoId('vis'); db.prepare(`INSERT INTO visitas_tecnicas(id,lote_id,profesional_id,fecha,objetivo,observaciones,recomendaciones,proxima_visita) VALUES(?,?,?,?,?,?,?,?)`).run(
 id,lote.id,req.usuario.id,fecha,limpiarTexto(req.body.objetivo,300)||null,limpiarTexto(req.body.observaciones,3000)||null,limpiarTexto(req.body.recomendaciones,3000)||null,limpiarTexto(req.body.proximaVisita,30)||null);
 res.status(201).json(db.prepare(`SELECT v.*,u.nombre profesional_nombre FROM visitas_tecnicas v JOIN usuarios u ON u.id=v.profesional_id WHERE v.id=?`).get(id));
});

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
