const crypto = require('crypto');
const rateLimitPackage = require('express-rate-limit');
const rateLimit = rateLimitPackage.rateLimit || rateLimitPackage;

function allowedOrigins() {
  const values = [process.env.APP_URL, process.env.CORS_ORIGIN]
    .flatMap(v => String(v || '').split(','))
    .map(v => v.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return new Set(values);
}

function corsOptions() {
  const allowed = allowedOrigins();
  return {
    credentials: false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-ID'],
    maxAge: 600,
    origin(origin, callback) {
      // Apps móviles, curl y comunicación servidor-servidor pueden no enviar Origin.
      if (!origin || allowed.size === 0 || allowed.has(origin.replace(/\/$/, ''))) return callback(null, true);
      return callback(new Error('Origen no autorizado por CORS.'));
    }
  };
}

function requestId(req, res, next) {
  const incoming = String(req.get('X-Request-ID') || '');
  const id = /^[A-Za-z0-9._-]{8,100}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.id = id;
  res.setHeader('X-Request-ID', id);
  next();
}

function originGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/api/pagos/wompi/eventos') return next();
  const origin = req.get('Origin');
  if (!origin) return next();
  const allowed = allowedOrigins();
  if (allowed.size === 0 || allowed.has(origin.replace(/\/$/, ''))) return next();
  return res.status(403).json({ code: 'ORIGIN_REJECTED', error: 'Origen no autorizado.' });
}

function limiter({ windowMs, limit, message, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests,
    // express-rate-limit v8 ya usa internamente ipKeyGenerator para IPv4/IPv6.
    // No se define un keyGenerator personalizado para evitar ERR_ERL_KEY_GEN_IPV6
    // y conservar la protección correcta detrás del proxy de Hostinger.
    handler: (_req, res) => res.status(429).json({ code: 'RATE_LIMITED', error: message })
  });
}

const globalLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_GLOBAL || 600),
  message: 'Demasiadas solicitudes. Intenta nuevamente en unos minutos.'
});
const loginLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_LOGIN || 10),
  message: 'Demasiados intentos de inicio de sesión. Intenta nuevamente en 15 minutos.',
  skipSuccessfulRequests: true
});
const registerLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_REGISTER || 5),
  message: 'Demasiados intentos de registro. Intenta nuevamente más tarde.'
});
const uploadLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_UPLOAD || 20),
  message: 'Demasiadas cargas de archivos. Intenta nuevamente en 15 minutos.'
});
const paymentLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_PAYMENT || 20),
  message: 'Demasiados intentos de pago. Intenta nuevamente en unos minutos.'
});
const webhookLimiter = limiter({
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_WEBHOOK || 120),
  message: 'Límite temporal de eventos excedido.'
});

function noSniffDownloads(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
}

module.exports = {
  corsOptions, requestId, originGuard, globalLimiter, loginLimiter,
  registerLimiter, uploadLimiter, paymentLimiter, webhookLimiter, noSniffDownloads
};
