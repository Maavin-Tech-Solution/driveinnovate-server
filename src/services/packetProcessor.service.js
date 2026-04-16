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

module.exports = { processPacket, invalidateVehicleCache };
