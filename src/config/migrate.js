/**
 * Startup column migration.
 *
 * Adds any columns that are defined in the Sequelize models but may not exist
 * in the live database (because sequelize.sync runs with alter:false).
 *
 * Each entry describes one column.  The migration checks INFORMATION_SCHEMA
 * first, so it is completely safe to run on every server start — columns that
 * already exist are silently skipped.
 *
 * Works on MySQL 5.7+ (no IF NOT EXISTS shorthand required).
 */

const { sequelize } = require('../models');

const MIGRATIONS = [
  // ── di_device_config ───────────────────────────────────────────────────────
  { table: 'di_device_config', column: 'capabilities', ddl: 'JSON NULL COMMENT "Capability flags snapshot"' },

  // ── vehicle_device_states ──────────────────────────────────────────────────
  { table: 'vehicle_device_states', column: 'last_altitude',         ddl: 'DECIMAL(8,2) NULL COMMENT "Last altitude metres"' },
  { table: 'vehicle_device_states', column: 'last_satellites',       ddl: 'TINYINT UNSIGNED NULL COMMENT "GPS satellite count"' },
  { table: 'vehicle_device_states', column: 'last_course',           ddl: 'SMALLINT UNSIGNED NULL COMMENT "Heading 0-359 deg"' },
  { table: 'vehicle_device_states', column: 'last_odometer_reading', ddl: 'DECIMAL(14,3) NULL COMMENT "Device hardware odometer km"' },
  { table: 'vehicle_device_states', column: 'last_battery',          ddl: 'DECIMAL(5,2) NULL COMMENT "Device battery V or %"' },
  { table: 'vehicle_device_states', column: 'last_external_voltage', ddl: 'DECIMAL(5,2) NULL COMMENT "Vehicle 12V supply V"' },
  { table: 'vehicle_device_states', column: 'last_gsm_signal',       ddl: 'TINYINT UNSIGNED NULL COMMENT "GSM signal strength"' },
  { table: 'vehicle_device_states', column: 'last_gps_packet_time',  ddl: 'DATETIME(6) NULL COMMENT "Time of last GPS-bearing packet"' },

  // ── trips ──────────────────────────────────────────────────────────────────
  { table: 'trips', column: 'driving_time_seconds', ddl: 'INT NULL DEFAULT 0 COMMENT "Seconds speed>0"' },
  { table: 'trips', column: 'engine_idle_seconds',  ddl: 'INT NULL DEFAULT 0 COMMENT "Seconds engine ON speed=0"' },
  { table: 'trips', column: 'idle_time',            ddl: 'INT NULL COMMENT "Alias for engine_idle_seconds"' },
  { table: 'trips', column: 'odometer_start',       ddl: 'DECIMAL(14,3) NULL COMMENT "Hardware odometer at trip start"' },
  { table: 'trips', column: 'odometer_end',         ddl: 'DECIMAL(14,3) NULL COMMENT "Hardware odometer at trip end"' },
  { table: 'trips', column: 'stoppage_count',       ddl: 'SMALLINT UNSIGNED NULL DEFAULT 0 COMMENT "Engine-off stops in trip"' },

  // ── vehicle_engine_sessions ────────────────────────────────────────────────
  { table: 'vehicle_engine_sessions', column: 'driving_seconds', ddl: 'INT NULL DEFAULT 0 COMMENT "Seconds speed>0 in session"' },
  { table: 'vehicle_engine_sessions', column: 'idle_seconds',    ddl: 'INT NULL DEFAULT 0 COMMENT "Seconds engine ON speed=0 in session"' },
  { table: 'vehicle_engine_sessions', column: 'odometer_start',  ddl: 'DECIMAL(14,3) NULL COMMENT "Hardware odometer at session start"' },
  { table: 'vehicle_engine_sessions', column: 'odometer_end',    ddl: 'DECIMAL(14,3) NULL COMMENT "Hardware odometer at session end"' },
];

async function runMigrations() {
  const [[{ db }]] = await sequelize.query('SELECT DATABASE() AS db');

  let added = 0;
  for (const { table, column, ddl } of MIGRATIONS) {
    const [[row]] = await sequelize.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = :db AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
      { replacements: { db, table, column } }
    );

    if (!row) {
      await sequelize.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
      console.log(`[migrate] ✓ Added ${table}.${column}`);
      added++;
    }
  }

  if (added === 0) {
    console.log('[migrate] All columns up to date — nothing to add');
  } else {
    console.log(`[migrate] Done — added ${added} column(s)`);
  }
}

module.exports = { runMigrations };
