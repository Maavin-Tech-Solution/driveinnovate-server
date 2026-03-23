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
  Stop,
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
 * @param {Object} doc - MongoDB document (fmb125locations or gt06locations)
 * @param {string} deviceType - 'FMB125' | 'GT06'
 */
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
    const idleThresholdMs = (vehicle.idleThreshold || 5) * 60 * 1000;
    const fuelFillThreshold = vehicle.fuelFillThreshold || 5;

    // Extract packet fields (normalise FMB125 vs GT06)
    const packetTime = new Date(doc.timestamp || doc.serverTimestamp || Date.now());
    const lat = parseFloat(doc.latitude) || null;
    const lng = parseFloat(doc.longitude) || null;
    const speed = parseFloat(doc.speed) || 0;
    const fuelLevel = doc.fuelLevel !== undefined && doc.fuelLevel !== null ? parseFloat(doc.fuelLevel) : null;
    const odometer = doc.totalOdometer || doc.mileage || null;

    // Ignition detection:
    //   FMB125 → doc.ignition (dedicated signal)
    //   GT06   → doc.acc when ACC wire is connected;
    //            fall back to speed >= 5 km/h when acc is not wired.
    //            5 km/h threshold filters GPS position-drift noise (typically 1-3 km/h
    //            on parked vehicles) while still detecting slow urban movement.
    const MIN_MOVING_SPEED_KMPH = 5;
    const ignitionOn = deviceType === 'GT06'
      ? !!(doc.acc || speed >= MIN_MOVING_SPEED_KMPH)
      : !!(doc.ignition || doc.acc);

    console.log(`[PacketProcessor:${deviceType}] imei=${imei} vehicleId=${vehicleId} ignition=${ignitionOn} acc=${doc.acc} speed=${speed} lat=${lat} lng=${lng} ts=${packetTime.toISOString()}`);

    // ── Get or create device state ──────────────────────────────────────────
    let state = await VehicleDeviceState.findOne({ where: { vehicleId } });
    if (!state) {
      state = await VehicleDeviceState.create({ vehicleId, imei });
    }

    const prevEngineOn = state.engineOn;
    const prevFuelLevel = state.lastFuelLevel;

    // ── Detect fuel events ──────────────────────────────────────────────────
    if (fuelLevel !== null && prevFuelLevel !== null) {
      const diff = fuelLevel - prevFuelLevel;
      if (diff >= fuelFillThreshold) {
        await VehicleFuelEvent.create({
          vehicleId,
          imei,
          eventType: 'fill',
          eventTime: packetTime,
          fuelBefore: prevFuelLevel,
          fuelAfter: fuelLevel,
          fuelChangePct: diff,
          latitude: lat,
          longitude: lng,
        });
      } else if (diff <= -(fuelFillThreshold * 2)) {
        // Significant unexpected drop = drain
        await VehicleFuelEvent.create({
          vehicleId,
          imei,
          eventType: 'drain',
          eventTime: packetTime,
          fuelBefore: prevFuelLevel,
          fuelAfter: fuelLevel,
          fuelChangePct: Math.abs(diff),
          latitude: lat,
          longitude: lng,
        });
      }
    }

    // ── Engine session state machine ────────────────────────────────────────
    const now = packetTime.getTime();

    if (ignitionOn && !prevEngineOn) {
      // ── ENGINE TURNED ON ────────────────────────────────────────────────
      const engineOffMs = state.engineOffSince ? now - new Date(state.engineOffSince).getTime() : Infinity;

      if (state.pendingTripEnd && engineOffMs < idleThresholdMs && state.currentTripId) {
        // Within idle threshold — traffic stop, resume existing trip
        state.pendingTripEnd = false;
        state.engineOffSince = null;
      } else {
        // Beyond threshold or no active trip — close pending trip, create parking stop, start new trip

        // ① Close trip at the time engine TURNED OFF, not now
        if (state.currentTripId) {
          await closeTripIfActive(state.currentTripId, state.engineOffSince || packetTime);
          state.currentTripId = null;
        }

        // ② Handle parking Stop for the off period
        if (state.engineOffSince) {
          // Check if "STILL OFF" branch already created an open Stop
          const openStop = await Stop.findOne({
            where: { vehicleId, endTime: null },
            order: [['start_time', 'DESC']],
          });
          if (openStop) {
            // Close the existing stop
            const stopDurSec = Math.floor((now - new Date(openStop.startTime).getTime()) / 1000);
            await openStop.update({ endTime: packetTime, duration: stopDurSec });
          } else {
            // No intermediate packets fired — create and immediately close the stop
            const stopDurSec = Math.floor((now - new Date(state.engineOffSince).getTime()) / 1000);
            await Stop.create({
              vehicleId,
              imei,
              startTime: state.engineOffSince,
              endTime: packetTime,
              latitude: state.lastLat,
              longitude: state.lastLng,
              stopType: 'PARKING',
              engineStatus: false,
              duration: stopDurSec,
            });
          }
        }

        // ③ Start new Trip
        const newTrip = await Trip.create({
          vehicleId,
          imei,
          startTime: packetTime,
          endTime: packetTime,
          duration: 0,
          distance: 0,
          startLatitude: lat,
          startLongitude: lng,
          avgSpeed: 0,
          maxSpeed: 0,
          idleTime: 0,
          fuelConsumed: null,
          routeData: lat ? [{ lat, lng, ts: packetTime.toISOString(), spd: speed }] : [],
        });
        state.currentTripId = newTrip.id;
        state.pendingTripEnd = false;
        state.engineOffSince = null;
      }

      // Start new Engine Session
      const newSession = await VehicleEngineSession.create({
        vehicleId,
        imei,
        startTime: packetTime,
        startLatitude: lat,
        startLongitude: lng,
        startFuelLevel: fuelLevel,
        tripId: state.currentTripId,
        distanceKm: 0,
        status: 'active',
      });
      state.currentSessionId = newSession.id;
      state.engineOn = true;
      state.engineOnSince = packetTime;
    } else if (!ignitionOn && prevEngineOn) {
      // ── ENGINE TURNED OFF ───────────────────────────────────────────────
      // Sleep-gap detection: GT06 goes silent during parking then wakes with
      // speed=0, triggering ENGINE TURNED OFF. The real stop was at
      // state.lastPacketTime (last active packet), NOT at the current packet
      // time. Detect the large gap and back-date the trip/session closure so
      // the parking period is accounted for correctly.
      const sleepGapThresholdMs = Math.max(idleThresholdMs * 2, 20 * 60 * 1000);
      let sessionEndTime = packetTime;
      let gapHandled = false;
      if (state.lastPacketTime && state.currentTripId) {
        const gapMs = now - new Date(state.lastPacketTime).getTime();
        if (gapMs >= sleepGapThresholdMs) {
          gapHandled = true;
          sessionEndTime = new Date(state.lastPacketTime); // real stop time
          // Close the trip at the real stop time
          await closeTripIfActive(state.currentTripId, sessionEndTime);
          // Create a fully-closed parking stop for the silent window
          await Stop.create({
            vehicleId,
            imei,
            startTime: sessionEndTime,
            endTime: packetTime,
            latitude: state.lastLat,
            longitude: state.lastLng,
            stopType: 'PARKING',
            engineStatus: false,
            duration: Math.floor(gapMs / 1000),
          });
          state.currentTripId = null;
          state.pendingTripEnd = false;
          state.engineOffSince = null; // ENGINE ON will start a fresh trip
        }
      }
      if (state.currentSessionId) {
        await closeEngineSession(state.currentSessionId, sessionEndTime, lat, lng, fuelLevel, state);
      }
      state.engineOn = false;
      state.currentSessionId = null;
      if (!gapHandled) {
        // Normal engine-off: arm the idle threshold check
        state.engineOffSince = packetTime;
        state.pendingTripEnd = true;
      }
    } else if (!ignitionOn && state.pendingTripEnd) {
      // ── STILL OFF — check idle threshold ───────────────────────────────
      const offDurationMs = state.engineOffSince
        ? now - new Date(state.engineOffSince).getTime()
        : Infinity;

      if (offDurationMs >= idleThresholdMs && state.currentTripId) {
        // Threshold exceeded — finalise the trip at the moment engine went off
        await closeTripIfActive(state.currentTripId, state.engineOffSince || packetTime);

        // Create parking Stop (open-ended; will be closed when engine turns on)
        // Guard against duplicates in case this branch fires multiple times
        const existingStop = await Stop.findOne({ where: { vehicleId, endTime: null } });
        if (!existingStop) {
          await Stop.create({
            vehicleId,
            imei,
            startTime: state.engineOffSince || packetTime,
            endTime: null,
            latitude: lat || state.lastLat,
            longitude: lng || state.lastLng,
            stopType: 'PARKING',
            engineStatus: false,
            duration: 0,
          });
        }

        state.currentTripId = null;
        state.pendingTripEnd = false;
      }
    } else if (ignitionOn && state.currentSessionId) {
      // ── Sleep-gap detection (GT06 parks silently between packets) ────────
      // When GT06 enters sleep mode it stops transmitting entirely.
      // On wake-up both prevEngineOn and ignitionOn are true → STILL ON branch.
      // If the inter-packet gap is >= sleepGapThreshold we treat it as a
      // parking period: close the current trip/session, create a closed
      // parking stop, then open fresh ones for the new movement.
      const sleepGapThresholdMs = Math.max(idleThresholdMs * 2, 20 * 60 * 1000); // ≥ 20 min
      if (state.lastPacketTime && state.currentTripId) {
        const gapMs = now - new Date(state.lastPacketTime).getTime();
        if (gapMs >= sleepGapThresholdMs) {
          const gapStart = new Date(state.lastPacketTime);
          // Close current session and trip at the moment of last contact
          await closeEngineSession(state.currentSessionId, gapStart, state.lastLat, state.lastLng, state.lastFuelLevel, state);
          await closeTripIfActive(state.currentTripId, gapStart);
          // Create a fully-closed parking stop covering the silent window
          await Stop.create({
            vehicleId,
            imei,
            startTime: gapStart,
            endTime: packetTime,
            latitude: state.lastLat,
            longitude: state.lastLng,
            stopType: 'PARKING',
            engineStatus: false,
            duration: Math.floor(gapMs / 1000),
          });
          // Start a fresh trip for the new movement
          const newTrip = await Trip.create({
            vehicleId,
            imei,
            startTime: packetTime,
            endTime: packetTime,
            duration: 0,
            distance: 0,
            startLatitude: lat,
            startLongitude: lng,
            avgSpeed: 0,
            maxSpeed: 0,
            idleTime: 0,
            fuelConsumed: null,
            routeData: lat ? [{ lat, lng, ts: packetTime.toISOString(), spd: speed }] : [],
          });
          state.currentTripId = newTrip.id;
          // Start a fresh engine session for the new movement
          const newSession = await VehicleEngineSession.create({
            vehicleId,
            imei,
            startTime: packetTime,
            startLatitude: lat,
            startLongitude: lng,
            startFuelLevel: fuelLevel,
            tripId: newTrip.id,
            distanceKm: 0,
            status: 'active',
          });
          state.currentSessionId = newSession.id;
          state.engineOnSince = packetTime;
        }
      }

      // ── ENGINE STILL ON — update active session & trip ─────────────────
      const prevLat = state.lastLat;
      const prevLng = state.lastLng;
      const segmentKm = prevLat && lat ? haversine(prevLat, prevLng, lat, lng) : 0;

      // Update engine session
      await VehicleEngineSession.increment(
        { distanceKm: segmentKm },
        { where: { id: state.currentSessionId } }
      );

      // Update active trip
      if (state.currentTripId) {
        const trip = await Trip.findByPk(state.currentTripId);
        if (trip) {
          const tripStart = new Date(trip.startTime).getTime();
          const durationSec = Math.floor((now - tripStart) / 1000);
          const newDist = parseFloat(trip.distance || 0) + segmentKm;
          const newMax = Math.max(parseFloat(trip.maxSpeed || 0), speed);

          // Append route point (sample every ~30 sec to limit storage)
          let route = trip.routeData || [];
          const lastPt = route[route.length - 1];
          const secSinceLast = lastPt ? (now - new Date(lastPt.ts).getTime()) / 1000 : 999;
          if (secSinceLast >= 30 && lat) {
            route = [...route, { lat, lng, ts: packetTime.toISOString(), spd: speed }];
            if (route.length > 2000) route = route.slice(-2000); // cap size
          }

          const totalSpeeds = route.filter(p => p.spd > 0);
          const avgSpeed = totalSpeeds.length
            ? totalSpeeds.reduce((s, p) => s + p.spd, 0) / totalSpeeds.length
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
    }

    // ── Update device state ─────────────────────────────────────────────────
    await state.save();
    await VehicleDeviceState.update(
      {
        lastLat: lat || state.lastLat,
        lastLng: lng || state.lastLng,
        lastSpeed: speed,
        lastFuelLevel: fuelLevel !== null ? fuelLevel : state.lastFuelLevel,
        lastOdometer: odometer || state.lastOdometer,
        lastPacketTime: packetTime,
        engineOn: ignitionOn,
        currentSessionId: state.currentSessionId,
        currentTripId: state.currentTripId,
        pendingTripEnd: state.pendingTripEnd,
        engineOnSince: state.engineOnSince,
        engineOffSince: state.engineOffSince,
      },
      { where: { vehicleId } }
    );
  } catch (err) {
    console.error('[PacketProcessor] Error processing packet:', err.message);
  }
}

async function closeEngineSession(sessionId, endTime, lat, lng, fuelLevel, state) {
  const session = await VehicleEngineSession.findByPk(sessionId);
  if (!session || session.status === 'completed') return;
  const durationSec = Math.floor(
    (new Date(endTime).getTime() - new Date(session.startTime).getTime()) / 1000
  );
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
  const durationSec = Math.floor(
    (new Date(endTime).getTime() - new Date(trip.startTime).getTime()) / 1000
  );
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

  // Reset device state for clean reprocessing
  await VehicleDeviceState.destroy({ where: { vehicleId } });
  // Remove existing data in range
  await VehicleEngineSession.destroy({ where: { vehicleId, startTime: { [Op.between]: [fromDate, toDate] } } });
  await VehicleFuelEvent.destroy({ where: { vehicleId, eventTime: { [Op.between]: [fromDate, toDate] } } });
  await Trip.destroy({ where: { vehicleId, startTime: { [Op.between]: [fromDate, toDate] } } });
  await Stop.destroy({ where: { vehicleId, startTime: { [Op.between]: [fromDate, toDate] } } });

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
}

module.exports = { processPacket, reprocessVehicle, invalidateVehicleCache };
