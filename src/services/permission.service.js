const { UserPermission } = require('../models');

const PERMISSION_KEYS = [
  'canAddVehicle',
  'canTrackVehicle',
  'canViewFleet',
  'canAddClient',
  'canManageGroups',
  'canManageGeofences',
  'canViewTrips',
  'canShareTrip',
  'canShareLiveLocation',
  'canViewReports',
  'canDownloadReports',
  'canSetAlerts',
  'canViewRTO',
  'canViewChallans',
  'canViewNotifications',
];

const ALL_TRUE = Object.fromEntries(PERMISSION_KEYS.map(k => [k, true]));
const ALL_FALSE = Object.fromEntries(PERMISSION_KEYS.map(k => [k, false]));

/**
 * Returns permissions for a user.
 * papa (parentId === 0) gets all permissions true.
 * Others get their DB record, or all-false if no record exists.
 */
const getPermissions = async (user) => {
  if (Number(user.parentId) === 0) return { ...ALL_TRUE };

  const record = await UserPermission.findOne({ where: { userId: user.id } });
  if (!record) return { ...ALL_FALSE };

  const data = record.toJSON();
  return Object.fromEntries(PERMISSION_KEYS.map(k => [k, Boolean(data[k])]));
};

/**
 * Upsert permissions for a user by their parent.
 * Only PERMISSION_KEYS entries are accepted; others are ignored.
 */
const setPermissions = async (userId, permissions) => {
  const [record] = await UserPermission.findOrCreate({
    where: { userId },
    defaults: { userId, ...ALL_FALSE },
  });

  const updates = {};
  for (const key of PERMISSION_KEYS) {
    if (key in permissions) updates[key] = Boolean(permissions[key]);
  }

  await record.update(updates);

  const fresh = await UserPermission.findOne({ where: { userId } });
  const data = fresh.toJSON();
  return Object.fromEntries(PERMISSION_KEYS.map(k => [k, Boolean(data[k])]));
};

module.exports = { getPermissions, setPermissions, PERMISSION_KEYS, ALL_TRUE };
