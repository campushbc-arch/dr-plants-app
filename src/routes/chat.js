const express = require('express');
const fs = require('fs');
const db = require('../db');
const { nuevoId, requiereAuth } = require('../auth');
const { crearNotificacionAdmin } = require('../notificaciones');

const router = express.Router();

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const WEB_SEARCH_ENABLED = String(process.env.ANTHROPIC_WEB_SEARCH_ENABLED || 'false').toLowerCase() === 'true';
const AI_TIMEOUT_MS = Math.max(10000, Number(process.env.AI_TIMEOUT_MS) || 45000);

router.get('/status', requiereAuth, (req, res) => {
  res.json({
    ok: Boolean(process.env.ANTHROPIC_API_KEY),
    provider: 'anthropic',
    model: ANTHROPIC_MODEL,
    webSearch: WEB_SEARCH_ENABLED
  });
});

// POST /api/chat
// Esta es la ruta que resuelve el hueco de seguridad del prototipo: en el HTML, Dr. Agro,
// Soporte y Laboratorio llamaban DIRECTO a api.anthropic.com sin ninguna llave — algo que
// solo funcionaba dentro de la vista previa de Claude.ai. Aquí la llave real vive SOLO en
// el servidor (variable de entorno ANTHROPIC_API_KEY), nunca en el navegador.
//
// En el frontend, esto significa cambiar la función `llamarClaudeAPI()` de dr_plants_v4.html
// para que llame a este endpoint en vez de api.anthropic.com directamente, mandando el
// token de sesión (Authorization: Bearer <token>) en vez de nada.
router.post('/', requiereAuth, async (req, res) => {
  const { system, messages, modulo, archivoIds = [] } = req.body;
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'Falta el arreglo "messages".' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'El servidor no tiene configurada ANTHROPIC_API_KEY. Revisa el .env.' });
  }

  const inicioMs = Date.now();
  try {
    let mensajesProveedor = messages;
    if (Array.isArray(archivoIds) && archivoIds.length) {
      const adjuntos = archivoIds.slice(0, 3).map(id => db.prepare('SELECT * FROM archivos_usuario WHERE id=? AND usuario_id=?').get(id, req.usuario.id)).filter(Boolean);
      const ultimo = messages[messages.length - 1];
      const bloques = [{ type: 'text', text: typeof ultimo.content === 'string' ? ultimo.content : 'Analiza los documentos adjuntos.' }];
      for (const a of adjuntos) {
        if (a.mime_type === 'application/pdf' && fs.existsSync(a.ruta)) {
          bloques.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(a.ruta).toString('base64') }, title: a.nombre_original });
        }
      }
      mensajesProveedor = [...messages.slice(0, -1), { role: 'user', content: bloques }];
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    const requestBody = {
      model: ANTHROPIC_MODEL,
      max_tokens: 600,
      system: typeof system === 'string' ? system.slice(0, 30000) : '',
      messages: mensajesProveedor
    };
    // La búsqueda web es opcional: puede generar cargos adicionales y respuestas pause_turn.
    if (WEB_SEARCH_ENABLED) {
      requestBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }];
    }

    let respuesta;
    try {
      respuesta = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(requestBody)
      });
    } finally {
      clearTimeout(timeout);
    }

    const data = await respuesta.json().catch(() => ({}));

    // Los errores de Anthropic no son errores de sesión de Dr Plants. Normalizamos
    // el mensaje y respondemos 502 para que el frontend no cierre la sesión del usuario.
    if (!respuesta.ok) {
      const detalleProveedor =
        (typeof data?.error === 'string' && data.error) ||
        data?.error?.message ||
        data?.message ||
        `Anthropic respondió con estado ${respuesta.status}.`;

      console.error('Error de Anthropic:', respuesta.status, detalleProveedor);
      return res.status(502).json({
        code: 'AI_PROVIDER_ERROR',
        error: detalleProveedor,
        providerStatus: respuesta.status
      });
    }

    // Guarda el historial real en la base de datos, asociado al usuario autenticado.
    if (modulo && ['dr_agro', 'soporte', 'laboratorio'].includes(modulo)) {
      guardarEnHistorial(req.usuario.id, modulo, messages, data, archivoIds, Date.now()-inicioMs);
    }

    res.json(data);
  } catch (err) {
    console.error('Error llamando a la API de Claude:', err);
    const timeout = err?.name === 'AbortError';
    res.status(timeout ? 504 : 502).json({
      code: timeout ? 'AI_TIMEOUT' : 'AI_CONNECTION_ERROR',
      error: timeout ? 'Dr. Plants tardó demasiado en responder. Intenta nuevamente.' : 'No se pudo contactar al asistente de IA en este momento.'
    });
  }
});

function guardarEnHistorial(usuarioId, modulo, messages, data, archivoIds = [], duracionMs = null) {
  let conv = db.prepare(
    'SELECT * FROM conversaciones_ia WHERE usuario_id = ? AND modulo = ? ORDER BY creado_en DESC LIMIT 1'
  ).get(usuarioId, modulo);

  if (!conv) {
    const id = nuevoId('conv');
    db.prepare('INSERT INTO conversaciones_ia (id, usuario_id, modulo) VALUES (?, ?, ?)').run(id, usuarioId, modulo);
    conv = { id };
  }

  if (Array.isArray(archivoIds)) {
    const insertAdjunto = db.prepare('INSERT OR IGNORE INTO conversacion_archivos (conversacion_id, archivo_id) SELECT ?, id FROM archivos_usuario WHERE id=? AND usuario_id=?');
    for (const archivoId of archivoIds.slice(0, 3)) insertAdjunto.run(conv.id, archivoId, usuarioId);
  }

  const ultimoMensajeUsuario = messages[messages.length - 1];
  if (ultimoMensajeUsuario?.role === 'user') {
    db.prepare('INSERT INTO mensajes (id, conversacion_id, rol, contenido) VALUES (?, ?, ?, ?)')
      .run(nuevoId('msg'), conv.id, 'user', String(ultimoMensajeUsuario.content));
  }

  const textoRespuesta = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n\n');
  if (textoRespuesta) {
    db.prepare('INSERT INTO mensajes (id, conversacion_id, rol, contenido) VALUES (?, ?, ?, ?)')
      .run(nuevoId('msg'), conv.id, 'assistant', textoRespuesta);
  }

  const pregunta = ultimoMensajeUsuario?.role === 'user'
    ? (typeof ultimoMensajeUsuario.content === 'string' ? ultimoMensajeUsuario.content : JSON.stringify(ultimoMensajeUsuario.content))
    : '';
  db.prepare(`INSERT INTO auditoria_ia
    (id,conversacion_id,usuario_id,modulo,pregunta,respuesta,archivo_ids_json,modelo,tokens_entrada,tokens_salida,duracion_ms,estado)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'completado')`).run(
      nuevoId('aia'), conv.id, usuarioId, modulo, pregunta, textoRespuesta,
      JSON.stringify(Array.isArray(archivoIds)?archivoIds:[]), data.model || ANTHROPIC_MODEL,
      data.usage?.input_tokens ?? null, data.usage?.output_tokens ?? null, duracionMs
    );
  if (modulo === 'laboratorio') {
    crearNotificacionAdmin({ tipo:'analisis_ia_laboratorio', titulo:'Nuevo análisis en Laboratorio', mensaje:`Un usuario realizó una consulta de laboratorio con IA${archivoIds?.length ? ` y adjuntó ${archivoIds.length} archivo(s)` : ''}.`, usuarioId, entidadTipo:'conversacion_ia', entidadId:conv.id, prioridad:'alta' });
  }
}

module.exports = router;
