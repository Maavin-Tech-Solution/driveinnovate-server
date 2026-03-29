const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * One row per vehicle — tracks current device state for the real-time packet processor.
 * This is the "brain" of the state machine, not a report table.
 */
const VehicleDeviceState = sequelize.define('VehicleDeviceState', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  vehicleId: { type: DataTypes.INTEGER, allowNull: false, unique: true, field: 'vehicle_id' },
  imei: { type: DataTypes.STRING(20), allowNull: true },

  // Engine / ignition state
  engineOn: { type: DataTypes.BOOLEAN, defaultValue: false, field: 'engine_on' },
  engineOnSince: { type: DataTypes.DATE, allowNull: true, field: 'engine_on_since', comment: 'When current ignition-on session started' },
  engineOffSince: { type: DataTypes.DATE, allowNull: true, field: 'engine_off_since', comment: 'When engine last turned off (idle threshold timer)' },

  // Active session/trip pointers
  currentSessionId: { type: DataTypes.INTEGER, allowNull: true, field: 'current_session_id', comment: 'Active VehicleEngineSession id' },
  currentTripId: { type: DataTypes.INTEGER, allowNull: true, field: 'current_trip_id', comment: 'Active Trip id' },
  pendingTripEnd: { type: DataTypes.BOOLEAN, defaultValue: false, field: 'pending_trip_end', comment: 'Engine off but within idle threshold — do not close trip yet' },

  // Last known GPS position
  lastLat: { type: DataTypes.DECIMAL(10, 7), allowNull: true, field: 'last_lat' },
  lastLng: { type: DataTypes.DECIMAL(10, 7), allowNull: true, field: 'last_lng' },
  lastOdometer: { type: DataTypes.DECIMAL(12, 3), allowNull: true, field: 'last_odometer', comment: 'km' },
  lastSpeed: { type: DataTypes.SMALLINT, allowNull: true, field: 'last_speed' },
  lastFuelLevel: { type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'last_fuel_level', comment: 'Fuel % from last packet' },
  lastPacketTime: { type: DataTypes.DATE, allowNull: true, field: 'last_packet_time' },
  lastGpsPacketTime: { type: DataTypes.DATE, allowNull: true, field: 'last_gps_packet_time', comment: 'Time of last packet that carried real GPS coordinates (lat/lng) — used for alert staleness check' },
}, {
  tableName: 'vehicle_device_states',
  timestamps: true,
  underscored: true,
});

module.exports = VehicleDeviceState;
