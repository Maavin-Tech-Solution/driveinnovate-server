-- Run Database Migrations Script
-- Execute these migrations in order to create the necessary tables

-- Migration 001: Speed Violations Table
SOURCE ./001_create_speed_violations_table.sql;

-- Migration 002: Trips Table
SOURCE ./002_create_trips_table.sql;

-- Migration 003: Stops Table
SOURCE ./003_create_stops_table.sql;

-- Verify tables were created
SHOW TABLES LIKE '%violations%';
SHOW TABLES LIKE '%trips%';
SHOW TABLES LIKE '%stops%';

-- Show table structures
DESCRIBE speed_violations;
DESCRIBE trips;
DESCRIBE stops;
