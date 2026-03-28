const dashboardService = require('../services/dashboard.service');

/**
 * GET /api/dashboard/stats
 */
const getStats = async (req, res) => {
  try {
    const stats = await dashboardService.getStats(req.user.id);
    return res.json({ success: true, data: stats });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/dashboard/user-stats
 */
const getUserStats = async (req, res) => {
  try {
    const stats = await dashboardService.getUserStats(req.user.id);
    return res.json({ success: true, data: stats });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/dashboard/overspeed-vehicles?threshold=80
 */
const getOverspeedVehicles = async (req, res) => {
  try {
    const speedThreshold = parseInt(req.query.threshold) || 80;
    const vehicles = await dashboardService.getOverspeedVehicles(req.user.id, speedThreshold);
    return res.json({ success: true, data: vehicles });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/dashboard/network-stats
 * Requires papa / dealer role (clientIds in req.user contains full network).
 */
const getNetworkStats = async (req, res) => {
  try {
    const clientIds = req.user.clientIds || [req.user.id];
    const stats = await dashboardService.getNetworkStats(clientIds);
    return res.json({ success: true, data: stats });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

module.exports = { getStats, getUserStats, getOverspeedVehicles, getNetworkStats };
