const fs = require('fs');
const path = require('path');

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
]);

const EXTENSION_BY_TYPE = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp'
};

function safeDelete(fileOrPath) {
  const filePath = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath?.path;
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (error) {
    console.error('No se pudo eliminar archivo temporal:', error.message);
  }
}

function safeDeleteMany(files) {
  for (const file of files || []) safeDelete(file);
}

function flattenFiles(filesObject) {
  return Object.values(filesObject || {}).flat().filter(Boolean);
}

function detectMimeFromMagic(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(16);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);

    if (bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 8 && bytes.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    ) return 'image/webp';

    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function validateStoredFile(file) {
  if (!file?.path || !fs.existsSync(file.path)) {
    throw new Error('El archivo cargado no pudo verificarse.');
  }
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw new Error('Solo se permiten archivos PDF, JPG, PNG o WEBP.');
  }

  const detectedMime = detectMimeFromMagic(file.path);
  if (!detectedMime || detectedMime !== file.mimetype) {
    throw new Error(`El contenido real de ${file.originalname || 'un archivo'} no coincide con el formato declarado.`);
  }

  const originalExtension = path.extname(file.originalname || '').toLowerCase();
  const validExtensions = detectedMime === 'image/jpeg' ? new Set(['.jpg', '.jpeg']) : new Set([EXTENSION_BY_TYPE[detectedMime]]);
  if (!validExtensions.has(originalExtension)) {
    throw new Error(`La extensión de ${file.originalname || 'un archivo'} no corresponde con su contenido.`);
  }
  return detectedMime;
}

function multerFileFilter(_req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error('Solo se permiten archivos PDF, JPG, PNG o WEBP.'));
  }
  cb(null, true);
}

function uploadLimits({ files, fields, parts }) {
  return {
    fileSize: MAX_FILE_SIZE,
    files,
    fields,
    parts,
    fieldNameSize: 100,
    fieldSize: 256 * 1024,
    headerPairs: 100
  };
}

module.exports = {
  MAX_FILE_SIZE,
  flattenFiles,
  multerFileFilter,
  safeDelete,
  safeDeleteMany,
  uploadLimits,
  validateStoredFile
};
