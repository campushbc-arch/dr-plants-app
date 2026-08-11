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

router.post('/cancelar',requiereAuth,(req,res)=>{const s=db.prepare(`SELECT * FROM suscripciones WHERE usuario_id=? AND estado IN ('trial','activa','morosa') ORDER BY creado_en DESC LIMIT 1`).get(req.usuario.id);if(!s)return res.status(404).json({error:'No tienes una suscripción cancelable.'});db.prepare(`UPDATE suscripciones SET cancelar_al_final=1,actualizado_en=datetime('now') WHERE id=?`).run(s.id);res.json({ok:true,mensaje:'La suscripción no se renovará al finalizar el periodo vigente.'});});

async function cobrarSuscripcion(s){
 const plan=PLANES.find(p=>p.id===s.plan_id);if(!plan)throw new Error('Plan no encontrado');const monto=s.periodicidad==='anual'?plan.anual:plan.mensual;const fuente=db.prepare('SELECT * FROM fuentes_pago_suscripcion WHERE id=?').get(s.fuente_pago_id);const u=db.prepare('SELECT * FROM usuarios WHERE id=?').get(s.usuario_id);if(!fuente||!u)throw new Error('Fuente o usuario no encontrado');
 const ref=`DRP-SUB-${Date.now()}-${Math.random().toString(16).slice(2,10)}`;const body={amount_in_cents:monto*100,currency:'COP',customer_email:u.email,reference:ref,payment_source_id:Number(fuente.wompi_payment_source_id),recurrent:true,payment_method:{installments:1}};
 const r=await wompi('/transactions',{private:true,method:'POST',body});const trx=r.data||r;const id=nuevoId('chg');db.prepare(`INSERT INTO cobros_suscripcion(id,suscripcion_id,usuario_id,referencia,monto_cop,estado,wompi_transaccion_id,respuesta_wompi,creado_en) VALUES(?,?,?,?,?,?,?,?,datetime('now'))`).run(id,s.id,s.usuario_id,ref,monto,String(trx.status||'PENDING').toUpperCase(),trx.id||null,JSON.stringify(trx));return {id,trx,monto};
}

async function procesarRenovaciones(){
 const now=new Date().toISOString();const pendientes=db.prepare(`SELECT * FROM suscripciones WHERE estado IN ('trial','activa','morosa') AND proximo_cobro IS NOT NULL AND proximo_cobro<=?`).all(now);
 for(const s of pendientes){try{
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

module.exports={router,procesarRenovaciones};
