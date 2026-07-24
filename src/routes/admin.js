const express = require('express');
const db = require('../db');
const { nuevoId, requiereAuth, requiereRol } = require('../auth');

const router = express.Router();
router.use(requiereAuth, requiereRol('admin'));

// GET /api/admin/agronomos?estado=pendiente
router.get('/agronomos', (req, res) => {
  const estado = req.query.estado || 'pendiente';
  const filas = db.prepare(`
    SELECT id, nombre, telefono, tarjeta_profesional, especialidad, estado_agronomo, creado_en
    FROM usuarios WHERE rol IN ('agronomo','agronomo_pendiente') AND estado_agronomo = ?
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

  const nuevoEstado = accion === 'aprobar' ? 'aprobado' : 'rechazado';
  const nuevoRol = accion === 'aprobar' ? 'agronomo' : 'agronomo_pendiente';
  db.prepare('UPDATE usuarios SET estado_agronomo = ?, rol = ? WHERE id = ?').run(nuevoEstado, nuevoRol, usuario.id);
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
