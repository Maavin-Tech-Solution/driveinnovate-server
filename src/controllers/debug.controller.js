const mongoose = require('mongoose');
const { Op } = require('sequelize');
const { Vehicle, VehicleDeviceState, Trip, VehicleEngineSession } = require('../models');
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

/**
 * GET /api/debug/data-packets?imei=...&deviceType=...
 * Returns raw MongoDB packets for an IMEI
 */
const getDataPackets = async (req, res) => {
  try {
    const { imei, deviceType } = req.query;
    if (!imei || !deviceType) {
      return res.status(400).json({ success: false, message: 'imei and deviceType are required' });
    }
    const Model = getModelForDeviceType(deviceType);
    if (!Model) {
      return res.status(400).json({ success: false, message: 'Invalid device type' });
    }
    const packets = await Model.find({ imei })
      .sort({ date: -1, timestamp: -1, createdAt: -1 })
      .limit(Number(req.query.limit) || 20)
      .skip(Number(req.query.skip) || 0);

    const mapped = packets.map(doc => ({
      date: doc.date || doc.timestamp || doc.createdAt || null,
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

module.exports = { getDataPackets, getVehicleStatus };
