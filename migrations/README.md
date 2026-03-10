# Database Migrations

This directory contains SQL migration files to create the necessary database tables for the reports system.

## How to Run Migrations

### Option 1: Using MySQL Command Line

```bash
# Navigate to the migrations directory
cd server/migrations

# Run each migration file individually
mysql -u your_username -p your_database_name < 001_create_speed_violations_table.sql
mysql -u your_username -p your_database_name < 002_create_trips_table.sql
mysql -u your_username -p your_database_name < 003_create_stops_table.sql
mysql -u your_username -p your_database_name < 004_create_user_settings_table.sql
```

### Option 2: Using MySQL Workbench or phpMyAdmin

1. Open your MySQL client
2. Select your database
3. Open and execute each `.sql` file in order:
   - `001_create_speed_violations_table.sql`
   - `002_create_trips_table.sql`
   - `003_create_stops_table.sql`
   - `004_create_user_settings_table.sql`

### Option 3: Using the run_migrations.sql script

```bash
mysql -u your_username -p your_database_name < run_migrations.sql
```

### Option 4: Using Node.js migration script

```bash
cd server
node run-migration.js
```

## Migrations Overview

### 001_create_speed_violations_table.sql
Creates the `speed_violations` table to store detected speed violations including:
- Speed and speed limit data
- Location information
- Severity classification (LOW, MEDIUM, HIGH, CRITICAL)
- Acknowledgment tracking
- Foreign keys to `di_user_vehicle` and `di_user` tables

### 002_create_trips_table.sql
Creates the `trips` table to store vehicle trip data including:
- Start/end times and locations
- Duration and distance
- Speed metrics (average and maximum)
- Route data (JSON array of GPS points)
- Fuel consumption and idle time

### 003_create_stops_table.sql
Creates the `stops` table to store vehicle stop/parking data including:
- Start/end times and location
- Duration
- Stop type classification (PARKING, IDLE, TRAFFIC)
- Engine status during stop

### 004_create_user_settings_table.sql
Creates the `user_settings` table to store user-level vehicle configurations including:
- Speed range color coding (JSON array with min, max, color, label)
- Speed alert thresholds
- Automatically populates defaults for existing users

## Verifying Migrations

After running migrations, verify the tables were created:

```sql
SHOW TABLES;
DESCRIBE speed_violations;
DESCRIBE trips;
DESCRIBE stops;
DESCRIBE user_settings;
```

## Notes

- All tables include proper foreign key relationships with the `di_user_vehicle` and `di_user` tables
- Indexes are added for optimal query performance on common search patterns
- Both tables support JSON data for flexible storage (route points, metadata)
- ENUM types are used for controlled categorical data (stop types, engine status, severity)
