const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { nuevoId, requiereAuth } = require('../auth');
const { crearNotificacionAdmin } = require('../notificaciones');

const router = express.Router();

function cfg() {
  const publicKey = process.env.WOMPI_PUBLIC_KEY || '';
  const integritySecret = process.env.WOMPI_INTEGRITY_SECRET || '';
  const eventsSecret = process.env.WOMPI_EVENTS_SECRET || '';
  const appUrl = (process.env.APP_URL || 'https://drplants.campushbc.com').replace(/\/$/, '');
  return { publicKey, integritySecret, eventsSecret, appUrl };
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function getByPath(root, path) {
  return String(path).split('.').reduce((value, key) => value == null ? undefined : value[key], root);
}

function precioServicio(tipo) {
  const envMap = {
    consulta_personalizada: Number(process.env.PRECIO_CONSULTA_COP || 0),
    analisis_laboratorio: Number(process.env.PRECIO_ANALISIS_LAB_COP || 0)
  };
  return envMap[tipo] || 0;
}

router.get('/configuracion', requiereAuth, (_req, res) => {
  const { publicKey } = cfg();
  res.json({ habilitado: Boolean(publicKey && process.env.WOMPI_INTEGRITY_SECRET), moneda: 'COP' });
});

// Crea una intención firmada en el servidor. Nunca expone secretos de Wompi.
router.post('/intencion', requiereAuth, (req, res) => {
  const usuario = db.prepare('SELECT id,nombre,email,telefono FROM usuarios WHERE id=?').get(req.usuario.id);
  if (!usuario) return res.status(401).json({ error: 'Usuario no encontrado.' });
  const { tipo, pedidoId, solicitudId } = req.body || {};
  const permitidos = ['productos', 'consulta_personalizada', 'analisis_laboratorio'];
  if (!permitidos.includes(tipo)) return res.status(400).json({ error: 'Tipo de cobro inválido.' });

  const { publicKey, integritySecret, appUrl } = cfg();
  if (!publicKey || !integritySecret) {
    return res.status(503).json({ code: 'WOMPI_NOT_CONFIGURED', error: 'Wompi todavía no está configurado en el servidor.' });
  }

  let montoCop = 0;
  let descripcion = '';
  let entidadId = null;

  if (tipo === 'productos') {
    const pedido = db.prepare('SELECT * FROM pedidos WHERE id=? AND usuario_id=?').get(pedidoId, req.usuario.id);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado.' });
    montoCop = Number(pedido.total_cop);
    descripcion = `Pedido ${pedido.numero}`;
    entidadId = pedido.id;
  } else if (tipo === 'analisis_laboratorio') {
    const solicitud = db.prepare('SELECT * FROM solicitudes_laboratorio WHERE id=? AND usuario_id=?').get(solicitudId, req.usuario.id);
    if (!solicitud) return res.status(404).json({ error: 'Solicitud de laboratorio no encontrada.' });
    montoCop = precioServicio(tipo);
    descripcion = `Análisis de laboratorio: ${solicitud.tipo_analisis}`;
    entidadId = solicitud.id;
  } else {
    const solicitud = db.prepare('SELECT * FROM solicitudes_teleconsulta WHERE id=? AND usuario_id=?').get(solicitudId, req.usuario.id);
    if (!solicitud) return res.status(404).json({ error: 'Solicitud de consulta no encontrada.' });
    montoCop = precioServicio(tipo);
    descripcion = 'Consulta personalizada con agrónomo';
    entidadId = solicitud.id;
  }

  if (!Number.isFinite(montoCop) || montoCop <= 0) {
    return res.status(422).json({ code: 'PRICE_NOT_CONFIGURED', error: 'El precio de este servicio todavía no está configurado.' });
  }

  const id = nuevoId('pay');
  const referencia = `DRP-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const montoCentavos = Math.round(montoCop * 100);
  const moneda = 'COP';
  const firmaIntegridad = sha256(`${referencia}${montoCentavos}${moneda}${integritySecret}`);

  db.prepare(`INSERT INTO pagos
    (id, usuario_id, tipo, entidad_id, referencia, descripcion, monto_cop, monto_centavos, moneda, estado)
    VALUES (?,?,?,?,?,?,?,?,?,'PENDING')`)
    .run(id, req.usuario.id, tipo, entidadId, referencia, descripcion, montoCop, montoCentavos, moneda);

  if (tipo === 'productos') db.prepare("UPDATE pedidos SET estado='pendiente_pago', pago_id=? WHERE id=?").run(id, entidadId);
  if (tipo === 'analisis_laboratorio') db.prepare('UPDATE solicitudes_laboratorio SET pago_id=? WHERE id=?').run(id, entidadId);
  if (tipo === 'consulta_personalizada') db.prepare('UPDATE solicitudes_teleconsulta SET pago_id=? WHERE id=?').run(id, entidadId);

  const params = new URLSearchParams({
    'public-key': publicKey,
    currency: moneda,
    'amount-in-cents': String(montoCentavos),
    reference: referencia,
    'signature:integrity': firmaIntegridad,
    'redirect-url': `${appUrl}/?pago=resultado`,
    'customer-data:email': usuario.email || '',
    'customer-data:full-name': usuario.nombre || '',
    'customer-data:phone-number': usuario.telefono || ''
  });

  res.status(201).json({
    pagoId: id,
    referencia,
    tipo,
    descripcion,
    montoCop,
    moneda,
    checkoutUrl: `https://checkout.wompi.co/p/?${params.toString()}`
  });
});

router.get('/mis-pagos', requiereAuth, (req, res) => {
  res.json(db.prepare(`SELECT id,tipo,entidad_id,referencia,descripcion,monto_cop,moneda,estado,
    wompi_transaccion_id,metodo_pago,creado_en,actualizado_en
    FROM pagos WHERE usuario_id=? ORDER BY creado_en DESC`).all(req.usuario.id));
});

// URL pública para configurar en Wompi: /api/pagos/wompi/eventos
router.post('/wompi/eventos', (req, res) => {
  const { eventsSecret } = cfg();
  if (!eventsSecret) return res.status(503).json({ error: 'WOMPI_EVENTS_SECRET no está configurado.' });
  const body = req.body || {};
  const properties = body.signature?.properties;
  const checksum = String(body.signature?.checksum || req.get('X-Event-Checksum') || '').toLowerCase();
  if (!Array.isArray(properties) || !checksum || body.timestamp == null) return res.status(400).json({ error: 'Evento incompleto.' });

  const concatenado = properties.map(p => getByPath(body.data, p)).join('') + String(body.timestamp) + eventsSecret;
  const esperado = sha256(concatenado).toLowerCase();
  const a = Buffer.from(checksum);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Firma de evento inválida.' });

  if (body.event === 'transaction.updated' && body.data?.transaction) {
    const trx = body.data.transaction;
    const pago = db.prepare('SELECT * FROM pagos WHERE referencia=?').get(trx.reference);
    if (pago && Number(trx.amount_in_cents) === Number(pago.monto_centavos) && trx.currency === pago.moneda) {
      const estado = String(trx.status || 'PENDING').toUpperCase();
      db.prepare(`UPDATE pagos SET estado=?, wompi_transaccion_id=?, metodo_pago=?, respuesta_wompi=?, actualizado_en=datetime('now') WHERE id=?`)
        .run(estado, trx.id || null, trx.payment_method_type || null, JSON.stringify(trx), pago.id);
      if (estado === 'APPROVED') {
        if (pago.tipo === 'productos') db.prepare("UPDATE pedidos SET estado='pagado' WHERE id=?").run(pago.entidad_id);
        if (pago.tipo === 'analisis_laboratorio') db.prepare("UPDATE solicitudes_laboratorio SET estado='en_proceso' WHERE id=?").run(pago.entidad_id);
        if (pago.tipo === 'consulta_personalizada') db.prepare("UPDATE solicitudes_teleconsulta SET estado='pendiente' WHERE id=?").run(pago.entidad_id);
        crearNotificacionAdmin({ tipo:'pago_aprobado', titulo:'Pago aprobado', mensaje:`Pago aprobado por $${Number(pago.monto_cop).toLocaleString('es-CO')} COP: ${pago.descripcion || pago.tipo}.`, usuarioId:pago.usuario_id, entidadTipo:'pago', entidadId:pago.id, prioridad:'alta' });
      } else if (['DECLINED','ERROR','VOIDED'].includes(estado)) {
        crearNotificacionAdmin({ tipo:'pago_no_aprobado', titulo:'Pago no aprobado', mensaje:`La transacción ${pago.referencia} quedó en estado ${estado}.`, usuarioId:pago.usuario_id, entidadTipo:'pago', entidadId:pago.id, prioridad:'normal' });
      }
    }
  }
  res.json({ ok: true });
});

module.exports = router;
