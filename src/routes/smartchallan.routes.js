const express = require('express');
const router  = express.Router();
const validateConsumer = require('../middleware/validateConsumer');
const ctrl = require('../controllers/smartchallan.controller');

// Connectivity ping (no auth needed — just checks if SC server is reachable)
router.get('/ping', ctrl.ping);

// Settings
router.get ('/settings',      validateConsumer, ctrl.getSettings);
router.put ('/settings',      validateConsumer, ctrl.saveSettings);
router.post('/settings/test', validateConsumer, ctrl.testCredentials);

// Data proxies
router.get('/rto',     validateConsumer, ctrl.getRtoData);
router.get('/challan', validateConsumer, ctrl.getChallanData);

module.exports = router;
