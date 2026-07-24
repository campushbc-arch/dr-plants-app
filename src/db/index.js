const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'drplants.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Migraciones compatibles con bases ya existentes en producción.
// CREATE TABLE IF NOT EXISTS no agrega columnas nuevas, por eso verificamos y alteramos.
const columnasUsuarios = db.prepare('PRAGMA table_info(usuarios)').all().map(c => c.name);
if (!columnasUsuarios.includes('activo')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0,1))');
}
if (!columnasUsuarios.includes('bloqueado_en')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN bloqueado_en TEXT DEFAULT NULL');
}
if (!columnasUsuarios.includes('motivo_bloqueo')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN motivo_bloqueo TEXT DEFAULT NULL');
}

module.exports = db;
