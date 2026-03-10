const challanService = require('../services/challan.service');

/**
 * GET /api/challans
 */
const getChallans = async (req, res) => {
  try {
    const challans = await challanService.getChallans(req.user.id);
    return res.json({ success: true, data: challans });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/challans/:id
 */
const getChallanById = async (req, res) => {
  try {
    const challan = await challanService.getChallanById(req.params.id, req.user.id);
    return res.json({ success: true, data: challan });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/challans
 * Body: { vehicleId, challanNumber, amount, challanType, offense, challanDate, dueDate, location }
 */
const createChallan = async (req, res) => {
  try {
    const { vehicleId, challanNumber, amount, challanType, challanDate } = req.body;
    if (!vehicleId || !challanNumber || !amount || !challanType || !challanDate) {
      return res.status(400).json({ success: false, message: 'vehicleId, challanNumber, amount, challanType and challanDate are required' });
    }
    const challan = await challanService.createChallan(req.user.id, req.body);
    return res.status(201).json({ success: true, message: 'Challan created successfully', data: challan });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/challans/:id
 * Body: { amount, challanType, offense, status, location }
 */
const updateChallan = async (req, res) => {
  try {
    const challan = await challanService.updateChallan(req.params.id, req.user.id, req.body);
    return res.json({ success: true, message: 'Challan updated successfully', data: challan });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/challans/:id/pay
 * Body: { transactionId }
 */
const payChallan = async (req, res) => {
  try {
    const challan = await challanService.payChallan(req.params.id, req.user.id, req.body);
    return res.json({ success: true, message: 'Challan marked as paid', data: challan });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/challans/:id
 */
const deleteChallan = async (req, res) => {
  try {
    const result = await challanService.deleteChallan(req.params.id, req.user.id);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

module.exports = { getChallans, getChallanById, createChallan, updateChallan, payChallan, deleteChallan };
