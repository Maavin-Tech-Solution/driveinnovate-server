/**
 * SystemSetting — single-row global feature flags for the platform.
 *
 * We enforce a single row (id = 1) so there is always exactly one settings
 * record.  Use upsert({ id: 1, ... }) to create-or-update safely.
 */
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SystemSetting = sequelize.define('SystemSetting', {
  id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },

  /** Master switch — when false the Live Share feature is hidden for everyone */
  liveShareEnabled: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },

  /** Master switch — enables trial account type with expiry enforcement */
  trialAccountEnabled: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },

  /** How many days a newly created trial account is valid (default 5) */
  trialDurationDays: { type: DataTypes.INTEGER, defaultValue: 5, allowNull: false },

  /** Max vehicles a trial account may register (default 10) */
  trialVehicleLimit: { type: DataTypes.INTEGER, defaultValue: 10, allowNull: false },

  /** Master switch — when false the prepaid billing module is hidden/disabled */
  billingEnabled: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },

  /** Months of validity one token grants a vehicle (default 1) */
  tokenValidityMonths: { type: DataTypes.INTEGER, defaultValue: 1, allowNull: false },

  /** Network-wide fallback monthly price (coins/₹) per vehicle when a client has no explicit BillingRate */
  defaultMonthlyPrice: { type: DataTypes.DECIMAL(14, 2), defaultValue: 0, allowNull: false },

  /** Default GST/tax % applied to invoices when an issuer has not set their own */
  defaultTaxPercent: { type: DataTypes.DECIMAL(5, 2), defaultValue: 0, allowNull: false },
}, {
  tableName: 'system_settings',
  timestamps: true,
});

module.exports = SystemSetting;
