-- Create speed_violations table for storing speed violation records
CREATE TABLE IF NOT EXISTS speed_violations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_id INT NOT NULL,
    imei VARCHAR(50) NOT NULL,
    timestamp DATETIME NOT NULL,
    speed DECIMAL(5, 2) NOT NULL COMMENT 'Speed in km/h',
    speed_limit DECIMAL(5, 2) NOT NULL COMMENT 'Speed limit in km/h',
    excess_speed DECIMAL(5, 2) NOT NULL COMMENT 'Speed over limit in km/h',
    latitude DECIMAL(10, 7) NOT NULL,
    longitude DECIMAL(10, 7) NOT NULL,
    location VARCHAR(255),
    duration INT DEFAULT 0 COMMENT 'Duration of violation in seconds',
    severity ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') DEFAULT 'LOW' COMMENT 'LOW: 1-10 km/h over, MEDIUM: 11-20, HIGH: 21-40, CRITICAL: >40',
    acknowledged BOOLEAN DEFAULT FALSE COMMENT 'Has violation been reviewed/acknowledged',
    acknowledged_by INT,
    acknowledged_at DATETIME,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Foreign keys
    FOREIGN KEY (vehicle_id) REFERENCES di_user_vehicle(id) ON DELETE CASCADE,
    FOREIGN KEY (acknowledged_by) REFERENCES di_user(id) ON DELETE SET NULL,
    
    -- Indexes for better query performance
    INDEX idx_vehicle_timestamp (vehicle_id, timestamp),
    INDEX idx_imei_timestamp (imei, timestamp),
    INDEX idx_severity (severity),
    INDEX idx_acknowledged (acknowledged),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
