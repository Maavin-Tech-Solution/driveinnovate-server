const billingService = require('../services/billing.service');

const fail = (res, err) =>
  res.status(err.status || 500).json({
    success: false,
    message: err.message,
    code: err.code,
    details: err.details,
  });

// ─── Wallet ──────────────────────────────────────────────────────────────────
const getMyWallet = async (req, res) => {
  try {
    const data = await billingService.getMyWallet(req.user);
    return res.json({ success: true, data });
  } catch (err) { return fail(res, err); }
};

const getTransactions = async (req, res) => {
  try {
    const data = await billingService.listTransactions({
      user: req.user,
      targetUserId: req.query.userId,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.json({ success: true, data });
  } catch (err) { return fail(res, err); }
};

const getNetworkWallets = async (req, res) => {
  try {
    const data = await billingService.listNetworkWallets(req.user);
    return res.json({ success: true, data });
  } catch (err) { return fail(res, err); }
};

// ─── Coin movements ──────────────────────────────────────────────────────────
const mint = async (req, res) => {
  try {
    const data = await billingService.mintCoins({ actor: req.user, amount: req.body.amount, note: req.body.note });
    return res.json({ success: true, message: 'Coins minted', data });
  } catch (err) { return fail(res, err); }
};

const transfer = async (req, res) => {
  try {
    const data = await billingService.transferCoins({
      actor: req.user, toUserId: req.body.toUserId,
      vehicles: req.body.vehicles, unitPrice: req.body.unitPrice, note: req.body.note,
    });
    return res.json({ success: true, message: 'Vehicles added to wallet', data });
  } catch (err) { return fail(res, err); }
};

// ─── Rates ───────────────────────────────────────────────────────────────────
const getRates = async (req, res) => {
  try {
    const data = await billingService.listRates(req.user);
    return res.json({ success: true, data });
  } catch (err) { return fail(res, err); }
};

const setRate = async (req, res) => {
  try {
    const data = await billingService.setRate({ actor: req.user, clientId: req.params.clientId, monthlyPrice: req.body.monthlyPrice });
    return res.json({ success: true, message: 'Rate saved', data });
  } catch (err) { return fail(res, err); }
};

// ─── Recharge quote (preview ₹ for a token sale) ─────────────────────────────
const getQuote = async (req, res) => {
  try {
    const data = await billingService.quoteRecharge({
      actor: req.user, toUserId: req.query.toUserId, vehicles: req.query.vehicles, unitPrice: req.query.unitPrice,
    });
    return res.json({ success: true, data });
  } catch (err) { return fail(res, err); }
};

// ─── Renew (spend 1 token, +1 year) ──────────────────────────────────────────
const renewVehicle = async (req, res) => {
  try {
    const data = await billingService.renewVehicle({ actor: req.user, vehicleId: req.params.id });
    return res.json({ success: true, message: 'Vehicle renewed', data });
  } catch (err) { return fail(res, err); }
};

// ─── Invoices ────────────────────────────────────────────────────────────────
const getInvoices = async (req, res) => {
  try {
    const data = await billingService.listInvoices({
      user: req.user,
      page: req.query.page,
      limit: req.query.limit,
      clientId: req.query.clientId,
      vehicleId: req.query.vehicleId,
      type: req.query.type,
    });
    return res.json({ success: true, data });
  } catch (err) { return fail(res, err); }
};

const getInvoice = async (req, res) => {
  try {
    const data = await billingService.getInvoice(req.user, req.params.id);
    return res.json({ success: true, data });
  } catch (err) { return fail(res, err); }
};

// ─── Issuer settings ─────────────────────────────────────────────────────────
const getSettings = async (req, res) => {
  try {
    const data = await billingService.getBillingSettings(req.user);
    return res.json({ success: true, data });
  } catch (err) { return fail(res, err); }
};

const updateSettings = async (req, res) => {
  try {
    const data = await billingService.updateBillingSettings(req.user, req.body);
    return res.json({ success: true, message: 'Billing settings saved', data });
  } catch (err) { return fail(res, err); }
};

module.exports = {
  getMyWallet,
  getTransactions,
  getNetworkWallets,
  mint,
  transfer,
  getRates,
  setRate,
  getQuote,
  renewVehicle,
  getInvoices,
  getInvoice,
  getSettings,
  updateSettings,
};
