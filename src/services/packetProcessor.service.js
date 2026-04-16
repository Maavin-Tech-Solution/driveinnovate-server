/**
 * PacketProcessor — real-time state machine for vehicle tracking data.
 * ─────────────────────────────────────────────────────────────────────────────
 * Called for every new GPS packet (via MongoDB change stream OR batch reprocessing).
 *
 * Works with any device type by delegating raw-packet normalization to
 * packetNormalizer.service.js.  Device-specific ignition logic is controlled
 * by the device's capability descriptor (deviceCapabilities.js), NOT by
 * if/else chains inside this file.
 *
 * Updates per packet:
 *   vehicle_device_states    — live state tracker (one row per vehicle)
 *   vehicle_engine_sessions  — each ignition-on/off period
 *   trips                    — logical journeys (sessions grouped by idle threshold)
 *   vehicle_fuel_events      — fuel fill / drain detections
 *
 * ── Trip state machine overview ───────────────────────────────────────────────
 *
 *   ENGINE ON  (ignitionOn=true, prevEngineOn=false)
 *     → Start a new trip.  If pendingTripEnd=true AND the engine-off gap was
 *       < idleThreshold, RESUME the existing trip (traffic-light stop).
 *       If gap >= idleThreshold, close the lingering trip and start a new one.
 *
 *   ENGINE OFF (ignitionOn=false, prevEngineOn=true)
 *     → Close the engine session.  Set pendingTripEnd + start idle debounce.
 *       The trip stays open — a brief stop must not split a trip.
 *
 *   STILL OFF  (ignitionOn=false, pendingTripEnd=true)
 *     → Once engine-off gap >= idleThreshold, close the trip.
 *
 *   STILL ON   (ignitionOn=true, prevEngineOn=true)
 *     → Accumulate distance, update route / speed / times.
 *     → Gap detection: no GPS packet for > MAX_GPS_GAP_MS → assume silent shutoff.
 *
 * ── Ignition detection ────────────────────────────────────────────────────────
 *   Controlled by device capability `ignitionSource`:
 *
 *   'ignition-io'      (FMB125, FMB920, AIS140)
 *     → normalizer already resolved doc.ignition; use it directly.
 *       ignitionOn = pkt.ignition
 *
 *   'acc-strict'       (GT06 with TRIP_ON_IGNITION=true)
 *     → Trust ACC bit regardless of speed.
 *       ignitionOn = pkt.ignition (= !!doc.acc from normalizer)
 *
 *   'acc-hysteresis'   (GT06 without TRIP_ON_IGNITION / generic fallback)
 *     → Speed-based hysteresis to suppress traffic-light flicker:
 *       ON  when acc=true OR speed ≥ 5 km/h
 *       OFF when acc=false AND speed === 0
 *       HOLD (keep previous) when 0 < speed < 5 km/h
 */

const { Op } = require('sequelize');
const {
  Vehicle,
  VehicleDeviceState,
  VehicleEngineSession,
  VehicleFuelEvent,
  Trip,
  Stop,
} = require('../models');
const { normalizePacket }   = require('./packetNormalizer.service');
const { getCapabilities }   = require('../config/deviceCapabilities');

// ─── Constants ────────────────────────────────────────────────────────────────

// Maximum GPS gap before assuming the vehicle stopped (engine-off packet missed).
const MAX_GPS_GAP_MS = 30 * 60 * 1000; // 30 minutes

// Trip detection mode (env-driven, read once at startup)
const TRIP_ON_IGNITION = process.env.TRIP_ON_IGNITION === 'true';
const TRIP_MIN_IDLE_MS = parseInt(process.env.TRIP_MIN_IDLE_MINUTES || '1', 10) * 60 * 1000;
console.log(`[PacketProcessor] TRIP_ON_IGNITION=${TRIP_ON_IGNITION}  TRIP_MIN_IDLE_MINUTES=${TRIP_MIN_IDLE_MS / 60000}`);

// Minimum movement speed (km/h) to count a segment as "driving" vs "idling"
const DRIVING_SPEED_THRESHOLD = 2;

// ─── Vehicle lookup cache (imei → Vehicle row) ────────────────────────────────
const vehicleCache = new Map();

async function getVehicle(imei) {
  if (vehicleCache.has(imei)) return vehicleCache.get(imei);
  const candidates = [imei];
  if (imei.startsWith('0')) candidates.push(imei.slice(1));
  else candidates.push('0' + imei);

  const v = await Vehicle.findOne({
    where: { imei: candidates },
    attributes: ['id', 'imei', 'idleThreshold', 'fuelFillThreshold', 'deviceType'],
  });
  if (v) {
    vehicleCache.set(imei, v);
    vehicleCache.set(v.imei, v);
  }
  return v;
}

function invalidateVehicleCache(imei) {
  vehicleCache.delete(imei);
  if (imei?.startsWith('0')) vehicleCache.delete(imei.slice(1));
  else if (imei) vehicleCache.delete('0' + imei);
}

// ─── Reprocess lock ───────────────────────────────────────────────────────────
const reprocessingVehicles = new Set();

// ─── Haversine distance (km) ──────────────────────────────────────────────────
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

// ─── Ignition detection ───────────────────────────────────────────────────────
/**
 * Resolve current ignition state from a normalized packet.
 * Returns true/false (never null) by falling back to prevEngineOn when ambiguous.
 */
function resolveIgnition(pkt, caps, prevEngineOn) {
  // For devices with a dedicated ignition IO element (FMB125, FMB920, AIS140)
  // the normalizer sets pkt.ignition from the reliable IO signal.
  if (caps.ignitionSource === 'ignition-io') {
    return pkt.ignition !== null ? pkt.ignition : prevEngineOn;
  }

  // GT06 with TRIP_ON_IGNITION=true — strict ACC bit
  if (caps.ignitionSource === 'acc-strict' || TRIP_ON_IGNITION) {
    return pkt.ignition !== null ? pkt.ignition : prevEngineOn;
  }

  // acc-hysteresis (GT06 legacy / generic fallback)
  const speed = pkt.speed || 0;
  const acc   = pkt.ignition; // normalizer maps acc→ignition for GT06
  if (acc === true || speed >= 5) return true;
  if (acc === false && speed === 0) return false;
  return prevEngineOn; // hold — ambiguous speed range (1–4 km/h)
}

// ─── Main processor ───────────────────────────────────────────────────────────
/**
 * Process a single raw MongoDB document.
 *
 * @param {object} doc        Raw MongoDB document from any device collection
 * @param {string} deviceType e.g. 'GT06', 'FMB125', 'FMB920', 'AIS140'
 */
async function processPacket(doc, deviceType, { skipLockCheck = false } = {}) {
  try {
    if (!doc?.imei) {
      console.warn(`[PacketProcessor:${deviceType}] Packet missing IMEI, skipping`);
      return;
    }

    // ── 1. Normalize raw packet to common shape ────────────────────────────
    const pkt  = normalizePacket(doc, deviceType);
    const caps = getCapabilities(deviceType);
    const imei = pkt.imei;

    // ── 2. Resolve vehicle ─────────────────────────────────────────────────
    const vehicle = await getVehicle(imei);
    if (!vehicle) {
      console.warn(`[PacketProcessor:${deviceType}] No vehicle for IMEI "${imei}", skipping`);
      return;
    }
    const vehicleId = vehicle.id;
    if (!skipLockCheck && reprocessingVehicles.has(vehicleId)) return;

    const idleThresholdMs   = (vehicle.idleThreshold  || 5) * 60 * 1000;
    const fuelFillThreshold = vehicle.fuelFillThreshold || 5;

    // ── 3. Status-only packets (GT06 STATUS 0x13 without ACC signal) ───────
    // These have no GPS and no ignition signal.  Only refresh lastPacketTime.
    // Exception: when TRIP_ON_IGNITION=true and packet carries a valid ignition
    // signal, let it fall through so the state machine can close/open trips.
    if (pkt.isStatusOnly && pkt.ignition === null) {
      let state = await VehicleDeviceState.findOne({ where: { vehicleId } });
      if (!state) state = await VehicleDeviceState.create({ vehicleId, imei });
      await VehicleDeviceState.update({ lastPacketTime: pkt.timestamp }, { where: { vehicleId } });
      return;
    }

    // ── 4. Get or create device state ──────────────────────────────────────
    let state = await VehicleDeviceState.findOne({ where: { vehicleId } });
    if (!state) state = await VehicleDeviceState.create({ vehicleId, imei });

    const prevEngineOn  = state.engineOn;
    const prevFuelLevel = state.lastFuelLevel;

    // ── 5. Resolve ignition from normalized packet + device strategy ────────
    const ignitionOn = resolveIgnition(pkt, caps, prevEngineOn);

    console.log(
      `[PacketProcessor:${deviceType}] imei=${imei} vehicleId=${vehicleId} ` +
      `ignition=${ignitionOn} speed=${pkt.speed} lat=${pkt.lat} lng=${pkt.lng} ` +
      `fuel=${pkt.fuel} odo=${pkt.odometer} ts=${pkt.timestamp.toISOString()}`
    );

    const now = pkt.timestamp.getTime();

    // ── 6. Fuel event detection ─────────────────────────────────────────────
    if (pkt.fuel !== null && prevFuelLevel !== null) {
      const diff = pkt.fuel - prevFuelLevel;
      if (diff >= fuelFillThreshold) {
        await VehicleFuelEvent.create({
          vehicleId, imei, eventType: 'fill', eventTime: pkt.timestamp,
          fuelBefore: prevFuelLevel, fuelAfter: pkt.fuel, fuelChangePct: diff,
          latitude: pkt.lat, longitude: pkt.lng,
        });
      } else if (diff <= -(fuelFillThreshold * 2)) {
        await VehicleFuelEvent.create({
          vehicleId, imei, eventType: 'drain', eventTime: pkt.timestamp,
          fuelBefore: prevFuelLevel, fuelAfter: pkt.fuel, fuelChangePct: Math.abs(diff),
          latitude: pkt.lat, longitude: pkt.lng,
        });
      }
    }

    // ── 7. Trip state machine ───────────────────────────────────────────────

    if (ignitionOn && !prevEngineOn) {
      // ── ENGINE TURNED ON ────────────────────────────────────────────────
      if (state.pendingTripEnd && state.currentTripId) {
        const engineOffMs   = state.engineOffSince
          ? now - new Date(state.engineOffSince).getTime() : Infinity;
        const lastRunningMs = state.lastGpsPacketTime
          ? now - new Date(state.lastGpsPacketTime).getTime() : Infinity;

        // Determine whether this was a long stop or a brief traffic-light pause.
        // Strategy depends on mode:
        //   TRIP_ON_IGNITION: long if off >= TRIP_MIN_IDLE_MS or GPS gap too big
        //   acc-hysteresis (GT06 legacy): hysteresis already filtered traffic stops
        //     so any pendingTripEnd is always treated as a long stop
        //   ignition-io (FMB, AIS): respect per-vehicle idleThreshold
        const isLongStop = TRIP_ON_IGNITION
          ? (engineOffMs >= TRIP_MIN_IDLE_MS || lastRunningMs >= MAX_GPS_GAP_MS)
          : (caps.ignitionSource === 'acc-hysteresis'
            ? true
            : (engineOffMs >= idleThresholdMs || lastRunningMs >= MAX_GPS_GAP_MS));

        if (!isLongStop) {
          // Brief stop — resume existing trip
          state.pendingTripEnd = false;
          state.engineOffSince = null;
        } else {
          // Long stop — trip was already closed on ENGINE OFF; just clear the reference
          state.currentTripId  = null;
          state.pendingTripEnd = false;
          state.engineOffSince = null;
        }
      }

      // Start a new trip if we don't have one
      if (!state.currentTripId) {
        const newTrip = await Trip.create({
          vehicleId, imei,
          startTime: pkt.timestamp, endTime: pkt.timestamp,
          duration: 0, distance: 0,
          startLatitude: pkt.lat, startLongitude: pkt.lng,
          avgSpeed: 0, maxSpeed: 0,
          drivingTimeSeconds: 0, engineIdleSeconds: 0, idleTime: 0,
          stoppageCount: 0, fuelConsumed: null,
          odometerStart: pkt.odometer || null,
          routeData: pkt.lat ? [{ lat: pkt.lat, lng: pkt.lng, ts: pkt.timestamp.toISOString(), spd: pkt.speed }] : [],
        });
        state.currentTripId = newTrip.id;
      }

      // Start a new engine session
      const newSession = await VehicleEngineSession.create({
        vehicleId, imei,
        startTime: pkt.timestamp,
        startLatitude: pkt.lat, startLongitude: pkt.lng,
        startFuelLevel: pkt.fuel,
        odometerStart: pkt.odometer || null,
        tripId: state.currentTripId,
        distanceKm: 0, drivingSeconds: 0, idleSeconds: 0, status: 'active',
      });
      state.currentSessionId = newSession.id;
      state.engineOn         = true;
      state.engineOnSince    = pkt.timestamp;

    } else if (!ignitionOn && prevEngineOn) {
      // ── ENGINE TURNED OFF ───────────────────────────────────────────────
      if (state.currentSessionId) {
        await closeEngineSession(state.currentSessionId, pkt.timestamp, pkt.lat, pkt.lng, pkt.fuel, pkt.odometer, state);
      }
      // Close trip immediately — it is visible in reports right away.
      // currentTripId is preserved so a brief stop (< idleThreshold) can resume it.
      if (state.currentTripId) {
        await closeTripIfActive(state.currentTripId, pkt.timestamp);
      }
      state.engineOn         = false;
      state.currentSessionId = null;
      state.engineOffSince   = pkt.timestamp;
      state.pendingTripEnd   = true;

    } else if (!ignitionOn && state.pendingTripEnd) {
      // ── STILL OFF — check idle threshold ───────────────────────────────
      const offMs = state.engineOffSince
        ? now - new Date(state.engineOffSince).getTime() : Infinity;

      const offThresholdMs = TRIP_ON_IGNITION
        ? TRIP_MIN_IDLE_MS
        : (caps.ignitionSource === 'acc-hysteresis' ? 0 : idleThresholdMs);

      if (offMs >= offThresholdMs && state.currentTripId) {
        // Trip was already closed on ENGINE OFF — just release the resume reference
        state.currentTripId  = null;
        state.pendingTripEnd = false;
      }

    } else if (ignitionOn && prevEngineOn) {
      // ── ENGINE STILL ON — accumulate ────────────────────────────────────

      // Gap detection: if no real GPS for > MAX_GPS_GAP_MS, assume silent shutoff
      const gapCheckTime = state.lastGpsPacketTime;
      if (gapCheckTime) {
        const gapMs = now - new Date(gapCheckTime).getTime();
        if (gapMs > MAX_GPS_GAP_MS) {
          if (state.currentTripId) {
            await closeTripIfActive(state.currentTripId, new Date(gapCheckTime));
            state.currentTripId = null;
          }
          if (state.currentSessionId) {
            await closeEngineSession(state.currentSessionId, new Date(gapCheckTime), state.lastLat, state.lastLng, state.lastFuelLevel, null, state);
            state.currentSessionId = null;
          }
          state.pendingTripEnd = false;
          state.engineOnSince  = pkt.timestamp;
        }
      }

      // Recovery: engine was ON at start of reprocess range but records were deleted
      let justCreated = false;
      if (!state.currentTripId) {
        const newTrip = await Trip.create({
          vehicleId, imei,
          startTime: state.engineOnSince || pkt.timestamp, endTime: pkt.timestamp,
          duration: 0, distance: 0,
          startLatitude: state.lastLat || pkt.lat, startLongitude: state.lastLng || pkt.lng,
          avgSpeed: 0, maxSpeed: 0,
          drivingTimeSeconds: 0, engineIdleSeconds: 0, idleTime: 0,
          stoppageCount: 0, fuelConsumed: null,
          odometerStart: pkt.odometer || null,
          routeData: pkt.lat ? [{ lat: pkt.lat, lng: pkt.lng, ts: pkt.timestamp.toISOString(), spd: pkt.speed }] : [],
        });
        state.currentTripId = newTrip.id;
        justCreated = true;
      }
      if (!state.currentSessionId) {
        const newSession = await VehicleEngineSession.create({
          vehicleId, imei,
          startTime: state.engineOnSince || pkt.timestamp,
          startLatitude: pkt.lat, startLongitude: pkt.lng,
          startFuelLevel: pkt.fuel,
          odometerStart: pkt.odometer || null,
          tripId: state.currentTripId,
          distanceKm: 0, drivingSeconds: 0, idleSeconds: 0, status: 'active',
        });
        state.currentSessionId = newSession.id;
        justCreated = true;
      }

      // Segment distance
      const prevLat   = state.lastLat;
      const prevLng   = state.lastLng;
      const segmentKm = (!justCreated && prevLat && pkt.lat)
        ? haversine(prevLat, prevLng, pkt.lat, pkt.lng) : 0;

      // Determine if this segment was driving or idling
      const isDriving = pkt.speed >= DRIVING_SPEED_THRESHOLD;
      // Approximate segment duration from last GPS packet time
      const segmentSecs = state.lastGpsPacketTime && pkt.lat
        ? Math.max(0, Math.floor((now - new Date(state.lastGpsPacketTime).getTime()) / 1000))
        : 0;

      await VehicleEngineSession.increment(
        {
          distanceKm:     segmentKm,
          drivingSeconds: isDriving ? segmentSecs : 0,
          idleSeconds:    isDriving ? 0 : segmentSecs,
        },
        { where: { id: state.currentSessionId } }
      );

      const trip = await Trip.findByPk(state.currentTripId);
      if (trip) {
        const durationSec = Math.floor((now - new Date(trip.startTime).getTime()) / 1000);
        const newDist     = parseFloat(trip.distance || 0) + segmentKm;
        const newMax      = Math.max(parseFloat(trip.maxSpeed || 0), pkt.speed);

        // Append route point (sample every ~30 s)
        let route = trip.routeData || [];
        const lastPt = route[route.length - 1];
        if (pkt.lat && (!lastPt || (now - new Date(lastPt.ts).getTime()) / 1000 >= 30)) {
          route = [...route, { lat: pkt.lat, lng: pkt.lng, ts: pkt.timestamp.toISOString(), spd: pkt.speed }];
          if (route.length > 2000) route = route.slice(-2000);
        }

        const movingPts = route.filter(p => p.spd >= DRIVING_SPEED_THRESHOLD);
        const avgSpeed  = movingPts.length
          ? movingPts.reduce((s, p) => s + p.spd, 0) / movingPts.length : 0;

        await trip.update({
          endTime:            pkt.timestamp,
          duration:           durationSec,
          distance:           newDist,
          maxSpeed:           newMax,
          avgSpeed:           Math.round(avgSpeed * 100) / 100,
          endLatitude:        pkt.lat || trip.endLatitude,
          endLongitude:       pkt.lng || trip.endLongitude,
          routeData:          route,
          odometerEnd:        pkt.odometer != null ? pkt.odometer : trip.odometerEnd,
          drivingTimeSeconds: (trip.drivingTimeSeconds || 0) + (isDriving ? segmentSecs : 0),
          engineIdleSeconds:  (trip.engineIdleSeconds  || 0) + (isDriving ? 0 : segmentSecs),
          idleTime:           (trip.idleTime           || 0) + (isDriving ? 0 : segmentSecs),
          fuelConsumed:       (pkt.fuel !== null && trip.odometerStart !== null)
                                ? Math.max(0, (state.lastFuelLevel || pkt.fuel) - pkt.fuel)
                                : trip.fuelConsumed,
        });
      }
    }

    // ── 8. Persist live device state ────────────────────────────────────────
    await state.save();
    await VehicleDeviceState.update(
      {
        lastLat:             pkt.lat  || state.lastLat,
        lastLng:             pkt.lng  || state.lastLng,
        lastAltitude:        pkt.altitude   != null ? pkt.altitude   : state.lastAltitude,
        lastSatellites:      pkt.satellites != null ? pkt.satellites : state.lastSatellites,
        lastCourse:          pkt.course     != null ? pkt.course     : state.lastCourse,
        lastSpeed:           pkt.speed,
        lastFuelLevel:       pkt.fuel       != null ? pkt.fuel       : state.lastFuelLevel,
        lastOdometer:        state.lastOdometer,               // haversine-accumulated (unchanged here)
        lastOdometerReading: pkt.odometer   != null ? pkt.odometer   : state.lastOdometerReading,
        lastBattery:         pkt.battery    != null ? pkt.battery    : state.lastBattery,
        lastExternalVoltage: pkt.externalVoltage != null ? pkt.externalVoltage : state.lastExternalVoltage,
        lastGsmSignal:       pkt.gsmSignal  != null ? pkt.gsmSignal  : state.lastGsmSignal,
        lastPacketTime:      pkt.timestamp,
        lastGpsPacketTime:   (ignitionOn && pkt.hasGps) ? pkt.timestamp : state.lastGpsPacketTime,
        engineOn:            ignitionOn,
        currentSessionId:    state.currentSessionId,
        currentTripId:       state.currentTripId,
        engineOnSince:       state.engineOnSince,
        engineOffSince:      state.engineOffSince,
        pendingTripEnd:      state.pendingTripEnd,
      },
      { where: { vehicleId } }
    );
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError' && doc?.imei) {
      invalidateVehicleCache(doc.imei);
      console.warn(`[PacketProcessor] FK violation for IMEI ${doc.imei} — cache cleared`);
    } else {
      console.error('[PacketProcessor] Error processing packet:', err.message);
    }
  }
}

// ─── Session close helper ─────────────────────────────────────────────────────
async function closeEngineSession(sessionId, endTime, lat, lng, fuelLevel, odometer, _state) {
  const session = await VehicleEngineSession.findByPk(sessionId);
  if (!session || session.status === 'completed') return;

  const durationSec = Math.max(0, Math.floor(
    (new Date(endTime).getTime() - new Date(session.startTime).getTime()) / 1000
  ));
  const fuelConsumed =
    session.startFuelLevel !== null && fuelLevel !== null
      ? Math.max(0, session.startFuelLevel - fuelLevel) : 0;

  await session.update({
    endTime,
    durationSeconds: durationSec,
    endLatitude:     lat  || null,
    endLongitude:    lng  || null,
    endFuelLevel:    fuelLevel,
    odometerEnd:     odometer != null ? odometer : session.odometerEnd,
    fuelConsumed,
    status: 'completed',
  });
}

// ─── Trip close helper ────────────────────────────────────────────────────────
async function closeTripIfActive(tripId, endTime) {
  const trip = await Trip.findByPk(tripId);
  if (!trip) return;
  const durationSec = Math.max(0, Math.floor(
    (new Date(endTime).getTime() - new Date(trip.startTime).getTime()) / 1000
  ));
  await trip.update({ endTime, duration: durationSec });
}

// ─── Batch reprocess ──────────────────────────────────────────────────────────
/**
 * Reprocess all historical packets from MongoDB for a vehicle in a date range.
 * Deletes existing trips/sessions/stops for the range and rebuilds from scratch.
 *
 * Safe to call while the vehicle is live:
 *   - Live VehicleDeviceState is saved and fully restored after reprocess so
 *     today's tracking is never interrupted.
 *   - The reprocessingVehicles lock uses the integer vehicleId so the change
 *     stream is properly blocked during replay.
 *
 * Works with any device type because processPacket() uses the normalizer.
 */
async function reprocessVehicle(vehicleId, from, to) {
  const { getMongoDb }   = require('../config/mongodb');
  const { DeviceConfig } = require('../models');

  // Normalise to integer — req.params.id arrives as a string; the Set must
  // hold the same type that processPacket uses (vehicle.id = integer).
  const vid = parseInt(vehicleId, 10);

  const vehicle = await Vehicle.findByPk(vid);
  if (!vehicle || !vehicle.imei) return { processed: 0 };

  // Block live change-stream packets from racing with reprocess
  reprocessingVehicles.add(vid);

  try {
    invalidateVehicleCache(vehicle.imei);

    const db       = getMongoDb();
    const fromDate = new Date(from);
    const toDate   = new Date(to);

    // ── 1. Resolve MongoDB collection for this device type ─────────────────
    const dtype = (vehicle.deviceType || '').toUpperCase();
    let collections = [];

    const cfg = dtype
      ? await DeviceConfig.findOne({ where: { type: dtype } })
      : null;

    if (cfg?.mongoCollection) {
      // DeviceConfig is authoritative
      collections = [{ colName: cfg.mongoCollection, deviceType: dtype }];
    } else if (dtype === 'AIS140') {
      collections = [{ colName: 'ais140locations', deviceType: 'AIS140' }];
    } else if (dtype.startsWith('FMB')) {
      collections = [{ colName: `${dtype.toLowerCase()}locations`, deviceType: dtype }];
    } else if (dtype === 'GT06') {
      collections = [{ colName: 'gt06locations', deviceType: 'GT06' }];
    } else {
      // Unknown device type — try all known collections
      collections = [
        { colName: 'ais140locations',  deviceType: 'AIS140' },
        { colName: 'fmb125locations',  deviceType: 'FMB125' },
        { colName: 'gt06locations',    deviceType: 'GT06'   },
      ];
    }

    // ── 2. Snapshot live state so we can restore it after reprocess ────────
    // This is critical: reprocess wipes VehicleDeviceState during replay.
    // If the vehicle is live (lastPacketTime > toDate), we MUST restore the
    // live state afterwards, otherwise today's tracking is wiped.
    const liveSnap = await VehicleDeviceState.findOne({ where: { vehicleId: vid } });
    const liveSnapJson = liveSnap ? liveSnap.toJSON() : null;
    const liveIsNewer  = liveSnapJson?.lastPacketTime
      && new Date(liveSnapJson.lastPacketTime) > toDate;

    // Context to seed the reprocess state machine:
    // Use the snapshot only if its lastPacketTime is *before* the range start
    // so we carry the correct engineOn/fuel/etc. into the replay.
    const priorContext =
      liveSnapJson?.lastPacketTime && new Date(liveSnapJson.lastPacketTime) < fromDate
        ? {
            engineOn:            liveSnapJson.engineOn,
            engineOnSince:       liveSnapJson.engineOn ? liveSnapJson.engineOnSince : null,
            lastLat:             liveSnapJson.lastLat,
            lastLng:             liveSnapJson.lastLng,
            lastFuelLevel:       liveSnapJson.lastFuelLevel,
            lastOdometerReading: liveSnapJson.lastOdometerReading,
          }
        : null;

    // ── 3. Wipe device state; delete trips/sessions that overlap the range ─
    await VehicleDeviceState.destroy({ where: { vehicleId: vid } });

    // Only remove records strictly within or overlapping the requested range.
    // The endTime: null guard excludes open records that started AFTER toDate
    // (e.g. a trip that just started today — it must not be deleted).
    const spanOrInRange = (timeCol) => ({
      vehicleId: vid,
      [Op.or]: [
        { [timeCol]: { [Op.between]: [fromDate, toDate] } },
        { [timeCol]: { [Op.lt]: fromDate }, endTime: { [Op.between]: [fromDate, toDate] } },
        // Open record that started before range — only if it actually started in
        // the past (not an active record whose startTime is after toDate)
        { [timeCol]: { [Op.between]: [fromDate, toDate] }, endTime: null },
      ],
    });
    await VehicleEngineSession.destroy({ where: spanOrInRange('startTime') });
    await VehicleFuelEvent.destroy({ where: { vehicleId: vid, eventTime: { [Op.between]: [fromDate, toDate] } } });
    await Trip.destroy({ where: spanOrInRange('startTime') });
    await Stop.destroy({ where: spanOrInRange('startTime') });

    // ── 4. Seed reprocess state (context from before the range if available)
    if (priorContext) {
      await VehicleDeviceState.create({
        vehicleId:           vid,
        imei:                vehicle.imei,
        engineOn:            priorContext.engineOn,
        engineOnSince:       priorContext.engineOnSince,
        lastLat:             priorContext.lastLat,
        lastLng:             priorContext.lastLng,
        lastFuelLevel:       priorContext.lastFuelLevel,
        lastOdometerReading: priorContext.lastOdometerReading,
        lastGpsPacketTime:   priorContext.engineOn ? priorContext.engineOnSince : null,
      });
    }

    // ── 5. Replay packets in chronological order ───────────────────────────
    const imeis = [vehicle.imei];
    if (vehicle.imei.startsWith('0')) imeis.push(vehicle.imei.slice(1));
    else imeis.push('0' + vehicle.imei);

    let processed = 0;
    for (const { colName, deviceType } of collections) {
      let col;
      try { col = db.collection(colName); } catch (_) { continue; }

      const cursor = col
        .find({ imei: { $in: imeis }, timestamp: { $gte: fromDate, $lte: toDate } })
        .sort({ timestamp: 1 });

      for await (const rawDoc of cursor) {
        await processPacket(rawDoc, deviceType, { skipLockCheck: true });
        processed++;
      }
    }

    // ── 6. Restore live state if the vehicle was active after the range ─────
    // Without this, reprocessing historical data would overwrite today's
    // live tracking state (engine-on, current trip, last GPS, etc.).
    if (liveIsNewer) {
      const stateAfter = await VehicleDeviceState.findOne({ where: { vehicleId: vid } });
      const { id: _id, createdAt: _c, updatedAt: _u, vehicleId: _v, ...restFields } = liveSnapJson;
      if (stateAfter) {
        await stateAfter.update(restFields);
      } else {
        await VehicleDeviceState.create({ vehicleId: vid, ...restFields });
      }
      console.log(`[Reprocess] Restored live state for vehicle ${vid} (lastPacket=${liveSnapJson.lastPacketTime})`);
    }

    console.log(`[Reprocess] Vehicle ${vid}: replayed ${processed} packets in range [${fromDate.toISOString()} – ${toDate.toISOString()}]`);
    return { processed };

  } finally {
    reprocessingVehicles.delete(vid);
  }
}

module.exports = {
  processPacket,
  reprocessVehicle,
  invalidateVehicleCache,
};
