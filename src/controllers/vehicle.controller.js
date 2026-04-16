const vehicleService = require('../services/vehicle.service');

/**
 * GET /api/vehicles
 * Optional ?clientId=X — admin/papa/dealer can view a child client's fleet.
 * X must be in req.user.clientIds (the user's full descendant tree).
 */
const getVehicles = async (req, res) => {
  try {
    let effectiveClientId = req.user.id;
    if (req.query.clientId) {
      const targetId = Number(req.query.clientId);
      if (!req.user.clientIds?.includes(targetId)) {
        return res.status(403).json({ success: false, message: 'You do not have access to this client.' });
      }
      effectiveClientId = targetId;
    }
    const vehicles = await vehicleService.getVehicles(effectiveClientId);
    return res.json({ success: true, data: vehicles });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/vehicles/:id
 */
const getVehicleById = async (req, res) => {
  try {
    const vehicle = await vehicleService.getVehicleById(req.params.id, req.user.id);
    return res.json({ success: true, data: vehicle });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/vehicles
 * Body: { vehicleNumber, chasisNumber, engineNumber, imei, ...
 *         forClientId? } — papa/dealer can assign to a child client
 */
const addVehicle = async (req, res) => {
  try {
    const {
      vehicleNumber, vehicleName, chasisNumber, engineNumber, imei,
      deviceName, deviceType, serverIp, serverPort, vehicleIcon,
      forClientId,
    } = req.body;

    if (!vehicleNumber && !chasisNumber && !engineNumber && !imei) {
      return res.status(400).json({ success: false, message: 'At least one of vehicleNumber, chasisNumber, engineNumber or imei is required' });
    }

    // If caller wants to assign the vehicle to a different client, verify access
    let effectiveClientId = req.user.id;
    if (forClientId) {
      const targetId = Number(forClientId);
      if (!req.user.clientIds?.includes(targetId)) {
        return res.status(403).json({ success: false, message: 'You do not have access to this client.' });
      }
      effectiveClientId = targetId;
    }

    const vehicle = await vehicleService.addVehicle(effectiveClientId, {
      vehicleNumber, vehicleName, chasisNumber, engineNumber, imei, deviceName, deviceType, serverIp, serverPort, vehicleIcon,
    });
    return res.status(201).json({ success: true, message: 'Vehicle registered successfully', data: vehicle });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/vehicles/:id
 * Body: { name, imei, deviceType, make, model, year, status,
 *         clientId? } — papa/dealer can reassign to a child client
 */
const updateVehicle = async (req, res) => {
  try {
    // If caller wants to reassign to a different client, verify access
    if (req.body.clientId) {
      const targetId = Number(req.body.clientId);
      if (!req.user.clientIds?.includes(targetId)) {
        return res.status(403).json({ success: false, message: 'You do not have access to this client.' });
      }
    }
    const vehicle = await vehicleService.updateVehicle(req.params.id, req.user.id, req.body, req.user.clientIds);
    return res.json({ success: true, message: 'Vehicle updated successfully', data: vehicle });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/vehicles/:id
 */
const deleteVehicle = async (req, res) => {
  try {
    const result = await vehicleService.deleteVehicle(req.params.id, req.user.id);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/vehicles/:id/sync
 * Fetch vehicle data from MySQL + GPS data from MongoDB
 */
const syncVehicleData = async (req, res) => {
  try {
    const data = await vehicleService.syncVehicleData(req.params.id, req.user.clientIds);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/vehicles/test-gps/:imei
 * Test GPS data availability for an IMEI
 */
const testGpsData = async (req, res) => {
  try {
    const result = await vehicleService.testGpsData(req.params.imei);
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/vehicles/:id/location-player
 * Get location history for a vehicle within a date range for playback
 * Query params:
 *   - from: Start date (ISO 8601 format, required)
 *   - to: End date (ISO 8601 format, required)
 *   - limit: Max records to return (optional, default: 10000, max: 50000)
 *   - skip: Records to skip for pagination (optional, default: 0)
 */
const getLocationPlayerData = async (req, res) => {
  try {
    const { from, to, limit, skip } = req.query;
    if (!from || !to) {
      return res.status(400).json({ 
        success: false, 
        message: 'Both from and to date parameters are required' 
      });
    }
    
    const data = await vehicleService.getLocationPlayerData(
      req.params.id, 
      req.user.id, 
      from, 
      to,
      limit,
      skip
    );
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/vehicles/live-positions
 * Lightweight: returns current lat/lng/speed/engineOn for all user vehicles
 * from VehicleDeviceState (MySQL only — no MongoDB). Used for map auto-refresh.
 */
const getLivePositions = async (req, res) => {
  try {
    let effectiveClientId = req.user.id;
    if (req.query.clientId) {
      const targetId = Number(req.query.clientId);
      if (!req.user.clientIds?.includes(targetId)) {
        return res.status(403).json({ success: false, message: 'You do not have access to this client.' });
      }
      effectiveClientId = targetId;
    }
    const data = await vehicleService.getLivePositions(effectiveClientId, req.query.since);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

module.exports = { getVehicles, getVehicleById, addVehicle, updateVehicle, deleteVehicle, syncVehicleData, testGpsData, getLocationPlayerData, getLivePositions };
