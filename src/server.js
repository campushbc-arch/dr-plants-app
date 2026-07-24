require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const fincasRoutes = require('./routes/fincas');
const adminRoutes = require('./routes/admin');
const productosRoutes = require('./routes/productos');
const pedidosRoutes = require('./routes/pedidos');
const solicitudesRoutes = require('./routes/solicitudes');
const { seedSiVacio } = require('./db/seed');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, servicio: 'dr-plants-backend' }));

app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/fincas', fincasRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/solicitudes', solicitudesRoutes);

// Sirve la app (dr_plants_v4.html renombrado a public/index.html) desde el mismo dominio
// y puerto que la API — así todo vive en drplants.campushbc.com sin necesidad de CORS
// entre frontend y backend, ni de configurar dos sitios distintos en Hostinger.
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

// Siembra datos de ejemplo solo si la base de datos está vacía — así no hace falta
// entrar por terminal a correr "npm run seed" a mano (Hostinger Business no siempre
// da acceso SSH; en VPS si quieres, puedes seguir corriéndolo manualmente también).
seedSiVacio();

app.listen(PORT, () => {
  console.log(`Dr Plants backend escuchando en http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY no está configurada — /api/chat va a fallar hasta que la agregues en las variables de entorno.');
  }
  if (!process.env.JWT_SECRET) {
    console.warn('⚠️  JWT_SECRET no está configurada — la app va a fallar al arrancar sin ella.');
  }
});
