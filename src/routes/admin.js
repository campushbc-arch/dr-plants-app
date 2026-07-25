const express = require('express');
const db = require('../db');
const { nuevoId, requiereAuth, requiereRol } = require('../auth');

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
           bloqueado_en, motivo_bloqueo, creado_en
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
    SELECT id, tipo, nombre_original AS nombre, mime_type, tamano_bytes, creado_en
    FROM archivos_usuario
    WHERE usuario_id = ?
    ORDER BY creado_en DESC
  `).all(usuario.id).map(a => ({ ...a, url: `/api/admin/archivos/${a.id}` }));
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
  const { estado } = req.body;
  if (!['pendiente', 'en_proceso', 'completado', 'cancelado'].includes(estado)) {
    return res.status(400).json({ error: 'estado inválido.' });
  }
  db.prepare('UPDATE solicitudes_laboratorio SET estado = ? WHERE id = ?').run(estado, req.params.id);
  res.json(db.prepare('SELECT * FROM solicitudes_laboratorio WHERE id = ?').get(req.params.id));
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
  const { estado } = req.body;
  if (!['pendiente', 'agendada', 'atendida', 'cancelada'].includes(estado)) {
    return res.status(400).json({ error: 'estado inválido.' });
  }
  db.prepare('UPDATE solicitudes_teleconsulta SET estado = ? WHERE id = ?').run(estado, req.params.id);
  res.json(db.prepare('SELECT * FROM solicitudes_teleconsulta WHERE id = ?').get(req.params.id));
});

module.exports = router;
