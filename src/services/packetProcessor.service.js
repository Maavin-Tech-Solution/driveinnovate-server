/**
 * PacketProcessor — real-time trip detection.
 *
 * Trip rules:
 *   START  : ignition ON  AND  speed > TRIP_START_SPEED km/h
 *   UPDATE : every packet while ignition ON and trip is active
 *   END    : ignition OFF  (any packet where ignition resolves to false)
 *
 * Engine session rules (for engine-hours report):
 *   START  : ignition ON
 *   END    : ignition OFF
 *
 * All results are written to MySQL in real-time.
 * Reports simply query the trips table — no reprocessing needed.
 */

const {
  Vehicle,
  VehicleDeviceState,
  VehicleEngineSession,
  VehicleFuelEvent,
  Trip,
} = require('../models');
const { normalizePacket }  = require('./packetNormalizer.service');
const { getCapabilities }  = require('../config/deviceCapabilities');
const { getMongoDb }       = require('../config/mongodb');

// ── Constants ─────────────────────────────────────────────────────────────────
const TRIP_START_SPEED    = 5;   // km/h — must exceed to open a new trip
const ROUTE_SAMPLE_SECS   = 30;  // append a route point at most every 30 s
const DRIVE_SPEED_THRESH  = 2;   // km/h — above this counts as "driving"

// ── Vehicle lookup cache (imei → Vehicle row) ─────────────────────────────────
const vehicleCache = new Map();

async function getVehicle(imei) {
  if (vehicleCache.has(imei)) return vehicleCache.get(imei);
  const candidates = [imei];
  if (imei.startsWith('0')) candidates.push(imei.slice(1));
  else candidates.push('0' + imei);
  const v = await Vehicle.findOne({
    where: { imei: candidates },
    attributes: ['id', 'imei', 'deviceType', 'fuelFillThreshold'],
  });
  if (v) {
    vehicleCache.set(imei, v);
    vehicleCache.set(v.imei, v);
  }
  return v;
}

function invalidateVehicleCache(imei) {
  if (!imei) return;
  vehicleCache.delete(imei);
  const alt = imei.startsWith('0') ? imei.slice(1) : '0' + imei;
  vehicleCache.delete(alt);
}

// ── Haversine distance (km) ───────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  if (!lat1 || !lng1 || !lat2 || !lng2) return 0;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Ignition resolution ───────────────────────────────────────────────────────
/**
 * Converts a normalized packet's ignition signal to a boolean.
 *
 * Devices with a hardware ignition IO (FMB125, FMB920, AIS140):
 *   → trust pkt.ignition directly.
 *
 * GT06 / generic devices (no dedicated ignition pin):
 *   → use ACC bit + speed hysteresis to suppress false triggers.
 *     ON  when acc=true OR speed ≥ 5 km/h
 *     OFF when acc=false AND speed = 0
 *     HOLD (keep previous) for speeds 1–4 km/h (ambiguous)
 */
function resolveIgnition(pkt, caps, prevIgnition) {
  if (caps.ignitionSource === 'ignition-io' || caps.ignitionSource === 'acc-strict') {
    return pkt.ignition !== null ? pkt.ignition : prevIgnition;
  }
  // acc-hysteresis fallback (GT06 and generics)
  const speed = pkt.speed || 0;
  const acc   = pkt.ignition;
  if (acc === true  || speed >= 5)            return true;
  if (acc === false && speed === 0)           return false;
  return prevIgnition; // hold — ambiguous range
}

// ── Main processor ────────────────────────────────────────────────────────────
async function processPacket(doc, deviceType) {
  try {
    if (!doc?.imei) return;

    const pkt  = normalizePacket(doc, deviceType);
    const caps = getCapabilities(deviceType);

    const vehicle = await getVehicle(pkt.imei);
    if (!vehicle) return;

    const vehicleId          = vehicle.id;
    const fuelFillThreshold  = vehicle.fuelFillThreshold || 5;
    const now                = pkt.timestamp.getTime();

    // ── Get or create live device state ───────────────────────────────────────
    let state = await VehicleDeviceState.findOne({ where: { vehicleId } });
    if (!state) state = await VehicleDeviceState.create({ vehicleId, imei: pkt.imei });

    const prevIgnition = state.engineOn || false;
    const ignitionOn   = resolveIgnition(pkt, caps, prevIgnition);
    const speed        = pkt.speed || 0;

    console.log(
      `[PP] vid=${vehicleId} ign=${ignitionOn} spd=${speed} ` +
      `trip=${state.currentTripId || '-'} ts=${pkt.timestamp.toISOString()}`
    );

    // ── Fuel event detection ───────────────────────────────────────────────────
    if (pkt.fuel !== null && state.lastFuelLevel !== null) {
      const diff = pkt.fuel - state.lastFuelLevel;
      if (diff >= fuelFillThreshold) {
        await VehicleFuelEvent.create({
          vehicleId, imei: pkt.imei, eventType: 'fill', eventTime: pkt.timestamp,
          fuelBefore: state.lastFuelLevel, fuelAfter: pkt.fuel, fuelChangePct: diff,
          latitude: pkt.lat, longitude: pkt.lng,
        });
      } else if (diff <= -(fuelFillThreshold * 2)) {
        await VehicleFuelEvent.create({
          vehicleId, imei: pkt.imei, eventType: 'drain', eventTime: pkt.timestamp,
          fuelBefore: state.lastFuelLevel, fuelAfter: pkt.fuel, fuelChangePct: Math.abs(diff),
          latitude: pkt.lat, longitude: pkt.lng,
        });
      }
    }

    // ── Engine session tracking ────────────────────────────────────────────────
    if (ignitionOn && !prevIgnition) {
      // Engine just turned ON — open a new session
      const session = await VehicleEngineSession.create({
        vehicleId, imei: pkt.imei,
        startTime: pkt.timestamp,
        startLatitude: pkt.lat, startLongitude: pkt.lng,
        startFuelLevel: pkt.fuel,
        odometerStart: pkt.odometer || null,
        distanceKm: 0, drivingSeconds: 0, idleSeconds: 0,
        status: 'active',
      });
      state.currentSessionId = session.id;
      state.engineOnSince    = pkt.timestamp;

    } else if (!ignitionOn && prevIgnition && state.currentSessionId) {
      // Engine just turned OFF — close the active session
      const session = await VehicleEngineSession.findByPk(state.currentSessionId);
      if (session && session.status === 'active') {
        const durationSec  = Math.max(0, Math.floor((now - new Date(session.startTime).getTime()) / 1000));
        const fuelConsumed = (session.startFuelLevel !== null && pkt.fuel !== null)
          ? Math.max(0, session.startFuelLevel - pkt.fuel) : 0;
        await session.update({
          endTime: pkt.timestamp,
          durationSeconds: durationSec,
          endLatitude: pkt.lat, endLongitude: pkt.lng,
          endFuelLevel: pkt.fuel,
          odometerEnd: pkt.odometer != null ? pkt.odometer : session.odometerEnd,
          fuelConsumed,
          status: 'completed',
        });
      }
      state.currentSessionId = null;

    } else if (ignitionOn && prevIgnition && state.currentSessionId) {
      // Engine still ON — accumulate session distance/time
      const segKm   = haversine(state.lastLat, state.lastLng, pkt.lat, pkt.lng);
      const isDriving = speed >= DRIVE_SPEED_THRESH;
      const segSecs   = state.lastGpsPacketTime && pkt.lat
        ? Math.max(0, Math.floor((now - new Date(state.lastGpsPacketTime).getTime()) / 1000)) : 0;
      if (segKm > 0 || segSecs > 0) {
        await VehicleEngineSession.increment(
          {
            distanceKm:     segKm,
            drivingSeconds: isDriving ? segSecs : 0,
            idleSeconds:    isDriving ? 0 : segSecs,
          },
          { where: { id: state.currentSessionId } }
        );
      }
    }

    // ── Trip tracking ──────────────────────────────────────────────────────────

    if (ignitionOn && speed > TRIP_START_SPEED && !state.currentTripId) {
      // Condition met: ignition ON + moving — start a new trip
      const trip = await Trip.create({
        vehicleId, imei: pkt.imei,
        status:         'in_progress',
        startTime:      pkt.timestamp,
        endTime:        pkt.timestamp,
        startLatitude:  pkt.lat,
        startLongitude: pkt.lng,
        distance:          0,
        duration:          0,
        avgSpeed:          0,
        maxSpeed:          speed,
        drivingTimeSeconds: 0,
        engineIdleSeconds:  0,
        idleTime:           0,
        stoppageCount:      0,
        odometerStart:  pkt.odometer || null,
        routeData: pkt.lat
          ? [{ lat: pkt.lat, lng: pkt.lng, ts: pkt.timestamp.toISOString(), spd: speed }]
          : [],
      });
      state.currentTripId = trip.id;
      console.log(`[PP] Trip #${trip.id} STARTED for vehicle ${vehicleId}`);

    } else if (!ignitionOn && state.currentTripId) {
      // Ignition OFF — close the active trip
      const trip = await Trip.findByPk(state.currentTripId);
      if (trip && trip.status === 'in_progress') {
        const durationSec = Math.max(0, Math.floor((now - new Date(trip.startTime).getTime()) / 1000));
        await trip.update({
          status:       'completed',
          endTime:      pkt.timestamp,
          duration:     durationSec,
          endLatitude:  pkt.lat  || trip.endLatitude,
          endLongitude: pkt.lng  || trip.endLongitude,
          odometerEnd:  pkt.odometer != null ? pkt.odometer : trip.odometerEnd,
        });
        console.log(`[PP] Trip #${trip.id} COMPLETED for vehicle ${vehicleId} (${durationSec}s, ${trip.distance} km)`);
      }
      state.currentTripId = null;

    } else if (ignitionOn && state.currentTripId) {
      // Ignition ON, trip active — accumulate stats
      const trip = await Trip.findByPk(state.currentTripId);
      if (trip && trip.status === 'in_progress') {
        const segKm      = haversine(state.lastLat, state.lastLng, pkt.lat, pkt.lng);
        const newDist    = parseFloat(trip.distance || 0) + segKm;
        const newMax     = Math.max(parseFloat(trip.maxSpeed || 0), speed);
        const durationSec = Math.max(0, Math.floor((now - new Date(trip.startTime).getTime()) / 1000));
        const isDriving  = speed >= DRIVE_SPEED_THRESH;
        const segSecs    = state.lastGpsPacketTime && pkt.lat
          ? Math.max(0, Math.floor((now - new Date(state.lastGpsPacketTime).getTime()) / 1000)) : 0;

        // Build route (sample every ROUTE_SAMPLE_SECS)
        let route   = trip.routeData || [];
        const lastPt = route[route.length - 1];
        if (pkt.lat && (!lastPt || (now - new Date(lastPt.ts).getTime()) / 1000 >= ROUTE_SAMPLE_SECS)) {
          route = [...route, { lat: pkt.lat, lng: pkt.lng, ts: pkt.timestamp.toISOString(), spd: speed }];
          if (route.length > 2000) route = route.slice(-2000);
        }

        const movingPts = route.filter(p => p.spd >= DRIVE_SPEED_THRESH);
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
          drivingTimeSeconds: (trip.drivingTimeSeconds || 0) + (isDriving ? segSecs : 0),
          engineIdleSeconds:  (trip.engineIdleSeconds  || 0) + (isDriving ? 0 : segSecs),
          idleTime:           (trip.idleTime           || 0) + (isDriving ? 0 : segSecs),
        });
      }
    }

    // ── Persist live device state ──────────────────────────────────────────────
    state.engineOn          = ignitionOn;
    state.engineOffSince    = ignitionOn ? null : pkt.timestamp;
    state.lastLat           = pkt.lat       || state.lastLat;
    state.lastLng           = pkt.lng       || state.lastLng;
    state.lastAltitude      = pkt.altitude      != null ? pkt.altitude      : state.lastAltitude;
    state.lastSatellites    = pkt.satellites    != null ? pkt.satellites    : state.lastSatellites;
    state.lastCourse        = pkt.course        != null ? pkt.course        : state.lastCourse;
    state.lastSpeed         = pkt.speed;
    state.lastFuelLevel     = pkt.fuel          != null ? pkt.fuel          : state.lastFuelLevel;
    state.lastOdometerReading = pkt.odometer    != null ? pkt.odometer      : state.lastOdometerReading;
    state.lastBattery       = pkt.battery       != null ? pkt.battery       : state.lastBattery;
    state.lastExternalVoltage = pkt.externalVoltage != null ? pkt.externalVoltage : state.lastExternalVoltage;
    state.lastGsmSignal     = pkt.gsmSignal     != null ? pkt.gsmSignal     : state.lastGsmSignal;
    state.lastPacketTime    = pkt.timestamp;
    state.lastGpsPacketTime = (ignitionOn && pkt.hasGps) ? pkt.timestamp : state.lastGpsPacketTime;
    state.currentTripId     = state.currentTripId    || null;
    state.currentSessionId  = state.currentSessionId || null;
    state.pendingTripEnd    = false; // legacy field — always false in new logic
    await state.save();

  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError' && doc?.imei) {
      invalidateVehicleCache(doc.imei);
      console.warn(`[PP] FK violation for IMEI ${doc.imei} — cache cleared`);
    } else {
      console.error('[PP] Error processing packet:', err.message);
    }
  }
}

// ── Startup reconciliation ────────────────────────────────────────────────────
/**
 * Close any in_progress trips that the state machine is no longer tracking.
 *
 * This handles the case where the server (or change stream) was down when the
 * ignition-off packet arrived — the trip stays in_progress in MySQL forever
 * because processPacket was never called for that packet.
 *
 * Rules applied on startup:
 *   A) VehicleDeviceState.currentTripId === null but a trip with that vehicle
 *      is still in_progress  →  the state machine has already moved on; close
 *      the trip using trip.endTime (continuously updated while engine was ON).
 *
 *   B) VehicleDeviceState.currentTripId === trip.id but engineOn === false
 *      →  engine is off, state pointer wasn't cleared; close trip + clear pointer.
 *
 *   C) No VehicleDeviceState row at all for a vehicle that has an in_progress trip
 *      →  orphaned; close the trip.
 *
 *   D) trip.endTime is older than STALE_THRESHOLD_MS regardless of engineOn state
 *      →  server was down when ignition-OFF arrived (Render spin-down); engineOn
 *         stayed true in MySQL but the engine has long since turned off.
 *      While the engine is genuinely ON, endTime is updated every ~30 s per packet.
 *      30 minutes of silence means the device has gone dark or the engine is off.
 */
const STALE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

async function reconcileStaleTrips() {
  try {
    const staleTrips = await Trip.findAll({
      where: { status: 'in_progress' },
      attributes: ['id', 'vehicleId', 'startTime', 'endTime'],
    });

    if (!staleTrips.length) {
      console.log('[Reconcile] No in_progress trips found — nothing to do');
      return;
    }

    console.log(`[Reconcile] Found ${staleTrips.length} in_progress trip(s) — checking states…`);
    let closed = 0;

    for (const trip of staleTrips) {
      const state = await VehicleDeviceState.findOne({ where: { vehicleId: trip.vehicleId } });

      // Rule D: endTime hasn't been touched for 15+ minutes → engine is definitely off
      const endTimeMs   = trip.endTime ? new Date(trip.endTime).getTime() : null;
      const staleSinceMs = endTimeMs ? Date.now() - endTimeMs : null;
      const isStale      = staleSinceMs !== null && staleSinceMs > STALE_THRESHOLD_MS;

      console.log(
        `[Reconcile] trip #${trip.id} vid=${trip.vehicleId}` +
        ` endTime=${trip.endTime ? new Date(trip.endTime).toISOString() : 'NULL'}` +
        ` staleMin=${staleSinceMs !== null ? (staleSinceMs / 60000).toFixed(1) : 'N/A'}` +
        ` state.currentTripId=${state?.currentTripId ?? 'NO_STATE'}` +
        ` state.engineOn=${state?.engineOn ?? 'NO_STATE'}` +
        ` isStale=${isStale}`
      );

      const shouldClose =
        !state ||                                                 // C: no state row
        state.currentTripId !== trip.id ||                       // A: state no longer references this trip
        (state.currentTripId === trip.id && !state.engineOn) ||  // B: still referenced but engine OFF
        isStale;                                                  // D: endTime stale (server was down)

      if (!shouldClose) {
        console.log(`[Reconcile] trip #${trip.id} — skipping (no rule matched)`);
        continue;
      }

      // Use the trip's own endTime (updated live while engine was ON) as the end time.
      // Fall back to state.lastPacketTime, then now.
      const endTime = trip.endTime || state?.lastPacketTime || new Date();
      const durationSec = Math.max(
        0,
        Math.floor((new Date(endTime).getTime() - new Date(trip.startTime).getTime()) / 1000)
      );

      await trip.update({ status: 'completed', endTime, duration: durationSec });

      // Clear the dangling pointer in device state if it still points here
      if (state?.currentTripId === trip.id) {
        await state.update({ currentTripId: null, engineOn: false });
      }

      console.log(`[Reconcile] Closed stale trip #${trip.id} (vehicle ${trip.vehicleId}, ${durationSec}s)`);
      closed++;
    }

    console.log(`[Reconcile] Done — closed ${closed} stale trip(s)`);
  } catch (err) {
    console.error('[Reconcile] Error during stale-trip reconciliation:', err.message, err.stack);
  }
}

// ── Startup catch-up ──────────────────────────────────────────────────────────
/**
 * Process any MongoDB packets that arrived while the server was down.
 *
 * Change streams only deliver NEW inserts from the moment they start.
 * On Render free tier the server spins down after 15 min of inactivity,
 * so packets can pile up in MongoDB unprocessed for hours.
 *
 * For each vehicle we look up its VehicleDeviceState.lastPacketTime and replay
 * every MongoDB packet newer than that timestamp (capped at CATCHUP_LOOKBACK_MS).
 * Packets are fed through processPacket in chronological order so the state
 * machine behaves identically to the real-time path.
 *
 * Runs non-blocking in the background — the server is already accepting requests.
 */
const CATCHUP_LOOKBACK_MS = 48 * 60 * 60 * 1000; // look back up to 48 hours
const CATCHUP_BATCH_LIMIT = 5000;                  // max packets per vehicle per run

async function catchUpMissedPackets() {
  const { Op } = require('sequelize');
  let mongoDb;
  try {
    mongoDb = getMongoDb();
  } catch (e) {
    console.log('[CatchUp] MongoDB not ready — skipping:', e.message);
    return;
  }

  let vehicles;
  try {
    vehicles = await Vehicle.findAll({
      where: { imei: { [Op.ne]: null }, status: { [Op.ne]: 'deleted' } },
      attributes: ['id', 'imei', 'deviceType'],
    });
  } catch (err) {
    console.error('[CatchUp] Could not load vehicles from MySQL:', err.message);
    return;
  }

  const cutoff = new Date(Date.now() - CATCHUP_LOOKBACK_MS);
  let totalVehicles = 0;
  let totalPackets  = 0;

  for (const vehicle of vehicles) {
    try {
      // Find from-date: resume from lastPacketTime or fall back to 48-h cutoff
      const state = await VehicleDeviceState.findOne({ where: { vehicleId: vehicle.id } });
      const lastSeen = state?.lastPacketTime ? new Date(state.lastPacketTime) : null;
      const fromDate = lastSeen && lastSeen > cutoff ? lastSeen : cutoff;

      const caps = getCapabilities(vehicle.deviceType);

      // Try both with and without leading zero (device may send either form)
      const imeiVariants = [vehicle.imei];
      if (vehicle.imei.startsWith('0')) imeiVariants.push(vehicle.imei.slice(1));
      else imeiVariants.push('0' + vehicle.imei);

      const packets = await mongoDb
        .collection(caps.mongoCollection)
        .find({ imei: { $in: imeiVariants }, timestamp: { $gt: fromDate } })
        .sort({ timestamp: 1 })
        .limit(CATCHUP_BATCH_LIMIT)
        .toArray();

      if (!packets.length) continue;

      console.log(
        `[CatchUp] vehicle ${vehicle.id} (${vehicle.imei}): ` +
        `${packets.length} missed packet(s) since ${fromDate.toISOString()}`
      );

      for (const packet of packets) {
        await processPacket(packet, vehicle.deviceType);
      }

      totalVehicles++;
      totalPackets += packets.length;
    } catch (err) {
      console.warn(`[CatchUp] vehicle ${vehicle.id} error:`, err.message);
    }
  }

  if (totalPackets > 0) {
    console.log(`[CatchUp] Done — processed ${totalPackets} missed packet(s) for ${totalVehicles} vehicle(s)`);
  } else {
    console.log('[CatchUp] No missed packets found');
  }
}

// ── On-demand reprocess (PAPA only) ──────────────────────────────────────────
/**
 * Reprocess ALL MongoDB packets for a vehicle from scratch.
 *
 * 1. Deletes all existing trips, engine sessions, and fuel events for the vehicle.
 * 2. Resets VehicleDeviceState so the state machine starts clean.
 * 3. Replays every MongoDB packet through processPacket in chronological order.
 *
 * This is an admin action (PAPA accounts only) meant to rebuild trip history
 * when the real-time change stream missed packets (e.g. server was down).
 */
async function reprocessVehicle(vehicleId) {
  const { Op } = require('sequelize');

  const vehicle = await Vehicle.findByPk(vehicleId, {
    attributes: ['id', 'imei', 'deviceType'],
  });
  if (!vehicle || !vehicle.imei) {
    throw Object.assign(new Error('Vehicle not found or has no IMEI'), { status: 404 });
  }

  let mongoDb;
  try { mongoDb = getMongoDb(); } catch (e) {
    throw Object.assign(new Error('MongoDB not connected'), { status: 503 });
  }

  const caps = getCapabilities(vehicle.deviceType);
  const imeiVariants = [vehicle.imei];
  if (vehicle.imei.startsWith('0')) imeiVariants.push(vehicle.imei.slice(1));
  else imeiVariants.push('0' + vehicle.imei);

  // ── 1. Wipe existing computed data ──────────────────────────────────────────
  await Trip.destroy({ where: { vehicleId } });
  await VehicleEngineSession.destroy({ where: { vehicleId } });
  await VehicleFuelEvent.destroy({ where: { vehicleId } });

  const state = await VehicleDeviceState.findOne({ where: { vehicleId } });
  if (state) {
    await state.update({
      currentTripId: null,
      currentSessionId: null,
      engineOn: false,
      engineOnSince: null,
      pendingTripEnd: false,
      lastFuelLevel: null,
    });
  }

  // Invalidate vehicle cache so processPacket re-reads from DB
  invalidateVehicleCache(vehicle.imei);

  // ── 2. Fetch all packets from MongoDB ───────────────────────────────────────
  const packets = await mongoDb
    .collection(caps.mongoCollection)
    .find({ imei: { $in: imeiVariants } })
    .sort({ timestamp: 1 })
    .toArray();

  console.log(`[Reprocess] Vehicle ${vehicleId} (${vehicle.imei}): ${packets.length} packets in ${caps.mongoCollection}`);

  // ── 3. Replay through processPacket ─────────────────────────────────────────
  let processed = 0;
  for (const pkt of packets) {
    await processPacket(pkt, vehicle.deviceType);
    processed++;
    if (processed % 500 === 0) {
      console.log(`[Reprocess] Vehicle ${vehicleId}: ${processed}/${packets.length}…`);
    }
  }

  const tripCount = await Trip.count({ where: { vehicleId } });
  console.log(`[Reprocess] Vehicle ${vehicleId} done — ${processed} packets → ${tripCount} trips`);

  return { processed, tripsCreated: tripCount };
}

module.exports = { processPacket, invalidateVehicleCache, reconcileStaleTrips, catchUpMissedPackets, reprocessVehicle };
