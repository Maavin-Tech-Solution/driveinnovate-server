const userService = require('../services/user.service');

/**
 * GET /api/users/me
 */
const getProfile = async (req, res) => {
  try {
    const user = await userService.getProfile(req.user.id);
    return res.json({ success: true, data: user });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/users/me
 * Body: { name, phone }
 */
const updateProfile = async (req, res) => {
  try {
    const { name, phone } = req.body;
    const updated = await userService.updateProfile(req.user.id, { name, phone });
    return res.json({ success: true, message: 'Profile updated successfully', data: updated });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/users/me/password
 * Body: { currentPassword, newPassword }
 */
const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }
    const result = await userService.updatePassword(req.user.id, { currentPassword, newPassword });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/users/me/notifications
 * Body: { emailNotifications, smsNotifications, marketingNotifications }
 */
const updateNotifications = async (req, res) => {
  try {
    const { emailNotifications, smsNotifications, marketingNotifications } = req.body;
    const updated = await userService.updateNotifications(req.user.id, {
      emailNotifications,
      smsNotifications,
      marketingNotifications,
    });
    return res.json({ success: true, message: 'Notification preferences updated', data: updated });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/users/clients
 * Body: { name, email, phone, password, companyName, address, state, city, zip, country, businessCategory, gtin }
 */
const createClient = async (req, res) => {
  try {
    // Allow papa (parentId === 0), dealer (has children), or any user with canAddClient permission
    const isPapa = Number(req.user.parentId) === 0;
    const isDealer = req.user.role === 'dealer';
    const hasPermission = req.user.permissions?.canAddClient === true;
    if (!isPapa && !isDealer && !hasPermission) {
      return res.status(403).json({ success: false, message: 'You do not have permission to add clients.' });
    }

    const { name, email, phone, password, companyName, address, state, city, zip, country, businessCategory, gtin } = req.body;
    if (!name || !email || !phone || !password) {
      return res.status(400).json({ success: false, message: 'name, email, phone and password are required' });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ success: false, message: 'password must be at least 6 characters' });
    }

    const client = await userService.createClient(req.user.id, {
      name,
      email,
      phone,
      password,
      companyName,
      address,
      state,
      city,
      zip,
      country,
      businessCategory,
      gtin,
    });

    return res.status(201).json({ success: true, message: 'Client created successfully', data: client });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/users/clients
 * List direct children (clients/dealers) of the current user.
 */
const listClients = async (req, res) => {
  try {
    const clients = await userService.listClients(req.user.id);
    return res.json({ success: true, data: clients });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/users/clients/:clientId
 * Full detail: client info + sub-clients + direct vehicles + stats.
 */
const getClientDetail = async (req, res) => {
  try {
    const clientId = Number(req.params.clientId);
    const data = await userService.getClientDetail(req.user.clientIds, clientId);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/users/client-tree
 * Returns the full recursive client tree for the current user.
 * Any authenticated user with canAddClient permission (or papa/dealer) may call this.
 */
const getClientTree = async (req, res) => {
  try {
    const tree = await userService.buildClientTree(req.user.id);
    return res.json({ success: true, data: tree });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

module.exports = { getProfile, updateProfile, updatePassword, updateNotifications, createClient, listClients, getClientDetail, getClientTree };
