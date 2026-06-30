const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Append-only ledger of every coin movement. One row = one balance change on
 * one wallet. This is the source of truth for "all transactions captured".
 *
 *  amount       — SIGNED. > 0 = coins came IN, < 0 = coins went OUT.
 *  balanceAfter — wallet balance immediately after this row was applied (audit).
 *  groupRef     — a transfer creates TWO rows (debit sender + credit receiver)
 *                 sharing the same groupRef so both legs are reconcilable.
 *  refType/refId — what caused it (a transfer, a vehicle charge → invoice, …).
 *
 * Rows are NEVER updated or deleted. A correction is a new REVERSAL/ADJUSTMENT
 * row, so the history is immutable and fully auditable.
 */
const WalletTransaction = sequelize.define(
  'WalletTransaction',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    walletId: { type: DataTypes.INTEGER, allowNull: false, field: 'wallet_id' },

    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'user_id',
      comment: 'Owner of the wallet this row belongs to (denormalised for scope queries)',
    },

    type: {
      type: DataTypes.ENUM('MINT', 'CREDIT', 'DEBIT', 'ADJUSTMENT', 'REVERSAL'),
      allowNull: false,
      comment: 'MINT=papa creates coins, CREDIT=received, DEBIT=spent/sent, ADJUSTMENT/REVERSAL=corrections',
    },

    // PAID = real/billable. TESTING/GRACE = free tokens that must NOT count as
    // revenue. The token's nature follows it through the ledger.
    tokenType: {
      type: DataTypes.ENUM('PAID', 'TESTING', 'GRACE'),
      allowNull: false,
      defaultValue: 'PAID',
      field: 'token_type',
      comment: 'PAID=billable, TESTING=trial (free), GRACE=goodwill (free)',
    },

    refType: {
      type: DataTypes.ENUM('MINT', 'TRANSFER', 'VEHICLE_ACTIVATION', 'VEHICLE_RENEWAL', 'MANUAL_ADJUST', 'REVERSAL'),
      allowNull: false,
      field: 'ref_type',
      comment: 'Business reason for the movement',
    },

    refId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'ref_id',
      comment: 'Linked entity id (invoice id for vehicle charges, etc.)',
    },

    amount: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      comment: 'SIGNED coins: +in / -out',
    },

    balanceAfter: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      field: 'balance_after',
      comment: 'Wallet balance immediately after applying this row',
    },

    counterpartyUserId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'counterparty_user_id',
      comment: 'The other party in a transfer (sender for a CREDIT, receiver for a DEBIT)',
    },

    performedByUserId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'performed_by_user_id',
      comment: 'The user who initiated the action (actor)',
    },

    groupRef: {
      type: DataTypes.STRING(40),
      allowNull: true,
      field: 'group_ref',
      comment: 'Shared id linking the two legs of a transfer (debit + credit)',
    },

    note: { type: DataTypes.STRING(300), allowNull: true },
  },
  {
    tableName: 'di_wallet_transaction',
    underscored: true,
    timestamps: true,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['group_ref'] },
      { fields: ['ref_type', 'ref_id'] },
    ],
  }
);

module.exports = WalletTransaction;
