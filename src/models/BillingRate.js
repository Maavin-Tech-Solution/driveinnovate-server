const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * The monthly price (in coins/₹) charged PER VEHICLE for a given client.
 * A dealer sets one rate per client; that rate applies to every vehicle the
 * client activates/renews.
 *
 * Resolution order for a vehicle owned by client C (see billing.service.resolveRate):
 *   1. BillingRate row with clientId = C        (explicit per-client price)
 *   2. SystemSetting.defaultMonthlyPrice         (papa-set network default)
 *
 * One row per client (clientId unique). `setByUserId` records which dealer/papa
 * last set it (for audit).
 */
const BillingRate = sequelize.define(
  'BillingRate',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },

    clientId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      unique: true,
      field: 'client_id',
      comment: 'The client this price applies to (di_user.id)',
    },

    monthlyPrice: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      field: 'monthly_price',
      comment: 'Coins charged per vehicle per month (1 coin = ₹1)',
    },

    setByUserId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'set_by_user_id',
      comment: 'Dealer/papa who last set this rate',
    },
  },
  {
    tableName: 'di_billing_rate',
    underscored: true,
    timestamps: true,
  }
);

module.exports = BillingRate;
