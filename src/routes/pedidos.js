const express = require('express');
const db = require('../db');
const { nuevoId, requiereAuth } = require('../auth');
const { crearNotificacionAdmin } = require('../notificaciones');

const router = express.Router();
router.use(requiereAuth);

router.post('/', (req, res) => {
  const { items, loteId } = req.body;
  if (!Array.isArray(items) || !items.length || items.length > 50) {
    return res.status(400).json({ error: 'El pedido debe contener entre 1 y 50 productos.' });
  }

  const ids = [...new Set(items.map(x => String(x.productoId || '')))].filter(Boolean);
  const placeholders = ids.map(() => '?').join(',');
  const productos = ids.length ? db.prepare(`SELECT id,nombre,precio_cop FROM productos WHERE id IN (${placeholders})`).all(...ids) : [];
  const mapa = new Map(productos.map(p => [p.id, p]));
  const normalizados = [];
  for (const item of items) {
    const producto = mapa.get(String(item.productoId || ''));
    const cantidad = Number(item.cantidad);
    if (!producto || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 999) {
      return res.status(400).json({ error: 'El pedido contiene un producto o una cantidad inválida.' });
    }
    normalizados.push({ producto, cantidad });
  }

  const total = normalizados.reduce((s, it) => s + it.cantidad * Number(it.producto.precio_cop), 0);
  const id = nuevoId('ped');
  const numero = 'DP-' + Math.floor(100000 + Math.random() * 900000);
  const crear = db.transaction(() => {
    db.prepare("INSERT INTO pedidos (id,usuario_id,numero,lote_id,estado,total_cop) VALUES (?,?,?,?, 'pendiente_pago', ?)")
      .run(id, req.usuario.id, numero, loteId || null, total);
    const ins = db.prepare('INSERT INTO pedido_items (id,pedido_id,producto_id,cantidad,precio_unitario_cop) VALUES (?,?,?,?,?)');
    for (const it of normalizados) ins.run(nuevoId('pi'), id, it.producto.id, it.cantidad, it.producto.precio_cop);
  });
  crear();
  crearNotificacionAdmin({ tipo:'nuevo_pedido', titulo:'Nuevo pedido en AgroTienda', mensaje:`${req.usuario.nombre || req.usuario.email} creó el pedido ${numero} por $${total.toLocaleString('es-CO')} COP.`, usuarioId:req.usuario.id, entidadTipo:'pedido', entidadId:id, prioridad:'alta' });
  res.status(201).json({ ...db.prepare('SELECT * FROM pedidos WHERE id=?').get(id), items: normalizados.map(x => ({ productoId:x.producto.id, nombre:x.producto.nombre, cantidad:x.cantidad, precioUnitarioCop:x.producto.precio_cop })) });
});

router.get('/', (req, res) => {
  const pedidos = db.prepare('SELECT * FROM pedidos WHERE usuario_id=? ORDER BY fecha DESC').all(req.usuario.id);
  res.json(pedidos.map(p => ({ ...p, items: db.prepare(`SELECT pi.*,pr.nombre AS producto_nombre FROM pedido_items pi JOIN productos pr ON pr.id=pi.producto_id WHERE pi.pedido_id=?`).all(p.id) })));
});
module.exports = router;
