const express=require('express');
const db=require('../db');
const {nuevoId,requiereAuth}=require('../auth');
const {puedeDemo,rolEmpresarial,modoDemo,setModoDemo,esEjecutivoComercial}=require('../enterprise');
const router=express.Router();
router.use(requiereAuth);

const ESCENARIOS={
 cafe:{nombre:'Café de montaña',cultivo:'Café',variedad:'Castillo',region:'Caldas',ciudad:'Manizales',pais:'Colombia',rend:1800,precio:14500},
 cana:{nombre:'Caña tecnificada',cultivo:'Caña de azúcar',variedad:'CC 01-1940',region:'Valle del Cauca',ciudad:'Palmira',pais:'Colombia',rend:105000,precio:220},
 cacao:{nombre:'Cacao productivo',cultivo:'Cacao',variedad:'ICS 95',region:'Santander',ciudad:'San Vicente de Chucurí',pais:'Colombia',rend:1400,precio:12000},
 arroz:{nombre:'Arroz tecnificado',cultivo:'Arroz',variedad:'Fedearroz 2000',region:'Tolima',ciudad:'Espinal',pais:'Colombia',rend:6200,precio:1850},
 maiz:{nombre:'Maíz comercial',cultivo:'Maíz',variedad:'Híbrido amarillo',region:'Córdoba',ciudad:'Montería',pais:'Colombia',rend:7800,precio:1550},
 banano:{nombre:'Banano exportación',cultivo:'Banano',variedad:'Cavendish',region:'Antioquia',ciudad:'Apartadó',pais:'Colombia',rend:42000,precio:1650},
 aguacate:{nombre:'Aguacate Hass',cultivo:'Aguacate',variedad:'Hass',region:'Antioquia',ciudad:'Sonsón',pais:'Colombia',rend:12500,precio:6500},
 palma:{nombre:'Palma productiva',cultivo:'Palma de aceite',variedad:'Híbrido OxG',region:'Meta',ciudad:'Villavicencio',pais:'Colombia',rend:26000,precio:780},
};
function validar(req,res){if(!puedeDemo(req.usuario)) {res.status(403).json({error:'Tu cuenta no tiene permisos de demostración.'});return false;} return true;}
router.get('/status',(req,res)=>res.json({puedeDemo:puedeDemo(req.usuario),rolEmpresarial:rolEmpresarial(req.usuario.id),modoDemo:modoDemo(req.usuario.id),escenarios:Object.entries(ESCENARIOS).map(([id,e])=>({id,nombre:e.nombre,cultivo:e.cultivo}))}));
router.put('/modo',(req,res)=>{if(!validar(req,res))return;setModoDemo(req.usuario.id,req.body?.activo!==false);res.json({ok:true,modoDemo:modoDemo(req.usuario.id)});});
router.delete('/datos',(req,res)=>{if(!validar(req,res))return;const tx=db.transaction(()=>{const fincas=db.prepare('SELECT id FROM fincas WHERE productor_id=? AND es_demo=1').all(req.usuario.id);for(const f of fincas)db.prepare('DELETE FROM fincas WHERE id=?').run(f.id);db.prepare('DELETE FROM clientes_agronomicos WHERE agronomo_id=? AND es_demo=1').run(req.usuario.id);db.prepare('INSERT INTO demo_eventos(id,usuario_id,tipo) VALUES(?,?,?)').run(nuevoId('demo'),req.usuario.id,'reset');});tx();res.json({ok:true});});
router.post('/generar',(req,res)=>{
 if(!validar(req,res))return;
 const key=String(req.body?.escenario||'cafe'); const base=ESCENARIOS[key]||ESCENARIOS.cafe;
 const hectareas=Math.min(Math.max(Number(req.body?.hectareas)||50,1),3000);
 const pais=String(req.body?.pais||base.pais); const region=String(req.body?.region||base.region); const ciudad=String(req.body?.ciudad||base.ciudad);
 const clienteNombre=String(req.body?.clienteNombre||'Cliente demostración').slice(0,120); const fincaNombre=String(req.body?.fincaNombre||base.nombre).slice(0,120); const problema=String(req.body?.problema||'Optimizar productividad y rentabilidad').slice(0,500);
 const tx=db.transaction(()=>{
   const cli=nuevoId('cli');db.prepare(`INSERT INTO clientes_agronomicos(id,agronomo_id,nombre,pais,region,ciudad,notas,es_demo) VALUES(?,?,?,?,?,?,?,1)`).run(cli,req.usuario.id,clienteNombre,pais,region,ciudad,`Escenario generado para demostración comercial. Necesidad principal: ${problema}`);
   const fid=nuevoId('finca');db.prepare(`INSERT INTO fincas(id,productor_id,nombre,ubicacion_id,pais,region,ciudad,cliente_id,gestor_id,relacion_tipo,cliente_nombre_cache,es_demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`).run(fid,req.usuario.id,fincaNombre,`${ciudad}, ${region}`,pais,region,ciudad,cli,req.usuario.id,'demo',clienteNombre);
   const partes=hectareas>120?3:2; const lotes=[];
   for(let i=0;i<partes;i++){
     const area=Number((hectareas/partes).toFixed(2)); const lid=nuevoId('lote'); const salud=[92,84,76][i]||88;
     db.prepare(`INSERT INTO lotes(id,finca_id,nombre,cultivo_id,cultivo_nombre,variedad,area_ha,fecha_siembra,salud_pct,rendimiento_objetivo_ha,precio_objetivo,unidad_precio,moneda_proyeccion,etapa_fenologica,es_demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(lid,fid,`Lote ${i+1}`,base.cultivo.toLowerCase().replace(/\s+/g,'-'),base.cultivo,base.variedad,area,'2025-03-15',salud,base.rend,base.precio,'kg','COP',i===0?'Producción':'Desarrollo');
     db.prepare(`INSERT INTO aplicaciones(id,lote_id,tipo,producto,fecha,cantidad,costo_cop,creado_por) VALUES(?,?,?,?,?,?,?,?)`).run(nuevoId('apl'),lid,'Fertilización','Plan nutricional demo','2026-08-01','Según recomendación',Math.round(area*180000),req.usuario.id);
     db.prepare(`INSERT INTO analisis_laboratorio(id,lote_id,tipo,fecha,resultado,creado_por) VALUES(?,?,?,?,?,?)`).run(nuevoId('ana'),lid,'Suelo','2026-07-20','pH 5.6 · MO 3.8% · condición demostrativa',req.usuario.id);
     db.prepare(`INSERT INTO costos_operativos(id,lote_id,categoria,descripcion,fecha,costo_cop,creado_por) VALUES(?,?,?,?,?,?,?)`).run(nuevoId('cos'),lid,'Manejo','Costos acumulados demo','2026-08-01',Math.round(area*650000),req.usuario.id);
     lotes.push(lid);
   }
   db.prepare(`INSERT INTO demo_eventos(id,usuario_id,tipo,escenario,detalle_json) VALUES(?,?,?,?,?)`).run(nuevoId('demo'),req.usuario.id,'generar',key,JSON.stringify({hectareas,pais,region,ciudad,clienteNombre,fincaNombre,problema,lotes:lotes.length}));
   return {fincaId:fid,clienteId:cli,lotes:lotes.length,hectareas,escenario:base.nombre};
 });
 try{setModoDemo(req.usuario.id,true);res.status(201).json(tx());}catch(e){console.error('demo generar',e);res.status(500).json({error:'No se pudo generar el escenario de demostración.'});}
});

router.post('/generar-completa',(req,res)=>{
 if(!validar(req,res))return;
 const soloSuper=req.usuario.rol==='admin'; if(!soloSuper) return res.status(403).json({error:'La biblioteca demo completa solo puede generarla un administrador.'});
 const keys=Object.keys(ESCENARIOS); const tx=db.transaction(()=>{
   // Evita duplicar una biblioteca completa accidentalmente.
   const existentes=db.prepare('SELECT COUNT(*) n FROM fincas WHERE productor_id=? AND es_demo=1').get(req.usuario.id).n;
   if(existentes>=100) return {yaExistia:true,clientes:50,fincas:existentes,lotes:db.prepare(`SELECT COUNT(*) n FROM lotes l JOIN fincas f ON f.id=l.finca_id WHERE f.productor_id=? AND f.es_demo=1 AND l.es_demo=1`).get(req.usuario.id).n};
   const clientes=[];
   for(let i=0;i<50;i++){const e=ESCENARIOS[keys[i%keys.length]],id=nuevoId('cli');db.prepare(`INSERT INTO clientes_agronomicos(id,agronomo_id,nombre,pais,region,ciudad,notas,es_demo) VALUES(?,?,?,?,?,?,?,1)`).run(id,req.usuario.id,`Cliente Demo ${String(i+1).padStart(2,'0')}`,e.pais,e.region,e.ciudad,'Portafolio comercial Dr. Plants');clientes.push(id);}
   let loteCount=0;
   for(let i=0;i<120;i++){const e=ESCENARIOS[keys[i%keys.length]],cid=clientes[i%clientes.length],fid=nuevoId('finca');db.prepare(`INSERT INTO fincas(id,productor_id,nombre,ubicacion_id,pais,region,ciudad,cliente_id,gestor_id,relacion_tipo,cliente_nombre_cache,es_demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)`).run(fid,req.usuario.id,`Finca Demo ${String(i+1).padStart(3,'0')}`,`${e.ciudad}, ${e.region}`,e.pais,e.region,e.ciudad,cid,req.usuario.id,'demo',`Cliente Demo ${String((i%50)+1).padStart(2,'0')}`);
     const n=i<110?3:2; for(let j=0;j<n;j++){if(loteCount>=350)break;const lid=nuevoId('lote'),area=Number((8+(i%17)*2.5+(j*3)).toFixed(2));db.prepare(`INSERT INTO lotes(id,finca_id,nombre,cultivo_id,cultivo_nombre,variedad,area_ha,fecha_siembra,salud_pct,rendimiento_objetivo_ha,precio_objetivo,unidad_precio,moneda_proyeccion,etapa_fenologica,es_demo) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`).run(lid,fid,`Lote ${j+1}`,e.cultivo.toLowerCase().replace(/\s+/g,'-'),e.cultivo,e.variedad,area,'2025-02-15',70+((i+j)%28),e.rend,e.precio,'kg','COP',['Desarrollo','Floración','Producción'][j%3]);db.prepare(`INSERT INTO aplicaciones(id,lote_id,tipo,producto,fecha,cantidad,costo_cop,creado_por) VALUES(?,?,?,?,?,?,?,?)`).run(nuevoId('apl'),lid,'Fertilización','Programa técnico demo','2026-08-01','Dosis demostrativa',Math.round(area*150000),req.usuario.id);db.prepare(`INSERT INTO analisis_laboratorio(id,lote_id,tipo,fecha,resultado,creado_por) VALUES(?,?,?,?,?,?)`).run(nuevoId('ana'),lid,'Suelo','2026-07-15',`pH ${(5.2+((i+j)%10)/10).toFixed(1)} · MO ${(2.8+((i+j)%8)/10).toFixed(1)}% · escenario demo`,req.usuario.id);db.prepare(`INSERT INTO costos_operativos(id,lote_id,categoria,descripcion,fecha,costo_cop,creado_por) VALUES(?,?,?,?,?,?,?)`).run(nuevoId('cos'),lid,'Operación','Costo acumulado demostrativo','2026-08-01',Math.round(area*580000),req.usuario.id);loteCount++;}
   }
   db.prepare(`INSERT INTO demo_eventos(id,usuario_id,tipo,escenario,detalle_json) VALUES(?,?,?,?,?)`).run(nuevoId('demo'),req.usuario.id,'biblioteca_completa','multi',JSON.stringify({clientes:50,fincas:120,lotes:loteCount}));return {clientes:50,fincas:120,lotes:loteCount};
 });
 try{setModoDemo(req.usuario.id,true);res.status(201).json(tx());}catch(e){console.error('demo completa',e);res.status(500).json({error:'No se pudo generar la biblioteca demo completa.'});}
});

module.exports=router;
