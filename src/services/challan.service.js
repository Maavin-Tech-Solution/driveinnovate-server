const { Challan, Vehicle } = require('../models');

const getChallans = async (userId) => {
  return Challan.findAll({
    include: [{ model: Vehicle, as: 'vehicle', where: { userId }, attributes: ['vehicleNumber', 'name'] }],
    order: [['challanDate', 'DESC']],
  });
};

const getChallanById = async (id, userId) => {
  const challan = await Challan.findOne({
    where: { id },
    include: [{ model: Vehicle, as: 'vehicle', where: { userId } }],
  });
  if (!challan) {
    const err = new Error('Challan not found');
    err.status = 404;
    throw err;
  }
  return challan;
};

const createChallan = async (userId, data) => {
  const vehicle = await Vehicle.findOne({ where: { id: data.vehicleId, userId } });
  if (!vehicle) {
    const err = new Error('Vehicle not found or not authorized');
    err.status = 404;
    throw err;
  }
  return Challan.create({ ...data, vehicleNumber: vehicle.vehicleNumber });
};

const updateChallan = async (id, userId, data) => {
  const challan = await Challan.findOne({
    where: { id },
    include: [{ model: Vehicle, as: 'vehicle', where: { userId } }],
  });
  if (!challan) {
    const err = new Error('Challan not found');
    err.status = 404;
    throw err;
  }
  await challan.update(data);
  return challan;
};

const payChallan = async (id, userId, { transactionId }) => {
  const challan = await Challan.findOne({
    where: { id },
    include: [{ model: Vehicle, as: 'vehicle', where: { userId } }],
  });
  if (!challan) {
    const err = new Error('Challan not found');
    err.status = 404;
    throw err;
  }
  await challan.update({ status: 'paid', paymentDate: new Date(), transactionId });
  return challan;
};

const deleteChallan = async (id, userId) => {
  const challan = await Challan.findOne({
    where: { id },
    include: [{ model: Vehicle, as: 'vehicle', where: { userId } }],
  });
  if (!challan) {
    const err = new Error('Challan not found');
    err.status = 404;
    throw err;
  }
  await challan.destroy();
  return { message: 'Challan deleted successfully' };
};

module.exports = { getChallans, getChallanById, createChallan, updateChallan, payChallan, deleteChallan };
