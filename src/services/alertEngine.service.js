/**
 * Alert Engine
 * ────────────────────────────────────────────────────────────────────
 * Runs every CHECK_INTERVAL_MS (default 60 s).
 * For each active alert, determines which vehicles to check, reads their
 * current state from VehicleDeviceState, and fires a Notification + email
 * when the condition is satisfied.
 *
 * Duration-based alerts (NOT_MOVING, IDLE_ENGINE) use an in-memory Map
 * to track when each vehicle's condition started, so we can measure
 * elapsed time without extra DB writes on every tick.
 *
 * Cooldown logic: an alert will not fire again for the same vehicle
 * within alert.cooldownMinutes after the last trigger.
 */

const { Op } = require('sequelize');
const { Alert, Notification, Vehicle, VehicleDeviceState, VehicleGroup, VehicleGroupMember } = require('../models');
const { sendAlertEmail, buildAlertEmailHtml } = require('./email.service');
const { FMB125Location } = require('../config/mongodb');

const CHECK_INTERVAL_MS = parseInt(process.env.ALERT_CHECK_INTERVAL_MS || '60000'); // 60 s

/**
 * conditionState[`${alertId}_${vehicleId}`] = Date  (when condition started)
 * Used only for NOT_MOVING and IDLE_ENGINE which need duration tracking.
 */
const conditionState = new Map();

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Minutes elapsed since a given Date */
const minutesSince = (date) => (Date.now() - new Date(date).getTime()) / 60000;

/** True if the alert is still in cooldown for this vehicle */
const inCooldown = (alert, vehicleId) => {
  const key = `cooldown_${alert.id}_${vehicleId}`;
  const last = conditionState.get(key);
  if (!last) return false;
  return minutesSince(last) < alert.cooldownMinutes;
};

const setCooldown = (alert, vehicleId) => {
  conditionState.set(`cooldown_${alert.id}_${vehicleId}`, new Date());
};

/** Get / set condition-started timestamp */
const getConditionStart = (alertId, vehicleId) =>
  conditionState.get(`cond_${alertId}_${vehicleId}`);

const setConditionStart = (alertId, vehicleId, date = new Date()) =>
  conditionState.set(`cond_${alertId}_${vehicleId}`, date);

const clearConditionStart = (alertId, vehicleId) =>
  conditionState.delete(`cond_${alertId}_${vehicleId}`);

// ── Fetch vehicles to check ──────────────────────────────────────────────────

async function getVehiclesForAlert(alert) {
  if (alert.scope === 'VEHICLE' && alert.vehicleId) {
    const v = await Vehicle.findOne({
      where: { id: alert.vehicleId, clientId: alert.clientId, status: 'active' },
      include: [{ model: VehicleDeviceState, as: 'deviceState', required: false }],
    });
    return v ? [v] : [];
  }

  if (alert.scope === 'GROUP' && alert.groupId) {
    const members = await VehicleGroupMember.findAll({ where: { groupId: alert.groupId } });
    const vehicleIds = members.map(m => m.vehicleId);
    return Vehicle.findAll({
      where: { id: { [Op.in]: vehicleIds }, clientId: alert.clientId, status: 'active' },
      include: [{ model: VehicleDeviceState, as: 'deviceState', required: false }],
    });
  }

  // scope === 'ALL'
  return Vehicle.findAll({
    where: { clientId: alert.clientId, status: 'active' },
    include: [{ model: VehicleDeviceState, as: 'deviceState', required: false }],
  });
}

// ── Create notification + send email ────────────────────────────────────────

async function triggerAlert(alert, vehicle, message, metadata) {
  const title = `${alert.name} — ${vehicle.vehicleNumber || vehicle.vehicleName || `Vehicle #${vehicle.id}`}`;

  const notification = await Notification.create({
    clientId:  alert.clientId,
    alertId:   alert.id,
    vehicleId: vehicle.id,
    title,
    message,
    alertType: alert.type,
    isRead:    false,
    emailSent: false,
    metadata,
    triggeredAt: new Date(),
  });

  // Update lastTriggeredAt on the alert
  await alert.update({ lastTriggeredAt: new Date() });
  setCooldown(alert, vehicle.id);

  // Send email asynchronously (don't block the engine loop)
  const htmlBody = buildAlertEmailHtml({
    alertName:     alert.name,
    alertType:     alert.type,
    vehicleNumber: vehicle.vehicleNumber,
    vehicleName:   vehicle.vehicleName,
    message,
    triggeredAt:   notification.triggeredAt,
    metadata,
  });

  sendAlertEmail({
    subject:     `[DriveInnovate Alert] ${title}`,
    htmlBody,
    extraEmails: alert.notifyEmails,
  }).then((sent) => {
    if (sent) notification.update({ emailSent: true }).catch(() => {});
  }).catch(() => {});

  console.log(`[AlertEngine] TRIGGERED: ${title}`);
}

// ── FUEL_THEFT check ─────────────────────────────────────────────────────────
// Evaluated once per tick per (alert, vehicle). Reads the last `windowMinutes`
// of FMB125 packets carrying a fuelLevel, converts % → litres via the tank
// capacity, and fires if the drop from max → most-recent within the window
// exceeds the threshold.
//
// Quiet skips (no error, no alert):
//   - Vehicle is not an FMB family device
//   - Vehicle does not have fuelSupported=true or tankCapacity missing
//   - Fewer than 2 fuel-carrying packets in the window
async function checkFuelTheft(alert, vehicle) {
  if (!vehicle.fuelSupported || !vehicle.fuelTankCapacity) return;
  const deviceType = (vehicle.deviceType || '').toUpperCase();
  if (!deviceType.startsWith('FMB')) return;

  const windowMin = parseInt(alert.windowMinutes, 10) || 5;
  const thresholdL = parseFloat(alert.threshold) || 0;
  if (thresholdL <= 0) return;

  const tank = parseInt(vehicle.fuelTankCapacity, 10);

  const imei = String(vehicle.imei || '').trim();
  if (!imei) return;
  const imeiVars = [imei, imei.replace(/^0+/, ''), '0' + imei].filter(Boolean);

  const since = new Date(Date.now() - windowMin * 60 * 1000);

  const rows = await FMB125Location.find({
    imei: { $in: imeiVars },
    timestamp: { $gte: since },
    fuelLevel: { $exists: true, $ne: null },
  })
    .sort({ timestamp: 1 })
    .select('timestamp fuelLevel ignition speed')
    .lean();

  if (rows.length < 2) return;

  // Max reading anywhere in the window vs the most recent
  let maxPct = -Infinity;
  for (const r of rows) if (r.fuelLevel > maxPct) maxPct = r.fuelLevel;
  const lastPct  = rows[rows.length - 1].fuelLevel;
  const dropPct  = maxPct - lastPct;
  const dropL    = (dropPct / 100) * tank;

  if (dropL < thresholdL) return;
  if (inCooldown(alert, vehicle.id)) return;

  await triggerAlert(
    alert, vehicle,
    `Fuel dropped by ${dropL.toFixed(1)} L in the last ${windowMin} min for ${vehicle.vehicleNumber || vehicle.vehicleName} (${maxPct.toFixed(1)}% → ${lastPct.toFixed(1)}%, threshold ${thresholdL} L).`,
    {
      vehicleNumber: vehicle.vehicleNumber,
      vehicleName:   vehicle.vehicleName,
      dropLitres:    +dropL.toFixed(2),
      dropPct:       +dropPct.toFixed(2),
      maxPct:        +maxPct.toFixed(2),
      lastPct:       +lastPct.toFixed(2),
      windowMinutes: windowMin,
      thresholdLitres: thresholdL,
    }
  );
}

// ── Per-type condition checks ────────────────────────────────────────────────

async function checkVehicle(alert, vehicle) {
  // FUEL_THEFT has its own path — reads Mongo, not VehicleDeviceState.
  if (alert.type === 'FUEL_THEFT') {
    await checkFuelTheft(alert, vehicle);
    return;
  }

  const state = vehicle.deviceState;
  if (!state) return; // No device state yet — skip

  const speed    = state.lastSpeed || 0;
  const engineOn = state.engineOn  || false;
  const packetTime = state.lastPacketTime;

  // Use lastGpsPacketTime for staleness check — GT06 heartbeat/status packets
  // refresh lastPacketTime without updating speed data, which would cause false
  // speed alerts for parked vehicles. lastGpsPacketTime is only set when a real
  // GPS packet (with lat/lng) is processed, so it reflects actual data freshness.
  const gpsPacketTime = state.lastGpsPacketTime || state.lastPacketTime;
  if (!gpsPacketTime || minutesSince(gpsPacketTime) > 10) {
    clearConditionStart(alert.id, vehicle.id);
    return;
  }

  const metadata = {
    speed,
    lat:        state.lastLat  ? parseFloat(state.lastLat)  : null,
    lng:        state.lastLng  ? parseFloat(state.lastLng)  : null,
    packetTime: gpsPacketTime,
    vehicleNumber: vehicle.vehicleNumber,
    vehicleName:   vehicle.vehicleName,
  };

  if (alert.type === 'SPEED_EXCEEDED') {
    if (speed > parseFloat(alert.threshold)) {
      if (!inCooldown(alert, vehicle.id)) {
        await triggerAlert(
          alert, vehicle,
          `${vehicle.vehicleNumber || vehicle.vehicleName} is travelling at ${speed} km/h, exceeding the limit of ${alert.threshold} km/h.`,
          metadata
        );
      }
    }
    // Speed-based alerts don't need condition state — they re-arm after cooldown
    return;
  }

  if (alert.type === 'NOT_MOVING') {
    const conditionMet = speed === 0;
    if (conditionMet) {
      if (!getConditionStart(alert.id, vehicle.id)) {
        setConditionStart(alert.id, vehicle.id);
      }
      const elapsed = minutesSince(getConditionStart(alert.id, vehicle.id));
      if (elapsed >= parseFloat(alert.threshold) && !inCooldown(alert, vehicle.id)) {
        await triggerAlert(
          alert, vehicle,
          `${vehicle.vehicleNumber || vehicle.vehicleName} has not moved for ${Math.round(elapsed)} minutes (threshold: ${alert.threshold} min).`,
          metadata
        );
      }
    } else {
      clearConditionStart(alert.id, vehicle.id);
    }
    return;
  }

  if (alert.type === 'IDLE_ENGINE') {
    const conditionMet = engineOn && speed === 0;
    if (conditionMet) {
      if (!getConditionStart(alert.id, vehicle.id)) {
        setConditionStart(alert.id, vehicle.id);
      }
      const elapsed = minutesSince(getConditionStart(alert.id, vehicle.id));
      if (elapsed >= parseFloat(alert.threshold) && !inCooldown(alert, vehicle.id)) {
        await triggerAlert(
          alert, vehicle,
          `${vehicle.vehicleNumber || vehicle.vehicleName} engine is ON but vehicle has been idle for ${Math.round(elapsed)} minutes (threshold: ${alert.threshold} min).`,
          metadata
        );
      }
    } else {
      clearConditionStart(alert.id, vehicle.id);
    }
    return;
  }
}

// ── Main engine tick ─────────────────────────────────────────────────────────

async function runAlertEngine() {
  try {
    const activeAlerts = await Alert.findAll({ where: { isActive: true } });
    if (!activeAlerts.length) return;

    for (const alert of activeAlerts) {
      try {
        const vehicles = await getVehiclesForAlert(alert);
        for (const vehicle of vehicles) {
          await checkVehicle(alert, vehicle);
        }
      } catch (err) {
        console.error(`[AlertEngine] Error processing alert #${alert.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[AlertEngine] Tick error:', err.message);
  }
}

// ── Public: start / stop ─────────────────────────────────────────────────────

let _timer = null;

function startAlertEngine() {
  if (_timer) return;
  console.log(`✓ Alert engine started (interval: ${CHECK_INTERVAL_MS / 1000}s)`);
  // Run immediately once, then on interval
  runAlertEngine().catch(() => {});
  _timer = setInterval(() => runAlertEngine().catch(() => {}), CHECK_INTERVAL_MS);
}

function stopAlertEngine() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { startAlertEngine, stopAlertEngine };
