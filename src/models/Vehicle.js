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
    serverIp: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    serverPort: {
      type: DataTypes.INTEGER,
      allowNull: true,
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
