# Desplegar Dr Plants en drplants.campushbc.com (Hostinger)

Este paquete es **una sola aplicación Node.js** que sirve el frontend y el backend juntos,
desde el mismo dominio — así evitas configurar dos sitios distintos y no hay problemas de
CORS entre frontend y API. Ya lo probé de punta a punta en mi entorno antes de entregarlo:
arranca, siembra los datos de ejemplo automáticamente la primera vez, sirve la app en `/`
y la API en `/api/...`, y no vuelve a duplicar los datos si reinicias el servidor.

## Requisito de plan en Hostinger

Necesitas un plan que soporte **Node.js Web App**: Business o superior en hosting web
normal, Cloud hosting, o un VPS. Si tu plan actual es Premium/Single (sin Node.js), vas a
necesitar subir de plan o mover esto a un VPS — el hosting compartido básico de Hostinger
no ejecuta Node.js.

## Paso 1 — Crear el subdominio y la app Node.js

1. Entra a **hPanel** → **Websites** → **Add website**
2. Elige **Node.js Web App** (si tu plan es Business+ en hosting normal, aparece esta opción directamente; en Cloud/VPS puede llamarse distinto, busca "Deploy Web App")
3. Cuando te pida el dominio, escribe `drplants.campushbc.com` (Hostinger lo crea como subdominio de `campushbc.com`, asumiendo que ese dominio ya está en tu cuenta)
4. Selecciona **Node.js versión 20 o superior**

## Paso 2 — Subir el código

Tienes dos formas, usa la que te resulte más simple:

**Opción A — Subir el ZIP directo (más simple):**
1. En el flujo de creación de la app, elige **Upload ZIP file**
2. Sube `dr-plants-deploy.zip` (el archivo que te entregué)
3. Como carpeta raíz de la aplicación (**Application root**), deja la que contiene `package.json` — si el ZIP se descomprime en una subcarpeta, apunta ahí
4. Comando de arranque: `npm start` (ya está definido en `package.json`, normalmente Hostinger lo detecta solo)

**Opción B — Conectar un repositorio de GitHub (recomendada si vas a seguir haciendo cambios):**

Cada vez que hagas `git push`, Hostinger puede redesplegar la app sola — no tienes que
volver a subir un ZIP manualmente cada vez que ajustemos algo.

1. Crea un repositorio nuevo en GitHub (puede ser privado, Hostinger lo soporta igual)
2. En tu máquina, dentro de esta carpeta que te entregué, corre:
   ```bash
   git init
   git add .
   git commit -m "Dr Plants - primer despliegue"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git push -u origin main
   ```
   El `.gitignore` que incluí ya excluye `node_modules/`, `data/` (la base de datos) y
   `.env` — **nunca subas tu `.env` real a GitHub**, ese archivo solo debe existir en
   Hostinger, cargado a mano en Environment Variables.
3. En hPanel, al crear la app Node.js, elige **conectar GitHub** en vez de subir ZIP,
   autoriza el acceso, y selecciona el repositorio y la rama `main`
4. Configura las variables de entorno igual que en la Opción A (paso 3 de esta guía) —
   esto se hace siempre en hPanel, nunca en el repositorio
5. Cada `git push` a `main` dispara un redespliegue automático

## Paso 3 — Variables de entorno (obligatorio antes de arrancar)

En el dashboard de tu app Node.js en hPanel, busca **Environment Variables** y agrega:

| Variable | Valor |
|---|---|
| `JWT_SECRET` | Genera uno único — no uses el de ejemplo. Puedes pedirme que te genere uno, o correr `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` en cualquier terminal con Node |
| `ANTHROPIC_API_KEY` | Tu llave real de la API de Anthropic (console.anthropic.com) |
| `CORS_ORIGIN` | `https://drplants.campushbc.com` |
| `PORT` | Normalmente Hostinger lo asigna solo; si te pide uno, usa `3000` |

**Sin `JWT_SECRET` la app no arranca — es intencional, para que nunca quede corriendo con
una llave insegura por defecto.** Sin `ANTHROPIC_API_KEY`, la app sí arranca, pero Dr. Agro,
Soporte y el Laboratorio no van a poder responder.

## Paso 4 — Desplegar y verificar

1. Dale a **Deploy** / **Start Deployment**
2. Espera a que termine (instala dependencias y arranca `npm start`)
3. Entra a `https://drplants.campushbc.com` — deberías ver la carátula de bienvenida
4. Primer arranque: la app siembra sola los datos de ejemplo (4 fincas, 12 lotes, catálogo).
   Lo vas a ver en los **logs de despliegue** del dashboard: *"Datos de demostración cargados."*
5. Prueba entrar como admin: usuario `AGROCAMPUS`, contraseña `Globallabs12`

## Sobre el certificado SSL

Hostinger emite SSL gratis (Let's Encrypt) automáticamente para subdominios en cuanto el
DNS apunta correctamente — normalmente no tienes que hacer nada, pero si `https://` no
carga apenas despliegas, revisa en hPanel → **SSL** que esté activo para ese subdominio.

## Qué pasa con la base de datos

Este paquete usa SQLite (un archivo, no un servidor de base de datos aparte) — se crea
solo en `data/drplants.db` la primera vez que arranca. Es perfecto para empezar; el único
cuidado real es que **si tu plan de Hostinger borra o reinicia el sistema de archivos en
cada despliegue** (algunos planes administrados lo hacen), perderías los datos con cada
redeploy. Si notas eso, dímelo y migramos a una base de datos externa (Postgres gestionado,
por ejemplo) — el SQL en `src/db/schema.sql` ya es estándar y el cambio es directo.

## Si algo no arranca

Revisa primero los **logs de despliegue** en el dashboard de la app Node.js — casi siempre
dicen exactamente qué falta (una variable de entorno, un puerto ocupado, etc.). Si me
pegas ese log, te ayudo a interpretarlo.

**Si la subida del ZIP falla con "Unsupported framework or invalid project structure"**
antes de siquiera llegar a la pantalla de configuración: es un problema de cómo Hostinger
valida el archivo comprimido, no de tu código (ya lo probamos exhaustivamente). En ese
caso, usa la opción **"Import Git repository"** en vez de subir el ZIP — Hostinger la
marca como "Recommended" y lee el código directo del repositorio, sin ese paso de
validación de archivo comprimido. Los pasos para eso están en la sección de arriba
("Opción B — Conectar un repositorio de GitHub").

Si llegas a la pantalla de configuración y te pide **Entry file**, debe decir `app.js`
(así está definido en este paquete). Si el desplegable de **Framework preset** no detecta
"Express" solo, selecciónalo manualmente — Hostinger lo soporta explícitamente.
