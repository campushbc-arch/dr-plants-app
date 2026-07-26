require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const fincasRoutes = require('./routes/fincas');
const adminRoutes = require('./routes/admin');
const productosRoutes = require('./routes/productos');
const pedidosRoutes = require('./routes/pedidos');
const solicitudesRoutes = require('./routes/solicitudes');
const archivosRoutes = require('./routes/archivos');
const pagosRoutes = require('./routes/pagos');
const { seedSiVacio } = require('./db/seed');

const app = express();
const PORT = Number(process.env.PORT) || 3001;

for (const variable of ['JWT_SECRET', 'ADMIN_USERNAME', 'ADMIN_PASSWORD']) {
  if (!process.env[variable]) {
    throw new Error(`Falta la variable de entorno obligatoria: ${variable}`);
  }
}

app.set('trust proxy', 1);

const corsOrigin = process.env.CORS_ORIGIN || false;
app.use(cors({ origin: corsOrigin, credentials: false }));
app.use(express.json({ limit: '1mb' }));

// Evita que navegadores/PWA/proxies reutilicen respuestas de sesión o API.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, servicio: 'dr-plants-backend' }));

function crearLimitador({ ventanaMs, maximo, mensaje }) {
  const intentos = new Map();
  const limpieza = setInterval(() => {
    const ahora = Date.now();
    for (const [clave, dato] of intentos) {
      if (dato.reinicio <= ahora) intentos.delete(clave);
    }
  }, Math.min(ventanaMs, 60 * 1000));
  limpieza.unref();

  return (req, res, next) => {
    const ahora = Date.now();
    const clave = req.ip || req.socket.remoteAddress || 'desconocida';
    let dato = intentos.get(clave);
    if (!dato || dato.reinicio <= ahora) {
      dato = { cantidad: 0, reinicio: ahora + ventanaMs };
      intentos.set(clave, dato);
    }
    dato.cantidad += 1;
    res.set('RateLimit-Limit', String(maximo));
    res.set('RateLimit-Remaining', String(Math.max(0, maximo - dato.cantidad)));
    res.set('RateLimit-Reset', String(Math.ceil(dato.reinicio / 1000)));
    if (dato.cantidad > maximo) {
      res.set('Retry-After', String(Math.ceil((dato.reinicio - ahora) / 1000)));
      return res.status(429).json({ code: 'RATE_LIMITED', error: mensaje });
    }
    next();
  };
}

const registroLimiter = crearLimitador({
  ventanaMs: 15 * 60 * 1000,
  maximo: 5,
  mensaje: 'Demasiados intentos de registro. Intenta nuevamente en 15 minutos.'
});
const uploadsLimiter = crearLimitador({
  ventanaMs: 15 * 60 * 1000,
  maximo: 10,
  mensaje: 'Demasiadas cargas de archivos. Intenta nuevamente en 15 minutos.'
});
app.use('/api/auth/register', registroLimiter);
app.use('/api/archivos/subir', uploadsLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/fincas', fincasRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/pedidos', pedidosRoutes);
app.use('/api/solicitudes', solicitudesRoutes);
app.use('/api/archivos', archivosRoutes);
app.use('/api/pagos', pagosRoutes);

// Sirve la app (dr_plants_v4.html renombrado a public/index.html) desde el mismo dominio
// y puerto que la API — así todo vive en drplants.campushbc.com sin necesidad de CORS
// entre frontend y backend, ni de configurar dos sitios distintos en Hostinger.
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ code: err.code, error: 'La carga del archivo no pudo completarse: ' + err.message });
  }
  console.error(err);
  return res.status(500).json({ error: 'Error interno del servidor.' });
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
});
