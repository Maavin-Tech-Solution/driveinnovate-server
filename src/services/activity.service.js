const { UserActivity } = require('../models');

// userId can be a single id or the network array [self, ...descendants].
// For papa/dealer the dashboard's Activity (7d) card now reflects the entire
// network's audit trail; for solo users it stays equivalent to their own.
const getActivities = async (userId, { page = 1, limit = 20 } = {}) => {
  const offset = (page - 1) * limit;
  const { count, rows } = await UserActivity.findAndCountAll({
    where: { userId },
    order: [['createdAt', 'DESC']],
    limit: parseInt(limit),
    offset,
  });
  return {
    activities: rows,
    pagination: {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / limit),
    },
  };
};

module.exports = { getActivities };
