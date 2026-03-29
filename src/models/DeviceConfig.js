const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const DeviceConfig = sequelize.define(
  'DeviceConfig',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Display name e.g. "GT06 GPS Tracker"',
    },
    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      comment: 'Unique code used across the app e.g. "GT06", "FMB125"',
    },
    serverIp: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'TCP server IP this device connects to',
    },
    serverPort: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'TCP server port',
    },
    mongoCollection: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'MongoDB collection name where packets are stored',
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    isBuiltIn: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Built-in devices (GT06, FMB125) cannot be deleted',
    },
  },
  {
    tableName: 'di_device_config',
    underscored: true,
    timestamps: true,
  }
);

module.exports = DeviceConfig;
