const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function cleanString(value, max = 5000) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}
function email(value) {
  const v = cleanString(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v : null;
}
function phone(value) {
  const v = cleanString(value, 30);
  return /^\+?[0-9 ()-]{7,25}$/.test(v) ? v : null;
}
function enumValue(value, allowed) {
  const v = cleanString(value, 100);
  return allowed.includes(v) ? v : null;
}
function id(value) {
  const v = cleanString(value, 120);
  return /^[A-Za-z0-9_-]{3,120}$/.test(v) ? v : null;
}
function sanitizeObject(value, depth = 0) {
  if (depth > 10) return null;
  if (Array.isArray(value)) return value.slice(0, 200).map(v => sanitizeObject(v, depth + 1));
  if (value && typeof value === 'object') {
    const result = Object.create(null);
    for (const [key, child] of Object.entries(value)) {
      if (DANGEROUS_KEYS.has(key)) continue;
      result[key.slice(0, 100)] = sanitizeObject(child, depth + 1);
    }
    return result;
  }
  return typeof value === 'string' ? cleanString(value) : value;
}
function sanitizeRequest(req, _res, next) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) req.body = sanitizeObject(req.body);
  next();
}
function strongPassword(value) {
  const p = String(value || '');
  return p.length >= 10 && p.length <= 128 && /[A-Za-z]/.test(p) && /\d/.test(p);
}
module.exports = { cleanString, email, phone, enumValue, id, sanitizeObject, sanitizeRequest, strongPassword };
