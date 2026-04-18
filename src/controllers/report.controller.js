const reportService = require('../services/report.service');
const { Op } = require('sequelize');
const { Vehicle, UserSettings } = require('../models');

/**
 * Resolve the set of vehicle IDs the caller may query.
 * – If the caller passes vehicleIds, each one is verified against req.user.clientIds.
 * – Otherwise we return all vehicles across the caller's network.
 */
async function scopeVehicleIds(req, rawVehicleIds) {
  const clientIds = req.user.clientIds || [req.user.id];
  let requested = [];
  if (rawVehicleIds) {
    requested = Array.isArray(rawVehicleIds) ? rawVehicleIds : [rawVehicleIds];
    requested = requested.map(Number).filter(Number.isFinite);
  }
  const where = { clientId: { [Op.in]: clientIds } };
  if (requested.length) where.id = { [Op.in]: requested };
  const rows = await Vehicle.findAll({ where, attributes: ['id'] });
  return rows.map(r => r.id);
}

async function getSpeedLimitForUser(userId) {
  try {
    const row = await UserSettings.findOne({ where: { userId } });
    return row?.speedThreshold || 80;
  } catch (_) { return 80; }
}

/**
 * Analyze and detect speed violations from location data
 */
exports.analyzeSpeedViolations = async (req, res) => {
  try {
    const { vehicleIds, startDate, endDate, speedLimit, minDuration, autoSave } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }

    // Always restrict vehicles to caller's scope
    const scopedIds = await scopeVehicleIds(req, vehicleIds);

    // Analyze violations
    const violations = await reportService.analyzeSpeedViolations({
      vehicleIds: scopedIds,
      startDate,
      endDate,
      speedLimit: speedLimit || await getSpeedLimitForUser(req.user.id),
      minDuration: minDuration || 3
    });

    // Optionally save to database
    let saved = [];
    if (autoSave && violations.length > 0) {
      saved = await reportService.saveSpeedViolations(violations);
    }

    res.json({
      success: true,
      data: {
        violations,
        count: violations.length,
        saved: saved.length
      }
    });
  } catch (error) {
    console.error('Error in analyzeSpeedViolations:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze speed violations',
      error: error.message
    });
  }
};

/**
 * Get speed violation report.
 * – Always scopes to the caller's vehicles (clientIds).
 * – Auto-runs analyze+save if no saved records exist for the date range,
 *   so users see up-to-date violations without a manual "detect" step.
 */
exports.getSpeedViolationReport = async (req, res) => {
  try {
    const {
      vehicleIds,
      startDate,
      endDate,
      severity,
      acknowledged,
      limit,
      offset
    } = req.query;

    const scopedIds = await scopeVehicleIds(req, vehicleIds);

    // No accessible vehicles → return empty result instead of leaking other users' data
    if (!scopedIds.length) {
      return res.json({
        success: true,
        data: { violations: [], total: 0, stats: { total: 0, acknowledged: 0, unacknowledged: 0, bySeverity: { low: 0, medium: 0, high: 0, critical: 0 }, avgExcessSpeed: 0, maxSpeed: 0 } }
      });
    }

    const filters = {
      vehicleIds: scopedIds,
      startDate,
      endDate,
      severity: severity && severity !== '' ? severity : undefined,
      acknowledged: acknowledged === 'true' ? true : acknowledged === 'false' ? false : undefined,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0
    };

    let report = await reportService.getSpeedViolationReport(filters);

    // If the caller has vehicles but nothing has been saved yet for this range,
    // analyze MongoDB packets now and persist — then re-query so the UI gets data
    // on the first open of the tab. Skip only when an *active* severity/ack
    // filter is set (empty strings, which axios sends for untouched dropdowns,
    // count as no filter).
    const hasSeverity = severity && severity !== '';
    const hasAckFilter = acknowledged !== undefined && acknowledged !== '';
    const shouldAutoDetect =
      (!report.violations || report.violations.length === 0) &&
      scopedIds.length > 0 &&
      startDate && endDate &&
      !hasSeverity && !hasAckFilter;

    if (shouldAutoDetect) {
      const speedLimit = await getSpeedLimitForUser(req.user.id);
      const detected = await reportService.analyzeSpeedViolations({
        vehicleIds: scopedIds,
        startDate,
        endDate,
        speedLimit,
        minDuration: 1, // match dashboard counting — any sustained overspeed >=1s
      });
      if (detected.length) {
        await reportService.saveSpeedViolations(detected);
        report = await reportService.getSpeedViolationReport(filters);
      }
    }

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('Error in getSpeedViolationReport:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get speed violation report',
      error: error.message
    });
  }
};

/**
 * Acknowledge a speed violation
 */
exports.acknowledgeViolation = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const userId = req.user.id;

    const violation = await reportService.acknowledgeViolation(
      parseInt(id),
      userId,
      notes
    );

    res.json({
      success: true,
      message: 'Violation acknowledged successfully',
      data: violation
    });
  } catch (error) {
    console.error('Error in acknowledgeViolation:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to acknowledge violation',
      error: error.message
    });
  }
};

/**
 * Get vehicle violation summary
 */
exports.getVehicleViolationSummary = async (req, res) => {
  try {
    const { startDate, endDate, vehicleIds } = req.query;
    const scopedIds = await scopeVehicleIds(req, vehicleIds);
    if (!scopedIds.length) return res.json({ success: true, data: [] });

    const summary = await reportService.getVehicleViolationSummary({
      startDate,
      endDate,
      vehicleIds: scopedIds,
    });

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    console.error('Error in getVehicleViolationSummary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get vehicle violation summary',
      error: error.message
    });
  }
};

/**
 * Export speed violation report (CSV)
 */
exports.exportSpeedViolationReport = async (req, res) => {
  try {
    const {
      vehicleIds,
      startDate,
      endDate,
      severity,
      acknowledged
    } = req.query;

    const scopedIds = await scopeVehicleIds(req, vehicleIds);

    const filters = {
      vehicleIds: scopedIds,
      startDate,
      endDate,
      severity: severity && severity !== '' ? severity : undefined,
      acknowledged: acknowledged === 'true' ? true : acknowledged === 'false' ? false : undefined,
      limit: 10000, // Higher limit for export
      offset: 0
    };

    const report = await reportService.getSpeedViolationReport(filters);

    // Convert to CSV
    const csvHeader = 'Date & Time,Vehicle Number,IMEI,Speed (km/h),Speed Limit (km/h),Excess Speed (km/h),Duration (sec),Latitude,Longitude,Severity,Acknowledged,Notes\n';
    
    const csvRows = report.violations.map(v => {
      return [
        new Date(v.timestamp).toISOString(),
        v.vehicle?.vehicleNumber || 'N/A',
        v.imei,
        v.speed,
        v.speedLimit,
        v.excessSpeed,
        v.duration || 0,
        v.latitude,
        v.longitude,
        v.severity,
        v.acknowledged ? 'Yes' : 'No',
        `"${(v.notes || '').replace(/"/g, '""')}"`
      ].join(',');
    }).join('\n');

    const csv = csvHeader + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=speed_violations_${Date.now()}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Error in exportSpeedViolationReport:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export speed violation report',
      error: error.message
    });
  }
};

/**
 * Analyze and detect trips
 */
exports.analyzeTrips = async (req, res) => {
  try {
    const { vehicleIds, startDate, endDate, minTripDuration, minDistance, autoSave } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }

    const scopedIds = await scopeVehicleIds(req, vehicleIds);

    const trips = await reportService.analyzeTrips({
      vehicleIds: scopedIds,
      startDate,
      endDate,
      minTripDuration,
      minDistance,
    });

    let saved = [];
    if (autoSave && trips.length > 0) {
      saved = await reportService.saveTrips(trips);
    }

    res.json({
      success: true,
      data: {
        trips,
        count: trips.length,
        saved: saved.length
      }
    });
  } catch (error) {
    console.error('Error in analyzeTrips:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze trips',
      error: error.message
    });
  }
};

/**
 * Get trip report
 */
exports.getTripReport = async (req, res) => {
  try {
    const { vehicleIds, startDate, endDate, limit, offset } = req.query;
    const scopedIds = await scopeVehicleIds(req, vehicleIds);
    if (!scopedIds.length) return res.json({ success: true, data: { trips: [], total: 0, stats: {} } });

    const filters = {
      vehicleIds: scopedIds,
      startDate,
      endDate,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0
    };

    const report = await reportService.getTripReport(filters);

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('Error in getTripReport:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get trip report',
      error: error.message
    });
  }
};

/**
 * Analyze and detect stops
 */
exports.analyzeStops = async (req, res) => {
  try {
    const { vehicleIds, startDate, endDate, minStopDuration, autoSave } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Start date and end date are required'
      });
    }

    const scopedIds = await scopeVehicleIds(req, vehicleIds);

    const stops = await reportService.analyzeStops({
      vehicleIds: scopedIds,
      startDate,
      endDate,
      minStopDuration
    });

    let saved = [];
    if (autoSave && stops.length > 0) {
      saved = await reportService.saveStops(stops);
    }

    res.json({
      success: true,
      data: {
        stops,
        count: stops.length,
        saved: saved.length
      }
    });
  } catch (error) {
    console.error('Error in analyzeStops:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to analyze stops',
      error: error.message
    });
  }
};

/**
 * Get stop report
 */
exports.getStopReport = async (req, res) => {
  try {
    const { vehicleIds, startDate, endDate, stopType, limit, offset } = req.query;
    const scopedIds = await scopeVehicleIds(req, vehicleIds);
    if (!scopedIds.length) return res.json({ success: true, data: { stops: [], total: 0, stats: {} } });

    const filters = {
      vehicleIds: scopedIds,
      startDate,
      endDate,
      stopType,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0
    };

    const report = await reportService.getStopReport(filters);

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('Error in getStopReport:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get stop report',
      error: error.message
    });
  }
};

/**
 * Get engine hours report
 */
exports.getEngineHoursReport = async (req, res) => {
  try {
    const { vehicleIds, startDate, endDate } = req.query;
    const scopedIds = await scopeVehicleIds(req, vehicleIds);
    if (!scopedIds.length) return res.json({ success: true, data: [] });

    const filters = {
      vehicleIds: scopedIds,
      startDate,
      endDate
    };

    const report = await reportService.getEngineHoursReport(filters);

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    console.error('Error in getEngineHoursReport:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get engine hours report',
      error: error.message
    });
  }
};

/**
 * Export trip report to CSV
 */
exports.exportTripReport = async (req, res) => {
  try {
    const { vehicleIds, startDate, endDate } = req.query;
    const scopedIds = await scopeVehicleIds(req, vehicleIds);

    const filters = {
      vehicleIds: scopedIds,
      startDate,
      endDate,
      limit: 10000,
      offset: 0
    };

    const report = await reportService.getTripReport(filters);

    const csvHeader = 'Start Time,End Time,Vehicle Number,IMEI,Duration (min),Distance (km),Start Location,End Location,Avg Speed (km/h),Max Speed (km/h)\n';
    
    const csvRows = report.trips.map(t => {
      return [
        new Date(t.startTime).toISOString(),
        new Date(t.endTime).toISOString(),
        t.vehicle?.vehicleNumber || 'N/A',
        t.imei,
        Math.floor(t.duration / 60),
        t.distance,
        `${t.startLatitude.toFixed(6)},${t.startLongitude.toFixed(6)}`,
        `${t.endLatitude.toFixed(6)},${t.endLongitude.toFixed(6)}`,
        t.avgSpeed,
        t.maxSpeed
      ].join(',');
    }).join('\n');

    const csv = csvHeader + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=trip_report_${Date.now()}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Error in exportTripReport:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export trip report',
      error: error.message
    });
  }
};

/**
 * Export stop report to CSV
 */
exports.exportStopReport = async (req, res) => {
  try {
    const { vehicleIds, startDate, endDate, stopType } = req.query;
    const scopedIds = await scopeVehicleIds(req, vehicleIds);

    const filters = {
      vehicleIds: scopedIds,
      startDate,
      endDate,
      stopType,
      limit: 10000,
      offset: 0
    };

    const report = await reportService.getStopReport(filters);

    const csvHeader = 'Start Time,End Time,Vehicle Number,IMEI,Duration (min),Location,Stop Type,Engine Status\n';
    
    const csvRows = report.stops.map(s => {
      return [
        new Date(s.startTime).toISOString(),
        s.endTime ? new Date(s.endTime).toISOString() : 'Ongoing',
        s.vehicle?.vehicleNumber || 'N/A',
        s.imei,
        Math.floor(s.duration / 60),
        `${s.latitude.toFixed(6)},${s.longitude.toFixed(6)}`,
        s.stopType,
        s.engineStatus ? 'ON' : 'OFF'
      ].join(',');
    }).join('\n');

    const csv = csvHeader + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=stop_report_${Date.now()}.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Error in exportStopReport:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to export stop report',
      error: error.message
    });
  }
};
