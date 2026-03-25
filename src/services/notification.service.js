const { Op } = require('sequelize');
const { Notification, Alert, Vehicle } = require('../models');

const getNotifications = async (clientId, { page = 0, limit = 50, unreadOnly = false } = {}) => {
  const where = { clientId };
  if (unreadOnly) where.isRead = false;

  const { count, rows } = await Notification.findAndCountAll({
    where,
    include: [
      { model: Vehicle, as: 'vehicle', attributes: ['id', 'vehicleNumber', 'vehicleName', 'vehicleIcon'], required: false },
      { model: Alert, as: 'alert', attributes: ['id', 'name', 'type'], required: false },
    ],
    order: [['triggeredAt', 'DESC']],
    limit: parseInt(limit),
    offset: parseInt(page) * parseInt(limit),
  });
  return { notifications: rows, total: count };
};

const getUnreadCount = async (clientId) => {
  return Notification.count({ where: { clientId, isRead: false } });
};

const markAsRead = async (id, clientId) => {
  const n = await Notification.findOne({ where: { id, clientId } });
  if (!n) { const e = new Error('Notification not found'); e.status = 404; throw e; }
  await n.update({ isRead: true });
  return n;
};

const markAllAsRead = async (clientId) => {
  const [count] = await Notification.update({ isRead: true }, { where: { clientId, isRead: false } });
  return { updated: count };
};

const deleteNotification = async (id, clientId) => {
  const n = await Notification.findOne({ where: { id, clientId } });
  if (!n) { const e = new Error('Notification not found'); e.status = 404; throw e; }
  await n.destroy();
  return { message: 'Notification deleted' };
};

module.exports = { getNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteNotification };
