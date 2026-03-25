const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TripShare = sequelize.define(
  'TripShare',
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    token: { type: DataTypes.STRING(64), unique: true, allowNull: false },
    vehicleId:     { type: DataTypes.INTEGER, allowNull: true },
    imei:          { type: DataTypes.STRING(50), allowNull: true },
    vehicleNumber: { type: DataTypes.STRING(50), allowNull: true },
    vehicleName:   { type: DataTypes.STRING(100), allowNull: true },
    vehicleIcon:   { type: DataTypes.STRING(50), allowNull: true, defaultValue: 'car' },
    deviceType:    { type: DataTypes.STRING(50), allowNull: true },
    fromTime:      { type: DataTypes.DATE, allowNull: false, field: 'from_time' },
    toTime:        { type: DataTypes.DATE, allowNull: false, field: 'to_time' },
    createdBy:     { type: DataTypes.INTEGER, allowNull: true, field: 'created_by' },
  },
  {
    tableName: 'trip_shares',
    underscored: true,
    timestamps: true,
  }
);

module.exports = TripShare;
