const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * A bill generated each time a vehicle is activated or renewed. Because the
 * model is prepaid, an invoice is created at the moment coins are deducted, so
 * it is always PAID on creation (status flips to VOID only on reversal).
 *
 * Issuer/client identity + tax fields are SNAPSHOTTED at issue time so a printed
 * invoice never changes even if the user later edits their company profile.
 *
 * totalAmount = baseAmount + taxAmount = exact coins debited from the client
 * wallet, and is linked to that DEBIT row via walletTransactionId.
 */
const Invoice = sequelize.define(
  'Invoice',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    invoiceNumber: {
      type: DataTypes.STRING(40),
      allowNull: false,
      unique: true,
      field: 'invoice_number',
      comment: 'Human-facing number e.g. INV-2026-000123',
    },

    // RECHARGE = a token sale (parent credits a child's wallet with N vehicle
    // tokens). ACTIVATION/RENEWAL retained for back-compat / optional vouchers.
    type: {
      type: DataTypes.ENUM('RECHARGE', 'ACTIVATION', 'RENEWAL'),
      allowNull: false,
    },

    status: {
      type: DataTypes.ENUM('PAID', 'VOID'),
      allowNull: false,
      defaultValue: 'PAID',
    },

    // Nature of the tokens sold. TESTING/GRACE recharges are free (zeroed money)
    // and accountable=false so they are excluded from revenue reporting.
    tokenType: {
      type: DataTypes.ENUM('PAID', 'TESTING', 'GRACE'),
      allowNull: false,
      defaultValue: 'PAID',
      field: 'token_type',
    },
    accountable: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: 'false for TESTING/GRACE grants — excluded from revenue/accounting',
    },

    // ── Parties ────────────────────────────────────────────────────────────
    clientId:     { type: DataTypes.INTEGER, allowNull: false, field: 'client_id',      comment: 'Billed party — the recipient/buyer of the tokens' },
    issuedByUserId:{ type: DataTypes.INTEGER, allowNull: false, field: 'issued_by_user_id', comment: 'Seller — the parent who issued the tokens' },
    vehicleId:    { type: DataTypes.INTEGER, allowNull: true,  field: 'vehicle_id', comment: 'Set only for ACTIVATION/RENEWAL vouchers; null for RECHARGE' },

    // Number of vehicle tokens sold on a RECHARGE invoice (1 token = 1 vehicle, 1 year).
    vehicleCount: { type: DataTypes.INTEGER, allowNull: true, field: 'vehicle_count' },

    // ── Subscription term (fixed 1 year per token) ─────────────────────────
    cycle: {
      type: DataTypes.ENUM('YEARLY'),
      allowNull: false,
      defaultValue: 'YEARLY',
    },
    cycleMonths:  { type: DataTypes.INTEGER, allowNull: false, defaultValue: 12, field: 'cycle_months', comment: 'Always 12 — billing cycle is fixed at 1 year' },
    periodStart:  { type: DataTypes.DATE,    allowNull: true, field: 'period_start' },
    periodEnd:    { type: DataTypes.DATE,    allowNull: true, field: 'period_end', comment: 'Billed-till date (ACTIVATION/RENEWAL vouchers only)' },

    // ── Money (₹) — what the buyer owes for the tokens ─────────────────────
    monthlyPrice: { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: 'monthly_price', comment: 'Per-vehicle price (1 year) used to value this sale' },
    baseAmount:   { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: 'base_amount', comment: 'vehicleCount × monthlyPrice' },
    taxPercent:   { type: DataTypes.DECIMAL(5, 2),  allowNull: false, defaultValue: 0, field: 'tax_percent' },
    taxAmount:    { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'tax_amount' },
    totalAmount:  { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: 'total_amount', comment: 'base + tax = invoice total' },

    walletTransactionId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'wallet_transaction_id',
      comment: 'The token DEBIT ledger row on the sender wallet for this sale',
    },

    // ── Snapshots for printing (frozen at issue time) ──────────────────────
    issuerSnapshot: { type: DataTypes.JSON, allowNull: true, field: 'issuer_snapshot', comment: '{name, company, address, gstin, phone, email, logoUrl}' },
    clientSnapshot: { type: DataTypes.JSON, allowNull: true, field: 'client_snapshot', comment: '{name, company, address, gstin, phone, email}' },
    vehicleSnapshot:{ type: DataTypes.JSON, allowNull: true, field: 'vehicle_snapshot', comment: '{vehicleNumber, imei, deviceType}' },

    notes: { type: DataTypes.STRING(500), allowNull: true },
  },
  {
    tableName: 'di_invoice',
    underscored: true,
    timestamps: true,
    indexes: [
      { fields: ['client_id'] },
      { fields: ['issued_by_user_id'] },
      { fields: ['vehicle_id'] },
    ],
  }
);

module.exports = Invoice;
