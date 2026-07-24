// Carga los mismos datos de demostración que ya tenía el prototipo en dr_plants_v4.html
// (4 fincas, 12 lotes, catálogo real de CampusHBC). Se puede correr manualmente con
// "npm run seed", o se llama automáticamente desde server.js si la base está vacía.
const bcrypt = require('bcryptjs');
const db = require('./index');
const { nuevoId } = require('../auth');

function isoDaysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function seedSiVacio() {
  const yaHayDatos = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n > 0;
  if (yaHayDatos) {
    console.log('Ya hay datos en la base — no se vuelve a sembrar.');
    return false;
  }

  const demoPassword = process.env.DEMO_PASSWORD;
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  const productor = { id: nuevoId('usr'), nombre: 'Productor Demo' };
  db.prepare(`
    INSERT INTO usuarios (id, nombre, email, telefono, password_hash, rol, tipo_productor, pais, region)
    VALUES (?, ?, ?, ?, ?, 'agricultor', 'Mediano productor (5 a 50 ha)', 'Colombia', 'Multi-región demo')
  `).run(
    productor.id,
    productor.nombre,
    'productor.demo@drplants.co',
    '+57 300 000 0000',
    bcrypt.hashSync(demoPassword || nuevoId('pwd'), 12)
  );

  // El administrador se crea únicamente con credenciales privadas configuradas en Hostinger.
  if (!adminUsername || !adminPassword) {
    throw new Error('Faltan ADMIN_USERNAME y ADMIN_PASSWORD en las variables de entorno.');
  }
  const admin = { id: nuevoId('usr'), nombre: 'Administrador Campus HBC' };
  db.prepare(`
    INSERT INTO usuarios (id, nombre, email, telefono, password_hash, rol)
    VALUES (?, ?, ?, ?, ?, 'admin')
  `).run(admin.id, admin.nombre, adminUsername, '+57 316 691 2983', bcrypt.hashSync(adminPassword, 12));

  const FINCAS = [
    { nombre: 'Finca La Esperanza', ubicacionId: 'pasto', lotes: [
      { nombre: 'Lote Alto Nariño', cultivoId: 'papa', areaHa: 5, fechaSiembra: isoDaysAgo(70), salud: 89 },
      { nombre: 'Lote Bajo Nariño', cultivoId: 'papa', areaHa: 3.2, fechaSiembra: isoDaysAgo(18), salud: 92 },
      { nombre: 'Lote Aguacate Andino', cultivoId: 'aguacate', areaHa: 2, fechaSiembra: isoDaysAgo(180), salud: 85 }
    ]},
    { nombre: 'Finca El Cafetal', ubicacionId: 'medellin', lotes: [
      { nombre: 'Lote Cafetal Norte', cultivoId: 'cafe', areaHa: 4, fechaSiembra: isoDaysAgo(150), salud: 91 },
      { nombre: 'Lote Cafetal Sur', cultivoId: 'cafe', areaHa: 3.5, fechaSiembra: isoDaysAgo(300), salud: 88 },
      { nombre: 'Lote Aguacate Cafetero', cultivoId: 'aguacate', areaHa: 2.5, fechaSiembra: isoDaysAgo(400), salud: 90 }
    ]},
    { nombre: 'Finca Río Seco', ubicacionId: 'espinal', lotes: [
      { nombre: 'Lote Arrozal 1', cultivoId: 'arroz', areaHa: 8, fechaSiembra: isoDaysAgo(60), salud: 87 },
      { nombre: 'Lote Arrozal 2', cultivoId: 'arroz', areaHa: 6, fechaSiembra: isoDaysAgo(15), salud: 93 },
      { nombre: 'Lote Mango Seco', cultivoId: 'mango', areaHa: 3, fechaSiembra: isoDaysAgo(250), salud: 84 }
    ]},
    { nombre: 'Finca Costa Verde', ubicacionId: 'cartagena', lotes: [
      { nombre: 'Lote Cañaduzal', cultivoId: 'cana', areaHa: 10, fechaSiembra: isoDaysAgo(180), salud: 90 },
      { nombre: 'Lote Limonar Costa', cultivoId: 'limon', areaHa: 4, fechaSiembra: isoDaysAgo(220), salud: 86 },
      { nombre: 'Lote Mango Costero', cultivoId: 'mango', areaHa: 5, fechaSiembra: isoDaysAgo(90), salud: 91 }
    ]}
  ];

  for (const f of FINCAS) {
    const fincaId = nuevoId('finca');
    db.prepare('INSERT INTO fincas (id, productor_id, nombre, ubicacion_id) VALUES (?,?,?,?)')
      .run(fincaId, productor.id, f.nombre, f.ubicacionId);
    for (const l of f.lotes) {
      const loteId = nuevoId('lote');
      db.prepare('INSERT INTO lotes (id, finca_id, nombre, cultivo_id, area_ha, fecha_siembra, salud_pct) VALUES (?,?,?,?,?,?,?)')
        .run(loteId, fincaId, l.nombre, l.cultivoId, l.areaHa, l.fechaSiembra, l.salud);
    }
  }

  const CATEGORIAS = [
    { id: 'campushbc', label: 'Línea CampusHBC' },
    { id: 'semillas', label: 'Semillas' },
    { id: 'insecticidas', label: 'Insecticidas' }
  ];
  for (const c of CATEGORIAS) {
    db.prepare('INSERT INTO categorias (id, label) VALUES (?, ?)').run(c.id, c.label);
  }

  const PRODUCTOS = [
    { nombre: 'RAIZCAMPUS', formula: '12-24-12', tag: 'Etapa: Raíz', precio: 92000, unidad: 'por bulto 25kg', icono: 'ti-seedling', destacado: 1 },
    { nombre: 'CRECICAMPUS', formula: '18-12-18', tag: 'Etapa: Crecimiento', precio: 88000, unidad: 'por bulto 25kg', icono: 'ti-plant-2', destacado: 1 },
    { nombre: 'PRODUCAMPUS', formula: '10-8-26', tag: 'Etapa: Floración y llenado', precio: 105000, unidad: 'por bulto 25kg', icono: 'ti-apple', destacado: 1 },
    { nombre: 'Biocampus', formula: null, tag: 'Materia orgánica', precio: 135000, unidad: 'por bulto 25kg', icono: 'ti-recycle', destacado: 1 },
    { nombre: 'Leonardita', formula: null, tag: 'Acondicionador orgánico', precio: 165000, unidad: 'por bulto 50kg', icono: 'ti-shovel', destacado: 1 }
  ];
  for (const p of PRODUCTOS) {
    db.prepare(`
      INSERT INTO productos (id, nombre, formula, categoria_id, tag, descripcion, precio_cop, unidad, icono, destacado)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(nuevoId('prod'), p.nombre, p.formula, 'campushbc', p.tag, '', p.precio, p.unidad, p.icono, p.destacado);
  }

  console.log('Datos iniciales creados correctamente.');
  if (demoPassword) console.log('La cuenta de demostración quedó habilitada.');
  return true;
}

module.exports = { seedSiVacio };

// Permite seguir corriendo "npm run seed" manualmente además de la siembra automática.
if (require.main === module) {
  require('dotenv').config();
  seedSiVacio();
}
