const express = require('express');
const router = express.Router();
const shareController = require('../controllers/share.controller');
const validateConsumer = require('../middleware/validateConsumer');

// POST /api/share — authenticated: create a share token for a trip
router.post('/', validateConsumer, shareController.createShare);

// GET /api/share/:token — PUBLIC: no auth, returns location data for the token
router.get('/:token', shareController.getShareData);

module.exports = router;
