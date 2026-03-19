const express = require('express');
const router = express.Router();
const { getDataPackets } = require('../controllers/debug.controller');

// GET /api/debug/data-packets
router.get('/data-packets', getDataPackets);

module.exports = router;
