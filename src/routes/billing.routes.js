const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billing.controller');
const validateConsumer = require('../middleware/validateConsumer');

// All billing routes require an authenticated user.
router.use(validateConsumer);

// Billing-management guard: anyone with a downline (papa/dealer) OR the explicit
// canManageBilling permission can recharge/manage. This is what lets a DEALER
// recharge its own direct sub-dealers/clients (not just papa).
const requireBillingManager = (req, res, next) => {
  const u = req.user;
  if (u?.role === 'papa' || u?.hasClients === true || u?.permissions?.canManageBilling === true) return next();
  return res.status(403).json({ success: false, message: 'You do not have permission to manage billing.' });
};

// ── Wallet (any authenticated user may view their OWN wallet/ledger) ──────────
router.get('/wallet',              billingController.getMyWallet);
router.get('/wallet/transactions', billingController.getTransactions);

// ── Network chain (papa + any dealer over their own direct children) ─────────
router.get('/network/wallets',  requireBillingManager, billingController.getNetworkWallets);
router.post('/mint',            requireBillingManager, billingController.mint);      // service enforces papa-only
router.post('/transfer',        requireBillingManager, billingController.transfer);

// ── Rate card (papa / dealer) ────────────────────────────────────────────────
router.get('/rates',                requireBillingManager, billingController.getRates);
router.put('/rates/:clientId',      requireBillingManager, billingController.setRate);

// ── Quote (preview cost before charging) ─────────────────────────────────────
router.get('/quote', billingController.getQuote);

// ── Renew a vehicle's subscription ───────────────────────────────────────────
router.post('/vehicles/:id/renew', billingController.renewVehicle);

// ── Papa: manually override a vehicle's expiry (no token spend) ──────────────
router.put('/vehicles/:id/expiry', billingController.setVehicleExpiry);

// ── Invoices ─────────────────────────────────────────────────────────────────
router.get('/invoices',     billingController.getInvoices);
router.get('/invoices/:id', billingController.getInvoice);

// ── Issuer billing settings (GST + branding) ─────────────────────────────────
router.get('/settings',  billingController.getSettings);
router.put('/settings',  requireBillingManager, billingController.updateSettings);

module.exports = router;
