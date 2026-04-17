/**
 * PacketProcessor — real-time trip detection.
 *
 * Trip rules (v3 — handles GT06 STATUS noise + AIS140 always-ON ignition):
 *   GATE    : only GPS-bearing packets participate in trip/engine decisions.
 *             STATUS (0x13), HEARTBEAT (0x23), and GPS-unfixed LOCATION packets
 *             use a different ACC register that conflicts with LOCATION's ACC,
 *             causing false ignition toggles that shatter trips into fragments.
 *   START   : ignition ON  AND  speed > TRIP_START_SPEED km/h
 *   UPDATE  : every GPS packet while ignition ON and trip is active
 *   END     : (a) ignition OFF confirmed for IGNITION_OFF_CONFIRM_MS (debounce)
 *             (b) speed < DRIVE_SPEED_THRESH for TRIP_IDLE_CLOSE_MS (idle close)
 *             (c) GPS gap > TRIP_GPS_GAP_MS (no GPS packets received)
 *
 * The idle-close rule (b) handles devices like AIS140 where ignition is always
 * reported as ON.  Without it, trips stay open forever during parking.
 *
 * Engine session rules:
 *   Same GPS-only gate.  START on ignition ON, END on confirmed ignition OFF.
 *
 * GPS noise guard:
 *   If the implied speed between consecutive GPS fixes exceeds MAX_JUMP_KPH,
 *   the new position is treated as jitter and excluded from distance sums.
 *
 * All results are written to MySQL in real-time.
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
const TRIP_START_SPEED         = 5;     // km/h — must exceed to open a new trip
const ROUTE_SAMPLE_SECS        = 30;    // append a route point at most every 30 s
const DRIVE_SPEED_THRESH       = 2;     // km/h — above this counts as "driving"
const IGNITION_OFF_CONFIRM_MS  = 30_000; // 30 s debounce before closing a trip
const TRIP_IDLE_CLOSE_MS       = 5 * 60_000; // 5 min — close trip if speed stays below DRIVE_SPEED_THRESH
const MAX_JUMP_KPH             = 200;   // GPS positions implying faster than this are noise
const TRIP_GPS_GAP_MS          = 5 * 60_000; // 5 min — auto-close trip if no GPS packet for this long
const MIN_TRIP_DURATION_SEC    = 30;    // trips shorter than this are noise (deleted in reprocess cleanup)
const MIN_TRIP_DISTANCE_KM     = 0.05;  // trips shorter than 50 m are noise

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

// ── GPS jump detection ────────────────────────────────────────────────────────
/**
 * Returns true if the new GPS point implies impossible movement from the
 * previous point (teleport / GPS jitter while stationary).
 */
function isGpsJump(prevLat, prevLng, prevTimeMs, newLat, newLng, newTimeMs) {
  if (!prevLat || !prevLng || !newLat || !newLng || !prevTimeMs) return false;
  const segKm = haversine(prevLat, prevLng, newLat, newLng);
  const segMs = newTimeMs - prevTimeMs;
  if (segMs <= 0 || segMs > 3_600_000) return false; // skip check for >1 h gaps
  const impliedKph = segKm / (segMs / 3_600_000);
  return impliedKph > MAX_JUMP_KPH;
}

// ── Main processor ────────────────────────────────────────────────────────────
/**
 * @param {object}  doc        Raw MongoDB document
 * @param {string}  deviceType e.g. 'GT06', 'AIS140'
 * @param {object} [_state]    Optional in-memory Sequelize state instance.
 *                             When provided, skips the MySQL read (used by
 *                             reprocessVehicle to avoid state corruption from
 *                             concurrent live-packet processing).
 * @returns {object|undefined} The state instance (when _state was provided)
 */
async function processPacket(doc, deviceType, _state) {
  try {
    if (!doc?.imei) return _state;

    const pkt  = normalizePacket(doc, deviceType);
    const caps = getCapabilities(deviceType);

    const vehicle = await getVehicle(pkt.imei);
    if (!vehicle) return _state;

    const vehicleId          = vehicle.id;
    const fuelFillThreshold  = vehicle.fuelFillThreshold || 5;
    const now                = pkt.timestamp.getTime();

    // ── Get or create live device state ───────────────────────────────────────
    // During reprocess, _state is passed in-memory to avoid MySQL read per packet.
    let state = _state || await VehicleDeviceState.findOne({ where: { vehicleId } });
    if (!state) state = await VehicleDeviceState.create({ vehicleId, imei: pkt.imei });

    // ══════════════════════════════════════════════════════════════════════════
    // NON-GPS PACKETS — update telemetry only, skip trip/engine decisions.
    //
    // GT06 STATUS (0x13) uses terminal-info-byte bit 3 for ACC — a DIFFERENT
    // register from LOCATION's course-status-word bit 10.  These two bits
    // frequently disagree while the engine is running, producing false
    // ignition-OFF events that fragment a single drive into 50+ micro-trips.
    //
    // GPS-unfixed LOCATION packets also land here (lat/lng/speed are deleted
    // by the GT06 TCP server when gpsFixed=false).
    //
    // HEARTBEAT packets carry no ACC at all (ignition would resolve to null).
    //
    // → Safe rule: never let a packet without real GPS coordinates influence
    //   the trip or engine-session state machine.
    // ══════════════════════════════════════════════════════════════════════════
    if (pkt.isStatusOnly) {
      // Still update non-GPS telemetry fields
      state.lastPacketTime = pkt.timestamp;
      if (pkt.fuel       != null) state.lastFuelLevel       = pkt.fuel;
      if (pkt.battery    != null) state.lastBattery          = pkt.battery;
      if (pkt.gsmSignal  != null) state.lastGsmSignal        = pkt.gsmSignal;
      if (pkt.externalVoltage != null) state.lastExternalVoltage = pkt.externalVoltage;
      await state.save();
      return _state ? state : undefined;
    }

    // ── From here on, packet has valid GPS coordinates ────────────────────────

    // ── GPS gap timeout ──────────────────────────────────────────────────────
    // When the car parks, the GT06 stops sending GPS-fixed LOCATION packets
    // and only sends STATUS/HEARTBEAT (which are skipped above).  Without
    // this check the trip would stay open indefinitely.
    //
    // If the gap between the last GPS packet and this one exceeds 5 minutes,
    // auto-close any active trip/session at the last-known GPS time.
    if (state.currentTripId && state.lastGpsPacketTime) {
      const gapMs = now - new Date(state.lastGpsPacketTime).getTime();
      if (gapMs > TRIP_GPS_GAP_MS) {
        const trip = await Trip.findByPk(state.currentTripId);
        if (trip && trip.status === 'in_progress') {
          const gapEndTime = new Date(state.lastGpsPacketTime);
          const dur = Math.max(0, Math.floor(
            (gapEndTime.getTime() - new Date(trip.startTime).getTime()) / 1000
          ));
          await trip.update({
            status: 'completed', endTime: gapEndTime, duration: dur,
            endLatitude: state.lastLat || trip.endLatitude,
            endLongitude: state.lastLng || trip.endLongitude,
          });
          console.log(`[PP] Trip #${trip.id} AUTO-CLOSED (GPS gap ${(gapMs/60000).toFixed(1)} min) vid=${vehicleId}`);
        }
        state.currentTripId = null;
        state.engineOffSince = null;
        // Also close any active engine session
        if (state.currentSessionId) {
          const sess = await VehicleEngineSession.findByPk(state.currentSessionId);
          if (sess && sess.status === 'active') {
            const dur = Math.max(0, Math.floor(
              (new Date(state.lastGpsPacketTime).getTime() - new Date(sess.startTime).getTime()) / 1000
            ));
            await sess.update({ endTime: new Date(state.lastGpsPacketTime), durationSeconds: dur, status: 'completed' });
          }
          state.currentSessionId = null;
        }
        state.engineOn = false; // reset so downstream logic sees a clean state
      }
    }

    // Derive ignition AFTER gap check so prevIgnition reflects any gap closure
    const prevIgnition = state.engineOn || false;
    const ignitionOn   = resolveIgnition(pkt, caps, prevIgnition);
    const speed        = pkt.speed || 0;

    // GPS jump filter — reject impossible position jumps
    const jumped = isGpsJump(
      parseFloat(state.lastLat), parseFloat(state.lastLng),
      state.lastGpsPacketTime ? new Date(state.lastGpsPacketTime).getTime() : null,
      pkt.lat, pkt.lng, now
    );

    console.log(
      `[PP] vid=${vehicleId} ign=${ignitionOn} spd=${speed} ` +
      `trip=${state.currentTripId || '-'} jump=${jumped} ts=${pkt.timestamp.toISOString()}`
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
      const segKm   = jumped ? 0 : haversine(state.lastLat, state.lastLng, pkt.lat, pkt.lng);
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

    // ══════════════════════════════════════════════════════════════════════════
    // TRIP TRACKING — with ignition-OFF debounce
    //
    // Instead of closing the trip on the FIRST ignition-OFF GPS packet (which
    // can be a transient ACC glitch), we record when ignition first went OFF
    // in state.engineOffSince and only close when the condition persists for
    // IGNITION_OFF_CONFIRM_MS.  If ignition comes back ON within the window
    // the pending close is cancelled and the trip continues seamlessly.
    // ══════════════════════════════════════════════════════════════════════════

    if (ignitionOn && speed > TRIP_START_SPEED && !state.currentTripId) {
      // ── START new trip ──────────────────────────────────────────────────────
      state.engineOffSince = null; // clear any pending off
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
      // ── Ignition OFF while trip active — debounce before closing ────────────
      // Record the FIRST off-transition time; don't overwrite on subsequent OFF packets
      if (prevIgnition || !state.engineOffSince) {
        state.engineOffSince = pkt.timestamp;
      }

      const offMs = now - new Date(state.engineOffSince).getTime();

      if (offMs >= IGNITION_OFF_CONFIRM_MS) {
        // Confirmed OFF for long enough — close the trip
        const trip = await Trip.findByPk(state.currentTripId);
        if (trip && trip.status === 'in_progress') {
          // Use the moment ignition first went OFF as the real trip end
          const realEndTime = new Date(state.engineOffSince);
          const durationSec = Math.max(0, Math.floor(
            (realEndTime.getTime() - new Date(trip.startTime).getTime()) / 1000
          ));
          await trip.update({
            status:       'completed',
            endTime:      realEndTime,
            duration:     durationSec,
            endLatitude:  pkt.lat  || trip.endLatitude,
            endLongitude: pkt.lng  || trip.endLongitude,
            odometerEnd:  pkt.odometer != null ? pkt.odometer : trip.odometerEnd,
          });
          console.log(`[PP] Trip #${trip.id} COMPLETED for vehicle ${vehicleId} (${durationSec}s, ${trip.distance} km)`);
        }
        state.currentTripId = null;
      }
      // else: still within debounce window — don't close yet

    } else if (ignitionOn && state.currentTripId) {
      // ── Trip active, ignition still ON — accumulate stats ───────────────────
      const isDriving = speed >= DRIVE_SPEED_THRESH;

      // Speed-based idle close: if vehicle has been below driving threshold for
      // TRIP_IDLE_CLOSE_MS, close the trip even though ignition is still ON.
      // This handles AIS140 and similar devices where ignition is always reported
      // as ON.  Re-uses engineOffSince to track idle start (since ignition-OFF
      // never fires for these devices, the field is available).
      if (!isDriving) {
        if (!state.engineOffSince) state.engineOffSince = pkt.timestamp;
        const idleMs = now - new Date(state.engineOffSince).getTime();
        if (idleMs >= TRIP_IDLE_CLOSE_MS) {
          // Vehicle idle for too long — close the trip at the moment speed first dropped
          const trip = await Trip.findByPk(state.currentTripId);
          if (trip && trip.status === 'in_progress') {
            const realEndTime = new Date(state.engineOffSince);
            const durationSec = Math.max(0, Math.floor(
              (realEndTime.getTime() - new Date(trip.startTime).getTime()) / 1000
            ));
            await trip.update({
              status: 'completed', endTime: realEndTime, duration: durationSec,
              endLatitude: pkt.lat || trip.endLatitude,
              endLongitude: pkt.lng || trip.endLongitude,
              odometerEnd: pkt.odometer != null ? pkt.odometer : trip.odometerEnd,
            });
            console.log(`[PP] Trip #${trip.id} IDLE-CLOSED for vehicle ${vehicleId} (${durationSec}s, ${trip.distance} km)`);
          }
          state.currentTripId = null;
          state.engineOffSince = null;
          // Don't start a new trip on this packet (speed is low)
        }
        // else: still within idle window — keep trip open, continue below
      } else {
        // Vehicle is driving — clear any idle timer
        state.engineOffSince = null;
      }

      // Update trip stats if trip is still active
      if (state.currentTripId) {
        const trip = await Trip.findByPk(state.currentTripId);
        if (trip && trip.status === 'in_progress') {
          const segKm      = jumped ? 0 : haversine(state.lastLat, state.lastLng, pkt.lat, pkt.lng);
          const newDist    = parseFloat(trip.distance || 0) + segKm;
          const newMax     = Math.max(parseFloat(trip.maxSpeed || 0), speed);
          const durationSec = Math.max(0, Math.floor((now - new Date(trip.startTime).getTime()) / 1000));
          const segSecs    = state.lastGpsPacketTime && pkt.lat
            ? Math.max(0, Math.floor((now - new Date(state.lastGpsPacketTime).getTime()) / 1000)) : 0;

          // Build route (sample every ROUTE_SAMPLE_SECS)
          let route   = trip.routeData || [];
          const lastPt = route[route.length - 1];
          if (pkt.lat && !jumped && (!lastPt || (now - new Date(lastPt.ts).getTime()) / 1000 >= ROUTE_SAMPLE_SECS)) {
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

    } else if (ignitionOn && !state.currentTripId) {
      // Ignition ON but speed ≤ threshold — no trip yet, just clear pending off
      state.engineOffSince = null;
    }

    // ── Persist live device state ──────────────────────────────────────────────
    state.engineOn          = ignitionOn;
    // engineOffSince is managed in the trip logic above — don't overwrite here
    state.lastLat           = jumped ? state.lastLat : (pkt.lat  || state.lastLat);
    state.lastLng           = jumped ? state.lastLng : (pkt.lng  || state.lastLng);
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
    state.lastGpsPacketTime = pkt.hasGps ? pkt.timestamp : state.lastGpsPacketTime;
    state.currentTripId     = state.currentTripId    || null;
    state.currentSessionId  = state.currentSessionId || null;
    state.pendingTripEnd    = false;
    await state.save();
    return _state ? state : undefined;

  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError' && doc?.imei) {
      invalidateVehicleCache(doc.imei);
      console.warn(`[PP] FK violation for IMEI ${doc.imei} — cache cleared`);
    } else {
      console.error('[PP] Error processing packet:', err.message);
    }
    return _state ? _state : undefined;
  }
}

// ── Startup reconciliation ────────────────────────────────────────────────────
/**
 * Close any in_progress trips that the state machine is no longer tracking.
 *
 * Rules:
 *   A) state moved on (currentTripId ≠ trip.id)
 *   B) state says engine is OFF
 *   C) no state row at all
 *   D) trip.endTime is older than 15 min (server was down when ignition-OFF arrived)
 */
const STALE_THRESHOLD_MS = 15 * 60 * 1000;

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

      const endTimeMs    = trip.endTime ? new Date(trip.endTime).getTime() : null;
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
        !state ||
        state.currentTripId !== trip.id ||
        (state.currentTripId === trip.id && !state.engineOn) ||
        isStale;

      if (!shouldClose) {
        console.log(`[Reconcile] trip #${trip.id} — skipping (no rule matched)`);
        continue;
      }

      const endTime = trip.endTime || state?.lastPacketTime || new Date();
      const durationSec = Math.max(
        0,
        Math.floor((new Date(endTime).getTime() - new Date(trip.startTime).getTime()) / 1000)
      );

      await trip.update({ status: 'completed', endTime, duration: durationSec });

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
const CATCHUP_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const CATCHUP_BATCH_LIMIT = 5000;

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
      const state = await VehicleDeviceState.findOne({ where: { vehicleId: vehicle.id } });
      const lastSeen = state?.lastPacketTime ? new Date(state.lastPacketTime) : null;
      const fromDate = lastSeen && lastSeen > cutoff ? lastSeen : cutoff;

      const caps = getCapabilities(vehicle.deviceType);

      const imeiVariants = [vehicle.imei];
      if (vehicle.imei.startsWith('0')) imeiVariants.push(vehicle.imei.slice(1));
      else imeiVariants.push('0' + vehicle.imei);

      const packets = await mongoDb
        .collection(caps.mongoCollection)
        .find({ imei: { $in: imeiVariants }, timestamp: { $gt: fromDate } })
        .sort({ timestamp: 1, _id: 1 })
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
 * 1. Deletes all existing trips, engine sessions, and fuel events.
 * 2. Resets VehicleDeviceState clean.
 * 3. Replays every MongoDB packet through processPacket in deterministic order.
 * 4. Cleans up micro-trips (noise) and closes any dangling in_progress trip.
 */
async function reprocessVehicle(vehicleId, { from = null, to = null } = {}) {
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

  const hasRange = from || to;

  // ── 1. Wipe existing computed data (scoped to date range if provided) ───────
  const tripWhere = { vehicleId };
  const sessionWhere = { vehicleId };
  const fuelWhere = { vehicleId };
  if (hasRange) {
    const rangeFilter = {};
    if (from) rangeFilter[Op.gte] = from;
    if (to)   rangeFilter[Op.lte] = to;
    tripWhere.startTime = rangeFilter;
    sessionWhere.startTime = rangeFilter;
    fuelWhere.eventTime = rangeFilter;
  }
  await Trip.destroy({ where: tripWhere });
  await VehicleEngineSession.destroy({ where: sessionWhere });
  await VehicleFuelEvent.destroy({ where: fuelWhere });

  const state = await VehicleDeviceState.findOne({ where: { vehicleId } });
  if (state) {
    await state.update({
      currentTripId: null,
      currentSessionId: null,
      engineOn: false,
      engineOnSince: null,
      engineOffSince: null,
      pendingTripEnd: false,
      lastFuelLevel: null,
      lastLat: null,
      lastLng: null,
      lastGpsPacketTime: null,
      lastSpeed: null,
    });
  }

  // Invalidate vehicle cache so processPacket re-reads from DB
  invalidateVehicleCache(vehicle.imei);

  // ── 2. Fetch packets from MongoDB (deterministic order) ─────────────────────
  const mongoFilter = { imei: { $in: imeiVariants } };
  if (hasRange) {
    mongoFilter.timestamp = {};
    if (from) mongoFilter.timestamp.$gte = from;
    if (to)   mongoFilter.timestamp.$lte = to;
  }
  const packets = await mongoDb
    .collection(caps.mongoCollection)
    .find(mongoFilter)
    .sort({ timestamp: 1, _id: 1 })
    .toArray();

  const rangeLabel = hasRange
    ? ` [${from ? from.toISOString().slice(0,10) : '…'} → ${to ? to.toISOString().slice(0,10) : '…'}]`
    : ' [ALL]';
  console.log(`[Reprocess] Vehicle ${vehicleId} (${vehicle.imei}): ${packets.length} packets in ${caps.mongoCollection}${rangeLabel}`);

  // ── 3. Replay through processPacket (in-memory state) ───────────────────────
  // Pass the state instance through each processPacket call so it is read/written
  // in memory instead of MySQL.  This avoids two bugs:
  //   a) ~12k MySQL reads per reprocess (slow)
  //   b) Concurrent live-packet processing overwriting state between reads,
  //      causing false GPS-gap detections and trip fragmentation.
  let inMemState = state || await VehicleDeviceState.findOne({ where: { vehicleId } });
  let processed = 0;
  for (const pkt of packets) {
    inMemState = await processPacket(pkt, vehicle.deviceType, inMemState) || inMemState;
    processed++;
    if (processed % 500 === 0) {
      console.log(`[Reprocess] Vehicle ${vehicleId}: ${processed}/${packets.length}…`);
    }
  }

  // ── 4. Post-replay cleanup ──────────────────────────────────────────────────

  // 4a. Close any still-in_progress trip (vehicle might still be running, but
  //     for reprocess we close based on last known data)
  const openTrips = await Trip.findAll({
    where: { vehicleId, status: 'in_progress' },
  });
  for (const trip of openTrips) {
    const endTime = trip.endTime || trip.startTime;
    const durationSec = Math.max(0, Math.floor(
      (new Date(endTime).getTime() - new Date(trip.startTime).getTime()) / 1000
    ));
    await trip.update({ status: 'completed', endTime, duration: durationSec });
  }

  // 4b. Delete noise/micro-trips: duration < MIN_TRIP_DURATION_SEC AND distance < MIN_TRIP_DISTANCE_KM
  const noiseDeleted = await Trip.destroy({
    where: {
      vehicleId,
      duration: { [Op.lt]: MIN_TRIP_DURATION_SEC },
      distance: { [Op.lt]: MIN_TRIP_DISTANCE_KM },
    },
  });
  if (noiseDeleted > 0) {
    console.log(`[Reprocess] Deleted ${noiseDeleted} noise micro-trip(s)`);
  }

  // 4c. Clear trip pointer in state (all trips are now completed)
  const finalState = await VehicleDeviceState.findOne({ where: { vehicleId } });
  if (finalState) {
    await finalState.update({ currentTripId: null });
  }

  const tripCount = await Trip.count({ where: { vehicleId } });
  console.log(`[Reprocess] Vehicle ${vehicleId} done — ${processed} packets → ${tripCount} trips`);

  return { processed, tripsCreated: tripCount };
}

module.exports = { processPacket, invalidateVehicleCache, reconcileStaleTrips, catchUpMissedPackets, reprocessVehicle };
