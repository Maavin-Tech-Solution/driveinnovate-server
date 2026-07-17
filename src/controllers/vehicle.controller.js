const vehicleService = require('../services/vehicle.service');
const { buildVehicleScope } = require('../utils/vehicleScope');
const { getSystemSettings } = require('../services/master.service');
const { getUserSettings } = require('../services/settings.service');
const { isPointInsideGeofence } = require('../services/geofence.service');
const { User, Vehicle, Geofence } = require('../models');
const { Op } = require('sequelize');

/**
 * GET /api/vehicles
 * Optional ?clientId=X — drilldown into a single child client's fleet.
 *   X must be in req.user.clientIds (the user's full descendant tree).
 * Otherwise returns vehicles for the user's whole network
 *   (req.user.clientIds = [self, ...descendants] for papa/dealer; just [self]
 *   for solo users — so behaviour is unchanged for non-network accounts).
 */
const getVehicles = async (req, res) => {
  try {
    const scope = buildVehicleScope(req.user, req.query.clientId);
    const vehicles = await vehicleService.getVehicles(scope);
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
    const vehicle = await vehicleService.getVehicleById(req.params.id, req.user.clientIds);
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
      vehicleNumber, vehicleName, chasisNumber, engineNumber, imei, sim1, sim2, branch,
      deviceName, deviceType, serverIp, serverPort, vehicleIcon,
      fuelSupported, fuelTankCapacity,
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

    const settings = await getSystemSettings();
    const owner = await User.findByPk(effectiveClientId, { attributes: ['billingType', 'accountType'] });

    // Trial accounts are capped at trialVehicleLimit vehicles.
    if (owner?.accountType === 'trial') {
      const limit = Number(settings.trialVehicleLimit) || 10;
      const count = await Vehicle.count({ where: { clientId: effectiveClientId, status: { [Op.ne]: 'deleted' } } });
      if (count >= limit) {
        return res.status(403).json({ success: false, message: `Trial accounts are limited to ${limit} vehicles. Upgrade to billable to add more.` });
      }
    }

    // A vehicle add spends 1 token ONLY when the module is on network-wide AND the
    // owning client is billable + prepaid (trial = free testing). Server-enforced.
    let consumeToken = false;
    if (settings.billingEnabled) {
      consumeToken = owner?.billingType === 'prepaid' && owner?.accountType === 'billable';
    }
    const vehicle = await vehicleService.addVehicle(
      effectiveClientId,
      {
        vehicleNumber, vehicleName, chasisNumber, engineNumber, imei, sim1, sim2, branch,
        deviceName, deviceType, serverIp, serverPort, vehicleIcon,
        fuelSupported, fuelTankCapacity,
      },
      consumeToken ? { actor: req.user, consumeToken: true } : {},
    );
    return res.status(201).json({ success: true, message: 'Vehicle registered successfully', data: vehicle });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message, code: err.code, details: err.details });
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
    const vehicle = await vehicleService.updateVehicle(
      req.params.id,
      req.user.id,
      req.body,
      req.user.clientIds,
      { id: req.user.id, name: req.user.name, email: req.user.email },
    );
    return res.json({ success: true, message: 'Vehicle updated successfully', data: vehicle });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/vehicles/:id/reassign
 * Transfer a vehicle to another client in the caller's network.
 * Body: { targetClientId }
 */
const reassignVehicle = async (req, res) => {
  try {
    const vehicle = await vehicleService.reassignVehicle(
      req.params.id,
      req.body.targetClientId,
      req.user.clientIds,
      { id: req.user.id, name: req.user.name, email: req.user.email },
    );
    return res.json({ success: true, message: 'Vehicle reassigned successfully', data: vehicle });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/vehicles/:id/edit-history
 * Audit trail of edits to a vehicle (newest first).
 */
const getEditHistory = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const data = await vehicleService.getEditHistory(req.params.id, req.user.clientIds, { limit, offset });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/vehicles/:id
 */
const deleteVehicle = async (req, res) => {
  try {
    const result = await vehicleService.deleteVehicle(req.params.id, req.user.clientIds);
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
      req.user.clientIds,
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
    // SAME scope as getVehicles (via buildVehicleScope) so every vehicle on the
    // map also gets live updates — accounts by ownership, members by team.
    const scope = buildVehicleScope(req.user, req.query.clientId);
    const data = await vehicleService.getLivePositions(scope);

    // Geofence-as-address: when the account has opted in, tag each position
    // with the name of the geofence containing it so web/mobile can show the
    // geofence name as the vehicle's primary location. Best-effort — must
    // never break the live poll.
    try {
      const settings = await getUserSettings(req.user.id);
      if (settings.geofenceAsAddress) {
        const clientIds = req.user.clientIds?.length ? req.user.clientIds : [req.user.id];
        const fences = await Geofence.findAll({ where: { clientId: clientIds, isActive: true } });
        if (fences.length) {
          for (const p of data) {
            if (p.lat == null || p.lng == null) continue;
            const hit = fences.find(g => isPointInsideGeofence(g, p.lat, p.lng));
            if (hit) p.geofenceName = hit.name;
          }
        }
      }
    } catch { /* annotation only */ }

    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

module.exports = { getVehicles, getVehicleById, addVehicle, updateVehicle, reassignVehicle, deleteVehicle, syncVehicleData, testGpsData, getLocationPlayerData, getLivePositions, getEditHistory };
