const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const VehicleGroup = sequelize.define(
  'VehicleGroup',
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    color: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: '#3b82f6',
    },
    clientId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    tableName: 'vehicle_groups',
    underscored: true,
    timestamps: true,
  }
);

module.exports = VehicleGroup;
