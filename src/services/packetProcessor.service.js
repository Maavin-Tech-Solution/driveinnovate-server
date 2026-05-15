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
  Notification,
  Geofence,
  GeofenceAssignment,
  VehicleGroupMember,
} = require('../models');
const { Op } = require('sequelize');
const { normalizePacket }  = require('./packetNormalizer.service');
const { getCapabilities }  = require('../config/deviceCapabilities');
const { getMongoDb }       = require('../config/mongodb');
const { sendAlertEmail, buildAlertEmailHtml } = require('./email.service');

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

// ── Geofence position state ───────────────────────────────────────────────────
// Tracks whether each vehicle was inside each of its geofences on the PREVIOUS
// GPS packet.  Key: `${vehicleId}_${geofenceId}`, Value: boolean.
// In-memory only — after server restart the first packet recalibrates state
// without generating false alerts (we only fire on transitions, not first read).
const _geoState = new Map();

/**
 * Haversine distance in metres (duplicated from geofence.service to avoid
 * circular imports — keeps packetProcessor self-contained).
 */
const _haversineM = (lat1, lng1, lat2, lng2) => {
  const R = 6_371_000;
  const toR = d => d * Math.PI / 180;
  const dLat = toR(lat2 - lat1);
  const dLng = toR(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const _pointInPolygon = (lat, lng, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng, yi = polygon[i].lat;
    const xj = polygon[j].lng, yj = polygon[j].lat;
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
};

const _isInsideGeo = (geo, lat, lng) => {
  if (geo.type === 'CIRCULAR') {
    return _haversineM(parseFloat(geo.centerLat), parseFloat(geo.centerLng), lat, lng) <= parseFloat(geo.radiusMeters);
  }
  if (geo.type === 'POLYGON' && geo.coordinates?.length >= 3) {
    return _pointInPolygon(lat, lng, geo.coordinates);
  }
  return false;
};

/**
 * Check whether the vehicle's new position crosses any of its assigned
 * geofences and fire GEOFENCE_ENTRY / GEOFENCE_EXIT notifications.
 * Called once per GPS-bearing packet after position is updated.
 */
async function checkGeofences(vehicle, lat, lng, pkt) {
  // ── Bug-guard: clientId missing means vehicle was cached before the field
  // was added to the query.  Look it up fresh instead of silently bailing.
  let clientId = vehicle.clientId;
  if (!clientId) {
    const fresh = await Vehicle.findByPk(vehicle.id, { attributes: ['clientId'] });
    clientId = fresh?.clientId;
    if (clientId) vehicle.clientId = clientId; // patch in-memory cache entry
  }
  if (!clientId || !lat || !lng) {
    console.warn(`[Geofence] skip vehicle ${vehicle.id} — no clientId or coords`);
    return;
  }

  // ── Direct vehicle assignments + group memberships ──
  const memberships  = await VehicleGroupMember.findAll({
    where: { vehicleId: vehicle.id }, attributes: ['groupId'],
  });
  const groupIds = memberships.map(m => m.groupId);

  const orClause = [{ scope: 'VEHICLE', vehicleId: vehicle.id }];
  if (groupIds.length) orClause.push({ scope: 'GROUP', groupId: groupIds });

  const assignments = await GeofenceAssignment.findAll({
    where: { [Op.or]: orClause },
    attributes: ['geofenceId', 'alertOnEntry', 'alertOnExit'],
    raw: true,
  });

  if (!assignments.length) {
    console.log(`[Geofence] vehicle ${vehicle.id} — no geofence assignments`);
    return;
  }

  const geofenceIds = [...new Set(assignments.map(a => a.geofenceId))];

  // ── Fetch geofences WITHOUT raw:true so JSON columns (coordinates) are
  //    properly deserialized.  raw:true returns coordinates as a plain string.
  const geofences = await Geofence.findAll({
    where: { id: geofenceIds, isActive: true },
  });

  if (!geofences.length) {
    console.log(`[Geofence] vehicle ${vehicle.id} — no active geofences found for ids`, geofenceIds);
    return;
  }

  console.log(`[Geofence] vehicle ${vehicle.id} lat=${lat} lng=${lng} — checking ${geofences.length} geofence(s)`);

  // Build a lookup: geofenceId → alert flags
  const assignMap = {};
  assignments.forEach(a => {
    if (!assignMap[a.geofenceId]) assignMap[a.geofenceId] = { alertOnEntry: false, alertOnExit: false };
    if (a.alertOnEntry) assignMap[a.geofenceId].alertOnEntry = true;
    if (a.alertOnExit)  assignMap[a.geofenceId].alertOnExit  = true;
  });

  for (const geo of geofences) {
    const geoData   = geo.toJSON ? geo.toJSON() : geo;
    // Parse coordinates if stored as a string (defensive)
    if (typeof geoData.coordinates === 'string') {
      try { geoData.coordinates = JSON.parse(geoData.coordinates); } catch { geoData.coordinates = []; }
    }

    const stateKey  = `${vehicle.id}_${geoData.id}`;
    const wasInside = _geoState.get(stateKey); // undefined = first packet
    const nowInside = _isInsideGeo(geoData, lat, lng);

    console.log(`[Geofence] "${geoData.name}" wasInside=${wasInside} nowInside=${nowInside}`);

    _geoState.set(stateKey, nowInside);

    // First packet after restart: initialise state, no alert (avoids false trigger)
    if (wasInside === undefined) continue;

    const assign    = assignMap[geoData.id] || {};
    let   eventType = null;
    if (!wasInside && nowInside  && assign.alertOnEntry) eventType = 'ENTRY';
    if ( wasInside && !nowInside && assign.alertOnExit)  eventType = 'EXIT';
    if (!eventType) continue;

    // vehicleNumber isn't in the packet-processor cache — fetch it once.
    if (!vehicle._vehicleNumber) {
      const vFull = await Vehicle.findByPk(vehicle.id, { attributes: ['vehicleNumber', 'vehicleName'] });
      vehicle._vehicleNumber = vFull?.vehicleNumber || vFull?.vehicleName || `Vehicle #${vehicle.id}`;
    }
    const vehicleName = vehicle._vehicleNumber;
    const title   = `Geofence ${eventType === 'ENTRY' ? 'Entry' : 'Exit'} — ${geoData.name}`;
    const message = `${vehicleName} ${eventType === 'ENTRY' ? 'entered' : 'exited'} geofence "${geoData.name}" at ${new Date(pkt.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.`;

    try {
      const notif = await Notification.create({
        clientId:    clientId,
        alertId:     null,
        vehicleId:   vehicle.id,
        title,
        message,
        alertType:   `GEOFENCE_${eventType}`,
        isRead:      false,
        emailSent:   false,
        metadata:    { geofenceId: geoData.id, geofenceName: geoData.name, lat, lng, eventType },
        triggeredAt: new Date(),
      });

      const htmlBody = buildAlertEmailHtml({
        alertName:     title,
        alertType:     `GEOFENCE_${eventType}`,
        vehicleNumber: vehicleName,
        vehicleName:   vehicleName,
        message,
        triggeredAt:   notif.triggeredAt,
        metadata:      { lat, lng, geofenceName: geoData.name },
      });
      sendAlertEmail({ subject: `[DriveInnovate] ${title}`, htmlBody })
        .then(sent => { if (sent) notif.update({ emailSent: true }).catch(() => {}); })
        .catch(() => {});

      console.log(`[Geofence] ✓ NOTIFICATION created: ${eventType} vehicle=${vehicle.id} geo="${geoData.name}"`);
    } catch (err) {
      console.error('[Geofence] Failed to create notification:', err.message);
    }
  }
}

// ── Vehicle lookup cache (imei → Vehicle row) ─────────────────────────────────
const vehicleCache = new Map();

async function getVehicle(imei) {
  if (vehicleCache.has(imei)) return vehicleCache.get(imei);
  const candidates = [imei];
  if (imei.startsWith('0')) candidates.push(imei.slice(1));
  else candidates.push('0' + imei);
  const v = await Vehicle.findOne({
    where: { imei: candidates },
    attributes: ['id', 'imei', 'clientId', 'deviceType', 'fuelFillThreshold'],
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

  // acc-hysteresis (GT06 and generics):
  // ─ When the ACC bit is present and explicitly false, TRUST it — never let
  //   GPS speed noise override a hard ignition-OFF signal.  A GT06 parked in
  //   poor satellite conditions can emit a single packet with speed=6 km/h
  //   while the ACC bit correctly reads 0 (engine off).  The old code returned
  //   true for that packet, locking engineOn=true in the DB until the next
  //   clean acc=false+speed=0 packet arrived.
  // ─ Only use speed as a positive signal when acc is absent/null (devices
  //   that don't expose an ACC pin or wired without one).
  const speed = pkt.speed || 0;
  const acc   = pkt.ignition;

  if (acc === true)                 return true;   // ACC on → definitely running
  if (acc === false)                return false;  // ACC off → trust it regardless of speed
  // acc is null (no ignition signal from device)
  if (speed >= 5)                   return true;   // clearly moving → infer engine on
  if (speed === 0 && prevIgnition)  return false;  // stopped after moving → engine off
  return prevIgnition;                             // hold last known state
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

// ── Global concurrency limiter ────────────────────────────────────────────────
// Caps simultaneous processPacket DB sessions so API routes always have
// connections available.  5 slots × ~6 DB ops each = up to 30 in-flight
// queries from packet processing, leaving the other 15 pool connections
// free for API routes (login, vehicle list, reports, etc.) at all times.
const MAX_CONCURRENT = 5;
let _activePP = 0;
const _ppWaitQueue = [];

function _acquireSlot() {
  return new Promise(resolve => {
    if (_activePP < MAX_CONCURRENT) { _activePP++; resolve(); }
    else _ppWaitQueue.push(resolve);
  });
}
function _releaseSlot() {
  if (_ppWaitQueue.length > 0) { _ppWaitQueue.shift()(); }
  else _activePP--;
}

// ── Retry wrapper for transient DB timeouts ───────────────────────────────────
const RETRY_DELAYS = [300, 1000, 3000];

function isTransientError(err) {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('timeout') || msg.includes('deadlock') ||
         msg.includes('lock wait') || msg.includes('econnreset') ||
         msg.includes('connection lost');
}

// Suppress noisy per-packet timeout log — only print a summary every 60 s
let _transientErrCount = 0;
let _transientErrTimer = null;
function _noteTransient(label, msg) {
  _transientErrCount++;
  if (!_transientErrTimer) {
    _transientErrTimer = setTimeout(() => {
      if (_transientErrCount > 0)
        console.warn(`[PP] ${_transientErrCount} transient DB error(s) in last 60 s (last: ${label}: ${msg})`);
      _transientErrCount = 0;
      _transientErrTimer = null;
    }, 60_000);
    _transientErrTimer.unref?.();
  }
}

async function withRetry(fn, label) {
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt < RETRY_DELAYS.length && isTransientError(err)) {
        _noteTransient(label, err.message);
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
      } else {
        throw err;
      }
    }
  }
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
async function processPacketInner(doc, deviceType, _state) {
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
      // Update non-GPS telemetry fields.
      state.lastPacketTime = pkt.timestamp;
      state.lastSeenAt     = new Date();

      // GT06 STATUS packets (0x13) carry the ACC bit in the terminal-info byte
      // (bit 3).  We use this to detect engine-off when no GPS-fixed LOCATION
      // packets are arriving.  However, the terminal-info ACC bit and the
      // course-status ACC bit (bit 10, used in LOCATION packets) can disagree on
      // some GT06 firmware/wiring combinations — a vehicle actively moving with
      // GPS-confirmed runningStreak > 0 must not have its engineOn overridden to
      // false by a STATUS packet whose acc bit reads 0 due to hardware quirks.
      //
      // Rule: STATUS acc=false is only trusted when the vehicle is NOT moving.
      //       STATUS acc=true is always trusted (safe — can't falsely show engine on
      //       when GPS motion already confirms it).
      if (pkt.ignition !== null && pkt.ignition !== undefined) {
        const prevIgnition = state.engineOn;
        const ignFromStatus = resolveIgnition(
          { ...pkt, speed: 0 },
          caps,
          prevIgnition
        );
        const vehicleIsMoving = (state.runningStreak || 0) > 0;
        if (ignFromStatus === true || !vehicleIsMoving) {
          // Apply update: engine turning ON → always trust.
          // Engine turning OFF → only trust when GPS motion confirms vehicle stopped.
          state.engineOn = ignFromStatus;
        }
      }

      if (pkt.fuel       != null) state.lastFuelLevel       = pkt.fuel;
      if (pkt.battery    != null) state.lastBattery          = pkt.battery;
      if (pkt.gsmSignal  != null) state.lastGsmSignal        = pkt.gsmSignal;
      if (pkt.externalVoltage != null) state.lastExternalVoltage = pkt.externalVoltage;
      if (pkt.movement   != null) state.lastMovement         = pkt.movement;
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

    // Out-of-order guard — this GPS packet's timestamp is older than the last
    // GPS packet we already processed.  isGpsJump() returns false for these
    // (segMs <= 0 bypass) so they slip through the jump filter and the haversine
    // distance from the current live position to the stale position gets added to
    // the trip, inflating it by hundreds of km.  Also state.lastLat/Lng must NOT
    // be overwritten with the old position or the NEXT in-order packet will
    // compute a spuriously large segment from the wrong origin.
    const isOutOfOrder = pkt.hasGps
      && !!state.lastGpsPacketTime
      && now < new Date(state.lastGpsPacketTime).getTime();

    console.log(
      `[PP] vid=${vehicleId} ign=${ignitionOn} spd=${speed} ` +
      `trip=${state.currentTripId || '-'} jump=${jumped} oor=${isOutOfOrder} ts=${pkt.timestamp.toISOString()}`
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
      const segKm   = (jumped || isOutOfOrder) ? 0 : haversine(state.lastLat, state.lastLng, pkt.lat, pkt.lng);
      const isDriving = speed >= DRIVE_SPEED_THRESH;
      const segSecs   = (!isOutOfOrder && state.lastGpsPacketTime && pkt.lat)
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
          // Never accumulate distance or time from out-of-order packets —
          // they bypass isGpsJump (segMs ≤ 0) and would add the full haversine
          // distance from the current live position back to the stale position,
          // inflating trip distance by hundreds of km.
          const segKm   = (jumped || isOutOfOrder) ? 0 : haversine(state.lastLat, state.lastLng, pkt.lat, pkt.lng);
          const newDist = parseFloat(trip.distance || 0) + segKm;
          const newMax  = isOutOfOrder ? parseFloat(trip.maxSpeed || 0) : Math.max(parseFloat(trip.maxSpeed || 0), speed);

          const packetIsForward = !isOutOfOrder && now >= new Date(trip.endTime).getTime();
          const durationSec = packetIsForward
            ? Math.max(0, Math.floor((now - new Date(trip.startTime).getTime()) / 1000))
            : (trip.duration || 0);
          const segSecs = packetIsForward && state.lastGpsPacketTime && pkt.lat
            ? Math.max(0, Math.floor((now - new Date(state.lastGpsPacketTime).getTime()) / 1000))
            : 0;

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
            // Only advance endTime/duration — never move them backwards
            ...(packetIsForward && { endTime: pkt.timestamp, duration: durationSec }),
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
    // Always update engineOn — the realTime guard was removed because many GT06
    // firmware versions permanently send realTime=false even for live packets,
    // freezing engineOn at its initial value forever.  resolveIgnition() already
    // correctly handles the acc=true/false signal, so no guard is needed here.
    state.engineOn = ignitionOn;
    // engineOffSince is managed in the trip logic above — don't overwrite here

    // Capture previous GPS position AND packet time BEFORE advancing state.
    // Both are needed for the displacement + implied-speed runningStreak check.
    // state.lastGpsPacketTime is overwritten below to the CURRENT packet; if we
    // read it after that update segMs = 0 → impliedKph = 0 → streak never builds.
    const prevLat            = parseFloat(state.lastLat) || null;
    const prevLng            = parseFloat(state.lastLng) || null;
    const prevGpsPacketTime  = state.lastGpsPacketTime   || null;

    // Positional state must only advance forward in time.  An out-of-order packet
    // must not overwrite lastLat/Lng/lastGpsPacketTime — doing so would corrupt
    // the origin point used by the next in-order packet's haversine calculation.
    if (!isOutOfOrder) {
      state.lastLat           = jumped ? state.lastLat : (pkt.lat  || state.lastLat);
      state.lastLng           = jumped ? state.lastLng : (pkt.lng  || state.lastLng);
      state.lastGpsPacketTime = pkt.hasGps ? pkt.timestamp : state.lastGpsPacketTime;
    }

    state.lastAltitude      = pkt.altitude      != null ? pkt.altitude      : state.lastAltitude;
    state.lastSatellites    = pkt.satellites    != null ? pkt.satellites    : state.lastSatellites;
    state.lastCourse        = pkt.course        != null ? pkt.course        : state.lastCourse;
    state.lastSpeed         = pkt.speed;

    // ── State-machine duration trackers ───────────────────────────────────────
    if (!isOutOfOrder) {
      // speedZeroSince: anchored on the first speed=0 packet; cleared the
      // moment the vehicle moves again.  Drives the Idle rule.
      if ((pkt.speed || 0) === 0) {
        if (!state.speedZeroSince) state.speedZeroSince = pkt.timestamp;
      } else {
        state.speedZeroSince = null;
      }

      // runningStreak: consecutive packets that confirm genuine movement.
      //
      // Guards:
      // 1. ignitionOn       — engine must be on
      // 2. speed > 5        — device GPS speed above threshold
      // 3. impliedKph > 5   — haversine / inter-packet time must exceed 5 km/h.
      //    This is the key filter: a parked vehicle can show GPS drift of 50 m
      //    but over a long inter-packet gap that implies only ~0.6 km/h — not
      //    movement.  At 30 km/h with 30-second packets, displacement is ~250 m
      //    → impliedKph = 30. Packets > 1 hour apart are skipped (offline gap).
      //
      // runningStreak is GPS-only movement confirmation — ignitionOn is NOT
      // required here.  AIS140 devices frequently have ignition=0 in packets
      // even when the vehicle is physically driving (unwired ignition line or
      // AIS140-specific reporting), so gating on ignitionOn causes streak to
      // permanently stay 0 for those vehicles.  The state DEFINITION already
      // handles ignition requirements (e.g. Running = ignition=true AND streak>=3).
      // The streak's job is only to confirm that the GPS is showing real, sustained
      // movement — the three guards below do that reliably without ignition:
      //   1. speed > 5      — device GPS speed reading
      //   2. displacement   — position must actually change between packets
      //   3. impliedKph > 5 — rate of change normalised by packet interval so
      //                        parked-vehicle GPS drift (50 m over 5 min = 0.6 km/h)
      //                        does not count, even when reported speed reads > 5
      const displacement = (!jumped && prevLat && prevLng && pkt.lat && pkt.lng)
        ? haversine(prevLat, prevLng, pkt.lat, pkt.lng)
        : null;
      const segMs = prevGpsPacketTime
        ? (now - new Date(prevGpsPacketTime).getTime())
        : 0;
      const impliedKph = (displacement !== null && segMs > 0 && segMs < 3_600_000)
        ? (displacement * 3_600_000 / segMs)
        : 0;
      const genuinelyMoving = (pkt.speed || 0) > 5
        && displacement !== null
        && impliedKph > 5;

      if (genuinelyMoving) {
        state.runningStreak = Math.min(255, (state.runningStreak || 0) + 1);
      } else {
        state.runningStreak = 0;
      }
    }
    state.lastFuelLevel     = pkt.fuel          != null ? pkt.fuel          : state.lastFuelLevel;
    state.lastOdometerReading = pkt.odometer    != null ? pkt.odometer      : state.lastOdometerReading;
    state.lastBattery       = pkt.battery       != null ? pkt.battery       : state.lastBattery;
    state.lastExternalVoltage = pkt.externalVoltage != null ? pkt.externalVoltage : state.lastExternalVoltage;
    state.lastGsmSignal     = pkt.gsmSignal     != null ? pkt.gsmSignal     : state.lastGsmSignal;
    state.lastPacketTime    = pkt.timestamp;
    // Track AIS140 movement sensor value so the state evaluator can use it
    // even when GPS has no fix (isStatusOnly packets skip this path, so
    // lastMovement is only updated from GPS-bearing packets).
    if (pkt.movement !== null && pkt.movement !== undefined) {
      state.lastMovement = pkt.movement;
    }
    // lastSeenAt = real server wall-clock at packet-processing time.
    // This is the authoritative field for "when did we last hear from this
    // device".  Unlike updatedAt it is NOT bumped by reconcileStaleTrips.
    // Unlike lastPacketTime it is NOT subject to device-clock timezone errors.
    state.lastSeenAt        = new Date();
    state.currentTripId     = state.currentTripId    || null;
    state.currentSessionId  = state.currentSessionId || null;
    state.pendingTripEnd    = false;
    await state.save();

    // ── Geofence entry/exit check (non-blocking) ────────────────────────────
    // Only run when this packet has a valid GPS fix so we have a real position.
    if (pkt.hasGps && pkt.lat && pkt.lng) {
      checkGeofences(vehicle, pkt.lat, pkt.lng, pkt).catch(err =>
        console.error('[Geofence] checkGeofences error:', err.message)
      );
    }

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
  const { sequelize: db } = require('../models');
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  try {
    // Set a short session-level lock wait timeout so reconcile fails fast on
    // locked rows instead of hanging for MySQL's default 50 s.  processPacket
    // holds trip row locks for only a few ms; 3 s is more than enough to
    // distinguish "genuinely locked" from "processPacket is mid-update".
    try {
      await db.query('SET SESSION innodb_lock_wait_timeout = 3');
    } catch (_) { /* ignore — not all MySQL setups allow session variable changes */ }

    const staleTrips = await Trip.findAll({
      where: { status: 'in_progress' },
      attributes: ['id', 'vehicleId', 'startTime', 'endTime'],
      lock: false,
    });

    if (!staleTrips.length) {
      console.log('[Reconcile] No in_progress trips found — nothing to do');
      return;
    }

    console.log(`[Reconcile] Found ${staleTrips.length} in_progress trip(s) — checking states…`);
    let closed = 0;
    let skipped = 0;

    for (const trip of staleTrips) {
      // Small inter-trip pause so processPacket can finish any in-flight update
      // on the previous vehicle before we attempt the next one.
      await sleep(50);

      let lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (attempt > 0) await sleep(attempt * 500); // 500 ms, 1000 ms back-off

          const state = await VehicleDeviceState.findOne({
            where: { vehicleId: trip.vehicleId },
            lock: false,
          });

          const endTimeMs    = trip.endTime ? new Date(trip.endTime).getTime() : null;
          const staleSinceMs = endTimeMs ? Date.now() - endTimeMs : null;
          const isStale      = staleSinceMs !== null && staleSinceMs > STALE_THRESHOLD_MS;

          const shouldClose =
            !state ||
            state.currentTripId !== trip.id ||
            (state.currentTripId === trip.id && !state.engineOn) ||
            isStale;

          if (!shouldClose) { lastErr = null; break; }

          const endTime = trip.endTime || state?.lastPacketTime || new Date();
          const durationSec = Math.max(
            0,
            Math.floor((new Date(endTime).getTime() - new Date(trip.startTime).getTime()) / 1000)
          );

          const [affected] = await Trip.update(
            { status: 'completed', endTime, duration: durationSec },
            { where: { id: trip.id, status: 'in_progress' } }
          );

          if (affected) {
            if (state?.currentTripId === trip.id) {
              try {
                await VehicleDeviceState.update(
                  { currentTripId: null },
                  { where: { vehicleId: trip.vehicleId, currentTripId: trip.id } }
                );
              } catch (_) { /* non-fatal */ }
            }
            console.log(`[Reconcile] Closed stale trip #${trip.id} (vehicle ${trip.vehicleId}, ${durationSec}s)`);
            closed++;
          }
          lastErr = null;
          break; // success
        } catch (err) {
          lastErr = err;
          const msg = (err.message || '').toLowerCase();
          if (!msg.includes('lock') && !msg.includes('timeout') && !msg.includes('deadlock')) break;
        }
      }

      if (lastErr) {
        skipped++;
        // Only log first occurrence at WARN level; subsequent ones are DEBUG noise
        if (skipped === 1) console.warn(`[Reconcile] Skipped trip #${trip.id} after retries: ${lastErr.message}`);
      }
    }

    if (skipped > 0) console.log(`[Reconcile] Done — closed ${closed}, skipped ${skipped} (will retry next cycle)`);
    else             console.log(`[Reconcile] Done — closed ${closed} stale trip(s)`);
  } catch (err) {
    console.error('[Reconcile] Error:', err.message);
  } finally {
    // Restore default lock wait timeout for the connection when it returns to pool
    try {
      const { sequelize: db2 } = require('../models');
      await db2.query('SET SESSION innodb_lock_wait_timeout = 50');
    } catch (_) {}
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

  const mongoFilter = { imei: { $in: imeiVariants } };
  if (hasRange) {
    mongoFilter.timestamp = {};
    if (from) mongoFilter.timestamp.$gte = from;
    if (to)   mongoFilter.timestamp.$lte = to;
  }

  const rangeLabel = hasRange
    ? ` [${from ? from.toISOString().slice(0,10) : '…'} → ${to ? to.toISOString().slice(0,10) : '…'}]`
    : ' [ALL]';

  // ── 1. Confirm packets exist BEFORE touching any SQL data ────────────────────
  // If Atlas is temporarily unavailable, countDocuments returns 0 — we must not
  // wipe trips and then rebuild nothing.  Always count first, abort if empty.
  const packetCount = await mongoDb
    .collection(caps.mongoCollection)
    .countDocuments(mongoFilter);

  console.log(`[Reprocess] Vehicle ${vehicleId} (${vehicle.imei}): ${packetCount} packets in ${caps.mongoCollection}${rangeLabel}`);

  if (packetCount === 0) {
    const msg = hasRange
      ? `No packets found in MongoDB for IMEI ${vehicle.imei} in the selected date range. ` +
        `Existing trips preserved. Check MongoDB connectivity or try a wider date range.`
      : `No packets found in MongoDB for IMEI ${vehicle.imei}. ` +
        `Existing trips preserved. The device may not have sent data yet, or MongoDB may be temporarily unavailable.`;
    console.warn(`[Reprocess] Aborting — ${msg}`);
    return { vehicleId, processed: 0, tripsCreated: 0, aborted: true, message: msg };
  }

  // ── 2. Fetch full packet list ────────────────────────────────────────────────
  const packets = await mongoDb
    .collection(caps.mongoCollection)
    .find(mongoFilter)
    .sort({ timestamp: 1, _id: 1 })
    .toArray();

  console.log(`[Reprocess] ${packets.length} packets fetched — proceeding with wipe+rebuild`);

  // ── 3. Wipe existing computed data (packets confirmed above) ─────────────────
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
      speedZeroSince: null,
      runningStreak: 0,
    });
  }

  // Invalidate vehicle cache so processPacket re-reads from DB
  invalidateVehicleCache(vehicle.imei);

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

  return { processed, tripsCreated: tripCount, aborted: false };
}

// Public wrapper — enforces concurrency limit + retries transient timeouts
async function processPacket(doc, deviceType, _state) {
  await _acquireSlot();
  try {
    return await withRetry(
      () => processPacketInner(doc, deviceType, _state),
      `imei=${doc?.imei}`
    );
  } finally {
    _releaseSlot();
  }
}

module.exports = { processPacket, invalidateVehicleCache, reconcileStaleTrips, catchUpMissedPackets, reprocessVehicle };
