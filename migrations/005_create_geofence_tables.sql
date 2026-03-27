-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 005 — Geofences
-- ─────────────────────────────────────────────────────────────────────────────

-- geofences ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geofences (
  id              INT          NOT NULL AUTO_INCREMENT,
  client_id       INT          NOT NULL,

  name            VARCHAR(150) NOT NULL,
  description     VARCHAR(300)     NULL,

  -- CIRCULAR or POLYGON
  type            ENUM('CIRCULAR','POLYGON') NOT NULL,

  -- CIRCULAR fields (NULL when type = POLYGON)
  center_lat      DECIMAL(10,7)    NULL COMMENT 'Centre latitude',
  center_lng      DECIMAL(10,7)    NULL COMMENT 'Centre longitude',
  radius_meters   DECIMAL(10,2)    NULL COMMENT 'Radius in metres',

  -- POLYGON field (NULL when type = CIRCULAR)
  -- Stored as JSON array: [{"lat":28.6,"lng":77.2}, ...]
  coordinates     JSON             NULL COMMENT 'Ordered vertex array for polygon',

  color           VARCHAR(20)      NULL DEFAULT '#3b82f6',
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,

  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_geofences_client (client_id),
  INDEX idx_geofences_active (client_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- geofence_assignments ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS geofence_assignments (
  id              INT          NOT NULL AUTO_INCREMENT,
  geofence_id     INT          NOT NULL,

  -- VEHICLE: targets a single vehicle
  -- GROUP  : targets all vehicles in a group
  scope           ENUM('VEHICLE','GROUP') NOT NULL,

  vehicle_id      INT              NULL COMMENT 'Set when scope = VEHICLE',
  group_id        INT              NULL COMMENT 'Set when scope = GROUP',

  alert_on_entry  TINYINT(1)   NOT NULL DEFAULT 1,
  alert_on_exit   TINYINT(1)   NOT NULL DEFAULT 1,

  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  -- Prevent duplicate vehicle assignments on the same geofence
  UNIQUE KEY uq_geo_vehicle (geofence_id, vehicle_id),
  -- Prevent duplicate group assignments on the same geofence
  UNIQUE KEY uq_geo_group  (geofence_id, group_id),

  INDEX idx_gfa_geofence  (geofence_id),
  INDEX idx_gfa_vehicle   (vehicle_id),
  INDEX idx_gfa_group     (group_id),

  CONSTRAINT fk_gfa_geofence FOREIGN KEY (geofence_id) REFERENCES geofences (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
