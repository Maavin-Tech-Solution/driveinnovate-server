const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const VehicleSensor = sequelize.define(
  'VehicleSensor',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    vehicleId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM('number', 'boolean', 'text'),
      defaultValue: 'number',
      allowNull: false,
    },
    unit: {
      type: DataTypes.STRING(30),
      allowNull: true,
    },
    mappedParameter: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'Key in ioElements or device data, e.g. "9" for fuel level',
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    visible: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      allowNull: false,
    },
  },
  {
    tableName: 'vehicle_sensors',
    timestamps: true,
  }
);

module.exports = VehicleSensor;
