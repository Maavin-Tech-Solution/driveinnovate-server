const express = require('express');
const router = express.Router();
const billingController = require('../controllers/billing.controller');
const validateConsumer = require('../middleware/validateConsumer');
const requirePermission = require('../middleware/requirePermission');

// All billing routes require an authenticated user.
router.use(validateConsumer);

// ── Wallet (any authenticated user may view their OWN wallet/ledger) ──────────
router.get('/wallet',              billingController.getMyWallet);
router.get('/wallet/transactions', billingController.getTransactions);

// ── Network coin chain (dealer/papa) — gated by canManageBilling ─────────────
router.get('/network/wallets',  requirePermission('canManageBilling'), billingController.getNetworkWallets);
router.post('/mint',            requirePermission('canManageBilling'), billingController.mint);
router.post('/transfer',        requirePermission('canManageBilling'), billingController.transfer);

// ── Rate card (dealer/papa) ──────────────────────────────────────────────────
router.get('/rates',                requirePermission('canManageBilling'), billingController.getRates);
router.put('/rates/:clientId',      requirePermission('canManageBilling'), billingController.setRate);

// ── Quote (preview cost before charging) ─────────────────────────────────────
router.get('/quote', billingController.getQuote);

// ── Renew a vehicle's subscription ───────────────────────────────────────────
router.post('/vehicles/:id/renew', billingController.renewVehicle);

// ── Invoices ─────────────────────────────────────────────────────────────────
router.get('/invoices',     billingController.getInvoices);
router.get('/invoices/:id', billingController.getInvoice);

// ── Issuer billing settings (GST + branding) ─────────────────────────────────
router.get('/settings',  billingController.getSettings);
router.put('/settings',  requirePermission('canManageBilling'), billingController.updateSettings);

module.exports = router;
