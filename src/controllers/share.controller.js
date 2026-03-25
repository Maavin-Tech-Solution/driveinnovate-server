const shareService = require('../services/share.service');

/**
 * POST /api/share
 * Authenticated — creates a shareable token for a trip window.
 * Body: { vehicleId, from, to }
 */
exports.createShare = async (req, res) => {
  try {
    const { vehicleId, from, to } = req.body;
    if (!vehicleId || !from || !to) {
      return res.status(400).json({ success: false, message: 'vehicleId, from and to are required' });
    }
    const { token } = await shareService.createTripShare(vehicleId, req.user.id, from, to);
    return res.json({ success: true, data: { token } });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/share/:token
 * PUBLIC — no authentication required.
 * Returns vehicle info + GPS locations for the shared trip.
 */
exports.getShareData = async (req, res) => {
  try {
    const data = await shareService.getTripShareData(req.params.token);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};
