const express = require('express');
const router = express.Router();
const alertController = require('../controllers/alert.controller');
const validateConsumer = require('../middleware/validateConsumer');

router.get('/',         validateConsumer, alertController.getAlerts);
router.post('/',        validateConsumer, alertController.createAlert);
router.put('/:id',      validateConsumer, alertController.updateAlert);
router.patch('/:id/toggle', validateConsumer, alertController.toggleAlert);
router.delete('/:id',   validateConsumer, alertController.deleteAlert);

module.exports = router;
