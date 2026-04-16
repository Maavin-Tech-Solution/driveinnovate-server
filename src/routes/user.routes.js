const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const validateConsumer = require('../middleware/validateConsumer');

// GET /api/users/me - get current user profile
router.get('/me', validateConsumer, userController.getProfile);

// PUT /api/users/me - update profile
router.put('/me', validateConsumer, userController.updateProfile);

// PUT /api/users/me/password - update password
router.put('/me/password', validateConsumer, userController.updatePassword);

// PUT /api/users/me/notifications - update notification preferences
router.put('/me/notifications', validateConsumer, userController.updateNotifications);

// GET  /api/users/client-tree - full recursive client tree (all descendants)
router.get('/client-tree', validateConsumer, userController.getClientTree);

// GET  /api/users/clients - list direct children of current user
router.get('/clients', validateConsumer, userController.listClients);

// GET  /api/users/clients/:clientId - full detail for a single client
router.get('/clients/:clientId', validateConsumer, userController.getClientDetail);

// POST /api/users/clients - create a client under current user
router.post('/clients', validateConsumer, userController.createClient);

// POST /api/users/clients/:clientId/upgrade - upgrade to billable (papa/dealer)
router.post('/clients/:clientId/upgrade', validateConsumer, userController.upgradeClient);

// POST /api/users/clients/:clientId/extend-trial - extend trial expiry (papa/dealer)
router.post('/clients/:clientId/extend-trial', validateConsumer, userController.extendClientTrial);

module.exports = router;
