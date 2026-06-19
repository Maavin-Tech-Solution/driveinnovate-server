// Route guard: allow only if req.user holds the given permission key.
// Papa (parentId === 0) implicitly holds every permission. Must run AFTER
// validateConsumer (which attaches req.user.permissions + role).
const requirePermission = (permissionKey) => (req, res, next) => {
  const u = req.user;
  const isPapa = u?.role === 'papa' || Number(u?.parentId) === 0;
  if (isPapa || u?.permissions?.[permissionKey] === true) return next();
  return res.status(403).json({
    success: false,
    message: 'You do not have permission to perform this action.',
  });
};

module.exports = requirePermission;
