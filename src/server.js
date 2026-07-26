require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const helmet = require('helmet');
const hpp = require('hpp');

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
const { corsOptions, requestId, originGuard, globalLimiter, loginLimiter, registerLimiter, uploadLimiter, paymentLimiter, webhookLimiter } = require('./security');
const { sanitizeRequest } = require('./validation');

const app = express();
const PORT = Number(process.env.PORT) || 3001;

for (const variable of ['JWT_SECRET', 'ADMIN_USERNAME', 'ADMIN_PASSWORD']) {
  if (!process.env[variable]) {
    throw new Error(`Falta la variable de entorno obligatoria: ${variable}`);
  }
}

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(requestId);
app.use(helmet({
  // El frontend actual usa scripts y estilos inline. Se mantienen las demás cabeceras
  // de Helmet y se deja CSP para una fase de migración con nonces.
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  strictTransportSecurity: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false
}));
app.use(cors(corsOptions()));
app.use(hpp());
app.use(express.json({ limit: '512kb', strict: true, type: ['application/json', 'application/*+json'] }));
app.use(express.urlencoded({ extended: false, limit: '128kb', parameterLimit: 100 }));
app.use(sanitizeRequest);
app.use(originGuard);
app.use('/api', globalLimiter);

// Evita que navegadores/PWA/proxies reutilicen respuestas de sesión o API.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, servicio: 'dr-plants-backend', requestId: req.id }));
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', registerLimiter);
app.use('/api/archivos/subir', uploadLimiter);
app.use('/api/pagos/intencion', paymentLimiter);
app.use('/api/pagos/wompi/eventos', webhookLimiter);

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
    return res.status(400).json({ code: err.code, error: 'La carga del archivo no pudo completarse.', requestId: req.id });
  }
  if (err?.message === 'Origen no autorizado por CORS.') {
    return res.status(403).json({ code: 'CORS_REJECTED', error: err.message, requestId: req.id });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ code: 'INVALID_JSON', error: 'El cuerpo JSON no es válido.', requestId: req.id });
  }
  console.error(`[${req.id || 'sin-id'}]`, err);
  return res.status(500).json({ error: 'Error interno del servidor.', requestId: req.id });
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
