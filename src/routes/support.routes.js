const express = require('express');
const router = express.Router();
const supportController = require('../controllers/support.controller');
const validateConsumer = require('../middleware/validateConsumer');
const upload = require('../middleware/upload');

// List all tickets for the authenticated client
router.get('/', validateConsumer, supportController.getTickets);

// Get single ticket
router.get('/:id', validateConsumer, supportController.getTicketById);

// Create ticket (with optional file attachments — up to 5 files named "attachments")
router.post('/', validateConsumer, upload.array('attachments', 5), supportController.createTicket);

// Update status / priority / admin notes
router.patch('/:id', validateConsumer, supportController.updateTicketStatus);

module.exports = router;
