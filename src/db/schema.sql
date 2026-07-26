-- Esquema de Dr Plants / Campus HBC — calcado 1:1 del modelo_datos.md que ya definimos
-- con Claude en el prototipo. SQLite para arrancar simple; migrar a Postgres es directo
-- si el proyecto crece (la mayoría de este SQL es estándar).

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE, -- identificador de inicio de sesión
  telefono TEXT,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'agricultor' CHECK(rol IN ('agricultor','agronomo','agronomo_pendiente','admin')),
  tipo_productor TEXT,
  pais TEXT,
  region TEXT,
  tarjeta_profesional TEXT,
  especialidad TEXT,
  estado_agronomo TEXT DEFAULT NULL CHECK(estado_agronomo IN (NULL,'pendiente','aprobado','rechazado')),
  activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0,1)),
  bloqueado_en TEXT DEFAULT NULL,
  motivo_bloqueo TEXT DEFAULT NULL,
  foto_perfil TEXT DEFAULT NULL,
  aprobado_en TEXT DEFAULT NULL,
  rechazado_en TEXT DEFAULT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fincas (
  id TEXT PRIMARY KEY,
  productor_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  ubicacion_id TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agronomo_asignacion (
  id TEXT PRIMARY KEY,
  finca_id TEXT NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  agronomo_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  fecha_asignacion TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(finca_id, agronomo_id)
);

CREATE TABLE IF NOT EXISTS lotes (
  id TEXT PRIMARY KEY,
  finca_id TEXT NOT NULL REFERENCES fincas(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  cultivo_id TEXT NOT NULL,
  area_ha REAL NOT NULL,
  fecha_siembra TEXT NOT NULL,
  salud_pct INTEGER NOT NULL DEFAULT 90,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS aplicaciones (
  id TEXT PRIMARY KEY,
  lote_id TEXT NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  producto TEXT NOT NULL,
  fecha TEXT NOT NULL,
  cantidad TEXT,
  costo_cop INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS analisis_laboratorio (
  id TEXT PRIMARY KEY,
  lote_id TEXT NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  fecha TEXT NOT NULL,
  resultado TEXT
);

CREATE TABLE IF NOT EXISTS costos_operativos (
  id TEXT PRIMARY KEY,
  lote_id TEXT NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  categoria TEXT NOT NULL,
  descripcion TEXT,
  fecha TEXT NOT NULL,
  costo_cop INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categorias (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS productos (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  formula TEXT,
  categoria_id TEXT NOT NULL REFERENCES categorias(id),
  tag TEXT,
  descripcion TEXT,
  precio_cop INTEGER NOT NULL,
  unidad TEXT,
  icono TEXT,
  destacado INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pedidos (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  lote_id TEXT REFERENCES lotes(id),
  fecha TEXT NOT NULL DEFAULT (datetime('now')),
  estado TEXT NOT NULL DEFAULT 'recibido',
  total_cop INTEGER NOT NULL,
  pago_id TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS pedido_items (
  id TEXT PRIMARY KEY,
  pedido_id TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id TEXT NOT NULL REFERENCES productos(id),
  cantidad INTEGER NOT NULL,
  precio_unitario_cop INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS leccion_progreso (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  leccion_id TEXT NOT NULL,
  completada INTEGER NOT NULL DEFAULT 1,
  fecha TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(usuario_id, leccion_id)
);

CREATE TABLE IF NOT EXISTS conversaciones_ia (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo TEXT NOT NULL CHECK(modulo IN ('dr_agro','soporte','laboratorio')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mensajes (
  id TEXT PRIMARY KEY,
  conversacion_id TEXT NOT NULL REFERENCES conversaciones_ia(id) ON DELETE CASCADE,
  rol TEXT NOT NULL CHECK(rol IN ('user','assistant')),
  contenido TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS solicitudes_laboratorio (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  lote_id TEXT REFERENCES lotes(id),
  tipo_analisis TEXT NOT NULL,
  notas TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','en_proceso','completado','cancelado')),
  fecha TEXT NOT NULL DEFAULT (datetime('now')),
  pago_id TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS solicitudes_teleconsulta (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  lote_id TEXT REFERENCES lotes(id),
  motivo TEXT NOT NULL,
  fecha_preferida TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','agendada','atendida','cancelada')),
  fecha_solicitud TEXT NOT NULL DEFAULT (datetime('now')),
  pago_id TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_fincas_productor ON fincas(productor_id);
CREATE INDEX IF NOT EXISTS idx_lotes_finca ON lotes(finca_id);
CREATE INDEX IF NOT EXISTS idx_aplicaciones_lote ON aplicaciones(lote_id);
CREATE INDEX IF NOT EXISTS idx_analisis_lote ON analisis_laboratorio(lote_id);
CREATE INDEX IF NOT EXISTS idx_costos_lote ON costos_operativos(lote_id);
CREATE INDEX IF NOT EXISTS idx_asignacion_agronomo ON agronomo_asignacion(agronomo_id);
CREATE INDEX IF NOT EXISTS idx_mensajes_conversacion ON mensajes(conversacion_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_usuario ON pedidos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_lab_usuario ON solicitudes_laboratorio(usuario_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_tele_usuario ON solicitudes_teleconsulta(usuario_id);


CREATE TABLE IF NOT EXISTS archivos_usuario (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('foto_perfil','documento_identidad','tarjeta_profesional','analisis_suelo','otro_pdf')),
  nombre_original TEXT NOT NULL,
  nombre_guardado TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  tamano_bytes INTEGER NOT NULL,
  ruta TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_archivos_usuario ON archivos_usuario(usuario_id, creado_en);


-- Observaciones profesionales: no alteran el dato original del productor.
CREATE TABLE IF NOT EXISTS observaciones_agronomicas (
  id TEXT PRIMARY KEY,
  lote_id TEXT NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  autor_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL DEFAULT 'observacion' CHECK(tipo IN ('observacion','correccion','recomendacion','alerta')),
  texto TEXT NOT NULL,
  referencia_tipo TEXT DEFAULT NULL,
  referencia_id TEXT DEFAULT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT DEFAULT NULL,
  eliminado_en TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_obs_lote ON observaciones_agronomicas(lote_id, creado_en);


CREATE TABLE IF NOT EXISTS pagos (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('productos','consulta_personalizada','analisis_laboratorio')),
  entidad_id TEXT NOT NULL,
  referencia TEXT NOT NULL UNIQUE,
  descripcion TEXT,
  monto_cop INTEGER NOT NULL,
  monto_centavos INTEGER NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'COP',
  estado TEXT NOT NULL DEFAULT 'PENDING',
  wompi_transaccion_id TEXT DEFAULT NULL,
  metodo_pago TEXT DEFAULT NULL,
  respuesta_wompi TEXT DEFAULT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_pagos_usuario ON pagos(usuario_id, creado_en);
CREATE INDEX IF NOT EXISTS idx_pagos_referencia ON pagos(referencia);

CREATE TABLE IF NOT EXISTS conversacion_archivos (
  conversacion_id TEXT NOT NULL REFERENCES conversaciones_ia(id) ON DELETE CASCADE,
  archivo_id TEXT NOT NULL REFERENCES archivos_usuario(id) ON DELETE CASCADE,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(conversacion_id, archivo_id)
);

CREATE TABLE IF NOT EXISTS archivo_verificaciones (
  id TEXT PRIMARY KEY,
  archivo_id TEXT NOT NULL REFERENCES archivos_usuario(id) ON DELETE CASCADE,
  administrador_id TEXT NOT NULL REFERENCES usuarios(id),
  estado TEXT NOT NULL CHECK(estado IN ('pendiente','verificado','rechazado')),
  observacion TEXT DEFAULT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_verificaciones_archivo ON archivo_verificaciones(archivo_id, creado_en);


-- Centro de notificaciones administrativas y trazabilidad avanzada
CREATE TABLE IF NOT EXISTS notificaciones_admin (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  usuario_id TEXT REFERENCES usuarios(id) ON DELETE SET NULL,
  entidad_tipo TEXT DEFAULT NULL,
  entidad_id TEXT DEFAULT NULL,
  prioridad TEXT NOT NULL DEFAULT 'normal' CHECK(prioridad IN ('normal','alta','critica')),
  leida INTEGER NOT NULL DEFAULT 0 CHECK(leida IN (0,1)),
  creada_en TEXT NOT NULL DEFAULT (datetime('now')),
  leida_en TEXT DEFAULT NULL,
  email_estado TEXT NOT NULL DEFAULT 'no_configurado',
  email_enviado_en TEXT DEFAULT NULL,
  email_error TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_notificaciones_admin ON notificaciones_admin(leida, creada_en);


CREATE TABLE IF NOT EXISTS notificaciones_usuario (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  titulo TEXT NOT NULL,
  mensaje TEXT NOT NULL,
  entidad_tipo TEXT DEFAULT NULL,
  entidad_id TEXT DEFAULT NULL,
  url_destino TEXT DEFAULT NULL,
  prioridad TEXT NOT NULL DEFAULT 'normal' CHECK(prioridad IN ('normal','alta','critica')),
  leida INTEGER NOT NULL DEFAULT 0 CHECK(leida IN (0,1)),
  creada_en TEXT NOT NULL DEFAULT (datetime('now')),
  leida_en TEXT DEFAULT NULL,
  email_estado TEXT NOT NULL DEFAULT 'no_configurado',
  email_enviado_en TEXT DEFAULT NULL,
  email_error TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario ON notificaciones_usuario(usuario_id, leida, creada_en);

CREATE TABLE IF NOT EXISTS auditoria_ia (
  id TEXT PRIMARY KEY,
  conversacion_id TEXT NOT NULL REFERENCES conversaciones_ia(id) ON DELETE CASCADE,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  modulo TEXT NOT NULL,
  pregunta TEXT,
  respuesta TEXT,
  archivo_ids_json TEXT DEFAULT '[]',
  modelo TEXT DEFAULT NULL,
  tokens_entrada INTEGER DEFAULT NULL,
  tokens_salida INTEGER DEFAULT NULL,
  duracion_ms INTEGER DEFAULT NULL,
  estado TEXT NOT NULL DEFAULT 'completado',
  error TEXT DEFAULT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_auditoria_ia_usuario ON auditoria_ia(usuario_id, creado_en);

-- Registro inmutable de eventos de seguridad y acciones sensibles.
CREATE TABLE IF NOT EXISTS auditoria_seguridad (
  id TEXT PRIMARY KEY,
  usuario_id TEXT REFERENCES usuarios(id) ON DELETE SET NULL,
  accion TEXT NOT NULL,
  resultado TEXT NOT NULL DEFAULT 'ok',
  entidad_tipo TEXT DEFAULT NULL,
  entidad_id TEXT DEFAULT NULL,
  ip TEXT DEFAULT NULL,
  user_agent TEXT DEFAULT NULL,
  request_id TEXT DEFAULT NULL,
  metadata_json TEXT DEFAULT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_auditoria_seguridad_fecha ON auditoria_seguridad(creado_en);
CREATE INDEX IF NOT EXISTS idx_auditoria_seguridad_usuario ON auditoria_seguridad(usuario_id, creado_en);
