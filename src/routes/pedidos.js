const express = require('express');
const db = require('../db');
const { nuevoId, requiereAuth } = require('../auth');

const router = express.Router();
router.use(requiereAuth);

// POST /api/pedidos — crea el pedido real al finalizar la compra en AgroTienda
router.post('/', (req, res) => {
  const { items, loteId } = req.body; // items: [{productoId, cantidad, precioUnitarioCop}]
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'items es obligatorio y no puede estar vacío.' });
  }
  const total = items.reduce((s, it) => s + it.cantidad * it.precioUnitarioCop, 0);
  const id = nuevoId('ped');
  const numero = 'DP-' + Math.floor(100000 + Math.random() * 900000);

  const crearPedidoCompleto = db.transaction(() => {
    db.prepare('INSERT INTO pedidos (id, usuario_id, numero, lote_id, total_cop) VALUES (?,?,?,?,?)')
      .run(id, req.usuario.id, numero, loteId || null, total);
    const insertItem = db.prepare('INSERT INTO pedido_items (id, pedido_id, producto_id, cantidad, precio_unitario_cop) VALUES (?,?,?,?,?)');
    for (const it of items) {
      insertItem.run(nuevoId('pi'), id, it.productoId, it.cantidad, it.precioUnitarioCop);
    }
  });

  try{
    crearPedidoCompleto();
  }catch(err){
    return res.status(400).json({ error: 'No se pudo crear el pedido — revisa que los productos existan en el catálogo.' });
  }

  res.status(201).json(db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id));
});

// GET /api/pedidos — historial de pedidos del usuario autenticado
router.get('/', (req, res) => {
  const pedidos = db.prepare('SELECT * FROM pedidos WHERE usuario_id = ? ORDER BY fecha DESC').all(req.usuario.id);
  res.json(pedidos);
});

module.exports = router;
