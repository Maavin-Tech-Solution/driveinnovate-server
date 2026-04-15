const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const LiveShare = sequelize.define('LiveShare', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

  token: { type: DataTypes.STRING(64), unique: true, allowNull: false },

  /** 'vehicle' or 'group' */
  shareType: {
    type: DataTypes.ENUM('vehicle', 'group'),
    allowNull: false,
    defaultValue: 'vehicle',
  },

  // ── Vehicle share fields ───────────────────────────────────────────────────
  vehicleId:     { type: DataTypes.INTEGER, allowNull: true },
  imei:          { type: DataTypes.STRING(30), allowNull: true },
  vehicleNumber: { type: DataTypes.STRING(30), allowNull: true },
  vehicleName:   { type: DataTypes.STRING(100), allowNull: true },
  vehicleIcon:   { type: DataTypes.STRING(30), allowNull: true },
  deviceType:    { type: DataTypes.STRING(30), allowNull: true },

  // ── Group share fields ─────────────────────────────────────────────────────
  groupId:       { type: DataTypes.INTEGER, allowNull: true },
  groupName:     { type: DataTypes.STRING(100), allowNull: true },
  groupColor:    { type: DataTypes.STRING(10), allowNull: true },

  // ── Expiry ────────────────────────────────────────────────────────────────
  expiresAt: { type: DataTypes.DATE, allowNull: false },

  createdBy: { type: DataTypes.INTEGER, allowNull: false },
}, {
  tableName: 'live_shares',
  timestamps: true,
});

module.exports = LiveShare;
