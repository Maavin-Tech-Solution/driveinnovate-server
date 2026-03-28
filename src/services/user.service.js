const bcrypt = require('bcryptjs');
const { UniqueConstraintError, fn, col } = require('sequelize');
const { sequelize, User, UserMeta, Vehicle } = require('../models');

const getProfile = async (userId) => {
  const user = await User.findByPk(userId, { attributes: { exclude: ['password'] } });
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  return user;
};

const updateProfile = async (userId, { name, phone }) => {
  const user = await User.findByPk(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  await user.update({ name, phone });
  const { password: _, ...updated } = user.toJSON();
  return updated;
};

const updatePassword = async (userId, { currentPassword, newPassword }) => {
  const user = await User.findByPk(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  const isMatch = await bcrypt.compare(currentPassword, user.password);
  if (!isMatch) {
    const err = new Error('Current password is incorrect');
    err.status = 400;
    throw err;
  }
  const hashed = await bcrypt.hash(newPassword, 12);
  await user.update({ password: hashed });
  return { message: 'Password updated successfully' };
};

const updateNotifications = async (userId, { emailNotifications, smsNotifications, marketingNotifications }) => {
  const user = await User.findByPk(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  await user.update({ emailNotifications, smsNotifications, marketingNotifications });
  const { password: _, ...updated } = user.toJSON();
  return updated;
};

const createClient = async (
  parentUserId,
  { name, email, phone, password, companyName, address, state, city, zip, country, businessCategory, gtin }
) => {
  const existing = await User.findOne({ where: { email } });
  if (existing) {
    const err = new Error('Email is already registered');
    err.status = 409;
    throw err;
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  let user;
  try {
    user = await User.create({
      parentId: parentUserId,
      name,
      email,
      phone,
      password: hashedPassword,
    });
  } catch (e) {
    if (e instanceof UniqueConstraintError) {
      const field = e.errors?.[0]?.path || 'email/phone';
      const err = new Error(`${field} is already registered`);
      err.status = 409;
      throw err;
    }
    throw e;
  }

  await UserMeta.create({
    userId: user.id,
    companyName,
    address,
    state,
    city,
    zip,
    country,
    businessCategory,
    gtin,
  });

  const { password: _, ...clientWithoutPassword } = user.toJSON();
  return clientWithoutPassword;
};

const listClients = async (parentUserId) => {
  const clients = await User.findAll({
    where: { parentId: parentUserId },
    attributes: { exclude: ['password'] },
    include: [{ model: UserMeta, as: 'meta', required: false }],
    order: [['created_at', 'DESC']],
  });

  if (!clients.length) return [];

  const ids = clients.map(c => c.id);

  // Batch: vehicle count per client
  const vcRows = await Vehicle.findAll({
    where: { clientId: ids },
    attributes: ['clientId', [fn('COUNT', col('id')), 'cnt']],
    group: ['clientId'],
    raw: true,
  });
  const vcMap = Object.fromEntries(vcRows.map(r => [r.clientId, Number(r.cnt)]));

  // Batch: sub-client count per client
  const scRows = await User.findAll({
    where: { parentId: ids },
    attributes: ['parentId', [fn('COUNT', col('id')), 'cnt']],
    group: ['parentId'],
    raw: true,
  });
  const scMap = Object.fromEntries(scRows.map(r => [r.parentId, Number(r.cnt)]));

  return clients.map(c => ({
    ...c.toJSON(),
    vehicleCount: vcMap[c.id] || 0,
    subClientCount: scMap[c.id] || 0,
  }));
};

const getClientDetail = async (callerClientIds, clientId) => {
  if (!callerClientIds.includes(clientId)) {
    const err = new Error('Access denied');
    err.status = 403;
    throw err;
  }

  const client = await User.findByPk(clientId, {
    attributes: { exclude: ['password'] },
    include: [{ model: UserMeta, as: 'meta', required: false }],
  });
  if (!client) {
    const err = new Error('Client not found');
    err.status = 404;
    throw err;
  }

  // Direct sub-clients
  const subClients = await User.findAll({
    where: { parentId: clientId },
    attributes: { exclude: ['password'] },
    include: [{ model: UserMeta, as: 'meta', required: false }],
    order: [['created_at', 'DESC']],
  });

  // Vehicle counts for sub-clients (batch)
  const subIds = subClients.map(sc => sc.id);
  let subVcMap = {};
  if (subIds.length) {
    const rows = await Vehicle.findAll({
      where: { clientId: subIds },
      attributes: ['clientId', [fn('COUNT', col('id')), 'cnt']],
      group: ['clientId'],
      raw: true,
    });
    subVcMap = Object.fromEntries(rows.map(r => [r.clientId, Number(r.cnt)]));
  }

  const subClientsData = subClients.map(sc => ({
    ...sc.toJSON(),
    vehicleCount: subVcMap[sc.id] || 0,
  }));

  // Direct vehicles
  const vehicles = await Vehicle.findAll({
    where: { clientId: clientId },
    attributes: ['id', 'vehicleNumber', 'vehicleName', 'vehicleIcon', 'deviceType', 'status', 'imei'],
    order: [['created_at', 'DESC']],
  });

  const vehicleCount = vehicles.length;
  const networkVehicleCount = vehicleCount + Object.values(subVcMap).reduce((s, c) => s + c, 0);

  return {
    client: client.toJSON(),
    subClients: subClientsData,
    vehicles: vehicles.map(v => v.toJSON()),
    stats: {
      subClientCount: subClients.length,
      vehicleCount,
      networkVehicleCount,
    },
  };
};

module.exports = {
  getProfile,
  updateProfile,
  updatePassword,
  updateNotifications,
  createClient,
  listClients,
  getClientDetail,
};
