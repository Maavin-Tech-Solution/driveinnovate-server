const express = require('express');
const router = express.Router();
const groupController = require('../controllers/group.controller');
const validateConsumer = require('../middleware/validateConsumer');

// GET  /api/groups            — list all groups for current user
router.get('/', validateConsumer, groupController.getGroups);

// POST /api/groups            — create a new group
router.post('/', validateConsumer, groupController.createGroup);

// PUT  /api/groups/:id        — update a group
router.put('/:id', validateConsumer, groupController.updateGroup);

// DELETE /api/groups/:id      — delete a group (and its memberships)
router.delete('/:id', validateConsumer, groupController.deleteGroup);

// POST   /api/groups/:id/vehicles              — add a vehicle to a group
router.post('/:id/vehicles', validateConsumer, groupController.addVehicleToGroup);

// DELETE /api/groups/:id/vehicles/:vehicleId   — remove a vehicle from a group
router.delete('/:id/vehicles/:vehicleId', validateConsumer, groupController.removeVehicleFromGroup);

module.exports = router;
