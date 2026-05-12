const { User } = require('../models');
const sc = require('../services/smartchallan.service');

const SC_FIELDS = ['scEnabled','scUsername','scPassword','scRtoEnabled','scChallanEnabled','scDlEnabled'];

exports.getSettings = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, { attributes: SC_FIELDS });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const d = user.toJSON();
    res.json({ success: true, data: {
      scEnabled:        !!d.scEnabled,
      scUsername:       d.scUsername || '',
      scRtoEnabled:     !!d.scRtoEnabled,
      scChallanEnabled: !!d.scChallanEnabled,
      scDlEnabled:      !!d.scDlEnabled,
      // never return the password back to client
    }});
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.saveSettings = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const { scEnabled, scUsername, scPassword, scRtoEnabled, scChallanEnabled, scDlEnabled } = req.body;
    const update = { scEnabled: !!scEnabled, scRtoEnabled: !!scRtoEnabled, scChallanEnabled: !!scChallanEnabled, scDlEnabled: !!scDlEnabled };
    if (scUsername !== undefined) update.scUsername = scUsername;
    // Only update password if a new non-empty one was sent
    if (scPassword && scPassword.trim()) update.scPassword = scPassword.trim();

    await user.update(update);
    res.json({ success: true, message: 'SmartChallan settings saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.testCredentials = async (req, res) => {
  try {
    const { scUsername, scPassword } = req.body;
    if (!scUsername || !scPassword) return res.status(400).json({ success: false, message: 'Username and password required' });
    const ok = await sc.testCredentials(scUsername, scPassword);
    res.json({ success: ok, message: ok ? 'Credentials verified' : 'Invalid credentials' });
  } catch (err) {
    res.status(401).json({ success: false, message: err.response?.data?.message || err.message });
  }
};

exports.getRtoData = async (req, res) => {
  // Respond within 20 s so the client never hangs indefinitely
  const timeout = setTimeout(() => {
    if (!res.headersSent) res.json({ success: true, data: [], disabled: false, timeout: true });
  }, 20_000);
  try {
    const user = await User.findByPk(req.user.id, { attributes: SC_FIELDS });
    console.log('[SC:RTO] user sc_enabled=%s sc_rto_enabled=%s', user?.scEnabled, user?.scRtoEnabled);
    clearTimeout(timeout);
    if (!user?.scEnabled || !user?.scRtoEnabled) return res.json({ success: true, data: [], disabled: true });
    if (!user.scUsername || !user.scPassword) return res.status(400).json({ success: false, message: 'SmartChallan credentials not configured' });
    const data = await sc.getRtoData(req.user.id, user.scUsername, user.scPassword);
    res.json({ success: true, data });
  } catch (err) {
    clearTimeout(timeout);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
};

exports.getChallanData = async (req, res) => {
  const timeout = setTimeout(() => {
    if (!res.headersSent) res.json({ success: true, data: [], disabled: false, timeout: true });
  }, 20_000);
  try {
    const user = await User.findByPk(req.user.id, { attributes: SC_FIELDS });
    clearTimeout(timeout);
    if (!user?.scEnabled || !user?.scChallanEnabled) return res.json({ success: true, data: [], disabled: true });
    if (!user.scUsername || !user.scPassword) return res.status(400).json({ success: false, message: 'SmartChallan credentials not configured' });
    const data = await sc.getChallanData(req.user.id, user.scUsername, user.scPassword);
    res.json({ success: true, data });
  } catch (err) {
    clearTimeout(timeout);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
};
