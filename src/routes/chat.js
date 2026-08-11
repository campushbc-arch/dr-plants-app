const express = require('express');
const fs = require('fs');
const db = require('../db');
const { nuevoId, requiereAuth } = require('../auth');
const { crearNotificacionAdmin } = require('../notificaciones');

const router = express.Router();

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const AI_TIMEOUT_MS = Math.max(10000, Number(process.env.AI_TIMEOUT_MS) || 45000);
const AI_MAX_TOKENS = Math.max(300, Math.min(3000, Number(process.env.AI_MAX_TOKENS) || 1200));
const FALLBACK_ENABLED = String(process.env.AI_FALLBACK_ENABLED || 'true').toLowerCase() === 'true';

router.get('/status', requiereAuth, (req, res) => {
  res.json({
    ok: Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY),
    primaryProvider: process.env.ANTHROPIC_API_KEY ? 'anthropic' : (process.env.OPENAI_API_KEY ? 'openai' : null),
    fallbackAvailable: Boolean(FALLBACK_ENABLED && process.env.OPENAI_API_KEY),
    requestId: req.requestId
  });
});

router.post('/', requiereAuth, async (req, res) => {
  const { system, messages, modulo, archivoIds = [] } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ code: 'INVALID_MESSAGES', error: 'Falta el arreglo de mensajes.' });
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    return res.status(500).json({ code: 'AI_NOT_CONFIGURED', error: 'El asistente no tiene una llave de IA configurada.' });
  }

  const inicioMs = Date.now();
  const mensajesNormalizados = normalizarMensajes(messages);
  const systemEnriquecido = modulo === 'dr_agro' ? enriquecerSystemAgronomico(req.usuario, system, mensajesNormalizados) : system;
  const adjuntos = obtenerAdjuntos(req.usuario.id, archivoIds);
  let resultado;
  let errores = [];

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      resultado = await consultarAnthropic({ system: systemEnriquecido, messages: mensajesNormalizados, adjuntos });
    } catch (error) {
      errores.push(error);
      console.error('Anthropic falló:', error.message);
    }
  }

  if (!resultado && FALLBACK_ENABLED && process.env.OPENAI_API_KEY) {
    try {
      resultado = await consultarOpenAI({ system: systemEnriquecido, messages: mensajesNormalizados });
    } catch (error) {
      errores.push(error);
      console.error('OpenAI fallback falló:', error.message);
    }
  }

  if (!resultado) {
    const ultimo = errores[errores.length - 1];
    return res.status(502).json({
      code: ultimo?.code || 'AI_PROVIDER_ERROR',
      error: ultimo?.publicMessage || 'El asistente no pudo responder en este momento. Intenta nuevamente.',
      requestId: req.requestId
    });
  }

  if (modulo && ['dr_agro', 'soporte', 'laboratorio'].includes(modulo)) {
    try {
      guardarEnHistorial(req.usuario.id, modulo, messages, resultado, archivoIds, Date.now() - inicioMs);
    } catch (error) {
      console.error('No se pudo guardar el historial IA:', error);
    }
  }

  return res.json({
    ok: true,
    reply: resultado.text,
    content: [{ type: 'text', text: resultado.text }],
    provider: resultado.provider,
    stopReason: resultado.stopReason || 'end_turn',
    usage: resultado.usage || null,
    requestId: req.requestId
  });
});


function enriquecerSystemAgronomico(usuario, system, messages) {
  try {
    const lotes = db.prepare(`SELECT l.id,l.nombre,l.cultivo_id,l.cultivo_nombre,l.variedad,l.area_ha,l.etapa_fenologica,l.rendimiento_objetivo_ha,
      f.nombre finca_nombre,f.pais,f.region,f.ciudad,COALESCE(c.nombre,f.cliente_nombre_cache) cliente_nombre
      FROM lotes l JOIN fincas f ON f.id=l.finca_id LEFT JOIN clientes_agronomicos c ON c.id=f.cliente_id
      WHERE l.eliminado_en IS NULL AND f.eliminado_en IS NULL
      AND (?='admin' OR f.productor_id=? OR f.gestor_id=? OR EXISTS(SELECT 1 FROM agronomo_asignacion a WHERE a.finca_id=f.id AND a.agronomo_id=?))
      ORDER BY l.actualizado_en DESC,l.creado_en DESC LIMIT 30`).all(usuario.rol,usuario.id,usuario.id,usuario.id);
    const resumen = lotes.map(l => {
      const snap=db.prepare('SELECT payload_json FROM clima_lote_snapshots WHERE lote_id=? ORDER BY creado_en DESC LIMIT 1').get(l.id);
      let c=null;try{c=snap?JSON.parse(snap.payload_json):null}catch(e){}
      const r=c?.resumen7d;
      return `${l.cliente_nombre?`Cliente ${l.cliente_nombre} · `:''}${l.finca_nombre} · ${l.nombre}: ${l.cultivo_nombre||l.cultivo_id}${l.variedad?' '+l.variedad:''}, ${l.area_ha} ha${l.etapa_fenologica?`, etapa ${l.etapa_fenologica}`:''}${r?`, lluvia7d ${r.precipitacionMm} mm, balance hídrico ${r.balanceHidricoMm} mm, riesgo hídrico ${r.riesgoHidrico}, riesgo térmico ${r.riesgoTermico}`:''}.`;
    }).join('\n');
    const ultimaPregunta=messages.filter(m=>m.role==='user').slice(-1)[0]?.content||'';
    const palabras=String(ultimaPregunta).toLowerCase().split(/[^a-záéíóúñ0-9]+/).filter(x=>x.length>4).slice(0,8);
    let conocimientos=[];
    if(palabras.length){
      const rows=db.prepare('SELECT titulo,cultivo,categoria,resumen,contenido,fuente FROM conocimiento_agronomico WHERE activo=1 ORDER BY prioridad DESC,actualizado_en DESC LIMIT 80').all();
      conocimientos=rows.filter(x=>{const t=`${x.titulo} ${x.cultivo||''} ${x.categoria||''} ${x.resumen||''}`.toLowerCase();return palabras.some(w=>t.includes(w));}).slice(0,4);
    }
    const kb=conocimientos.map(x=>`• ${x.titulo}${x.fuente?' ('+x.fuente+')':''}: ${(x.resumen||x.contenido||'').slice(0,1200)}`).join('\n');
    const extra=`\n\nCONTEXTO V8B DISPONIBLE EN DR. PLANTS (datos del usuario, úsalo solo cuando sea pertinente):\n${resumen||'No hay lotes registrados.'}${kb?`\n\nBASE DE CONOCIMIENTO VALIDADA POR EL ADMINISTRADOR:\n${kb}`:''}\n\nReglas: distingue datos medidos de modelos; no presentes proyecciones como garantías; para recomendaciones de dosis o fitosanitarios pide análisis y contexto técnico suficiente.`;
    return `${typeof system==='string'?system:''}${extra}`.slice(0,30000);
  } catch(e) {
    console.error('No se pudo enriquecer el contexto V8B:',e.message);
    return system;
  }
}

function normalizarMensajes(messages) {
  return messages.slice(-20).map(m => ({
    role: m?.role === 'assistant' ? 'assistant' : 'user',
    content: typeof m?.content === 'string' ? m.content.slice(0, 20000) : JSON.stringify(m?.content || '').slice(0, 20000)
  }));
}

function obtenerAdjuntos(usuarioId, archivoIds) {
  if (!Array.isArray(archivoIds) || !archivoIds.length) return [];
  return archivoIds.slice(0, 3)
    .map(id => db.prepare('SELECT * FROM archivos_usuario WHERE id=? AND usuario_id=?').get(id, usuarioId))
    .filter(Boolean);
}

async function consultarAnthropic({ system, messages, adjuntos }) {
  const proveedorMessages = [...messages];
  if (adjuntos.length) {
    const ultimo = proveedorMessages[proveedorMessages.length - 1];
    const bloques = [{ type: 'text', text: ultimo?.content || 'Analiza los documentos adjuntos.' }];
    for (const a of adjuntos) {
      if (a.mime_type === 'application/pdf' && a.ruta && fs.existsSync(a.ruta)) {
        bloques.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(a.ruta).toString('base64') },
          title: a.nombre_original || 'Documento'
        });
      }
    }
    proveedorMessages[proveedorMessages.length - 1] = { role: 'user', content: bloques };
  }

  const data = await fetchJsonConTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: AI_MAX_TOKENS,
      system: typeof system === 'string' ? system.slice(0, 30000) : '',
      messages: proveedorMessages
    })
  });

  if (!data.ok) throw crearErrorProveedor('ANTHROPIC_ERROR', data.status, data.body);
  const body = data.body || {};
  const text = extraerTextoAnthropic(body);
  if (!text) {
    const reason = body.stop_reason;
    if (reason === 'refusal') throw crearError('AI_REFUSAL', 'El asistente no puede responder esa solicitud.');
    throw crearError('AI_EMPTY_RESPONSE', 'El asistente respondió sin texto. Intenta formular la pregunta de otra manera.');
  }
  return {
    provider: 'anthropic',
    model: body.model || ANTHROPIC_MODEL,
    text,
    stopReason: body.stop_reason,
    usage: body.usage || null
  };
}

async function consultarOpenAI({ system, messages }) {
  const input = [];
  if (typeof system === 'string' && system.trim()) input.push({ role: 'developer', content: system.slice(0, 30000) });
  for (const m of messages) input.push({ role: m.role, content: m.content });

  const data = await fetchJsonConTimeout('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({ model: OPENAI_MODEL, input, max_output_tokens: AI_MAX_TOKENS })
  });

  if (!data.ok) throw crearErrorProveedor('OPENAI_ERROR', data.status, data.body);
  const body = data.body || {};
  const text = extraerTextoOpenAI(body);
  if (!text) throw crearError('AI_EMPTY_RESPONSE', 'El asistente alterno respondió sin texto.');
  return {
    provider: 'openai',
    model: body.model || OPENAI_MODEL,
    text,
    stopReason: body.status || 'completed',
    usage: body.usage || null
  };
}

function extraerTextoAnthropic(body) {
  if (!Array.isArray(body?.content)) return '';
  return body.content
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function extraerTextoOpenAI(body) {
  if (typeof body?.output_text === 'string' && body.output_text.trim()) return body.output_text.trim();
  const partes = [];
  for (const item of Array.isArray(body?.output) ? body.output : []) {
    for (const c of Array.isArray(item?.content) ? item.content : []) {
      if (c?.type === 'output_text' && typeof c.text === 'string') partes.push(c.text);
      if (c?.type === 'refusal' && typeof c.refusal === 'string') partes.push(c.refusal);
    }
  }
  return partes.join('\n\n').trim();
}

async function fetchJsonConTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    if (error?.name === 'AbortError') throw crearError('AI_TIMEOUT', 'Dr. Plants tardó demasiado en responder. Intenta nuevamente.');
    throw crearError('AI_CONNECTION_ERROR', 'No se pudo contactar al proveedor de inteligencia artificial.');
  } finally {
    clearTimeout(timer);
  }
}

function crearErrorProveedor(code, status, body) {
  const detalle = body?.error?.message || body?.message || `El proveedor respondió con estado ${status}.`;
  const error = crearError(code, status === 429 ? 'El servicio de IA alcanzó temporalmente su límite. Intenta en unos minutos.' : detalle);
  error.status = status;
  return error;
}

function crearError(code, publicMessage) {
  const error = new Error(publicMessage);
  error.code = code;
  error.publicMessage = publicMessage;
  return error;
}

function guardarEnHistorial(usuarioId, modulo, messages, resultado, archivoIds = [], duracionMs = null) {
  let conv = db.prepare('SELECT * FROM conversaciones_ia WHERE usuario_id = ? AND modulo = ? ORDER BY creado_en DESC LIMIT 1').get(usuarioId, modulo);
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
  const pregunta = ultimoMensajeUsuario?.role === 'user'
    ? (typeof ultimoMensajeUsuario.content === 'string' ? ultimoMensajeUsuario.content : JSON.stringify(ultimoMensajeUsuario.content))
    : '';
  if (pregunta) db.prepare('INSERT INTO mensajes (id, conversacion_id, rol, contenido) VALUES (?, ?, ?, ?)').run(nuevoId('msg'), conv.id, 'user', pregunta);
  db.prepare('INSERT INTO mensajes (id, conversacion_id, rol, contenido) VALUES (?, ?, ?, ?)').run(nuevoId('msg'), conv.id, 'assistant', resultado.text);

  db.prepare(`INSERT INTO auditoria_ia
    (id,conversacion_id,usuario_id,modulo,pregunta,respuesta,archivo_ids_json,modelo,tokens_entrada,tokens_salida,duracion_ms,estado)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'completado')`).run(
      nuevoId('aia'), conv.id, usuarioId, modulo, pregunta, resultado.text,
      JSON.stringify(Array.isArray(archivoIds) ? archivoIds : []), `${resultado.provider}:${resultado.model}`,
      resultado.usage?.input_tokens ?? resultado.usage?.input_tokens_details?.cached_tokens ?? null,
      resultado.usage?.output_tokens ?? null, duracionMs
    );

  if (modulo === 'laboratorio') {
    crearNotificacionAdmin({
      tipo: 'analisis_ia_laboratorio',
      titulo: 'Nueva consulta en Laboratorio',
      mensaje: `Un usuario realizó una consulta de laboratorio con IA${archivoIds?.length ? ` y adjuntó ${archivoIds.length} archivo(s)` : ''}.`,
      usuarioId,
      entidadTipo: 'conversacion_ia',
      entidadId: conv.id,
      prioridad: 'alta'
    });
  }
}

module.exports = router;
