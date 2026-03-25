const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const validateConsumer = require('../middleware/validateConsumer');

router.get('/',              validateConsumer, notificationController.getNotifications);
router.get('/unread-count',  validateConsumer, notificationController.getUnreadCount);
router.patch('/read-all',    validateConsumer, notificationController.markAllAsRead);
router.patch('/:id/read',    validateConsumer, notificationController.markAsRead);
router.delete('/:id',        validateConsumer, notificationController.deleteNotification);

module.exports = router;
