-- Create stops table for storing vehicle stop/parking data
CREATE TABLE IF NOT EXISTS stops (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vehicle_id INT NOT NULL,
    imei VARCHAR(20),
    start_time DATETIME NOT NULL,
    end_time DATETIME NOT NULL,
    duration INT NOT NULL COMMENT 'Duration in seconds',
    latitude DECIMAL(10, 7) NOT NULL,
    longitude DECIMAL(10, 7) NOT NULL,
    location VARCHAR(255),
    stop_type ENUM('PARKING', 'IDLE', 'TRAFFIC') NOT NULL COMMENT 'PARKING: engine off, IDLE: engine on, TRAFFIC: short stop',
    engine_status ENUM('ON', 'OFF') DEFAULT 'OFF',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- Foreign key
    FOREIGN KEY (vehicle_id) REFERENCES di_user_vehicle(id) ON DELETE CASCADE,
    
    -- Indexes for better query performance
    INDEX idx_vehicle_start_time (vehicle_id, start_time),
    INDEX idx_imei_start_time (imei, start_time),
    INDEX idx_start_time (start_time),
    INDEX idx_stop_type (stop_type),
    INDEX idx_duration (duration)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
