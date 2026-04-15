const express = require('express');
const router = express.Router();
const validateConsumer = require('../middleware/validateConsumer');
const ctrl = require('../controllers/master.controller');

// Write operations (create / update / delete) require papa role
const requirePapa = (req, res, next) => {
  if (req.user?.role !== 'papa' && Number(req.user?.parentId) !== 0) {
    return res.status(403).json({ success: false, message: 'Master settings require papa role' });
  }
  next();
};

// Device Configs — read is open to all authenticated users so MyFleet can
// load state definitions for any role (client, dealer, papa).
// Write operations remain papa-only.
router.get('/device-configs',          validateConsumer, ctrl.listDeviceConfigs);
router.post('/device-configs',         validateConsumer, requirePapa, ctrl.createDeviceConfig);
router.put('/device-configs/:id',      validateConsumer, requirePapa, ctrl.updateDeviceConfig);
router.delete('/device-configs/:id',   validateConsumer, requirePapa, ctrl.deleteDeviceConfig);

// State Definitions (scoped to a device)
router.get('/device-configs/:deviceId/states',    validateConsumer, ctrl.listStates);
router.post('/device-configs/:deviceId/states',   validateConsumer, requirePapa, ctrl.createState);
router.put('/states/:stateId',                    validateConsumer, requirePapa, ctrl.updateState);
router.delete('/states/:stateId',                 validateConsumer, requirePapa, ctrl.deleteState);
router.post('/device-configs/:id/reset-states',   validateConsumer, requirePapa, ctrl.reseedStates);

// System Settings — read is open to all authenticated users; write is papa-only
router.get('/settings',  validateConsumer,            ctrl.getSettings);
router.put('/settings',  validateConsumer, requirePapa, ctrl.updateSettings);

module.exports = router;
