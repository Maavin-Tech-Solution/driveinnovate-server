const { UserActivity } = require('../models');

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
