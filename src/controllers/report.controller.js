const reportService = require('../services/report.service');

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

    // Analyze violations
    const violations = await reportService.analyzeSpeedViolations({
      vehicleIds,
      startDate,
      endDate,
      speedLimit: speedLimit || 80,
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
 * Get speed violation report
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

    const filters = {
      vehicleIds: vehicleIds ? (Array.isArray(vehicleIds) ? vehicleIds : [vehicleIds]) : undefined,
      startDate,
      endDate,
      severity,
      acknowledged: acknowledged !== undefined ? acknowledged === 'true' : undefined,
      limit: limit ? parseInt(limit) : 100,
      offset: offset ? parseInt(offset) : 0
    };

    const report = await reportService.getSpeedViolationReport(filters);

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
    const { startDate, endDate } = req.query;

    const summary = await reportService.getVehicleViolationSummary({
      startDate,
      endDate
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

    const filters = {
      vehicleIds: vehicleIds ? (Array.isArray(vehicleIds) ? vehicleIds : [vehicleIds]) : undefined,
      startDate,
      endDate,
      severity,
      acknowledged: acknowledged !== undefined ? acknowledged === 'true' : undefined,
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

    const trips = await reportService.analyzeTrips({
      vehicleIds,
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

    const filters = {
      vehicleIds: vehicleIds ? (Array.isArray(vehicleIds) ? vehicleIds : [vehicleIds]) : undefined,
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

    const stops = await reportService.analyzeStops({
      vehicleIds,
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

    const filters = {
      vehicleIds: vehicleIds ? (Array.isArray(vehicleIds) ? vehicleIds : [vehicleIds]) : undefined,
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

    const filters = {
      vehicleIds: vehicleIds ? (Array.isArray(vehicleIds) ? vehicleIds : [vehicleIds]) : undefined,
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

    const filters = {
      vehicleIds: vehicleIds ? (Array.isArray(vehicleIds) ? vehicleIds : [vehicleIds]) : undefined,
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

    const filters = {
      vehicleIds: vehicleIds ? (Array.isArray(vehicleIds) ? vehicleIds : [vehicleIds]) : undefined,
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
