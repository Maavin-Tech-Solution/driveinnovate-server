const express = require('express');
const router = express.Router();
const { getDataPackets, getVehicleStatus, getSessions } = require('../controllers/debug.controller');

router.get('/data-packets', getDataPackets);
router.get('/vehicle-status', getVehicleStatus);
router.get('/sessions', getSessions);

module.exports = router;
