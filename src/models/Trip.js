const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * A logical journey — one or more engine sessions grouped by idle threshold.
 *
 * Trip duration breakdown (all in seconds):
 *   duration          = total wall-clock time (startTime → endTime)
 *   drivingTimeSeconds = time when speed > 0  (actual motion)
 *   engineIdleSeconds  = time when engine ON but speed = 0
 *   (duration - drivingTimeSeconds - engineIdleSeconds = engine-off stoppages within trip)
 *
 * Distance:
 *   distance          = haversine-accumulated km (always available)
 *   odometerStart/End = device hardware odometer (km) — only when device supports it
 *
 * stoppageCount = number of distinct stops (engine-off events) within the trip.
 */
const Trip = sequelize.define('Trip', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  vehicleId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'vehicle_id',
    references: { model: 'di_user_vehicle', key: 'id' },
  },
  imei: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },

  // ── Timing ────────────────────────────────────────────────────────────────
  startTime: {
    type: DataTypes.DATE, allowNull: false, field: 'start_time',
  },
  endTime: {
    type: DataTypes.DATE, allowNull: false, field: 'end_time',
  },
  duration: {
    type: DataTypes.INTEGER, allowNull: false,
    comment: 'Total trip wall-clock duration (seconds)',
  },
  drivingTimeSeconds: {
    type: DataTypes.INTEGER, allowNull: true, defaultValue: 0, field: 'driving_time_seconds',
    comment: 'Seconds when speed > 0 (actual motion)',
  },
  engineIdleSeconds: {
    type: DataTypes.INTEGER, allowNull: true, defaultValue: 0, field: 'engine_idle_seconds',
    comment: 'Seconds when engine ON but speed = 0 (idling in traffic / warm-up)',
  },
  idleTime: {
    type: DataTypes.INTEGER, allowNull: true, field: 'idle_time',
    comment: 'Alias kept for backward compatibility — same as engineIdleSeconds',
  },

  // ── Positions ─────────────────────────────────────────────────────────────
  startLatitude: {
    type: DataTypes.DECIMAL(10, 8), allowNull: true, field: 'start_latitude',
  },
  startLongitude: {
    type: DataTypes.DECIMAL(11, 8), allowNull: true, field: 'start_longitude',
  },
  startLocation: {
    type: DataTypes.STRING(255), allowNull: true, field: 'start_location',
    comment: 'Reverse geocoded start address',
  },
  endLatitude: {
    type: DataTypes.DECIMAL(10, 8), allowNull: true, field: 'end_latitude',
  },
  endLongitude: {
    type: DataTypes.DECIMAL(11, 8), allowNull: true, field: 'end_longitude',
  },
  endLocation: {
    type: DataTypes.STRING(255), allowNull: true, field: 'end_location',
    comment: 'Reverse geocoded end address',
  },

  // ── Distance ──────────────────────────────────────────────────────────────
  distance: {
    type: DataTypes.DECIMAL(10, 2), allowNull: false,
    comment: 'Haversine-accumulated distance in km (available for all devices)',
  },
  odometerStart: {
    type: DataTypes.DECIMAL(14, 3), allowNull: true, field: 'odometer_start',
    comment: 'Device hardware odometer (km) at trip start — FMB125, FMB920',
  },
  odometerEnd: {
    type: DataTypes.DECIMAL(14, 3), allowNull: true, field: 'odometer_end',
    comment: 'Device hardware odometer (km) at trip end — FMB125, FMB920',
  },

  // ── Speed ─────────────────────────────────────────────────────────────────
  avgSpeed: {
    type: DataTypes.DECIMAL(5, 2), allowNull: true, field: 'avg_speed',
    comment: 'Average speed over moving segments (km/h)',
  },
  maxSpeed: {
    type: DataTypes.DECIMAL(5, 2), allowNull: true, field: 'max_speed',
    comment: 'Peak speed in the trip (km/h)',
  },

  // ── Stoppages ─────────────────────────────────────────────────────────────
  stoppageCount: {
    type: DataTypes.SMALLINT.UNSIGNED, allowNull: true, defaultValue: 0, field: 'stoppage_count',
    comment: 'Number of distinct engine-off stops within the trip',
  },

  // ── Fuel ──────────────────────────────────────────────────────────────────
  fuelConsumed: {
    type: DataTypes.DECIMAL(8, 2), allowNull: true, field: 'fuel_consumed',
    comment: 'Fuel consumed during trip (% drop from device sensor, FMB125 etc.)',
  },

  // ── Route ─────────────────────────────────────────────────────────────────
  routeData: {
    type: DataTypes.JSON, allowNull: true, field: 'route_data',
    comment: 'Array of {lat, lng, ts, spd} sampled every ~30 s for route playback',
  },
}, {
  tableName: 'trips',
  timestamps: true,
  underscored: true,
  indexes: [
    { name: 'idx_vehicle_start_time', fields: ['vehicle_id', 'start_time'] },
    { name: 'idx_imei_start_time',    fields: ['imei', 'start_time'] },
    { name: 'idx_start_time',         fields: ['start_time'] },
  ],
});

module.exports = Trip;
