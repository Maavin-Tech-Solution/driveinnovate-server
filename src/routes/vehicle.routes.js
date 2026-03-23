const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicle.controller');
const sensorController = require('../controllers/sensor.controller');
const vehicleReportController = require('../controllers/vehicleReport.controller');
const validateConsumer = require('../middleware/validateConsumer');

// GET /api/vehicles - list all vehicles for user
router.get('/', validateConsumer, vehicleController.getVehicles);

// GET /api/vehicles/:id - get vehicle by id
router.get('/:id', validateConsumer, vehicleController.getVehicleById);

// POST /api/vehicles - add new vehicle
router.post('/', validateConsumer, vehicleController.addVehicle);

// PUT /api/vehicles/:id - update vehicle
router.put('/:id', validateConsumer, vehicleController.updateVehicle);

// DELETE /api/vehicles/:id - delete vehicle
router.delete('/:id', validateConsumer, vehicleController.deleteVehicle);

// GET /api/vehicles/test-gps/:imei - test GPS data availability for an IMEI (no auth required for testing)
router.get('/test-gps/:imei', vehicleController.testGpsData);

// GET /api/vehicles/:id/sync - sync vehicle data from server (MySQL + MongoDB GPS)
router.get('/:id/sync', validateConsumer, vehicleController.syncVehicleData);

// GET /api/vehicles/:id/location-player - get location history for playback
router.get('/:id/location-player', validateConsumer, vehicleController.getLocationPlayerData);

// Sensor CRUD
router.get('/:id/sensors', validateConsumer, sensorController.getSensors);
router.post('/:id/sensors', validateConsumer, sensorController.createSensor);
router.put('/:id/sensors/:sensorId', validateConsumer, sensorController.updateSensor);
router.delete('/:id/sensors/:sensorId', validateConsumer, sensorController.deleteSensor);

// Vehicle Reports (SQL-backed, real-time data)
router.get('/:id/reports/summary',       validateConsumer, vehicleReportController.getSummary);
router.get('/:id/reports/daily',         validateConsumer, vehicleReportController.getDailyStats);
router.get('/:id/reports/engine-hours',  validateConsumer, vehicleReportController.getEngineHours);
router.get('/:id/reports/trips',         validateConsumer, vehicleReportController.getTrips);
router.get('/:id/reports/fuel-fillings', validateConsumer, vehicleReportController.getFuelFillings);
router.get('/:id/reports/export',        validateConsumer, vehicleReportController.exportReport);
router.get('/:id/reports/export-xlsx',   validateConsumer, vehicleReportController.exportExcel);
router.post('/:id/reports/reprocess',    validateConsumer, vehicleReportController.reprocess);

module.exports = router;
