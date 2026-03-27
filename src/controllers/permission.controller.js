const { User } = require('../models');
const { getPermissions, setPermissions } = require('../services/permission.service');

/**
 * GET /api/permissions/:userId
 * Parent fetches permissions for one of their direct children.
 * papa can fetch any user's permissions.
 */
const fetchPermissions = async (req, res) => {
  try {
    const targetId = Number(req.params.userId);
    const caller = req.user;

    // Only allow if caller is papa OR target is a direct child of caller
    if (Number(caller.parentId) !== 0) {
      const target = await User.findOne({ where: { id: targetId, parentId: caller.id } });
      if (!target) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }

    const target = await User.findByPk(targetId, { attributes: { exclude: ['password'] } });
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });

    const permissions = await getPermissions(target);
    return res.json({ success: true, data: { userId: targetId, permissions } });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/permissions/:userId
 * Parent updates permissions for one of their direct children.
 * papa can update any user's permissions.
 * Body: { canAddVehicle: true, canTrackVehicle: false, ... }
 */
const updatePermissions = async (req, res) => {
  try {
    const targetId = Number(req.params.userId);
    const caller = req.user;

    // Only allow if caller is papa OR target is a direct child of caller
    if (Number(caller.parentId) !== 0) {
      const target = await User.findOne({ where: { id: targetId, parentId: caller.id } });
      if (!target) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }
    }

    // papa's own permissions cannot be modified (always all-true)
    const target = await User.findByPk(targetId);
    if (!target) return res.status(404).json({ success: false, message: 'User not found' });
    if (Number(target.parentId) === 0) {
      return res.status(400).json({ success: false, message: 'Papa permissions cannot be modified' });
    }

    const permissions = await setPermissions(targetId, req.body);
    return res.json({ success: true, message: 'Permissions updated', data: { userId: targetId, permissions } });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

module.exports = { fetchPermissions, updatePermissions };
