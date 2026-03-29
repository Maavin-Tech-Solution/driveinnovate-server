const express = require('express');
const router = express.Router();
const validateConsumer = require('../middleware/validateConsumer');
const ctrl = require('../controllers/master.controller');

// All master routes require authentication + papa role
const requirePapa = (req, res, next) => {
  if (req.user?.role !== 'papa' && Number(req.user?.parentId) !== 0) {
    return res.status(403).json({ success: false, message: 'Master settings require papa role' });
  }
  next();
};

router.use(validateConsumer, requirePapa);

// Device Configs
router.get('/device-configs',          ctrl.listDeviceConfigs);
router.post('/device-configs',         ctrl.createDeviceConfig);
router.put('/device-configs/:id',      ctrl.updateDeviceConfig);
router.delete('/device-configs/:id',   ctrl.deleteDeviceConfig);

// State Definitions (scoped to a device)
router.get('/device-configs/:deviceId/states',    ctrl.listStates);
router.post('/device-configs/:deviceId/states',   ctrl.createState);
router.put('/states/:stateId',                    ctrl.updateState);
router.delete('/states/:stateId',                 ctrl.deleteState);

module.exports = router;
