const { Alert, Vehicle, VehicleGroup, VehicleGroupMember } = require('../models');

const getAlerts = async (clientId) => {
  return Alert.findAll({
    where: { clientId },
    include: [
      { model: Vehicle, as: 'vehicle', attributes: ['id', 'vehicleNumber', 'vehicleName', 'vehicleIcon'], required: false },
    ],
    order: [['createdAt', 'DESC']],
  });
};

const getAlertById = async (id, clientId) => {
  const alert = await Alert.findOne({ where: { id, clientId } });
  if (!alert) { const e = new Error('Alert not found'); e.status = 404; throw e; }
  return alert;
};

const createAlert = async (clientId, data) => {
  const { name, description, type, scope, vehicleId, groupId, threshold, windowMinutes, cooldownMinutes, notifyEmails, isActive } = data;
  if (!name?.trim()) { const e = new Error('Alert name is required'); e.status = 400; throw e; }
  if (!type) { const e = new Error('Alert type is required'); e.status = 400; throw e; }
  if (!threshold || isNaN(threshold)) { const e = new Error('Threshold is required'); e.status = 400; throw e; }
  if (type === 'FUEL_THEFT' && (!windowMinutes || isNaN(windowMinutes))) {
    const e = new Error('windowMinutes is required for FUEL_THEFT alerts'); e.status = 400; throw e;
  }

  // Ownership checks
  if (scope === 'VEHICLE' && vehicleId) {
    const v = await Vehicle.findOne({ where: { id: vehicleId, clientId } });
    if (!v) { const e = new Error('Vehicle not found'); e.status = 404; throw e; }
  }
  if (scope === 'GROUP' && groupId) {
    const g = await VehicleGroup.findOne({ where: { id: groupId, clientId } });
    if (!g) { const e = new Error('Group not found'); e.status = 404; throw e; }
  }

  return Alert.create({
    clientId,
    name: name.trim(),
    description: description || null,
    type,
    scope: scope || 'ALL',
    vehicleId: scope === 'VEHICLE' ? vehicleId : null,
    groupId: scope === 'GROUP' ? groupId : null,
    threshold: parseFloat(threshold),
    windowMinutes: windowMinutes ? parseInt(windowMinutes) : null,
    cooldownMinutes: cooldownMinutes ? parseInt(cooldownMinutes) : 30,
    notifyEmails: notifyEmails || null,
    isActive: isActive !== false,
  });
};

const updateAlert = async (id, clientId, data) => {
  const alert = await Alert.findOne({ where: { id, clientId } });
  if (!alert) { const e = new Error('Alert not found'); e.status = 404; throw e; }
  const { name, description, type, scope, vehicleId, groupId, threshold, windowMinutes, cooldownMinutes, notifyEmails, isActive } = data;
  await alert.update({
    name: name ? name.trim() : alert.name,
    description: description !== undefined ? description : alert.description,
    type: type || alert.type,
    scope: scope || alert.scope,
    vehicleId: scope === 'VEHICLE' ? vehicleId : (scope === 'GROUP' || scope === 'ALL' ? null : alert.vehicleId),
    groupId:   scope === 'GROUP'   ? groupId   : (scope === 'VEHICLE' || scope === 'ALL' ? null : alert.groupId),
    threshold: threshold != null ? parseFloat(threshold) : alert.threshold,
    windowMinutes: windowMinutes != null ? parseInt(windowMinutes) : alert.windowMinutes,
    cooldownMinutes: cooldownMinutes != null ? parseInt(cooldownMinutes) : alert.cooldownMinutes,
    notifyEmails: notifyEmails !== undefined ? (notifyEmails || null) : alert.notifyEmails,
    isActive: isActive !== undefined ? isActive : alert.isActive,
  });
  return alert;
};

const toggleAlert = async (id, clientId) => {
  const alert = await Alert.findOne({ where: { id, clientId } });
  if (!alert) { const e = new Error('Alert not found'); e.status = 404; throw e; }
  await alert.update({ isActive: !alert.isActive });
  return alert;
};

const deleteAlert = async (id, clientId) => {
  const alert = await Alert.findOne({ where: { id, clientId } });
  if (!alert) { const e = new Error('Alert not found'); e.status = 404; throw e; }
  await alert.destroy();
  return { message: 'Alert deleted successfully' };
};

module.exports = { getAlerts, getAlertById, createAlert, updateAlert, toggleAlert, deleteAlert };
