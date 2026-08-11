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
  actualizado_en: "TEXT DEFAULT NULL", eliminado_en: "TEXT DEFAULT NULL",
  cliente_id: "TEXT DEFAULT NULL", gestor_id: "TEXT DEFAULT NULL",
  relacion_tipo: "TEXT DEFAULT 'propia'", cliente_nombre_cache: "TEXT DEFAULT NULL",
  latitud: "REAL DEFAULT NULL", longitud: "REAL DEFAULT NULL", altitud: "REAL DEFAULT NULL"
});
migrarColumnas('lotes', {
  cultivo_nombre: "TEXT DEFAULT NULL", variedad: "TEXT DEFAULT NULL",
  actualizado_en: "TEXT DEFAULT NULL", eliminado_en: "TEXT DEFAULT NULL",
  rendimiento_objetivo_ha: "REAL DEFAULT 0", unidad_rendimiento: "TEXT DEFAULT 'kg/ha'",
  precio_objetivo: "REAL DEFAULT 0", unidad_precio: "TEXT DEFAULT NULL", moneda_proyeccion: "TEXT DEFAULT NULL",
  etapa_fenologica: "TEXT DEFAULT NULL"
});
migrarColumnas('pedidos', { pago_id: "TEXT DEFAULT NULL" });
migrarColumnas('solicitudes_laboratorio', { pago_id: "TEXT DEFAULT NULL" });
migrarColumnas('solicitudes_teleconsulta', {
  pago_id: "TEXT DEFAULT NULL", fecha_cita: "TEXT DEFAULT NULL", hora_cita: "TEXT DEFAULT NULL",
  enlace_cita: "TEXT DEFAULT NULL", profesional_asignado: "TEXT DEFAULT NULL", retroalimentacion: "TEXT DEFAULT NULL"
});
migrarColumnas('solicitudes_laboratorio', { retroalimentacion: "TEXT DEFAULT NULL" });

for (const tabla of ['aplicaciones','analisis_laboratorio','costos_operativos']) {
  migrarColumnas(tabla, {
    creado_por: "TEXT DEFAULT NULL", actualizado_en: "TEXT DEFAULT NULL", eliminado_en: "TEXT DEFAULT NULL"
  });
}


// Amplía pagos para matrículas de cursos en bases existentes.
const pagosSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='pagos'").get()?.sql || '';
if (pagosSql && !pagosSql.includes("'curso'")) {
  db.exec(`PRAGMA foreign_keys=OFF;
  BEGIN TRANSACTION;
  ALTER TABLE pagos RENAME TO pagos_old;
  CREATE TABLE pagos (
    id TEXT PRIMARY KEY, usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK(tipo IN ('productos','consulta_personalizada','analisis_laboratorio','curso')),
    entidad_id TEXT NOT NULL, referencia TEXT NOT NULL UNIQUE, descripcion TEXT, monto_cop INTEGER NOT NULL,
    monto_centavos INTEGER NOT NULL, moneda TEXT NOT NULL DEFAULT 'COP', estado TEXT NOT NULL DEFAULT 'PENDING',
    wompi_transaccion_id TEXT DEFAULT NULL, metodo_pago TEXT DEFAULT NULL, respuesta_wompi TEXT DEFAULT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')), actualizado_en TEXT DEFAULT NULL
  );
  INSERT INTO pagos SELECT * FROM pagos_old;
  DROP TABLE pagos_old;
  CREATE INDEX IF NOT EXISTS idx_pagos_usuario ON pagos(usuario_id, creado_en);
  CREATE INDEX IF NOT EXISTS idx_pagos_referencia ON pagos(referencia);
  COMMIT; PRAGMA foreign_keys=ON;`);
}

// Curso inicial y temario. Se crea una sola vez.
const cursoId='curso-master-ventas-agro';
if (!db.prepare('SELECT id FROM cursos WHERE id=?').get(cursoId)) {
  const tx=db.transaction(()=>{
    db.prepare(`INSERT INTO cursos (id,nombre,descripcion,precio_cop,portada,publicado) VALUES (?,?,?,?,?,1)`).run(
      cursoId,'Máster en Sistemas de Venta y Cierre de Negocios en el Sector Agrícola',
      'Programa práctico para dominar la venta consultiva agrícola, la negociación, el diseño de propuestas de valor y el cierre profesional de negocios con productores, distribuidores y empresas del agro.',320000,'ti-chart-arrows-vertical'
    );
    const modulos=[
      ['m1','Fundamentos de la venta agrícola','Cómo compra el productor y qué hace diferente la comercialización en el agro.',1,[
        ['l1','El mercado agrícola y sus actores','Productores, asociaciones, distribuidores, técnicos y decisores.',25],
        ['l2','Psicología de compra del productor','Riesgo, confianza, evidencia y retorno de la inversión.',30],
        ['l3','Perfil del vendedor consultivo agrícola','Competencias técnicas, humanas y comerciales.',25]]],
      ['m2','Prospección y diagnóstico comercial','Métodos para encontrar oportunidades y comprender necesidades reales.',2,[
        ['l4','Segmentación de clientes agrícolas','Criterios por cultivo, zona, tamaño, tecnificación y potencial.',30],
        ['l5','Preguntas de diagnóstico','Cómo descubrir problemas productivos y económicos.',35],
        ['l6','Gestión de prospectos y seguimiento','Embudo, priorización y disciplina comercial.',30]]],
      ['m3','Propuesta de valor y presentación de soluciones','Transformar características técnicas en resultados comprensibles y medibles.',3,[
        ['l7','Construcción de propuestas de valor','Beneficios agronómicos, económicos y operativos.',35],
        ['l8','Demostraciones y evidencia','Ensayos, casos, testimonios y datos para reducir incertidumbre.',30],
        ['l9','Presentaciones comerciales de alto impacto','Estructura narrativa para reuniones, campo y entornos virtuales.',30]]],
      ['m4','Negociación y manejo de objeciones','Herramientas para conversar sobre precio, competencia, crédito y resultados.',4,[
        ['l10','Objeciones frecuentes en el agro','Precio, desconfianza, experiencias previas y resistencia al cambio.',35],
        ['l11','Negociación basada en valor','Concesiones, condiciones, margen y acuerdos sostenibles.',35],
        ['l12','Crédito, cartera y condiciones de pago','Cómo vender sin comprometer la salud financiera.',30]]],
      ['m5','Cierre de negocios agrícolas','Técnicas éticas para convertir decisiones en acuerdos concretos.',5,[
        ['l13','Señales de compra y momentos de cierre','Cómo reconocer avance, interés y decisión.',30],
        ['l14','Técnicas de cierre consultivo','Cierre por plan, alternativa, prueba y compromiso.',35],
        ['l15','Formalización, posventa y recompra','Pedidos, implementación, seguimiento y fidelización.',30]]],
      ['m6','Dirección y escalamiento comercial','Construcción de sistemas de venta repetibles para equipos y territorios.',6,[
        ['l16','Indicadores comerciales agrícolas','Conversión, ticket, ciclo, margen, cartera y recurrencia.',30],
        ['l17','Gestión de territorios y canales','Rutas, distribuidores, alianzas y cobertura.',35],
        ['l18','Plan comercial de 90 días','Diseño del sistema personal o empresarial de ejecución.',40]]]
    ];
    for (const [mid,titulo,desc,orden,lecciones] of modulos){
      db.prepare('INSERT INTO curso_modulos (id,curso_id,titulo,descripcion,orden) VALUES (?,?,?,?,?)').run(mid,cursoId,titulo,desc,orden);
      for (let i=0;i<lecciones.length;i++){const [lid,lt,ld,dur]=lecciones[i];db.prepare('INSERT INTO curso_lecciones (id,modulo_id,titulo,descripcion,duracion_min,contenido,orden) VALUES (?,?,?,?,?,?,?)').run(lid,mid,lt,ld,dur,`Contenido de ${lt}.`,i+1);}
    }
  }); tx();
}

console.log(`Base de datos activa: ${DB_PATH}`);
module.exports = db;
