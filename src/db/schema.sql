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
  tipo TEXT NOT NULL CHECK(tipo IN ('productos','consulta_personalizada','analisis_laboratorio','curso')),
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

-- Sesiones renovables: evita pedir inicio de sesión en cada petición.
CREATE TABLE IF NOT EXISTS sesiones_refresh (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expira_en TEXT NOT NULL,
  revocado_en TEXT DEFAULT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  ultimo_uso_en TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_sesiones_refresh_usuario ON sesiones_refresh(usuario_id, expira_en);

-- AgroCircular V5: directorio propio y solicitudes de recolección sin APIs comerciales
CREATE TABLE IF NOT EXISTS puntos_circulares (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  pais TEXT NOT NULL,
  region TEXT,
  ciudad TEXT,
  direccion TEXT,
  lat REAL,
  lon REAL,
  tipo_entidad TEXT,
  tipos_residuo TEXT NOT NULL DEFAULT 'general',
  materiales TEXT,
  telefono TEXT,
  email TEXT,
  sitio_web TEXT,
  horario TEXT,
  maps_url TEXT,
  fuente TEXT DEFAULT 'Directorio Dr. Plants',
  verificado INTEGER NOT NULL DEFAULT 0 CHECK(verificado IN (0,1)),
  activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0,1)),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_puntos_circulares_ubicacion ON puntos_circulares(pais,region,ciudad,activo);

CREATE TABLE IF NOT EXISTS solicitudes_recoleccion_circular (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  pais TEXT NOT NULL,
  region TEXT NOT NULL,
  ciudad TEXT NOT NULL,
  tipo_residuo TEXT NOT NULL,
  cantidad TEXT NOT NULL,
  direccion TEXT NOT NULL,
  observaciones TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','contactando_gestor','programada','recolectada','cancelada')),
  gestor_asignado TEXT,
  fecha_programada TEXT,
  retroalimentacion TEXT,
  creada_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizada_en TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_solicitudes_recoleccion_estado ON solicitudes_recoleccion_circular(estado,creada_en);

CREATE TABLE IF NOT EXISTS cursos (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  precio_cop INTEGER NOT NULL,
  portada TEXT DEFAULT NULL,
  publicado INTEGER NOT NULL DEFAULT 1 CHECK(publicado IN (0,1)),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS curso_modulos (
  id TEXT PRIMARY KEY,
  curso_id TEXT NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  orden INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS curso_lecciones (
  id TEXT PRIMARY KEY,
  modulo_id TEXT NOT NULL REFERENCES curso_modulos(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  duracion_min INTEGER NOT NULL DEFAULT 20,
  contenido TEXT,
  orden INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS matriculas_curso (
  id TEXT PRIMARY KEY,
  curso_id TEXT NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  estado TEXT NOT NULL DEFAULT 'pendiente_pago' CHECK(estado IN ('pendiente_pago','pago_aprobado','activa','rechazada','cancelada')),
  pago_id TEXT DEFAULT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  pagado_en TEXT DEFAULT NULL,
  activado_en TEXT DEFAULT NULL,
  activado_por TEXT DEFAULT NULL REFERENCES usuarios(id),
  UNIQUE(curso_id,usuario_id)
);
CREATE INDEX IF NOT EXISTS idx_matriculas_usuario ON matriculas_curso(usuario_id,creado_en);


-- V8A · CRM agronómico profesional
CREATE TABLE IF NOT EXISTS clientes_agronomicos (
  id TEXT PRIMARY KEY,
  agronomo_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  documento TEXT DEFAULT NULL,
  telefono TEXT DEFAULT NULL,
  email TEXT DEFAULT NULL,
  pais TEXT DEFAULT NULL,
  region TEXT DEFAULT NULL,
  ciudad TEXT DEFAULT NULL,
  notas TEXT DEFAULT NULL,
  activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0,1)),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_clientes_agronomo ON clientes_agronomicos(agronomo_id, activo, creado_en);

CREATE TABLE IF NOT EXISTS visitas_tecnicas (
  id TEXT PRIMARY KEY,
  lote_id TEXT NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  profesional_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  objetivo TEXT DEFAULT NULL,
  observaciones TEXT DEFAULT NULL,
  recomendaciones TEXT DEFAULT NULL,
  proxima_visita TEXT DEFAULT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT DEFAULT NULL,
  eliminado_en TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_visitas_lote ON visitas_tecnicas(lote_id, fecha);

-- V8B · Inteligencia climática, hídrica, mercado, proyección y conocimiento
CREATE TABLE IF NOT EXISTS clima_lote_snapshots (
  id TEXT PRIMARY KEY,
  lote_id TEXT NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  fuente TEXT NOT NULL,
  latitud REAL NOT NULL,
  longitud REAL NOT NULL,
  payload_json TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clima_lote_fecha ON clima_lote_snapshots(lote_id, creado_en);

CREATE TABLE IF NOT EXISTS mediciones_campo (
  id TEXT PRIMARY KEY,
  lote_id TEXT NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('precipitacion','temperatura','humedad_suelo','caudal_riego')),
  valor REAL NOT NULL,
  unidad TEXT,
  fecha TEXT NOT NULL,
  notas TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mediciones_lote_fecha ON mediciones_campo(lote_id, fecha);

CREATE TABLE IF NOT EXISTS precios_mercado (
  id TEXT PRIMARY KEY,
  pais TEXT NOT NULL,
  region TEXT,
  mercado TEXT,
  producto TEXT NOT NULL,
  variedad TEXT,
  unidad TEXT,
  precio_min REAL,
  precio_max REAL,
  precio_promedio REAL NOT NULL,
  moneda TEXT NOT NULL,
  fuente TEXT NOT NULL,
  fuente_url TEXT,
  fecha TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pais,region,mercado,producto,variedad,unidad,precio_promedio,fuente,fecha)
);
CREATE INDEX IF NOT EXISTS idx_precio_producto_fecha ON precios_mercado(pais,producto,fecha);

CREATE TABLE IF NOT EXISTS conocimiento_agronomico (
  id TEXT PRIMARY KEY,
  titulo TEXT NOT NULL,
  cultivo TEXT,
  categoria TEXT,
  resumen TEXT,
  contenido TEXT NOT NULL,
  fuente TEXT,
  fuente_url TEXT,
  prioridad INTEGER NOT NULL DEFAULT 50,
  activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0,1)),
  creado_por TEXT REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conocimiento_cultivo ON conocimiento_agronomico(cultivo,activo,prioridad);
