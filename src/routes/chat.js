const express = require('express');
const fs = require('fs');
const db = require('../db');
const { nuevoId, requiereAuth } = require('../auth');

const router = express.Router();

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
    const respuesta = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system,
        messages: mensajesProveedor,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });

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
      guardarEnHistorial(req.usuario.id, modulo, messages, data);
    }

    res.json(data);
  } catch (err) {
    console.error('Error llamando a la API de Claude:', err);
    res.status(502).json({ error: 'No se pudo contactar a la API de Claude en este momento.' });
  }
});

function guardarEnHistorial(usuarioId, modulo, messages, data) {
  let conv = db.prepare(
    'SELECT * FROM conversaciones_ia WHERE usuario_id = ? AND modulo = ? ORDER BY creado_en DESC LIMIT 1'
  ).get(usuarioId, modulo);

  if (!conv) {
    const id = nuevoId('conv');
    db.prepare('INSERT INTO conversaciones_ia (id, usuario_id, modulo) VALUES (?, ?, ?)').run(id, usuarioId, modulo);
    conv = { id };
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
}

module.exports = router;
