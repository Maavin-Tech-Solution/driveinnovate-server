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

  // ── reserved for future feature flags ────────────────────────────────────
  // tripShareEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  tableName: 'system_settings',
  timestamps: true,
});

module.exports = SystemSetting;
