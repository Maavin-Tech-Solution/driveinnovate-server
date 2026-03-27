const express = require('express');
const router = express.Router();
const validateConsumer = require('../middleware/validateConsumer');
const { fetchPermissions, updatePermissions } = require('../controllers/permission.controller');

// GET  /api/permissions/:userId  — get permissions for a child user
router.get('/:userId', validateConsumer, fetchPermissions);

// PUT  /api/permissions/:userId  — update permissions for a child user
router.put('/:userId', validateConsumer, updatePermissions);

module.exports = router;
