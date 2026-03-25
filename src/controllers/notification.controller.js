const notificationService = require('../services/notification.service');

const getNotifications = async (req, res) => {
  try {
    const { page = 0, limit = 50, unreadOnly } = req.query;
    const data = await notificationService.getNotifications(req.user.id, {
      page: parseInt(page),
      limit: parseInt(limit),
      unreadOnly: unreadOnly === 'true',
    });
    return res.json({ success: true, data });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const getUnreadCount = async (req, res) => {
  try {
    const count = await notificationService.getUnreadCount(req.user.id);
    return res.json({ success: true, data: { count } });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const markAsRead = async (req, res) => {
  try {
    const n = await notificationService.markAsRead(req.params.id, req.user.id);
    return res.json({ success: true, data: n });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const markAllAsRead = async (req, res) => {
  try {
    const result = await notificationService.markAllAsRead(req.user.id);
    return res.json({ success: true, ...result });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const deleteNotification = async (req, res) => {
  try {
    const result = await notificationService.deleteNotification(req.params.id, req.user.id);
    return res.json({ success: true, ...result });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

module.exports = { getNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteNotification };
