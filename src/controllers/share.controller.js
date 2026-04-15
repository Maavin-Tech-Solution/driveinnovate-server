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

// ─── Live Share ───────────────────────────────────────────────────────────────

/**
 * POST /api/share/live
 * Authenticated — creates a live-tracking share token.
 * Body: { shareType, vehicleId?, groupId?, expiresAt }
 *   expiresAt: ISO datetime string — when the share expires.
 *              e.g. "2026-04-15T14:00:00+05:30"  (specific time)
 *              or compute client-side as  new Date(Date.now() + hours*3600000).toISOString()
 */
exports.createLiveShare = async (req, res) => {
  try {
    const { shareType, vehicleId, groupId, expiresAt } = req.body;
    if (!shareType || !expiresAt) {
      return res.status(400).json({ success: false, message: 'shareType and expiresAt are required' });
    }
    const target = shareType === 'vehicle' ? { vehicleId } : { groupId };
    const result = await shareService.createLiveShare(
      shareType,
      target,
      req.user.id,
      req.user.clientIds || [req.user.id],
      expiresAt,
      req.user.permissions,
    );
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/share/live/:token
 * PUBLIC — no authentication required.
 * Returns share metadata + current live positions.
 * Client polls this every 5 s.
 */
exports.getLiveShareData = async (req, res) => {
  try {
    const data = await shareService.getLiveShareData(req.params.token);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};
