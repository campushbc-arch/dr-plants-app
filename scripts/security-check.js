const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');
const failures = [];
if (String(pkg.dependencies?.nodemailer || '').match(/^[~^]?6\./)) failures.push('Nodemailer 6.x no está permitido.');
for (const name of ['helmet','express-rate-limit','hpp']) if (!pkg.dependencies?.[name]) failures.push(`Falta ${name}.`);
for (const file of ['src/security.js','src/validation.js','src/audit.js']) if (!fs.existsSync(path.join(__dirname,'..',file))) failures.push(`Falta ${file}.`);
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('Verificación estática de seguridad: OK');
