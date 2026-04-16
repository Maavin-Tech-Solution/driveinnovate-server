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

  /** How many days a newly created trial account is valid (default 30) */
  trialDurationDays: { type: DataTypes.INTEGER, defaultValue: 30, allowNull: false },
}, {
  tableName: 'system_settings',
  timestamps: true,
});

module.exports = SystemSetting;
