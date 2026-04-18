const { Op } = require('sequelize');
const { SpeedViolation, Vehicle, User, Trip, Stop } = require('../models');
const { getMongoDb } = require('../config/mongodb');

// When a caller passes a bare date string (YYYY-MM-DD) for endDate, a naive
// new Date(endDate) lands at 00:00 UTC — which excludes the whole day of data.
// Normalize: YYYY-MM-DD end → 23:59:59.999 local, start → 00:00:00.000.
function normalizeRange(startDate, endDate) {
  const isBareDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const start = startDate ? (isBareDate(startDate) ? new Date(startDate + 'T00:00:00') : new Date(startDate)) : null;
  const end   = endDate   ? (isBareDate(endDate)   ? new Date(endDate   + 'T23:59:59.999') : new Date(endDate)) : null;
  return { start, end };
}

class ReportService {
  /**
   * Analyze location data and detect speed violations
   * @param {Object} params - { vehicleIds, startDate, endDate, speedLimit }
   * @returns {Array} Array of detected violations
   */
  async analyzeSpeedViolations(params) {
    const {
      vehicleIds = [],
      startDate,
      endDate,
      speedLimit = 80, // Default speed limit in km/h
      minDuration = 3   // Minimum duration in seconds to count as violation
    } = params;

    try {
      const db = getMongoDb();
      const LocationData = db.collection('locations');

      // Build query - use direct fields (not nested in data)
      const { start, end } = normalizeRange(startDate, endDate);
      const query = {
        timestamp: { $gte: start, $lte: end },
        speed: { $gt: speedLimit, $exists: true }
      };

      // If specific vehicles provided
      if (vehicleIds && vehicleIds.length > 0) {
        const vehicles = await Vehicle.findAll({
          where: { id: { [Op.in]: vehicleIds } },
          attributes: ['id', 'imei']
        });
        console.log('Analyzing violations for vehicles:', vehicles.map(v => ({ id: v.id, imei: v.imei })));
        
        const imeis = vehicles.map(v => v.imei).filter(Boolean);
        if (imeis.length > 0) {
          query.imei = { $in: imeis };
        } else {
          console.log('WARNING: No IMEIs found for provided vehicle IDs');
        }
      } else {
        console.log('Analyzing violations for ALL vehicles (no filter)');
      }

      console.log('MongoDB query:', JSON.stringify(query, null, 2));

      // Fetch violations from MongoDB
      const violations = await LocationData.find(query)
        .sort({ imei: 1, timestamp: 1 })
        .toArray();

      console.log(`Found ${violations.length} raw violations from MongoDB`);

      // Group consecutive violations and calculate duration
      const processedViolations = this._groupConsecutiveViolations(
        violations,
        speedLimit,
        minDuration
      );

      console.log(`Processed into ${processedViolations.length} violation groups`);

      return processedViolations;
    } catch (error) {
      console.error('Error analyzing speed violations:', error);
      throw error;
    }
  }

  /**
   * Group consecutive violations and calculate duration
   * @private
   */
  _groupConsecutiveViolations(violations, speedLimit, minDuration) {
    const grouped = [];
    let currentGroup = null;

    violations.forEach((violation, index) => {
      const speed = violation.speed || 0;
      const excessSpeed = speed - speedLimit;

      if (!currentGroup) {
        // Start new group
        currentGroup = {
          imei: violation.imei,
          startTime: new Date(violation.timestamp),
          endTime: new Date(violation.timestamp),
          maxSpeed: speed,
          latitude: violation.latitude,
          longitude: violation.longitude,
          violations: [violation]
        };
      } else if (
        violation.imei === currentGroup.imei &&
        (new Date(violation.timestamp) - currentGroup.endTime) < 60000 // Within 1 minute
      ) {
        // Extend current group
        currentGroup.endTime = new Date(violation.timestamp);
        currentGroup.maxSpeed = Math.max(currentGroup.maxSpeed, speed);
        currentGroup.violations.push(violation);
      } else {
        // Save current group and start new one
        if (currentGroup.violations.length > 0) {
          grouped.push(this._createViolationRecord(currentGroup, speedLimit));
        }
        currentGroup = {
          imei: violation.imei,
          startTime: new Date(violation.timestamp),
          endTime: new Date(violation.timestamp),
          maxSpeed: speed,
          latitude: violation.latitude,
          longitude: violation.longitude,
          violations: [violation]
        };
      }
    });

    // Don't forget the last group
    if (currentGroup && currentGroup.violations.length > 0) {
      grouped.push(this._createViolationRecord(currentGroup, speedLimit));
    }

    // Filter by minimum duration
    return grouped.filter(v => v.duration >= minDuration);
  }

  /**
   * Create violation record from grouped data
   * @private
   */
  _createViolationRecord(group, speedLimit) {
    // A single-packet overspeed still represents a real violation — clamp to ≥1s
    // so it doesn't get filtered out when the minDuration threshold is applied.
    const rawDuration = Math.floor((group.endTime - group.startTime) / 1000);
    const duration = Math.max(1, rawDuration);
    const excessSpeed = group.maxSpeed - speedLimit;
    const severity = this._calculateSeverity(excessSpeed);

    return {
      imei: group.imei,
      timestamp: group.startTime,
      speed: parseFloat(group.maxSpeed.toFixed(2)),
      speedLimit: parseFloat(speedLimit.toFixed(2)),
      excessSpeed: parseFloat(excessSpeed.toFixed(2)),
      latitude: group.latitude,
      longitude: group.longitude,
      duration,
      severity
    };
  }

  /**
   * Calculate violation severity
   * @private
   */
  _calculateSeverity(excessSpeed) {
    if (excessSpeed > 40) return 'CRITICAL';
    if (excessSpeed > 20) return 'HIGH';
    if (excessSpeed > 10) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Save speed violations to database
   * @param {Array} violations - Array of violation objects
   * @returns {Array} Saved violations
   */
  async saveSpeedViolations(violations) {
    try {
      // Get vehicle IDs from IMEIs
      const imeis = [...new Set(violations.map(v => v.imei))];
      console.log('Saving violations for IMEIs:', imeis);
      
      const vehicles = await Vehicle.findAll({
        where: { imei: { [Op.in]: imeis } },
        attributes: ['id', 'imei']
      });

      console.log('Found vehicles:', vehicles.map(v => ({ id: v.id, imei: v.imei })));

      const imeiToVehicleId = {};
      vehicles.forEach(v => {
        imeiToVehicleId[v.imei] = v.id;
      });

      // Prepare records for bulk insert
      const records = violations
        .filter(v => imeiToVehicleId[v.imei]) // Only violations with valid vehicle
        .map(v => ({
          vehicleId: imeiToVehicleId[v.imei],
          imei: v.imei,
          timestamp: v.timestamp,
          speed: v.speed,
          speedLimit: v.speedLimit,
          excessSpeed: v.excessSpeed,
          latitude: v.latitude,
          longitude: v.longitude,
          duration: v.duration,
          severity: v.severity,
          acknowledged: false
        }));

      console.log(`Prepared ${records.length} records out of ${violations.length} violations`);

      // Bulk create
      const saved = await SpeedViolation.bulkCreate(records, {
        ignoreDuplicates: true,
        returning: true
      });

      console.log(`Successfully saved ${saved.length} violations to database`);
      return saved;
    } catch (error) {
      console.error('Error saving speed violations:', error);
      throw error;
    }
  }

  /**
   * Get speed violation report with filters
   * @param {Object} filters - { vehicleIds, startDate, endDate, severity, acknowledged }
   * @returns {Object} Report data with violations and statistics
   */
  async getSpeedViolationReport(filters) {
    const {
      vehicleIds,
      startDate,
      endDate,
      severity,
      acknowledged,
      limit = 100,
      offset = 0
    } = filters;

    try {
      const where = {};

      if (vehicleIds && vehicleIds.length > 0) {
        where.vehicleId = { [Op.in]: vehicleIds };
      }

      if (startDate && endDate) {
        const { start, end } = normalizeRange(startDate, endDate);
        where.timestamp = { [Op.between]: [start, end] };
      }

      if (severity) {
        where.severity = severity;
      }

      if (acknowledged !== undefined) {
        where.acknowledged = acknowledged;
      }

      // Get violations with vehicle details
      const { count, rows: violations } = await SpeedViolation.findAndCountAll({
        where,
        include: [
          {
            model: Vehicle,
            as: 'vehicle',
            attributes: ['id', 'vehicleNumber', 'imei', 'chasisNumber']
          },
          {
            model: User,
            as: 'acknowledger',
            attributes: ['id', 'name', 'email'],
            required: false
          }
        ],
        order: [['timestamp', 'DESC']],
        limit,
        offset
      });

      // Calculate statistics
      const stats = await this._calculateViolationStats(where);

      return {
        violations,
        total: count,
        stats,
        filters
      };
    } catch (error) {
      console.error('Error getting speed violation report:', error);
      throw error;
    }
  }

  /**
   * Calculate statistics for violations
   * @private
   */
  async _calculateViolationStats(where) {
    try {
      const total = await SpeedViolation.count({ where });
      
      const bySeverity = await SpeedViolation.findAll({
        where,
        attributes: [
          'severity',
          [SpeedViolation.sequelize.fn('COUNT', SpeedViolation.sequelize.col('id')), 'count']
        ],
        group: ['severity'],
        raw: true
      });

      const acknowledged = await SpeedViolation.count({
        where: { ...where, acknowledged: true }
      });

      const avgExcessSpeed = await SpeedViolation.findOne({
        where,
        attributes: [
          [SpeedViolation.sequelize.fn('AVG', SpeedViolation.sequelize.col('excess_speed')), 'avg']
        ],
        raw: true
      });

      const maxSpeed = await SpeedViolation.findOne({
        where,
        attributes: [
          [SpeedViolation.sequelize.fn('MAX', SpeedViolation.sequelize.col('speed')), 'max']
        ],
        raw: true
      });

      return {
        total,
        acknowledged,
        unacknowledged: total - acknowledged,
        bySeverity: bySeverity.reduce((acc, item) => {
          acc[item.severity.toLowerCase()] = parseInt(item.count);
          return acc;
        }, { low: 0, medium: 0, high: 0, critical: 0 }),
        avgExcessSpeed: parseFloat((avgExcessSpeed?.avg || 0).toFixed(2)),
        maxSpeed: parseFloat((maxSpeed?.max || 0).toFixed(2))
      };
    } catch (error) {
      console.error('Error calculating violation stats:', error);
      return {
        total: 0,
        acknowledged: 0,
        unacknowledged: 0,
        bySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
        avgExcessSpeed: 0,
        maxSpeed: 0
      };
    }
  }

  /**
   * Acknowledge a speed violation
   * @param {Number} violationId
   * @param {Number} userId
   * @param {String} notes
   */
  async acknowledgeViolation(violationId, userId, notes = '') {
    try {
      const violation = await SpeedViolation.findByPk(violationId);
      if (!violation) {
        throw new Error('Violation not found');
      }

      violation.acknowledged = true;
      violation.acknowledgedBy = userId;
      violation.acknowledgedAt = new Date();
      violation.notes = notes;

      await violation.save();
      return violation;
    } catch (error) {
      console.error('Error acknowledging violation:', error);
      throw error;
    }
  }

  /**
   * Get speed violation summary by vehicle
   * @param {Object} filters - { startDate, endDate }
   */
  async getVehicleViolationSummary(filters) {
    const { startDate, endDate, vehicleIds } = filters;

    try {
      const where = {};
      if (startDate && endDate) {
        const { start, end } = normalizeRange(startDate, endDate);
        where.timestamp = { [Op.between]: [start, end] };
      }
      if (Array.isArray(vehicleIds) && vehicleIds.length) {
        where.vehicleId = { [Op.in]: vehicleIds };
      }

      const summary = await SpeedViolation.findAll({
        where,
        attributes: [
          'vehicleId',
          [SpeedViolation.sequelize.fn('COUNT', SpeedViolation.sequelize.col('SpeedViolation.id')), 'violationCount'],
          [SpeedViolation.sequelize.fn('MAX', SpeedViolation.sequelize.col('speed')), 'maxSpeed'],
          [SpeedViolation.sequelize.fn('AVG', SpeedViolation.sequelize.col('excess_speed')), 'avgExcessSpeed']
        ],
        include: [
          {
            model: Vehicle,
            as: 'vehicle',
            attributes: ['id', 'vehicleNumber', 'imei']
          }
        ],
        group: ['vehicleId', 'vehicle.id'],
        order: [[SpeedViolation.sequelize.literal('violationCount'), 'DESC']]
      });

      return summary;
    } catch (error) {
      console.error('Error getting vehicle violation summary:', error);
      throw error;
    }
  }

  /**
   * Analyze trips from location data
   * @param {Object} params - { vehicleIds, startDate, endDate, minTripDuration }
   */
  async analyzeTrips(params) {
    const {
      vehicleIds = [],
      startDate,
      endDate,
      minTripDuration = 60, // Minimum trip duration in seconds
      minDistance = 0.1 // Minimum distance in km
    } = params;

    try {
      const db = getMongoDb();

      let imeis = [];
      if (vehicleIds && vehicleIds.length > 0) {
        const vehicles = await Vehicle.findAll({
          where: { id: { [Op.in]: vehicleIds } },
          attributes: ['id', 'imei', 'deviceType', 'idleThreshold']
        });
        imeis = vehicles.map(v => ({ id: v.id, imei: v.imei, deviceType: v.deviceType, idleThreshold: v.idleThreshold }));
      } else {
        const vehicles = await Vehicle.findAll({ attributes: ['id', 'imei', 'deviceType', 'idleThreshold'] });
        imeis = vehicles.map(v => ({ id: v.id, imei: v.imei, deviceType: v.deviceType, idleThreshold: v.idleThreshold }));
      }

      const trips = [];

      for (const vehicle of imeis) {
        if (!vehicle.imei) continue;

        const collectionName = this._getCollectionForDevice(vehicle.deviceType);
        const LocationData = db.collection(collectionName);

        const locations = await LocationData.find({
          imei: vehicle.imei,
          timestamp: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          },
          latitude: { $exists: true, $ne: null },
          longitude: { $exists: true, $ne: null }
        }).sort({ timestamp: 1 }).toArray();

        if (locations.length < 2) continue;

        const haltThresholdMin = vehicle.idleThreshold || 10;
        const vehicleTrips = this._extractTrips(locations, vehicle.id, vehicle.imei, minTripDuration, minDistance, haltThresholdMin);
        trips.push(...vehicleTrips);
      }

      return trips;
    } catch (error) {
      console.error('Error analyzing trips:', error);
      throw error;
    }
  }

  /**
   * Extract trips from location data
   * Trip start: speed >= SPEED_THRESHOLD (2 km/h)
   * Trip end: speed below threshold for >= haltThresholdMin (prolonged halt) or engine off
   * @private
   */
  _extractTrips(locations, vehicleId, imei, minTripDuration, minDistance, haltThresholdMin = 10) {
    const SPEED_THRESHOLD = 2; // km/h - minimum speed to consider vehicle moving
    const HALT_THRESHOLD_SEC = haltThresholdMin * 60;

    const trips = [];
    let currentTrip = null;
    let haltStart = null;      // timestamp when speed first dropped below threshold
    let lastMovingLoc = null;  // last location where speed >= SPEED_THRESHOLD

    for (let i = 0; i < locations.length; i++) {
      const loc = locations[i];
      const speed = loc.speed || 0;
      // Normalize ignition across device types:
      //   GT06   → loc.acc  (boolean)
      //   FMB125 → loc.ignition (boolean)
      //   AIS140 → loc.ignition (0/1 integer)
      const rawIgnition = loc.acc !== undefined ? loc.acc : loc.ignition;
      const ignitionOff = rawIgnition === false || rawIgnition === 0;
      const isMoving = speed >= SPEED_THRESHOLD;

      if (!currentTrip) {
        if (isMoving) {
          currentTrip = {
            vehicleId,
            imei,
            startTime: new Date(loc.timestamp),
            startLat: loc.latitude,
            startLng: loc.longitude,
            points: [loc],
            speeds: [speed],
            totalDistance: 0,
          };
          lastMovingLoc = loc;
          haltStart = null;
        }
      } else {
        // Currently in a trip
        if (isMoving) {
          // Vehicle moving — extend trip, reset halt tracking
          const prevLoc = currentTrip.points[currentTrip.points.length - 1];
          const dist = this._calculateDistance(
            prevLoc.latitude, prevLoc.longitude, loc.latitude, loc.longitude
          );
          currentTrip.totalDistance += dist;
          currentTrip.points.push(loc);
          currentTrip.speeds.push(speed);
          lastMovingLoc = loc;
          haltStart = null;
        } else {
          // Speed below threshold — start or continue halt tracking
          if (!haltStart) {
            haltStart = new Date(loc.timestamp);
          }

          const haltDurationSec = (new Date(loc.timestamp) - haltStart) / 1000;

          // End trip if prolonged halt exceeded OR engine explicitly turned off
          if (haltDurationSec >= HALT_THRESHOLD_SEC || ignitionOff) {
            const endLoc = lastMovingLoc || currentTrip.points[currentTrip.points.length - 1];
            const duration = Math.floor((new Date(endLoc.timestamp) - currentTrip.startTime) / 1000);

            if (duration >= minTripDuration && currentTrip.totalDistance >= minDistance) {
              trips.push(this._createTripRecord(currentTrip, endLoc));
            }
            currentTrip = null;
            lastMovingLoc = null;
            haltStart = null;
          }
          // else: halt within threshold — keep trip open, vehicle may resume
        }
      }
    }

    // Finalize any still-open trip at end of data window
    if (currentTrip && currentTrip.points.length > 1) {
      const endLoc = lastMovingLoc || currentTrip.points[currentTrip.points.length - 1];
      const duration = Math.floor((new Date(endLoc.timestamp) - currentTrip.startTime) / 1000);
      if (duration >= minTripDuration && currentTrip.totalDistance >= minDistance) {
        trips.push(this._createTripRecord(currentTrip, endLoc));
      }
    }

    return trips;
  }

  /**
   * Create trip record from trip data
   * @private
   */
  _createTripRecord(tripData, endLoc) {
    const duration = Math.floor((new Date(endLoc.timestamp) - tripData.startTime) / 1000);
    const avgSpeed = tripData.speeds.reduce((a, b) => a + b, 0) / tripData.speeds.length;
    const maxSpeed = Math.max(...tripData.speeds);

    // Sample route data (every 10th point to reduce size)
    const routeData = tripData.points
      .filter((_, i) => i % 10 === 0 || i === tripData.points.length - 1)
      .map(p => ({
        lat: p.latitude,
        lng: p.longitude,
        time: p.timestamp,
        speed: p.speed
      }));

    return {
      vehicleId: tripData.vehicleId,
      imei: tripData.imei,
      startTime: tripData.startTime,
      endTime: new Date(endLoc.timestamp),
      duration,
      distance: parseFloat(tripData.totalDistance.toFixed(2)),
      startLatitude: tripData.startLat,
      startLongitude: tripData.startLng,
      endLatitude: endLoc.latitude,
      endLongitude: endLoc.longitude,
      avgSpeed: parseFloat(avgSpeed.toFixed(2)),
      maxSpeed: parseFloat(maxSpeed.toFixed(2)),
      routeData
    };
  }

  /**
   * Calculate distance between two coordinates (Haversine formula)
   * @private
   */
  _calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = this._toRad(lat2 - lat1);
    const dLon = this._toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this._toRad(lat1)) * Math.cos(this._toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  _toRad(deg) {
    return deg * (Math.PI / 180);
  }

  /**
   * Save trips to database
   */
  async saveTrips(trips) {
    try {
      const saved = await Trip.bulkCreate(trips, {
        ignoreDuplicates: true,
        returning: true
      });
      return saved;
    } catch (error) {
      console.error('Error saving trips:', error);
      throw error;
    }
  }

  /**
   * Get trip report
   */
  async getTripReport(filters) {
    const {
      vehicleIds,
      startDate,
      endDate,
      limit = 100,
      offset = 0
    } = filters;

    try {
      const where = {};

      if (vehicleIds && vehicleIds.length > 0) {
        where.vehicleId = { [Op.in]: vehicleIds };
      }

      if (startDate && endDate) {
        where.startTime = {
          [Op.between]: [new Date(startDate), new Date(endDate)]
        };
      }

      const { count, rows: trips } = await Trip.findAndCountAll({
        where,
        include: [
          {
            model: Vehicle,
            as: 'vehicle',
            attributes: ['id', 'vehicleNumber', 'imei']
          }
        ],
        order: [['startTime', 'DESC']],
        limit,
        offset
      });

      const stats = await this._calculateTripStats(where);

      return {
        trips,
        total: count,
        stats,
        filters
      };
    } catch (error) {
      console.error('Error getting trip report:', error);
      throw error;
    }
  }

  /**
   * Calculate trip statistics
   * @private
   */
  async _calculateTripStats(where) {
    try {
      const total = await Trip.count({ where });
      
      const sums = await Trip.findOne({
        where,
        attributes: [
          [Trip.sequelize.fn('SUM', Trip.sequelize.col('distance')), 'totalDistance'],
          [Trip.sequelize.fn('SUM', Trip.sequelize.col('duration')), 'totalDuration'],
          [Trip.sequelize.fn('AVG', Trip.sequelize.col('avg_speed')), 'avgSpeed'],
          [Trip.sequelize.fn('MAX', Trip.sequelize.col('max_speed')), 'maxSpeed']
        ],
        raw: true
      });

      return {
        total,
        totalDistance: parseFloat((sums?.totalDistance || 0).toFixed(2)),
        totalDuration: parseInt(sums?.totalDuration || 0),
        avgSpeed: parseFloat((sums?.avgSpeed || 0).toFixed(2)),
        maxSpeed: parseFloat((sums?.maxSpeed || 0).toFixed(2))
      };
    } catch (error) {
      console.error('Error calculating trip stats:', error);
      return { total: 0, totalDistance: 0, totalDuration: 0, avgSpeed: 0, maxSpeed: 0 };
    }
  }

  /**
   * Analyze stops from location data
   */
  async analyzeStops(params) {
    const {
      vehicleIds = [],
      startDate,
      endDate,
      minStopDuration = 300 // Minimum 5 minutes
    } = params;

    try {
      const db = getMongoDb();

      let imeis = [];
      if (vehicleIds && vehicleIds.length > 0) {
        const vehicles = await Vehicle.findAll({
          where: { id: { [Op.in]: vehicleIds } },
          attributes: ['id', 'imei', 'deviceType']
        });
        imeis = vehicles.map(v => ({ id: v.id, imei: v.imei, deviceType: v.deviceType }));
      } else {
        const vehicles = await Vehicle.findAll({ attributes: ['id', 'imei', 'deviceType'] });
        imeis = vehicles.map(v => ({ id: v.id, imei: v.imei, deviceType: v.deviceType }));
      }

      const stops = [];

      for (const vehicle of imeis) {
        if (!vehicle.imei) continue;

        const collectionName = this._getCollectionForDevice(vehicle.deviceType);
        const LocationData = db.collection(collectionName);

        const locations = await LocationData.find({
          imei: vehicle.imei,
          timestamp: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          },
          latitude: { $exists: true, $ne: null },
          longitude: { $exists: true, $ne: null }
        }).sort({ timestamp: 1 }).toArray();

        if (locations.length < 2) continue;

        const vehicleStops = this._extractStops(locations, vehicle.id, vehicle.imei, minStopDuration);
        stops.push(...vehicleStops);
      }

      return stops;
    } catch (error) {
      console.error('Error analyzing stops:', error);
      throw error;
    }
  }

  /**
   * Extract stops from location data
   * @private
   */
  _extractStops(locations, vehicleId, imei, minStopDuration) {
    const stops = [];
    let currentStop = null;

    for (let i = 0; i < locations.length; i++) {
      const loc = locations[i];
      const speed = loc.speed || 0;
      // Normalize ignition across device types (GT06: acc bool, FMB: ignition bool, AIS140: ignition 0/1)
      const ignition = loc.acc !== undefined ? loc.acc : loc.ignition;
      const isMoving = speed >= 2; // consistent with trip speed threshold

      // Stop start: vehicle not moving
      if (!currentStop && !isMoving) {
        currentStop = {
          vehicleId,
          imei,
          startTime: new Date(loc.timestamp),
          latitude: loc.latitude,
          longitude: loc.longitude,
          engineStatus: ignition,
          points: [loc]
        };
      }
      // Stop continues
      else if (currentStop && !isMoving) {
        currentStop.points.push(loc);
        // Update engine status (take latest)
        currentStop.engineStatus = ignition;
      }
      // Stop ends: vehicle starts moving
      else if (currentStop && isMoving) {
        const duration = Math.floor((new Date(loc.timestamp) - currentStop.startTime) / 1000);
        
        if (duration >= minStopDuration) {
          stops.push(this._createStopRecord(currentStop, loc));
        }
        currentStop = null;
      }
    }

    // Handle last stop if still ongoing
    if (currentStop && currentStop.points.length > 1) {
      const lastLoc = currentStop.points[currentStop.points.length - 1];
      const duration = Math.floor((new Date(lastLoc.timestamp) - currentStop.startTime) / 1000);
      
      if (duration >= minStopDuration) {
        stops.push(this._createStopRecord(currentStop, lastLoc));
      }
    }

    return stops;
  }

  /**
   * Create stop record
   * @private
   */
  _createStopRecord(stopData, endLoc) {
    const duration = Math.floor((new Date(endLoc.timestamp) - stopData.startTime) / 1000);
    
    // Determine stop type
    let stopType = 'PARKING';
    if (stopData.engineStatus) {
      stopType = 'IDLE';
    } else if (duration < 600) { // Less than 10 minutes
      stopType = 'TRAFFIC';
    }

    return {
      vehicleId: stopData.vehicleId,
      imei: stopData.imei,
      startTime: stopData.startTime,
      endTime: new Date(endLoc.timestamp),
      duration,
      latitude: stopData.latitude,
      longitude: stopData.longitude,
      stopType,
      engineStatus: stopData.engineStatus
    };
  }

  /**
   * Save stops to database
   */
  async saveStops(stops) {
    try {
      const saved = await Stop.bulkCreate(stops, {
        ignoreDuplicates: true,
        returning: true
      });
      return saved;
    } catch (error) {
      console.error('Error saving stops:', error);
      throw error;
    }
  }

  /**
   * Get stop report
   */
  async getStopReport(filters) {
    const {
      vehicleIds,
      startDate,
      endDate,
      stopType,
      limit = 100,
      offset = 0
    } = filters;

    try {
      const where = {};

      if (vehicleIds && vehicleIds.length > 0) {
        where.vehicleId = { [Op.in]: vehicleIds };
      }

      if (startDate && endDate) {
        where.startTime = {
          [Op.between]: [new Date(startDate), new Date(endDate)]
        };
      }

      if (stopType) {
        where.stopType = stopType;
      }

      const { count, rows: stops } = await Stop.findAndCountAll({
        where,
        include: [
          {
            model: Vehicle,
            as: 'vehicle',
            attributes: ['id', 'vehicleNumber', 'imei']
          }
        ],
        order: [['startTime', 'DESC']],
        limit,
        offset
      });

      const stats = await this._calculateStopStats(where);

      return {
        stops,
        total: count,
        stats,
        filters
      };
    } catch (error) {
      console.error('Error getting stop report:', error);
      throw error;
    }
  }

  /**
   * Calculate stop statistics
   * @private
   */
  async _calculateStopStats(where) {
    try {
      const total = await Stop.count({ where });
      
      const byType = await Stop.findAll({
        where,
        attributes: [
          'stopType',
          [Stop.sequelize.fn('COUNT', Stop.sequelize.col('id')), 'count'],
          [Stop.sequelize.fn('SUM', Stop.sequelize.col('duration')), 'totalDuration']
        ],
        group: ['stopType'],
        raw: true
      });

      const sums = await Stop.findOne({
        where,
        attributes: [
          [Stop.sequelize.fn('SUM', Stop.sequelize.col('duration')), 'totalDuration'],
          [Stop.sequelize.fn('AVG', Stop.sequelize.col('duration')), 'avgDuration']
        ],
        raw: true
      });

      return {
        total,
        byType: byType.reduce((acc, item) => {
          acc[item.stopType.toLowerCase()] = {
            count: parseInt(item.count),
            duration: parseInt(item.totalDuration || 0)
          };
          return acc;
        }, { parking: { count: 0, duration: 0 }, idle: { count: 0, duration: 0 }, traffic: { count: 0, duration: 0 } }),
        totalDuration: parseInt(sums?.totalDuration || 0),
        avgDuration: parseInt(sums?.avgDuration || 0)
      };
    } catch (error) {
      console.error('Error calculating stop stats:', error);
      return {
        total: 0,
        byType: { parking: { count: 0, duration: 0 }, idle: { count: 0, duration: 0 }, traffic: { count: 0, duration: 0 } },
        totalDuration: 0,
        avgDuration: 0
      };
    }
  }

  /**
   * Get MongoDB collection name based on device type
   * @private
   */
  _getCollectionForDevice(deviceType) {
    if (!deviceType) return 'gt06locations';
    const dt = deviceType.toUpperCase();
    if (dt === 'AIS140')                         return 'ais140locations';
    if (dt === 'FMB125' || dt.startsWith('FMB')) return 'fmb125locations';
    return 'gt06locations'; // GT06 and others default
  }

  /**
   * Get engine hours report (from trips and stops)
   */
  async getEngineHoursReport(filters) {
    const { vehicleIds, startDate, endDate } = filters;

    try {
      const where = {};
      if (vehicleIds && vehicleIds.length > 0) {
        where.vehicleId = { [Op.in]: vehicleIds };
      }
      if (startDate && endDate) {
        where.startTime = {
          [Op.between]: [new Date(startDate), new Date(endDate)]
        };
      }

      // Get trip durations (running hours)
      const tripStats = await Trip.findAll({
        where,
        attributes: [
          'vehicleId',
          [Trip.sequelize.fn('SUM', Trip.sequelize.col('duration')), 'runningTime']
        ],
        include: [{
          model: Vehicle,
          as: 'vehicle',
          attributes: ['id', 'vehicleNumber', 'imei']
        }],
        group: ['vehicleId', 'vehicle.id'],
        raw: true
      });

      // Get idle durations
      const idleStats = await Stop.findAll({
        where: { ...where, stopType: 'IDLE' },
        attributes: [
          'vehicleId',
          [Stop.sequelize.fn('SUM', Stop.sequelize.col('duration')), 'idleTime']
        ],
        group: ['vehicleId'],
        raw: true
      });

      const idleMap = {};
      idleStats.forEach(stat => {
        idleMap[stat.vehicleId] = parseInt(stat.idleTime || 0);
      });

      const engineHours = tripStats.map(stat => {
        const runningTime = parseInt(stat.runningTime || 0);
        const idleTime = idleMap[stat.vehicleId] || 0;
        const totalEngineTime = runningTime + idleTime;

        return {
          vehicleId: stat.vehicleId,
          vehicleNumber: stat['vehicle.vehicleNumber'],
          runningHours: parseFloat((runningTime / 3600).toFixed(2)),
          idleHours: parseFloat((idleTime / 3600).toFixed(2)),
          totalEngineHours: parseFloat((totalEngineTime / 3600).toFixed(2)),
          idlePercentage: totalEngineTime > 0 ? parseFloat(((idleTime / totalEngineTime) * 100).toFixed(2)) : 0
        };
      });

      return { engineHours };
    } catch (error) {
      console.error('Error getting engine hours report:', error);
      throw error;
    }
  }
}

module.exports = new ReportService();
