const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contact.controller');

// Public — no auth required
router.post('/', contactController.submit);

module.exports = router;
