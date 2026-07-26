# Dr. Plants V6.1 — estabilidad y diseño adaptable

## Correcciones funcionales
- Sesión renovable antes de mostrar un falso cierre de sesión.
- Reintento automático de la consulta IA cuando expira el token de acceso.
- Dr. Agro, Laboratorio y Soporte usan formularios reales con botón `submit` y tecla Enter.
- Identificación correcta del módulo de soporte (`schat` → `soporte`).
- La respuesta visible usa `reply`; los datos técnicos del modelo permanecen fuera del chat.
- Se eliminó del saludo el mensaje fijo que pedía registrarse a usuarios ya autenticados.

## Renovación visual
- Tipografía y controles más grandes.
- Diseño moderno con gradientes, profundidad y superficies translúcidas.
- Adaptación desde teléfonos pequeños hasta tabletas y escritorio.
- Áreas táctiles mínimas de 44–48 px.
- Respeto por áreas seguras de iPhone y preferencia de movimiento reducido.
- Zoom del navegador habilitado para accesibilidad.

## Pruebas después del despliegue
1. Iniciar sesión una sola vez.
2. Enviar preguntas en Dr. Agro, Laboratorio y Soporte usando botón y Enter.
3. Dejar vencer o reemplazar un token y comprobar que la consulta se reintenta sin sacar al usuario.
4. Probar en móvil, tableta y computador.
5. Hacer recarga forzada o desinstalar/reinstalar la PWA si conserva una versión anterior.
