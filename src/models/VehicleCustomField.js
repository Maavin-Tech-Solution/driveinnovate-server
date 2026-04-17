const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const VehicleCustomField = sequelize.define(
  'VehicleCustomField',
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
    fieldName: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    fieldValue: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
  },
  {
    tableName: 'di_vehicle_custom_fields',
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

module.exports = VehicleCustomField;
