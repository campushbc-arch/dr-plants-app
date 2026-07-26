# Dr. Plants V6 — Asistente IA estable

Esta versión combina la corrección del botón de envío con una normalización completa de las respuestas de IA.

## Correcciones principales

- El frontend usa `reply` y nunca muestra campos técnicos como `model`.
- El backend extrae únicamente bloques de texto válidos de Anthropic.
- Manejo explícito de respuestas vacías, timeout, límites y rechazos.
- La sesión no se elimina por fallos del proveedor de IA.
- Historial y auditoría guardan la respuesta natural y dejan el nombre del modelo solo para administración.
- Fallback opcional a OpenAI cuando Anthropic falla y `OPENAI_API_KEY` está configurada.
- El fallback no se activa si no existe esa llave.

## Variables

Obligatoria para Anthropic:

```env
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

Recomendadas:

```env
AI_TIMEOUT_MS=45000
AI_MAX_TOKENS=1200
AI_FALLBACK_ENABLED=true
```

Fallback opcional:

```env
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5-mini
```

No agregues `OPENAI_API_KEY` si no deseas usar ni pagar un segundo proveedor.
