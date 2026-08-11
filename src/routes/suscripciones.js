const express=require('express');
const db=require('../db');
const {requiereAuth,nuevoId,requiereRol}=require('../auth');
const {PLANES,hectareasUsuario,planPorHectareas,estadoAcceso}=require('../subscription');
const {crearNotificacionAdmin,crearNotificacionUsuario}=require('../notificaciones');
const {audit}=require('../audit');
const router=express.Router();

function wompiCfg(){
  const sandbox=(process.env.WOMPI_ENVIRONMENT||'sandbox')!=='production';
  return {base:sandbox?'https://sandbox.wompi.co/v1':'https://production.wompi.co/v1',publicKey:process.env.WOMPI_PUBLIC_KEY||'',privateKey:process.env.WOMPI_PRIVATE_KEY||''};
}
async function wompi(path,opts={}){
  const c=wompiCfg(); const auth=opts.private?c.privateKey:c.publicKey;
  if(!auth) throw Object.assign(new Error(opts.private?'WOMPI_PRIVATE_KEY no configurada.':'WOMPI_PUBLIC_KEY no configurada.'),{status:503});
  const r=await fetch(c.base+path,{method:opts.method||'GET',headers:{Authorization:`Bearer ${auth}`,'Content-Type':'application/json'},body:opts.body?JSON.stringify(opts.body):undefined});
  const j=await r.json().catch(()=>({})); if(!r.ok) throw Object.assign(new Error(j?.error?.reason||j?.error?.type||j?.error||`Wompi HTTP ${r.status}`),{status:r.status,body:j}); return j;
}
function addDays(date,days){const d=new Date(date);d.setUTCDate(d.getUTCDate()+days);return d.toISOString();}
function addMonths(date,months){const d=new Date(date);d.setUTCMonth(d.getUTCMonth()+months);return d.toISOString();}

router.get('/planes',requiereAuth,(req,res)=>{const ha=hectareasUsuario(req.usuario.id,req.usuario.rol);res.json({planes:PLANES,hectareas:ha,recomendado:planPorHectareas(ha)});});
router.get('/estado',requiereAuth,(req,res)=>res.json(estadoAcceso(req.usuario.id,req.usuario.rol)));
router.get('/wompi-aceptacion',requiereAuth,async(req,res,next)=>{try{const c=wompiCfg();if(!c.publicKey)return res.status(503).json({error:'Wompi no configurado.'});const r=await fetch(`${c.base}/merchants/${encodeURIComponent(c.publicKey)}`);const j=await r.json();if(!r.ok)throw new Error('No fue posible obtener los contratos de Wompi.');const d=j.data||{};res.json({publicKey:c.publicKey,terminos:d.presigned_acceptance||null,datos:d.presigned_personal_data_auth||null});}catch(e){next(e)}});

router.post('/activar-prueba',requiereAuth,async(req,res,next)=>{try{
  const {planId,periodicidad,cardToken,acceptanceToken,personalAuth}=req.body||{};
  const plan=PLANES.find(p=>p.id===planId);if(!plan)return res.status(400).json({error:'Plan inválido.'});if(!['mensual','anual'].includes(periodicidad))return res.status(400).json({error:'Periodicidad inválida.'});
  if(!cardToken||!acceptanceToken||!personalAuth)return res.status(400).json({error:'Faltan datos de tokenización o aceptación.'});
  const existente=db.prepare(`SELECT id FROM suscripciones WHERE usuario_id=? AND estado IN ('trial','activa')`).get(req.usuario.id);if(existente)return res.status(409).json({error:'Ya tienes una suscripción o prueba activa.'});
  const ha=hectareasUsuario(req.usuario.id,req.usuario.rol);if(plan.maxHa!=null && ha>plan.maxHa)return res.status(422).json({error:`Tus ${ha.toFixed(1)} ha superan el límite del plan ${plan.nombre}.`,recomendado:planPorHectareas(ha)});
  const u=db.prepare('SELECT id,nombre,email FROM usuarios WHERE id=?').get(req.usuario.id);
  const source=await wompi('/payment_sources',{private:true,method:'POST',body:{type:'CARD',token:cardToken,customer_email:u.email,acceptance_token:acceptanceToken,accept_personal_auth:personalAuth}});
  const ps=source.data||source; if(!ps?.id)throw new Error('Wompi no devolvió una fuente de pago válida.');
  const now=new Date(); const trialEnd=addDays(now,7); const sid=nuevoId('sub'); const fid=nuevoId('fps');
  const tx=db.transaction(()=>{
    db.prepare(`INSERT INTO fuentes_pago_suscripcion(id,usuario_id,wompi_payment_source_id,tipo,marca,ultimos4,estado,creado_en) VALUES(?,?,?,?,?,?,?,datetime('now'))`).run(fid,u.id,String(ps.id),'CARD',ps.brand||ps.public_data?.brand||null,ps.last_four||ps.public_data?.last_four||null,'activa');
    db.prepare(`INSERT INTO suscripciones(id,usuario_id,plan_id,periodicidad,estado,prueba_inicio,prueba_hasta,proximo_cobro,fuente_pago_id,max_ha_plan,creado_en,actualizado_en) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).run(sid,u.id,plan.id,periodicidad,'trial',now.toISOString(),trialEnd,trialEnd,fid,plan.maxHa);
  });tx();
  crearNotificacionUsuario({usuarioId:u.id,tipo:'suscripcion_trial',titulo:'Prueba gratuita activada',mensaje:`Tienes 7 días gratis de Dr. Plants Professional. Tu plan ${plan.nombre} comenzará a cobrarse ${periodicidad==='anual'?'anualmente':'mensualmente'} al finalizar la prueba, salvo cancelación.`,entidadTipo:'suscripcion',entidadId:sid});
  crearNotificacionAdmin({tipo:'suscripcion_trial',titulo:'Nueva prueba gratuita',mensaje:`${u.nombre} inició 7 días de prueba en el plan ${plan.nombre}.`,usuarioId:u.id,entidadTipo:'suscripcion',entidadId:sid,prioridad:'normal'});
  audit({req,action:'activar_trial_suscripcion',entityType:'suscripcion',entityId:sid,metadata:{planId,periodicidad,ha}});
  res.status(201).json({ok:true,suscripcionId:sid,pruebaHasta:trialEnd,plan,periodicidad});
}catch(e){next(e)}});

router.get('/mi-suscripcion',requiereAuth,(req,res)=>{
 const s=db.prepare(`SELECT s.*,p.nombre plan_nombre,p.min_ha,p.max_ha,p.precio_mensual_cop,p.precio_anual_cop,f.marca,f.ultimos4 FROM suscripciones s JOIN planes_suscripcion p ON p.id=s.plan_id LEFT JOIN fuentes_pago_suscripcion f ON f.id=s.fuente_pago_id WHERE s.usuario_id=? ORDER BY s.creado_en DESC LIMIT 1`).get(req.usuario.id);
 if(!s)return res.json({suscripcion:null,solicitudCancelacion:null,hectareas:hectareasUsuario(req.usuario.id,req.usuario.rol),pagos:[]});
 const solicitud=solicitudCancelacionAbierta(s.id)||db.prepare(`SELECT * FROM solicitudes_cancelacion_suscripcion WHERE suscripcion_id=? ORDER BY solicitado_en DESC LIMIT 1`).get(s.id)||null;
 const pagos=db.prepare(`SELECT referencia,monto_cop,estado,creado_en,wompi_transaccion_id FROM cobros_suscripcion WHERE suscripcion_id=? ORDER BY creado_en DESC LIMIT 20`).all(s.id);
 const descuento=descuentoVigente(s.id);
 res.json({suscripcion:s,solicitudCancelacion:solicitud,hectareas:hectareasUsuario(req.usuario.id,req.usuario.rol),pagos,descuento});
});

router.post('/solicitar-cancelacion',requiereAuth,(req,res)=>{
 const s=db.prepare(`SELECT * FROM suscripciones WHERE usuario_id=? AND estado IN ('trial','activa','morosa') ORDER BY creado_en DESC LIMIT 1`).get(req.usuario.id);
 if(!s)return res.status(404).json({error:'No tienes una suscripción que pueda solicitar cancelación.'});
 if(solicitudCancelacionAbierta(s.id))return res.status(409).json({error:'Ya tienes una solicitud de cancelación en revisión.'});
 const motivos=['precio','no_uso','venta_finca','cierre_empresa','problemas_tecnicos','competencia','no_cumplio_expectativas','otro'];
 const motivo=String(req.body?.motivo||'').trim();const explicacion=String(req.body?.explicacion||'').trim();const mejoras=String(req.body?.mejoras||'').trim();const recomendaria=Number(req.body?.recomendaria);
 if(!motivos.includes(motivo))return res.status(400).json({error:'Selecciona un motivo válido.'});
 if(explicacion.length<10)return res.status(400).json({error:'Explica el motivo con al menos 10 caracteres.'});
 if(mejoras.length<5)return res.status(400).json({error:'Cuéntanos qué podríamos mejorar.'});
 if(!Number.isInteger(recomendaria)||recomendaria<1||recomendaria>5)return res.status(400).json({error:'Califica de 1 a 5.'});
 const id=nuevoId('can');db.prepare(`INSERT INTO solicitudes_cancelacion_suscripcion(id,suscripcion_id,usuario_id,motivo,explicacion,recomendaria,mejoras,estado,solicitado_en) VALUES(?,?,?,?,?,?,?,'pendiente_revision',datetime('now'))`).run(id,s.id,req.usuario.id,motivo,explicacion,recomendaria,mejoras);
 crearNotificacionAdmin({tipo:'cancelacion_suscripcion',titulo:'Nueva solicitud de cancelación',mensaje:`${req.usuario.nombre||'Un usuario'} solicitó cancelar su suscripción. Motivo: ${motivo}.`,usuarioId:req.usuario.id,entidadTipo:'solicitud_cancelacion',entidadId:id,prioridad:'alta'});
 crearNotificacionUsuario({usuarioId:req.usuario.id,tipo:'cancelacion_suscripcion',titulo:'Solicitud recibida',mensaje:'Recibimos tu solicitud de cancelación. La renovación automática queda en pausa mientras administración revisa tu caso.',entidadTipo:'solicitud_cancelacion',entidadId:id,prioridad:'normal'});
 audit({req,action:'solicitar_cancelacion_suscripcion',entityType:'suscripcion',entityId:s.id,metadata:{solicitudId:id,motivo,recomendaria}});
 res.status(201).json({ok:true,id,estado:'pendiente_revision',mensaje:'Solicitud enviada. No se generarán cobros automáticos mientras esté en revisión.'});
});

function solicitudCancelacionAbierta(suscripcionId){
 return db.prepare(`SELECT * FROM solicitudes_cancelacion_suscripcion WHERE suscripcion_id=? AND estado IN ('pendiente_revision','pendiente_contacto','en_negociacion') ORDER BY solicitado_en DESC LIMIT 1`).get(suscripcionId)||null;
}
function descuentoVigente(suscripcionId){
 return db.prepare(`SELECT * FROM descuentos_suscripcion WHERE suscripcion_id=? AND activo=1 AND datetime(inicia_en)<=datetime('now') AND datetime(vence_en)>datetime('now') ORDER BY porcentaje DESC, creado_en DESC LIMIT 1`).get(suscripcionId)||null;
}
function registrarAccionRetencion({suscripcionId,solicitudId=null,usuarioId,tipo,valor=null,detalle=null,creadoPor=null}){
 const id=nuevoId('ret');
 db.prepare(`INSERT INTO acciones_retencion_suscripcion(id,suscripcion_id,solicitud_id,usuario_id,tipo,valor,detalle,creado_por,creado_en) VALUES(?,?,?,?,?,?,?,?,datetime('now'))`).run(id,suscripcionId,solicitudId,usuarioId,tipo,valor,detalle,creadoPor);
 return id;
}

async function cobrarSuscripcion(s){
 const plan=PLANES.find(p=>p.id===s.plan_id);if(!plan)throw new Error('Plan no encontrado');let monto=s.periodicidad==='anual'?plan.anual:plan.mensual;const descuento=descuentoVigente(s.id);if(descuento)monto=Math.max(0,Math.round(monto*(100-Number(descuento.porcentaje))/100));const fuente=db.prepare('SELECT * FROM fuentes_pago_suscripcion WHERE id=?').get(s.fuente_pago_id);const u=db.prepare('SELECT * FROM usuarios WHERE id=?').get(s.usuario_id);if(!fuente||!u)throw new Error('Fuente o usuario no encontrado');
 const ref=`DRP-SUB-${Date.now()}-${Math.random().toString(16).slice(2,10)}`;const body={amount_in_cents:monto*100,currency:'COP',customer_email:u.email,reference:ref,payment_source_id:Number(fuente.wompi_payment_source_id),recurrent:true,payment_method:{installments:1}};
 const r=await wompi('/transactions',{private:true,method:'POST',body});const trx=r.data||r;const id=nuevoId('chg');db.prepare(`INSERT INTO cobros_suscripcion(id,suscripcion_id,usuario_id,referencia,monto_cop,estado,wompi_transaccion_id,respuesta_wompi,creado_en) VALUES(?,?,?,?,?,?,?,?,datetime('now'))`).run(id,s.id,s.usuario_id,ref,monto,String(trx.status||'PENDING').toUpperCase(),trx.id||null,JSON.stringify(trx));return {id,trx,monto};
}

async function procesarRenovaciones(){
 const now=new Date().toISOString();const pendientes=db.prepare(`SELECT * FROM suscripciones WHERE estado IN ('trial','activa','morosa') AND proximo_cobro IS NOT NULL AND proximo_cobro<=?`).all(now);
 for(const s of pendientes){try{
   if(solicitudCancelacionAbierta(s.id)){continue;}
   if(s.cancelar_al_final){db.prepare(`UPDATE suscripciones SET estado='cancelada',actualizado_en=datetime('now') WHERE id=?`).run(s.id);continue;}
   const {trx,monto}=await cobrarSuscripcion(s);const estado=String(trx.status||'PENDING').toUpperCase();
   if(estado==='APPROVED'){
     const desde=new Date();const hasta=s.periodicidad==='anual'?addMonths(desde,12):addMonths(desde,1);db.prepare(`UPDATE suscripciones SET estado='activa',periodo_desde=?,periodo_hasta=?,proximo_cobro=?,intentos_fallidos=0,actualizado_en=datetime('now') WHERE id=?`).run(desde.toISOString(),hasta,hasta,s.id);
     crearNotificacionUsuario({usuarioId:s.usuario_id,tipo:'suscripcion_cobrada',titulo:'Suscripción renovada',mensaje:`Tu pago de Dr. Plants Professional por $${monto.toLocaleString('es-CO')} COP fue aprobado.`,entidadTipo:'suscripcion',entidadId:s.id});
   } else if(['DECLINED','ERROR','VOIDED'].includes(estado)){
     db.prepare(`UPDATE suscripciones SET estado='morosa',intentos_fallidos=intentos_fallidos+1,proximo_cobro=?,actualizado_en=datetime('now') WHERE id=?`).run(addDays(new Date(),1),s.id);
     crearNotificacionUsuario({usuarioId:s.usuario_id,tipo:'suscripcion_fallo',titulo:'No pudimos renovar tu suscripción',mensaje:'El cobro automático no fue aprobado. Reintentaremos en 24 horas. Puedes actualizar tu medio de pago.',entidadTipo:'suscripcion',entidadId:s.id});
     crearNotificacionAdmin({tipo:'suscripcion_fallo',titulo:'Cobro recurrente no aprobado',mensaje:`No se aprobó la renovación de la suscripción ${s.id}.`,usuarioId:s.usuario_id,entidadTipo:'suscripcion',entidadId:s.id,prioridad:'alta'});
   }
 }catch(e){console.error('Renovación suscripción falló',s.id,e.message);}
 }
 return pendientes.length;
}

router.post('/procesar-renovaciones',requiereAuth,requiereRol('admin'),async(req,res,next)=>{try{res.json({ok:true,procesadas:await procesarRenovaciones()})}catch(e){next(e)}});
router.get('/admin',requiereAuth,requiereRol('admin'),(req,res)=>res.json(db.prepare(`SELECT s.*,u.nombre,u.email,p.nombre plan_nombre,p.precio_mensual_cop,p.precio_anual_cop FROM suscripciones s JOIN usuarios u ON u.id=s.usuario_id JOIN planes_suscripcion p ON p.id=s.plan_id ORDER BY s.creado_en DESC`).all()));

// V8C.1 · Accesos temporales / comerciales sin pago.
router.get('/admin/accesos-temporales',requiereAuth,requiereRol('admin'),(req,res)=>{
  res.json(db.prepare(`SELECT a.*,u.nombre,u.email,u.rol,
    CASE WHEN a.revocado_en IS NULL AND datetime(a.vence_en)>datetime('now') THEN 1 ELSE 0 END AS vigente
    FROM accesos_temporales_cultivo a JOIN usuarios u ON u.id=a.usuario_id
    ORDER BY a.creado_en DESC`).all());
});

router.post('/admin/accesos-temporales',requiereAuth,requiereRol('admin'),(req,res)=>{
  const {usuarioId,dias,tipo,motivo}=req.body||{};
  const u=db.prepare(`SELECT id,nombre,email,rol,activo FROM usuarios WHERE id=?`).get(usuarioId);
  if(!u)return res.status(404).json({error:'Usuario no encontrado.'});
  if(u.rol==='admin')return res.status(400).json({error:'Los administradores ya tienen acceso completo.'});
  if(Number(u.activo)===0)return res.status(409).json({error:'El usuario está bloqueado. Desbloquéalo antes de otorgar acceso temporal.'});
  const n=Math.floor(Number(dias));
  if(!Number.isFinite(n)||n<1||n>365)return res.status(400).json({error:'La duración debe estar entre 1 y 365 días.'});
  const tipos=['demo','cortesia','comercial','soporte'];
  const clase=tipos.includes(String(tipo||''))?String(tipo):'demo';
  const now=new Date(); const vence=addDays(now,n); const id=nuevoId('tmp');
  db.prepare(`UPDATE accesos_temporales_cultivo SET revocado_en=datetime('now') WHERE usuario_id=? AND revocado_en IS NULL AND datetime(vence_en)>datetime('now')`).run(u.id);
  db.prepare(`INSERT INTO accesos_temporales_cultivo(id,usuario_id,tipo,motivo,inicia_en,vence_en,creado_por,creado_en) VALUES(?,?,?,?,?,?,?,datetime('now'))`)
    .run(id,u.id,clase,String(motivo||'').trim()||null,now.toISOString(),vence,req.usuario.id);
  crearNotificacionUsuario({usuarioId:u.id,tipo:'acceso_temporal',titulo:'Acceso temporal habilitado',mensaje:`Dr. Plants Professional fue habilitado sin pago hasta ${new Date(vence).toLocaleDateString('es-CO')}.`,entidadTipo:'acceso_temporal',entidadId:id,prioridad:'alta'});
  audit({req,action:'otorgar_acceso_temporal',entityType:'usuario',entityId:u.id,metadata:{dias:n,tipo:clase,motivo:String(motivo||'').trim()||null,vence}});
  res.status(201).json({ok:true,id,usuarioId:u.id,tipo:clase,venceEn:vence});
});

router.delete('/admin/accesos-temporales/:id',requiereAuth,requiereRol('admin'),(req,res)=>{
  const a=db.prepare(`SELECT * FROM accesos_temporales_cultivo WHERE id=?`).get(req.params.id);
  if(!a)return res.status(404).json({error:'Acceso temporal no encontrado.'});
  if(!a.revocado_en)db.prepare(`UPDATE accesos_temporales_cultivo SET revocado_en=datetime('now') WHERE id=?`).run(a.id);
  crearNotificacionUsuario({usuarioId:a.usuario_id,tipo:'acceso_temporal',titulo:'Acceso temporal finalizado',mensaje:'El acceso temporal a Dr. Plants Professional fue finalizado por administración.',entidadTipo:'acceso_temporal',entidadId:a.id,prioridad:'normal'});
  audit({req,action:'revocar_acceso_temporal',entityType:'usuario',entityId:a.usuario_id,metadata:{accesoId:a.id}});
  res.json({ok:true});
});



// V8C.2 · Centro de Retención y Customer Success
router.get('/admin/cancelaciones',requiereAuth,requiereRol('admin'),(req,res)=>{
 const rows=db.prepare(`SELECT c.*,u.nombre,u.email,u.telefono,s.plan_id,s.periodicidad,s.estado AS suscripcion_estado,s.prueba_hasta,s.periodo_hasta,s.proximo_cobro,p.nombre plan_nombre,p.precio_mensual_cop,p.precio_anual_cop,
   (SELECT COALESCE(SUM(monto_cop),0) FROM cobros_suscripcion co WHERE co.suscripcion_id=s.id AND co.estado='APPROVED') total_pagado_cop,
   (SELECT COUNT(*) FROM acciones_retencion_suscripcion ar WHERE ar.solicitud_id=c.id) acciones_count
   FROM solicitudes_cancelacion_suscripcion c JOIN usuarios u ON u.id=c.usuario_id JOIN suscripciones s ON s.id=c.suscripcion_id JOIN planes_suscripcion p ON p.id=s.plan_id ORDER BY CASE c.estado WHEN 'pendiente_revision' THEN 1 WHEN 'pendiente_contacto' THEN 2 WHEN 'en_negociacion' THEN 3 ELSE 4 END,c.solicitado_en DESC`).all();
 res.json(rows);
});

router.get('/admin/customer-success-metricas',requiereAuth,requiereRol('admin'),(req,res)=>{
 const activos=Number(db.prepare(`SELECT COUNT(*) n FROM suscripciones WHERE estado IN ('trial','activa','morosa')`).get()?.n||0);
 const solicitudes=Number(db.prepare(`SELECT COUNT(*) n FROM solicitudes_cancelacion_suscripcion`).get()?.n||0);
 const canceladas=Number(db.prepare(`SELECT COUNT(*) n FROM solicitudes_cancelacion_suscripcion WHERE estado='aprobada_cancelacion'`).get()?.n||0);
 const retenidas=Number(db.prepare(`SELECT COUNT(*) n FROM solicitudes_cancelacion_suscripcion WHERE estado='retenida'`).get()?.n||0);
 const abiertas=Number(db.prepare(`SELECT COUNT(*) n FROM solicitudes_cancelacion_suscripcion WHERE estado IN ('pendiente_revision','pendiente_contacto','en_negociacion')`).get()?.n||0);
 const retencion=(retenidas+canceladas)>0?Math.round((retenidas/(retenidas+canceladas))*100):0;
 const motivos=db.prepare(`SELECT motivo,COUNT(*) cantidad FROM solicitudes_cancelacion_suscripcion GROUP BY motivo ORDER BY cantidad DESC`).all();
 res.json({activos,solicitudes,canceladas,retenidas,abiertas,retencion,motivos});
});

router.patch('/admin/cancelaciones/:id/estado',requiereAuth,requiereRol('admin'),(req,res)=>{
 const c=db.prepare(`SELECT * FROM solicitudes_cancelacion_suscripcion WHERE id=?`).get(req.params.id);if(!c)return res.status(404).json({error:'Solicitud no encontrada.'});
 const estados=['pendiente_revision','pendiente_contacto','en_negociacion'];const estado=String(req.body?.estado||'');if(!estados.includes(estado))return res.status(400).json({error:'Estado inválido.'});
 const nota=String(req.body?.nota||'').trim()||null;db.prepare(`UPDATE solicitudes_cancelacion_suscripcion SET estado=?,nota_admin=?,gestionado_por=?,actualizado_en=datetime('now') WHERE id=?`).run(estado,nota,req.usuario.id,c.id);
 registrarAccionRetencion({suscripcionId:c.suscripcion_id,solicitudId:c.id,usuarioId:c.usuario_id,tipo:'contacto',valor:estado,detalle:nota,creadoPor:req.usuario.id});
 crearNotificacionUsuario({usuarioId:c.usuario_id,tipo:'cancelacion_suscripcion',titulo:'Actualización de tu solicitud',mensaje:estado==='pendiente_contacto'?'Nuestro equipo se pondrá en contacto contigo para revisar tu solicitud.':'Tu solicitud está siendo revisada por nuestro equipo.',entidadTipo:'solicitud_cancelacion',entidadId:c.id});
 res.json({ok:true});
});

router.post('/admin/cancelaciones/:id/aprobar',requiereAuth,requiereRol('admin'),(req,res)=>{
 const c=db.prepare(`SELECT * FROM solicitudes_cancelacion_suscripcion WHERE id=?`).get(req.params.id);if(!c)return res.status(404).json({error:'Solicitud no encontrada.'});
 const nota=String(req.body?.nota||'').trim()||'Cancelación aprobada por administración.';
 const tx=db.transaction(()=>{db.prepare(`UPDATE solicitudes_cancelacion_suscripcion SET estado='aprobada_cancelacion',nota_admin=?,gestionado_por=?,actualizado_en=datetime('now'),resuelto_en=datetime('now') WHERE id=?`).run(nota,req.usuario.id,c.id);db.prepare(`UPDATE suscripciones SET cancelar_al_final=1,actualizado_en=datetime('now') WHERE id=?`).run(c.suscripcion_id);});tx();
 registrarAccionRetencion({suscripcionId:c.suscripcion_id,solicitudId:c.id,usuarioId:c.usuario_id,tipo:'nota',valor:'cancelacion_aprobada',detalle:nota,creadoPor:req.usuario.id});
 crearNotificacionUsuario({usuarioId:c.usuario_id,tipo:'cancelacion_aprobada',titulo:'Cancelación aprobada',mensaje:'Tu cancelación fue aprobada. Mantendrás acceso hasta finalizar el periodo vigente y no se generarán nuevas renovaciones.',entidadTipo:'suscripcion',entidadId:c.suscripcion_id,prioridad:'alta'});
 audit({req,action:'aprobar_cancelacion_suscripcion',entityType:'suscripcion',entityId:c.suscripcion_id,metadata:{solicitudId:c.id}});res.json({ok:true});
});

router.post('/admin/cancelaciones/:id/retener',requiereAuth,requiereRol('admin'),(req,res)=>{
 const c=db.prepare(`SELECT * FROM solicitudes_cancelacion_suscripcion WHERE id=?`).get(req.params.id);if(!c)return res.status(404).json({error:'Solicitud no encontrada.'});
 const nota=String(req.body?.nota||'').trim()||'El usuario decidió continuar.';db.prepare(`UPDATE solicitudes_cancelacion_suscripcion SET estado='retenida',nota_admin=?,gestionado_por=?,actualizado_en=datetime('now'),resuelto_en=datetime('now') WHERE id=?`).run(nota,req.usuario.id,c.id);db.prepare(`UPDATE suscripciones SET cancelar_al_final=0,actualizado_en=datetime('now') WHERE id=?`).run(c.suscripcion_id);
 registrarAccionRetencion({suscripcionId:c.suscripcion_id,solicitudId:c.id,usuarioId:c.usuario_id,tipo:'nota',valor:'retenida',detalle:nota,creadoPor:req.usuario.id});crearNotificacionUsuario({usuarioId:c.usuario_id,tipo:'suscripcion_retenida',titulo:'Tu suscripción continúa activa',mensaje:'Gracias por continuar con Dr. Plants. Tu renovación automática volvió a quedar activa.',entidadTipo:'suscripcion',entidadId:c.suscripcion_id});res.json({ok:true});
});

router.post('/admin/cancelaciones/:id/cortesia',requiereAuth,requiereRol('admin'),(req,res)=>{
 const c=db.prepare(`SELECT * FROM solicitudes_cancelacion_suscripcion WHERE id=?`).get(req.params.id);if(!c)return res.status(404).json({error:'Solicitud no encontrada.'});const dias=Math.floor(Number(req.body?.dias));if(![30,60,90,180].includes(dias))return res.status(400).json({error:'Cortesía permitida: 30, 60, 90 o 180 días.'});
 const s=db.prepare(`SELECT * FROM suscripciones WHERE id=?`).get(c.suscripcion_id);const base=s.proximo_cobro&&new Date(s.proximo_cobro)>new Date()?new Date(s.proximo_cobro):new Date();const nuevo=addDays(base,dias);db.prepare(`UPDATE suscripciones SET proximo_cobro=?,periodo_hasta=CASE WHEN periodo_hasta IS NULL THEN ? ELSE ? END,actualizado_en=datetime('now') WHERE id=?`).run(nuevo,nuevo,nuevo,s.id);registrarAccionRetencion({suscripcionId:s.id,solicitudId:c.id,usuarioId:c.usuario_id,tipo:'cortesia',valor:String(dias),detalle:String(req.body?.nota||''),creadoPor:req.usuario.id});db.prepare(`UPDATE solicitudes_cancelacion_suscripcion SET estado='en_negociacion',gestionado_por=?,actualizado_en=datetime('now') WHERE id=?`).run(req.usuario.id,c.id);crearNotificacionUsuario({usuarioId:c.usuario_id,tipo:'cortesia_suscripcion',titulo:'Cortesía aplicada',mensaje:`Administración agregó ${dias} días sin cobro a tu suscripción.`,entidadTipo:'suscripcion',entidadId:s.id});res.json({ok:true,proximoCobro:nuevo});
});

router.post('/admin/cancelaciones/:id/descuento',requiereAuth,requiereRol('admin'),(req,res)=>{
 const c=db.prepare(`SELECT * FROM solicitudes_cancelacion_suscripcion WHERE id=?`).get(req.params.id);if(!c)return res.status(404).json({error:'Solicitud no encontrada.'});const porcentaje=Math.floor(Number(req.body?.porcentaje));const meses=Math.floor(Number(req.body?.meses));if(![10,20,30,50].includes(porcentaje)||![1,3,6].includes(meses))return res.status(400).json({error:'Descuento o duración inválidos.'});const inicio=new Date(),fin=addMonths(inicio,meses),id=nuevoId('dsc');db.prepare(`UPDATE descuentos_suscripcion SET activo=0 WHERE suscripcion_id=? AND activo=1`).run(c.suscripcion_id);db.prepare(`INSERT INTO descuentos_suscripcion(id,suscripcion_id,porcentaje,inicia_en,vence_en,activo,creado_por,creado_en) VALUES(?,?,?,?,?,1,?,datetime('now'))`).run(id,c.suscripcion_id,porcentaje,inicio.toISOString(),fin,req.usuario.id);registrarAccionRetencion({suscripcionId:c.suscripcion_id,solicitudId:c.id,usuarioId:c.usuario_id,tipo:'descuento',valor:`${porcentaje}%/${meses}m`,detalle:String(req.body?.nota||''),creadoPor:req.usuario.id});db.prepare(`UPDATE solicitudes_cancelacion_suscripcion SET estado='en_negociacion',gestionado_por=?,actualizado_en=datetime('now') WHERE id=?`).run(req.usuario.id,c.id);crearNotificacionUsuario({usuarioId:c.usuario_id,tipo:'descuento_suscripcion',titulo:'Oferta especial aplicada',mensaje:`Tienes un ${porcentaje}% de descuento durante ${meses} mes(es).`,entidadTipo:'suscripcion',entidadId:c.suscripcion_id});res.json({ok:true,porcentaje,venceEn:fin});
});

router.post('/admin/cancelaciones/:id/cambiar-plan',requiereAuth,requiereRol('admin'),(req,res)=>{
 const c=db.prepare(`SELECT * FROM solicitudes_cancelacion_suscripcion WHERE id=?`).get(req.params.id);if(!c)return res.status(404).json({error:'Solicitud no encontrada.'});const plan=PLANES.find(x=>x.id===String(req.body?.planId||''));if(!plan)return res.status(400).json({error:'Plan inválido.'});const ha=hectareasUsuario(c.usuario_id,db.prepare('SELECT rol FROM usuarios WHERE id=?').get(c.usuario_id)?.rol||'productor');if(plan.maxHa!=null&&ha>plan.maxHa)return res.status(422).json({error:`El usuario administra ${ha.toFixed(1)} ha y supera el límite de ${plan.nombre}.`});db.prepare(`UPDATE suscripciones SET plan_id=?,max_ha_plan=?,cancelar_al_final=0,actualizado_en=datetime('now') WHERE id=?`).run(plan.id,plan.maxHa,c.suscripcion_id);registrarAccionRetencion({suscripcionId:c.suscripcion_id,solicitudId:c.id,usuarioId:c.usuario_id,tipo:'cambio_plan',valor:plan.id,detalle:String(req.body?.nota||''),creadoPor:req.usuario.id});db.prepare(`UPDATE solicitudes_cancelacion_suscripcion SET estado='en_negociacion',gestionado_por=?,actualizado_en=datetime('now') WHERE id=?`).run(req.usuario.id,c.id);crearNotificacionUsuario({usuarioId:c.usuario_id,tipo:'cambio_plan',titulo:'Plan actualizado',mensaje:`Tu suscripción fue cambiada al plan ${plan.nombre}.`,entidadTipo:'suscripcion',entidadId:c.suscripcion_id});res.json({ok:true,plan});
});

router.post('/admin/cancelaciones/:id/congelar',requiereAuth,requiereRol('admin'),(req,res)=>{
 const c=db.prepare(`SELECT * FROM solicitudes_cancelacion_suscripcion WHERE id=?`).get(req.params.id);if(!c)return res.status(404).json({error:'Solicitud no encontrada.'});const dias=Math.floor(Number(req.body?.dias));if(![30,60,90].includes(dias))return res.status(400).json({error:'Congelación permitida: 30, 60 o 90 días.'});const s=db.prepare(`SELECT * FROM suscripciones WHERE id=?`).get(c.suscripcion_id);const base=s.proximo_cobro?new Date(s.proximo_cobro):new Date();const proximo=addDays(base,dias);const hasta=s.periodo_hasta?addDays(new Date(s.periodo_hasta),dias):proximo;db.prepare(`UPDATE suscripciones SET proximo_cobro=?,periodo_hasta=?,actualizado_en=datetime('now') WHERE id=?`).run(proximo,hasta,s.id);registrarAccionRetencion({suscripcionId:s.id,solicitudId:c.id,usuarioId:c.usuario_id,tipo:'congelacion',valor:String(dias),detalle:String(req.body?.nota||''),creadoPor:req.usuario.id});db.prepare(`UPDATE solicitudes_cancelacion_suscripcion SET estado='en_negociacion',gestionado_por=?,actualizado_en=datetime('now') WHERE id=?`).run(req.usuario.id,c.id);crearNotificacionUsuario({usuarioId:c.usuario_id,tipo:'suscripcion_congelada',titulo:'Suscripción congelada',mensaje:`Tu próximo cobro fue aplazado ${dias} días. Tus datos permanecen guardados.`,entidadTipo:'suscripcion',entidadId:s.id});res.json({ok:true,proximoCobro:proximo});
});

router.get('/admin/cancelaciones/:id/historial',requiereAuth,requiereRol('admin'),(req,res)=>{const c=db.prepare(`SELECT * FROM solicitudes_cancelacion_suscripcion WHERE id=?`).get(req.params.id);if(!c)return res.status(404).json({error:'Solicitud no encontrada.'});res.json(db.prepare(`SELECT a.*,u.nombre admin_nombre FROM acciones_retencion_suscripcion a LEFT JOIN usuarios u ON u.id=a.creado_por WHERE a.solicitud_id=? ORDER BY a.creado_en DESC`).all(c.id));});

module.exports={router,procesarRenovaciones};
