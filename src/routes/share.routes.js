const express = require('express');
const router = express.Router();
const shareController = require('../controllers/share.controller');
const validateConsumer = require('../middleware/validateConsumer');

// POST /api/share — authenticated: create a share token for a trip
router.post('/', validateConsumer, shareController.createShare);

// POST /api/share/live — authenticated: create a live-tracking share token
router.post('/live', validateConsumer, shareController.createLiveShare);

// GET /api/share/live/:token — PUBLIC: live positions for a live-share token
router.get('/live/:token', shareController.getLiveShareData);

// GET /api/share/:token — PUBLIC: no auth, returns location data for the token
router.get('/:token', shareController.getShareData);

module.exports = router;
