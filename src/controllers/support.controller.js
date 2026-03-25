const supportService = require('../services/support.service');

const createTicket = async (req, res) => {
  try {
    const ticket = await supportService.createTicket(req.user.id, req.body, req.files || []);
    return res.status(201).json({ success: true, message: `Ticket ${ticket.ticketNumber} created successfully`, data: ticket });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const getTickets = async (req, res) => {
  try {
    const { page = 0, limit = 20, status, issueType } = req.query;
    const data = await supportService.getTickets(req.user.id, { page, limit, status, issueType });
    return res.json({ success: true, data });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const getTicketById = async (req, res) => {
  try {
    const ticket = await supportService.getTicketById(req.params.id, req.user.id);
    return res.json({ success: true, data: ticket });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

const updateTicketStatus = async (req, res) => {
  try {
    const ticket = await supportService.updateTicketStatus(req.params.id, req.user.id, req.body);
    return res.json({ success: true, message: 'Ticket updated', data: ticket });
  } catch (err) { return res.status(err.status || 500).json({ success: false, message: err.message }); }
};

module.exports = { createTicket, getTickets, getTicketById, updateTicketStatus };
