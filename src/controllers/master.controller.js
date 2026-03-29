const svc = require('../services/master.service');

// ─── Device Configs ───────────────────────────────────────────────────────────

const listDeviceConfigs = async (req, res) => {
  try {
    const data = await svc.listDeviceConfigs();
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

const createDeviceConfig = async (req, res) => {
  try {
    const { name, type, serverIp, serverPort, mongoCollection } = req.body;
    if (!name || !type || !mongoCollection) {
      return res.status(400).json({ success: false, message: 'name, type and mongoCollection are required' });
    }
    const data = await svc.createDeviceConfig({ name, type, serverIp, serverPort, mongoCollection });
    return res.status(201).json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

const updateDeviceConfig = async (req, res) => {
  try {
    const data = await svc.updateDeviceConfig(req.params.id, req.body);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

const deleteDeviceConfig = async (req, res) => {
  try {
    const data = await svc.deleteDeviceConfig(req.params.id);
    return res.json({ success: true, ...data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

// ─── State Definitions ────────────────────────────────────────────────────────

const listStates = async (req, res) => {
  try {
    const data = await svc.listStates(req.params.deviceId);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

const createState = async (req, res) => {
  try {
    const { stateName, stateColor, stateIcon, priority, conditionLogic, conditions, isDefault } = req.body;
    if (!stateName) {
      return res.status(400).json({ success: false, message: 'stateName is required' });
    }
    const data = await svc.createState(req.params.deviceId, {
      stateName, stateColor, stateIcon, priority, conditionLogic, conditions, isDefault,
    });
    return res.status(201).json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

const updateState = async (req, res) => {
  try {
    const data = await svc.updateState(req.params.stateId, req.body);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

const deleteState = async (req, res) => {
  try {
    const data = await svc.deleteState(req.params.stateId);
    return res.json({ success: true, ...data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

const reseedStates = async (req, res) => {
  try {
    const data = await svc.reseedBuiltInStates(req.params.id);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

module.exports = {
  listDeviceConfigs,
  createDeviceConfig,
  updateDeviceConfig,
  deleteDeviceConfig,
  listStates,
  createState,
  updateState,
  deleteState,
  reseedStates,
};
