const alertService = require('../services/alert.service');

const getAlerts = async (req, res) => {
  try {
    const alerts = await alertService.getAlerts(req.user.id);
    return res.json({ success: true, data: alerts });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const createAlert = async (req, res) => {
  try {
    const alert = await alertService.createAlert(req.user.id, req.body);
    return res.status(201).json({ success: true, message: 'Alert created successfully', data: alert });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const updateAlert = async (req, res) => {
  try {
    const alert = await alertService.updateAlert(req.params.id, req.user.id, req.body);
    return res.json({ success: true, message: 'Alert updated successfully', data: alert });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const toggleAlert = async (req, res) => {
  try {
    const alert = await alertService.toggleAlert(req.params.id, req.user.id);
    return res.json({ success: true, message: `Alert ${alert.isActive ? 'enabled' : 'disabled'}`, data: alert });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const deleteAlert = async (req, res) => {
  try {
    const result = await alertService.deleteAlert(req.params.id, req.user.id);
    return res.json({ success: true, ...result });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

module.exports = { getAlerts, createAlert, updateAlert, toggleAlert, deleteAlert };
