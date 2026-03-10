const activityService = require('../services/activity.service');

/**
 * GET /api/activity?page=1&limit=20
 */
const getActivities = async (req, res) => {
  try {
    const { page, limit } = req.query;
    const result = await activityService.getActivities(req.user.id, { page, limit });
    return res.json({ success: true, data: result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

module.exports = { getActivities };
