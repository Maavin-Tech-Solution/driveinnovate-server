const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * Each individual ignition ON → OFF period.
 * One trip can contain multiple sessions separated by brief stops
 * (traffic lights, short parking) that don't exceed the idle threshold.
 *
 * Maps to "Engine Hours Report" and "Idle Hours Report" in reporting module.
 */
const VehicleEngineSession = sequelize.define('VehicleEngineSession', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  vehicleId: { type: DataTypes.INTEGER, allowNull: false, field: 'vehicle_id' },
  imei: { type: DataTypes.STRING(20), allowNull: false },
  tripId: {
    type: DataTypes.INTEGER, allowNull: true, field: 'trip_id',
    comment: 'FK to trips — which logical trip this session belongs to',
  },

  // ── Timing ────────────────────────────────────────────────────────────────
  startTime: { type: DataTypes.DATE, allowNull: false, field: 'start_time' },
  endTime: { type: DataTypes.DATE, allowNull: true, field: 'end_time' },
  durationSeconds: {
    type: DataTypes.INTEGER, allowNull: true, field: 'duration_seconds',
    comment: 'Engine-on duration in seconds (endTime - startTime)',
  },
  drivingSeconds: {
    type: DataTypes.INTEGER, allowNull: true, defaultValue: 0, field: 'driving_seconds',
    comment: 'Seconds when speed > 0 within this session',
  },
  idleSeconds: {
    type: DataTypes.INTEGER, allowNull: true, defaultValue: 0, field: 'idle_seconds',
    comment: 'Seconds when engine ON but speed = 0 within this session',
  },

  // ── Positions ─────────────────────────────────────────────────────────────
  startLatitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true, field: 'start_latitude' },
  startLongitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true, field: 'start_longitude' },
  startLocation: { type: DataTypes.STRING(300), allowNull: true, field: 'start_location' },
  endLatitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true, field: 'end_latitude' },
  endLongitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true, field: 'end_longitude' },
  endLocation: { type: DataTypes.STRING(300), allowNull: true, field: 'end_location' },

  // ── Distance ──────────────────────────────────────────────────────────────
  distanceKm: {
    type: DataTypes.DECIMAL(10, 3), allowNull: true, defaultValue: 0, field: 'distance_km',
    comment: 'Haversine-accumulated km for this session',
  },
  odometerStart: {
    type: DataTypes.DECIMAL(14, 3), allowNull: true, field: 'odometer_start',
    comment: 'Device hardware odometer (km) at session start — FMB125, FMB920',
  },
  odometerEnd: {
    type: DataTypes.DECIMAL(14, 3), allowNull: true, field: 'odometer_end',
    comment: 'Device hardware odometer (km) at session end — FMB125, FMB920',
  },

  // ── Fuel ──────────────────────────────────────────────────────────────────
  startFuelLevel: {
    type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'start_fuel_level',
    comment: 'Fuel % at session start (FMB125, etc.)',
  },
  endFuelLevel: {
    type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'end_fuel_level',
    comment: 'Fuel % at session end',
  },
  fuelConsumed: {
    type: DataTypes.DECIMAL(6, 2), allowNull: true, defaultValue: 0, field: 'fuel_consumed',
    comment: 'Fuel % consumed during session (startFuelLevel - endFuelLevel)',
  },

  // ── Status ────────────────────────────────────────────────────────────────
  status: {
    type: DataTypes.ENUM('active', 'completed'), defaultValue: 'active', allowNull: false,
  },
}, {
  tableName: 'vehicle_engine_sessions',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['vehicle_id', 'start_time'] },
    { fields: ['imei', 'start_time'] },
    { fields: ['status'] },
  ],
});

module.exports = VehicleEngineSession;
