const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboard.controller');
const validateConsumer = require('../middleware/validateConsumer');

// GET /api/dashboard/stats - get dashboard statistics
router.get('/stats', validateConsumer, dashboardController.getStats);

// GET /api/dashboard/user-stats - get user vehicle status-wise stats
router.get('/user-stats', validateConsumer, dashboardController.getUserStats);

// GET /api/dashboard/overspeed-vehicles - get vehicles that exceeded speed threshold in last 24 hours
router.get('/overspeed-vehicles', validateConsumer, dashboardController.getOverspeedVehicles);

module.exports = router;
