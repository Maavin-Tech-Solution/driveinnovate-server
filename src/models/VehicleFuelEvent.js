const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Fuel fill and drain events detected from fuel sensor.
 * Maps to "Fuel Fillings Total" (Sheet 6 of sample report).
 */
const VehicleFuelEvent = sequelize.define('VehicleFuelEvent', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  vehicleId: { type: DataTypes.INTEGER, allowNull: false, field: 'vehicle_id' },
  imei: { type: DataTypes.STRING(20), allowNull: false },
  eventType: { type: DataTypes.ENUM('fill', 'drain'), allowNull: false, field: 'event_type' },
  eventTime: { type: DataTypes.DATE, allowNull: false, field: 'event_time' },
  fuelBefore: { type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'fuel_before', comment: 'Fuel level % before event' },
  fuelAfter: { type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'fuel_after', comment: 'Fuel level % after event' },
  fuelChangePct: { type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'fuel_change_pct', comment: 'Absolute change in fuel %' },
  latitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  longitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  location: { type: DataTypes.STRING(300), allowNull: true, comment: 'Reverse-geocoded address' },
}, {
  tableName: 'vehicle_fuel_events',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['vehicle_id', 'event_time'] },
    { fields: ['imei', 'event_time'] },
    { fields: ['event_type'] },
  ],
});

module.exports = VehicleFuelEvent;
