const express = require('express');
const router = express.Router();
const reportController = require('../controllers/report.controller');
const validateConsumer = require('../middleware/validateConsumer');

// Speed Violation Routes
router.post('/speed-violations/analyze', validateConsumer, reportController.analyzeSpeedViolations);
router.get('/speed-violations', validateConsumer, reportController.getSpeedViolationReport);
router.get('/speed-violations/summary', validateConsumer, reportController.getVehicleViolationSummary);
router.get('/speed-violations/export', validateConsumer, reportController.exportSpeedViolationReport);
router.put('/speed-violations/:id/acknowledge', validateConsumer, reportController.acknowledgeViolation);

// Trip Routes
router.post('/trips/analyze', validateConsumer, reportController.analyzeTrips);
router.get('/trips', validateConsumer, reportController.getTripReport);
router.get('/trips/export', validateConsumer, reportController.exportTripReport);

// Stop Routes
router.post('/stops/analyze', validateConsumer, reportController.analyzeStops);
router.get('/stops', validateConsumer, reportController.getStopReport);
router.get('/stops/export', validateConsumer, reportController.exportStopReport);

// Engine Hours Routes
router.get('/engine-hours', validateConsumer, reportController.getEngineHoursReport);

module.exports = router;
