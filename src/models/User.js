const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define(
  'User',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    parentId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(50),
      defaultValue: 'active',
    },
    accountType: {
      type: DataTypes.ENUM('trial', 'billable', 'demo', 'master'),
      defaultValue: 'trial',
      allowNull: false,
    },
    trialExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'When null on a trial account, no expiry is enforced',
    },
    // SmartChallan integration
    scEnabled:        { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false, field: 'sc_enabled' },
    scUsername:       { type: DataTypes.STRING(255), allowNull: true, field: 'sc_username' },
    scPassword:       { type: DataTypes.STRING(255), allowNull: true, field: 'sc_password' },
    scRtoEnabled:     { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false, field: 'sc_rto_enabled' },
    scChallanEnabled: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false, field: 'sc_challan_enabled' },
    scDlEnabled:      { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false, field: 'sc_dl_enabled' },
  },
  {
    tableName: 'di_user',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

module.exports = User;
