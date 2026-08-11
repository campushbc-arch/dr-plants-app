# Dr. Plants V8C.5 — Roles empresariales, Demo Studio y panel ERP

## Roles empresariales
- **Super Administrador:** acceso ilimitado a Cultivo Professional, sin suscripción ni límites de hectáreas. Puede asignar roles empresariales e ingresar temporalmente como un usuario para soporte/demostración. La acción queda registrada en auditoría.
- **Administrador operativo:** rol empresarial preparado para delegación operativa. No obtiene las facultades exclusivas del Super Administrador.
- **Ejecutivo comercial:** no requiere suscripción, puede usar Demo Studio y trabaja con sus propios datos de demostración. No recibe permisos para entrar al panel administrativo ni consultar pagos/documentos de otros usuarios.

## Demo Studio
Incluye escenarios para café, caña, cacao, arroz, maíz, banano, aguacate y palma. Se puede indicar hectáreas, cliente, finca, país/región/ciudad y la necesidad principal del prospecto.

Los datos generados se identifican con `es_demo=1`, y pueden eliminarse con “Restablecer mis datos demo” sin borrar fincas reales.

El Super Administrador también puede cargar una biblioteca comercial ampliada de 50 clientes, 120 fincas y hasta 350 lotes, con aplicaciones, análisis y costos de ejemplo.

## Impersonación segura
“Entrar como” genera un token temporal para el usuario seleccionado, conserva el token del Super Administrador solo en `sessionStorage` y muestra una banda visible para volver a la sesión administrativa. No revela ni modifica la contraseña del usuario.

## Panel administrativo ERP
El panel se reorganizó con navegación lateral por módulos: Resumen, Alertas, Usuarios y roles, Suscripciones, Operación, Formación, IA y conocimiento, y Demostraciones. Incluye búsqueda global de usuarios y un espacio específico para administrar demos.

## Seguridad y privacidad
Los ejecutivos comerciales no obtienen rol `admin`. Los endpoints administrativos continúan protegidos por autenticación y rol administrador. Los datos demo quedan lógicamente separados mediante `es_demo` y el reset solo borra esos registros.
