const express = require('express');
const router = express.Router();
const geofenceController = require('../controllers/geofence.controller');
const validateConsumer = require('../middleware/validateConsumer');

// Geofence CRUD
router.get('/',                   validateConsumer, geofenceController.getGeofences);
router.post('/',                  validateConsumer, geofenceController.createGeofence);
router.get('/:id',                validateConsumer, geofenceController.getGeofenceById);
router.put('/:id',                validateConsumer, geofenceController.updateGeofence);
router.delete('/:id',             validateConsumer, geofenceController.deleteGeofence);
router.patch('/:id/toggle',       validateConsumer, geofenceController.toggleGeofence);

// Assignments
router.post('/:id/assignments',                            validateConsumer, geofenceController.addAssignment);
router.delete('/:id/assignments/:assignmentId',            validateConsumer, geofenceController.removeAssignment);

// Vehicle-centric — all geofences that apply to a given vehicle
router.get('/vehicle/:vehicleId', validateConsumer, geofenceController.getVehicleGeofences);

module.exports = router;
