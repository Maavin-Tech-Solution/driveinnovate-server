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
