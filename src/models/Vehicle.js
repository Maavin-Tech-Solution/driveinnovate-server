const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Vehicle = sequelize.define(
  'Vehicle',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    vehicleNumber: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    vehicleName: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: 'Friendly display name for the vehicle',
    },
    chasisNumber: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    engineNumber: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    imei: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    sim1: {
      type: DataTypes.STRING(30),
      allowNull: true,
      comment: 'Primary SIM number in the GPS device (optional)',
    },
    sim2: {
      type: DataTypes.STRING(30),
      allowNull: true,
      comment: 'Secondary SIM number in the GPS device (optional)',
    },
    branch: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Branch or depot the vehicle belongs to (optional)',
    },
    clientId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    parentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'deleted'),
      defaultValue: 'active',
      allowNull: false,
    },
    rtoData: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    challanData: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    deviceName: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    deviceType: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    serverIp: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    serverPort: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    vehicleIcon: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: 'car',
    },
    idleThreshold: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5,
      comment: 'Minutes of engine-off before closing a trip (traffic vs parking)',
    },
    fuelFillThreshold: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5,
      comment: 'Minimum fuel % increase to count as a fill event',
    },
    fuelSupported: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'fuel_supported',
      comment: 'True if this vehicle has a fuel-level sensor wired (FMB only).',
    },
    fuelTankCapacity: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'fuel_tank_capacity',
      comment: 'Tank capacity in litres. Required when fuelSupported=true to resolve % → L.',
    },
    subscriptionExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'ACTUAL paid expiry (activation/renewal + 1 year). null = not on a paid subscription',
    },
    graceExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'grace_expires_at',
      comment: 'subscriptionExpiresAt + client grace days. Vehicle stays usable until this; then auto-inactivated',
    },
    expiryReminderSentAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'expiry_reminder_sent_at',
      comment: 'When the pre-expiry reminder was last sent for the current term (reset on renew)',
    },
  },
  {
    tableName: 'di_user_vehicle',
    underscored: true,
    timestamps: true,
    createdAt: 'registered_at',
    updatedAt: 'updated_at',
  }
);

module.exports = Vehicle;
