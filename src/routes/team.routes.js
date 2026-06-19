const express = require('express');
const router = express.Router();
const validateConsumer = require('../middleware/validateConsumer');
const requirePermission = require('../middleware/requirePermission');
const teamController = require('../controllers/team.controller');

// All team-management routes require an authenticated account WITH canManageTeams.
// Members never hold canManageTeams, so they cannot reach any of these.
router.use(validateConsumer, requirePermission('canManageTeams'));

// Vehicles the owner may assign (their own fleet) — used to populate the picker.
router.get('/assignable-vehicles', teamController.assignableVehicles);

// Teams CRUD
router.get('/', teamController.list);
router.post('/', teamController.create);
router.get('/:id', teamController.detail);
router.patch('/:id', teamController.update);
router.delete('/:id', teamController.remove);

// Vehicle assignment (full replace)
router.put('/:id/vehicles', teamController.setVehicles);

// Members
router.post('/:id/members', teamController.addMember);                       // create + attach
router.delete('/:id/members/:userId', teamController.removeMember);          // detach from this team
router.patch('/:id/members/:userId/permissions', teamController.setMemberPermissions);
router.delete('/:id/members/:userId/account', teamController.deleteMember);  // revoke login entirely

module.exports = router;
