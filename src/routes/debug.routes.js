const express = require('express');
const router = express.Router();
const { getDataPackets, getVehicleStatus } = require('../controllers/debug.controller');

router.get('/data-packets', getDataPackets);
router.get('/vehicle-status', getVehicleStatus);

module.exports = router;
