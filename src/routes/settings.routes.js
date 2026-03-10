const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settings.controller');
const validateConsumer = require('../middleware/validateConsumer');

// GET /api/settings - get current user's settings
router.get('/', validateConsumer, settingsController.getSettings);

// PUT /api/settings - update current user's settings
router.put('/', validateConsumer, settingsController.updateSettings);

// POST /api/settings/reset - reset to default settings
router.post('/reset', validateConsumer, settingsController.resetSettings);

module.exports = router;
