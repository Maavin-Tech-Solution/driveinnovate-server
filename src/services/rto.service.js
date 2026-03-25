const { RtoDetail, Vehicle } = require('../models');

const getRtoDetails = async (userId) => {
  return RtoDetail.findAll({
    include: [{ model: Vehicle, as: 'vehicle', where: { clientId: userId }, attributes: ['vehicleNumber', 'vehicleName', 'deviceType'] }],
  });
};

const getRtoByVehicle = async (vehicleId, userId) => {
  const vehicle = await Vehicle.findOne({ where: { id: vehicleId, clientId: userId } });
  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }
  const rto = await RtoDetail.findOne({ where: { vehicleId } });
  if (!rto) {
    const err = new Error('RTO details not found for this vehicle');
    err.status = 404;
    throw err;
  }
  return rto;
};

const createRtoDetail = async (userId, data) => {
  const vehicle = await Vehicle.findOne({ where: { id: data.vehicleId, clientId: userId } });
  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }
  const existing = await RtoDetail.findOne({ where: { vehicleId: data.vehicleId } });
  if (existing) {
    const err = new Error('RTO details already exist for this vehicle. Use update instead.');
    err.status = 409;
    throw err;
  }
  return RtoDetail.create({ ...data, vehicleNumber: vehicle.vehicleNumber });
};

const updateRtoDetail = async (vehicleId, userId, data) => {
  const vehicle = await Vehicle.findOne({ where: { id: vehicleId, clientId: userId } });
  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }
  const rto = await RtoDetail.findOne({ where: { vehicleId } });
  if (!rto) {
    const err = new Error('RTO details not found');
    err.status = 404;
    throw err;
  }
  await rto.update(data);
  return rto;
};

module.exports = { getRtoDetails, getRtoByVehicle, createRtoDetail, updateRtoDetail };
