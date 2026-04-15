const crypto = require('crypto');
const { TripShare, LiveShare, Vehicle, VehicleGroup, VehicleGroupMember, VehicleDeviceState } = require('../models');
const { Location, FMB125Location, isMongoDBConnected } = require('../config/mongodb');
const { getSystemSettings } = require('./master.service');

const FMB125_DEVICE_TYPES = ['FMB125', 'FMB120', 'FMB130', 'FMB140', 'FMB920'];
const getLocationModel = (deviceType) =>
  deviceType && FMB125_DEVICE_TYPES.includes(deviceType.toUpperCase()) ? FMB125Location : Location;

/**
 * Create a shareable link for a trip time window.
 * @param {number} vehicleId
 * @param {number} clientId - must own the vehicle
 * @param {string} from  - ISO datetime string (trip startTime)
 * @param {string} to    - ISO datetime string (trip endTime)
 */
const createTripShare = async (vehicleId, clientId, from, to) => {
  const vehicle = await Vehicle.findOne({ where: { id: vehicleId, clientId } });
  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }

  const token = crypto.randomBytes(32).toString('hex');
  await TripShare.create({
    token,
    vehicleId:     vehicle.id,
    imei:          vehicle.imei,
    vehicleNumber: vehicle.vehicleNumber,
    vehicleName:   vehicle.vehicleName,
    vehicleIcon:   vehicle.vehicleIcon || 'car',
    deviceType:    vehicle.deviceType,
    fromTime:      new Date(from),
    toTime:        new Date(to),
    createdBy:     clientId,
  });

  return { token };
};

/**
 * Fetch the vehicle info + GPS locations for a share token (no auth).
 */
const getTripShareData = async (token) => {
  const share = await TripShare.findOne({ where: { token } });
  if (!share) {
    const err = new Error('Share link not found or expired');
    err.status = 404;
    throw err;
  }

  if (!isMongoDBConnected()) {
    const err = new Error('GPS data temporarily unavailable');
    err.status = 503;
    throw err;
  }

  const LocationModel = getLocationModel(share.deviceType);
  const imei = share.imei || '';
  const imeiVariations = [imei, imei.startsWith('0') ? imei.substring(1) : `0${imei}`];

  const locations = await LocationModel.find({
    imei:      { $in: imeiVariations },
    timestamp: { $gte: share.fromTime, $lte: share.toTime },
    latitude:  { $exists: true, $ne: null },
    longitude: { $exists: true, $ne: null },
  })
    .sort({ timestamp: 1 })
    .limit(10000)
    .select('timestamp latitude longitude speed ignition acc fuel -_id')
    .lean();

  return {
    vehicle: {
      vehicleNumber: share.vehicleNumber,
      vehicleName:   share.vehicleName,
      vehicleIcon:   share.vehicleIcon,
    },
    from:      share.fromTime,
    to:        share.toTime,
    locations,
  };
};

// ─── Live Share ───────────────────────────────────────────────────────────────

/**
 * Create a live-tracking share link.
 * @param {'vehicle'|'group'} shareType
 * @param {object}  target        - { vehicleId } or { groupId }
 * @param {number}  clientId      - creator's id
 * @param {number[]} clientIds    - full accessible descendant IDs (for ownership check)
 * @param {string|Date} expiresAt - ISO datetime for when the share expires
 * @param {object}  permissions   - req.user.permissions object
 */
const createLiveShare = async (shareType, target, clientId, clientIds, expiresAt, permissions) => {
  // ── Feature-flag check ───────────────────────────────────────────────────
  const settings = await getSystemSettings();
  if (!settings.liveShareEnabled) {
    const err = new Error('Live sharing is not enabled on this platform');
    err.status = 403;
    throw err;
  }

  // ── Permission check (papa always has canShareLiveLocation = true) ───────
  if (!permissions?.canShareLiveLocation) {
    const err = new Error('You do not have permission to share live location');
    err.status = 403;
    throw err;
  }
  const expiry = new Date(expiresAt);
  if (isNaN(expiry.getTime())) {
    const err = new Error('Invalid expiresAt value');
    err.status = 400;
    throw err;
  }
  if (expiry <= new Date()) {
    const err = new Error('expiresAt must be in the future');
    err.status = 400;
    throw err;
  }

  let meta = {};

  if (shareType === 'vehicle') {
    const { vehicleId } = target;
    const vehicle = await Vehicle.findOne({ where: { id: vehicleId, clientId: clientIds } });
    if (!vehicle) {
      const err = new Error('Vehicle not found');
      err.status = 404;
      throw err;
    }
    meta = {
      vehicleId:     vehicle.id,
      imei:          vehicle.imei,
      vehicleNumber: vehicle.vehicleNumber,
      vehicleName:   vehicle.vehicleName,
      vehicleIcon:   vehicle.vehicleIcon || 'car',
      deviceType:    vehicle.deviceType,
    };
  } else if (shareType === 'group') {
    const { groupId } = target;
    const group = await VehicleGroup.findOne({ where: { id: groupId, clientId: clientIds } });
    if (!group) {
      const err = new Error('Vehicle group not found');
      err.status = 404;
      throw err;
    }
    meta = {
      groupId:    group.id,
      groupName:  group.name,
      groupColor: group.color,
    };
  } else {
    const err = new Error('shareType must be vehicle or group');
    err.status = 400;
    throw err;
  }

  const token = crypto.randomBytes(32).toString('hex');
  await LiveShare.create({ token, shareType, ...meta, expiresAt: expiry, createdBy: clientId });
  return { token, expiresAt: expiry };
};

/**
 * Get share metadata + live positions for a public live-share token.
 * No authentication required.
 */
const getLiveShareData = async (token) => {
  const share = await LiveShare.findOne({ where: { token } });
  if (!share) {
    const err = new Error('Share link not found');
    err.status = 404;
    throw err;
  }
  if (new Date() > share.expiresAt) {
    const err = new Error('This share link has expired');
    err.status = 410;
    throw err;
  }

  let info = {};
  let positions = [];

  if (share.shareType === 'vehicle') {
    info = {
      type:          'vehicle',
      vehicleNumber: share.vehicleNumber,
      vehicleName:   share.vehicleName,
      vehicleIcon:   share.vehicleIcon,
      deviceType:    share.deviceType,
    };

    if (share.vehicleId) {
      const state = await VehicleDeviceState.findOne({
        where: { vehicleId: share.vehicleId },
        attributes: ['vehicleId', 'lastLat', 'lastLng', 'lastSpeed', 'engineOn', 'lastPacketTime'],
      });
      if (state) {
        positions = [{
          id:             share.vehicleId,
          vehicleNumber:  share.vehicleNumber,
          vehicleName:    share.vehicleName,
          vehicleIcon:    share.vehicleIcon,
          lat:            state.lastLat  ? parseFloat(state.lastLat)  : null,
          lng:            state.lastLng  ? parseFloat(state.lastLng)  : null,
          speed:          state.lastSpeed ?? 0,
          engineOn:       state.engineOn ?? false,
          lastPacketTime: state.lastPacketTime ?? null,
        }];
      }
    }
  } else {
    // group share — load all member vehicles
    const members = await VehicleGroupMember.findAll({
      where: { groupId: share.groupId },
      include: [{ model: Vehicle, as: 'vehicle', attributes: ['id', 'vehicleNumber', 'vehicleName', 'vehicleIcon', 'deviceType'] }],
    });
    const vehicleIds = members.map(m => m.vehicleId).filter(Boolean);

    info = {
      type:       'group',
      groupName:  share.groupName,
      groupColor: share.groupColor,
    };

    if (vehicleIds.length) {
      const states = await VehicleDeviceState.findAll({
        where: { vehicleId: vehicleIds },
        attributes: ['vehicleId', 'lastLat', 'lastLng', 'lastSpeed', 'engineOn', 'lastPacketTime'],
      });
      const stateMap = new Map(states.map(s => [s.vehicleId, s]));

      positions = members.map(m => {
        const v = m.vehicle;
        if (!v) return null;
        const s = stateMap.get(v.id);
        return {
          id:             v.id,
          vehicleNumber:  v.vehicleNumber,
          vehicleName:    v.vehicleName,
          vehicleIcon:    v.vehicleIcon,
          lat:            s?.lastLat  ? parseFloat(s.lastLat)  : null,
          lng:            s?.lastLng  ? parseFloat(s.lastLng)  : null,
          speed:          s?.lastSpeed ?? 0,
          engineOn:       s?.engineOn ?? false,
          lastPacketTime: s?.lastPacketTime ?? null,
        };
      }).filter(Boolean);
    }
  }

  return { info, expiresAt: share.expiresAt, positions };
};

module.exports = { createTripShare, getTripShareData, createLiveShare, getLiveShareData };
