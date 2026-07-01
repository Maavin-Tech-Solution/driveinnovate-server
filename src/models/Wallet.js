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

    // Spendable vehicle tokens. One token = 1 vehicle for 1 year (+ the client's
    // grace days). Never goes negative.
    balance: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
      comment: 'Available vehicle tokens (single billable type).',
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
