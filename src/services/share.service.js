const crypto = require('crypto');
const { TripShare, Vehicle } = require('../models');
const { Location, FMB125Location, isMongoDBConnected } = require('../config/mongodb');

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

module.exports = { createTripShare, getTripShareData };
