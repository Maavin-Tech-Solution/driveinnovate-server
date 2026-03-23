const { VehicleGroup, VehicleGroupMember, Vehicle } = require('../models');

const getGroups = async (clientId) => {
  return VehicleGroup.findAll({
    where: { clientId },
    include: [
      {
        model: Vehicle,
        as: 'vehicles',
        attributes: ['id', 'vehicleNumber', 'vehicleName', 'vehicleIcon', 'status'],
        through: { attributes: [] },
      },
    ],
    order: [['name', 'ASC']],
  });
};

const createGroup = async (clientId, { name, description, color }) => {
  return VehicleGroup.create({
    clientId,
    name: name.trim(),
    description: description || null,
    color: color || '#3b82f6',
  });
};

const updateGroup = async (id, clientId, { name, description, color }) => {
  const group = await VehicleGroup.findOne({ where: { id, clientId } });
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }
  await group.update({
    name: name ? name.trim() : group.name,
    description: description !== undefined ? description : group.description,
    color: color || group.color,
  });
  return group;
};

const deleteGroup = async (id, clientId) => {
  const group = await VehicleGroup.findOne({ where: { id, clientId } });
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }
  await VehicleGroupMember.destroy({ where: { groupId: id } });
  await group.destroy();
  return { message: 'Group deleted successfully' };
};

const addVehicleToGroup = async (groupId, clientId, vehicleId) => {
  const group = await VehicleGroup.findOne({ where: { id: groupId, clientId } });
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }
  const vehicle = await Vehicle.findOne({ where: { id: vehicleId, clientId } });
  if (!vehicle) {
    const err = new Error('Vehicle not found');
    err.status = 404;
    throw err;
  }
  const [member, created] = await VehicleGroupMember.findOrCreate({
    where: { groupId, vehicleId },
  });
  if (!created) {
    const err = new Error('Vehicle is already in this group');
    err.status = 409;
    throw err;
  }
  return member;
};

const removeVehicleFromGroup = async (groupId, clientId, vehicleId) => {
  const group = await VehicleGroup.findOne({ where: { id: groupId, clientId } });
  if (!group) {
    const err = new Error('Group not found');
    err.status = 404;
    throw err;
  }
  const deleted = await VehicleGroupMember.destroy({ where: { groupId, vehicleId } });
  if (!deleted) {
    const err = new Error('Vehicle is not in this group');
    err.status = 404;
    throw err;
  }
  return { message: 'Vehicle removed from group successfully' };
};

module.exports = { getGroups, createGroup, updateGroup, deleteGroup, addVehicleToGroup, removeVehicleFromGroup };
