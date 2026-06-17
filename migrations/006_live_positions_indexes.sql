-- Indexes that keep GET /api/vehicles/live-positions fast at 5k+ vehicles.
--
-- The incremental poll runs:
--   SELECT ... FROM vehicle_device_states s
--   INNER JOIN di_user_vehicle v ON s.vehicle_id = v.id
--   WHERE v.client_id = ? AND s.last_seen_at > ?      -- incremental
-- (and the same without last_seen_at for the periodic full snapshot).
--
--   * di_user_vehicle.client_id  — scope the join to one client's fleet without
--     scanning every vehicle of every client.
--   * vehicle_device_states.last_seen_at — range-filter only the rows that
--     changed since the client's trailing watermark.
--   (vehicle_device_states.vehicle_id is already UNIQUE → indexed.)
--
-- Idempotent: each ADD INDEX is guarded so re-running is safe.

-- di_user_vehicle.client_id
SET @x := (SELECT COUNT(*) FROM information_schema.statistics
           WHERE table_schema = DATABASE() AND table_name = 'di_user_vehicle'
             AND index_name = 'idx_vehicle_client_id');
SET @sql := IF(@x = 0,
  'ALTER TABLE di_user_vehicle ADD INDEX idx_vehicle_client_id (client_id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- vehicle_device_states.last_seen_at
SET @y := (SELECT COUNT(*) FROM information_schema.statistics
           WHERE table_schema = DATABASE() AND table_name = 'vehicle_device_states'
             AND index_name = 'idx_vds_last_seen_at');
SET @sql := IF(@y = 0,
  'ALTER TABLE vehicle_device_states ADD INDEX idx_vds_last_seen_at (last_seen_at)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
