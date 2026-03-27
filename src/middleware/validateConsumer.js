const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { resolveUserRole } = require('../services/auth.service');
const { getPermissions } = require('../services/permission.service');

const validateConsumer = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token is required',
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization format',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({
      where: { id: decoded.id, status: 'active' },
      attributes: { exclude: ['password'] },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found or account is inactive',
      });
    }

    // Attach role + full network IDs + permissions so every route can scope data correctly
    const roleData = await resolveUserRole(user);
    const permissions = await getPermissions(user);
    req.user = Object.assign(user, roleData, { permissions });
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Token has expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
    return res.status(500).json({ success: false, message: 'Authentication error' });
  }
};

module.exports = validateConsumer;
