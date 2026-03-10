const express = require('express');
const router = express.Router();
const rtoController = require('../controllers/rto.controller');
const validateConsumer = require('../middleware/validateConsumer');

// GET /api/rto - list all rto details for user's vehicles
router.get('/', validateConsumer, rtoController.getRtoDetails);

// GET /api/rto/:vehicleId - get rto details by vehicle
router.get('/:vehicleId', validateConsumer, rtoController.getRtoByVehicle);

// POST /api/rto - create rto detail
router.post('/', validateConsumer, rtoController.createRtoDetail);

// PUT /api/rto/:vehicleId - update rto detail
router.put('/:vehicleId', validateConsumer, rtoController.updateRtoDetail);

module.exports = router;
