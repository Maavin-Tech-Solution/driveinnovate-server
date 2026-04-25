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
  { table: 'vehicle_device_states', column: 'speed_zero_since',      ddl: 'DATETIME(6) NULL COMMENT "When speed last became 0; cleared on speed>0. Drives Idle 4-min rule"' },
  { table: 'vehicle_device_states', column: 'running_streak',        ddl: 'TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT "Consecutive packets with speed>5. Drives Running 3-packets rule"' },

  // ── trips ──────────────────────────────────────────────────────────────────
  { table: 'trips', column: 'status', ddl: "ENUM('in_progress','completed') NOT NULL DEFAULT 'completed' COMMENT \"Trip lifecycle state\"" },
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

  // ── di_user (account type & trial expiry) ─────────────────────────────────
  { table: 'di_user', column: 'account_type',    ddl: "ENUM('trial','billable','demo','master') NOT NULL DEFAULT 'trial' COMMENT \"Account subscription type\"" },
  { table: 'di_user', column: 'trial_expires_at', ddl: 'DATETIME NULL COMMENT "Trial expiry timestamp; NULL = no expiry enforced"' },

  // ── di_user_vehicle (per-vehicle subscription expiry + optional SIMs) ────
  { table: 'di_user_vehicle', column: 'subscription_expires_at', ddl: 'DATETIME NULL COMMENT "Billable subscription expiry per vehicle"' },
  { table: 'di_user_vehicle', column: 'sim1', ddl: 'VARCHAR(30) NULL COMMENT "Primary SIM number in the GPS device (optional)"' },
  { table: 'di_user_vehicle', column: 'sim2', ddl: 'VARCHAR(30) NULL COMMENT "Secondary SIM number in the GPS device (optional)"' },
  { table: 'di_user_vehicle', column: 'fuel_supported',      ddl: 'TINYINT(1) NOT NULL DEFAULT 0 COMMENT "True if vehicle has a fuel-level sensor wired (FMB only)"' },
  { table: 'di_user_vehicle', column: 'fuel_tank_capacity',  ddl: 'INT NULL COMMENT "Tank capacity in litres (required when fuel_supported=1)"' },

  // ── alerts (FUEL_THEFT support) ──────────────────────────────────────────
  { table: 'alerts', column: 'window_minutes', ddl: 'INT NULL COMMENT "FUEL_THEFT: drop-window in minutes (threshold column holds the litres value)"' },

  // ── system_settings (trial feature flag + duration) ──────────────────────
  // NOTE: SystemSetting model has NO underscored:true, so Sequelize uses
  // camelCase column names directly (trialAccountEnabled, trialDurationDays).
  { table: 'system_settings', column: 'trialAccountEnabled', ddl: 'TINYINT(1) NOT NULL DEFAULT 0 COMMENT "Master switch for trial account expiry enforcement"' },
  { table: 'system_settings', column: 'trialDurationDays',   ddl: 'INT NOT NULL DEFAULT 30 COMMENT "Default trial period in days for new accounts"' },
];

/**
 * ENUM patches: applied when the column exists but may be missing a value.
 * Each entry checks INFORMATION_SCHEMA.COLUMNS for the exact COLUMN_TYPE and
 * runs MODIFY COLUMN if the expected value isn't present.
 *
 * Safe to run every start — the MODIFY is skipped when the ENUM already
 * contains the required value.
 */
const ENUM_PATCHES = [
  {
    table:        'di_user',
    column:       'account_type',
    mustContain:  'master',
    fullDdl:      "ENUM('trial','billable','demo','master') NOT NULL DEFAULT 'trial' COMMENT \"Account subscription type\"",
  },
  {
    table:        'alerts',
    column:       'type',
    mustContain:  'FUEL_THEFT',
    fullDdl:      "ENUM('SPEED_EXCEEDED','NOT_MOVING','IDLE_ENGINE','FUEL_THEFT') NOT NULL",
  },
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

  // Apply ENUM patches (expand enum values on existing columns)
  for (const { table, column, mustContain, fullDdl } of ENUM_PATCHES) {
    const [[row]] = await sequelize.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = :db AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
      { replacements: { db, table, column } }
    );
    if (row && !row.COLUMN_TYPE.includes(mustContain)) {
      await sequelize.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${fullDdl}`);
      console.log(`[migrate] ✓ Patched ENUM ${table}.${column} → added '${mustContain}'`);
      added++;
    }
  }

  if (added === 0) {
    console.log('[migrate] All columns up to date — nothing to add');
  } else {
    console.log(`[migrate] Done — added/patched ${added} column(s)`);
  }
}

module.exports = { runMigrations };
