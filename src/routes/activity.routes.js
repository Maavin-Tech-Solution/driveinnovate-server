const express = require('express');
const router = express.Router();
const activityController = require('../controllers/activity.controller');
const validateConsumer = require('../middleware/validateConsumer');

// GET /api/activity - list user activity logs
router.get('/', validateConsumer, activityController.getActivities);

module.exports = router;
