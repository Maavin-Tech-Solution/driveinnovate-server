const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

/**
 * One row per vehicle — tracks current device state for the real-time packet processor.
 * This is the "brain" of the state machine, not a report table.
 *
 * Fields are intentionally nullable so a fresh row can be created on first packet
 * without requiring values that only arrive later (e.g. fuel, odometer).
 *
 * Multi-device notes
 * ──────────────────
 * Fields prefixed with "last" store the most recently received sensor reading.
 * They are populated only when the device actually reports that sensor.
 * e.g. GT06 will never populate lastFuelLevel (it has no fuel sensor);
 *      FMB125 will populate lastOdometerReading from IO element 16.
 */
const VehicleDeviceState = sequelize.define('VehicleDeviceState', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  vehicleId: { type: DataTypes.INTEGER, allowNull: false, unique: true, field: 'vehicle_id' },
  imei: { type: DataTypes.STRING(20), allowNull: true },

  // ── Engine / ignition state ──────────────────────────────────────────────
  engineOn: { type: DataTypes.BOOLEAN, defaultValue: false, field: 'engine_on' },
  engineOnSince: {
    type: DataTypes.DATE, allowNull: true, field: 'engine_on_since',
    comment: 'When current ignition-on session started',
  },
  engineOffSince: {
    type: DataTypes.DATE, allowNull: true, field: 'engine_off_since',
    comment: 'When engine last turned off (idle threshold timer)',
  },

  // ── Active session/trip pointers ─────────────────────────────────────────
  currentSessionId: {
    type: DataTypes.INTEGER, allowNull: true, field: 'current_session_id',
    comment: 'Active VehicleEngineSession id',
  },
  currentTripId: {
    type: DataTypes.INTEGER, allowNull: true, field: 'current_trip_id',
    comment: 'Active Trip id',
  },
  pendingTripEnd: {
    type: DataTypes.BOOLEAN, defaultValue: false, field: 'pending_trip_end',
    comment: 'Engine off but within idle threshold — do not close trip yet',
  },

  // ── Last known GPS position ──────────────────────────────────────────────
  lastLat: { type: DataTypes.DECIMAL(10, 7), allowNull: true, field: 'last_lat' },
  lastLng: { type: DataTypes.DECIMAL(10, 7), allowNull: true, field: 'last_lng' },
  lastAltitude: {
    type: DataTypes.DECIMAL(8, 2), allowNull: true, field: 'last_altitude',
    comment: 'Last altitude in metres (FMB125, FMB920, etc.)',
  },
  lastSatellites: {
    type: DataTypes.TINYINT.UNSIGNED, allowNull: true, field: 'last_satellites',
    comment: 'Number of GPS satellites visible at last packet',
  },
  lastCourse: {
    type: DataTypes.SMALLINT.UNSIGNED, allowNull: true, field: 'last_course',
    comment: 'Heading in degrees (0–359)',
  },

  // ── Motion & performance ─────────────────────────────────────────────────
  lastSpeed: { type: DataTypes.SMALLINT, allowNull: true, field: 'last_speed' },
  // ── State-machine duration trackers (drive Idle / Running rules) ─────────
  speedZeroSince: {
    type: DataTypes.DATE, allowNull: true, field: 'speed_zero_since',
    comment: 'When speed last became 0; cleared the next time speed > 0. Drives the Idle rule (engine on + 4-min zero-speed window).',
  },
  runningStreak: {
    type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0, field: 'running_streak',
    comment: 'Consecutive packets observed with speed > 5 km/h. Drives the Running rule (3 in a row to avoid flapping).',
  },
  lastOdometer: {
    type: DataTypes.DECIMAL(12, 3), allowNull: true, field: 'last_odometer',
    comment: 'Haversine-accumulated distance (km) — used when device has no hardware odometer',
  },
  lastOdometerReading: {
    type: DataTypes.DECIMAL(14, 3), allowNull: true, field: 'last_odometer_reading',
    comment: 'Device hardware odometer (km) — FMB125 IO-16, FMB920, etc.',
  },

  // ── Fuel ────────────────────────────────────────────────────────────────
  lastFuelLevel: {
    type: DataTypes.DECIMAL(6, 2), allowNull: true, field: 'last_fuel_level',
    comment: 'Fuel level % from last packet (FMB125 IO-9)',
  },

  // ── Power & battery ──────────────────────────────────────────────────────
  lastBattery: {
    type: DataTypes.DECIMAL(5, 2), allowNull: true, field: 'last_battery',
    comment: 'Internal device battery (V or % depending on device)',
  },
  lastExternalVoltage: {
    type: DataTypes.DECIMAL(5, 2), allowNull: true, field: 'last_external_voltage',
    comment: 'Vehicle 12V supply voltage (FMB125 IO-67, FMB920, etc.)',
  },

  // ── Network / signal ─────────────────────────────────────────────────────
  lastGsmSignal: {
    type: DataTypes.TINYINT.UNSIGNED, allowNull: true, field: 'last_gsm_signal',
    comment: 'GSM signal strength (0–5 or raw RSSI depending on device)',
  },

  // ── Packet timing ────────────────────────────────────────────────────────
  lastPacketTime: {
    type: DataTypes.DATE, allowNull: true, field: 'last_packet_time',
  },
  lastGpsPacketTime: {
    type: DataTypes.DATE, allowNull: true, field: 'last_gps_packet_time',
    comment: 'Time of last packet that carried real GPS coordinates — used for alert staleness and gap detection',
  },
}, {
  tableName: 'vehicle_device_states',
  timestamps: true,
  underscored: true,
});

module.exports = VehicleDeviceState;
