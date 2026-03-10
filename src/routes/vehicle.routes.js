const express = require('express');
const router = express.Router();
const vehicleController = require('../controllers/vehicle.controller');
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

module.exports = router;
