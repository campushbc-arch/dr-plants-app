const express = require('express');
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
  const { system, messages, modulo } = req.body;
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'Falta el arreglo "messages".' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'El servidor no tiene configurada ANTHROPIC_API_KEY. Revisa el .env.' });
  }

  try {
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
        messages,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });

    const data = await respuesta.json();

    // Guarda el historial real en la base de datos, asociado al usuario autenticado —
    // esto es lo que en el prototipo vivía solo en `drAgroHistory`/`soporteHistory`/`labHistory`
    // en memoria del navegador y se perdía al recargar.
    if (modulo && ['dr_agro', 'soporte', 'laboratorio'].includes(modulo)) {
      guardarEnHistorial(req.usuario.id, modulo, messages, data);
    }

    res.status(respuesta.status).json(data);
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
