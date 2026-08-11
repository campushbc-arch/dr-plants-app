const db = require('./db');

const PLANES = [
  { id:'starter', nombre:'Starter', minHa:1, maxHa:50, mensual:50000, anual:420000 },
  { id:'professional', nombre:'Professional', minHa:51, maxHa:200, mensual:76000, anual:638400 },
  { id:'business', nombre:'Business', minHa:201, maxHa:800, mensual:120000, anual:1008000 },
  { id:'enterprise', nombre:'Enterprise', minHa:801, maxHa:1600, mensual:240000, anual:2016000 },
  { id:'corporate', nombre:'Corporate', minHa:1601, maxHa:null, mensual:460000, anual:3864000 }
];

function hectareasUsuario(usuarioId, rol) {
  if (rol === 'agronomo') {
    return Number(db.prepare(`SELECT COALESCE(SUM(l.area_ha),0) ha FROM lotes l JOIN fincas f ON f.id=l.finca_id WHERE f.gestor_id=? AND f.eliminado_en IS NULL AND l.eliminado_en IS NULL`).get(usuarioId)?.ha || 0);
  }
  return Number(db.prepare(`SELECT COALESCE(SUM(l.area_ha),0) ha FROM lotes l JOIN fincas f ON f.id=l.finca_id WHERE f.productor_id=? AND f.eliminado_en IS NULL AND l.eliminado_en IS NULL`).get(usuarioId)?.ha || 0);
}
function planPorHectareas(ha){
  const n=Math.max(1,Number(ha)||1);
  return PLANES.find(p=>n>=p.minHa && (p.maxHa==null || n<=p.maxHa)) || PLANES[PLANES.length-1];
}
function suscripcionActual(usuarioId){
  return db.prepare(`SELECT s.*,p.nombre plan_nombre,p.max_ha,p.precio_mensual_cop,p.precio_anual_cop FROM suscripciones s JOIN planes_suscripcion p ON p.id=s.plan_id WHERE s.usuario_id=? ORDER BY s.creado_en DESC LIMIT 1`).get(usuarioId);
}
function estadoAcceso(usuarioId, rol){
  if(rol==='admin') return {permitido:true,estado:'admin',hectareas:0};
  const ha=hectareasUsuario(usuarioId,rol);
  const recomendado=planPorHectareas(ha);
  const s=suscripcionActual(usuarioId);
  const ahora=Date.now();
  if(!s) return {permitido:false,estado:'sin_suscripcion',hectareas:ha,planRecomendado:recomendado};
  const trial= s.estado==='trial' && s.prueba_hasta && new Date(s.prueba_hasta).getTime()>ahora;
  const activa= s.estado==='activa' && (!s.periodo_hasta || new Date(s.periodo_hasta).getTime()>ahora);
  const dentro = s.max_ha_plan==null || ha<=Number(s.max_ha_plan);
  return {permitido:Boolean((trial||activa) && dentro),estado:s.estado,hectareas:ha,suscripcion:s,planRecomendado:recomendado,excedePlan:!dentro};
}
function requiereSuscripcionCultivos(req,res,next){
  const e=estadoAcceso(req.usuario.id,req.usuario.rol);
  if(e.permitido){req.suscripcion=e;return next();}
  return res.status(402).json({code:'SUBSCRIPTION_REQUIRED',error:e.excedePlan?'Superaste las hectáreas incluidas en tu plan. Actualiza tu suscripción para registrar o administrar más área.':'Esta sección requiere una suscripción activa o una prueba gratuita vigente.',...e});
}
module.exports={PLANES,hectareasUsuario,planPorHectareas,suscripcionActual,estadoAcceso,requiereSuscripcionCultivos};
