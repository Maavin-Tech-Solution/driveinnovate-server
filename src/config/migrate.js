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
  { table: 'vehicle_device_states', column: 'first_seen_at', ddl: 'DATETIME NULL COMMENT "Real server UTC when the first packet was ever processed"' },
  { table: 'vehicle_device_states', column: 'last_seen_at',          ddl: 'DATETIME(6) NULL COMMENT "Real server UTC at last packet processing — never bumped by reconcile/migrations"' },
  { table: 'vehicle_device_states', column: 'last_movement',         ddl: 'TINYINT(1) NULL COMMENT "AIS140 movement sensor: 1=moving, 0=stationary, NULL=device has no movement sensor"' },

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
  { table: 'di_user', column: 'kind',             ddl: "ENUM('account','member') NOT NULL DEFAULT 'account' COMMENT \"account=papa/dealer/client hierarchy user; member=restricted team-member login\"" },
  { table: 'di_user', column: 'billing_type',     ddl: "ENUM('prepaid','postpaid') NOT NULL DEFAULT 'postpaid' COMMENT \"prepaid=wallet-token billing; postpaid=billed outside the module\"" },
  { table: 'di_user', column: 'grace_days',       ddl: 'INT NOT NULL DEFAULT 0 COMMENT "Extra days beyond the 1-year token term (grace period, set at account creation)"' },

  // ── di_user_permissions (Teams feature) ───────────────────────────────────
  { table: 'di_user_permissions', column: 'can_manage_teams', ddl: 'TINYINT(1) NOT NULL DEFAULT 0 COMMENT "Can create/manage teams and team members"' },

  // ── user_settings (Menu Manager) ──────────────────────────────────────────
  { table: 'user_settings', column: 'menu_config', ddl: 'JSON NULL COMMENT "Per-user custom 2-level sidebar layout { groups:[{label,items[]}] }"' },

  // ── SmartChallan integration settings ────────────────────────────────────
  { table: 'di_user', column: 'sc_enabled',          ddl: "TINYINT(1) NOT NULL DEFAULT 0 COMMENT \"Master toggle for SmartChallan integration\"" },
  { table: 'di_user', column: 'sc_username',          ddl: "VARCHAR(255) NULL COMMENT \"SmartChallan login email\"" },
  { table: 'di_user', column: 'sc_password',          ddl: "VARCHAR(255) NULL COMMENT \"SmartChallan password (stored as-is; rotate regularly)\"" },
  { table: 'di_user', column: 'sc_rto_enabled',       ddl: "TINYINT(1) NOT NULL DEFAULT 0 COMMENT \"Enable RTO data from SmartChallan\"" },
  { table: 'di_user', column: 'sc_challan_enabled',   ddl: "TINYINT(1) NOT NULL DEFAULT 0 COMMENT \"Enable Challan data from SmartChallan\"" },
  { table: 'di_user', column: 'sc_dl_enabled',        ddl: "TINYINT(1) NOT NULL DEFAULT 0 COMMENT \"Enable DL verification from SmartChallan\"" },

  // ── di_user_vehicle (per-vehicle subscription expiry + optional SIMs) ────
  { table: 'di_user_vehicle', column: 'subscription_expires_at', ddl: 'DATETIME NULL COMMENT "Billable subscription expiry per vehicle"' },
  { table: 'di_user_vehicle', column: 'sim1',   ddl: 'VARCHAR(30) NULL COMMENT "Primary SIM number in the GPS device (optional)"' },
  { table: 'di_user_vehicle', column: 'sim2',   ddl: 'VARCHAR(30) NULL COMMENT "Secondary SIM number in the GPS device (optional)"' },
  { table: 'di_user_vehicle', column: 'branch', ddl: 'VARCHAR(100) NULL COMMENT "Branch or depot the vehicle belongs to (optional)"' },
  { table: 'di_user_vehicle', column: 'fuel_supported',      ddl: 'TINYINT(1) NOT NULL DEFAULT 0 COMMENT "True if vehicle has a fuel-level sensor wired (FMB only)"' },
  { table: 'di_user_vehicle', column: 'fuel_tank_capacity',  ddl: 'INT NULL COMMENT "Tank capacity in litres (required when fuel_supported=1)"' },

  // ── alerts (FUEL_THEFT support) ──────────────────────────────────────────
  { table: 'alerts', column: 'window_minutes', ddl: 'INT NULL COMMENT "FUEL_THEFT: drop-window in minutes (threshold column holds the litres value)"' },

  // ── system_settings (trial feature flag + duration) ──────────────────────
  // NOTE: SystemSetting model has NO underscored:true, so Sequelize uses
  // camelCase column names directly (trialAccountEnabled, trialDurationDays).
  { table: 'system_settings', column: 'trialAccountEnabled', ddl: 'TINYINT(1) NOT NULL DEFAULT 0 COMMENT "Master switch for trial account expiry enforcement"' },
  { table: 'system_settings', column: 'trialDurationDays',   ddl: 'INT NOT NULL DEFAULT 5 COMMENT "Default trial period in days for new accounts"' },
  { table: 'system_settings', column: 'trialVehicleLimit',   ddl: 'INT NOT NULL DEFAULT 10 COMMENT "Max vehicles a trial account may register"' },

  // ── Billing module: system_settings (camelCase — SystemSetting has no underscored) ──
  { table: 'system_settings', column: 'billingEnabled',      ddl: 'TINYINT(1) NOT NULL DEFAULT 0 COMMENT "Master switch for the prepaid billing module"' },
  { table: 'system_settings', column: 'defaultMonthlyPrice', ddl: 'DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT "Network fallback per-vehicle monthly price (coins/₹)"' },
  { table: 'system_settings', column: 'defaultTaxPercent',   ddl: 'DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT "Default GST/tax % on invoices"' },

  // ── Billing module: di_user_meta (GST + invoice branding) ──────────────────
  { table: 'di_user_meta', column: 'gstin',                ddl: 'VARCHAR(20) NULL COMMENT "GST registration number on tax invoices"' },
  { table: 'di_user_meta', column: 'invoice_tax_percent',  ddl: 'DECIMAL(5,2) NULL COMMENT "Default GST % this issuer applies (null = system default)"' },
  { table: 'di_user_meta', column: 'invoice_prefix',       ddl: 'VARCHAR(12) NULL COMMENT "Invoice number prefix e.g. INV"' },
  { table: 'di_user_meta', column: 'logo_url',             ddl: 'VARCHAR(500) NULL COMMENT "Company logo URL for invoice letterhead"' },

  // ── Billing module: di_user_permissions ────────────────────────────────────
  { table: 'di_user_permissions', column: 'can_manage_billing', ddl: 'TINYINT(1) NOT NULL DEFAULT 0 COMMENT "Can manage wallets, rates, and issue/renew bills"' },

  // ── Billing module: di_invoice (token model — vehicle_count added later) ────
  { table: 'di_invoice', column: 'vehicle_count', ddl: 'INT NULL COMMENT "Vehicle tokens sold on a RECHARGE invoice"' },
  { table: 'di_invoice', column: 'token_type',    ddl: "ENUM('PAID','TESTING','GRACE') NOT NULL DEFAULT 'PAID' COMMENT \"Nature of tokens sold\"" },
  { table: 'di_invoice', column: 'accountable',   ddl: 'TINYINT(1) NOT NULL DEFAULT 1 COMMENT "false for free TESTING/GRACE grants"' },

  // ── Billing lifecycle: token type on ledger + grace + per-vehicle expiry ────
  { table: 'di_wallet_transaction', column: 'token_type', ddl: "ENUM('PAID','TESTING','GRACE') NOT NULL DEFAULT 'PAID' COMMENT \"PAID=billable, TESTING/GRACE=free\"" },
  { table: 'di_billing_rate',       column: 'grace_days', ddl: 'INT NOT NULL DEFAULT 0 COMMENT "Extra days beyond the 1-year term for this client"' },
  { table: 'di_user_vehicle',       column: 'grace_expires_at',        ddl: 'DATETIME NULL COMMENT "Actual expiry + grace days; auto-inactivated after this"' },
  { table: 'di_user_vehicle',       column: 'expiry_reminder_sent_at', ddl: 'DATETIME NULL COMMENT "When the pre-expiry reminder was last sent (reset on renew)"' },

  // ── Per-type token balances on the wallet ──────────────────────────────────
  { table: 'di_wallet', column: 'balance_paid',    ddl: 'INT NOT NULL DEFAULT 0 COMMENT "Paid (billable) tokens"' },
  { table: 'di_wallet', column: 'balance_testing', ddl: 'INT NOT NULL DEFAULT 0 COMMENT "Testing tokens"' },
  { table: 'di_wallet', column: 'balance_grace',   ddl: 'INT NOT NULL DEFAULT 0 COMMENT "Grace/complimentary tokens"' },

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
  // Token billing model: invoices are now primarily RECHARGE (token sales).
  {
    table:        'di_invoice',
    column:       'type',
    mustContain:  'RECHARGE',
    fullDdl:      "ENUM('RECHARGE','ACTIVATION','RENEWAL') NOT NULL",
  },
];

// Columns that must become NULLABLE on existing tables (the token model no longer
// ties an invoice to one vehicle period). Safe to run every start.
const NULLABLE_PATCHES = [
  { table: 'di_invoice', column: 'period_start', ddl: 'DATETIME NULL' },
  { table: 'di_invoice', column: 'period_end',   ddl: 'DATETIME NULL COMMENT "Billed-till date (ACTIVATION/RENEWAL vouchers only)"' },
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

  // Relax NOT NULL → NULL on existing columns (only when the column exists and is
  // currently NOT NULL). Skipped entirely on a fresh DB where sync already made it nullable.
  for (const { table, column, ddl } of NULLABLE_PATCHES) {
    const [[row]] = await sequelize.query(
      `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = :db AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
      { replacements: { db, table, column } }
    );
    if (row && row.IS_NULLABLE === 'NO') {
      await sequelize.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${ddl}`);
      console.log(`[migrate] ✓ Relaxed ${table}.${column} → NULLABLE`);
      added++;
    }
  }

  // One-time backfill: pre-split wallets had a single `balance` (all PAID). Move it
  // into balance_paid. Guarded so it only touches rows that were never split
  // (all three per-type columns still 0 while balance > 0).
  try {
    const [[col]] = await sequelize.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = :db AND TABLE_NAME = 'di_wallet' AND COLUMN_NAME = 'balance_paid'`,
      { replacements: { db } }
    );
    if (col) {
      const [res] = await sequelize.query(
        `UPDATE di_wallet SET balance_paid = balance
           WHERE balance > 0 AND balance_paid = 0 AND balance_testing = 0 AND balance_grace = 0`
      );
      if (res?.affectedRows) console.log(`[migrate] ✓ Backfilled balance_paid for ${res.affectedRows} wallet(s)`);
    }
  } catch (e) { console.warn('[migrate] wallet backfill skipped:', e.message); }

  if (added === 0) {
    console.log('[migrate] All columns up to date — nothing to add');
  } else {
    console.log(`[migrate] Done — added/patched ${added} column(s)`);
  }

  // ── Force-sync all built-in state conditions to canonical spec ───────────────
  // The seedBuiltIns upsert runs on server start and should handle this, but
  // SQL patches here guarantee correctness even if seedBuiltIns hasn't propagated
  // (e.g. server restarted before seedBuiltIns ran, or partial migration).
  const statePatches = [
    // Running: OR — GPS streak (>=3) OR AIS140 movement sensor
    {
      name: 'Running (runningStreak>=3 OR movement=true)',
      sql: `UPDATE di_state_definition
               SET conditions = '[{"field":"runningStreak","operator":"gte","value":3},{"field":"movement","operator":"eq","value":true}]',
                   condition_logic = 'OR', priority = 30, is_default = 0
             WHERE state_name = 'Running'
               AND (condition_logic != 'OR'
                 OR JSON_LENGTH(conditions) < 2
                 OR JSON_EXTRACT(conditions,'$[0].value') != 3)`,
    },
    // Idle: ignition=true AND speedZeroSeconds>=180
    {
      name: 'Idle (speedZeroSeconds>=180)',
      sql: `UPDATE di_state_definition
               SET conditions = '[{"field":"ignition","operator":"eq","value":true},{"field":"speedZeroSeconds","operator":"gte","value":180}]',
                   condition_logic = 'AND', priority = 40, is_default = 0
             WHERE state_name = 'Idle'
               AND (JSON_LENGTH(conditions) != 2
                 OR JSON_EXTRACT(conditions,'$[1].value') != 180)`,
    },
    // Stopped: ignition=false only
    {
      name: 'Stopped (ignition=false)',
      sql: `UPDATE di_state_definition
               SET conditions = '[{"field":"ignition","operator":"eq","value":false}]',
                   condition_logic = 'AND', priority = 50, is_default = 0
             WHERE state_name = 'Stopped'
               AND JSON_LENGTH(conditions) != 1`,
    },
    // Offline: lastSeenSeconds > 600
    {
      name: 'Offline (lastSeenSeconds>600)',
      sql: `UPDATE di_state_definition
               SET conditions = '[{"field":"lastSeenSeconds","operator":"gt","value":600}]',
                   condition_logic = 'AND', priority = 10, is_default = 0
             WHERE state_name = 'Offline'
               AND JSON_EXTRACT(conditions,'$[0].value') != 600`,
    },
  ];
  for (const patch of statePatches) {
    try {
      const [r] = await sequelize.query(patch.sql);
      if ((r?.affectedRows ?? 0) > 0) {
        console.log(`[migrate] ✓ Patched state "${patch.name}" on ${r.affectedRows} row(s)`);
      }
    } catch (err) {
      console.warn(`[migrate] State patch "${patch.name}" skipped:`, err.message);
    }
  }

  // ── Diagnostic: log current state definitions AND vehicle state data ─────────
  try {
    // 1. What conditions are stored in DB for each state
    const [stateRows] = await sequelize.query(`
      SELECT dc.type AS device_type, sd.state_name, sd.priority,
             sd.conditions, sd.is_default
        FROM di_state_definition sd
        JOIN di_device_config dc ON dc.id = sd.device_config_id
       WHERE dc.type IN ('GT06','GT06N','FMB125','FMB920','AIS140')
       ORDER BY dc.type, sd.priority
    `);
    if (stateRows.length) {
      // Print one device type as representative (all should be identical)
      const byType = {};
      stateRows.forEach(r => { (byType[r.device_type] = byType[r.device_type] || []).push(r); });
      const sample = byType['AIS140'] || byType['GT06'] || Object.values(byType)[0] || [];
      console.log('[migrate] ── State definitions in DB (sample device) ────────');
      sample.forEach(r => {
        const conds = (typeof r.conditions === 'string' ? JSON.parse(r.conditions) : r.conditions) || [];
        const condStr = conds.map(c => `${c.field} ${c.operator} ${c.value}`).join(' AND ') || '(default)';
        console.log(`[migrate]  P${r.priority} ${r.state_name}: ${condStr}${r.is_default ? ' [DEFAULT]' : ''}`);
      });
      console.log('[migrate] ────────────────────────────────────────────────────');
    }

    // 2. Vehicle state health per device type
    const [streakRows] = await sequelize.query(`
      SELECT
        v.device_type,
        COUNT(*)                              AS total,
        SUM(vds.running_streak >= 3)          AS streak_3_plus,
        SUM(vds.running_streak >= 1)          AS streak_1_plus,
        MAX(vds.running_streak)               AS max_streak,
        SUM(vds.engine_on = 1)                AS engine_on,
        SUM(vds.last_seen_at IS NOT NULL)     AS has_last_seen_at,
        SUM(vds.last_speed > 5)               AS speed_above_5
      FROM vehicle_device_states vds
      JOIN di_user_vehicle v ON v.id = vds.vehicle_id
      WHERE v.status != 'deleted'
      GROUP BY v.device_type
      ORDER BY v.device_type
    `);
    if (streakRows.length) {
      console.log('[migrate] ── Vehicle state health by device type ─────────────');
      streakRows.forEach(r => {
        console.log(
          `[migrate]  ${(r.device_type || 'unknown').padEnd(8)}: total=${r.total}` +
          ` | engineOn=${r.engine_on} | speed>5=${r.speed_above_5}` +
          ` | streak>=3=${r.streak_3_plus} | maxStreak=${r.max_streak}` +
          ` | hasLastSeenAt=${r.has_last_seen_at}`
        );
      });
      console.log('[migrate] ────────────────────────────────────────────────────');
    }
  } catch (err) {
    console.warn('[migrate] Diagnostic query skipped:', err.message);
  }

}

module.exports = { runMigrations };
