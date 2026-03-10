const settingsService = require('../services/settings.service');

/**
 * GET /api/settings
 * Get current user's settings
 */
const getSettings = async (req, res) => {
  try {
    const settings = await settingsService.getUserSettings(req.user.id);
    return res.json({ success: true, data: settings });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * PUT /api/settings
 * Update current user's settings
 */
const updateSettings = async (req, res) => {
  try {
    const settings = await settingsService.updateUserSettings(req.user.id, req.body);
    return res.json({ success: true, message: 'Settings updated successfully', data: settings });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/settings/reset
 * Reset current user's settings to defaults
 */
const resetSettings = async (req, res) => {
  try {
    const settings = await settingsService.resetUserSettings(req.user.id);
    return res.json({ success: true, message: 'Settings reset to defaults', data: settings });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getSettings,
  updateSettings,
  resetSettings,
};
