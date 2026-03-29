/**
 * PacketProcessor — real-time state machine for vehicle tracking data.
 *
 * Called for every new GPS packet (via MongoDB change stream OR batch reprocessing).
 * Updates:
 *   vehicle_engine_sessions  — each ignition-on/off period
 *   trips                    — logical journeys (sessions grouped by idle threshold)
 *   stops                    — parking events
 *   vehicle_fuel_events      — fuel fill / drain detections
 *   vehicle_device_states    — live state tracker (one row per vehicle)
 */

const { Op } = require('sequelize');
const {
  Vehicle,
  VehicleDeviceState,
  VehicleEngineSession,
  VehicleFuelEvent,
  Trip,
  Stop,  // used in reprocessVehicle to delete old stops when reprocessing
} = require('../models');

// ─── Haversine distance (km) ────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 0;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Vehicle lookup cache (IMEI → Vehicle row) ──────────────────────────────
const vehicleCache = new Map(); // imei → { id, idleThreshold, fuelFillThreshold }

// ─── Reprocess lock ─────────────────────────────────────────────────────────
// Vehicle IDs currently being reprocessed.  Live change-stream packets for
// these vehicles are skipped to prevent the race condition where a live
// current-time packet overwrites reprocess state mid-run, producing negative
// trip / engine-hour durations.
const reprocessingVehicles = new Set();

async function getVehicle(imei) {
  if (vehicleCache.has(imei)) return vehicleCache.get(imei);

  // Build candidate list: try exact IMEI, then with/without leading zero.
  // GT06 devices often store IMEI without leading zero in MongoDB while the
  // vehicle record stores it with the leading zero (and vice-versa).
  const candidates = [imei];
  if (imei.startsWith('0')) candidates.push(imei.slice(1));
  else candidates.push('0' + imei);

  const v = await Vehicle.findOne({
    where: { imei: candidates },
    attributes: ['id', 'imei', 'idleThreshold', 'fuelFillThreshold'],
  });
  if (v) {
    // Cache under both the packet IMEI and the stored IMEI so future lookups hit.
    vehicleCache.set(imei, v);
    vehicleCache.set(v.imei, v);
  }
  return v;
}

// Invalidate cache when vehicle is updated (clears both leading-zero variants)
function invalidateVehicleCache(imei) {
  vehicleCache.delete(imei);
  if (imei.startsWith('0')) vehicleCache.delete(imei.slice(1));
  else vehicleCache.delete('0' + imei);
}

// ─── Format seconds → "H:MM:SS" ─────────────────────────────────────────────
function fmtDuration(secs) {
  if (!secs) return '0:00:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Main packet processor ───────────────────────────────────────────────────
/**
 * Process a single GPS packet document from MongoDB.
 *
 * ── Common trip definition (applies to ALL device types) ──────────────────────
 *
 *   ENGINE ON  (ignitionOn=true, prevEngineOn=false)
 *     → Start a new trip.  If the vehicle was in an idle-debounce (pendingTripEnd)
 *       and the engine-off gap was < idleThreshold, RESUME the existing trip instead
 *       (traffic-light stop).  If the gap was ≥ idleThreshold, close the lingering
 *       trip first and then start a new one.
 *
 *   ENGINE OFF (ignitionOn=false, prevEngineOn=true)
 *     → Close the engine session.  Set pendingTripEnd=true and start the idle timer
 *       (engineOffSince).  The trip stays open — a brief stop must not split a trip.
 *
 *   STILL OFF  (ignitionOn=false, pendingTripEnd=true)
 *     → Once the engine-off gap exceeds idleThreshold, close the trip.
 *
 *   STILL ON   (ignitionOn=true, prevEngineOn=true)
 *     → Accumulate distance, update route / speed / duration.
 *     → Gap detection: if no GPS packet has been received for > MAX_GPS_GAP_MS
 *       (default 30 min), assume the engine was silently turned off during the
 *       gap (packet lost or device slept).  Close the previous trip at the last
 *       known GPS timestamp and start a fresh one for the current engine-on period.
 *       lastGpsPacketTime (not lastPacketTime) is used so that GT06 heartbeat /
 *       status packets do not mask genuine gaps.
 *
 * Ignition detection per device type:
 *   FMB125 → uses explicit doc.ignition boolean (Teltonika IO element 239)
 *   GT06   → speed-based with hysteresis to avoid traffic-light flicker:
 *              ON  when acc=true OR speed ≥ 5 km/h
 *              OFF when acc=false AND speed === 0
 *              HOLD (keep previous state) when speed is 1–4 km/h
 *
 * @param {Object} doc        - MongoDB document (fmb125locations or gt06locations)
 * @param {string} deviceType - 'FMB125' | 'GT06'
 */

// Maximum GPS gap before assuming the vehicle stopped (engine-off packet missed).
// Uses lastGpsPacketTime so GT06 heartbeats don't count as real GPS activity.
const MAX_GPS_GAP_MS = 30 * 60 * 1000; // 30 minutes
async function processPacket(doc, deviceType) {
  try {
    const imei = doc.imei;
    if (!imei) {
      console.warn(`[PacketProcessor:${deviceType}] Packet missing IMEI, skipping`);
      return;
    }

    const vehicle = await getVehicle(imei);
    if (!vehicle) {
      console.warn(`[PacketProcessor:${deviceType}] No vehicle found for IMEI "${imei}", skipping`);
      return;
    }

    const vehicleId = vehicle.id;

    // Skip live packets while a reprocess is running for this vehicle
    if (reprocessingVehicles.has(vehicleId)) return;

    const idleThresholdMs = (vehicle.idleThreshold || 5) * 60 * 1000;
    const fuelFillThreshold = vehicle.fuelFillThreshold || 5;

    // Extract packet fields (normalise FMB125 vs GT06)
    const packetTime = new Date(doc.timestamp || doc.serverTimestamp || Date.now());
    const lat = parseFloat(doc.latitude) || null;
    const lng = parseFloat(doc.longitude) || null;
    const speed = parseFloat(doc.speed) || 0;
    const fuelLevel = doc.fuelLevel !== undefined && doc.fuelLevel !== null ? parseFloat(doc.fuelLevel) : null;
    const odometer = doc.totalOdometer || doc.mileage || null;

    // GT06 non-GPS packets (STATUS, LOGIN, HEARTBEAT) carry no position data.
    // Running them through the state machine would falsely flip engineOn to false.
    // Only refresh lastPacketTime so "last seen" stays accurate.
    if (deviceType === 'GT06' && lat === null && lng === null) {
      let state = await VehicleDeviceState.findOne({ where: { vehicleId } });
      if (!state) state = await VehicleDeviceState.create({ vehicleId, imei });
      await VehicleDeviceState.update({ lastPacketTime: packetTime }, { where: { vehicleId } });
      return;
    }

    // Get or create device state (must happen before ignition detection so GT06
    // hysteresis can reference the previous engine state)
    let state = await VehicleDeviceState.findOne({ where: { vehicleId } });
    if (!state) {
      state = await VehicleDeviceState.create({ vehicleId, imei });
    }

    const prevEngineOn = state.engineOn;
    const prevFuelLevel = state.lastFuelLevel;

    // Ignition detection:
    //   FMB125 → dedicated ignition/acc signal (reliable)
    //   GT06   → hysteresis to avoid false trips from speed fluctuating around 5 km/h:
    //              ON  when acc=true OR speed ≥ 5
    //              OFF when acc=false AND speed === 0
    //              Hold current state when acc=false AND 0 < speed < 5
    //            This prevents a vehicle slowing to 3 km/h in traffic from
    //            prematurely closing a trip.
    let ignitionOn;
    if (deviceType === 'GT06') {
      if (doc.acc || speed >= 5) {
        ignitionOn = true;
      } else if (speed === 0) {
        ignitionOn = false;
      } else {
        ignitionOn = prevEngineOn; // hold — speed is 1–4 km/h, ambiguous
      }
    } else {
      ignitionOn = !!(doc.ignition || doc.acc);
    }

    console.log(`[PacketProcessor:${deviceType}] imei=${imei} vehicleId=${vehicleId} ignition=${ignitionOn} acc=${doc.acc} speed=${speed} lat=${lat} lng=${lng} ts=${packetTime.toISOString()}`);
    const now = packetTime.getTime();

    // ── Fuel event detection ────────────────────────────────────────────────
    if (fuelLevel !== null && prevFuelLevel !== null) {
      const diff = fuelLevel - prevFuelLevel;
      if (diff >= fuelFillThreshold) {
        await VehicleFuelEvent.create({
          vehicleId, imei, eventType: 'fill', eventTime: packetTime,
          fuelBefore: prevFuelLevel, fuelAfter: fuelLevel, fuelChangePct: diff,
          latitude: lat, longitude: lng,
        });
      } else if (diff <= -(fuelFillThreshold * 2)) {
        await VehicleFuelEvent.create({
          vehicleId, imei, eventType: 'drain', eventTime: packetTime,
          fuelBefore: prevFuelLevel, fuelAfter: fuelLevel, fuelChangePct: Math.abs(diff),
          latitude: lat, longitude: lng,
        });
      }
    }

    // ── Trip state machine ──────────────────────────────────────────────────

    if (ignitionOn && !prevEngineOn) {
      // ── ENGINE TURNED ON ──────────────────────────────────────────────────
      if (state.pendingTripEnd && state.currentTripId) {
        // engineOffMs  — time since the ENGINE OFF packet was processed.
        // lastRunningMs — time since the last packet where ignition was ON.
        //
        // These differ when a device sends a "wake-up / parking" packet with
        // ignition=false just before an afternoon restart (FMB125 sleep mode).
        // In that case engineOffMs may be only 1–2 minutes even though the
        // vehicle actually stopped hours earlier.  Using lastGpsPacketTime
        // (which is NOT updated on ignitionOff packets) gives the true gap.
        const engineOffMs = state.engineOffSince
          ? now - new Date(state.engineOffSince).getTime()
          : Infinity;
        const lastRunningMs = state.lastGpsPacketTime
          ? now - new Date(state.lastGpsPacketTime).getTime()
          : Infinity;

        const isLongStop = engineOffMs >= idleThresholdMs || lastRunningMs >= MAX_GPS_GAP_MS;

        if (!isLongStop) {
          // Brief stop (traffic light) — resume existing trip, just start new session
          state.pendingTripEnd = false;
          state.engineOffSince = null;
        } else {
          // Long stop — close the lingering trip.  Use lastGpsPacketTime as
          // the trip end if it predates engineOffSince (i.e. the parking packet
          // arrived long after the vehicle actually stopped).
          const tripEndTime =
            state.lastGpsPacketTime && state.engineOffSince &&
            new Date(state.lastGpsPacketTime) < new Date(state.engineOffSince)
              ? new Date(state.lastGpsPacketTime)
              : state.engineOffSince || packetTime;
          await closeTripIfActive(state.currentTripId, tripEndTime);
          state.currentTripId = null;
          state.pendingTripEnd = false;
          state.engineOffSince = null;
        }
      }

      // Start a new trip if we don't have one
      if (!state.currentTripId) {
        const newTrip = await Trip.create({
          vehicleId, imei,
          startTime: packetTime, endTime: packetTime,
          duration: 0, distance: 0,
          startLatitude: lat, startLongitude: lng,
          avgSpeed: 0, maxSpeed: 0, idleTime: 0, fuelConsumed: null,
          routeData: lat ? [{ lat, lng, ts: packetTime.toISOString(), spd: speed }] : [],
        });
        state.currentTripId = newTrip.id;
      }

      // Always start a new engine session for this ON period
      const newSession = await VehicleEngineSession.create({
        vehicleId, imei,
        startTime: packetTime,
        startLatitude: lat, startLongitude: lng,
        startFuelLevel: fuelLevel,
        tripId: state.currentTripId,
        distanceKm: 0, status: 'active',
      });
      state.currentSessionId = newSession.id;
      state.engineOn = true;
      state.engineOnSince = packetTime;

    } else if (!ignitionOn && prevEngineOn) {
      // ── ENGINE TURNED OFF — close session, start idle debounce timer ──────
      // Do NOT close the trip yet — a traffic light stop should not split the trip.
      // The trip is closed by STILL OFF once idleThreshold is exceeded.
      if (state.currentSessionId) {
        await closeEngineSession(state.currentSessionId, packetTime, lat, lng, fuelLevel, state);
      }
      state.engineOn = false;
      state.currentSessionId = null;
      state.engineOffSince = packetTime;
      state.pendingTripEnd = true;

    } else if (!ignitionOn && state.pendingTripEnd) {
      // ── STILL OFF — check idle threshold ─────────────────────────────────
      const offMs = state.engineOffSince
        ? now - new Date(state.engineOffSince).getTime()
        : Infinity;
      if (offMs >= idleThresholdMs && state.currentTripId) {
        // Idle threshold exceeded — finalise trip at the moment speed went to 0
        await closeTripIfActive(state.currentTripId, state.engineOffSince || packetTime);
        state.currentTripId = null;
        state.pendingTripEnd = false;
      }

    } else if (ignitionOn && prevEngineOn) {
      // ── ENGINE STILL ON — accumulate distance and update active trip ───────

      // Gap detection: if lastGpsPacketTime is set and the gap since the last
      // real GPS packet exceeds MAX_GPS_GAP_MS, assume the engine was quietly
      // turned off during the silence (packet lost / device slept without sending
      // an engine-off record).  Close the previous trip and session at the last
      // known GPS moment; the recovery block below will then open a fresh trip.
      //
      // lastGpsPacketTime starts as null after a clean reprocess (priorContext
      // case), so this check is safely skipped for the very first packet of a
      // reprocessing run — preventing false splits at range boundaries.
      const gapCheckTime = state.lastGpsPacketTime;
      if (gapCheckTime) {
        const gapMs = now - new Date(gapCheckTime).getTime();
        if (gapMs > MAX_GPS_GAP_MS) {
          if (state.currentTripId) {
            await closeTripIfActive(state.currentTripId, new Date(gapCheckTime));
            state.currentTripId = null;
          }
          if (state.currentSessionId) {
            await closeEngineSession(state.currentSessionId, new Date(gapCheckTime), state.lastLat, state.lastLng, state.lastFuelLevel, state);
            state.currentSessionId = null;
          }
          state.pendingTripEnd = false;
          state.engineOnSince = packetTime; // fresh engine-on moment after the gap
        }
      }

      // Recovery: reprocessing restores prior state with engineOn=true but
      // currentTripId/currentSessionId=null (original records fell outside the
      // reprocessed range). Create them so the machine can continue from where
      // the vehicle left off.
      let justCreated = false;
      if (!state.currentTripId) {
        const newTrip = await Trip.create({
          vehicleId, imei,
          startTime: state.engineOnSince || packetTime, endTime: packetTime,
          duration: 0, distance: 0,
          startLatitude: state.lastLat || lat, startLongitude: state.lastLng || lng,
          avgSpeed: 0, maxSpeed: 0, idleTime: 0, fuelConsumed: null,
          routeData: lat ? [{ lat, lng, ts: packetTime.toISOString(), spd: speed }] : [],
        });
        state.currentTripId = newTrip.id;
        justCreated = true;
      }
      if (!state.currentSessionId) {
        const newSession = await VehicleEngineSession.create({
          vehicleId, imei,
          startTime: state.engineOnSince || packetTime,
          startLatitude: lat, startLongitude: lng,
          startFuelLevel: fuelLevel,
          tripId: state.currentTripId,
          distanceKm: 0, status: 'active',
        });
        state.currentSessionId = newSession.id;
        justCreated = true;
      }

      // Distance for this segment (skip on first packet after recovery — no valid prev pos)
      const prevLat = state.lastLat;
      const prevLng = state.lastLng;
      const segmentKm = (!justCreated && prevLat && lat) ? haversine(prevLat, prevLng, lat, lng) : 0;

      await VehicleEngineSession.increment({ distanceKm: segmentKm }, { where: { id: state.currentSessionId } });

      const trip = await Trip.findByPk(state.currentTripId);
      if (trip) {
        const durationSec = Math.floor((now - new Date(trip.startTime).getTime()) / 1000);
        const newDist = parseFloat(trip.distance || 0) + segmentKm;
        const newMax = Math.max(parseFloat(trip.maxSpeed || 0), speed);

        // Append route point (sample every ~30 s to limit storage)
        let route = trip.routeData || [];
        const lastPt = route[route.length - 1];
        if ((!lastPt || (now - new Date(lastPt.ts).getTime()) / 1000 >= 30) && lat) {
          route = [...route, { lat, lng, ts: packetTime.toISOString(), spd: speed }];
          if (route.length > 2000) route = route.slice(-2000);
        }

        const movingPts = route.filter(p => p.spd > 0);
        const avgSpeed = movingPts.length
          ? movingPts.reduce((s, p) => s + p.spd, 0) / movingPts.length
          : 0;

        await trip.update({
          endTime: packetTime,
          duration: durationSec,
          distance: newDist,
          maxSpeed: newMax,
          avgSpeed: Math.round(avgSpeed * 100) / 100,
          endLatitude: lat || trip.endLatitude,
          endLongitude: lng || trip.endLongitude,
          routeData: route,
        });
      }
    }
    // else: !ignitionOn && !prevEngineOn — engine still off, nothing to do

    // ── Persist device state ────────────────────────────────────────────────
    await state.save();
    await VehicleDeviceState.update(
      {
        lastLat: lat || state.lastLat,
        lastLng: lng || state.lastLng,
        lastSpeed: speed,
        lastFuelLevel: fuelLevel !== null ? fuelLevel : state.lastFuelLevel,
        lastOdometer: odometer || state.lastOdometer,
        lastPacketTime: packetTime,
        // Only advance lastGpsPacketTime while the engine is ON.
        // This means it tracks "last moment the vehicle was known to be running",
        // NOT the last received packet.  A parking/wake-up packet sent just before
        // an afternoon restart (ignitionOn=false) must NOT reset this value, or the
        // gap-detection logic in ENGINE TURNED ON would see a tiny engineOffMs and
        // incorrectly treat a 4-hour stop as a brief traffic-light pause.
        lastGpsPacketTime: ignitionOn ? packetTime : state.lastGpsPacketTime,
        engineOn: ignitionOn,
        currentSessionId: state.currentSessionId,
        currentTripId: state.currentTripId,
        engineOnSince: state.engineOnSince,
        engineOffSince: state.engineOffSince,
        pendingTripEnd: state.pendingTripEnd,
      },
      { where: { vehicleId } }
    );
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError' && doc?.imei) {
      invalidateVehicleCache(doc.imei);
      console.warn(`[PacketProcessor] FK violation for IMEI ${doc.imei} — stale cache cleared, will retry on next packet`);
    } else {
      console.error('[PacketProcessor] Error processing packet:', err.message);
    }
  }
}

async function closeEngineSession(sessionId, endTime, lat, lng, fuelLevel, state) {
  const session = await VehicleEngineSession.findByPk(sessionId);
  if (!session || session.status === 'completed') return;
  const durationSec = Math.max(0, Math.floor(
    (new Date(endTime).getTime() - new Date(session.startTime).getTime()) / 1000
  ));
  const fuelConsumed =
    session.startFuelLevel !== null && fuelLevel !== null
      ? Math.max(0, session.startFuelLevel - fuelLevel)
      : 0;
  await session.update({
    endTime,
    durationSeconds: durationSec,
    endLatitude: lat || null,
    endLongitude: lng || null,
    endFuelLevel: fuelLevel,
    fuelConsumed,
    status: 'completed',
  });
}

async function closeTripIfActive(tripId, endTime) {
  const trip = await Trip.findByPk(tripId);
  if (!trip) return;
  const durationSec = Math.max(0, Math.floor(
    (new Date(endTime).getTime() - new Date(trip.startTime).getTime()) / 1000
  ));
  await trip.update({ endTime, duration: durationSec });
}

/**
 * Batch reprocess historical packets from MongoDB for a vehicle.
 * Used for backfilling existing data.
 */
async function reprocessVehicle(vehicleId, from, to) {
  const { getMongoDb } = require('../config/mongodb');
  const vehicle = await Vehicle.findByPk(vehicleId);
  if (!vehicle || !vehicle.imei) return { processed: 0 };

  // Block live change-stream packets for this vehicle while reprocessing.
  // Without this lock the live stream can process a current-time packet
  // mid-run and create trips/sessions in DB state that the reprocess will
  // then overwrite with historical timestamps, producing negative durations.
  reprocessingVehicles.add(vehicleId);

  try {
  // Clear stale cache so processPacket finds the active vehicle, not a soft-deleted one with the same IMEI
  invalidateVehicleCache(vehicle.imei);

  const db = getMongoDb();
  const fromDate = new Date(from);
  const toDate = new Date(to);

  // Determine which collections to check
  const collections = [];
  const dtype = (vehicle.deviceType || '').toUpperCase();
  if (dtype.startsWith('FMB')) {
    collections.push(`${dtype.toLowerCase()}locations`);
  } else if (dtype === 'GT06') {
    collections.push('gt06locations');
  } else {
    collections.push('fmb125locations', 'gt06locations');
  }

  let processed = 0;
  const imeis = [vehicle.imei];
  if (vehicle.imei.startsWith('0')) imeis.push(vehicle.imei.slice(1));
  else imeis.push('0' + vehicle.imei);

  // Capture prior engine state before wiping so the state machine can resume
  // in the correct context (e.g. engine was ON from a trip that started before
  // the reprocess range and continues into it).
  const priorState = await VehicleDeviceState.findOne({ where: { vehicleId } });
  const priorContext =
    priorState &&
    priorState.lastPacketTime &&
    new Date(priorState.lastPacketTime) < fromDate
      ? {
          engineOn: priorState.engineOn,
          engineOnSince: priorState.engineOn ? priorState.engineOnSince : null,
          lastLat: priorState.lastLat,
          lastLng: priorState.lastLng,
          lastFuelLevel: priorState.lastFuelLevel,
          lastOdometer: priorState.lastOdometer,
        }
      : null;

  // Reset device state for clean reprocessing
  await VehicleDeviceState.destroy({ where: { vehicleId } });

  // Remove existing data in range — also catch records that SPAN the range
  // boundary (started before fromDate but extend into or past toDate).
  const spanOrInRange = (timeCol) => ({
    vehicleId,
    [Op.or]: [
      { [timeCol]: { [Op.between]: [fromDate, toDate] } },
      { [timeCol]: { [Op.lt]: fromDate }, endTime: { [Op.gt]: fromDate } },
      { [timeCol]: { [Op.lt]: fromDate }, endTime: null },
    ],
  });
  await VehicleEngineSession.destroy({ where: spanOrInRange('startTime') });
  await VehicleFuelEvent.destroy({ where: { vehicleId, eventTime: { [Op.between]: [fromDate, toDate] } } });
  await Trip.destroy({ where: spanOrInRange('startTime') });
  await Stop.destroy({ where: spanOrInRange('startTime') });

  // Restore prior engine context so the state machine begins in the correct
  // state.  All time anchors are clamped to fromDate so that:
  //
  //   1. engineOnSince = fromDate  → the recovery session/trip created by the
  //      first STILL-ON packet will have startTime = fromDate (within the
  //      report range), not yesterday's timestamp which would make it invisible
  //      to date-range queries.
  //
  //   2. lastGpsPacketTime = fromDate  → gap detection has a valid baseline for
  //      the very first incoming packet.  If the first packet arrives < 30 min
  //      after midnight the gap is small → no split; session starts at fromDate.
  //      If the first packet is ≥ 30 min after midnight the gap fires → engine-
  //      OnSince resets to the first real packet time → session starts at first
  //      real data point.  Either way the session falls inside today's range.
  if (priorContext) {
    await VehicleDeviceState.create({
      vehicleId,
      imei: vehicle.imei,
      engineOn: priorContext.engineOn,
      engineOnSince: priorContext.engineOn ? fromDate : null,  // clamped to range start
      lastLat: priorContext.lastLat,
      lastLng: priorContext.lastLng,
      lastFuelLevel: priorContext.lastFuelLevel,
      lastOdometer: priorContext.lastOdometer,
      lastPacketTime: fromDate,       // anchored to range start
      lastGpsPacketTime: priorContext.engineOn ? fromDate : null, // gap-detection baseline
      currentTripId: null,            // re-created by STILL ON recovery block on first packet
      currentSessionId: null,
      pendingTripEnd: false,
      engineOffSince: null,
    });
  }

  for (const colName of collections) {
    try {
      const col = db.collection(colName);
      const cursor = col
        .find({ imei: { $in: imeis }, timestamp: { $gte: fromDate, $lte: toDate } })
        .sort({ timestamp: 1 });

      for await (const doc of cursor) {
        const dt = colName.includes('fmb') ? 'FMB125' : 'GT06';
        await processPacket(doc, dt);
        processed++;
      }
    } catch (_) { /* collection may not exist */ }
  }

  return { processed };
  } finally {
    reprocessingVehicles.delete(vehicleId);
  }
}

module.exports = { processPacket, reprocessVehicle, invalidateVehicleCache };
