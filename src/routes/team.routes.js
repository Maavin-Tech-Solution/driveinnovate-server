const express = require('express');
const router = express.Router();
const validateConsumer = require('../middleware/validateConsumer');
const requirePermission = require('../middleware/requirePermission');
const teamController = require('../controllers/team.controller');

// All team-management routes require an authenticated account WITH canManageTeams.
// Members never hold canManageTeams, so they cannot reach any of these.
router.use(validateConsumer, requirePermission('canManageTeams'));

// Static sub-paths first so they don't get captured by '/:id'.
router.get('/assignable-vehicles', teamController.assignableVehicles); // owner's fleet (picker)
router.get('/members', teamController.listMembers);                    // owner's member pool

// Teams CRUD
router.get('/', teamController.list);
router.post('/', teamController.create);
router.get('/:id', teamController.detail);
router.patch('/:id', teamController.update);
router.delete('/:id', teamController.remove);

// Vehicle assignment — immediate per-vehicle toggle (+ bulk replace)
router.put('/:id/vehicles', teamController.setVehicles);
router.post('/:id/vehicles/:vehicleId', teamController.addVehicle);
router.delete('/:id/vehicles/:vehicleId', teamController.removeVehicle);

// Members
router.post('/:id/members', teamController.addMember);                       // create new login + attach
router.post('/:id/members/:userId', teamController.attachMember);            // attach EXISTING member (multi-team)
router.delete('/:id/members/:userId', teamController.removeMember);          // detach from this team
router.patch('/:id/members/:userId/permissions', teamController.setMemberPermissions);
router.delete('/:id/members/:userId/account', teamController.deleteMember);  // revoke login entirely

module.exports = router;
