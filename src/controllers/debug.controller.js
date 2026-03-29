const mongoose = require('mongoose');
const { Op } = require('sequelize');
const { Vehicle, VehicleDeviceState, Trip, VehicleEngineSession, Stop } = require('../models');
const { getMongoDb } = require('../config/mongodb');

// Dynamic model loader for device types
const getModelForDeviceType = (deviceType) => {
  if (deviceType === 'gt06') {
    return mongoose.models.GT06Location || mongoose.model('GT06Location', new mongoose.Schema({}, { strict: false }), 'gt06locations');
  } else if (deviceType === 'fmb125') {
    return mongoose.models.FMB125Location || mongoose.model('FMB125Location', new mongoose.Schema({}, { strict: false }), 'fmb125locations');
  }
  return null;
};

// Parse a datetime string as IST (append +05:30 if no tz present)
const parseIst = (str) => {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T00:00:00+05:30');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str)) return new Date(str + ':00+05:30');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(str)) return new Date(str + '+05:30');
  return new Date(str);
};

/**
 * GET /api/debug/data-packets
 * Query params:
 *   imei + deviceType  OR  vehicleId
 *   from, to           — IST datetime strings (YYYY-MM-DD or YYYY-MM-DDTHH:mm)
 *   packetType         — exact match, 'all' to skip
 *   acc                — 'true' | 'false' | 'any'
 *   hasGps             — 'yes' | 'no' | 'any'
 *   minSpeed, maxSpeed — numbers
 *   hasBattery         — 'yes' | 'no' | 'any'
 *   limit, skip
 */
const getDataPackets = async (req, res) => {
  try {
    let { imei, deviceType, vehicleId, packetType, acc, hasGps, minSpeed, maxSpeed, hasBattery, from, to } = req.query;

    // Resolve IMEI + deviceType from vehicleId if provided
    if (vehicleId && !imei) {
      const vehicle = await Vehicle.findByPk(vehicleId);
      if (!vehicle) return res.status(404).json({ success: false, message: 'Vehicle not found' });
      imei = vehicle.imei;
      deviceType = vehicle.deviceType || deviceType;
    }

    if (!imei || !deviceType) {
      return res.status(400).json({ success: false, message: 'imei and deviceType (or vehicleId) are required' });
    }

    const Model = getModelForDeviceType(deviceType);
    if (!Model) {
      return res.status(400).json({ success: false, message: 'Invalid device type' });
    }

    // IMEI variants (leading-zero both ways)
    const imeiVariants = [imei];
    if (imei.startsWith('0')) imeiVariants.push(imei.slice(1));
    else imeiVariants.push('0' + imei);

    // Build MongoDB filter
    const filter = { imei: { $in: imeiVariants } };

    // Date range (IST)
    if (from || to) {
      filter.timestamp = {};
      if (from) filter.timestamp.$gte = parseIst(from);
      if (to)   filter.timestamp.$lte = parseIst(to);
    }

    // Packet type
    if (packetType && packetType !== 'all') filter.packetType = packetType;

    // ACC
    if (acc === 'true')  filter.acc = true;
    else if (acc === 'false') filter.acc = false;

    // Has GPS
    if (hasGps === 'yes') {
      filter.latitude  = { $exists: true, $gt: 0 };
      filter.longitude = { $exists: true, $ne: null };
    } else if (hasGps === 'no') {
      filter.$or = [{ latitude: { $exists: false } }, { latitude: { $lte: 0 } }];
    }

    // Speed range
    if (minSpeed !== undefined || maxSpeed !== undefined) {
      filter.speed = {};
      if (minSpeed !== undefined) filter.speed.$gte = Number(minSpeed);
      if (maxSpeed !== undefined) filter.speed.$lte = Number(maxSpeed);
    }

    // Battery presence
    if (hasBattery === 'yes')  filter.battery = { $exists: true, $ne: null };
    else if (hasBattery === 'no') filter.battery = { $exists: false };

    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const skip  = Number(req.query.skip) || 0;

    const packets = await Model.find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .skip(skip);

    const mapped = packets.map(doc => ({
      date: doc.timestamp || doc.date || doc.createdAt || null,
      imei: doc.imei || imei,
      deviceType,
      data: doc,
    }));
    return res.json(mapped);
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/debug/vehicle-status?vehicleNumber=HR26DC9709
 * Full diagnostic for a vehicle: MySQL state + MongoDB packet timeline
 */
const getVehicleStatus = async (req, res) => {
  try {
    const { vehicleNumber, vehicleId } = req.query;
    if (!vehicleNumber && !vehicleId) {
      return res.status(400).json({ success: false, message: 'vehicleNumber or vehicleId is required' });
    }

    // ── Find vehicle in MySQL ────────────────────────────────────────────────
    let vehicle;
    if (vehicleId) {
      vehicle = await Vehicle.findByPk(vehicleId);
    } else {
      vehicle = await Vehicle.findOne({ where: { vehicleNumber: vehicleNumber.toUpperCase() } });
    }
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found in MySQL' });
    }

    // ── IMEI variants (leading-zero both ways) ───────────────────────────────
    const storedImei = vehicle.imei || '';
    const imeiVariants = [storedImei];
    if (storedImei.startsWith('0')) imeiVariants.push(storedImei.slice(1));
    else if (storedImei) imeiVariants.push('0' + storedImei);

    // ── VehicleDeviceState ───────────────────────────────────────────────────
    const deviceState = await VehicleDeviceState.findOne({ where: { vehicleId: vehicle.id } });

    // ── Recent MySQL trips ───────────────────────────────────────────────────
    const recentTrip = await Trip.findOne({
      where: { vehicleId: vehicle.id },
      order: [['start_time', 'DESC']],
      attributes: ['id', 'startTime', 'endTime', 'distance'],
    });
    const tripCount = await Trip.count({ where: { vehicleId: vehicle.id } });

    // ── MongoDB diagnostics ──────────────────────────────────────────────────
    let mongoData = null;
    try {
      const db = getMongoDb();
      const collections = ['gt06locations', 'fmb125locations'];
      mongoData = {};

      for (const colName of collections) {
        const col = db.collection(colName);

        // Latest packet for any IMEI variant
        const latest = await col.findOne(
          { imei: { $in: imeiVariants } },
          { sort: { timestamp: -1 } }
        );

        // Latest packet WITH GPS coordinates
        const latestGps = await col.findOne(
          { imei: { $in: imeiVariants }, latitude: { $exists: true, $gt: 0 }, longitude: { $exists: true, $ne: null } },
          { sort: { timestamp: -1 } }
        );

        // Daily packet counts for the last 45 days
        const since45 = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
        const dailyCounts = await col.aggregate([
          { $match: { imei: { $in: imeiVariants }, timestamp: { $gte: since45 } } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
              count: { $sum: 1 },
              imei: { $first: '$imei' },
            },
          },
          { $sort: { _id: -1 } },
        ]).toArray();

        // Packet-type breakdown for last 7 days
        const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const typeBreakdown = await col.aggregate([
          { $match: { imei: { $in: imeiVariants }, timestamp: { $gte: since7 } } },
          {
            $group: {
              _id: { $ifNull: ['$packetType', '(none)'] },
              count: { $sum: 1 },
              hasGps:  { $sum: { $cond: [{ $and: [{ $gt: ['$latitude', 0] }, { $gt: ['$longitude', 0] }] }, 1, 0] } },
              hasAcc:  { $sum: { $cond: [{ $gt: [{ $type: '$acc' }, 'null'] }, 1, 0] } },
              avgSpeed: { $avg: '$speed' },
            },
          },
          { $sort: { count: -1 } },
        ]).toArray();

        // Last 10 recent packets — key fields only for diagnosis
        const recentPackets = await col.find(
          { imei: { $in: imeiVariants } },
          {
            projection: {
              timestamp: 1, packetType: 1,
              latitude: 1, longitude: 1,
              speed: 1, acc: 1, imei: 1,
            },
          }
        )
          .sort({ timestamp: -1 })
          .limit(10)
          .toArray();

        // Total packet count for this IMEI
        const totalCount = await col.countDocuments({ imei: { $in: imeiVariants } });

        mongoData[colName] = {
          latestPacket: latest
            ? { timestamp: latest.timestamp, imei: latest.imei, packetType: latest.packetType, acc: latest.acc, speed: latest.speed, lat: latest.latitude, lng: latest.longitude }
            : null,
          latestGpsPacket: latestGps
            ? { timestamp: latestGps.timestamp, imei: latestGps.imei, packetType: latestGps.packetType, lat: latestGps.latitude, lng: latestGps.longitude, speed: latestGps.speed, acc: latestGps.acc }
            : null,
          dailyCounts,
          typeBreakdown,
          recentPackets: recentPackets.map(p => ({
            timestamp: p.timestamp,
            packetType: p.packetType || '(none)',
            lat: p.latitude ?? null,
            lng: p.longitude ?? null,
            speed: p.speed ?? null,
            acc: p.acc ?? null,
            imei: p.imei,
          })),
          totalCount,
        };
      }
    } catch (mongoErr) {
      mongoData = { error: mongoErr.message };
    }

    return res.json({
      success: true,
      data: {
        vehicle: {
          id: vehicle.id,
          vehicleNumber: vehicle.vehicleNumber,
          imei: vehicle.imei,
          status: vehicle.status,
          deviceType: vehicle.deviceType,
        },
        imeiVariants,
        deviceState: deviceState
          ? {
              lastPacketTime: deviceState.lastPacketTime,
              engineOn: deviceState.engineOn,
              lastLat: deviceState.lastLat,
              lastLng: deviceState.lastLng,
              lastSpeed: deviceState.lastSpeed,
              currentTripId: deviceState.currentTripId,
              currentSessionId: deviceState.currentSessionId,
            }
          : null,
        mysql: {
          totalTrips: tripCount,
          lastTrip: recentTrip
            ? { id: recentTrip.id, startTime: recentTrip.startTime, endTime: recentTrip.endTime, distanceKm: recentTrip.distance }
            : null,
        },
        mongo: mongoData,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/debug/sessions?vehicleId=X&from=2026-03-29&to=2026-03-29
 * Shows every VehicleEngineSession row for a vehicle in an IST date range.
 * Use this to diagnose inflated / negative engine hours.
 */
const IST_MS = 5.5 * 60 * 60 * 1000;
const getSessions = async (req, res) => {
  try {
    const { vehicleId, from, to } = req.query;
    if (!vehicleId) return res.status(400).json({ success: false, message: 'vehicleId required' });
    const fromDate = from
      ? new Date(new Date(from).getTime() - IST_MS)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const toDate = to
      ? new Date(new Date(to).getTime() - IST_MS + 24 * 60 * 60 * 1000 - 1)
      : new Date();

    const sessions = await VehicleEngineSession.findAll({
      where: {
        vehicleId,
        [Op.or]: [
          { startTime: { [Op.between]: [fromDate, toDate] } },
          { startTime: { [Op.lt]: fromDate }, endTime: { [Op.gt]: fromDate } },
          { startTime: { [Op.lt]: fromDate }, endTime: null },
        ],
      },
      order: [['startTime', 'ASC']],
    });

    const toIST = (d) => d ? new Date(new Date(d).getTime() + IST_MS).toISOString().replace('T', ' ').slice(0, 19) + ' IST' : null;
    const fmtSecs = (s) => {
      if (!s && s !== 0) return null;
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    };

    const rows = sessions.map(s => ({
      id: s.id,
      status: s.status,
      startTime_IST: toIST(s.startTime),
      endTime_IST:   toIST(s.endTime),
      durationSeconds: s.durationSeconds,
      durationFormatted: fmtSecs(s.durationSeconds),
    }));

    const totalCompleted = sessions
      .filter(s => s.status === 'completed')
      .reduce((sum, s) => sum + (s.durationSeconds || 0), 0);

    res.json({
      success: true,
      queryRange: { from: toIST(fromDate), to: toIST(toDate) },
      totalSessions: sessions.length,
      totalCompletedEngineHours: fmtSecs(totalCompleted),
      totalCompletedSeconds: totalCompleted,
      rows,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getDataPackets, getVehicleStatus, getSessions };
