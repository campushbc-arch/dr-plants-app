const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const HOME_DIR = process.env.HOME || path.join(__dirname, '..', '..');
const DB_PATH = process.env.DB_PATH || path.join(HOME_DIR, 'data', 'drplants', 'drplants.db');
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

if (!columnasUsuarios.includes('foto_perfil')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN foto_perfil TEXT DEFAULT NULL');
}
if (!columnasUsuarios.includes('aprobado_en')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN aprobado_en TEXT DEFAULT NULL');
}
if (!columnasUsuarios.includes('rechazado_en')) {
  db.exec('ALTER TABLE usuarios ADD COLUMN rechazado_en TEXT DEFAULT NULL');
}



function migrarColumnas(tabla, columnas) {
  const existentes = db.prepare(`PRAGMA table_info(${tabla})`).all().map(c => c.name);
  for (const [nombre, definicion] of Object.entries(columnas)) {
    if (!existentes.includes(nombre)) db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${nombre} ${definicion}`);
  }
}

migrarColumnas('fincas', {
  pais: "TEXT DEFAULT NULL", region: "TEXT DEFAULT NULL", ciudad: "TEXT DEFAULT NULL",
  actualizado_en: "TEXT DEFAULT NULL", eliminado_en: "TEXT DEFAULT NULL"
});
migrarColumnas('lotes', {
  cultivo_nombre: "TEXT DEFAULT NULL", variedad: "TEXT DEFAULT NULL",
  actualizado_en: "TEXT DEFAULT NULL", eliminado_en: "TEXT DEFAULT NULL"
});
for (const tabla of ['aplicaciones','analisis_laboratorio','costos_operativos']) {
  migrarColumnas(tabla, {
    creado_por: "TEXT DEFAULT NULL", actualizado_en: "TEXT DEFAULT NULL", eliminado_en: "TEXT DEFAULT NULL"
  });
}

console.log(`Base de datos activa: ${DB_PATH}`);
module.exports = db;
