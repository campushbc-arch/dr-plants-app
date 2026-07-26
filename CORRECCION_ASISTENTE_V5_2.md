# Corrección del asistente Dr. Plants V5.2

- Modelo Anthropic configurable por variable de entorno.
- Modelo predeterminado estable: `claude-sonnet-4-20250514`.
- Búsqueda web desactivada por defecto para evitar cargos y respuestas `pause_turn`.
- Tiempo máximo de respuesta configurable.
- Endpoint de diagnóstico autenticado: `GET /api/chat/status`.
- El frontend ya no impone modelo ni herramientas.
- Los errores de IA no cierran la sesión del usuario.

Variables recomendadas:

```env
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-20250514
ANTHROPIC_WEB_SEARCH_ENABLED=false
AI_TIMEOUT_MS=45000
```
