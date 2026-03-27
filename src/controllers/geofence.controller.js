const geofenceService = require('../services/geofence.service');

const getGeofences = async (req, res) => {
  try {
    const data = await geofenceService.getGeofences(req.user.id);
    return res.json({ success: true, data });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const getGeofenceById = async (req, res) => {
  try {
    const data = await geofenceService.getGeofenceById(req.params.id, req.user.id);
    return res.json({ success: true, data });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const createGeofence = async (req, res) => {
  try {
    const data = await geofenceService.createGeofence(req.user.id, req.body);
    return res.status(201).json({ success: true, message: 'Geofence created successfully', data });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const updateGeofence = async (req, res) => {
  try {
    const data = await geofenceService.updateGeofence(req.params.id, req.user.id, req.body);
    return res.json({ success: true, message: 'Geofence updated successfully', data });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const deleteGeofence = async (req, res) => {
  try {
    const result = await geofenceService.deleteGeofence(req.params.id, req.user.id);
    return res.json({ success: true, ...result });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const toggleGeofence = async (req, res) => {
  try {
    const data = await geofenceService.toggleGeofence(req.params.id, req.user.id);
    return res.json({ success: true, message: `Geofence ${data.isActive ? 'enabled' : 'disabled'}`, data });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const addAssignment = async (req, res) => {
  try {
    const data = await geofenceService.addAssignment(req.params.id, req.user.id, req.body);
    return res.status(201).json({ success: true, message: 'Assignment added successfully', data });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const removeAssignment = async (req, res) => {
  try {
    const result = await geofenceService.removeAssignment(req.params.id, req.params.assignmentId, req.user.id);
    return res.json({ success: true, ...result });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const getVehicleGeofences = async (req, res) => {
  try {
    const data = await geofenceService.getVehicleGeofences(req.params.vehicleId, req.user.id);
    return res.json({ success: true, data });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

module.exports = {
  getGeofences,
  getGeofenceById,
  createGeofence,
  updateGeofence,
  deleteGeofence,
  toggleGeofence,
  addAssignment,
  removeAssignment,
  getVehicleGeofences,
};
