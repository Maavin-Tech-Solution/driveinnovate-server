const rtoService = require('../services/rto.service');

/**
 * GET /api/rto
 */
const getRtoDetails = async (req, res) => {
  try {
    const rtoDetails = await rtoService.getRtoDetails(req.user.id);
    return res.json({ success: true, data: rtoDetails });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/rto/:vehicleId
 */
const getRtoByVehicle = async (req, res) => {
  try {
    const rto = await rtoService.getRtoByVehicle(req.params.vehicleId, req.user.id);
    return res.json({ success: true, data: rto });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/rto
 * Body: { vehicleId, bodyType, insuranceExpiry, insuranceCompany, insurancePolicyNumber,
 *         roadTaxExpiry, fitnessExpiry, pollutionExpiry, nationalPermitExpiry,
 *         nationalPermitNumber, registrationExpiry, ownerName }
 */
const createRtoDetail = async (req, res) => {
  try {
    const { vehicleId } = req.body;
    if (!vehicleId) {
      return res.status(400).json({ success: false, message: 'vehicleId is required' });
    }
    const rto = await rtoService.createRtoDetail(req.user.id, req.body);
    return res.status(201).json({ success: true, message: 'RTO details created successfully', data: rto });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/rto/:vehicleId
 * Body: { bodyType, insuranceExpiry, insuranceCompany, ... }
 */
const updateRtoDetail = async (req, res) => {
  try {
    const rto = await rtoService.updateRtoDetail(req.params.vehicleId, req.user.id, req.body);
    return res.json({ success: true, message: 'RTO details updated successfully', data: rto });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

module.exports = { getRtoDetails, getRtoByVehicle, createRtoDetail, updateRtoDetail };
