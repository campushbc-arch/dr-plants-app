const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = 'dr-plants';
const JWT_AUDIENCE = 'dr-plants-web';
if (!JWT_SECRET) {
  throw new Error('Falta JWT_SECRET en el .env — genera uno con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}
if (process.env.NODE_ENV === 'production' && JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET debe tener al menos 32 caracteres en producción.');
}

function nuevoId(prefijo) {
  return `${prefijo}_${crypto.randomBytes(12).toString('hex')}`;
}

function firmarToken(usuario, extra = {}) {
  return jwt.sign(
    { id: usuario.id, rol: usuario.rol, ...extra },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h', issuer: JWT_ISSUER, audience: JWT_AUDIENCE }
  );
}

// Middleware: exige un usuario autenticado (Authorization: Bearer <token>)
function requiereAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'No autenticado. Falta el token.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE, algorithms: ['HS256'] });
    const usuarioActual = db.prepare('SELECT id, rol, activo FROM usuarios WHERE id = ?').get(payload.id);
    if (!usuarioActual) {
      return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'La cuenta ya no existe.' });
    }
    if (usuarioActual.activo === 0) {
      return res.status(403).json({ error: 'Tu cuenta está bloqueada. Comunícate con el administrador.' });
    }
    // Se toma el rol vigente en la base, no el rol antiguo incluido en el token.
    req.usuario = { id: usuarioActual.id, rol: usuarioActual.rol, impersonadoPor: payload.impersonadoPor || null };
    next();
  } catch (err) {
    return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'Token inválido o expirado.' });
  }
}

// Middleware: exige un rol específico (o uno de varios)
function requiereRol(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'No autenticado.' });
    if (!rolesPermitidos.includes(req.usuario.rol)) {
      return res.status(403).json({ error: `Esta acción requiere rol: ${rolesPermitidos.join(' o ')}.` });
    }
    next();
  };
}

module.exports = { nuevoId, firmarToken, requiereAuth, requiereRol, JWT_SECRET };
