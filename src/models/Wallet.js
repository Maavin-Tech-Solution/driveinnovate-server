const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * A prepaid coin wallet — one per user (papa / dealer / client).
 * 1 coin = ₹1. Balance is the spendable coin count.
 *
 * Coins flow DOWN the hierarchy: papa mints into its own wallet, then transfers
 * to dealers, who transfer to clients. A vehicle activation/renewal debits the
 * vehicle owner's (client's) wallet. Every movement is recorded as a
 * WalletTransaction row — the wallet balance is the running tally of that ledger.
 *
 * Concurrency: balance mutations MUST happen inside a transaction with a
 * `SELECT ... FOR UPDATE` row lock (see billing.service.adjustWallet) so two
 * simultaneous debits can never both pass the balance check.
 */
const Wallet = sequelize.define(
  'Wallet',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    userId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      field: 'user_id',
      comment: 'Owner of this wallet (di_user.id)',
    },

    // Total spendable tokens = balancePaid + balanceTesting + balanceGrace.
    // Kept as a denormalised sum for quick display; the per-type columns are the
    // source of truth (a vehicle spends ONE specific type, and the duration it
    // grants depends on that type).
    balance: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
      comment: 'Total vehicle tokens across all types (sum of the per-type balances).',
    },
    balancePaid: {
      type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'balance_paid',
      comment: 'Paid (billable) tokens — each grants 1 year + grace buffer',
    },
    balanceTesting: {
      type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'balance_testing',
      comment: 'Testing tokens — each grants the network test period (days)',
    },
    balanceGrace: {
      type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'balance_grace',
      comment: 'Grace/complimentary tokens — each grants the network grace period (days)',
    },

    status: {
      type: DataTypes.ENUM('active', 'frozen'),
      allowNull: false,
      defaultValue: 'active',
      comment: 'frozen = no debits/credits allowed (admin hold)',
    },
  },
  {
    tableName: 'di_wallet',
    underscored: true,
    timestamps: true,
  }
);

module.exports = Wallet;
