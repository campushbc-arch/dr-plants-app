const express = require('express');
const db = require('../db');
const { nuevoId, requiereAuth, requiereRol } = require('../auth');
const { crearNotificacionUsuario } = require('../notificaciones');
const { firmarToken } = require('../auth');
const { rolEmpresarial, esSuperAdmin } = require('../enterprise');
const { audit } = require('../audit');

const router = express.Router();
router.use(requiereAuth, requiereRol('admin'));


// GET /api/admin/database-status — comprobación segura de conexión y persistencia
router.get('/database-status', (req, res) => {
  const integrity = db.pragma('integrity_check', { simple: true });
  const tablas = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map(f => f.name);
  const usuarios = db.prepare('SELECT COUNT(*) AS total FROM usuarios').get().total;
  const ultimoUsuario = db.prepare(`
    SELECT id, nombre, email, rol, creado_en
    FROM usuarios ORDER BY creado_en DESC LIMIT 1
  `).get() || null;

  res.json({
    ok: integrity === 'ok',
    motor: 'sqlite',
    integrity,
    tablas,
    usuarios,
    ultimoUsuario
  });
});

// GET /api/admin/usuarios?estado=todos|activos|bloqueados&buscar=texto
router.get('/usuarios', (req, res) => {
  const estado = String(req.query.estado || 'todos');
  const buscar = `%${String(req.query.buscar || '').trim().toLowerCase()}%`;
  const condiciones = ["rol <> 'admin'"];
  const params = [];
  if (estado === 'activos') condiciones.push('activo = 1');
  if (estado === 'bloqueados') condiciones.push('activo = 0');
  if (buscar !== '%%') {
    condiciones.push('(lower(nombre) LIKE ? OR lower(email) LIKE ? OR lower(telefono) LIKE ?)');
    params.push(buscar, buscar, buscar);
  }
  const usuarios = db.prepare(`
    SELECT id, nombre, email, telefono, rol, tipo_productor, pais, region,
           tarjeta_profesional, especialidad, estado_agronomo, activo,
           bloqueado_en, motivo_bloqueo, creado_en,
           (SELECT a.vence_en FROM accesos_temporales_cultivo a
              WHERE a.usuario_id=usuarios.id AND a.revocado_en IS NULL AND datetime(a.vence_en)>datetime('now')
              ORDER BY datetime(a.vence_en) DESC LIMIT 1) AS acceso_temp_vence,
           (SELECT a.tipo FROM accesos_temporales_cultivo a
              WHERE a.usuario_id=usuarios.id AND a.revocado_en IS NULL AND datetime(a.vence_en)>datetime('now')
              ORDER BY datetime(a.vence_en) DESC LIMIT 1) AS acceso_temp_tipo,
           (SELECT p.rol FROM permisos_empresariales p WHERE p.usuario_id=usuarios.id AND p.activo=1) AS rol_empresarial
    FROM usuarios
    WHERE ${condiciones.join(' AND ')}
    ORDER BY activo ASC, creado_en DESC
  `).all(...params);
  res.json(usuarios);
});

// GET /api/admin/usuarios/:id/expediente — datos y archivos cargados por el usuario
router.get('/usuarios/:id/expediente', (req, res) => {
  const usuario = db.prepare(`
    SELECT id, nombre, email, telefono, rol, tipo_productor, pais, region,
           tarjeta_profesional, especialidad, estado_agronomo, activo,
           bloqueado_en, motivo_bloqueo, creado_en, foto_perfil
    FROM usuarios WHERE id = ? AND rol <> 'admin'
  `).get(req.params.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });
  const archivos = db.prepare(`
    SELECT a.id, a.tipo, a.nombre_original AS nombre, a.mime_type, a.tamano_bytes, a.creado_en,
      (SELECT v.estado FROM archivo_verificaciones v WHERE v.archivo_id=a.id ORDER BY v.creado_en DESC LIMIT 1) AS estado_verificacion,
      (SELECT v.observacion FROM archivo_verificaciones v WHERE v.archivo_id=a.id ORDER BY v.creado_en DESC LIMIT 1) AS observacion_verificacion
    FROM archivos_usuario a
    WHERE a.usuario_id = ?
    ORDER BY a.creado_en DESC
  `).all(usuario.id).map(a => ({ ...a, estado_verificacion: a.estado_verificacion || 'pendiente', url: `/api/admin/archivos/${a.id}` }));
  res.json({ usuario, archivos });
});

// PATCH /api/admin/usuarios/:id/acceso  { activo: true|false, motivo?: string }
router.patch('/usuarios/:id/acceso', (req, res) => {
  const activo = req.body.activo;
  const motivo = String(req.body.motivo || '').trim();
  if (typeof activo !== 'boolean') {
    return res.status(400).json({ error: 'activo debe ser true o false.' });
  }
  const usuario = db.prepare('SELECT id, nombre, email, rol FROM usuarios WHERE id = ?').get(req.params.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (usuario.rol === 'admin') {
    return res.status(403).json({ error: 'No se puede bloquear una cuenta administradora desde este módulo.' });
  }
  db.prepare(`
    UPDATE usuarios
    SET activo = ?,
        bloqueado_en = CASE WHEN ? = 0 THEN datetime('now') ELSE NULL END,
        motivo_bloqueo = CASE WHEN ? = 0 THEN ? ELSE NULL END
    WHERE id = ?
  `).run(activo ? 1 : 0, activo ? 1 : 0, activo ? 1 : 0, motivo || null, usuario.id);
  res.json(db.prepare(`
    SELECT id, nombre, email, rol, activo, bloqueado_en, motivo_bloqueo
    FROM usuarios WHERE id = ?
  `).get(usuario.id));
});

// GET /api/admin/agronomos?estado=pendiente
router.get('/agronomos', (req, res) => {
  const estado = req.query.estado || 'pendiente';
  const filas = db.prepare(`
    SELECT u.id, u.nombre, u.email, u.telefono, u.tarjeta_profesional, u.especialidad, u.estado_agronomo, u.creado_en,
      (SELECT a.id FROM archivos_usuario a WHERE a.usuario_id=u.id AND a.tipo='documento_identidad' ORDER BY a.creado_en DESC LIMIT 1) AS documento_identidad_archivo_id,
      (SELECT a.id FROM archivos_usuario a WHERE a.usuario_id=u.id AND a.tipo='tarjeta_profesional' ORDER BY a.creado_en DESC LIMIT 1) AS tarjeta_profesional_archivo_id
    FROM usuarios u WHERE u.rol IN ('agronomo','agronomo_pendiente') AND u.estado_agronomo = ?
    ORDER BY creado_en DESC
  `).all(estado);
  res.json(filas);
});

// PATCH /api/admin/agronomos/:id  { accion: 'aprobar' | 'rechazar' }
router.patch('/agronomos/:id', (req, res) => {
  const { accion } = req.body;
  if (!['aprobar', 'rechazar'].includes(accion)) {
    return res.status(400).json({ error: "accion debe ser 'aprobar' o 'rechazar'." });
  }
  const usuario = db.prepare("SELECT * FROM usuarios WHERE id = ? AND rol IN ('agronomo','agronomo_pendiente')").get(req.params.id);
  if (!usuario) return res.status(404).json({ error: 'Solicitud de agrónomo no encontrada.' });

  if (accion === 'aprobar') {
    const documentos = db.prepare(`SELECT tipo FROM archivos_usuario WHERE usuario_id=? AND tipo IN ('documento_identidad','tarjeta_profesional')`).all(usuario.id).map(x=>x.tipo);
    if (!documentos.includes('documento_identidad') || !documentos.includes('tarjeta_profesional')) {
      return res.status(400).json({ error: 'No se puede aprobar: faltan el documento de identidad o la tarjeta profesional.' });
    }
  }
  const nuevoEstado = accion === 'aprobar' ? 'aprobado' : 'rechazado';
  const nuevoRol = accion === 'aprobar' ? 'agronomo' : 'agronomo_pendiente';
  db.prepare(`UPDATE usuarios SET estado_agronomo = ?, rol = ?,
    aprobado_en = CASE WHEN ? = 'aprobado' THEN datetime('now') ELSE aprobado_en END,
    rechazado_en = CASE WHEN ? = 'rechazado' THEN datetime('now') ELSE rechazado_en END
    WHERE id = ?`).run(nuevoEstado, nuevoRol, nuevoEstado, nuevoEstado, usuario.id);
  crearNotificacionUsuario({ usuarioId:usuario.id, tipo:'estado_agronomo', titulo:accion==='aprobar'?'Perfil profesional aprobado':'Perfil profesional rechazado', mensaje:accion==='aprobar'?'Tu perfil de agrónomo fue aprobado. Ya puedes acceder a las funciones profesionales habilitadas.':'Tu solicitud de agrónomo fue rechazada. Revisa tus documentos o comunícate con soporte.', entidadTipo:'usuario', entidadId:usuario.id, urlDestino:'perfil', prioridad:'alta' });
  res.json(db.prepare('SELECT id, nombre, rol, estado_agronomo FROM usuarios WHERE id = ?').get(usuario.id));
});

// POST /api/admin/agronomos/:id/asignar-finca  { fincaId }
router.post('/agronomos/:id/asignar-finca', (req, res) => {
  const { fincaId } = req.body;
  const agronomo = db.prepare("SELECT * FROM usuarios WHERE id = ? AND rol = 'agronomo'").get(req.params.id);
  if (!agronomo) return res.status(404).json({ error: 'Agrónomo no encontrado o no aprobado aún.' });
  const finca = db.prepare('SELECT * FROM fincas WHERE id = ?').get(fincaId);
  if (!finca) return res.status(404).json({ error: 'Finca no encontrada.' });

  db.prepare('INSERT OR IGNORE INTO agronomo_asignacion (id, finca_id, agronomo_id) VALUES (?, ?, ?)')
    .run(nuevoId('asig'), fincaId, agronomo.id);
  res.status(201).json({ ok: true });
});

// GET /api/admin/archivos/:id — permite al administrador revisar documentos de solicitudes
router.get('/archivos/:id', (req, res) => {
  const fs = require('fs');
  const archivo = db.prepare('SELECT * FROM archivos_usuario WHERE id=?').get(req.params.id);
  if (!archivo || !fs.existsSync(archivo.ruta)) return res.status(404).json({ error: 'Documento no encontrado.' });
  res.type(archivo.mime_type).sendFile(archivo.ruta);
});

// --- Catálogo de productos y categorías ---

router.get('/categorias', (req, res) => {
  res.json(db.prepare('SELECT * FROM categorias').all());
});

router.post('/categorias', (req, res) => {
  const { id, label } = req.body;
  if (!id || !label) return res.status(400).json({ error: 'id y label son obligatorios.' });
  db.prepare('INSERT OR IGNORE INTO categorias (id, label) VALUES (?, ?)').run(id, label);
  res.status(201).json({ id, label });
});

router.post('/productos', (req, res) => {
  const { nombre, formula, categoriaId, tag, descripcion, precioCop, unidad, icono, destacado } = req.body;
  if (!nombre || !categoriaId || !precioCop) {
    return res.status(400).json({ error: 'nombre, categoriaId y precioCop son obligatorios.' });
  }
  const id = nuevoId('prod');
  db.prepare(`
    INSERT INTO productos (id, nombre, formula, categoria_id, tag, descripcion, precio_cop, unidad, icono, destacado)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(id, nombre, formula || null, categoriaId, tag || null, descripcion || null, precioCop, unidad || null, icono || 'ti-flask', destacado ? 1 : 0);
  res.status(201).json(db.prepare('SELECT * FROM productos WHERE id = ?').get(id));
});

router.patch('/productos/:id', (req, res) => {
  const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(req.params.id);
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado.' });
  const { precioCop } = req.body;
  if (precioCop != null) {
    db.prepare('UPDATE productos SET precio_cop = ? WHERE id = ?').run(precioCop, producto.id);
  }
  res.json(db.prepare('SELECT * FROM productos WHERE id = ?').get(producto.id));
});

router.delete('/productos/:id', (req, res) => {
  db.prepare('DELETE FROM productos WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// --- Vistas del administrador: todo lo que los usuarios envían desde la app ---

// GET /api/admin/pedidos — todas las compras hechas en AgroTienda, de cualquier usuario
router.get('/pedidos', (req, res) => {
  const pedidos = db.prepare(`
    SELECT p.*, u.nombre AS usuario_nombre, u.email AS usuario_email
    FROM pedidos p JOIN usuarios u ON u.id = p.usuario_id
    ORDER BY p.fecha DESC
  `).all();
  const items = db.prepare('SELECT * FROM pedido_items');
  res.json(pedidos.map(p => ({
    ...p,
    items: db.prepare(`
      SELECT pi.*, pr.nombre AS producto_nombre
      FROM pedido_items pi JOIN productos pr ON pr.id = pi.producto_id
      WHERE pi.pedido_id = ?
    `).all(p.id)
  })));
});

// GET /api/admin/solicitudes/laboratorio — todas las solicitudes de análisis pendientes
router.get('/solicitudes/laboratorio', (req, res) => {
  const estado = req.query.estado || 'pendiente';
  res.json(db.prepare(`
    SELECT s.*, u.nombre AS usuario_nombre, u.email AS usuario_email, u.telefono AS usuario_telefono
    FROM solicitudes_laboratorio s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.estado = ? ORDER BY s.fecha DESC
  `).all(estado));
});

// PATCH /api/admin/solicitudes/laboratorio/:id  { estado }
router.patch('/solicitudes/laboratorio/:id', (req, res) => {
  const { estado, retroalimentacion } = req.body || {};
  if (!['pendiente', 'en_proceso', 'completado', 'cancelado'].includes(estado)) return res.status(400).json({ error: 'estado inválido.' });
  const solicitud = db.prepare('SELECT * FROM solicitudes_laboratorio WHERE id=?').get(req.params.id);
  if (!solicitud) return res.status(404).json({ error:'Solicitud no encontrada.' });
  db.prepare('UPDATE solicitudes_laboratorio SET estado=?, retroalimentacion=COALESCE(?,retroalimentacion) WHERE id=?').run(estado, String(retroalimentacion||'').trim()||null, solicitud.id);
  const etiquetas={pendiente:'Pendiente',en_proceso:'En proceso',completado:'Completado',cancelado:'Cancelado'};
  const extra=String(retroalimentacion||'').trim();
  crearNotificacionUsuario({ usuarioId:solicitud.usuario_id, tipo:'estado_laboratorio', titulo:`Laboratorio: ${etiquetas[estado]}`, mensaje:`Tu solicitud de ${solicitud.tipo_analisis} cambió a ${etiquetas[estado]}.${extra?' Retroalimentación: '+extra:''}`, entidadTipo:'solicitud_laboratorio', entidadId:solicitud.id, urlDestino:'laboratorio', prioridad:estado==='completado'?'alta':'normal' });
  res.json(db.prepare('SELECT * FROM solicitudes_laboratorio WHERE id = ?').get(solicitud.id));
});

// GET /api/admin/solicitudes/teleconsulta — todas las solicitudes de teleconsulta pendientes
router.get('/solicitudes/teleconsulta', (req, res) => {
  const estado = req.query.estado || 'pendiente';
  res.json(db.prepare(`
    SELECT s.*, u.nombre AS usuario_nombre, u.email AS usuario_email, u.telefono AS usuario_telefono
    FROM solicitudes_teleconsulta s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.estado = ? ORDER BY s.fecha_solicitud DESC
  `).all(estado));
});

// PATCH /api/admin/solicitudes/teleconsulta/:id  { estado }
router.patch('/solicitudes/teleconsulta/:id', (req, res) => {
  const { estado, fechaCita, horaCita, enlaceCita, profesionalAsignado, retroalimentacion } = req.body || {};
  if (!['pendiente', 'agendada', 'atendida', 'cancelada'].includes(estado)) return res.status(400).json({ error: 'estado inválido.' });
  const solicitud = db.prepare('SELECT * FROM solicitudes_teleconsulta WHERE id=?').get(req.params.id);
  if (!solicitud) return res.status(404).json({ error:'Solicitud no encontrada.' });
  if (estado==='agendada' && (!fechaCita || !horaCita)) return res.status(400).json({ error:'Para agendar debes indicar fecha y hora.' });
  db.prepare(`UPDATE solicitudes_teleconsulta SET estado=?, fecha_cita=COALESCE(?,fecha_cita), hora_cita=COALESCE(?,hora_cita), enlace_cita=COALESCE(?,enlace_cita), profesional_asignado=COALESCE(?,profesional_asignado), retroalimentacion=COALESCE(?,retroalimentacion) WHERE id=?`)
    .run(estado, fechaCita||null, horaCita||null, enlaceCita||null, profesionalAsignado||null, String(retroalimentacion||'').trim()||null, solicitud.id);
  let mensaje=`Tu consulta cambió a estado ${estado}.`;
  if(estado==='agendada') mensaje=`Tu consulta fue agendada para el ${fechaCita} a las ${horaCita}.${profesionalAsignado?' Profesional: '+profesionalAsignado+'.':''}${enlaceCita?' Enlace: '+enlaceCita:''}`;
  if(retroalimentacion) mensaje += ` Retroalimentación: ${String(retroalimentacion).trim()}`;
  crearNotificacionUsuario({ usuarioId:solicitud.usuario_id, tipo:'estado_teleconsulta', titulo:estado==='agendada'?'Consulta agendada':`Consulta ${estado}`, mensaje, entidadTipo:'teleconsulta', entidadId:solicitud.id, urlDestino:'teleconsulta', prioridad:estado==='agendada'?'alta':'normal' });
  res.json(db.prepare('SELECT * FROM solicitudes_teleconsulta WHERE id = ?').get(solicitud.id));
});

// --- Auditoría completa para el administrador ---
router.get('/conversaciones/laboratorio', (req, res) => {
  const conversaciones = db.prepare(`
    SELECT c.id,c.usuario_id,c.creado_en,u.nombre AS usuario_nombre,u.email AS usuario_email,u.telefono AS usuario_telefono,
      (SELECT COUNT(*) FROM mensajes m WHERE m.conversacion_id=c.id) AS total_mensajes,
      (SELECT MAX(m.creado_en) FROM mensajes m WHERE m.conversacion_id=c.id) AS ultima_actividad
    FROM conversaciones_ia c JOIN usuarios u ON u.id=c.usuario_id
    WHERE c.modulo='laboratorio'
    ORDER BY COALESCE(ultima_actividad,c.creado_en) DESC
  `).all();
  res.json(conversaciones);
});

router.get('/conversaciones/:id', (req, res) => {
  const conversacion = db.prepare(`SELECT c.*,u.nombre AS usuario_nombre,u.email AS usuario_email,u.telefono AS usuario_telefono
    FROM conversaciones_ia c JOIN usuarios u ON u.id=c.usuario_id WHERE c.id=?`).get(req.params.id);
  if (!conversacion) return res.status(404).json({ error: 'Conversación no encontrada.' });
  const mensajes = db.prepare('SELECT id,rol,contenido,creado_en FROM mensajes WHERE conversacion_id=? ORDER BY creado_en ASC').all(conversacion.id);
  const archivos = db.prepare(`SELECT a.id,a.tipo,a.nombre_original AS nombre,a.mime_type,a.tamano_bytes,a.creado_en
    FROM conversacion_archivos ca JOIN archivos_usuario a ON a.id=ca.archivo_id WHERE ca.conversacion_id=? ORDER BY ca.creado_en`).all(conversacion.id);
  res.json({ conversacion, mensajes, archivos });
});

router.get('/pagos', (req, res) => {
  res.json(db.prepare(`SELECT p.*,u.nombre AS usuario_nombre,u.email AS usuario_email
    FROM pagos p JOIN usuarios u ON u.id=p.usuario_id ORDER BY p.creado_en DESC`).all());
});

router.patch('/archivos/:id/verificacion', (req, res) => {
  const { estado, observacion } = req.body || {};
  if (!['pendiente','verificado','rechazado'].includes(estado)) return res.status(400).json({ error: 'Estado de verificación inválido.' });
  const archivo = db.prepare('SELECT id FROM archivos_usuario WHERE id=?').get(req.params.id);
  if (!archivo) return res.status(404).json({ error: 'Archivo no encontrado.' });
  const id = nuevoId('ver');
  db.prepare('INSERT INTO archivo_verificaciones (id,archivo_id,administrador_id,estado,observacion) VALUES (?,?,?,?,?)')
    .run(id, archivo.id, req.usuario.id, estado, String(observacion||'').trim() || null);
  const detalle=db.prepare('SELECT usuario_id,nombre_original,tipo FROM archivos_usuario WHERE id=?').get(archivo.id);
  crearNotificacionUsuario({ usuarioId:detalle.usuario_id, tipo:'verificacion_documento', titulo:estado==='verificado'?'Documento aprobado':estado==='rechazado'?'Documento rechazado':'Documento en revisión', mensaje:`El documento ${detalle.nombre_original} fue marcado como ${estado}.${observacion?' Observación: '+String(observacion).trim():''}`, entidadTipo:'archivo', entidadId:archivo.id, urlDestino:'perfil', prioridad:estado==='rechazado'?'alta':'normal' });
  res.status(201).json(db.prepare('SELECT * FROM archivo_verificaciones WHERE id=?').get(id));
});


// --- Panel ejecutivo, notificaciones e historial integral del productor ---
router.get('/dashboard', (req, res) => {
  const uno = (sql, ...params) => Number(db.prepare(sql).get(...params)?.total || 0);
  const ventasMes = Number(db.prepare(`SELECT COALESCE(SUM(monto_cop),0) AS total FROM pagos WHERE estado='APPROVED' AND creado_en >= datetime('now','start of month')`).get().total || 0);
  const indicadores = {
    usuarios: uno("SELECT COUNT(*) total FROM usuarios WHERE rol<>'admin'"),
    usuariosActivos: uno("SELECT COUNT(*) total FROM usuarios WHERE rol<>'admin' AND activo=1"),
    ventasMes,
    pagosPendientes: uno("SELECT COUNT(*) total FROM pagos WHERE estado='PENDING'"),
    pedidosPendientes: uno("SELECT COUNT(*) total FROM pedidos WHERE estado IN ('recibido','pendiente_pago')"),
    analisisPendientes: uno("SELECT COUNT(*) total FROM solicitudes_laboratorio WHERE estado IN ('pendiente','en_proceso')"),
    consultasPendientes: uno("SELECT COUNT(*) total FROM solicitudes_teleconsulta WHERE estado IN ('pendiente','agendada')"),
    documentosPendientes: uno(`SELECT COUNT(*) total FROM archivos_usuario a WHERE COALESCE((SELECT v.estado FROM archivo_verificaciones v WHERE v.archivo_id=a.id ORDER BY v.creado_en DESC LIMIT 1),'pendiente')='pendiente'`),
    conversacionesIA: uno("SELECT COUNT(*) total FROM conversaciones_ia"),
    notificacionesNoLeidas: uno("SELECT COUNT(*) total FROM notificaciones_admin WHERE leida=0")
  };
  const productosTop = db.prepare(`SELECT pr.nombre, SUM(pi.cantidad) cantidad, SUM(pi.cantidad*pi.precio_unitario_cop) total_cop
    FROM pedido_items pi JOIN productos pr ON pr.id=pi.producto_id JOIN pedidos p ON p.id=pi.pedido_id
    WHERE p.estado='pagado' GROUP BY pr.id,pr.nombre ORDER BY cantidad DESC LIMIT 5`).all();
  const usuariosPorPais = db.prepare(`SELECT COALESCE(NULLIF(pais,''),'Sin registrar') pais, COUNT(*) total FROM usuarios WHERE rol<>'admin' GROUP BY pais ORDER BY total DESC LIMIT 8`).all();
  const actividad = db.prepare(`SELECT tipo,titulo,mensaje,prioridad,leida,creada_en FROM notificaciones_admin ORDER BY creada_en DESC LIMIT 8`).all();
  res.json({ indicadores, productosTop, usuariosPorPais, actividad });
});

router.get('/notificaciones', (req, res) => {
  const soloNoLeidas = String(req.query.noLeidas || 'false') === 'true';
  const limite = Math.max(1, Math.min(100, Number.parseInt(req.query.limit || '30', 10) || 30));
  res.json(db.prepare(`SELECT n.*,u.nombre usuario_nombre,u.email usuario_email FROM notificaciones_admin n
    LEFT JOIN usuarios u ON u.id=n.usuario_id ${soloNoLeidas ? 'WHERE n.leida=0' : ''} ORDER BY n.creada_en DESC LIMIT ?`).all(limite));
});
router.patch('/notificaciones/:id/leida', (req, res) => {
  const leida = req.body?.leida !== false;
  db.prepare(`UPDATE notificaciones_admin SET leida=?, leida_en=CASE WHEN ?=1 THEN datetime('now') ELSE NULL END WHERE id=?`).run(leida?1:0, leida?1:0, req.params.id);
  res.json(db.prepare('SELECT * FROM notificaciones_admin WHERE id=?').get(req.params.id));
});
router.patch('/notificaciones-leer-todas', (_req, res) => {
  db.prepare("UPDATE notificaciones_admin SET leida=1, leida_en=datetime('now') WHERE leida=0").run();
  res.json({ ok:true });
});

router.get('/usuarios/:id/historial-integral', (req, res) => {
  const usuario = db.prepare(`SELECT id,nombre,email,telefono,rol,tipo_productor,pais,region,tarjeta_profesional,especialidad,estado_agronomo,activo,creado_en FROM usuarios WHERE id=? AND rol<>'admin'`).get(req.params.id);
  if (!usuario) return res.status(404).json({ error:'Usuario no encontrado.' });
  const fincas = db.prepare(`SELECT * FROM fincas WHERE productor_id=? AND eliminado_en IS NULL ORDER BY creado_en DESC`).all(usuario.id);
  const lotes = fincas.flatMap(f => db.prepare(`SELECT * FROM lotes WHERE finca_id=? AND eliminado_en IS NULL ORDER BY creado_en DESC`).all(f.id));
  const loteIds = lotes.map(x=>x.id);
  const porLotes = (sql) => loteIds.length ? db.prepare(sql.replace(':ids', loteIds.map(()=>'?').join(','))).all(...loteIds) : [];
  const aplicaciones = porLotes(`SELECT * FROM aplicaciones WHERE lote_id IN (:ids) AND eliminado_en IS NULL ORDER BY fecha DESC`);
  const analisisCultivo = porLotes(`SELECT * FROM analisis_laboratorio WHERE lote_id IN (:ids) AND eliminado_en IS NULL ORDER BY fecha DESC`);
  const costos = porLotes(`SELECT * FROM costos_operativos WHERE lote_id IN (:ids) AND eliminado_en IS NULL ORDER BY fecha DESC`);
  const archivos = db.prepare(`SELECT a.id,a.tipo,a.nombre_original nombre,a.mime_type,a.tamano_bytes,a.creado_en,
    COALESCE((SELECT v.estado FROM archivo_verificaciones v WHERE v.archivo_id=a.id ORDER BY v.creado_en DESC LIMIT 1),'pendiente') estado_verificacion
    FROM archivos_usuario a WHERE a.usuario_id=? ORDER BY a.creado_en DESC`).all(usuario.id);
  const pedidos = db.prepare(`SELECT * FROM pedidos WHERE usuario_id=? ORDER BY fecha DESC`).all(usuario.id).map(p=>({...p,items:db.prepare(`SELECT pi.*,pr.nombre producto_nombre FROM pedido_items pi JOIN productos pr ON pr.id=pi.producto_id WHERE pi.pedido_id=?`).all(p.id)}));
  const pagos = db.prepare(`SELECT * FROM pagos WHERE usuario_id=? ORDER BY creado_en DESC`).all(usuario.id);
  const solicitudesLaboratorio = db.prepare(`SELECT * FROM solicitudes_laboratorio WHERE usuario_id=? ORDER BY fecha DESC`).all(usuario.id);
  const consultas = db.prepare(`SELECT * FROM solicitudes_teleconsulta WHERE usuario_id=? ORDER BY fecha_solicitud DESC`).all(usuario.id);
  const conversaciones = db.prepare(`SELECT c.*,COUNT(m.id) total_mensajes,MAX(m.creado_en) ultima_actividad FROM conversaciones_ia c LEFT JOIN mensajes m ON m.conversacion_id=c.id WHERE c.usuario_id=? GROUP BY c.id ORDER BY c.creado_en DESC`).all(usuario.id);
  const auditoriaIA = db.prepare(`SELECT id,modulo,pregunta,respuesta,archivo_ids_json,modelo,tokens_entrada,tokens_salida,duracion_ms,estado,error,creado_en FROM auditoria_ia WHERE usuario_id=? ORDER BY creado_en DESC LIMIT 100`).all(usuario.id);
  res.json({ usuario,fincas,lotes,aplicaciones,analisisCultivo,costos,archivos,pedidos,pagos,solicitudesLaboratorio,consultas,conversaciones,auditoriaIA });
});

router.get('/auditoria-ia', (req, res) => {
  const modulo = String(req.query.modulo || 'todos');
  const where = modulo==='todos' ? '' : 'WHERE a.modulo=?';
  const params = modulo==='todos' ? [] : [modulo];
  res.json(db.prepare(`SELECT a.*,u.nombre usuario_nombre,u.email usuario_email FROM auditoria_ia a JOIN usuarios u ON u.id=a.usuario_id ${where} ORDER BY a.creado_en DESC LIMIT 200`).all(...params));
});


// Auditoría de seguridad: solo administradores, con paginación limitada.
router.get('/auditoria-seguridad', (req, res) => {
  const limite = Math.min(Math.max(Number(req.query.limite) || 100, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const rows = db.prepare(`SELECT a.id,a.accion,a.resultado,a.entidad_tipo,a.entidad_id,a.ip,
    a.user_agent,a.request_id,a.metadata_json,a.creado_en,u.nombre AS usuario_nombre,u.email AS usuario_email
    FROM auditoria_seguridad a LEFT JOIN usuarios u ON u.id=a.usuario_id
    ORDER BY a.creado_en DESC LIMIT ? OFFSET ?`).all(limite, offset);
  res.json(rows);
});


// --- AgroCircular: directorio propio y solicitudes de recolección ---
router.get('/circular/puntos', (req, res) => {
  const activo = String(req.query.activo || 'todos');
  const where = activo === 'todos' ? '' : 'WHERE activo=?';
  const params = activo === 'todos' ? [] : [activo === '1' ? 1 : 0];
  res.json(db.prepare(`SELECT * FROM puntos_circulares ${where} ORDER BY pais,region,ciudad,nombre`).all(...params));
});

router.post('/circular/puntos', (req, res) => {
  const b = req.body || {};
  if (!b.nombre || !b.pais) return res.status(400).json({ error:'Nombre y país son obligatorios.' });
  const id = nuevoId('pcirc');
  db.prepare(`INSERT INTO puntos_circulares
    (id,nombre,pais,region,ciudad,direccion,lat,lon,tipo_entidad,tipos_residuo,materiales,telefono,email,sitio_web,horario,maps_url,fuente,verificado,activo)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id,String(b.nombre).trim(),String(b.pais).trim().toLowerCase(),String(b.region||'').trim().toLowerCase()||null,
      String(b.ciudad||'').trim().toLowerCase()||null,String(b.direccion||'').trim()||null,b.lat??null,b.lon??null,
      String(b.tipoEntidad||'Gestor de economía circular').trim(),String(b.tiposResiduo||'general').trim(),String(b.materiales||'').trim()||null,
      String(b.telefono||'').trim()||null,String(b.email||'').trim()||null,String(b.sitioWeb||'').trim()||null,
      String(b.horario||'').trim()||null,String(b.mapsUrl||'').trim()||null,String(b.fuente||'Directorio Dr. Plants').trim(),b.verificado?1:0,b.activo===false?0:1
    );
  res.status(201).json(db.prepare('SELECT * FROM puntos_circulares WHERE id=?').get(id));
});

router.patch('/circular/puntos/:id', (req, res) => {
  const actual = db.prepare('SELECT * FROM puntos_circulares WHERE id=?').get(req.params.id);
  if (!actual) return res.status(404).json({ error:'Punto no encontrado.' });
  const b=req.body||{};
  db.prepare(`UPDATE puntos_circulares SET
    nombre=?,pais=?,region=?,ciudad=?,direccion=?,lat=?,lon=?,tipo_entidad=?,tipos_residuo=?,materiales=?,telefono=?,email=?,sitio_web=?,horario=?,maps_url=?,fuente=?,verificado=?,activo=?,actualizado_en=datetime('now')
    WHERE id=?`).run(
      b.nombre??actual.nombre,String(b.pais??actual.pais).toLowerCase(),String(b.region??actual.region??'').toLowerCase()||null,String(b.ciudad??actual.ciudad??'').toLowerCase()||null,
      b.direccion??actual.direccion,b.lat??actual.lat,b.lon??actual.lon,b.tipoEntidad??actual.tipo_entidad,b.tiposResiduo??actual.tipos_residuo,
      b.materiales??actual.materiales,b.telefono??actual.telefono,b.email??actual.email,b.sitioWeb??actual.sitio_web,b.horario??actual.horario,
      b.mapsUrl??actual.maps_url,b.fuente??actual.fuente,b.verificado==null?actual.verificado:(b.verificado?1:0),b.activo==null?actual.activo:(b.activo?1:0),actual.id
    );
  res.json(db.prepare('SELECT * FROM puntos_circulares WHERE id=?').get(actual.id));
});

router.get('/circular/solicitudes', (req, res) => {
  const estado=String(req.query.estado||'todos');
  const where=estado==='todos'?'':'WHERE s.estado=?';
  const params=estado==='todos'?[]:[estado];
  res.json(db.prepare(`SELECT s.*,u.nombre usuario_nombre,u.email usuario_email,u.telefono usuario_telefono
    FROM solicitudes_recoleccion_circular s JOIN usuarios u ON u.id=s.usuario_id ${where}
    ORDER BY s.creada_en DESC`).all(...params));
});

router.get('/circular/solicitudes/:id', (req, res) => {
  const fila = db.prepare(`SELECT s.*,u.nombre usuario_nombre,u.email usuario_email,u.telefono usuario_telefono,u.pais usuario_pais,u.region usuario_region
    FROM solicitudes_recoleccion_circular s JOIN usuarios u ON u.id=s.usuario_id WHERE s.id=?`).get(req.params.id);
  if(!fila) return res.status(404).json({error:'Solicitud no encontrada.'});
  res.json(fila);
});

router.patch('/circular/solicitudes/:id', (req, res) => {
  const estados=['pendiente','contactando_gestor','programada','recolectada','cancelada'];
  const actual=db.prepare('SELECT * FROM solicitudes_recoleccion_circular WHERE id=?').get(req.params.id);
  if(!actual) return res.status(404).json({error:'Solicitud no encontrada.'});
  const b=req.body||{};
  const estado=b.estado||actual.estado;
  if(!estados.includes(estado)) return res.status(400).json({error:'Estado inválido.'});
  db.prepare(`UPDATE solicitudes_recoleccion_circular SET estado=?,gestor_asignado=?,fecha_programada=?,retroalimentacion=?,actualizada_en=datetime('now') WHERE id=?`)
    .run(estado,b.gestorAsignado??actual.gestor_asignado,b.fechaProgramada??actual.fecha_programada,b.retroalimentacion??actual.retroalimentacion,actual.id);
  const detalle=[b.gestorAsignado?`Gestor: ${b.gestorAsignado}.`:'',b.fechaProgramada?`Fecha: ${b.fechaProgramada}.`:'',b.retroalimentacion||''].filter(Boolean).join(' ');
  crearNotificacionUsuario({usuarioId:actual.usuario_id,tipo:'estado_recoleccion',titulo:`Recolección circular: ${estado.replaceAll('_',' ')}`,mensaje:`Tu solicitud cambió a ${estado.replaceAll('_',' ')}. ${detalle}`.trim(),entidadTipo:'solicitud_recoleccion',entidadId:actual.id,urlDestino:'rec-puntos',prioridad:estado==='programada'?'alta':'normal'});
  res.json(db.prepare(`SELECT s.*,u.nombre usuario_nombre,u.email usuario_email,u.telefono usuario_telefono FROM solicitudes_recoleccion_circular s JOIN usuarios u ON u.id=s.usuario_id WHERE s.id=?`).get(actual.id));
});


// --- Matrículas de cursos ---
router.get('/matriculas-cursos', (req,res)=>{
  res.json(db.prepare(`SELECT m.*,c.nombre AS curso_nombre,c.precio_cop,u.nombre AS usuario_nombre,u.email AS usuario_email,u.telefono AS usuario_telefono,p.estado AS pago_estado,p.referencia AS pago_referencia,p.monto_cop AS pago_monto
    FROM matriculas_curso m JOIN cursos c ON c.id=m.curso_id JOIN usuarios u ON u.id=m.usuario_id
    LEFT JOIN pagos p ON p.id=m.pago_id ORDER BY m.creado_en DESC`).all());
});

router.patch('/matriculas-cursos/:id', (req,res)=>{
  const accion=String(req.body?.accion||'');
  if(!['activar','rechazar','cancelar'].includes(accion)) return res.status(400).json({error:'Acción inválida.'});
  const m=db.prepare(`SELECT m.*,c.nombre AS curso_nombre,p.estado AS pago_estado FROM matriculas_curso m JOIN cursos c ON c.id=m.curso_id LEFT JOIN pagos p ON p.id=m.pago_id WHERE m.id=?`).get(req.params.id);
  if(!m) return res.status(404).json({error:'Matrícula no encontrada.'});
  if(accion==='activar' && m.pago_estado!=='APPROVED') return res.status(400).json({error:'No se puede activar: el pago todavía no está aprobado.'});
  const estado=accion==='activar'?'activa':accion==='rechazar'?'rechazada':'cancelada';
  db.prepare(`UPDATE matriculas_curso SET estado=?,activado_en=CASE WHEN ?='activa' THEN datetime('now') ELSE activado_en END,activado_por=CASE WHEN ?='activa' THEN ? ELSE activado_por END WHERE id=?`).run(estado,estado,estado,req.usuario.id,m.id);
  crearNotificacionUsuario({usuarioId:m.usuario_id,tipo:'matricula_curso',titulo:estado==='activa'?'Acceso al curso activado':'Estado de matrícula actualizado',mensaje:estado==='activa'?`Tu acceso a ${m.curso_nombre} fue activado. Ya puedes ingresar al contenido.`:`Tu matrícula en ${m.curso_nombre} quedó en estado ${estado}.`,entidadTipo:'matricula_curso',entidadId:m.id,urlDestino:'formacion',prioridad:'alta'});
  res.json(db.prepare('SELECT * FROM matriculas_curso WHERE id=?').get(m.id));
});


// --- V8C.5 · Roles empresariales, impersonación y control de demostraciones ---
router.get('/empresa/estado', (req,res)=>{
  res.json({ rolEmpresarial: rolEmpresarial(req.usuario.id) || (req.usuario.rol==='admin'?'super_admin':null), superAdmin: esSuperAdmin(req.usuario) });
});
router.patch('/usuarios/:id/rol-empresarial', (req,res)=>{
  if(!esSuperAdmin(req.usuario)) return res.status(403).json({error:'Solo el Super Administrador puede asignar roles empresariales.'});
  const destino=db.prepare('SELECT id,nombre,email,rol FROM usuarios WHERE id=?').get(req.params.id);
  if(!destino) return res.status(404).json({error:'Usuario no encontrado.'});
  const rol=String(req.body?.rol||'ninguno');
  if(rol==='ninguno') db.prepare('DELETE FROM permisos_empresariales WHERE usuario_id=?').run(destino.id);
  else {
    if(!['admin_operativo','ejecutivo_comercial'].includes(rol)) return res.status(400).json({error:'Rol empresarial inválido.'});
    db.prepare(`INSERT INTO permisos_empresariales(usuario_id,rol,activo,asignado_por,actualizado_en) VALUES(?,?,1,?,datetime('now'))
      ON CONFLICT(usuario_id) DO UPDATE SET rol=excluded.rol,activo=1,asignado_por=excluded.asignado_por,actualizado_en=datetime('now')`).run(destino.id,rol,req.usuario.id);
  }
  if(rol==='ejecutivo_comercial') db.prepare(`INSERT INTO modo_demo_usuario(usuario_id,activo,actualizado_en) VALUES(?,1,datetime('now')) ON CONFLICT(usuario_id) DO UPDATE SET activo=1,actualizado_en=datetime('now')`).run(destino.id);
  audit({req,action:'asignar_rol_empresarial',entityType:'usuario',entityId:destino.id,metadata:{rol}});
  res.json({ok:true,usuarioId:destino.id,rolEmpresarial:rol==='ninguno'?null:rol});
});
router.post('/impersonar/:id', (req,res)=>{
  if(!esSuperAdmin(req.usuario)) return res.status(403).json({error:'Solo el Super Administrador puede usar Entrar como.'});
  const destino=db.prepare('SELECT * FROM usuarios WHERE id=? AND activo=1').get(req.params.id);
  if(!destino) return res.status(404).json({error:'Usuario no encontrado o bloqueado.'});
  if(destino.rol==='admin') return res.status(400).json({error:'No es necesario impersonar otra cuenta administradora.'});
  audit({req,action:'impersonar_usuario',entityType:'usuario',entityId:destino.id,metadata:{admin:req.usuario.id}});
  const {password_hash,...usuario}=destino;
  res.json({token:firmarToken(destino,{impersonadoPor:req.usuario.id}),usuario:{...usuario,rol_empresarial:rolEmpresarial(destino.id)},impersonadoPor:req.usuario.id});
});

module.exports = router;
