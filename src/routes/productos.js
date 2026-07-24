const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/productos — pública, no requiere login (así funciona AgroTienda sin registrarse)
router.get('/', (req, res) => {
  const productos = db.prepare('SELECT * FROM productos').all();
  res.json(productos);
});

router.get('/categorias', (req, res) => {
  res.json(db.prepare('SELECT * FROM categorias').all());
});

module.exports = router;
