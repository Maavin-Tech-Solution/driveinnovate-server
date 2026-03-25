const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const vehicleRoutes = require('./vehicle.routes');
const challanRoutes = require('./challan.routes');
const rtoRoutes = require('./rto.routes');
const dashboardRoutes = require('./dashboard.routes');
const activityRoutes = require('./activity.routes');
const reportRoutes = require('./report.routes');
const settingsRoutes = require('./settings.routes');
const debugRoutes = require('./debug.routes');
const groupRoutes = require('./group.routes');
const shareRoutes = require('./share.routes');
const alertRoutes = require('./alert.routes');
const notificationRoutes = require('./notification.routes');
const supportRoutes = require('./support.routes');

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/vehicles', vehicleRoutes);
router.use('/challans', challanRoutes);
router.use('/rto', rtoRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/activity', activityRoutes);
router.use('/reports', reportRoutes);
router.use('/settings', settingsRoutes);
router.use('/debug', debugRoutes);
router.use('/groups', groupRoutes);
router.use('/share', shareRoutes);
router.use('/alerts', alertRoutes);
router.use('/notifications', notificationRoutes);
router.use('/support', supportRoutes);

module.exports = router;
