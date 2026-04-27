const activityService = require('../services/activity.service');

/**
 * GET /api/activity?page=1&limit=20
 */
const getActivities = async (req, res) => {
  try {
    const { page, limit } = req.query;
    // Network scope: papa/dealer see audit logs for every account in their
    // tree; solo users see only their own (clientIds = [self]).
    const scope = req.user.clientIds || [req.user.id];
    const result = await activityService.getActivities(scope, { page, limit });
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

module.exports = { getActivities };
